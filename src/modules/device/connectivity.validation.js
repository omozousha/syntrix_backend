const { createHttpError } = require('../../utils/httpError');

const LINK_STATUS = new Set(['planning', 'active', 'inactive', 'cutover']);
const PORT_STATUS = new Set(['idle', 'used', 'reserved', 'down', 'maintenance']);
const PORT_TYPE = new Set(['ethernet', 'pon', 'uplink', 'fiber', 'splitter', 'other']);
const PORT_DIRECTION = new Set(['in', 'out', 'bidirectional']);
const CONNECTION_STATUS = new Set(['active', 'planned', 'inactive', 'cutover']);
const CONNECTION_TYPE = new Set(['fiber', 'patch', 'uplink', 'crossconnect', 'other']);

function ensureInteger(value, fieldName, minValue = 0) {
  if (value == null || value === '') return;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minValue) {
    throw createHttpError(400, `Field ${fieldName} must be an integer >= ${minValue}`);
  }
}

function ensureCoreRange(start, end, startField = 'core_start', endField = 'core_end') {
  const hasStart = start != null && start !== '';
  const hasEnd = end != null && end !== '';
  if (!hasStart && !hasEnd) return;
  if (!hasStart || !hasEnd) {
    throw createHttpError(400, `${startField} and ${endField} must be provided together`);
  }
  ensureInteger(start, startField, 1);
  ensureInteger(end, endField, 1);
  if (Number(end) < Number(start)) {
    throw createHttpError(400, `${endField} cannot be smaller than ${startField}`);
  }
}

function validateDeviceLinkPayload(payload, mode = 'create') {
  if (mode === 'create') {
    ['region_id', 'from_device_id', 'to_device_id'].forEach((field) => {
      if (!payload[field]) throw createHttpError(400, `Field ${field} is required`);
    });
  }

  if (payload.from_device_id && payload.to_device_id && payload.from_device_id === payload.to_device_id) {
    throw createHttpError(400, 'from_device_id and to_device_id cannot be the same');
  }

  if (payload.status != null && !LINK_STATUS.has(payload.status)) {
    throw createHttpError(400, `status must be one of: ${Array.from(LINK_STATUS).join(', ')}`);
  }

  ensureInteger(payload.fiber_count, 'fiber_count', 0);
  ensureCoreRange(payload.core_start, payload.core_end);
}

function validateDevicePortPayload(payload, mode = 'create') {
  if (mode === 'create') {
    ['region_id', 'device_id', 'port_index'].forEach((field) => {
      if (payload[field] == null || payload[field] === '') throw createHttpError(400, `Field ${field} is required`);
    });
  }

  ensureInteger(payload.port_index, 'port_index', 1);
  ensureInteger(payload.core_capacity, 'core_capacity', 0);
  ensureInteger(payload.core_used, 'core_used', 0);

  if (payload.core_capacity != null && payload.core_used != null && Number(payload.core_used) > Number(payload.core_capacity)) {
    throw createHttpError(400, 'core_used cannot be greater than core_capacity');
  }

  if (payload.status != null && !PORT_STATUS.has(payload.status)) {
    throw createHttpError(400, `status must be one of: ${Array.from(PORT_STATUS).join(', ')}`);
  }

  if (payload.port_type != null && !PORT_TYPE.has(payload.port_type)) {
    throw createHttpError(400, `port_type must be one of: ${Array.from(PORT_TYPE).join(', ')}`);
  }

  if (payload.direction != null && !PORT_DIRECTION.has(payload.direction)) {
    throw createHttpError(400, `direction must be one of: ${Array.from(PORT_DIRECTION).join(', ')}`);
  }
}

function validatePortConnectionPayload(payload, mode = 'create') {
  if (mode === 'create') {
    ['region_id', 'from_port_id', 'to_port_id'].forEach((field) => {
      if (!payload[field]) throw createHttpError(400, `Field ${field} is required`);
    });
  }

  if (payload.from_port_id && payload.to_port_id && payload.from_port_id === payload.to_port_id) {
    throw createHttpError(400, 'from_port_id and to_port_id cannot be the same');
  }

  if (payload.status != null && !CONNECTION_STATUS.has(payload.status)) {
    throw createHttpError(400, `status must be one of: ${Array.from(CONNECTION_STATUS).join(', ')}`);
  }

  if (payload.connection_type != null && !CONNECTION_TYPE.has(payload.connection_type)) {
    throw createHttpError(400, `connection_type must be one of: ${Array.from(CONNECTION_TYPE).join(', ')}`);
  }

  ensureInteger(payload.fiber_count, 'fiber_count', 0);
  ensureCoreRange(payload.core_start, payload.core_end);
}

module.exports = {
  validateDeviceLinkPayload,
  validateDevicePortPayload,
  validatePortConnectionPayload,
};
