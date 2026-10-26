/**
 * The PC/SC transport driven end to end through a fake reader.
 *
 * **These tests still do not prove the transport works on silicon.** The fake answers
 * the way the PC/SC storage card commands are documented to answer, which is exactly
 * the assumption README section 6.2 says only a tag can settle. What they do prove is
 * everything between the CLI and the binding: that a tag already on the reader is
 * seen, that the reader chosen is one that can hold a tag, that a reader which never
 * appears or a service that is not running fails with a sentence rather than a hang,
 * and above all that **the two irreversible commands send nothing to the reader until
 * the probe has passed**. That last property is the D66 gate, and it is asserted here
 * on the bytes that reach the reader rather than on the error alone.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PCSC_BINDING_PACKAGE,
  PcscTransport,
  READER_STATE_FLAGS,
  adaptPcscMini,
  describePcscError,
  describeReaderState,
  isSamSlot,
  tagPresence,
  type PcscMiniModule,
  type PcscReaderHandle,
  type PcscReaderState,
  type PcscTransportOptions,
} from '../src/transport/pcsc.js';
import { main } from '../src/cli/main.js';
import { isChipError } from '../src/chip/errors.js';
import { PART } from '../src/chip/st25tv02kc.js';
import { ST_COMMANDS } from '../src/chip/st-custom.js';
import { readJournal } from '../src/workflow/journal.js';
import { UnitSession } from '../src/workflow/unit.js';
import { ACR1552U, FakeBinding, FakeReader, FakeTag, OK, carriesSt, hex, pcscError } from './fake-acr1552u.js';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const { PRESENT, EMPTY, MUTE, CHANGED, EXCLUSIVE } = READER_STATE_FLAGS;

async function openWith(
  readers: FakeReader[],
  filter?: string,
  options: PcscTransportOptions = {},
): Promise<{ transport: PcscTransport; binding: FakeBinding }> {
  const binding = new FakeBinding(readers);
  const transport = new PcscTransport(filter, { loadBinding: async () => binding, readerTimeoutMs: 50, ...options });
  await transport.open();
  return { transport, binding };
}

function chipCode(code: string) {
  return (error: unknown) => {
    assert.ok(isChipError(error), 'must be a ChipError so the CLI can render a remedy');
    assert.equal(error.code, code);
    return true;
  };
}

test('a tag already lying on the reader before the unit starts is found', async () => {
  // The previous binding reported state on change only, and the listener was attached
  // per unit, so a tag placed before the prompt was never seen and every unit timed out.
  const reader = new FakeReader(ACR1552U);
  const { transport } = await openWith([reader]);
  const identity = await transport.waitForTag(200);
  assert.equal(identity.uid, 'e002112233445566');
  assert.equal(identity.blockCount, PART.blockCount);
  assert.equal(identity.blockSizeBytes, PART.blockSizeBytes);
  await transport.close();
});

test('selecting a tag sends the UID read and the two geometry reads, in that order and nothing else', async () => {
  const reader = new FakeReader(ACR1552U);
  const { transport } = await openWith([reader]);
  await transport.waitForTag(200);
  // Block 4Fh (79), END_MEM, must answer and block 50h (80) must not.
  assert.deepEqual(reader.tag.sent, ['ff ca 00 00 00', 'ff b0 00 4f 04', 'ff b0 00 50 04']);
  await transport.close();
});

test('the probe accepts an 80 block tag: block 79 readable, block 80 not', async () => {
  const reader = new FakeReader(ACR1552U, new FakeTag(80));
  const { transport } = await openWith([reader]);
  const identity = await transport.waitForTag(200);
  assert.equal(identity.blockCount, 80);
  await transport.close();
});

for (const [blocks, label, pattern] of [
  [64, 'a 64 block part, the geometry this tool wrongly assumed until 25 October 2026', /Block 79 could not be read/],
  [62, 'a TruST25 configured part whose END_MEM DS13304 says may be reduced to 3Dh', /Block 79 could not be read/],
  [16, 'an ST25TV512C, END_MEM 0Fh', /Block 79 could not be read/],
  [81, 'a part one block larger', /Block 80 answered a read/],
  [128, 'a larger ST25 part', /Block 80 answered a read/],
] as const) {
  test(`the probe refuses ${label} (${blocks} blocks) and writes nothing`, async () => {
    const reader = new FakeReader(ACR1552U, new FakeTag(blocks));
    const { transport } = await openWith([reader]);
    await assert.rejects(
      () => transport.waitForTag(200),
      (error: unknown) => {
        assert.ok(isChipError(error));
        assert.equal(error.code, 'TAG_NOT_ST25TV02KC');
        assert.match(error.message, pattern);
        return true;
      },
    );
    assert.ok(reader.tag.sent.every((apdu) => !apdu.startsWith('ff d6')), 'no Update Binary may reach a refused tag');
    await transport.close();
  });
}

/** Every block an Update Binary was sent to, in order. */
function blocksWritten(tag: FakeTag): number[] {
  return tag.sent.filter((apdu) => apdu.startsWith('ff d6')).map((apdu) => parseInt(apdu.slice(6, 11).replace(' ', ''), 16));
}

