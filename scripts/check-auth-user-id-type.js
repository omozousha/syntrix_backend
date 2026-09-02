require('dotenv').config();
const { query } = require('../src/config/db');

async function check() {
  const res = await query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'app_users'
    AND column_name IN ('id', 'auth_user_id')
    ORDER BY column_name;
  `);
  console.log('app_users column types:');
  console.table(res.rows);
  process.exit(0);
}

check().catch(e => { console.error(e.message); process.exit(1); });
