/**
 * The re-review of Monday 26 October 2026: the merge of the 80 block geometry (section 7)
 * and findings N1 to N5, on the fake ACR1552U and ST25TV02KC.
 *
 *   - Section 7: the probe's END_A1 check and its block 79 / block 80 geometry read come
 *     from one number; a full --protect runs on an 80 block tag; the three reads of the
 *     image share one span policy; block 80 is still refused after protection; a TruST25
 *     part with END_MEM 3Dh fails closed in both places.
 *   - N1: WritePassword is followed, in the same session, by a presentation of the new
 *     password, and area protection is sent only after that succeeded. After the refusal
 *     proof, the recorded password must open the tag.
 *   - N2: the readability check after protection runs after the RF cycle.
 *   - N3: "LOCKED?" starts with the first irreversible frame actually sent.
 *   - N4: a batch stops at a unit that may be locked.
 *   - N5: tests aimed at the reviewer's surviving and single guard mutations, X4, X6, X7,
 *     X8, X10 and X11.
 *
 * As with every test against the fake: these prove the tool and a model of the documents
 * agree. They prove nothing about silicon.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PcscTransport, judgeProbePreconditions, type TagAnswer } from '../src/transport/pcsc.js';
import { isChipError } from '../src/chip/errors.js';
import { TagPassword } from '../src/chip/password.js';
import { PART, READ_SPAN_MAX_BLOCKS } from '../src/chip/st25tv02kc.js';
import { END_MEM_ST25TV02KC, ST_COMMANDS } from '../src/chip/st-custom.js';
import { SimulatorTransport } from '../src/transport/simulator.js';
import { RecordingTransport, type TagTransport } from '../src/transport/transport.js';
import { UnitSession, planEncoding } from '../src/workflow/unit.js';
import { runBatch, type BatchEvent } from '../src/workflow/batch.js';
import { readJournal } from '../src/workflow/journal.js';
import { RedirectTable } from '../src/table/redirect-table.js';
import { renderBatchSummary } from '../src/cli/render.js';
import { ACR1552U, FakeBinding, FakeReader, FakeTag, OTHER_UID_LSB_FIRST, ST25TV02KC_BLOCKS, UID_LSB_FIRST, carriesSt, frameOf, hex } from './fake-acr1552u.js';

const B4 = ST_COMMANDS.GET_RANDOM_NUMBER.code;
const B3 = ST_COMMANDS.PRESENT_PASSWORD.code;
const B1 = ST_COMMANDS.WRITE_PASSWORD.code;
const A0 = ST_COMMANDS.READ_CONFIGURATION.code;
const A1 = ST_COMMANDS.WRITE_CONFIGURATION.code;
const BA = 0xba;
const W21 = 0x21;
const URI = 'https://treveanspice.com/t/ps';
const NEW_PASSWORD = '0a1b2c3d4e5f6071';
const NEW = () => TagPassword.fromHex(NEW_PASSWORD, 'new');
const UID = 'e002112233445566';
/** The exact sentence review finding N1 asks for. */
const N1_MESSAGE = 'WritePassword was accepted but the new password does not open the tag. Area protection was NOT applied; the tag is still writable; its password 1 is unknown.';

async function openWith(reader: FakeReader): Promise<PcscTransport> {
  const transport = new PcscTransport(undefined, { loadBinding: async () => new FakeBinding([reader]), readerTimeoutMs: 50 });
  await transport.open();
  return transport;
}

async function selected(reader = new FakeReader(ACR1552U)): Promise<{ reader: FakeReader; transport: PcscTransport }> {
  const transport = await openWith(reader);
  await transport.waitForTag(200);
  return { reader, transport };
}

async function proven(reader = new FakeReader(ACR1552U)): Promise<{ reader: FakeReader; transport: PcscTransport }> {
  const ctx = await selected(reader);
  const probe = await ctx.transport.verifyOpcodes();
  assert.equal(probe.proven, true, probe.detail);
  await ctx.transport.presentPassword(1, new Uint8Array(8));
  return ctx;
}

async function protectOnReader(reader: FakeReader, uri = URI) {
  const transport = new RecordingTransport(await openWith(reader));
  const session = new UnitSession({ transport, uri, code: 'ps', unlockPassword: TagPassword.factoryDefault() });
  await session.selectTag();
  await session.write();
  const receipt = await session.verify();
  const result = session.protect(receipt, { currentPassword: TagPassword.factoryDefault(), newPassword: NEW() });
  return { transport, session, result };
}

function chipCode(code: string, also?: (e: { message: string; remedy: string; detail: Record<string, unknown> }) => void) {
  return (error: unknown) => {
    assert.ok(isChipError(error), 'must be a ChipError so the CLI can render a remedy');
    assert.equal(error.code, code, error.message);
    also?.(error);
    return true;
  };
}

function mayBeLocked(originalCode: string, original: RegExp) {
  return chipCode('PROTECT_FAILED', (e) => {
    assert.match(e.message, /Protection did not complete, and its irreversible part had begun/);
    assert.match(e.message, /Label the tag LOCKED\?/);
    assert.match(e.message, new RegExp(`Original message: ${originalCode}: `));
    assert.match(e.message, original);
    assert.equal(e.detail['mayBeLocked'], true);
  });
}

