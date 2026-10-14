#!/usr/bin/env node
/**
 * End to end verification of every /t/{code} and /q/{code} against a live
 * deployment.
 *
 * This is the script to run the moment treveanspice.com points at Vercel. It
 * asks the deployed host the same questions the test suite asks the compiled
 * configuration, and it is the only thing in this package that can tell you
 * whether the configuration was actually adopted.
 *
 * It is written to be operable by somebody who did not write it. Every failing
 * cell is followed by a sentence saying what it means and what it costs.
 *
 * USAGE
 *
 *   Against the client's Vercel project, before DNS moves:
 *     node scripts/verify-live.mjs --base https://trevean-spice-website.vercel.app
 *
 *   Against the real domain, after DNS moves:
 *     node scripts/verify-live.mjs --base https://treveanspice.com
 *
 *   Before /blend.html has real content, or when you only care about the redirect:
 *     node scripts/verify-live.mjs --base https://treveanspice.com --no-follow
 *
 *   Options:
 *     --base URL     required. Scheme and host of the thing under test.
 *     --host NAME    override the Host header and the TLS server name.
 *     --no-follow    do not fetch the destination page.
 *     --quick        canonical paths only. Skips the casing and trailing slash
 *                    sweep, which is 150 extra requests.
 *     --timeout MS   per request, default 10000.
 *     --json         machine readable output in addition to the table.
 *
 * EXIT CODE
 *   0  every check passed, or passed with notes.
 *   1  at least one check failed. Do not tell the client the tags work.
 *   2  the script was invoked wrongly.
 *
 * A NOTE IS NOT A FAILURE
 *   A NOTE is something Vercel does that the CloudFront implementation did not,
 *   where the difference is real and worth reading but does not send anybody to
 *   the wrong blend. The two expected ones are the query string passthrough and
 *   the client rendered destination page. Both are explained in the README,
 *   section 5. Read them once, then treat them as known.
 */

import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { loadTable, summarise, ROUTES } from '../lib/table.mjs';
import { sourcesFor } from '../lib/variants.mjs';
import {
  PASS,
  NOTE,
  FAIL,
  worst,
  checkStatus,
  checkLocation,
  checkCacheControl,
  checkDestinationBody,
  checkQueryPassthrough,
  checkUnknown
} from '../lib/checks.mjs';
import { REDIRECT_STATUS } from '../lib/compile.mjs';

/** A code that is in no table and never will be. Two letters, so shape alone cannot reject it. */
const UNKNOWN_CODE = 'zz';

/** Parameters appended to one probe request, to see whether Vercel passes them through. */
const PROBE_KEYS = ['utm_source', 'fbclid'];

const options = parseArgs(process.argv.slice(2));
if (!options.base) {
  console.error('Missing --base.\n');
  console.error('  node scripts/verify-live.mjs --base https://treveanspice.com\n');
  console.error('Read the header of this file for the rest of the options.');
  process.exit(2);
}

const table = loadTable();
const counts = summarise(table);
const base = new URL(options.base);
const hostHeader = options.host || base.hostname;
const allBlendNames = table.entries.map((entry) => entry.blendName);

console.log('Trevean Spice, /t/{code} and /q/{code} redirect verification, Vercel');
console.log(`  base            ${base.origin}`);
console.log(`  host header     ${hostHeader}`);
console.log(`  table           build/edge/redirect-table.json, version ${table.version}`);
console.log(`  expecting       ${REDIRECT_STATUS} on every code, on both routes`);
console.log(`  destination     ${options.follow ? 'fetched and checked' : 'not fetched (--no-follow)'}`);
console.log(`  variants        ${options.quick ? 'canonical paths only (--quick)' : 'all casings and trailing slashes'}`);
console.log(`  started         ${new Date().toISOString()}`);
console.log('');

const rows = [];

