function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 503;
  console.error('Request failed:', req.method, req.path, err.code || err.name);
  res.status(status).json({
    error: err.type === 'entity.parse.failed' ? 'Request body must be valid JSON'
      : status < 500 ? err.message : 'Database operation unavailable; check server logs, identity, grants, and network access',
  });
}

module.exports = errorHandler;
