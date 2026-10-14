/**
 * The build step, and the guarantees it refuses to emit a configuration without.
 *
 * These tests protect the property in "M1 Deliverable 2: Data model",
 * section 7.1: one version-controlled source of truth, derived artifacts, none
 * of them hand edited. This package is a second serving surface for the same
 * table, added because the client approved serving the five tag routes through
 * Vercel now rather than waiting on the AWS environment. Two surfaces raise the
 * odds of a second copy, so the checks here are stricter than the CloudFront
 * package's rather than looser.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadTable, summarise, PATHS, PACKAGE_ROOT, CANONICAL_TABLE_PATH } from '../lib/table.mjs';
import { compile, serialise, REDIRECT_STATUS, REDIRECT_CACHE_CONTROL } from '../lib/compile.mjs';
import { casings, sourcesFor, sourcesPerRow, isLiteralSource, SUFFIXES } from '../lib/variants.mjs';
import {
  CODES,
  CODE_TO_SLUG,
  ON_PHYSICAL_TAGS,
  RESERVED,
  TOTAL_UNITS_ENCODED,
  UNITS_PER_ENCODED_CODE,
  EXPECTED_LOCATION,
  EXPECTED_QR_LOCATION
} from './expectations.mjs';

const table = loadTable();
const compiled = compile(table);

// ---------------------------------------------------------------------------
// One source of truth, in the other package
// ---------------------------------------------------------------------------

test('this package carries no redirect table of its own', () => {
  // The failure mode with no visible symptom on the deploying side. A second
  // table does not break a deployment. It strands jars, and nobody finds out
  // from a dashboard. "M1 Deliverable 3", section 6, failure mode 2.
  for (const candidate of ['redirect-table.json', 'table.json', 'redirects.json', 'codes.json']) {
    assert.ok(!existsSync(join(PACKAGE_ROOT, candidate)), `${candidate} is a second copy of the load-bearing artifact`);
  }
});

test('the canonical table is the one in the edge package', () => {
  assert.ok(CANONICAL_TABLE_PATH.split(/[\\/]/).slice(-2).join('/') === 'edge/redirect-table.json');
  assert.ok(existsSync(CANONICAL_TABLE_PATH));
});

test('loading a table that is not there fails loudly rather than serving nothing', () => {
  assert.throws(() => loadTable(join(PACKAGE_ROOT, 'no-such-table.json')), /single source of truth/);
});

test('dist/vercel.json is exactly what the table compiles to', () => {
  assert.equal(
    readFileSync(PATHS.distVercelJson, 'utf8'),
    serialise(compiled).vercelJson,
    'dist/ has drifted from the table. Run npm run build. Never edit dist/ by hand.'
  );
});

test('dist/redirects.json is exactly the redirects array from the same compile', () => {
  assert.equal(readFileSync(PATHS.distRedirects, 'utf8'), serialise(compiled).redirectsFragment);
});

test('dist/404.html is exactly the page in src', () => {
  assert.equal(readFileSync(PATHS.distNotFound, 'utf8'), readFileSync(PATHS.notFound, 'utf8'));
});

test('the fragment and the whole file agree, so merging cannot diverge from dropping in', () => {
  const whole = JSON.parse(readFileSync(PATHS.distVercelJson, 'utf8'));
  const fragment = JSON.parse(readFileSync(PATHS.distRedirects, 'utf8'));
  assert.deepEqual(fragment, whole.redirects);
});

test('the compiled destinations come from the table and from nowhere else', () => {
  const fromTable = new Set(table.entries.flatMap((entry) => [entry.targetPath, entry.qrTargetPath]));
  for (const redirect of compiled.redirects) {
    assert.ok(fromTable.has(redirect.destination), `${redirect.destination} is not in the canonical table`);
  }
  const emitted = new Set(compiled.redirects.map((redirect) => redirect.destination));
  assert.equal(emitted.size, fromTable.size, 'a table row is not being served');
});

// ---------------------------------------------------------------------------
// The table agrees with the contract documents, checked independently
// ---------------------------------------------------------------------------

test('the table serves the five codes in Scope, section "Tag code map", and no others', () => {
  assert.deepEqual(table.entries.map((entry) => entry.code).sort(), [...CODES].sort());
});

test('every code points at the blend Scope says it points at', () => {
  for (const entry of table.entries) {
    assert.equal(entry.blendSlug, CODE_TO_SLUG[entry.code], `code ${entry.code} points at the wrong blend`);
  }
});

test('five blends, not six', () => {
  // Confirmed by the client on 25 August 2026. A sixth row would mean a code
  // nothing is encoded with and a page nothing links to.
  assert.equal(table.entries.length, 5);
  assert.equal(new Set(table.entries.map((entry) => entry.blendSlug)).size, 5);
});

test('four codes are on physical tags and the fifth is reserved', () => {
  const counts = summarise(table);
  assert.equal(counts.physicalTags, ON_PHYSICAL_TAGS.length);
  assert.deepEqual(counts.reservedCodes, RESERVED);
  assert.equal(counts.unitsEncoded, TOTAL_UNITS_ENCODED);
  for (const code of ON_PHYSICAL_TAGS) {
    assert.equal(table.entries.find((entry) => entry.code === code).unitsEncoded, UNITS_PER_ENCODED_CODE);
  }
  assert.equal(table.entries.find((entry) => entry.code === RESERVED[0]).unitsEncoded, 0);
});

test('the reserved code is still served, because someone will type it', () => {
  assert.equal(compiled.redirects.filter((redirect) => redirect.source === `/t/${RESERVED[0]}`).length, 1);
  assert.equal(compiled.redirects.filter((redirect) => redirect.source === `/q/${RESERVED[0]}`).length, 1);
});

test('the compiled destinations match the strings transcribed from the deliverables', () => {
  for (const code of CODES) {
    const tap = compiled.redirects.find((redirect) => redirect.source === `/t/${code}`);
    const qr = compiled.redirects.find((redirect) => redirect.source === `/q/${code}`);
    assert.equal(tap.destination, EXPECTED_LOCATION[code]);
    assert.equal(qr.destination, EXPECTED_QR_LOCATION[code]);
  }
});

// ---------------------------------------------------------------------------
// Shape and size of the compiled configuration
// ---------------------------------------------------------------------------

test('the configuration declares redirects and headers and nothing else', () => {
  assert.deepEqual(Object.keys(compiled).sort(), ['headers', 'redirects']);
});

test('the configuration declares no routes key, which would forbid the other three', () => {
  // Vercel rejects a vercel.json that carries routes alongside redirects,
  // headers, rewrites, cleanUrls or trailingSlash. Using routes would take the
  // client's existing configuration hostage.
  const source = readFileSync(PATHS.distVercelJson, 'utf8');
  assert.ok(!source.includes('"routes"'));
  assert.ok(!source.includes('"rewrites"'));
  assert.ok(!source.includes('"cleanUrls"'));
  assert.ok(!source.includes('"trailingSlash"'), 'trailingSlash is a site wide setting and would change the marketing site');
});

test('the configuration declares no function, no middleware and no runtime', () => {
  // The property the original decision was chosen for: the tap path touches no
  // compute. "M1 Deliverable 3", section 3, option A.
  const source = readFileSync(PATHS.distVercelJson, 'utf8');
  for (const forbidden of ['"functions"', '"middleware"', '"runtime"', '"crons"', '"builds"']) {
    assert.ok(!source.includes(forbidden), `the configuration declares ${forbidden}`);
  }
  assert.ok(!existsSync(join(PACKAGE_ROOT, 'middleware.js')));
  assert.ok(!existsSync(join(PACKAGE_ROOT, 'middleware.ts')));
  assert.ok(!existsSync(join(PACKAGE_ROOT, 'dist', 'middleware.js')));
});

test('the redirect count is exactly sixteen paths per code per route', () => {
  assert.equal(sourcesPerRow('ps'), 16);
  assert.equal(compiled.redirects.length, CODES.length * 2 * 16);
  assert.equal(compiled.redirects.length, 160);
});

test('the configuration stays well inside a sane route budget', () => {
  // Vercel compiles redirects and headers into routes. This is not near any
  // documented ceiling, and the assertion exists so that a future per tag table,
  // which "M1 Deliverable 3", section 5 already anticipates, fails here rather
  // than at deploy time on the client's live site.
  assert.ok(compiled.redirects.length + compiled.headers.length < 512, 'the configuration is getting large enough to need a different mechanism');
});

// ---------------------------------------------------------------------------
// Every source is literal, which is what makes the router model exact
// ---------------------------------------------------------------------------

test('every redirect source is a literal path with no pattern syntax', () => {
  for (const redirect of compiled.redirects) {
    assert.ok(isLiteralSource(redirect.source), `${redirect.source} is not literal`);
  }
});

test('the literal source check rejects the pattern that would have been shorter', () => {
  assert.ok(!isLiteralSource('/:route(t|T)/:code(ps|PS)'));
  assert.ok(!isLiteralSource('/t/(.*)'));
  assert.ok(!isLiteralSource('/t/:code'));
  assert.ok(!isLiteralSource('/t/ps*'));
  assert.ok(isLiteralSource('/t/ps'));
  assert.ok(isLiteralSource('/T/PS/'));
});

test('the enumeration covers both route casings, all four code casings and both trailing forms', () => {
  const sources = sourcesFor('t', 'ps');
  assert.deepEqual(sources.sort(), [
    '/T/PS', '/T/PS/', '/T/Ps', '/T/Ps/', '/T/pS', '/T/pS/', '/T/ps', '/T/ps/',
    '/t/PS', '/t/PS/', '/t/Ps', '/t/Ps/', '/t/pS', '/t/pS/', '/t/ps', '/t/ps/'
  ].sort());
});

test('casings returns the canonical lowercase form first and never repeats', () => {
  assert.equal(casings('ps')[0], 'ps');
  assert.equal(casings('ps').length, 4);
  assert.equal(new Set(casings('ps')).size, 4);
  assert.deepEqual(SUFFIXES, ['', '/']);
});

// ---------------------------------------------------------------------------
// What the build refuses to emit
// ---------------------------------------------------------------------------

test('the build refuses a table that is not 307', () => {
  for (const status of [301, 302, 308]) {
    const wrong = structuredClone(table);
    wrong.redirectStatus = status;
    assert.throws(() => compile(wrong), /Only 307 is permitted/);
  }
});

test('the build refuses a transposed row', () => {
  const transposed = structuredClone(table);
  transposed.entries.find((entry) => entry.code === 'cs').targetPath = '/blend.html?blend=silk-road&via=nfc';
  assert.throws(() => compile(transposed), /does not carry blend=caribbean-sunset/);
});

test('the build refuses a row whose two routes reach different blends', () => {
  const split = structuredClone(table);
  split.entries.find((entry) => entry.code === 'ps').qrTargetPath = '/blend.html?blend=silk-road&via=qr';
  assert.throws(() => compile(split), /does not carry blend=persian-sunrise|two different destinations/);
});

test('the build refuses a tap target that lost via=nfc', () => {
  const wrong = structuredClone(table);
  wrong.entries.find((entry) => entry.code === 'ps').targetPath = '/blend.html?blend=persian-sunrise&via=tap';
  assert.throws(() => compile(wrong), /via=nfc/);
});

test('the build refuses a QR target that would be attributed as a tap', () => {
  const wrong = structuredClone(table);
  for (const entry of wrong.entries) entry.qrTargetPath = entry.targetPath;
  assert.throws(() => compile(wrong), /two different destinations|via=qr/);
});

test('the build refuses an absolute destination', () => {
  const wrong = structuredClone(table);
  wrong.entries.find((entry) => entry.code === 'ps').targetPath = 'https://treveanspice.com/blend.html?blend=persian-sunrise&via=nfc';
  assert.throws(() => compile(wrong), /relative same origin path/);
});

test('the build refuses a destination carrying an extra parameter', () => {
  const wrong = structuredClone(table);
  wrong.entries.find((entry) => entry.code === 'ps').targetPath = '/blend.html?blend=persian-sunrise&via=nfc&utm_source=nfc';
  assert.throws(() => compile(wrong), /parameters/);
});

test('the build refuses a destination whose parameters are in the wrong order', () => {
  const wrong = structuredClone(table);
  wrong.entries.find((entry) => entry.code === 'ps').targetPath = '/blend.html?via=nfc&blend=persian-sunrise';
  assert.throws(() => compile(wrong), /parameters/);
});

test('the build refuses a blend slug that is not one of the five', () => {
  const wrong = structuredClone(table);
  const entry = wrong.entries.find((item) => item.code === 'ps');
  entry.blendSlug = 'persian-sunset';
  entry.targetPath = '/blend.html?blend=persian-sunset&via=nfc';
  entry.qrTargetPath = '/blend.html?blend=persian-sunset&via=qr';
  assert.throws(() => compile(wrong), /not one of the\s+five blends|not one of the five blends/);
});

test('the build refuses a duplicate code', () => {
  const wrong = structuredClone(table);
  wrong.entries.push(structuredClone(wrong.entries[0]));
  assert.throws(() => compile(wrong), /appears twice/);
});

test('the build refuses a code that is not two lowercase letters', () => {
  for (const code of ['PS', 'p', 'pss', 'p1', 'p-']) {
    const wrong = structuredClone(table);
    wrong.entries[0].code = code;
    assert.throws(() => compile(wrong), /two lowercase letters/);
  }
});

test('the build refuses an empty table rather than emitting a configuration that serves nothing', () => {
  assert.throws(() => compile({ redirectStatus: 307, entries: [] }), /serves nothing/);
});

test('the cache directive is the one the specification names', () => {
  assert.equal(REDIRECT_CACHE_CONTROL, 'no-store');
  assert.equal(REDIRECT_STATUS, 307);
});

test('the compile is deterministic, so the drift check means something', () => {
  assert.deepEqual(compile(table), compile(loadTable()));
  assert.equal(serialise(compile(table)).vercelJson, serialise(compiled).vercelJson);
});
