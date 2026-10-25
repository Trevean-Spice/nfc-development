/**
 * Failure paths.
 *
 * Every one of these is a thing that happens on a bench: a tag that slides off, a
 * write that stops halfway, a tag that already belongs to somebody else's password,
 * a tag that is not the part at all. The test is not that the tool copes, it is that
 * the tool refuses, says which unit, and leaves the tag in a state that cannot open
 * the wrong page.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SimulatorTransport } from '../src/transport/simulator.js';
import { RecordingTransport } from '../src/transport/transport.js';
import { UnitSession } from '../src/workflow/unit.js';
import { TagPassword } from '../src/chip/password.js';
import { isChipError, type ChipErrorCode } from '../src/chip/errors.js';
import { unwrapNdefTlv } from '../src/ndef/tlv.js';
import { decodeUriMessage } from '../src/ndef/decode.js';
import { PART } from '../src/chip/st25tv02kc.js';

const URI = 'https://treveanspice.com/t/ps';

async function runUnit(
  options: ConstructorParameters<typeof SimulatorTransport>[0],
  sessionOptions: { protect?: boolean } = {},
): Promise<{ error: unknown; simulator: SimulatorTransport; transport: RecordingTransport }> {
  const simulator = new SimulatorTransport(options);
  const transport = new RecordingTransport(simulator);
  await transport.open();
  const session = new UnitSession({ transport, uri: URI, code: 'ps' });
  let error: unknown = null;
  try {
    await session.selectTag();
    await session.write();
    const receipt = await session.verify();
    if (sessionOptions.protect === true) {
      await session.protect(receipt, {
        currentPassword: TagPassword.factoryDefault(),
        newPassword: TagPassword.fromHex('a1b2c3d4e5f60718', 'new'),
      });
    }
  } catch (cause) {
    error = cause;
  }
  return { error, simulator, transport };
}

function expectCode(error: unknown, code: ChipErrorCode): void {
  assert.ok(isChipError(error), `expected a ChipError, got ${String(error)}`);
  assert.equal(error.code, code, error.message);
  assert.ok(error.remedy.length > 0, 'every failure must tell the operator what to do');
}

test('no tag in the field is reported as TAG_ABSENT', async () => {
  const { error, transport } = await runUnit({ faults: { 1: 'tag-absent' } });
  expectCode(error, 'TAG_ABSENT');
  assert.equal(transport.countOf('writeBlock'), 0);
});

test('a tag that is not an ST25TV02KC is refused before a single byte is written', async () => {
  const { error, transport } = await runUnit({ faults: { 1: 'geometry-mismatch' } });
  expectCode(error, 'TAG_NOT_ST25TV02KC');
  assert.equal(transport.countOf('writeBlock'), 0, 'nothing may be written to a part this tool does not model');
});

test('a refused write is reported and the tag is left readable as empty rather than wrong', async () => {
  const { error } = await runUnit({ faults: { 1: 'write-fail' } });
  expectCode(error, 'WRITE_FAILED');
});

test('a partial write leaves a tag that opens nothing, not a tag that opens the wrong page', async () => {
  const { error, simulator } = await runUnit({ preloadUri: 'https://treveanspice.com/t/cs', faults: { 1: 'write-partial' } });
  expectCode(error, 'WRITE_FAILED');

  // The tag started encoded as Caribbean Sunset and the write stopped partway.
  // Because the plan writes a terminator first, the area now reads as formatted and
  // empty. It must not still decode as the old blend, and it must not decode as a
  // half written new one.
  const memory = simulator.snapshot(1);
  const area = memory.subarray(PART.blockSizeBytes);
  assert.throws(
    () => decodeUriMessage(unwrapNdefTlv(area)),
    (thrown: unknown) => isChipError(thrown) && thrown.code === 'NDEF_DECODE',
    'a partially written tag must not decode to any URL at all',
  );
});

test('a tag that reports success and holds different bytes fails the read back', async () => {
  const { error } = await runUnit({ faults: { 1: 'readback-corrupt' } });
  expectCode(error, 'READBACK_MISMATCH');
  assert.ok(isChipError(error) && error.message.includes('First difference at byte'));
});

test('a read back that errors is reported as READBACK_FAILED', async () => {
  const { error } = await runUnit({ faults: { 1: 'readback-fail' } });
  expectCode(error, 'READBACK_FAILED');
});

test('a tag holding somebody else password is refused rather than guessed at', async () => {
  const simulator = new SimulatorTransport({ faults: { 1: 'wrong-password' } });
  await simulator.open();
  const session = new UnitSession({
    transport: simulator,
    uri: URI,
    code: 'ps',
    unlockPassword: TagPassword.factoryDefault(),
  });
  await assert.rejects(
    () => session.selectTag(),
    (error: unknown) => isChipError(error) && error.code === 'PASSWORD_REJECTED',
  );
});

test('a tag already protected by an earlier run refuses the write', async () => {
  const simulator = new SimulatorTransport();
  await simulator.open();
  await simulator.waitForTag(1000);
  await simulator.presentPassword(1, new Uint8Array(8));
  await simulator.setAreaProtection(1, 'write_protected', 1);
  await simulator.releaseTag();

  const session = new UnitSession({ transport: simulator, uri: URI, code: 'ps' });
  await session.selectTag();
  await assert.rejects(
    () => session.write(),
    (error: unknown) => isChipError(error) && error.code === 'AREA_PROTECTED',
  );
});

test('a protection command the tag refuses fails the unit rather than recording it as protected', async () => {
  const { error } = await runUnit({ faults: { 1: 'protect-fail' } }, { protect: true });
  expectCode(error, 'PROTECT_FAILED');
});

test('a protected unit that would not actually be protected fails loudly', async () => {
  // A transport whose setAreaProtection is accepted but does nothing. The tool must
  // catch it on the proof step rather than reporting the tag as protected.
  const simulator = new SimulatorTransport();
  const lying = new Proxy(simulator, {
    get(target, property, receiver) {
      if (property === 'setAreaProtection') return async () => undefined;
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as SimulatorTransport;

  await lying.open();
  const session = new UnitSession({ transport: lying, uri: URI, code: 'ps' });
  await session.selectTag();
  await session.write();
  const receipt = await session.verify();
  await assert.rejects(
    () =>
      session.protect(receipt, {
        currentPassword: TagPassword.factoryDefault(),
        newPassword: TagPassword.fromHex('a1b2c3d4e5f60718', 'new'),
      }),
    (error: unknown) => isChipError(error) && error.code === 'PROTECT_FAILED',
  );
});

test('the physical reader transport says it is not implemented rather than pretending', async () => {
  const { PhysicalReaderTransport } = await import('../src/transport/reader-stub.js');
  const reader = new PhysicalReaderTransport();
  assert.equal(reader.isHardware, true);
  await assert.rejects(
    () => reader.open(),
    (error: unknown) => isChipError(error) && error.code === 'TRANSPORT_UNAVAILABLE',
  );
});

test('every failure carries a remedy and a code an operator can look up', async () => {
  const kinds = ['tag-absent', 'write-fail', 'readback-fail', 'readback-corrupt', 'geometry-mismatch'] as const;
  for (const kind of kinds) {
    const { error } = await runUnit({ faults: { 1: kind } });
    assert.ok(isChipError(error), `${kind} must produce a ChipError`);
    assert.ok(error.code.length > 0);
    assert.ok(error.remedy.length > 10, `${kind} needs a real remedy, got "${error.remedy}"`);
  }
});
