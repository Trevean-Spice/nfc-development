/**
 * The build step and the artifacts it produces.
 *
 * These tests protect the property in Architecture, "The redirect table": one
 * version-controlled source of truth, deployed with the application, never hand
 * edited state. A second copy is the failure mode with no visible symptom on the
 * deploying side, because everything comes up green and 1,000 jars are stranded.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  PATHS,
  PACKAGE_ROOT,
  MAX_FUNCTION_BYTES,
  loadTable,
  tableId,
  targetsOf,
  preloadsOf
} from '../lib/table.mjs';
import { compile, collapseHtml } from '../lib/compile.mjs';
import { nfcTagsSeed, tagEncodingCsv, qrArtworkCsv, csvField } from '../lib/derive.mjs';
import { validate } from '../lib/validate.mjs';

const table = loadTable();
const notFoundHtml = collapseHtml(readFileSync(PATHS.notFound, 'utf8'));
const compiled = compile(table);

// ---------------------------------------------------------------------------
// One source of truth
// ---------------------------------------------------------------------------

test('dist/redirect.js is exactly what the table compiles to', () => {
  assert.equal(
    readFileSync(PATHS.distFunction, 'utf8'),
    compiled.source,
    'dist/ has drifted from the table. Run npm run build. Never edit dist/ by hand.'
  );
});

test('the NFCTags seed is exactly what the table derives to', () => {
  assert.equal(readFileSync(PATHS.distSeed, 'utf8'), `${JSON.stringify(nfcTagsSeed(table, notFoundHtml), null, 2)}\n`);
});

test('the chip encoding input is exactly what the table derives to', () => {
  assert.equal(readFileSync(PATHS.distEncoding, 'utf8'), tagEncodingCsv(table));
});

test('the QR artwork sheet is exactly what the table derives to', () => {
  assert.equal(readFileSync(PATHS.distQrArtwork, 'utf8'), qrArtworkCsv(table));
});

test('the QR artwork sheet states one encodable URL per code and the page it reaches', () => {
  const lines = qrArtworkCsv(table).trim().split('\n');
  assert.equal(lines.length, table.entries.length + 1);
  assert.equal(lines[0], 'code,blendSlug,blendName,encodeInQr,resolvesTo,redirectStatus');
  for (const entry of table.entries) {
    const row = lines.find((line) => line.startsWith(`${entry.code},`));
    assert.ok(row.includes(`https://treveanspice.com/q/${entry.code}`), `${entry.code} has no encodable URL`);
    assert.ok(row.includes('via=qr'), `${entry.code} would be printed pointing at the tap attribution`);
    assert.ok(row.endsWith(',307'));
  }
});

test('the chip encoding input carries no QR URL, because a QR is not encoded onto silicon', () => {
  assert.ok(!tagEncodingCsv(table).includes('/q/'));
});

test('no file outside the table and its derived artifacts carries a target path', () => {
  // A literal "/blend.html?blend=...&via=nfc" anywhere else is a second copy of
  // the load-bearing artifact, waiting to disagree with the first. The table,
  // the three generated artifacts and the tests are the permitted exceptions,
  // and the tests hold theirs deliberately: their expectations are transcribed
  // from the contract documents rather than derived from the file under test.
  const allowed = new Set(
    [PATHS.table, PATHS.distFunction, PATHS.distSeed, PATHS.distEncoding, PATHS.distQrArtwork].map((p) =>
      relative(PACKAGE_ROOT, p).split('\\').join('/')
    )
  );
  const offenders = [];
  for (const file of sourceFiles()) {
    const rel = relative(PACKAGE_ROOT, file).split('\\').join('/');
    // Prose is exempt. The risk is a copy something reads, not a copy something
    // reads about, and a README that cannot show the table is a worse README.
    if (allowed.has(rel) || rel.startsWith('test/') || rel.endsWith('.md')) continue;
    const contents = readFileSync(file, 'utf8');
    for (const entry of table.entries) {
      // Both routes. A hard coded QR target is the same defect as a hard coded
      // tap target: a second copy of the load-bearing artifact waiting to
      // disagree with the first.
      for (const [field, value] of [
        ['target', entry.targetPath],
        ['QR target', entry.qrTargetPath],
        ['QR URL', entry.qrUrl]
      ]) {
        if (contents.includes(value)) {
          offenders.push(`${rel} hard codes the ${field} for ${entry.code}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('the derived seed agrees with the table row for row', () => {
  const seed = nfcTagsSeed(table, notFoundHtml);
  assert.equal(seed.items.length, table.entries.length);
  for (const item of seed.items) {
    const entry = table.entries.find((e) => e.code === item.code);
    assert.equal(item.blendSlug, entry.blendSlug);
    assert.equal(item.targetPath, entry.targetPath);
    assert.equal(item.qrRequestPath, entry.qrRequestPath);
    assert.equal(item.qrTargetPath, entry.qrTargetPath);
    assert.equal(item.qrUrl, entry.qrUrl);
    assert.equal(item.ndefUri, entry.ndefUri);
    assert.equal(item.redirectStatus, 307);
  }
});

test('the NFCTags mirror carries the QR route, so an operator can read both without cloning the repo', () => {
  for (const item of nfcTagsSeed(table, notFoundHtml).items) {
    assert.equal(item.qrRequestPath, `/q/${item.code}`);
    assert.ok(item.qrTargetPath.includes('via=qr'));
    assert.equal(item.qrUrl, `https://treveanspice.com/q/${item.code}`);
  }
});

test('the seed leaves provenance fields null so the build stays reproducible', () => {
  for (const item of nfcTagsSeed(table, notFoundHtml).items) {
    assert.equal(item.sourceCommit, null);
    assert.equal(item.deployedAt, null);
    assert.equal(item.lastVerifiedAgainstPhysicalTag, null);
  }
});

test('the chip encoding input carries one row per code and no ndefUri for the reserved one', () => {
  const lines = tagEncodingCsv(table).trim().split('\n');
  assert.equal(lines.length, table.entries.length + 1);
  const kg = lines.find((line) => line.startsWith('kg,'));
  assert.ok(kg.includes(',,'), 'the reserved code carries no NDEF URI');
  assert.ok(kg.includes('reserved'));
  for (const line of lines.slice(1)) {
    const expected = line.startsWith('kg,') ? 'unknown' : 'true';
    assert.ok(line.endsWith(expected), 'writeProtected is true across the SO4731 run and unknown on the reserved code');
  }
});

// ---------------------------------------------------------------------------
// The runtime limits
// ---------------------------------------------------------------------------

test('the compiled function fits the CloudFront Functions 10 KB code limit', () => {
  assert.ok(
    compiled.bytes <= MAX_FUNCTION_BYTES,
    `compiled function is ${compiled.bytes} bytes against a ${MAX_FUNCTION_BYTES} byte limit`
  );
});

test('the build refuses to emit a function over the limit', () => {
  const bloated = structuredClone(table);
  const filler = 'x'.repeat(MAX_FUNCTION_BYTES);
  assert.throws(
    () => compile(bloated, { notFoundHtml: filler }),
    /over the CloudFront Functions limit/,
    'an oversized function must fail the build, not the deployment'
  );
});

test('the build refuses to emit a function with an unsubstituted token', () => {
  // Named token changed from __PRELOADS__ to __QR_TARGETS__ when the QR route
  // was added, because __QR_TARGETS__ is now the first token the template is
  // missing. The property under test is unchanged: a partial function is a
  // build failure, not a deployment.
  assert.throws(() => compile(table, { template: 'var TARGETS = __TARGETS__;' }), /__QR_TARGETS__/);
});

test('the build refuses a function that would read the query string', () => {
  const template = readFileSync(PATHS.template, 'utf8').replace(
    'var uri = event.request.uri;',
    'var uri = event.request.uri; var q = event.request.querystring;'
  );
  assert.throws(() => compile(table, { template }), /cache key/);
});

test('the build refuses a function that would serve every code with via=nfc', () => {
  // The regression this guards is the one that shipped: the compiled function
  // hardcoded via=nfc on every target, so nothing in the system could ever emit
  // via=qr and every QR scan was attributed as a tap. It is a build failure now.
  const noQr = structuredClone(table);
  for (const entry of noQr.entries) entry.qrTargetPath = entry.targetPath;
  assert.throws(() => compile(noQr), /does not carry via=qr/);
});

test('the build refuses a function whose tap target lost via=nfc', () => {
  const noTap = structuredClone(table);
  noTap.entries.find((e) => e.code === 'ps').targetPath = '/blend.html?blend=persian-sunrise&via=tap';
  assert.throws(() => compile(noTap), /does not carry via=nfc/);
});

test('the build refuses a function whose two routes reach different blends', () => {
  const split = structuredClone(table);
  split.entries.find((e) => e.code === 'ps').qrTargetPath = '/blend.html?blend=silk-road&via=qr';
  assert.throws(() => compile(split), /do not resolve to the same destination/);
});

test('the compiled function serves both routes for every code', () => {
  for (const entry of table.entries) {
    assert.ok(compiled.source.includes(entry.targetPath), `${entry.code} tap target is missing`);
    assert.ok(compiled.source.includes(entry.qrTargetPath), `${entry.code} QR target is missing`);
  }
});

test('the build refuses a function that could return a permanent redirect', () => {
  const template = readFileSync(PATHS.template, 'utf8').replace('statusCode: 307', 'statusCode: 301');
  assert.throws(() => compile(table, { template }), /Only 307 and 404/);
});

// ---------------------------------------------------------------------------
// The table id, which is how a stale deployment is detected from outside
// ---------------------------------------------------------------------------

test('the table id changes when the mapping changes', () => {
  const changed = structuredClone(table);
  changed.entries.find((e) => e.code === 'cs').targetPath = '/blend.html?blend=kyoto-garden&via=nfc';
  assert.notEqual(tableId(changed, notFoundHtml), tableId(table, notFoundHtml));
});

test('the table id changes when the QR mapping changes', () => {
  // Without this the QR route could be repointed and every deployed function
  // would still look current from outside, which is the whole point of the id.
  const changed = structuredClone(table);
  changed.entries.find((e) => e.code === 'cs').qrTargetPath = '/blend.html?blend=kyoto-garden&via=qr';
  assert.notEqual(tableId(changed, notFoundHtml), tableId(table, notFoundHtml));
});

test('the table id changes when the branded 404 page changes', () => {
  assert.notEqual(tableId(table, `${notFoundHtml}<!-- edit -->`), tableId(table, notFoundHtml));
});

test('the table id does not change on an inventory correction that changes no behaviour', () => {
  const corrected = structuredClone(table);
  corrected.entries.find((e) => e.code === 'ps').supplierOrderRef = 'SO4731-A';
  assert.equal(
    tableId(corrected, notFoundHtml),
    tableId(table, notFoundHtml),
    'a deployed function should not look stale when its behaviour is identical'
  );
});

test('the table id is stable across repeated builds', () => {
  assert.equal(compile(table).tableId, compiled.tableId);
});

test('the preload map is empty until a hero path is set', () => {
  assert.deepEqual(preloadsOf(table), {});
  assert.equal(Object.keys(targetsOf(table)).length, 5);
});

// ---------------------------------------------------------------------------
// House style, enforced rather than remembered
// ---------------------------------------------------------------------------

test('no file in this package contains an en dash or an em dash', () => {
  // The two characters are built from their code points so that this file, which
  // is itself scanned, does not report itself.
  const forbidden = [String.fromCharCode(0x2013), String.fromCharCode(0x2014)];
  const offenders = [];
  for (const file of sourceFiles()) {
    const contents = readFileSync(file, 'utf8');
    for (const [index, line] of contents.split('\n').entries()) {
      if (forbidden.some((character) => line.includes(character))) {
        offenders.push(`${relative(PACKAGE_ROOT, file).split('\\').join('/')}:${index + 1}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('the package has no runtime or development dependencies', () => {
  const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.dependencies ?? {}, {});
  assert.deepEqual(pkg.devDependencies ?? {}, {});
});

function sourceFiles(dir = PACKAGE_ROOT, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(mjs|js|json|md|html|csv)$/.test(entry)) out.push(full);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* The generated sheets go to a print vendor, so their columns have to hold    */
/* -------------------------------------------------------------------------- */

