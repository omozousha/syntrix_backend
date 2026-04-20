const { createHttpError } = require('../../utils/httpError');

const VALIDATION_STATUS_VALUES = ['unvalidated', 'valid', 'warning', 'invalid'];

function ensureValidDate(value, fieldName) {
  if (value == null || value === '') {
    return;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw createHttpError(400, `Field ${fieldName} must be a valid date`);
  }
}

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

  if (payload.validation_status != null && !VALIDATION_STATUS_VALUES.includes(payload.validation_status)) {
    throw createHttpError(400, `validation_status must be one of: ${VALIDATION_STATUS_VALUES.join(', ')}`);
  }

  ensureValidDate(payload.validation_date, 'validation_date');
}

module.exports = { validatePopPayload };
