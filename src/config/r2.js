const { S3Client } = require('@aws-sdk/client-s3');
const { env } = require('./env');

const accountId = String(env.r2AccountId || '').replace(/[\r\n\t\s]/g, '').trim();
const accessKeyId = String(env.r2AccessKeyId || '').replace(/[\r\n\t\s]/g, '').trim();
const secretAccessKey = String(env.r2SecretAccessKey || '').replace(/[\r\n\t\s]/g, '').trim();
const bucketName = String(env.r2BucketName || 'syntrix-storage').replace(/[\r\n\t\s]/g, '').trim();
const publicUrl = String(env.r2PublicUrl || '').replace(/[\r\n\t\s]/g, '').trim();

const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
  forcePathStyle: true,
});

const R2_CONFIG = {
  bucketName,
  publicUrl,
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
};

function getPublicFileUrl(filename) {
  if (!R2_CONFIG.publicUrl) return null;
  return `${R2_CONFIG.publicUrl}/${filename}`;
}

module.exports = { r2Client, R2_CONFIG, getPublicFileUrl };
