# Based Aesthetics — Try-On · Deploy Notes

## What this is
- `tryon.html` — client page. Flow: capture protocol → design rack (12 house designs) → render → **fitting record** (price + book weld + share card) → 6-render cap pushing to the free Nail Assessment.
- `worker.js` — Cloudflare Worker. Design prompts live server-side; Gemini image-edit call; session cap; daily budget kill-switch; permanent render log in KV (meta only, **no TTL** — deliberately).

## 1. Validation test FIRST (one afternoon, ~₹1–2k)
Before deploying anything public:
1. Collect 15–20 hand photos across skin tones / lighting (client photos with consent, or team hands).
2. `wrangler dev` the Worker locally, hit it from `tryon.html` served with any static server.
3. Run every photo × every design. Judge with AK's eye: "would a client book from this render?"
4. Kill any design that fails. Chrome and cat-eye are the likely casualties — if they look plastic, ship v1 without the Chrome group. The rack degrades gracefully.
5. If 2.5-flash-image quality disappoints, set `MODEL = "gemini-3.1-flash-image-preview"` and re-run (~₹6/render). 2.5 retires 2026-10-02 regardless, so if 3.1 passes, start there.

## 2. Worker deploy
```toml
# wrangler.toml
name = "based-tryon"
main = "worker.js"
compatibility_date = "2026-07-01"
routes = [{ pattern = "basedaesthetics.co/api/tryon*", zone_name = "basedaesthetics.co" }]

[[kv_namespaces]]
binding = "TRYON"
id = "<create: wrangler kv namespace create TRYON>"

[vars]
DAILY_RENDER_CAP = "400"     # global kill-switch ≈ ₹1,600–2,400/day worst case
SESSION_RENDER_CAP = "6"
```
```bash
wrangler kv namespace create TRYON
wrangler secret put GEMINI_API_KEY
wrangler deploy
curl https://basedaesthetics.co/api/tryon/health
```
Route order: `based-nail-scanner` owns `/api/*`. Either register `/api/tryon*` on this Worker (more specific patterns win), or mount these handlers inside the scanner Worker if routing fights you — the handler is self-contained.

## 3. Page deploy
- Drop `tryon.html` into the Pages direct-upload bundle as `/tryon`.
- Fill `CONFIG.BOOK_LINKS` with the per-service GHL calendar deep-links already wired on the site (map: gel polish designs → gel calendar, art designs → art calendar, etc.). Until filled, everything falls back to the free-assessment widget — acceptable for in-chair week one, NOT for public launch. The weld is the point.
- Pixel events wired: `ViewContent` (load) → `CustomizeProduct` (design tap) → `AddToCart` (successful render) → `InitiateCheckout` (book tap). Funnel = those four numbers plus GHL bookings.

## 4. Launch order (locked earlier)
1. **In-chair, week 1–2**: tablet during free Nail Assessments. Perfect light, staff fluency, immediate conversions. `/tryon` can stay unlinked from nav during this phase.
2. **Public** only after in-chair render→booking proves the close. Announce with the share card, not an ad.

## 5. Watch-outs
- **Dark-mode**: guarded with `only light` (meta + CSS, incl. dark-media override). Keep it when editing.
- **KV**: render logs are meta-only (~150 bytes) with no TTL. Counters expire in 48h. Don't add a TTL to logs — the scanner's 180-day TTL lesson.
- **Cost control**: `DAILY_RENDER_CAP` is the hard brake. Watch `tryon:daily:*` keys the first week.
- **Ops honesty**: every design in the Worker table must be executable at the listed price. Removing a design = delete its entry; the rack updates itself.
- **v2 backlog** (only after the conversion number is real): inspo upload (Pinterest screenshot → render), shape/length change, per-finger design mix, recovery-forecast variant for pack sales.

---
# v3 additions (conversion build)

## New Worker endpoints
- `GET /api/tryon/slots` — next open slots from the GHL calendar (7-day window, Asia/Kolkata). Returns `{fallback:true}` until GHL vars are set → page shows the widget button instead. Zero-risk to deploy before wiring.
- `POST /api/tryon/book` — contact upsert (E.164, tags: `tryon`, designId, source `tryon`) + appointment create. Same GHL v2 chain as the consent Worker; mirror its `Version` header value if it differs from 2021-04-15.

## New vars/secrets
```
wrangler secret put GHL_API_KEY
# wrangler.toml [vars]: GHL_LOCATION_ID, GHL_CALENDAR_ID  (use the nail-art service calendar)
```

## Campaign
- `campaign:true` designs show ₹2,999 (art/chrome/ombré/glitter/detailed); plain gels keep menu price so the offer never inflates anything. Edit in the Worker's DESIGN table only.

## Assets (see SHOTLIST.md)
- Hero demo hand: `assets/tryon/hero-*.jpg` — page falls back to labelled placeholders until these exist.
- Proof strips: `assets/tryon/proof/<designId>-N.jpg` — auto-hidden until present.

## Funnel events (updated)
ViewContent → CustomizeProduct → AddToCart (render) → InitiateCheckout (slot tap / book tap) → **Schedule (inline booking confirmed)**. Render→Schedule is THE conversion number.

## GHL follow-up workflow (build in GHL, not code)
Tag `tryon` triggers: WhatsApp confirmation w/ record reference → 24h reminder → no-show → "your record is still valid" re-book nudge. The tag + design tag give you per-design conversion reporting inside GHL for free.
