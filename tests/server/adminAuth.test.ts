import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADMIN_SESSION_COOKIE,
  createAdminSessionToken,
  createVisitorIdToken,
  parseCookieHeader,
  verifyAdminSessionToken,
  verifyVisitorIdToken,
} from '../../server/adminAuth';

test('verifies a signed admin session token and rejects tampering', () => {
  const token = createAdminSessionToken('secret', 1_700_000_000_000);

  assert.equal(verifyAdminSessionToken(token, 'secret', 1_700_000_000_001), true);
  assert.equal(verifyAdminSessionToken(`${token}x`, 'secret', 1_700_000_000_001), false);
  assert.equal(verifyAdminSessionToken(token, 'different-secret', 1_700_000_000_001), false);
});

test('rejects expired admin session tokens', () => {
  const createdAt = 1_700_000_000_000;
  const token = createAdminSessionToken('secret', createdAt);
  const eightDaysLater = createdAt + 8 * 24 * 60 * 60 * 1000;

  assert.equal(verifyAdminSessionToken(token, 'secret', eightDaysLater), false);
});

test('signs visitor identities for feedback ownership and rejects spoofing', () => {
  const createdAt = 1_700_000_000_000;
  const token = createVisitorIdToken('v_abc123', 'secret', createdAt);

  assert.equal(verifyVisitorIdToken(token, 'secret', createdAt + 1), 'v_abc123');
  assert.equal(verifyVisitorIdToken(token.replace('v_abc123', 'v_attacker'), 'secret', createdAt + 1), null);
  assert.equal(verifyVisitorIdToken(token, 'different-secret', createdAt + 1), null);
  assert.equal(verifyVisitorIdToken(token, 'secret', createdAt + 366 * 24 * 60 * 60 * 1000), null);
});

test('visitor identity tokens reject invalid inputs', () => {
  assert.throws(() => createVisitorIdToken('attacker', 'secret'), /valid/);
  assert.throws(() => createVisitorIdToken('v_valid', ''), /valid/);
  assert.equal(verifyVisitorIdToken('v_valid.bad.signature', 'secret'), null);
});

test('parses cookie headers', () => {
  assert.deepEqual(parseCookieHeader(`visitor_id=v_1; ${ADMIN_SESSION_COOKIE}=token%201`), {
    visitor_id: 'v_1',
    [ADMIN_SESSION_COOKIE]: 'token 1',
  });
  assert.deepEqual(parseCookieHeader(undefined), {});
});