/**
 * An RFC 4180 parser, written here rather than assumed, because the assertions below are
 * about the shape of the file a vendor's tool will read. Splitting on commas would agree
 * with the bug rather than catch it.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === '') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * The failure this reproduces: blendName "Kyoto Garden, Limited Edition", which is an
 * ordinary marketing decision. Every column right of blendName used to shift by one, so a
 * vendor reading the encodeInQr column got " Limited Edition" instead of a URL. The
 * validator returned zero errors and the artifact test above still passed, because it
 * checked only that the QR URL appeared somewhere in the row and that the row ended with
 * ",307". Both survive a shift. Print artwork is as unrecallable as an encoded chip.
 */
function tableWithBlendName(name) {
  const copy = JSON.parse(JSON.stringify(table));
  copy.entries[0].blendName = name;
  return copy;
}

test('a comma in a blend name does not move a single column of the QR artwork sheet', () => {
  const awkward = tableWithBlendName('Kyoto Garden, Limited Edition');
  const rows = parseCsv(qrArtworkCsv(awkward));
  const header = rows[0];
  assert.equal(header.length, 6);
  for (const row of rows.slice(1)) {
    assert.equal(row.length, header.length, `row ${row[0]} has ${row.length} columns, header has ${header.length}`);
  }

  const first = rows[1];
  assert.equal(first[2], 'Kyoto Garden, Limited Edition', 'the name survives whole');
  assert.equal(first[3], awkward.entries[0].qrUrl, 'the column a print vendor encodes is still the QR URL');
  assert.equal(first[4], awkward.entries[0].qrTargetPath);
  assert.equal(first[5], '307');
});