/** A refusal that sent nothing irreversible: passed through as it is, never "LOCKED?". */
function notLocked(original: RegExp) {
  return chipCode('PROTECT_FAILED', (e) => {
    assert.match(e.message, original);
    assert.doesNotMatch(e.message, /irreversible part had begun|LOCKED\?/);
    assert.notEqual(e.detail['mayBeLocked'], true);
  });
}

const framesSent = (tag: FakeTag) => tag.sent.map(frameOf).filter((f): f is number[] => f !== null);
const commandsSent = (tag: FakeTag) => framesSent(tag).map((f) => f[1]);
const count = (tag: FakeTag, code: number) => commandsSent(tag).filter((c) => c === code).length;
const irreversibleFrames = (tag: FakeTag) => tag.sent.filter((a) => carriesSt(a, B1) || carriesSt(a, A1) || carriesSt(a, BA));
const ok = (data: number[] = []): TagAnswer => ({ kind: 'ok', data: Uint8Array.from(data) });

/** The silicon of the reviewer's demo: B1 answers 00 and stores the cover coded bytes, not the value the tool meant. */
function storesB1Raw(tag: FakeTag): void {
  tag.tagOverride = (f) => {
    if (f[1] === B1) {
      tag.password = Uint8Array.from(f.slice(4));
      return [0x00];
    }
    return tag.datasheetAnswer(f);
  };
}

/* ------------------------------------------------------------------------ */
/* Section 7. The geometry merge.                                             */
/* ------------------------------------------------------------------------ */

test('7: END_MEM in the probe is derived from the part model, and both are the datasheet\'s 4Fh', () => {
  assert.equal(END_MEM_ST25TV02KC, PART.blockCount - 1);
  assert.equal(END_MEM_ST25TV02KC, 0x4f, 'DS13304 Table 13: END_MEM 4Fh on ST25TV02KC');
  assert.equal(ST25TV02KC_BLOCKS, 0x4f + 1, 'the fake tag is typed in from the datasheet, not from PART');
  assert.equal(judgeProbePreconditions({ configPassword: ok(), rwProtectionA1: ok([0]), endA1: ok([PART.blockCount - 1]), lckConfig: ok([0, 0]) }).proven, true);
});

test('7: a full --protect on an 80 block tag, with the geometry read passing, ends protected with the refusal and the unlock proven', async () => {
  const tag = new FakeTag(80);
  tag.memory.fill(0x5a, 79 * 4);
  const reader = new FakeReader(ACR1552U, tag);
  const { session, result } = await protectOnReader(reader);
  const outcome = await result;
  assert.equal(session.identity?.blockCount, 80);
  assert.equal(session.phase, 'protected');
  assert.equal(outcome.refusalProven, true);
  assert.equal(outcome.unlockProven, true);
  assert.equal(outcome.opcodeProbe, 'passed');
  // The geometry read at selection and again at the reacquire after protection.
  assert.equal(tag.sent.filter((a) => a === 'ff b0 00 4f 04').length, 2);
  assert.equal(tag.sent.filter((a) => a === 'ff b0 00 50 04').length, 2);
  assert.deepEqual(Array.from(tag.memory.subarray(79 * 4)), [0x5a, 0x5a, 0x5a, 0x5a], 'block 79 is never written');
  assert.equal(tag.areaProtection, 0x01);
  assert.equal(hex(tag.password), '0a 1b 2c 3d 4e 5f 60 71');
});

test('7: after protection block 79 still reads and block 80 is still refused, so the tag is still selected as 80 blocks', async () => {
  const reader = new FakeReader(ACR1552U);
  const { transport, result } = await protectOnReader(reader);
  await result;
  await transport.close();
  assert.equal(reader.tag.activeAreaProtection, 0x01);
  const again = await openWith(reader);
  const identity = await again.waitForTag(200);
  assert.equal(identity.blockCount, 80, 'RW_PROTECTION_A1 01b is "read always allowed" (Table 11)');
  assert.deepEqual(reader.tag.sent.slice(-2), ['ff b0 00 4f 04', 'ff b0 00 50 04']);
  await again.close();
});

test('7: the three reads of the image, at verify, before protection and after protection, are the same single Read Binary', async () => {
  const reader = new FakeReader(ACR1552U);
  const { transport, result } = await protectOnReader(reader);
  await result;
  const reads = transport.calls.filter((c) => c.method === 'readBlocks' && c.args[0] === 0 && (c.args[1] as number) > 1);
  assert.equal(reads.length, 3);
  assert.deepEqual(reads.map((c) => c.args), [[0, 9], [0, 9], [0, 9]]);
  assert.equal(reader.tag.sent.filter((a) => a === 'ff b0 00 00 24').length, 3, 'block 0 and blocks 1 to 8, 36 bytes, three times');
});

/** The URI of `n` path characters, and the image blocks (block 0 included) it needs. */
function longUri(n: number): string {
  return `https://treveanspice.com/t/${'a'.repeat(n)}`;
}

