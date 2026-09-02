const https = require('https');
const fs = require('fs');
const path = require('path');

const url = "https://nhost-production-ap-southeast-1-database-backups.s3.ap-southeast-1.amazonaws.com/f6bae742-0b76-44d7-8a62-e2ea86fb8eca/3767b223-8be3-41a6-b41e-694604767043?response-content-disposition=inline&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Security-Token=IQoJb3JpZ2luX2VjEPD%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FwEaDmFwLXNvdXRoZWFzdC0xIkcwRQIgVqv1teuj1RDbadFo88%2BGC1fie%2F0TFUJCm0jtzXKxQyECIQDBYTqOb9kmChUMB6gHhIEFeEVBmEOpHjaeEn%2BZKhff9irbAwi5%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F8BEAEaDDE2MzU4MjYzNjk2NiIMQuAllGMPJ7%2FpRZ9cKq8DMmmtWSiQnNCaN3HgiZcS8JLQdgImdke4Y8B5Crz78jJpE0bYVq%2BCzBPjsrwFIyXdkgKwHyiFWC2GdQ%2FrplwkmpMdzc%2BOXk2HNVUXpoto58Kzlw7N1usHvyuL9N5KjBFtnXo94acdDJgFok%2Fnx0JYLT6ApNlmGzWzJH2kqgHvogXJnN%2BR8Ic3o%2Fb0tfx4qKTQM2FX8oUnZ2ZxAmBL9bKKvxcxqjmelsPUnJB%2F2MvG23CWjJwiPekQsE5rGoU0Mv33j6oZhUGDVqb852VFj9DIHpbDh5eKpMzOjlKfrDzsgXCU1LJoRgGRybxy9%2FU9lnQXw1NrarkFt%2Fbf6kUAPhy1B9c0u0IeXjmj%2BPGViwge5OSikBdUJRbuArm0J%2FE4rNOD9ifjkv9pZY6Nb5yrQoyBsa2AutuEtpeYPYCCaerOreF6nK5gCIgDl8o%2B92TORuCpOSZs8y%2FDZzqxqxczhhB5fefg4RzFR%2Fg3D%2FSZquNdyr5JwufDj7hjXgjGOB4Zj5gE3DVqccZKyln1n3%2BhK119gM1qAYN6oWWHeWuBTw8q7a5DLlruEnh2KTRvX6NEhjIwk6Wl1AY63gKAwitMKfX7103r%2FyfzDPmTzk%2F%2FJbuYLUl98qCLTR0LjVcDWW8kJsBzfVU1DZQjFlWPiMt8uq4tb%2BMQp6xu6ZoUeiU%2FZ5f%2BkGdSB9s%2BUuQdqhWaH9Yz4S2edmrwMMFHbe3l7%2FZzw%2FG%2BYs406%2FBj56479XW1taapeR6EjUzPd4SEGMByFQTRCgXcoxozw%2FeTg3DQoXQLtRPgCW7gJsg1W5aYqeWvSYZiIf0l9wLbRHcsWeN09hU5ZQZwTz%2FkkauXPeadaSYTGeyn%2FinEqhWkUeXjr2iYrpnHSOMpripdBlqMcNoapn0nyjIJu5Va0Q71Tq6ElhubkbI0IVbK4czEaSx3XZEcLYN%2FlaurNPUhzTnGV83Io60Hj9iFYnNby7YyTAHBokUuKyC%2FZZ1vQmFi%2BB0r5LYz14miSTZt0aftwm5kcnB9k3NNSlc%2BGIKeHv7Wwe2%2BaESvYqGr1U9CiyjJZQ%3D%3D&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ASIASMFSI6OTGWWYGIHR%2F20260822%2Fap-southeast-1%2Fs3%2Faws4_request&X-Amz-Date=20260822T075203Z&X-Amz-Expires=43200&X-Amz-SignedHeaders=host&X-Amz-Signature=79b612c236f87d680a6c90704c19266b610f1cf3f575e02d20975b97eaa02b52";

const targetPath = path.resolve('D:/Follow The Beat/Req/Syntrix/syntrix_backend/database/backups/nhost_dump.sql.gz');

console.log('Downloading dump from Nhost S3...');
console.log('Destination:', targetPath);

const file = fs.createWriteStream(targetPath);

function download(downloadUrl) {
  https.get(downloadUrl, (response) => {
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
      console.log('Redirecting to:', response.headers.location);
      return download(response.headers.location);
    }
    
    if (response.statusCode !== 200) {
      console.error('HTTP Error:', response.statusCode, response.statusMessage);
      process.exit(1);
    }

    const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
    let downloadedBytes = 0;
    
    response.on('data', (chunk) => {
      downloadedBytes += chunk.length;
      if (totalBytes > 0) {
        const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1);
        process.stdout.write(`\rProgress: ${downloadedBytes} / ${totalBytes} bytes (${percent}%)`);
      } else {
        process.stdout.write(`\rDownloaded: ${downloadedBytes} bytes`);
      }
    });

    response.pipe(file);

    file.on('finish', () => {
      file.close(() => {
        console.log('\n\nSUCCESS! File saved successfully.');
        const stat = fs.statSync(targetPath);
        console.log(`File size: ${(stat.size / (1024 * 1024)).toFixed(2)} MB (${stat.size} bytes)`);
      });
    });
  }).on('error', (err) => {
    fs.unlink(targetPath, () => {});
    console.error('\nDownload failed:', err.message);
    process.exit(1);
  });
}

download(url);
