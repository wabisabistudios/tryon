# DealHawk — India E-commerce Deal Finder

A self-hosted deal finder built on the existing Cloudflare Worker. It scrapes Amazon India and Flipkart, stores price history in D1, scores listings for genuine discounts, and surfaces them in a dark dashboard UI.

## Local development

```bash
# 1. Start the Worker (with local D1 + KV)
cd worker
npx wrangler d1 migrations apply deals-db --local
npx wrangler dev --local

# 2. In another terminal, serve the frontend
cd ..
npx serve public -p 3000
# open http://localhost:3000/deals.html
```

## Endpoints

- `GET /api/deals/search?q=monitor&limit=20` — search and score deals
- `GET /api/deals/best?limit=20` — best deals from recent scrapes
- `GET /api/deals/item/:id` — product detail + price history

## Architecture

```
Frontend (public/deals.html)
  ↓
Cloudflare Worker /deals/*
  ↓
Source adapters: Amazon IN, Flipkart, demo fallback
  ↓
D1 (products, prices, searches, alerts) + KV (cache, robots.txt)
  ↓
Scoring engine: anomaly detection, fake-discount check, cross-site match, confidence
```

## Important: real scraping from serverless Workers

Amazon and Flipkart aggressively block requests from cloud/serverless IP ranges. In local/dev tests you will usually see `HTTP 503` or timeouts. The tool automatically falls back to demo data so the scoring UI remains usable.

To enable real scraping in production you need either:

1. A residential/rotating proxy (e.g., ScrapingBee, Bright Data, Oxylabs) — costs money, but you control the data.
2. A small VPS or home server with browser-like headers and IP reputation.
3. Browser-extension/user-side scraping (not implemented here).

Because the tool is self-hosted and source-agnostic, you can plug in a proxy later without changing the scoring or UI layers.

## Deployment

1. Create a D1 database: `npx wrangler d1 create deals-db`
2. Create a KV namespace: `npx wrangler kv namespace create DEALS`
3. Replace the placeholder IDs in `worker/wrangler.toml`.
4. Apply migrations: `npx wrangler d1 migrations apply deals-db`
5. Deploy: `npx wrangler deploy`

## Next steps

- Add Flipkart and OLX scrapers once a proxy path is decided.
- Scheduled scraping via Workers cron triggers.
- Alert subscriptions (email/webhook) for anomaly thresholds.
