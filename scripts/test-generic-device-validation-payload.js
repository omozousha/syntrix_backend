const assert = require('assert');
const { buildGenericFieldValidationPayload } = require('../src/modules/validation/validation.service');

function testLegacyOdpPayload() {
  const payload = buildGenericFieldValidationPayload({
    device: {
      id: 'device-odp',
      device_type_key: 'ODP',
      device_name: 'ODP Lama',
      region_id: 'region-1',
      pop_id: 'pop-1',
    },
    payloadSnapshot: {
      source: 'mobile-validator',
      field_validation: {
        old_device_name: 'ODP Lama',
        new_device_name: 'ODP Baru',
        validation_status: 'valid',
        odp_type: 'ODP PB',
        installation_type: 'Pole',
        splitter_ratio: '1:8',
        total_ports: 8,
      },
    },
  });

  assert.strictEqual(payload.field_validation_type, 'ODP');
  assert.strictEqual(payload.device.id, 'device-odp');
  assert.strictEqual(payload.device.device_type_key, 'ODP');
  assert.strictEqual(payload.general_validation.device_name, 'ODP Baru');
  assert.strictEqual(payload.general_validation.status, 'valid');
  assert.strictEqual(payload.technical_validation.odp_type, 'ODP PB');
  assert.strictEqual(payload.technical_validation.installation_type, 'Pole');
  assert.strictEqual(payload.technical_validation.splitter_ratio, '1:8');
  assert.strictEqual(payload.technical_validation.total_ports, 8);
  assert.strictEqual(payload.field_validation.old_device_name, 'ODP Lama');
}

function testOdcPayload() {
  const payload = buildGenericFieldValidationPayload({
    device: {
      id: 'device-odc',
      device_type_key: 'ODC',
      device_name: 'ODC A',
      region_id: 'region-1',
    },
    payloadSnapshot: {
      field_validation_type: 'ODC',
      device: {
        status: 'active',
      },
      technical_validation: {
        splitter_ratio: '1:4',
        total_ports: 24,
        capacity_core: 96,
      },
      field_validation: {
        pop_name: 'POP A',
      },
    },
  });

  assert.strictEqual(payload.field_validation_type, 'ODC');
  assert.strictEqual(payload.device.id, 'device-odc');
  assert.strictEqual(payload.device.device_type_key, 'ODC');
  assert.strictEqual(payload.device.status, 'active');
  assert.strictEqual(payload.technical_validation.splitter_ratio, '1:4');
  assert.strictEqual(payload.technical_validation.total_ports, 24);
  assert.strictEqual(payload.technical_validation.capacity_core, 96);
  assert.strictEqual(payload.field_validation.pop_name, 'POP A');
}

function testCablePayload() {
  const payload = buildGenericFieldValidationPayload({
    device: {
      id: 'device-cable',
      device_type_key: 'CABLE',
      device_name: 'Cable Main',
    },
    payloadSnapshot: {
      field_validation_type: 'CABLE',
      field_validation: {
        capacity_core: 144,
        used_core: 12,
        longitude: 106.1,
        latitude: -6.2,
      },
    },
  });

  assert.strictEqual(payload.field_validation_type, 'CABLE');
  assert.strictEqual(payload.device.device_type_key, 'CABLE');
  assert.strictEqual(payload.general_validation.longitude, 106.1);
  assert.strictEqual(payload.general_validation.latitude, -6.2);
  assert.strictEqual(payload.technical_validation.capacity_core, 144);
  assert.strictEqual(payload.technical_validation.used_core, 12);
}

function testUnknownTypeFallback() {
  const payload = buildGenericFieldValidationPayload({
    device: {
      id: 'device-unknown',
      device_type_key: 'SENSOR',
      device_name: 'Sensor A',
      tenant_id: 'tenant-1',
    },
    payloadSnapshot: {
      field_validation: {
        address: 'Jl. Test',
        management_ip: '10.0.0.1',
      },
    },
  });

  assert.strictEqual(payload.field_validation_type, 'SENSOR');
  assert.strictEqual(payload.device.device_type_key, 'SENSOR');
  assert.strictEqual(payload.device.tenant_id, 'tenant-1');
  assert.strictEqual(payload.general_validation.address, 'Jl. Test');
  assert.strictEqual(payload.technical_validation.management_ip, '10.0.0.1');
}

function main() {
  testLegacyOdpPayload();
  testOdcPayload();
  testCablePayload();
  testUnknownTypeFallback();
  console.log('Generic device validation payload unit checks PASSED');
}

main();
