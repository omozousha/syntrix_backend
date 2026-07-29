/**
 * Tests for backend master data validation functions
 * Tests validateResourcePayload and translateHasuraError directly
 */

const { validateResourcePayload, translateHasuraError } = require('../src/modules/resource/resource.validators');

const passed = [];
const failed = [];
function check(label, ok, detail = '') {
  (ok ? passed : failed).push(label);
  const mark = ok ? '[ OK ]' : '[FAIL]';
  console.log(`${mark} ${label}${detail ? ` :: ${detail}` : ''}`);
}

function main() {
  // ── deviceTypes ──
  check(
    'deviceTypes: valid payload passes',
    validateResourcePayload('deviceTypes', { device_type_key: 'OLT', device_type_name: 'OLT', asset_group: 'active' }) === null,
  );
  check(
    'deviceTypes: missing device_type_key',
    validateResourcePayload('deviceTypes', { device_type_name: 'OLT', asset_group: 'active' }) !== null,
  );
  check(
    'deviceTypes: invalid key format (lowercase)',
    validateResourcePayload('deviceTypes', { device_type_key: 'olt', device_type_name: 'OLT', asset_group: 'active' }) !== null,
  );
  check(
    'deviceTypes: bad asset_group',
    validateResourcePayload('deviceTypes', { device_type_key: 'OLT', device_type_name: 'OLT', asset_group: 'hybrid' }) !== null,
  );

  // ── cableTypes ──
  check(
    'cableTypes: valid payload passes',
    validateResourcePayload('cableTypes', { cable_type_name: 'Single-mode (SM)' }) === null,
  );
  check(
    'cableTypes: missing name',
    validateResourcePayload('cableTypes', {}) !== null,
  );
  check(
    'cableTypes: negative attenuation',
    validateResourcePayload('cableTypes', { cable_type_name: 'SM', attenuation_1310_db_per_km: -1 }) !== null,
  );

  // ── closureTypes ──
  check(
    'closureTypes: missing in validator (no specific rules → pass)',
    validateResourcePayload('closureTypes', { closure_type_name: 'Dome 24' }) === null,
  );

  // ── splitterProfiles ──
  check(
    'splitterProfiles: valid payload passes',
    validateResourcePayload('splitterProfiles', { ratio_label: '1:8', input_port_count: 1, output_port_count: 8 }) === null,
  );
  check(
    'splitterProfiles: missing ratio_label',
    validateResourcePayload('splitterProfiles', { input_port_count: 1, output_port_count: 8 }) !== null,
  );
  check(
    'splitterProfiles: bad ratio format (1x8)',
    validateResourcePayload('splitterProfiles', { ratio_label: '1x8', input_port_count: 1, output_port_count: 8 }) !== null,
  );
  check(
    'splitterProfiles: output_port_count < 2',
    validateResourcePayload('splitterProfiles', { ratio_label: '1:1', input_port_count: 1, output_port_count: 1 }) !== null,
  );

  // ── linkBudgetParameters ──
  check(
    'linkBudgetParameters: valid payload passes',
    validateResourcePayload('linkBudgetParameters', { parameter_key: 'ENG_MARGIN', parameter_label: 'Engineering Margin', parameter_value: 3.0 }) === null,
  );
  check(
    'linkBudgetParameters: missing parameter_value',
    validateResourcePayload('linkBudgetParameters', { parameter_key: 'ENG_MARGIN', parameter_label: 'Engineering Margin' }) !== null,
  );
  check(
    'linkBudgetParameters: non-numeric value',
    validateResourcePayload('linkBudgetParameters', { parameter_key: 'ENG_MARGIN', parameter_label: 'Engineering Margin', parameter_value: 'abc' }) !== null,
  );

  // ── topologyRelationRules ──
  check(
    'topologyRelationRules: valid payload passes',
    validateResourcePayload('topologyRelationRules', { source_device_type_key: 'ODC', direction: 'front', allowed_peer_device_type_key: 'ODP' }) === null,
  );
  check(
    'topologyRelationRules: invalid direction',
    validateResourcePayload('topologyRelationRules', { source_device_type_key: 'ODC', direction: 'sideways', allowed_peer_device_type_key: 'ODP' }) !== null,
  );
  check(
    'topologyRelationRules: missing source',
    validateResourcePayload('topologyRelationRules', { direction: 'front', allowed_peer_device_type_key: 'ODP' }) !== null,
  );

  // ── odpTypes ──
  check(
    'odpTypes: valid payload passes',
    validateResourcePayload('odpTypes', { odp_type_name: 'ODP PB' }) === null,
  );
  check(
    'odpTypes: missing name',
    validateResourcePayload('odpTypes', {}) !== null,
  );

  // ── installationTypes ──
  check(
    'installationTypes: valid payload passes',
    validateResourcePayload('installationTypes', { installation_type_name: 'Aerial' }) === null,
  );

  // ── serviceTypes ──
  check(
    'serviceTypes: valid payload passes',
    validateResourcePayload('serviceTypes', { service_type_name: 'Internet' }) === null,
  );

  // ── tenants ──
  check(
    'tenants: valid payload passes',
    validateResourcePayload('tenants', { tenant_name: 'FiberPro' }) === null,
  );

  // ── manufacturers ──
  check(
    'manufacturers: valid payload passes',
    validateResourcePayload('manufacturers', { manufacturer_name: 'Huawei' }) === null,
  );

  // ── brands ──
  check(
    'brands: valid payload passes',
    validateResourcePayload('brands', { brand_name: 'MA5800' }) === null,
  );

  // ── assetModels ──
  check(
    'assetModels: valid payload passes',
    validateResourcePayload('assetModels', { model_name: 'MA5800-X17' }) === null,
  );

  // ── popTypes ──
  check(
    'popTypes: valid payload passes',
    validateResourcePayload('popTypes', { pop_type_name: 'Main POP' }) === null,
  );

  // ── routeTypes ──
  check(
    'routeTypes: valid payload passes',
    validateResourcePayload('routeTypes', { route_type_name: 'Backbone' }) === null,
  );

  // ── provinces ──
  check(
    'provinces: valid payload passes',
    validateResourcePayload('provinces', { province_name: 'Banten' }) === null,
  );

  // ── cities ──
  check(
    'cities: valid payload passes',
    validateResourcePayload('cities', { city_name: 'Kota Serang' }) === null,
  );

  // ── translateHasuraError ──
  check(
    'translateHasuraError: unique constraint recognized',
    translateHasuraError({ message: 'duplicate key value violates unique constraint "device_type_catalog_device_type_key_key"' }, 'deviceTypes') !== null,
  );
  check(
    'translateHasuraError: cable_types unique constraint',
    translateHasuraError({ message: 'duplicate key value violates unique constraint "cable_types_cable_type_name_key"' }, 'cableTypes') !== null,
  );
  check(
    'translateHasuraError: check constraint recognized',
    translateHasuraError({ message: 'new row for relation "device_type_catalog" violates check constraint' }, 'deviceTypes') !== null,
  );
  check(
    'translateHasuraError: unknown error returns null (letting raw pass through)',
    translateHasuraError({ message: 'some unrelated error' }, 'deviceTypes') === null,
  );

  // ── edge cases ──
  check(
    'null payload returns error',
    validateResourcePayload('deviceTypes', null) !== null,
  );
  check(
    'empty object payload returns error for required fields',
    validateResourcePayload('deviceTypes', {}) !== null,
  );
  check(
    'unknown resource returns null (no validator)',
    validateResourcePayload('nonexistentResource', {}) === null,
  );

  console.log(`\n--- MASTER DATA VALIDATION SUITE [${passed.length} passed / ${failed.length} failed] ---`);
  if (failed.length) {
    console.log('Failures:');
    failed.forEach((f) => console.log(' -', f));
  }
  process.exit(failed.length > 0 ? 1 : 0);
}

main();
