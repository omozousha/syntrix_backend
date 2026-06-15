const DEFAULT_COLOR_STANDARD = 'TIA_EIA_598_12_COLOR';
const DEFAULT_CORES_PER_TUBE = 12;

const FIBER_COLOR_CYCLE = [
  { name: 'Blue', hex: '#2563EB' },
  { name: 'Orange', hex: '#F97316' },
  { name: 'Green', hex: '#16A34A' },
  { name: 'Brown', hex: '#92400E' },
  { name: 'Slate', hex: '#475569' },
  { name: 'White', hex: '#F8FAFC' },
  { name: 'Red', hex: '#DC2626' },
  { name: 'Black', hex: '#111827' },
  { name: 'Yellow', hex: '#EAB308' },
  { name: 'Violet', hex: '#7C3AED' },
  { name: 'Rose', hex: '#E11D48' },
  { name: 'Aqua', hex: '#06B6D4' },
];

function normalizeCoresPerTube(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_CORES_PER_TUBE;
}

function getFiberColorBySequence(sequenceNo) {
  const index = ((Number(sequenceNo) - 1) % FIBER_COLOR_CYCLE.length + FIBER_COLOR_CYCLE.length) % FIBER_COLOR_CYCLE.length;
  return FIBER_COLOR_CYCLE[index];
}

function buildFiberCorePhysicalFields(coreNo, options = {}) {
  const normalizedCoreNo = Math.max(1, Number(coreNo) || 1);
  const coresPerTube = normalizeCoresPerTube(options.coresPerTube);
  const tubeNo = Math.floor((normalizedCoreNo - 1) / coresPerTube) + 1;
  const coreColor = getFiberColorBySequence(normalizedCoreNo);
  const tubeColor = getFiberColorBySequence(tubeNo);

  return {
    tube_no: tubeNo,
    tube_color_name: tubeColor.name,
    tube_color_hex: tubeColor.hex,
    color_standard: options.colorStandard || DEFAULT_COLOR_STANDARD,
    cores_per_tube: coresPerTube,
    color_name: coreColor.name,
    color_hex: coreColor.hex,
  };
}

function getDeviceCoresPerTube(device = {}) {
  const candidates = [
    device.cores_per_tube,
    device.specifications?.cores_per_tube,
    device.specifications?.fiber?.cores_per_tube,
    device.specifications?.cable?.cores_per_tube,
    device.custom_fields?.cores_per_tube,
    device.custom_fields?.fiber?.cores_per_tube,
    device.custom_fields?.cable?.cores_per_tube,
  ];
  const matched = candidates.find((value) => normalizeCoresPerTube(value) === Number(value));
  return normalizeCoresPerTube(matched);
}

function needsFiberCorePhysicalRepair(row = {}, expected = {}) {
  return (
    row.tube_no == null
    || Number(row.tube_no) !== Number(expected.tube_no)
    || !row.tube_color_name
    || !row.tube_color_hex
    || !row.color_name
    || !row.color_hex
    || !row.color_standard
    || Number(row.cores_per_tube || 0) !== Number(expected.cores_per_tube)
  );
}

module.exports = {
  DEFAULT_COLOR_STANDARD,
  DEFAULT_CORES_PER_TUBE,
  FIBER_COLOR_CYCLE,
  buildFiberCorePhysicalFields,
  getDeviceCoresPerTube,
  needsFiberCorePhysicalRepair,
  normalizeCoresPerTube,
};
