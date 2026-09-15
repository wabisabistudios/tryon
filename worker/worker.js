/**
 * BASED AESTHETICS — TRY-ON WORKER v3 + India Deal Finder
 * Route: basedaesthetics.co/api/tryon*
 *
 * Endpoints:
 *   GET  /api/tryon/health
 *   GET  /api/tryon/designs          — public design list (no prompts)
 *   POST /api/tryon                  — render {image, designId, sessionId}
 *   GET  /api/tryon/slots            — next bookable slots from GHL calendar
 *   POST /api/tryon/book             — {slot, name, phone, designId, renderId} → GHL contact + appointment
 *
 * DEALS Endpoints:
 *   GET  /api/deals/search?q=monitor&limit=20   — search and score deals
 *   GET  /api/deals/best?limit=20               — best current deals
 *   GET  /api/deals/item/:id                    — product detail + price history
 *
 * Secrets: GEMINI_API_KEY, GHL_API_KEY
 * Vars:    DAILY_RENDER_CAP (400), SESSION_RENDER_CAP (6),
 *          GHL_LOCATION_ID, GHL_CALENDAR_ID   (leave unset → /slots & /book return {fallback:true}
 *                                              and the page uses the widget link instead)
 *
 * MODEL NOTE: gemini-2.5-flash-image retires 2026-10-02 → switch to
 * "gemini-3.1-flash-image-preview" (~₹6/render) if validation prefers it.
 */

import { searchAmazon } from "./deals/scrapers/amazon.js";
import { searchFlipkart } from "./deals/scrapers/flipkart.js";
import { searchDemo } from "./deals/scrapers/demo.js";
import {
  upsertProduct,
  insertPrice,
  getPriceHistory,
  logSearch,
  getProduct,
  getLatestPrice,
  listRecentPrices,
  productId,
} from "./deals/db.js";
import { scoreDeals, filterBestDeals } from "./deals/engine.js";

const MODEL = "gemini-2.5-flash-image";
const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-04-15"; // Version header GHL v2 expects; match what the consent Worker uses
const ALLOWED_ORIGINS = [
  "https://basedaesthetics.co",
  "https://www.basedaesthetics.co",
  "http://localhost:8788",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5500",
];

/**
 * DESIGN TABLE — server-side only; client gets display fields, never prompts.
 * campaign:true → shows the ₹2,999 any-design rate (art designs where menu would exceed it).
 * Plain gels stay at menu price — the campaign should never make a service look MORE expensive.
 */
