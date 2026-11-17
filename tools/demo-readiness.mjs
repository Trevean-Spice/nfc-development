#!/usr/bin/env node
/**
 * What is provably working, right now, on the real domain.
 *
 * WHY THIS EXISTS. The dress rehearsal is Wednesday 23 September 2026 and the demo
 * is Sunday 27 September 2026. In the five days before this was written the live
 * state changed four times: the jars went from 404, to a dead `www`, to working, and
 * `www` itself disappeared twice. **Nobody should walk into either room holding a
 * belief about the system that is five days old.**
 *
 * It checks the customer path the way a customer meets it, from outside, with no
 * credentials. Everything it reports is measured in the moment it runs.
 *
 *   node tools/demo-readiness.mjs
 *   node tools/demo-readiness.mjs --base https://<TREVEAN_DISTRIBUTION_DOMAIN>
 *
 * <TREVEAN_DISTRIBUTION_DOMAIN> and <TREVEAN_PREFIX_SUFFIX> are placeholders; the
 * real values are in Trevean's private record, not in this public repository.
 *
 * Exit 0 if every blocking check passes, 1 otherwise. A WARN never fails the run:
 * warnings are things to know before standing up, not reasons to stop.
 *
 * WHAT IT CANNOT TELL YOU, and both matter more than anything it can:
 *
 *   1. **Whether the right blend appears on screen.** The destination renders in the
 *      browser from the query string, so every code returns a byte identical page to
 *      a script. A transposed blend is invisible here and visible instantly on a
 *      handset. See "Decision log", D55.
 *   2. **Whether a tag reads through an 8 mm bamboo lid.** No HTTP check touches the
 *      physical layer. That is the tap test, it is the M2 gate, and it has never run.
 */

import { readFileSync } from 'node:fs';

const DEFAULT_BASE = 'https://treveanspice.com';
const TIMEOUT_MS = 20000;

const CODES = [
  ['ps', 'persian-sunrise', 'Persian Sunrise'],
  ['cs', 'caribbean-sunset', 'Caribbean Sunset'],
  ['sr', 'silk-road', 'The Silk Road'],
  ['nm', 'north-african-night-market', 'North African Night Market'],
];

// Every slug in the redirect table, reserved ones included: a tap lands on
// /blend.html?blend={slug}&via=nfc for each of them.
const TABLE_SLUGS = JSON.parse(
  readFileSync(new URL('../build/edge/redirect-table.json', import.meta.url), 'utf8'),
).entries.map((e) => e.blendSlug);

// Our S3 page carries this marker. Dan's Vercel page does not (live regression 11-04).
const PLACEHOLDER = 'Placeholder content, not for release';

const args = process.argv.slice(2);
const baseIdx = args.indexOf('--base');
const BASE = (baseIdx >= 0 ? args[baseIdx + 1] : DEFAULT_BASE).replace(/\/$/, '');

const results = [];
const record = (level, name, detail) => results.push({ level, name, detail });

