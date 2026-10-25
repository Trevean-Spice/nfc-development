/**
 * The ST custom command table.
 *
 * None of these tests can tell you the opcodes are correct. A datasheet or a tag
 * can do that and a test cannot. What they protect is everything around the
 * opcodes: the framing, the manufacturer byte, the password length, and above all
 * **the honesty of the confidence labels**, because the runtime gate in the PC/SC
 * transport is built on the destructive commands being marked as destructive.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ST_COMMANDS,
  type StCommand,
  IC_MFG_ST,
  FLAG_HIGH_DATA_RATE,
  stRequest,
  assertPasswordLength,
  FACTORY_DEFAULT_PASSWORD,
  DELIBERATELY_WRONG_PASSWORD,
} from '../src/chip/st-custom.js';

/**
 * Read through the interface rather than the literal type. TypeScript narrows the
 * const assertion so hard that comparing confidence against 'measured' is a compile
 * error, which is a pleasant way to be told nothing is measured and a useless one for
 * a test that must keep checking.
 */
const COMMANDS: ReadonlyArray<readonly [string, StCommand]> = Object.entries(ST_COMMANDS);

test('every command carries its provenance, so nothing looks more certain than it is', () => {
  for (const [key, cmd] of COMMANDS) {
    assert.ok(cmd.source.length > 20, `${key} must say where its opcode came from`);
    assert.ok(
      cmd.confidence === 'measured' || cmd.confidence === 'secondary-source',
      `${key} must declare a confidence level`,
    );
  }
});

test('NOTHING is marked measured yet, because the datasheet never downloaded', () => {
  // The day one of these legitimately becomes 'measured', this test is the thing
  // that forces somebody to think about whether it really is.
  for (const [key, cmd] of COMMANDS) {
    assert.equal(cmd.confidence, 'secondary-source', `${key} is not measured and must not claim to be`);
  }
});

test('the two irreversible commands are marked irreversible', () => {
  // The runtime gate reads exactly this. Flipping either of these to true would
  // silently unlock a command that can permanently protect a tag.
  assert.equal(ST_COMMANDS.WRITE_PASSWORD.nonDestructive, false);
  assert.equal(ST_COMMANDS.SET_MEMORY_PROTECTION.nonDestructive, false);
});

test('present password is the only one marked safe, because it is the only one that is', () => {
  assert.equal(ST_COMMANDS.PRESENT_PASSWORD.nonDestructive, true);
  const safe = COMMANDS.filter(([, c]) => c.nonDestructive);
  assert.equal(safe.length, 1, 'exactly one command may be marked non destructive');
});

test('a request frame is flags, command, manufacturer, then parameters', () => {
  const frame = stRequest(ST_COMMANDS.PRESENT_PASSWORD, [1, ...FACTORY_DEFAULT_PASSWORD]);
  assert.equal(frame[0], FLAG_HIGH_DATA_RATE);
  assert.equal(frame[1], 0xb3);
  // Without the manufacturer byte a custom opcode means another vendor's command.
  assert.equal(frame[2], IC_MFG_ST);
  assert.equal(frame[3], 1, 'password number');
  assert.equal(frame.length, 4 + 8);
});

test('the manufacturer byte is STMicroelectronics on every command', () => {
  for (const [, cmd] of COMMANDS) {
    assert.equal(stRequest(cmd)[2], 0x02);
  }
});

test('opcodes sit in the ISO 15693 custom range, which is the one check available without a datasheet', () => {
  // 0xA0 to 0xDF is the custom range. A value outside it is certainly wrong,
  // whatever the forum said.
  for (const [key, cmd] of COMMANDS) {
    assert.ok(cmd.code >= 0xa0 && cmd.code <= 0xdf, `${key} opcode 0x${cmd.code.toString(16)} is outside the custom range`);
  }
});

test('no two commands share an opcode', () => {
  const codes = COMMANDS.map(([, c]) => c.code);
  assert.equal(new Set(codes).size, codes.length);
});

test('a password must be exactly 64 bits', () => {
  assert.doesNotThrow(() => assertPasswordLength(new Uint8Array(8)));
  for (const n of [0, 4, 7, 9, 16]) {
    assert.throws(() => assertPasswordLength(new Uint8Array(n)), /8/);
  }
});

test('the probe pair differ, or the probe proves nothing', () => {
  // verifyOpcodes works by presenting these two and requiring different answers.
  // If they were ever made equal the probe would pass vacuously and the gate
  // would open on an unproven path.
  assert.equal(FACTORY_DEFAULT_PASSWORD.length, 8);
  assert.equal(DELIBERATELY_WRONG_PASSWORD.length, 8);
  assert.notDeepEqual(Array.from(FACTORY_DEFAULT_PASSWORD), Array.from(DELIBERATELY_WRONG_PASSWORD));
  assert.ok(
    FACTORY_DEFAULT_PASSWORD.every((b) => b === 0),
    'the factory default on an unconfigured area is all zeroes',
  );
});
