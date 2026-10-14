// Public content reads.
//
// Every call here goes through callOperation, which has already validated the response
// against the schema in the OpenAPI document, checked the status is one the document
// declares, and checked X-Request-Id, before any assertion below runs.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { callOperation } from '../client.js';
import { discoveredIds } from '../discovery.js';
import {
  LAUNCH_BLEND_SLUGS,
  REAL_BLEND_SLUGS,
  UNKNOWN_BLEND_SLUG,
  UNPUBLISHED_BLEND_SLUG,
} from '../fixtures.js';

describe('GET /v1/blends', () => {
  it('is readable with no credential at all', async () => {
    const result = await callOperation('listBlends', { anonymous: true, expectStatus: 200 });
    assert.ok(Array.isArray(result.body.data));
    assert.ok(Object.hasOwn(result.body, 'nextCursor'), 'List responses are always enveloped.');
  });

  it('serves only published blends to an unauthenticated caller', async () => {
    const result = await callOperation('listBlends', { anonymous: true, expectStatus: 200 });
    for (const blend of result.body.data) {
      assert.equal(
        blend.status,
        'published',
        `${blend.slug} is ${blend.status} and was served without a credential. Section 5.1, qualification 1.`,
      );
    }
  });

  it('returns blends whose slugs are all real slugs', async () => {
    const result = await callOperation('listBlends', { anonymous: true, expectStatus: 200 });
    for (const blend of result.body.data) {
      assert.ok(
        (REAL_BLEND_SLUGS as readonly string[]).includes(blend.slug),
        `${blend.slug} is not one of the five real blends.`,
      );
    }
  });

  it('carries a public Cache-Control and an ETag', async () => {
    const result = await callOperation('listBlends', { anonymous: true, expectStatus: 200 });
    const cacheControl = result.headers.get('cache-control') ?? '';
    assert.match(cacheControl, /public/, 'Public content reads are briefly cacheable. Section 7.');
    assert.match(cacheControl, /max-age=\d+/);
    assert.ok(result.headers.get('etag'), 'Build callers send If-None-Match and take 304s.');
  });

  it('honours limit', async () => {
    const result = await callOperation('listBlends', { anonymous: true, query: { limit: 2 }, expectStatus: 200 });
    assert.ok(result.body.data.length <= 2);
  });

  it('rejects a limit above the documented maximum with the error envelope', async () => {
    const result = await callOperation('listBlends', {
      anonymous: true,
      query: { limit: 5000 },
      expectStatus: 400,
    });
    assert.equal(result.body.error.code, 'VALIDATION_FAILED');
    assert.ok(Array.isArray(result.body.error.details));
  });
});

describe('GET /v1/blends/{slug}', () => {
  it('returns the full build time payload with include=grower,recipes', async () => {
    const result = await callOperation('getBlendBySlug', {
      anonymous: true,
      pathParams: { slug: LAUNCH_BLEND_SLUGS[0]! },
      query: { include: 'grower,recipes' },
      expectStatus: 200,
    });
    assert.equal(result.body.slug, LAUNCH_BLEND_SLUGS[0]);
    assert.ok(Object.hasOwn(result.body, 'grower'), 'include=grower must embed the grower.');
    assert.ok(Array.isArray(result.body.recipes), 'include=recipes must embed the recipe array.');
  });

  it('returns a single object rather than an envelope', async () => {
    const result = await callOperation('getBlendBySlug', {
      anonymous: true,
      pathParams: { slug: LAUNCH_BLEND_SLUGS[0]! },
      expectStatus: 200,
    });
    assert.ok(!Object.hasOwn(result.body, 'data'), 'Single resource responses are the object itself. Section 8.4.');
  });

  it('takes If-None-Match and answers 304 with no body', async () => {
    const first = await callOperation('getBlendBySlug', {
      anonymous: true,
      pathParams: { slug: LAUNCH_BLEND_SLUGS[0]! },
      expectStatus: 200,
    });
    const etag = first.headers.get('etag');
    assert.ok(etag, 'No ETag, so the build process cannot take a 304.');
    const second = await callOperation('getBlendBySlug', {
      anonymous: true,
      pathParams: { slug: LAUNCH_BLEND_SLUGS[0]! },
      headers: { 'if-none-match': etag! },
      expectStatus: 304,
    });
    assert.equal(second.bodyText.trim(), '');
  });

  it('404s a slug that does not exist', async () => {
    const result = await callOperation('getBlendBySlug', {
      anonymous: true,
      pathParams: { slug: UNKNOWN_BLEND_SLUG },
      expectStatus: 404,
    });
    assert.equal(result.body.error.code, 'BLEND_NOT_FOUND');
  });

  it('404s a blend that exists but is not published, to an unauthenticated caller', async () => {
    const result = await callOperation('getBlendBySlug', {
      anonymous: true,
      pathParams: { slug: UNPUBLISHED_BLEND_SLUG },
      expectStatus: 404,
    });
    assert.equal(
      result.body.error.code,
      'BLEND_NOT_FOUND',
      'Draft and archived blends return 404 to an unauthenticated caller. Section 5.1.',
    );
  });
});