test('7: the longest URI the encoder accepts is refused at verify, before protection, and nothing irreversible is sent', async () => {
  // 235 characters of path is the last the 255 byte short record takes; 236 is refused.
  const uri = longUri(235);
  assert.equal(planEncoding(uri).summary.tlvBytes, 264);
  assert.throws(() => planEncoding(longUri(236)), (e: unknown) => isChipError(e) && e.code === 'NDEF_ENCODE');
  const reader = new FakeReader(ACR1552U);
  const transport = new RecordingTransport(await openWith(reader));
  const session = new UnitSession({ transport, uri, code: 'ps', unlockPassword: TagPassword.factoryDefault() });
  await session.selectTag();
  await session.write();
  await assert.rejects(
    () => session.verify(),
    chipCode('READBACK_FAILED', (e) => {
      assert.match(e.message, /The written image is 67 blocks, block 0 included/);
      assert.match(e.message, new RegExp(`at most ${READ_SPAN_MAX_BLOCKS} blocks`));
      assert.match(e.message, /too long to verify/);
    }),
  );
  assert.equal(session.phase, 'failed');
  assert.equal(transport.calls.filter((c) => c.method === 'readBlocks' && c.args[0] === 0 && (c.args[1] as number) > 1).length, 0, 'not even sent');
  assert.deepEqual(irreversibleFrames(reader.tag), []);
  assert.equal(count(reader.tag, B4) + count(reader.tag, B3), 2, 'only the unlock presentation at selection');
  await transport.close();
});

test('7: a URI whose image is exactly 63 blocks verifies and protects, with all three reads at the limit', async () => {
  const uri = longUri(221);
  const reader = new FakeReader(ACR1552U);
  const { transport, session, result } = await protectOnReader(reader, uri);
  const outcome = await result;
  assert.equal(session.phase, 'protected');
  assert.equal(outcome.unlockProven, true);
  const reads = transport.calls.filter((c) => c.method === 'readBlocks' && c.args[0] === 0 && (c.args[1] as number) > 1);
  assert.deepEqual(reads.map((c) => c.args), [[0, 63], [0, 63], [0, 63]]);
});

test('7: one path character more, 64 blocks, is already refused at verify', async () => {
  const reader = new FakeReader(ACR1552U);
  const transport = new RecordingTransport(await openWith(reader));
  const session = new UnitSession({ transport, uri: longUri(222), code: 'ps' });
  await session.selectTag();
  await session.write();
  await assert.rejects(() => session.verify(), chipCode('READBACK_FAILED', (e) => assert.match(e.message, /64 blocks/)));
  await transport.close();
});

test('7: TruST25 with END_MEM 3Dh fails closed at the geometry read: block 79 cannot be read, nothing is written', async () => {
  const tag = new FakeTag(0x3d + 1);
  assert.equal(tag.endA1, 0x3d, 'single area on the reduced memory');
  const reader = new FakeReader(ACR1552U, tag);
  const transport = await openWith(reader);
  await assert.rejects(() => transport.waitForTag(200), chipCode('TAG_NOT_ST25TV02KC', (e) => assert.match(e.message, /Block 79 could not be read/)));
  assert.equal(tag.sent.filter((a) => a.startsWith('ff d6')).length, 0);
  assert.deepEqual(framesSent(tag), [], 'no ISO 15693 frame at all');
  await transport.close();
});

test('7: TruST25 with END_MEM 3Dh fails closed at the probe too: an END_A1 of 3Dh is refused even where block 79 reads', async () => {
  const reader = new FakeReader(ACR1552U);
  reader.tag.tagOverride = (f) => (f[1] === A0 && f[3] === 0x00 && f[4] === 0x01 ? [0x00, 0x3d] : reader.tag.datasheetAnswer(f));
  const { transport, result } = await protectOnReader(reader);
  await assert.rejects(() => result, notLocked(/opcode probe did not pass.*END_A1 reads 0x3d, not 0x4f/));
  assert.equal(transport.countOf('writePassword'), 0);
  assert.deepEqual(irreversibleFrames(reader.tag), []);
  assert.equal(judgeProbePreconditions({ configPassword: ok(), rwProtectionA1: ok([0]), endA1: ok([0x3d]), lckConfig: ok([0, 0]) }).proven, false);
});

/* ------------------------------------------------------------------------ */
/* N1. The new password is proven to open the tag before protection.         */
/* ------------------------------------------------------------------------ */

