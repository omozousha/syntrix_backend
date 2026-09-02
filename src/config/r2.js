const { S3Client } = require('@aws-sdk/client-s3');
const { env } = require('./env');

const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${env.r2AccountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.r2AccessKeyId,
    secretAccessKey: env.r2SecretAccessKey,
  },
  forcePathStyle: true,
});

const R2_CONFIG = {
  bucketName: env.r2BucketName || 'syntrix-storage',
  publicUrl: env.r2PublicUrl || '',
  region: 'auto',
  endpoint: `https://${env.r2AccountId}.r2.cloudflarestorage.com`,
};

function getPublicFileUrl(filename) {
  if (!R2_CONFIG.publicUrl) return null;
  return `${R2_CONFIG.publicUrl}/${filename}`;
}

module.exports = { r2Client, R2_CONFIG, getPublicFileUrl };
