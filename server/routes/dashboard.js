const { Router } = require('express');
const { getDashboardStats } = require('../db/queries');

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const [revenue, orderCount, customerCount, productCount, topVendors, recentOrders, ordersByStatus] = await getDashboardStats();
    res.json({
      revenue_cents: parseInt(revenue.rows[0].total),
      order_count: parseInt(orderCount.rows[0].count),
      customer_count: parseInt(customerCount.rows[0].count),
      product_count: parseInt(productCount.rows[0].count),
      top_vendors: topVendors.rows,
      recent_orders: recentOrders.rows,
      orders_by_status: ordersByStatus.rows,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
