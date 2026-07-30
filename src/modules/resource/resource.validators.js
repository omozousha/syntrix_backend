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

function validateTrayConfig(trayConfig, totalPorts, capacityCore) {
  if (!trayConfig) return null;
  let config = trayConfig;
  if (typeof trayConfig === 'string') {
    try {
      config = JSON.parse(trayConfig);
    } catch (e) {
      return 'Format tray_config harus berupa JSON valid.';
    }
  }

  if (typeof config !== 'object' || config === null) {
    return 'tray_config harus berupa objek JSON.';
  }

  if (!config.version) return 'tray_config wajib memiliki field "version".';
  if (!config.layout_type) return 'tray_config wajib memiliki field "layout_type".';

  if (config.groups !== undefined) {
    if (!Array.isArray(config.groups)) return 'tray_config.groups harus berupa array.';

    const ranges = [];
    for (let i = 0; i < config.groups.length; i++) {
      const g = config.groups[i];
      if (!g.id) return `Group ke-${i+1} wajib memiliki field "id".`;
      if (!g.label) return `Group ke-${i+1} wajib memiliki field "label".`;
      if (g.start_index === undefined || g.end_index === undefined) {
        return `Group "${g.label}" wajib memiliki field "start_index" dan "end_index".`;
      }
      
      const start = Number(g.start_index);
      const end = Number(g.end_index);
      
      if (isNaN(start) || isNaN(end) || start < 1 || end < 1) {
        return `Group "${g.label}" start/end index harus berupa angka positif >= 1.`;
      }
      if (start > end) {
        return `Group "${g.label}" start_index (${start}) tidak boleh lebih besar dari end_index (${end}).`;
      }

      for (const r of ranges) {
        if (start <= r.end && end >= r.start) {
          return `Group "${g.label}" tumpang tindih (overlap) dengan group "${r.label}" [${r.start}-${r.end}].`;
        }
      }
      ranges.push({ start, end, label: g.label });
    }
  }
  return null;
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
    if (payload.capacity_core !== undefined && payload.capacity_core !== null && payload.capacity_core !== '') {
      if (!isPositiveNumber(payload.capacity_core)) return 'Capacity Core harus integer > 0.';
    }
    if (payload.total_ports !== undefined && payload.total_ports !== null && payload.total_ports !== '') {
      if (!isPositiveNumber(payload.total_ports)) return 'Total Ports harus integer > 0.';
    }
    if (payload.tray_config) {
      const trayErr = validateTrayConfig(payload.tray_config, payload.total_ports, payload.capacity_core);
      if (trayErr) return trayErr;
    }
    return null;
  },

  closureTypes: (payload) => {
    if (!isNonEmptyString(payload.closure_type_name)) return 'Closure Type Name wajib diisi.';
    if (payload.max_core_capacity === undefined || payload.max_core_capacity === null || payload.max_core_capacity === '') {
      return 'Max Core Capacity wajib diisi.';
    }
    if (!isPositiveNumber(payload.max_core_capacity)) return 'Max Core Capacity harus integer > 0.';
    if (payload.max_splice_capacity === undefined || payload.max_splice_capacity === null || payload.max_splice_capacity === '') {
      return 'Max Splice Capacity wajib diisi.';
    }
    if (!isPositiveNumber(payload.max_splice_capacity)) return 'Max Splice Capacity harus integer > 0.';
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
    if (msg.includes('closure_types_closure_type_name_key')) return 'Closure Type Name sudah terdaftar. Gunakan nama yang berbeda.';
    if (msg.includes('asset_models_model_name_key')) return 'Model Name sudah terdaftar. Gunakan nama yang berbeda.';
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
