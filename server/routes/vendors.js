const { Router } = require('express');
const { getVendors, getVendorById, getVendorProducts } = require('../db/queries');
const { positiveInteger } = require('../validation');

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const result = await getVendors();
    res.json({ vendors: result.rows });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = positiveInteger(req.params.id, 'id');
    const vendor = await getVendorById(id);
    if (!vendor.rows.length) return res.status(404).json({ error: 'Vendor not found' });

    const products = await getVendorProducts(id);
    res.json({ vendor: vendor.rows[0], products: products.rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