test('a quote in a blend name is doubled rather than ending the field early', () => {
  const rows = parseCsv(qrArtworkCsv(tableWithBlendName('The "Silk" Road')));
  assert.equal(rows[1].length, rows[0].length);
  assert.equal(rows[1][2], 'The "Silk" Road');
  assert.equal(rows[1][3], table.entries[0].qrUrl);
});

test('every row of both generated sheets has exactly as many columns as its header', () => {
  for (const [name, csv] of [
    ['qr-artwork.csv', qrArtworkCsv(table)],
    ['tag-encoding.csv', tagEncodingCsv(table)],
  ]) {
    const rows = parseCsv(csv);
    assert.equal(rows.length, table.entries.length + 1, `${name} has one row per code plus a header`);
    for (const row of rows) {
      assert.equal(row.length, rows[0].length, `${name}: ${row[0]} has the wrong column count`);
    }
  }
});

test('a blend name with no comma is written unquoted, so the committed sheets do not churn', () => {
  // The quoting is minimal per RFC 4180: only fields that need it get quotes. Without this
  // the dist/ drift check would fail on a change that alters nothing a reader can see.
  assert.equal(csvField('Persian Sunrise'), 'Persian Sunrise');
  assert.equal(csvField('Kyoto Garden, Limited Edition'), '"Kyoto Garden, Limited Edition"');
  assert.equal(csvField('The "Silk" Road'), '"The ""Silk"" Road"');
  assert.equal(csvField(307), '307');
  assert.equal(csvField(null), '');
});

test('a blend name carrying a line break is refused by the validator rather than quoted through', () => {
  // RFC 4180 permits a newline inside a quoted field and plenty of vendor tooling
  // mishandles it, so this one is rejected at the table rather than smuggled onto a sheet.
  const { errors } = validate(tableWithBlendName('Kyoto Garden\nLimited Edition'));
  assert.ok(errors.some((error) => /line break/.test(error)), errors.join('\n'));

  assert.ok(validate(tableWithBlendName('  Persian Sunrise ')).errors.some((e) => /whitespace/.test(e)));
  assert.ok(validate(tableWithBlendName('')).errors.some((e) => /non empty string/.test(e)));
  // A comma is allowed, because it is an ordinary name and the sheet now quotes it.
  assert.deepEqual(validate(tableWithBlendName('Kyoto Garden, Limited Edition')).errors, []);
});
