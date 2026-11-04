const { Router } = require('express');
const { getRevenue, getTopProducts } = require('../db/queries');
const { positiveInteger, text } = require('../validation');

const router = Router();

router.get('/revenue', async (req, res, next) => {
  try {
    const period = text(req.query.period, 'period', 10) || 'day';
    const trunc = ['day', 'week', 'month'].includes(period) ? period : 'day';
    const limit = positiveInteger(req.query.limit ?? 30, 'limit', 90);
    const result = await getRevenue(trunc, limit);
    res.json({ revenue: result.rows.reverse(), period: trunc });
  } catch (err) {
    next(err);
  }
});

router.get('/top-products', async (req, res, next) => {
  try {
    const limit = positiveInteger(req.query.limit ?? 10, 'limit', 50);
    const result = await getTopProducts(limit);
    res.json({ products: result.rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
