function slugifyCodePart(value, fallback = 'GEN') {
  return String(value || fallback)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 12) || fallback;
}

function buildEntityCode(prefix, suffix) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${slugifyCodePart(prefix)}-${date}-${slugifyCodePart(suffix, '001')}`;
}

module.exports = { slugifyCodePart, buildEntityCode };
