/**
 * What a request does, exercised through the configuration in dist/.
 *
 * The artifact under test is dist/vercel.json, the exact file the client's
 * Vercel project will carry, read from disk rather than recompiled in memory.
 * Nothing here re-implements the mapping.
 *
 * The most valuable test in this file is "no code resolves to another blend's
 * page". A transposed pair produces a fast, successful, 200 returning page
 * showing the wrong blend and passes any smoke test that looks at status codes.
 * It is a SOW section 6.1 correct destination failure that no speed measurement
 * can see, and it is the reason 1,000 shipped jars are worth a test suite.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PATHS, ROUTES } from '../lib/table.mjs';
import { route, locationOf } from '../lib/router.mjs';
import { casings, sourcesFor, SUFFIXES } from '../lib/variants.mjs';
import {
  CODES,
  EXPECTED_LOCATION,
  EXPECTED_QR_LOCATION,
  EXPECTED_STATUS,
  FORBIDDEN_STATUSES,
  CODE_TO_SLUG
} from './expectations.mjs';

const config = JSON.parse(readFileSync(PATHS.distVercelJson, 'utf8'));
const at = (pathname) => route(config, pathname);
const locate = (pathname) => locationOf(config, pathname);

// ---------------------------------------------------------------------------
// The five codes, on the tap route the 1,000 shipped tags carry
// ---------------------------------------------------------------------------

for (const code of CODES) {
  test(`/t/${code} returns 307 to ${EXPECTED_LOCATION[code]}`, () => {
    const response = at(`/t/${code}`);
    assert.equal(response.status, EXPECTED_STATUS);
    assert.equal(response.location, EXPECTED_LOCATION[code]);
  });
}

test('the code to blend mapping is exactly the identity matrix', () => {
  const actual = Object.fromEntries(CODES.map((code) => [code, locate(`/t/${code}`)]));
  assert.deepEqual(actual, EXPECTED_LOCATION);
});

test('no code resolves to another blend page', () => {
  const slugs = Object.values(CODE_TO_SLUG);
  for (const code of CODES) {
    const location = locate(`/t/${code}`);
    for (const slug of slugs) {
      if (slug === CODE_TO_SLUG[code]) continue;
      assert.ok(
        !location.includes(`blend=${slug}`),
        `/t/${code} sent the customer to ${slug} instead of ${CODE_TO_SLUG[code]}`
      );
    }
  }
});

test('a transposed pair anywhere in the configuration is caught', () => {
  // The failure this suite exists for, injected on purpose. Swapping two
  // destinations changes no status code, no header, no timing and no byte count.
  // Only an expectation transcribed from Scope, section "Tag code map", rather
  // than derived from the table, can see it.
  const transposed = structuredClone(config);
  for (const redirect of transposed.redirects) {
    if (redirect.destination === EXPECTED_LOCATION.ps) redirect.destination = EXPECTED_LOCATION.cs;
    else if (redirect.destination === EXPECTED_LOCATION.cs) redirect.destination = EXPECTED_LOCATION.ps;
  }
  assert.equal(route(transposed, '/t/ps').status, EXPECTED_STATUS, 'the status is unchanged, which is the point');
  assert.notEqual(locationOf(transposed, '/t/ps'), EXPECTED_LOCATION.ps);
  assert.equal(locationOf(transposed, '/t/ps'), EXPECTED_LOCATION.cs, 'this is what a customer holding a Persian Sunrise jar would read about');
});

test('a half transposition, one route of one row, is caught', () => {
  // A row whose tap and QR targets disagree with each other. The tap still
  // looks right, so only a test that checks both routes finds it.
  const half = structuredClone(config);
  for (const redirect of half.redirects) {
    if (redirect.source.startsWith('/q/') && redirect.destination === EXPECTED_QR_LOCATION.sr) {
      redirect.destination = EXPECTED_QR_LOCATION.nm;
    }
  }
  assert.equal(locationOf(half, '/t/sr'), EXPECTED_LOCATION.sr, 'the tap route is untouched');
  assert.notEqual(locationOf(half, '/q/sr'), EXPECTED_QR_LOCATION.sr);
});

// ---------------------------------------------------------------------------
// The QR route, /q/{code}
// ---------------------------------------------------------------------------

for (const code of CODES) {
  test(`/q/${code} returns 307 to ${EXPECTED_QR_LOCATION[code]}`, () => {
    const response = at(`/q/${code}`);
    assert.equal(response.status, EXPECTED_STATUS);
    assert.equal(response.location, EXPECTED_QR_LOCATION[code]);
  });
}

test('the QR route lands on the same page as the tap, differing only in via', () => {
  for (const code of CODES) {
    const tap = locate(`/t/${code}`);
    const qr = locate(`/q/${code}`);
    assert.equal(qr, tap.replace('via=nfc', 'via=qr'));
    assert.equal(qr.replace('via=qr', ''), tap.replace('via=nfc', ''), 'the paths and the blend must match exactly');
  }
});

test('no QR code resolves to another blend page', () => {
  const slugs = Object.values(CODE_TO_SLUG);
  for (const code of CODES) {
    const location = locate(`/q/${code}`);
    for (const slug of slugs) {
      if (slug === CODE_TO_SLUG[code]) continue;
      assert.ok(!location.includes(`blend=${slug}`), `/q/${code} sent the customer to ${slug}`);
    }
  }
});

test('the tap route is unchanged by the presence of the QR route', () => {
  // The 1,000 tags shipped on 24 July 2026 cannot be re-encoded. Whatever else
  // changes, /t/{code} must answer exactly what it always answered.
  for (const code of CODES) {
    assert.equal(locate(`/t/${code}`), EXPECTED_LOCATION[code]);
    assert.ok(!locate(`/t/${code}`).includes('via=qr'));
  }
});

test('a QR scan is never attributed as a tap, and a tap never as a QR', () => {
  for (const code of CODES) {
    assert.ok(locate(`/t/${code}`).includes('via=nfc'));
    assert.ok(locate(`/q/${code}`).includes('via=qr'));
  }
});

// ---------------------------------------------------------------------------
// The status code, specifically
// ---------------------------------------------------------------------------

test('the redirect status is 307 and nothing else', () => {
  for (const code of CODES) {
    for (const prefix of ['t', 'q']) {
      const status = at(`/${prefix}/${code}`).status;
      assert.equal(status, 307);
      for (const forbidden of FORBIDDEN_STATUSES) {
        assert.notEqual(status, forbidden, 'a permanent redirect is cached by browsers and would make the destination un-editable');
      }
    }
  }
});

test('the deployable configuration declares no status other than 307', () => {
  const found = new Set(config.redirects.map((redirect) => redirect.statusCode));
  assert.deepEqual([...found], [307]);
});

test('the deployable configuration never uses permanent, in either sense', () => {
  const source = readFileSync(PATHS.distVercelJson, 'utf8');
  assert.ok(!source.includes('"permanent"'), 'permanent: true is 308 and permanent: false is an unclear way of writing 307');
  for (const forbidden of FORBIDDEN_STATUSES) {
    assert.ok(!source.includes(`"statusCode": ${forbidden}`), `the configuration can return ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// Normalisation, which on Vercel is enumeration rather than code
// ---------------------------------------------------------------------------

test('every casing of every code resolves to the same blend, on both routes', () => {
  for (const code of CODES) {
    for (const cased of casings(code)) {
      for (const prefix of ['t', 'T']) {
        assert.equal(locate(`/${prefix}/${cased}`), EXPECTED_LOCATION[code], `/${prefix}/${cased} did not resolve`);
      }
      for (const prefix of ['q', 'Q']) {
        assert.equal(locate(`/${prefix}/${cased}`), EXPECTED_QR_LOCATION[code], `/${prefix}/${cased} did not resolve`);
      }
    }
  }
});

test('a trailing slash resolves, in every casing, on both routes', () => {
  for (const code of CODES) {
    for (const cased of casings(code)) {
      assert.equal(locate(`/t/${cased}/`), EXPECTED_LOCATION[code]);
      assert.equal(locate(`/T/${cased}/`), EXPECTED_LOCATION[code]);
      assert.equal(locate(`/q/${cased}/`), EXPECTED_QR_LOCATION[code]);
      assert.equal(locate(`/Q/${cased}/`), EXPECTED_QR_LOCATION[code]);
    }
  }
});

test('the canonical form the tags actually carry is the first entry for its row', () => {
  // Order is not correctness here, since the sources are literal and disjoint,
  // but the file is read by people. The string a jar carries should be the one
  // at the top of its block.
  for (const routeSpec of ROUTES) {
    for (const code of CODES) {
      assert.equal(sourcesFor(routeSpec.prefix, code)[0], `/${routeSpec.prefix}/${code}`);
    }
  }
});

test('every enumerated variant is present in the deployed configuration', () => {
  const declared = new Set(config.redirects.map((redirect) => redirect.source));
  const missing = [];
  for (const routeSpec of ROUTES) {
    for (const code of CODES) {
      for (const source of sourcesFor(routeSpec.prefix, code)) {
        if (!declared.has(source)) missing.push(source);
      }
    }
  }
  assert.deepEqual(missing, []);
  assert.equal(declared.size, CODES.length * ROUTES.length * 2 * 4 * SUFFIXES.length);
});

// ---------------------------------------------------------------------------
// The Location header shape
// ---------------------------------------------------------------------------

test('Location is relative and same origin, so the connection is reused', () => {
  for (const redirect of config.redirects) {
    const location = redirect.destination;
    assert.ok(location.startsWith('/blend.html?'), `${location} is not a relative path`);
    assert.ok(!location.startsWith('//'), `${location} is protocol relative`);
    assert.ok(!location.includes('://'), `${location} is absolute and costs a second DNS, TCP and TLS setup`);
  }
});

test('Location carries blend and via, in that order, and no other parameter', () => {
  for (const redirect of config.redirects) {
    const query = redirect.destination.slice(redirect.destination.indexOf('?') + 1);
    const keys = query.split('&').map((pair) => pair.split('=')[0]);
    assert.deepEqual(keys, ['blend', 'via'], `${redirect.destination} has unexpected parameters`);
  }
});

test('the via value appears exactly once and matches the route it is on', () => {
  for (const redirect of config.redirects) {
    const expected = redirect.source.slice(1, 2).toLowerCase() === 'q' ? 'qr' : 'nfc';
    const query = redirect.destination.slice(redirect.destination.indexOf('?') + 1);
    assert.equal(query.match(new RegExp(`(^|&)via=${expected}(&|$)`, 'g'))?.length, 1, `${redirect.source} to ${redirect.destination}`);
  }
});

test('no destination carries an attribution parameter that could fragment a cache key', () => {
  for (const redirect of config.redirects) {
    for (const forbidden of ['utm_', 'gclid', 'fbclid', 'ref=', 'source=']) {
      assert.ok(!redirect.destination.includes(forbidden), `${redirect.destination} carries ${forbidden}`);
    }
  }
});

// ---------------------------------------------------------------------------
// The cache key: nothing from the request may reach the destination
// ---------------------------------------------------------------------------

test('no source captures a parameter, so no parameter can be appended to a destination', () => {
  // This is the structural version of the edge package's "the deployable source
  // never touches querystring or cookies". A literal source has nothing to
  // capture. It is the reason the casings are enumerated rather than matched.
  for (const redirect of config.redirects) {
    for (const character of [':', '*', '(', ')', '[', ']', '{', '}', '?', '+', '\\', '|', '!']) {
      assert.ok(!redirect.source.includes(character), `source ${redirect.source} contains ${character}`);
    }
  }
});

test('the routing decision depends on the path and on nothing else', () => {
  // The route is one character of the path. There is no header, no cookie and
  // no query parameter anywhere in the matching rules, so no attribution value
  // can enter the cache key by way of the redirect.
  const source = readFileSync(PATHS.distVercelJson, 'utf8');
  for (const forbidden of ['"has"', '"missing"', 'cookie', 'query', 'header"']) {
    assert.ok(!source.includes(forbidden), `the configuration matches on ${forbidden}`);
  }
});

test('the redirect carries Cache-Control: no-store', () => {
  const rules = config.headers.filter((rule) => rule.source.startsWith('/t/') || rule.source.startsWith('/T/'));
  assert.ok(rules.length > 0, 'no header rule covers the tap route');
  for (const rule of rules) {
    assert.deepEqual(rule.headers, [{ key: 'Cache-Control', value: 'no-store' }], 'a cached redirect is an uneditable redirect');
  }
});

test('the cache directive covers both routes in both casings', () => {
  const covered = config.headers.map((rule) => rule.source).sort();
  assert.deepEqual(covered, ['/Q/(.*)', '/T/(.*)', '/q/(.*)', '/t/(.*)']);
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
  '/t/persian-sunrise',
  '/q/zz',
  '/q/',
  '/q/ps/extra',
  '/q/persian-sunrise'
];

for (const pathname of UNKNOWN) {
  test(`${pathname} matches no redirect and falls through to the branded 404`, () => {
    const response = at(pathname);
    assert.equal(response.location, undefined, 'an unknown code must never redirect anywhere');
    assert.equal(response.status, 404, `${pathname} should not resolve`);
  });
}

test('an unknown code is never sent to the home page or to a generic landing page', () => {
  // SOW section 6.1: a generic landing page is a failure in the same way a wrong
  // blend is. There is no rule in this configuration whose destination is "/".
  for (const redirect of config.redirects) {
    assert.notEqual(redirect.destination, '/');
    assert.ok(redirect.destination.startsWith('/blend.html?'));
  }
  assert.equal(at('/t/zz').location, undefined);
});

test('a prefix that is neither t nor q is refused rather than guessed at', () => {
  for (const pathname of ['/p/ps', '/r/ps', '/qq/ps', '/tq/ps', '/ /ps', '/tt/ps', '/x/ps']) {
    assert.equal(at(pathname).status, 404);
  }
});

test('prototype chain keys cannot resolve as codes', () => {
  // Structurally impossible in a declarative configuration, since there is no
  // object lookup, but asserted so the property survives any future rewrite that
  // introduces one.
  for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'prototype']) {
    assert.equal(at(`/t/${key}`).status, 404, `/t/${key} resolved off the prototype chain`);
    assert.equal(at(`/q/${key}`).status, 404);
  }
});

test('the marketing site paths are untouched by this configuration', () => {
  // The redirect is being added to a live marketing site. Anything it shadows is
  // a page the client already has that would stop working.
  for (const pathname of ['/', '/blend.html', '/index.html', '/about', '/shop', '/blend.html/']) {
    assert.equal(at(pathname).status, 404, `${pathname} was captured by the redirect and would no longer reach the site`);
    assert.equal(at(pathname).location, undefined);
  }
});

test('no unknown code anywhere ever produces a redirect', () => {
  // Property check across a wide space of junk. The claim is one directional and
  // absolute: if it is not one of the five, it does not redirect.
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789-_./%ABZ';
  const known = new Set();
  for (const code of CODES) {
    for (const cased of casings(code)) known.add(cased);
  }
  let checked = 0;
  for (let i = 0; i < 2000; i += 1) {
    const length = 1 + (i % 6);
    let code = '';
    for (let j = 0; j < length; j += 1) {
      code += alphabet[(i * 31 + j * 17) % alphabet.length];
    }
    const bare = code.replace(/\/+$/, '');
    if (known.has(bare)) continue;
    for (const prefix of ['t', 'T', 'q', 'Q']) {
      assert.equal(at(`/${prefix}/${code}`).status, 404, `/${prefix}/${code} redirected and should not have`);
    }
    checked += 1;
  }
  assert.ok(checked > 1500, `only ${checked} junk codes were exercised`);
});

test('every literal source in the configuration resolves, and resolves to the table', () => {
  // The inverse property. Nothing is declared that does not answer, and nothing
  // answers with something outside the two expected maps.
  const permitted = new Set([...Object.values(EXPECTED_LOCATION), ...Object.values(EXPECTED_QR_LOCATION)]);
  for (const redirect of config.redirects) {
    const response = at(redirect.source);
    assert.equal(response.status, 307);
    assert.ok(permitted.has(response.location), `${redirect.source} answered ${response.location}`);
  }
});

test('no source is declared twice, so no rule is unreachable', () => {
  const sources = config.redirects.map((redirect) => redirect.source);
  assert.equal(new Set(sources).size, sources.length);
});
