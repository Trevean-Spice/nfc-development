/**
 * SCARD_E_NO_SMARTCARD right after a connect: Dan's first run of the Tag Tool.
 *
 * Monday 26 October 2026, Windows 11, ACR1552U, after a reboot. The reader was found, and
 * then, verbatim, about eleven times in three seconds without stopping:
 *
 *   14:08:59 Reader trouble, reconnecting: The reader rejected a command: NoSmartCard
 *            (SCARD_E_NO_SMARTCARD): [ Session.TaskTransmit ] Async task error
 *
 * The connect to the tag succeeded and the next SCardTransmit found no card. The loop then
 * called that reader trouble, closed the reader (powering the tag down), opened it again and
 * connected again at once, so the tag never had a moment to come up, and the page went on
 * saying "Waiting for a tag" throughout.
 *
 * These tests drive the real transport and the real controller through the fake ACR1552U,
 * which fails a transmit with exactly pcsc-mini's error (see `noSmartCard` in the fake). They
 * prove what the code does with that error. Why the reader reported it is not something a
 * fake can settle: see the report for the evidence and the ranking.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { TagToolController, AppRefusal, type Snapshot } from '../src/app/controller.js';
import { STATIC_DIR } from '../src/app/server.js';
import { isChipError } from '../src/chip/errors.js';
import { CC_BYTES } from '../src/chip/st25tv02kc.js';
import { decodeUriMessage } from '../src/ndef/decode.js';
import { unwrapNdefTlv } from '../src/ndef/tlv.js';
import { RedirectTable } from '../src/table/redirect-table.js';
import { PcscTransport, type PcscTransportOptions } from '../src/transport/pcsc.js';
import { UnitSession } from '../src/workflow/unit.js';
import { ACR1552U, FakeBinding, FakeReader, FakeTag, pcscError } from './fake-acr1552u.js';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The words after "Reader trouble, reconnecting: " in Dan's log. */
const DANS_LINE = 'The reader rejected a command: NoSmartCard (SCARD_E_NO_SMARTCARD): [ Session.TaskTransmit ] Async task error';

