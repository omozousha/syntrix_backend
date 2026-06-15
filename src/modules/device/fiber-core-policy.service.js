const { executeHasura } = require('../../config/hasura');
const { createHttpError } = require('../../utils/httpError');

const ACTIVE_CONNECTION_STATUSES = ['active', 'planned', 'cutover'];
const BLOCKED_CORE_STATUSES = new Set(['damaged', 'inactive', 'down']);
const RESERVED_CORE_STATUS = 'reserved';

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function shouldValidateCoreRange(payload, existing = null) {
  if (!existing) return true;
  return ['cable_device_id', 'core_start', 'core_end', 'fiber_count', 'status'].some((key) => hasOwn(payload, key));
}

function getEffectiveCoreRange(payload, existing = null) {
  const cableDeviceId = payload.cable_device_id !== undefined ? payload.cable_device_id : existing?.cable_device_id;
  const coreStart = payload.core_start !== undefined ? payload.core_start : existing?.core_start;
  const coreEnd = payload.core_end !== undefined ? payload.core_end : existing?.core_end;

  const hasCable = cableDeviceId != null && String(cableDeviceId).trim() !== '';
  const hasStart = coreStart != null && coreStart !== '';
  const hasEnd = coreEnd != null && coreEnd !== '';
  if (!hasCable || !hasStart || !hasEnd) return null;

  const start = Number(coreStart);
  const end = Number(coreEnd);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end <= 0 || end < start) {
    return null;
  }

  return {
    cableDeviceId: String(cableDeviceId),
    start,
    end,
  };
}

async function loadFiberCoreRangePolicyContext({ cableDeviceId, start, end, excludeConnectionId = null }) {
  const connectionWhere = {
    cable_device_id: { _eq: cableDeviceId },
    status: { _in: ACTIVE_CONNECTION_STATUSES },
    core_start: { _lte: end },
    core_end: { _gte: start },
  };
  if (excludeConnectionId) {
    connectionWhere.id = { _neq: excludeConnectionId };
  }

  const query = `
    query LoadFiberCoreRangePolicyContext(
      $cableDeviceId: uuid!
      $start: Int!
      $end: Int!
      $connectionWhere: port_connections_bool_exp!
    ) {
      cores: fiber_cores(
        where: {
          cable_device_id: { _eq: $cableDeviceId }
          core_no: { _gte: $start, _lte: $end }
        }
        order_by: { core_no: asc }
      ) {
        id
        core_no
        status
        connection_id
      }
      overlaps: port_connections(
        where: $connectionWhere
        limit: 5
        order_by: { updated_at: desc }
      ) {
        id
        connection_id
        core_start
        core_end
        status
      }
    }
  `;

  return executeHasura(query, { cableDeviceId, start, end, connectionWhere });
}

async function validateFiberCoreRangeForConnection(payload, existing = null) {
  if (!shouldValidateCoreRange(payload, existing)) return;

  const range = getEffectiveCoreRange(payload, existing);
  if (!range) return;

  const excludeConnectionId = existing?.id || payload.id || null;
  const data = await loadFiberCoreRangePolicyContext({
    ...range,
    excludeConnectionId,
  });

  const expectedCoreCount = range.end - range.start + 1;
  const cores = data.cores || [];
  if (cores.length !== expectedCoreCount) {
    throw createHttpError(400, 'Cable fiber core inventory is not provisioned for the requested core range');
  }

  const occupiedCore = cores.find((core) => {
    const connectionId = core.connection_id ? String(core.connection_id) : '';
    return connectionId && (!excludeConnectionId || connectionId !== String(excludeConnectionId));
  });
  if (occupiedCore) {
    throw createHttpError(400, `Core ${occupiedCore.core_no} is already mapped to another connection`);
  }

  const blockedCore = cores.find((core) => BLOCKED_CORE_STATUSES.has(String(core.status || '').toLowerCase()));
  if (blockedCore) {
    throw createHttpError(400, `Core ${blockedCore.core_no} cannot be used because status is ${blockedCore.status}`);
  }

  const reservedCore = cores.find((core) => String(core.status || '').toLowerCase() === RESERVED_CORE_STATUS);
  if (reservedCore) {
    throw createHttpError(400, `Core ${reservedCore.core_no} is reserved and cannot be used without an approved reservation policy`);
  }

  const overlap = (data.overlaps || [])[0];
  if (overlap) {
    throw createHttpError(
      400,
      `Core range overlaps with existing connection ${overlap.connection_id || overlap.id}`,
    );
  }
}

module.exports = {
  validateFiberCoreRangeForConnection,
};
