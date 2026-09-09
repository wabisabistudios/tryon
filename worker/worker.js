/**
 * BASED AESTHETICS — TRY-ON WORKER v4
 * Routes: basedaesthetics.co/api/tryon*  and  basedaesthetics.co/r/* (shareable Fitting Records)
 *
 * Endpoints:
 *   GET  /api/tryon/health
 *   GET  /api/tryon/designs          — public design rack (no prompts)
 *   GET  /api/tryon/pricing          — THE pricing brain: tiers, extras, shades, builder rules
 *   GET  /api/tryon/stats/public     — { painted } live honesty counter
 *   POST /api/tryon/otp/send         — { phone } → WhatsApp OTP (dev mode when no provider)
 *   POST /api/tryon/otp/verify       — { phone, code } → { token } (30-day verified session)
 *   POST /api/tryon/render           — unified render, modes: design | shade | builder | inspo
 *   POST /api/tryon                  — legacy alias for render mode=design
 *   POST /api/tryon/records          — save a Fitting Record (verified token or staff PIN)
 *   GET  /api/tryon/records/:id      — public record meta (phone stripped)
 *   GET  /api/tryon/img/:id          — record image from R2 (":id" or ":id/after")
 *   POST /api/tryon/records/:id/painted — staff marks the set painted (+ optional after photo)
 *   GET  /r/:id                      — shareable record page (og tags → WhatsApp link preview)
 *   GET  /api/tryon/slots            — next bookable slots from GHL calendar
 *   POST /api/tryon/book             — { slot, name, phone, ... } → GHL contact + appointment
 *
 * Secrets: GEMINI_API_KEY, GHL_API_KEY, SESSION_SECRET, STAFF_PIN,
 *          WA_TOKEN, WA_PHONE_ID   (WhatsApp Cloud API — OTP delivery)
 * Vars:    DAILY_RENDER_CAP (400), ANON_RENDER_CAP (2), VERIFIED_DAILY_CAP (6),
 *          RECORD_PRICE_HOLD_DAYS (7), OTP_DEV ("true" = code returned in response, LOCAL ONLY),
 *          DEV_MOCK ("true" = skip Gemini, return a labelled placeholder render, LOCAL ONLY),
 *          WA_OTP_TEMPLATE, GHL_LOCATION_ID, GHL_CALENDAR_ID
 *
 * MODEL: gemini-3.1-flash-image (Nano Banana 2, GA 2026-05-28). 2.5-flash-image retired
 * 2026-10-02 — do not roll back. Multi-image (hand + inspiration) is native to this model.
 */