const table = RedirectTable.load();
const scratchDirs: string[] = [];
test.after(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function openWith(reader: FakeReader, options: PcscTransportOptions = {}): Promise<{ transport: PcscTransport; binding: FakeBinding }> {
  const binding = new FakeBinding([reader]);
  const transport = new PcscTransport(undefined, { loadBinding: async () => binding, readerTimeoutMs: 50, ...options });
  await transport.open();
  return { transport, binding };
}

/** A tag that is on the reader and fails every transmit with SCARD_E_NO_SMARTCARD until told otherwise. */
function notReadyTag(): FakeTag {
  const tag = new FakeTag();
  tag.noCardTransmits = Number.POSITIVE_INFINITY;
  return tag;
}

function rejectsWith(code: string, check: (e: { message: string; remedy: string; detail: Record<string, unknown> }) => void = () => undefined) {
  return (error: unknown) => {
    assert.ok(isChipError(error));
    assert.equal(error.code, code);
    check(error);
    return true;
  };
}

/* -------------------------------------------------------------------------- */
/* The transport                                                               */
/* -------------------------------------------------------------------------- */

test('the fake reader fails a transmit with Dan\'s exact words, and outside detection they are unchanged', async () => {
  const reader = new FakeReader(ACR1552U);
  const { transport } = await openWith(reader);
  await transport.waitForTag(200);
  reader.tag.noCardTransmits = 1;
  await assert.rejects(
    () => transport.readBlocks(0, 1),
    rejectsWith('TRANSPORT_UNAVAILABLE', (e) => {
      assert.equal(e.message, DANS_LINE);
      assert.equal(e.detail.pcscCode, 'NoSmartCard');
    }),
  );
  await transport.close();
});

test('NoSmartCard on the first transmit after a connect is retried, and the tag is selected', async () => {
  const reader = new FakeReader(ACR1552U);
  reader.tag.noCardTransmits = 1;
  const { transport } = await openWith(reader, { notReadyRetryMs: 10 });
  const identity = await transport.waitForTag(200);
  assert.equal(identity.uid, 'e002112233445566');
  assert.equal(reader.connects, 2, 'the dead connection is dropped and a new one made');
  assert.deepEqual(reader.tag.sent, ['ff ca 00 00 00', 'ff ca 00 00 00', 'ff b0 00 4f 04', 'ff b0 00 50 04']);
  assert.equal(reader.tag.leaves, 1, 'let go of without powering the tag down');
  assert.equal(reader.tag.disconnects, 0, 'never SCARD_UNPOWER_CARD on a tag that is not ready');
  await transport.close();
});

test('a tag that is never ready is TAG_ABSENT, case TAG_NOT_READY, naming the command, after three tries', async () => {
  const reader = new FakeReader(ACR1552U, notReadyTag());
  const { transport } = await openWith(reader, { notReadyRetryMs: 10 });
  await assert.rejects(
    () => transport.waitForTag(200),
    rejectsWith('TAG_ABSENT', (e) => {
      assert.equal(e.detail.case, 'TAG_NOT_READY');
      assert.equal(e.detail.pcscCode, 'NoSmartCard');
      assert.equal(e.detail.step, 'the UID read (FF CA 00 00 00)');
      assert.match(e.message, /^Case TAG_NOT_READY\. The tag was not ready\./);
      assert.ok(e.message.includes('the UID read (FF CA 00 00 00) found no tag: NoSmartCard (SCARD_E_NO_SMARTCARD): [ Session.TaskTransmit ] Async task error. Tried 3 times.'));
      assert.match(e.message, /Reader "ACS ACR1552 1S CL Reader PICC 0", state 0x00000022 CHANGED\|PRESENT/);
      assert.match(e.remedy, /tries again by itself/);
    }),
  );
  assert.equal(reader.connects, 3);
  assert.deepEqual([...new Set(reader.tag.sent)], ['ff ca 00 00 00'], 'nothing but the UID read reached it');
  assert.equal(reader.tag.disconnects, 0);
  await transport.close();
});

test('a tag lost at the geometry check names that read, so a field report says which command it was', async () => {
  const reader = new FakeReader(ACR1552U);
  reader.tag.noCardOn = (apdu) => apdu === 'ff b0 00 50 04';
  const { transport } = await openWith(reader, { notReadyRetryMs: 10 });
  await assert.rejects(
    () => transport.waitForTag(200),
    rejectsWith('TAG_ABSENT', (e) => {
      assert.equal(e.detail.case, 'TAG_NOT_READY');
      assert.equal(e.detail.step, "the geometry check's read of block 80 (FF B0 00 50 04)");
    }),
  );
  await transport.close();
});

test('after SCARD_UNPOWER_CARD, the next selection rides out the reader bringing the tag back up', async () => {
  const reader = new FakeReader(ACR1552U);
  reader.tag.unpowerSettleMs = 400;
  const { transport } = await openWith(reader);
  await transport.waitForTag(200);
  // The write path's release, unchanged: it powers the tag down.
  await transport.releaseTag();
  assert.equal(reader.tag.disconnects, 1);
  const started = Date.now();
  const identity = await transport.waitForTag(200);
  assert.equal(identity.uid, 'e002112233445566');
  assert.equal(reader.connects, 1 + 3, 'not ready at 0 ms and 250 ms, ready at 750 ms');
  assert.ok(Date.now() - started >= 400);
  await transport.close();
});

test('a tag that arrives while the tool watches is left to settle before the first command', async () => {
  const reader = new FakeReader(ACR1552U, new FakeTag(), false);
  const { transport } = await openWith(reader);
  await assert.rejects(() => transport.waitForTag(50), rejectsWith('TAG_ABSENT', (e) => assert.equal(e.detail.case, 'NO_TAG')));
  // The tag goes down. The reader reports it at once and is still bringing it up for 200 ms.
  reader.present = true;
  reader.tag.noCardUntil = Date.now() + 200;
  const identity = await transport.waitForTag(1000);
  assert.equal(identity.uid, 'e002112233445566');
  assert.equal(reader.connects, 1, 'no command reached it before it was ready');
  await transport.close();
});

test('a tag already on the reader when the tool opens is selected at once, as before', async () => {
  const reader = new FakeReader(ACR1552U);
  const { transport } = await openWith(reader);
  const started = Date.now();
  await transport.waitForTag(200);
  assert.ok(Date.now() - started < 200, 'no settle for a tag that did not just arrive');
  await transport.close();
});

test('a PC/SC error that is about the reader is not retried and stays TRANSPORT_UNAVAILABLE', async () => {
  const reader = new FakeReader(ACR1552U);
  const { transport } = await openWith(reader, { notReadyRetryMs: 10 });
  const handle = reader.tag.handle();
  reader.connect = async () => {
    reader.connects += 1;
    return { ...handle, transmit: async () => Promise.reject(pcscError('ReaderUnavailable')) };
  };
  await assert.rejects(() => transport.waitForTag(200), rejectsWith('TRANSPORT_UNAVAILABLE', (e) => assert.equal(e.detail.pcscCode, 'ReaderUnavailable')));
  assert.equal(reader.connects, 1);
  await transport.close();
});

test('releaseTag powers the tag down by default and leaves it powered only when asked', async () => {
  const reader = new FakeReader(ACR1552U);
  const { transport } = await openWith(reader);
  await transport.waitForTag(200);
  await transport.releaseTag('leave');
  assert.deepEqual([reader.tag.leaves, reader.tag.disconnects], [1, 0]);
  await transport.waitForTag(200);
  await transport.releaseTag();
  assert.deepEqual([reader.tag.leaves, reader.tag.disconnects], [1, 1]);
  await transport.waitForTag(200);
  await transport.completeUnit();
  assert.deepEqual([reader.tag.leaves, reader.tag.disconnects], [1, 2]);
  await transport.close();
});

test('a chip-cli write is unchanged: select, write, verify and release, every release powering the tag down', async () => {
  const reader = new FakeReader(ACR1552U);
  const { transport } = await openWith(reader);
  const session = new UnitSession({ transport, uri: 'https://treveanspice.com/t/ps', code: 'ps', tagTimeoutMs: 200 });
  await session.selectTag();
  await session.write();
  await session.verify();
  await transport.completeUnit();
  assert.equal(reader.tag.leaves, 0);
  assert.ok(reader.tag.disconnects >= 1);
  await transport.close();
});

test('the only places that let go with SCARD_LEAVE_CARD are the Tag Tool poll and the not ready retry', () => {
  const src = (name: string) => readFileSync(join(PACKAGE_ROOT, 'src', name), 'utf8');
  const controller = src('app/controller.ts');
  assert.equal((controller.match(/this\.release\('leave'\)/g) ?? []).length, 4, 'the four releases in poll()');
  const writePath = controller.slice(controller.indexOf('  private async write('), controller.indexOf('  private resolve('));
  assert.equal(writePath.includes("'leave'"), false, 'the write path keeps powering the tag down');
  const pcsc = src('transport/pcsc.ts');
  assert.equal((pcsc.match(/releaseTag\('leave'\)/g) ?? []).length, 1, 'waitForTag, after a tag that was not ready');
  assert.equal((pcsc.match(/disconnectLeave\(\)/g) ?? []).length, 2, 'the interface and releaseTag');
  for (const name of ['workflow/unit.ts', 'workflow/batch.ts', 'cli/main.ts']) assert.equal(src(name).includes("'leave'"), false, name);
});

/* -------------------------------------------------------------------------- */
/* The Tag Tool                                                                */
/* -------------------------------------------------------------------------- */

function tagTool(reader: FakeReader, transportOptions: PcscTransportOptions = { notReadyRetryMs: 10 }) {
  const binding = new FakeBinding([reader]);
  const transport = new PcscTransport(undefined, { loadBinding: async () => binding, readerTimeoutMs: 50, ...transportOptions });
  const lines: { at: number; line: string }[] = [];
  const journalDir = mkdtempSync(join(tmpdir(), 'chip-cli-not-ready-'));
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
    log: (line) => lines.push({ at: Date.now(), line }),
  });
  return { controller, binding, lines };
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

