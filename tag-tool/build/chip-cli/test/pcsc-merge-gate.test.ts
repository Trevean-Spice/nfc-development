/**
 * Where the TAG_ABSENT work (connect to a PRESENT|MUTE tag, doctor's inspectTag) meets
 * the D66 gate of the lock path. Neither may weaken the other: a tag reached by the
 * mute connect is selected like any other and carries no proof, any later selection
 * wipes a proof, and doctor's look at the tag is a selection too.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { PcscTransport, READER_STATE_FLAGS } from '../src/transport/pcsc.js';
import { isChipError } from '../src/chip/errors.js';
import { ST_COMMANDS } from '../src/chip/st-custom.js';
import { ACR1552U, FakeBinding, FakeReader, FakeTag, OTHER_UID_LSB_FIRST, carriesSt } from './fake-acr1552u.js';

const { PRESENT, MUTE, CHANGED } = READER_STATE_FLAGS;
const B1 = ST_COMMANDS.WRITE_PASSWORD.code;
const A1 = ST_COMMANDS.WRITE_CONFIGURATION.code;
const NEW = Uint8Array.from([0x0a, 0x1b, 0x2c, 0x3d, 0x4e, 0x5f, 0x60, 0x71]);

async function openMute(tag = new FakeTag()): Promise<{ reader: FakeReader; transport: PcscTransport }> {
  const reader = new FakeReader(ACR1552U, tag);
  reader.raw = PRESENT | MUTE | CHANGED;
  const transport = new PcscTransport(undefined, { loadBinding: async () => new FakeBinding([reader]), readerTimeoutMs: 50, muteGraceMs: 10 });
  await transport.open();
  return { reader, transport };
}

function gateHeld(reason: RegExp) {
  return (error: unknown) => {
    assert.ok(isChipError(error));
    assert.equal(error.code, 'PROTECT_FAILED');
    assert.match(error.message, /^Refusing to /);
    assert.match(error.message, reason);
    assert.match(error.message, /This command was not sent\.$/);
    return true;
  };
}

const irreversible = (tag: FakeTag) => tag.sent.filter((a) => carriesSt(a, B1) || carriesSt(a, A1));

test('a tag reached by the mute connect carries no proof: both irreversible commands are refused before the probe', async () => {
  const { reader, transport } = await openMute();
  const identity = await transport.waitForTag(2_000);
  assert.equal(identity.uid, 'e002112233445566');
  assert.equal(reader.connects, 1);
  await assert.rejects(() => transport.writePassword(1, NEW), gateHeld(/has not been proven on this tag/));
  await assert.rejects(() => transport.setAreaProtection(1, 'write_protected', 1), gateHeld(/has not been proven on this tag/));
  assert.deepEqual(irreversible(reader.tag), []);
  assert.equal(transport.irreversibleFramesSent, 0);
  await transport.close();
});

test('a probe passed on a mute-connected tag does not survive a release and a second mute connect of the same tag', async () => {
  const { reader, transport } = await openMute();
  await transport.waitForTag(2_000);
  assert.equal((await transport.verifyOpcodes()).proven, true);
  await transport.presentPassword(1, new Uint8Array(8));
  await transport.releaseTag();

  const again = await transport.waitForTag(2_000);
  assert.equal(again.uid, 'e002112233445566', 'the same UID, and still no proof');
  assert.equal(reader.connects, 2);
  await assert.rejects(() => transport.writePassword(1, NEW), gateHeld(/has not been proven on this tag/));
  assert.deepEqual(irreversible(reader.tag), []);
  await transport.close();
});

test('a reselect while the connection is held, after the tag went mute, also wipes the proof', async () => {
  const { reader, transport } = await openMute();
  await transport.waitForTag(2_000);
  assert.equal((await transport.verifyOpcodes()).proven, true);
  await transport.presentPassword(1, new Uint8Array(8));

  // The connection is reused, so no second connect: the proof still goes.
  await transport.waitForTag(2_000);
  assert.equal(reader.connects, 1);
  await assert.rejects(() => transport.writePassword(1, NEW), gateHeld(/has not been proven on this tag/));
  assert.deepEqual(irreversible(reader.tag), []);
  await transport.close();
});

test('a mute connect that finds another tag cannot use the proof of the first', async () => {
  const { reader, transport } = await openMute();
  await transport.waitForTag(2_000);
  assert.equal((await transport.verifyOpcodes()).proven, true);
  await transport.presentPassword(1, new Uint8Array(8));
  await transport.releaseTag();

  const other = new FakeTag();
  other.uidLsbFirst = OTHER_UID_LSB_FIRST;
  reader.tag = other;
  const identity = await transport.waitForTag(2_000);
  assert.equal(identity.uid, 'e002112233778899');
  await assert.rejects(() => transport.writePassword(1, NEW), gateHeld(/has not been proven on this tag/));
  assert.deepEqual(irreversible(other), []);
  await transport.close();
});

test('doctor\'s inspectTag is a selection: it ends a proof and drops the held connection', async () => {
  const reader = new FakeReader(ACR1552U);
  const transport = new PcscTransport(undefined, { loadBinding: async () => new FakeBinding([reader]), readerTimeoutMs: 50 });
  await transport.open();
  await transport.waitForTag(200);
  assert.equal((await transport.verifyOpcodes()).proven, true);
  await transport.presentPassword(1, new Uint8Array(8));
  const disconnectsBefore = reader.tag.disconnects;

  const seen = await transport.inspectTag(200);
  assert.equal(seen.selected, true);
  assert.equal(reader.tag.disconnects, disconnectsBefore + 2, 'the held connection, then inspectTag\'s own');

  await assert.rejects(() => transport.writePassword(1, NEW), gateHeld(/has not been proven on this tag/));
  await assert.rejects(() => transport.setAreaProtection(1, 'write_protected', 1), gateHeld(/has not been proven on this tag/));
  assert.deepEqual(irreversible(reader.tag), []);
  await transport.close();
});
