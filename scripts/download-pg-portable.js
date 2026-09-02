const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const url = 'https://get.enterprisedb.com/postgresql/postgresql-16.2-1-windows-x64-binaries.zip';
const targetPath = path.resolve('D:/Follow The Beat/Req/Syntrix/syntrix_backend/database/pgsql-portable.zip');

console.log('Downloading PostgreSQL portable binaries...');
console.log('URL:', url);
console.log('Target:', targetPath);

const file = fs.createWriteStream(targetPath);

function download(downloadUrl) {
  const parsed = new URL(downloadUrl);
  const client = parsed.protocol === 'https:' ? https : http;

  client.get(downloadUrl, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      console.log('Redirecting to:', res.headers.location);
      return download(res.headers.location);
    }

    if (res.statusCode !== 200) {
      console.error('HTTP Error:', res.statusCode, res.statusMessage);
      process.exit(1);
    }

    const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
    let downloadedBytes = 0;

    res.on('data', (chunk) => {
      downloadedBytes += chunk.length;
      if (totalBytes > 0) {
        const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1);
        process.stdout.write(`\rProgress: ${(downloadedBytes / (1024*1024)).toFixed(1)} / ${(totalBytes / (1024*1024)).toFixed(1)} MB (${percent}%)`);
      } else {
        process.stdout.write(`\rDownloaded: ${(downloadedBytes / (1024*1024)).toFixed(1)} MB`);
      }
    });

    res.pipe(file);

    file.on('finish', () => {
      file.close(() => {
        console.log('\n\nSUCCESS! Portable PostgreSQL downloaded.');
      });
    });
  }).on('error', (err) => {
    fs.unlink(targetPath, () => {});
    console.error('\nDownload error:', err.message);
    process.exit(1);
  });
}

download(url);