const DESIGNS = {
  "cherry-noir": {
    name: "Cherry Noir", finish: "Gloss", price: "\u20B91,000", campaign: false,
    service: "Gel Polish \u2014 Hands",
    style: "opaque deep oxblood cherry-red gel polish, high-gloss wet-look finish, perfectly smooth single colour on every nail",
  },
  "milk-glaze": {
    name: "Milk Glaze", finish: "Gloss", price: "\u20B91,000", campaign: false,
    service: "Gel Polish \u2014 Hands",
    style: "sheer milky-white glazed-donut gel polish, soft translucent finish with a subtle pearl sheen, clean and even on every nail",
  },
  "classic-french": {
    name: "Classic French", finish: "French", price: "\u20B91,300", campaign: false,
    service: "Gel French",
    style: "classic French manicure in gel: natural pink-nude base with a crisp white tip following the free edge of each nail, glossy finish",
  },
  "micro-french-marigold": {
    name: "Micro French \u2014 Marigold", finish: "French", price: "\u20B91,300", campaign: false,
    service: "Gel French",
    style: "micro French manicure: sheer nude base with an ultra-thin marigold-yellow line tracing only the very edge of each nail tip, glossy finish, precise and minimal",
  },
  "chrome-silver": {
    name: "Chrome Silver", finish: "Chrome", price: "\u20B92,999", campaign: true,
    service: "Any-Design \u2014 Chrome",
    style: "liquid-metal silver chrome powder finish over gel, intense mirror reflectivity, seamless metallic surface on every nail",
  },
  "cat-eye-emerald": {
    name: "Cat Eye \u2014 Emerald", finish: "Chrome", price: "\u20B92,999", campaign: true,
    service: "Any-Design \u2014 Cat Eye",
    style: "deep emerald-green magnetic cat-eye gel: dark green base with a bright vertical band of shimmering light through the centre of each nail, glossy finish",
  },
  "latte-ombre": {
    name: "Latte Ombr\u00E9", finish: "Ombr\u00E9", price: "\u20B92,999", campaign: true,
    service: "Any-Design \u2014 Ombr\u00E9",
    style: "soft latte ombr\u00E9 gel: warm milky beige at the cuticle blending seamlessly into a deeper caramel brown at the tip of each nail, glossy finish",
  },
  "terracotta-matte": {
    name: "Terracotta Matte", finish: "Matte", price: "\u20B91,000", campaign: false,
    service: "Gel Polish \u2014 Hands",
    style: "opaque burnt terracotta clay-orange gel polish with a completely matte velvet finish, no shine, smooth single colour on every nail",
  },
  "marigold-line": {
    name: "Marigold Line", finish: "Minimal art", price: "\u20B92,999", campaign: true,
    service: "Any-Design \u2014 Minimal Art",
    style: "minimal nail art: sheer nude glossy base with a single thin hand-painted marigold-yellow diagonal line across each nail, clean negative space",
  },
  "ink-dots": {
    name: "Ink Dots", finish: "Minimal art", price: "\u20B92,999", campaign: true,
    service: "Any-Design \u2014 Minimal Art",
    style: "minimal nail art: milky sheer base with three small dark-ink dots arranged near the cuticle of each nail, glossy finish, precise and understated",
  },
  "glitter-champagne": {
    name: "Champagne Glitter", finish: "Glitter", price: "\u20B92,999", campaign: true,
    service: "Any-Design \u2014 Glitter",
    style: "champagne-gold fine glitter gel, densely packed micro-glitter with warm golden sparkle, glossy sealed finish on every nail",
  },
  "tortoise-shell": {
    name: "Tortoise Shell", finish: "Detailed art", price: "\u20B92,999", campaign: true,
    service: "Any-Design \u2014 Detailed Art",
    style: "tortoise-shell nail art: translucent amber base with organic dark-brown and black mottled patches, deep glass-like glossy finish on every nail",
  },
};

function buildPrompt(style) {
  return [
    "Edit this photo of a real hand. Apply the following nail design to the fingernails only:",
    style + ".",
    "STRICT RULES:",
    "- Change ONLY the nail plates. Keep the exact same hand, fingers, skin tone, skin texture, jewellery, background and lighting.",
    "- Keep the person's natural nail length and nail shape exactly as photographed. Do not lengthen, shorten or reshape any nail.",
    "- The polish must respect each nail's natural edges and cuticle line. No colour on skin.",
    "- Match the photo's lighting: reflections and shadows on the polish must be consistent with the scene.",
    "- Photorealistic result. This must look like a photograph of a finished professional manicure, not an illustration.",
    "Return the edited image.",
  ].join("\n");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    try {
      if (url.pathname === "/api/tryon/health") {
        return json({ ok: true, model: MODEL, booking: ghlConfigured(env) }, 200, cors);
      }
      if (url.pathname === "/api/tryon/designs" && request.method === "GET") {
        const list = Object.entries(DESIGNS).map(([id, d]) => ({
          id, name: d.name, finish: d.finish, price: d.price, campaign: d.campaign, service: d.service,
        }));
        return json({ designs: list, offer: "Any design \u2014 \u20B92,999" }, 200, cors);
      }
      if (url.pathname === "/api/tryon" && request.method === "POST") {
        return await handleRender(request, env, cors);
      }
      if (url.pathname === "/api/tryon/slots" && request.method === "GET") {
        return await handleSlots(env, cors);
      }
      if (url.pathname === "/api/tryon/book" && request.method === "POST") {
        return await handleBook(request, env, cors);
      }
      if (url.pathname === "/api/deals/search" && request.method === "GET") {
        return await handleDealsSearch(request, env, cors);
      }
      if (url.pathname === "/api/deals/best" && request.method === "GET") {
        return await handleDealsBest(request, env, cors);
      }
      if (url.pathname.startsWith("/api/deals/item/") && request.method === "GET") {
        return await handleDealsItem(url.pathname, env, cors);
      }
    } catch (e) {
      console.error("Unhandled", e);
      return json({ error: "Something broke on our side. Try again." }, 500, cors);
    }
    return json({ error: "Not found" }, 404, cors);
  },
};

