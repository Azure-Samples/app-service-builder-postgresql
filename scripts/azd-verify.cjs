const { Client } = require('pg');
const { isIPv4 } = require('node:net');
const { createConfig } = require('../server/db/config');
const { hasRuntimeMapping } = require('../db/setup');
const { AzureCliCredential } = require('@azure/identity');
const { readFileSync } = require('node:fs');

const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validateArm(request, env) {
  const prefix = `/subscriptions/${env.AZURE_SUBSCRIPTION_ID}/resourceGroups/${env.AZURE_RESOURCE_GROUP}`;
  const deployments = `/subscriptions/${env.AZURE_SUBSCRIPTION_ID}/providers/Microsoft.Resources/deployments/`;
  if (!guid.test(env.AZURE_SUBSCRIPTION_ID || '') || !guid.test(env.AZURE_TENANT_ID || '')
      || !/^rg-shopstream-[a-z0-9-]+$/.test(env.AZURE_RESOURCE_GROUP || '')
      || !(request.id?.startsWith(`${prefix}/providers/`) || request.method === 'GET' && request.id?.startsWith(deployments))
      || /[?#%\\]|\.\./.test(request.id)
      || !/^[0-9-]+(?:-preview)?$/.test(request.version) || !['GET', 'PUT', 'PATCH'].includes(request.method)
      || Object.entries(request.headers || {}).some(([key, value]) => !['If-Match', 'If-None-Match'].includes(key) || typeof value !== 'string' || /[\r\n]/.test(value))) {
    throw new Error('ARM request must target the explicit owned group/read-only subscription deployment and supported method/headers');
  }
}
function validate(env) {
  const { createDemoWrites } = require('../server/middleware/demoWrites');
  for (const key of ['AZURE_SUBSCRIPTION_ID', 'AZURE_TENANT_ID', 'ADMIN_OBJECT_ID']) {
    if (!guid.test(env[key] || '')) throw new Error(`${key} must be a GUID`);
  }
  for (const key of ['AZURE_LOCATION', 'PG_LOCATION']) {
    if (!/^[a-z][a-z0-9]+$/.test(env[key] || '')) throw new Error(`${key} is required`);
  }
  if (!/^[a-z][a-z0-9-]{1,18}[a-z0-9]$/.test(env.AZURE_ENV_NAME || '')) throw new Error('AZURE_ENV_NAME must be 3-20 lowercase letters/digits/hyphens');
  if (!/^asb-pg-[a-z0-9-]{1,54}[a-z0-9]$/.test(env.PG_SERVER || '')) throw new Error('PG_SERVER must be a valid asb-pg-prefixed name');
  if (!env.ADMIN_NAME || /[\r\n]/.test(env.ADMIN_NAME) || !['User', 'Group'].includes(env.ADMIN_TYPE || 'User')) throw new Error('ADMIN_NAME/ADMIN_TYPE is invalid');
  const ids = (env.BUILDER_ALLOWED_OBJECT_IDS || '').split(',').sort();
  if (!ids.length || ids.some((id) => !guid.test(id)) || new Set(ids.map((id) => id.toLowerCase())).size !== ids.length) {
    throw new Error('BUILDER_ALLOWED_OBJECT_IDS must be nonempty unique comma-separated GUIDs');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY || '')
      || !/^[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9])?$/.test(env.GITHUB_REF_NAME || '')
      || env.GITHUB_REF_NAME.includes('..') || env.GITHUB_REF_NAME.includes('//')
      || !/^[0-9a-f]{40}$/i.test(env.GITHUB_SHA || '')
      || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(env.GITHUB_ACCOUNT || '')) throw new Error('Explicit GitHub account/repository/branch/full SHA required');
  if (env.BOOTSTRAP_IPV4 && (!isIPv4(env.BOOTSTRAP_IPV4) || env.BOOTSTRAP_IPV4 === '0.0.0.0')) throw new Error('BOOTSTRAP_IPV4 must be one nonzero IPv4');
  for (const key of ['SHOPSTREAM_ALLOW_AZURE_SERVICES', 'SHOPSTREAM_ENABLE_DEMO_WRITES']) {
    if (env[key] !== undefined && !['true', 'false'].includes(env[key])) throw new Error(`${key} must be true or false`);
  }
  if (env.PGDATABASE && env.PGDATABASE !== 'shopstream' || env.PGUSER && env.PGUSER !== 'shopstream_runtime') throw new Error('This fast path requires its dedicated shopstream database/runtime role');
  if (env.AZURE_CLIENT_ID) throw new Error('This fast path uses system identity, not AZURE_CLIENT_ID');
  if (env.DATABASE_URL || env.PGPASSWORD || env.PGSSLMODE || env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('Password and TLS override variables are forbidden');
  createDemoWrites(env);
  if (env.SHOPSTREAM_ENABLE_DEMO_WRITES === 'true'
      && !env.SHOPSTREAM_PUBLIC_ORIGIN?.startsWith('https://')) throw new Error('Opted-in hosted writes require canonical HTTPS SHOPSTREAM_PUBLIC_ORIGIN');
}

