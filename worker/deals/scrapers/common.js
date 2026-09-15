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
 * Simple robots.txt checker. Caches result for 24h in KV under `robots:<host>`.
 * Returns true if path is allowed.
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
    const res = await fetch(robotsUrl, { headers: { "User-Agent": pickUA() } });
    if (!res.ok) {
      if (env.DEALS) await env.DEALS.put(key, "ALLOWED", { expirationTtl: 86400 });
      return true;
    }
    const text = await res.text();
    const lines = text.split("\n");
    let userAgentRelevant = false;
    let disallowed = [];

    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const [directive, ...valueParts] = line.split(":");
      const value = valueParts.join(":").trim();
      if (!directive) continue;
      const d = directive.trim().toLowerCase();
      if (d === "user-agent") {
        userAgentRelevant = value === "*" || value.toLowerCase().includes("bot");
      } else if (userAgentRelevant && d === "disallow") {
        disallowed.push(value);
      }
    }

    const path = u.pathname;
    const blocked = disallowed.some((prefix) => path.startsWith(prefix));
    if (env.DEALS) {
      await env.DEALS.put(key, blocked ? "BLOCKED" : "ALLOWED", { expirationTtl: 86400 });
    }
    return !blocked;
  } catch {
    return true;
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