/* ================= RENDER ================= */
async function handleRender(request, env, cors) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid request body." }, 400, cors); }

  const { image, designId, sessionId } = body || {};
  const design = DESIGNS[designId];
  if (!design) return json({ error: "Unknown design." }, 400, cors);
  if (!image || typeof image !== "string" || !image.startsWith("data:image/")) {
    return json({ error: "A hand photo is required." }, 400, cors);
  }
  if (image.length > 8_400_000) {
    return json({ error: "Photo too large. Retake in the app \u2014 it resizes automatically." }, 413, cors);
  }

  const today = new Date().toISOString().slice(0, 10);

  const dailyCap = parseInt(env.DAILY_RENDER_CAP || "400", 10);
  const dailyKey = `tryon:daily:${today}`;
  const dailyCount = parseInt((await env.TRYON.get(dailyKey)) || "0", 10);
  if (dailyCount >= dailyCap) {
    return json({ error: "Today\u2019s render limit is reached. Book the free Nail Assessment and try unlimited designs in the chair.", capped: true }, 429, cors);
  }

  const sessionCap = parseInt(env.SESSION_RENDER_CAP || "6", 10);
  const sid = sanitizeId(sessionId) || hashIp(request);
  const sessKey = `tryon:sess:${today}:${sid}`;
  const sessCount = parseInt((await env.TRYON.get(sessKey)) || "0", 10);
  if (sessCount >= sessionCap) {
    return json({ error: "Render limit reached for today.", capped: true }, 429, cors);
  }

  const [meta, b64] = image.split(",");
  const mime = (meta.match(/data:(image\/[a-z+]+);/) || [])[1] || "image/jpeg";

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mime, data: b64 } },
          { text: buildPrompt(design.style) },
        ]}],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
    }
  );

  if (!geminiRes.ok) {
    console.error("Gemini error", geminiRes.status, (await geminiRes.text()).slice(0, 500));
    return json({ error: "Render failed. Try a brighter photo with nails clearly visible." }, 502, cors);
  }

  const data = await geminiRes.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find((p) => p.inline_data || p.inlineData);
  if (!imgPart) {
    console.error("No image in Gemini response", JSON.stringify(data).slice(0, 500));
    return json({ error: "Render failed. Try a clearer, brighter photo." }, 502, cors);
  }
  const out = imgPart.inline_data || imgPart.inlineData;

  const renderId = `TR-${today.replace(/-/g, "").slice(2)}-${crypto.randomUUID().slice(0, 5).toUpperCase()}`;
  await Promise.all([
    env.TRYON.put(dailyKey, String(dailyCount + 1), { expirationTtl: 172800 }),
    env.TRYON.put(sessKey, String(sessCount + 1), { expirationTtl: 172800 }),
    env.TRYON.put(`tryon:render:${renderId}`,
      JSON.stringify({ renderId, designId, ts: Date.now(), session: sid })
      // deliberately NO expirationTtl — meta only, ~150 bytes
    ),
  ]);

  return json({
    renderId,
    image: `data:${out.mime_type || out.mimeType || "image/png"};base64,${out.data}`,
    design: { id: designId, name: design.name, price: design.price, campaign: design.campaign, service: design.service },
    remaining: sessionCap - sessCount - 1,
  }, 200, cors);
}

/* ================= SLOTS (GHL) ================= */
function ghlConfigured(env) {
  return Boolean(env.GHL_API_KEY && env.GHL_CALENDAR_ID && env.GHL_LOCATION_ID);
}

async function handleSlots(env, cors) {
  if (!ghlConfigured(env)) return json({ fallback: true, slots: [] }, 200, cors);

  const start = Date.now();
  const end = start + 7 * 86400000;
  // GHL v2 free-slots. If your consent Worker uses a different Version header, mirror it here.
  const r = await fetch(
    `${GHL_BASE}/calendars/${env.GHL_CALENDAR_ID}/free-slots?startDate=${start}&endDate=${end}&timezone=Asia/Kolkata`,
    { headers: ghlHeaders(env) }
  );
  if (!r.ok) {
    console.error("GHL slots error", r.status, (await r.text()).slice(0, 300));
    return json({ fallback: true, slots: [] }, 200, cors);
  }
  const data = await r.json();
  // Response shape: { "2026-07-29": { slots: ["2026-07-29T11:30:00+05:30", ...] }, ... }
  const slots = [];
  for (const day of Object.keys(data).sort()) {
    const daySlots = data[day]?.slots || [];
    for (const s of daySlots) {
      slots.push(s);
      if (slots.length >= 9) break;
    }
    if (slots.length >= 9) break;
  }
  return json({ fallback: false, slots }, 200, cors);
}

