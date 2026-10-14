/**
 * The compiled CloudFront Function, exercised as CloudFront exercises it.
 *
 * The artifact under test is dist/redirect.js, the exact file Terraform uploads.
 * Nothing here re-implements the mapping.
 *
 * The most valuable test in this file is "no code resolves to another blend's
 * page". A transposed table entry produces a fast, successful, 200 returning
 * page showing the wrong blend and passes any smoke test that looks at status
 * codes. It is a SOW section 6.1 correct destination failure that no speed
 * measurement can see.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadHandler, viewerRequest, headerValue, casings } from './helpers.mjs';
import { loadTable, tableId, PATHS } from '../lib/table.mjs';
import { compile, collapseHtml } from '../lib/compile.mjs';

const { handler } = loadHandler();
const table = loadTable();
const NOT_FOUND_HTML = collapseHtml(readFileSync(PATHS.notFound, 'utf8'));
const TABLE_ID = tableId(table, NOT_FOUND_HTML);

/**
 * Transcribed by hand from "M1 Deliverable 3: Redirect-Serving Decision and
 * Apex Domain Routing", section 5, "The table". Not derived from the file under
 * test, on purpose.
 */
const EXPECTED_LOCATION = {
  ps: '/blend.html?blend=persian-sunrise&via=nfc',
  cs: '/blend.html?blend=caribbean-sunset&via=nfc',
  sr: '/blend.html?blend=silk-road&via=nfc',
  nm: '/blend.html?blend=north-african-night-market&via=nfc',
  kg: '/blend.html?blend=kyoto-garden&via=nfc'
};

/**
 * The QR route, transcribed by hand from "M1 Deliverable 14: QR attribution",
 * section 4. Same destination page as the tap, differing only in the via value.
 */
const EXPECTED_QR_LOCATION = {
  ps: '/blend.html?blend=persian-sunrise&via=qr',
  cs: '/blend.html?blend=caribbean-sunset&via=qr',
  sr: '/blend.html?blend=silk-road&via=qr',
  nm: '/blend.html?blend=north-african-night-market&via=qr',
  kg: '/blend.html?blend=kyoto-garden&via=qr'
};

const CODES = Object.keys(EXPECTED_LOCATION);
const get = (uri) => handler(viewerRequest(uri));

// ---------------------------------------------------------------------------
// The five codes
// ---------------------------------------------------------------------------

for (const code of CODES) {
  test(`/t/${code} returns 307 to ${EXPECTED_LOCATION[code]}`, () => {
    const response = get(`/t/${code}`);
    assert.equal(response.statusCode, 307);
    assert.equal(response.statusDescription, 'Temporary Redirect');
    assert.equal(headerValue(response, 'location'), EXPECTED_LOCATION[code]);
  });
}

test('no code resolves to another blend page', () => {
  const slugs = table.entries.map((e) => e.blendSlug);
  for (const code of CODES) {
    const location = headerValue(get(`/t/${code}`), 'location');
    const expectedSlug = table.entries.find((e) => e.code === code).blendSlug;
    for (const slug of slugs) {
      if (slug === expectedSlug) continue;
      assert.ok(
        !location.includes(`blend=${slug}`),
        `/t/${code} sent the customer to ${slug} instead of ${expectedSlug}`
      );
    }
  }
});

test('the code to blend mapping is exactly the identity matrix', () => {
  const actual = Object.fromEntries(CODES.map((code) => [code, headerValue(get(`/t/${code}`), 'location')]));
  assert.deepEqual(actual, EXPECTED_LOCATION);
});

test('every response is a generated response, never a forwarded request', () => {
  for (const uri of [...CODES.map((c) => `/t/${c}`), '/t/zz', '/t/', '/t/ps/extra']) {
    const response = get(uri);
    assert.equal(typeof response.statusCode, 'number', `${uri} did not generate a response`);
    assert.equal(response.uri, undefined, `${uri} was forwarded to an origin`);
  }
});

// ---------------------------------------------------------------------------
// The QR route, /q/{code}
//
// The requirement these tests hold is the one the source documents disagree
// about. Scope, in scope, item 5 says the QR resolves to the same URL as the
// tap; Scope, in scope, item 6 requires an NFC versus QR split, which is
// impossible if both routes carry byte identical attribution. The reading these
// tests encode, argued in "M1 Deliverable 14: QR attribution", section 3, is
// that the requirement is the same destination page, not the same request line.
// ---------------------------------------------------------------------------