test('a write over PC/SC on an 80 block tag with a 320 byte container touches blocks 1 to 8 only and keeps block 0', async () => {
  const tag = new FakeTag();
  tag.memory.set([0xe1, 0x40, 0x28, 0x01], 0);
  tag.memory[4] = 0xfe;
  tag.memory.fill(0x5a, 79 * 4);
  const reader = new FakeReader(ACR1552U, tag);
  const { transport } = await openWith([reader]);
  const session = new UnitSession({ transport, uri: 'https://treveanspice.com/t/ps', code: 'ps', tagTimeoutMs: 200 });
  await session.selectTag();
  const plan = await session.write();
  const receipt = await session.verify();
  assert.equal(receipt.decodedUri, 'https://treveanspice.com/t/ps');
  assert.equal(plan.ccAction, 'preserve');
  assert.deepEqual(blocksWritten(tag), [1, 2, 3, 4, 5, 6, 7, 8, 1]);
  assert.deepEqual(Array.from(tag.memory.subarray(0, 4)), [0xe1, 0x40, 0x28, 0x01], 'the container is untouched');
  assert.deepEqual(Array.from(tag.memory.subarray(79 * 4)), [0x5a, 0x5a, 0x5a, 0x5a], 'block 79 is untouched');
  await transport.close();
});

test('a write over PC/SC on a blank 80 block tag adds block 0 last, with the tool\'s E1 40 27 01', async () => {
  const tag = new FakeTag();
  const reader = new FakeReader(ACR1552U, tag);
  const { transport } = await openWith([reader]);
  const session = new UnitSession({ transport, uri: 'https://treveanspice.com/t/ps', code: 'ps', tagTimeoutMs: 200 });
  await session.selectTag();
  const plan = await session.write();
  await session.verify();
  assert.equal(plan.ccAction, 'write');
  assert.deepEqual(blocksWritten(tag), [1, 2, 3, 4, 5, 6, 7, 8, 1, 0]);
  assert.deepEqual(Array.from(tag.memory.subarray(0, 4)), [0xe1, 0x40, 0x27, 0x01]);
  await transport.close();
});

test('no tag within the timeout is TAG_ABSENT, and nothing is sent', async () => {
  const reader = new FakeReader(ACR1552U, new FakeTag(), false);
  const { transport } = await openWith([reader]);
  await assert.rejects(() => transport.waitForTag(150), chipCode('TAG_ABSENT'));
  assert.equal(reader.connects, 0);
  assert.deepEqual(reader.tag.sent, []);
  await transport.close();
});

test('a block write reaches the tag byte for byte and reads back', async () => {
  const reader = new FakeReader(ACR1552U);
  const { transport } = await openWith([reader]);
  await transport.waitForTag(200);
  await transport.writeBlock(1, Uint8Array.from([0x03, 0x1a, 0xd1, 0x01]));
  assert.equal(reader.tag.sent.at(-1), 'ff d6 00 01 04 03 1a d1 01');
  assert.equal(hex(await transport.readBlocks(1, 1)), '03 1a d1 01');
  await transport.close();
});

test('a 63 block read, the largest the tool makes, arrives whole', async () => {
  const reader = new FakeReader(ACR1552U);
  reader.tag.memory.fill(0xab);
  const { transport } = await openWith([reader]);
  await transport.waitForTag(200);
  const image = await transport.readBlocks(0, 63);
  assert.equal(image.length, 252);
  await transport.close();
});

test('an answer longer than the old receive buffer is accepted rather than refused by PC/SC', async () => {
  // The transparent session control commands answer with seven bytes and were given a
  // four byte buffer, which PC/SC refuses outright. Present Password goes through them.
  const reader = new FakeReader(ACR1552U);
  const { transport } = await openWith([reader]);
  await transport.waitForTag(200);
  await transport.presentPassword(1, new Uint8Array(8));
  await transport.close();
});

test('a tag that leaves mid command is TRANSPORT_UNAVAILABLE with a remedy', async () => {
  const reader = new FakeReader(ACR1552U);
  const { transport } = await openWith([reader]);
  await transport.waitForTag(200);
  reader.tag.failTransmit = true;
  await assert.rejects(() => transport.readBlocks(0, 1), chipCode('TRANSPORT_UNAVAILABLE'));
  await transport.close();
});

test('releasing the tag powers it down, and the next unit connects afresh', async () => {
  const reader = new FakeReader(ACR1552U);
  const { transport } = await openWith([reader]);
  await transport.waitForTag(200);
  await transport.releaseTag();
  assert.equal(reader.tag.disconnects, 1);
  await assert.rejects(() => transport.readBlocks(0, 1), chipCode('TRANSPORT_UNAVAILABLE'));
  await transport.waitForTag(200);
  assert.equal(reader.connects, 2);
  await transport.close();
});

/* ------------------------------------------------------------------------ */
/* TAG_ABSENT, case by case. Field report, Monday 26 October 2026: doctor     */
/* said Ready on Windows with an ACR1552U, and write failed TAG_ABSENT.       */
/* ------------------------------------------------------------------------ */

/** A TAG_ABSENT naming its case, the reader and the raw state, as every one must. */
function tagAbsent(which: string, flags: RegExp) {
  return (error: unknown) => {
    assert.ok(isChipError(error));
    assert.equal(error.code, 'TAG_ABSENT');
    assert.match(error.message, new RegExp(`^Case ${which}\\. `));
    assert.ok(error.message.includes(`Reader "${ACR1552U}"`), error.message);
    assert.match(error.message, /state 0x[0-9a-f]{8} /);
    assert.match(error.message, flags);
    assert.equal(error.detail.case, which);
    assert.equal(error.detail.readerName, ACR1552U);
    return true;
  };
}

test('no tag: case NO_TAG, with the EMPTY state, and the other readers named so a wrong pick shows', async () => {
  const reader = new FakeReader(ACR1552U, new FakeTag(), false);
  const other = new FakeReader('Broadcom Corp Contacted SmartCard 0');
  const { transport } = await openWith([reader, other]);
  await assert.rejects(() => transport.waitForTag(50), (error: unknown) => {
    tagAbsent('NO_TAG', /EMPTY/)(error);
    assert.ok(isChipError(error) && error.message.includes('Other readers attached: "Broadcom Corp Contacted SmartCard 0"'));
    return true;
  });
  assert.equal(reader.connects, 0);
  await transport.close();
});

