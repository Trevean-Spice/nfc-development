// The error envelope, across every status the suite can legitimately provoke.
//
// Section 4: every non 2xx response from every endpoint has exactly this body, and no
// endpoint invents its own shape. The requestId in the body is the same value as the
// X-Request-Id header and the structured log line, which is the whole reason it exists:
// it is what gets pasted into a support message.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { callOperation, type ContractResult } from '../client.js';
import { config } from '../config.js';
import { discoveredIds } from '../discovery.js';
import { scanEventBody, UNKNOWN_BLEND_SLUG } from '../fixtures.js';

const canWrite = config.allowWrites && Boolean(config.tokens.editor);

async function collectErrors(): Promise<ContractResult[]> {
  const ids = await discoveredIds();
  const results: ContractResult[] = [];

  results.push(
    await callOperation('listBlends', { anonymous: true, query: { limit: 5000 }, expectStatus: 400 }),
  );
  results.push(
    await callOperation('getBlendBySlug', {
      anonymous: true,
      pathParams: { slug: UNKNOWN_BLEND_SLUG },
      expectStatus: 404,
    }),
  );
  results.push(
    await callOperation('recordScanEvent', {
      anonymous: true,
      body: { ...scanEventBody(), somethingUnknown: true },
      validateRequestBody: false,
      expectStatus: 400,
    }),
  );
  results.push(await callOperation('adminListBlends', { anonymous: true, expectStatus: 401 }));

  if (config.tokens.viewer) {
    results.push(
      await callOperation('adminRevalidate', {
        role: 'viewer',
        body: { blendSlugs: ['persian-sunrise'] },
        expectStatus: 403,
      }),
    );
  }

  if (canWrite) {
    results.push(
      await callOperation('adminCreateBlend', {
        role: 'editor',
        body: { slug: 'persian-sunrise', name: 'Persian Sunrise' },
        expectStatus: 409,
      }),
    );
    results.push(
      await callOperation('adminCreateMediaUpload', {
        role: 'editor',
        body: { filename: 'x.gif', contentType: 'image/gif', bytes: 100, kind: 'gallery' },
        validateRequestBody: false,
        expectStatus: 415,
      }),
    );
    results.push(
      await callOperation('adminCreateMediaUpload', {
        role: 'editor',
        body: { filename: 'x.jpg', contentType: 'image/jpeg', bytes: 999999999, kind: 'hero' },
        validateRequestBody: false,
        expectStatus: 413,
      }),
    );
    results.push(
      await callOperation('adminPublishBlend', {
        role: 'editor',
        pathParams: { slug: 'north-african-night-market' },
        expectStatus: [202, 422],
      }),
    );
    results.push(
      await callOperation('adminGetMedia', {
        role: config.tokens.viewer ? 'viewer' : 'editor',
        pathParams: { mediaId: 'med_00000000000000000000000000' },
        expectStatus: 404,
      }),
    );
    void ids;
  }

  return results.filter((result) => result.status >= 400);
}

describe('Error envelope', () => {
  it('is the same shape at every status the suite can provoke', async () => {
    const errors = await collectErrors();
    assert.ok(errors.length >= 4, 'Too few error responses collected to be a meaningful check.');

    const statuses = new Set<number>();
    for (const result of errors) {
      statuses.add(result.status);
      const envelope = result.body;
      assert.ok(envelope && typeof envelope === 'object', `${result.operationId} returned no JSON body.`);
      assert.deepEqual(
        Object.keys(envelope),
        ['error'],
        `${result.operationId} returned ${JSON.stringify(Object.keys(envelope))} at the top level. ` +
          'The envelope has exactly one key.',
      );
      const error = envelope.error;
      for (const field of ['code', 'message', 'requestId']) {
        assert.ok(
          typeof error[field] === 'string' && error[field].length > 0,
          `${result.operationId} at ${result.status} has no ${field} in the error envelope.`,
        );
      }
      const allowed = new Set(['code', 'message', 'requestId', 'details']);
      for (const key of Object.keys(error)) {
        assert.ok(allowed.has(key), `${result.operationId} added ${key} to the error envelope.`);
      }
    }
    console.log(`      statuses exercised: ${[...statuses].sort((a, b) => a - b).join(', ')}`);
  });

  it('uses a stable machine readable code that a client can branch on', async () => {
    const errors = await collectErrors();
    for (const result of errors) {
      assert.match(
        result.body.error.code,
        /^[A-Z][A-Z0-9_]*$/,
        `${result.operationId} returned code ${result.body.error.code}, which is not SCREAMING_SNAKE_CASE. ` +
          'Clients branch on this, never on the message.',
      );
    }
  });

  it('repeats the X-Request-Id header inside the body', async () => {
    const errors = await collectErrors();
    for (const result of errors) {
      const header = result.headers.get('x-request-id');
      assert.equal(
        result.body.error.requestId,
        header,
        `${result.operationId} returned requestId ${result.body.error.requestId} in the body and ` +
          `${header} in the header. Section 4 says they are the same value, because that value is ` +
          'what gets pasted into a support message.',
      );
    }
  });

  it('formats requestId as a ULID', async () => {
    const errors = await collectErrors();
    for (const result of errors) {
      assert.match(result.body.error.requestId, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    }
  });

  it('names one offending field per entry when it reports validation details', async () => {
    const errors = await collectErrors();
    const withDetails = errors.filter((result) => Array.isArray(result.body.error.details));
    assert.ok(withDetails.length > 0, 'No validation failure reported details at all.');
    for (const result of withDetails) {
      for (const detail of result.body.error.details) {
        assert.deepEqual(
          Object.keys(detail).sort(),
          ['field', 'issue'],
          `${result.operationId} reported a detail entry of ${JSON.stringify(detail)}.`,
        );
      }
    }
  });

  it('never renders a consumer facing message through this envelope', async () => {
    const errors = await collectErrors();
    for (const result of errors) {
      assert.ok(
        result.body.error.message.length < 500,
        `${result.operationId} returned a very long error message, which reads like page copy. ` +
          'The branded consumer error is a page level concern served from the edge, not an API response.',
      );
    }
  });
});
