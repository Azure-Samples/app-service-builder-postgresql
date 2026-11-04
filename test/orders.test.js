const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const poolPath = require.resolve('../server/db/pool');
let counts = { orders: '0', events: '0' };
let failConnect = false;
let statements = [];
let releases = 0;
const pool = {
  async connect() {
    if (failConnect) throw Object.assign(new Error('Should not expose secret details'), { code: 'AUTH_FAILED' });
    return {
      async query(sql) {
        statements.push(sql);
        if (sql.includes('COUNT(*) FROM orders')) return { rows: [counts] };
        if (sql.startsWith('SELECT id FROM customers')) return { rows: [{ id: 1 }] };
        if (sql.startsWith('SELECT id, vendor_id')) return { rows: [{ id: 1, vendor_id: 1, price_cents: 100, stock_qty: 0 }] };
        return { rows: [] };
      },
      release() { releases++; },
    };
  },
};
require.cache[poolPath] = { id: poolPath, filename: poolPath, loaded: true, exports: pool };
const router = require('../server/routes/orders');
const errorHandler = require('../server/middleware/errorHandler');

test('order validation never opens a transaction; capacity, stock and auth failures roll back safely', async () => {
  const app = express();
  app.use(express.json());
  app.use('/orders', router);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = async (body) => {
    const response = await fetch(origin + '/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    for (const quantity of [-1, 0, 1.5, '2oops', 101]) {
      assert.equal((await post({ customer_id: 1, items: [{ product_id: 1, quantity }] })).status, 400);
    }
    assert.equal(statements.length, 0);
    const body = { customer_id: 1, items: [{ product_id: 1, quantity: 1 }] };
    for (const value of [{ orders: '1000', events: '0' }, { orders: '0', events: '5000' }]) {
      counts = value;
      assert.equal((await post(body)).status, 409);
      assert.equal(statements.at(-1), 'ROLLBACK');
    }
    counts = { orders: '0', events: '0' };
    assert.equal((await post(body)).status, 409);
    assert.equal(statements.at(-1), 'ROLLBACK');
    assert.equal(releases, 3);
    failConnect = true;
    const failure = await post(body);
    assert.equal(failure.status, 503);
    assert.equal(JSON.stringify(failure.body).includes('secret details'), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
