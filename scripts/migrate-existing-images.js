const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });

const { executeHasura } = require('../src/config/hasura');
const { nhostStorageClient } = require('../src/config/nhost');
const { processImageBuffer } = require('../src/services/image-optimization.service');

class FormDataBuilder {
  constructor() {
    this.boundary = `--------------------------${Math.random().toString(36).substring(2, 15)}`;
    this.parts = [];
  }
  append(name, buffer, options) {
    let part = `--${this.boundary}\r\n`;
    part += `Content-Disposition: form-data; name="${name}"; filename="${options.filename}"\r\n`;
    part += `Content-Type: ${options.contentType}\r\n\r\n`;
    this.parts.push(Buffer.concat([Buffer.from(part), buffer, Buffer.from('\r\n')]));
  }
  getHeaders() {
    return {
      'Content-Type': `multipart/form-data; boundary=${this.boundary}`,
    };
  }
  toBuffer() {
    return Buffer.concat([...this.parts, Buffer.from(`--${this.boundary}--\r\n`)]);
  }
}

async function uploadNhostBuffer(buffer, filename, mimeType) {
  const fd = new FormDataBuilder();
  fd.append('file[]', buffer, { filename, contentType: mimeType });

  const { data } = await nhostStorageClient.post('/files', fd.toBuffer(), {
    headers: {
      ...fd.getHeaders(),
      'x-hasura-admin-secret': process.env.HASURA_ADMIN_SECRET,
    },
  });
  return data;
}

async function fetchImageBuffer(storageFileId) {
  const response = await nhostStorageClient.get(`/files/${storageFileId}`, {
    headers: {
      'x-hasura-admin-secret': process.env.HASURA_ADMIN_SECRET,
    },
    responseType: 'arraybuffer',
  });
  return Buffer.from(response.data);
}

async function processSingleImage(storageId, originalName) {
  const rawBuffer = await fetchImageBuffer(storageId);
  const processed = await processImageBuffer(rawBuffer, originalName || 'image.jpg');

  const mainUpload = await uploadNhostBuffer(processed.mainBuffer, processed.filename, 'image/webp');
  const thumbUpload = await uploadNhostBuffer(processed.thumbBuffer, `thumb-${processed.filename}`, 'image/webp');

  const mainStorageId = mainUpload.processedFiles?.[0]?.id || mainUpload.id;
  const thumbStorageId = thumbUpload.processedFiles?.[0]?.id || thumbUpload.id;

  const mainUrl = `${process.env.NHOST_STORAGE_URL}/files/${mainStorageId}`;
  const thumbUrl = `${process.env.NHOST_STORAGE_URL}/files/${thumbStorageId}`;

  return {
    storageFileId: mainStorageId,
    thumbStorageId,
    name: processed.filename,
    url: mainUrl,
    thumbUrl,
    blurDataUrl: processed.blurDataUrl,
    width: processed.width,
    height: processed.height,
    sizeBytes: processed.sizeBytes,
    originalSizeBytes: processed.originalSizeBytes,
    savingsPercentage: processed.savingsPercentage,
  };
}