test('a reader that never reported a state says so rather than EMPTY', async () => {
  const reader = new FakeReader(ACR1552U, new FakeTag(), false);
  reader.raw = 0;
  const { transport } = await openWith([reader]);
  await assert.rejects(() => transport.waitForTag(20), tagAbsent('NO_TAG', /0x00000000 no flags, nothing reported yet/));
  await transport.close();
});

test('an unplugged reader: case READER_GONE, at once rather than at the timeout', async () => {
  const reader = new FakeReader(ACR1552U, new FakeTag(), false);
  reader.gone = true;
  const { transport } = await openWith([reader]);
  const started = Date.now();
  await assert.rejects(() => transport.waitForTag(5_000), tagAbsent('READER_GONE', /reader disconnected/));
  assert.ok(Date.now() - started < 1_000);
  await transport.close();
});

test('a tag that stays PRESENT with MUTE is connected to after the grace, and goes through every check', async () => {
  // Before, this waited out the whole timeout and reported "No tag arrived".
  const reader = new FakeReader(ACR1552U);
  reader.raw = PRESENT | MUTE | CHANGED;
  const { transport } = await openWith([reader], undefined, { muteGraceMs: 30 });
  const identity = await transport.waitForTag(5_000);
  assert.equal(identity.uid, 'e002112233445566');
  assert.equal(reader.connects, 1);
  assert.deepEqual(reader.tag.sent, ['ff ca 00 00 00', 'ff b0 00 4f 04', 'ff b0 00 50 04'], 'the same UID and geometry checks, nothing written');
  await transport.close();
});

test('a mute tag is given the grace to clear by itself before the tool connects', async () => {
  const reader = new FakeReader(ACR1552U);
  reader.raw = PRESENT | MUTE;
  setTimeout(() => {
    reader.raw = PRESENT;
  }, 150);
  const { transport } = await openWith([reader], undefined, { muteGraceMs: 2_000 });
  const started = Date.now();
  await transport.waitForTag(5_000);
  const waited = Date.now() - started;
  assert.ok(waited >= 100 && waited < 1_500, `connected when MUTE cleared, after ${waited} ms`);
  assert.equal(reader.connects, 1);
  await transport.close();
});

test('a mute tag is tried at the deadline when the timeout is shorter than the grace', async () => {
  const reader = new FakeReader(ACR1552U);
  reader.raw = PRESENT | MUTE;
  const { transport } = await openWith([reader], undefined, { muteGraceMs: 60_000 });
  await transport.waitForTag(50);
  assert.equal(reader.connects, 1);
  await transport.close();
});

test('a mute tag that will not connect: case TAG_MUTE, with the PC/SC error name, and nothing sent', async () => {
  const reader = new FakeReader(ACR1552U);
  reader.raw = 0x00020000 | PRESENT | MUTE | CHANGED;
  reader.connectError = () => pcscError('UnresponsiveCard');
  const { transport } = await openWith([reader], undefined, { muteGraceMs: 10 });
  await assert.rejects(() => transport.waitForTag(5_000), (error: unknown) => {
    tagAbsent('TAG_MUTE', /0x00020222 CHANGED\|PRESENT\|MUTE/)(error);
    assert.ok(isChipError(error));
    assert.match(error.message, /UnresponsiveCard \(SCARD_W_UNRESPONSIVE_CARD\)/);
    assert.match(error.remedy, /edge of the reader field/);
    return true;
  });
  assert.equal(reader.connects, 1, 'one attempt, not a loop against the reader');
  assert.deepEqual(reader.tag.sent, []);
  await transport.close();
});

test('another application holding the reader: case CONNECT_FAILED, SCARD_E_SHARING_VIOLATION, and the remedy says close it', async () => {
  const reader = new FakeReader(ACR1552U);
  reader.raw = PRESENT | EXCLUSIVE | CHANGED;
  reader.connectError = () => pcscError('SharingViolation');
  const { transport } = await openWith([reader]);
  await assert.rejects(() => transport.waitForTag(200), (error: unknown) => {
    tagAbsent('CONNECT_FAILED', /PRESENT\|EXCLUSIVE/)(error);
    assert.ok(isChipError(error));
    assert.match(error.message, /SharingViolation \(SCARD_E_SHARING_VIOLATION\): \[ Client\.TaskConnect \] Async task error/);
    assert.match(error.remedy, /holds the reader exclusively/);
    return true;
  });
  await transport.close();
});

for (const [code, name, remedy] of [
  ['ProtoMismatch', 'SCARD_E_PROTO_MISMATCH', /may not be ISO 15693/],
  ['RemovedCard', 'SCARD_W_REMOVED_CARD', /left the field/],
  ['UnresponsiveCard', 'SCARD_W_UNRESPONSIVE_CARD', /edge of the reader field/],
] as const) {
  test(`a connect failing ${code} without MUTE is CONNECT_FAILED naming ${name}`, async () => {
    const reader = new FakeReader(ACR1552U);
    reader.connectError = () => pcscError(code);
    const { transport } = await openWith([reader]);
    await assert.rejects(() => transport.waitForTag(200), (error: unknown) => {
      tagAbsent('CONNECT_FAILED', /PRESENT/)(error);
      assert.ok(isChipError(error));
      assert.ok(error.message.includes(`${code} (${name})`), error.message);
      assert.match(error.remedy, remedy);
      return true;
    });
    await transport.close();
  });
}

test('a reader that will not give the UID: case UID_REFUSED, with the status word', async () => {
  const reader = new FakeReader(ACR1552U);
  reader.tag.uidAnswer = [0x6a, 0x81];
  const { transport } = await openWith([reader]);
  await assert.rejects(() => transport.waitForTag(200), (error: unknown) => {
    tagAbsent('UID_REFUSED', /PRESENT/)(error);
    assert.ok(isChipError(error) && error.message.includes('status 0x6a81'));
    return true;
  });
  await transport.close();
});

