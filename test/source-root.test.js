const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const path = require('node:path');

test('Builder compute root is separate from Vite frontend evidence', () => {
  const root = require('../package.json');
  const client = require('../client/package.json');
  for (const section of ['dependencies', 'devDependencies']) {
    assert.equal(root[section]?.vite, undefined);
    assert.equal(root[section]?.['@vitejs/plugin-react'], undefined);
    assert.equal(root[section]?.react, undefined);
  }
  for (const name of ['vite.config.js', 'vite.config.mjs', 'vite.config.ts']) {
    assert.equal(existsSync(path.join(__dirname, '..', name)), false);
  }
  assert.ok(client.devDependencies.vite);
  assert.ok(client.dependencies.react);
  assert.equal(root.scripts.build, 'npm ci --prefix client && npm run build --prefix client');
  assert.equal(client.scripts.build, 'vite build');
  assert.equal(root.engines.node, '24.x');
});
