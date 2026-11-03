const { Router } = require('express');
const { transaction, httpError } = require('../db/transaction');
const { positiveInteger, text } = require('../validation');
const { createReview, updateProductRating } = require('../db/queries');

const router = Router();

router.post('/', async (req, res, next) => {
  try {
    const productId = positiveInteger(req.body.product_id, 'product_id');
    const customerId = positiveInteger(req.body.customer_id, 'customer_id');
    const rating = positiveInteger(req.body.rating, 'rating', 5);
    const title = text(req.body.title, 'title', 200);
    const body = text(req.body.body, 'body', 2000);
    const review = await transaction(async (client) => {
      if (Number((await client.query('SELECT COUNT(*) FROM reviews')).rows[0].count) >= 1000) {
        throw httpError(409, 'Demo review limit reached; an administrator must reset the sample');
      }
      const product = await client.query('SELECT id FROM products WHERE id = $1 AND is_active = TRUE FOR UPDATE', [productId]);
      const customer = await client.query('SELECT id FROM customers WHERE id = $1', [customerId]);
      if (!product.rows.length || !customer.rows.length) throw httpError(400, 'Product or customer not found');
      const result = await createReview(productId, customerId, rating, title, body, client);
      await updateProductRating(productId, client);
      return result.rows[0];
    });
    res.status(201).json({ review });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = positiveInteger(req.params.id, 'id');
    await transaction(async (client) => {
      const review = await client.query('DELETE FROM reviews WHERE id = $1 RETURNING product_id', [id]);
      if (!review.rows.length) throw httpError(404, 'Review not found');
      await updateProductRating(review.rows[0].product_id, client);
    });
    res.json({ deleted: id });
  } catch (err) { next(err); }
});

module.exports = router;
