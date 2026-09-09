/**
 * BASED AESTHETICS — TRY-ON WORKER v3
 * Route: basedaesthetics.co/api/tryon*
 *
 * Endpoints:
 *   GET  /api/tryon/health
 *   GET  /api/tryon/designs          — public design list (no prompts)
 *   POST /api/tryon                  — render {image, designId, sessionId}
 *   GET  /api/tryon/slots            — next bookable slots from GHL calendar
 *   POST /api/tryon/book             — {slot, name, phone, designId, renderId} → GHL contact + appointment
 *
 * Secrets: GEMINI_API_KEY, GHL_API_KEY
 * Vars:    DAILY_RENDER_CAP (400), SESSION_RENDER_CAP (6),
 *          GHL_LOCATION_ID, GHL_CALENDAR_ID   (leave unset → /slots & /book return {fallback:true}
 *                                              and the page uses the widget link instead)
 *
 * MODEL NOTE: gemini-2.5-flash-image retires 2026-10-02 → switch to
 * "gemini-3.1-flash-image-preview" (~₹6/render) if validation prefers it.
 */

const MODEL = "gemini-2.5-flash-image";
const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-04-15"; // Version header GHL v2 expects; match what the consent Worker uses
const ALLOWED_ORIGINS = [
  "https://basedaesthetics.co",
  "https://www.basedaesthetics.co",
  "http://localhost:8788",
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
