require('dotenv').config();
const http = require('http');

async function run() {
  // Step 1: Login
  console.log('1. Login...');
  const loginRes = await fetch('http://localhost:3000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin.ops@syntrix.local', password: 'SyntrixUser@2026!' }),
  });
  const loginData = await loginRes.json();
  console.log('Login status:', loginRes.status, loginData.message);
  const token = loginData?.data?.session?.accessToken;
  console.log('Token length:', token?.length);

  // Step 2: /auth/me
  console.log('\n2. GET /auth/me...');
  const meRes = await fetch('http://localhost:3000/api/v1/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const meData = await meRes.json();
  console.log('Status:', meRes.status);
  console.log('Response:', JSON.stringify(meData, null, 2));
}

run().catch(console.error);
