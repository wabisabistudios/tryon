/**
 * Confidence scoring for deals.
 * Combines anomaly, cross-site, seller, and data-quality signals into a label.
 */

export const LEVELS = {
  VERIFIED: "verified",
  LIKELY: "likely",
  CHECK: "check manually",
};

/**
 * Build a confidence label and score from deal signals.
 * @param {object} signals
 * @returns {object} { level, score, reasons }
 */
export function scoreConfidence(signals) {
  const {
    anomalySeverity,
    fakeDiscount,
    crossSiteSources,
    historySamples,
    isFulfilled,
    sellerKnown,
    inStock,
    priceDropPct,
  } = signals;

  let score = 0;
  const reasons = [];

  if (crossSiteSources >= 2) {
    score += 25;
    reasons.push("price confirmed on multiple sites");
  } else if (crossSiteSources === 1) {
    score += 10;
  }

  if (historySamples >= 5) {
    score += 20;
    reasons.push("solid price history");
  } else if (historySamples >= 3) {
    score += 10;
  }

  if (anomalySeverity === "severe") {
    score += 25;
    reasons.push("statistically severe price drop");
  } else if (anomalySeverity === "moderate") {
    score += 15;
    reasons.push("notable price drop");
  }

  if (priceDropPct >= 0.30) {
    score += 10;
  }

  if (isFulfilled) {
    score += 10;
    reasons.push("fulfilled by marketplace");
  } else if (sellerKnown) {
    score += 5;
  }

  if (!fakeDiscount) {
    score += 10;
  } else {
    score -= 15;
    reasons.push("discount looks inflated");
  }

  if (!inStock) {
    score -= 30;
    reasons.push("item appears out of stock");
  }

  score = Math.max(0, Math.min(100, score));

  let level;
  if (score >= 75) level = LEVELS.VERIFIED;
  else if (score >= 50) level = LEVELS.LIKELY;
  else level = LEVELS.CHECK;

  return { level, score, reasons };
}
