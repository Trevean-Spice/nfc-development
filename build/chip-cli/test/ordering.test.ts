/**
 * Write, read back, verify, then protect. Enforced, not documented.
 *
 * A wrong lock is not recoverable the way a wrong write is, so these tests assert
 * two separate things every time: that the tool refuses, and that no protection
 * command reached the tag.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SimulatorTransport } from '../src/transport/simulator.js';
import { RecordingTransport, type TagTransport } from '../src/transport/transport.js';
import { UnitSession, type VerificationReceipt } from '../src/workflow/unit.js';
import { TagPassword } from '../src/chip/password.js';
import { isChipError } from '../src/chip/errors.js';

const URI = 'https://treveanspice.com/t/ps';

function passwords() {
  return {
    currentPassword: TagPassword.factoryDefault(),
    newPassword: TagPassword.fromHex('a1b2c3d4e5f60718', 'new'),
  };
}

async function newSession(options: { faults?: Record<number, never> } = {}) {
  const simulator = new SimulatorTransport(options as ConstructorParameters<typeof SimulatorTransport>[0]);
  const transport = new RecordingTransport(simulator);
  await transport.open();
  const session = new UnitSession({ transport, uri: URI, code: 'ps' });
  return { simulator, transport, session };
}

test('protect before anything else is refused and no protection command is sent', async () => {
  const { transport, session } = await newSession();
  await assert.rejects(
    () => session.protect({} as unknown as VerificationReceipt, passwords()),
    (error: unknown) => isChipError(error) && error.code === 'PROTECT_BEFORE_VERIFY',
  );
  assert.equal(transport.countOf('setAreaProtection'), 0);
  assert.equal(transport.countOf('writePassword'), 0);
});

test('protect after writing but before verifying is refused and no protection command is sent', async () => {
  const { transport, session } = await newSession();
  await session.selectTag();
  await session.write();
  assert.equal(session.phase, 'written');

  await assert.rejects(
    () => session.protect({} as unknown as VerificationReceipt, passwords()),
    (error: unknown) => isChipError(error) && error.code === 'PROTECT_BEFORE_VERIFY',
  );
  assert.equal(transport.countOf('setAreaProtection'), 0);
});

test('verify before write is refused', async () => {
  const { session } = await newSession();
  await session.selectTag();
  await assert.rejects(
    () => session.verify(),
    (error: unknown) => isChipError(error) && error.code === 'USAGE',
  );
});

test('write before selecting a tag is refused', async () => {
  const { transport, session } = await newSession();
  await assert.rejects(
    () => session.write(),
    (error: unknown) => isChipError(error) && error.code === 'USAGE',
  );
  assert.equal(transport.countOf('writeBlock'), 0);
});

test('the happy path runs in the required order and reaches the protected phase', async () => {
  const { transport, session } = await newSession();
  await session.selectTag();
  await session.write();
  const receipt = await session.verify();
  const outcome = await session.protect(receipt, passwords());

  assert.equal(session.phase, 'protected');
  assert.equal(outcome.applied, true);
  assert.equal(outcome.refusalProven, true, 'a write must have been attempted after protection and refused');

  const sequence = transport.methodSequence();
  const firstWrite = sequence.indexOf('writeBlock');
  const firstReadAfterWrite = sequence.indexOf('readBlocks', firstWrite);
  const protectAt = sequence.indexOf('setAreaProtection');

  assert.ok(firstWrite >= 0 && firstReadAfterWrite > firstWrite, 'a read back must follow the write');
  assert.ok(protectAt > firstReadAfterWrite, 'protection must follow the read back');
});

test('a receipt from another session cannot protect this one', async () => {
  const a = await newSession();
  await a.session.selectTag();
  await a.session.write();
  const receiptA = await a.session.verify();

  const b = await newSession();
  await b.session.selectTag();
  await b.session.write();
  await b.session.verify();

  await assert.rejects(
    () => b.session.protect(receiptA, passwords()),
    (error: unknown) => isChipError(error) && error.code === 'RECEIPT_INVALID',
  );
  assert.equal(b.transport.countOf('setAreaProtection'), 0);
});

test('a fabricated receipt cannot protect, even one carrying the right URI', async () => {
  const { transport, session } = await newSession();
  await session.selectTag();
  await session.write();
  const real = await session.verify();

  const forged = {
    intendedUri: real.intendedUri,
    expectedImageHex: real.expectedImageHex,
    readBackHex: real.readBackHex,
    decodedUri: real.decodedUri,
    digest: real.digest,
    verifiedAt: real.verifiedAt,
    powerCycled: false,
  } as unknown as VerificationReceipt;

  await assert.rejects(
    () => session.protect(forged, passwords()),
    (error: unknown) => isChipError(error) && error.code === 'RECEIPT_INVALID',
  );
  assert.equal(transport.countOf('setAreaProtection'), 0);
});

test('a failed verification leaves the session unable to protect', async () => {
  const simulator = new SimulatorTransport({ faults: { 1: 'readback-corrupt' } });
  const transport = new RecordingTransport(simulator);
  await transport.open();
  const session = new UnitSession({ transport, uri: URI, code: 'ps' });

  await session.selectTag();
  await session.write();
  await assert.rejects(
    () => session.verify(),
    (error: unknown) => isChipError(error) && error.code === 'READBACK_MISMATCH',
  );
  assert.equal(session.phase, 'failed');

  await assert.rejects(
    () => session.protect({} as unknown as VerificationReceipt, passwords()),
    (error: unknown) => isChipError(error) && error.code === 'PROTECT_BEFORE_VERIFY',
  );
  assert.equal(transport.countOf('setAreaProtection'), 0, 'nothing may be locked around a tag that failed verification');
});

test('a tag written with one code cannot be verified against another', async () => {
  const simulator = new SimulatorTransport();
  await simulator.open();
  const session = new UnitSession({ transport: simulator, uri: URI, code: 'ps' });
  await session.selectTag();
  await session.write();
  await session.verify();
  await simulator.releaseTag();

  // Same physical tag, now checked against the Caribbean Sunset URL.
  const wrong = new UnitSession({ transport: simulator, uri: 'https://treveanspice.com/t/cs', code: 'cs' });
  await wrong.selectTag();
  const readBack = await simulator.readBlocks(0, 9);
  assert.ok(readBack.length > 0);
  // Verifying without writing is refused by the phase machine, which is the point:
  // there is no route to a receipt that does not go through a write and a read back.
  await assert.rejects(
    () => wrong.verify(),
    (error: unknown) => isChipError(error) && error.code === 'USAGE',
  );
});

test('verifying after a power cycle drops the tag out of the field before reading it back', async () => {
  const simulator = new SimulatorTransport();
  const transport = new RecordingTransport(simulator);
  await transport.open();
  const session = new UnitSession({ transport, uri: URI, code: 'ps', verifyAfterPowerCycle: true });

  await session.selectTag();
  await session.write();
  const receipt = await session.verify();

  assert.equal(receipt.powerCycled, true);
  const sequence = transport.methodSequence();
  const lastWrite = sequence.lastIndexOf('writeBlock');
  const release = sequence.indexOf('releaseTag', lastWrite);
  const reselect = sequence.indexOf('waitForTag', release);
  const read = sequence.indexOf('readBlocks', reselect);
  assert.ok(release > lastWrite, 'the tag must leave the field after the write');
  assert.ok(reselect > release, 'and be selected again');
  assert.ok(read > reselect, 'before the read back');
});

test('protection is proven by a refused write, not by the command being accepted', async () => {
  const simulator = new SimulatorTransport();
  await simulator.open();
  const session = new UnitSession({ transport: simulator, uri: URI, code: 'ps' });
  await session.selectTag();
  await session.write();
  const receipt = await session.verify();
  await session.protect(receipt, passwords());

  // A fresh session with no password presented must not be able to write.
  await simulator.releaseTag();
  await simulator.waitForTag(1000);
  await assert.rejects(
    () => simulator.writeBlock(1, Uint8Array.from([0, 0, 0, 0])),
    (error: unknown) => isChipError(error) && error.code === 'AREA_PROTECTED',
  );
});

/**
 * Identity continuity. Mechanisms 1 and 2 above prove the session is self
 * consistent; neither of them touches the tag. These two hold the third property:
 * the silicon protect() commits to has to be the silicon verify() read.
 */

