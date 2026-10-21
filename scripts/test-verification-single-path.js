// Asserts that sendVerificationEmail uses exactly ONE delivery path per call.
// Two paths in one call is what killed the link: sendOobCode invalidates the
// link that generateEmailVerificationLink just produced.
const assert = require('node:assert');
const path = require('node:path');

const root = path.join(__dirname, '..');
const env = {
  firebaseWebApiKey: 'test-key',
  smtpHost: '',
  smtpPort: 465,
  smtpUser: '',
  smtpPass: '',
  smtpFrom: 'Syntrix One <no-reply@example.com>',
  smtpSecure: true,
};

let generated = 0;
let oobCodeCalls = 0;
let smtpCalls = 0;
let smtpShouldFail = false;

const stub = (relPath, exports) => {
  const full = require.resolve(path.join(root, relPath));
  require.cache[full] = { id: full, filename: full, loaded: true, exports };
};

stub('src/config/env.js', { env });
stub('src/config/db.js', { query: async () => ({ rows: [] }) });
stub('src/config/firebase.js', {
  getFirebaseAdmin: () => ({
    auth: () => ({
      generateEmailVerificationLink: async (email) => {
        generated += 1;
        return `https://example.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=code-${generated}&email=${email}`;
      },
      getUserByEmail: async () => ({ uid: 'uid-1' }),
      createCustomToken: async () => 'custom-token',
    }),
  }),
});

// nodemailer is required lazily inside the service, so stub it through the loader.
const Module = require('node:module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'nodemailer') {
    return {
      createTransport: () => ({
        sendMail: async () => {
          smtpCalls += 1;
          if (smtpShouldFail) throw new Error('SMTP_CONNECT_FAILED');
          return { accepted: ['ok'] };
        },
      }),
    };
  }
  return origLoad.call(this, request, parent, isMain);
};

global.fetch = async (url) => {
  const target = String(url);
  if (target.includes('sendOobCode')) oobCodeCalls += 1;
  return { json: async () => ({ idToken: 'id-token-1', ok: true }) };
};

const { sendVerificationEmail } = require(path.join(root, 'src/modules/auth/auth.service.js'));

const reset = () => {
  generated = 0;
  oobCodeCalls = 0;
  smtpCalls = 0;
  smtpShouldFail = false;
};

(async () => {
  // Case 1: no SMTP configured -> sendOobCode only, no link generated.
  reset();
  env.smtpHost = '';
  env.smtpUser = '';
  let r = await sendVerificationEmail('a@example.com', 'pw');
  assert.strictEqual(generated, 0, 'case1: must not generate a link when SMTP is off');
  assert.strictEqual(oobCodeCalls, 1, 'case1: sendOobCode called once');
  assert.strictEqual(r.email_sent, true);
  assert.strictEqual(r.verification_link, null, 'case1: no dead link handed back');

  // Case 2: SMTP configured -> generate once + send once, never sendOobCode.
  reset();
  env.smtpHost = 'smtp.example.com';
  env.smtpUser = 'user';
  r = await sendVerificationEmail('a@example.com', 'pw');
  assert.strictEqual(generated, 1, 'case2: exactly one link');
  assert.strictEqual(smtpCalls, 1, 'case2: exactly one SMTP send');
  assert.strictEqual(oobCodeCalls, 0, 'case2: must NOT also call sendOobCode (would invalidate link)');
  assert.strictEqual(r.email_sent, true);
  assert.ok(r.verification_link.includes('oobCode=code-1'));

  // Case 3: SMTP configured but fails -> fall back to sendOobCode, return NO link.
  reset();
  smtpShouldFail = true;
  r = await sendVerificationEmail('a@example.com', 'pw');
  assert.strictEqual(oobCodeCalls, 1, 'case3: falls back to sendOobCode');
  assert.strictEqual(r.verification_link, null, 'case3: the undelivered link must not be persisted');
  assert.strictEqual(r.reason, 'SMTP_CONNECT_FAILED');
  assert.strictEqual(r.email_sent, true);

  // Case 4: neither path available -> explicit reason instead of silent null.
  reset();
  env.smtpHost = '';
  env.smtpUser = '';
  env.firebaseWebApiKey = '';
  r = await sendVerificationEmail('a@example.com', 'pw');
  assert.strictEqual(r.email_sent, false);
  assert.strictEqual(r.verification_link, null);
  assert.strictEqual(r.reason, 'SMTP_NOT_CONFIGURED');

  console.log('ALL TESTS PASSED (4 cases): single delivery path enforced, no dead link returned.');
})().catch((err) => {
  console.error('TEST FAILED:', err.message);
  process.exit(1);
});
