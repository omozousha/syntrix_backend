const { executeHasura, executeHasuraSql, sqlLiteral } = require('../../config/hasura');
const { createHttpError } = require('../../utils/httpError');

const PARAMETER_KEYS = new Set([
  'gpon_class_b_plus_budget',
  'gpon_class_c_plus_budget',
  'engineering_margin',
  'fusion_splice_loss',
  'connector_pair_loss',
  'fiber_attenuation_1310',
  'fiber_attenuation_1490',
  'fiber_attenuation_1550',
]);

const DEFAULT_PARAMETERS = {
  gpon_class_b_plus_budget: 28.0,
  gpon_class_c_plus_budget: 32.0,
  engineering_margin: 3.0,
  fusion_splice_loss: 0.1,
  connector_pair_loss: 0.3,
  fiber_attenuation_1310: 0.35,
  fiber_attenuation_1490: 0.25,
  fiber_attenuation_1550: 0.25,
};

const GPON_BUDGET_BY_CLASS = {
  B_plus: 28.0,
  C_plus: 32.0,
};

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

async function loadParameterMap() {
  const query = `
    query LoadLinkBudgetParameters {
      items: link_budget_parameters(where: { is_active: { _eq: true } }) {
        parameter_key
        parameter_value
        unit
      }
    }
  `;
  const data = await executeHasura(query);
  const map = { ...DEFAULT_PARAMETERS };
  (data.items || []).forEach((row) => {
    if (PARAMETER_KEYS.has(row.parameter_key) && Number.isFinite(Number(row.parameter_value)) && Number(row.parameter_value) >= 0) {
      map[row.parameter_key] = Number(row.parameter_value);
    }
  });
  return map;
}

async function loadDeviceContext(deviceId) {
  if (!isUuid(deviceId)) return null;
  const query = `
    query LoadLinkBudgetDevice($id: uuid!) {
      item: devices_by_pk(id: $id) {
        id
        device_id
        device_name
        device_type_key
        region_id
        status
      }
    }
  `;
  const data = await executeHasura(query, { id: deviceId });
  return data.item || null;
}

async function loadSplitterLossesBetween(odpDeviceId, parameters) {
  if (!isUuid(odpDeviceId)) return [];
  const data = await executeHasuraSql(`
        select id, ratio_label, expected_loss_db::text as expected_loss_db, is_active
        from public.splitter_profiles
        where is_active = true;
      `);
  const header = data?.result?.[0] || [];
  const rows = data?.result?.slice(1) || [];
  return rows
    .map((row) => Object.fromEntries(header.map((key, idx) => [key, row[idx]])))
    .filter((row) => Number.isFinite(Number(row.expected_loss_db)) && Number(row.expected_loss_db) > 0);
}

async function loadSplitterProfilesMap() {
  const map = new Map();
  const data = await executeHasuraSql(`
        select ratio_label, expected_loss_db::text as expected_loss_db
        from public.splitter_profiles
        where is_active = true;
      `);
  const header = data?.result?.[0] || [];
  (data?.result?.slice(1) || []).forEach((row) => {
    const obj = Object.fromEntries(header.map((key, idx) => [key, row[idx]]));
    if (obj.ratio_label) {
      map.set(String(obj.ratio_label).toLowerCase(), Number(obj.expected_loss_db));
    }
  });
  return map;
}

function aggregateSplitterLoss({ splitterProfileIds, splitterRatios, splitterProfilesMap }) {
  const total = (splitterProfileIds || []).reduce((acc, id) => {
    if (!id) return acc;
    return acc;
  }, 0);
  const fromProfiles = (splitterRatios || []).reduce((acc, label) => {
    if (!label) return acc;
    const value = splitterProfilesMap.get(String(label).toLowerCase());
    return Number.isFinite(value) ? acc + value : acc;
  }, 0);
  return Number((total + fromProfiles).toFixed(3));
}

function evaluateWarnings({ calculatedLoss, measuredLoss, gponBudget, engineeringMargin, splitters, segments }) {
  const warnings = [];

  if (Number.isFinite(gponBudget) && Number.isFinite(calculatedLoss)) {
    const totalWithMargin = calculatedLoss + (Number.isFinite(engineeringMargin) ? engineeringMargin : 0);
    if (totalWithMargin >= gponBudget) {
      warnings.push({
        code: 'GPON_BUDGET_EXCEEDED',
        severity: 'critical',
        message: `Calculated loss ${calculatedLoss.toFixed(2)} dB plus margin exceeds GPON budget ${gponBudget.toFixed(2)} dB`,
      });
    } else if (totalWithMargin >= gponBudget * 0.9) {
      warnings.push({
        code: 'GPON_BUDGET_NEAR_LIMIT',
        severity: 'warning',
        message: `Calculated loss + margin is within 90% of GPON budget ${gponBudget.toFixed(2)} dB`,
      });
    }
  }

  if (Number.isFinite(measuredLoss) && Number.isFinite(calculatedLoss)) {
    const drift = Math.abs(measuredLoss - calculatedLoss);
    if (drift >= 3) {
      warnings.push({
        code: 'MEASURED_DRIFT_LARGE',
        severity: 'warning',
        message: `Measured loss (${measuredLoss.toFixed(2)} dB) differs from calculated by ${drift.toFixed(2)} dB`,
      });
    }
  }

  if (!splitters || splitters.length === 0) {
    warnings.push({
      code: 'NO_SPLITTER_LOSS_RECORDED',
      severity: 'info',
      message: 'No splitter ratio detected on the path; calculated loss excludes splitter loss',
    });
  }

  if (!segments || segments.length === 0) {
    warnings.push({
      code: 'NO_TOPOLOGY_PATH',
      severity: 'warning',
      message: 'No topology segments were provided; calculated loss assumes engineering defaults only',
    });
  }

  return warnings;
}

