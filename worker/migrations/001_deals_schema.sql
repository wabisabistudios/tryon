-- D1 schema for India Deal Finder
-- Products, prices, searches, and alerts

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  image TEXT,
  brand TEXT,
  model TEXT,
  category TEXT,
  specs_json TEXT,
  rating REAL,
  review_count INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_source ON products(source);
CREATE INDEX IF NOT EXISTS idx_products_model ON products(model);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_source_id ON products(source, source_id);

CREATE TABLE IF NOT EXISTS prices (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  price REAL,
  list_price REAL,
  currency TEXT,
  availability TEXT,
  seller TEXT,
  is_fulfilled INTEGER DEFAULT 0,
  scraped_at INTEGER NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_prices_product ON prices(product_id);
CREATE INDEX IF NOT EXISTS idx_prices_scraped ON prices(scraped_at);

CREATE TABLE IF NOT EXISTS searches (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  source TEXT NOT NULL,
  results_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_searches_query ON searches(query);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  query_or_product_id TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  threshold REAL,
  email TEXT,
  webhook TEXT,
  active INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alerts_target ON alerts(query_or_product_id);
