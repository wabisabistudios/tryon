# Based Aesthetics — AI Nail Try-On

Upload one hand photo → see any design rendered on your own nails → get a stamped
**Fitting Record** → tap a live slot → booked in the chair.

Live target: `basedaesthetics.co/tryon` · Studio: Kilpauk, Chennai

---

## Repo layout

```
worker/worker.js      Cloudflare Worker — render, designs, slots, booking
public/tryon.html     The page (single file, no build step)
public/tryon-preview.html  Standalone demo build (mocked API, images inlined)
public/assets/tryon/  Studio photos + illustrated mock hands
docs/DEPLOY.md        Deploy steps, env vars, GHL wiring, watch-outs
docs/SHOTLIST.md      Photography/video needed to replace mock assets
scripts/              Build helpers
```

## Run locally

```bash
# page only (preview build works with zero backend)
npx serve public
# → open http://localhost:3000/tryon-preview.html

# with the real Worker
cd worker && wrangler dev
```

## Architecture (short)

- **No framework, no build.** One HTML file, vanilla JS. Deliberate — matches the
  rest of basedaesthetics.co and keeps the funnel dependency-free.
- **Worker holds all secrets and prompts.** The client sends `{image, designId}`;
  design prompts never leave the server, so nobody can run arbitrary generations
  on our Gemini key.
- **Render**: Gemini image edit (`gemini-2.5-flash-image`, ~₹3.4/render).
  ⚠️ Retires **2026-10-02** → switch to `gemini-3.1-flash-image-preview` (~₹6).
- **Booking**: GHL v2 — free-slots → contact upsert (E.164) → appointment.
  Unset GHL vars = graceful fallback to the booking widget link.
- **Caps**: 6 renders/session, daily global kill-switch (`DAILY_RENDER_CAP`).
  KV render logs are permanent (meta only, no TTL — intentional).

## Launch checklist

- [ ] **Validation afternoon** — 15–20 real hand photos × all designs through the
      live API. Cut any design that doesn't pass AK's eye. This is go/no-go.
- [ ] Set secrets: `GEMINI_API_KEY`, `GHL_API_KEY`
- [ ] Set vars: `GHL_LOCATION_ID`, `GHL_CALENDAR_ID`, `DAILY_RENDER_CAP`, `SESSION_RENDER_CAP`
- [ ] In `public/tryon.html` CONFIG: `WHATSAPP` (studio number), `MAPS_URL`
      (forced-waypoint link), `SETS_PAINTED` (real number, or leave null)
- [ ] **Confirm pricing** — DESIGN table shows ₹2,999 for art finishes and menu
      price for plain gels. If everything is flat ₹2,999 right now, fix the table
      BEFORE launch. A render that quotes less than the counter breaks the core promise.
- [ ] Deploy Worker + page, verify `/api/tryon/health`
- [ ] **Phase 1: in-chair** — tablet during free Nail Assessments, 2 weeks
- [ ] Shoot demo hands + proof sets (docs/SHOTLIST.md) using real clients from phase 1
- [ ] **Phase 2: public** — launch with the video as Meta creative

## The one metric

**Render → confirmed booking.** Not renders, not leads. Pixel funnel:
`ViewContent → CustomizeProduct → AddToCart (render) → InitiateCheckout → Schedule`.

## Principles that shouldn't be edited away

1. **What you render is what you get.** Every design must be executable by the
   team at exactly the price shown. Remove a design rather than fudge this.
2. **Her hand always leads.** The record shows the client's own photo, never a sample.
3. **No friction before the magic.** No contact fields before the render —
   details are captured at booking, where they're attached to money.
4. **Every render ends at a slot.** A render that dead-ends is a wasted rupee.
5. **Tunables live in config, not in code bodies** — see CONFIG block and Worker vars.