type Describe = (s: Record<string, unknown>) => { reader: string; title: string; detail: string; error: { code: string } | null };
function page(): { describe: Describe; writeHint: (s: Record<string, unknown>, writable: boolean) => string } {
  const sandbox: Record<string, unknown> = {};
  runInNewContext(readFileSync(join(STATIC_DIR, 'page.js'), 'utf8'), sandbox);
  return sandbox.TagToolPage as { describe: Describe; writeHint: (s: Record<string, unknown>, writable: boolean) => string };
}

test('Dan\'s 14:08:59: a tag that is never ready is "tag not ready, retrying", the reader stays open, and it backs off', async () => {
  const reader = new FakeReader(ACR1552U, notReadyTag(), false);
  // A real connect takes time. Without this the old loop never even yielded.
  reader.connectDelayMs = 5;
  const { controller, binding, lines } = tagTool(reader);
  controller.start();
  try {
    await waitFor(controller, 'reader ready', (s) => s.phase === 'waiting-for-tag');
    reader.present = true;
    const s = await waitFor(controller, 'tag not ready', (x) => x.phase === 'tag-not-ready');
    assert.equal(s.error?.code, 'TAG_ABSENT');
    assert.match(s.error?.message ?? '', /^Case TAG_NOT_READY\./);
    assert.ok(s.error?.message.includes('SCARD_E_NO_SMARTCARD'));
    assert.equal(s.readerName, ACR1552U);

    const said = page().describe(s as unknown as Record<string, unknown>);
    assert.equal(said.title, 'Tag not ready, retrying');
    assert.match(said.detail, /keeps trying by itself/);
    assert.equal(said.error?.code, 'TAG_ABSENT', 'the message and what to do are on the page');
    assert.equal(page().writeHint(s as unknown as Record<string, unknown>, true), 'Waiting for the tag to be ready.');
    assert.throws(
      () => controller.requestWrite('ps'),
      (e: unknown) => e instanceof AppRefusal && e.status === 409 && e.error.message === 'The tag on the reader is not ready yet.',
    );

    await sleep(1200);
    const notReady = lines.filter((l) => l.line.startsWith('Tag not ready, retrying in '));
    assert.equal(lines.some((l) => l.line.startsWith('Reader trouble')), false, 'never reader trouble');
    assert.equal(lines.some((l) => l.line.includes(DANS_LINE) && l.line.startsWith('Reader trouble')), false);
    assert.equal(binding.stops, 0, 'the reader was opened once and never closed');
    assert.equal(reader.tag.disconnects, 0, 'the tag was never powered down');
    assert.ok(notReady.length >= 3 && notReady.length <= 6, `backing off, not spinning: ${notReady.length} retries in about 1.5 s`);
    assert.deepEqual(
      notReady.slice(0, 3).map((l) => l.line.slice(0, 'Tag not ready, retrying in 0.04 s'.length)),
      ['Tag not ready, retrying in 0.04 s', 'Tag not ready, retrying in 0.08 s', 'Tag not ready, retrying in 0.16 s'],
    );
    const connectsBefore = reader.connects;
    await sleep(400);
    assert.ok(reader.connects - connectsBefore <= 6, 'at the cap, one poll of three tries every 0.32 s at most');
  } finally {
    await controller.stop();
  }
});

