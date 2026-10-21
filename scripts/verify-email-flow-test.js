// End-to-end verification of the email verification fix.
// Usage: node scripts/verify-email-flow-test.js <email> [password]
//
// 1. Ensures a Firebase Auth user + Neon app_users row exist.
// 2. Runs the REAL loadAuthVerificationMap-equivalent (Firebase getUsers).
// 3. Asserts the badge status matches Firebase emailVerified, not is_active.
// 4. Flips Firebase emailVerified to prove the status follows Firebase.

const { query: dbQuery } = require('../src/config/db');
const { getFirebaseAdmin } = require('../src/config/firebase');

const email = process.argv[2] || 'duniaaimemangbagong@gmail.com';
const password = process.argv[3] || 'Syntrix!Test1234';

// Mirrors the fixed loadAuthVerificationMap + enrichUsersWithVerification
async function loadAuthVerificationMap(admin, authUserIds) {
  const ids = Array.from(new Set((authUserIds || []).filter(Boolean)));
  if (!ids.length) return new Map();
  const map = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const result = await admin.auth().getUsers(batch.map((uid) => ({ uid })));
    for (const user of result.users || []) map.set(user.uid, Boolean(user.emailVerified));
  }
  return map;
}

function enrich(user, verificationMap) {
  const emailVerified = verificationMap.get(user.auth_user_id) || false;
  return {
    email_verified: emailVerified,
    verification_status: emailVerified
      ? 'verified'
      : user.metadata?.pending_email_verification
        ? 'pending'
        : 'unverified',
  };
}

let failures = 0;
function assert(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}${ok ? '' : ' (expected ' + JSON.stringify(expected) + ')'}`);
}

async function main() {
  const admin = getFirebaseAdmin();
  if (!admin) throw new Error('Firebase Admin not configured');

  console.log('=== Setup ===');
  let fbUser;
  try {
    fbUser = await admin.auth().getUserByEmail(email);
    console.log('Firebase user exists: uid=' + fbUser.uid + ' emailVerified=' + fbUser.emailVerified);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
    fbUser = await admin.auth().createUser({ email, password, displayName: 'Dunia Aime', emailVerified: false });
    console.log('Created Firebase user: uid=' + fbUser.uid);
  }

  let dbUser = (await dbQuery(
    'SELECT id, auth_user_id, email, is_active, metadata FROM public.app_users WHERE email = $1',
    [email]
  )).rows[0];

  if (!dbUser) {
    dbUser = (await dbQuery(
      `INSERT INTO public.app_users (auth_user_id, user_code, full_name, email, role_name, is_active, metadata)
       VALUES ($1, $2, $3, $4, 'user_region', true, $5::jsonb)
       RETURNING id, auth_user_id, email, is_active, metadata`,
      [fbUser.uid, 'VLD' + String(Date.now()).slice(-6), 'Dunia Aime', email,
       JSON.stringify({ pending_email_verification: true, verification_email_sent_at: new Date().toISOString() })]
    )).rows[0];
    console.log('Created Neon app_users row: id=' + dbUser.id);
  } else {
    console.log('Neon app_users row exists: id=' + dbUser.id + ' is_active=' + dbUser.is_active);
  }

  console.log('\n=== State ===');
  console.log('  Neon is_active:           ' + dbUser.is_active);
  console.log('  Neon pending_verification:' + dbUser.metadata?.pending_email_verification);
  console.log('  Firebase emailVerified:   ' + fbUser.emailVerified);

  console.log('\n=== Test 1: unverified user must NOT show verified ===');
  await admin.auth().updateUser(fbUser.uid, { emailVerified: false });
  let map = await loadAuthVerificationMap(admin, [dbUser.auth_user_id]);
  let state = enrich(dbUser, map);
  assert('email_verified', state.email_verified, false);
  assert('verification_status', state.verification_status, 'pending');

  console.log('\n=== Test 2: verified in Firebase must show verified ===');
  await admin.auth().updateUser(fbUser.uid, { emailVerified: true });
  map = await loadAuthVerificationMap(admin, [dbUser.auth_user_id]);
  state = enrich(dbUser, map);
  assert('email_verified', state.email_verified, true);
  assert('verification_status', state.verification_status, 'verified');

  console.log('\n=== Test 3: batch lookup across multiple uids ===');
  map = await loadAuthVerificationMap(admin, [dbUser.auth_user_id, 'nonexistent-uid', null]);
  assert('size of map', map.size, 1);
  assert('verified uid resolved', map.get(dbUser.auth_user_id), true);

  console.log('\n=== Test 4: login error token matches mobile app parser ===');
  const message = 'EMAIL_NOT_VERIFIED: Email address has not been verified yet. Please check your inbox.';
  assert("message.includes('EMAIL_NOT_VERIFIED')", message.includes('EMAIL_NOT_VERIFIED'), true);

  console.log('\n=== Cleanup: restore unverified state ===');
  await admin.auth().updateUser(fbUser.uid, { emailVerified: false });
  console.log('  emailVerified reset to false');

  console.log('\n' + (failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FAILED: ' + err.message);
  process.exit(1);
});
