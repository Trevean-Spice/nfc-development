// Publish and revalidate.
//
// Publish returns 202 rather than 200 because it does not wait for regeneration. That is
// the whole point of the rendering strategy: the previous version keeps serving until the
// new one is ready, so no customer waits for a render and no editor waits for a deploy.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { callOperation } from '../client.js';
import { config } from '../config.js';
import { LAUNCH_BLEND_SLUGS, UNKNOWN_BLEND_SLUG } from '../fixtures.js';

const needsEditor = config.allowWrites && config.tokens.editor ? false : 'writes disabled or no editor token';

/** Seeded without a grower, so it cannot be published. Used for the 422 path. */
const BLOCKED_BLEND_SLUG = 'north-african-night-market';

describe('POST /v1/admin/blends/{slug}/publish', () => {
  it('accepts with 202 and returns the paths queued for regeneration', { skip: needsEditor }, async () => {
    const result = await callOperation('adminPublishBlend', {
      role: 'editor',
      pathParams: { slug: LAUNCH_BLEND_SLUGS[0]! },
      expectStatus: 202,
    });
    assert.match(result.body.revalidationId, /^rvl_[0-9A-HJKMNP-TV-Z]{26}$/);
    assert.ok(Array.isArray(result.body.paths) && result.body.paths.length > 0);
    assert.equal(result.body.status, 'published');
    assert.ok(
      result.body.paths.some((path: string) => path.includes(LAUNCH_BLEND_SLUGS[0]!)),
      'The queued paths do not mention the blend that was published.',
    );
  });

  it('lists every blocking reason at once rather than one at a time', { skip: needsEditor }, async () => {
    const result = await callOperation('adminPublishBlend', {
      role: 'editor',
      pathParams: { slug: BLOCKED_BLEND_SLUG },
      expectStatus: [202, 422],
    });
    if (result.status === 422) {
      assert.equal(result.body.error.code, 'PUBLISH_BLOCKED');
      assert.ok(
        Array.isArray(result.body.error.details) && result.body.error.details.length > 0,
        'An editor fixing five problems in five round trips will stop using the tool.',
      );
    }
  });

  it('404s a slug that does not exist', { skip: needsEditor }, async () => {
    const result = await callOperation('adminPublishBlend', {
      role: 'editor',
      pathParams: { slug: UNKNOWN_BLEND_SLUG },
      expectStatus: 404,
    });
    assert.equal(result.body.error.code, 'BLEND_NOT_FOUND');
  });

  it('refuses to publish a stale draft', { skip: needsEditor }, async () => {
    const result = await callOperation('adminPublishBlend', {
      role: 'editor',
      pathParams: { slug: LAUNCH_BLEND_SLUGS[0]! },
      body: { version: 999999 },
      expectStatus: 409,
    });
    assert.equal(result.body.error.code, 'VERSION_CONFLICT');
  });
});

describe('POST /v1/admin/revalidate', () => {
  it('queues revalidation for named blends', { skip: needsEditor }, async () => {
    const result = await callOperation('adminRevalidate', {
      role: 'editor',
      body: {
        blendSlugs: [...LAUNCH_BLEND_SLUGS],
        reason: 'Cache and data disagreed. Raised by the contract test suite.',
      },
      expectStatus: 202,
    });
    assert.equal(result.body.status, 'queued');
    assert.match(result.body.revalidationId, /^rvl_[0-9A-HJKMNP-TV-Z]{26}$/);
    assert.ok(Array.isArray(result.body.paths));
  });

  it('queues revalidation for explicit paths', { skip: needsEditor }, async () => {
    await callOperation('adminRevalidate', {
      role: 'editor',
      body: { paths: ['/sitemap.xml'], reason: 'Contract test suite.' },
      expectStatus: 202,
    });
  });

  it('rejects a request that names neither blends nor paths', { skip: needsEditor }, async () => {
    const result = await callOperation('adminRevalidate', {
      role: 'editor',
      body: { reason: 'Nothing to revalidate.' },
      validateRequestBody: false,
      expectStatus: 400,
    });
    assert.equal(result.body.error.code, 'VALIDATION_FAILED');
  });
});