test('a command the reader rejects names the PC/SC error, not only "Async task error"', async () => {
  const reader = new FakeReader(ACR1552U);
  const { transport } = await openWith([reader]);
  await transport.waitForTag(200);
  reader.tag.failTransmit = true;
  await assert.rejects(() => transport.readBlocks(0, 1), (error: unknown) => {
    assert.ok(isChipError(error));
    assert.equal(error.code, 'TRANSPORT_UNAVAILABLE');
    assert.match(error.message, /RemovedCard/);
    return true;
  });
  await transport.close();
});

test('reader state flags are decoded by name, with the event count in the high word left as raw hex', () => {
  assert.equal(describeReaderState({ raw: 0x00030222, gone: false }), '0x00030222 CHANGED|PRESENT|MUTE');
  assert.equal(describeReaderState({ raw: 0x00000012, gone: false }), '0x00000012 CHANGED|EMPTY');
  assert.equal(describeReaderState({ raw: 0x000001a2, gone: false }), '0x000001a2 CHANGED|PRESENT|EXCLUSIVE|INUSE');
  assert.equal(describeReaderState({ raw: 0, gone: true }), '0x00000000 no flags, nothing reported yet, reader disconnected');
  assert.equal(tagPresence({ raw: PRESENT | MUTE, gone: false }), 'mute');
  assert.equal(tagPresence({ raw: PRESENT | READER_STATE_FLAGS.INUSE, gone: false }), 'present');
  assert.equal(tagPresence({ raw: EMPTY, gone: false }), 'absent');
  assert.equal(tagPresence({ raw: PRESENT, gone: true }), 'reader-gone');
});

test('PC/SC errors are described by their code, and plain errors are left alone', () => {
  assert.equal(describePcscError(pcscError('NoSmartCard')), 'NoSmartCard (SCARD_E_NO_SMARTCARD): [ Client.TaskConnect ] Async task error');
  assert.equal(describePcscError(pcscError('Mystery')), 'Mystery: [ Client.TaskConnect ] Async task error');
  assert.equal(describePcscError(new Error('[ RemovedCard ] - Error in native function')), '[ RemovedCard ] - Error in native function');
  assert.equal(describePcscError('text'), 'text');
});

test('the state flags match the ReaderStatus pcsc-mini declares, when it is installed', (t) => {
  const declarations = join(PACKAGE_ROOT, 'node_modules', 'pcsc-mini', 'build', 'addon.node.d.ts');
  let text: string;
  try {
    text = readFileSync(declarations, 'utf8');
  } catch {
    t.skip('pcsc-mini is not installed here');
    return;
  }
  const block = /export enum ReaderStatus \{([^}]*)\}/.exec(text)?.[1] ?? '';
  const declared = Object.fromEntries(Array.from(block.matchAll(/(\w+) = (\d+)/g), (m) => [m[1]!.replace('_', ''), Number(m[2])]));
  for (const [name, bit] of Object.entries(READER_STATE_FLAGS)) {
    assert.equal(declared[name], bit, `${name}`);
  }
});

/* ------------------------------------------------------------------------ */
/* What doctor says about the tag on the reader.                             */
/* ------------------------------------------------------------------------ */

test('inspectTag on a tag lying on the reader reads its UID, sends nothing else, and powers it down', async () => {
  const reader = new FakeReader(ACR1552U);
  const { transport } = await openWith([reader]);
  const tag = await transport.inspectTag(200);
  assert.equal(tag.presence, 'present');
  assert.equal(tag.selected, true);
  assert.equal(tag.uid, 'e002112233445566');
  assert.match(tag.note, /STMicroelectronics/);
  assert.deepEqual(reader.tag.sent, ['ff ca 00 00 00']);
  assert.equal(reader.tag.disconnects, 1);
  await transport.close();
});

test('inspectTag with no tag says absent with the state, and connects to nothing', async () => {
  const reader = new FakeReader(ACR1552U, new FakeTag(), false);
  const { transport } = await openWith([reader]);
  const tag = await transport.inspectTag(30);
  assert.equal(tag.presence, 'absent');
  assert.equal(tag.selected, false);
  assert.equal(tag.uid, null);
  assert.match(tag.readerState, /EMPTY/);
  assert.equal(reader.connects, 0);
  await transport.close();
});

test('inspectTag on a mute tag connects anyway, and says so either way', async () => {
  const reader = new FakeReader(ACR1552U);
  reader.raw = PRESENT | MUTE;
  const { transport } = await openWith([reader], undefined, { muteGraceMs: 10 });
  const ok = await transport.inspectTag(500);
  assert.equal(ok.presence, 'mute');
  assert.equal(ok.selected, true);
  assert.equal(ok.uid, 'e002112233445566');
  assert.match(ok.note, /after the tool connected to a mute tag/);

  reader.connectError = () => pcscError('UnresponsiveCard');
  const refused = await transport.inspectTag(500);
  assert.equal(refused.presence, 'mute');
  assert.equal(refused.selected, false);
  assert.match(refused.note, /does not answer activation, and connecting again failed: UnresponsiveCard \(SCARD_W_UNRESPONSIVE_CARD\)/);
  assert.match(refused.readerState, /PRESENT\|MUTE/);
  await transport.close();
});

test('inspectTag on a tag that is not ST says whose it is and does not count it as selected', async () => {
  const reader = new FakeReader(ACR1552U);
  reader.tag.uidAnswer = [0x66, 0x55, 0x44, 0x33, 0x22, 0x11, 0x04, 0xe0, ...OK];
  const { transport } = await openWith([reader]);
  const tag = await transport.inspectTag(200);
  assert.equal(tag.selected, false);
  assert.equal(tag.uid, 'e004112233445566');
  assert.match(tag.note, /manufacturer code 0x04, so not STMicroelectronics/);
  await transport.close();
});

