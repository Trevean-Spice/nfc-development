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
 * Desk-root's ruling trevean#10, the same day: the bound is general. A tag that keeps answering
 * its UID and is lost at any later command of the selection, block 79 included, is asked at
 * most twice more and then ends in one SELECTION_LOST naming the reader and the step.
 *
 * Desk-root's ruling trevean#12, the same day: a drop counts when the same tag answers its UID
 * within the next three connects, not only the next one, so a reader that also loses the UID
 * read after each drop still ends in SELECTION_LOST (review C1); and a pass through that fails
 * with any error that is not a drop is asked the other way, the same as a refusal (review C2).
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
import { ACR1552U, FakeBinding, FakeReader, FakeTag, GEOMETRY_APDUS, GET_SYSTEM_INFO_APDU, OTHER_UID_LSB_FIRST, frameOf, hex } from './fake-acr1552u.js';

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
const BLOCK_79 = GEOMETRY_APDUS[1]!;
const block79Reads = (tag: FakeTag) => tag.sent.filter((a) => a === BLOCK_79).length;
const BLOCK_79_STEP = "the geometry check's read of block 79 (FF B0 00 4F 04)";

/** The tag is lost at the next `times` reads of block 79: a real drop, the reader going EMPTY and finding it again. */
function dropBlock79(tag: FakeTag, times: number): void {
  let left = times;
  tag.noCardOn = (apdu) => {
    if (apdu !== BLOCK_79 || left === 0) return false;
    left -= 1;
    tag.drop();
  };
}

const UID_READ = 'ff ca 00 00 00';

/**
 * Every read of block 79 drops the tag (while `drops.left`, when given), and the reader then
 * loses the UID read on the next `uidLosses` connects, the tag left in place: review C1, a
 * reader that also loses the first transmit after it finds the tag again.
 */
function dropsThenLosesUid(tag: FakeTag, uidLosses: number, drops = { left: Number.POSITIVE_INFINITY }, onUidLoss?: () => void): void {
  let uidLossesLeft = 0;
  tag.noCardOn = (apdu) => {
    if (apdu === UID_READ) {
      if (uidLossesLeft === 0) return false;
      uidLossesLeft -= 1;
      onUidLoss?.();
      return true;
    }
    if (apdu !== BLOCK_79 || drops.left === 0) return false;
    drops.left -= 1;
    uidLossesLeft = uidLosses;
    tag.drop();
  };
}

/** Review C2: SCARD_E_NOT_TRANSACTED, as an older firmware's PC/SC layer may answer an APDU it does not take. */
const notTransacted = () => Object.assign(new Error('[ Session.TaskTransmit ] Async task error'), { code: 'NotTransacted' });

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

