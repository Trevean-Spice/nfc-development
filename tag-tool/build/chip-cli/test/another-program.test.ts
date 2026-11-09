/**
 * Another program reading the tags: GoToTags' keyboard wedge on Dan's first Tag Tool run.
 *
 * Monday 26 October 2026, Windows 11, ACR1552U. His screen recording shows the Tag Tool
 * page on "Waiting for a tag" while something typed each tag's UID into the product code
 * box like a keyboard, over and over, and toggled Caps Lock:
 *
 *   35 49 5E 6D 05 08 02 E035 49 5E 6D 05 08 02 E0 ...
 *   srDE 2B 65 6D 05 08 02 E0DE 2B 65 6D 05 08 02 E0 ...
 *
 * ST UIDs, byte reversed, upper case hex pairs with spaces. The "sr" is what he had typed.
 * That is GoToTags, which starts with Windows and reads every tag the moment it arrives,
 * and a program reading the tag at the same moment fits the SCARD_E_NO_SMARTCARD on this
 * tool's first command.
 *
 * Three parts: the transport says when the reader shows the tag held by another program;
 * the controller decides "another program" from that, or from a tag that is not ready
 * twice in a row; and the page refuses typed IDs and says what to do. The page is driven
 * here through a small fake DOM, with key events timed the way a wedge and a person type.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

import { ANOTHER_PROGRAM_ADVICE, TagToolController, type Snapshot } from '../src/app/controller.js';
import { STATIC_DIR } from '../src/app/server.js';
import { ChipError, isChipError } from '../src/chip/errors.js';
import { RedirectTable } from '../src/table/redirect-table.js';
import { OTHER_PROGRAM_REMEDY, PcscTransport, READER_STATE_FLAGS, type PcscTransportOptions } from '../src/transport/pcsc.js';
import { ACR1552U, FakeBinding, FakeReader, FakeTag, GEOMETRY_APDUS, OTHER_UID_LSB_FIRST, pcscError } from './fake-acr1552u.js';

/** The banner, word for word as asked for. */
const BANNER =
  'Another program is reading the tags and typing their ID (usually GoToTags). Exit it from the icon near the clock (right click, Exit), or end it in Task Manager, then try again.';

const { PRESENT, CHANGED, INUSE, EXCLUSIVE } = READER_STATE_FLAGS;

