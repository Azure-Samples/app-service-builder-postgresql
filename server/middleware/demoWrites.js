function demoWrites(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (process.env.SHOPSTREAM_ENABLE_DEMO_WRITES !== 'true') {
    return res.status(403).json({ error: 'Demo writes are disabled' });
  }
  if (req.get('origin')) {
    let origin;
    try { origin = new URL(req.get('origin')); } catch {
      return res.status(403).json({ error: 'Invalid request origin' });
    }
    if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.get('host')) {
      return res.status(403).json({ error: 'Cross-origin demo writes are not allowed' });
    }
  }
  next();
}

module.exports = { demoWrites };