const MODEL = "gemini-3.1-flash-image";
const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-04-15"; // Version header GHL v2 expects; match what the consent Worker uses
const ALLOWED_ORIGINS = [
  "https://basedaesthetics.co",
  "https://www.basedaesthetics.co",
  "http://localhost:8788",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

/* ================= PRICING — single source of truth =================
 * The rack, the shade wall, the builder, the inspo flow AND the standalone
 * calculator all read from this table. If the counter price changes, change it
 * HERE only. A render that quotes less than the counter breaks the core promise.
 * CONFIRM every number with the counter before public launch.
 */
const PRICING = {
  currency: "INR",
  tiers: {
    "gel-polish": { service: "Gel Polish — Hands", price: 1000, label: "₹1,000" },
    "gel-french": { service: "Gel French", price: 1300, label: "₹1,300" },
    "any-design": { service: "Any Design — Art · Chrome · Ombré · Glitter", price: 2999, label: "₹2,999", campaign: true, was: "₹3,500" },
  },
  // Extras are quoted by the calculator; renders always quote the service tier only.
  extras: {
    removal: { name: "Old gel / polish removal", price: 300, label: "₹300" },
  },
  extensionsNote: "Extensions are measured and priced in the chair — bring your record to the free Nail Assessment.",
  // Builder rules: finish/art selections can only push the tier UP, never invent a price.
  finishes: {
    gloss:    { label: "Gloss",   tier: null,         mod: "high-gloss wet-look finish" },
    matte:    { label: "Matte",   tier: null,         mod: "completely matte velvet finish, no shine" },
    glazed:   { label: "Glazed",  tier: "any-design", mod: "glazed-donut pearl sheen over the colour" },
    chrome:   { label: "Chrome",  tier: "any-design", mod: "liquid-metal chrome powder finish over the colour, intense mirror reflectivity" },
    "cat-eye":{ label: "Cat Eye", tier: "any-design", mod: "magnetic cat-eye effect: a bright vertical band of shimmering light through the centre of each nail" },
    ombre:    { label: "Ombré",   tier: "any-design", mod: "soft ombré: sheer nude at the cuticle melting seamlessly into full colour at the tip" },
  },
  arts: {
    none:           { label: "No art",       tier: null,         mod: "" },
    french:         { label: "French tip",   tier: "gel-french", mod: "French manicure: sheer pink-nude base with a crisp ARTCOLOUR tip following the free edge of each nail" },
    "micro-french": { label: "Micro French", tier: "gel-french", mod: "micro French: sheer pink-nude base with an ultra-thin ARTCOLOUR line tracing only the very edge of each nail tip, precise and minimal" },
    line:           { label: "Fine line",    tier: "any-design", mod: "minimal art: a single thin hand-painted ARTCOLOUR diagonal line across each nail, clean negative space" },
    dots:           { label: "Dots",         tier: "any-design", mod: "minimal art: three small ARTCOLOUR dots arranged near the cuticle of each nail, precise and understated" },
    "glitter-fade": { label: "Glitter fade", tier: "any-design", mod: "fine ARTCOLOUR micro-glitter fading densely from the tip of each nail over the base colour, sealed glossy" },
  },
  artColours: {
    white:    { label: "White",    hex: "#F7F4EE" },
    marigold: { label: "Marigold", hex: "#E3AB36" },
    ink:      { label: "Ink",      hex: "#26190F" },
    gold:     { label: "Gold",     hex: "#C9A227" },
    silver:   { label: "Silver",   hex: "#C0C4CC" },
    cherry:   { label: "Cherry",   hex: "#5C1218" },
  },
};

const TIER_ORDER = ["gel-polish", "gel-french", "any-design"];

/* ================= SHADE WALL =================
 * Solid colours on YOUR hand — the most reliable render class. All gel-polish
 * tier unless a finish upgrades them. undertone powers "for your skin" grouping.
 */
const SHADES = {
  "cherry-noir":   { name: "Cherry Noir",   hex: "#5C1218", undertone: "warm",    desc: "opaque deep oxblood cherry-red" },
  "tomato-red":    { name: "Tomato Red",    hex: "#C0342B", undertone: "warm",    desc: "opaque bright true tomato red" },
  "brick-rose":    { name: "Brick Rose",    hex: "#A9504C", undertone: "warm",    desc: "muted brick-rose, between red and dusty pink" },
  "dusty-rose":    { name: "Dusty Rose",    hex: "#C99A92", undertone: "neutral", desc: "soft dusty rose pink" },
  "milk-glaze":    { name: "Milk Glaze",    hex: "#F2EBE0", undertone: "neutral", desc: "sheer milky-white, translucent and even" },
  "bare-sand":     { name: "Bare Sand",     hex: "#D9BFA6", undertone: "neutral", desc: "sheer-to-opaque warm sand nude" },
  "latte":         { name: "Latte",         hex: "#B08968", undertone: "warm",    desc: "creamy latte beige" },
  "caramel":       { name: "Caramel",       hex: "#9C6642", undertone: "warm",    desc: "rich caramel brown" },
  "terracotta":    { name: "Terracotta",    hex: "#B85C38", undertone: "warm",    desc: "burnt terracotta clay-orange" },
  "marigold":      { name: "Marigold",      hex: "#E3AB36", undertone: "warm",    desc: "bright marigold yellow" },
  "olive":         { name: "Olive",         hex: "#6B7042", undertone: "neutral", desc: "muted olive green" },
  "emerald":       { name: "Emerald",       hex: "#1E5C46", undertone: "cool",    desc: "deep emerald green" },
  "midnight-ink":  { name: "Midnight Ink",  hex: "#1F2A44", undertone: "cool",    desc: "near-black midnight navy" },
  "plum":          { name: "Plum",          hex: "#5C2E4A", undertone: "cool",    desc: "deep wine plum" },
  "lilac-haze":    { name: "Lilac Haze",    hex: "#B9A7C9", undertone: "cool",    desc: "soft hazy lilac" },
  "classic-white": { name: "Classic White", hex: "#F7F4EE", undertone: "neutral", desc: "opaque clean classic white" },
};

/* ================= DESIGN RACK (12 house sets) =================
 * Server-side only; client gets display fields, never prompts.
 * campaign:true → shows the ₹2,999 any-design rate (art designs where menu would exceed it).
 */
const DESIGNS = {
  "cherry-noir": {
    name: "Cherry Noir", finish: "Gloss", tier: "gel-polish", campaign: false,
    style: "opaque deep oxblood cherry-red gel polish, high-gloss wet-look finish, perfectly smooth single colour on every nail",
  },
  "milk-glaze": {
    name: "Milk Glaze", finish: "Gloss", tier: "gel-polish", campaign: false,
    style: "sheer milky-white glazed-donut gel polish, soft translucent finish with a subtle pearl sheen, clean and even on every nail",
  },
  "classic-french": {
    name: "Classic French", finish: "French", tier: "gel-french", campaign: false,
    style: "classic French manicure in gel: natural pink-nude base with a crisp white tip following the free edge of each nail, glossy finish",
  },
  "micro-french-marigold": {
    name: "Micro French — Marigold", finish: "French", tier: "gel-french", campaign: false,
    style: "micro French manicure: sheer nude base with an ultra-thin marigold-yellow line tracing only the very edge of each nail tip, glossy finish, precise and minimal",
  },
  "chrome-silver": {
    name: "Chrome Silver", finish: "Chrome", tier: "any-design", campaign: true,
    style: "liquid-metal silver chrome powder finish over gel, intense mirror reflectivity, seamless metallic surface on every nail",
  },
  "cat-eye-emerald": {
    name: "Cat Eye — Emerald", finish: "Chrome", tier: "any-design", campaign: true,
    style: "deep emerald-green magnetic cat-eye gel: dark green base with a bright vertical band of shimmering light through the centre of each nail, glossy finish",
  },
  "latte-ombre": {
    name: "Latte Ombré", finish: "Ombré", tier: "any-design", campaign: true,
    style: "soft latte ombré gel: warm milky beige at the cuticle blending seamlessly into a deeper caramel brown at the tip of each nail, glossy finish",
  },
  "terracotta-matte": {
    name: "Terracotta Matte", finish: "Matte", tier: "gel-polish", campaign: false,
    style: "opaque burnt terracotta clay-orange gel polish with a completely matte velvet finish, no shine, smooth single colour on every nail",
  },
  "marigold-line": {
    name: "Marigold Line", finish: "Minimal art", tier: "any-design", campaign: true,
    style: "minimal nail art: sheer nude glossy base with a single thin hand-painted marigold-yellow diagonal line across each nail, clean negative space",
  },
  "ink-dots": {
    name: "Ink Dots", finish: "Minimal art", tier: "any-design", campaign: true,
    style: "minimal nail art: milky sheer base with three small dark-ink dots arranged near the cuticle of each nail, glossy finish, precise and understated",
  },
  "glitter-champagne": {
    name: "Champagne Glitter", finish: "Glitter", tier: "any-design", campaign: true,
    style: "champagne-gold fine glitter gel, densely packed micro-glitter with warm golden sparkle, glossy sealed finish on every nail",
  },
  "tortoise-shell": {
    name: "Tortoise Shell", finish: "Detailed art", tier: "any-design", campaign: true,
    style: "tortoise-shell nail art: translucent amber base with organic dark-brown and black mottled patches, deep glass-like glossy finish on every nail",
  },
};

/* ================= PROMPTS ================= */
const STRICT_RULES = [
  "STRICT RULES:",
  "- Change ONLY the nail plates. Keep the exact same hand, fingers, skin tone, skin texture, jewellery, background and lighting.",
  "- Keep the person's natural nail length and nail shape exactly as photographed. Do not lengthen, shorten or reshape any nail.",
  "- The polish must respect each nail's natural edges and cuticle line. No colour on skin.",
  "- Match the photo's lighting: reflections and shadows on the polish must be consistent with the scene.",
  "- Photorealistic result. This must look like a photograph of a finished professional manicure, not an illustration.",
  "Return the edited image.",
].join("\n");

function buildPrompt(style) {
  return [
    "Edit this photo of a real hand. Apply the following nail design to the fingernails only:",
    style + ".",
    STRICT_RULES,
  ].join("\n");
}

function shadeStyle(shade, finishKey) {
  const finish = PRICING.finishes[finishKey] || PRICING.finishes.gloss;
  return `${shade.desc} gel polish, ${finish.mod}, perfectly smooth and even on every nail`;
}

function builderStyle(spec) {
  const shade = SHADES[spec.shadeId] || SHADES["bare-sand"];
  const finish = PRICING.finishes[spec.finish] || PRICING.finishes.gloss;
  const art = PRICING.arts[spec.art] || PRICING.arts.none;
  const artColour = (PRICING.artColours[spec.artColour] || {}).label || "white";
  if (spec.art && spec.art !== "none") {
    const artMod = art.mod.replace(/ARTCOLOUR/g, artColour.toLowerCase());
    return `${artMod}, over a ${shade.desc} base where the base shows, ${finish.mod}`;
  }
  return shadeStyle(shade, spec.finish);
}

const INSPO_INTENTS = {
  colours: "Carry over the exact colour palette and finish from the inspiration. Adapt the pattern placement freely to suit this client's nails.",
  art:     "Carry over the artwork, pattern and placement from the inspiration as faithfully as flat gel art allows. Keep colours close to the inspiration.",
  vibe:    "Carry over the overall style, mood and finish of the inspiration. Interpret freely so it suits this client's nails and skin tone.",
};

function inspoPrompt(analysis, intent) {
  return [
    "You are editing the FIRST image: a photo of a real client's hand. The SECOND image is their nail-design inspiration.",
    "Transfer the inspiration's nail design onto the client's fingernails.",
    INSPO_INTENTS[intent] || INSPO_INTENTS.vibe,
    "Studio read of the inspiration: " + analysis,
    "Interpret the design so a gel salon can execute it in a standard appointment: flat gel art only — no 3D charms, no encapsulated elements, no airbrush.",
    STRICT_RULES.replace("Edit this photo of a real hand. Apply the following nail design to the fingernails only:", ""),
  ].join("\n");
}

const GATE_PROMPT = [
  "You are the strict photo checker for a nail try-on studio. Examine this image and reply with ONLY a JSON object, no other text:",
  '{"ok": true} or {"ok": false, "reason": "<one short friendly sentence telling the user exactly how to retake it>"}',
  "ok=true ONLY when ALL of these hold:",
  "- the back of a real human hand is clearly visible",
  "- at least 4 fingernails are visible",
  "- lighting is bright and even (not dark, not heavily yellow, not backlit silhouette)",
  "- the photo is sharp, not motion-blurred",
  "- the hand fills a good portion of the frame (nails are the subject, not the table)",
  "Be strict: a bad photo produces a dishonest render, and this studio only does honest.",
].join("\n");

const INSPO_ANALYSIS_PROMPT = [
  "You are a nail technician examining a client's inspiration photo. Reply with ONLY a JSON object, no other text:",
  '{"palette":"main colours","finish":"gloss|matte|chrome|cat-eye|glitter|ombre|french","pattern":"short description of the art","complexity":"plain|french|art|heavy","executable":true|false,"note":"one short sentence"}',
  "executable=false when the design needs 3D charms, encapsulated elements, airbrush, jewellery, or hand-painted micro-detail beyond flat gel art in a standard salon appointment.",
].join("\n");

/* ================= ROUTER ================= */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    try {
      if (url.pathname === "/api/tryon/health") {
        return json({ ok: true, v: 4, model: MODEL, booking: ghlConfigured(env), otp: otpConfigured(env) }, 200, cors);
      }
      if (url.pathname === "/api/tryon/designs" && request.method === "GET") {
        const list = Object.entries(DESIGNS).map(([id, d]) => {
          const t = PRICING.tiers[d.tier];
          return { id, name: d.name, finish: d.finish, price: t.label, campaign: !!t.campaign, service: t.service };
        });
        return json({ designs: list, offer: "Any design — ₹2,999" }, 200, cors);
      }
      if (url.pathname === "/api/tryon/pricing" && request.method === "GET") {
        return json({
          tiers: PRICING.tiers,
          extras: PRICING.extras,
          extensionsNote: PRICING.extensionsNote,
          finishes: mapVals(PRICING.finishes, (f) => ({ label: f.label, tier: f.tier })),
          arts: mapVals(PRICING.arts, (a) => ({ label: a.label, tier: a.tier })),
          artColours: PRICING.artColours,
          shades: Object.entries(SHADES).map(([id, s]) => ({ id, ...s })),
        }, 200, cors);
      }
      if (url.pathname === "/api/tryon/stats/public" && request.method === "GET") {
        const painted = parseInt((await env.TRYON.get("tryon:stats:painted")) || "0", 10);
        const staff = Boolean(env.STAFF_PIN && request.headers.get("X-Staff-Pin") === env.STAFF_PIN);
        return json({ painted, staff }, 200, cors);
      }
      if (url.pathname === "/api/tryon/otp/send" && request.method === "POST") {
        return await handleOtpSend(request, env, cors);
      }
      if (url.pathname === "/api/tryon/otp/verify" && request.method === "POST") {
        return await handleOtpVerify(request, env, cors);
      }
      if ((url.pathname === "/api/tryon/render" || url.pathname === "/api/tryon") && request.method === "POST") {
        return await handleRender(request, env, cors);
      }
      if (url.pathname === "/api/tryon/records" && request.method === "POST") {
        return await handleRecordSave(request, env, cors);
      }
      const recMatch = url.pathname.match(/^\/api\/tryon\/records\/([A-Za-z0-9-]+)$/);
      if (recMatch && request.method === "GET") {
        return await handleRecordGet(recMatch[1], env, cors);
      }
      const paintedMatch = url.pathname.match(/^\/api\/tryon\/records\/([A-Za-z0-9-]+)\/painted$/);
      if (paintedMatch && request.method === "POST") {
        return await handlePainted(paintedMatch[1], request, env, cors);
      }
      const imgMatch = url.pathname.match(/^\/api\/tryon\/img\/([A-Za-z0-9-]+)(\/after)?$/);
      if (imgMatch && request.method === "GET") {
        return await handleRecordImage(imgMatch[1], Boolean(imgMatch[2]), env);
      }
      const pageMatch = url.pathname.match(/^\/r\/([A-Za-z0-9-]+)\/?$/);
      if (pageMatch && request.method === "GET") {
        return await handleRecordPage(pageMatch[1], url, env);
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

/* ================= IDENTITY (OTP + token) ================= */
function otpConfigured(env) {
  return Boolean(env.WA_TOKEN && env.WA_PHONE_ID);
}

async function handleOtpSend(request, env, cors) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400, cors); }
  const e164 = toE164India(body?.phone);
  if (!e164) return json({ error: "That number doesn't look right. Use your 10-digit WhatsApp number." }, 400, cors);

  // Rate limits: 3 sends / phone / hour, 10 sends / IP / day
  const today = new Date().toISOString().slice(0, 10);
  const rlKey = `tryon:otprl:${e164}`;
  const rlCount = parseInt((await env.TRYON.get(rlKey)) || "0", 10);
  if (rlCount >= 3) return json({ error: "Too many codes sent. Wait an hour and try again." }, 429, cors);
  const ipKey = `tryon:otpip:${today}:${hashIp(request)}`;
  const ipCount = parseInt((await env.TRYON.get(ipKey)) || "0", 10);
  if (ipCount >= 10) return json({ error: "Too many attempts from here today." }, 429, cors);

  const code = String(Math.floor(100000 + Math.random() * 900000));
  await Promise.all([
    env.TRYON.put(`tryon:otp:${e164}`, JSON.stringify({ code, attempts: 0 }), { expirationTtl: 600 }),
    env.TRYON.put(rlKey, String(rlCount + 1), { expirationTtl: 3600 }),
    env.TRYON.put(ipKey, String(ipCount + 1), { expirationTtl: 172800 }),
  ]);

  if (otpConfigured(env)) {
    const sent = await sendWhatsAppOtp(env, e164, code);
    if (!sent) {
      console.error("WhatsApp OTP send failed", e164);
      return json({ error: "Couldn't reach WhatsApp. Check the number and try again." }, 502, cors);
    }
    await logEvent(env, "otp_sent", { phone: e164 });
    return json({ sent: true }, 200, cors);
  }

  // No provider configured — local/dev only. Requires OTP_DEV=true so this can never
  // leak codes in production by accident.
  if (env.OTP_DEV === "true") {
    console.log("OTP (dev) for", e164, "=", code);
    return json({ sent: true, dev: true, devCode: code }, 200, cors);
  }
  console.error("OTP provider not configured and OTP_DEV is not true");
  return json({ error: "Verification is being set up. Try WhatsApping us instead." }, 503, cors);
}

