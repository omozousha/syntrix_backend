const { createHttpError } = require('../../utils/httpError');

function validatePopPayload(payload, mode = 'create') {
  if (mode === 'create') {
    if (!payload.pop_name) {
      throw createHttpError(400, 'Field pop_name is required');
    }

    if (!payload.region_id) {
      throw createHttpError(400, 'Field region_id is required');
    }

    if (!payload.pop_code) {
      throw createHttpError(400, 'Field pop_code is required');
    }
  }

  if (payload.pop_code != null) {
    const popCode = String(payload.pop_code).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(popCode)) {
      throw createHttpError(400, 'pop_code must be exactly 3 letters (A-Z)');
    }
    payload.pop_code = popCode;
  }
}

module.exports = { validatePopPayload };
