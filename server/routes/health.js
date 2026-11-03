const { Router } = require('express');
const { healthCheck } = require('../db/queries');

const router = Router();

router.get('/health', async (req, res) => {
  try {
    const result = await healthCheck();
    res.json({ status: 'healthy', ...result.rows[0] });
  } catch (err) {
    console.error('PostgreSQL health failed:', err.code || err.name);
    res.status(503).json({ status: 'unhealthy', error: 'PostgreSQL is unavailable; check identity, grants, TLS, and network access' });
  }
});

module.exports = router;
