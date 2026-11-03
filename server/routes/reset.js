const { Router } = require('express');
const router = Router();
router.post('/', (req, res) => {
  res.status(403).json({ error: 'Web reset is disabled. Use the privileged npm run db:reset command.' });
});
module.exports = router;