/** Two independent tags on one reader, with a swap the tool is never told about. */
class SwappableReader implements TagTransport {
  readonly name = 'pcsc';
  readonly isHardware = true;
  #active: SimulatorTransport;
  constructor(
    private readonly first: SimulatorTransport,
    private readonly second: SimulatorTransport,
  ) {
    this.#active = first;
  }
  swap(): void {
    this.#active = this.second;
  }
  async open(): Promise<void> {
    await this.first.open();
    await this.second.open();
  }
  async close(): Promise<void> {
    await this.first.close();
    await this.second.close();
  }
  waitForTag(timeoutMs: number) {
    return this.#active.waitForTag(timeoutMs);
  }
  readBlocks(firstBlock: number, count: number) {
    return this.#active.readBlocks(firstBlock, count);
  }
  writeBlock(block: number, data: Uint8Array) {
    return this.#active.writeBlock(block, data);
  }
  presentPassword(n: number, password: Uint8Array) {
    return this.#active.presentPassword(n, password);
  }
  writePassword(n: number, password: Uint8Array) {
    return this.#active.writePassword(n, password);
  }
  setAreaProtection(area: number, protection: Parameters<TagTransport['setAreaProtection']>[1], n: number) {
    return this.#active.setAreaProtection(area, protection, n);
  }
  readAreaProtection(area: number) {
    return this.#active.readAreaProtection(area);
  }
  releaseTag() {
    return this.#active.releaseTag();
  }
  completeUnit() {
    return this.#active.completeUnit();
  }
}