test('N1: a tag that stores a different value on B1 while answering 00 ends unprotected, PROTECT_FAILED, with no BA, A1 or proof write sent', async () => {
  const reader = new FakeReader(ACR1552U);
  storesB1Raw(reader.tag);
  const { transport, session, result } = await protectOnReader(reader);
  await assert.rejects(
    () => result,
    chipCode('PROTECT_FAILED', (e) => {
      assert.ok(e.message.startsWith(N1_MESSAGE), e.message);
      assert.match(e.message, /tag error code 0x0f/);
      assert.doesNotMatch(e.message, /may already be protected|irreversible part had begun/);
      assert.doesNotMatch(e.message, new RegExp(NEW_PASSWORD));
      assert.match(e.remedy, /PASSWORD UNKNOWN, NOT PROTECTED/);
      assert.match(e.remedy, /stop the batch/);
      assert.equal(e.detail['passwordUnknown'], true);
      assert.equal(e.detail['areaProtectionSent'], false);
    }),
  );
  assert.equal(session.phase, 'failed');
  assert.notEqual(hex(reader.tag.password), '0a 1b 2c 3d 4e 5f 60 71', 'the tag holds a value nobody meant');
  assert.equal(reader.tag.areaProtection, 0x00);
  assert.equal(reader.tag.activeAreaProtection, 0x00);
  assert.equal(count(reader.tag, A1), 0);
  assert.equal(count(reader.tag, BA), 0);
  assert.equal(count(reader.tag, W21), 0);
  assert.equal(transport.countOf('setAreaProtection'), 0);
  // Still writable without any password: the claim in the message.
  await transport.close();
  const again = await openWith(reader);
  await again.waitForTag(200);
  await again.writeBlock(1, reader.tag.memory.slice(4, 8));
  await again.close();
});

test('N1: the check after B1 is in the same session, with a fresh GetRandomNumber, and its failure stops the unit before A1', async () => {
  const reader = new FakeReader(ACR1552U);
  storesB1Raw(reader.tag);
  const { result } = await protectOnReader(reader);
  await assert.rejects(() => result, () => true);
  const sent = reader.tag.sent;
  const b1 = sent.findIndex((a) => carriesSt(a, B1));
  const after = sent.slice(b1 + 1);
  assert.deepEqual(after.map(frameOf).filter((f): f is number[] => f !== null).map((f) => f[1]), [B4, B3], 'B4 then B3 new, then nothing');
  const end = after.indexOf('ff c2 00 00 02 82 00');
  assert.ok(end > after.findIndex((a) => carriesSt(a, B3)), 'no session end between B1 and its check');
});

test('N1: a check after B1 that gets no answer is treated the same way: no A1, password unknown', async () => {
  const reader = new FakeReader(ACR1552U);
  let sawB1 = false;
  reader.tag.tagOverride = (f) => {
    if (f[1] === B1) sawB1 = true;
    if (sawB1 && f[1] === B3) return null;
    return reader.tag.datasheetAnswer(f);
  };
  const { result } = await protectOnReader(reader);
  await assert.rejects(() => result, chipCode('PROTECT_FAILED', (e) => assert.ok(e.message.startsWith(N1_MESSAGE))));
  assert.equal(count(reader.tag, A1), 0);
  assert.equal(reader.tag.areaProtection, 0x00);
});

test('N1: setAreaProtection refuses, sending nothing past the gate, when no password 1 has been shown to open the tag', async () => {
  const { reader, transport } = await selected();
  assert.equal((await transport.verifyOpcodes()).proven, true);
  const before = reader.tag.sent.length;
  await assert.rejects(
    () => transport.setAreaProtection(1, 'write_protected', 1),
    notLocked(/Refusing to apply area protection: no password 1 has been shown to open AREA1.*This command was not sent/),
  );
  assert.deepEqual(reader.tag.sent.slice(before), ['ff ca 00 00 00']);
  assert.equal(transport.irreversibleFramesSent, 0);
  await transport.close();
});

test('N1: after a WritePassword whose check failed, presenting the old password again does not let area protection through', async () => {
  const { reader, transport } = await proven();
  // B1 answers 00 and changes nothing, so the old password still opens the tag and the new one does not.
  reader.tag.tagOverride = (f) => (f[1] === B1 ? [0x00] : reader.tag.datasheetAnswer(f));
  await assert.rejects(() => transport.writePassword(1, NEW().toBytes()), chipCode('PROTECT_FAILED', (e) => assert.ok(e.message.startsWith(N1_MESSAGE))));
  await transport.presentPassword(1, new Uint8Array(8));
  await assert.rejects(
    () => transport.setAreaProtection(1, 'write_protected', 1),
    chipCode('PROTECT_FAILED', (e) => assert.match(e.message, /the password written by WritePassword has not been shown to open the tag since/)),
  );
  assert.equal(count(reader.tag, A1), 0);
  await transport.close();
});

test('N1: only the check inside WritePassword\'s own session counts: a later separate presentation of the new value does not let area protection through', async () => {
  const { reader, transport } = await proven();
  // The tag stores the new value correctly, but the check straight after B1 gets no answer.
  let sawB1 = false;
  let checkLost = false;
  reader.tag.tagOverride = (f) => {
    if (f[1] === B1) sawB1 = true;
    if (sawB1 && !checkLost && f[1] === B3) {
      checkLost = true;
      reader.tag.datasheetAnswer(f);
      return null;
    }
    return reader.tag.datasheetAnswer(f);
  };
  await assert.rejects(() => transport.writePassword(1, NEW().toBytes()), chipCode('PROTECT_FAILED', (e) => assert.ok(e.message.startsWith(N1_MESSAGE))));
  assert.equal(hex(reader.tag.password), '0a 1b 2c 3d 4e 5f 60 71');
  await transport.presentPassword(1, NEW().toBytes());
  await assert.rejects(
    () => transport.setAreaProtection(1, 'write_protected', 1),
    notLocked(/Refusing to apply area protection: the password written by WritePassword has not been shown to open the tag since/),
  );
  assert.equal(count(reader.tag, A1), 0);
  await transport.close();
});