async function sendWhatsAppOtp(env, e164, code) {
  // Meta WhatsApp Cloud API. Template must exist in the WA Business account
  // (utility category, one body variable = the code). Name via WA_OTP_TEMPLATE.
  const r = await fetch(`https://graph.facebook.com/v21.0/${env.WA_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: e164.replace("+", ""),
      type: "template",
      template: {
        name: env.WA_OTP_TEMPLATE || "tryon_otp",
        language: { code: "en" },
        components: [{ type: "body", parameters: [{ type: "text", text: code }] }],
      },
    }),
  });
  if (!r.ok) console.error("WA API", r.status, (await r.text()).slice(0, 300));
  return r.ok;
}

async function handleOtpVerify(request, env, cors) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400, cors); }
  const e164 = toE164India(body?.phone);
  const code = String(body?.code || "").replace(/\D/g, "");
  if (!e164 || code.length !== 6) return json({ error: "Enter the 6-digit code from WhatsApp." }, 400, cors);

  const raw = await env.TRYON.get(`tryon:otp:${e164}`);
  if (!raw) return json({ error: "Code expired. Send a new one." }, 410, cors);
  const rec = JSON.parse(raw);
  if (rec.attempts >= 5) return json({ error: "Too many wrong tries. Send a new code." }, 429, cors);
  if (rec.code !== code) {
    await env.TRYON.put(`tryon:otp:${e164}`, JSON.stringify({ code: rec.code, attempts: rec.attempts + 1 }), { expirationTtl: 600 });
    return json({ error: "That code doesn't match. Check and try again." }, 401, cors);
  }

  if (!env.SESSION_SECRET) {
    console.error("SESSION_SECRET not set");
    return json({ error: "Verification is being set up. Try again shortly." }, 503, cors);
  }
  await Promise.all([
    env.TRYON.delete(`tryon:otp:${e164}`),
    env.TRYON.put(`tryon:phone:${e164}`, JSON.stringify({ verified: true, ts: Date.now() })),
  ]);
  const token = await signToken(e164, env.SESSION_SECRET, 30);
  await logEvent(env, "otp_verified", { phone: e164 });
  return json({ verified: true, token, phone: e164 }, 200, cors);
}

async function signToken(phone, secret, days) {
  const exp = Date.now() + days * 86400000;
  const payload = `${phone}.${exp}`;
  const sig = await hmacHex(secret, payload);
  return b64url(payload) + "." + sig;
}

async function readToken(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const tok = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!tok || !env.SESSION_SECRET) return null;
  const dot = tok.lastIndexOf(".");
  if (dot < 0) return null;
  const payloadB64 = tok.slice(0, dot);
  const sig = tok.slice(dot + 1);
  let payload;
  try { payload = atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")); } catch { return null; }
  const expect = await hmacHex(env.SESSION_SECRET, payload);
  if (expect !== sig) return null;
  const splitAt = payload.lastIndexOf(".");
  const phone = payload.slice(0, splitAt);
  const exp = parseInt(payload.slice(splitAt + 1), 10);
  if (!phone.startsWith("+") || !exp || Date.now() > exp) return null;
  return { phone };
}

async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64url(s) {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* ================= LIMITS =================
 * Anonymous: ANON_RENDER_CAP renders / session / day (+ soft per-IP cap).
 * Verified:  VERIFIED_DAILY_CAP renders / phone / day.
 * Staff PIN: bypass (in-chair kiosk). Booking never consumes renders.
 * Global:    DAILY_RENDER_CAP kill-switch across everyone.
 */
async function checkLimits(request, env, sessionId) {
  const today = new Date().toISOString().slice(0, 10);

  const dailyCap = parseInt(env.DAILY_RENDER_CAP || "400", 10);
  const dailyKey = `tryon:daily:${today}`;
  const dailyCount = parseInt((await env.TRYON.get(dailyKey)) || "0", 10);
  if (dailyCount >= dailyCap) {
    return { blocked: { error: "Today's render limit is reached. Book the free Nail Assessment and try unlimited designs in the chair.", capped: true, reason: "global" }, status: 429 };
  }

  if (env.STAFF_PIN && request.headers.get("X-Staff-Pin") === env.STAFF_PIN) {
    return { ok: true, kind: "staff", bump: async () => {
      await env.TRYON.put(dailyKey, String(dailyCount + 1), { expirationTtl: 172800 });
    }, remaining: 999, limit: 999 };
  }

  const auth = await readToken(request, env);
  if (auth) {
    const cap = parseInt(env.VERIFIED_DAILY_CAP || "6", 10);
    const key = `tryon:ph:${today}:${auth.phone}`;
    const n = parseInt((await env.TRYON.get(key)) || "0", 10);
    if (n >= cap) {
      return { blocked: { error: "That's your six for today. The chair has no limit — book the free assessment.", capped: true, reason: "daily" }, status: 429 };
    }
    return { ok: true, kind: "verified", phone: auth.phone, bump: async () => {
      await Promise.all([
        env.TRYON.put(dailyKey, String(dailyCount + 1), { expirationTtl: 172800 }),
        env.TRYON.put(key, String(n + 1), { expirationTtl: 172800 }),
      ]);
    }, remaining: cap - n - 1, limit: cap };
  }

  const cap = parseInt(env.ANON_RENDER_CAP || "2", 10);
  const sid = sanitizeId(sessionId) || hashIp(request);
  const sessKey = `tryon:anon:${today}:${sid}`;
  const sessCount = parseInt((await env.TRYON.get(sessKey)) || "0", 10);
  const ipKey = `tryon:ip:${today}:${hashIp(request)}`;
  const ipCount = parseInt((await env.TRYON.get(ipKey)) || "0", 10);
  if (sessCount >= cap || ipCount >= cap * 2) {
    return { blocked: { error: "Your free previews are used. Verify your WhatsApp number for more renders — and to save your Fitting Records.", capped: true, reason: "anon", verify: true }, status: 429 };
  }
  return { ok: true, kind: "anon", bump: async () => {
    await Promise.all([
      env.TRYON.put(dailyKey, String(dailyCount + 1), { expirationTtl: 172800 }),
      env.TRYON.put(sessKey, String(sessCount + 1), { expirationTtl: 172800 }),
      env.TRYON.put(ipKey, String(ipCount + 1), { expirationTtl: 172800 }),
    ]);
  }, remaining: cap - sessCount - 1, limit: cap };
}

/* ================= GEMINI ================= */
function splitDataUrl(image) {
  const [meta, b64] = image.split(",");
  const mime = (meta.match(/data:(image\/[a-z+]+);/) || [])[1] || "image/jpeg";
  return { mime, b64 };
}

async function gemini(env, parts, wantImage) {
  const body = {
    contents: [{ parts }],
    generationConfig: { responseModalities: wantImage ? ["IMAGE"] : ["TEXT"] },
  };
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY }, body: JSON.stringify(body) }
  );
  if (!r.ok) {
    console.error("Gemini error", r.status, (await r.text()).slice(0, 500));
    return null;
  }
  const data = await r.json();
  return data?.candidates?.[0]?.content?.parts || [];
}

async function gatePhoto(env, image) {
  // Fail-OPEN on API trouble: a gate outage must not block paying renders. Log it.
  try {
    const { mime, b64 } = splitDataUrl(image);
    const parts = await gemini(env, [{ inline_data: { mime_type: mime, data: b64 } }, { text: GATE_PROMPT }], false);
    if (!parts) return { ok: true, bypass: true };
    const text = (parts.find((p) => p.text) || {}).text || "";
    const m = text.replace(/```json|```/g, "").match(/\{[\s\S]*\}/);
    if (!m) return { ok: true, bypass: true };
    const g = JSON.parse(m[0]);
    return g.ok ? { ok: true } : { ok: false, reason: g.reason || "Retake it brighter, with all five nails filling the frame." };
  } catch (e) {
    console.error("gate error", e);
    return { ok: true, bypass: true };
  }
}

async function analyseInspo(env, image) {
  try {
    const { mime, b64 } = splitDataUrl(image);
    const parts = await gemini(env, [{ inline_data: { mime_type: mime, data: b64 } }, { text: INSPO_ANALYSIS_PROMPT }], false);
    if (!parts) return null;
    const text = (parts.find((p) => p.text) || {}).text || "";
    const m = text.replace(/```json|```/g, "").match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch (e) {
    console.error("inspo analysis error", e);
    return null;
  }
}

function mockRenderImage(label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#E9DFCB"/><rect x="40" y="40" width="720" height="520" fill="none" stroke="#26190F" stroke-width="6"/><text x="400" y="280" font-family="monospace" font-size="34" fill="#A8352C" text-anchor="middle">DEV MOCK RENDER</text><text x="400" y="340" font-family="monospace" font-size="24" fill="#26190F" text-anchor="middle">${label.replace(/[<>&"]/g, "").slice(0, 40)}</text></svg>`;
  return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
}

/* ================= RENDER ================= */
async function handleRender(request, env, cors) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid request body." }, 400, cors); }

  const mode = body?.mode || (body?.designId ? "design" : "");
  const { image, sessionId } = body || {};
  if (!image || typeof image !== "string" || !image.startsWith("data:image/")) {
    return json({ error: "A hand photo is required." }, 400, cors);
  }
  if (image.length > 8_400_000) {
    return json({ error: "Photo too large. Retake in the app — it resizes automatically." }, 413, cors);
  }

  // Resolve the mode into a prompt + display spec BEFORE spending on limits/gate.
  let prompt, spec, inspoImage = null, analysis = null;

  if (mode === "design") {
    const d = DESIGNS[body.designId];
    if (!d) return json({ error: "Unknown design." }, 400, cors);
    const t = PRICING.tiers[d.tier];
    prompt = buildPrompt(d.style);
    spec = { mode, designId: body.designId, name: d.name, service: t.service, price: t.label, campaign: !!t.campaign, was: t.was || null, interpretation: false };
  } else if (mode === "shade") {
    const shade = SHADES[body.shadeId];
    if (!shade) return json({ error: "Unknown shade." }, 400, cors);
    const finish = PRICING.finishes[body.finish] ? body.finish : "gloss";
    const tierKey = highestTier(["gel-polish", PRICING.finishes[finish].tier]);
    const t = PRICING.tiers[tierKey];
    prompt = buildPrompt(shadeStyle(shade, finish));
    spec = { mode, shadeId: body.shadeId, finish, name: `${shade.name} · ${PRICING.finishes[finish].label}`, service: t.service, price: t.label, campaign: !!t.campaign, was: t.was || null, interpretation: false };
  } else if (mode === "builder") {
    const b = body.builder || {};
    if (!SHADES[b.shadeId]) return json({ error: "Pick a colour first." }, 400, cors);
    if (!PRICING.finishes[b.finish]) return json({ error: "Pick a finish." }, 400, cors);
    if (!PRICING.arts[b.art]) return json({ error: "Pick an art option." }, 400, cors);
    if (b.art !== "none" && !PRICING.artColours[b.artColour]) return json({ error: "Pick an art colour." }, 400, cors);
    const tierKey = highestTier(["gel-polish", PRICING.finishes[b.finish].tier, PRICING.arts[b.art].tier]);
    const t = PRICING.tiers[tierKey];
    const shade = SHADES[b.shadeId];
    const bits = [shade.name, PRICING.finishes[b.finish].label];
    if (b.art !== "none") bits.push(PRICING.arts[b.art].label + " " + (PRICING.artColours[b.artColour]?.label || ""));
    prompt = buildPrompt(builderStyle(b));
    spec = { mode, builder: b, name: bits.join(" · "), service: t.service, price: t.label, campaign: !!t.campaign, was: t.was || null, interpretation: false };
  } else if (mode === "inspo") {
    const inspo = body.inspo || {};
    if (!inspo.image || typeof inspo.image !== "string" || !inspo.image.startsWith("data:image/")) {
      return json({ error: "An inspiration photo is required." }, 400, cors);
    }
    if (inspo.image.length > 8_400_000) return json({ error: "Inspiration photo too large." }, 413, cors);
    inspoImage = inspo.image;
    const intent = INSPO_INTENTS[inspo.intent] ? inspo.intent : "vibe";
    if (env.DEV_MOCK !== "true") {
      analysis = await analyseInspo(env, inspoImage);
    }
    const note = analysis ? `${analysis.palette || ""}, ${analysis.pattern || "design"}, ${analysis.finish || "gloss"} finish`.replace(/^, /, "") : "the design in the inspiration photo";
    prompt = inspoPrompt(note, intent);
    const complexity = analysis?.complexity || "art";
    const executable = analysis ? analysis.executable !== false : true;
    const tierKey = complexity === "plain" ? "gel-polish" : complexity === "french" ? "gel-french" : "any-design";
    const t = PRICING.tiers[tierKey];
    spec = {
      mode, intent, name: "Your inspiration", service: executable ? t.service : "Custom art — quoted in chair",
      price: executable ? t.label : null, priceNote: executable ? null : "Artist confirms feasibility & price in the chair",
      campaign: executable && !!t.campaign, was: executable ? t.was || null : null,
      interpretation: true, analysis: analysis ? { complexity, executable, note: analysis.note || "" } : null,
    };
  } else {
    return json({ error: "Unknown render mode." }, 400, cors);
  }

  // Limits
  const lim = await checkLimits(request, env, sessionId);
  if (lim.blocked) return json(lim.blocked, lim.status, cors);

  // Photo gate — strict rules on the hand photo before we spend a render.
  if (env.DEV_MOCK !== "true") {
    const gate = await gatePhoto(env, image);
    if (!gate.ok) {
      await logEvent(env, "gate_reject", { mode, reason: gate.reason });
      return json({ error: gate.reason, gate: true }, 422, cors);
    }
    if (gate.bypass) await logEvent(env, "gate_bypass", { mode });
  }

  // Render
  let outImage;
  if (env.DEV_MOCK === "true") {
    outImage = mockRenderImage(spec.name);
  } else {
    const hand = splitDataUrl(image);
    const parts = [{ inline_data: { mime_type: hand.mime, data: hand.b64 } }];
    if (inspoImage) {
      const ref = splitDataUrl(inspoImage);
      parts.push({ inline_data: { mime_type: ref.mime, data: ref.b64 } });
    }
    parts.push({ text: prompt });
    const out = await gemini(env, parts, true);
    const imgPart = out && out.find((p) => p.inline_data || p.inlineData);
    if (!imgPart) {
      return json({ error: "Render failed. Try a brighter photo with nails clearly visible." }, 502, cors);
    }
    const o = imgPart.inline_data || imgPart.inlineData;
    outImage = `data:${o.mime_type || o.mimeType || "image/png"};base64,${o.data}`;
  }

  await lim.bump();

  const today = new Date().toISOString().slice(0, 10);
  const renderId = `TR-${today.replace(/-/g, "").slice(2)}-${crypto.randomUUID().slice(0, 5).toUpperCase()}`;
  await Promise.all([
    env.TRYON.put(`tryon:render:${renderId}`,
      JSON.stringify({ renderId, mode, spec: { name: spec.name, price: spec.price }, ts: Date.now(), who: lim.kind === "verified" ? lim.phone : lim.kind })
      // deliberately NO expirationTtl — meta only
    ),
    logEvent(env, "render_" + mode, { renderId, who: lim.kind }),
  ]);

  return json({
    renderId,
    image: outImage,
    spec,
    remaining: lim.remaining,
    limit: lim.limit,
    verified: lim.kind === "verified" || lim.kind === "staff",
  }, 200, cors);
}

