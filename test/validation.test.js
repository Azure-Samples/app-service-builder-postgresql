const { test } = require('node:test');
const assert = require('node:assert/strict');
const { positiveInteger, pagination, text } = require('../server/validation');
const { demoWrites } = require('../server/middleware/demoWrites');

test('pagination, IDs, quantities and strings are strictly bounded', () => {
  assert.deepEqual(pagination({}, 24), { page: 1, limit: 24, offset: 0 });
  assert.deepEqual(pagination({ page: '2', limit: '10' }, 24), { page: 2, limit: 10, offset: 10 });
  for (const value of [-1, 0, 1.5, '1oops', [], {}, null, '9007199254740993']) {
    assert.throws(() => positiveInteger(value, 'id'), { status: 400 });
  }
  assert.throws(() => pagination({ limit: 101 }, 24), { status: 400 });
  assert.throws(() => text('a'.repeat(201), 'title', 200), { status: 400 });
});

test('demo writes default off, reads allowed, and foreign origins rejected', () => {
  const original = process.env.SHOPSTREAM_ENABLE_DEMO_WRITES;
  try {
    const call = (method, origin) => {
      let status;
      let continued = false;
      demoWrites({ method, get: (name) => name === 'host' ? 'localhost:8186' : origin },
        { status(value) { status = value; return this; }, json() {} },
        () => { continued = true; });
      return { status, continued };
    };
    delete process.env.SHOPSTREAM_ENABLE_DEMO_WRITES;
    assert.equal(call('GET').continued, true);
    assert.equal(call('POST').status, 403);
    process.env.SHOPSTREAM_ENABLE_DEMO_WRITES = 'true';
    assert.equal(call('POST', 'http://localhost:8186').continued, true);
    assert.equal(call('POST').continued, true);
    assert.equal(call('POST', 'https://attacker.example').status, 403);
    assert.equal(call('POST', 'not-a-url').status, 403);
  } finally {
    if (original === undefined) delete process.env.SHOPSTREAM_ENABLE_DEMO_WRITES;
    else process.env.SHOPSTREAM_ENABLE_DEMO_WRITES = original;
  }
});
