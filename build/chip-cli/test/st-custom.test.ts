/**
 * The ST custom command table.
 *
 * None of these tests can tell you the opcodes work on the part. A tag can do that and a
 * test cannot. Since Sunday 25 October 2026 they check every byte against the quoted
 * text of the ST25TV02KC datasheet, DS13304 Rev 7, and above all **the honesty of the
 * confidence labels**, because the runtime gate in the PC/SC transport is built on the
 * destructive commands being marked as destructive.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ST_COMMANDS,
  type StCommand,
  IC_MFG_ST,
  FLAGS_ADDRESSED,
  FORBIDDEN_OPCODES,
  CONFIG_REGISTERS,
  PASSWORD_ID,
  RW_PROTECTION_WRITE_PROTECTED,
  stRequest,
  coverCode,
  uidOnAir,
  assertPasswordLength,
  FACTORY_DEFAULT_PASSWORD,
  FACTORY_DEFAULT_CONFIG_PASSWORD,
  DELIBERATELY_WRONG_PASSWORD,
} from '../src/chip/st-custom.js';

const UID = Uint8Array.from([0xe0, 0x02, 0x08, 0x11, 0x22, 0x33, 0x44, 0x55]);
const UID_ON_AIR = [0x55, 0x44, 0x33, 0x22, 0x11, 0x08, 0x02, 0xe0];

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
      cmd.confidence === 'measured' || cmd.confidence === 'datasheet' || cmd.confidence === 'secondary-source',
      `${key} must declare a confidence level`,
    );
  }
});

test('NOTHING is marked measured yet, and every command is now from the datasheet', () => {
  // The day one of these legitimately becomes 'measured', this test is the thing
  // that forces somebody to think about whether it really is.
  for (const [key, cmd] of COMMANDS) {
    assert.equal(cmd.confidence, 'datasheet', `${key} is quoted from DS13304, not measured, and must say so`);
    assert.match(cmd.source, /DS13304 Rev 7, 6\.4\.\d+, Table \d+/, `${key} must cite its section and table`);
  }
});

test('the opcodes are the datasheet\'s: B4h, B3h, B1h, A0h, A1h', () => {
  assert.equal(ST_COMMANDS.GET_RANDOM_NUMBER.code, 0xb4); // Table 166
  assert.equal(ST_COMMANDS.PRESENT_PASSWORD.code, 0xb3); // Table 153
  assert.equal(ST_COMMANDS.WRITE_PASSWORD.code, 0xb1); // Table 150
  assert.equal(ST_COMMANDS.READ_CONFIGURATION.code, 0xa0); // Table 144
  assert.equal(ST_COMMANDS.WRITE_CONFIGURATION.code, 0xa1); // Table 147
});

test('BAh is ToggleDiscreetSilent and no command uses it, nor Kill, nor LockBlock', () => {
  // DS13304 Table 163: "BAh 02h ... 03h". The tool used to send it as Set Memory Protection.
  for (const [key, cmd] of COMMANDS) assert.ok(!FORBIDDEN_OPCODES.includes(cmd.code), `${key} uses forbidden opcode 0x${cmd.code.toString(16)}`);
  assert.deepEqual([...FORBIDDEN_OPCODES].sort((a, b) => a - b), [0x22, 0x32, 0xa6, 0xba]);
  assert.throws(() => stRequest({ code: 0xba, name: 'x', nonDestructive: false, confidence: 'datasheet', source: 'x' }, UID), /forbidden/);
});

test('the two irreversible commands are marked irreversible', () => {
  // The runtime gate reads exactly this. Flipping either of these to true would
  // silently unlock a command that can permanently protect a tag.
  assert.equal(ST_COMMANDS.WRITE_PASSWORD.nonDestructive, false);
  assert.equal(ST_COMMANDS.WRITE_CONFIGURATION.nonDestructive, false);
});

test('exactly the random number, the presentation and the configuration read are marked safe', () => {
  const safe = COMMANDS.filter(([, c]) => c.nonDestructive).map(([k]) => k).sort();
  assert.deepEqual(safe, ['GET_RANDOM_NUMBER', 'PRESENT_PASSWORD', 'READ_CONFIGURATION']);
});

test('a request frame is flags 22h, opcode, IC Mfg code 02h, the UID LSB first, then parameters', () => {
  const frame = stRequest(ST_COMMANDS.PRESENT_PASSWORD, UID, [1, ...FACTORY_DEFAULT_PASSWORD]);
  assert.equal(frame[0], FLAGS_ADDRESSED);
  assert.equal(frame[0], 0x22, 'high data rate and Address_flag, Option_flag clear (Table 153 "00xx00xxb")');
  assert.equal(frame[1], 0xb3);
  assert.equal(frame[2], IC_MFG_ST);
  assert.deepEqual(Array.from(frame.slice(3, 11)), UID_ON_AIR, 'UID after the IC Mfg code, LSB first');
  assert.equal(frame[11], 1, 'Password_id');
  assert.equal(frame.length, 12 + 8);
});

test('a frame cannot be addressed to anything but an eight byte ST UID', () => {
  assert.throws(() => uidOnAir(new Uint8Array(8)));
  assert.throws(() => uidOnAir(Uint8Array.from([0xe0, 0x04, 1, 2, 3, 4, 5, 6])), /ST UID/);
  assert.throws(() => uidOnAir(UID.subarray(0, 7)));
  assert.deepEqual(uidOnAir(UID), UID_ON_AIR);
});

test('the manufacturer byte is STMicroelectronics on every command', () => {
  for (const [, cmd] of COMMANDS) {
    assert.equal(stRequest(cmd, UID)[2], 0x02);
  }
});

test('cover coding reproduces the datasheet\'s worked example, Table 30', () => {
  // RND_NUMBER 1DE6h, PASSWORD_8B FAD75E15CAA5D0D4h, Password_data E73143F3D743CD32h, sent LSB first.
  const password = Uint8Array.from([0xfa, 0xd7, 0x5e, 0x15, 0xca, 0xa5, 0xd0, 0xd4]);
  assert.deepEqual(coverCode(password, 0x1de6), [0x32, 0xcd, 0x43, 0xd7, 0xf3, 0x43, 0x31, 0xe7]);
});

test('cover coding of a 32 bit password repeats RND_NUMBER twice, Table 28, and refuses other sizes', () => {
  assert.deepEqual(coverCode(Uint8Array.from([0x01, 0x02, 0x03, 0x04]), 0xa55a), [0x04 ^ 0x5a, 0x03 ^ 0xa5, 0x02 ^ 0x5a, 0x01 ^ 0xa5]);
  assert.deepEqual(coverCode(FACTORY_DEFAULT_CONFIG_PASSWORD, 0x1234), [0x34, 0x12, 0x34, 0x12]);
  assert.throws(() => coverCode(new Uint8Array(5), 1));
  assert.throws(() => coverCode(new Uint8Array(8), 0x10000));
});

test('password ids, registers and the protection value are the datasheet\'s', () => {
  assert.equal(PASSWORD_ID.CONFIG, 0x00); // Table 27
  assert.equal(PASSWORD_ID.AREA1, 0x01);
  assert.deepEqual(CONFIG_REGISTERS.RW_PROTECTION_A1, { name: 'RW_PROTECTION_A1', fid: 0x00, pid: 0x00, bytes: 1 }); // Table 4
  assert.deepEqual(CONFIG_REGISTERS.END_A1, { name: 'END_A1', fid: 0x00, pid: 0x01, bytes: 1 });
  assert.deepEqual(CONFIG_REGISTERS.LCK_CONFIG, { name: 'LCK_CONFIG', fid: 0xff, pid: 0x00, bytes: 2 });
  // Table 11, "01: read always allowed / write allowed if AREA1 security session is open".
  assert.equal(RW_PROTECTION_WRITE_PROTECTED, 0x01);
});

test('opcodes sit in the ISO 15693 custom range', () => {
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
  assert.equal(FACTORY_DEFAULT_PASSWORD.length, 8);
  assert.equal(DELIBERATELY_WRONG_PASSWORD.length, 8);
  assert.notDeepEqual(Array.from(FACTORY_DEFAULT_PASSWORD), Array.from(DELIBERATELY_WRONG_PASSWORD));
  assert.ok(FACTORY_DEFAULT_PASSWORD.every((b) => b === 0), 'PWD_A1 factory value is 00000000h twice (Table 19)');
  assert.ok(FACTORY_DEFAULT_CONFIG_PASSWORD.length === 4 && FACTORY_DEFAULT_CONFIG_PASSWORD.every((b) => b === 0), 'PWD_CFG factory value is 00000000h (Table 17)');
});
