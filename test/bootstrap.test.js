const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bootstrap } = require('../db/setup');

test('bootstrap reruns do not duplicate seed data or change transactions', async () => {
  const statements = [];
  await bootstrap({
    async query(statement) {
      statements.push(statement);
      if (statement.includes('to_regclass')) return { rows: [{ marker: 'shopstream_bootstrap' }] };
      if (statement === 'SELECT version FROM shopstream_bootstrap') return { rows: [{ version: 1 }] };
      return { rows: [] };
    },
  }, false);
  assert.equal(statements.at(-1), 'COMMIT');
  assert.equal(statements.some((sql) => /TRUNCATE|INSERT/.test(sql)), false);
});

test('bootstrap refuses to merge seed into an existing non-sample database', async () => {
  const statements = [];
  await assert.rejects(bootstrap({
    async query(statement) {
      statements.push(statement);
      if (statement.includes('to_regclass')) return { rows: [{ marker: null }] };
      if (statement.includes('pg_tables')) return { rows: [{ tablename: 'unrelated' }] };
      return { rows: [] };
    },
  }, false), /empty dedicated database/);
  assert.equal(statements.at(-1), 'ROLLBACK');
});

test('bootstrap and reset refuse unknown schema versions before changing data', async () => {
  for (const reset of [false, true]) {
    const statements = [];
    await assert.rejects(bootstrap({
      async query(statement) {
        statements.push(statement);
        if (statement.includes('to_regclass')) return { rows: [{ marker: 'shopstream_bootstrap' }] };
        if (statement === 'SELECT version FROM shopstream_bootstrap') return { rows: [{ version: 2 }] };
        return { rows: [] };
      },
    }, reset), /Unsupported bootstrap version/);
    assert.equal(statements.at(-1), 'ROLLBACK');
    assert.equal(statements.some((sql) => /TRUNCATE|INSERT|DELETE/.test(sql)), false);
  }
});
