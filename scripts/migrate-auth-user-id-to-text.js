require('dotenv').config();
const { query } = require('../src/config/db');

async function migrateAuthUserIdToText() {
  console.log('Altering app_users.auth_user_id from UUID to TEXT...');
  
  // Drop foreign key ke auth.users jika ada (karena auth.users versi Nhost pakai UUID)
  await query(`
    ALTER TABLE public.app_users DROP CONSTRAINT IF EXISTS app_users_auth_user_id_fkey;
  `);

  // Alter column type dari UUID ke TEXT
  await query(`
    ALTER TABLE public.app_users ALTER COLUMN auth_user_id TYPE text USING auth_user_id::text;
  `);

  console.log('SUCCESS! Column app_users.auth_user_id is now TEXT.');
  process.exit(0);
}

migrateAuthUserIdToText().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
