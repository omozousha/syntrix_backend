require('dotenv').config();
const { getFirebaseAdmin } = require('../src/config/firebase');
const { query: dbQuery } = require('../src/config/db');

const DEFAULT_PASSWORD = 'SyntrixUser@2026!';

async function seedFirebaseUsers() {
  console.log('=== Seeding Firebase Auth Users ===\n');

  const admin = getFirebaseAdmin();
  if (!admin) {
    console.error('ERROR: Firebase Admin SDK not configured. Check .env FIREBASE_* variables.');
    process.exit(1);
  }

  const auth = admin.auth();

  const userRes = await dbQuery(`
    SELECT id, email, full_name, role_name, is_active
    FROM public.app_users
    ORDER BY email
  `);

  const users = userRes.rows;
  console.log(`Found ${users.length} users in PostgreSQL app_users.\n`);

  for (const user of users) {
    try {
      let fbUser;
      try {
        fbUser = await auth.getUserByEmail(user.email);
        console.log(`[EXISTS] ${user.email} (UID: ${fbUser.uid})`);
      } catch (err) {
        if (err.code === 'auth/user-not-found') {
          fbUser = await auth.createUser({
            email: user.email,
            emailVerified: true,
            password: DEFAULT_PASSWORD,
            displayName: user.full_name,
            disabled: !user.is_active,
          });
          console.log(`[CREATED] ${user.email} (UID: ${fbUser.uid})`);
        } else {
          throw err;
        }
      }

      // Update auth_user_id di PostgreSQL dengan UID Firebase
      await dbQuery(
        `UPDATE public.app_users SET auth_user_id = $1 WHERE id = $2`,
        [fbUser.uid, user.id]
      );
      console.log(`  └─ Linked app_users.id ${user.id} -> auth_user_id ${fbUser.uid}`);
    } catch (err) {
      console.error(`[ERROR] ${user.email}: ${err.message}`);
    }
  }

  console.log(`\n=== Seeding Finished ===`);
  console.log(`Default password for created users: ${DEFAULT_PASSWORD}`);
  process.exit(0);
}

seedFirebaseUsers().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
