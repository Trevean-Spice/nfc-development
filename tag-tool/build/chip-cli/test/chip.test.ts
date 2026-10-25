/**
 * The chip model: geometry, the 312 byte capacity limit, the capability container,
 * and the ordering of the write plan.
 *
 * The geometry figures below are typed in from the datasheet rather than read from
 * PART, so a model that drifts from DS13304 fails here instead of agreeing with itself.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CC_BLOCK,
  CC_MLEN,
  PART,
  T5T_AREA_BLOCK_COUNT,
  T5T_AREA_BYTES,
  T5T_AREA_FIRST_BLOCK,
  buildCapabilityContainer,
  buildWritePlan,
  evaluateCc,
} from '../src/chip/st25tv02kc.js';
import { encodeUriRecord } from '../src/ndef/encode.js';
import { wrapNdefTlv } from '../src/ndef/tlv.js';
import { isChipError } from '../src/chip/errors.js';

/** DS13304 Rev 7, section 4.2: "Value of END_MEM is ... 4Fh for ... ST25TV02KC". */
const DATASHEET_END_MEM = 0x4f;
/** DS13304 Rev 7, page 1: "Up to 2560 bits (320 bytes) of EEPROM". */
const DATASHEET_USER_BITS = 2560;

test('the part is a 320 byte Type 5 tag in 80 blocks, as DS13304 states, not an NTAG', () => {
  assert.equal(PART.partNumber, 'ST25TV02KC');
  assert.equal(PART.nfcForumType, 5);
  assert.equal(PART.airInterface, 'ISO/IEC 15693');
  assert.equal(PART.totalBytes, DATASHEET_USER_BITS / 8);
  assert.equal(PART.totalBytes, 320);
  // AREA1 "is composed of (END_MEM+1) blocks" in single area mode, the factory default.
  assert.equal(PART.blockCount, DATASHEET_END_MEM + 1);
  assert.equal(PART.blockCount, 80);
  assert.notEqual(PART.blockCount, 64, 'the figure the tool carried before 25 October 2026, which refused every genuine tag');
  assert.equal(PART.blockSizeBytes, 4);
  assert.equal(PART.blockCount * PART.blockSizeBytes, PART.totalBytes);
  assert.equal(PART.passwordBits, 64);
  // 888 is NTAG216 user memory. If this ever equals 888 the wrong part is modelled.
  assert.notEqual(PART.totalBytes, 888);
});

test('the T5T area is 312 bytes in blocks 1 to 78, which is what the capability container declares', () => {
  assert.equal(CC_MLEN, 0x27);
  assert.equal(T5T_AREA_BYTES, 312);
  assert.equal(T5T_AREA_BYTES, CC_MLEN * 8);
  assert.equal(T5T_AREA_FIRST_BLOCK, 1);
  assert.equal(T5T_AREA_BLOCK_COUNT, 78);
  // The area sits wholly inside the part, after the container, and leaves block 79 alone.
  assert.equal(T5T_AREA_FIRST_BLOCK + T5T_AREA_BLOCK_COUNT - 1, DATASHEET_END_MEM - 1);
});

test('the capability container this tool writes is a valid Type 5 one', () => {
  const cc = buildCapabilityContainer();
  assert.equal(cc.length, 4);
  assert.equal(cc[0], 0xe1);
  assert.equal(cc[1], 0x40);
  assert.equal(cc[2], CC_MLEN);
  assert.equal(cc[3], 0x01, 'Read Multiple Block supported, which DS13304 page 1 lists');
  const assessment = evaluateCc(cc);
  assert.equal(assessment.valid, true);
  assert.equal(assessment.declaredAreaBytes, 312);
});

test('a container declaring the full 320 bytes is accepted, so it is preserved rather than rewritten', () => {
  // 0x28 is 320 / 8: the memory size byte for the whole part, block 0 included. A
  // formatting tool that counts the container in MLEN writes this, and on stock that
  // already works on phones the tool must keep it rather than replace it with its own.
  for (const cc of [
    [0xe1, 0x40, 0x28, 0x01],
    [0xe1, 0x40, 0x28, 0x00],
    [0xe1, 0x40, 0x27, 0x01],
  ]) {
    const assessment = evaluateCc(Uint8Array.from(cc));
    assert.equal(assessment.valid, true, `E1 40 ${cc[2]?.toString(16)} ${cc[3]?.toString(16)}`);
    const plan = planFor('https://treveanspice.com/t/ps', Uint8Array.from(cc));
    assert.equal(plan.ccAction, 'preserve');
    assert.ok(plan.steps.every((step) => step.block !== CC_BLOCK), 'block 0 must not be written');
    assert.deepEqual(Array.from(plan.capabilityContainer), cc);
  }
  assert.equal(evaluateCc(Uint8Array.from([0xe1, 0x40, 0x28, 0x01])).declaredAreaBytes, 320);
});

