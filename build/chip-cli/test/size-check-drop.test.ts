/**
 * Review C1, Friday 30 October 2026: a reader that drops the tag at Get System Information.
 *
 * Since 29 October the geometry check asks the tag its size through the ACS pass through,
 * `FF FB`, instead of reading block 80, which Dan's ACR1552U answered by dropping the tag. His
 * reader's firmware is not known here, so it may drop the tag at the pass through as well. The
 * fake then models that as the reader dropping the tag, SCARD_E_NO_SMARTCARD and EMPTY, not as
 * a refusal word, and these rows hold the ruling: a thrown pass through falls back to the
 * transparent session the way a refusal does, and if that drops the tag too it ends in one
 * message naming the reader and the step, never an endless retry. A tag taken off is still no
 * tag, and is waited for.
 *
 * Like every fake reader test here, this proves what the tool does with those answers, not
 * that Dan's reader gives them.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

import { TagToolController, type Snapshot } from '../src/app/controller.js';
import { STATIC_DIR } from '../src/app/server.js';
import { isChipError } from '../src/chip/errors.js';
import { CC_BYTES } from '../src/chip/st25tv02kc.js';
import { decodeUriMessage } from '../src/ndef/decode.js';
import { unwrapNdefTlv } from '../src/ndef/tlv.js';
import { RedirectTable } from '../src/table/redirect-table.js';
import { PcscTransport, type PcscTransportOptions } from '../src/transport/pcsc.js';
import { ACR1552U, FakeBinding, FakeReader, FakeTag, GET_SYSTEM_INFO_APDU, OTHER_UID_LSB_FIRST, frameOf, hex } from './fake-acr1552u.js';

const table = RedirectTable.load();
const scratchDirs: string[] = [];
test.after(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const FAST: PcscTransportOptions = { readerTimeoutMs: 50, notReadyRetryMs: 10, arrivalSettleMs: 5 };

async function openWith(reader: FakeReader, options: PcscTransportOptions = {}): Promise<PcscTransport> {
  const transport = new PcscTransport(undefined, { loadBinding: async () => new FakeBinding([reader]), ...FAST, ...options });
  await transport.open();
  return transport;
}

async function rejection(promise: Promise<unknown>): Promise<{ code: string; message: string; remedy: string; detail: Record<string, unknown> }> {
  try {
    await promise;
  } catch (error) {
    assert.ok(isChipError(error));
    return error;
  }
  return assert.fail('expected a rejection');
}

/** Get System Information as each path carries it: the pass through APDU, or the frame in a Transparent Exchange. */
const passThroughAsks = (tag: FakeTag) => tag.sent.filter((a) => a === GET_SYSTEM_INFO_APDU).length;
const transparentAsks = (tag: FakeTag) => tag.sent.filter((a) => frameOf(a)?.[1] === 0x2b).length;

/* -------------------------------------------------------------------------- */
/* The transport                                                               */
/* -------------------------------------------------------------------------- */

test('C1: the pass through drops the tag, so the same tag is asked through a transparent session and selected, in one wait', async () => {
  const tag = new FakeTag();
  tag.passThroughDropsSystemInfo = true;
  const reader = new FakeReader(ACR1552U, tag);
  const transport = await openWith(reader);
  const identity = await transport.waitForTag(200);
  assert.equal(identity.blockCount, 80);
  assert.equal(tag.drops, 1, 'dropped once, at the pass through');
  assert.equal(reader.connects, 2, 'connected again after the drop');
  assert.equal(passThroughAsks(tag), 1);
  assert.equal(transparentAsks(tag), 1);
  assert.equal(tag.sent.at(-1), 'ff b0 00 4f 04', 'then block 79, and nothing past it');

  // Remembered for this reader: the next selection does not ask through the pass through again.
  await transport.releaseTag('leave');
  assert.equal((await transport.waitForTag(200)).blockCount, 80);
  assert.equal(passThroughAsks(tag), 1, 'not asked that way again');
  assert.equal(transparentAsks(tag), 2);
  assert.equal(tag.drops, 1);

  // And the tag writes and reads back on that selection.
  await transport.writeBlock(1, Uint8Array.from([1, 2, 3, 4]));
  assert.equal(hex(await transport.readBlocks(1, 1)), '01 02 03 04');
  await transport.close();

  // A reader opened again is given the pass through again.
  tag.passThroughDropsSystemInfo = false;
  const again = await openWith(reader);
  assert.equal((await again.waitForTag(200)).blockCount, 80);
  assert.equal(passThroughAsks(tag), 2);
  await again.close();
});