for (const code of CODES) {
  test(`/q/${code} returns 307 to ${EXPECTED_QR_LOCATION[code]}`, () => {
    const response = get(`/q/${code}`);
    assert.equal(response.statusCode, 307);
    assert.equal(response.statusDescription, 'Temporary Redirect');
    assert.equal(headerValue(response, 'location'), EXPECTED_QR_LOCATION[code]);
  });
}

test('the QR route lands on the same page as the tap, differing only in via', () => {
  for (const code of CODES) {
    const tap = headerValue(get(`/t/${code}`), 'location');
    const qr = headerValue(get(`/q/${code}`), 'location');
    assert.equal(qr, tap.replace('via=nfc', 'via=qr'));
    assert.equal(qr.replace('via=qr', ''), tap.replace('via=nfc', ''), 'the paths and the blend must match exactly');
  }
});

test('no QR code resolves to another blend page', () => {
  const slugs = table.entries.map((e) => e.blendSlug);
  for (const code of CODES) {
    const location = headerValue(get(`/q/${code}`), 'location');
    const expectedSlug = table.entries.find((e) => e.code === code).blendSlug;
    for (const slug of slugs) {
      if (slug === expectedSlug) continue;
      assert.ok(!location.includes(`blend=${slug}`), `/q/${code} sent the customer to ${slug}`);
    }
  }
});

test('the QR route normalises casing and trailing slashes exactly as the tap does', () => {
  for (const code of CODES) {
    for (const uri of [`/q/${code.toUpperCase()}`, `/Q/${code}`, `/q/${code}/`, `/Q/${code.toUpperCase()}//`]) {
      assert.equal(headerValue(get(uri), 'location'), EXPECTED_QR_LOCATION[code], `${uri} did not normalise`);
    }
  }
});

test('an unknown QR code gets the same branded 404 as an unknown tag code', () => {
  for (const uri of ['/q/zz', '/q/', '/q//', '/q/ps/extra', '/q/persian-sunrise', '/q/__proto__']) {
    const response = get(uri);
    assert.equal(response.statusCode, 404, `${uri} should not resolve`);
    assert.equal(headerValue(response, 'location'), undefined);
  }
  assert.equal(get('/q/zz').body.data, get('/t/zz').body.data);
});

test('the QR 307 carries the same headers as the tap 307', () => {
  for (const code of CODES) {
    const qr = get(`/q/${code}`);
    assert.equal(headerValue(qr, 'cache-control'), 'no-store');
    assert.equal(headerValue(qr, 'x-trevean-table'), TABLE_ID);
    assert.deepEqual(Object.keys(qr.headers).map((n) => n.toLowerCase()).sort(), [
      'cache-control',
      'location',
      'x-trevean-table'
    ]);
  }
});

test('the QR Location carries via=qr exactly once and no other parameter', () => {
  for (const code of CODES) {
    const location = headerValue(get(`/q/${code}`), 'location');
    assert.ok(location.startsWith('/blend.html?'), `${location} is not a relative path`);
    assert.ok(!location.includes('://'), `${location} is absolute`);
    const query = location.slice(location.indexOf('?') + 1);
    assert.deepEqual(query.split('&').map((pair) => pair.split('=')[0]), ['blend', 'via']);
    assert.equal(query.match(/(^|&)via=qr(&|$)/g)?.length, 1);
    assert.ok(!query.includes('via=nfc'), 'a QR scan attributed as a tap is the failure this route exists to fix');
  }
});

test('the QR route is a generated response and touches no origin', () => {
  for (const code of CODES) {
    assert.equal(get(`/q/${code}`).uri, undefined);
  }
});

test('the tap route is unchanged by the presence of the QR route', () => {
  // The 1,000 tags shipped on 24 July 2026 cannot be re-encoded. Whatever else
  // changes, /t/{code} must answer exactly what it always answered.
  for (const code of CODES) {
    assert.equal(headerValue(get(`/t/${code}`), 'location'), EXPECTED_LOCATION[code]);
    assert.ok(!headerValue(get(`/t/${code}`), 'location').includes('via=qr'));
  }
});

