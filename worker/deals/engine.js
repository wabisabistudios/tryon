/**
 * Main deal scoring engine.
 * Fetches history, computes anomaly/cross-site/confidence scores,
 * and returns ranked deals.
 */

import { detectAnomaly, velocityCheck, detectFakeDiscount } from "./engine/anomaly.js";
import { matchScore } from "./engine/matcher.js";
import { scoreConfidence } from "./engine/confidence.js";

/**
 * Score a single listing against its own price history.
 */
export function scoreListing(listing, historyPrices) {
  const price = listing.price;
  const listPrice = listing.list_price;

  const anomaly = detectAnomaly(price, historyPrices);
  const velocity = velocityCheck(price, historyPrices);
  const fakeDiscount = detectFakeDiscount(listPrice, historyPrices);

  const mean = historyPrices && historyPrices.length
    ? historyPrices.reduce((a, b) => a + b, 0) / historyPrices.length
    : price;

  const priceDropPct = mean > 0 ? (mean - price) / mean : 0;

  return {
    ...listing,
    anomaly,
    velocity,
    fakeDiscount,
    meanPrice: mean,
    priceDropPct,
    zScore: anomaly.zScore,
  };
}

/**
 * Find the cheapest matching listing across all listings for cross-site score.
 */
export function addCrossSiteScores(listings) {
  const out = listings.map((l) => ({ ...l, crossSite: null }));

  for (let i = 0; i < out.length; i++) {
    let bestMatch = null;
    let bestPrice = out[i].price;
    for (let j = 0; j < out.length; j++) {
      if (i === j) continue;
      const score = matchScore(out[i], out[j]);
      if (score >= 0.6 && (!bestMatch || out[j].price < bestPrice)) {
        bestMatch = out[j];
        bestPrice = out[j].price;
      }
    }
    if (bestMatch) {
      out[i].crossSite = {
        source: bestMatch.source,
        price: bestMatch.price,
        diffPct: (out[i].price - bestMatch.price) / out[i].price,
      };
    }
  }
  return out;
}

/**
 * Add confidence and final rank score to listings.
 */
export function addConfidence(listings) {
  return listings.map((l) => {
    const crossSiteSources = l.crossSite ? 2 : 1;
    const historySamples = l.historyLength || 0;

    const confidence = scoreConfidence({
      anomalySeverity: l.anomaly?.severity,
      fakeDiscount: l.fakeDiscount?.isFake,
      crossSiteSources,
      historySamples,
      isFulfilled: l.is_fulfilled,
      sellerKnown: l.seller && l.seller !== "Unknown",
      inStock: l.availability && !/out\s*of\s*stock|unavailable/i.test(l.availability),
      priceDropPct: l.priceDropPct,
    });

    // Rank score: blend confidence, anomaly severity, and price drop.
    let rankScore = confidence.score;
    if (l.anomaly?.severity === "severe") rankScore += 20;
    else if (l.anomaly?.severity === "moderate") rankScore += 10;
    rankScore += Math.min(l.priceDropPct * 30, 15);
    rankScore -= l.fakeDiscount?.isFake ? 25 : 0;
    rankScore = Math.max(0, Math.min(100, rankScore));

    return { ...l, confidence, rankScore };
  });
}

/**
 * Main scoring pipeline.
 * @param {object[]} listings raw listings from scrapers
 * @param {Map<string, number[]>} historyMap product_id -> historical prices
 */
export function scoreDeals(listings, historyMap = new Map()) {
  const scored = listings.map((l) => {
    const history = historyMap.get(l.product_id) || [];
    const withHistory = scoreListing(l, history);
    withHistory.historyLength = history.length;
    return withHistory;
  });

  const withCrossSite = addCrossSiteScores(scored);
  const withConfidence = addConfidence(withCrossSite);

  return withConfidence.sort((a, b) => b.rankScore - a.rankScore);
}

/**
 * Filter deals to return only the best ones.
 */
export function filterBestDeals(listings, minRankScore = 50) {
  return listings.filter((l) => l.rankScore >= minRankScore || l.anomaly?.isAnomaly);
}
