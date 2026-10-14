#!/usr/bin/env node
/**
 * End to end verification of every /t/{code} and /q/{code} against a running
 * distribution. Ten redirects plus two unknown code checks.
 *
 * This is the script that runs on cutover day, Thursday 20 August 2026: once in
 * the morning against the distribution with no DNS involved, and again on Friday
 * 21 August after the nameservers have moved. It is written to be operable by
 * somebody who did not write it.
 *
 * WHAT IT CHECKS, per code
 *   status is exactly 307, never 301, 302 or 308
 *   Location matches the canonical table byte for byte
 *   Location is relative, so the browser keeps the connection it already has
 *   Cache-Control is no-store
 *   x-trevean-table matches the table in this working tree, which is how a host
 *     that came up without the redirect table is detected from outside
 *   the destination returns 200 and the page names the right blend
 *   an unknown code returns a branded 404 rather than a redirect or a home page
 *   the QR route reaches the same destination page as the tap, carrying via=qr
 *     rather than via=nfc, so the dashboard split is real rather than assumed
 *
 * WHAT IT DOES NOT CHECK
 *   That a physical tag carries the code. Four physical tags exist in this run,
 *   not five: /t/kg is reserved and no jar carries it. Tapping the four real
 *   tags with a real handset is a separate step and this script does not replace
 *   it. See "M1 Deliverable 4: Tap test protocol".
 *
 * USAGE
 *   Before DNS, against the distribution, equivalent to curl --resolve:
 *     node scripts/verify-live.mjs --base https://treveanspice.com --resolve 203.0.113.10
 *
 *   Before DNS, against the CloudFront domain, with the Host header overridden:
 *     node scripts/verify-live.mjs --base https://d111111abcdef8.cloudfront.net --host treveanspice.com
 *
 *   After DNS, the real thing:
 *     node scripts/verify-live.mjs --base https://treveanspice.com
 *
 *   Options:
 *     --base URL        required, scheme and host of the thing under test
 *     --resolve IP      send the request to this address, keeping the Host
 *                       header and the TLS server name from --base
 *     --host NAME       override the Host header and the TLS server name
 *     --no-follow       do not fetch the destination page. Use this before
 *                       /blend.html has real content on it
 *     --timeout MS      per request, default 10000
 *     --json            machine readable output in addition to the table
 *
 * EXIT CODE
 *   0 every check passed. Non zero otherwise, and the failing cells say why.
 */

import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { readFileSync } from 'node:fs';
import { lookup as dnsLookup } from 'node:dns';
import { loadTable, summarise, tableId, PATHS } from '../lib/table.mjs';
import { collapseHtml } from '../lib/compile.mjs';

const UNKNOWN_CODE = 'zz';

const options = parseArgs(process.argv.slice(2));
if (!options.base) {
  console.error('Missing --base. Example:\n  node scripts/verify-live.mjs --base https://treveanspice.com --resolve 203.0.113.10\n');
  process.exit(2);
}

const table = loadTable();
const expectedTableId = tableId(table, collapseHtml(readFileSync(PATHS.notFound, 'utf8')));
const counts = summarise(table);
const base = new URL(options.base);
const hostHeader = options.host || base.hostname;

console.log('Trevean Spice, /t/{code} edge redirect verification');
console.log(`  base            ${base.origin}`);
console.log(`  host header     ${hostHeader}`);
console.log(`  sent to         ${options.resolve ? `${options.resolve} (curl --resolve equivalent, no DNS for ${hostHeader})` : 'whatever DNS resolves'}`);
console.log(`  table expected  ${expectedTableId} (version ${table.version})`);
console.log(`  destination     ${options.follow ? 'fetched and checked for the blend name' : 'not fetched (--no-follow)'}`);
console.log(`  started         ${new Date().toISOString()}`);
console.log('');

const rows = [];

// Both routes, every code. The QR is checked here rather than left to the page
// team, because on-pack artwork is as unrecallable as an encoded tag and a QR
// that resolves wrongly is discovered by a customer, not by a monitor.
for (const entry of table.entries) {
  rows.push(await checkCode(entry, 'tap'));
}
for (const entry of table.entries) {
  rows.push(await checkCode(entry, 'qr'));
}
rows.push(await checkUnknown('/t/'));
rows.push(await checkUnknown('/q/'));

report(rows);