const table = RedirectTable.load();
const scratchDirs: string[] = [];
test.after(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function openWith(reader: FakeReader, options: PcscTransportOptions = {}): Promise<PcscTransport> {
  const transport = new PcscTransport(undefined, { loadBinding: async () => new FakeBinding([reader]), readerTimeoutMs: 50, notReadyRetryMs: 10, ...options });
  await transport.open();
  return transport;
}

function notReadyTag(): FakeTag {
  const tag = new FakeTag();
  tag.noCardTransmits = Number.POSITIVE_INFINITY;
  return tag;
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

/** Names GoToTags and how to exit it from the tray, as the CLI prints the remedy. */
function namesTheTrayExit(remedy: string): void {
  assert.match(remedy, /GoToTags/);
  assert.match(remedy, /icon near the clock \(right click, Exit\)/);
  assert.match(remedy, /Task Manager/);
}

/* -------------------------------------------------------------------------- */
/* The transport                                                               */
/* -------------------------------------------------------------------------- */

test('TAG_NOT_READY names GoToTags and the tray exit in its remedy', async () => {
  const reader = new FakeReader(ACR1552U, notReadyTag());
  const transport = await openWith(reader);
  const e = await rejection(transport.waitForTag(200));
  assert.equal(e.detail.case, 'TAG_NOT_READY');
  assert.match(e.remedy, /^The tool tries again by itself\./);
  namesTheTrayExit(e.remedy);
  assert.ok(e.remedy.includes(OTHER_PROGRAM_REMEDY));
  assert.equal(e.detail.otherProgram, null, 'nothing in the reader state said another program had it');
  assert.doesNotMatch(e.message, /in use by another program/);
  await transport.close();
});

test('a tag not ready while the reader shows it in use (INUSE) before the connect says another program has it', async () => {
  const reader = new FakeReader(ACR1552U, notReadyTag());
  reader.raw = PRESENT | INUSE | CHANGED;
  const transport = await openWith(reader);
  const e = await rejection(transport.waitForTag(200));
  assert.equal(e.detail.case, 'TAG_NOT_READY');
  assert.equal(e.detail.otherProgram, 'INUSE');
  assert.match(e.message, /Before the connect the reader reported the tag in use by another program \(INUSE\)\./);
  await transport.close();
});

test('INUSE alone stops nothing: a tag another program shares is still read', async () => {
  const reader = new FakeReader(ACR1552U);
  reader.raw = PRESENT | INUSE | CHANGED;
  const transport = await openWith(reader);
  const identity = await transport.waitForTag(200);
  assert.equal(identity.uid, 'e002112233445566');
  await transport.close();
});

for (const [code, raw, otherProgram] of [
  ['SharingViolation', PRESENT | EXCLUSIVE | CHANGED, 'SCARD_E_SHARING_VIOLATION'],
  ['SharingViolation', PRESENT | CHANGED, 'SCARD_E_SHARING_VIOLATION'],
  ['NoSmartCard', PRESENT | CHANGED, null],
  ['NoSmartCard', PRESENT | INUSE | CHANGED, 'INUSE'],
  ['UnresponsiveCard', PRESENT | CHANGED, null],
  ['ProtoMismatch', PRESENT | EXCLUSIVE | CHANGED, 'EXCLUSIVE'],
  ['ProtoMismatch', PRESENT | CHANGED, null],
] as const) {
  test(`CONNECT_FAILED ${code}, state 0x${raw.toString(16)}: the remedy names GoToTags and the tray exit, other program ${otherProgram ?? 'not seen'}`, async () => {
    const reader = new FakeReader(ACR1552U);
    reader.raw = raw;
    reader.connectError = () => pcscError(code);
    const transport = await openWith(reader);
    const e = await rejection(transport.waitForTag(200));
    assert.equal(e.detail.case, 'CONNECT_FAILED');
    namesTheTrayExit(e.remedy);
    assert.equal(e.detail.otherProgram, otherProgram);
    assert.equal(e.detail.pcscCode, code);
    await transport.close();
  });
}

/* -------------------------------------------------------------------------- */
/* The Tag Tool                                                                */
/* -------------------------------------------------------------------------- */

function tagTool(reader: FakeReader, transport = new PcscTransport(undefined, { loadBinding: async () => new FakeBinding([reader]), readerTimeoutMs: 50, notReadyRetryMs: 10 })) {
  const lines: string[] = [];
  const journalDir = mkdtempSync(join(tmpdir(), 'chip-cli-another-program-'));
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

interface PageWords {
  describe: (s: Record<string, unknown>) => { title: string; detail: string; error: { code: string } | null };
  looksLikeTagId: (text: string) => boolean;
  keyRhythm: (run: { at: number | null; run: number }, at: number) => number;
  anotherProgramShowing: (s: Record<string, unknown> | null, typedAt: number | null, now: number) => boolean;
  setCodes: (list: unknown[]) => void;
  ANOTHER_PROGRAM: string;
}

function pageWords(): PageWords {
  const sandbox: Record<string, unknown> = {};
  runInNewContext(readFileSync(join(STATIC_DIR, 'page.js'), 'utf8'), sandbox);
  const page = sandbox.TagToolPage as PageWords;
  page.setCodes(codeList());
  return page;
}

function codeList() {
  return table.entries().map((e) => ({ code: e.code, blendName: e.blendName, url: e.ndefUri, encodable: e.ndefUri !== null, status: e.status }));
}

test('GoToTags holding every tag: not ready twice in a row is "another program", and it clears once it has gone', async () => {
  const reader = new FakeReader(ACR1552U, notReadyTag(), false);
  const { controller, lines } = tagTool(reader);
  controller.start();
  try {
    await waitFor(controller, 'reader ready', (s) => s.phase === 'waiting-for-tag');
    reader.present = true;
    const first = await waitFor(controller, 'tag not ready', (s) => s.phase === 'tag-not-ready');
    assert.equal(first.anotherProgram, null, 'once is a tag not ready yet');
    assert.equal(pageWords().describe(first as unknown as Record<string, unknown>).title, 'Tag not ready, retrying');

    const s = await waitFor(controller, 'another program', (x) => x.anotherProgram !== null);
    assert.equal(s.anotherProgram, 'The tag was not ready 2 times in a row, each after three tries.');
    assert.equal(s.phase, 'tag-not-ready');
    const page = pageWords();
    const said = page.describe(s as unknown as Record<string, unknown>);
    assert.equal(said.title, 'Another program is reading the tags', 'not the generic "not ready"');
    assert.match(said.detail, /message at the top of the page/);
    assert.equal(said.error?.code, 'TAG_ABSENT', 'the full message stays on the page');
    assert.equal(page.anotherProgramShowing(s as unknown as Record<string, unknown>, null, 0), true, 'the banner shows');

    await sleep(300);
    assert.equal(lines.filter((l) => l.startsWith('Another program is reading the tags (usually GoToTags): ')).length, 1, 'said once, not every retry');

    // GoToTags exited: the tag reads, and the banner goes.
    reader.tag.noCardTransmits = 0;
    const seen = await waitFor(controller, 'tag seen', (x) => x.phase === 'tag-seen');
    assert.equal(seen.anotherProgram, null);
    assert.equal(pageWords().anotherProgramShowing(seen as unknown as Record<string, unknown>, null, 0), false);
  } finally {
    await controller.stop();
  }
});

test('Dan, 29 October 2026: a tag lost every time after it answered the UID read is retried within a bound, never called another program, and ends in one message', async () => {
  // GoToTags uninstalled, rebooted twice, and the banner still sent him back to it: the tag
  // answered the UID read in every try and was lost at a later command of this tool's, here
  // the block 79 read. (A tag lost at Get System Information is asked another way since 30
  // October 2026: see size-check-drop.test.ts.) Since desk-root's ruling trevean#10 that ends
  // in SELECTION_LOST, which names the reader and the command, rather than retrying for ever.
  const reader = new FakeReader(ACR1552U, new FakeTag(), false);
  reader.tag.noCardOn = (apdu) => apdu === GEOMETRY_APDUS[1];
  const { controller, lines } = tagTool(reader);
  const flagged: (string | null)[] = [];
  const stop = controller.subscribe((x) => flagged.push(x.anotherProgram));
  controller.start();
  try {
    await waitFor(controller, 'reader ready', (s) => s.phase === 'waiting-for-tag');
    reader.present = true;
    const s = await waitFor(controller, 'the selection message', (x) => x.phase === 'error' && (x.error?.message ?? '').startsWith('Case SELECTION_LOST.'));
    assert.equal(s.anotherProgram, null);
    assert.ok(flagged.every((x) => x === null), 'never flagged on the way');
    assert.equal(lines.filter((l) => l.startsWith('Another program')).length, 0);
    assert.equal(pageWords().describe(s as unknown as Record<string, unknown>).title, 'The reader cannot read the tag', 'not "Another program is reading the tags"');
    assert.ok(s.error?.message.includes("the geometry check's read of block 79 (FF B0 00 4F 04)"));
    assert.doesNotMatch(s.error?.remedy ?? '', /GoToTags/);
    const reads = reader.tag.sent.filter((a) => a === GEOMETRY_APDUS[1]).length;
    await sleep(300);
    assert.equal(reader.tag.sent.filter((a) => a === GEOMETRY_APDUS[1]).length, reads, 'block 79 not asked again');
  } finally {
    stop();
    await controller.stop();
  }
});

/** UID reads lost where `lostAt` says (counting from 1), and every read of block 79 lost: a tag lost at the first command in some tries and later in others. */
function mixedTag(lostAt: (uidRead: number) => boolean): FakeTag {
  const tag = new FakeTag();
  let uidReads = 0;
  tag.noCardOn = (apdu) => {
    if (apdu === 'ff ca 00 00 00') return lostAt((uidReads += 1));
    return apdu === GEOMETRY_APDUS[1];
  };
  return tag;
}

test('review C3: a mixed run, lost at the first command in one try and later in the others, counts as lost at the first: fewest 0, the GoToTags remedy', async () => {
  const reader = new FakeReader(ACR1552U, mixedTag((n) => n === 1));
  const transport = await openWith(reader);
  const e = await rejection(transport.waitForTag(200));
  assert.equal(e.detail.case, 'TAG_NOT_READY');
  assert.equal(e.detail.tagAnswered, 0, 'the fewest in any try');
  assert.equal(reader.tag.sent.filter((a) => a === GEOMETRY_APDUS[1]).length, 2, 'the other two tries got as far as block 79');
  namesTheTrayExit(e.remedy);
  await transport.close();
});

test('review C3: in the Tag Tool, mixed runs twice in a row raise the banner', async () => {
  // Lost at the UID read three times in every four, and at block 79 the fourth. Since
  // desk-root's ruling trevean#12 a block 79 loss counts as a drop when the same tag answers
  // its UID within three connects, and a tag that lost only the next UID read each time ends
  // in SELECTION_LOST (size-check-drop.test.ts). Three lost in a row is the tag another program
  // reads first, so this one is never confirmed, and stays the banner.
  const reader = new FakeReader(ACR1552U, mixedTag((n) => n % 4 !== 1), false);
  const { controller } = tagTool(reader);
  controller.start();
  try {
    await waitFor(controller, 'reader ready', (s) => s.phase === 'waiting-for-tag');
    reader.present = true;
    const s = await waitFor(controller, 'another program', (x) => x.anotherProgram !== null);
    assert.equal(s.anotherProgram, 'The tag was not ready 2 times in a row, each after three tries.');
    assert.equal(pageWords().describe(s as unknown as Record<string, unknown>).title, 'Another program is reading the tags');
  } finally {
    await controller.stop();
  }
});

/** A transport whose TAG_NOT_READY does not say how many commands the tag answered, as one before 29 October 2026 did not. */
class SaysNothingAnswered extends PcscTransport {
  override async waitForTag(timeoutMs: number) {
    try {
      return await super.waitForTag(timeoutMs);
    } catch (error) {
      if (!isChipError(error) || !('tagAnswered' in error.detail)) throw error;
      const { tagAnswered: _dropped, ...detail } = error.detail;
      throw new ChipError(error.code, error.message, error.remedy, detail);
    }
  }
}

test('review C3: a not ready error that does not say how many commands the tag answered is taken as lost at the first, and raises the banner', async () => {
  // Two tags taking turns, each answering the UID read and Get System Information every time
  // and lost at block 79: with tagAnswered this is never the banner. Two, so no tag is lost
  // twice in a row and the not ready rounds go on (SELECTION_LOST is per tag).
  const reader = new FakeReader(ACR1552U, mixedTag(() => false), false);
  const other = mixedTag(() => false);
  other.uidLsbFirst = OTHER_UID_LSB_FIRST;
  const first = reader.tag;
  reader.onConnect = (count) => {
    reader.tag = count % 2 === 0 ? other : first;
  };
  const transport = new SaysNothingAnswered(undefined, { loadBinding: async () => new FakeBinding([reader]), readerTimeoutMs: 50, notReadyRetryMs: 10 });
  const { controller } = tagTool(reader, transport);
  controller.start();
  try {
    await waitFor(controller, 'reader ready', (s) => s.phase === 'waiting-for-tag');
    reader.present = true;
    const s = await waitFor(controller, 'another program', (x) => x.anotherProgram !== null);
    assert.equal(s.anotherProgram, 'The tag was not ready 2 times in a row, each after three tries.');
  } finally {
    await controller.stop();
  }
});

test('a tag not ready with the reader showing it in use is "another program" at the first poll', async () => {
  const reader = new FakeReader(ACR1552U, notReadyTag());
  reader.raw = PRESENT | INUSE | CHANGED;
  const { controller } = tagTool(reader);
  controller.start();
  try {
    const s = await waitFor(controller, 'tag not ready', (x) => x.phase === 'tag-not-ready');
    assert.equal(s.anotherProgram, 'The reader reported the tag in use by another program (INUSE).');
  } finally {
    await controller.stop();
  }
});

test('a connect refused with SCARD_E_SHARING_VIOLATION is shown at once as another program, not "cannot read the tag"', async () => {
  const reader = new FakeReader(ACR1552U);
  reader.connectError = () => pcscError('SharingViolation');
  const { controller } = tagTool(reader);
  controller.start();
  try {
    const s = await waitFor(controller, 'error', (x) => x.phase === 'error');
    assert.equal(s.anotherProgram, 'The reader reported the tag in use by another program (SCARD_E_SHARING_VIOLATION).');
    assert.equal(s.error?.code, 'TAG_ABSENT');
    assert.equal(s.notices[s.notices.length - 1]?.title, 'Another program is reading the tags');
    assert.equal(pageWords().describe(s as unknown as Record<string, unknown>).title, 'Another program is reading the tags');
  } finally {
    await controller.stop();
  }
});

test('a tag already seen, then reported in use by another program and lost, is shown at once', async () => {
  const reader = new FakeReader(ACR1552U);
  const { controller } = tagTool(reader);
  controller.start();
  try {
    await waitFor(controller, 'tag seen', (s) => s.phase === 'tag-seen');
    reader.raw = PRESENT | INUSE | CHANGED;
    reader.tag.noCardTransmits = Number.POSITIVE_INFINITY;
    const s = await waitFor(controller, 'another program', (x) => x.anotherProgram !== null);
    assert.equal(s.phase, 'tag-not-ready', 'no quiet grace when the reader says another program has it');
    assert.equal(s.anotherProgram, 'The reader reported the tag in use by another program (INUSE).');
  } finally {
    await controller.stop();
  }
});

test('a tag already seen that misses one poll is not called another program', async () => {
  const reader = new FakeReader(ACR1552U);
  const { controller, lines } = tagTool(reader);
  controller.start();
  try {
    await waitFor(controller, 'tag seen', (s) => s.phase === 'tag-seen');
    const flagged: (string | null)[] = [];
    const stop = controller.subscribe((x) => flagged.push(x.anotherProgram));
    reader.tag.noCardTransmits = 3;
    await waitFor(controller, 'one not ready poll', () => lines.some((l) => l.startsWith('Tag not ready')));
    await sleep(150);
    stop();
    assert.equal(controller.snapshot().phase, 'tag-seen');
    assert.ok(flagged.every((x) => x === null), 'never flagged on the way');
    assert.equal(controller.snapshot().anotherProgram, null);
  } finally {
    await controller.stop();
  }
});

test('the controller and the page say the same sentence, and it is the one asked for', () => {
  assert.equal(ANOTHER_PROGRAM_ADVICE, BANNER);
  assert.equal(pageWords().ANOTHER_PROGRAM, BANNER);
  const html = readFileSync(join(STATIC_DIR, 'page.html'), 'utf8');
  assert.ok(html.includes(`<p class="say">${BANNER}</p>`));
});

/* -------------------------------------------------------------------------- */
/* The page's rules, as functions                                              */
/* -------------------------------------------------------------------------- */

test('what counts as a typed tag ID: Dan\'s two, and never a product code', () => {
  const { looksLikeTagId } = pageWords();
  for (const text of [
    '35 49 5E 6D 05 08 02 E0',
    'DE 2B 65 6D 05 08 02 E0',
    '35 49 5E 6D 05 08 02 E035 49 5E 6D',
    'srDE 2B 65 6D 05 08 02 E0',
    '05 08 02 e0',
    '35 49',
    'e0:02:11',
    '35495e',
    'persian',
  ]) {
    assert.equal(looksLikeTagId(text), true, text);
  }
  for (const text of ['', ' ', 'p', 'ps', 'PS', 'cs', 'sr', 'nm', 'kg', 'zz', ' sr ', '35', '35 4', 'abc']) {
    assert.equal(looksLikeTagId(text), false, text);
  }
});

test('keys faster than a person types: a run counts keys within 30 ms of the one before', () => {
  const { keyRhythm } = pageWords();
  const runs = (times: number[]) => {
    const run = { at: null as number | null, run: 0 };
    return times.map((t) => keyRhythm(run, t));
  };
  assert.deepEqual(runs([0, 4, 8, 12, 16]), [1, 2, 3, 4, 5], 'a wedge');
  assert.deepEqual(runs([0, 120, 260, 380]), [1, 1, 1, 1], 'a person');
  assert.deepEqual(runs([0, 20, 140, 160, 175]), [1, 2, 1, 2, 3], 'a quick pair is two, never three');
  assert.deepEqual(runs([0, 30, 61]), [1, 2, 1]);
});

test('the banner shows while the Tag Tool says another program, or for a minute after an ID was typed', () => {
  const { anotherProgramShowing } = pageWords();
  assert.equal(anotherProgramShowing({ anotherProgram: 'The tag was not ready 2 times in a row.' }, null, 0), true);
  assert.equal(anotherProgramShowing({ anotherProgram: null }, null, 0), false);
  assert.equal(anotherProgramShowing(null, 1000, 60_999), true);
  assert.equal(anotherProgramShowing(null, 1000, 61_000), false);
  assert.equal(anotherProgramShowing({ anotherProgram: null }, null, 1e9), false);
});

/* -------------------------------------------------------------------------- */
/* The page itself, in a fake browser                                          */
/* -------------------------------------------------------------------------- */

type Listener = (e: FakeEvent) => void;

class FakeEvent {
  defaultPrevented = false;
  stopped = false;
  constructor(
    readonly type: string,
    readonly timeStamp: number,
    readonly extra: Record<string, unknown> = {},
  ) {
    Object.assign(this, extra);
  }
  preventDefault(): void {
    this.defaultPrevented = true;
  }
  stopPropagation(): void {
    this.stopped = true;
  }
}

class FakeElement {
  value = '';
  textContent = '';
  className = '';
  disabled = false;
  checked = false;
  colSpan = 0;
  label = '';
  readonly style: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, Listener[]>();
  readonly parts = new Map<string, FakeElement>();
  focusCalls = 0;
  constructor(
    readonly doc: FakeDocument,
    readonly id: string,
    readonly tag: string,
    readonly kind: 'text' | 'checkbox' | 'button' | 'select' | 'other' = 'other',
  ) {}
  addEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }
  querySelector(selector: string): FakeElement {
    let part = this.parts.get(selector);
    if (!part) this.parts.set(selector, (part = new FakeElement(this.doc, '', 'span')));
    return part;
  }
  getAttribute(): string | null {
    return null;
  }
  focus(): void {
    this.focusCalls += 1;
    this.doc.activeElement = this;
  }
  blur(): void {
    if (this.doc.activeElement === this) this.doc.activeElement = this.doc.body;
  }
  fire(event: FakeEvent): void {
    for (const fn of this.listeners.get(event.type) ?? []) {
      if (event.stopped) return;
      fn(event);
    }
  }
  dispatchEvent(event: FakeEvent): boolean {
    this.fire(event);
    return !event.defaultPrevented;
  }
}

class FakeDocument {
  title = '';
  readonly body: FakeElement;
  activeElement: FakeElement;
  readonly elements = new Map<string, FakeElement>();
  readonly captureListeners = new Map<string, Listener[]>();
  constructor(html: string) {
    this.body = new FakeElement(this, 'body', 'body');
    this.activeElement = this.body;
    for (const m of html.matchAll(/<(\w+)[^>]*\sid="([^"]+)"[^>]*>/g)) {
      const [whole, tag = '', id = ''] = m;
      const kind = tag === 'button' ? 'button' : tag === 'select' ? 'select' : tag === 'input' ? (/type="checkbox"/.test(whole) ? 'checkbox' : 'text') : 'other';
      this.elements.set(id, new FakeElement(this, id, tag, kind));
    }
  }
  getElementById(id: string): FakeElement | null {
    return this.elements.get(id) ?? null;
  }
  createElement(tag: string): FakeElement {
    return new FakeElement(this, '', tag);
  }
  querySelectorAll(): FakeElement[] {
    return [];
  }
  addEventListener(type: string, fn: Listener, capture?: boolean): void {
    if (capture !== true) throw new Error('the page listens on the document in the capture phase only');
    this.captureListeners.set(type, [...(this.captureListeners.get(type) ?? []), fn]);
  }
}

interface Posted {
  path: string;
  body: Record<string, unknown>;
}

/** Loads page.js against a fake document, the codes from the real table, and a state the test sets. */
async function browser() {
  const doc = new FakeDocument(readFileSync(join(STATIC_DIR, 'page.html'), 'utf8'));
  const posted: Posted[] = [];
  let now = 1_000_000;
  let state: Record<string, unknown> = snapshotOf({ phase: 'waiting-for-tag' });
  let poll: (() => void) | null = null;
  const timers: { at: number; fn: () => void }[] = [];
  const sandbox: Record<string, unknown> = {
    document: doc,
    performance: { now: () => now },
    setInterval: (fn: () => void) => {
      poll = fn;
      return 1;
    },
    clearInterval: () => undefined,
    setTimeout: (fn: () => void, ms: number) => {
      timers.push({ at: now + ms, fn });
      return timers.length;
    },
    clearTimeout: () => undefined,
    fetch: async (path: string, init?: { method?: string; body?: string }) => {
      if (init?.method === 'POST') posted.push({ path, body: JSON.parse(init.body ?? '{}') as Record<string, unknown> });
      const reply = path === '/api/codes' ? { codes: codeList() } : path === '/api/state' ? state : {};
      return { ok: true, status: 200, json: async () => reply };
    },
  };
  sandbox.Event = class extends FakeEvent {
    constructor(type: string) {
      super(type, now);
    }
  };
  sandbox.window = sandbox;
  runInNewContext(readFileSync(join(STATIC_DIR, 'page.js'), 'utf8'), sandbox);
  const settle = async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
  };
  const el = (id: string) => {
    const found = doc.getElementById(id);
    assert.ok(found, id);
    return found;
  };

  /** One key, as the browser delivers it: document capture first, then the focused element, then its default action. */
  function key(name: string, at: number, repeat = false): void {
    now = at;
    const target = doc.activeElement;
    const down = new FakeEvent('keydown', at, { key: name, repeat });
    for (const fn of doc.captureListeners.get('keydown') ?? []) fn(down);
    if (!down.stopped) target.fire(down);
    if (down.defaultPrevented) return;
    if (target.kind === 'text' && name.length === 1 && !target.disabled) {
      target.value += name;
      target.fire(new FakeEvent('input', at, { inputType: 'insertText', data: name }));
    } else if (target.kind === 'checkbox' && name === ' ') {
      target.checked = !target.checked;
      target.fire(new FakeEvent('change', at));
    } else if (target.kind === 'button' && (name === ' ' || name === 'Enter') && !target.disabled) {
      target.fire(new FakeEvent('click', at));
    } else if (target.kind === 'select' && name.length === 1 && name !== ' ' && !target.disabled) {
      // A select's own type-ahead: a letter picks the first option whose text starts with it.
      const hit = target.children.find((o) => o.textContent.toLowerCase().startsWith(name.toLowerCase()));
      if (hit && hit.value !== target.value) {
        target.value = hit.value;
        target.fire(new FakeEvent('change', at));
      }
    }
  }

  return {
    doc,
    el,
    posted,
    settle,
    /** Types `text`, `gapMs` apart, into whatever has the focus at each key. "\n" is Enter. */
    type(text: string, gapMs: number): void {
      for (const ch of text) key(ch === '\n' ? 'Enter' : ch, now + gapMs);
    },
    /** A key held down: the first press, then the keyboard's own repeats, `gapMs` apart. */
    hold(name: string, repeats: number, gapMs: number): void {
      key(name, now + gapMs);
      for (let i = 0; i < repeats; i += 1) key(name, now + gapMs, true);
    },
    /** A code put into the box whole: one input event that is not a typed key. */
    pick(code: string): void {
      const box = el('code');
      box.value = code;
      box.fire(new FakeEvent('input', now, { inputType: 'insertReplacementText' }));
    },
    /** A blend chosen with the mouse from the "Pick a blend" list: focus, then one change event. */
    choose(code: string): void {
      const list = el('code-pick');
      assert.ok(!list.disabled, 'the list can be opened');
      assert.ok(list.children.some((o) => o.value === code), `${code} is in the list`);
      list.focus();
      list.value = code;
      list.fire(new FakeEvent('change', now));
    },
    async setState(fields: Record<string, unknown>): Promise<void> {
      state = snapshotOf(fields);
      assert.ok(poll, 'the page polls the state');
      poll();
      await settle();
    },
    /** Moves the clock on and runs the timers that are due. */
    advance(ms: number): void {
      now += ms;
      for (const t of timers.splice(0)) {
        if (t.at <= now) t.fn();
        else timers.push(t);
      }
    },
    bannerShowing: () => el('another-program').style.display === 'block',
  };
}