// The canonical paths first: /t/ps is the exact string on the shipped jars, and
// it is the only one that has to work for the inventory already in kitchens.
for (const route of ROUTES) {
  for (const entry of table.entries) {
    rows.push(await checkOneCode(entry, route));
  }
}

// The one guarantee that does not carry over from CloudFront, probed rather than
// assumed. See the README, section 5.
rows.push(await checkQuery(table.entries[0]));

// An unknown code must land on the branded not found page, never a redirect and
// never the home page.
for (const route of ROUTES) {
  rows.push(await checkUnknownCode(route));
}

report(rows);

// The normalisation sweep is reported as a count rather than as 150 more table
// rows, because a wall of identical PASS lines is a wall nobody reads.
let sweep = null;
if (!options.quick) {
  sweep = await sweepVariants();
}

const failed = rows.filter((row) => row.result === FAIL);
const noted = rows.filter((row) => row.result === NOTE);

console.log('');
console.log(`${rows.length - failed.length} of ${rows.length} checks pass, ${noted.length} with notes.`);
if (sweep) {
  console.log(
    `${sweep.passed} of ${sweep.total} casing and trailing slash variants resolve to the same destination as the canonical path.`
  );
}
console.log(
  `${counts.codes} codes exist and ${counts.physicalTags} are on physical tags (${counts.unitsEncoded.toLocaleString('en-GB')} jars). ` +
    `Reserved, carried by no jar in this run: ${counts.reservedCodes.join(', ') || 'none'}.`
);

if (noted.length > 0) {
  console.log('');
  console.log('NOTES. Real differences from the CloudFront implementation. Not failures:');
  for (const row of noted) {
    for (const note of row.notes) console.log(`  ${row.label}  ${note}`);
  }
}

if (sweep && sweep.failures.length > 0) {
  console.log('');
  console.log('VARIANT FAILURES. These paths did not resolve:');
  for (const failure of sweep.failures.slice(0, 20)) console.log(`  ${failure}`);
  if (sweep.failures.length > 20) console.log(`  and ${sweep.failures.length - 20} more`);
}

if (options.json) {
  console.log('');
  console.log(JSON.stringify({ base: base.origin, checkedAt: new Date().toISOString(), rows, sweep }, null, 2));
}

if (failed.length > 0 || (sweep && sweep.failures.length > 0)) {
  console.log('');
  console.log('FAILED. The tags are not being served correctly. Detail:');
  for (const row of failed) {
    for (const note of row.notes) console.log(`  ${row.label}  ${note}`);
  }
  console.log('');
  process.exit(1);
}

console.log('');
console.log('Overall: PASS');
console.log('');

// ---------------------------------------------------------------------------

