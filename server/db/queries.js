const pool = require('./pool');

// Dashboard
exports.getDashboardStats = () => Promise.all([
  pool.query('SELECT COALESCE(SUM(total_cents), 0) AS total FROM orders'),
  pool.query('SELECT COUNT(*) AS count FROM orders'),
  pool.query('SELECT COUNT(*) AS count FROM customers'),
  pool.query('SELECT COUNT(*) AS count FROM products WHERE is_active = TRUE'),
  pool.query(`
    SELECT v.id, v.name, v.slug, v.rating,
           COUNT(DISTINCT p.id) AS product_count,
           COALESCE(SUM(oi.total_cents), 0) AS revenue
    FROM vendors v
    LEFT JOIN products p ON p.vendor_id = v.id
    LEFT JOIN order_items oi ON oi.vendor_id = v.id
    GROUP BY v.id ORDER BY revenue DESC LIMIT 5
  `),
  pool.query(`
    SELECT o.id, o.status, o.total_cents, o.created_at,
           c.first_name, c.last_name,
           (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS item_count
    FROM orders o JOIN customers c ON c.id = o.customer_id
    ORDER BY o.created_at DESC LIMIT 10
  `),
  pool.query(`
    SELECT status, COUNT(*) AS count FROM orders GROUP BY status ORDER BY count DESC
  `),
]);

// Products
exports.getProducts = (conditions, params, sortColumn, order, limit, offset) => {
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const paramIdx = params.length + 1;
  return Promise.all([
    pool.query(`SELECT COUNT(*) FROM products p ${where}`, params),
    pool.query(`
      SELECT p.*, v.name AS vendor_name, v.slug AS vendor_slug,
             cat.name AS category_name, cat.icon AS category_icon
      FROM products p
      JOIN vendors v ON v.id = p.vendor_id
      JOIN categories cat ON cat.id = p.category_id
      ${where}
      ORDER BY ${sortColumn} ${order}
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `, [...params, limit, offset]),
  ]);
};

exports.getProductById = (id) => pool.query(`
  SELECT p.*, v.name AS vendor_name, v.slug AS vendor_slug,
         cat.name AS category_name, cat.icon AS category_icon
  FROM products p
  JOIN vendors v ON v.id = p.vendor_id
  JOIN categories cat ON cat.id = p.category_id
  WHERE p.id = $1
`, [id]);

exports.getProductReviews = (productId) => pool.query(`
  SELECT r.*, c.first_name, c.last_name
  FROM reviews r JOIN customers c ON c.id = r.customer_id
  WHERE r.product_id = $1 ORDER BY r.created_at DESC LIMIT 20
`, [productId]);

// Search
exports.searchProducts = (query, limit) => pool.query(`
  SELECT p.id, p.name, p.slug, p.price_cents, p.rating_avg, p.review_count,
         v.name AS vendor_name, cat.name AS category_name, cat.icon AS category_icon
  FROM products p
  JOIN vendors v ON v.id = p.vendor_id
  JOIN categories cat ON cat.id = p.category_id
  WHERE p.is_active = TRUE AND (p.name ILIKE $1 OR p.description ILIKE $1)
  ORDER BY p.rating_avg DESC, p.review_count DESC
  LIMIT $2
`, [`%${query}%`, limit]);

// Categories
exports.getCategories = () => pool.query('SELECT * FROM categories ORDER BY parent_id NULLS FIRST, name');

// Vendors
exports.getVendors = () => pool.query(`
  SELECT v.*, COUNT(p.id) AS product_count
  FROM vendors v LEFT JOIN products p ON p.vendor_id = v.id AND p.is_active = TRUE
  GROUP BY v.id ORDER BY v.name
`);

exports.getVendorById = (id) => pool.query('SELECT * FROM vendors WHERE id = $1', [id]);

exports.getVendorProducts = (vendorId) => pool.query(`
  SELECT p.*, cat.name AS category_name
  FROM products p JOIN categories cat ON cat.id = p.category_id
  WHERE p.vendor_id = $1 AND p.is_active = TRUE
  ORDER BY p.created_at DESC LIMIT 50
`, [vendorId]);

// Orders
exports.getOrders = (status, limit, offset) => {
  let where = '';
  const params = [];
  if (status) {
    where = 'WHERE o.status = $1';
    params.push(status);
  }
  const paramOff = params.length;
  return Promise.all([
    pool.query(`SELECT COUNT(*) FROM orders o ${where}`, params),
    pool.query(`
      SELECT o.*, c.first_name, c.last_name, c.email,
             (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS item_count
      FROM orders o JOIN customers c ON c.id = o.customer_id
      ${where}
      ORDER BY o.created_at DESC
      LIMIT $${paramOff + 1} OFFSET $${paramOff + 2}
    `, [...params, limit, offset]),
  ]);
};

exports.getOrderById = (id) => pool.query(`
  SELECT o.*, c.first_name, c.last_name, c.email
  FROM orders o JOIN customers c ON c.id = o.customer_id
  WHERE o.id = $1
`, [id]);

exports.getOrderItems = (orderId) => pool.query(`
  SELECT oi.*, p.name AS product_name, p.slug AS product_slug, v.name AS vendor_name
  FROM order_items oi
  JOIN products p ON p.id = oi.product_id
  JOIN vendors v ON v.id = oi.vendor_id
  WHERE oi.order_id = $1
`, [orderId]);

// Order creation (uses a client from pool for transactions)
exports.getPool = () => pool;

// Reviews
exports.createReview = (productId, customerId, rating, title, body, client = pool) => client.query(
  `INSERT INTO reviews (product_id, customer_id, rating, title, body, is_verified)
   VALUES ($1, $2, $3, $4, $5, FALSE) RETURNING *`,
  [productId, customerId, rating, title, body]
);

exports.updateProductRating = (productId, client = pool) => client.query(`
  UPDATE products SET
    rating_avg = COALESCE((SELECT ROUND(AVG(rating)::numeric, 2) FROM reviews WHERE product_id = $1), 0),
    review_count = (SELECT COUNT(*) FROM reviews WHERE product_id = $1),
    updated_at = NOW()
  WHERE id = $1
`, [productId]);

// Analytics
exports.getRevenue = (trunc, limit) => pool.query(`
  SELECT DATE_TRUNC($1, created_at) AS period,
         SUM(total_cents) AS revenue, COUNT(*) AS order_count
  FROM orders
  GROUP BY DATE_TRUNC($1, created_at)
  ORDER BY period DESC LIMIT $2
`, [trunc, limit]);

exports.getTopProducts = (limit) => pool.query(`
  SELECT p.id, p.name, p.price_cents, p.rating_avg,
         SUM(oi.quantity) AS total_sold, SUM(oi.total_cents) AS total_revenue,
         v.name AS vendor_name
  FROM order_items oi
  JOIN products p ON p.id = oi.product_id
  JOIN vendors v ON v.id = p.vendor_id
  GROUP BY p.id, p.name, p.price_cents, p.rating_avg, v.name
  ORDER BY total_revenue DESC LIMIT $1
`, [limit]);

// Health
exports.healthCheck = () => pool.query('SELECT NOW() AS time, current_database() AS db');
