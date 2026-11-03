const { Router } = require('express');
const { getCategories } = require('../db/queries');

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const result = await getCategories();
    res.json({ categories: result.rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
