function normalizeRoleName(roleName) {
  const role = String(roleName || '').trim().toLowerCase();
  if (role === 'admin') return 'superadmin';
  if (role === 'user_all_region') return 'adminregion';
  if (role === 'user_region') return 'validator';
  return role;
}

function isSuperAdminRole(roleName) {
  return normalizeRoleName(roleName) === 'superadmin';
}

function isRegionalRole(roleName) {
  const normalized = normalizeRoleName(roleName);
  return normalized === 'adminregion' || normalized === 'validator';
}

module.exports = {
  normalizeRoleName,
  isSuperAdminRole,
  isRegionalRole,
};

