const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { Pool } = require('pg');
const { createConfig } = require('../../server/db/config');

test('real PostgreSQL CRUD, atomic inventory and process-restart persistence', { timeout: 120000 }, async () => {
  if (!process.env.SHOPSTREAM_INTEGRATION_DB || process.env.SHOPSTREAM_INTEGRATION_DB !== process.env.PGDATABASE) {
    throw new Error('Set SHOPSTREAM_INTEGRATION_DB to the dedicated seeded PGDATABASE to explicitly confirm test writes');
  }
  const pool = new Pool(createConfig());
  const port = process.env.SHOPSTREAM_TEST_PORT || '8187';
  const origin = `http://127.0.0.1:${port}`;
  let server;
  const start = async () => {
    server = spawn(process.execPath, ['server/index.js'], {
      env: { ...process.env, HOST: '127.0.0.1', PORT: port, SHOPSTREAM_ENABLE_DEMO_WRITES: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    server.stdout.on('data', (data) => { output += data; });
    server.stderr.on('data', (data) => { output += data; });
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      if (server.exitCode !== null) throw new Error(`Server exited: ${output}`);
      try {
        const health = await fetch(origin + '/health');
        if (health.ok) return;
      } catch (err) {
        if (err.name !== 'TypeError') throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`Server readiness failed: ${output}`);
  };
  const stop = async () => {
    if (server && server.exitCode === null) {
      const exited = once(server, 'exit');
      server.kill('SIGTERM');
      await exited;
    }
  };
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(origin + path, {
      method, headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  let reviewId;
  try {
    await start();
    assert.equal((await request('/api/products?limit=-1')).status, 400);
    assert.equal((await request('/api/reset', 'POST', {})).status, 403);
    assert.equal((await request('/api/orders', 'POST', { customer_id: 1, items: [] })).status, 400);
    const product = (await request('/api/products?limit=1')).body.products[0];
    const original = (await pool.query('SELECT stock_qty FROM products WHERE id=$1', [product.id])).rows[0].stock_qty;
    const order = await request('/api/orders', 'POST', {
      customer_id: 1, items: [{ product_id: product.id, quantity: 1 }, { product_id: product.id, quantity: 1 }],
    });
    assert.equal(order.status, 201);
    assert.equal(order.body.items.length, 1);
    assert.equal(order.body.items[0].quantity, 2);
    const orderId = order.body.order.id;
    assert.equal((await pool.query('SELECT stock_qty FROM products WHERE id=$1', [product.id])).rows[0].stock_qty, original - 2);
    assert.equal(Number((await pool.query('SELECT COUNT(*) FROM inventory_events WHERE reason=$1', [`Order #${orderId}`])).rows[0].count), 1);
    assert.equal((await request(`/api/orders/${orderId}`, 'PATCH', { status: 'processing' })).status, 200);
    assert.equal((await request(`/api/orders/${orderId}`, 'PATCH', { status: 'delivered' })).status, 409);
    const review = await request('/api/reviews', 'POST', { product_id: product.id, customer_id: 1, rating: 5, title: 'Integration review' });
    assert.equal(review.status, 201);
    reviewId = review.body.review.id;
    assert.equal((await request(`/api/products/${product.id}`)).body.reviews.some((row) => row.id === reviewId), true);
    assert.equal((await request(`/api/reviews/${reviewId}`, 'DELETE')).status, 200);
    reviewId = undefined;
    const after = await request(`/api/products/${product.id}`);
    const count = (await pool.query('SELECT COUNT(*) FROM reviews WHERE product_id=$1', [product.id])).rows[0].count;
    assert.equal(after.body.product.review_count, Number(count));
    await stop();
    await start();
    assert.equal((await request(`/api/orders/${orderId}`)).body.order.status, 'processing');
    assert.equal((await pool.query('SELECT stock_qty FROM products WHERE id=$1', [product.id])).rows[0].stock_qty, original - 2);
    for (const statement of ['CREATE TABLE forbidden (id int)', 'TRUNCATE orders']) {
      await assert.rejects(pool.query(statement), (err) => err.code === '42501');
    }
  } finally {
    try {
      if (reviewId && server?.exitCode === null) {
        const response = await request(`/api/reviews/${reviewId}`, 'DELETE');
        assert.equal(response.status, 200);
      }
    } finally {
      await stop();
      await pool.end();
    }
  }
});
