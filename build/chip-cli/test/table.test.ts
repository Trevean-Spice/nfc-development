/**
 * The redirect table is the single source of truth, and this file is the tripwire
 * on it.
 *
 * The expected URLs below are transcribed from the Scope document, "Tag code map",
 * and from the M1 tag writing instructions, section 3.2. They are deliberately not
 * read out of the file under test. A table edit that changes what a tag carries has
 * to fail here and be looked at by a person, because 1,000 tags in the field carry
 * these strings.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RedirectTable } from '../src/table/redirect-table.js';
import { isChipError } from '../src/chip/errors.js';
import { planEncoding } from '../src/workflow/unit.js';
import { decodeUriMessage } from '../src/ndef/decode.js';
import { unwrapNdefTlv } from '../src/ndef/tlv.js';

/** Transcribed from the Scope document, not from the table. */
const EXPECTED: ReadonlyArray<readonly [string, string, string]> = [
  ['ps', 'Persian Sunrise', 'https://treveanspice.com/t/ps'],
  ['cs', 'Caribbean Sunset', 'https://treveanspice.com/t/cs'],
  ['sr', 'The Silk Road', 'https://treveanspice.com/t/sr'],
  ['nm', 'North African Night Market', 'https://treveanspice.com/t/nm'],
];

const table = RedirectTable.load();

test('the canonical redirect table loads and names itself', () => {
  assert.ok(table.version >= 2);
  assert.match(table.digest, /^[0-9a-f]{12}$/);
  assert.equal(table.origin, 'https://treveanspice.com');
});

test('every encodable code produces exactly the URI the Scope document states', () => {
  for (const [code, blendName, uri] of EXPECTED) {
    const resolved = table.uriFor(code);
    assert.equal(resolved.uri, uri, `code ${code}`);
    assert.equal(resolved.entry.blendName, blendName, `code ${code}`);
  }
});

test('the encodable set is exactly the four codes in this production run', () => {
  assert.deepEqual(
    table.encodable().map((e) => e.code).sort(),
    EXPECTED.map(([code]) => code).sort(),
  );
});

test('every code in the table encodes, writes back and decodes to its own URI', () => {
  for (const [code, , uri] of EXPECTED) {
    const plan = planEncoding(table.uriFor(code).uri);
    const decoded = decodeUriMessage(unwrapNdefTlv(plan.tlv));
    assert.equal(decoded.uri, uri, `code ${code} must survive encode and decode`);
    assert.equal(decoded.identifierCode, 0x04, `code ${code} must use the https:// abbreviation`);
    assert.ok(plan.summary.tlvBytes < 256, 'and must fit the part with room to spare');
  }
});

test('kg is refused, and refused by the rule rather than by name', () => {
  assert.throws(
    () => table.uriFor('kg'),
    (error: unknown) => isChipError(error) && error.code === 'CODE_NOT_ENCODABLE',
  );
  // The rule is "the row has no ndefUri", which is why it needs no special case.
  const kg = table.find('kg');
  assert.ok(kg !== undefined);
  assert.equal(kg.ndefUri, null);
  assert.equal(kg.status, 'reserved');
});

test('an unknown code is refused and the message lists the real ones', () => {
  assert.throws(
    () => table.uriFor('zz'),
    (error: unknown) => isChipError(error) && error.code === 'CODE_UNKNOWN' && error.remedy.includes('ps'),
  );
});

test('codes are matched case insensitively and with surrounding whitespace trimmed', () => {
  assert.equal(table.uriFor(' PS ').uri, 'https://treveanspice.com/t/ps');
});

test('a table whose ndefUri disagrees with its own origin plus path is refused outright', () => {
  const raw = JSON.stringify({
    version: 9,
    origin: 'https://treveanspice.com',
    entries: [
      {
        code: 'ps',
        blendSlug: 'persian-sunrise',
        blendName: 'Persian Sunrise',
        requestPath: '/t/ps',
        ndefUri: 'https://treveanspice.com/t/cs',
        status: 'encoded',
        unitsEncoded: 250,
        chipPartNumber: 'ST25TV02KC',
      },
    ],
  });
  assert.throws(
    () => RedirectTable.parse(raw, 'test'),
    (error: unknown) => isChipError(error) && error.code === 'TABLE_INVALID' && /disagrees with itself/.test(error.message),
  );
});