function highestTier(keys) {
  let best = "gel-polish";
  for (const k of keys) {
    if (k && TIER_ORDER.indexOf(k) > TIER_ORDER.indexOf(best)) best = k;
  }
  return best;
}

/* ================= RECORDS (shareable Fitting Records) ================= */
async function handleRecordSave(request, env, cors) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400, cors); }
  const { renderId, image, spec } = body || {};
  if (!renderId || !/^TR-\d{6}-[A-Z0-9]+$/.test(renderId)) return json({ error: "A render reference is required." }, 400, cors);
  if (!image || !image.startsWith("data:image/") || image.length > 8_400_000) return json({ error: "The rendered image is required." }, 400, cors);

  const staff = env.STAFF_PIN && request.headers.get("X-Staff-Pin") === env.STAFF_PIN;
  const auth = await readToken(request, env);
  if (!staff && !auth) {
    return json({ error: "Verify your WhatsApp number to save records.", verify: true }, 401, cors);
  }

  const existing = await env.TRYON.get(`tryon:record:${renderId}`);
  if (existing) return json({ saved: true, id: renderId, url: recordUrl(request, renderId), already: true }, 200, cors);

  const holdDays = parseInt(env.RECORD_PRICE_HOLD_DAYS || "7", 10);
  const now = Date.now();
  const meta = {
    id: renderId,
    phone: auth ? auth.phone : (toE164India(body.clientPhone) || null),
    source: staff ? "kiosk" : "web",
    spec: {
      mode: spec?.mode || "design",
      name: String(spec?.name || "Custom set").slice(0, 80),
      service: String(spec?.service || "").slice(0, 80),
      price: spec?.price ? String(spec.price).slice(0, 12) : null,
      priceNote: spec?.priceNote ? String(spec.priceNote).slice(0, 120) : null,
      interpretation: !!spec?.interpretation,
    },
    ts: now,
    expiresAt: now + holdDays * 86400000,
    painted: false,
  };

  const { b64 } = splitDataUrl(image);
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  await Promise.all([
    env.TRYON_R2.put(`records/${renderId}.jpg`, bytes, { httpMetadata: { contentType: "image/jpeg" } }),
    env.TRYON.put(`tryon:record:${renderId}`, JSON.stringify(meta)), // no TTL — the record is the proof
    logEvent(env, "record_saved", { id: renderId, source: meta.source }),
  ]);

  return json({ saved: true, id: renderId, url: recordUrl(request, renderId), expiresAt: meta.expiresAt }, 200, cors);
}

