/**
 * Backend Validation Rules for Master Data Resources
 * Validates payloads before hitting Hasura/DB layer.
 * Returns human-friendly error messages in Indonesian.
 */

function isNonEmptyString(val) {
  return typeof val === 'string' && val.trim().length > 0;
}

function isPositiveNumber(val) {
  const num = Number(val);
  return !isNaN(num) && num > 0;
}

function isNonNegativeNumber(val) {
  const num = Number(val);
  return !isNaN(num) && num >= 0;
}

const VALIDATOR_MAP = {
  deviceTypes: (payload) => {
    if (!isNonEmptyString(payload.device_type_key)) return 'Device Type Key wajib diisi.';
    if (!/^[A-Z][A-Z0-9_]*$/.test(payload.device_type_key.trim())) {
      return 'Device Type Key hanya boleh huruf besar, angka, dan underscore (diawali huruf).';
    }
    if (!isNonEmptyString(payload.device_type_name)) return 'Device Type Name wajib diisi.';
    if (!isNonEmptyString(payload.asset_group)) return 'Asset Group wajib diisi.';
    if (!['active', 'passive'].includes(payload.asset_group)) return 'Asset Group harus active atau passive.';
    if (payload.inventory_type_code && !/^\d{3}$/.test(String(payload.inventory_type_code).trim())) {
      return 'Inventory Type Code harus 3 digit angka (contoh: 001).';
    }
    return null;
  },

  topologyRelationRules: (payload) => {
    if (!isNonEmptyString(payload.source_device_type_key)) return 'Source Device Type Key wajib diisi.';
    if (!isNonEmptyString(payload.direction)) return 'Direction wajib diisi.';
    if (!['front', 'rear'].includes(payload.direction)) return 'Direction harus front atau rear.';
    if (!isNonEmptyString(payload.allowed_peer_device_type_key)) return 'Allowed Peer Device Type Key wajib diisi.';
    if (payload.connection_role && !['uplink', 'feeder', 'distribution', 'branch', 'drop', 'physical_fiber'].includes(payload.connection_role)) {
      return 'Connection Role tidak valid.';
    }
    return null;
  },

  linkBudgetParameters: (payload) => {
    if (!isNonEmptyString(payload.parameter_key)) return 'Parameter Key wajib diisi.';
    if (!isNonEmptyString(payload.parameter_label)) return 'Parameter Label wajib diisi.';
    if (payload.parameter_value === undefined || payload.parameter_value === null || payload.parameter_value === '') {
      return 'Parameter Value wajib diisi.';
    }
    if (isNaN(Number(payload.parameter_value))) return 'Parameter Value harus berupa angka valid.';
    return null;
  },

  popTypes: (payload) => {
    if (!isNonEmptyString(payload.pop_type_name)) return 'POP Type Name wajib diisi.';
    return null;
  },

  routeTypes: (payload) => {
    if (!isNonEmptyString(payload.route_type_name)) return 'Route Type Name wajib diisi.';
    return null;
  },

  cableTypes: (payload) => {
    if (!isNonEmptyString(payload.cable_type_name)) return 'Cable Type Name wajib diisi.';
    if (payload.core_count !== undefined && payload.core_count !== null && payload.core_count !== '') {
      if (!isPositiveNumber(payload.core_count)) return 'Core Count harus integer > 0.';
    }
    if (payload.attenuation_1310_db_per_km !== undefined && !isNonNegativeNumber(payload.attenuation_1310_db_per_km)) {
      return 'Attenuation 1310 (dB/km) harus berupa angka >= 0.';
    }
    if (payload.attenuation_1490_db_per_km !== undefined && !isNonNegativeNumber(payload.attenuation_1490_db_per_km)) {
      return 'Attenuation 1490 (dB/km) harus berupa angka >= 0.';
    }
    if (payload.attenuation_1550_db_per_km !== undefined && !isNonNegativeNumber(payload.attenuation_1550_db_per_km)) {
      return 'Attenuation 1550 (dB/km) harus berupa angka >= 0.';
    }
    return null;
  },

  coreCapacities: (payload) => {
    if (!isNonEmptyString(payload.label)) return 'Label wajib diisi.';
    if (!payload.core_capacity_value || !isPositiveNumber(payload.core_capacity_value)) {
      return 'Core Capacity Value harus integer > 0.';
    }
    return null;
  },

  deviceCoreCapacities: (payload) => {
    if (!isNonEmptyString(payload.label)) return 'Label wajib diisi.';
    if (!payload.core_capacity_value || !isPositiveNumber(payload.core_capacity_value)) {
      return 'Core Capacity Value harus integer > 0.';
    }
    return null;
  },

  odpTypes: (payload) => {
    if (!isNonEmptyString(payload.odp_type_name)) return 'ODP Type Name wajib diisi.';
    return null;
  },

  installationTypes: (payload) => {
    if (!isNonEmptyString(payload.installation_type_name)) return 'Installation Type Name wajib diisi.';
    return null;
  },

  serviceTypes: (payload) => {
    if (!isNonEmptyString(payload.service_type_name)) return 'Service Type Name wajib diisi.';
    return null;
  },

  tenants: (payload) => {
    if (!isNonEmptyString(payload.tenant_name)) return 'Tenant Name wajib diisi.';
    return null;
  },

  manufacturers: (payload) => {
    if (!isNonEmptyString(payload.manufacturer_name)) return 'Manufacturer Name wajib diisi.';
    return null;
  },

  brands: (payload) => {
    if (!isNonEmptyString(payload.brand_name)) return 'Brand Name wajib diisi.';
    return null;
  },

  assetModels: (payload) => {
    if (!isNonEmptyString(payload.model_name)) return 'Model Name wajib diisi.';
    return null;
  },

  splitterProfiles: (payload) => {
    if (!isNonEmptyString(payload.ratio_label)) return 'Ratio Label wajib diisi (contoh: 1:8).';
    if (!/^\d+:\d+$/.test(payload.ratio_label.trim())) return 'Ratio Label harus format N:M (contoh: 1:8, 2:32).';
    if (!payload.input_port_count || !isPositiveNumber(payload.input_port_count)) return 'Input Port Count harus integer >= 1.';
    if (!payload.output_port_count || Number(payload.output_port_count) < 2) return 'Output Port Count harus integer >= 2.';
    if (payload.expected_loss_db !== undefined && payload.expected_loss_db !== null && payload.expected_loss_db !== '') {
      if (isNaN(Number(payload.expected_loss_db))) return 'Expected Loss (dB) harus berupa angka valid.';
    }
    return null;
  },

  provinces: (payload) => {
    if (!isNonEmptyString(payload.province_name)) return 'Province Name wajib diisi.';
    return null;
  },

  cities: (payload) => {
    if (!isNonEmptyString(payload.city_name)) return 'City Name wajib diisi.';
    return null;
  },
};