test('a QR scan cannot be requested on the tap path, and a tap cannot be requested on the QR path', () => {
  // The route is the path. ?via= is not a way in, on either side, which is what
  // keeps untrusted input out of the Location header and out of the cache key.
  const tapWithQrParam = handler(viewerRequest('/t/ps', { querystring: { via: { value: 'qr' } } }));
  assert.equal(headerValue(tapWithQrParam, 'location'), EXPECTED_LOCATION.ps);

  const qrWithNfcParam = handler(viewerRequest('/q/ps', { querystring: { via: { value: 'nfc' } } }));
  assert.equal(headerValue(qrWithNfcParam, 'location'), EXPECTED_QR_LOCATION.ps);

  const injected = handler(viewerRequest('/q/ps', { querystring: { via: { value: '<script>' } } }));
  assert.equal(headerValue(injected, 'location'), EXPECTED_QR_LOCATION.ps, 'nothing from the request is reflected');
});

test('a prefix that is neither t nor q is refused rather than guessed at', () => {
  for (const uri of ['/p/ps', '/r/ps', '/qq/ps', '/tq/ps', '/ /ps']) {
    assert.equal(get(uri).statusCode, 404);
  }
});

// ---------------------------------------------------------------------------
// The status code, specifically
// ---------------------------------------------------------------------------

test('the redirect status is 307 and nothing else', () => {
  for (const code of CODES) {
    const status = get(`/t/${code}`).statusCode;
    assert.equal(status, 307);
    assert.notEqual(status, 301, 'a 301 is cached by browsers and would make the destination un-editable');
    assert.notEqual(status, 302);
    assert.notEqual(status, 308);
  }
});

test('the deployable source contains no status other than 307 and 404', () => {
  const source = readFileSync(PATHS.distFunction, 'utf8');
  const found = new Set([...source.matchAll(/statusCode\s*:\s*(\d+)/g)].map((m) => m[1]));
  assert.deepEqual([...found].sort(), ['307', '404']);
});

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

test('every casing of every code resolves to the same blend', () => {
  for (const code of CODES) {
    for (const variant of casings(code)) {
      assert.equal(
        headerValue(get(`/t/${variant}`), 'location'),
        EXPECTED_LOCATION[code],
        `/t/${variant} did not normalise`
      );
    }
  }
});

test('an uppercase /T/ prefix resolves', () => {
  assert.equal(headerValue(get('/T/ps'), 'location'), EXPECTED_LOCATION.ps);
  assert.equal(headerValue(get('/T/PS'), 'location'), EXPECTED_LOCATION.ps);
});

test('a trailing slash is stripped', () => {
  for (const code of CODES) {
    assert.equal(headerValue(get(`/t/${code}/`), 'location'), EXPECTED_LOCATION[code]);
  }
});

test('repeated trailing slashes are stripped', () => {
  assert.equal(headerValue(get('/t/ps//'), 'location'), EXPECTED_LOCATION.ps);
  assert.equal(headerValue(get('/t/ps////'), 'location'), EXPECTED_LOCATION.ps);
});

test('casing and a trailing slash together resolve', () => {
  assert.equal(headerValue(get('/T/PS/'), 'location'), EXPECTED_LOCATION.ps);
  assert.equal(headerValue(get('/T/Cs//'), 'location'), EXPECTED_LOCATION.cs);
});

// ---------------------------------------------------------------------------
// The Location header shape
// ---------------------------------------------------------------------------

test('Location is relative and same origin, so the connection is reused', () => {
  for (const code of CODES) {
    const location = headerValue(get(`/t/${code}`), 'location');
    assert.ok(location.startsWith('/blend.html?'), `${location} is not a relative path`);
    assert.ok(!location.startsWith('//'), `${location} is protocol relative`);
    assert.ok(!location.includes('://'), `${location} is absolute and costs a second DNS, TCP and TLS setup`);
  }
});