function recordUrl(request, id) {
  const u = new URL(request.url);
  return `${u.origin}/r/${id}`;
}

async function handleRecordGet(id, env, cors) {
  const raw = await env.TRYON.get(`tryon:record:${id}`);
  if (!raw) return json({ error: "Record not found." }, 404, cors);
  const meta = JSON.parse(raw);
  delete meta.phone; // records are public — never expose the number
  return json({ record: meta }, 200, cors);
}

async function handleRecordImage(id, after, env) {
  const key = `records/${id}${after ? "-after" : ""}.jpg`;
  const obj = await env.TRYON_R2.get(key);
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType || "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function handlePainted(id, request, env, cors) {
  if (!env.STAFF_PIN || request.headers.get("X-Staff-Pin") !== env.STAFF_PIN) {
    return json({ error: "Staff only." }, 401, cors);
  }
  const raw = await env.TRYON.get(`tryon:record:${id}`);
  if (!raw) return json({ error: "Record not found." }, 404, cors);
  const meta = JSON.parse(raw);

  let body = {};
  try { body = await request.json(); } catch { /* photo optional */ }
  const puts = [];
  if (body.image && typeof body.image === "string" && body.image.startsWith("data:image/") && body.image.length <= 8_400_000) {
    const { b64 } = splitDataUrl(body.image);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    puts.push(env.TRYON_R2.put(`records/${id}-after.jpg`, bytes, { httpMetadata: { contentType: "image/jpeg" } }));
    meta.hasAfter = true;
  }
  meta.painted = true;
  meta.paintedAt = Date.now();
  const paintedTotal = parseInt((await env.TRYON.get("tryon:stats:painted")) || "0", 10) + 1;
  puts.push(env.TRYON.put(`tryon:record:${id}`, JSON.stringify(meta)));
  puts.push(env.TRYON.put("tryon:stats:painted", String(paintedTotal))); // honesty counter — no TTL
  puts.push(logEvent(env, "painted", { id }));
  await Promise.all(puts);
  return json({ painted: true, id, paintedTotal }, 200, cors);
}

