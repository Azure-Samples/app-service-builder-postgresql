const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createConfig, SCOPE } = require('../server/db/config');

const env = { PGHOST: 'sample.postgres.database.azure.com', PGDATABASE: 'shopstream', PGUSER: 'shopstream_runtime' };

test('Entra token callback obtains a token at each new connection establishment', async () => {
  let calls = 0;
  const config = createConfig(env, {
    async getToken(scope, options) {
      assert.equal(scope, SCOPE);
      assert.ok(options.abortSignal);
      return { token: `token-${++calls}`, expiresOnTimestamp: Date.now() + 3600000 };
    },
  });
  assert.equal(await config.password(), 'token-1');
  assert.equal(await config.password(), 'token-2');
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  assert.equal(config.max, 5);
  assert.equal(config.connectionTimeoutMillis, 15000);
  assert.equal(config.maxLifetimeSeconds, 1800);
});

test('invalid, missing, and expired credentials/configuration fail explicitly', async () => {
  for (const key of ['PGHOST', 'PGDATABASE', 'PGUSER']) {
    assert.throws(() => createConfig({ ...env, [key]: '' }), new RegExp(key));
  }
  for (const overrides of [
    { DATABASE_URL: 'postgres://example' }, { PGPASSWORD: 'not-a-real-secret' },
    { PGSSLMODE: 'disable' }, { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    { ENTRA_CREDENTIAL: 'password' }, { PGPORT: 'NaN' }, { PGPORT: '0' },
    { ENTRA_CREDENTIAL: 'azure-cli' },
  ]) assert.throws(() => createConfig({ ...env, ...overrides }));
  for (const token of [null, { token: '' }, { token: 'missing-expiry' }, { token: 'expired', expiresOnTimestamp: Date.now() - 1 }]) {
    await assert.rejects(createConfig(env, { getToken: async () => token }).password(), /usable/);
  }
  const failure = new Error('Credential unavailable');
  await assert.rejects(createConfig(env, { getToken: async () => { throw failure; } }).password(), failure);
});

test('local credential pins the subscription and rejects mismatched token tenant selection', async () => {
  const tenant = '00000000-0000-0000-0000-000000000001';
  const local = { ...env, ENTRA_CREDENTIAL: 'azure-cli', AZURE_TENANT_ID: tenant, AZURE_SUBSCRIPTION_ID: 'test-subscription' };
  const jwt = (tid) => `header.${Buffer.from(JSON.stringify({ tid })).toString('base64url')}.signature`;
  const credential = (tid) => ({ getToken: async () => ({ token: jwt(tid), expiresOnTimestamp: Date.now() + 3600000 }) });
  assert.equal(await createConfig(local, credential(tenant)).password(), jwt(tenant));
  await assert.rejects(createConfig(local, credential('different-tenant')).password(), /tenant does not match/);
  await assert.rejects(createConfig(local, { getToken: async () => ({ token: 'invalid', expiresOnTimestamp: Date.now() + 3600000 }) }).password(), /tenant metadata/);
});