test('a tag swapped in after verification is never protected', async () => {
  // Tag A is written and verified with the Persian Sunrise URL. Tag B is a
  // Caribbean Sunset tag that ends up on the reader before the protect step,
  // which at pack out is one hand movement. Nothing may be locked on either.
  const tagA = new SimulatorTransport();
  const tagB = new SimulatorTransport({ preloadUri: 'https://treveanspice.com/t/cs' });
  const reader = new SwappableReader(tagA, tagB);
  const transport = new RecordingTransport(reader);
  await transport.open();

  const session = new UnitSession({ transport, uri: URI, code: 'ps' });
  await session.selectTag();
  await session.write();
  const receipt = await session.verify();

  await tagB.waitForTag(1000);
  reader.swap();

  await assert.rejects(
    () => session.protect(receipt, passwords()),
    (error: unknown) => isChipError(error) && error.code === 'PROTECT_FAILED',
  );

  assert.equal(transport.countOf('setAreaProtection'), 0, 'nothing may be locked around a tag that was not verified');
  assert.equal(transport.countOf('writePassword'), 0, 'and its password may not be changed either');
  assert.equal(tagB.protectionOf(1).protection, 'none');
  assert.equal(tagA.protectionOf(1).protection, 'none');
});

test('a tag swapped in during the protection proof is caught by its uid', async () => {
  // Both tags carry the same URL, so the content checks cannot tell them apart.
  // The UID is the only thing that can, and it is checked on every re-selection.
  const tagA = new SimulatorTransport();
  const tagB = new SimulatorTransport({ preloadUri: URI });
  const reader = new SwappableReader(tagA, tagB);
  await reader.open();
  // Advance tag B's tray so the two tags carry different UIDs, as two real tags do.
  await tagB.completeUnit();

  const session = new UnitSession({ transport: reader, uri: URI, code: 'ps' });
  const first = await session.selectTag();
  await session.write();
  const receipt = await session.verify();

  const originalRelease = tagA.releaseTag.bind(tagA);
  tagA.releaseTag = async () => {
    await originalRelease();
    await tagB.waitForTag(1000);
    reader.swap();
  };

  await assert.rejects(
    () => session.protect(receipt, passwords()),
    (error: unknown) => isChipError(error) && error.code === 'TAG_CHANGED',
  );
  assert.notEqual(first.uid, null);
  assert.equal(session.phase, 'failed');
});