/* The shareable page — og tags make the WhatsApp/social link preview carry the render */
async function handleRecordPage(id, url, env) {
  const raw = await env.TRYON.get(`tryon:record:${id}`);
  if (!raw) {
    return new Response(pageShell("Record not found", "This Fitting Record doesn't exist (or the link is mistyped).", null, null, url), {
      status: 404, headers: { "Content-Type": "text/html;charset=UTF-8" },
    });
  }
  const meta = JSON.parse(raw);
  const origin = url.origin;
  const img = `${origin}/api/tryon/img/${meta.id}`;
  const title = `Fitting Record ${meta.id} — ${meta.spec.name}`;
  const priceLine = meta.spec.price ? `${meta.spec.price} · price held till ${fmtDate(meta.expiresAt)}` : (meta.spec.priceNote || "Price confirmed in the chair");
  const desc = `${meta.spec.name} — rendered on a real hand at Based Aesthetics, Kilpauk. ${priceLine}. Try it on YOUR hand.`;
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

  const afterBlock = meta.hasAfter
    ? `<div class="pair"><figure><img src="${img}" alt="The render"><figcaption>Rendered</figcaption></figure><figure><img src="${img}/after" alt="The painted set"><figcaption>Painted</figcaption></figure></div><p class="stamp2">RENDERED → PAINTED · THE SET YOU SEE IS THE SET YOU GET</p>`
    : `<div class="solo"><img src="${img}" alt="The render on a real hand"></div><p class="stamp2">${meta.spec.interpretation ? "OUR INTERPRETATION — ARTIST CONFIRMS IN THE CHAIR" : "RENDERED ON A REAL HAND"}</p>`;

  const body = `
    <div class="rec">
      <div class="rh"><span>FITTING RECORD</span><span class="no">${esc(meta.id)}</span></div>
      ${afterBlock}
      <div class="rows">
        <div class="row"><span>Design</span><b>${esc(meta.spec.name)}</b></div>
        ${meta.spec.service ? `<div class="row"><span>Service</span><b>${esc(meta.spec.service)}</b></div>` : ""}
        <div class="row"><span>Price</span><b class="price">${meta.spec.price ? esc(meta.spec.price) : "In chair"}</b></div>
        <div class="row"><span>Price held till</span><b>${fmtDate(meta.expiresAt)}</b></div>
        ${meta.painted ? `<div class="row"><span>Status</span><b>Painted in the chair ✓</b></div>` : ""}
      </div>
      <a class="cta" href="https://basedaesthetics.co/tryon">Try it on YOUR hand →</a>
      <p class="foot">Based Aesthetics · Kilpauk · Chennai · basedaesthetics.co/tryon</p>
      <details class="staff"><summary>Staff</summary>
        <div class="staffin">
          <input id="pin" type="password" inputmode="numeric" placeholder="Staff PIN" autocomplete="off">
          <input id="afterFile" type="file" accept="image/*">
          <button id="markBtn">${meta.painted ? "Update after-photo" : "Mark painted"}</button>
          <p id="staffMsg"></p>
        </div>
      </details>
    </div>
    <script>
    (function(){
      var btn=document.getElementById("markBtn"), msg=document.getElementById("staffMsg");
      var file=document.getElementById("afterFile"), pin=document.getElementById("pin");
      function downscale(f,max){return new Promise(function(res,rej){var i=new Image();i.onload=function(){
        var s=Math.min(1,max/Math.max(i.width,i.height));var c=document.createElement("canvas");
        c.width=Math.round(i.width*s);c.height=Math.round(i.height*s);
        c.getContext("2d").drawImage(i,0,0,c.width,c.height);res(c.toDataURL("image/jpeg",0.85));};
        i.onerror=rej;i.src=URL.createObjectURL(f);});}
      btn.onclick=async function(){
        msg.textContent="";
        if(!pin.value){msg.textContent="PIN first.";return;}
        btn.disabled=true;btn.textContent="Saving…";
        try{
          var body={};
          if(file.files&&file.files[0]) body.image=await downscale(file.files[0],1024);
          var r=await fetch("/api/tryon/records/${meta.id}/painted",{method:"POST",
            headers:{"Content-Type":"application/json","X-Staff-Pin":pin.value},body:JSON.stringify(body)});
          var d=await r.json();
          if(!r.ok){msg.textContent=d.error||"Failed.";}
          else{msg.textContent="Done — the record now shows painted.";setTimeout(function(){location.reload();},900);}
        }catch(e){msg.textContent="Connection dropped. Try again.";}
        btn.disabled=false;btn.textContent="${meta.painted ? "Update after-photo" : "Mark painted"}";
      };
    })();
    </script>`;
  return new Response(pageShell(title, desc, img, body, url), { headers: { "Content-Type": "text/html;charset=UTF-8", "Cache-Control": "public, max-age=300" } });
}

