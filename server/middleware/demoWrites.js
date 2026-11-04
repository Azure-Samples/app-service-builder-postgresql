function publicOrigin(value) {
  if (value === undefined) return null;
  const invalid = () => new Error('SHOPSTREAM_PUBLIC_ORIGIN must be a canonical HTTPS origin without a path, credentials, query, fragment, or wildcard (HTTP is allowed only for loopback development)');
  if (typeof value !== 'string') throw invalid();
  let url;
  try { url = new URL(value); } catch { throw invalid(); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.origin !== value || url.hostname.includes('*') ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback))) {
    throw invalid();
  }
  return url.origin;
}

function createDemoWrites(env = process.env) {
  const configuredOrigin = publicOrigin(env.SHOPSTREAM_PUBLIC_ORIGIN);
  return function demoWrites(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (env.SHOPSTREAM_ENABLE_DEMO_WRITES !== 'true') {
      return res.status(403).json({ error: 'Demo writes are disabled' });
    }
    const header = req.get('origin');
    if (header !== undefined) {
      let origin;
      let expected;
      try {
        origin = new URL(header);
        expected = configuredOrigin || new URL(`${req.protocol}://${req.get('host')}`).origin;
      } catch {
        return res.status(403).json({ error: 'Invalid request origin' });
      }
      if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== header || origin.origin !== expected) {
        return res.status(403).json({ error: 'Cross-origin demo writes are not allowed' });
      }
    }
    next();
  };
}

module.exports = { demoWrites: createDemoWrites(), createDemoWrites };