function snapshotOf(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    app: 'trevean-tag-tool',
    version: 'test',
    phase: 'waiting-for-tag',
    transport: 'pcsc',
    isHardware: true,
    simulator: null,
    readerName: ACR1552U,
    uid: null,
    code: null,
    blendName: null,
    url: null,
    error: null,
    anotherProgram: null,
    tagAlreadyAttempted: false,
    auto: { enabled: false, code: null, blendName: null },
    writtenCount: 0,
    failedAttempts: 0,
    recent: [],
    journals: [],
    notices: [],
    ...fields,
  };
}

/** GoToTags' rhythm: every key within a few milliseconds of the last. */
const WEDGE_MS = 4;
/** A person: a key every eighth of a second or so. */
const PERSON_MS = 130;

test('page: the code box is not given the focus while waiting for a tag', async () => {
  const b = await browser();
  await b.settle();
  await b.setState({ phase: 'waiting-for-tag' });
  assert.equal(b.el('code').focusCalls, 0);
  assert.notEqual(b.doc.activeElement, b.el('code'));
  // The one focus() left is the Write button's own, for a press with no code chosen.
  const script = readFileSync(join(STATIC_DIR, 'page.js'), 'utf8');
  assert.deepEqual(script.match(/\.focus\(\)/g), ['.focus()']);
  assert.match(script, /if \(entry === null\) \{ \$\('code'\)\.focus\(\); return; \}/);
});

