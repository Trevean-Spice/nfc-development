/**
 * NDEF encoding: one URI record, nothing else.
 *
 * The tag carries a single well known URI record. That is what the 1,000 shipped
 * tags carry and what the M1 tag writing instructions specify, so it is what this
 * tool produces. There is no path here that writes a second record, a text record,
 * an Android Application Record or an Augmented NDEF field. Augmented NDEF and
 * TruST25 are real features of this chip and are dormant by the client's decision.
 */

import { ChipError } from '../chip/errors.js';
import { splitUri, type UriSplit } from './uri-prefixes.js';

/** NDEF record header bits. */
const MB = 0x80; // message begin
const ME = 0x40; // message end
const SR = 0x10; // short record, one byte payload length
const TNF_WELL_KNOWN = 0x01;

/** Record type "U", the well known URI type. */
export const TYPE_URI = 0x55;

/** Fixed overhead of a short URI record: header, type length, payload length, type. */
export const SHORT_RECORD_OVERHEAD_BYTES = 4;

export interface EncodedUriRecord {
  readonly uri: string;
  readonly identifierCode: number;
  readonly prefix: string;
  readonly remainder: string;
  /** Identifier code byte followed by the UTF-8 remainder. */
  readonly payload: Uint8Array;
  /** The complete single record NDEF message. */
  readonly message: Uint8Array;
  /** Bytes the URI prefix abbreviation saved. */
  readonly bytesSavedByPrefix: number;
}

function validateUri(uri: string): void {
  if (typeof uri !== 'string' || uri.length === 0) {
    throw new ChipError('NDEF_ENCODE', 'The URI is empty.', 'Check the redirect table entry for this code.', {
      uri: String(uri),
    });
  }
  if (/[\u0000-\u001f\u007f]/.test(uri)) {
    throw new ChipError(
      'NDEF_ENCODE',
      'The URI contains a control character.',
      'The redirect table is corrupt. Do not write tags until it is fixed.',
      { uri },
    );
  }
  if (uri.trim() !== uri) {
    throw new ChipError(
      'NDEF_ENCODE',
      'The URI has leading or trailing whitespace.',
      'The redirect table is corrupt. Do not write tags until it is fixed.',
      { uri },
    );
  }
}

/**
 * Encodes one URI into a single record NDEF message.
 *
 * The record is always MB + ME + SR with TNF well known, because a URI that fits
 * on a 256 byte chip can never need the long record form. A payload over 255 bytes
 * is rejected here rather than silently switched to the long form, since on this
 * part it could not fit in the NDEF area anyway and the honest failure is better
 * than a record no reader on this project will ever see.
 */
export function encodeUriRecord(uri: string): EncodedUriRecord {
  validateUri(uri);

  const split: UriSplit = splitUri(uri);
  const remainderBytes = Buffer.from(split.remainder, 'utf8');

  const payload = new Uint8Array(1 + remainderBytes.length);
  payload[0] = split.identifierCode;
  payload.set(remainderBytes, 1);

  if (payload.length > 0xff) {
    throw new ChipError(
      'NDEF_ENCODE',
      `The URI payload is ${payload.length} bytes, over the 255 byte short record limit.`,
      'Shorten the URI. Nothing this long fits in the ST25TV02KC NDEF area in any case.',
      { uri, payloadBytes: payload.length },
    );
  }

  const message = new Uint8Array(SHORT_RECORD_OVERHEAD_BYTES + payload.length);
  message[0] = MB | ME | SR | TNF_WELL_KNOWN; // 0xD1
  message[1] = 0x01; // type length
  message[2] = payload.length; // payload length
  message[3] = TYPE_URI;
  message.set(payload, SHORT_RECORD_OVERHEAD_BYTES);

  return {
    uri,
    identifierCode: split.identifierCode,
    prefix: split.prefix,
    remainder: split.remainder,
    payload,
    message,
    bytesSavedByPrefix: split.bytesSaved,
  };
}