async function buildLinkBudgetInput({ device, splitterProfileIds = [], splitterRatios = [], segments = [], engineeringMarginOverride = null }) {
  if (!device) {
    throw createHttpError(404, 'Device not found for link budget');
  }
  const parameters = await loadParameterMap();
  const splitterProfilesMap = await loadSplitterProfilesMap();

  const splitterLoss = aggregateSplitterLoss({
    splitterProfileIds,
    splitterRatios,
    splitterProfilesMap,
  });

  const attenuationPerKm = Number.isFinite(parameters.fiber_attenuation_1310)
    ? parameters.fiber_attenuation_1310
    : DEFAULT_PARAMETERS.fiber_attenuation_1310;
  const spliceLoss = Number.isFinite(parameters.fusion_splice_loss)
    ? parameters.fusion_splice_loss
    : DEFAULT_PARAMETERS.fusion_splice_loss;
  const connectorLoss = Number.isFinite(parameters.connector_pair_loss)
    ? parameters.connector_pair_loss
    : DEFAULT_PARAMETERS.connector_pair_loss;
  const engineeringMargin = Number.isFinite(engineeringMarginOverride)
    ? Number(engineeringMarginOverride)
    : (Number.isFinite(parameters.engineering_margin) ? parameters.engineering_margin : DEFAULT_PARAMETERS.engineering_margin);

  let fiberLoss = 0;
  let spliceCount = 0;
  let connectorCount = 0;
  const usedSegments = [];
  (segments || []).forEach((segment) => {
    if (!segment || typeof segment !== 'object') return;
    const distanceKm = Math.max(0, Number(segment.distance_km ?? segment.distanceKm ?? 0) || 0);
    const segmentSplices = Math.max(0, Number(segment.splice_count ?? segment.spliceCount ?? 0) || 0);
    const segmentConnectors = Math.max(0, Number(segment.connector_count ?? segment.connectorCount ?? 0) || 0);
    if (!distanceKm && !segmentSplices && !segmentConnectors) return;
    const segmentFiberLoss = distanceKm * attenuationPerKm;
    fiberLoss += segmentFiberLoss;
    spliceCount += segmentSplices;
    connectorCount += segmentConnectors;
    usedSegments.push({
      label: segment.label || null,
      cable_device_id: segment.cable_device_id || null,
      distance_km: distanceKm,
      splice_count: segmentSplices,
      connector_count: segmentConnectors,
      fiber_loss_db: Number(segmentFiberLoss.toFixed(3)),
    });
  });

  const calculatedLoss = Number(
    (
      splitterLoss
      + fiberLoss
      + (spliceCount * spliceLoss)
      + (connectorCount * connectorLoss)
      + engineeringMargin
    ).toFixed(3),
  );

  return {
    device: {
      id: device.id,
      device_id: device.device_id,
      device_name: device.device_name,
      device_type_key: device.device_type_key,
      region_id: device.region_id,
    },
    parameters: {
      attenuation_per_km: attenuationPerKm,
      splice_loss: spliceLoss,
      connector_loss: connectorLoss,
      engineering_margin: engineeringMargin,
    },
    segments: usedSegments,
    splitter_loss_db: splitterLoss,
    fiber_loss_db: Number(fiberLoss.toFixed(3)),
    splice_loss_db: Number((spliceCount * spliceLoss).toFixed(3)),
    connector_loss_db: Number((connectorCount * connectorLoss).toFixed(3)),
    engineering_margin_db: engineeringMargin,
    calculated_loss_db: calculatedLoss,
  };
}

