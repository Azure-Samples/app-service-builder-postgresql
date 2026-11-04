// Lightweight request logger -> stdout.
// Embr's runtime log stream tails the app process stdout, so emitting one line
// per request gives the Logs viewer continuous activity to render.
// Health-check pings are skipped to avoid flooding the stream.
function requestLogger(req, res, next) {
  if (req.path === '/health') return next();

  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const ts = new Date().toISOString();
    // Single-line, easy to scan in the Logs viewer.
    console.log(
      `${ts} ${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs.toFixed(1)}ms`
    );
  });
  next();
}

module.exports = requestLogger;
