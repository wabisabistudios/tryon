/**
 * Threshold alert generation.
 * Checks a scored deal against active alert rules.
 */

/**
 * Evaluate an alert rule against a deal.
 * @param {object} alert { alert_type, threshold }
 * @param {object} deal scored deal object
 */
export function shouldTrigger(alert, deal) {
  const { alert_type, threshold } = alert;
  const priceDrop = deal.priceDropPct || 0;
  const zScore = deal.zScore || 0;
  const confidenceScore = deal.confidence?.score || 0;

  switch (alert_type) {
    case "price_drop_pct":
      return priceDrop >= threshold;
    case "price_below":
      return deal.price && deal.price <= threshold;
    case "z_score":
      return zScore >= threshold;
    case "confidence":
      return confidenceScore >= threshold;
    case "anomaly_severe":
      return deal.anomaly?.severity === "severe";
    default:
      return false;
  }
}

/**
 * Format a human-readable alert message.
 */
export function formatAlert(alert, deal) {
  const title = deal.title || deal.product?.title || "Deal";
  const url = deal.url || deal.product?.url;
  const price = deal.price ?? "?";
  const drop = Math.round((deal.priceDropPct || 0) * 100);
  const conf = deal.confidence?.level || "unknown";

  return {
    alert_id: alert.id,
    product_title: title,
    url,
    current_price: price,
    drop_pct: drop,
    confidence: conf,
    message: `${title} is now ₹${price} (${drop}% drop) — confidence: ${conf}`,
  };
}
