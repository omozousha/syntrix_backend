const { createHttpError } = require('../../utils/httpError');

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
}

module.exports = { validateDevicePayload };
