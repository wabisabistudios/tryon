/**
 * Flipkart search scraper.
 */

import { politeFetch, isAllowedByRobots, extractCurrency, normalizeText } from "./common.js";

const SOURCE = "flipkart";
const BASE = "https://www.flipkart.com";

function buildSearchUrl(query) {
  return `${BASE}/search?q=${encodeURIComponent(query.trim())}`;
}

function extractBetween(text, start, end) {
  const i = text.indexOf(start);
  if (i === -1) return null;
  const j = text.indexOf(end, i + start.length);
  if (j === -1) return null;
  return text.slice(i + start.length, j);
}

function cleanTitle(raw) {
  return String(raw || "").replace(/\s+/g, " ").trim();
}

function parseRating(text) {
  const m = String(text || "").match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

function parseReviewCount(text) {
  const t = String(text || "").replace(/,/g, "").replace(/\s*Reviews?\s*/i, "");
  const m = t.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function parseProductBlock(block) {
  const pid = extractBetween(block, 'data-id="', '"');
  if (!pid) return null;

  const title = cleanTitle(
    extractBetween(block, '<div class="KzDlHZ">', "</div>") ||
    extractBetween(block, '<a class="WKTcLC" title="', '"') ||
    extractBetween(block, '<img class="DByuf4" alt="', '"')
  );
  if (!title) return null;

  const urlPath = extractBetween(block, '<a class="VJA3sP" href="', '"') ||
    extractBetween(block, '<a class="WKTcLC" href="', '"') ||
    extractBetween(block, '<a href="', '"');
  const url = urlPath ? (urlPath.startsWith("http") ? urlPath : `${BASE}${urlPath.split("?")[0]}`) : `${BASE}/search?q=${pid}`;

  const image =
    extractBetween(block, '<img class="DByuf4" src="', '"') ||
    extractBetween(block, 'src="https://rukminim', '"');

  const priceText =
    extractBetween(block, '<div class="Nx9bqj">', "</div>") ||
    extractBetween(block, '<div class="Nx9bqj _4b5dRq">', "</div>");

  const listPriceText = extractBetween(block, '<div class="yRaY8j">', "</div>");

  const ratingText = extractBetween(block, '<div class="XQDdHH">', "</div>");
  const reviewText = extractBetween(block, '<span class="Wphh3N">', "</span>");

  const price = extractCurrency(priceText);
  if (!price) return null;

  const listPrice = extractCurrency(listPriceText);

  return {
    source: SOURCE,
    source_id: pid,
    title,
    url,
    image,
    brand: null,
    model: null,
    specs_json: null,
    rating: parseRating(ratingText),
    review_count: parseReviewCount(reviewText),
    price,
    list_price: listPrice,
    currency: "INR",
    availability: "In stock",
    seller: "Flipkart",
    is_fulfilled: 1,
  };
}

export async function searchFlipkart(query, env) {
  const url = buildSearchUrl(query);

  const allowed = await isAllowedByRobots(url, env);
  if (!allowed) {
    return { ok: false, source: SOURCE, error: "robots.txt disallows this path", items: [] };
  }

  try {
    const res = await politeFetch(url, { retries: 0, minDelayMs: 500, timeoutMs: 2500 });
    const html = await res.text();

    if (html.includes("Access Denied") || html.includes("are you human") || res.status === 403) {
      return { ok: false, source: SOURCE, error: "Flipkart returned an access-denied page", items: [] };
    }

    // Flipkart search results contain data-id on product divs
    const blocks = html.split('data-id="').slice(1);
    const items = [];
    for (const block of blocks) {
      const wrapped = 'data-id="' + block;
      const parsed = parseProductBlock(wrapped);
      if (parsed) items.push(parsed);
    }

    return { ok: true, source: SOURCE, count: items.length, items };
  } catch (err) {
    console.error("Flipkart scrape error", err.message);
    return { ok: false, source: SOURCE, error: err.message, items: [] };
  }
}
