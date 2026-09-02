const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { r2Client, R2_CONFIG } = require('../config/r2');

async function uploadFile(buffer, key, contentType) {
  const command = new PutObjectCommand({
    Bucket: R2_CONFIG.bucketName,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await r2Client.send(command);
  return { key, url: `${R2_CONFIG.publicUrl}/${key}` };
}

async function deleteFile(key) {
  const command = new DeleteObjectCommand({
    Bucket: R2_CONFIG.bucketName,
    Key: key,
  });
  await r2Client.send(command);
  return { success: true };
}

async function getPresignedUrl(key, expiresIn = 3600) {
  const command = new GetObjectCommand({
    Bucket: R2_CONFIG.bucketName,
    Key: key,
  });
  return getSignedUrl(r2Client, command, { expiresIn });
}

async function getPublicUrl(key) {
  return `${R2_CONFIG.publicUrl}/${key}`;
}

async function fileExists(key) {
  try {
    const command = new HeadObjectCommand({
      Bucket: R2_CONFIG.bucketName,
      Key: key,
    });
    await r2Client.send(command);
    return true;
  } catch {
    return false;
  }
}

async function getFileStream(key) {
  const command = new GetObjectCommand({
    Bucket: R2_CONFIG.bucketName,
    Key: key,
  });
  const response = await r2Client.send(command);
  return response.Body;
}

module.exports = { uploadFile, deleteFile, getPresignedUrl, getPublicUrl, fileExists, getFileStream };
