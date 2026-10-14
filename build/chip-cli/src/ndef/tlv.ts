/**
 * The NDEF TLV inside the Type 5 tag area.
 *
 * On a Type 5 tag the NDEF message does not sit bare in memory. It sits in the
 * T5T area, which begins immediately after the four byte capability container, as
 * a type / length / value block: type 0x03, then the length, then the message,
 * then a 0xFE terminator.
 *
 * Only the TLV types a Type 5 tag can legitimately carry are handled here: NULL
 * (0x00), NDEF (0x03), Proprietary (0xFD) and Terminator (0xFE). Anything else is
 * reported rather than skipped, because a TLV this tool does not understand sitting
 * in front of the NDEF message is a tag it must not pass as verified.
 */

import { ChipError } from '../chip/errors.js';

export const TLV_NULL = 0x00;
export const TLV_NDEF = 0x03;
export const TLV_PROPRIETARY = 0xfd;
export const TLV_TERMINATOR = 0xfe;

/** Lengths at or above this use the three byte form: 0xFF then two bytes, big endian. */
export const TLV_THREE_BYTE_LENGTH_THRESHOLD = 0xff;

export interface TlvPlan {
  /** The complete TLV block including the terminator. */
  readonly bytes: Uint8Array;
  /** Bytes of the T5T area consumed. */
  readonly usedBytes: number;
  /** Bytes of the T5T area left over. */
  readonly freeBytes: number;
}

function lengthFieldSize(messageLength: number): number {
  return messageLength < TLV_THREE_BYTE_LENGTH_THRESHOLD ? 1 : 3;
}

/**
 * Wraps an NDEF message in its TLV and checks it against the area size.
 *
 * The capacity check is the reason this function takes the area size rather than
 * assuming it. The ST25TV02KC has 256 bytes of memory, of which the capability
 * container takes four and the T5T area is what the container declares. A tool that
 * assumed a different part's memory would happily overrun it.
 */
export function wrapNdefTlv(message: Uint8Array, areaBytes: number): TlvPlan {
  const lengthSize = lengthFieldSize(message.length);
  const usedBytes = 1 + lengthSize + message.length + 1; // type, length, value, terminator

  if (usedBytes > areaBytes) {
    throw new ChipError(
      'CAPACITY_EXCEEDED',
      `The NDEF message needs ${usedBytes} bytes of the ${areaBytes} byte tag area (message ${message.length} bytes, TLV overhead ${lengthSize + 2}).`,
      'Shorten the URI. If you believe this URI should fit, the tool has been pointed at the wrong chip profile.',
      { requiredBytes: usedBytes, areaBytes, messageBytes: message.length },
    );
  }

  const bytes = new Uint8Array(usedBytes);
  let offset = 0;
  bytes[offset] = TLV_NDEF;
  offset += 1;
  if (lengthSize === 1) {
    bytes[offset] = message.length;
    offset += 1;
  } else {
    bytes[offset] = 0xff;
    bytes[offset + 1] = (message.length >> 8) & 0xff;
    bytes[offset + 2] = message.length & 0xff;
    offset += 3;
  }
  bytes.set(message, offset);
  offset += message.length;
  bytes[offset] = TLV_TERMINATOR;

  return { bytes, usedBytes, freeBytes: areaBytes - usedBytes };
}

/**
 * Finds and returns the NDEF message inside a T5T area image.
 *
 * Walks the TLV chain from the start of the area. NULL TLVs are padding and are
 * skipped. A Proprietary TLV is skipped over by its length, which is the only
 * correct thing to do with it. A terminator before any NDEF TLV means the tag is
 * formatted but empty.
 */
export function unwrapNdefTlv(area: Uint8Array): Uint8Array {
  let offset = 0;
  while (offset < area.length) {
    const type = area[offset];
    if (type === undefined) break;
    offset += 1;

    if (type === TLV_NULL) continue;
    if (type === TLV_TERMINATOR) {
      throw new ChipError(
        'NDEF_DECODE',
        'The tag area is formatted but holds no NDEF message.',
        'The write did not land. Write the tag, then verify again.',
        {},
      );
    }

    const first = area[offset];
    if (first === undefined) {
      throw new ChipError(
        'NDEF_DECODE',
        'The tag area ends in the middle of a TLV length field.',
        'The tag holds a partial write. Rewrite the tag, then verify again.',
        { offset },
      );
    }
    offset += 1;
    let length: number;
    if (first === 0xff) {
      const hi = area[offset];
      const lo = area[offset + 1];
      if (hi === undefined || lo === undefined) {
        throw new ChipError(
          'NDEF_DECODE',
          'The tag area ends in the middle of a three byte TLV length field.',
          'The tag holds a partial write. Rewrite the tag, then verify again.',
          { offset },
        );
      }
      length = (hi << 8) | lo;
      offset += 2;
    } else {
      length = first;
    }

    if (offset + length > area.length) {
      throw new ChipError(
        'NDEF_DECODE',
        `A TLV of type 0x${type.toString(16).padStart(2, '0')} claims ${length} bytes but the area has ${area.length - offset} left.`,
        'The tag holds a partial write. Rewrite the tag, then verify again.',
        { tlvType: type, claimedLength: length, available: area.length - offset },
      );
    }

    if (type === TLV_NDEF) {
      return area.slice(offset, offset + length);
    }
    if (type === TLV_PROPRIETARY) {
      offset += length;
      continue;
    }

    throw new ChipError(
      'NDEF_DECODE',
      `The tag area holds a TLV of type 0x${type.toString(16).padStart(2, '0')}, which is not valid on a Type 5 tag.`,
      'Do not accept this tag. Set it aside, label it, and report it.',
      { tlvType: type, offset: offset - 2 },
    );
  }

  throw new ChipError(
    'NDEF_DECODE',
    'The tag area holds no NDEF TLV and no terminator.',
    'The tag is unformatted or the write did not land. Write the tag, then verify again.',
    {},
  );
}