test('page: Dan\'s first recording, the UID typed into the code box is thrown away and the banner says what to do', async () => {
  const b = await browser();
  await b.settle();
  await b.setState({ phase: 'waiting-for-tag' });
  assert.equal(b.bannerShowing(), false);
  b.el('code').focus();
  b.type('35 49 5E 6D 05 08 02 E0', WEDGE_MS);
  assert.equal(b.el('code').value, '', 'cleared');
  assert.notEqual(b.doc.activeElement, b.el('code'), 'the box lets go of the focus, so the rest has nowhere to land');
  assert.equal(b.bannerShowing(), true);
  assert.equal(b.el('another-program-why').textContent, "A tag's ID was typed into this page.");
  assert.doesNotMatch(b.el('code-note').textContent, /35 49/, 'the ID is not repeated back as a bad product code');
  // It types it again, and again, with nothing focused. Nothing lands, and the banner stays.
  b.type('35 49 5E 6D 05 08 02 E0'.repeat(3), WEDGE_MS);
  assert.equal(b.el('code').value, '');
  assert.equal(b.bannerShowing(), true);
  assert.deepEqual(b.posted, []);
});

test('page: Dan\'s second recording, "sr" typed by him survives and the ID after it does not', async () => {
  const b = await browser();
  await b.settle();
  await b.setState({ phase: 'tag-seen', uid: 'e002112233445566' });
  b.el('code').focus();
  b.type('sr', PERSON_MS);
  assert.equal(b.el('code').value, 'sr');
  assert.equal(b.el('write').disabled, false);
  assert.equal(b.bannerShowing(), false);
  b.advance(2000);
  b.type('DE 2B 65 6D 05 08 02 E0\n', WEDGE_MS);
  assert.equal(b.el('code').value, 'sr');
  assert.equal(b.bannerShowing(), true);
  assert.deepEqual(b.posted, [], 'the Enter it typed did not press Write');
});

