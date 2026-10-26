/**
 * The Tag Tool: its state machine, its HTTP surface, where it listens, and the
 * absence of any way to protect a tag through it.
 *
 * The state machine is driven two ways. Against the bench simulator, which is the
 * real SimulatorTransport memory model with a tag that can be put down and lifted.
 * And against a scripted reader, which does exactly what each test tells it to, in
 * order: no reader, then a reader, then a tag, then no tag, then a tag that fails.
 *
 * Every server here listens on a port from 10360 to 10379.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { connect, createServer as createNetServer, type Server as NetServer, type Socket } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { BenchSimulator } from '../src/app/bench-simulator.js';
import { TagToolController, AppRefusal, type ControllerOptions, type Snapshot } from '../src/app/controller.js';
import { runTagTool } from '../src/app/main.js';
import { HOST, STATIC_DIR, probeExisting, startServer, type RunningServer } from '../src/app/server.js';
import { WriteOnlyTransport } from '../src/app/write-only.js';
import { ChipError } from '../src/chip/errors.js';
import { main as cliMain } from '../src/cli/main.js';
import { CC_BYTES, PART } from '../src/chip/st25tv02kc.js';
import type { AreaProtection } from '../src/chip/st25tv02kc.js';
import { decodeUriMessage } from '../src/ndef/decode.js';
import { unwrapNdefTlv } from '../src/ndef/tlv.js';
import { RedirectTable } from '../src/table/redirect-table.js';
import { RecordingTransport, type AreaProtectionState, type TagIdentity, type TagTransport } from '../src/transport/transport.js';
import { readJournal, verifyRecordDigest } from '../src/workflow/journal.js';

const table = RedirectTable.load();
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TAG_TOOL_FOLDER = resolve(PACKAGE_ROOT, '..', '..');

const PROTECTION_METHODS = ['presentPassword', 'writePassword', 'setAreaProtection'];

const scratchDirs: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'chip-cli-tag-tool-'));
  scratchDirs.push(dir);
  return dir;
}

test.after(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(controller: TagToolController, what: string, predicate: (s: Snapshot) => boolean, timeoutMs = 4000): Promise<Snapshot> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snapshot = controller.snapshot();
    if (predicate(snapshot)) return snapshot;
    if (Date.now() > deadline) {
      assert.fail(`timed out waiting for ${what}; phase is ${snapshot.phase}, error ${snapshot.error?.code ?? 'none'}`);
    }
    await sleep(5);
  }
}

const FAST = { pollMs: 20, idleMs: 5, reopenMs: 20, removalPolls: 2, tagTimeoutMs: 200 } as const;

function controllerFor(transport: TagTransport, extra: Partial<ControllerOptions> = {}): { controller: TagToolController; journalDir: string } {
  const journalDir = scratch();
  const controller = new TagToolController({
    transport,
    table,
    journalDir,
    toolVersion: 'test',
    operator: 'test-operator',
    ...FAST,
    ...extra,
  });
  return { controller, journalDir };
}

function urlOn(memory: Uint8Array): string {
  return decodeUriMessage(unwrapNdefTlv(memory.subarray(CC_BYTES))).uri;
}

function journalFiles(dir: string): string[] {
  return readdirSync(dir).filter((n) => n.endsWith('.jsonl')).map((n) => join(dir, n));
}

/* -------------------------------------------------------------------------- */
/* A scripted reader                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A reader that does what the test says. Memory per tag is a plain array, the
 * geometry is the ST25TV02KC's, and every call is counted.
 */
class ScriptedReader implements TagTransport {
  readonly name = 'scripted';
  readonly isHardware = true;
  readerPresent = false;
  tag: string | null = null;
  readonly failWrites = new Set<string>();
  readonly memory = new Map<string, Uint8Array>();
  readonly calls: string[] = [];
  /** One shot results for the next waitForTag calls, ahead of the steady state. */
  readonly queue: ('absent' | 'reader-error')[] = [];
  #opened = false;

  private unavailable(): ChipError {
    return new ChipError('TRANSPORT_UNAVAILABLE', 'No PC/SC reader appeared within 10 seconds.', 'Check the reader is plugged in.', {});
  }

  private memoryOf(uid: string): Uint8Array {
    let m = this.memory.get(uid);
    if (m === undefined) {
      m = new Uint8Array(PART.totalBytes);
      this.memory.set(uid, m);
    }
    return m;
  }

