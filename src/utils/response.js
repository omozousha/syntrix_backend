function sendSuccess(res, data, message = 'Success', statusCode = 200, meta = undefined) {
  const payload = {
    success: true,
    message,
    data,
  };

  if (meta) {
    payload.meta = meta;
  }

  return res.status(statusCode).json(payload);
}

function sendError(res, message = 'Unexpected error', statusCode = 500, details = undefined) {
  const payload = {
    success: false,
    message,
  };

  if (details) {
    payload.details = details;
  }

  return res.status(statusCode).json(payload);
}

module.exports = { sendSuccess, sendError };
