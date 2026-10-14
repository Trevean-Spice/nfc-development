#!/usr/bin/env node
/**
 * Compile the canonical redirect table into every artifact derived from it.
 *
 *   node scripts/build.mjs            write dist/
 *   node scripts/build.mjs --check    write nothing, exit 1 if dist/ has drifted
 *
 * --check is what CI runs. It is the guard against the one thing this package
 * exists to make impossible: a second, hand edited copy of the table living in
 * dist/redirect.js or in a hosting console.
 *
 * The build fails, loudly and before anything can be deployed, if the compiled
 * function exceeds the CloudFront Functions 10 KB code limit.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { relative, dirname } from 'node:path';
import { PATHS, PACKAGE_ROOT, MAX_FUNCTION_BYTES, loadTable, summarise } from '../lib/table.mjs';
import { compile, collapseHtml } from '../lib/compile.mjs';
import { validate } from '../lib/validate.mjs';
import { previousTable } from '../lib/previous.mjs';
import { nfcTagsSeed, tagEncodingCsv, qrArtworkCsv } from '../lib/derive.mjs';

const check = process.argv.includes('--check');
const rel = (p) => relative(PACKAGE_ROOT, p).split('\\').join('/');

const table = loadTable();
const previous = previousTable();

const { errors, warnings } = validate(table, { previous: previous.table });
if (errors.length > 0) {
  console.error('Table validation failed. Nothing was written.\n');
  for (const error of errors) console.error(`  FAIL  ${error}`);
  console.error('');
  process.exit(1);
}
for (const warning of warnings) console.warn(`  warn  ${warning}`);

const notFoundHtml = collapseHtml(readFileSync(PATHS.notFound, 'utf8'));

let compiled;
try {
  compiled = compile(table);
} catch (error) {
  console.error(`Compile failed. Nothing was written.\n\n  ${error.message}\n`);
  process.exit(1);
}
for (const warning of compiled.warnings) console.warn(`  warn  ${warning}`);

const artifacts = [
  [PATHS.distFunction, compiled.source],
  [PATHS.distSeed, `${JSON.stringify(nfcTagsSeed(table, notFoundHtml), null, 2)}\n`],
  [PATHS.distEncoding, tagEncodingCsv(table)],
  [PATHS.distQrArtwork, qrArtworkCsv(table)]
];

const drifted = artifacts
  .filter(([path, contents]) => (existsSync(path) ? readFileSync(path, 'utf8') : null) !== contents)
  .map(([path]) => rel(path));

if (check && drifted.length > 0) {
  console.error('Build artifacts have drifted from redirect-table.json.\n');
  for (const path of drifted) console.error(`  FAIL  ${path} is not what the table compiles to`);
  console.error('\nRun `npm run build` and commit the result. Do not edit dist/ by hand:');
  console.error('the table is the single source of truth and dist/ is output.\n');
  process.exit(1);
}

if (!check) {
  for (const [path, contents] of artifacts) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, 'utf8');
  }
}

const counts = summarise(table);
const percent = ((compiled.bytes / MAX_FUNCTION_BYTES) * 100).toFixed(1);
const reserved = counts.reservedCodes.length > 0 ? counts.reservedCodes.join(', ') : 'none';

console.log('');
console.log(`  table id        ${compiled.tableId}`);
console.log(`  codes           ${counts.codes}, of which ${counts.physicalTags} are on physical tags (reserved: ${reserved})`);
console.log(`  routes          /t/{code} tap (via=nfc), /q/{code} on-pack QR (via=qr), same destination page`);
console.log(`  units encoded   ${counts.unitsEncoded}`);
console.log(`  function size   ${compiled.bytes} bytes, ${percent}% of the ${MAX_FUNCTION_BYTES} byte limit`);
console.log(`  repoint check   ${previous.reason}`);
console.log(`  artifacts       ${artifacts.map(([p]) => rel(p)).join(', ')}`);
console.log(check ? '  result          dist/ is in sync with the table' : `  written         ${drifted.length > 0 ? drifted.join(', ') : 'no change'}`);
console.log('');
