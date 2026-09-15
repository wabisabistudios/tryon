/**
 * Cross-site product identity matching.
 * Determines whether two listings from different sources refer to the same product.
 */

import { normalizeText } from "../scrapers/common.js";

/**
 * Extract likely model identifiers from a title: screen sizes, chip names,
 * storage sizes, refresh rates, etc.
 */
export function extractModelTokens(title) {
  const t = normalizeText(title);
  const tokens = [];

  const patterns = [
    /\b(\d{2}\s*inch|\d{2}\s*")\b/, // monitor/TV size
    /\b(\d{3,4}\s*x\s*\d{3,4})\b/, // resolution
    /\b(m\d+|a\d+|snapdragon\s*\d+\s*(?:gen\s*\d+)?|dimensity\s*\d+)\b/, // chips
    /\b(\d+\s*gb\s*(?:ram|rom)?)\b/, // RAM/ROM
    /\b(\d+\s*tb|\d+\s*gb)\s+(?:ssd|hdd|storage)\b/, // storage
    /\b(\d+\s*hz)\b/, // refresh rate
    /\b(rtx\s*\d+|gtx\s*\d+|rx\s*\d+)\b/, // GPUs
    /\b(playstation\s*\d+|xbox\s*series\s*[xs]|switch\s*(?:oled)?)\b/, // consoles
    /\b(macbook\s*(?:air|pro)\s*(?:m\d+)?)\b/, // Macs
    /\b(iphone\s*\d+(?:\s*pro?\s*max?)?)\b/, // iPhones
    /\b(galaxy\s*s\d+|pixel\s*\d+)\b/, // phones
  ];

  for (const p of patterns) {
    const m = t.match(p);
    if (m) tokens.push(m[1].replace(/\s+/g, ""));
  }

  return [...new Set(tokens)];
}

/**
 * Compare two listings and return a match score 0..1.
 */
export function matchScore(a, b) {
  if (!a || !b) return 0;
  if (a.source === b.source) return 1; // same source same id assumed unique

  let score = 0;
  const tokensA = extractModelTokens(a.title);
  const tokensB = extractModelTokens(b.title);

  if (tokensA.length && tokensB.length) {
    const intersection = tokensA.filter((t) => tokensB.includes(t));
    const union = [...new Set([...tokensA, ...tokensB])];
    const tokenScore = union.length ? intersection.length / union.length : 0;
    score += tokenScore * 0.7;
  }

  // Brand match
  if (a.brand && b.brand && normalizeText(a.brand) === normalizeText(b.brand)) {
    score += 0.15;
  }

  // Exact model match
  if (a.model && b.model && normalizeText(a.model) === normalizeText(b.model)) {
    score += 0.5;
  }

  return Math.min(score, 1);
}

/**
 * Group listings by product identity.
 * Returns an array of groups, each group is an array of listings.
 */
export function groupListings(listings, threshold = 0.6) {
  const groups = [];
  for (const item of listings) {
    let added = false;
    for (const group of groups) {
      if (matchScore(item, group[0]) >= threshold) {
        group.push(item);
        added = true;
        break;
      }
    }
    if (!added) groups.push([item]);
  }
  return groups;
}