test('page: a wedge typing more slowly than a person still cannot fill the box', async () => {
  const b = await browser();
  await b.settle();
  b.el('code').focus();
  b.pick('ps');
  b.type('35 49 5E', 60);
  assert.equal(b.el('code').value, 'ps', 'the chosen code is kept');
  assert.equal(b.bannerShowing(), true);
});

test('page: with the focus on the automatic box or on Write, the space and Enter a wedge types do nothing', async () => {
  const b = await browser();
  await b.settle();
  await b.setState({ phase: 'tag-seen', uid: 'e002112233445566' });
  b.pick('ps');
  b.el('auto').focus();
  b.type('35 49 5E 6D 05 08 02 E0\n', WEDGE_MS);
  assert.equal(b.el('auto').checked, false, 'automatic writing was not switched on');
  b.advance(1000);
  b.el('write').focus();
  b.type('35 49 5E 6D 05 08 02 E0\n', WEDGE_MS);
  assert.deepEqual(b.posted, []);
  assert.equal(b.bannerShowing(), true);
});

test('page: a person typing a code and pressing Enter writes it, with no banner', async () => {
  const b = await browser();
  await b.settle();
  await b.setState({ phase: 'tag-seen', uid: 'e002112233445566' });
  b.el('code').focus();
  b.type('ps\n', PERSON_MS);
  assert.equal(b.bannerShowing(), false);
  assert.deepEqual(b.posted, [{ path: '/api/write', body: { code: 'ps' } }]);
  // A quick pair, as people do type, is still a person.
  b.el('code').value = '';
  b.advance(1000);
  b.type('cs', 15);
  assert.equal(b.el('code').value, 'cs');
  assert.equal(b.bannerShowing(), false);
  // And a person can tick the automatic box with the space bar.
  b.el('auto').focus();
  b.type(' ', PERSON_MS);
  assert.equal(b.el('auto').checked, true);
  assert.deepEqual(b.posted[1], { path: '/api/auto', body: { enabled: true, code: 'cs' } });
});

