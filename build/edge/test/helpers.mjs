/**
 * Test harness for the CloudFront Function.
 *
 * The tests run the compiled artifact in dist/redirect.js, evaluated in a fresh
 * V8 context with nothing in scope, rather than importing the template or
 * re-implementing the mapping. Two reasons, both of them the point of the suite:
 *
 *   1. The bytes under test are the bytes that get deployed. A test that passes
 *      against a re-implementation of the redirect proves nothing about the
 *      artifact Terraform uploads.
 *   2. An empty context is the closest available approximation of the CloudFront
 *      Functions sandbox: no require, no fetch, no process, no filesystem. Code
 *      that reached for any of them would fail here rather than in production.
 */

import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { PATHS } from '../lib/table.mjs';

/**
 * Evaluate CloudFront Function source and return its handler plus anything it
 * logged. Pass source explicitly to test a function compiled from a synthetic
 * table; omit it to test the committed artifact.
 */
export function loadHandler(source = readFileSync(PATHS.distFunction, 'utf8')) {
  const logs = [];
  const context = createContext({
    console: {
      log: (...args) => logs.push(args.join(' ')),
      error: (...args) => logs.push(args.join(' '))
    }
  });
  runInContext(`${source}\n;handler;`, context, { filename: 'redirect.js' });
  const handler = runInContext('handler', context);
  return { handler, logs, context };
}

/**
 * A viewer request event in the shape CloudFront delivers. querystring, headers
 * and cookies are populated deliberately: the function must ignore all three,
 * and a test that passed them as empty objects would not prove that.
 */
export function viewerRequest(uri, overrides = {}) {
  return {
    version: '1.0',
    context: { distributionId: 'EDFDVBD6EXAMPLE', requestId: 'test-request' },
    viewer: { ip: '203.0.113.10' },
    request: {
      method: 'GET',
      uri,
      querystring: {
        utm_source: { value: 'newsletter' },
        utm_campaign: { value: 'launch' },
        gclid: { value: 'abc123' }
      },
      headers: {
        host: { value: 'treveanspice.com' },
        'user-agent': { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)' }
      },
      cookies: { session: { value: 'should-never-be-read' } },
      ...overrides
    }
  };
}

/** Header values come back as { value }. This flattens them for assertions. */
export function headerValue(response, name) {
  const header = response.headers?.[name];
  return header === undefined ? undefined : header.value;
}

/** Every casing permutation of a string, for exhaustive normalisation tests. */
export function casings(text) {
  const results = new Set();
  const total = 2 ** text.length;
  for (let mask = 0; mask < total; mask += 1) {
    let out = '';
    for (let i = 0; i < text.length; i += 1) {
      out += mask & (1 << i) ? text[i].toUpperCase() : text[i].toLowerCase();
    }
    results.add(out);
  }
  return [...results];
}
