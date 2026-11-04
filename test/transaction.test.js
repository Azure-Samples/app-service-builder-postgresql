const { test } = require('node:test');
const assert = require('node:assert/strict');

const poolPath = require.resolve('../server/db/pool');
let connect;
require.cache[poolPath] = { id: poolPath, filename: poolPath, loaded: true, exports: { connect: () => connect() } };
const { transaction } = require('../server/db/transaction');

test('transactions commit and release, or roll back and release on failure', async () => {
  const statements = [];
  let releases = 0;
  connect = async () => ({
    query: async (sql) => { statements.push(sql); },
    release: () => { releases++; },
  });
  assert.equal(await transaction(async () => 42), 42);
  assert.equal(statements.at(-1), 'COMMIT');
  assert.ok(statements.some((sql) => sql.includes('pg_advisory_xact_lock')));
  const failure = new Error('Mutation failed');
  await assert.rejects(transaction(async () => { throw failure; }), failure);
  assert.equal(statements.at(-1), 'ROLLBACK');
  assert.equal(releases, 2);
});

test('connection establishment failure is propagated without a transaction leak', async () => {
  connect = async () => { throw new Error('Connection unavailable'); };
  await assert.rejects(transaction(async () => 1), /Connection unavailable/);
});
