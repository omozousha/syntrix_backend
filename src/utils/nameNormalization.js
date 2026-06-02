function normalizeSpacing(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizePopName(value) {
  const text = normalizeSpacing(value);
  if (!text) return '';

  return text
    .toLocaleLowerCase('id-ID')
    .replace(/(^|\s)(\S)/g, (match, prefix, letter) => `${prefix}${letter.toLocaleUpperCase('id-ID')}`);
}

function normalizeDeviceName(value) {
  return normalizeSpacing(value).toLocaleUpperCase('id-ID');
}

function applyResourceNameNormalization(resourceName, object) {
  if (!object || typeof object !== 'object') return object;

  if (resourceName === 'pops' && object.pop_name != null) {
    object.pop_name = normalizePopName(object.pop_name);
  }

  if (resourceName === 'devices' && object.device_name != null) {
    object.device_name = normalizeDeviceName(object.device_name);
  }

  return object;
}

module.exports = {
  normalizePopName,
  normalizeDeviceName,
  applyResourceNameNormalization,
};
