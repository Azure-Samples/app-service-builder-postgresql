const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hasRuntimeMapping } = require('../db/setup');

const role = 'shopstream_runtime';
const oid = '11111111-2222-4333-8444-555555555555';
const principal = { rolname: role, objectId: oid, principalType: 'service', isAdmin: 0 };

test('existing runtime mapping is reused on repeated grants with actual Azure result fields', () => {
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.equal(hasRuntimeMapping([principal], role, oid, 'service'), true);
  }
  assert.equal(hasRuntimeMapping([], role, oid, 'service'), false);
});

test('existing runtime mapping rejects administrator privileges and identity changes', () => {
  for (const change of [{ isAdmin: 1 }, { objectId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }, { principalType: 'user' }]) {
    assert.throws(() => hasRuntimeMapping([{ ...principal, ...change }], role, oid, 'service'), /mapping differs/);
  }
});

test('runtime mapping refuses unknown field shapes and coercive administrator flags', () => {
  for (const isAdmin of [false, true, '0', '1', null, undefined]) {
    assert.throws(() => hasRuntimeMapping([{ ...principal, isAdmin }], role, oid, 'service'), /Unsupported/);
  }
  assert.throws(() => hasRuntimeMapping([{ ...principal, rolname: undefined, rolename: role }], role, oid, 'service'), /Unsupported/);
  assert.throws(() => hasRuntimeMapping([null], role, oid, 'service'), /Unsupported/);
});

test('runtime mapping refuses duplicate principal records', () => {
  assert.throws(() => hasRuntimeMapping([principal, principal], role, oid, 'service'), /Duplicate/);
});
