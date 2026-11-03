-- ShopStream Schema
-- Multi-Vendor E-Commerce Marketplace

CREATE TABLE IF NOT EXISTS vendors (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(200) NOT NULL,
  slug          VARCHAR(200) NOT NULL UNIQUE,
  email         VARCHAR(255) NOT NULL,
  description   TEXT,
  logo_url      VARCHAR(500),
  rating        NUMERIC(3,2) DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  slug          VARCHAR(100) NOT NULL UNIQUE,
  parent_id     INTEGER REFERENCES categories(id),
  icon          VARCHAR(10)
);

CREATE TABLE IF NOT EXISTS products (
  id                  SERIAL PRIMARY KEY,
  vendor_id           INTEGER NOT NULL REFERENCES vendors(id),
  category_id         INTEGER NOT NULL REFERENCES categories(id),
  name                VARCHAR(300) NOT NULL,
  slug                VARCHAR(300) NOT NULL,
  description         TEXT,
  price_cents         INTEGER NOT NULL,
  compare_price_cents INTEGER,
  sku                 VARCHAR(50),
  image_url           VARCHAR(500),
  stock_qty           INTEGER NOT NULL DEFAULT 0,
  is_active           BOOLEAN DEFAULT TRUE,
  rating_avg          NUMERIC(3,2) DEFAULT 0,
  review_count        INTEGER DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id            SERIAL PRIMARY KEY,
  first_name    VARCHAR(100) NOT NULL,
  last_name     VARCHAR(100) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL DEFAULT '',
  avatar_url    VARCHAR(500),
  city          VARCHAR(100),
  country       VARCHAR(100),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id                SERIAL PRIMARY KEY,
  customer_id       INTEGER NOT NULL REFERENCES customers(id),
  status            VARCHAR(30) NOT NULL DEFAULT 'pending',
  subtotal_cents    INTEGER NOT NULL DEFAULT 0,
  tax_cents         INTEGER NOT NULL DEFAULT 0,
  shipping_cents    INTEGER NOT NULL DEFAULT 0,
  total_cents       INTEGER NOT NULL DEFAULT 0,
  shipping_address  TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id              SERIAL PRIMARY KEY,
  order_id        INTEGER NOT NULL REFERENCES orders(id),
  product_id      INTEGER NOT NULL REFERENCES products(id),
  vendor_id       INTEGER NOT NULL REFERENCES vendors(id),
  quantity        INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL,
  total_cents     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id            SERIAL PRIMARY KEY,
  product_id    INTEGER NOT NULL REFERENCES products(id),
  customer_id   INTEGER NOT NULL REFERENCES customers(id),
  rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title         VARCHAR(200),
  body          TEXT,
  is_verified   BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_events (
  id              SERIAL PRIMARY KEY,
  product_id      INTEGER NOT NULL REFERENCES products(id),
  event_type      VARCHAR(30) NOT NULL,
  quantity_delta   INTEGER NOT NULL,
  reason          VARCHAR(200),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_products_vendor ON products(vendor_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_created ON products(created_at);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_customer ON reviews(customer_id);
CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory_events(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_created ON inventory_events(created_at);
