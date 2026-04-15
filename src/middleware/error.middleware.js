const { sendError } = require('../utils/response');

function notFoundHandler(req, res) {
  return sendError(res, `Route not found: ${req.method} ${req.originalUrl}`, 404);
}

function errorHandler(error, _req, res, _next) {
  const statusCode = error.statusCode || 500;
  const message = error.message || 'Internal server error';

  if (statusCode >= 500) {
    console.error(error);
  }

  return sendError(
    res,
    message,
    statusCode,
    process.env.NODE_ENV === 'development' ? error.details || error.stack : undefined,
  );
}

module.exports = { notFoundHandler, errorHandler };
