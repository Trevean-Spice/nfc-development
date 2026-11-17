/**
 * NDEF encoding and decoding.
 *
 * The byte level assertions here are written out by hand from the NFC Forum URI
 * Record Type Definition rather than captured from the encoder, so a change in the
 * encoder that is wrong fails rather than being blessed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encodeUriRecord, SHORT_RECORD_OVERHEAD_BYTES } from '../src/ndef/encode.js';
import { decodeUriMessage } from '../src/ndef/decode.js';
import { splitUri, expandUri, URI_PREFIXES, HTTPS_IDENTIFIER_CODE } from '../src/ndef/uri-prefixes.js';
import { wrapNdefTlv, unwrapNdefTlv, TLV_NDEF, TLV_TERMINATOR } from '../src/ndef/tlv.js';
import { T5T_AREA_BYTES } from '../src/chip/st25tv02kc.js';
import { isChipError } from '../src/chip/errors.js';
import { toHex } from '../src/util/hex.js';

test('the https:// prefix is code 0x04 and www variants are distinct', () => {
  assert.equal(URI_PREFIXES[0x01], 'http://www.');
  assert.equal(URI_PREFIXES[0x02], 'https://www.');
  assert.equal(URI_PREFIXES[0x03], 'http://');
  assert.equal(URI_PREFIXES[0x04], 'https://');
  assert.equal(HTTPS_IDENTIFIER_CODE, 0x04);
});

test('the longest matching prefix wins', () => {
  assert.equal(splitUri('https://www.example.com').identifierCode, 0x02);
  assert.equal(splitUri('https://example.com').identifierCode, 0x04);
  assert.equal(splitUri('http://www.example.com').identifierCode, 0x01);
  assert.equal(splitUri('ftp://ftp.example.com').identifierCode, 0x08);
  assert.equal(splitUri('urn:epc:id:sgtin:1').identifierCode, 0x1e);
  assert.equal(splitUri('mailto:someone@example.com').identifierCode, 0x06);
  assert.equal(splitUri('gopher://example.com').identifierCode, 0x00);
});

test('every defined prefix round trips through split and expand', () => {
  for (let code = 0; code < URI_PREFIXES.length; code += 1) {
    const prefix = URI_PREFIXES[code] as string;
    const uri = `${prefix}trevean-round-trip`;
    const split = splitUri(uri);
    assert.equal(expandUri(split.identifierCode, split.remainder), uri, `code 0x${code.toString(16)}`);
  }
});

test('the Trevean tag URI encodes to the exact expected bytes', () => {
  const record = encodeUriRecord('https://treveanspice.com/t/ps');

  assert.equal(record.identifierCode, 0x04, 'must abbreviate https:// rather than carrying it whole');
  assert.equal(record.remainder, 'treveanspice.com/t/ps');
  assert.equal(record.payload.length, 22, 'one identifier byte plus 21 characters');
  assert.equal(record.message.length, SHORT_RECORD_OVERHEAD_BYTES + 22);
  assert.equal(record.bytesSavedByPrefix, 8, 'the eight characters of "https://"');

  // Header 0xD1 is MB + ME + SR + TNF well known. Type length 1, payload length
  // 0x16 (22), type 0x55 ("U"), then the payload starting with prefix code 0x04.
  const expected =
    'd1' + '01' + '16' + '55' + '04' + Buffer.from('treveanspice.com/t/ps', 'ascii').toString('hex');
  assert.equal(toHex(record.message), expected);
});

test('the prefix abbreviation saves eight bytes of a 320 byte chip', () => {
  const uri = 'https://treveanspice.com/t/ps';
  const record = encodeUriRecord(uri);
  const withoutAbbreviation = SHORT_RECORD_OVERHEAD_BYTES + 1 + Buffer.byteLength(uri, 'utf8');
  assert.equal(withoutAbbreviation - record.message.length, 8);

  // A scheme with no defined prefix carries the whole URI, and that is correct too.
  const noPrefix = encodeUriRecord('gopher://treveanspice.com/t/ps');
  assert.equal(noPrefix.identifierCode, 0x00);
  assert.equal(noPrefix.remainder, 'gopher://treveanspice.com/t/ps');
});

test('encode then decode round trips every code in the tag code map', () => {
  for (const uri of [
    'https://treveanspice.com/t/ps',
    'https://treveanspice.com/t/cs',
    'https://treveanspice.com/t/sr',
    'https://treveanspice.com/t/nm',
  ]) {
    const decoded = decodeUriMessage(encodeUriRecord(uri).message);
    assert.equal(decoded.uri, uri);
    assert.equal(decoded.identifierCode, 0x04);
  }
});

test('encode then decode round trips awkward URIs', () => {
  for (const uri of [
    'https://a.b',
    'https://treveanspice.com/t/ps?x=1#frag',
    'https://treveanspice.com/' + 'a'.repeat(200),
    'tel:+441234567890',
    'urn:nfc:ext:example.com:thing',
  ]) {
    assert.equal(decodeUriMessage(encodeUriRecord(uri).message).uri, uri);
  }
});

test('the TLV wraps the message with a terminator', () => {
  const record = encodeUriRecord('https://treveanspice.com/t/ps');
  const tlv = wrapNdefTlv(record.message, T5T_AREA_BYTES);

  assert.equal(tlv.bytes[0], TLV_NDEF);
  assert.equal(tlv.bytes[1], record.message.length);
  assert.equal(tlv.bytes[tlv.bytes.length - 1], TLV_TERMINATOR);
  assert.equal(tlv.usedBytes, 1 + 1 + record.message.length + 1);
  assert.equal(tlv.usedBytes, 29, '26 byte message plus three bytes of TLV overhead');
  assert.equal(tlv.freeBytes, T5T_AREA_BYTES - 29);

  assert.equal(toHex(unwrapNdefTlv(tlv.bytes)), toHex(record.message));
});

test('the decoder refuses a second record', () => {
  const first = encodeUriRecord('https://treveanspice.com/t/ps').message.slice();
  const second = encodeUriRecord('https://treveanspice.com/t/cs').message.slice();
  first[0] = 0x91; // MB set, ME cleared
  second[0] = 0x51; // ME set, MB cleared
  const twoRecords = new Uint8Array(first.length + second.length);
  twoRecords.set(first, 0);
  twoRecords.set(second, first.length);

  assert.throws(
    () => decodeUriMessage(twoRecords),
    (error: unknown) => isChipError(error) && error.code === 'NDEF_DECODE',
  );
});

test('the decoder refuses a truncated record, which is what a partial write leaves', () => {
  const message = encodeUriRecord('https://treveanspice.com/t/ps').message;
  for (const cut of [1, 3, 5, 12, message.length - 1]) {
    assert.throws(
      () => decodeUriMessage(message.slice(0, cut)),
      (error: unknown) => isChipError(error) && error.code === 'NDEF_DECODE',
      `truncated at ${cut} must be refused`,
    );
  }
});

test('the decoder refuses a reserved URI identifier code', () => {
  const message = encodeUriRecord('https://treveanspice.com/t/ps').message.slice();
  message[4] = 0x40; // above 0x23, reserved for future use
  assert.throws(
    () => decodeUriMessage(message),
    (error: unknown) => isChipError(error) && error.code === 'NDEF_DECODE',
  );
});

test('the decoder refuses a record that is not a URI record', () => {
  const message = encodeUriRecord('https://treveanspice.com/t/ps').message.slice();
  message[3] = 0x54; // "T", a text record
  assert.throws(
    () => decodeUriMessage(message),
    (error: unknown) => isChipError(error) && error.code === 'NDEF_DECODE',
  );
});

test('unwrapping an area that holds only a terminator says so rather than guessing', () => {
  const area = new Uint8Array(32);
  area[0] = TLV_TERMINATOR;
  assert.throws(
    () => unwrapNdefTlv(area),
    (error: unknown) => isChipError(error) && error.code === 'NDEF_DECODE' && /formatted but holds no NDEF/.test(error.message),
  );
});

test('unwrapping skips NULL TLV padding', () => {
  const record = encodeUriRecord('https://treveanspice.com/t/cs');
  const tlv = wrapNdefTlv(record.message, T5T_AREA_BYTES);
  const padded = new Uint8Array(tlv.bytes.length + 3);
  padded.set(tlv.bytes, 3); // three NULL TLVs in front
  assert.equal(toHex(unwrapNdefTlv(padded)), toHex(record.message));
});