test('the same tag, once it settles, is seen and written and verified', async () => {
  const reader = new FakeReader(ACR1552U, notReadyTag(), false);
  const { controller, lines } = tagTool(reader);
  controller.start();
  try {
    await waitFor(controller, 'reader ready', (s) => s.phase === 'waiting-for-tag');
    reader.present = true;
    await waitFor(controller, 'tag not ready', (x) => x.phase === 'tag-not-ready');
    reader.tag.noCardTransmits = 0;
    let s = await waitFor(controller, 'tag seen', (x) => x.phase === 'tag-seen');
    assert.equal(s.uid, 'E002112233445566'.toLowerCase());
    assert.equal(s.error, null);
    controller.requestWrite('ps');
    s = await waitFor(controller, 'written', (x) => x.phase === 'written');
    assert.equal(s.url, 'https://treveanspice.com/t/ps');
    assert.equal(decodeUriMessage(unwrapNdefTlv(reader.tag.memory.subarray(CC_BYTES))).uri, 'https://treveanspice.com/t/ps');
    assert.equal(s.writtenCount, 1);
    assert.ok(lines.some((l) => l.line.startsWith('Tag seen: ')));
  } finally {
    await controller.stop();
  }
});

test('after a write powers the tag down, the page stays on "Written and verified" while the reader brings it back', async () => {
  const reader = new FakeReader(ACR1552U);
  reader.tag.unpowerSettleMs = 150;
  const { controller, lines } = tagTool(reader, {});
  controller.start();
  try {
    await waitFor(controller, 'tag seen', (s) => s.phase === 'tag-seen');
    controller.requestWrite('ps');
    await waitFor(controller, 'written', (x) => x.phase === 'written');
    const phases = new Set<string>();
    const stop = controller.subscribe((x) => phases.add(x.phase));
    await sleep(900);
    stop();
    assert.equal(controller.snapshot().phase, 'written');
    assert.equal(phases.has('tag-not-ready'), false);
    assert.equal(controller.snapshot().anotherProgram, null, 'a tag coming back up after a write is not another program');
    assert.equal(lines.some((l) => l.line.startsWith('Reader trouble')), false);
  } finally {
    await controller.stop();
  }
});

