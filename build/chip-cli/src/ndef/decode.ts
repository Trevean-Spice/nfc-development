/**
 * NDEF decoding, used only for read back verification.
 *
 * This is deliberately strict. Its job is not to be tolerant of whatever a tag
 * happens to contain, it is to answer one question: are the bytes now on this tag
 * exactly the single URI record we meant to write. Anything it cannot account for
 * is a mismatch, and a mismatch stops the unit.
 *
 * It does accept record shapes this tool never writes (long records, an ID field)
 * because a tag may already carry an encoding produced by somebody else. The 1,000
 * tags on order SO4731 were encoded by the supplier before this engagement, and
 * reading one of those back is a real case.
 */

import { ChipError } from '../chip/errors.js';
import { expandUri, MAX_URI_IDENTIFIER_CODE } from './uri-prefixes.js';
import { TYPE_URI } from './encode.js';

const MB = 0x80;
const ME = 0x40;
const CF = 0x20;
const SR = 0x10;
const IL = 0x08;
const TNF_MASK = 0x07;
const TNF_WELL_KNOWN = 0x01;

export interface DecodedUriRecord {
  readonly uri: string;
  readonly identifierCode: number;
  readonly remainder: string;
  readonly payloadLength: number;
  /** Total bytes consumed by the record, including its header. */
  readonly recordLength: number;
}

function byteAt(bytes: Uint8Array, index: number, what: string): number {
  const value = bytes[index];
  if (value === undefined) {
    throw new ChipError(
      'NDEF_DECODE',
      `The NDEF message is truncated: ran out of bytes reading ${what} at offset ${index}.`,
      'The tag holds a partial write. Rewrite the tag, then verify again.',
      { offset: index, length: bytes.length },
    );
  }
  return value;
}

/**
 * Decodes a single record NDEF message into its URI.
 *
 * Rejects: more than one record, chunked records, a type other than well known
 * "U", an empty payload, and a reserved URI identifier code. Each of those is a
 * tag this tool must not pass as verified.
 */
export function decodeUriMessage(bytes: Uint8Array): DecodedUriRecord {
  if (bytes.length === 0) {
    throw new ChipError(
      'NDEF_DECODE',
      'The NDEF message is empty.',
      'The tag holds no NDEF record. Write it, then verify again.',
      {},
    );
  }

  const header = byteAt(bytes, 0, 'the record header');

  if ((header & MB) === 0) {
    throw new ChipError(
      'NDEF_DECODE',
      'The first record does not have the message begin flag set.',
      'The tag holds a malformed NDEF message. Rewrite the tag.',
      { header },
    );
  }
  if ((header & CF) !== 0) {
    throw new ChipError(
      'NDEF_DECODE',
      'The record is chunked. This tool does not accept chunked records.',
      'Rewrite the tag with this tool, which never produces a chunked record.',
      { header },
    );
  }
  const tnf = header & TNF_MASK;
  if (tnf !== TNF_WELL_KNOWN) {
    throw new ChipError(
      'NDEF_DECODE',
      `The record type name format is ${tnf}, not 1 (well known).`,
      'The tag holds something other than a URI record. Rewrite the tag.',
      { tnf },
    );
  }

  const typeLength = byteAt(bytes, 1, 'the type length');
  const shortRecord = (header & SR) !== 0;

  let offset = 2;
  let payloadLength: number;
  if (shortRecord) {
    payloadLength = byteAt(bytes, offset, 'the payload length');
    offset += 1;
  } else {
    payloadLength =
      byteAt(bytes, offset, 'the payload length') * 0x1000000 +
      byteAt(bytes, offset + 1, 'the payload length') * 0x10000 +
      byteAt(bytes, offset + 2, 'the payload length') * 0x100 +
      byteAt(bytes, offset + 3, 'the payload length');
    offset += 4;
  }

  let idLength = 0;
  if ((header & IL) !== 0) {
    idLength = byteAt(bytes, offset, 'the ID length');
    offset += 1;
  }

  if (typeLength !== 1) {
    throw new ChipError(
      'NDEF_DECODE',
      `The record type is ${typeLength} bytes long, not 1.`,
      'The tag holds something other than a URI record. Rewrite the tag.',
      { typeLength },
    );
  }
  const type = byteAt(bytes, offset, 'the record type');
  offset += 1;
  if (type !== TYPE_URI) {
    throw new ChipError(
      'NDEF_DECODE',
      `The record type is 0x${type.toString(16).padStart(2, '0')}, not 0x55 ("U", the URI type).`,
      'The tag holds something other than a URI record. Rewrite the tag.',
      { type },
    );
  }

  offset += idLength; // the ID itself is not used by this project

  if (payloadLength === 0) {
    throw new ChipError(
      'NDEF_DECODE',
      'The URI record has an empty payload.',
      'The tag holds a partial write. Rewrite the tag, then verify again.',
      {},
    );
  }

  const identifierCode = byteAt(bytes, offset, 'the URI identifier code');
  if (identifierCode > MAX_URI_IDENTIFIER_CODE) {
    throw new ChipError(
      'NDEF_DECODE',
      `The URI identifier code 0x${identifierCode.toString(16).padStart(2, '0')} is reserved for future use.`,
      'The tag was written by a tool using a prefix code this one does not recognise. Rewrite the tag.',
      { identifierCode },
    );
  }

  const remainderStart = offset + 1;
  const remainderEnd = offset + payloadLength;
  if (remainderEnd > bytes.length) {
    throw new ChipError(
      'NDEF_DECODE',
      `The record claims a ${payloadLength} byte payload but only ${bytes.length - offset} bytes are present.`,
      'The tag holds a partial write. Rewrite the tag, then verify again.',
      { payloadLength, available: bytes.length - offset },
    );
  }

  const remainderBytes = bytes.subarray(remainderStart, remainderEnd);
  for (const b of remainderBytes) {
    if (b < 0x20 || b === 0x7f) {
      throw new ChipError(
        'NDEF_DECODE',
        'The URI contains a control character.',
        'The tag holds a corrupt or partial write. Rewrite the tag, then verify again.',
        { byte: b },
      );
    }
  }
  const remainder = Buffer.from(remainderBytes).toString('utf8');

  const recordLength = remainderEnd;

  if ((header & ME) === 0) {
    throw new ChipError(
      'NDEF_DECODE',
      'The message contains more than one record. This project writes exactly one URI record.',
      'Rewrite the tag with this tool. Do not accept a tag carrying extra records.',
      { header },
    );
  }
  if (bytes.length > recordLength) {
    throw new ChipError(
      'NDEF_DECODE',
      `The message has ${bytes.length - recordLength} trailing bytes after the single record.`,
      'Rewrite the tag with this tool.',
      { trailingBytes: bytes.length - recordLength },
    );
  }

  return {
    uri: expandUri(identifierCode, remainder),
    identifierCode,
    remainder,
    payloadLength,
    recordLength,
  };
}