/* ================= BOOK (GHL contact upsert + appointment) ================= */
async function handleBook(request, env, cors) {
  if (!ghlConfigured(env)) return json({ fallback: true }, 200, cors);

  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400, cors); }
  const { slot, name, phone, designId, renderId } = body || {};
  const design = DESIGNS[designId];

  if (!slot || !name || !phone) return json({ error: "Name, WhatsApp number and a time are required." }, 400, cors);
  const e164 = toE164India(phone);
  if (!e164) return json({ error: "That phone number doesn\u2019t look right. Use your 10-digit WhatsApp number." }, 400, cors);

  // 1) Contact upsert — same pattern as the consent Worker (phone stored E.164 to match scanner records)
  const cRes = await fetch(`${GHL_BASE}/contacts/upsert`, {
    method: "POST",
    headers: ghlHeaders(env),
    body: JSON.stringify({
      locationId: env.GHL_LOCATION_ID,
      name,
      phone: e164,
      tags: ["tryon", designId || "tryon-unknown"],
      source: "tryon",
    }),
  });
  if (!cRes.ok) {
    console.error("GHL upsert error", cRes.status, (await cRes.text()).slice(0, 300));
    return json({ error: "Couldn\u2019t save your details. Try again." }, 502, cors);
  }
  const contact = (await cRes.json()).contact || {};

  // 2) Appointment
  const aRes = await fetch(`${GHL_BASE}/calendars/events/appointments`, {
    method: "POST",
    headers: ghlHeaders(env),
    body: JSON.stringify({
      calendarId: env.GHL_CALENDAR_ID,
      locationId: env.GHL_LOCATION_ID,
      contactId: contact.id,
      startTime: slot,
      title: `Try-On \u2014 ${design ? design.name : "design"} (${renderId || "no record"})`,
      appointmentStatus: "confirmed",
    }),
  });
  if (!aRes.ok) {
    console.error("GHL appointment error", aRes.status, (await aRes.text()).slice(0, 300));
    return json({ error: "That slot may have just been taken. Pick another." }, 409, cors);
  }
  const appt = await aRes.json();

  // Log the conversion — permanent, no TTL
  await env.TRYON.put(`tryon:booking:${renderId || crypto.randomUUID().slice(0, 8)}`,
    JSON.stringify({ renderId, designId, slot, contactId: contact.id, ts: Date.now() }));

  return json({ booked: true, slot, appointmentId: appt?.id || appt?.event?.id || null }, 200, cors);
}