test('page: a key held down is a person, however fast it repeats', async () => {
  const b = await browser();
  await b.settle();
  b.el('code').focus();
  b.hold('p', 3, 20);
  assert.equal(b.el('code').value, 'pppp');
  assert.equal(b.bannerShowing(), false);
});

test('page: Dan 11-09, after writing sr, ps picked from the list is written', async () => {
  const b = await browser();
  await b.settle();
  await b.setState({ phase: 'tag-seen', uid: 'e002112233445566' });
  b.choose('sr');
  b.el('write').fire(new FakeEvent('click', 0));
  assert.deepEqual(b.posted, [{ path: '/api/write', body: { code: 'sr' } }]);
  assert.equal(b.el('code').value, 'sr', 'the last code stays in the box');
  await b.setState({ phase: 'tag-seen', uid: 'e002112233445577' });
  b.choose('ps');
  assert.equal(b.el('code').value, 'ps');
  assert.equal(b.el('code-pick').value, '', 'the list goes back to "Pick a blend"');
  assert.notEqual(b.doc.activeElement, b.el('code-pick'), 'the list lets go of the focus');
  assert.equal(b.el('code-note').className, 'muted');
  assert.equal(b.el('write').disabled, false);
  b.el('write').fire(new FakeEvent('click', 0));
  assert.deepEqual(b.posted[1], { path: '/api/write', body: { code: 'ps' } });
  assert.equal(b.bannerShowing(), false);
});

