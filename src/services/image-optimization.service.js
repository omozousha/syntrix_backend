/**
 * Image Optimization Service using Sharp.
 * Generates 3 variants:
 * 1. Main WebP (max 1920px, quality 80)
 * 2. Thumbnail WebP (200x200px crop, quality 75)
 * 3. LQIP Base64 blur string (20px, quality 20, data URI)
 */
async function processImageBuffer(inputBuffer, filename = 'image.jpg') {
  if (!Buffer.isBuffer(inputBuffer) || inputBuffer.length === 0) {
    throw new Error('Invalid or empty image buffer supplied.');
  }

  let sharp;
  try {
    sharp = require('sharp');
  } catch (err) {
    console.error('Sharp module failed to load:', err.message);
    throw new Error('Image optimization service unavailable (sharp library not loaded).');
  }

  const sharpInstance = sharp(inputBuffer);
  const metadata = await sharpInstance.metadata();

  // 1. Primary Main WebP (max 1920px width/height)
  const mainBuffer = await sharp(inputBuffer)
    .resize(1920, 1920, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 80 })
    .toBuffer();

  const mainMeta = await sharp(mainBuffer).metadata();

  // 2. Thumbnail WebP (exact 200x200px square crop)
  const thumbBuffer = await sharp(inputBuffer)
    .resize(200, 200, {
      fit: 'cover',
      position: 'center',
    })
    .webp({ quality: 75 })
    .toBuffer();

  // 3. LQIP Base64 Blur Placeholder (tiny 20px image, blurred)
  const lqipBuffer = await sharp(inputBuffer)
    .resize(20, 20, {
      fit: 'inside',
    })
    .blur(2)
    .webp({ quality: 20 })
    .toBuffer();

  const blurDataUrl = `data:image/webp;base64,${lqipBuffer.toString('base64')}`;

  const originalName = filename.replace(/\.[^/.]+$/, '');
  const cleanName = `${originalName}.webp`;

  return {
    filename: cleanName,
    width: mainMeta.width || metadata.width || 0,
    height: mainMeta.height || metadata.height || 0,
    originalSizeBytes: inputBuffer.length,
    sizeBytes: mainBuffer.length,
    thumbSizeBytes: thumbBuffer.length,
    savingsPercentage: Math.round(((inputBuffer.length - mainBuffer.length) / inputBuffer.length) * 100),
    mainBuffer,
    thumbBuffer,
    blurDataUrl,
    mimeType: 'image/webp',
  };
}

module.exports = {
  processImageBuffer,
};