function validateResourcePayload(resourceName, payload) {
  if (!payload || typeof payload !== 'object') return 'Payload tidak valid.';
  const validator = VALIDATOR_MAP[resourceName];
  if (!validator) return null; // No specific validator rule = pass
  return validator(payload);
}

function translateHasuraError(err, resourceName) {
  const msg = err?.message || String(err || '');
  if (msg.includes('unique constraint') || msg.includes('Uniqueness violation')) {
    if (msg.includes('device_type_catalog_device_type_key_key')) return 'Device Type Key sudah terdaftar. Gunakan key yang berbeda.';
    if (msg.includes('cable_types_cable_type_name_key')) return 'Cable Type Name sudah terdaftar. Gunakan nama yang berbeda.';
    if (msg.includes('pop_types_pop_type_name_key')) return 'POP Type Name sudah terdaftar. Gunakan nama yang berbeda.';
    if (msg.includes('route_types_route_type_name_key')) return 'Route Type Name sudah terdaftar. Gunakan nama yang berbeda.';
    if (msg.includes('odp_types_odp_type_name_key')) return 'ODP Type Name sudah terdaftar. Gunakan nama yang berbeda.';
    if (msg.includes('installation_types_installation_type_name_key')) return 'Installation Type Name sudah terdaftar. Gunakan nama yang berbeda.';
    if (msg.includes('service_types_service_type_name_key')) return 'Service Type Name sudah terdaftar. Gunakan nama yang berbeda.';
    if (msg.includes('tenants_tenant_name_key')) return 'Tenant Name sudah terdaftar. Gunakan nama yang berbeda.';
    if (msg.includes('manufacturers_manufacturer_name_key')) return 'Manufacturer Name sudah terdaftar. Gunakan nama yang berbeda.';
    if (msg.includes('provinces_province_name_key')) return 'Province Name sudah terdaftar. Gunakan nama yang berbeda.';
    return 'Data dengan nilai unik yang sama sudah terdaftar di sistem.';
  }
  if (msg.includes('check constraint') || msg.includes('Check constraint')) {
    return 'Data yang dimasukkan melanggar batasan validasi basis data.';
  }
  return null;
}

module.exports = {
  validateResourcePayload,
  translateHasuraError,
};
