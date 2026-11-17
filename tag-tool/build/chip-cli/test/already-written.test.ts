/**
 * A tag that was written already, and one that was written and locked, put back on the
 * reader: chip-cli write over the fake ACR1552U, the way the pcsc-lock tests drive it.
 *
 * Asked for on the call of Tuesday 17 November 2026: a locked tag answered a second write
 * with errors that did not say it was locked. These tests hold the tool to naming the
 * product code a tag already holds before anything is written, and to calling a write
 * the tag refuses "locked" only when the tag still reads exactly as before.
 *
 * They also hold what this change does NOT do. It reads blocks and nothing else: no ST
 * custom command and no password reaches the reader for it, and the D66 gate refuses to
 * protect or change anything on a tag that already carries a password, as before.
 *
 * **These tests do not prove anything about silicon.** The fake tag is a model of the
 * ACS manual and the ST25TV02KC datasheet. README section 6 says what is unproven.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { main } from '../src/cli/main.js';
import { CC_BYTES } from '../src/chip/st25tv02kc.js';
import { ST_COMMANDS } from '../src/chip/st-custom.js';
import { decodeUriMessage } from '../src/ndef/decode.js';
import { unwrapNdefTlv } from '../src/ndef/tlv.js';
import { RedirectTable } from '../src/table/redirect-table.js';
import { SimulatorTransport } from '../src/transport/simulator.js';
import { RecordingTransport } from '../src/transport/transport.js';
import { UnitSession, planEncoding } from '../src/workflow/unit.js';
import { TagPassword } from '../src/chip/password.js';
import { classifyArea, describeExisting, existingSpanBlocks, explainRefusedWrite, readExisting } from '../src/workflow/existing.js';
import { ChipError } from '../src/chip/errors.js';
import { ACR1552U, FakeBinding, FakeReader, GET_SYSTEM_INFO_APDU, carriesSt } from './fake-acr1552u.js';

const table = RedirectTable.load();
const PS = 'https://treveanspice.com/t/ps';
const CS = 'https://treveanspice.com/t/cs';
/** The password Dan kept, as a test value. MSB first, as the fake tag holds it. */
const KEPT_HEX = '5a3c9e17b2d40f68';
const KEPT = Uint8Array.from(Buffer.from(KEPT_HEX, 'hex'));

const ST_CODES = [
  ST_COMMANDS.GET_RANDOM_NUMBER.code,
  ST_COMMANDS.PRESENT_PASSWORD.code,
  ST_COMMANDS.WRITE_PASSWORD.code,
  ST_COMMANDS.READ_CONFIGURATION.code,
  ST_COMMANDS.WRITE_CONFIGURATION.code,
  0xba,
];

/** A fake reader with a tag that carries `uri`, formatted the way this tool writes it. */
function holding(uri: string | null): FakeReader {
  const reader = new FakeReader(ACR1552U);
  if (uri !== null) {
    reader.tag.memory.set([0xe1, 0x40, 0x27, 0x01], 0);
    reader.tag.memory.set(planEncoding(uri).tlv, CC_BYTES);
  }
  return reader;
}

/** The state Dan's spare tag was left in on 17 November: PWD_A1 changed, area 1 write protected and enforced. */
function lockWithKept(reader: FakeReader): void {
  reader.tag.password = Uint8Array.from(KEPT);
  reader.tag.areaProtection = 0x01;
  reader.tag.activeAreaProtection = 0x01;
}

