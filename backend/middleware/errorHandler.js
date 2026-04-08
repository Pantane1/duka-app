'use strict';

/**
 * Central error-handling middleware.
 * Must be registered LAST in Express (after all routes).
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status  = err.status || err.statusCode || 500;
  const message = err.expose || status < 500
    ? err.message
    : 'Internal server error';

  if (status >= 500) {
    console.error('[ERROR]', err);
  }

  res.status(status).json({ success: false, error: message });
}

/**
 * 404 handler – register before errorHandler.
 */
function notFound(req, res, next) {
  const err    = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  err.status   = 404;
  err.expose   = true;
  next(err);
}

module.exports = { errorHandler, notFound };
