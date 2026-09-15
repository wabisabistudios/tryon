/**
 * D1 persistence layer for deal finder.
 */

export function productId(source, sourceId) {
  return `${source}:${sourceId}`;
}

export async function upsertProduct(db, product) {
  const now = Date.now();
  const id = productId(product.source, product.source_id);
  await db.prepare(
    `INSERT INTO products (id, source, source_id, title, url, image, brand, model, category, specs_json, rating, review_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       url = excluded.url,
       image = excluded.image,
       brand = excluded.brand,
       model = excluded.model,
       category = excluded.category,
       specs_json = excluded.specs_json,
       rating = excluded.rating,
       review_count = excluded.review_count,
       updated_at = excluded.updated_at`
  )
    .bind(
      id,
      product.source,
      product.source_id,
      product.title,
      product.url,
      product.image || null,
      product.brand || null,
      product.model || null,
      product.category || null,
      product.specs_json || null,
      product.rating || null,
      product.review_count || null,
      now,
      now
    )
    .run();
  return id;
}

export async function insertPrice(db, productId, priceRecord) {
  await db.prepare(
    `INSERT INTO prices (id, product_id, price, list_price, currency, availability, seller, is_fulfilled, scraped_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      `${productId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      productId,
      priceRecord.price,
      priceRecord.list_price || null,
      priceRecord.currency || "INR",
      priceRecord.availability || "unknown",
      priceRecord.seller || null,
      priceRecord.is_fulfilled ? 1 : 0,
      Date.now()
    )
    .run();
}

export async function getPriceHistory(db, productId, sinceMs = 30 * 86400000) {
  const since = Date.now() - sinceMs;
  const res = await db.prepare(
    `SELECT price, scraped_at FROM prices WHERE product_id = ? AND scraped_at > ? ORDER BY scraped_at ASC`
  )
    .bind(productId, since)
    .all();
  return res.results ? res.results.map((r) => r.price).filter(Boolean) : [];
}

export async function logSearch(db, query, source, count) {
  const id = `${source}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  await db.prepare(
    `INSERT INTO searches (id, query, source, results_count, created_at) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(id, query, source, count, Date.now())
    .run();
  return id;
}

export async function getProduct(db, id) {
  const res = await db.prepare(`SELECT * FROM products WHERE id = ?`).bind(id).first();
  return res || null;
}

export async function getLatestPrice(db, productId) {
  const res = await db.prepare(
    `SELECT * FROM prices WHERE product_id = ? ORDER BY scraped_at DESC LIMIT 1`
  )
    .bind(productId)
    .first();
  return res || null;
}

export async function listRecentPrices(db, productIds) {
  if (!productIds || productIds.length === 0) return [];
  const placeholders = productIds.map(() => "?").join(",");
  const res = await db.prepare(
    `SELECT p.* FROM prices p
     INNER JOIN (
       SELECT product_id, MAX(scraped_at) as max_ts FROM prices WHERE product_id IN (${placeholders}) GROUP BY product_id
     ) latest ON p.product_id = latest.product_id AND p.scraped_at = latest.max_ts`
  )
    .bind(...productIds)
    .all();
  return res.results || [];
}
