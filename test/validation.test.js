const { test } = require('node:test');
const assert = require('node:assert/strict');
const { positiveInteger, pagination, text } = require('../server/validation');
const { demoWrites, createDemoWrites } = require('../server/middleware/demoWrites');

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
      demoWrites({ method, protocol: 'http', get: (name) => name === 'host' ? 'localhost:8186' : origin },
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

function checkOrigin(middleware, origin, { host = 'internal-routing.example', protocol = 'http', forwardedHost } = {}) {
  let status;
  let continued = false;
  const headers = { host, origin, 'x-forwarded-host': forwardedHost };
  middleware({ method: 'POST', protocol, get: name => headers[name] },
    { status(value) { status = value; return this; }, json() {} },
    () => { continued = true; });
  return { status, continued };
}

test('configured public origin permits the exact hosted origin despite an internal routing host', () => {
  const middleware = createDemoWrites({
    SHOPSTREAM_ENABLE_DEMO_WRITES: 'true', SHOPSTREAM_PUBLIC_ORIGIN: 'https://shopstream.example:8443',
  });
  assert.equal(checkOrigin(middleware, 'https://shopstream.example:8443').continued, true);
  for (const origin of ['http://shopstream.example:8443', 'https://shopstream.example',
    'https://shopstream.example:8444', 'https://attacker.example', 'null', 'not-a-url',
    'https://user@shopstream.example:8443', 'https://shopstream.example:8443/path']) {
    assert.equal(checkOrigin(middleware, origin, { forwardedHost: 'shopstream.example:8443' }).status, 403);
  }
});

test('forwarded headers never authorize writes and local direct-host scheme and port are preserved', () => {
  const middleware = createDemoWrites({ SHOPSTREAM_ENABLE_DEMO_WRITES: 'true' });
  const local = { host: 'localhost:8186' };
  assert.equal(checkOrigin(middleware, 'http://localhost:8186', local).continued, true);
  assert.equal(checkOrigin(middleware, undefined, local).continued, true);
  for (const origin of ['https://localhost:8186', 'http://localhost:8187', 'https://attacker.example']) {
    assert.equal(checkOrigin(middleware, origin, { ...local, forwardedHost: new URL(origin).host }).status, 403);
  }
});

test('invalid configured public origins fail explicitly before serving requests', () => {
  for (const value of ['', null, true, 'not-a-url', 'null', 'http://public.example', 'https://*.example',
    'https://example.com/', 'https://example.com/path', 'https://example.com?query=1',
    'https://example.com#fragment', 'https://user:password@example.com']) {
    assert.throws(() => createDemoWrites({ SHOPSTREAM_PUBLIC_ORIGIN: value }), /SHOPSTREAM_PUBLIC_ORIGIN/);
  }
  for (const value of ['https://example.com', 'https://example.com:8443',
    'http://localhost:8186', 'http://127.0.0.1:8186', 'http://[::1]:8186']) {
    assert.doesNotThrow(() => createDemoWrites({ SHOPSTREAM_PUBLIC_ORIGIN: value }));
  }
});

test('a configured public origin never enables writes without the separate demo opt-in', () => {
  const middleware = createDemoWrites({ SHOPSTREAM_PUBLIC_ORIGIN: 'https://shopstream.example' });
  assert.equal(checkOrigin(middleware, 'https://shopstream.example').status, 403);
});
