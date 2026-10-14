#!/usr/bin/env node
/**
 * Trevean Spice NFC. Blend slugs against the canonical redirect table.
 *
 * Destination: scripts/ci/assert-slugs.mjs
 * Runs in the Guards job of .github/workflows/ci.yml. No dependency install required, so
 * it still reports when the dependency tree is broken.
 *
 * WHY THIS EXISTS
 *
 * One thousand ST25TV02KC tags were encoded on 24 July 2026 and shipped. Each carries a
 * fixed URI of the form https://treveanspice.com/t/{code}, and /t/sr resolves to the
 * blend slug silk-road. The tags cannot be changed. Therefore the application must not
 * drift, and this repository had already drifted: three separate blend datasets said
 * the-silk-road, one hyphenated word away from correct, in the file the rest of the
 * codebase imports from.
 *
 * The failure mode is the reason this check is worth a CI job of its own: a wrong slug is
 * silent. Nothing crashes, no test goes red, no log line appears. It surfaces when a
 * customer taps a jar and gets a 404, and under the acceptance criteria, section 6.1,
 * "correct destination", a 404 fails regardless of speed.
 *
 * SOURCE OF TRUTH
 *
 * config/redirect-table.json, a copy of the canonical table maintained in the Serene Labs
 * edge package (build/edge/redirect-table.json). The copy is temporary: when the edge
 * package is transplanted into this repository, delete the copy and point REDIRECT_TABLE
 * below at the real file. The check itself does not change.
 *
 * No dependencies. Node standard library only.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const REDIRECT_TABLE = 'config/redirect-table.json';

/* Slug spellings that are known wrong and must appear nowhere in tracked source. Each */
/* carries the reason, so a failure explains itself without anyone opening this file.  */
const FORBIDDEN = [
  [
    'the-silk-road',
    'The canonical slug is silk-road. /t/sr resolves to /blend.html?blend=silk-road&via=nfc ' +
      'on 250 encoded and shipped tags. This spelling was present in three disagreeing blend ' +
      'datasets in this repository and was found independently by three auditors.',
  ],
];

/* Files where the five slugs must all be present, because they define the blend set. */
const CANONICAL_SOURCES = ['src/shared/constants/index.ts'];

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'coverage', '.git', 'budget-artifacts']);
const SCAN_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.md', '.sh', '.yml', '.yaml']);

const failures = [];

if (!existsSync(REDIRECT_TABLE)) {
  console.error('');
  console.error(`FAIL: the canonical redirect table is not in this repository at ${REDIRECT_TABLE}.`);
  console.error('');
  console.error('Without it there is nothing to check the application slugs against, and the');
  console.error('check would pass by having no opinion. The redirect table is described in the');
  console.error('Architecture document, section "The redirect table", as the load-bearing');
  console.error('artifact of the whole design.');
  console.error('');
  console.error('Fix: copy redirect-table.json from the edge package into config/.');
  process.exit(1);
}

const table = JSON.parse(readFileSync(REDIRECT_TABLE, 'utf8'));
const canonicalSlugs = table.entries.map((e) => e.blendSlug);

console.log(`Canonical slugs, from ${REDIRECT_TABLE} version ${table.version}:`);
for (const e of table.entries) {
  console.log(`  /t/${e.code}  ->  ${e.blendSlug}  (${e.status}, ${e.unitsEncoded} units encoded)`);
}
console.log('');

/* ------------------------------------------------------- the redirect status is 307 -- */

if (table.redirectStatus !== 307) {
  failures.push(
    `The redirect table declares redirectStatus ${table.redirectStatus}. It must be 307. ` +
      'A permanent redirect is cached by the handset and removes the ability to repoint a ' +
      'blend by editing this table, which is the entire reason the redirect exists.'
  );
}

/* --------------------------------------------------------------- forbidden spellings -- */

const walk = (dir) => {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (SCAN_EXT.has(extname(p))) out.push(p);
  }
  return out;
};

const selfPath = 'scripts/ci/assert-slugs.mjs';
const files = walk('.').filter((f) => !f.endsWith('assert-slugs.mjs') && f !== selfPath);

for (const [bad, why] of FORBIDDEN) {
  const hits = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (line.includes(bad)) hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  if (hits.length) {
    failures.push(
      `The forbidden slug "${bad}" appears ${hits.length} time(s).\n  ${why}\n` +
        hits.map((h) => `    ${h}`).join('\n')
    );
  }
}

/* ---------------------------------------------- every canonical slug is defined here -- */

for (const source of CANONICAL_SOURCES) {
  if (!existsSync(source)) {
    failures.push(`${source} does not exist, so the canonical blend set is defined nowhere.`);
    continue;
  }
  const src = readFileSync(source, 'utf8');
  const missing = canonicalSlugs.filter((s) => !src.includes(s));
  if (missing.length) {
    failures.push(
      `${source} does not mention ${missing.length} canonical slug(s): ${missing.join(', ')}. ` +
        'Every code in the redirect table must resolve to a blend this application knows ' +
        'about, including the reserved fifth, or a tap lands on a page that does not exist.'
    );
  }
}

/* ---------------------------------------------------------------------- report -- */

if (failures.length === 0) {
  console.log(`Slug guard passed: ${canonicalSlugs.length} canonical slugs, no forbidden spellings.`);
  process.exit(0);
}

console.error('');
console.error(`SLUG GUARD FAILED. ${failures.length} problem(s).`);
console.error('');
for (const [i, f] of failures.entries()) console.error(`${i + 1}. ${f}\n`);
console.error('The tags cannot change. One thousand were encoded on 24 July 2026 and shipped,');
console.error('so when the application and the tags disagree it is always the application that');
console.error('moves. This check is the only place that disagreement can be caught before a');
console.error('customer taps a jar.');
process.exit(1);