async function cli(args: string[], readers: FakeReader[], options: PcscTransportOptions = {}) {
  const out: string[] = [];
  const binding = new FakeBinding(readers);
  const code = await main(args, {
    out: (line) => out.push(line),
    err: (line) => out.push(line),
    pcsc: { loadBinding: async () => binding, readerTimeoutMs: 50, ...options },
  });
  return { code, out: out.join('\n'), binding };
}

test('doctor --transport reader with a tag on the reader prints present, the UID and the state, and is Ready', async () => {
  const result = await cli(['doctor', '--transport', 'reader'], [new FakeReader(ACR1552U)]);
  assert.match(result.out, /ok {4}tag on the reader {12}present, uid e002112233445566, ISO 15693, STMicroelectronics\. Reader state 0x00000022 CHANGED\|PRESENT/);
  assert.match(result.out, new RegExp(`physical reader responded: ${ACR1552U}`));
  assert.match(result.out, /Ready\./);
  assert.equal(result.code, 0);
  assert.equal(result.binding.stops, 1);
});

test('doctor --transport reader with no tag says absent and is still Ready', async () => {
  const result = await cli(['doctor', '--transport', 'reader', '--tag-timeout-ms', '20'], [new FakeReader(ACR1552U, new FakeTag(), false)]);
  assert.match(result.out, /ok {4}tag on the reader {12}absent, no tag seen within 20 ms\. Reader state 0x00000012 CHANGED\|EMPTY/);
  assert.match(result.out, /Ready\./);
});

test('doctor --transport reader with a mute tag it cannot select fails, naming mute, the error and the state', async () => {
  const reader = new FakeReader(ACR1552U);
  reader.raw = PRESENT | MUTE;
  reader.connectError = () => pcscError('UnresponsiveCard');
  const result = await cli(['doctor', '--transport', 'reader'], [reader], { muteGraceMs: 10 });
  assert.match(result.out, /FAIL {2}tag on the reader {12}mute, it does not answer activation, and connecting again failed: UnresponsiveCard/);
  assert.match(result.out, /PRESENT\|MUTE/);
  assert.ok(!result.out.includes('Ready.'));
  assert.notEqual(result.code, 0);
});

test('doctor names the other readers attached beside the one it picked', async () => {
  const result = await cli(
    ['doctor', '--transport', 'reader'],
    [new FakeReader('ACS ACR1552 1S CL Reader SAM 0'), new FakeReader(ACR1552U)],
  );
  assert.match(result.out, /physical reader responded: ACS ACR1552 1S CL Reader PICC 0 \(also attached: ACS ACR1552 1S CL Reader SAM 0\)/);
});

test('write --transport reader that meets a mute tag prints the case, the state and the reader', async () => {
  const reader = new FakeReader(ACR1552U);
  reader.raw = PRESENT | MUTE;
  reader.connectError = () => pcscError('UnresponsiveCard');
  const result = await cli(['write', '--code', 'ps', '--transport', 'reader', '--tag-timeout-ms', '200'], [reader], { muteGraceMs: 10 });
  assert.match(result.out, /FAILED {2}TAG_ABSENT/);
  assert.match(result.out, /Case TAG_MUTE\. .*UnresponsiveCard.* Reader "ACS ACR1552 1S CL Reader PICC 0", state 0x00000220 PRESENT\|MUTE\./);
  assert.deepEqual(reader.tag.sent, []);
});

/* ------------------------------------------------------------------------ */
/* --protect and a running Tag Tool. Both can open the reader in shared mode. */
/* Servers here listen on 10375 and 10376.                                    */
/* ------------------------------------------------------------------------ */

/** Answers /api/ping the way the Tag Tool does, once `running` is true. Before that it is some other program. */
async function fakeTagTool(port: number, running: boolean): Promise<{ server: Server; set: (on: boolean) => void }> {
  let on = running;
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(on ? { app: 'trevean-tag-tool', version: 'test' } : { app: 'something-else' }));
  });
  await new Promise<void>((r) => server.listen({ host: '127.0.0.1', port }, () => r()));
  return { server, set: (value) => (on = value) };
}

const closeServer = (server: Server) => new Promise<void>((r) => server.close(() => r()));
const ST_COMMAND_BYTES = Object.values(ST_COMMANDS).map((c) => c.code);
const carriesAnySt = (apdus: string[]) => apdus.filter((a) => ST_COMMAND_BYTES.some((code) => carriesSt(a, code)));

async function withPassword<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env['TEST_TAG_TOOL_GUARD_PASSWORD'];
  process.env['TEST_TAG_TOOL_GUARD_PASSWORD'] = 'a1b2c3d4e5f60718';
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env['TEST_TAG_TOOL_GUARD_PASSWORD'];
    else process.env['TEST_TAG_TOOL_GUARD_PASSWORD'] = previous;
  }
}

const PROTECT = ['--transport', 'reader', '--protect', '--password-env', 'TEST_TAG_TOOL_GUARD_PASSWORD', '--tag-timeout-ms', '200'];

