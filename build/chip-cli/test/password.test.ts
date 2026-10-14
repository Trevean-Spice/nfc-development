/**
 * The 64 bit area password, and its custody rules.
 *
 * The hazard on this chip is not permanence, it is custody. Lose the password and
 * the tag is frozen exactly as if it had been fused shut, so the tests here are
 * mostly about the password not leaking and not being something an attacker guesses
 * first.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { FACTORY_DEFAULT_HEX, PASSWORD_BITS, PASSWORD_BYTES, TagPassword, loadPassword } from '../src/chip/password.js';
import { isChipError } from '../src/chip/errors.js';

test('a password is 64 bits, eight bytes, sixteen hex characters', () => {
  assert.equal(PASSWORD_BITS, 64);
  assert.equal(PASSWORD_BYTES, 8);
  const password = TagPassword.fromHex('0123456789abcdef', 'new');
  assert.equal(password.toBytes().length, 8);
});

test('anything that is not sixteen hex characters is refused', () => {
  for (const bad of ['', '0123', '0123456789abcde', '0123456789abcdef0', 'zzzzzzzzzzzzzzzz', '0123456789 abcdef']) {
    assert.throws(
      () => TagPassword.fromHex(bad, 'new'),
      (error: unknown) => isChipError(error) && error.code === 'PASSWORD_INVALID',
      `"${bad}" must be refused`,
    );
  }
});

test('the factory default is accepted as a current password and refused as a new one', () => {
  assert.equal(TagPassword.factoryDefault().isFactoryDefault(), true);
  assert.equal(TagPassword.fromHex(FACTORY_DEFAULT_HEX, 'current').isFactoryDefault(), true);
  assert.throws(
    () => TagPassword.fromHex(FACTORY_DEFAULT_HEX, 'new'),
    (error: unknown) => isChipError(error) && error.code === 'PASSWORD_INVALID' && /factory default/.test(error.message),
  );
});

test('a password that is one repeated character is refused as a new one', () => {
  assert.throws(
    () => TagPassword.fromHex('ffffffffffffffff', 'new'),
    (error: unknown) => isChipError(error) && error.code === 'PASSWORD_INVALID',
  );
});

test('a password never prints itself, in any of the three ways a value normally escapes', () => {
  const secret = 'a1b2c3d4e5f60718';
  const password = TagPassword.fromHex(secret, 'new');

  assert.ok(!String(password).includes(secret));
  assert.ok(!`${password}`.includes(secret));
  assert.ok(!JSON.stringify({ password }).includes(secret));
  assert.ok(!JSON.stringify([password]).includes(secret));
  assert.ok(String(password).includes(password.fingerprint()));
});

test('a fingerprint identifies a password without revealing it', () => {
  const a = TagPassword.fromHex('a1b2c3d4e5f60718', 'new');
  const b = TagPassword.fromHex('a1b2c3d4e5f60718', 'new');
  const c = TagPassword.fromHex('0f1e2d3c4b5a6978', 'new');

  assert.equal(a.fingerprint(), b.fingerprint());
  assert.notEqual(a.fingerprint(), c.fingerprint());
  assert.match(a.fingerprint(), /^[0-9a-f]{8}$/);
  assert.equal(a.equals(b), true);
  assert.equal(a.equals(c), false);
});

test('the stored bytes cannot be mutated through the copy handed out', () => {
  const password = TagPassword.fromHex('a1b2c3d4e5f60718', 'new');
  const bytes = password.toBytes();
  bytes.fill(0);
  assert.notDeepEqual(password.toBytes(), new Uint8Array(8));
});

test('a password is loaded from an environment variable', () => {
  const loaded = loadPassword({ env: 'TEST_TAG_PASSWORD' }, 'new', () => '', {
    TEST_TAG_PASSWORD: 'a1b2c3d4e5f60718',
  });
  assert.equal(loaded.origin, 'environment variable TEST_TAG_PASSWORD');
  assert.equal(loaded.password.fingerprint(), TagPassword.fromHex('a1b2c3d4e5f60718', 'new').fingerprint());
});

test('a missing environment variable is a named failure that says which variable', () => {
  assert.throws(
    () => loadPassword({ env: 'TEST_TAG_PASSWORD' }, 'new', () => '', {}),
    (error: unknown) => isChipError(error) && error.code === 'PASSWORD_MISSING' && error.message.includes('TEST_TAG_PASSWORD'),
  );
});

test('no password source at all explains why there is no --password flag', () => {
  assert.throws(
    () => loadPassword({}, 'new', () => '', {}),
    (error: unknown) => isChipError(error) && error.code === 'PASSWORD_MISSING' && /visible to other processes/.test(error.remedy),
  );
});

test('two password sources at once are refused rather than one silently winning', () => {
  assert.throws(
    () => loadPassword({ env: 'A', file: 'b' }, 'new', () => '', { A: 'a1b2c3d4e5f60718' }),
    (error: unknown) => isChipError(error) && error.code === 'USAGE',
  );
});

test('a password file is read and trimmed', () => {
  const loaded = loadPassword({ file: 'anywhere' }, 'new', () => '  a1b2c3d4e5f60718\n', {});
  assert.equal(loaded.origin, 'file anywhere');
  assert.equal(loaded.password.fingerprint(), TagPassword.fromHex('a1b2c3d4e5f60718', 'new').fingerprint());
});