async function checkOneCode(entry, route) {
  const requestPath = `/${route.prefix}/${entry.code}`;
  const expected = entry[route.targetField];
  const notes = [];
  const verdicts = [];
  const row = {
    label: requestPath,
    code: entry.code,
    blend: entry.blendName,
    tags: route.prefix === 'q' ? 'on-pack QR' : entry.status === 'encoded' ? `${entry.unitsEncoded} jars` : 'reserved',
    status: '',
    location: '',
    cache: '',
    page: options.follow ? '' : 'skipped',
    notes,
    result: PASS
  };

  let response;
  try {
    response = await fetchOnce(requestPath);
  } catch (error) {
    row.status = 'ERROR';
    notes.push(`the request failed: ${error.message}`);
    row.result = FAIL;
    return row;
  }

  row.status = String(response.statusCode);
  const status = checkStatus(response.statusCode, REDIRECT_STATUS);
  record(status, verdicts, notes);

  const location = response.headers.location;
  row.location = location ?? '(none)';
  const locationCheck = checkLocation(location, expected);
  record(locationCheck, verdicts, notes);

  // The cache directive is a statement about the redirect, so it is only asked
  // when a redirect actually happened. Judging the Cache-Control of a 404 and
  // reporting it as "Vercel's default on a declarative redirect" would be three
  // misleading lines per code on the one run where everything is already broken.
  if (location && response.statusCode >= 300 && response.statusCode < 400) {
    const cache = checkCacheControl(response.headers['cache-control']);
    row.cache = cache.verdict === PASS ? 'no-store' : cache.verdict === NOTE ? 'default' : 'BAD';
    record(cache, verdicts, notes);
  } else {
    row.cache = 'n/a';
  }

  // Only worth fetching the destination if the redirect pointed somewhere.
  if (options.follow && location) {
    const others = allBlendNames.filter((name) => name !== entry.blendName);
    const destination = await fetchOnce(location).catch((error) => ({ error }));
    if (destination.error) {
      row.page = 'ERROR';
      notes.push(`the destination could not be fetched: ${destination.error.message}`);
      verdicts.push(FAIL);
    } else if (destination.statusCode !== 200) {
      row.page = String(destination.statusCode);
      notes.push(`the destination returned ${destination.statusCode}, expected 200.`);
      verdicts.push(FAIL);
    } else {
      const body = checkDestinationBody(destination.body, entry.blendName, others);
      row.page = body.verdict === PASS ? '200 ok' : body.verdict === NOTE ? '200 all' : '200 wrong';
      record(body, verdicts, notes);
    }
  }

  row.result = worst(verdicts);
  return row;
}

/**
 * One request carrying a query string, to see what the platform does with it.
 *
 * The CloudFront Function never read the incoming query string and a build time
 * check refused to emit a function that mentioned it. Vercel's routing layer
 * merges the incoming query into the destination. That is asked here rather
 * than asserted anywhere, because it is somebody else's router.
 */
async function checkQuery(entry) {
  const query = PROBE_KEYS.map((key) => `${key}=probe`).join('&');
  const requestPath = `/${ROUTES[0].prefix}/${entry.code}?${query}`;
  const expected = entry[ROUTES[0].targetField];
  const notes = [];
  const row = {
    label: `/${ROUTES[0].prefix}/${entry.code}?${PROBE_KEYS[0]}=...`,
    code: entry.code,
    blend: entry.blendName,
    tags: 'query probe',
    status: '',
    location: '',
    cache: 'n/a',
    page: 'n/a',
    notes,
    result: PASS
  };

  let response;
  try {
    response = await fetchOnce(requestPath);
  } catch (error) {
    row.status = 'ERROR';
    notes.push(`the request failed: ${error.message}`);
    row.result = FAIL;
    return row;
  }

  row.status = String(response.statusCode);
  const verdicts = [];
  record(checkStatus(response.statusCode, REDIRECT_STATUS), verdicts, notes);

  const location = response.headers.location;
  row.location = location ?? '(none)';
  const passthrough = checkQueryPassthrough(location, expected, PROBE_KEYS);
  record(passthrough, verdicts, notes);
  // The passthrough check reports its PASS note as well, since "the query string
  // was dropped" is worth seeing when it happens.
  if (passthrough.verdict === PASS && passthrough.note) notes.push(passthrough.note);

  row.result = worst(verdicts);
  return row;
}

async function checkUnknownCode(route) {
  const requestPath = `/${route.prefix}/${UNKNOWN_CODE}`;
  const row = {
    label: requestPath,
    code: UNKNOWN_CODE,
    blend: 'unknown code',
    tags: 'n/a',
    status: '',
    location: '(none)',
    cache: 'n/a',
    page: 'n/a',
    notes: [],
    result: PASS
  };

  let response;
  try {
    response = await fetchOnce(requestPath);
  } catch (error) {
    row.status = 'ERROR';
    row.notes.push(`the request failed: ${error.message}`);
    row.result = FAIL;
    return row;
  }

  row.status = String(response.statusCode);
  if (response.headers.location) row.location = response.headers.location;

  const outcome = checkUnknown(response.statusCode, response.headers.location, response.body);
  row.result = outcome.verdict;
  row.notes.push(...outcome.notes);
  return row;
}

