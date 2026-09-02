const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { Pool } = require('pg');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const NHOST_STORAGE_URL = process.env.NHOST_STORAGE_URL || 'https://ctliinjmcfksgeerilcu.storage.ap-southeast-1.nhost.run/v1';
const HASURA_ADMIN_SECRET = process.env.HASURA_ADMIN_SECRET;

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '',
  database: process.env.PGDATABASE || 'syntrix',
});

const OUTPUT_DIR = path.resolve(__dirname, '../database/storage_files');

function downloadFile(fileId, filename, destinationPath) {
  return new Promise((resolve, reject) => {
    const url = `${NHOST_STORAGE_URL}/files/${fileId}`;
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;

    const req = client.get(url, {
      headers: {
        'x-hasura-admin-secret': HASURA_ADMIN_SECRET || '',
      },
      timeout: 30000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Handle redirect
        https.get(res.headers.location, (redirectRes) => {
          if (redirectRes.statusCode !== 200) {
            return reject(new Error(`HTTP ${redirectRes.statusCode}`));
          }
          const fileStream = fs.createWriteStream(destinationPath);
          redirectRes.pipe(fileStream);
          fileStream.on('finish', () => {
            fileStream.close();
            resolve();
          });
        }).on('error', reject);
        return;
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} ${res.statusMessage}`));
      }

      const fileStream = fs.createWriteStream(destinationPath);
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('=== Syntrix Nhost Storage File Downloader ===');
  console.log(`Storage URL: ${NHOST_STORAGE_URL}`);
  console.log(`Output Directory: ${OUTPUT_DIR}\n`);

  console.log('Connecting to local database to retrieve file list...');
  const client = await pool.connect();
  
  const query = `
    SELECT 
      sf.id,
      sf.name,
      sf.size,
      sf.mime_type,
      sf.bucket_id,
      a.original_name,
      a.extension,
      a.file_category
    FROM storage.files sf
    LEFT JOIN public.attachments a ON a.storage_file_id = sf.id
    ORDER BY sf.created_at ASC;
  `;

  const { rows: files } = await client.query(query);
  client.release();
  await pool.end();

  console.log(`Found ${files.length} total files to download.\n`);

  let successCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const failedList = [];

  const BATCH_CONCURRENCY = 5;

  for (let i = 0; i < files.length; i += BATCH_CONCURRENCY) {
    const batch = files.slice(i, i + BATCH_CONCURRENCY);
    
    await Promise.all(
      batch.map(async (file, batchIndex) => {
        const globalIndex = i + batchIndex + 1;
        const ext = file.extension ? `.${file.extension.replace(/^\./, '')}` : (file.name && path.extname(file.name)) || '';
        const safeName = file.original_name || file.name || file.id;
        const destFilename = `${file.id}${ext}`;
        const destPath = path.join(OUTPUT_DIR, destFilename);

        // Check if already downloaded
        if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
          process.stdout.write(`[${globalIndex}/${files.length}] ALREADY EXISTS: ${destFilename}\n`);
          skippedCount++;
          return;
        }

        try {
          process.stdout.write(`[${globalIndex}/${files.length}] Downloading: ${destFilename} (${file.size ? (file.size/1024).toFixed(1) + ' KB' : '?'}) ... `);
          await downloadFile(file.id, safeName, destPath);
          console.log('OK');
          successCount++;
        } catch (err) {
          console.log(`FAILED (${err.message})`);
          failedCount++;
          failedList.push({ id: file.id, name: safeName, error: err.message });
          // Remove empty/corrupted file
          if (fs.existsSync(destPath)) {
            try { fs.unlinkSync(destPath); } catch (_) {}
          }
        }
      })
    );
  }

  console.log('\n======================================');
  console.log(`Download Summary:`);
  console.log(`  Total:     ${files.length}`);
  console.log(`  Success:   ${successCount}`);
  console.log(`  Skipped:   ${skippedCount}`);
  console.log(`  Failed:    ${failedCount}`);
  console.log('======================================');

  if (failedList.length > 0) {
    const failedLogPath = path.join(OUTPUT_DIR, 'failed_downloads.json');
    fs.writeFileSync(failedLogPath, JSON.stringify(failedList, null, 2));
    console.log(`Failed file list saved to: ${failedLogPath}`);
    console.log('\nNote: If all downloads failed with DNS/Connection error, the Nhost project is still paused.');
    console.log('Once you unpause the project (by upgrading to Pro temporarily), run this script again:');
    console.log('  npm run storage:download');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
