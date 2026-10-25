/**
 * The PC/SC transport, in the only way it can honestly be tested today.
 *
 * **These tests do not prove the transport works.** Nothing on a machine with no
 * reader can. What they prove is the part that is pure: that the APDUs it builds
 * are the bytes intended, that a UID is accepted or rejected for the right
 * reasons, and that the protection methods refuse rather than guess.
 *
 * The distinction matters enough to keep in the file rather than in a commit
 * message. README section 6.2 lists what only silicon can settle, and section 6.3
 * is the bring up that settles it. A green run here is not a substitute for
 * either, and no claim about hardware behaviour follows from it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PcscTransport,
  getUidApdu,
  isStMicroelectronics,
  normaliseUid,
  readBinaryApdu,
  updateBinaryApdu,
} from '../src/transport/pcsc.js';
import { isChipError } from '../src/chip/errors.js';
import { PART } from '../src/chip/st25tv02kc.js';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');

test('the UID command is the standard PC/SC Get Data, which ACS documents for FeliCa too', () => {
  assert.equal(hex(getUidApdu()), 'ff ca 00 00 00');
});

test('a single block read asks for exactly one block of bytes', () => {
  assert.equal(hex(readBinaryApdu(0, 1)), 'ff b0 00 00 04');
});

test('a multi block read asks for the whole span in one command', () => {
  // 62 blocks is the NDEF area. Asking for it in one read rather than 62 is the
  // difference between a tag that encodes in a second and one that takes a minute.
  assert.equal(hex(readBinaryApdu(1, 62)), 'ff b0 00 01 f8');
});

test('a block number above 255 goes in the high byte rather than overflowing silently', () => {
  // ST25TV02KC has 64 blocks so this cannot arise on this part. It is asserted because
  // the next ST25 part up has more, and an off by one that only appears on a bigger
  // chip is the kind that ships.
  assert.equal(hex(readBinaryApdu(300, 1)), 'ff b0 01 2c 04');
});

test('a block write carries the data and its length', () => {
  const data = Uint8Array.from([0xe1, 0x40, 0x07, 0x01]);
  assert.equal(hex(updateBinaryApdu(0, data)), 'ff d6 00 00 04 e1 40 07 01');
});

test('a UID that already begins 0xE0 is taken as is', () => {
  const uid = Uint8Array.from([0xe0, 0x02, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66]);
  const result = normaliseUid(uid);
  assert.ok(result);
  assert.equal(result.reversed, false);
  assert.equal(hex(result.uid), 'e0 02 11 22 33 44 55 66');
});

test('a UID that ends 0xE0 is reversed, because readers disagree about byte order', () => {
  const reversed = Uint8Array.from([0x66, 0x55, 0x44, 0x33, 0x22, 0x11, 0x02, 0xe0]);
  const result = normaliseUid(reversed);
  assert.ok(result);
  assert.equal(result.reversed, true);
  assert.equal(hex(result.uid), 'e0 02 11 22 33 44 55 66');
});

test('a UID with 0xE0 at neither end is refused rather than guessed at', () => {
  assert.equal(normaliseUid(Uint8Array.from([0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77])), null);
});

test('a UID of the wrong length is refused', () => {
  // An NTAG returns seven bytes. This is the most likely wrong tag to meet in practice,
  // because it is what almost every NFC tutorial online is about.
  assert.equal(normaliseUid(Uint8Array.from([0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66])), null);
  assert.equal(normaliseUid(new Uint8Array(0)), null);
});

test('manufacturer code 0x02 is STMicroelectronics and anything else is not', () => {
  assert.equal(isStMicroelectronics(Uint8Array.from([0xe0, 0x02, 0, 0, 0, 0, 0, 0])), true);
  // 0x04 is NXP. An ICODE SLIX is ISO 15693 and would otherwise pass every other check
  // in this file while having a different memory layout.
  assert.equal(isStMicroelectronics(Uint8Array.from([0xe0, 0x04, 0, 0, 0, 0, 0, 0])), false);
});

test('the part geometry the transport reports is the one the encoder assumes', () => {
  // Guards against the two constants drifting apart. If this fails, either the
  // datasheet model changed or somebody edited one of them alone.
  assert.equal(PART.blockCount * PART.blockSizeBytes, PART.totalBytes);
  assert.equal(PART.blockSizeBytes, 4);
});

/**
 * THE GATE. This is the guarantee that makes shipping secondary sourced opcodes
 * defensible, so it is tested rather than described.
 *
 * The two irreversible commands must refuse while the command path is unproven.
 * `verifyOpcodes` is the only thing that can clear them, it needs a physical tag,
 * and it cannot run here, so in this suite they must ALWAYS refuse.
 */
for (const [label, call] of [
  ['writePassword', (t: PcscTransport) => t.writePassword(1, new Uint8Array(8))],
  ['setAreaProtection', (t: PcscTransport) => t.setAreaProtection(1, 'write_protected', 1)],
] as const) {
  test(`${label} refuses while the opcodes are unproven`, async () => {
    const transport = new PcscTransport();
    await assert.rejects(
      () => call(transport),
      (error: unknown) => {
        assert.ok(isChipError(error), 'must be a ChipError so the CLI can render a remedy');
        assert.equal(error.code, 'PROTECT_FAILED');
        // The remedy must send the reader to the probe, not to a datasheet they
        // cannot download. That was the whole problem on 7 October 2026.
        assert.match(error.remedy, /probe/i);
        assert.match(error.remedy, /sacrificial/i);
        return true;
      },
    );
  });
}

test('a password that is not 64 bits is refused before anything reaches a tag', async () => {
  const transport = new PcscTransport();
  // Caller bug rather than a tag problem, and it must be caught on this side of
  // the air interface. A short password silently padded would be a password
  // nobody could reproduce.
  await assert.rejects(() => transport.presentPassword(1, new Uint8Array(4)), /8/);
  await assert.rejects(() => transport.writePassword(1, new Uint8Array(16)), /8/);
});

test('the transport declares itself hardware, which drives the honesty banner and the journal', () => {
  const transport = new PcscTransport();
  assert.equal(transport.isHardware, true);
  assert.equal(transport.name, 'pcsc');
});

test('reading before open fails as a caller bug rather than a tag fault', async () => {
  const transport = new PcscTransport();
  await assert.rejects(
    () => transport.readBlocks(0, 1),
    (error: unknown) => {
      assert.ok(isChipError(error));
      assert.equal(error.code, 'TRANSPORT_UNAVAILABLE');
      return true;
    },
  );
});

test('closing a transport that was never opened is safe', async () => {
  await new PcscTransport().close();
});
