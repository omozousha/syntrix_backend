require('dotenv').config();
const { loginWithPassword } = require('../src/modules/auth/auth.service');

async function testLogin() {
  console.log('Testing loginWithPassword via Firebase REST API...');
  const result = await loginWithPassword('admin.ops@syntrix.local', 'SyntrixUser@2026!');
  console.log('Login Result:', {
    uid: result.uid,
    hasIdToken: Boolean(result.idToken),
    hasRefreshToken: Boolean(result.refreshTokenFirebase),
    expiresIn: result.expiresIn,
  });
  console.log('\nSUCCESS! Firebase REST API login is working.');
  process.exit(0);
}

testLogin().catch(err => {
  console.error('Login Failed:', err.message);
  process.exit(1);
});
