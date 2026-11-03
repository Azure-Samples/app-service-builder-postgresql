-- ShopStream Seed Data (Internal Mode)
-- ~2,000 rows for quick demo

-- Vendors (10)
INSERT INTO vendors (name, slug, email, description, logo_url, rating) VALUES
  ('TechNova', 'technova', 'hello@technova.io', 'Premium consumer electronics and accessories', NULL, 4.7),
  ('Urban Threads', 'urban-threads', 'info@urbanthreads.co', 'Streetwear and contemporary fashion', NULL, 4.5),
  ('HomeHaven', 'homehaven', 'support@homehaven.com', 'Modern furniture and home decor', NULL, 4.6),
  ('FitForge', 'fitforge', 'team@fitforge.io', 'Performance fitness equipment and gear', NULL, 4.4),
  ('PureGlow', 'pureglow', 'care@pureglow.com', 'Clean beauty and skincare essentials', NULL, 4.8),
  ('PageBound', 'pagebound', 'hello@pagebound.co', 'Curated books, stationery, and desk accessories', NULL, 4.3),
  ('ByteGear', 'bytegear', 'sales@bytegear.io', 'Developer tools, peripherals, and workspace gear', NULL, 4.6),
  ('GreenRoot', 'greenroot', 'hello@greenroot.co', 'Sustainable living products and eco-friendly goods', NULL, 4.5),
  ('LittleLeap', 'littleleap', 'hi@littleleap.com', 'Educational toys and kids development products', NULL, 4.2),
  ('TrailEdge', 'trailedge', 'adventure@trailedge.io', 'Outdoor adventure and camping equipment', NULL, 4.4)
ON CONFLICT DO NOTHING;

-- Categories (15)
INSERT INTO categories (name, slug, parent_id, icon) VALUES
  ('Electronics', 'electronics', NULL, '🔌'),
  ('Clothing', 'clothing', NULL, '👕'),
  ('Home & Garden', 'home-garden', NULL, '🏠'),
  ('Sports & Fitness', 'sports-fitness', NULL, '🏋️'),
  ('Beauty', 'beauty', NULL, '✨'),
  ('Books & Office', 'books-office', NULL, '📚'),
  ('Phones & Tablets', 'phones-tablets', 1, '📱'),
  ('Laptops & PCs', 'laptops-pcs', 1, '💻'),
  ('Audio', 'audio', 1, '🎧'),
  ('Men''s Fashion', 'mens-fashion', 2, '👔'),
  ('Women''s Fashion', 'womens-fashion', 2, '👗'),
  ('Furniture', 'furniture', 3, '🛋️'),
  ('Kitchen', 'kitchen', 3, '🍳'),
  ('Outdoor Gear', 'outdoor-gear', 4, '⛺'),
  ('Skincare', 'skincare', 5, '🧴')
ON CONFLICT DO NOTHING;

-- Products (500) via generate_series
INSERT INTO products (vendor_id, category_id, name, slug, description, price_cents, compare_price_cents, sku, stock_qty, is_active, rating_avg, review_count, created_at)
SELECT
  (i % 10) + 1 AS vendor_id,
  (i % 15) + 1 AS category_id,
  (ARRAY[
    'Pro', 'Ultra', 'Elite', 'Essential', 'Classic', 'Nano', 'Max', 'Lite', 'Prime', 'Core',
    'Studio', 'Edge', 'Flex', 'Swift', 'Zen', 'Bold', 'Pure', 'Apex', 'Nova', 'Spark'
  ])[(i % 20) + 1] || ' ' ||
  (ARRAY[
    'Wireless Headphones', 'Running Shoes', 'Desk Lamp', 'Backpack', 'Water Bottle',
    'Phone Case', 'Yoga Mat', 'Coffee Maker', 'Notebook', 'Sunglasses',
    'Keyboard', 'T-Shirt', 'Face Cream', 'Camping Tent', 'Wall Art',
    'Smart Watch', 'Sneakers', 'Throw Pillow', 'Resistance Bands', 'Lip Balm',
    'Monitor Stand', 'Hoodie', 'Candle Set', 'Dumbbell Set', 'Serum',
    'USB-C Hub', 'Jacket', 'Plant Pot', 'Jump Rope', 'Tote Bag',
    'Webcam', 'Joggers', 'Bookshelf', 'Foam Roller', 'Moisturizer',
    'Power Bank', 'Beanie', 'Table Runner', 'Kettlebell', 'Cleanser',
    'Desk Mat', 'Polo Shirt', 'Door Mat', 'Ab Wheel', 'Hair Oil',
    'Charger Cable', 'Scarf', 'Mirror', 'Pull-Up Bar', 'Eye Cream'
  ])[(i % 50) + 1] AS name,
  'product-' || i AS slug,
  'High-quality product crafted with care. Perfect for everyday use.' AS description,
  (1000 + (i * 137) % 15000) AS price_cents,
  CASE WHEN i % 3 = 0 THEN (1500 + (i * 137) % 20000) ELSE NULL END AS compare_price_cents,
  'SKU-' || LPAD(i::text, 6, '0') AS sku,
  (5 + (i * 7) % 200) AS stock_qty,
  TRUE AS is_active,
  (30 + (i * 13) % 20)::numeric / 10 AS rating_avg,
  (i * 3) % 50 AS review_count,
  NOW() - ((i % 365) || ' days')::interval
FROM generate_series(1, 500) AS s(i)
ON CONFLICT DO NOTHING;

