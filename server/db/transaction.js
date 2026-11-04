const pool = require('./pool');

async function transaction(action) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    // Serialize bounded demo mutations across all app replicas and administrative resets.
    await client.query('SELECT pg_advisory_xact_lock(730031)');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) {
      console.error('PostgreSQL rollback failed:', rollbackError.code || rollbackError.name);
    }
    throw err;
  } finally {
    client.release();
  }
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

module.exports = { transaction, httpError };
