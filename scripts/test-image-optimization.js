const assert = require('assert');
const sharp = require('sharp');
const { processImageBuffer } = require('../src/services/image-optimization.service');

async function runTest() {
  console.log('🧪 Starting Image Optimization Service Unit Test...');

  // Create a dummy high-res image (3000x2000 SVG rasterized to JPEG buffer)
  const sampleSvg = `<svg width="3000" height="2000" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#1e293b"/>
    <circle cx="1500" cy="1000" r="800" fill="#3b82f6"/>
    <text x="1500" y="1050" font-size="120" fill="#ffffff" text-anchor="middle">Syntrix High-Res Test Image</text>
  </svg>`;

  const inputBuffer = await sharp(Buffer.from(sampleSvg))
    .jpeg({ quality: 100 })
    .toBuffer();

  console.log(`📷 Input Raw Image Size: ${(inputBuffer.length / 1024).toFixed(2)} KB`);

  // Process image
  const result = await processImageBuffer(inputBuffer, 'test-odp-photo.jpg');

  console.log(`✅ Main WebP Size: ${(result.sizeBytes / 1024).toFixed(2)} KB`);
  console.log(`✅ Thumbnail WebP Size: ${(result.thumbSizeBytes / 1024).toFixed(2)} KB`);
  console.log(`✅ Savings: ${result.savingsPercentage}%`);
  console.log(`✅ Dimensions: ${result.width}x${result.height}`);
  console.log(`✅ LQIP Data URI: ${result.blurDataUrl.substring(0, 60)}... (${result.blurDataUrl.length} chars)`);

  // Assertions
  assert.strictEqual(result.filename, 'test-odp-photo.webp');
  assert.strictEqual(result.mimeType, 'image/webp');
  assert(result.width <= 1920, 'Width should be scaled down to <= 1920px');
  assert(result.height <= 1920, 'Height should be scaled down to <= 1920px');
  assert(result.blurDataUrl.startsWith('data:image/webp;base64,'), 'LQIP must be valid WebP data URI');
  assert(result.sizeBytes < inputBuffer.length, 'Compressed size must be smaller than raw size');

  console.log('\n🎉 ALL PHASE 1 TESTS PASSED SUCCESSFULLY!');
}

runTest().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