-- Customers (200)
INSERT INTO customers (first_name, last_name, email, city, country, created_at)
SELECT
  (ARRAY['James','Emma','Liam','Olivia','Noah','Ava','Ethan','Sophia','Mason','Isabella',
         'Lucas','Mia','Logan','Charlotte','Alex','Amelia','Jack','Harper','Owen','Ella'])[(i % 20) + 1],
  (ARRAY['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Wilson','Anderson',
         'Taylor','Thomas','Moore','Martin','Lee','Clark','Lewis','Walker','Hall','Young'])[(i % 20) + 1],
  'customer' || i || '@example.com',
  (ARRAY['New York','Los Angeles','Chicago','Houston','Phoenix','San Diego','Dallas','Austin',
         'Seattle','Denver','Portland','Miami','Atlanta','Boston','Nashville','Detroit',
         'Minneapolis','San Francisco','Philadelphia','Charlotte'])[(i % 20) + 1],
  'US',
  NOW() - ((i % 300) || ' days')::interval
FROM generate_series(1, 200) AS s(i)
ON CONFLICT DO NOTHING;

-- Orders (300)
INSERT INTO orders (customer_id, status, subtotal_cents, tax_cents, shipping_cents, total_cents, shipping_address, created_at)
SELECT
  (i % 200) + 1 AS customer_id,
  (ARRAY['pending','confirmed','processing','shipped','delivered','delivered','delivered','delivered'])[(i % 8) + 1] AS status,
  sub AS subtotal_cents,
  (sub * 8 / 100) AS tax_cents,
  CASE WHEN sub > 5000 THEN 0 ELSE 599 END AS shipping_cents,
  sub + (sub * 8 / 100) + CASE WHEN sub > 5000 THEN 0 ELSE 599 END AS total_cents,
  '123 Main St, Anytown, US 12345' AS shipping_address,
  NOW() - ((i % 90) || ' days')::interval
FROM (
  SELECT i, (2000 + (i * 173) % 30000) AS sub
  FROM generate_series(1, 300) AS s(i)
) t
ON CONFLICT DO NOTHING;

-- Order Items (~1000)
INSERT INTO order_items (order_id, product_id, vendor_id, quantity, unit_price_cents, total_cents)
SELECT
  ((i - 1) / 3) + 1 AS order_id,
  (i % 500) + 1 AS product_id,
  ((i % 500) % 10) + 1 AS vendor_id,
  1 + (i % 3) AS quantity,
  price AS unit_price_cents,
  price * (1 + (i % 3)) AS total_cents
FROM (
  SELECT i, (1000 + (i * 137) % 15000) AS price
  FROM generate_series(1, 900) AS s(i)
) t
WHERE ((i - 1) / 3) + 1 <= 300
ON CONFLICT DO NOTHING;

-- Reviews (400)
INSERT INTO reviews (product_id, customer_id, rating, title, body, is_verified, created_at)
SELECT
  (i % 500) + 1 AS product_id,
  (i % 200) + 1 AS customer_id,
  (3 + (i % 3)) AS rating,
  (ARRAY[
    'Love it!', 'Great value', 'Exceeded expectations', 'Solid purchase', 'Would buy again',
    'Pretty good', 'Decent quality', 'Nice product', 'Impressive', 'Highly recommend',
    'Good but pricey', 'Perfect gift', 'Better than expected', 'Five stars', 'Very happy',
    'Works great', 'Top notch', 'Fantastic quality', 'Just okay', 'Worth every penny'
  ])[(i % 20) + 1] AS title,
  (ARRAY[
    'This product has been amazing for daily use. The quality is outstanding and it arrived quickly.',
    'Really impressed with the build quality. Exactly what I needed for my home office.',
    'Great value for the price. I have been using it for a few weeks now and it holds up well.',
    'The design is sleek and modern. Gets compliments every time someone sees it.',
    'Purchased as a gift and the recipient loved it. Would definitely buy again.',
    'Solid product overall. Minor issues with packaging but the item itself is perfect.',
    'Compared several options before buying this one. No regrets at all.',
    'Fast shipping and the product matched the description exactly. Very satisfied.',
    'This is my second purchase from this vendor. Consistent quality every time.',
    'Good product for the price range. Does exactly what it claims to do.'
  ])[(i % 10) + 1] AS body,
  (i % 3 = 0) AS is_verified,
  NOW() - ((i % 120) || ' days')::interval
FROM generate_series(1, 400) AS s(i)
ON CONFLICT DO NOTHING;

-- Inventory Events (~200)
INSERT INTO inventory_events (product_id, event_type, quantity_delta, reason, created_at)
SELECT
  (i % 500) + 1 AS product_id,
  (ARRAY['restock','sale','return','adjustment'])[(i % 4) + 1] AS event_type,
  CASE (i % 4)
    WHEN 0 THEN 50 + (i % 100)
    WHEN 1 THEN -(1 + (i % 5))
    WHEN 2 THEN (1 + (i % 3))
    ELSE (i % 20) - 10
  END AS quantity_delta,
  (ARRAY['Supplier shipment received','Customer purchase','Customer return - defective','Cycle count adjustment',
         'Warehouse transfer','Bulk order fulfilled','Quality inspection removal','Promotional restock'])[(i % 8) + 1] AS reason,
  NOW() - ((i % 60) || ' days')::interval
FROM generate_series(1, 200) AS s(i)
ON CONFLICT DO NOTHING;