test('write and batch --protect on a reader refuse to start while a Tag Tool is running, before anything reaches the reader', async () => {
  const tagTool = await fakeTagTool(10375, true);
  const journalDir = mkdtempSync(join(tmpdir(), 'chip-cli-guard-'));
  const journal = join(journalDir, 'ps.jsonl');
  try {
    await withPassword(async () => {
      for (const args of [
        ['write', '--code', 'ps', ...PROTECT],
        ['batch', '--code', 'ps', '--count', '1', '--journal', journal, '--no-prompt', ...PROTECT],
      ]) {
        const reader = new FakeReader(ACR1552U);
        const out: string[] = [];
        const binding = new FakeBinding([reader]);
        const code = await main(args, {
          out: (line) => out.push(line),
          err: (line) => out.push(line),
          pcsc: { loadBinding: async () => binding, readerTimeoutMs: 50 },
          tagToolPorts: [10376, 10375],
        });
        const text = out.join('\n');
        assert.equal(code, 1, `${args[0]}: ${text}`);
        assert.match(text, /FAILED {2}USAGE/);
        assert.match(text, /Close the Tag Tool first: both programs can open the reader at the same time and nothing stops them\./);
        assert.match(text, /http:\/\/127\.0\.0\.1:10375\//);
        assert.deepEqual(reader.tag.sent, [], `${args[0]}: nothing reaches the reader`);
      }
    });
    assert.equal(existsSync(journal), false, 'the batch stopped before its journal was started');
  } finally {
    await closeServer(tagTool.server);
    rmSync(journalDir, { recursive: true, force: true });
  }
});

test('write --protect checks again before the protect step, and protects nothing if a Tag Tool started meanwhile', async () => {
  // Some other program on the port first, so the check before opening the reader passes.
  const tagTool = await fakeTagTool(10376, false);
  try {
    await withPassword(async () => {
      const reader = new FakeReader(ACR1552U);
      const binding = new FakeBinding([reader]);
      const out: string[] = [];
      let sentBeforeTagTool = -1;
      const code = await main(['write', '--code', 'ps', ...PROTECT], {
        out: (line) => {
          out.push(line);
          if (line.startsWith('Verified')) {
            // The Tag Tool is started while the tag is being written.
            tagTool.set(true);
            sentBeforeTagTool = reader.tag.sent.length;
          }
        },
        err: (line) => out.push(line),
        pcsc: { loadBinding: async () => binding, readerTimeoutMs: 50 },
        tagToolPorts: [10376],
      });
      const text = out.join('\n');
      assert.ok(sentBeforeTagTool > 0, `the tag was written and verified first: ${text}`);
      assert.equal(code, 1, text);
      assert.match(text, /Close the Tag Tool first/);
      assert.match(text, /written and verified but not protected/);
      assert.doesNotMatch(text, /Protected {8}/);
      assert.deepEqual(carriesAnySt(reader.tag.sent.slice(sentBeforeTagTool)), [], 'not one password or protection command, not even the probe');
      assert.equal(reader.tag.areaProtection, 0);
    });
  } finally {
    await closeServer(tagTool.server);
  }
});

test('batch --protect checks again before each unit, and stops with the next unit not attempted if a Tag Tool started meanwhile', async () => {
  const tagTool = await fakeTagTool(10376, false);
  const journalDir = mkdtempSync(join(tmpdir(), 'chip-cli-guard-'));
  const journal = join(journalDir, 'ps.jsonl');
  try {
    await withPassword(async () => {
      const reader = new FakeReader(ACR1552U);
      const binding = new FakeBinding([reader]);
      const out: string[] = [];
      let sentBeforeTagTool = -1;
      const code = await main(['batch', '--code', 'ps', '--count', '2', '--journal', journal, '--no-prompt', ...PROTECT], {
        out: (line) => {
          out.push(line);
          if (/^ {5}1 {2}protected /.test(line)) {
            tagTool.set(true);
            sentBeforeTagTool = reader.tag.sent.length;
          }
        },
        err: (line) => out.push(line),
        pcsc: { loadBinding: async () => binding, readerTimeoutMs: 50 },
        tagToolPorts: [10376],
      });
      const text = out.join('\n');
      assert.ok(sentBeforeTagTool > 0, `unit 1 was protected first: ${text}`);
      assert.equal(code, 1, text);
      assert.match(text, /Close the Tag Tool first/);
      assert.match(text, /This unit was not attempted\. Rerun the same command to resume the batch\./);
      assert.deepEqual(reader.tag.sent.slice(sentBeforeTagTool), [], 'nothing reached the reader for unit 2');
      const units = readJournal(journal).units;
      assert.deepEqual(units.map((u) => [u.seq, u.outcome]), [[1, 'protected']]);
    });
  } finally {
    await closeServer(tagTool.server);
    rmSync(journalDir, { recursive: true, force: true });
  }
});

test('write --protect on a reader still protects when nothing on the Tag Tool ports is a Tag Tool', async () => {
  const other = await fakeTagTool(10376, false);
  try {
    await withPassword(async () => {
      const reader = new FakeReader(ACR1552U);
      const binding = new FakeBinding([reader]);
      const out: string[] = [];
      const code = await main(['write', '--code', 'ps', ...PROTECT], {
        out: (line) => out.push(line),
        err: (line) => out.push(line),
        pcsc: { loadBinding: async () => binding, readerTimeoutMs: 50 },
        tagToolPorts: [10375, 10376],
      });
      const text = out.join('\n');
      assert.equal(code, 0, text);
      assert.match(text, /Protected {8}area 1/);
    });
  } finally {
    await closeServer(other.server);
  }
});

/* ------------------------------------------------------------------------ */
/* THE GATE, on the wire. "Decision log", D66, and README section 6.4.       */
/* ------------------------------------------------------------------------ */

const WRITE_PASSWORD_BYTE = ST_COMMANDS.WRITE_PASSWORD.code;
const SET_PROTECTION_BYTE = ST_COMMANDS.WRITE_CONFIGURATION.code;
/** ToggleDiscreetSilent (DS13304 6.4.23), which the tool used to send as "Set Memory Protection". */
const TOGGLE_DISCREET_SILENT = 0xba;
const carries = carriesSt;

for (const [label, call] of [
  ['writePassword', (t: PcscTransport) => t.writePassword(1, Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))],
  ['setAreaProtection', (t: PcscTransport) => t.setAreaProtection(1, 'write_protected', 1)],
] as const) {
  test(`${label} sends NOTHING to the reader while the opcodes are unproven, with a tag selected`, async () => {
    const reader = new FakeReader(ACR1552U);
    const { transport } = await openWith([reader]);
    await transport.waitForTag(200);
    const before = reader.tag.sent.length;
    await assert.rejects(() => call(transport), chipCode('PROTECT_FAILED'));
    assert.equal(reader.tag.sent.length, before, 'not one APDU, not even a session start');
    await transport.close();
  });

  test(`${label} stays locked when the probe gets the same answer to both passwords`, async () => {
    const reader = new FakeReader(ACR1552U);
    reader.tag.tagOverride = () => [0x01, 0x0f];
    const { transport } = await openWith([reader]);
    await transport.waitForTag(200);
    const probe = await transport.verifyOpcodes();
    assert.equal(probe.proven, false);
    const before = reader.tag.sent.length;
    await assert.rejects(() => call(transport), chipCode('PROTECT_FAILED'));
    assert.equal(reader.tag.sent.length, before);
    await transport.close();
  });
}