/* ================= helpers ================= */
function ghlHeaders(env) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${env.GHL_API_KEY}`,
    Version: GHL_VERSION,
  };
}
function toE164India(p) {
  const d = String(p).replace(/\D/g, "");
  if (d.length === 10) return "+91" + d;
  if (d.length === 12 && d.startsWith("91")) return "+" + d;
  if (String(p).startsWith("+") && d.length >= 11) return "+" + d;
  return null;
}
function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };
}
function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...cors } });
}
function sanitizeId(s) {
  return typeof s === "string" ? s.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) : "";
}
function hashIp(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "0";
  let h = 0;
  for (let i = 0; i < ip.length; i++) h = (h * 31 + ip.charCodeAt(i)) | 0;
  return "ip" + Math.abs(h).toString(36);
}

/* ================= DEALS ================= */

async function handleDealsSearch(request, env, cors) {
  if (!env.DEALS_DB) {
    return json({ error: "Deal database not configured." }, 503, cors);
  }
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 50);
  if (!query) return json({ error: "Query parameter `q` is required." }, 400, cors);

  const cacheKey = `deals:search:${query}:${limit}`;
  const cached = await env.DEALS.get(cacheKey);
  if (cached) {
    return json(JSON.parse(cached), 200, cors);
  }

  const db = env.DEALS_DB;
  const [amazon, flipkart] = await Promise.all([
    searchAmazon(query, env),
    searchFlipkart(query, env),
  ]);
  let useDemo = false;
  const all = [];
  const perSourceLimit = Math.ceil(limit / 2) + 4;

  for (const sourceResult of [amazon, flipkart]) {
    if (!sourceResult.ok || !sourceResult.items) continue;
    for (const item of sourceResult.items.slice(0, perSourceLimit)) {
      const pid = productId(item.source, item.source_id);
      await upsertProduct(db, item);
      await insertPrice(db, pid, item);
      const history = await getPriceHistory(db, pid);
      all.push({ ...item, product_id: pid, history });
    }
  }

  // If real scrapers are blocked (common from serverless IPs), fall back to
  // demo data so the scoring engine and UI remain testable.
  if (all.length === 0) {
    const demo = await searchDemo(query, env);
    if (demo.ok && demo.items) {
      useDemo = true;
      for (const item of demo.items.slice(0, limit)) {
        const pid = productId(item.source, item.source_id);
        await upsertProduct(db, item);
        await insertPrice(db, pid, item);
        const history = item.demo_history || [];
        all.push({ ...item, product_id: pid, history });
      }
    }
  }

  await logSearch(db, query, useDemo ? "demo" : "all", all.length);

  const historyMap = new Map();
  for (const item of all) {
    historyMap.set(item.product_id, item.history);
  }

  const scored = scoreDeals(all, historyMap);
  const best = filterBestDeals(scored, 30);
  const response = {
    query,
    source_status: {
      amazon_in: { ok: amazon.ok, count: amazon.items?.length || 0, error: amazon.error || null },
      flipkart: { ok: flipkart.ok, count: flipkart.items?.length || 0, error: flipkart.error || null },
      demo: { ok: useDemo, count: useDemo ? all.length : 0 },
    },
    demo_mode: useDemo,
    results: best,
    total: scored.length,
  };

  await env.DEALS.put(cacheKey, JSON.stringify(response), { expirationTtl: 1800 });
  return json(response, 200, cors);
}

async function handleDealsBest(request, env, cors) {
  if (!env.DEALS_DB) {
    return json({ error: "Deal database not configured." }, 503, cors);
  }
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 50);

  const db = env.DEALS_DB;
  const rows = await db.prepare(
    `SELECT p.*, pr.price, pr.list_price, pr.seller, pr.is_fulfilled, pr.availability
     FROM products p
     JOIN prices pr ON p.id = pr.product_id
     WHERE pr.scraped_at = (
       SELECT MAX(scraped_at) FROM prices WHERE product_id = p.id
     )
     ORDER BY pr.scraped_at DESC
     LIMIT ?`
  )
    .bind(limit * 3)
    .all();

  const items = (rows.results || []).map((r) => ({
    product_id: r.id,
    source: r.source,
    source_id: r.source_id,
    title: r.title,
    url: r.url,
    image: r.image,
    brand: r.brand,
    model: r.model,
    rating: r.rating,
    review_count: r.review_count,
    price: r.price,
    list_price: r.list_price,
    seller: r.seller,
    is_fulfilled: r.is_fulfilled,
    availability: r.availability,
  }));

  const historyMap = new Map();
  for (const item of items) {
    const hist = await getPriceHistory(db, item.product_id);
    historyMap.set(item.product_id, hist);
  }

  const scored = scoreDeals(items, historyMap);
  const best = scored.slice(0, limit);
  return json({ deals: best, total: scored.length }, 200, cors);
}

async function handleDealsItem(pathname, env, cors) {
  if (!env.DEALS_DB) {
    return json({ error: "Deal database not configured." }, 503, cors);
  }
  const id = pathname.replace("/api/deals/item/", "").trim();
  if (!id) return json({ error: "Product id required." }, 400, cors);

  const db = env.DEALS_DB;
  const product = await getProduct(db, id);
  if (!product) return json({ error: "Product not found." }, 404, cors);

  const latest = await getLatestPrice(db, id);
  const history = await getPriceHistory(db, id, 90 * 86400000);

  return json(
    {
      product,
      latest_price: latest,
      price_history: history,
      stats: {
        min: history.length ? Math.min(...history) : null,
        max: history.length ? Math.max(...history) : null,
        avg: history.length ? history.reduce((a, b) => a + b, 0) / history.length : null,
        samples: history.length,
      },
    },
    200,
    cors
  );
}
