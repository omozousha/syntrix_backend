const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('🧪 Checking route file require resolution...');

try {
  const routesPath = path.join(__dirname, '../src/modules/resource/resource.routes.js');
  const servicePath = path.join(__dirname, '../src/services/image-optimization.service.js');

  assert(fs.existsSync(routesPath), 'resource.routes.js must exist');
  assert(fs.existsSync(servicePath), 'image-optimization.service.js must exist');

  // Dry run require to verify no syntax errors
  const service = require('../src/services/image-optimization.service');
  assert.strictEqual(typeof service.processImageBuffer, 'function', 'processImageBuffer must be a function');

  console.log('🎉 Require paths successfully resolved and validated!');
} catch (err) {
  console.error('❌ Require path validation failed:', err);
  process.exit(1);
}