test('C1: the pass through and the transparent session both drop the tag: one SIZE_CHECK_LOST naming the reader and the step, then no more asking', async () => {
  const tag = new FakeTag();
  tag.passThroughDropsSystemInfo = true;
  tag.transparentDropsSystemInfo = true;
  const reader = new FakeReader(ACR1552U, tag);
  const transport = await openWith(reader);

  // The first wait: dropped at the pass through, then twice in the session. Retried, as a tag
  // that answered its UID every time, so never blamed on another program.
  const first = await rejection(transport.waitForTag(200));
  assert.equal(first.detail.case, 'TAG_NOT_READY');
  assert.equal(first.detail.tagAnswered, 1);
  assert.doesNotMatch(first.remedy, /GoToTags/);

  // The second: the same tag answers its UID again, and the check stops there.
  const lost = await rejection(transport.waitForTag(200));
  assert.equal(lost.code, 'TAG_ABSENT');
  assert.equal(lost.detail.case, 'SIZE_CHECK_LOST');
  assert.equal(lost.detail.readerName, ACR1552U);
  assert.equal(lost.detail.step, 'the size check (Get System Information)');
  assert.match(lost.message, /^Case SIZE_CHECK_LOST\. The reader loses the tag at the size check/);
  assert.match(lost.message, /pass through, FF FB \(NoSmartCard \(SCARD_E_NO_SMARTCARD\)/);
  assert.match(lost.message, /transparent session, FF C2 \(NoSmartCard .*, then NoSmartCard /);
  assert.match(lost.message, /Nothing was written\./);
  assert.ok(lost.message.includes(`Reader "${ACR1552U}"`), 'names the reader');
  assert.match(lost.remedy, /this reader is/);
  assert.doesNotMatch(lost.remedy, /GoToTags/);
  assert.equal(tag.drops, 3);
  const asks = passThroughAsks(tag) + transparentAsks(tag);
  assert.equal(asks, 3);

  // From then on nothing past the UID read is sent, and nothing is dropped, however often it is asked.
  for (let i = 0; i < 3; i += 1) {
    await transport.releaseTag('leave');
    assert.equal((await rejection(transport.waitForTag(200))).detail.case, 'SIZE_CHECK_LOST');
  }
  assert.equal(passThroughAsks(tag) + transparentAsks(tag), asks, 'never asked again');
  assert.equal(tag.drops, 3);
  assert.ok(tag.sent.every((a) => !a.startsWith('ff d6') && !a.startsWith('ff b0')), 'no block read, no write');
  await transport.close();
});

test('C1: a tag taken off as the pass through goes out is no tag, and the pass through is not given up', async () => {
  const tag = new FakeTag();
  const reader = new FakeReader(ACR1552U, tag);
  tag.noCardOn = (apdu) => {
    if (apdu !== GET_SYSTEM_INFO_APDU || passThroughAsks(tag) > 1) return false;
    reader.present = false;
    return true;
  };
  const transport = await openWith(reader);
  assert.equal((await rejection(transport.waitForTag(120))).detail.case, 'NO_TAG');
  // Put back: asked through the pass through again, and selected.
  reader.present = true;
  assert.equal((await transport.waitForTag(200)).blockCount, 80);
  assert.equal(passThroughAsks(tag), 2);
  assert.equal(transparentAsks(tag), 0, 'no transparent session: the removal was not counted as a drop');
  await transport.close();
});

test('C1: with the pass through given up, a tag taken off during the transparent session is no tag, and put back it is selected', async () => {
  const tag = new FakeTag();
  tag.passThroughDropsSystemInfo = true;
  const reader = new FakeReader(ACR1552U, tag);
  const transport = await openWith(reader);
  assert.equal((await transport.waitForTag(200)).blockCount, 80);
  await transport.releaseTag('leave');

  // Lifted off as the session's Get System Information goes out, twice over.
  for (let i = 0; i < 2; i += 1) {
    tag.noCardOn = (apdu) => {
      if (frameOf(apdu)?.[1] !== 0x2b) return false;
      tag.noCardOn = null;
      reader.present = false;
      return true;
    };
    assert.equal((await rejection(transport.waitForTag(120))).detail.case, 'NO_TAG');
    reader.present = true;
  }
  const identity = await transport.waitForTag(200);
  assert.equal(identity.blockCount, 80, 'never SIZE_CHECK_LOST for a tag that was taken off');
  await transport.close();
});

test('C1: a drop at the pass through, with another tag on the reader when it is found again, is forgotten', async () => {
  const tag = new FakeTag();
  tag.passThroughDropsSystemInfo = true;
  const other = new FakeTag();
  other.uidLsbFirst = OTHER_UID_LSB_FIRST;
  const reader = new FakeReader(ACR1552U, tag);
  reader.onConnect = (count) => {
    if (count === 2) reader.tag = other;
  };
  const transport = await openWith(reader);
  const identity = await transport.waitForTag(200);
  assert.equal(identity.uid, 'e002112233778899');
  assert.equal(other.sent.filter((a) => a.startsWith('ff fb')).length, 1, 'the other tag is asked through the pass through');
  assert.equal(transparentAsks(other), 0);
  await transport.close();
});

test('C1: one drop in the transparent session, then a size answered there, starts the count again', async () => {
  const tag = new FakeTag();
  tag.passThroughDropsSystemInfo = true;
  const reader = new FakeReader(ACR1552U, tag);
  const transport = await openWith(reader);
  assert.equal((await transport.waitForTag(200)).blockCount, 80);
  // Two drops more in the session, each followed by a good answer, never stop the tool.
  for (let i = 0; i < 2; i += 1) {
    await transport.releaseTag('leave');
    // Dropped on this selection's first connect, answered on the one after it.
    tag.transparentDropsSystemInfo = true;
    const at = reader.connects;
    reader.onConnect = (count) => {
      if (count <= at + 1) return;
      tag.transparentDropsSystemInfo = false;
      reader.onConnect = null;
    };
    assert.equal((await transport.waitForTag(200)).blockCount, 80);
  }
  assert.equal(tag.drops, 3);
  await transport.close();
});

test('C3: a pass through answering 90 00 with a body that is not a usable answer falls back to the transparent session', async () => {
  const tag = new FakeTag();
  tag.passThroughOverride = [0x00, 0x0f, 0x66, 0x55, 0x90, 0x00];
  const reader = new FakeReader(ACR1552U, tag);
  const transport = await openWith(reader);
  assert.equal((await transport.waitForTag(200)).blockCount, 80);
  assert.equal(passThroughAsks(tag), 1);
  assert.equal(transparentAsks(tag), 1);
  assert.equal(tag.drops, 0);
  assert.equal(reader.connects, 1, 'no retry: a refusal is not a lost tag');
  await transport.close();
});

/* -------------------------------------------------------------------------- */
/* The Tag Tool                                                                */
/* -------------------------------------------------------------------------- */

function tagTool(reader: FakeReader) {
  const transport = new PcscTransport(undefined, { loadBinding: async () => new FakeBinding([reader]), ...FAST });
  const lines: string[] = [];
  const journalDir = mkdtempSync(join(tmpdir(), 'chip-cli-size-check-'));
  scratchDirs.push(journalDir);
  const controller = new TagToolController({
    transport,
    table,
    journalDir,
    toolVersion: 'test',
    operator: 'test-operator',
    readerName: () => transport.readerName,
    pollMs: 40,
    idleMs: 5,
    reopenMs: 20,
    notReadyMs: 40,
    removalPolls: 2,
    tagTimeoutMs: 1000,
    log: (line) => lines.push(line),
  });
  return { controller, lines };
}

async function waitFor(controller: TagToolController, what: string, predicate: (s: Snapshot) => boolean, timeoutMs = 4000): Promise<Snapshot> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snapshot = controller.snapshot();
    if (predicate(snapshot)) return snapshot;
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}; phase is ${snapshot.phase}, error ${snapshot.error?.code ?? 'none'}`);
    await sleep(5);
  }
}

function describe(s: Snapshot): { title: string; detail: string } {
  const sandbox: Record<string, unknown> = {};
  runInNewContext(readFileSync(join(STATIC_DIR, 'page.js'), 'utf8'), sandbox);
  return (sandbox.TagToolPage as { describe: (s: Record<string, unknown>) => { title: string; detail: string } }).describe(s as unknown as Record<string, unknown>);
}

test('C1, Tag Tool: on a reader whose pass through drops the tag, the tag is seen, written and verified', async () => {
  const reader = new FakeReader(ACR1552U, new FakeTag(), false);
  reader.tag.passThroughDropsSystemInfo = true;
  const { controller, lines } = tagTool(reader);
  controller.start();
  try {
    await waitFor(controller, 'reader ready', (s) => s.phase === 'waiting-for-tag');
    reader.present = true;
    const seen = await waitFor(controller, 'tag seen', (x) => x.phase === 'tag-seen');
    assert.equal(seen.anotherProgram, null);
    controller.requestWrite('ps');
    await waitFor(controller, 'written', (x) => x.phase === 'written');
    assert.equal(decodeUriMessage(unwrapNdefTlv(reader.tag.memory.subarray(CC_BYTES))).uri, 'https://treveanspice.com/t/ps');
    assert.equal(reader.tag.drops, 1, 'dropped once, at the first pass through, and never again');
    assert.equal(lines.some((l) => l.startsWith('Another program')), false);
  } finally {
    await controller.stop();
  }
});

test('C1, Tag Tool: on a reader that drops the tag both ways, one clear message, no banner, and it stops asking', async () => {
  const reader = new FakeReader(ACR1552U, new FakeTag(), false);
  reader.tag.passThroughDropsSystemInfo = true;
  reader.tag.transparentDropsSystemInfo = true;
  const { controller, lines } = tagTool(reader);
  const flagged: (string | null)[] = [];
  const stop = controller.subscribe((x) => flagged.push(x.anotherProgram));
  controller.start();
  try {
    await waitFor(controller, 'reader ready', (s) => s.phase === 'waiting-for-tag');
    reader.present = true;
    const s = await waitFor(controller, 'the size check message', (x) => x.phase === 'error' && (x.error?.message ?? '').startsWith('Case SIZE_CHECK_LOST.'));
    assert.equal(describe(s).title, 'The reader cannot read the tag');
    assert.ok(s.error?.message.includes(ACR1552U), 'names the reader');
    assert.match(s.error?.message ?? '', /size check/);
    assert.equal(s.anotherProgram, null);
    assert.ok(flagged.every((x) => x === null), 'never flagged as another program');

    const drops = reader.tag.drops;
    const asks = passThroughAsks(reader.tag) + transparentAsks(reader.tag);
    await sleep(400);
    assert.equal(reader.tag.drops, drops, 'no more drops');
    assert.equal(drops, 3);
    assert.equal(passThroughAsks(reader.tag) + transparentAsks(reader.tag), asks, 'no more asking');
    assert.equal(lines.filter((l) => l.startsWith('Tag on the reader cannot be written')).length, 1, 'said once');
    assert.equal(controller.snapshot().phase, 'error', 'still showing it');
    assert.ok(reader.tag.sent.every((a) => !a.startsWith('ff d6')), 'nothing written');
  } finally {
    stop();
    await controller.stop();
  }
});

test('C1, Tag Tool: a tag taken off during the size check still reads as no tag, and the next one is written', async () => {
  const reader = new FakeReader(ACR1552U, new FakeTag(), false);
  const tag = reader.tag;
  let removals = 0;
  tag.noCardOn = (apdu) => {
    if (apdu !== GET_SYSTEM_INFO_APDU || removals > 0) return false;
    removals += 1;
    reader.present = false;
    return true;
  };
  const { controller, lines } = tagTool(reader);
  controller.start();
  try {
    await waitFor(controller, 'reader ready', (s) => s.phase === 'waiting-for-tag');
    reader.present = true;
    await waitFor(controller, 'the removal', () => removals === 1);
    await sleep(200);
    const waiting = controller.snapshot();
    assert.equal(waiting.phase, 'waiting-for-tag', 'no tag, waiting');
    assert.equal(waiting.error, null);
    reader.present = true;
    await waitFor(controller, 'tag seen', (x) => x.phase === 'tag-seen');
    controller.requestWrite('ps');
    await waitFor(controller, 'written', (x) => x.phase === 'written');
    assert.equal(transparentAsks(tag), 0, 'the pass through was kept');
    assert.equal(lines.some((l) => l.startsWith('Tag on the reader cannot be written')), false);
  } finally {
    await controller.stop();
  }
});
