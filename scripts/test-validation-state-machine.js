const assert = require('assert');
const { STATUS, normalizeRole, assertRejectNote } = require('../src/modules/validation/validation.service');
const { normalizeRoleName, isRegionalRole, isSuperAdminRole } = require('../src/utils/roles');

const ALLOWED_TRANSITIONS = new Set([
  `${STATUS.UNVALIDATED}->${STATUS.ONGOING}`,
  `${STATUS.REJECTED_ADMINREGION}->${STATUS.ONGOING}`,
  `${STATUS.ONGOING}->${STATUS.PENDING_ASYNC}`,
  `${STATUS.ONGOING}->${STATUS.REJECTED_ADMINREGION}`,
  `${STATUS.PENDING_ASYNC}->${STATUS.VALIDATED}`,
  `${STATUS.PENDING_ASYNC}->${STATUS.REJECTED_SUPERADMIN}`,
]);

function canTransition(from, to) {
  return ALLOWED_TRANSITIONS.has(`${from}->${to}`);
}

function testTransitions() {
  assert.strictEqual(canTransition(STATUS.UNVALIDATED, STATUS.ONGOING), true);
  assert.strictEqual(canTransition(STATUS.ONGOING, STATUS.PENDING_ASYNC), true);
  assert.strictEqual(canTransition(STATUS.PENDING_ASYNC, STATUS.VALIDATED), true);
  assert.strictEqual(canTransition(STATUS.VALIDATED, STATUS.ONGOING), false);
  assert.strictEqual(canTransition(STATUS.REJECTED_SUPERADMIN, STATUS.VALIDATED), false);
}

function testRejectNoteRule() {
  assert.throws(() => assertRejectNote('short'), /at least 10 characters/i);
  assert.doesNotThrow(() => assertRejectNote('catatan reject valid'));
}

function testRoleNormalization() {
  assert.strictEqual(normalizeRole('admin'), 'superadmin');
  assert.strictEqual(normalizeRole('user_all_region'), 'adminregion');
  assert.strictEqual(normalizeRole('user_region'), 'validator');

  assert.strictEqual(normalizeRoleName('admin'), 'superadmin');
  assert.strictEqual(normalizeRoleName('user_all_region'), 'adminregion');
  assert.strictEqual(normalizeRoleName('user_region'), 'validator');

  assert.strictEqual(isSuperAdminRole('admin'), true);
  assert.strictEqual(isRegionalRole('user_all_region'), true);
  assert.strictEqual(isRegionalRole('user_region'), true);
}

function main() {
  testTransitions();
  testRejectNoteRule();
  testRoleNormalization();
  console.log('Validation state-machine unit checks PASSED');
}

main();