test('N1: the unlock proof is a new session after the refusal proof: B4, B3 with the new password, then the same 21h write, accepted', async () => {
  const reader = new FakeReader(ACR1552U);
  const { result } = await protectOnReader(reader);
  await result;
  const frames = framesSent(reader.tag);
  const writes = frames.map((f, i) => (f[1] === W21 ? i : -1)).filter((i) => i >= 0);
  assert.equal(writes.length, 2, 'the refusal proof and the unlock proof');
  const [refusal, unlock] = writes as [number, number];
  assert.deepEqual(frames.slice(refusal + 1, unlock + 1).map((f) => f[1]), [B4, B3, W21]);
  assert.deepEqual(frames[unlock], frames[refusal], 'the same addressed write of the same bytes');
  assert.equal(frames[unlock - 1]![11], 0x01, 'Password_id 01h');
  const sent = reader.tag.sent;
  const refusalAt = sent.findIndex((a) => frameOf(a)?.[1] === W21);
  const unlockB4 = sent.findIndex((a, i) => i > refusalAt && frameOf(a)?.[1] === B4);
  assert.ok(sent.slice(refusalAt, unlockB4).includes('ff c2 00 00 02 81 00'), 'a new transparent session');
  assert.deepEqual(Array.from(reader.tag.memory.subarray(4, 8)), frames[unlock]!.slice(-4), 'the block holds the bytes it held');
});

test('N1: a protected tag that the recorded password does not open after protection is LOCKED?, never protected', async () => {
  const reader = new FakeReader(ACR1552U);
  let w21 = 0;
  reader.tag.tagOverride = (f) => {
    if (f[1] === W21) w21 += 1;
    if (w21 >= 1 && f[1] === B3) return [0x01, 0x0f];
    return reader.tag.datasheetAnswer(f);
  };
  const { session, result } = await protectOnReader(reader);
  await assert.rejects(() => result, mayBeLocked('PROTECT_FAILED', /the password this run wrote did not open the tag.*The unlock proof write was not sent/));
  assert.equal(session.phase, 'failed');
  assert.equal(count(reader.tag, W21), 1, 'only the refusal proof');
});

test('N1: an unlock proof write that is still refused with the password presented is LOCKED?', async () => {
  const reader = new FakeReader(ACR1552U);
  let w21 = 0;
  reader.tag.tagOverride = (f) => (f[1] === W21 && ++w21 === 2 ? [0x01, 0x12] : reader.tag.datasheetAnswer(f));
  const { result } = await protectOnReader(reader);
  await assert.rejects(() => result, mayBeLocked('PROTECT_FAILED', /unlock proof write to block 1 got tag error code 0x12 rather than a plain success/));
});

/* ------------------------------------------------------------------------ */
/* N2. Readability is checked after the RF cycle.                             */
/* ------------------------------------------------------------------------ */

test('N2: with the field left up on release, a tag that cannot be read once its protection is enforced is caught, LOCKED?', async () => {
  const reader = new FakeReader(ACR1552U);
  reader.tag.unpowerDropsField = false;
  // Read Binary of the image fails only while the new protection is in force, which it is
  // only after the proof's RF cycle (Table 10). Read before the cycle, it would pass.
  reader.tag.failOn = (apdu) => apdu === 'ff b0 00 00 24' && reader.tag.activeAreaProtection !== 0;
  const { session, result } = await protectOnReader(reader);
  await assert.rejects(() => result, mayBeLocked('TRANSPORT_UNAVAILABLE', /The reader rejected a command/));
  assert.equal(session.phase, 'failed');
  assert.equal(count(reader.tag, W21), 1, 'the refusal proof ran first, and the unlock proof did not run');
});

/* ------------------------------------------------------------------------ */
/* N3. LOCKED? only once an irreversible frame was actually sent.             */
/* ------------------------------------------------------------------------ */

test('N3: the transport counts an irreversible frame only when it is transmitted', async () => {
  const { reader, transport } = await proven();
  assert.equal(transport.irreversibleFramesSent, 0);
  await assert.rejects(() => transport.writePassword(0, new Uint8Array(8)), chipCode('PROTECT_FAILED'));
  assert.equal(transport.irreversibleFramesSent, 0);
  await transport.writePassword(1, NEW().toBytes());
  assert.equal(transport.irreversibleFramesSent, 1);
  await transport.setAreaProtection(1, 'write_protected', 1);
  assert.equal(transport.irreversibleFramesSent, 2);
  assert.equal(irreversibleFrames(reader.tag).length, 2);
  await transport.close();
});

