function createHttpError(statusCode, message, details = undefined) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

module.exports = { createHttpError };
