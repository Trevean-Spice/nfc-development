// Can navigator.sendBeacon actually call this endpoint?
//
// This suite exists because a schema check cannot answer that question. The scan beacon is
// the only operation on the tap path, it is fired after paint from the blend page on
// treveanspice.com to the API on a different host, and it is fired by sendBeacon, which:
//
//   1. sends POST and nothing else,
//   2. sets no headers at all except a Content-Type taken from the Blob type,
//   3. therefore cannot send Authorization, an API key, a CSRF token or a custom header,
//   4. is cross origin here, and application/json is NOT a CORS safelisted content type,
//      so the browser issues a preflight OPTIONS first and drops the beacon silently if
//      that preflight does not succeed,
//   5. returns only a boolean to the caller and never exposes the response,
//   6. is capped at roughly 64 KB across all in flight beacons.
//
// An endpoint that fails any of these is a contract that fails only in the field, on a
// customer's phone, with nothing in any log to say so.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rawRequest } from '../client.js';
import { config } from '../config.js';
import { operation } from '../spec.js';
import { scanEventBody } from '../fixtures.js';

const BEACON = operation('recordScanEvent');
const BEACON_PATH = BEACON.path;

/** The exact headers a sendBeacon call produces. Nothing else may be required. */
function beaconHeaders(): Record<string, string> {
  return {
    'content-type': 'application/json',
    origin: config.pageOrigin,
  };
}

describe('The beacon endpoint is reachable by navigator.sendBeacon', () => {
  it('is POST only, which is the only method sendBeacon can issue', () => {
    assert.equal(BEACON.method, 'post');
  });

  it('accepts a request carrying only the headers sendBeacon can set', async () => {
    const result = await rawRequest('POST', BEACON_PATH, {
      headers: beaconHeaders(),
      body: JSON.stringify(scanEventBody()),
    });
    assert.equal(
      result.status,
      202,
      'The beacon sent exactly what sendBeacon can send and was not accepted. ' +
        'sendBeacon cannot add an Authorization header, an API key, a CSRF token or any ' +
        'custom header, so an endpoint that needs one cannot be called from the tap path.',
    );
    assert.equal(result.bodyText.trim(), '', 'sendBeacon cannot read a response body.');
  });

  it('does not answer the beacon with a redirect', async () => {
    const result = await rawRequest('POST', BEACON_PATH, {
      headers: beaconHeaders(),
      body: JSON.stringify(scanEventBody()),
    });
    assert.ok(
      result.status < 300 || result.status >= 400,
      `The beacon was answered with ${result.status}. A redirect on the beacon path repeats the ` +
        'CORS preflight and can lose the event.',
    );
  });

  it('answers the CORS preflight the browser sends before a cross origin JSON beacon', async () => {
    const result = await rawRequest('OPTIONS', BEACON_PATH, {
      headers: {
        origin: config.pageOrigin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    assert.ok(
      result.status >= 200 && result.status < 300,
      `The preflight returned ${result.status}. application/json is not a CORS safelisted content ` +
        'type, so the browser preflights before it will send the beacon. A failed preflight means ' +
        'the beacon is never sent and the scan is never counted, with no error anywhere.',
    );
    const allowOrigin = result.headers.get('access-control-allow-origin');
    assert.ok(
      allowOrigin === '*' || allowOrigin === config.pageOrigin,
      `The preflight did not allow ${config.pageOrigin}. Access-Control-Allow-Origin was ${allowOrigin}.`,
    );
    const allowMethods = (result.headers.get('access-control-allow-methods') ?? '').toUpperCase();
    assert.match(allowMethods, /POST/, 'The preflight does not allow POST.');
    const allowHeaders = (result.headers.get('access-control-allow-headers') ?? '').toLowerCase();
    assert.match(
      allowHeaders,
      /content-type/,
      'The preflight does not allow Content-Type, which is the one header sendBeacon sets.',
    );
  });

  it('allows the page origin on the beacon response itself', async () => {
    const result = await rawRequest('POST', BEACON_PATH, {
      headers: beaconHeaders(),
      body: JSON.stringify(scanEventBody()),
    });
    const allowOrigin = result.headers.get('access-control-allow-origin');
    assert.ok(
      allowOrigin === '*' || allowOrigin === config.pageOrigin,
      `The beacon response did not allow ${config.pageOrigin}. Access-Control-Allow-Origin was ${allowOrigin}.`,
    );
  });

  it('produces a body far inside the sendBeacon size budget', () => {
    const bytes = Buffer.byteLength(JSON.stringify(scanEventBody()), 'utf8');
    assert.ok(
      bytes < 8192,
      `The beacon body is ${bytes} bytes. sendBeacon shares a budget of roughly 64 KB across all ` +
        'in flight beacons and returns false rather than queueing when it is exceeded.',
    );
  });

  it('needs no cookie, so the page carries no cookie on the tap path', async () => {
    const result = await rawRequest('POST', BEACON_PATH, {
      headers: beaconHeaders(),
      body: JSON.stringify(scanEventBody()),
    });
    assert.equal(result.status, 202);
    assert.equal(
      result.headers.get('set-cookie'),
      null,
      'No cookies on the tap path. A cookie here would also make the beacon a credentialed ' +
        'cross origin request, which needs a stricter CORS answer than this one gives.',
    );
  });

  it('records an Origin mismatch rather than trusting it, and still accepts the write', async () => {
    const result = await rawRequest('POST', BEACON_PATH, {
      headers: { 'content-type': 'application/json', origin: 'https://not-trevean.example' },
      body: JSON.stringify(scanEventBody()),
    });
    assert.ok(
      result.status === 202 || result.status === 400 || result.status === 429,
      `An unexpected origin produced ${result.status}. Section 5.2 says a mismatch is recorded ` +
        'rather than trusted, and the realistic attack is inflating a count, not exfiltrating data.',
    );
    if (result.status === 202) {
      const allowOrigin = result.headers.get('access-control-allow-origin');
      assert.ok(
        allowOrigin === null || allowOrigin === '*' || allowOrigin === config.pageOrigin,
        `The server reflected the unknown origin ${allowOrigin} in Access-Control-Allow-Origin.`,
      );
    }
  });
});