test('a container declaring more than 320 bytes describes a bigger part and is refused', () => {
  const assessment = evaluateCc(Uint8Array.from([0xe1, 0x40, 0x29, 0x01]));
  assert.equal(assessment.valid, false);
  assert.match(assessment.reason, /328 bytes, more than the 320/);
});

test('an unusable capability container is rejected with a reason', () => {
  assert.equal(evaluateCc(Uint8Array.from([0x00, 0x00, 0x00, 0x00])).valid, false);
  assert.equal(evaluateCc(Uint8Array.from([0xff, 0xff, 0xff, 0xff])).valid, false);
  assert.equal(evaluateCc(Uint8Array.from([0xe1, 0x40, 0x00, 0x01])).valid, false, 'zero length area');
  assert.equal(evaluateCc(Uint8Array.from([0xe1, 0x40, 0xff, 0x01])).valid, false, 'area larger than the part');
  assert.equal(evaluateCc(Uint8Array.from([0xe1, 0x00, 0x1f, 0x01])).valid, false, 'wrong mapping version');
  assert.equal(evaluateCc(Uint8Array.from([0xe1, 0x40, 0x1f])).valid, false, 'too short');
});

/* -------------------------------------------------------------------------- */
/* Capacity                                                                    */
/* -------------------------------------------------------------------------- */

/** The longest message that fits: area, less TLV type, three byte length and terminator. */
const MAX_MESSAGE = T5T_AREA_BYTES - 1 - 3 - 1;

test('a message that exactly fills the 312 byte area is accepted', () => {
  const tlv = wrapNdefTlv(new Uint8Array(MAX_MESSAGE), T5T_AREA_BYTES);
  assert.equal(tlv.usedBytes, T5T_AREA_BYTES);
  assert.equal(tlv.freeBytes, 0);
});

test('one byte more than the area holds is refused, with the numbers in the message', () => {
  assert.throws(
    () => wrapNdefTlv(new Uint8Array(MAX_MESSAGE + 1), T5T_AREA_BYTES),
    (error: unknown) =>
      isChipError(error) &&
      error.code === 'CAPACITY_EXCEEDED' &&
      error.message.includes('313') &&
      error.message.includes('312'),
  );
});

test('a full area writes blocks 1 to 78 and never block 79 or the container', () => {
  const plan = buildWritePlan({
    tlv: new Uint8Array(T5T_AREA_BYTES),
    existingCc: buildCapabilityContainer(),
    ccPolicy: 'preserve',
  });
  const blocks = new Set(plan.steps.map((step) => step.block));
  assert.equal(Math.min(...blocks), 1);
  assert.equal(Math.max(...blocks), 78);
  assert.equal(blocks.size, 78);
  assert.throws(
    () => buildWritePlan({ tlv: new Uint8Array(T5T_AREA_BYTES + 1), existingCc: null, ccPolicy: 'preserve' }),
    (error: unknown) => isChipError(error) && error.code === 'CAPACITY_EXCEEDED' && error.message.includes('312'),
  );
});

test('on the 320 byte part the binding URI limit is the 255 byte short record, not the area', () => {
  // A payload of 255 bytes is the longest short record, and it now fits the area with
  // room to spare, using the three byte TLV length form.
  const longest = `https://${'a'.repeat(254)}`;
  assert.equal(encodeUriRecord(longest).payload.length, 255);
  const tlv = wrapNdefTlv(encodeUriRecord(longest).message, T5T_AREA_BYTES);
  assert.equal(tlv.usedBytes, 1 + 3 + 4 + 255 + 1);
  assert.equal(tlv.bytes[1], 0xff, 'three byte length form');
  assert.throws(
    () => encodeUriRecord(`https://${'a'.repeat(255)}`),
    (error: unknown) => isChipError(error) && error.code === 'NDEF_ENCODE',
  );
});