test('N3: the current password refused inside WritePassword\'s session is passed through as "WritePassword was not sent", not LOCKED?', async () => {
  const reader = new FakeReader(ACR1552U);
  // Select 1, probe 3, the unit's own presentation 1: the sixth B3 is WritePassword's.
  let b3 = 0;
  reader.tag.tagOverride = (f) => (f[1] === B3 && ++b3 === 6 ? [0x01, 0x0f] : reader.tag.datasheetAnswer(f));
  const { transport, session, result } = await protectOnReader(reader);
  await assert.rejects(() => result, notLocked(/The current password was not accepted immediately before WritePassword.*WritePassword was not sent/));
  assert.equal(session.phase, 'failed');
  assert.equal(session.retryForbidden, true, 'the probe passed, so no automatic retry');
  assert.equal(transport.irreversibleFramesSent, 0);
  assert.deepEqual(irreversibleFrames(reader.tag), []);
  assert.equal(hex(reader.tag.password), '00 00 00 00 00 00 00 00');
});

test('N3: the gate refusing WritePassword is passed through as "This command was not sent", not LOCKED?', async () => {
  const reader = new FakeReader(ACR1552U);
  let b3 = 0;
  let failed = false;
  reader.tag.exchangeOverride = (frame, normal) => {
    if (frame[1] === B3) b3 += 1;
    return normal();
  };
  // The first UID read after the unit's own presentation is the WritePassword gate's.
  reader.tag.failOn = (apdu) => (b3 === 5 && !failed && apdu === 'ff ca 00 00 00' ? (failed = true) : false);
  const { result } = await protectOnReader(reader);
  await assert.rejects(() => result, notLocked(/Refusing to change a password: the tag in the field reads uid unreadable.*This command was not sent/));
  assert.equal(failed, true);
  assert.deepEqual(irreversibleFrames(reader.tag), []);
});

test('N3: once B1 went out, a refusal before A1 is still LOCKED?', async () => {
  const reader = new FakeReader(ACR1552U);
  let sawB1 = false;
  let failed = false;
  reader.tag.exchangeOverride = (frame, normal) => {
    if (frame[1] === B1) sawB1 = true;
    return normal();
  };
  reader.tag.failOn = (apdu) => (sawB1 && !failed && apdu === 'ff ca 00 00 00' ? (failed = true) : false);
  const { result } = await protectOnReader(reader);
  await assert.rejects(() => result, mayBeLocked('PROTECT_FAILED', /Refusing to apply area protection/));
});

test('N3: a transport that cannot count irreversible frames is treated as though one was sent', async () => {
  const sim = new SimulatorTransport({ faults: { 1: 'protect-fail' } });
  assert.equal((sim as TagTransport).irreversibleFramesSent, undefined);
  const transport = new RecordingTransport(sim);
  await transport.open();
  const session = new UnitSession({ transport, uri: URI, code: 'ps' });
  await session.selectTag();
  await session.write();
  const receipt = await session.verify();
  await assert.rejects(
    () => session.protect(receipt, { currentPassword: TagPassword.factoryDefault(), newPassword: NEW() }),
    chipCode('PROTECT_FAILED', (e) => assert.equal(e.detail['mayBeLocked'], true)),
  );
});

/* ------------------------------------------------------------------------ */
/* N4. A batch stops at a unit that may be locked.                            */
/* ------------------------------------------------------------------------ */

async function batchOnReader(reader: FakeReader, units: number) {
  const journalPath = join(mkdtempSync(join(tmpdir(), 'chip-cli-lock3-')), 'run.jsonl');
  const events: BatchEvent[] = [];
  const transport = new PcscTransport(undefined, { loadBinding: async () => new FakeBinding([reader]), readerTimeoutMs: 50 });
  // No beforeUnit: this is --no-prompt, where the next unit would start on the same tag.
  const summary = await runBatch({
    table: RedirectTable.load(),
    code: 'ps',
    count: units,
    journalPath,
    transport,
    dryRun: false,
    protect: true,
    currentPassword: TagPassword.factoryDefault(),
    newPassword: NEW(),
    toolVersion: 'test',
    operator: 'test-operator',
    attemptsPerUnit: 2,
    maxFailures: 10,
    tagTimeoutMs: 200,
    onEvent: (e) => events.push(e),
  });
  return { summary, events, journal: readJournal(journalPath) };
}

test('N4: with --no-prompt, a batch stops at a unit that may be locked and never starts the next unit on that tag', async () => {
  const reader = new FakeReader(ACR1552U);
  reader.tag.exchangeOverride = (frame, normal) => {
    const answer = normal();
    if (frame[1] === B1) throw new Error('[ RemovedCard ] - Error in native function');
    return answer;
  };
  const { summary, events, journal } = await batchOnReader(reader, 3);
  assert.equal(summary.stoppedAtUnsafeUnit, 1);
  assert.equal(summary.aborted, true);
  assert.deepEqual(summary.failed, [1]);
  assert.deepEqual(summary.notAttempted, [2, 3]);
  assert.equal(events.filter((e) => e.type === 'unit-start').length, 1);
  assert.equal(journal.units.length, 1, 'one record for that UID, not two');
  assert.equal(journal.ends.at(-1)?.reason, 'aborted');
  assert.match(journal.ends.at(-1)?.note ?? '', /stopped at unit 1: its tag may be locked/);
  const text = renderBatchSummary(summary);
  assert.match(text, /The run stopped at unit 1: its tag may be locked, or holds a password 1 nobody knows/);
  assert.doesNotMatch(text, /too many units failed/);
});