const failed = rows.filter((row) => row.result !== 'PASS');
console.log('');
console.log(`${rows.length - failed.length} of ${rows.length} checks pass.`);
console.log(
  `${counts.codes} codes exist and ${counts.physicalTags} are on physical tags. ` +
    `Reserved, carried by no jar in this run: ${counts.reservedCodes.join(', ') || 'none'}.`
);

if (options.json) {
  console.log('');
  console.log(JSON.stringify({ base: base.origin, expectedTableId, checkedAt: new Date().toISOString(), rows }, null, 2));
}

if (failed.length > 0) {
  console.log('');
  console.log('FAILED. Do not proceed with the cutover. Detail:');
  for (const row of failed) {
    for (const note of row.notes) console.log(`  ${row.label}  ${note}`);
  }
  console.log('');
  process.exit(1);
}

console.log('\nOverall: PASS\n');

// ---------------------------------------------------------------------------

async function checkCode(entry, route) {
  const requestPath = route === 'qr' ? entry.qrRequestPath : entry.requestPath;
  const expectedTarget = route === 'qr' ? entry.qrTargetPath : entry.targetPath;
  const label = requestPath;
  const notes = [];
  const row = {
    label,
    route,
    code: entry.code,
    blend: entry.blendName,
    tag: route === 'qr' ? 'on-pack QR' : entry.status === 'encoded' ? `${entry.unitsEncoded} tags` : 'reserved',
    status: '',
    location: '',
    headers: '',
    page: options.follow ? '' : 'skipped',
    notes,
    result: 'PASS'
  };

  let response;
  try {
    response = await fetchOnce(requestPath);
  } catch (error) {
    row.status = 'ERROR';
    notes.push(`request failed: ${error.message}`);
    row.result = 'FAIL';
    return row;
  }

  row.status = String(response.statusCode);
  if (response.statusCode !== 307) {
    notes.push(`status is ${response.statusCode}, must be exactly 307. A 301 or 308 is cached by browsers and would make the destination un-editable across the installed base.`);
    row.result = 'FAIL';
  }

  const location = response.headers.location;
  row.location = location ?? '(none)';
  if (location !== expectedTarget) {
    notes.push(`Location is ${JSON.stringify(location)}, table says ${JSON.stringify(expectedTarget)}.`);
    row.result = 'FAIL';
  } else if (!location.startsWith('/') || location.startsWith('//')) {
    notes.push('Location is not a relative same origin path, which costs a second DNS, TCP and TLS setup.');
    row.result = 'FAIL';
  }

  const headerNotes = [];
  const cacheControl = (response.headers['cache-control'] || '').toLowerCase();
  if (!cacheControl.includes('no-store')) {
    headerNotes.push(`Cache-Control is ${JSON.stringify(response.headers['cache-control'] ?? null)}, must contain no-store.`);
  }
  const servedTableId = response.headers['x-trevean-table'];
  if (servedTableId !== expectedTableId) {
    headerNotes.push(
      `x-trevean-table is ${JSON.stringify(servedTableId ?? null)}, this working tree compiles to ${expectedTableId}. ` +
        'The deployed function was built from a different table.'
    );
  }
  row.headers = headerNotes.length === 0 ? 'ok' : 'BAD';
  if (headerNotes.length > 0) {
    notes.push(...headerNotes);
    row.result = 'FAIL';
  }

  if (options.follow && location) {
    const destination = await fetchOnce(location).catch((error) => ({ error }));
    if (destination.error) {
      row.page = 'ERROR';
      notes.push(`destination fetch failed: ${destination.error.message}`);
      row.result = 'FAIL';
    } else if (destination.statusCode !== 200) {
      row.page = String(destination.statusCode);
      notes.push(`destination returned ${destination.statusCode}, expected 200.`);
      row.result = 'FAIL';
    } else if (!namesTheBlend(destination.body, entry)) {
      row.page = '200 wrong';
      notes.push(
        `destination returned 200 but the page never names ${JSON.stringify(entry.blendName)}. ` +
          'A fast page showing the wrong blend is a SOW section 6.1 failure regardless of speed. ' +
          'This is the check that a status code smoke test cannot make.'
      );
      row.result = 'FAIL';
    } else {
      row.page = '200 ok';
    }
  }

  return row;
}

