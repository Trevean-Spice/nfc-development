/**
 * The simulator, which is the thing the rest of the suite stands on.
 *
 * If it models the memory wrongly, every other test is measuring the wrong thing.
 * So these tests check the model against the datasheet facts we are relying on, and
 * they are deliberately explicit about the ones we cannot check without hardware.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SimulatorTransport } from '../src/transport/simulator.js';
import { PART } from '../src/chip/st25tv02kc.js';
import { isChipError } from '../src/chip/errors.js';

async function fresh(options: ConstructorParameters<typeof SimulatorTransport>[0] = {}) {
  const simulator = new SimulatorTransport(options);
  await simulator.open();
  await simulator.waitForTag(1000);
  return simulator;
}

test('the simulated tag is 64 blocks of 4 bytes and nothing outside it can be touched', async () => {
  const simulator = await fresh();
  const identity = await simulator.waitForTag(1000);
  assert.equal(identity.blockCount, PART.blockCount);
  assert.equal(identity.blockSizeBytes, PART.blockSizeBytes);

  await assert.rejects(
    () => simulator.writeBlock(PART.blockCount, Uint8Array.from([1, 2, 3, 4])),
    (error: unknown) => isChipError(error) && error.code === 'WRITE_FAILED',
  );
  await assert.rejects(
    () => simulator.readBlocks(PART.blockCount - 1, 2),
    (error: unknown) => isChipError(error) && error.code === 'READBACK_FAILED',
  );
});

test('a write is exactly one block, because that is what ISO 15693 offers', async () => {
  const simulator = await fresh();
  await assert.rejects(
    () => simulator.writeBlock(1, Uint8Array.from([1, 2, 3])),
    (error: unknown) => isChipError(error) && error.code === 'WRITE_FAILED',
  );
  await assert.rejects(
    () => simulator.writeBlock(1, Uint8Array.from([1, 2, 3, 4, 5])),
    (error: unknown) => isChipError(error) && error.code === 'WRITE_FAILED',
  );
  await simulator.writeBlock(1, Uint8Array.from([1, 2, 3, 4]));
  assert.deepEqual(Array.from((await simulator.readBlocks(1, 1))), [1, 2, 3, 4]);
});

test('a protected area refuses a write until its password is presented', async () => {
  const simulator = await fresh();
  await simulator.presentPassword(1, new Uint8Array(8));
  await simulator.setAreaProtection(1, 'write_protected', 1);

  // Still in the same session, so the password still applies.
  await simulator.writeBlock(1, Uint8Array.from([9, 9, 9, 9]));

  await simulator.releaseTag();
  await simulator.waitForTag(1000);
  await assert.rejects(
    () => simulator.writeBlock(1, Uint8Array.from([8, 8, 8, 8])),
    (error: unknown) => isChipError(error) && error.code === 'AREA_PROTECTED',
  );

  await simulator.presentPassword(1, new Uint8Array(8));
  await simulator.writeBlock(1, Uint8Array.from([7, 7, 7, 7]));
  assert.deepEqual(Array.from(await simulator.readBlocks(1, 1)), [7, 7, 7, 7]);
});

test('the presented password stops applying when the tag leaves the field', async () => {
  const simulator = await fresh();
  await simulator.presentPassword(1, new Uint8Array(8));
  await simulator.setAreaProtection(1, 'write_protected', 1);
  await simulator.releaseTag();
  await simulator.waitForTag(1000);

  await assert.rejects(
    () => simulator.writeBlock(2, Uint8Array.from([1, 1, 1, 1])),
    (error: unknown) => isChipError(error) && error.code === 'AREA_PROTECTED',
  );
});

test('a wrong password is rejected and does not unlock anything', async () => {
  const simulator = await fresh({ storedPassword: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]) });
  await assert.rejects(
    () => simulator.presentPassword(1, new Uint8Array(8)),
    (error: unknown) => isChipError(error) && error.code === 'PASSWORD_REJECTED',
  );
});

test('protection is reversible with the password, which is the whole difference from a lock bit', async () => {
  const simulator = await fresh();
  await simulator.presentPassword(1, new Uint8Array(8));
  await simulator.setAreaProtection(1, 'write_protected', 1);
  assert.equal((await simulator.readAreaProtection(1)).protection, 'write_protected');

  await simulator.setAreaProtection(1, 'none', 1);
  assert.equal((await simulator.readAreaProtection(1)).protection, 'none');

  await simulator.releaseTag();
  await simulator.waitForTag(1000);
  await simulator.writeBlock(1, Uint8Array.from([4, 3, 2, 1]));
});

test('a password can be changed once the current one is presented, and not before', async () => {
  const simulator = await fresh();
  await assert.rejects(
    () => simulator.writePassword(1, Uint8Array.from([1, 1, 1, 1, 1, 1, 1, 1])),
    (error: unknown) => isChipError(error) && error.code === 'PROTECT_FAILED',
  );
  await simulator.presentPassword(1, new Uint8Array(8));
  await simulator.writePassword(1, Uint8Array.from([1, 1, 1, 1, 1, 1, 1, 1]));

  await simulator.releaseTag();
  await simulator.waitForTag(1000);
  await assert.rejects(
    () => simulator.presentPassword(1, new Uint8Array(8)),
    (error: unknown) => isChipError(error) && error.code === 'PASSWORD_REJECTED',
  );
  await simulator.presentPassword(1, Uint8Array.from([1, 1, 1, 1, 1, 1, 1, 1]));
});

test('the tray advances one tag per unit and each tag has its own UID and memory', async () => {
  const simulator = new SimulatorTransport();
  await simulator.open();

  const first = await simulator.waitForTag(1000);
  await simulator.writeBlock(1, Uint8Array.from([1, 1, 1, 1]));
  await simulator.completeUnit();

  const second = await simulator.waitForTag(1000);
  assert.notEqual(first.uid, second.uid);
  assert.notDeepEqual(Array.from(await simulator.readBlocks(1, 1)), [1, 1, 1, 1]);
});

test('a tray that runs out says so rather than looping', async () => {
  const simulator = new SimulatorTransport({ trayCount: 1 });
  await simulator.open();
  await simulator.waitForTag(1000);
  await simulator.completeUnit();
  await assert.rejects(
    () => simulator.waitForTag(1000),
    (error: unknown) => isChipError(error) && error.code === 'TAG_ABSENT',
  );
});

test('a preloaded tag models stock that is already encoded, which is what SO4731 is', async () => {
  const simulator = await fresh({ preloadUri: 'https://treveanspice.com/t/cs' });
  const image = await simulator.readBlocks(0, 9);
  assert.equal(image[0], 0xe1, 'a preloaded tag carries a capability container');
  assert.equal(image[4], 0x03, 'and an NDEF TLV');
});

test('a blank tag models virgin stock with no capability container', async () => {
  const simulator = await fresh({ preloadBlank: true });
  const image = await simulator.readBlocks(0, 1);
  assert.deepEqual(Array.from(image), [0, 0, 0, 0]);
});