test('a tag already seen that is not ready for one poll keeps its place on the page, and two in a row are shown', async () => {
  const reader = new FakeReader(ACR1552U);
  const { controller, lines } = tagTool(reader);
  controller.start();
  try {
    await waitFor(controller, 'tag seen', (s) => s.phase === 'tag-seen');
    const phases = new Set<string>();
    const stop = controller.subscribe((x) => phases.add(x.phase));
    // Exactly one poll's three tries fail, the way a Windows idle power down could catch one.
    reader.tag.noCardTransmits = 3;
    await waitFor(controller, 'one not ready poll', () => lines.some((l) => l.line.startsWith('Tag not ready')));
    await sleep(150);
    stop();
    assert.equal(phases.has('tag-not-ready'), false);
    assert.equal(controller.snapshot().phase, 'tag-seen');
    reader.tag.noCardTransmits = 6;
    await waitFor(controller, 'shown on the second', (x) => x.phase === 'tag-not-ready');
  } finally {
    await controller.stop();
  }
});

test('a tag sitting on the reader is polled without being powered down, so the reader never has to find it again', async () => {
  const reader = new FakeReader(ACR1552U);
  const { controller } = tagTool(reader);
  controller.start();
  try {
    await waitFor(controller, 'tag seen', (s) => s.phase === 'tag-seen');
    await sleep(150);
    assert.ok(reader.tag.leaves >= 3, `polled ${reader.tag.leaves} times`);
    assert.equal(reader.tag.disconnects, 0);
  } finally {
    await controller.stop();
  }
});

test('the page words for a tag that is not ready', () => {
  const { describe, writeHint } = page();
  const s = {
    phase: 'tag-not-ready',
    readerName: ACR1552U,
    uid: null,
    code: null,
    blendName: null,
    url: null,
    error: { code: 'TAG_ABSENT', message: 'Case TAG_NOT_READY. The tag was not ready.', remedy: 'The tool tries again by itself.' },
    tagAlreadyAttempted: false,
    auto: { enabled: false, code: null },
    recent: [],
  };
  const said = describe(s);
  assert.equal(said.reader, `Reader ready: ${ACR1552U}`, 'the reader is fine, and the page says so');
  assert.equal(said.title, 'Tag not ready, retrying');
  assert.equal(said.detail, 'The reader sees a tag but lost it before it could be read. The Tag Tool keeps trying by itself. Keep the tag flat and still in the centre of the reader.');
  assert.equal(said.error?.code, 'TAG_ABSENT');
  assert.equal(writeHint(s, true), 'Waiting for the tag to be ready.');
  const dashes = [0x2013, 0x2014].map((c) => String.fromCharCode(c));
  assert.ok(dashes.every((d) => !(said.title + said.detail).includes(d)));
});
