/**
 * Statistical anomaly detection for deal prices.
 * Flags real pricing mistakes (e.g., seller typo) without crying wolf.
 */

/**
 * Compute mean and standard deviation from an array of numbers.
 */
function stats(values) {
  if (!values || values.length === 0) return { mean: 0, std: 0, count: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  return { mean, std: Math.sqrt(variance), count: values.length };
}

/**
 * Detect if a current price is an outlier compared to historical prices.
 * @param {number} currentPrice
 * @param {number[]} historyPrices
 * @param {object} options
 * @returns {object} { isAnomaly, zScore, severity, reason }
 */
export function detectAnomaly(currentPrice, historyPrices, options = {}) {
  const { minSamples = 3, zThresholdModerate = 1.5, zThresholdSevere = 2.5 } = options;

  if (!currentPrice || !historyPrices || historyPrices.length < minSamples) {
    return { isAnomaly: false, zScore: 0, severity: "none", reason: "not enough history" };
  }

  const { mean, std, count } = stats(historyPrices);
  if (std === 0 || mean <= 0) {
    return { isAnomaly: false, zScore: 0, severity: "none", reason: "flat history" };
  }

  const zScore = (mean - currentPrice) / std;
  const dropPct = (mean - currentPrice) / mean;

  let severity = "none";
  let isAnomaly = false;

  if (zScore >= zThresholdSevere && dropPct >= 0.35) {
    severity = "severe";
    isAnomaly = true;
  } else if (zScore >= zThresholdModerate && dropPct >= 0.20) {
    severity = "moderate";
    isAnomaly = true;
  }

  return {
    isAnomaly,
    zScore,
    severity,
    mean,
    std,
    count,
    dropPct,
    reason: isAnomaly
      ? `price is ${(dropPct * 100).toFixed(1)}% below ${count}-sample average`
      : "within normal range",
  };
}

/**
 * Check how fast the price dropped. A sudden cliff is more likely a typo
 * than a gradual month-long decline.
 * @param {number} currentPrice
 * @param {number[]} historyPrices chronological order, newest last
 */
export function velocityCheck(currentPrice, historyPrices) {
  if (!historyPrices || historyPrices.length < 2) {
    return { suddenDrop: false, previousPrice: null, dropPct: 0 };
  }
  const previousPrice = historyPrices[historyPrices.length - 2];
  if (!previousPrice || previousPrice <= 0) {
    return { suddenDrop: false, previousPrice, dropPct: 0 };
  }
  const dropPct = (previousPrice - currentPrice) / previousPrice;
  return {
    suddenDrop: dropPct >= 0.25,
    previousPrice,
    dropPct,
  };
}

/**
 * Compare list/claimed MRP to historical average selling price.
 * If sellers inflate MRP to fake a discount, flag it.
 */
export function detectFakeDiscount(listPrice, historyPrices) {
  if (!listPrice || !historyPrices || historyPrices.length < 3) {
    return { isFake: false, reason: "insufficient data" };
  }
  const mean = historyPrices.reduce((a, b) => a + b, 0) / historyPrices.length;
  if (mean <= 0) return { isFake: false, reason: "invalid mean" };

  const inflated = listPrice > mean * 1.35;
  return {
    isFake: inflated,
    inflatedBy: inflated ? (listPrice / mean - 1) : 0,
    reason: inflated
      ? `claimed MRP ${listPrice} is ${((listPrice / mean - 1) * 100).toFixed(0)}% above average selling price ${mean.toFixed(0)}`
      : "MRP looks realistic",
  };
}
