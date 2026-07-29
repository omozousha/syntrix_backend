const { createHttpError } = require('../../utils/httpError');
const { executeHasura } = require('../../config/hasura');

const USAGE_MAP = {
  deviceTypes: [
    { table: 'devices', fk: 'device_type_key', fkType: 'text', labelField: 'device_name' },
    { table: 'device_port_templates', fk: 'device_type_key', fkType: 'text', labelField: 'profile_name' },
    { table: 'topology_relation_rules', fk: 'source_device_type_key', fkType: 'text', labelField: 'source_device_type_key' },
    { table: 'custom_field_definitions', fk: 'device_type_key', fkType: 'text', labelField: 'field_label' },
  ],
  manufacturers: [
    { table: 'devices', fk: 'manufacturer_id', fkType: 'uuid', labelField: 'device_name' },
    { table: 'brands', fk: 'manufacturer_id', fkType: 'uuid', labelField: 'brand_name' },
    { table: 'asset_models', fk: 'manufacturer_id', fkType: 'uuid', labelField: 'model_name' },
  ],
  brands: [
    { table: 'devices', fk: 'brand_id', fkType: 'uuid', labelField: 'device_name' },
    { table: 'asset_models', fk: 'brand_id', fkType: 'uuid', labelField: 'model_name' },
  ],
  assetModels: [
    { table: 'devices', fk: 'model_id', fkType: 'uuid', labelField: 'device_name' },
  ],
  tenants: [
    { table: 'devices', fk: 'tenant_id', fkType: 'uuid', labelField: 'device_name' },
  ],
  closureTypes: [
    { table: 'devices', fk: 'closure_type_id', fkType: 'uuid', labelField: 'device_name' },
  ],
  splitterProfiles: [
    { table: 'device_ports', fk: 'splitter_profile_id', fkType: 'uuid', labelField: 'port_label' },
  ],
  odpTypes: [
    { table: 'devices', fk: 'odp_type', fkType: 'text', labelField: 'device_name' },
  ],
  installationTypes: [
    { table: 'devices', fk: 'installation_type', fkType: 'text', labelField: 'device_name' },
  ],
  cableTypes: [
    { table: 'devices', fk: 'cable_type', fkType: 'text', labelField: 'device_name' },
  ],
  popTypes: [
    { table: 'pops', fk: 'pop_type_id', fkType: 'uuid', labelField: 'pop_name' },
  ],
  routeTypes: [
    { table: 'network_routes', fk: 'route_type', fkType: 'text', labelField: 'route_name' },
  ],
  serviceTypes: [
    { table: 'customers', fk: 'service_type_id', fkType: 'uuid', labelField: 'customer_name' },
  ],
  provinces: [
    { table: 'devices', fk: 'province_id', fkType: 'uuid', labelField: 'device_name' },
    { table: 'pops', fk: 'province_id', fkType: 'uuid', labelField: 'pop_name' },
    { table: 'cities', fk: 'province_id', fkType: 'uuid', labelField: 'city_name' },
  ],
  cities: [
    { table: 'devices', fk: 'city_id', fkType: 'uuid', labelField: 'device_name' },
    { table: 'pops', fk: 'city_id', fkType: 'uuid', labelField: 'pop_name' },
  ],
};

function sanitize(val) {
  if (val == null) return '';
  return String(val).replace(/'/g, "''");
}

function buildWhereText(ref, recordData) {
  const refKey = ref.fkRef || ref.fk;
  const value = recordData ? recordData[refKey] : null;
  if (!value) return '';
  return `${ref.fk} = '${sanitize(value)}'`;
}

function buildWhereUuid(ref, recordId) {
  return `${ref.fk} = '${sanitize(recordId)}'`;
}

async function checkUsage(resourceName, recordId, recordData) {
  const refs = USAGE_MAP[resourceName] || [];
  const byType = {};
  let total = 0;

  for (const ref of refs) {
    let where;
    if (ref.fkType === 'uuid') {
      where = buildWhereUuid(ref, recordId);
    } else {
      where = buildWhereText(ref, recordData);
    }
    if (!where) continue;

    const countQuery = `query CountRef {
        ${ref.table}_aggregate(where: {${where}}) {
          aggregate { count }
        }
      }`;

    try {
      const countResult = await executeHasura(countQuery);
      const count = countResult?.data?.[`${ref.table}_aggregate`]?.aggregate?.count || 0;
      if (count > 0) {
        const sampleQuery = `query SampleRef {
            ${ref.table}(where: {${where}}, limit: 3, order_by: {created_at: desc}) {
              id
              ${ref.labelField}
            }
          }`;

        let sample = [];
        try {
          const sampleResult = await executeHasura(sampleQuery);
          sample = (sampleResult?.data?.[ref.table] || []).map((item) => ({
            id: item.id,
            label: String(item[ref.labelField] || '-'),
          }));
        } catch {
          sample = [];
        }

        byType[ref.table] = { count, sample };
        total += count;
      }
    } catch {
      // skip table if error
    }
  }

  return { total, by_type: byType };
}

module.exports = { checkUsage, USAGE_MAP };
