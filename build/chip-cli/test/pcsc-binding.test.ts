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
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PCSC_BINDING_PACKAGE,
  PcscTransport,
  adaptPcscMini,
  isSamSlot,
  type PcscBinding,
  type PcscCardHandle,
  type PcscMiniModule,
  type PcscReaderHandle,
} from '../src/transport/pcsc.js';
import { isChipError } from '../src/chip/errors.js';
import { PART } from '../src/chip/st25tv02kc.js';
import { ST_COMMANDS } from '../src/chip/st-custom.js';
import { UnitSession } from '../src/workflow/unit.js';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
const OK = [0x90, 0x00];
const UID_LSB_FIRST = [0x66, 0x55, 0x44, 0x33, 0x22, 0x11, 0x02, 0xe0];
/** What an ACS transparent session control command answers: a status TLV, then 90 00. */
const SESSION_ANSWER = [0xc0, 0x03, 0x00, 0x90, 0x00, ...OK];

/**
 * DS13304 Rev 7, section 4.2: END_MEM is 4Fh on ST25TV02KC, so 80 blocks. Typed in
 * rather than taken from PART, so the fake tag is the datasheet's and a model that
 * drifts from it fails the probe here as it would on silicon.
 */
const ST25TV02KC_BLOCKS = 0x4f + 1;

/** A tag on a reader, answering the PC/SC storage card commands, and recording every APDU. */
class FakeTag {
  readonly memory: Uint8Array;
  readonly sent: string[] = [];
  disconnects = 0;
  /** What a transceived ST frame answers. Tests set it to make the probe pass or fail. */
  stAnswer: (frame: Uint8Array) => number[] = () => [0x97, 0x01, 0x00, ...OK];
  failTransmit = false;

  constructor(readonly blockCount: number = ST25TV02KC_BLOCKS) {
    this.memory = new Uint8Array(blockCount * 4);
  }

  handle(): PcscCardHandle {
    return {
      transmit: async (apdu) => {
        this.sent.push(hex(apdu));
        if (this.failTransmit) throw new Error('[ RemovedCard ] - Error in native function');
        return Uint8Array.from(this.answer(apdu));
      },
      disconnectUnpower: async () => {
        this.disconnects += 1;
      },
    };
  }

  private answer(apdu: Uint8Array): number[] {
    const [cla, ins, p1 = 0, p2 = 0, lc = 0] = apdu;
    if (cla !== 0xff) return [0x6e, 0x00];
    const block = (p1 << 8) | p2;
    if (ins === 0xca) return [...UID_LSB_FIRST, ...OK];
    if (ins === 0xb0) {
      const count = (lc === 0 ? 256 : lc) / PART.blockSizeBytes;
      if (block + count > this.blockCount) return [0x6a, 0x82];
      return [...this.memory.subarray(block * 4, (block + count) * 4), ...OK];
    }
    if (ins === 0xd6) {
      if (block >= this.blockCount) return [0x6a, 0x82];
      this.memory.set(apdu.subarray(5, 5 + lc), block * 4);
      return OK;
    }
    if (ins === 0xc2 && p2 === 0x01) return this.stAnswer(apdu.subarray(7));
    if (ins === 0xc2) return SESSION_ANSWER;
    return [0x6d, 0x00];
  }
}

class FakeReader implements PcscReaderHandle {
  present: boolean;
  connects = 0;
  constructor(
    readonly name: string,
    readonly tag: FakeTag = new FakeTag(),
    present = true,
  ) {
    this.present = present;
  }
  tagPresent(): boolean {
    return this.present;
  }
  async connect(): Promise<PcscCardHandle> {
    this.connects += 1;
    return this.tag.handle();
  }
}

class FakeBinding implements PcscBinding {
  stops = 0;
  constructor(
    private readonly readers: FakeReader[],
    private readonly startError?: Error,
  ) {}
  start(onReader: (reader: PcscReaderHandle) => void): void {
    if (this.startError) throw this.startError;
    for (const reader of this.readers) onReader(reader);
  }
  stop(): void {
    this.stops += 1;
  }
}

const ACR1552U = 'ACS ACR1552 1S CL Reader PICC 0';

async function openWith(readers: FakeReader[], filter?: string): Promise<{ transport: PcscTransport; binding: FakeBinding }> {
  const binding = new FakeBinding(readers);
  const transport = new PcscTransport(filter, { loadBinding: async () => binding, readerTimeoutMs: 50 });
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
/* THE GATE, on the wire. "Decision log", D66, and README section 6.4.       */
/* ------------------------------------------------------------------------ */

const WRITE_PASSWORD_BYTE = ST_COMMANDS.WRITE_PASSWORD.code.toString(16).padStart(2, '0');
const SET_PROTECTION_BYTE = ST_COMMANDS.SET_MEMORY_PROTECTION.code.toString(16).padStart(2, '0');
/** An ACS transceive APDU carrying an ST custom command: ff c2 00 01 len 95 len flags CODE 02 ... */
const carries = (apdu: string, code: string) => apdu.startsWith('ff c2 00 01') && apdu.split(' ')[8] === code;

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

test('the probe that unlocks the pair sends only Present Password, never either irreversible opcode', async () => {
  const reader = new FakeReader(ACR1552U);
  // The factory default (eight zero bytes) is accepted and anything else is refused.
  reader.tag.stAnswer = (frame) => (frame.subarray(4).every((b) => b === 0) ? [0x97, 0x01, 0x00, ...OK] : [0x97, 0x02, 0x01, 0x0f, ...OK]);
  const { transport } = await openWith([reader]);
  await transport.waitForTag(200);
  const probe = await transport.verifyOpcodes();
  assert.equal(probe.proven, true);
  assert.equal(reader.tag.sent.filter((a) => carries(a, WRITE_PASSWORD_BYTE) || carries(a, SET_PROTECTION_BYTE)).length, 0);
  await transport.close();
});

test('the unproven state is per transport: a new transport starts locked even after another proved the path', async () => {
  const reader = new FakeReader(ACR1552U);
  reader.tag.stAnswer = (frame) => (frame.subarray(4).every((b) => b === 0) ? [0x97, 0x01, 0x00, ...OK] : [0x97, 0x02, 0x01, 0x0f, ...OK]);
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
    CardDisposition: { UNPOWER: 2 },
    ReaderStatus: { PRESENT: STATUS.PRESENT, MUTE: STATUS.MUTE },
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
  assert.equal(seen[0]!.tagPresent(), true);
  raw.emit('change', { raw: STATUS.EMPTY });
  assert.equal(seen[0]!.tagPresent(), false);
});

test('the adapter treats a mute tag and an unplugged reader as no tag', () => {
  const fake = fakePcscMini();
  const binding = adaptPcscMini(fake.module);
  const seen: PcscReaderHandle[] = [];
  binding.start((r) => seen.push(r), () => undefined);
  const raw = fake.announce(ACR1552U, STATUS.PRESENT | STATUS.MUTE);
  assert.equal(seen[0]!.tagPresent(), false);
  raw.emit('change', { raw: STATUS.PRESENT });
  assert.equal(seen[0]!.tagPresent(), true);
  raw.emit('disconnect');
  assert.equal(seen[0]!.tagPresent(), false);
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
