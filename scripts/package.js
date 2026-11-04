const { cpSync, mkdirSync, realpathSync } = require('node:fs');
const path = require('node:path');

const destination = process.env.DESTINATION_DIR;
if (!destination || !path.isAbsolute(destination)) {
  throw new Error('DESTINATION_DIR must be an absolute Builder output directory');
}
mkdirSync(destination, { recursive: true });
if (realpathSync(destination) === realpathSync('.')) {
  throw new Error('DESTINATION_DIR must not be the source directory');
}
for (const name of ['server', 'dist', 'node_modules', 'package.json', 'package-lock.json']) {
  cpSync(name, path.join(destination, name), { recursive: true });
}