test('Location carries via=nfc exactly once and no other parameter', () => {
  for (const code of CODES) {
    const location = headerValue(get(`/t/${code}`), 'location');
    const query = location.slice(location.indexOf('?') + 1);
    const keys = query.split('&').map((pair) => pair.split('=')[0]);
    assert.deepEqual(keys, ['blend', 'via'], `${location} has unexpected parameters`);
    assert.equal(query.match(/(^|&)via=nfc(&|$)/g)?.length, 1);
  }
});

// ---------------------------------------------------------------------------
// Cache behaviour
// ---------------------------------------------------------------------------

test('the 307 carries Cache-Control: no-store', () => {
  for (const code of CODES) {
    assert.equal(
      headerValue(get(`/t/${code}`), 'cache-control'),
      'no-store',
      'a cached redirect is an uneditable redirect'
    );
  }
});

test('the 404 also carries no-store, so a table fix reaches devices that saw it', () => {
  assert.equal(headerValue(get('/t/zz'), 'cache-control'), 'no-store');
});

test('the 307 sets no header that would fragment or vary a cache', () => {
  for (const code of CODES) {
    const names = Object.keys(get(`/t/${code}`).headers).map((n) => n.toLowerCase());
    assert.deepEqual(names.sort(), ['cache-control', 'location', 'x-trevean-table']);
    assert.ok(!names.includes('vary'));
    assert.ok(!names.includes('set-cookie'));
  }
});

test('every response identifies the table it was compiled from', () => {
  assert.equal(headerValue(get('/t/ps'), 'x-trevean-table'), TABLE_ID);
  assert.equal(headerValue(get('/t/zz'), 'x-trevean-table'), TABLE_ID);
});

// ---------------------------------------------------------------------------
// The cache key: the function must never read a request parameter
// ---------------------------------------------------------------------------

test('the incoming query string is ignored entirely', () => {
  const withParams = handler(
    viewerRequest('/t/ps', {
      querystring: {
        utm_source: { value: 'instagram' },
        utm_medium: { value: 'paid' },
        blend: { value: 'kyoto-garden' },
        via: { value: 'qr' }
      }
    })
  );
  assert.equal(
    headerValue(withParams, 'location'),
    EXPECTED_LOCATION.ps,
    'attribution parameters must never reach the target or the cache key'
  );
});

test('the deployable source never touches querystring or cookies', () => {
  const source = readFileSync(PATHS.distFunction, 'utf8');
  assert.ok(!source.includes('querystring'), 'reading the query string invites it into the cache key');
  assert.ok(!source.includes('cookies'));
  assert.ok(!source.includes('.headers'), 'the function must not read request headers either');
});

test('the deployable source makes no network call and loads no dependency', () => {
  const source = readFileSync(PATHS.distFunction, 'utf8');
  for (const forbidden of ['fetch(', 'XMLHttpRequest', 'require(', 'import ', 'eval(', 'setTimeout', 'Promise']) {
    assert.ok(!source.includes(forbidden), `the function references ${forbidden}, which the runtime does not allow`);
  }
});

// ---------------------------------------------------------------------------
// Unknown and malformed codes
// ---------------------------------------------------------------------------

const UNKNOWN = [
  '/t/zz',
  '/t/aa',
  '/t/p',
  '/t/pss',
  '/t/ps-1',
  '/t/PSX',
  '/t/',
  '/t//',
  '/t/ps/extra',
  '/t/ps/cs',
  '/t/%70s',
  '/t/ps%2F',
  '/t/../blend.html',
  '/t/ ',
  '/t/persian-sunrise'
];

for (const uri of UNKNOWN) {
  test(`${uri} returns a branded 404, not a redirect`, () => {
    const response = get(uri);
    assert.equal(response.statusCode, 404, `${uri} should not resolve`);
    assert.equal(response.statusDescription, 'Not Found');
    assert.equal(headerValue(response, 'location'), undefined, 'an unknown code must never redirect anywhere');
  });
}

test('an unknown code is never sent to the home page or a generic landing page', () => {
  const response = get('/t/zz');
  assert.equal(headerValue(response, 'location'), undefined);
  assert.equal(response.statusCode, 404);
  // SOW section 6.1: a generic landing page is a failure in the same way a wrong
  // blend is. The response is a branded page carried by the function itself.
  assert.ok(response.body.data.includes('Trevean Spice'));
  assert.ok(response.body.data.includes('That code is not one of ours.'));
  assert.equal(headerValue(response, 'content-type'), 'text/html; charset=utf-8');
});

