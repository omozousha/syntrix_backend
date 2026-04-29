const { createHttpError } = require('../../utils/httpError');

const VALIDATION_STATUS_VALUES = ['unvalidated', 'valid', 'warning', 'invalid'];
const DEVICE_TYPE_CORE_REQUIRED = new Set(['OTB', 'ODC', 'JC', 'CABLE']);
const DEVICE_TYPE_PORT_REQUIRED = new Set(['OLT', 'SWITCH', 'ROUTER', 'ONT', 'ODP']);
const DEVICE_TYPE_CORE_AND_PORT_REQUIRED = new Set();

function ensureValidDate(value, fieldName) {
  if (value == null || value === '') {
    return;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw createHttpError(400, `Field ${fieldName} must be a valid date`);
  }
}

function ensureNonNegativeInteger(value, fieldName) {
  if (value == null || value === '') return;
  if (!Number.isInteger(Number(value)) || Number(value) < 0) {
    throw createHttpError(400, `Field ${fieldName} must be an integer >= 0`);
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

  if (payload.device_type_key != null) {
    payload.device_type_key = String(payload.device_type_key).trim().toUpperCase();
  }

  ensureNonNegativeInteger(payload.capacity_core, 'capacity_core');
  ensureNonNegativeInteger(payload.used_core, 'used_core');
  ensureNonNegativeInteger(payload.total_ports, 'total_ports');
  ensureNonNegativeInteger(payload.used_ports, 'used_ports');

  if (payload.capacity_core != null && payload.used_core != null && Number(payload.used_core) > Number(payload.capacity_core)) {
    throw createHttpError(400, 'used_core cannot be greater than capacity_core');
  }

  if (payload.total_ports != null && payload.used_ports != null && Number(payload.used_ports) > Number(payload.total_ports)) {
    throw createHttpError(400, 'used_ports cannot be greater than total_ports');
  }

  if (payload.validation_status != null) {
    payload.validation_status = String(payload.validation_status).trim().toLowerCase();
  }

  if (payload.validation_status != null && !VALIDATION_STATUS_VALUES.includes(payload.validation_status)) {
    throw createHttpError(400, `validation_status must be one of: ${VALIDATION_STATUS_VALUES.join(', ')}`);
  }

  if (payload.validation_status && payload.validation_status !== 'unvalidated' && !payload.validation_date) {
    throw createHttpError(400, 'validation_date is required when validation_status is not unvalidated');
  }

  const typeKey = String(payload.device_type_key || '').toUpperCase();

  if (DEVICE_TYPE_CORE_REQUIRED.has(typeKey) || DEVICE_TYPE_CORE_AND_PORT_REQUIRED.has(typeKey)) {
    if (mode === 'create' && payload.capacity_core == null) {
      throw createHttpError(400, `capacity_core is required for device_type_key ${typeKey}`);
    }
  }

  if (DEVICE_TYPE_PORT_REQUIRED.has(typeKey) || DEVICE_TYPE_CORE_AND_PORT_REQUIRED.has(typeKey)) {
    if (mode === 'create' && payload.total_ports == null) {
      throw createHttpError(400, `total_ports is required for device_type_key ${typeKey}`);
    }
  }

  if (typeKey === 'ODP' && mode === 'create' && !payload.splitter_ratio) {
    throw createHttpError(400, 'splitter_ratio is required for device_type_key ODP');
  }

  ensureValidDate(payload.validation_date, 'validation_date');
}

module.exports = { validateDevicePayload };
