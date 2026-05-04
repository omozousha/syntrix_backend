const { executeHasura } = require('../src/config/hasura');

const TARGET_EMAILS = [
  process.env.VALIDATION_TEST_SUPERADMIN_EMAIL || 'superadmin.test@syntrix.local',
  process.env.VALIDATION_TEST_ADMINREGION_EMAIL || 'adminregion.test@syntrix.local',
  process.env.VALIDATION_TEST_VALIDATOR_EMAIL || 'validator.test@syntrix.local',
  'admin@syntrix.local',
  'admin.ops@syntrix.local',
  'admin.region@syntrix.local',
];

function normalizeRole(roleName) {
  if (roleName === 'admin') return 'superadmin';
  if (roleName === 'user_all_region') return 'adminregion';
  if (roleName === 'user_region') return 'validator';
  return roleName || '-';
}

async function main() {
  const query = `
    query CheckValidationTestAccounts($emailsAuth: [citext!]!, $emailsApp: [String!]!) {
      users(where: { email: { _in: $emailsAuth } }) {
        id
        email
        emailVerified
      }
      appUsers: app_users(where: { email: { _in: $emailsApp } }) {
        id
        auth_user_id
        email
        full_name
        role_name
        is_active
        default_region_id
      }
      scopes: user_region_scopes {
        app_user_id
        region_id
      }
    }
  `;

  const data = await executeHasura(query, { emailsAuth: TARGET_EMAILS, emailsApp: TARGET_EMAILS });
  const authByEmail = new Map((data.users || []).map((u) => [String(u.email || '').toLowerCase(), u]));
  const scopes = data.scopes || [];
  const scopeMap = scopes.reduce((acc, item) => {
    if (!acc[item.app_user_id]) acc[item.app_user_id] = [];
    acc[item.app_user_id].push(item.region_id);
    return acc;
  }, {});

  const report = (data.appUsers || []).map((user) => {
    const authUser = authByEmail.get(String(user.email || '').toLowerCase());
    return {
      email: user.email,
      full_name: user.full_name,
      stored_role: user.role_name,
      normalized_role: normalizeRole(user.role_name),
      app_user_active: Boolean(user.is_active),
      auth_email_verified: Boolean(authUser?.emailVerified),
      default_region_id: user.default_region_id || null,
      region_scopes: scopeMap[user.id] || [],
      ready_for_integration_test: Boolean(user.is_active) && Boolean(authUser?.emailVerified),
    };
  });

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error('check-validation-test-accounts failed:', error.message || error);
  process.exitCode = 1;
});
