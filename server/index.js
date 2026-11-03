const express = require('express');
const path = require('path');
const errorHandler = require('./middleware/errorHandler');
const requestLogger = require('./middleware/requestLogger');
const { demoWrites } = require('./middleware/demoWrites');
const pool = require('./db/pool');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use(requestLogger);
app.use('/api', demoWrites);
app.get('/api/config', (req, res) => {
  res.json({ demoWritesEnabled: process.env.SHOPSTREAM_ENABLE_DEMO_WRITES === 'true' });
});

// API routes
app.use('/', require('./routes/health'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/products', require('./routes/products'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/vendors', require('./routes/vendors'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/reviews', require('./routes/reviews'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/reset', require('./routes/reset'));
app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found' }));

// Serve static build output (for production / local preview)
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get('*', (req, res, next) => {
  // Only serve index.html for non-API, non-file requests (SPA fallback)
  if (req.path.startsWith('/api') || req.path === '/health') return next();
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err) next();
  });
});

app.use(errorHandler);

// Crash visibility: surface uncaught errors on stdout/stderr so they show up in the Logs viewer.
process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err.code || err.name);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason?.code || reason?.name || 'unknown');
  process.exit(1);
});

const PORT = process.env.PORT || 8080;
const server = app.listen(PORT, process.env.HOST || '0.0.0.0', () => {
  console.log(`ShopStream running on port ${PORT}`);
  console.log('PostgreSQL Entra authentication configured; /health verifies connectivity');
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    const timer = setTimeout(() => process.exit(1), 15000);
    timer.unref();
    server.close(async () => {
      await pool.end();
      clearTimeout(timer);
    });
  });
}
