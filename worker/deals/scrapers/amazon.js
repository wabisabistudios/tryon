/**
 * Amazon India search scraper.
 * Returns structured product listings from a keyword search.
 * Handles layout drift, missing fields, and anti-bot blocks gracefully.
 */

import {
  politeFetch,
  isAllowedByRobots,
  normalizeText,
  extractCurrency,
  slugify,
} from "./common.js";

const SOURCE = "amazon_in";
const BASE = "https://www.amazon.in";

function buildSearchUrl(query) {
  const q = encodeURIComponent(query.trim());
  return `${BASE}/s?k=${q}&ref=nb_sb_noss`;
}

function cleanTitle(raw) {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .replace(/(?:Amazon(?:\s+Originals?)?|Prime|Echo|Kindle)\s*$/i, "")
    .trim();
}

function parseRating(text) {
  const m = String(text || "").match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

function parseReviewCount(text) {
  const t = String(text || "").replace(/,/g, "");
  const m = t.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function extractField(html, startMarker, endMarker) {
  const i = html.indexOf(startMarker);
  if (i === -1) return null;
  const j = html.indexOf(endMarker, i + startMarker.length);
  if (j === -1) return null;
  return html.slice(i + startMarker.length, j);
}

function extractBetween(text, start, end) {
  const i = text.indexOf(start);
  if (i === -1) return null;
  const j = text.indexOf(end, i + start.length);
  if (j === -1) return null;
  return text.slice(i + start.length, j);
}

function decodeHtmlEntities(str) {
  return String(str || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
}

/**
 * Parse one product block from Amazon search HTML.
 * Uses regex + string extraction to avoid DOM dependency in Workers.
 */
function parseProductBlock(block) {
  const asin = extractBetween(block, 'data-asin="', '"');
  if (!asin) return null;

  const title = cleanTitle(
    extractBetween(block, '<span class="a-size-medium a-color-base a-text-normal">', "</span>") ||
    extractBetween(block, '<span class="a-size-base-plus a-color-base a-text-normal">', "</span>") ||
    extractBetween(block, '<span class="a-size-base a-color-base a-text-normal">', "</span>")
  );
  if (!title) return null;

  const urlPath =
    extractBetween(block, '<a class="a-link-normal s-line-clamp-2 s-link-style a-text-normal" href="', '"') ||
    extractBetween(block, '<a class="a-link-normal s-underline-text s-underline-link-text s-link-style a-text-normal" href="', '"') ||
    extractBetween(block, '<a class="a-link-normal a-text-normal" href="', '"');
  const url = urlPath ? (urlPath.startsWith("http") ? urlPath : `${BASE}${urlPath.split("?")[0]}`) : `${BASE}/dp/${asin}`;

  const image =
    extractBetween(block, '<img class="s-image" src="', '"') ||
    extractBetween(block, 'data-src="', '"');

  const priceText =
    extractBetween(block, '<span class="a-price" data-a-size="xl" data-a-color="base"><span class="a-offscreen">', "</span>") ||
    extractBetween(block, '<span class="a-price" data-a-size="l" data-a-color="base"><span class="a-offscreen">', "</span>") ||
    extractBetween(block, '<span class="a-price" data-a-size="b" data-a-color="base"><span class="a-offscreen">', "</span>") ||
    extractBetween(block, '<span class="a-price"><span class="a-offscreen">', "</span>");

  const listPriceText =
    extractBetween(block, '<span class="a-price a-text-price" data-a-size="b" data-a-strike="true" data-a-color="secondary"><span class="a-offscreen">', "</span>") ||
    extractBetween(block, '<span class="a-price a-text-price" data-a-size="s" data-a-strike="true"><span class="a-offscreen">', "</span>");

  const ratingText = extractBetween(block, '<span class="a-icon-alt">', "</span>");
  const reviewText =
    extractBetween(block, '<span class="a-size-base s-underline-text">', "</span>") ||
    extractBetween(block, '<a class="a-link-normal s-underline-text s-link-style" href="#"><span class="a-size-base">', "</span>");

  const sellerFulfilled = block.includes("Amazon fulfilled") || block.includes("Fulfilled by Amazon") || block.includes("FBA");

  const price = extractCurrency(priceText);
  if (!price) return null; // skip if no price

  const listPrice = extractCurrency(listPriceText);

  return {
    source: SOURCE,
    source_id: asin,
    title: decodeHtmlEntities(title),
    url,
    image,
    brand: null, // extracted later from title/model
    model: null,
    specs_json: null,
    rating: parseRating(ratingText),
    review_count: parseReviewCount(reviewText),
    price,
    list_price: listPrice,
    currency: "INR",
    availability: "In stock",
    seller: sellerFulfilled ? "Fulfilled by Amazon" : "Third-party",
    is_fulfilled: sellerFulfilled ? 1 : 0,
  };
}

export async function searchAmazon(query, env) {
  const url = buildSearchUrl(query);

  const allowed = await isAllowedByRobots(url, env);
  if (!allowed) {
    return { ok: false, source: SOURCE, error: "robots.txt disallows this path", items: [] };
  }

  try {
    const res = await politeFetch(url, { retries: 0, minDelayMs: 500, timeoutMs: 2500 });
    const html = await res.text();

    if (html.includes("Enter the characters you see below") || html.includes("Captcha") || html.includes("api-services-support")) {
      return { ok: false, source: SOURCE, error: "Amazon returned a captcha / bot check", items: [] };
    }
    if (html.includes("did not match any products")) {
      return { ok: true, source: SOURCE, items: [] };
    }

    // Split page into product blocks
    const blocks = html.split('data-asin="').slice(1);
    const items = [];
    for (const block of blocks) {
      const wrapped = 'data-asin="' + block;
      const parsed = parseProductBlock(wrapped);
      if (parsed) items.push(parsed);
    }

    return { ok: true, source: SOURCE, count: items.length, items };
  } catch (err) {
    console.error("Amazon scrape error", err.message);
    return { ok: false, source: SOURCE, error: err.message, items: [] };
  }
}

export function amazonId(query, asin) {
  return `${SOURCE}:${asin}`;
}