test('the probe that unlocks the pair sends only non destructive commands, never either irreversible opcode', async () => {
  // The fake tag accepts the factory defaults (DS13304 Tables 17 and 19) and refuses anything else.
  const reader = new FakeReader(ACR1552U);
  const { transport } = await openWith([reader]);
  await transport.waitForTag(200);
  const probe = await transport.verifyOpcodes();
  assert.equal(probe.proven, true);
  assert.equal(reader.tag.sent.filter((a) => carries(a, WRITE_PASSWORD_BYTE) || carries(a, SET_PROTECTION_BYTE)).length, 0);
  assert.equal(reader.tag.sent.filter((a) => carries(a, TOGGLE_DISCREET_SILENT)).length, 0);
  await transport.close();
});

test('the unproven state is per transport: a new transport starts locked even after another proved the path', async () => {
  const reader = new FakeReader(ACR1552U);
  const first = await openWith([reader]);
  await first.transport.waitForTag(200);
  assert.equal((await first.transport.verifyOpcodes()).proven, true);
  await first.transport.close();

  const second = await openWith([reader]);
  await second.transport.waitForTag(200);
  await assert.rejects(() => second.transport.writePassword(1, Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])), chipCode('PROTECT_FAILED'));
  await second.transport.close();
});

/* ------------------------------------------------------------------------ */
/* Opening the reader.                                                       */
/* ------------------------------------------------------------------------ */

test('with no --reader-name, a SAM slot announced first is passed over for the contactless interface', async () => {
  const sam = new FakeReader('ACS ACR1552 1S CL Reader SAM 0');
  const picc = new FakeReader(ACR1552U);
  const { transport } = await openWith([sam, picc]);
  assert.equal(transport.readerName, ACR1552U);
  await transport.close();
});

test('--reader-name picks by substring, ignoring case, and is obeyed even for a SAM slot', async () => {
  const sam = new FakeReader('ACS ACR1552 1S CL Reader SAM 0');
  const picc = new FakeReader(ACR1552U);
  const { transport } = await openWith([picc, sam], 'sam 0');
  assert.equal(transport.readerName, 'ACS ACR1552 1S CL Reader SAM 0');
  await transport.close();
});

test('the SAM check matches the word SAM only', () => {
  assert.equal(isSamSlot('ACS ACR1552 1S CL Reader SAM 0'), true);
  assert.equal(isSamSlot(ACR1552U), false);
  assert.equal(isSamSlot('Samsung Reader'), false);
});

test('a reader that never appears fails with TRANSPORT_UNAVAILABLE and the binding is stopped, so the command exits', async () => {
  const binding = new FakeBinding([]);
  const transport = new PcscTransport(undefined, { loadBinding: async () => binding, readerTimeoutMs: 30 });
  await assert.rejects(() => transport.open(), chipCode('TRANSPORT_UNAVAILABLE'));
  assert.equal(binding.stops, 1);
});

test('a PC/SC service that is not running fails at once with a remedy about plugging the reader in', async () => {
  const binding = new FakeBinding([], Object.assign(new Error('[ NoService ] - Error in native function'), { code: 'NoService' }));
  const transport = new PcscTransport(undefined, { loadBinding: async () => binding, readerTimeoutMs: 5_000 });
  const started = Date.now();
  await assert.rejects(
    () => transport.open(),
    (error: unknown) => {
      assert.ok(isChipError(error));
      assert.equal(error.code, 'TRANSPORT_UNAVAILABLE');
      assert.match(error.message, /NoService/);
      assert.match(error.remedy, /Plug the reader in/);
      return true;
    },
  );
  assert.ok(Date.now() - started < 1_000, 'fails at once rather than waiting out the reader timeout');
  assert.equal(binding.stops, 1);
});

test('a binding that is not installed names the exact package to install', async () => {
  const transport = new PcscTransport(undefined, {
    loadBinding: async () => {
      throw new Error('Cannot find package');
    },
  });
  await assert.rejects(
    () => transport.open(),
    (error: unknown) => {
      assert.ok(isChipError(error));
      assert.equal(error.code, 'TRANSPORT_UNAVAILABLE');
      assert.ok(error.remedy.includes(PCSC_BINDING_PACKAGE));
      return true;
    },
  );
});

test('close stops the binding and the reader name survives it for doctor', async () => {
  const { transport, binding } = await openWith([new FakeReader(ACR1552U)]);
  await transport.close();
  assert.equal(binding.stops, 1);
  assert.equal(transport.readerName, ACR1552U);
});