async function verify(client, env, auth = client) {
  const role = 'shopstream_runtime';
  const mapping = await auth.query('SELECT * FROM pgaadauth_list_principals(FALSE)');
  if (!hasRuntimeMapping(mapping.rows, role, env.RUNTIME_OBJECT_ID, 'service')) throw new Error('Runtime principal is not mapped');
  const marker = await client.query('SELECT version FROM shopstream_bootstrap');
  if (marker.rows.length !== 1 || marker.rows[0].version !== 1) throw new Error('Schema/seed version 1 is required');
  const result = await client.query(`SELECT rolsuper, rolcreatedb, rolcreaterole,
    pg_has_role(oid, 'azure_pg_admin', 'MEMBER') AS admin,
    has_database_privilege(oid, current_database(), 'CREATE') AS db_create,
    has_schema_privilege(oid, 'public', 'CREATE') AS schema_create,
    has_table_privilege(oid, 'products', 'DELETE') AS product_delete,
    has_table_privilege(oid, 'products', 'TRUNCATE') AS product_truncate,
    has_column_privilege(oid, 'products', 'price', 'UPDATE') AS price_update,
    (SELECT pg_get_userbyid(datdba) = $1 FROM pg_database WHERE datname=current_database()) AS db_owner,
    EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND tableowner=$1) AS table_owner,
    EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='public' AND pg_get_userbyid(nspowner)=$1) AS schema_owner
    FROM pg_roles WHERE rolname=$1`, [role]);
  if (result.rows.length !== 1 || Object.keys(result.rows[0]).length !== 12 || Object.values(result.rows[0]).some((value) => value !== false)) {
    throw new Error('Runtime has unexpected/unknown administrative or destructive privileges');
  }
  for (const [table, privilege] of [
    ...['vendors', 'categories', 'products', 'customers', 'orders', 'order_items', 'reviews', 'inventory_events'].map((name) => [name, 'SELECT']),
    ...['orders', 'order_items', 'reviews', 'inventory_events'].map((name) => [name, 'INSERT']),
    ['reviews', 'DELETE'],
  ]) {
    const granted = await client.query('SELECT has_table_privilege($1,$2,$3) AS granted', [role, table, privilege]);
    if (granted.rows[0]?.granted !== true) throw new Error('Required runtime table privilege is absent');
  }
  for (const [table, column] of [['products', 'stock_qty'], ['products', 'rating_avg'], ['products', 'review_count'], ['products', 'updated_at'], ['orders', 'status'], ['orders', 'updated_at']]) {
    const granted = await client.query('SELECT has_column_privilege($1,$2,$3,$4) AS granted', [role, table, column, 'UPDATE']);
    if (granted.rows[0]?.granted !== true) throw new Error('Required runtime column privilege is absent');
  }
  for (const sequence of ['orders_id_seq', 'order_items_id_seq', 'reviews_id_seq', 'inventory_events_id_seq']) {
    const granted = await client.query('SELECT has_sequence_privilege($1,$2,$3) AS granted', [role, sequence, 'USAGE']);
    if (granted.rows[0]?.granted !== true) throw new Error('Required runtime sequence privilege is absent');
  }
  for (const query of [
    "SELECT has_database_privilege($1,current_database(),'CONNECT') AS granted",
    "SELECT has_schema_privilege($1,'public','USAGE') AS granted",
  ]) {
    const granted = await client.query(query, [role]);
    if (granted.rows[0]?.granted !== true) throw new Error('Required runtime connection/schema privilege is absent');
  }
}

async function main() {
  if (process.argv[2] === 'inputs') return validate(process.env);
  if (process.argv[2] === 'arm') {
    const request = JSON.parse(readFileSync(process.argv[3], 'utf8'));
    validateArm(request, process.env);
    const credential = new AzureCliCredential({ subscription: process.env.AZURE_SUBSCRIPTION_ID, processTimeoutInMs: 10000 });
    const token = await credential.getToken('https://management.azure.com/.default', { abortSignal: AbortSignal.timeout(15000) });
    const tenant = JSON.parse(Buffer.from(token.token.split('.')[1], 'base64url').toString()).tid;
    if (tenant?.toLowerCase() !== process.env.AZURE_TENANT_ID.toLowerCase()) throw new Error('ARM credential tenant mismatch');
    const response = await fetch(`https://management.azure.com${request.id}?api-version=${request.version}`, {
      method: request.method, redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { ...request.headers, authorization: `Bearer ${token.token}`, 'content-type': 'application/json' },
      ...(request.body ? { body: JSON.stringify(request.body) } : {}),
    });
    const body = await response.json();
    console.log(JSON.stringify({ status: response.status, etag: response.headers.get('etag'), body }));
    return;
  }
  if (process.argv[2] !== 'sql' || process.env.ENTRA_CREDENTIAL !== 'azure-cli' || !guid.test(process.env.RUNTIME_OBJECT_ID || '')) {
    throw new Error('Use inputs or sql with explicit Entra administrator context/runtime OID');
  }
  const config = createConfig();
  const client = new Client(config);
  const auth = new Client({ ...config, database: 'postgres' });
  await client.connect();
  try { await auth.connect(); await verify(client, process.env, auth); }
  finally { await auth.end(); await client.end(); }
}
if (require.main === module) main().then(() => {
  if (process.argv[2] !== 'arm') console.log('Verified');
}).catch((error) => {
  console.error('azd prerequisite verification failed:', error.code || (error.constructor === Error ? error.message : error.name));
  process.exitCode = 1;
});
module.exports = { validate, validateArm, verify };
