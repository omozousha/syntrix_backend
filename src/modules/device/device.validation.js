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

function validateDevicePayload(payload, mode = 'create') {
  const requiredFields = ['device_name', 'asset_group', 'device_type_key', 'region_id'];

  if (mode === 'create') {
    for (const field of requiredFields) {
      if (!payload[field]) {
        throw createHttpError(400, `Field ${field} is required`);
      }
    }
  }

  if (payload.asset_group && !['active', 'passive'].includes(payload.asset_group)) {
    throw createHttpError(400, 'asset_group must be either active or passive');
  }

  if (payload.capacity_core != null && payload.used_core != null && Number(payload.used_core) > Number(payload.capacity_core)) {
    throw createHttpError(400, 'used_core cannot be greater than capacity_core');
  }

  if (payload.total_ports != null && payload.used_ports != null && Number(payload.used_ports) > Number(payload.total_ports)) {
    throw createHttpError(400, 'used_ports cannot be greater than total_ports');
  }

  if (payload.validation_status != null && !VALIDATION_STATUS_VALUES.includes(payload.validation_status)) {
    throw createHttpError(400, `validation_status must be one of: ${VALIDATION_STATUS_VALUES.join(', ')}`);
  }

  ensureValidDate(payload.validation_date, 'validation_date');
}

module.exports = { validateDevicePayload };