function pageShell(title, desc, img, body, url) {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="only light"><title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">${img ? `<meta property="og:image" content="${esc(img)}">` : ""}
<link href="https://fonts.googleapis.com/css2?family=Young+Serif&family=Instrument+Sans:wght@0,400;0,600&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>
body{margin:0;background:#F8F3E8;color:#26190F;font-family:'Instrument Sans',sans-serif;display:flex;justify-content:center;padding:24px 16px 60px}
.rec{max-width:520px;width:100%;border:2.5px solid #26190F;border-radius:8px;background:#F8F3E8;box-shadow:8px 8px 0 #1E2C1A;overflow:hidden}
.rh{display:flex;justify-content:space-between;padding:14px 18px;border-bottom:2px solid #26190F;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.16em}
.rh .no{color:#A8352C}
.solo img{width:100%;display:block;border-bottom:2px solid #26190F}
.pair{display:flex;gap:2px;background:#26190F;border-bottom:2px solid #26190F}
.pair figure{margin:0;flex:1;background:#F8F3E8}
.pair img{width:100%;display:block}
.pair figcaption{font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:.14em;text-transform:uppercase;text-align:center;padding:6px}
.stamp2{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.14em;color:#A8352C;text-align:center;padding:10px 12px;margin:0;border-bottom:1.5px dashed rgba(38,25,15,.25)}
.rows{padding:6px 18px}
.row{display:flex;justify-content:space-between;gap:14px;padding:10px 0;border-bottom:1.5px dashed rgba(38,25,15,.2);font-size:14px}
.row:last-child{border-bottom:none}
.row span{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;opacity:.55;padding-top:3px}
.row .price{font-family:'Young Serif',serif;font-size:22px;color:#A8352C}
.cta{display:block;background:#1E2C1A;color:#F8F3E8;text-align:center;text-decoration:none;font-weight:600;font-size:17px;padding:18px;margin:14px 18px;border-radius:100px;box-shadow:4px 4px 0 #A8352C}
.foot{font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:.14em;text-transform:uppercase;text-align:center;opacity:.6;padding:0 12px 18px}
.staff{margin:0 18px 18px;border-top:1.5px dashed rgba(38,25,15,.25);padding-top:10px}
.staff summary{font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:.14em;text-transform:uppercase;opacity:.45;cursor:pointer}
.staffin{display:grid;gap:8px;padding-top:10px}
.staffin input{border:2px solid #26190F;border-radius:10px;background:#F8F3E8;padding:10px;font-size:15px}
.staffin button{background:#A8352C;color:#F8F3E8;border:none;border-radius:100px;padding:12px;font-weight:600;font-size:14px}
.staffin p{font-size:12.5px;color:#A8352C;margin:0;min-height:16px}
</style></head><body>${body || ""}</body></html>`;
}

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
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
  const { slot, name, phone, renderId } = body || {};
  const specName = String(body?.specName || body?.designId || "design").slice(0, 80);

  if (!slot || !name || !phone) return json({ error: "Name, WhatsApp number and a time are required." }, 400, cors);
  const e164 = toE164India(phone);
  if (!e164) return json({ error: "That phone number doesn't look right. Use your 10-digit WhatsApp number." }, 400, cors);

  const auth = await readToken(request, env);
  const tags = ["tryon", String(body?.designId || body?.mode || "tryon-custom").slice(0, 40)];
  if (auth && auth.phone === e164) tags.push("verified");

  // 1) Contact upsert — same pattern as the consent Worker (phone stored E.164 to match scanner records)
  const cRes = await fetch(`${GHL_BASE}/contacts/upsert`, {
    method: "POST",
    headers: ghlHeaders(env),
    body: JSON.stringify({
      locationId: env.GHL_LOCATION_ID,
      name,
      phone: e164,
      tags,
      source: "tryon",
    }),
  });
  if (!cRes.ok) {
    console.error("GHL upsert error", cRes.status, (await cRes.text()).slice(0, 300));
    return json({ error: "Couldn't save your details. Try again." }, 502, cors);
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
      title: `Try-On — ${specName} (${renderId || "no record"})`,
      appointmentStatus: "confirmed",
    }),
  });
  if (!aRes.ok) {
    console.error("GHL appointment error", aRes.status, (await aRes.text()).slice(0, 300));
    return json({ error: "That slot may have just been taken. Pick another." }, 409, cors);
  }
  const appt = await aRes.json();

  // Log the conversion — permanent, no TTL
  await Promise.all([
    env.TRYON.put(`tryon:booking:${renderId || crypto.randomUUID().slice(0, 8)}`,
      JSON.stringify({ renderId, specName, slot, contactId: contact.id, ts: Date.now() })),
    logEvent(env, "booking", { renderId, specName }),
  ]);

  return json({ booked: true, slot, appointmentId: appt?.id || appt?.event?.id || null }, 200, cors);
}

/* ================= ANALYTICS =================
 * Meta-only events, no TTL (the scanner's 180-day TTL lesson). Daily counters
 * for dashboards expire in 48h.
 */
async function logEvent(env, type, meta) {
  const today = new Date().toISOString().slice(0, 10);
  const key = `tryon:evt:${today}:${crypto.randomUUID()}`;
  const countKey = `tryon:evtcount:${today}:${type}`;
  const n = parseInt((await env.TRYON.get(countKey)) || "0", 10);
  await Promise.all([
    env.TRYON.put(key, JSON.stringify({ type, ...meta, ts: Date.now() })),
    env.TRYON.put(countKey, String(n + 1), { expirationTtl: 172800 }),
  ]);
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
  const d = String(p || "").replace(/\D/g, "");
  if (d.length === 10) return "+91" + d;
  if (d.length === 12 && d.startsWith("91")) return "+" + d;
  if (String(p || "").startsWith("+") && d.length >= 11) return "+" + d;
  return null;
}
function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Staff-Pin",
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
function mapVals(obj, fn) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v)]));
}