async function head(url, redirect = 'manual') {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { redirect, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function checkTagRoute(prefix, via, code, slug, label) {
  const url = `${BASE}/${prefix}/${code}`;
  let res;
  try {
    res = await head(url);
  } catch (err) {
    record('FAIL', `${prefix}/${code}`, `request failed: ${err.message}. A customer tapping this jar gets nothing.`);
    return;
  }

  if (res.status !== 307) {
    record('FAIL', `${prefix}/${code}`, `status ${res.status}, expected 307. ${label} does not resolve.`);
    return;
  }

  const loc = res.headers.get('location') || '';
  if (!loc.includes(`blend=${slug}`)) {
    record('FAIL', `${prefix}/${code}`, `redirects to "${loc}", which does not carry blend=${slug}.`);
    return;
  }
  if (!loc.includes(`via=${via}`)) {
    record('WARN', `${prefix}/${code}`, `redirects correctly but via=${via} is missing, so this scan attributes wrongly.`);
    return;
  }

  // Follow it. A correct redirect into a broken page is still a broken jar.
  let final;
  try {
    final = await head(`${BASE}${loc.startsWith('/') ? loc : `/${loc}`}`, 'follow');
  } catch (err) {
    record('FAIL', `${prefix}/${code}`, `redirect is correct but the destination failed: ${err.message}`);
    return;
  }
  if (!final.ok) {
    record('FAIL', `${prefix}/${code}`, `redirect is correct but the destination returned ${final.status}.`);
    return;
  }

  record('PASS', `${prefix}/${code}`, `307 to ${slug}, destination ${final.status}. ${label}.`);
}

async function checkBlendPage(slug) {
  const url = `${BASE}/blend.html?blend=${slug}&via=nfc`;
  try {
    const res = await head(url, 'follow');
    const body = await res.text();
    if (body.includes(PLACEHOLDER)) {
      record('FAIL', `blend/${slug}`, `serves "${PLACEHOLDER}", our page and not Dan's. A tap lands on placeholder copy.`);
    } else {
      record('PASS', `blend/${slug}`, `${res.status}, no placeholder copy.`);
    }
  } catch (err) {
    record('FAIL', `blend/${slug}`, `request failed: ${err.message}`);
  }
}

async function checkBranded404() {
  try {
    const res = await head(`${BASE}/t/zz`, 'follow');
    const body = await res.text();
    const branded = /trevean/i.test(body);
    if (res.status === 404 && branded) {
      record('PASS', 'unknown code', 'returns a branded 404.');
    } else if (res.status === 404) {
      record(
        'WARN',
        'unknown code',
        'returns 404 but not the branded page. SOW 6.3 wants a branded response. Fix is waiting in pull request 2. Do not demonstrate a mistyped code.',
      );
    } else {
      record('FAIL', 'unknown code', `returned ${res.status}, expected 404.`);
    }
  } catch (err) {
    record('WARN', 'unknown code', `could not check: ${err.message}`);
  }
}

async function checkApexChain() {
  try {
    const res = await head(`${BASE}/t/ps`, 'follow');
    record(
      res.ok ? 'PASS' : 'FAIL',
      'full chain',
      `${BASE}/t/ps settles at ${res.url} with ${res.status}.`,
    );
  } catch (err) {
    record('FAIL', 'full chain', `the end to end path failed: ${err.message}`);
  }
}

const HUMAN = {
  PASS: 'PASS',
  WARN: 'WARN',
  FAIL: 'FAIL',
};

(async () => {
  console.log(`Demo readiness against ${BASE}\n`);

  for (const [code, slug, label] of CODES) await checkTagRoute('t', 'nfc', code, slug, label);
  for (const [code, slug, label] of CODES) await checkTagRoute('q', 'qr', code, slug, label);
  for (const slug of TABLE_SLUGS) await checkBlendPage(slug);
  await checkBranded404();
  await checkApexChain();

  const width = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    console.log(`  ${HUMAN[r.level]}  ${r.name.padEnd(width)}  ${r.detail}`);
  }

  const fails = results.filter((r) => r.level === 'FAIL');
  const warns = results.filter((r) => r.level === 'WARN');

  console.log('');
  console.log(`  ${results.filter((r) => r.level === 'PASS').length} passing, ${warns.length} warning, ${fails.length} failing`);

  console.log('');
  console.log('NOT CHECKED HERE, AND BOTH MATTER MORE THAN ANYTHING ABOVE:');
  console.log('  1. Whether the correct blend appears on screen. The page renders in the');
  console.log('     browser, so every code looks identical to this script. Tap a jar.');
  console.log('  2. Whether a tag reads through the 8 mm lid at all. That is the tap test');
  console.log('     and it has never been run.');
  console.log('');
  console.log('BEFORE SHOWING THE ANALYTICS SCREEN TO ANYBODY:');
  console.log('  The dev table carries synthetic rollup rows, every one tagged synthetic.');
  console.log('  Purge them or the dashboard shows invented numbers indistinguishable');
  console.log('  from sales:');
  console.log('    cd build/api && node tools/seed-rollups.mjs \\');
  console.log('      --table trevean-dev-<TREVEAN_PREFIX_SUFFIX>-ScanEvents --purge');

  process.exit(fails.length > 0 ? 1 : 0);
})();
