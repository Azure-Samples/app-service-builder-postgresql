const { Router } = require('express');
const { getProducts, getProductById, getProductReviews, searchProducts } = require('../db/queries');
const { positiveInteger, pagination, text } = require('../validation');

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { page, limit, offset } = pagination(req.query, 24);
    const search = text(req.query.search, 'search', 200);
    const category = req.query.category || '';
    const sort = text(req.query.sort, 'sort', 30) || 'created_at';
    const order = req.query.order === 'asc' ? 'ASC' : 'DESC';

    const conditions = ['p.is_active = TRUE'];
    const params = [];
    let paramIdx = 1;

    if (search) {
      conditions.push(`(p.name ILIKE $${paramIdx} OR p.description ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }
    if (category) {
      conditions.push(`p.category_id = $${paramIdx}`);
      params.push(positiveInteger(category, 'category'));
      paramIdx++;
    }

    const sortColumns = {
      price: 'p.price_cents', rating: 'p.rating_avg', name: 'p.name',
      newest: 'p.created_at', created_at: 'p.created_at',
    };
    const sortColumn = Object.hasOwn(sortColumns, sort) ? sortColumns[sort] : 'p.created_at';

    const [countQ, rows] = await getProducts(conditions, params, sortColumn, order, limit, offset);
    const total = parseInt(countQ.rows[0].count);

    res.json({ products: rows.rows, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
});

router.get('/search', async (req, res, next) => {
  try {
    const q = text(req.query.q, 'q', 200);
    if (!q) return res.json({ results: [] });
    const limit = positiveInteger(req.query.limit ?? 20, 'limit', 50);
    const result = await searchProducts(q, limit);
    res.json({ results: result.rows, query: q });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = positiveInteger(req.params.id, 'id');
    const product = await getProductById(id);
    if (!product.rows.length) return res.status(404).json({ error: 'Product not found' });

    const reviews = await getProductReviews(id);
    res.json({ product: product.rows[0], reviews: reviews.rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
