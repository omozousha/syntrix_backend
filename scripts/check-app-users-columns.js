require('dotenv').config();
const { query } = require('../src/config/db');

async function main() {
  const res = await query(`
    SELECT column_name, data_type, character_maximum_length
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'app_users'
    ORDER BY ordinal_position
  `);
  console.log('Columns in app_users:');
  console.table(res.rows);
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
