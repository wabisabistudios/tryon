# Based Aesthetics — AI Nail Try-On v2

Upload one hand photo → see any design, any shade, or a custom-built set rendered
on your own nails → get a stamped **Fitting Record** → tap a live slot → booked
in the chair. Or use the standalone **Price Calculator** to build your set, see the
exact price, then jump into the try-on with that configuration pre-loaded.

Live target: `basedaesthetics.co/tryon` · Calculator: `basedaesthetics.co/calculator`
Studio: Kilpauk, Chennai

---

## Repo layout

```
worker/worker.js            Cloudflare Worker — render, designs, pricing, OTP, records, booking
public/tryon.html           The try-on page (single file, no build step)
public/calculator.html      Standalone price calculator
public/tryon-preview.html   Standalone demo build (mocked API, images inlined)
public/assets/tryon/        Studio photos + illustrated mock hands
scripts/build-preview.py    Regenerates the standalone demo build
docs/DEPLOY.md              Deploy steps, env vars, GHL wiring, watch-outs
docs/SHOTLIST.md            Photography/video needed to replace mock assets
```

## Run locally

```bash
# page only (preview build works with zero backend)
npx serve public
# → open http://localhost:3000/tryon-preview.html

# with the real Worker (needs secrets in worker/.dev.vars)
cd worker && wrangler dev
# → open http://localhost:8788/tryon.html
```

## Architecture

- **No framework, no build.** Two HTML files, vanilla JS. Matches the rest of
  `basedaesthetics.co` and keeps the funnel dependency-free.
- **Worker holds all secrets and prompts.** The client sends `{image, mode,
  designId|shadeId|builder|inspo}`. Design prompts, builder rules, shade tables,
  and inspiration analysis never leave the server, so nobody can run arbitrary
  generations on the Gemini key.
- **Pricing brain is single-source-of-truth.** `GET /api/tryon/pricing` feeds
  the try-on rack, shade wall, builder, inspiration flow, and calculator. Change
  prices in one place or they drift, and a render that quotes less than the
  counter breaks the core promise.
- **Render**: `gemini-3.1-flash-image` (~₹6/render), native multi-image input
  (hand photo + inspiration reference in one call). `gemini-2.5-flash-image` is
  not used — it retired 2026-10-02.
- **Photo gate**: server-side text-only Gemini check before every paid render
  (hand visible, 4+ nails, bright, sharp, framed). Fail-open on gate outage.
- **Booking**: GHL v2 — free-slots → contact upsert (E.164) → appointment.
  Unset GHL vars = graceful fallback to the booking widget link.
- **Identity / limits**: 2 anonymous renders/session/day → WhatsApp OTP → 6/day
  per verified phone. Staff kiosk mode bypasses per-client limits with a PIN.
  Global daily kill-switch (`DAILY_RENDER_CAP`). Booking never consumes renders.
- **Records**: every saved Fitting Record is a shareable URL (`/r/abc123`), image
  in R2, meta in KV (no TTL). Staff can mark records "painted" with an after photo
  on the record page. This closes the conversion loop and auto-generates real
  proof assets.
- **Tamil toggle**: built into the page, not a separate file.

## Render modes

| Mode | What the client does | Worker endpoint | Key guardrails |
|---|---|---|---|
| **Wall** | Pick from 12 house designs | `POST /api/tryon/render` mode=`design` | Each design maps to a service tier + known price |
| **Shades** | Pick a colour + finish on your own hand | `POST /api/tryon/render` mode=`shade` | 16 shades with undertones; finish upgrades tier only |
| **Build my set** | Colour × finish × art | `POST /api/tryon/render` mode=`builder` | Builder selections resolve to existing menu prices; can't invent one |
| **Inspiration** | Upload a Pinterest/salon screenshot | `POST /api/tryon/render` mode=`inspo` | Two-step analysis (palette/finish/pattern/complexity/executable); non-executable designs get "artist confirms in chair" instead of a fake price |

## Funnel events

`ViewContent` → `CustomizeProduct` (design/shade/builder/inspo tap) →
`AddToCart` (successful render) → `InitiateCheckout` (slot/book tap) → `Schedule`
(inline booking confirmed).

**Render → confirmed booking** is THE conversion number.

## Launch checklist

- [ ] **Validation afternoon** — 15–20 real hand photos × all designs + 15 real
      inspiration screenshots through the live API. Cut anything that doesn't pass
      AK's eye. This is go/no-go.
- [ ] **Model check** — confirm `gemini-3.1-flash-image` is still active and
      priced as expected.
- [ ] Set secrets: `GEMINI_API_KEY`, `GHL_API_KEY`, `SESSION_SECRET`,
      `STAFF_PIN`, `WA_TOKEN`, `WA_PHONE_ID`
- [ ] Set vars: `GHL_LOCATION_ID`, `GHL_CALENDAR_ID`, `DAILY_RENDER_CAP`,
      `ANON_RENDER_CAP`, `VERIFIED_DAILY_CAP`, `RECORD_PRICE_HOLD_DAYS`,
      `WA_OTP_TEMPLATE` (defaults to `tryon_otp`)
- [ ] Create KV namespace and R2 bucket, paste ids into `worker/wrangler.toml`
- [ ] In `public/tryon.html` CONFIG: `WHATSAPP` (studio number), `MAPS_URL`
      (forced-waypoint link), `SETS_PAINTED` (real number, or leave null)
- [ ] Add route `/r/*` to `basedaesthetics.co` zone and confirm it doesn't clash
- [ ] **Confirm pricing** — every design, shade, builder combo, and calculator
      path quotes exactly what the counter charges. Fix before launch.
- [ ] Deploy Worker + pages, verify `/api/tryon/health` and `/api/tryon/pricing`
- [ ] **Phase 1: in-chair** — tablet during free Nail Assessments, 2 weeks.
      Use kiosk mode (`tryon.html#kiosk=1`) with staff PIN.
- [ ] Shoot demo hands + proof sets (docs/SHOTLIST.md) using real clients from phase 1
- [ ] **Phase 2: public** — launch with the video as Meta creative

## Principles that shouldn't be edited away

1. **What you render is what you get.** Every design must be executable by the
   team at exactly the price shown. Remove a design rather than fudge this.
2. **Her hand always leads.** The record shows the client's own photo, never a sample.
3. **No friction before the magic.** No contact fields before the first render —
   verification is offered *after* the magic, when motivation is highest.
4. **Every render ends at a slot.** A render that dead-ends is a wasted rupee.
5. **Tunables live in config, not in code bodies** — see CONFIG block, Worker vars,
   and the pricing API.