test('page: the list shows every writable blend whatever is in the box, and never kg', async () => {
  const b = await browser();
  await b.settle();
  const writable = codeList().filter((c) => c.encodable).map((c) => c.code);
  assert.deepEqual(writable, ['ps', 'cs', 'sr', 'nm']);
  const options = () => b.el('code-pick').children.map((o) => o.value);
  assert.deepEqual(options(), ['', ...writable]);
  assert.equal(b.el('code-pick').children[0]?.textContent, 'Pick a blend');
  for (const c of codeList().filter((e) => e.encodable)) {
    assert.ok(b.el('code-pick').children.some((o) => o.value === c.code && o.textContent === `${c.code} ${c.blendName}`), c.code);
  }
  assert.ok(codeList().some((c) => c.code === 'kg' && !c.encodable), 'kg is in the table, reserved');
  b.pick('sr');
  assert.deepEqual(options(), ['', ...writable], 'sr in the box does not narrow the list');
  assert.equal(b.doc.getElementById('code-list'), null, 'the datalist is gone');
});

test('page: the list is off while writing automatically, and an ID typed into it picks nothing', async () => {
  const b = await browser();
  await b.settle();
  await b.setState({ phase: 'waiting-for-tag', auto: { enabled: true, code: 'sr', blendName: 'x' } });
  assert.equal(b.el('code-pick').disabled, true);
  assert.equal(b.el('code').disabled, true);
  assert.equal(b.el('code').value, 'sr');
  await b.setState({ phase: 'waiting-for-tag' });
  assert.equal(b.el('code-pick').disabled, false);
  b.choose('ps');
  // A person clicks the list and closes it again, so it keeps the focus. GoToTags types a UID starting C.
  b.el('code-pick').focus();
  b.advance(2000);
  b.type('C4 49 5E 6D 05 08 02 E0\n', WEDGE_MS);
  assert.equal(b.el('code').value, 'ps', 'the C did not pick cs');
  assert.equal(b.el('code-pick').value, '');
  assert.equal(b.bannerShowing(), true);
  assert.deepEqual(b.posted, []);
  // The box's own guard still holds after a pick from the list.
  b.advance(2000);
  b.el('code').focus();
  b.type('35 49 5E 6D 05 08 02 E0', WEDGE_MS);
  assert.equal(b.el('code').value, 'ps');
  assert.notEqual(b.doc.activeElement, b.el('code'));
});