/**
 * Every casing and trailing slash variant, on both routes, for every code.
 *
 * On CloudFront this was three lines of normalisation inside the function. On
 * Vercel it is 160 enumerated configuration entries, so it is the part of the
 * move most likely to be silently incomplete, and it is worth the requests.
 */
async function sweepVariants() {
  const failures = [];
  let total = 0;
  let passed = 0;

  for (const route of ROUTES) {
    for (const entry of table.entries) {
      const expected = entry[route.targetField];
      for (const source of sourcesFor(route.prefix, entry.code)) {
        if (source === `/${route.prefix}/${entry.code}`) continue; // already checked above
        total += 1;
        const response = await fetchOnce(source).catch((error) => ({ error }));
        if (response.error) {
          failures.push(`${source} request failed: ${response.error.message}`);
        } else if (response.statusCode !== REDIRECT_STATUS) {
          failures.push(`${source} returned ${response.statusCode}, expected ${REDIRECT_STATUS}`);
        } else if (response.headers.location !== expected) {
          failures.push(`${source} went to ${response.headers.location}, expected ${expected}`);
        } else {
          passed += 1;
        }
      }
    }
  }

  return { total, passed, failures };
}

function record(outcome, verdicts, notes) {
  verdicts.push(outcome.verdict);
  if (outcome.verdict !== PASS && outcome.note) notes.push(outcome.note);
}

function fetchOnce(path) {
  return new Promise((resolve, reject) => {
    const isHttps = base.protocol === 'https:';
    const send = isHttps ? httpsRequest : httpRequest;
    const requestOptions = {
      protocol: base.protocol,
      hostname: base.hostname,
      port: base.port || (isHttps ? 443 : 80),
      path,
      method: 'GET',
      headers: {
        host: hostHeader,
        'user-agent': 'trevean-verify-live/1.0',
        accept: 'text/html'
      },
      timeout: options.timeout
    };
    if (isHttps) requestOptions.servername = hostHeader;

    const req = send(requestOptions, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') })
      );
    });
    req.on('timeout', () => req.destroy(new Error(`timed out after ${options.timeout} ms`)));
    req.on('error', reject);
    req.end();
  });
}

function report(allRows) {
  const columns = [
    ['PATH', (row) => row.label],
    ['CODE', (row) => row.code],
    ['BLEND', (row) => row.blend],
    ['CARRIED BY', (row) => row.tags],
    ['STATUS', (row) => row.status],
    ['LOCATION', (row) => row.location],
    ['CACHE', (row) => row.cache],
    ['PAGE', (row) => row.page],
    ['RESULT', (row) => row.result]
  ];
  const widths = columns.map(([heading, get]) =>
    Math.max(heading.length, ...allRows.map((row) => String(get(row)).length))
  );
  const line = (cells) => cells.map((cell, index) => String(cell).padEnd(widths[index])).join('  ').trimEnd();
  console.log(line(columns.map(([heading]) => heading)));
  console.log(line(widths.map((width) => '-'.repeat(width))));
  for (const row of allRows) console.log(line(columns.map(([, get]) => get(row))));
}

function parseArgs(argv) {
  const parsed = { base: null, host: null, follow: true, quick: false, timeout: 10000, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base') parsed.base = argv[++i];
    else if (arg === '--host') parsed.host = argv[++i];
    else if (arg === '--no-follow') parsed.follow = false;
    else if (arg === '--quick') parsed.quick = true;
    else if (arg === '--timeout') parsed.timeout = Number(argv[++i]);
    else if (arg === '--json') parsed.json = true;
    else {
      console.error(`Unknown argument ${JSON.stringify(arg)}. Read the header of this file for usage.`);
      process.exit(2);
    }
  }
  return parsed;
}