  private current(): Uint8Array {
    if (!this.#opened || this.tag === null) throw new ChipError('TAG_ABSENT', 'No tag.', 'Put one on.', {});
    return this.memoryOf(this.tag);
  }

  async open(): Promise<void> {
    this.calls.push('open');
    if (!this.readerPresent) throw this.unavailable();
    this.#opened = true;
  }
  async close(): Promise<void> {
    this.calls.push('close');
    this.#opened = false;
  }
  async waitForTag(timeoutMs: number): Promise<TagIdentity> {
    this.calls.push('waitForTag');
    const next = this.queue.shift();
    if (next === 'reader-error' || !this.readerPresent) throw this.unavailable();
    if (next === 'absent' || this.tag === null) {
      await sleep(Math.min(timeoutMs, 10));
      throw new ChipError('TAG_ABSENT', `No tag arrived on the reader within ${timeoutMs} ms.`, 'Place one tag.', {});
    }
    return { uid: this.tag, partNumber: null, blockCount: PART.blockCount, blockSizeBytes: PART.blockSizeBytes };
  }
  async readBlocks(firstBlock: number, count: number): Promise<Uint8Array> {
    this.calls.push('readBlocks');
    const start = firstBlock * PART.blockSizeBytes;
    return this.current().slice(start, start + count * PART.blockSizeBytes);
  }
  async writeBlock(block: number, data: Uint8Array): Promise<void> {
    this.calls.push('writeBlock');
    const memory = this.current();
    if (this.tag !== null && this.failWrites.has(this.tag)) {
      throw new ChipError('WRITE_FAILED', 'The tag refused the write.', 'Retry this unit. If it fails twice, set the tag aside.', {});
    }
    memory.set(data, block * PART.blockSizeBytes);
  }
  async presentPassword(_n: number, _p: Uint8Array): Promise<void> {
    this.calls.push('presentPassword');
  }
  async writePassword(_n: number, _p: Uint8Array): Promise<void> {
    this.calls.push('writePassword');
  }
  async setAreaProtection(_a: number, _p: AreaProtection, _n: number): Promise<void> {
    this.calls.push('setAreaProtection');
  }
  async readAreaProtection(_a: number): Promise<AreaProtectionState> {
    this.calls.push('readAreaProtection');
    return { protection: 'none', passwordNumber: 1 };
  }
  async releaseTag(): Promise<void> {
    this.calls.push('releaseTag');
  }
  async completeUnit(): Promise<void> {
    this.calls.push('completeUnit');
  }
}

/* -------------------------------------------------------------------------- */
/* State machine, scripted reader                                              */
/* -------------------------------------------------------------------------- */

test('scripted: reader appears, tag arrives, write, tag removed, next tag, an error, then a retry', async () => {
  const reader = new ScriptedReader();
  const { controller, journalDir } = controllerFor(reader, { readerName: () => (reader.readerPresent ? 'ACS ACR1552 1S CL Reader PICC 0' : null) });
  const phases: string[] = [];
  controller.subscribe((s) => {
    if (phases[phases.length - 1] !== s.phase) phases.push(s.phase);
  });
  controller.start();
  try {
    let s = await waitFor(controller, 'reader not found', (x) => x.phase === 'reader-not-found');
    assert.equal(s.error?.code, 'TRANSPORT_UNAVAILABLE');
    assert.match(s.error?.remedy ?? '', /plugged in/);

    reader.readerPresent = true;
    s = await waitFor(controller, 'reader ready', (x) => x.phase === 'waiting-for-tag');
    assert.equal(s.readerName, 'ACS ACR1552 1S CL Reader PICC 0');

    reader.tag = 'E002000000000A01';
    s = await waitFor(controller, 'tag seen', (x) => x.phase === 'tag-seen');
    assert.equal(s.uid, 'E002000000000A01');

    controller.requestWrite('PS ');
    s = await waitFor(controller, 'written', (x) => x.phase === 'written');
    assert.equal(s.url, 'https://treveanspice.com/t/ps');
    assert.equal(s.code, 'ps');
    assert.equal(s.writtenCount, 1);
    assert.equal(urlOn(reader.memory.get('E002000000000A01') as Uint8Array), 'https://treveanspice.com/t/ps');

    // One missed poll is a blink, not a removal.
    reader.queue.push('absent');
    await sleep(80);
    assert.equal(controller.snapshot().phase, 'written');

    reader.tag = null;
    await waitFor(controller, 'waiting again', (x) => x.phase === 'waiting-for-tag');

    reader.tag = 'E002000000000A02';
    reader.failWrites.add('E002000000000A02');
    await waitFor(controller, 'second tag seen', (x) => x.phase === 'tag-seen' && x.uid === 'E002000000000A02');
    controller.requestWrite('ps');
    s = await waitFor(controller, 'error', (x) => x.phase === 'error');
    assert.equal(s.error?.code, 'WRITE_FAILED');
    assert.equal(s.error?.message, 'The tag refused the write.');
    assert.match(s.error?.remedy ?? '', /set the tag aside/);
    assert.equal(s.uid, 'E002000000000A02');
    assert.equal(s.failedAttempts, 2, 'two attempts per press, as the batch does');

    // The error stays on screen while the same tag sits there.
    await sleep(60);
    assert.equal(controller.snapshot().phase, 'error');

    reader.failWrites.clear();
    controller.requestWrite('ps');
    s = await waitFor(controller, 'written on retry', (x) => x.phase === 'written' && x.uid === 'E002000000000A02');
    assert.equal(s.writtenCount, 2);

    // A different tag replacing it with no gap is still noticed.
    reader.tag = 'E002000000000A03';
    await waitFor(controller, 'third tag seen', (x) => x.phase === 'tag-seen' && x.uid === 'E002000000000A03');
  } finally {
    await controller.stop();
  }

  assert.deepEqual(phases.slice(0, 9), [
    'reader-not-found',
    'waiting-for-tag',
    'tag-seen',
    'writing',
    'written',
    'waiting-for-tag',
    'tag-seen',
    'writing',
    'error',
  ]);
  const kinds = controller.snapshot().notices.map((n) => n.kind);
  assert.deepEqual(kinds.slice(0, 7), ['error', 'reader-ready', 'tag-seen', 'written', 'tag-seen', 'error', 'written']);

  // The journal: one file for ps, in the batch format, every line self checked.
  const files = journalFiles(journalDir);
  assert.equal(files.length, 1);
  const journal = readJournal(files[0] as string);
  assert.deepEqual(journal.digestFailures, []);
  assert.equal(journal.badLines, 0);
  assert.equal(journal.header.code, 'ps');
  assert.equal(journal.header.protectRequested, false);
  assert.equal(journal.header.passwordFingerprint, null);
  assert.equal(journal.header.transport, 'scripted');
  assert.equal(journal.header.tableDigest, table.digest);
  assert.deepEqual(
    journal.units.map((u) => [u.seq, u.attempt, u.outcome, u.uid]),
    [
      [1, 1, 'verified', 'E002000000000A01'],
      [2, 1, 'failed', 'E002000000000A02'],
      [2, 2, 'failed', 'E002000000000A02'],
      [2, 3, 'verified', 'E002000000000A02'],
    ],
  );
  for (const unit of journal.units) {
    assert.equal(unit.protection, null);
    assert.equal(verifyRecordDigest(unit), true);
  }
  assert.equal(journal.ends.length, 1, 'closing the Tag Tool ends the journal');

  for (const method of PROTECTION_METHODS) assert.equal(reader.calls.includes(method), false, `${method} must never reach the reader`);
});

test('scripted: a reader that stops answering is reopened, and reported only if it will not open', async () => {
  const reader = new ScriptedReader();
  reader.readerPresent = true;
  const { controller } = controllerFor(reader);
  controller.start();
  try {
    await waitFor(controller, 'ready', (x) => x.phase === 'waiting-for-tag');
    const readyNotices = controller.snapshot().notices.length;
    reader.queue.push('reader-error');
    await sleep(80);
    assert.equal(controller.snapshot().phase, 'waiting-for-tag', 'a reader that reopens straight away is not news');
    assert.equal(controller.snapshot().notices.length, readyNotices);

    reader.readerPresent = false;
    const s = await waitFor(controller, 'reader lost', (x) => x.phase === 'reader-not-found');
    assert.equal(s.notices[s.notices.length - 1]?.kind, 'error');

    reader.readerPresent = true;
    await waitFor(controller, 'ready again', (x) => x.phase === 'waiting-for-tag');
    assert.equal(controller.snapshot().notices.filter((n) => n.kind === 'reader-ready').length, 2);
  } finally {
    await controller.stop();
  }
});

test('scripted: a write asked for with no tag, no reader, or while busy is refused with words to show', async () => {
  const reader = new ScriptedReader();
  const { controller } = controllerFor(reader);
  controller.start();
  try {
    await waitFor(controller, 'no reader', (x) => x.phase === 'reader-not-found');
    assert.throws(() => controller.requestWrite('ps'), (e: unknown) => e instanceof AppRefusal && e.status === 409 && e.error.code === 'TRANSPORT_UNAVAILABLE');

    reader.readerPresent = true;
    await waitFor(controller, 'ready', (x) => x.phase === 'waiting-for-tag');
    assert.throws(() => controller.requestWrite('ps'), (e: unknown) => e instanceof AppRefusal && e.status === 409 && e.error.code === 'TAG_ABSENT');

    reader.tag = 'E002000000000B01';
    await waitFor(controller, 'tag', (x) => x.phase === 'tag-seen');
    assert.throws(() => controller.requestWrite('kg'), (e: unknown) => e instanceof AppRefusal && e.status === 400 && e.error.code === 'CODE_NOT_ENCODABLE');
    assert.throws(() => controller.requestWrite('zz'), (e: unknown) => e instanceof AppRefusal && e.status === 400 && e.error.code === 'CODE_UNKNOWN');
    controller.requestWrite('sr');
    assert.throws(() => controller.requestWrite('sr'), (e: unknown) => e instanceof AppRefusal && e.status === 409 && e.error.code === 'BUSY');
    const s = await waitFor(controller, 'written', (x) => x.phase === 'written');
    assert.equal(s.url, 'https://treveanspice.com/t/sr');
  } finally {
    await controller.stop();
  }
});

/* -------------------------------------------------------------------------- */
/* State machine, bench simulator                                              */
/* -------------------------------------------------------------------------- */

test('simulator: write, take off, automatic mode writes each new tag once, a faulty tag shows its error', async () => {
  const bench = new BenchSimulator({ faults: { 3: 'write-fail' } });
  const recording = new RecordingTransport(bench);
  const { controller, journalDir } = controllerFor(recording, { readerName: () => bench.readerName });
  controller.start();
  try {
    await waitFor(controller, 'ready', (x) => x.phase === 'waiting-for-tag' && x.readerName === bench.readerName);

    await bench.placeTag();
    await waitFor(controller, 'tag 1 seen', (x) => x.phase === 'tag-seen' && x.uid === 'E002000000000001');
    controller.requestWrite('ps');
    let s = await waitFor(controller, 'tag 1 written', (x) => x.phase === 'written');
    assert.equal(s.url, 'https://treveanspice.com/t/ps');
    assert.equal(urlOn(bench.simulator.snapshot(1)), 'https://treveanspice.com/t/ps');

    await bench.removeTag();
    await waitFor(controller, 'waiting', (x) => x.phase === 'waiting-for-tag');

    controller.setAuto(true, 'nm');
    await bench.placeTag();
    s = await waitFor(controller, 'tag 2 written automatically', (x) => x.phase === 'written' && x.uid === 'E002000000000002');
    assert.equal(s.code, 'nm');
    assert.equal(urlOn(bench.simulator.snapshot(2)), 'https://treveanspice.com/t/nm');

    // Left on the reader, the written tag is not written again.
    await sleep(120);
    assert.equal(controller.snapshot().writtenCount, 2);
    assert.equal(controller.snapshot().phase, 'written');

    await bench.removeTag();
    await waitFor(controller, 'waiting', (x) => x.phase === 'waiting-for-tag');
    await bench.placeTag();
    s = await waitFor(controller, 'tag 3 fails', (x) => x.phase === 'error');
    assert.equal(s.error?.code, 'WRITE_FAILED');
    assert.equal(s.uid, 'E002000000000003');
    // Automatic mode does not keep hammering a tag that failed.
    await sleep(120);
    assert.equal(controller.snapshot().failedAttempts, 2);

    await bench.removeTag();
    await bench.placeTag();
    s = await waitFor(controller, 'tag 4 written automatically', (x) => x.phase === 'written' && x.uid === 'E002000000000004');
    assert.equal(s.writtenCount, 3);
    assert.deepEqual(
      s.recent.map((u) => [u.uid, u.code, u.outcome]),
      [
        ['E002000000000004', 'nm', 'verified'],
        ['E002000000000003', 'nm', 'failed'],
        ['E002000000000003', 'nm', 'failed'],
        ['E002000000000002', 'nm', 'verified'],
        ['E002000000000001', 'ps', 'verified'],
      ],
    );
  } finally {
    await controller.stop();
  }

  for (const method of PROTECTION_METHODS) assert.equal(recording.countOf(method), 0, `${method} must never be called`);
  assert.equal(bench.simulator.protectionOf(1).protection, 'none');
  assert.equal(bench.simulator.protectionOf(2).protection, 'none');

  const files = journalFiles(journalDir).sort();
  assert.equal(files.length, 2, 'one journal per product code');
  const units = files.flatMap((f) => readJournal(f).units);
  assert.equal(units.length, 5);
  assert.ok(units.every((u) => u.protection === null));
});

test('simulator: turning automatic on with a fresh tag already on the reader writes it', async () => {
  const bench = new BenchSimulator();
  const { controller } = controllerFor(bench);
  controller.start();
  try {
    await waitFor(controller, 'ready', (x) => x.phase === 'waiting-for-tag');
    await bench.placeTag();
    await waitFor(controller, 'tag seen', (x) => x.phase === 'tag-seen');
    controller.setAuto(true, 'cs');
    const s = await waitFor(controller, 'written', (x) => x.phase === 'written');
    assert.equal(s.url, 'https://treveanspice.com/t/cs');
    assert.throws(() => controller.setAuto(true, 'kg'), (e: unknown) => e instanceof AppRefusal && e.error.code === 'CODE_NOT_ENCODABLE');
    assert.throws(() => controller.setAuto(true, null), (e: unknown) => e instanceof AppRefusal);
    controller.setAuto(false, null);
    assert.equal(controller.snapshot().auto.enabled, false);
  } finally {
    await controller.stop();
  }
});

test('simulator: a tag that is not an ST25TV02KC is shown as an error and never written', async () => {
  const bench = new BenchSimulator({ faults: { 1: 'geometry-mismatch' } });
  const recording = new RecordingTransport(bench);
  const { controller } = controllerFor(recording);
  controller.start();
  try {
    await waitFor(controller, 'ready', (x) => x.phase === 'waiting-for-tag');
    controller.setAuto(true, 'ps');
    await bench.placeTag();
    const s = await waitFor(controller, 'error', (x) => x.phase === 'error');
    assert.equal(s.error?.code, 'TAG_NOT_ST25TV02KC');
    assert.throws(() => controller.requestWrite('ps'), (e: unknown) => e instanceof AppRefusal && e.status === 409);
    await bench.removeTag();
    await waitFor(controller, 'waiting', (x) => x.phase === 'waiting-for-tag');
  } finally {
    await controller.stop();
  }
  assert.equal(recording.countOf('writeBlock'), 0);
});

test('chip-cli status reads a Tag Tool journal as open ended, with nothing to resume', async () => {
  const bench = new BenchSimulator({ faults: { 2: 'write-fail' } });
  const { controller, journalDir } = controllerFor(bench);
  controller.start();
  try {
    await waitFor(controller, 'ready', (x) => x.phase === 'waiting-for-tag');
    controller.setAuto(true, 'sr');
    for (const expected of ['written', 'error', 'written']) {
      await bench.placeTag();
      await waitFor(controller, expected, (x) => x.phase === expected);
      await bench.removeTag();
      await waitFor(controller, 'waiting', (x) => x.phase === 'waiting-for-tag');
    }
  } finally {
    await controller.stop();
  }
  const path = journalFiles(journalDir)[0] as string;
  const out: string[] = [];
  assert.equal(await cliMain(['status', '--journal', path], { out: (l) => out.push(l), err: (l) => out.push(l) }), 0);
  const text = out.join('\n');
  assert.match(text, /Done +2 verified \(Tag Tool session, no target\)/);
  assert.doesNotMatch(text, /Remaining|--resume/);

  out.length = 0;
  assert.equal(await cliMain(['status', '--journal', path, '--json'], { out: (l) => out.push(l), err: (l) => out.push(l) }), 0);
  const json = JSON.parse(out.join('\n')) as { done: number; remaining: number[]; header: { targetCount: number } };
  assert.equal(json.done, 2);
  assert.deepEqual(json.remaining, []);
  assert.equal(json.header.targetCount, 0);
});

/* -------------------------------------------------------------------------- */
/* No protect path                                                             */
/* -------------------------------------------------------------------------- */

test('the write only wrapper refuses every password and protection command before the reader sees it', async () => {
  const inner = new RecordingTransport(new BenchSimulator());
  const guarded = new WriteOnlyTransport(inner);
  await assert.rejects(guarded.presentPassword(1, new Uint8Array(8)), /never locks/);
  await assert.rejects(guarded.writePassword(1, new Uint8Array(8)), /never locks/);
  await assert.rejects(guarded.setAreaProtection(1, 'write_protected', 1), /never locks/);
  for (const method of PROTECTION_METHODS) assert.equal(inner.countOf(method), 0);
});

test('no protect path is reachable from the Tag Tool source or its page', () => {
  const appDir = join(PACKAGE_ROOT, 'src', 'app');
  const sources = readdirSync(appDir).filter((n) => n.endsWith('.ts'));
  assert.ok(sources.length >= 5);
  for (const name of sources) {
    const text = readFileSync(join(appDir, name), 'utf8');
    assert.doesNotMatch(text, /\.protect\(/, `${name} calls protect`);
    assert.doesNotMatch(text, /TagPassword|loadPassword|unlockPassword|currentPassword|newPassword|--protect/, `${name} handles a password`);
    assert.doesNotMatch(text, /\.(presentPassword|writePassword|setAreaProtection)\(/, `${name} calls a protection command`);
  }
  for (const name of ['page.html', 'page.js']) {
    // The one exception: the plain words for the AREA_PROTECTED error, shown when a
    // tag that is already locked is put on the reader.
    const text = readFileSync(join(STATIC_DIR, name), 'utf8').replace(/AREA_PROTECTED: '[^']*',/, '');
    assert.doesNotMatch(text, /password|protect|\block\b/i, `${name} mentions a password or protection control`);
  }
  const script = readFileSync(join(STATIC_DIR, 'page.js'), 'utf8');
  assert.deepEqual(script.match(/post\('\/api\/write', [^)]*\)/g), ["post('/api/write', { code: entry.code })"], 'a write sends the code and nothing else');
});

/* -------------------------------------------------------------------------- */
/* HTTP                                                                        */
/* -------------------------------------------------------------------------- */

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
  json: () => Record<string, unknown>;
}

function call(port: number, method: string, path: string, body?: string, headers: Record<string, string> = {}): Promise<Reply> {
  return new Promise((resolveCall, reject) => {
    const req = httpRequest({ host: HOST, port, method, path, headers: { Host: `${HOST}:${port}`, ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolveCall({ status: res.statusCode ?? 0, headers: res.headers, body: text, json: () => JSON.parse(text) as Record<string, unknown> });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function withServer(
  port: number,
  run: (ctx: { server: RunningServer; controller: TagToolController; bench: BenchSimulator; recording: RecordingTransport; journalDir: string }) => Promise<void>,
  useBench = true,
): Promise<void> {
  const bench = new BenchSimulator();
  const recording = new RecordingTransport(bench);
  const { controller, journalDir } = controllerFor(recording, {
    readerName: () => bench.readerName,
    simulatorState: () => ({ readerConnected: bench.readerConnected, tagPresent: bench.tagPresent }),
  });
  const server = await startServer({ controller, bench: useBench ? bench : null, ports: [port] });
  controller.start();
  try {
    await run({ server, controller, bench, recording, journalDir });
  } finally {
    await controller.stop();
    await server.close();
  }
}

test('http: the page, its script, the codes and the state', async () => {
  await withServer(10360, async ({ server, controller }) => {
    assert.equal(server.url, 'http://127.0.0.1:10360/');
    await waitFor(controller, 'ready', (x) => x.phase === 'waiting-for-tag');

    const page = await call(10360, 'GET', '/');
    assert.equal(page.status, 200);
    assert.match(String(page.headers['content-type']), /text\/html/);
    assert.match(String(page.headers['content-security-policy']), /default-src 'none'; script-src 'self'/);
    assert.equal(page.headers['x-frame-options'], 'DENY');
    assert.match(page.body, /Trevean Tag Tool/);
    assert.match(page.body, /Write this code to every new tag automatically/);

    const script = await call(10360, 'GET', '/page.js');
    assert.equal(script.status, 200);
    assert.match(String(script.headers['content-type']), /javascript/);

    const ping = (await call(10360, 'GET', '/api/ping')).json();
    assert.equal(ping.app, 'trevean-tag-tool');

    const codes = (await call(10360, 'GET', '/api/codes')).json().codes as { code: string; blendName: string; encodable: boolean; url: string | null }[];
    assert.deepEqual(
      codes.filter((c) => c.encodable).map((c) => c.code),
      ['ps', 'cs', 'sr', 'nm'],
    );
    assert.equal(codes.find((c) => c.code === 'ps')?.blendName, 'Persian Sunrise');
    const kg = codes.find((c) => c.code === 'kg');
    assert.equal(kg?.encodable, false);
    assert.equal(kg?.url, null);

    const state = (await call(10360, 'GET', '/api/state')).json();
    assert.equal(state.phase, 'waiting-for-tag');
    assert.equal(state.isHardware, false);
  });
});

test('http: the event stream sends the state at once and again on every change', async () => {
  await withServer(10361, async ({ controller }) => {
    await waitFor(controller, 'ready', (x) => x.phase === 'waiting-for-tag');
    const events: Snapshot[] = [];
    let contentType = '';
    const req = httpRequest({ host: HOST, port: 10361, path: '/api/events', headers: { Host: `${HOST}:10361` } }, (res) => {
      contentType = String(res.headers['content-type']);
      let buffer = '';
      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        let at: number;
        while ((at = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, at);
          buffer = buffer.slice(at + 2);
          const data = block.split('\n').find((l) => l.startsWith('data: '));
          if (block.includes('event: state') && data !== undefined) events.push(JSON.parse(data.slice(6)) as Snapshot);
        }
      });
    });
    req.end();
    try {
      const deadline = Date.now() + 3000;
      while (events.length === 0 && Date.now() < deadline) await sleep(5);
      assert.match(contentType, /text\/event-stream/);
      assert.equal(events[0]?.phase, 'waiting-for-tag');

      const placed = await call(10361, 'POST', '/api/sim', JSON.stringify({ action: 'place' }), JSON_HEADERS);
      assert.equal(placed.status, 200);
      while (!events.some((e) => e.phase === 'tag-seen') && Date.now() < deadline) await sleep(5);
      assert.ok(events.some((e) => e.phase === 'tag-seen'), 'the stream carried the tag arriving');

      const wrote = await call(10361, 'POST', '/api/write', JSON.stringify({ code: 'ps' }), JSON_HEADERS);
      assert.equal(wrote.status, 202);
      while (!events.some((e) => e.phase === 'written') && Date.now() < deadline) await sleep(5);
      const written = events.find((e) => e.phase === 'written');
      assert.equal(written?.url, 'https://treveanspice.com/t/ps');
      assert.ok(events.some((e) => e.phase === 'writing'), 'the stream carried the writing state');
    } finally {
      req.destroy();
    }
  });
});

test('http: refusals come back with a code, a message and a remedy', async () => {
  await withServer(10362, async ({ controller, bench }) => {
    await waitFor(controller, 'ready', (x) => x.phase === 'waiting-for-tag');

    let r = await call(10362, 'POST', '/api/write', JSON.stringify({ code: 'ps' }), JSON_HEADERS);
    assert.equal(r.status, 409);
    const noTag = r.json().error as { code: string; message: string; remedy: string };
    assert.equal(noTag.code, 'TAG_ABSENT');
    assert.ok(noTag.message.length > 0 && noTag.remedy.length > 0);

    await bench.placeTag();
    await waitFor(controller, 'tag', (x) => x.phase === 'tag-seen');
    r = await call(10362, 'POST', '/api/write', JSON.stringify({ code: 'kg' }), JSON_HEADERS);
    assert.equal(r.status, 400);
    assert.equal((r.json().error as { code: string }).code, 'CODE_NOT_ENCODABLE');
    r = await call(10362, 'POST', '/api/write', JSON.stringify({ code: 'xx' }), JSON_HEADERS);
    assert.equal(r.status, 400);
    assert.equal((r.json().error as { code: string }).code, 'CODE_UNKNOWN');
    r = await call(10362, 'POST', '/api/auto', JSON.stringify({ enabled: true, code: 'kg' }), JSON_HEADERS);
    assert.equal(r.status, 400);
    r = await call(10362, 'POST', '/api/sim', JSON.stringify({ action: 'explode' }), JSON_HEADERS);
    assert.equal(r.status, 400);
    r = await call(10362, 'POST', '/api/write', 'not json', JSON_HEADERS);
    assert.equal(r.status, 400);
    r = await call(10362, 'POST', '/api/write', JSON.stringify({ code: 'x'.repeat(5000) }), JSON_HEADERS);
    assert.equal(r.status, 400, 'an oversized body is refused');
    r = await call(10362, 'GET', '/api/nothing');
    assert.equal(r.status, 404);
    r = await call(10362, 'POST', '/api/nothing', '{}', JSON_HEADERS);
    assert.equal(r.status, 404);
    r = await call(10362, 'DELETE', '/api/state');
    assert.equal(r.status, 405);

    assert.equal(controller.snapshot().phase, 'tag-seen', 'none of that wrote anything');
    assert.equal(controller.snapshot().recent.length, 0);
  });
});

test('http: another web page cannot drive it', async () => {
  await withServer(10363, async ({ controller, bench }) => {
    await waitFor(controller, 'ready', (x) => x.phase === 'waiting-for-tag');
    await bench.placeTag();
    await waitFor(controller, 'tag', (x) => x.phase === 'tag-seen');
    const body = JSON.stringify({ code: 'ps' });

    // DNS rebinding: a page on another name that resolves to 127.0.0.1.
    let r = await call(10363, 'GET', '/api/state', undefined, { Host: 'evil.example:10363' });
    assert.equal(r.status, 403);
    r = await call(10363, 'POST', '/api/write', body, { ...JSON_HEADERS, Host: 'evil.example:10363' });
    assert.equal(r.status, 403);
    // A cross site request from a page that knows the address.
    r = await call(10363, 'POST', '/api/write', body, { ...JSON_HEADERS, Origin: 'https://evil.example' });
    assert.equal(r.status, 403);
    r = await call(10363, 'POST', '/api/write', body, { ...JSON_HEADERS, 'Sec-Fetch-Site': 'cross-site' });
    assert.equal(r.status, 403);
    // A plain HTML form can only send these content types.
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      r = await call(10363, 'POST', '/api/write', body, { 'Content-Type': type });
      assert.equal(r.status, 415, type);
    }
    assert.equal(controller.snapshot().recent.length, 0, 'nothing was written');

    // The page itself, same origin, by name or by number.
    r = await call(10363, 'POST', '/api/write', body, { ...JSON_HEADERS, Origin: 'http://127.0.0.1:10363', 'Sec-Fetch-Site': 'same-origin' });
    assert.equal(r.status, 202);
    await waitFor(controller, 'written', (x) => x.phase === 'written');
    r = await call(10363, 'GET', '/api/state', undefined, { Host: 'localhost:10363' });
    assert.equal(r.status, 200);
  });
});

test('http: a write request asking for protection still only writes and verifies', async () => {
  await withServer(10364, async ({ controller, bench, recording, journalDir }) => {
    await waitFor(controller, 'ready', (x) => x.phase === 'waiting-for-tag');
    await bench.placeTag();
    await waitFor(controller, 'tag', (x) => x.phase === 'tag-seen');
    const r = await call(
      10364,
      'POST',
      '/api/write',
      JSON.stringify({ code: 'ps', protect: true, lock: true, password: '0011223344556677', newPassword: '8899aabbccddeeff' }),
      JSON_HEADERS,
    );
    assert.equal(r.status, 202);
    await waitFor(controller, 'written', (x) => x.phase === 'written');
    for (const method of PROTECTION_METHODS) assert.equal(recording.countOf(method), 0);
    assert.equal(bench.simulator.protectionOf(1).protection, 'none');
    const journal = readJournal(journalFiles(journalDir)[0] as string);
    assert.equal(journal.header.protectRequested, false);
    assert.equal(journal.units[0]?.outcome, 'verified');
    assert.equal(journal.units[0]?.protection, null);
  });
});

test('http: the simulator controls exist only with the simulator', async () => {
  await withServer(
    10365,
    async () => {
      const r = await call(10365, 'POST', '/api/sim', JSON.stringify({ action: 'place' }), JSON_HEADERS);
      assert.equal(r.status, 404);
    },
    false,
  );
});

/* -------------------------------------------------------------------------- */
/* Where it listens                                                            */
/* -------------------------------------------------------------------------- */

function tryConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolveConnect) => {
    const socket = connect({ host, port, timeout: 1000 });
    socket.once('connect', () => {
      socket.destroy();
      resolveConnect(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolveConnect(false);
    });
    socket.once('error', () => resolveConnect(false));
  });
}

test('the server binds 127.0.0.1 only, and is unreachable on every other address this machine has', async () => {
  await withServer(10366, async ({ server }) => {
    assert.equal(server.address, '127.0.0.1');
    assert.equal(HOST, '127.0.0.1');
    assert.equal(await tryConnect('127.0.0.1', 10366), true);

    const others: string[] = ['::1'];
    for (const list of Object.values(networkInterfaces())) {
      for (const info of list ?? []) {
        if (info.address !== '127.0.0.1') others.push(info.address.includes(':') ? `${info.address.split('%')[0]}` : info.address);
      }
    }
    for (const address of others) {
      if (address.startsWith('fe80')) continue; // link local needs a scope id to dial at all
      assert.equal(await tryConnect(address, 10366), false, `reachable on ${address}`);
    }
  });
});

test('the server source has no way to choose another address', () => {
  const text = readFileSync(join(PACKAGE_ROOT, 'src', 'app', 'server.ts'), 'utf8');
  const listens = text.match(/\.listen\([^)]*\)/g) ?? [];
  assert.deepEqual(listens, ['.listen({ host: HOST, port, exclusive: true })']);
  assert.match(text, /export const HOST = '127\.0\.0\.1';/);
  assert.doesNotMatch(text, /0\.0\.0\.0|'::'/);
});

test('a port that is taken is skipped for the next one, and a running Tag Tool is recognised', async () => {
  // Something else on the port: it accepts connections and never answers them.
  const held = new Set<Socket>();
  const squatter: NetServer = createNetServer((socket) => {
    held.add(socket);
    socket.on('error', () => undefined);
  });
  await new Promise<void>((r) => squatter.listen({ host: HOST, port: 10370 }, () => r()));
  try {
    await withServer(10371, async () => undefined); // sanity: 10371 is usable
    const bench = new BenchSimulator();
    const { controller } = controllerFor(bench);
    const server = await startServer({ controller, ports: [10370, 10371] });
    try {
      assert.equal(server.port, 10371);
      assert.equal(await probeExisting(10371), true);
      assert.equal(await probeExisting(10370, 300), false, 'something else on the port is not the Tag Tool');
      assert.equal(await probeExisting(10372), false, 'nothing on the port is not the Tag Tool');
    } finally {
      await server.close();
    }
    await assert.rejects(startServer({ controller, ports: [10370] }), /10370/);
  } finally {
    // close() waits for every connection, and the probe's is still held open.
    for (const socket of held) socket.destroy();
    await new Promise<void>((r) => squatter.close(() => r()));
  }
});

test('starting it twice opens the copy that is running instead of starting another', async () => {
  await withServer(10373, async () => {
    const out: string[] = [];
    const opened: string[] = [];
    const code = await runTagTool(['--simulator', '--port', '10373'], { out: (l) => out.push(l), err: (l) => out.push(l), openBrowser: (u) => opened.push(u) });
    assert.equal(code, 0);
    assert.deepEqual(opened, ['http://127.0.0.1:10373/']);
    assert.match(out.join('\n'), /already running/);
  });
});

test('runTagTool starts, opens the browser once on its own address, and stops cleanly', async () => {
  const out: string[] = [];
  const opened: string[] = [];
  const journalDir = scratch();
  let seen: string | null = null;
  const code = await runTagTool(['--simulator', '--port', '10374', '--journal-dir', journalDir], {
    out: (l) => out.push(l),
    err: (l) => out.push(l),
    openBrowser: (u) => opened.push(u),
    untilStopped: async (server) => {
      seen = server.url;
      const state = await call(10374, 'GET', '/api/state');
      assert.equal(state.status, 200);
    },
  });
  assert.equal(code, 0);
  assert.equal(seen, 'http://127.0.0.1:10374/');
  assert.deepEqual(opened, ['http://127.0.0.1:10374/']);
  assert.match(out.join('\n'), /SIMULATOR/);
  assert.equal(await tryConnect('127.0.0.1', 10374), false, 'the port is let go on the way out');

  assert.equal(await runTagTool(['--port', 'abc'], { out: () => undefined, err: () => undefined }), 1);
  assert.equal(await runTagTool(['--protect'], { out: () => undefined, err: () => undefined }), 1, 'there is no --protect here');
});

/* -------------------------------------------------------------------------- */
/* The page's words                                                            */
/* -------------------------------------------------------------------------- */

type Describe = (s: Record<string, unknown>) => { reader: string; title: string; detail: string; uid: string | null; error: { code: string } | null };

function pageDescribe(): Describe {
  const sandbox: Record<string, unknown> = {};
  runInNewContext(readFileSync(join(STATIC_DIR, 'page.js'), 'utf8'), sandbox);
  return (sandbox.TagToolPage as { describe: Describe }).describe;
}

test('the page says each state in plain words', () => {
  const describe = pageDescribe();
  const base = { readerName: 'ACS ACR1552 1S CL Reader PICC 0', uid: null, code: null, blendName: null, url: null, error: null, tagAlreadyAttempted: false, auto: { enabled: false, code: null }, recent: [] };
  const err = { code: 'TRANSPORT_UNAVAILABLE', message: 'No PC/SC reader appeared within 10 seconds.', remedy: 'Check the reader is plugged in.' };

  assert.equal(describe({ ...base, readerName: null, phase: 'starting' }).title, 'Looking for the reader');
  const missing = describe({ ...base, readerName: null, phase: 'reader-not-found', error: err });
  assert.equal(missing.title, 'Reader not found');
  assert.equal(missing.reader, 'Reader: not found');
  assert.equal(missing.error?.code, 'TRANSPORT_UNAVAILABLE');
  const waiting = describe({ ...base, phase: 'waiting-for-tag' });
  assert.equal(waiting.reader, 'Reader ready: ACS ACR1552 1S CL Reader PICC 0');
  assert.equal(waiting.title, 'Waiting for a tag');
  const seen = describe({ ...base, phase: 'tag-seen', uid: 'E002000000000001' });
  assert.equal(seen.title, 'Tag seen');
  assert.equal(seen.uid, 'E002000000000001');
  assert.equal(seen.detail, 'Choose the product code and press Write.');
  assert.equal(describe({ ...base, phase: 'writing', uid: 'E002000000000001', code: 'ps', blendName: 'Persian Sunrise' }).title, 'Writing ps (Persian Sunrise)');
  const written = describe({ ...base, phase: 'written', uid: 'E002000000000001', code: 'ps', blendName: 'Persian Sunrise', url: 'https://treveanspice.com/t/ps' });
  assert.equal(written.title, 'Written and verified');
  assert.match(written.detail, /reads back https:\/\/treveanspice\.com\/t\/ps/);
  const failed = describe({ ...base, phase: 'error', uid: 'E002000000000003', error: { code: 'WRITE_FAILED', message: 'The tag refused the write.', remedy: 'Retry.' } });
  assert.equal(failed.title, 'The write did not finish');
  assert.equal(failed.error?.code, 'WRITE_FAILED');
  const again = describe({ ...base, phase: 'tag-seen', uid: 'E002000000000003', tagAlreadyAttempted: true, recent: [{ outcome: 'failed' }] });
  assert.match(again.detail, /just failed/);
});

/* -------------------------------------------------------------------------- */
/* House style for the files the house style test does not cover               */
/* -------------------------------------------------------------------------- */

test('the page and the launchers have no en dashes or em dashes', () => {
  const EN_DASH = String.fromCharCode(0x2013);
  const EM_DASH = String.fromCharCode(0x2014);
  const files = [join(STATIC_DIR, 'page.html'), join(STATIC_DIR, 'page.js')];
  for (const name of ['Start Tag Tool.cmd', 'start-tag-tool.command']) {
    const path = join(TAG_TOOL_FOLDER, name);
    if (existsSync(path)) files.push(path);
  }
  for (const path of files) {
    const text = readFileSync(path, 'utf8');
    assert.equal(text.includes(EN_DASH) || text.includes(EM_DASH), false, path);
  }
});

test('the Windows launcher finds everything relative to itself and stops to explain any failure', () => {
  const path = join(TAG_TOOL_FOLDER, 'Start Tag Tool.cmd');
  assert.ok(existsSync(path), 'Start Tag Tool.cmd sits at the tag tool folder level, beside build');
  const raw = readFileSync(path, 'utf8');
  assert.ok(raw.split('\n').slice(0, -1).every((line) => line.endsWith('\r')), 'a .cmd file needs Windows line endings');
  assert.match(raw, /%~dp0build\\chip-cli/);
  assert.match(raw, /call npm ci/);
  assert.match(raw, /call npm run build/);
  assert.match(raw, /node bin\\tag-tool\.mjs/);
  assert.match(raw, /nodejs\.org/);
  assert.match(raw, /pause/);
  assert.doesNotMatch(raw, /protect|password/i);

  const mac = join(TAG_TOOL_FOLDER, 'start-tag-tool.command');
  assert.ok(existsSync(mac));
  const macText = readFileSync(mac, 'utf8');
  assert.doesNotMatch(macText, /\r/);
  assert.match(macText, /dirname "\$0"/);
  assert.match(macText, /node bin\/tag-tool\.mjs/);
  assert.doesNotMatch(macText, /protect|password/i);
});