test('the 404 body is the branded page from src, byte for byte', () => {
  assert.equal(get('/t/zz').body.data, NOT_FOUND_HTML);
  assert.equal(get('/t/zz').body.encoding, 'text');
});

test('the branded 404 needs no network request of its own', () => {
  const body = get('/t/zz').body.data;
  for (const forbidden of ['<script', 'src=', '<link', '@import', 'http://', 'https://']) {
    assert.ok(!body.includes(forbidden), `the 404 page references ${forbidden}`);
  }
});

test('prototype chain keys do not resolve as codes', () => {
  // A plain truthiness test on the lookup table would answer 307 for every one
  // of these, with a stringified function as the Location.
  for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'prototype']) {
    const response = get(`/t/${key}`);
    assert.equal(response.statusCode, 404, `/t/${key} resolved off the prototype chain`);
  }
});

test('a path outside the /t/ behaviour is refused rather than guessed at', () => {
  for (const uri of ['/', '/blend.html', '/tt/ps', '/x/ps', '/ps', '']) {
    assert.equal(get(uri).statusCode, 404);
  }
});

test('no unknown code anywhere ever produces a redirect', () => {
  // Property check across a wide space of junk. The claim is one directional and
  // absolute: if it is not one of the five, it does not redirect.
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789-_./%ABZ';
  let checked = 0;
  for (let i = 0; i < 2000; i += 1) {
    const length = 1 + (i % 6);
    let code = '';
    for (let j = 0; j < length; j += 1) {
      code += alphabet[(i * 31 + j * 17) % alphabet.length];
    }
    const normalised = code.toLowerCase().replace(/\/+$/, '');
    if (Object.prototype.hasOwnProperty.call(EXPECTED_LOCATION, normalised)) continue;
    const response = get(`/t/${code}`);
    assert.equal(response.statusCode, 404, `/t/${code} redirected and should not have`);
    checked += 1;
  }
  assert.ok(checked > 1500, `only ${checked} junk codes were exercised`);
});

test('an unknown code is logged once, sanitised, for the alarm on mis-encoded batches', () => {
  const isolated = loadHandler();
  isolated.handler(viewerRequest('/t/zz'));
  assert.deepEqual(isolated.logs, ['{"event":"unknown_tag_code","code":"zz"}']);
});

test('a hostile code is never echoed into a log line verbatim', () => {
  const isolated = loadHandler();
  isolated.handler(viewerRequest('/t/a"b\nc'));
  isolated.handler(viewerRequest(`/t/${'x'.repeat(40)}`));
  assert.deepEqual(isolated.logs, [
    '{"event":"unknown_tag_code","code":"invalid"}',
    '{"event":"unknown_tag_code","code":"oversize"}'
  ]);
});

test('the tap path logs nothing', () => {
  const isolated = loadHandler();
  for (const code of CODES) isolated.handler(viewerRequest(`/t/${code}`));
  assert.deepEqual(isolated.logs, [], 'logging on the tap path spends the customer budget');
});

// ---------------------------------------------------------------------------
// The hero preload hint, which is table driven and currently off
// ---------------------------------------------------------------------------

test('no preload Link header is emitted while the table carries no hero paths', () => {
  for (const code of CODES) {
    assert.equal(headerValue(get(`/t/${code}`), 'link'), undefined);
  }
});

test('adding a hero path to the table emits the preload Link header, with no code change', () => {
  const withHero = structuredClone(table);
  withHero.entries.find((e) => e.code === 'ps').heroPreloadPath = '/img/hero-persian-sunrise-1280.avif';
  const { handler: heroHandler } = loadHandler(compile(withHero).source);

  const ps = heroHandler(viewerRequest('/t/ps'));
  assert.equal(
    ps.headers.link.value,
    '</img/hero-persian-sunrise-1280.avif>; rel=preload; as=image; fetchpriority=high'
  );
  assert.equal(ps.headers.location.value, EXPECTED_LOCATION.ps, 'the redirect itself is unchanged');

  const cs = heroHandler(viewerRequest('/t/cs'));
  assert.equal(cs.headers.link, undefined, 'only codes with a hero path get the hint');
});
