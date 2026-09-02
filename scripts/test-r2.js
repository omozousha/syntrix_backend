require('dotenv').config();
const { S3Client, PutObjectCommand, HeadBucketCommand, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});

const BUCKET = process.env.R2_BUCKET_NAME || 'syntrix-storage';

async function test() {
  console.log('=== Cloudflare R2 Test ===');
  console.log('Bucket:', BUCKET);
  console.log('Public URL:', process.env.R2_PUBLIC_URL);

  try {
    // Test 1: Check bucket access
    console.log('\n[1] Checking bucket access...');
    await r2.send(new HeadBucketCommand({ Bucket: BUCKET }));
    console.log('✅ Bucket accessible');

    // Test 2: Upload test file
    console.log('\n[2] Uploading test file...');
    const testKey = '_r2_test.txt';
    const testBody = `R2 connectivity test - ${new Date().toISOString()}`;
    await r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: testKey,
      Body: testBody,
      ContentType: 'text/plain',
    }));
    console.log('✅ Upload success');

    // Test 3: List objects
    console.log('\n[3] Listing objects...');
    const listResult = await r2.send(new ListObjectsV2Command({ Bucket: BUCKET, MaxKeys: 10 }));
    console.log('✅ Objects found:', listResult.KeyCount || 0);

    // Test 4: Check public URL
    const publicUrl = `${process.env.R2_PUBLIC_URL}/${testKey}`;
    console.log('\n[4] Public URL test:', publicUrl);

    // Test 5: Clean up test file
    console.log('\n[5] Deleting test file...');
    await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: testKey }));
    console.log('✅ Cleanup success');

    console.log('\n🎉 All R2 tests passed!');
  } catch (err) {
    console.error('\n❌ R2 test failed:', err.message);
    console.error('   Error name:', err.name);
    if (err.$metadata) {
      console.error('   HTTP status:', err.$metadata.httpStatusCode);
    }
  }
}

test();
