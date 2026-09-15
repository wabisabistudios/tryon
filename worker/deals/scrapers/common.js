/**
 * Shared scraping utilities: polite fetch, retry, robots.txt awareness,
 * and source-specific rate limits.
 */

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];

const DEFAULT_HEADERS = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-IN,en;q=0.9",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  "Cache-Control": "max-age=0",
};

function pickUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch a URL with retry, backoff, and browser-like headers.
 * @param {string} url
 * @param {object} options
 */
export async function politeFetch(url, options = {}) {
  const {
    retries = 2,
    minDelayMs = 600,
    maxDelayMs = 3000,
    timeoutMs = 15000,
    extraHeaders = {},
  } = options;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const headers = {
      ...DEFAULT_HEADERS,
      "User-Agent": pickUA(),
      Referer: new URL(url).origin + "/",
      ...extraHeaders,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: "GET",
        headers,
        redirect: "follow",
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.status === 503 || res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) {
        const delay = Math.min(
          minDelayMs * Math.pow(2, attempt) + Math.random() * 500,
          maxDelayMs
        );
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}

/**
 * robots.txt checker. Caches result for 24h in KV under `robots:<host>`.
 * Returns true if path is allowed. Supports * wildcards conservatively.
 */
export async function isAllowedByRobots(url, env) {
  try {
    const u = new URL(url);
    const key = `robots:${u.hostname}`;
    let cached;
    if (env.DEALS) {
      cached = await env.DEALS.get(key);
    }
    if (cached === "BLOCKED") return false;
    if (cached === "ALLOWED") return true;

    const robotsUrl = `${u.protocol}//${u.hostname}/robots.txt`;
    let text = "";
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(robotsUrl, { headers: { "User-Agent": pickUA() }, signal: controller.signal });
      clearTimeout(t);
      if (!res.ok) {
        if (env.DEALS) await env.DEALS.put(key, "ALLOWED", { expirationTtl: 86400 });
        return true;
      }
      text = await res.text();
    } catch {
      if (env.DEALS) await env.DEALS.put(key, "ALLOWED", { expirationTtl: 86400 });
      return true;
    }
    const lines = text.split("\n");
    // We comply with the most specific matching UA. For a generic crawler,
    // that is the wildcard '*' section. We intentionally do not assume
    // the identity of named bots (Amazon marks many of those Disallow: /).
    let currentUA = null;
    let wildcardRules = [];
    let namedRules = new Map();

    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const directive = line.slice(0, idx).trim().toLowerCase();
      const value = line.slice(idx + 1).trim();
      if (directive === "user-agent") {
        currentUA = value.toLowerCase();
      } else if (currentUA && directive === "disallow" && value) {
        if (currentUA === "*") wildcardRules.push(value);
        else {
          if (!namedRules.has(currentUA)) namedRules.set(currentUA, []);
          namedRules.get(currentUA).push(value);
        }
      }
    }

    const path = u.pathname + u.search;
    const blocked = wildcardRules.some((rule) => robotsMatch(rule, path));
    if (env.DEALS) {
      await env.DEALS.put(key, blocked ? "BLOCKED" : "ALLOWED", { expirationTtl: 86400 });
    }
    return !blocked;
  } catch {
    return true;
  }
}

function robotsMatch(rule, path) {
  // Escape regex special chars, then turn * into .*
  const re = rule
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  const pattern = re.startsWith(".*") ? re : "^" + re;
  try {
    return new RegExp(pattern).test(path);
  } catch {
    return path.startsWith(rule);
  }
}

export function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractCurrency(priceText) {
  const t = String(priceText || "").replace(/,/g, "");
  const m = t.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

export function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