test('a payload over the short record limit is refused by the encoder', () => {
  const uri = `https://${'a'.repeat(300)}`;
  assert.throws(
    () => encodeUriRecord(uri),
    (error: unknown) => isChipError(error) && error.code === 'NDEF_ENCODE',
  );
});

/* -------------------------------------------------------------------------- */
/* The write plan                                                              */
/* -------------------------------------------------------------------------- */

function planFor(uri: string, existingCc: Uint8Array | null) {
  const tlv = wrapNdefTlv(encodeUriRecord(uri).message, T5T_AREA_BYTES);
  return buildWritePlan({ tlv: tlv.bytes, existingCc, ccPolicy: 'preserve' });
}

test('the write plan invalidates the area first, so an interrupted write cannot leave a wrong URL', () => {
  const plan = planFor('https://treveanspice.com/t/ps', buildCapabilityContainer());
  const first = plan.steps[0];
  assert.ok(first !== undefined);
  assert.equal(first.purpose, 'invalidate');
  assert.equal(first.block, T5T_AREA_FIRST_BLOCK);
  assert.equal(first.data[0], 0xfe, 'a terminator TLV: the area reads as formatted and empty');
});

test('the write plan writes the TLV header last, so the record becomes readable in one block write', () => {
  const plan = planFor('https://treveanspice.com/t/ps', buildCapabilityContainer());
  const last = plan.steps[plan.steps.length - 1];
  assert.ok(last !== undefined);
  assert.equal(last.purpose, 'tlv-header');
  assert.equal(last.block, T5T_AREA_FIRST_BLOCK);
  assert.equal(last.data[0], 0x03, 'the NDEF TLV type byte');
});

test('a valid capability container on the tag is preserved rather than overwritten', () => {
  const plan = planFor('https://treveanspice.com/t/ps', buildCapabilityContainer());
  assert.equal(plan.ccAction, 'preserve');
  assert.equal(
    plan.steps.filter((s) => s.purpose === 'capability-container').length,
    0,
    'nothing should be written to block 0',
  );
});

test('an unformatted tag gets a capability container, written last', () => {
  const plan = planFor('https://treveanspice.com/t/ps', new Uint8Array(4));
  assert.equal(plan.ccAction, 'write');
  const last = plan.steps[plan.steps.length - 1];
  assert.ok(last !== undefined);
  assert.equal(last.purpose, 'capability-container');
  assert.equal(last.block, 0);
});

test('a redirect table URI touches blocks 1 to 8 only, plus block 0 only on a tag with no valid container', () => {
  // The exact blocks a real write sends Update Binary to, in order. 29 TLV bytes pad to
  // 32, which is eight blocks: block 1 twice (terminator first, header last) and 2 to 8.
  const kept = planFor('https://treveanspice.com/t/ps', Uint8Array.from([0xe1, 0x40, 0x28, 0x01]));
  assert.deepEqual(kept.steps.map((step) => step.block), [1, 2, 3, 4, 5, 6, 7, 8, 1]);
  assert.equal(kept.blocksWritten, 9);

  const blank = planFor('https://treveanspice.com/t/ps', new Uint8Array(4));
  assert.deepEqual(blank.steps.map((step) => step.block), [1, 2, 3, 4, 5, 6, 7, 8, 1, 0]);
  assert.deepEqual(Array.from(blank.capabilityContainer), [0xe1, 0x40, 0x27, 0x01]);
});

test('every block in the plan is exactly one block long and inside the part', () => {
  const plan = planFor('https://treveanspice.com/t/nm', null);
  for (const step of plan.steps) {
    assert.equal(step.data.length, PART.blockSizeBytes);
    assert.ok(step.block >= 0 && step.block < PART.blockCount);
  }
});

test('the area image is padded to a block boundary with NULL TLVs', () => {
  const plan = planFor('https://treveanspice.com/t/ps', buildCapabilityContainer());
  assert.equal(plan.areaImage.length % PART.blockSizeBytes, 0);
  assert.equal(plan.areaBytesUsed, 29);
  assert.equal(plan.areaBytesFree, T5T_AREA_BYTES - 29);
  for (let i = plan.areaBytesUsed; i < plan.areaImage.length; i += 1) {
    assert.equal(plan.areaImage[i], 0x00);
  }
});