test('N4: a unit whose new password does not open the tag stops the batch too', async () => {
  const reader = new FakeReader(ACR1552U);
  storesB1Raw(reader.tag);
  const { summary, events } = await batchOnReader(reader, 2);
  assert.equal(summary.stoppedAtUnsafeUnit, 1);
  assert.deepEqual(summary.notAttempted, [2]);
  assert.equal(events.filter((e) => e.type === 'unit-retry').length, 0);
});

test('N4: a unit refused by the probe, with nothing irreversible sent, does not stop the batch', async () => {
  const reader = new FakeReader(ACR1552U);
  reader.tag.configPassword = Uint8Array.from([1, 2, 3, 4]);
  const { summary, events } = await batchOnReader(reader, 2);
  assert.equal(summary.stoppedAtUnsafeUnit, null);
  assert.deepEqual(summary.failed, [1, 2]);
  const started = new Set(events.flatMap((e) => (e.type === 'unit-start' ? [e.seq] : [])));
  assert.deepEqual([...started], [1, 2], 'the run carries on to unit 2');
  assert.deepEqual(irreversibleFrames(reader.tag), []);
});

/* ------------------------------------------------------------------------ */
/* N5. Tests aimed at the reviewer's mutations.                               */
/* ------------------------------------------------------------------------ */

for (const id of [0, 2, 3]) {
  test(`N5 (X7): writePassword with Password_id ${id} after a passed probe is refused by the id check, and only the gate's UID read is sent`, async () => {
    const { reader, transport } = await proven();
    const before = reader.tag.sent.length;
    await assert.rejects(
      () => transport.writePassword(id, new Uint8Array(8)),
      chipCode('PROTECT_FAILED', (e) => {
        assert.match(e.message, new RegExp(`Refusing to change password ${id}: this tool changes only PWD_A1, Password_id 01h\\. This command was not sent\\.`));
        assert.doesNotMatch(e.message, /has not been presented/);
      }),
    );
    assert.deepEqual(reader.tag.sent.slice(before), ['ff ca 00 00 00']);
    assert.equal(transport.irreversibleFramesSent, 0);
    assert.equal(hex(reader.tag.configPassword), '00 00 00 00');
    assert.equal(hex(reader.tag.privPassword), '00 00 00 00');
    await transport.close();
  });
}

test('N5 (X4): in a full --protect, a proof write answered 0Fh is never protection: LOCKED?, not protected', async () => {
  const reader = new FakeReader(ACR1552U);
  reader.tag.protectedWriteError = 0x0f;
  const { session, result } = await protectOnReader(reader);
  await assert.rejects(() => result, mayBeLocked('PROTECT_FAILED', /got neither a plain success nor the "block locked" refusal.*tag error code 0x0f/));
  assert.equal(session.phase, 'failed');
});

test('N5 (X6): a batch unit refused after the probe passed, with nothing irreversible sent, is still never retried', async () => {
  const reader = new FakeReader(ACR1552U);
  let b3 = 0;
  reader.tag.tagOverride = (f) => (f[1] === B3 && ++b3 === 6 ? [0x01, 0x0f] : reader.tag.datasheetAnswer(f));
  const { summary, events, journal } = await batchOnReader(reader, 1);
  assert.deepEqual(summary.failed, [1]);
  assert.equal(events.filter((e) => e.type === 'unit-retry').length, 0);
  assert.equal(journal.units.length, 1);
  assert.match(journal.units[0]?.error?.message ?? '', /WritePassword was not sent/);
});

test('N5 (X8): on the wire, a stored RW_PROTECTION_A1 of 02h (read protected) fails the probe', async () => {
  const { reader, transport } = await selected();
  reader.tag.areaProtection = 0x02;
  const probe = await transport.verifyOpcodes();
  assert.equal(probe.proven, false);
  assert.match(probe.detail, /RW_PROTECTION_A1 reads 0x02/);
  await assert.rejects(() => transport.writePassword(1, NEW().toBytes()), chipCode('PROTECT_FAILED'));
  assert.deepEqual(irreversibleFrames(reader.tag), []);
  await transport.close();
});

test('N5 (X8): in a full --protect, a stored RW_PROTECTION_A1 of 02h stops the run with nothing irreversible sent', async () => {
  const reader = new FakeReader(ACR1552U);
  // Stored but not yet in force (Table 10), so selection, write and verify are unaffected.
  reader.tag.areaProtection = 0x02;
  const { transport, result } = await protectOnReader(reader);
  await assert.rejects(() => result, notLocked(/opcode probe did not pass.*RW_PROTECTION_A1 reads 0x02/));
  assert.equal(transport.countOf('writePassword'), 0);
  assert.deepEqual(irreversibleFrames(reader.tag), []);
});