describe('GET /v1/blends/{slug}/recipes', () => {
  it('returns recipes in carousel order, ties broken on recipeId', async () => {
    const result = await callOperation('listRecipesForBlend', {
      anonymous: true,
      pathParams: { slug: LAUNCH_BLEND_SLUGS[0]! },
      expectStatus: 200,
    });
    const recipes = result.body.data as any[];
    for (let index = 1; index < recipes.length; index += 1) {
      const previous = recipes[index - 1];
      const current = recipes[index];
      const ordered =
        previous.sortOrder < current.sortOrder ||
        (previous.sortOrder === current.sortOrder && previous.recipeId < current.recipeId);
      assert.ok(
        ordered,
        'Recipes are sorted by sortOrder then recipeId. An unstable order produces a diff on every rebuild.',
      );
    }
    for (const recipe of recipes) {
      assert.equal(recipe.blendSlug, LAUNCH_BLEND_SLUGS[0]);
    }
  });

  it('404s an unknown blend', async () => {
    const result = await callOperation('listRecipesForBlend', {
      anonymous: true,
      pathParams: { slug: UNKNOWN_BLEND_SLUG },
      expectStatus: 404,
    });
    assert.match(result.body.error.code, /NOT_FOUND$/);
  });
});

describe('GET /v1/recipes/{recipeId}', () => {
  it('returns one recipe', async () => {
    const ids = await discoveredIds();
    const result = await callOperation('getRecipe', {
      anonymous: true,
      pathParams: { recipeId: ids.recipeId! },
      expectStatus: 200,
    });
    assert.equal(result.body.recipeId, ids.recipeId);
  });

  it('404s an unknown recipe', async () => {
    const result = await callOperation('getRecipe', {
      anonymous: true,
      pathParams: { recipeId: 'rcp_00000000000000000000000000' },
      expectStatus: 404,
    });
    assert.equal(result.body.error.code, 'RECIPE_NOT_FOUND');
  });
});

describe('GET /v1/growers and GET /v1/growers/{growerId}', () => {
  it('lists growers in an envelope', async () => {
    const result = await callOperation('listGrowers', { anonymous: true, expectStatus: 200 });
    assert.ok(Array.isArray(result.body.data));
  });

  it('returns one grower', async () => {
    const ids = await discoveredIds();
    const result = await callOperation('getGrower', {
      anonymous: true,
      pathParams: { growerId: ids.growerId! },
      expectStatus: 200,
    });
    assert.equal(result.body.growerId, ids.growerId);
  });

  it('404s an unknown grower', async () => {
    const result = await callOperation('getGrower', {
      anonymous: true,
      pathParams: { growerId: 'grw_00000000000000000000000000' },
      expectStatus: 404,
    });
    assert.equal(result.body.error.code, 'GROWER_NOT_FOUND');
  });
});