/* ------------------------------------------------------------------------ */
/* The pcsc-mini adapter, against a fake module of the same shape.           */
/* ------------------------------------------------------------------------ */

const STATUS = { PRESENT: 32, MUTE: 512, EMPTY: 16 };

function fakePcscMini() {
  const log: string[] = [];
  class Reader extends EventEmitter {
    constructor(private readonly readerName: string) {
      super();
    }
    name() {
      return this.readerName;
    }
    async connect(mode: number) {
      log.push(`connect mode ${mode}`);
      return {
        transmit: async (input: Uint8Array) => {
          log.push(`transmit ${hex(input)}`);
          return Uint8Array.from(OK);
        },
        disconnect: async (then: number) => {
          log.push(`disconnect ${then}`);
        },
      };
    }
  }
  let client: (EventEmitter & { stopped: number }) | null = null;
  class Client extends EventEmitter {
    stopped = 0;
    constructor() {
      super();
      client = this;
    }
    start() {
      return this;
    }
    stop() {
      this.stopped += 1;
    }
  }
  const module: PcscMiniModule = {
    Client: Client as unknown as PcscMiniModule['Client'],
    CardMode: { SHARED: 2 },
    CardDisposition: { UNPOWER: 2, LEAVE: 0 },
  };
  /** Mimics pcsc-mini: "reader" is emitted, then the first "change" right after it. */
  const announce = (name: string, raw: number) => {
    const reader = new Reader(name);
    client!.emit('reader', reader);
    reader.emit('change', { raw });
    return reader;
  };
  return { module, log, announce, client: () => client! };
}

test('the adapter hears the state reported together with the reader announcement', () => {
  const fake = fakePcscMini();
  const binding = adaptPcscMini(fake.module);
  const seen: PcscReaderHandle[] = [];
  binding.start((r) => seen.push(r), () => undefined);
  const raw = fake.announce(ACR1552U, STATUS.PRESENT);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.name, ACR1552U);
  assert.equal(tagPresence(seen[0]!.state()), 'present');
  raw.emit('change', { raw: STATUS.EMPTY });
  assert.equal(tagPresence(seen[0]!.state()), 'absent');
});

test('the adapter passes the raw state through, so mute and an unplugged reader can each be named', () => {
  const fake = fakePcscMini();
  const binding = adaptPcscMini(fake.module);
  const seen: PcscReaderHandle[] = [];
  binding.start((r) => seen.push(r), () => undefined);
  const raw = fake.announce(ACR1552U, 0x00030000 | STATUS.PRESENT | STATUS.MUTE);
  assert.deepEqual(seen[0]!.state(), { raw: 0x00030000 | STATUS.PRESENT | STATUS.MUTE, gone: false });
  assert.equal(tagPresence(seen[0]!.state()), 'mute');
  raw.emit('change', { raw: STATUS.PRESENT });
  assert.equal(tagPresence(seen[0]!.state()), 'present');
  raw.emit('disconnect');
  assert.equal(tagPresence(seen[0]!.state()), 'reader-gone');
});

test('the adapter connects shared, passes APDUs through, unpowers on release, and stop stops the client', async () => {
  const fake = fakePcscMini();
  const binding = adaptPcscMini(fake.module);
  const seen: PcscReaderHandle[] = [];
  binding.start((r) => seen.push(r), () => undefined);
  fake.announce(ACR1552U, STATUS.PRESENT);
  const card = await seen[0]!.connect();
  assert.equal(hex(await card.transmit(Uint8Array.from([0xff, 0xca, 0, 0, 0]))), '90 00');
  await card.disconnectUnpower();
  binding.stop();
  assert.deepEqual(fake.log, ['connect mode 2', 'transmit ff ca 00 00 00', 'disconnect 2']);
  assert.equal(fake.client().stopped, 1);
});

test('the adapter lets go with SCARD_LEAVE_CARD only when asked, for the Tag Tool\'s read only polls', async () => {
  const fake = fakePcscMini();
  const binding = adaptPcscMini(fake.module);
  const seen: PcscReaderHandle[] = [];
  binding.start((r) => seen.push(r), () => undefined);
  fake.announce(ACR1552U, STATUS.PRESENT);
  const card = await seen[0]!.connect();
  await card.disconnectLeave();
  binding.stop();
  assert.deepEqual(fake.log, ['connect mode 2', 'disconnect 0']);
});

test('the adapter forwards client errors', () => {
  const fake = fakePcscMini();
  const binding = adaptPcscMini(fake.module);
  const errors: string[] = [];
  binding.start(() => undefined, (e) => errors.push(e.message));
  fake.client().emit('error', new Error('[ ServiceStopped ]'));
  assert.deepEqual(errors, ['[ ServiceStopped ]']);
});

/* ------------------------------------------------------------------------ */
/* The pin. Measured problem 1 was a version that does not exist on npm.     */
/* ------------------------------------------------------------------------ */

test('the binding is pinned exactly, to the version the lockfile resolves and the remedy names', () => {
  const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
    optionalDependencies?: Record<string, string>;
  };
  const lock = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, { version?: string; optional?: boolean }>;
  };
  const [name, version] = PCSC_BINDING_PACKAGE.split('@') as [string, string];
  assert.deepEqual(pkg.optionalDependencies, { [name]: version }, 'one optional dependency, an exact version, no range');
  assert.equal(lock.packages[`node_modules/${name}`]?.version, version);
  // The prebuilt binaries the call needs must be in the lockfile, or npm ci on the
  // client's machine has nothing to install.
  for (const platform of ['windows-x86_64-node', 'macos-aarch64', 'macos-x86_64']) {
    const entry = lock.packages[`node_modules/@pcsc-mini/${platform}`];
    assert.equal(entry?.version, version, `@pcsc-mini/${platform} must be locked`);
    assert.equal(entry?.optional, true);
  }
});
