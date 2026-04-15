const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '../.env');

const requiredKeys = [
  'HASURA_URL',
  'HASURA_ADMIN_SECRET',
  'NHOST_AUTH_URL',
  'NHOST_STORAGE_URL',
  'SMOKE_ADMIN_EMAIL',
  'SMOKE_ADMIN_PASSWORD',
];

const optionalKeys = ['BOOTSTRAP_ADMIN_SECRET'];

function parseEnv(contents) {
  return contents
    .split(/\r?\n/)
    .filter((line) => line && !line.trim().startsWith('#') && line.includes('='))
    .reduce((acc, line) => {
      const idx = line.indexOf('=');
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      acc[key] = value;
      return acc;
    }, {});
}

if (!fs.existsSync(envPath)) {
  console.error('Missing .env file at project root');
  process.exit(1);
}

const env = parseEnv(fs.readFileSync(envPath, 'utf8'));

const missingRequired = requiredKeys.filter((key) => !env[key]);
const missingOptional = optionalKeys.filter((key) => !env[key]);

console.log('CI secrets source check from .env');
console.log('Required keys:');
for (const key of requiredKeys) {
  console.log(`- ${key}: ${env[key] ? 'OK' : 'MISSING'}`);
}

if (optionalKeys.length) {
  console.log('Optional keys:');
  for (const key of optionalKeys) {
    console.log(`- ${key}: ${env[key] ? 'OK' : 'MISSING'}`);
  }
}

if (missingRequired.length) {
  console.error(`Missing required keys: ${missingRequired.join(', ')}`);
  process.exit(1);
}

if (missingOptional.length) {
  console.log(`Optional keys not set: ${missingOptional.join(', ')}`);
}

console.log('All required CI keys are present in .env');
