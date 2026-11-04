const { Pool } = require('pg');
const { createConfig } = require('./config');

const pool = new Pool(createConfig());
pool.on('error', (err) => {
  console.error('Idle PostgreSQL connection failed:', err.code || err.name);
});

module.exports = pool;
