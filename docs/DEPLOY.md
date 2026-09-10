# Based Aesthetics — Try-On v2 · Deploy Notes

## What this is

- `tryon.html` — client page. Flow: strict photo capture → four try-on modes
  (design wall / shade wall / build-my-set / inspiration upload) → Fitting
  Record → booking. Tamil toggle and staff kiosk mode included.
- `calculator.html` — standalone price calculator that reads the same pricing
  brain and pre-loads a builder config into `tryon.html`.
- `worker.js` — Cloudflare Worker. Design prompts, shade table, builder rules,
  pricing, inspiration analysis, and OTP all live server-side.

## 1. Validation test FIRST (one afternoon, ~₹1–2k)

Before deploying anything public:

1. Collect 15–20 hand photos across skin tones / lighting (client photos with
   consent, or team hands).
2. Collect 15 real inspiration screenshots (Pinterest, reels, salon photos)
   including at least 5 that are *not* flat gel art (3D, charms, airbrush) to
   test the "artist confirms in chair" path.
3. `wrangler dev` the Worker locally, hit it from `tryon.html` served with any
   static server.
4. Run every photo × every design, shade, builder combo, and inspo image.
   Judge with AK's eye: "would a client book from this render?"
5. Kill any design / shade / builder rule that fails. The rack degrades
   gracefully — remove the entry, the UI updates itself.
6. If `gemini-3.1-flash-image` quality disappoints, the next step is testing
   `gemini-3-pro-image` (slower, more expensive) — do not roll back to the
   retired `gemini-2.5-flash-image`.

## 2. Required Cloudflare resources

```bash
cd worker

# KV namespace for logs, counters, sessions, record metadata
wrangler kv namespace create TRYON
# paste the id into wrangler.toml

# R2 bucket for shareable Fitting Record images
wrangler r2 bucket create based-tryon
# bucket name already in wrangler.toml

# Secrets
wrangler secret put GEMINI_API_KEY
wrangler secret put GHL_API_KEY
wrangler secret put SESSION_SECRET        # long random string
wrangler secret put STAFF_PIN             # e.g. 6-digit PIN for kiosk + painting records
wrangler secret put WA_TOKEN              # Meta WhatsApp Cloud API token
wrangler secret put WA_PHONE_ID           # WhatsApp phone number id

# Vars (in wrangler.toml [vars])
# DAILY_RENDER_CAP, ANON_RENDER_CAP, VERIFIED_DAILY_CAP, RECORD_PRICE_HOLD_DAYS
# GHL_LOCATION_ID, GHL_CALENDAR_ID, WA_OTP_TEMPLATE

wrangler deploy
```

## 3. DNS / routing

The Worker needs two route patterns on `basedaesthetics.co`:

```toml
routes = [
  { pattern = "basedaesthetics.co/api/tryon*", zone_name = "basedaesthetics.co" },
  { pattern = "basedaesthetics.co/r/*", zone_name = "basedaesthetics.co" }
]
```

The `/r/*` route serves the shareable Fitting Record pages. Make sure nothing
else on the zone claims `/r/*`.

Verify:

```bash
curl https://basedaesthetics.co/api/tryon/health
curl https://basedaesthetics.co/api/tryon/pricing
```

## 4. WhatsApp OTP template

In the Meta Business Manager:

- Category: **Utility**
- Template name: `tryon_otp` (or whatever you set in `WA_OTP_TEMPLATE`)
- Body: `Your Based Aesthetics Try-On code is {{1}}. It expires in 10 minutes.`
- No buttons, no media.

## 5. Page deploy

Drop `tryon.html`, `calculator.html`, and the `assets/tryon/` folder into the
Pages direct-upload bundle.

Update these in `public/tryon.html` before deploy:

```js
WHATSAPP: "91XXXXXXXXXX",  // studio WhatsApp in international format, no +
MAPS_URL: "https://maps.google.com/?q=Based+Aesthetics+Kilpauk+Chennai",
SETS_PAINTED: null,         // e.g. 214 (null hides the line)
```

The standalone preview is rebuilt with:

```bash
python3 scripts/build-preview.py
```

## 6. Launch order

1. **In-chair, week 1–2**: tablet during free Nail Assessments. URL:
   `https://basedaesthetics.co/tryon#kiosk=1`. Staff enter the `STAFF_PIN`.
   Renders are unlimited, no client phone required, and staff can mark each saved
   record as "painted" on the record page — auto-generating real proof assets.
2. **Public** only after in-chair render→booking proves the close. Announce
   with the share card, not an ad.

## 7. Watch-outs

- **Dark-mode**: guarded with `only light` (meta + CSS, incl. dark-media override).
- **KV**: render logs and booking records are meta-only with **no TTL**. Daily
  counters expire in 48h. Do not add TTL to logs — the scanner's 180-day TTL lesson.
- **R2**: record images are public and immutable. They are permanent proof.
- **Cost control**: `DAILY_RENDER_CAP` is the hard brake. Watch `tryon:daily:*`
  keys the first week.
- **Ops honesty**: every design, shade, builder combo, and calculator path must
  quote exactly what the counter charges. Removing a design = delete its entry.
- **Inspiration upload**: the output is labelled "our interpretation" when
  complex, and non-executable designs get an in-chair quote. Never let a render
  quote a price the chair can't honour.
- **Phone consent**: India DPDP — collecting phone + photos requires consent.
  The booking sheet and OTP sheet are the consent moments. Records are tied to
  the verified phone; shared public record pages strip the number.

## 8. GHL wiring

Booking uses the same v2 flow as the consent Worker:

```bash
curl "https://services.leadconnectorhq.com/calendars/${GHL_CALENDAR_ID}/free-slots?startDate=${ms}&endDate=${ms_plus_7d}&timezone=Asia/Kolkata" \
  -H "Authorization: Bearer ${GHL_API_KEY}" \
  -H "Version: 2021-04-15"
```

If the consent Worker uses a different `Version` header, update `GHL_VERSION` in
`worker.js` to match.

Follow-up workflow (build in GHL, not code):

- Tag `tryon` triggers WhatsApp confirmation → 24h reminder → no-show →
  "your record is still valid" re-book nudge.
- Tag `tryon` + design tag gives per-design conversion reporting inside GHL.

## 9. Metrics

The only metric that pays the rent: **render → confirmed booking**.

```
ViewContent → CustomizeProduct → AddToCart (render) → InitiateCheckout → Schedule
```

Server-side analytics keys to watch in KV:

- `tryon:evtcount:${date}:render_*`
- `tryon:evtcount:${date}:record_saved`
- `tryon:evtcount:${date}:booking`
- `tryon:evtcount:${date}:gate_reject`
- `tryon:stats:painted`
