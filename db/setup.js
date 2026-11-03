const { Client } = require('pg');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { createConfig } = require('../server/db/config');

const TABLES = ['order_items', 'inventory_events', 'reviews', 'orders', 'products', 'customers', 'categories', 'vendors'];
const sql = (name) => readFileSync(path.join(__dirname, name), 'utf8');
const identifier = (value) => '"' + value.replaceAll('"', '""') + '"';

function hasRuntimeMapping(rows, role, oid, type) {
  if (!Array.isArray(rows)) throw new Error('Unsupported Entra principal metadata');
  const principals = rows.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Unsupported Entra principal metadata');
    const principal = Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]));
    if (typeof principal.rolname !== 'string' || typeof principal.objectid !== 'string'
        || typeof principal.principaltype !== 'string' || ![0, 1].includes(principal.isadmin)) {
      throw new Error('Unsupported Entra principal metadata');
    }
    return principal;
  }).filter((row) => row.rolname === role);
  if (principals.length > 1) throw new Error('Duplicate Entra runtime principal metadata');
  if (!principals.length) return false;
  const mapped = principals[0];
  if (mapped.objectid.toLowerCase() !== oid.toLowerCase()
      || mapped.principaltype.toLowerCase() !== type || mapped.isadmin !== 0) {
    throw new Error('Existing Entra mapping differs; refusing to replace it');
  }
  return true;
}

async function bootstrap(client, reset) {
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(730031)');
    const exists = await client.query("SELECT to_regclass('public.shopstream_bootstrap') AS marker");
    if (!exists.rows[0].marker) {
      const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
      if (tables.rows.length) throw new Error('Bootstrap requires an empty dedicated database; existing tables were found');
      await client.query(sql('schema.sql'));
      await client.query('CREATE TABLE shopstream_bootstrap (version INTEGER PRIMARY KEY, seeded_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    }
    const marker = await client.query('SELECT version FROM shopstream_bootstrap');
    if (marker.rows.length && (marker.rows.length !== 1 || marker.rows[0].version !== 1)) {
      throw new Error('Unsupported bootstrap version');
    }
    if (marker.rows.length && !reset) {
      await client.query('COMMIT');
      console.log('Schema and seed version 1 already installed; no data changed');
      return;
    }
    if (reset) {
      if (process.env.SHOPSTREAM_CONFIRM_RESET !== process.env.PGDATABASE) {
        throw new Error('Set SHOPSTREAM_CONFIRM_RESET to the dedicated PGDATABASE name to confirm data replacement');
      }
      await client.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY`);
      await client.query('DELETE FROM shopstream_bootstrap');
    }
    await client.query(sql('seed.sql'));
    await client.query('INSERT INTO shopstream_bootstrap (version) VALUES (1)');
    await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await client.query('COMMIT');
    console.log('Installed schema and bounded seed version 1');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function grant(client, env = process.env) {
  const { RUNTIME_ROLE: role, RUNTIME_OBJECT_ID: oid, RUNTIME_OBJECT_TYPE: type = 'service' } = env;
  if (!role || role.length > 63 || !/^[a-z][a-z0-9_]*$/.test(role) || role === env.PGUSER) {
    throw new Error('RUNTIME_ROLE must be a separate lowercase SQL role (at most 63 characters)');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(oid || '') || !['user', 'service', 'group'].includes(type)) {
    throw new Error('RUNTIME_OBJECT_ID and RUNTIME_OBJECT_TYPE must identify the intended Entra principal');
  }
  const auth = new Client({ ...createConfig(env), database: 'postgres' });
  await auth.connect();
  try {
    const existing = await auth.query('SELECT * FROM pgaadauth_list_principals(FALSE)');
    if (!hasRuntimeMapping(existing.rows, role, oid, type)) {
      await auth.query('SELECT * FROM pgaadauth_create_principal_with_oid($1, $2, $3, FALSE, FALSE)', [role, oid, type]);
    }
  } finally { await auth.end(); }
  const name = identifier(role);
  const db = identifier(env.PGDATABASE);
  await client.query('BEGIN');
  try {
    const privileges = await client.query(`SELECT rolsuper, rolcreatedb, rolcreaterole,
      pg_has_role(oid, 'azure_pg_admin', 'MEMBER') AS is_admin
      FROM pg_roles WHERE rolname = $1`, [role]);
    if (!privileges.rows.length || Object.values(privileges.rows[0]).some(Boolean)) {
      throw new Error('Runtime role must not hold server-administrator privileges');
    }
    await client.query(`REVOKE ALL ON DATABASE ${db} FROM PUBLIC`);
    await client.query(`GRANT CONNECT ON DATABASE ${db} TO ${name}`);
    await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await client.query(`GRANT USAGE ON SCHEMA public TO ${name}`);
    await client.query(`GRANT SELECT ON ${TABLES.join(', ')} TO ${name}`);
    await client.query(`GRANT INSERT ON orders, order_items, reviews, inventory_events TO ${name}`);
    await client.query(`GRANT UPDATE (stock_qty, rating_avg, review_count, updated_at) ON products TO ${name}`);
    await client.query(`GRANT UPDATE (status, updated_at) ON orders TO ${name}`);
    await client.query(`GRANT DELETE ON reviews TO ${name}`);
    await client.query(`GRANT USAGE ON SEQUENCE orders_id_seq, order_items_id_seq, reviews_id_seq, inventory_events_id_seq TO ${name}`);
    await client.query('COMMIT');
    console.log('Mapped Entra runtime principal and granted only sample runtime operations');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function main() {
  const command = process.argv[2];
  if (!['bootstrap', 'reset', 'grant'].includes(command)) throw new Error('Use bootstrap, reset, or grant');
  if (process.env.ENTRA_CREDENTIAL !== 'azure-cli') throw new Error('Administrative setup requires ENTRA_CREDENTIAL=azure-cli');
  if (command === 'reset' && process.env.SHOPSTREAM_CONFIRM_RESET !== process.env.PGDATABASE) {
    throw new Error('Explicit reset confirmation is required');
  }
  const client = new Client({ ...createConfig(), statement_timeout: 60000, query_timeout: 65000 });
  await client.connect();
  try {
    if (command === 'grant') await grant(client);
    else await bootstrap(client, command === 'reset');
  } finally { await client.end(); }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Database setup failed:', err.code || err.name, err.code ? 'Check identity, grants, TLS, and network access' : err.message);
    process.exitCode = 1;
  });
}
module.exports = { bootstrap, grant, hasRuntimeMapping };