test('trevean#10: the transparent session answers and resets the connection, so block 79 is lost every time: one SELECTION_LOST within the bound, then nothing past the UID read', async () => {
  const tag = new FakeTag();
  tag.passThroughDropsSystemInfo = true;
  tag.sessionEndResets = true;
  const reader = new FakeReader(ACR1552U, tag);
  const transport = await openWith(reader);

  // The first wait: dropped at the pass through, then at block 79 twice, each straight after a
  // size answered in the session. One not ready round, never blamed on another program.
  const first = await rejection(transport.waitForTag(200));
  assert.equal(first.detail.case, 'TAG_NOT_READY');
  assert.equal(first.detail.step, BLOCK_79_STEP);
  assert.ok(Number(first.detail.tagAnswered) > 0);
  assert.doesNotMatch(first.remedy, /GoToTags/);
  assert.match(first.remedy, /not held by another program/);

  // The second: the same tag answers its UID again, and the tool stops there.
  const lost = await rejection(transport.waitForTag(200));
  assert.equal(lost.code, 'TAG_ABSENT');
  assert.equal(lost.detail.case, 'SELECTION_LOST');
  assert.equal(lost.detail.readerName, ACR1552U);
  assert.equal(lost.detail.step, BLOCK_79_STEP);
  assert.equal(lost.detail.drops, 2);
  assert.equal(lost.detail.uid, 'e002112233445566');
  assert.ok(lost.message.startsWith(`Case SELECTION_LOST. The reader loses the tag at ${BLOCK_79_STEP}, which comes before anything is written.`));
  assert.match(lost.message, /2 times in a row, at the geometry check's read of block 79 \(FF B0 00 4F 04\) \(NoSmartCard \(SCARD_E_NO_SMARTCARD\)/);
  assert.match(lost.message, /Nothing was written\./);
  assert.ok(lost.message.includes(`Reader "${ACR1552U}"`), 'names the reader');
  assert.match(lost.remedy, /this reader is/);
  assert.doesNotMatch(lost.remedy, /GoToTags/);
  assert.equal(tag.drops, 3, 'once at the pass through, twice at block 79');
  assert.equal(block79Reads(tag), 2);
  const asks = passThroughAsks(tag) + transparentAsks(tag);
  assert.equal(asks, 3, 'once through the pass through, twice in a session');

  // From then on nothing past the UID read is sent to it, and nothing is dropped, however often it is asked.
  for (let i = 0; i < 3; i += 1) {
    await transport.releaseTag('leave');
    assert.equal((await rejection(transport.waitForTag(200))).detail.case, 'SELECTION_LOST');
  }
  assert.equal(tag.drops, 3);
  assert.equal(block79Reads(tag), 2);
  assert.equal(passThroughAsks(tag) + transparentAsks(tag), asks, 'never asked its size again');
  assert.ok(tag.sent.every((a) => !a.startsWith('ff d6')), 'nothing written');
  await transport.close();

  // A reader opened again tries the tag again.
  tag.passThroughDropsSystemInfo = false;
  tag.sessionEndResets = false;
  const again = await openWith(reader);
  assert.equal((await again.waitForTag(200)).blockCount, 80);
  await again.close();
});

test('trevean#10: block 79 lost on every try, with the size answered through the pass through, is SELECTION_LOST inside the first wait', async () => {
  const tag = new FakeTag();
  dropBlock79(tag, Number.POSITIVE_INFINITY);
  const reader = new FakeReader(ACR1552U, tag);
  const transport = await openWith(reader);
  const lost = await rejection(transport.waitForTag(200));
  assert.equal(lost.detail.case, 'SELECTION_LOST');
  assert.equal(lost.detail.step, BLOCK_79_STEP);
  assert.equal(block79Reads(tag), 2, 'lost, confirmed and lost again, confirmed: then not read again');
  assert.equal(reader.connects, 3, 'within the three tries of one wait');
  await transport.close();
});

test('trevean#10: one loss at block 79, then the same tag reads, is selected and writes, and the count starts again', async () => {
  const tag = new FakeTag();
  const reader = new FakeReader(ACR1552U, tag);
  const transport = await openWith(reader);
  for (let round = 0; round < 3; round += 1) {
    dropBlock79(tag, 1);
    const identity = await transport.waitForTag(200);
    assert.equal(identity.blockCount, 80, `round ${round + 1}: one drop is tolerated, every time`);
    await transport.writeBlock(1, Uint8Array.from([round, 2, 3, 4]));
    assert.equal(hex(await transport.readBlocks(1, 1)), `0${round} 02 03 04`);
    await transport.releaseTag('leave');
  }
  assert.equal(tag.drops, 3);
  await transport.close();
});

test('trevean#10: another tag between two drops of the same tag starts the count again', async () => {
  const a = new FakeTag();
  const b = new FakeTag();
  b.uidLsbFirst = OTHER_UID_LSB_FIRST;
  // a lost at block 79 three times, b every time. Connects 1, 2, 4 and 5 find a, connect 3 finds b.
  let aLosses = 0;
  a.noCardOn = (apdu) => apdu === BLOCK_79 && (aLosses += 1) <= 3;
  b.noCardOn = (apdu) => apdu === BLOCK_79;
  const reader = new FakeReader(ACR1552U, a);
  reader.onConnect = (count) => {
    reader.tag = count === 3 ? b : a;
  };
  const transport = await openWith(reader);
  // a lost twice, the second confirmed; then b, lost too.
  assert.equal((await rejection(transport.waitForTag(200))).detail.case, 'TAG_NOT_READY');
  // a back: its count started again at b, so one more confirmed drop does not stop it.
  const identity = await transport.waitForTag(200);
  assert.equal(identity.uid, 'e002112233445566');
  assert.equal(aLosses, 4, 'three losses and then the read that got through');
  await transport.close();
});

test('trevean#12 C1: a reader that loses the UID read straight after every drop still ends in SELECTION_LOST, in the second wait, then nothing past the UID read', async () => {
  const tag = new FakeTag();
  dropsThenLosesUid(tag, 1);
  const reader = new FakeReader(ACR1552U, tag);
  const transport = await openWith(reader);

  // Dropped at block 79, the UID read lost, then the same tag back: that drop counts.
  const first = await rejection(transport.waitForTag(200));
  assert.equal(first.detail.case, 'TAG_NOT_READY');
  const lost = await rejection(transport.waitForTag(200));
  assert.equal(lost.detail.case, 'SELECTION_LOST', 'not another not ready round under the GoToTags banner');
  assert.equal(lost.detail.step, BLOCK_79_STEP);
  assert.equal(lost.detail.drops, 2);
  assert.equal(lost.detail.readerName, ACR1552U);
  assert.doesNotMatch(lost.remedy, /GoToTags/);
  assert.equal(tag.drops, 2);
  assert.equal(reader.connects, 5, 'drop, UID lost, drop, then UID lost and the same tag back');

  for (let i = 0; i < 3; i += 1) {
    await transport.releaseTag('leave');
    assert.equal((await rejection(transport.waitForTag(200))).detail.case, 'SELECTION_LOST');
  }
  assert.equal(block79Reads(tag), 2, 'block 79 not asked again');
  assert.equal(tag.drops, 2);
  assert.ok(tag.sent.every((a) => !a.startsWith('ff d6')), 'nothing written');
  await transport.close();
});

test('trevean#12 C1: the same tag answering within three connects of a drop confirms it; three UID reads lost after it forget it', async () => {
  // Two lost: each drop is confirmed on the third connect after it, so it ends in the third wait.
  const within = new FakeTag();
  dropsThenLosesUid(within, 2);
  const near = await openWith(new FakeReader(ACR1552U, within));
  assert.equal((await rejection(near.waitForTag(200))).detail.case, 'TAG_NOT_READY');
  assert.equal((await rejection(near.waitForTag(200))).detail.case, 'TAG_NOT_READY');
  const lost = await rejection(near.waitForTag(200));
  assert.equal(lost.detail.case, 'SELECTION_LOST');
  assert.equal(lost.detail.drops, 2);
  await near.close();

  // Three lost: the tag missed every connect it had to answer in, so it counts as taken off.
  // Lost at the UID read three times in four, this is the tag another program reads first, and
  // stays TAG_NOT_READY with the GoToTags remedy.
  const beyond = new FakeTag();
  dropsThenLosesUid(beyond, 3);
  const far = await openWith(new FakeReader(ACR1552U, beyond));
  for (let wait = 0; wait < 4; wait += 1) {
    const e = await rejection(far.waitForTag(200));
    assert.equal(e.detail.case, 'TAG_NOT_READY', `wait ${wait + 1}`);
    assert.equal(e.detail.tagAnswered, 0);
  }
  assert.equal(block79Reads(beyond), 3, 'every fourth connect gets as far as block 79, and none is counted');
  await far.close();
});

test('trevean#12 C1: a tag taken off, or another tag answering, while a drop waits through lost UID reads still forgets the drop', async () => {
  // Taken off: dropped, the UID read lost, and the reader EMPTY until the wait ends. NO_TAG.
  const tag = new FakeTag();
  const drops = { left: 1 };
  const reader = new FakeReader(ACR1552U, tag);
  let remove = true;
  dropsThenLosesUid(tag, 1, drops, () => {
    if (remove) reader.present = false;
  });
  const transport = await openWith(reader);
  assert.equal((await rejection(transport.waitForTag(200))).detail.case, 'NO_TAG');
  // Put back, and dropped once more the same way: only that drop counts, so it is selected.
  // Had the first drop been kept, the same tag answering would have made it two, SELECTION_LOST.
  remove = false;
  drops.left = 1;
  reader.present = true;
  assert.equal((await transport.waitForTag(400)).blockCount, 80);
  assert.equal(tag.drops, 2);
  await transport.close();

  // Another tag: dropped, the UID read lost, then another tag answers, and the first comes back.
  const a = new FakeTag();
  const b = new FakeTag();
  b.uidLsbFirst = OTHER_UID_LSB_FIRST;
  const aDrops = { left: 1 };
  dropsThenLosesUid(a, 1, aDrops);
  const swap = new FakeReader(ACR1552U, a);
  swap.onConnect = (count) => {
    swap.tag = count === 3 ? b : a;
  };
  const other = await openWith(swap);
  assert.notEqual((await other.waitForTag(200)).uid, 'e002112233445566', 'the other tag, selected');
  await other.releaseTag('leave');
  // The first tag back, dropped once more the same way: only that drop counts, so it is selected.
  aDrops.left = 1;
  assert.equal((await other.waitForTag(200)).uid, 'e002112233445566');
  assert.equal(a.drops, 2);
  assert.equal(swap.connects, 6);
  await other.close();
});

test('trevean#12 C2: a pass through that throws an error that is not a drop is asked through the transparent session, at once, for every tag', async () => {
  const tag = new FakeTag();
  tag.passThroughThrows = notTransacted;
  const reader = new FakeReader(ACR1552U, tag);
  const transport = await openWith(reader);
  for (let round = 1; round <= 2; round += 1) {
    const identity = await transport.waitForTag(200);
    assert.equal(identity.blockCount, 80, `round ${round}`);
    assert.equal(passThroughAsks(tag), round, 'the pass through is tried, as for a refusal word');
    assert.equal(transparentAsks(tag), round);
    await transport.releaseTag('leave');
  }
  assert.equal(reader.connects, 2, 'no retry: it is not a lost tag');
  assert.equal(tag.drops, 0);
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

test('trevean#10, Tag Tool: a transparent session that resets the connection, so block 79 is lost every time: one clear message at once, no banner, and it stops asking', async () => {
  const reader = new FakeReader(ACR1552U, new FakeTag(), false);
  reader.tag.passThroughDropsSystemInfo = true;
  reader.tag.sessionEndResets = true;
  const { controller, lines } = tagTool(reader);
  const flagged: (string | null)[] = [];
  const stop = controller.subscribe((x) => flagged.push(x.anotherProgram));
  controller.start();
  try {
    await waitFor(controller, 'reader ready', (s) => s.phase === 'waiting-for-tag');
    reader.present = true;
    const s = await waitFor(controller, 'the selection message', (x) => x.phase === 'error' && (x.error?.message ?? '').startsWith('Case SELECTION_LOST.'));
    assert.equal(describe(s).title, 'The reader cannot read the tag');
    assert.ok(s.error?.message.includes(ACR1552U), 'names the reader');
    assert.ok(s.error?.message.includes(BLOCK_79_STEP), 'names the step');
    assert.equal(s.anotherProgram, null);
    assert.ok(flagged.every((x) => x === null), 'never flagged as another program');
    assert.equal(lines.filter((l) => l.startsWith('Tag not ready')).length, 1, 'one not ready round on the way, inside the bound');

    const drops = reader.tag.drops;
    const reads = block79Reads(reader.tag);
    await sleep(400);
    assert.equal(drops, 3);
    assert.equal(reader.tag.drops, drops, 'no more drops');
    assert.equal(block79Reads(reader.tag), reads, 'block 79 not asked again');
    assert.equal(lines.filter((l) => l.startsWith('Tag on the reader cannot be written')).length, 1, 'said once');
    assert.equal(controller.snapshot().phase, 'error', 'still showing it');
    assert.ok(reader.tag.sent.every((a) => !a.startsWith('ff d6')), 'nothing written');
  } finally {
    stop();
    await controller.stop();
  }
});

test('trevean#10, Tag Tool: one loss at block 79, then the tag reads: seen, written and verified', async () => {
  const reader = new FakeReader(ACR1552U, new FakeTag(), false);
  dropBlock79(reader.tag, 1);
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
    assert.equal(reader.tag.drops, 1);
    assert.equal(lines.some((l) => l.startsWith('Tag on the reader cannot be written')), false);
  } finally {
    await controller.stop();
  }
});

test('trevean#12 C1, Tag Tool: a reader that loses the UID read straight after every drop: one clear message, no banner, and it stops asking', async () => {
  const reader = new FakeReader(ACR1552U, new FakeTag(), false);
  dropsThenLosesUid(reader.tag, 1);
  const { controller, lines } = tagTool(reader);
  const flagged: (string | null)[] = [];
  const stop = controller.subscribe((x) => flagged.push(x.anotherProgram));
  controller.start();
  try {
    await waitFor(controller, 'reader ready', (s) => s.phase === 'waiting-for-tag');
    reader.present = true;
    const s = await waitFor(controller, 'the selection message', (x) => x.phase === 'error' && (x.error?.message ?? '').startsWith('Case SELECTION_LOST.'));
    assert.equal(describe(s).title, 'The reader cannot read the tag');
    assert.ok(s.error?.message.includes(ACR1552U), 'names the reader');
    assert.ok(s.error?.message.includes(BLOCK_79_STEP), 'names the step');
    assert.doesNotMatch(s.error?.remedy ?? '', /GoToTags/);
    assert.ok(flagged.every((x) => x === null), 'the banner never raised');
    assert.equal(lines.filter((l) => l.startsWith('Another program')).length, 0);

    const reads = block79Reads(reader.tag);
    await sleep(400);
    assert.equal(block79Reads(reader.tag), reads, 'block 79 not asked again');
    assert.equal(reader.tag.drops, 2);
    assert.equal(lines.filter((l) => l.startsWith('Tag on the reader cannot be written')).length, 1, 'said once');
    assert.equal(controller.snapshot().phase, 'error', 'still showing it');
    assert.ok(reader.tag.sent.every((a) => !a.startsWith('ff d6')), 'nothing written');
  } finally {
    stop();
    await controller.stop();
  }
});

test('trevean#12 C2, Tag Tool: an older firmware reader whose pass through throws an error that is not a drop: seen through the transparent session, written and verified', async () => {
  const reader = new FakeReader(ACR1552U, new FakeTag(), false);
  reader.tag.passThroughThrows = notTransacted;
  const { controller, lines } = tagTool(reader);
  controller.start();
  try {
    await waitFor(controller, 'reader ready', (s) => s.phase === 'waiting-for-tag');
    reader.present = true;
    const seen = await waitFor(controller, 'tag seen', (x) => x.phase === 'tag-seen');
    assert.equal(seen.anotherProgram, null);
    assert.equal(transparentAsks(reader.tag), 1, 'its size asked in a transparent session');
    controller.requestWrite('ps');
    await waitFor(controller, 'written', (x) => x.phase === 'written');
    assert.equal(decodeUriMessage(unwrapNdefTlv(reader.tag.memory.subarray(CC_BYTES))).uri, 'https://treveanspice.com/t/ps');
    assert.equal(reader.tag.drops, 0);
    assert.equal(lines.some((l) => l.startsWith('Tag on the reader cannot be written')), false);
  } finally {
    await controller.stop();
  }
});