async function evaluateDeviceLinkBudget({ device, splitterProfileIds = [], splitterRatios = [], segments = [], gponClass = null, engineeringMarginOverride = null, measuredLossDb = null }) {
  const input = await buildLinkBudgetInput({
    device,
    splitterProfileIds,
    splitterRatios,
    segments,
    engineeringMarginOverride,
  });
  const gponClassSelected = gponClass && Object.prototype.hasOwnProperty.call(GPON_BUDGET_BY_CLASS, gponClass) ? gponClass : 'B_plus';
  const gponBudget = GPON_BUDGET_BY_CLASS[gponClassSelected];
  const warnings = evaluateWarnings({
    calculatedLoss: input.calculated_loss_db,
    measuredLoss: Number.isFinite(measuredLossDb) ? Number(measuredLossDb) : null,
    gponBudget,
    engineeringMargin: input.engineering_margin_db,
    splitters: splitterProfileIds.length || splitterRatios.length ? [{ source: 'mixed' }] : [],
    segments: input.segments,
  });
  return {
    ...input,
    gpon_class: gponClassSelected,
    gpon_budget_db: gponBudget,
    margin_db: Number((gponBudget - input.calculated_loss_db).toFixed(3)),
    warnings,
  };
}

async function loadEstimateForDevice(deviceId) {
  if (!isUuid(deviceId)) return null;
  const query = `
    query LoadLinkBudgetEstimate($deviceId: uuid!) {
      item: link_budget_estimates(where: { device_id: { _eq: $deviceId } }, limit: 1) {
        id
        estimate_id
        device_id
        region_id
        calculated_loss_db
        measured_loss_db
        ont_rx_power_dbm
        olt_tx_power_dbm
        engineering_margin_db
        measurement_date
        measurement_method
        evidence_attachment_id
        gpon_class
        gpon_budget_db
        warnings
        notes
        updated_at
      }
    }
  `;
  const data = await executeHasura(query, { deviceId });
  return data.item?.[0] || null;
}

function normalizeEstimateInput(body = {}) {
  const allowedMethods = new Set(['otdr', 'power_meter', 'manual', 'estimate']);
  const allowedClasses = new Set(['B_plus', 'C_plus']);
  const result = {};

  if (body.calculated_loss_db != null && body.calculated_loss_db !== '') {
    const value = Number(body.calculated_loss_db);
    if (!Number.isFinite(value) || value < 0) {
      throw createHttpError(400, 'calculated_loss_db must be a non-negative number');
    }
    result.calculated_loss_db = Number(value.toFixed(3));
  }
  if (body.measured_loss_db != null && body.measured_loss_db !== '') {
    const value = Number(body.measured_loss_db);
    if (!Number.isFinite(value) || value < 0) {
      throw createHttpError(400, 'measured_loss_db must be a non-negative number');
    }
    result.measured_loss_db = Number(value.toFixed(3));
  }
  if (body.ont_rx_power_dbm != null && body.ont_rx_power_dbm !== '') {
    const value = Number(body.ont_rx_power_dbm);
    if (!Number.isFinite(value)) {
      throw createHttpError(400, 'ont_rx_power_dbm must be a number');
    }
    result.ont_rx_power_dbm = Number(value.toFixed(3));
  }
  if (body.olt_tx_power_dbm != null && body.olt_tx_power_dbm !== '') {
    const value = Number(body.olt_tx_power_dbm);
    if (!Number.isFinite(value)) {
      throw createHttpError(400, 'olt_tx_power_dbm must be a number');
    }
    result.olt_tx_power_dbm = Number(value.toFixed(3));
  }
  if (body.engineering_margin_db != null && body.engineering_margin_db !== '') {
    const value = Number(body.engineering_margin_db);
    if (!Number.isFinite(value) || value < 0) {
      throw createHttpError(400, 'engineering_margin_db must be a non-negative number');
    }
    result.engineering_margin_db = Number(value.toFixed(3));
  }
  if (body.measurement_date != null && body.measurement_date !== '') {
    result.measurement_date = body.measurement_date;
  }
  if (body.measurement_method != null && body.measurement_method !== '') {
    if (!allowedMethods.has(body.measurement_method)) {
      throw createHttpError(400, 'measurement_method must be one of: otdr, power_meter, manual, estimate');
    }
    result.measurement_method = body.measurement_method;
  }
  if (body.evidence_attachment_id != null && body.evidence_attachment_id !== '') {
    if (!isUuid(body.evidence_attachment_id)) {
      throw createHttpError(400, 'evidence_attachment_id must be a valid UUID');
    }
    result.evidence_attachment_id = body.evidence_attachment_id;
  }
  if (body.gpon_class != null && body.gpon_class !== '') {
    if (!allowedClasses.has(body.gpon_class)) {
      throw createHttpError(400, 'gpon_class must be one of: B_plus, C_plus');
    }
    result.gpon_class = body.gpon_class;
  }
  if (body.warnings != null) {
    result.warnings = Array.isArray(body.warnings) ? body.warnings : [];
  }
  if (body.notes != null) {
    result.notes = body.notes || null;
  }
  return result;
}

module.exports = {
  evaluateDeviceLinkBudget,
  loadEstimateForDevice,
  normalizeEstimateInput,
  buildLinkBudgetInput,
  loadDeviceContext,
};