test('page: while the banner shows, an error notice does not put a second red banner over it', async () => {
  const b = await browser();
  await b.settle();
  const ready = { id: 1, kind: 'reader-ready', title: 'Reader ready', body: ACR1552U, at: '2026-10-26T14:08:53.000Z' };
  await b.setState({ phase: 'waiting-for-tag', notices: [ready] });
  const error = { code: 'TAG_ABSENT', message: 'Case CONNECT_FAILED. SharingViolation.', remedy: 'Exit GoToTags.' };
  const refused = { id: 2, kind: 'error', title: 'Another program is reading the tags', body: error.message, at: '2026-10-26T14:08:59.000Z' };
  await b.setState({ phase: 'error', error, anotherProgram: 'The reader reported the tag in use by another program (SCARD_E_SHARING_VIOLATION).', notices: [ready, refused] });
  assert.equal(b.bannerShowing(), true);
  assert.notEqual(b.el('banner').style.display, 'block');
  // Without it, the same notice is shown as usual.
  const c = await browser();
  await c.settle();
  await c.setState({ phase: 'waiting-for-tag', notices: [ready] });
  await c.setState({ phase: 'error', error, notices: [ready, { ...refused, title: 'TAG_ABSENT' }] });
  assert.equal(c.el('banner').style.display, 'block');
});

test('page: the banner goes a minute after the last typed ID, and shows whenever the Tag Tool says another program', async () => {
  const b = await browser();
  await b.settle();
  await b.setState({ phase: 'waiting-for-tag' });
  b.type('DE 2B 65 6D', WEDGE_MS);
  assert.equal(b.bannerShowing(), true);
  b.advance(30_000);
  assert.equal(b.bannerShowing(), true);
  b.advance(31_000);
  assert.equal(b.bannerShowing(), false);

  await b.setState({
    phase: 'tag-not-ready',
    error: { code: 'TAG_ABSENT', message: 'Case TAG_NOT_READY. The tag was not ready.', remedy: 'The tool tries again by itself.' },
    anotherProgram: 'The tag was not ready 2 times in a row, each after three tries.',
  });
  assert.equal(b.bannerShowing(), true);
  assert.equal(b.el('another-program-why').textContent, 'The tag was not ready 2 times in a row, each after three tries.');
  assert.equal(b.el('status-title').textContent, 'Another program is reading the tags');
  assert.equal(b.el('status-error').style.display, 'block', 'the full message is still there to send');

  await b.setState({ phase: 'tag-seen', uid: 'e002112233445566', anotherProgram: null });
  assert.equal(b.bannerShowing(), false);
  assert.equal(b.el('status-title').textContent, 'Tag seen');
});
