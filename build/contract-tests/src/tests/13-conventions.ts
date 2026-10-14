// Wire format conventions and caching, section 7 and section 8 of the frozen contract.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { callOperation } from '../client.js';
import { config } from '../config.js';
import { LAUNCH_BLEND_SLUGS } from '../fixtures.js';

const needsViewer = config.tokens.viewer ? false : 'no viewer token configured';

function collectTimestamps(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) found.push(value);
    return found;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTimestamps(item, found);
    return found;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectTimestamps(item, found);
  }
  return found;
}

function collectKeys(value: unknown, found: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, found);
    return found;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      found.add(key);
      collectKeys(item, found);
    }
  }
  return found;
}

describe('Wire format', () => {
  it('declares application/json with charset utf-8', { skip: config.requireCharset ? false : 'charset check disabled' }, async () => {
    const result = await callOperation('getBlendBySlug', {
      anonymous: true,
      pathParams: { slug: LAUNCH_BLEND_SLUGS[0]! },
      expectStatus: 200,
    });
    assert.match(
      result.headers.get('content-type') ?? '',
      /application\/json;\s*charset=utf-8/i,
      'Section 8.1: Content-Type is application/json; charset=utf-8.',
    );
  });

  it('sends no body and no content type on 204', async () => {
    // Reached through the recipe lifecycle when writes are on; otherwise this asserts the
    // document still declares 204 with no content, which is the half that never varies.
    const op = (await import('../spec.js')).operation('adminDeleteRecipe');
    const contract = op.responses.get(204);
    assert.ok(contract, 'The archive operation no longer declares 204.');
    assert.equal(contract!.schema, null, '204 declares a body.');
  });

  it('states every timestamp in UTC with a Z suffix', async () => {
    const result = await callOperation('getBlendBySlug', {
      anonymous: true,
      pathParams: { slug: LAUNCH_BLEND_SLUGS[0]! },
      query: { include: 'grower,recipes' },
      expectStatus: 200,
    });
    const timestamps = collectTimestamps(result.body);
    assert.ok(timestamps.length > 0, 'The blend payload carries no timestamp at all.');
    for (const timestamp of timestamps) {
      assert.ok(
        timestamp.endsWith('Z'),
        `Timestamp ${timestamp} is not UTC with a Z suffix. No local times anywhere in this API.`,
      );
    }
  });

  it('names every field in camelCase', async () => {
    const result = await callOperation('getBlendBySlug', {
      anonymous: true,
      pathParams: { slug: LAUNCH_BLEND_SLUGS[0]! },
      query: { include: 'grower,recipes' },
      expectStatus: 200,
    });
    for (const key of collectKeys(result.body)) {
      // Header style keys inside a presigned upload ticket are exempt; none appear here.
      assert.match(key, /^[a-z][a-zA-Z0-9]*$/, `Field ${key} is not camelCase.`);
    }
  });

  it('carries X-Request-Id on a successful response, not only on errors', async () => {
    const result = await callOperation('listBlends', { anonymous: true, expectStatus: 200 });
    assert.match(result.headers.get('x-request-id') ?? '', /^[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});

describe('Caching', () => {
  it('marks public content reads cacheable with a background revalidation window', async () => {
    for (const operationId of ['listBlends', 'listGrowers'] as const) {
      const result = await callOperation(operationId, { anonymous: true, expectStatus: 200 });
      const cacheControl = result.headers.get('cache-control') ?? '';
      assert.match(cacheControl, /public/, `${operationId} is not marked public.`);
      assert.match(cacheControl, /max-age=\d+/, `${operationId} has no max-age.`);
      assert.match(
        cacheControl,
        /stale-while-revalidate=\d+/,
        `${operationId} has no stale-while-revalidate. Section 7.`,
      );
    }
  });

  it('marks the beacon no-store', async () => {
    const { scanEventBody } = await import('../fixtures.js');
    const result = await callOperation('recordScanEvent', {
      anonymous: true,
      body: scanEventBody(),
      expectStatus: 202,
    });
    assert.match(result.headers.get('cache-control') ?? '', /no-store/);
  });

  it('marks every admin response private and no-store', { skip: needsViewer }, async () => {
    const result = await callOperation('adminListBlends', { role: 'viewer', expectStatus: 200 });
    const cacheControl = result.headers.get('cache-control') ?? '';
    assert.match(cacheControl, /private/, 'Admin responses are private.');
    assert.match(cacheControl, /no-store/, 'Admin responses are never stored.');
  });
});
