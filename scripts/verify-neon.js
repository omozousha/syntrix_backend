require('dotenv').config();
const { Client } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('ERROR: DATABASE_URL not set in .env');
  process.exit(1);
}

const c = new Client({ connectionString: url });

c.connect()
  .then(() => c.query(`
    SELECT 'devices' as tbl, count(*) as cnt FROM public.devices
    UNION ALL SELECT 'pops', count(*) FROM public.pops
    UNION ALL SELECT 'attachments', count(*) FROM public.attachments
    UNION ALL SELECT 'app_users', count(*) FROM public.app_users
    UNION ALL SELECT 'validation_requests', count(*) FROM public.validation_requests
    UNION ALL SELECT 'auth.users', count(*) FROM auth.users
    UNION ALL SELECT 'storage.files', count(*) FROM storage.files
  `))
  .then(r => { console.table(r.rows); c.end(); })
  .catch(e => { console.error('ERROR:', e.message); process.exit(1); });
