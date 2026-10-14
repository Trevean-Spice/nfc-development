#!/usr/bin/env node
/**
 * Compile the canonical redirect table into the Vercel configuration in dist/.
 *
 *   node scripts/build.mjs           write dist/
 *   node scripts/build.mjs --check   fail if dist/ has drifted from the table
 *
 * The --check form is what runs in CI. Its whole job is to make "somebody
 * edited the deployable file instead of the table" a build failure rather than
 * a thing discovered by a customer holding a jar.
 *
 * Three files are written and none of them is ever hand edited:
 *
 *   dist/vercel.json     the complete drop-in file for a project that has none
 *   dist/redirects.json  the redirects array on its own, to merge into a
 *                        project that already has a vercel.json
 *   dist/404.html        the branded not found page, for the project's site root
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { loadTable, summarise, PATHS, PACKAGE_ROOT, CANONICAL_TABLE_PATH } from '../lib/table.mjs';
import { compile, serialise } from '../lib/compile.mjs';

const check = process.argv.includes('--check');

const table = loadTable();
const config = compile(table);
const { vercelJson, redirectsFragment } = serialise(config);
const notFoundHtml = readFileSync(PATHS.notFound, 'utf8');
const counts = summarise(table);

const outputs = [
  [PATHS.distVercelJson, vercelJson],
  [PATHS.distRedirects, redirectsFragment],
  [PATHS.distNotFound, notFoundHtml]
];

const rel = (path) => relative(PACKAGE_ROOT, path).split('\\').join('/');

if (check) {
  const drifted = [];
  for (const [path, contents] of outputs) {
    if (!existsSync(path)) {
      drifted.push(`${rel(path)} is missing`);
    } else if (readFileSync(path, 'utf8') !== contents) {
      drifted.push(`${rel(path)} differs from what the table compiles to`);
    }
  }
  if (drifted.length > 0) {
    console.error('dist/ has drifted from the canonical redirect table.\n');
    for (const line of drifted) console.error(`  ${line}`);
    console.error('\nRun: npm run build');
    console.error('Never edit dist/ by hand, and never edit the mapping anywhere but the canonical table.');
    process.exit(1);
  }
  console.log('dist/ is in sync with the canonical redirect table.');
} else {
  for (const [path, contents] of outputs) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, 'utf8');
    console.log(`wrote ${rel(path)}`);
  }
}

console.log('');
console.log(`table            ${relative(PACKAGE_ROOT, CANONICAL_TABLE_PATH).split('\\').join('/')} (version ${table.version})`);
console.log(`codes            ${counts.codes}, of which ${counts.physicalTags} are on physical tags`);
console.log(`units encoded    ${counts.unitsEncoded.toLocaleString('en-GB')}`);
console.log(`reserved         ${counts.reservedNames.join(', ') || 'none'} (${counts.reservedCodes.join(', ') || 'none'}), carried by no jar in this run`);
console.log(`redirects        ${config.redirects.length}, all status ${table.redirectStatus}, all sources literal`);
console.log(`header rules     ${config.headers.length}`);
console.log(`vercel.json      ${Buffer.byteLength(vercelJson, 'utf8').toLocaleString('en-GB')} bytes`);
