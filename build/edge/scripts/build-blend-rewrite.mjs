// Compiles the /blend.html rewrite CloudFront Function from the canonical
// redirect table. Same single source of truth as the /t/ and /q/ function:
// this script never carries its own list of blends.
//
// Why this exists. The redirect sends a tap to /blend.html?blend={slug}, but
// the origin is a bucket, and a bucket does not vary its answer by query
// string. Without a rewrite, every code in the table lands on the same
// document, which is the "jar not recognised" page. That is a fast, correct
// looking 200 that is wrong for every blend, and it is exactly the failure
// mode the adjacent jar test exists to catch.
//
// The slug is matched against an allowlist rather than interpolated into a
// path. A slug taken from a query string and used to build a URI is a path
// traversal waiting to happen, and an allowlist makes that structurally
// impossible rather than filtered.

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const table = JSON.parse(readFileSync(join(root, 'redirect-table.json'), 'utf8'));
const entries = Array.isArray(table) ? table : table.entries;
if (!Array.isArray(entries) || entries.length === 0) {
  throw new Error('redirect-table.json produced no entries. Refusing to emit a function with an empty allowlist.');
}

const tableSlugs = [...new Set(entries.map((e) => e.blendSlug))].sort();
for (const s of tableSlugs) {
  if (!/^[a-z0-9-]+$/.test(s)) {
    throw new Error(`Slug ${JSON.stringify(s)} is not a safe path segment. Refusing to emit.`);
  }
}

// Only rewrite onto a page that actually exists. Rewriting onto a missing
// object makes the origin answer with a raw 403, which is an unbranded error
// on a customer's phone and is what SOW section 6.3 forbids. A slug with no
// page is better left alone: it falls through to /blend.html, which is the
// branded "jar not recognised" document.
//
// Observed on the first real deployment, Thursday 27 August 2026: /t/kg
// returned 403 because Kyoto Garden is reserved and has no built page.
const pagesDir = join(root, '..', 'web', 'out', 'blends');
let builtSlugs = [];
try {
  builtSlugs = readdirSync(pagesDir)
    .filter((f) => f.endsWith('.html'))
    .map((f) => f.slice(0, -'.html'.length));
} catch {
  throw new Error(
    `Cannot read built pages at ${pagesDir}. Run the web build first: the rewrite ` +
      `allowlist is the intersection of the redirect table and the pages that exist.`
  );
}

// The dangerous direction, and the reason this is an error rather than a warning:
// a code that is ENCODED ON PHYSICAL TAGS with no page behind it means jars in
// the field resolve to nothing. A reserved code with no page is harmless.
const encodedWithoutPage = entries
  .filter((e) => e.status === 'encoded' && !builtSlugs.includes(e.blendSlug))
  .map((e) => `${e.code} (${e.blendSlug}, ${e.unitsEncoded} units encoded)`);
if (encodedWithoutPage.length > 0) {
  throw new Error(
    `Encoded tag codes have no built page: ${encodedWithoutPage.join(', ')}. ` +
      `Those are physical jars that would resolve to an error. Build the pages or ` +
      `correct the table before deploying.`
  );
}

const slugs = tableSlugs.filter((s) => builtSlugs.includes(s));
const skipped = tableSlugs.filter((s) => !builtSlugs.includes(s));

const fn = `// GENERATED from redirect-table.json by scripts/build-blend-rewrite.mjs
// Do not edit. Run: npm run build:blend-rewrite
//
// Rewrites /blend.html?blend={slug} onto the pre-rendered document for that
// blend. An unknown or absent slug is left alone and falls through to the
// "jar not recognised" page, which is the correct branded outcome.
var PAGES = ${JSON.stringify(Object.fromEntries(slugs.map((s) => [s, '/blends/' + s + '.html'])), null, 2)};

function handler(event) {
  var request = event.request;
  var qs = request.querystring;
  var blend = qs && qs.blend && qs.blend.value;
  if (blend && Object.prototype.hasOwnProperty.call(PAGES, blend)) {
    request.uri = PAGES[blend];
  }
  return request;
}
`;

mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist', 'blend-rewrite.js');
writeFileSync(out, fn, 'utf8');

const bytes = Buffer.byteLength(fn, 'utf8');
if (bytes > 10240) throw new Error(`Function is ${bytes} bytes, over the 10240 CloudFront limit.`);
console.log(`blend-rewrite.js written, ${bytes} bytes, ${slugs.length} slugs: ${slugs.join(', ')}`);
if (skipped.length > 0) {
  console.log(`  not rewritten, no built page, falls through to the branded page: ${skipped.join(', ')}`);
}
