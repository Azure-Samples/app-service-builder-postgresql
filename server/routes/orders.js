const { Router } = require('express');
const { getOrders, getOrderById, getOrderItems } = require('../db/queries');
const { transaction, httpError } = require('../db/transaction');
const { positiveInteger, pagination, text } = require('../validation');

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { page, limit, offset } = pagination(req.query, 20);
    const status = text(req.query.status, 'status', 30);

    const [countQ, rows] = await getOrders(status, limit, offset);
    const total = parseInt(countQ.rows[0].count);

    res.json({ orders: rows.rows, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = positiveInteger(req.params.id, 'id');
    const order = await getOrderById(id);
    if (!order.rows.length) return res.status(404).json({ error: 'Order not found' });

    const items = await getOrderItems(id);
    res.json({ order: order.rows[0], items: items.rows });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { customer_id, items } = req.body;
    positiveInteger(customer_id, 'customer_id');
    if (!Array.isArray(items) || !items.length || items.length > 20) {
      throw httpError(400, 'items must contain between 1 and 20 products');
    }
    const quantities = new Map();
    for (const item of items) {
      if (!item || typeof item !== 'object') throw httpError(400, 'Invalid order item');
      const id = positiveInteger(item.product_id, 'product_id');
      const qty = positiveInteger(item.quantity ?? 1, 'quantity', 100);
      const combined = (quantities.get(id) || 0) + qty;
      if (combined > 100) throw httpError(400, 'Maximum quantity per product is 100');
      quantities.set(id, combined);
    }
    const result = await transaction(async (client) => {
      const counts = await client.query('SELECT (SELECT COUNT(*) FROM orders) AS orders, (SELECT COUNT(*) FROM inventory_events) AS events');
      if (Number(counts.rows[0].orders) >= 1000 || Number(counts.rows[0].events) + quantities.size > 5000) {
        throw httpError(409, 'Demo data limit reached; an administrator must reset the sample');
      }
      const customer = await client.query('SELECT id FROM customers WHERE id = $1', [customer_id]);
      if (!customer.rows.length) throw httpError(400, 'Customer not found');
      let subtotal = 0;
      const resolvedItems = [];
      for (const [productId, qty] of [...quantities].sort(([a], [b]) => a - b)) {
        const prod = await client.query(
          'SELECT id, vendor_id, price_cents, stock_qty FROM products WHERE id = $1 AND is_active = TRUE FOR UPDATE',
          [productId]
        );
        if (!prod.rows.length) {
          throw httpError(400, `Product ${productId} not found`);
        }
        const p = prod.rows[0];
        if (p.stock_qty < qty) {
          throw httpError(409, `Insufficient stock for product ${p.id}`);
        }
        const lineTot = p.price_cents * qty;
        subtotal += lineTot;
        if (subtotal > 1000000000) throw httpError(400, 'Order total exceeds the demo limit');
        resolvedItems.push({ product_id: p.id, vendor_id: p.vendor_id, quantity: qty, unit_price_cents: p.price_cents, total_cents: lineTot });
      }

      const tax = Math.round(subtotal * 0.08);
      const shipping = subtotal > 5000 ? 0 : 599;
      const total = subtotal + tax + shipping;

      const orderRes = await client.query(
        `INSERT INTO orders (customer_id, status, subtotal_cents, tax_cents, shipping_cents, total_cents, shipping_address)
         VALUES ($1, 'confirmed', $2, $3, $4, $5, '123 Demo Street, Anytown, US 12345') RETURNING *`,
        [customer_id, subtotal, tax, shipping, total]
      );
      const order = orderRes.rows[0];

      for (const item of resolvedItems) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, vendor_id, quantity, unit_price_cents, total_cents)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [order.id, item.product_id, item.vendor_id, item.quantity, item.unit_price_cents, item.total_cents]
        );
        await client.query('UPDATE products SET stock_qty = stock_qty - $1 WHERE id = $2', [item.quantity, item.product_id]);
        await client.query(
          `INSERT INTO inventory_events (product_id, event_type, quantity_delta, reason)
           VALUES ($1, 'sale', $2, $3)`,
          [item.product_id, -item.quantity, `Order #${order.id}`]
        );
      }

      return { order, items: resolvedItems };
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const id = positiveInteger(req.params.id, 'id');
    const { status } = req.body;
    const transitions = { pending: 'confirmed', confirmed: 'processing', processing: 'shipped', shipped: 'delivered' };
    const order = await transaction(async (client) => {
      const current = await client.query('SELECT status FROM orders WHERE id = $1 FOR UPDATE', [id]);
      if (!current.rows.length) throw httpError(404, 'Order not found');
      if (transitions[current.rows[0].status] !== status) {
        throw httpError(409, 'Order status must advance one fulfillment step');
      }
      return (await client.query('UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [status, id])).rows[0];
    });
    res.json({ order });
  } catch (err) { next(err); }
});

module.exports = router;
