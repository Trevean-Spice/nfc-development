/**
 * The chip model: geometry, the 256 byte capacity limit, the capability container,
 * and the ordering of the write plan.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CC_MLEN,
  PART,
  T5T_AREA_BYTES,
  T5T_AREA_FIRST_BLOCK,
  buildCapabilityContainer,
  buildWritePlan,
  evaluateCc,
} from '../src/chip/st25tv02kc.js';
import { encodeUriRecord } from '../src/ndef/encode.js';
import { wrapNdefTlv } from '../src/ndef/tlv.js';
import { isChipError } from '../src/chip/errors.js';

test('the part is a 256 byte Type 5 tag, not an NTAG', () => {
  assert.equal(PART.partNumber, 'ST25TV02KC');
  assert.equal(PART.nfcForumType, 5);
  assert.equal(PART.airInterface, 'ISO/IEC 15693');
  assert.equal(PART.totalBytes, 256);
  assert.equal(PART.blockCount, 64);
  assert.equal(PART.blockSizeBytes, 4);
  assert.equal(PART.blockCount * PART.blockSizeBytes, PART.totalBytes);
  assert.equal(PART.passwordBits, 64);
  // 888 is NTAG216 user memory. If this ever equals 888 the wrong part is modelled.
  assert.notEqual(PART.totalBytes, 888);
});

test('the T5T area is 248 bytes, which is what the capability container declares', () => {
  assert.equal(CC_MLEN, 31);
  assert.equal(T5T_AREA_BYTES, 248);
  assert.equal(T5T_AREA_BYTES, CC_MLEN * 8);
  assert.equal(T5T_AREA_FIRST_BLOCK, 1);
});

test('the capability container this tool writes is a valid Type 5 one', () => {
  const cc = buildCapabilityContainer();
  assert.equal(cc.length, 4);
  assert.equal(cc[0], 0xe1);
  assert.equal(cc[1], 0x40);
  assert.equal(cc[2], CC_MLEN);
  const assessment = evaluateCc(cc);
  assert.equal(assessment.valid, true);
  assert.equal(assessment.declaredAreaBytes, 248);
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

/** The longest remainder that fits: area, less TLV type, length and terminator, less the record header and prefix byte. */
const MAX_REMAINDER = T5T_AREA_BYTES - 3 - 4 - 1;

test('a URI that exactly fills the 248 byte area is accepted', () => {
  const uri = `https://${'a'.repeat(MAX_REMAINDER)}`;
  const tlv = wrapNdefTlv(encodeUriRecord(uri).message, T5T_AREA_BYTES);
  assert.equal(tlv.usedBytes, T5T_AREA_BYTES);
  assert.equal(tlv.freeBytes, 0);
});

test('one byte more than the area holds is refused, with the numbers in the message', () => {
  const uri = `https://${'a'.repeat(MAX_REMAINDER + 1)}`;
  assert.throws(
    () => wrapNdefTlv(encodeUriRecord(uri).message, T5T_AREA_BYTES),
    (error: unknown) =>
      isChipError(error) &&
      error.code === 'CAPACITY_EXCEEDED' &&
      error.message.includes('249') &&
      error.message.includes('248'),
  );
});

test('the capacity limit is the chip area and not the 255 byte short record limit', () => {
  // A payload of 250 bytes is a legal short record and still does not fit this part.
  const uri = `https://${'a'.repeat(249)}`;
  assert.equal(encodeUriRecord(uri).payload.length, 250);
  assert.throws(
    () => wrapNdefTlv(encodeUriRecord(uri).message, T5T_AREA_BYTES),
    (error: unknown) => isChipError(error) && error.code === 'CAPACITY_EXCEEDED',
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