async function runFullMigration() {
  console.log('🚀 STARTING IMAGE MIGRATION PIPELINE...');

  // STEP 1: Process `attachments` table
  console.log('\n--- PHASE 1: Optimizing Master `attachments` Table ---');
  const queryAttachments = `
    query GetImageAttachments {
      attachments(
        where: { mime_type: { _ilike: "image/%" } }
        order_by: { created_at: desc }
      ) {
        id
        storage_file_id
        original_name
        mime_type
        metadata
        entity_type
        entity_id
      }
    }
  `;

  const { attachments } = await executeHasura(queryAttachments);
  console.log(`Found ${attachments.length} total image records in master attachments.`);

  const attachmentMap = new Map();
  let attSuccess = 0;
  let attSkipped = 0;
  let attError = 0;

  for (const item of attachments) {
    const meta = item.metadata || {};

    if (meta.optimized === true && meta.url && meta.thumbUrl) {
      attachmentMap.set(item.id, {
        id: item.id,
        storage_file_id: item.storage_file_id,
        url: meta.url,
        thumbUrl: meta.thumbUrl,
        blurDataUrl: meta.blurDataUrl,
        width: meta.width,
        height: meta.height,
        sizeBytes: meta.size_bytes,
        name: item.original_name,
      });
      attSkipped++;
      continue;
    }

    const storageId = item.storage_file_id;
    if (!storageId) {
      attSkipped++;
      continue;
    }

    console.log(`📷 Optimizing Attachment [${item.id}] - ${item.original_name}...`);
    try {
      const result = await processSingleImage(storageId, item.original_name);

      const updatedMetadata = {
        ...meta,
        optimized: true,
        original_storage_file_id: storageId,
        thumb_storage_file_id: result.thumbStorageId,
        url: result.url,
        thumbUrl: result.thumbUrl,
        blurDataUrl: result.blurDataUrl,
        width: result.width,
        height: result.height,
        size_bytes: result.sizeBytes,
        original_size_bytes: result.originalSizeBytes,
        savings_percentage: result.savingsPercentage,
        optimized_at: new Date().toISOString(),
      };

      const updateMutation = `
        mutation UpdateAttachmentMetadata($id: uuid!, $storageFileId: uuid!, $metadata: jsonb!, $sizeBytes: bigint!) {
          update_attachments_by_pk(
            pk_columns: { id: $id },
            _set: {
              storage_file_id: $storageFileId,
              mime_type: "image/webp",
              size_bytes: $sizeBytes,
              metadata: $metadata
            }
          ) {
            id
          }
        }
      `;

      await executeHasura(updateMutation, {
        id: item.id,
        storageFileId: result.storageFileId,
        sizeBytes: result.sizeBytes,
        metadata: updatedMetadata,
      });

      const optData = {
        id: item.id,
        storage_file_id: result.storageFileId,
        url: result.url,
        thumbUrl: result.thumbUrl,
        blurDataUrl: result.blurDataUrl,
        width: result.width,
        height: result.height,
        sizeBytes: result.sizeBytes,
        name: result.name,
      };

      attachmentMap.set(item.id, optData);
      attSuccess++;
      console.log(`   ✅ Optimized (Savings: ${result.savingsPercentage}%).`);
    } catch (err) {
      console.error(`   ❌ Error [${item.id}]:`, err.message);
      attError++;
    }
  }

  console.log(`Phase 1 complete: ${attSuccess} optimized, ${attSkipped} skipped, ${attError} errors.`);

  // STEP 2: Sync to `devices.image_attachments` JSONB arrays
  console.log('\n--- PHASE 2: Syncing `devices.image_attachments` JSONB ---');
  const queryDevices = `
    query GetDevicesWithImages {
      devices(
        where: { image_attachments: { _is_null: false }, deleted_at: { _is_null: true } }
      ) {
        id
        device_name
        image_attachments
      }
    }
  `;

  const { devices } = await executeHasura(queryDevices);
  let devSuccess = 0;

  for (const dev of devices) {
    let list = [];
    try {
      list = Array.isArray(dev.image_attachments) ? dev.image_attachments : JSON.parse(dev.image_attachments || '[]');
    } catch {
      continue;
    }

    if (!list.length) continue;

    let updated = false;
    const newList = list.map((item) => {
      const attId = item.id || item.attachment_id;
      const match = attachmentMap.get(attId);
      if (match) {
        updated = true;
        return {
          ...item,
          url: match.url,
          thumbUrl: match.thumbUrl,
          blurDataUrl: match.blurDataUrl,
          width: match.width,
          height: match.height,
          size_bytes: match.sizeBytes,
          storage_file_id: match.storage_file_id,
        };
      }
      return item;
    });

    if (updated) {
      const devMutation = `
        mutation UpdateDeviceAttachments($id: uuid!, $attachments: jsonb!) {
          update_devices_by_pk(pk_columns: { id: $id }, _set: { image_attachments: $attachments }) {
            id
          }
        }
      `;
      await executeHasura(devMutation, { id: dev.id, attachments: newList });
      devSuccess++;
    }
  }

  console.log(`Phase 2 complete: ${devSuccess} devices synced.`);
  console.log('\n🎉 FULL MIGRATION COMPLETE SUCCESSFULLY!');
}

runFullMigration().catch((err) => {
  console.error('Fatal Migration Error:', err);
  process.exit(1);
});
