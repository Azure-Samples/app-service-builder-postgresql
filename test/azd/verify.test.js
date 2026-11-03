const test = require('node:test');
const assert = require('node:assert/strict');
const { validate, validateArm, verify } = require('../../scripts/azd-verify.cjs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createServer } = require('node:http');
const { resolve } = require('node:path');
const oid = '33333333-3333-4333-8333-333333333333';
const env = {
  AZURE_SUBSCRIPTION_ID: '11111111-1111-4111-8111-111111111111',
  AZURE_TENANT_ID: '22222222-2222-4222-8222-222222222222',
  ADMIN_OBJECT_ID: oid, AZURE_ENV_NAME: 'offline', AZURE_LOCATION: 'eastus2', PG_LOCATION: 'westus2',
  PG_SERVER: 'asb-pg-offline', ADMIN_NAME: 'setup-admin', GITHUB_REPOSITORY: 'owner/fork',
  GITHUB_REF_NAME: 'main', GITHUB_SHA: 'a'.repeat(40), GITHUB_ACCOUNT: 'owner',
  BUILDER_ALLOWED_OBJECT_IDS: oid,
};
test('default inputs retain read-only/no-Azure-exception opt-in and accept explicit source identity', () => {
  assert.doesNotThrow(() => validate(env));
  assert.doesNotThrow(() => validate({ ...env, SHOPSTREAM_ALLOW_AZURE_SERVICES: 'true' }));
});
test('reject invalid target, unsafe source, broad IP, credential/TLS and identity overrides', () => {
  for (const values of [
    { AZURE_SUBSCRIPTION_ID: '' }, { AZURE_TENANT_ID: '' }, { ADMIN_OBJECT_ID: 'runtime' },
    { AZURE_ENV_NAME: '../other' }, { PG_SERVER: 'other' }, { ADMIN_TYPE: 'ServicePrincipal' },
    { BUILDER_ALLOWED_OBJECT_IDS: '' }, { BUILDER_ALLOWED_OBJECT_IDS: `${oid},${oid}` },
    { GITHUB_REPOSITORY: 'owner/fork;secret' }, { GITHUB_REF_NAME: 'feature/../main' },
    { GITHUB_SHA: 'main' }, { GITHUB_ACCOUNT: '' }, { BOOTSTRAP_IPV4: '0.0.0.0' },
    { BOOTSTRAP_IPV4: '192.0.2.0/24' }, { SHOPSTREAM_ALLOW_AZURE_SERVICES: 'TRUE' },
    { PGUSER: 'administrator' }, { PGDATABASE: 'production' }, { AZURE_CLIENT_ID: oid },
    { DATABASE_URL: 'forbidden' }, { PGPASSWORD: 'forbidden' }, { PGSSLMODE: 'disable' },
    { NODE_TLS_REJECT_UNAUTHORIZED: '0' }, { SHOPSTREAM_ENABLE_DEMO_WRITES: 'true' },
    { SHOPSTREAM_PUBLIC_ORIGIN: 'https://example.test/' },
    { SHOPSTREAM_PUBLIC_ORIGIN: 'https://*.example.test' },
  ]) assert.throws(() => validate({ ...env, ...values }));
  assert.doesNotThrow(() => validate({ ...env, SHOPSTREAM_ENABLE_DEMO_WRITES: 'true', SHOPSTREAM_PUBLIC_ORIGIN: 'https://example.test' }));
});
test('ARM helper confines targets, disallows foreign writes/redirect tricks and never accepts credential headers', () => {
  const context = { ...env, AZURE_RESOURCE_GROUP: 'rg-shopstream-offline' };
  const id = `/subscriptions/${env.AZURE_SUBSCRIPTION_ID}/resourceGroups/rg-shopstream-offline/providers/Microsoft.Web/builderApps/asb-offline`;
  const request = { id, version: '2026-09-01-preview', method: 'PATCH' };
  assert.doesNotThrow(() => validateArm(request, context));
  const deployment = `/subscriptions/${env.AZURE_SUBSCRIPTION_ID}/providers/Microsoft.Resources/deployments/offline`;
  assert.doesNotThrow(() => validateArm({ ...request, id: deployment, method: 'GET' }, context));
  for (const change of [{ id: `${id}/../other` }, { id: `${id}%2Fother` }, { id: `${id}?other=1` },
    { id: 'https://other.invalid/' }, { id: deployment }, { method: 'DELETE' },
    { id: id.replace('rg-shopstream-offline', 'shared') }, { headers: { Host: 'other.invalid' } },
    { headers: { authorization: 'forbidden' } }, { headers: { 'If-Match': 'bad\r\nvalue' } }]) {
    assert.throws(() => validateArm({ ...request, ...change }, context));
  }
});
test('real PowerShell anonymous health probe reports redirects without following or authenticating', async () => {
  let requests = 0;
  const server = createServer((request, response) => {
    requests++;
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers.cookie, undefined);
    response.writeHead(302, { location: '/must-not-follow', 'set-cookie': 'fixture=not-reused' });
    response.end();
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  try {
    const script = resolve(__dirname, '../../scripts/azd.ps1').replaceAll("'", "''");
    const url = `http://127.0.0.1:${server.address().port}/health`;
    const { stdout } = await promisify(execFile)('pwsh', ['-NoLogo', '-NoProfile', '-Command',
      `. '${script}' -Library; Get-HealthStatus '${url}'`], { timeout: 15000 });
    assert.equal(stdout.trim(), '302');
    assert.equal(requests, 1);
  } finally { await new Promise((done) => server.close(done)); }
});
const columns = ['rolsuper', 'rolcreatedb', 'rolcreaterole', 'admin', 'db_create', 'schema_create',
  'product_delete', 'product_truncate', 'price_update', 'db_owner', 'table_owner', 'schema_owner'];
function fixture(options = {}) {
  const seen = [];
  return {
    seen,
    async query(sql) {
      seen.push(sql);
      assert.match(sql, /^SELECT/i, 'verification must be read-only');
      if (sql.includes('pgaadauth_list')) return { rows: [{ rolname: 'shopstream_runtime', objectid: options.oid || oid, principaltype: 'service', isadmin: options.admin ?? 0 }] };
      if (sql.includes('shopstream_bootstrap')) return { rows: [{ version: options.version ?? 1 }] };
      if (sql.includes('FROM pg_roles')) return { rows: [options.shape || Object.fromEntries(columns.map((key) => [key, options.bad === key ? true : false]))] };
      return { rows: [{ granted: options.granted ?? true }] };
    },
  };
}
test('read-only SQL verification checks exact mapping, schema, admin/ownership, positive privileges and sequences', async () => {
  const client = fixture();
  await verify(client, { RUNTIME_OBJECT_ID: oid });
  assert.ok(client.seen.some((sql) => sql.includes('has_sequence_privilege')));
  assert.ok(client.seen.some((sql) => sql.includes('has_database_privilege')));
});
test('read-only SQL verifier rejects existing-role mismatch, admin and unknown metadata/grants', async () => {
  for (const options of [{ oid: env.AZURE_TENANT_ID }, { admin: 1 }, { admin: false }, { version: 2 },
    { bad: 'rolsuper' }, { bad: 'table_owner' }, { bad: 'db_owner' }, { shape: {} }, { granted: false }, { granted: 'true' }]) {
    await assert.rejects(() => verify(fixture(options), { RUNTIME_OBJECT_ID: oid }));
  }
});