async function checkUnknown(prefix) {
  const label = `${prefix}${UNKNOWN_CODE}`;
  const notes = [];
  const row = {
    label,
    route: prefix === '/q/' ? 'qr' : 'tap',
    code: UNKNOWN_CODE,
    blend: 'unknown code',
    tag: 'n/a',
    status: '',
    location: '(none)',
    headers: '',
    page: 'n/a',
    notes,
    result: 'PASS'
  };

  let response;
  try {
    response = await fetchOnce(label);
  } catch (error) {
    row.status = 'ERROR';
    notes.push(`request failed: ${error.message}`);
    row.result = 'FAIL';
    return row;
  }

  row.status = String(response.statusCode);
  if (response.statusCode !== 404) {
    notes.push(`status is ${response.statusCode}, must be 404. An unknown code is never sent to the home page or a generic landing page.`);
    row.result = 'FAIL';
  }
  if (response.headers.location) {
    row.location = response.headers.location;
    notes.push('an unknown code returned a redirect, which it must never do.');
    row.result = 'FAIL';
  }
  const branded = response.body.includes('Trevean Spice');
  row.headers = branded ? 'ok' : 'BAD';
  if (!branded) {
    notes.push('the 404 body is not the branded page. SOW section 6.3 requires a graceful branded response, never a blank screen.');
    row.result = 'FAIL';
  }
  return row;
}

/**
 * Does the destination page actually name the blend the tag was meant to open?
 *
 * Accepts either the display name from the table or the slug written with
 * spaces, so the check does not break the first time marketing changes "The Silk
 * Road" to "Silk Road". All five names stay mutually distinctive under both
 * forms, which is what makes the check able to catch a wrong blend.
 */
function namesTheBlend(body, entry) {
  const haystack = body.toLowerCase();
  const candidates = [entry.blendName, entry.blendSlug.split('-').join(' ')];
  return candidates.some((candidate) => haystack.includes(candidate.toLowerCase()));
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
        // The device state and the handset do not matter to the redirect, but a
        // realistic agent keeps the request comparable with a real tap.
        'user-agent': 'trevean-verify-live/1.0',
        accept: 'text/html'
      },
      timeout: options.timeout
    };
    if (isHttps) requestOptions.servername = hostHeader;
    if (options.resolve) {
      // Exactly what curl --resolve does: skip DNS, keep the Host header and the
      // TLS server name, send the packets to a chosen address. Node calls a
      // custom lookup with either (hostname, callback) or (hostname, options,
      // callback), and expects an array back when options.all is set, so both
      // shapes are handled rather than assumed.
      const family = options.resolve.includes(':') ? 6 : 4;
      requestOptions.lookup = (_hostname, lookupOptions, maybeCallback) => {
        const callback = typeof lookupOptions === 'function' ? lookupOptions : maybeCallback;
        const settings = typeof lookupOptions === 'function' ? {} : lookupOptions || {};
        if (settings.all) callback(null, [{ address: options.resolve, family }]);
        else callback(null, options.resolve, family);
      };
    } else {
      requestOptions.lookup = dnsLookup;
    }

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
    ['PATH', (r) => r.label],
    ['CODE', (r) => r.code],
    ['BLEND', (r) => r.blend],
    ['TAGS', (r) => r.tag],
    ['STATUS', (r) => r.status],
    ['LOCATION', (r) => r.location],
    ['HDRS', (r) => r.headers],
    ['PAGE', (r) => r.page],
    ['RESULT', (r) => r.result]
  ];
  const widths = columns.map(([heading, get]) =>
    Math.max(heading.length, ...allRows.map((row) => String(get(row)).length))
  );
  const line = (cells) => cells.map((cell, i) => String(cell).padEnd(widths[i])).join('  ').trimEnd();
  console.log(line(columns.map(([heading]) => heading)));
  console.log(line(widths.map((width) => '-'.repeat(width))));
  for (const row of allRows) console.log(line(columns.map(([, get]) => get(row))));
}

function parseArgs(argv) {
  const parsed = { base: null, resolve: null, host: null, follow: true, timeout: 10000, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base') parsed.base = argv[++i];
    else if (arg === '--resolve') parsed.resolve = argv[++i];
    else if (arg === '--host') parsed.host = argv[++i];
    else if (arg === '--no-follow') parsed.follow = false;
    else if (arg === '--timeout') parsed.timeout = Number(argv[++i]);
    else if (arg === '--json') parsed.json = true;
    else {
      console.error(`Unknown argument ${JSON.stringify(arg)}. Read the header of this file for usage.`);
      process.exit(2);
    }
  }
  return parsed;
}
