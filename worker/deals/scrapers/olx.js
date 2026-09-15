/**
 * OLX India classifieds search scraper.
 * Focuses on public ad listing pages only — no messaging or seller profiling.
 */

import { politeFetch, isAllowedByRobots, extractCurrency, normalizeText } from "./common.js";

const SOURCE = "olx_in";
const BASE = "https://www.olx.in";

function buildSearchUrl(query) {
  const q = encodeURIComponent(query.trim().replace(/\s+/g, "-"));
  return `${BASE}/items/q-${q}`;
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

function parseAdBlock(block) {
  const id = extractBetween(block, 'data-id="', '"');
  if (!id) return null;

  const title = cleanTitle(
    extractBetween(block, '<div class="_2i1ux">', "</div>") ||
    extractBetween(block, 'title="', '"') ||
    extractBetween(block, '<img alt="', '"')
  );
  if (!title) return null;

  const urlPath = extractBetween(block, '<a href="', '"');
  const url = urlPath ? (urlPath.startsWith("http") ? urlPath : `${BASE}${urlPath.split("?")[0]}`) : `${BASE}/item/${id}`;

  const image =
    extractBetween(block, '<img src="', '"') ||
    extractBetween(block, 'data-src="', '"');

  const priceText =
    extractBetween(block, '<span class="_2KsB34">', "</span>") ||
    extractBetween(block, '<span data-aut-id="itemPrice">', "</span>");

  const location = extractBetween(block, '<span class="_2VQuTK">', "</span>");
  const dateText = extractBetween(block, '<span class="_2_pEaN">', "</span>");

  const price = extractCurrency(priceText);
  if (!price) return null;

  return {
    source: SOURCE,
    source_id: id,
    title,
    url,
    image,
    brand: null,
    model: null,
    specs_json: null,
    rating: null,
    review_count: null,
    price,
    list_price: null,
    currency: "INR",
    availability: dateText || "used listing",
    seller: location || "OLX seller",
    is_fulfilled: 0,
    condition: "used",
  };
}

export async function searchOlx(query, env) {
  const url = buildSearchUrl(query);

  const allowed = await isAllowedByRobots(url, env);
  if (!allowed) {
    return { ok: false, source: SOURCE, error: "robots.txt disallows this path", items: [] };
  }

  try {
    const res = await politeFetch(url, { retries: 0, minDelayMs: 700, timeoutMs: 3000 });
    const html = await res.text();

    if (html.includes("Access Denied") || html.includes("captcha") || html.includes("Are you a human")) {
      return { ok: false, source: SOURCE, error: "OLX returned an access-denied page", items: [] };
    }

    const blocks = html.split('data-id="').slice(1);
    const items = [];
    for (const block of blocks) {
      const wrapped = 'data-id="' + block;
      const parsed = parseAdBlock(wrapped);
      if (parsed) items.push(parsed);
    }

    return { ok: true, source: SOURCE, count: items.length, items };
  } catch (err) {
    console.error("OLX scrape error", err.message);
    return { ok: false, source: SOURCE, error: err.message, items: [] };
  }
}