test('N5 (X10): in a full --protect, a protection read with reserved bits set (05h) is LOCKED?, not protected', async () => {
  const reader = new FakeReader(ACR1552U);
  let sawA1 = false;
  reader.tag.tagOverride = (f) => {
    if (f[1] === A1) sawA1 = true;
    return f[1] === A0 && sawA1 ? [0x00, 0x05] : reader.tag.datasheetAnswer(f);
  };
  const { session, result } = await protectOnReader(reader);
  await assert.rejects(() => result, mayBeLocked('PROTECT_FAILED', /RW_PROTECTION_A1 reads 0x05, with reserved bits b7 to b2 set/));
  assert.equal(session.phase, 'failed');
});

test('N5 (X11): the proof write is not sent when the field UID cannot be read, even though the selected UID matches', async () => {
  const { reader, transport } = await selected();
  reader.tag.failOn = (apdu) => apdu === 'ff ca 00 00 00';
  await assert.rejects(() => transport.proveWriteRefused(1, new Uint8Array(4), UID), chipCode('TAG_CHANGED', (e) => assert.match(e.message, /The proof write was not sent.*reads uid unreadable/)));
  assert.equal(count(reader.tag, W21), 0);
  await transport.close();
});

test('N5 (X11): the unlock proof is not sent to a tag swapped in silently: no B4, no B3, no write', async () => {
  const { reader, transport } = await selected();
  reader.tag.uidLsbFirst = OTHER_UID_LSB_FIRST;
  const before = reader.tag.sent.length;
  await assert.rejects(
    () => transport.proveWriteUnlocked(1, new Uint8Array(4), 1, NEW().toBytes(), UID),
    chipCode('TAG_CHANGED', (e) => assert.match(e.message, /The unlock proof write was not sent/)),
  );
  assert.deepEqual(reader.tag.sent.slice(before).filter((a) => !a.startsWith('ff ca')), []);
  reader.tag.uidLsbFirst = UID_LSB_FIRST;
  await transport.close();
});

/* ------------------------------------------------------------------------ */
/* L1 to L3. The re-check of the same day.                                    */
/* ------------------------------------------------------------------------ */

test('L1: with the field left up on release, a tag reported protected refuses an Update Binary after finish()', async () => {
  const reader = new FakeReader(ACR1552U);
  reader.tag.unpowerDropsField = false;
  const { transport, session, result } = await protectOnReader(reader);
  const outcome = await result;
  assert.equal(outcome.unlockProven, true);
  await session.finish();
  await transport.waitForTag(200);
  const block1 = hex(reader.tag.memory.subarray(4, 8));
  await assert.rejects(() => transport.writeBlock(1, Uint8Array.from([0xde, 0xad, 0xbe, 0xef])), chipCode('WRITE_FAILED'));
  assert.equal(hex(reader.tag.memory.subarray(4, 8)), block1, 'block 1 unchanged');
  assert.equal(reader.tag.presented, false, 'no AREA1 session left open');
  await transport.close();
});

for (const [what, fault] of [
  ['GetRandomNumber gets no answer', (tag: FakeTag) => {
    let sawB1 = false;
    tag.tagOverride = (f) => {
      if (f[1] === B1) sawB1 = true;
      return sawB1 && f[1] === B4 ? null : tag.datasheetAnswer(f);
    };
  }],
  ['the transmit of PresentPassword fails', (tag: FakeTag) => {
    let sawB1 = false;
    tag.exchangeOverride = (frame, normal) => {
      if (frame[1] === B1) sawB1 = true;
      if (sawB1 && frame[1] === B3) throw new Error('lost');
      return normal();
    };
  }],
] as const) {
  test(`L2: a check after B1 that throws because ${what} is the N1 failure: password unknown, no A1, not LOCKED?`, async () => {
    const reader = new FakeReader(ACR1552U);
    fault(reader.tag);
    const { session, result } = await protectOnReader(reader);
    await assert.rejects(() => result, chipCode('PROTECT_FAILED', (e) => {
      assert.ok(e.message.startsWith(N1_MESSAGE), e.message);
      assert.doesNotMatch(e.message, /irreversible part had begun|LOCKED\?/);
      assert.equal(e.detail['passwordUnknown'], true);
      assert.equal(e.detail['areaProtectionSent'], false);
    }));
    assert.equal(session.phase, 'failed');
    assert.equal(count(reader.tag, A1), 0);
    assert.equal(reader.tag.areaProtection, 0x00);
  });
}

test('L3: A1 is counted before its transmit: a transmit that throws after the probe and a presentation, with no B1, counts 1', async () => {
  const { reader, transport } = await proven();
  reader.tag.failOn = (apdu) => carriesSt(apdu, A1);
  await assert.rejects(() => transport.setAreaProtection(1, 'write_protected', 1), () => true);
  assert.equal(count(reader.tag, B1), 0, 'no WritePassword');
  assert.equal(irreversibleFrames(reader.tag).length, 1, 'the A1 frame reached the transmit');
  assert.equal(transport.irreversibleFramesSent, 1);
  await transport.close();
});