async function run(args: string[], reader: FakeReader): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main([...args, '--transport', 'reader'], {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    pcsc: { loadBinding: async () => new FakeBinding([reader]), readerTimeoutMs: 50 },
    tagToolPorts: [],
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const urlOn = (reader: FakeReader) => decodeUriMessage(unwrapNdefTlv(reader.tag.memory.subarray(CC_BYTES))).uri;
const updateBinaries = (reader: FakeReader) => reader.tag.sent.filter((a) => a.startsWith('ff d6'));
const stCommandsSent = (reader: FakeReader) => reader.tag.sent.filter((a) => ST_CODES.some((code) => carriesSt(a, code)));
/** Every pass through is the geometry check's Get System Information and nothing else. */
const passThroughs = (reader: FakeReader) => reader.tag.sent.filter((a) => a.startsWith('ff fb') && a !== GET_SYSTEM_INFO_APDU);

/* ------------------------------------------------------------------------ */
/* Happy path                                                                */
/* ------------------------------------------------------------------------ */

test('a locked tag that holds ps: named before the write, TAG_LOCKED in plain words, one block tried, nothing changed, no ST command sent', async () => {
  const reader = holding(PS);
  lockWithKept(reader);
  const before = Uint8Array.from(reader.tag.memory);

  const result = await run(['write', '--code', 'ps'], reader);

  assert.equal(result.code, 2);
  assert.match(result.out, /^Already holds {4}ps \(Persian Sunrise\), the code being written$/m);
  assert.match(result.err, /FAILED {2}TAG_LOCKED/);
  assert.match(result.err, /This tag is locked, and it was written already: it holds ps \(Persian Sunrise\), the code being written\./);
  assert.match(result.err, /It refused the write and still reads exactly as before, so nothing on it changed\./);
  assert.match(result.err, /The reader said: Writing block 1 failed with status 0x6300\./);
  assert.match(result.err, /What to do: Nothing to do: this tag is finished\. Do not write it again\./);
  // The "already holds" line comes before any write was sent, and only the first block was tried.
  assert.equal(updateBinaries(reader).length, 1);
  assert.deepEqual(reader.tag.memory, before);
  assert.deepEqual(stCommandsSent(reader), []);
  assert.deepEqual(passThroughs(reader), []);
  // Still locked under the kept password: nothing here touches either.
  assert.equal(reader.tag.areaProtection, 0x01);
  assert.deepEqual(reader.tag.password, KEPT);
});

test('a locked tag asked for another code says which code it holds, and to set it aside rather than retry', async () => {
  const reader = holding(PS);
  lockWithKept(reader);

  const result = await run(['write', '--code', 'cs'], reader);

  assert.equal(result.code, 2);
  assert.match(result.out, /^Already holds {4}ps \(Persian Sunrise\)$/m);
  assert.match(result.err, /it holds ps \(Persian Sunrise\)\. It refused the write/);
  assert.match(result.err, /What to do: Do not try again: a locked tag refuses every write until it is opened with the password it was locked with\. Set it aside and label it "ps LOCKED"\./);
  assert.equal(urlOn(reader), PS);
  assert.deepEqual(stCommandsSent(reader), []);
});

/* ------------------------------------------------------------------------ */
/* Edge cases                                                                */
/* ------------------------------------------------------------------------ */

test('a tag that holds ps and is not locked is named, then written and verified as before', async () => {
  const same = holding(PS);
  const again = await run(['write', '--code', 'ps'], same);
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /^Already holds {4}ps \(Persian Sunrise\), the code being written$/m);
  assert.match(again.out, /^OK {2}ps {2}Persian Sunrise/m);

  const other = holding(PS);
  const changed = await run(['write', '--code', 'cs'], other);
  assert.equal(changed.code, 0, changed.err);
  assert.match(changed.out, /^Already holds {4}ps \(Persian Sunrise\)$/m);
  assert.equal(urlOn(other), CS);
  assert.deepEqual(stCommandsSent(other), []);
});

test('a blank tag gets no "already holds" line', async () => {
  const reader = holding(null);
  const result = await run(['write', '--code', 'ps'], reader);
  assert.equal(result.code, 0, result.err);
  assert.doesNotMatch(result.out, /Already holds/);
  assert.equal(urlOn(reader), PS);
});

test('a locked tag holding a URL that is not one of ours is named by its URL, and called locked', async () => {
  const reader = holding('https://example.com/a');
  lockWithKept(reader);
  const result = await run(['write', '--code', 'ps'], reader);
  assert.equal(result.code, 2);
  assert.match(result.out, /^Already holds {4}https:\/\/example\.com\/a, which is not a Trevean product URL$/m);
  assert.match(result.err, /FAILED {2}TAG_LOCKED/);
  assert.match(result.err, /label it "LOCKED"/);
});

test('a locked tag with nothing on it to compare keeps the reader\'s own WRITE_FAILED: locked is never guessed', async () => {
  const reader = holding(null);
  lockWithKept(reader);
  const result = await run(['write', '--code', 'ps'], reader);
  assert.equal(result.code, 2);
  assert.match(result.err, /FAILED {2}WRITE_FAILED/);
  assert.doesNotMatch(result.err, /TAG_LOCKED/);
});

test('a wrong current password on a locked tag is refused before any write, and nothing irreversible is sent', async () => {
  const reader = holding(PS);
  lockWithKept(reader);
  process.env.CHIP_CLI_TEST_WRONG = '0123456789abcdef';
  process.env.CHIP_CLI_TEST_NEW = 'f1e2d3c4b5a69788';
  try {
    const result = await run(['write', '--code', 'ps', '--protect', '--password-env', 'CHIP_CLI_TEST_NEW', '--current-password-env', 'CHIP_CLI_TEST_WRONG'], reader);
    assert.equal(result.code, 2);
    assert.match(result.err, /FAILED {2}PASSWORD_REJECTED/);
    assert.equal(updateBinaries(reader).length, 0);
    assert.equal(reader.tag.sent.filter((a) => carriesSt(a, ST_COMMANDS.WRITE_PASSWORD.code) || carriesSt(a, ST_COMMANDS.WRITE_CONFIGURATION.code)).length, 0);
    assert.deepEqual(reader.tag.password, KEPT);
    assert.equal(reader.tag.areaProtection, 0x01);
  } finally {
    delete process.env.CHIP_CLI_TEST_WRONG;
    delete process.env.CHIP_CLI_TEST_NEW;
  }
});

/* ------------------------------------------------------------------------ */
/* Failure modes                                                             */
/* ------------------------------------------------------------------------ */

test('the reader dropping the tag on the write is reported as the reader, never as a locked tag', async () => {
  const reader = holding(PS);
  reader.tag.failOn = (apdu) => apdu.startsWith('ff d6');
  const result = await run(['write', '--code', 'ps'], reader);
  assert.equal(result.code, 2);
  assert.match(result.err, /FAILED {2}TRANSPORT_UNAVAILABLE/);
  assert.doesNotMatch(result.err, /locked/i);
});

test('a locked tag the reader drops on the read after the refused write keeps WRITE_FAILED: locked is said only on a read that shows it', async () => {
  const reader = holding(PS);
  lockWithKept(reader);
  const span = existingSpanBlocks(table);
  const spanRead = `ff b0 00 00 ${(span * 4).toString(16).padStart(2, '0')}`;
  let spanReads = 0;
  reader.tag.failOn = (apdu) => apdu === spanRead && ++spanReads === 2;
  const result = await run(['write', '--code', 'ps'], reader);
  assert.equal(result.code, 2);
  assert.equal(spanReads, 2, 'the content was read before the write and once after it');
  assert.match(result.err, /FAILED {2}WRITE_FAILED/);
  assert.doesNotMatch(result.err, /TAG_LOCKED/);
});

test('the gate still refuses: --protect on a tag locked with a kept password rewrites under it, then stops at the probe with nothing irreversible sent', async () => {
  // The reason unlock and password change were not added (README section 5.6): the probe
  // passes only on factory passwords, so it cannot pass on this tag, and the irreversible
  // pair stays locked. This pins that, unchanged.
  const reader = holding(PS);
  lockWithKept(reader);
  process.env.CHIP_CLI_TEST_KEPT = KEPT_HEX;
  process.env.CHIP_CLI_TEST_NEW = 'f1e2d3c4b5a69788';
  try {
    const result = await run(['write', '--code', 'ps', '--protect', '--password-env', 'CHIP_CLI_TEST_NEW', '--current-password-env', 'CHIP_CLI_TEST_KEPT'], reader);
    assert.equal(result.code, 2);
    assert.match(result.out, /^Verified {9}https:\/\/treveanspice\.com\/t\/ps$/m);
    assert.match(result.err, /FAILED {2}PROTECT_FAILED/);
    assert.match(result.err, /Refusing to protect this tag: the opcode probe did not pass\./);
    assert.equal(reader.tag.sent.filter((a) => carriesSt(a, ST_COMMANDS.WRITE_PASSWORD.code) || carriesSt(a, ST_COMMANDS.WRITE_CONFIGURATION.code) || carriesSt(a, 0xba)).length, 0);
    assert.deepEqual(reader.tag.password, KEPT);
    assert.equal(reader.tag.areaProtection, 0x01);
    assert.equal(urlOn(reader), PS);
  } finally {
    delete process.env.CHIP_CLI_TEST_KEPT;
    delete process.env.CHIP_CLI_TEST_NEW;
  }
});

/* ------------------------------------------------------------------------ */
/* The module on its own, on the simulator                                   */
/* ------------------------------------------------------------------------ */

test('existing: the read span covers the longest URL in the table in one Read Binary, and classify never throws', () => {
  const span = existingSpanBlocks(table);
  assert.ok(span >= 2 && span <= 63, `span ${span}`);
  for (const entry of table.encodable()) {
    assert.ok(1 + Math.ceil(planEncoding(entry.ndefUri!).tlv.length / 4) <= span, entry.code);
  }
  assert.deepEqual(classifyArea(new Uint8Array(16), table), { uri: null, entry: null });
  assert.deepEqual(classifyArea(Uint8Array.from([0x03, 0x40, 0xd1]), table), { uri: null, entry: null });
  assert.equal(describeExisting(null), null);
  assert.equal(describeExisting({ uri: null, entry: null }), null);
});

test('existing: on the simulator, a tag protected by an earlier run is TAG_LOCKED from its own AREA_PROTECTED, and only a read is added', async () => {
  const transport = new SimulatorTransport({ preloadBlank: true });
  await transport.open();
  const first = new UnitSession({ transport, uri: PS, code: 'ps' });
  await first.selectTag();
  await first.write();
  const receipt = await first.verify();
  await first.protect(receipt, { currentPassword: TagPassword.factoryDefault(), newPassword: TagPassword.fromHex(KEPT_HEX, 'new') });
  await transport.releaseTag();

  const second = new UnitSession({ transport, uri: CS, code: 'cs' });
  await second.selectTag();
  const before = await readExisting(transport, table);
  assert.equal(before?.entry?.code, 'ps');
  let error: unknown = null;
  try {
    await second.write();
  } catch (cause) {
    error = await explainRefusedWrite(cause, before, transport, table, 'cs');
  }
  assert.ok(error instanceof ChipError);
  assert.equal(error.code, 'TAG_LOCKED');
  assert.equal(error.detail.readerErrorCode, 'AREA_PROTECTED');
  assert.equal(error.detail.heldCode, 'ps');
  await transport.close();
});

test('existing: an error that is not a refused write is returned as it is, and the tag is not read again', async () => {
  const transport = new SimulatorTransport({ preloadUri: PS });
  await transport.open();
  await transport.waitForTag(100);
  const before = await readExisting(transport, table);
  const recorded = new RecordingTransport(transport);
  const original = new ChipError('READBACK_MISMATCH', 'x', 'y');
  assert.equal(await explainRefusedWrite(original, before, recorded, table, 'ps'), original);
  const plain = new Error('not a chip error');
  assert.equal(await explainRefusedWrite(plain, before, recorded, table, 'ps'), plain);
  assert.deepEqual(recorded.methodSequence(), []);
  await transport.close();
});