test('a row for a different chip part is refused rather than written with the wrong memory model', () => {
  const raw = JSON.stringify({
    version: 9,
    origin: 'https://treveanspice.com',
    entries: [
      {
        code: 'xx',
        blendSlug: 'x',
        blendName: 'X',
        requestPath: '/t/xx',
        ndefUri: 'https://treveanspice.com/t/xx',
        status: 'encoded',
        unitsEncoded: 1,
        chipPartNumber: 'NTAG216',
      },
    ],
  });
  const other = RedirectTable.parse(raw, 'test');
  assert.throws(
    () => other.uriFor('xx'),
    (error: unknown) => isChipError(error) && error.code === 'CODE_NOT_ENCODABLE' && /NTAG216/.test(error.message),
  );
});

test('a duplicated code is refused', () => {
  const row = {
    code: 'ps',
    blendSlug: 'persian-sunrise',
    blendName: 'Persian Sunrise',
    requestPath: '/t/ps',
    ndefUri: 'https://treveanspice.com/t/ps',
    status: 'encoded',
    unitsEncoded: 250,
    chipPartNumber: 'ST25TV02KC',
  };
  const raw = JSON.stringify({ version: 9, origin: 'https://treveanspice.com', entries: [row, row] });
  assert.throws(
    () => RedirectTable.parse(raw, 'test'),
    (error: unknown) => isChipError(error) && error.code === 'TABLE_INVALID',
  );
});

test('a missing table is a named failure, not a fallback to a built in list', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chip-cli-table-'));
  assert.throws(
    () => RedirectTable.load(join(dir, 'nothing-here.json')),
    (error: unknown) => isChipError(error) && error.code === 'TABLE_NOT_FOUND',
  );
});

test('a table that is not JSON is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chip-cli-table-'));
  const path = join(dir, 'broken.json');
  writeFileSync(path, '{ this is not json');
  assert.throws(
    () => RedirectTable.load(path),
    (error: unknown) => isChipError(error) && error.code === 'TABLE_INVALID',
  );
});

test('the table digest changes when the table changes', () => {
  const a = RedirectTable.parse(JSON.stringify({ version: 1, origin: 'https://x.test', entries: [{ code: 'a', requestPath: '/t/a', ndefUri: 'https://x.test/t/a' }] }), 'a');
  const b = RedirectTable.parse(JSON.stringify({ version: 1, origin: 'https://x.test', entries: [{ code: 'b', requestPath: '/t/b', ndefUri: 'https://x.test/t/b' }] }), 'b');
  assert.notEqual(a.digest, b.digest);
});

test('a row whose code and request path name different blends is refused', () => {
  // The self consistency check alone is satisfied by an edit that moves
  // requestPath and ndefUri together. That edit is exactly what a hand edit looks
  // like, and it is the one that puts the Caribbean Sunset URL onto tags the tool
  // labels Persian Sunrise. The code has to be the last segment of its own path.
  const raw = JSON.stringify({
    version: 2,
    origin: 'https://treveanspice.com',
    entries: [
      {
        code: 'ps',
        blendSlug: 'persian-sunrise',
        blendName: 'Persian Sunrise',
        requestPath: '/t/cs',
        ndefUri: 'https://treveanspice.com/t/cs',
        status: 'encoded',
        unitsEncoded: 250,
        chipPartNumber: 'ST25TV02KC',
      },
    ],
  });
  assert.throws(
    () => RedirectTable.parse(raw, 'test'),
    (error: unknown) => isChipError(error) && error.code === 'TABLE_INVALID' && /does not end with/.test(error.message),
  );
});
