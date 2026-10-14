// Admin content authoring.
//
// These tests mutate. They are skipped when CONTRACT_TEST_ALLOW_WRITES is false, which is
// how the same suite is pointed at production without touching it. The unauthenticated
// rejection tests in the authorisation suite run everywhere regardless.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { callOperation } from '../client.js';
import { config } from '../config.js';
import { UNKNOWN_BLEND_SLUG, UNPUBLISHED_BLEND_SLUG } from '../fixtures.js';

const needsEditor = config.allowWrites && config.tokens.editor ? false : 'writes disabled or no editor token';
const needsViewer = config.tokens.viewer ? false : 'no viewer token configured';

describe('Admin blend reads', () => {
  it('lists drafts as well as published blends', { skip: needsViewer }, async () => {
    const result = await callOperation('adminListBlends', { role: 'viewer', expectStatus: 200 });
    const statuses = new Set((result.body.data as any[]).map((blend) => blend.status));
    assert.ok(statuses.size >= 1);
    assert.ok(
      (result.body.data as any[]).length >= 1,
      'The admin list returned nothing at all, which cannot be right.',
    );
  });

  it('filters by status', { skip: needsViewer }, async () => {
    const result = await callOperation('adminListBlends', {
      role: 'viewer',
      query: { status: 'draft' },
      expectStatus: 200,
    });
    for (const blend of result.body.data) assert.equal(blend.status, 'draft');
  });

  it('reads a draft blend that the public route hides', { skip: needsViewer }, async () => {
    const result = await callOperation('adminGetBlend', {
      role: 'viewer',
      pathParams: { slug: UNPUBLISHED_BLEND_SLUG },
      expectStatus: 200,
    });
    assert.equal(result.body.slug, UNPUBLISHED_BLEND_SLUG);
  });

  it('404s an unknown slug', { skip: needsViewer }, async () => {
    const result = await callOperation('adminGetBlend', {
      role: 'viewer',
      pathParams: { slug: UNKNOWN_BLEND_SLUG },
      expectStatus: 404,
    });
    assert.equal(result.body.error.code, 'BLEND_NOT_FOUND');
  });
});

describe('Admin blend writes', () => {
  it('refuses to create a blend whose slug is taken', { skip: needsEditor }, async () => {
    const result = await callOperation('adminCreateBlend', {
      role: 'editor',
      body: { slug: 'persian-sunrise', name: 'Persian Sunrise' },
      expectStatus: 409,
    });
    assert.equal(result.body.error.code, 'SLUG_TAKEN');
  });

  it('rejects a create body carrying an unknown property', { skip: needsEditor }, async () => {
    const result = await callOperation('adminCreateBlend', {
      role: 'editor',
      body: { slug: 'kyoto-garden', name: 'Kyoto Garden', colour: 'green' },
      validateRequestBody: false,
      expectStatus: 400,
    });
    assert.equal(result.body.error.code, 'VALIDATION_FAILED');
  });

  it('updates with the version it read and increments it', { skip: needsEditor }, async () => {
    const before = await callOperation('adminGetBlend', {
      role: 'editor',
      pathParams: { slug: UNPUBLISHED_BLEND_SLUG },
      expectStatus: 200,
    });
    const after = await callOperation('adminUpdateBlend', {
      role: 'editor',
      pathParams: { slug: UNPUBLISHED_BLEND_SLUG },
      body: { version: before.body.version, tagline: 'Sesame, nori, yuzu and green tea from Kyoto' },
      expectStatus: 200,
    });
    assert.equal(after.body.version, before.body.version + 1, 'The returned version is incremented.');
    assert.equal(after.body.slug, UNPUBLISHED_BLEND_SLUG, 'A slug is never updatable.');
  });

  it('refuses a stale version with 409 rather than overwriting', { skip: needsEditor }, async () => {
    const result = await callOperation('adminUpdateBlend', {
      role: 'editor',
      pathParams: { slug: UNPUBLISHED_BLEND_SLUG },
      body: { version: 1, tagline: 'Written over somebody else' },
      expectStatus: [200, 409],
    });
    if (result.status === 200) {
      // Version 1 happened to be current. Retry with a version that certainly is not.
      const conflict = await callOperation('adminUpdateBlend', {
        role: 'editor',
        pathParams: { slug: UNPUBLISHED_BLEND_SLUG },
        body: { version: 1, tagline: 'Written over somebody else' },
        expectStatus: 409,
      });
      assert.equal(conflict.body.error.code, 'VERSION_CONFLICT');
    } else {
      assert.equal(result.body.error.code, 'VERSION_CONFLICT');
    }
  });

  it('rejects an update with no version at all', { skip: needsEditor }, async () => {
    const result = await callOperation('adminUpdateBlend', {
      role: 'editor',
      pathParams: { slug: UNPUBLISHED_BLEND_SLUG },
      body: { tagline: 'No optimistic concurrency here' },
      validateRequestBody: false,
      expectStatus: 400,
    });
    assert.equal(result.body.error.code, 'VALIDATION_FAILED');
  });

  it('404s an update to a slug that does not exist', { skip: needsEditor }, async () => {
    const result = await callOperation('adminUpdateBlend', {
      role: 'editor',
      pathParams: { slug: UNKNOWN_BLEND_SLUG },
      body: { version: 1 },
      expectStatus: 404,
    });
    assert.equal(result.body.error.code, 'BLEND_NOT_FOUND');
  });
});

describe('Admin recipe lifecycle', () => {
  it('creates, updates, conflicts and archives a recipe', { skip: needsEditor }, async () => {
    const created = await callOperation('adminCreateRecipe', {
      role: 'editor',
      headers: { 'idempotency-key': `contract-test-${Date.now()}` },
      body: {
        blendSlug: 'silk-road',
        title: 'Roasted carrots with cumin and coriander',
        summary: 'One tray, forty minutes, very little attention.',
        servings: 4,
        prepMinutes: 10,
        cookMinutes: 35,
        difficulty: 'easy',
        ingredients: [{ quantity: 700, unit: 'g', item: 'carrots', note: 'halved lengthways' }],
        steps: ['Heat the oven to 200 C.', 'Roast for 35 minutes, turning once.'],
        sortOrder: 1,
        status: 'draft',
      },
      expectStatus: 201,
    });
    const recipeId = created.body.recipeId as string;
    assert.match(recipeId, /^rcp_[0-9A-HJKMNP-TV-Z]{26}$/);
    assert.equal(created.body.version, 1);

    const updated = await callOperation('adminUpdateRecipe', {
      role: 'editor',
      pathParams: { recipeId },
      body: { version: created.body.version, title: 'Roasted carrots with cumin' },
      expectStatus: 200,
    });
    assert.equal(updated.body.version, created.body.version + 1);

    const conflict = await callOperation('adminUpdateRecipe', {
      role: 'editor',
      pathParams: { recipeId },
      body: { version: created.body.version, title: 'Stale write' },
      expectStatus: 409,
    });
    assert.equal(conflict.body.error.code, 'VERSION_CONFLICT');

    const archived = await callOperation('adminDeleteRecipe', {
      role: 'editor',
      pathParams: { recipeId },
      expectStatus: 204,
    });
    assert.equal(archived.bodyText.trim(), '', '204 carries no body.');

    // Soft delete: the record is archived, so the public read stops serving it.
    await callOperation('getRecipe', { anonymous: true, pathParams: { recipeId }, expectStatus: 404 });
  });

  it('rejects a recipe create with an unknown property', { skip: needsEditor }, async () => {
    const result = await callOperation('adminCreateRecipe', {
      role: 'editor',
      body: { blendSlug: 'silk-road', title: 'Unknown property', chef: 'nobody' },
      validateRequestBody: false,
      expectStatus: 400,
    });
    assert.equal(result.body.error.code, 'VALIDATION_FAILED');
  });

  it('rejects a recipe update with no version', { skip: needsEditor }, async () => {
    const ids = await import('../discovery.js').then((module) => module.discoveredIds());
    const result = await callOperation('adminUpdateRecipe', {
      role: 'editor',
      pathParams: { recipeId: ids.recipeId! },
      body: { title: 'No optimistic concurrency here' },
      validateRequestBody: false,
      expectStatus: 400,
    });
    assert.equal(result.body.error.code, 'VALIDATION_FAILED');
  });

  it('404s an update to a recipe that does not exist', { skip: needsEditor }, async () => {
    const result = await callOperation('adminUpdateRecipe', {
      role: 'editor',
      pathParams: { recipeId: 'rcp_00000000000000000000000000' },
      body: { version: 1 },
      expectStatus: 404,
    });
    assert.equal(result.body.error.code, 'RECIPE_NOT_FOUND');
  });

  it('404s a delete of a recipe that does not exist', { skip: needsEditor }, async () => {
    const result = await callOperation('adminDeleteRecipe', {
      role: 'editor',
      pathParams: { recipeId: 'rcp_00000000000000000000000000' },
      expectStatus: 404,
    });
    assert.equal(result.body.error.code, 'RECIPE_NOT_FOUND');
  });
});

describe('Admin grower writes', () => {
  it('creates a grower and reports what a later edit makes stale', { skip: needsEditor }, async () => {
    const created = await callOperation('adminCreateGrower', {
      role: 'editor',
      body: {
        name: 'Contract test grower',
        farmName: 'Contract test farm',
        country: 'IR',
        region: 'Isfahan',
        yearsFarming: 12,
      },
      expectStatus: 201,
    });
    const growerId = created.body.growerId as string;
    assert.match(growerId, /^grw_[0-9A-HJKMNP-TV-Z]{26}$/);

    const updated = await callOperation('adminUpdateGrower', {
      role: 'editor',
      pathParams: { growerId },
      body: { version: created.body.version, bio: 'Updated by the contract test suite.' },
      expectStatus: 200,
    });
    assert.equal(updated.body.version, created.body.version + 1);
    assert.ok(
      Array.isArray(updated.body.republishRequiredFor),
      'The grower record is snapshotted into the page, so the response must say what needs republishing.',
    );

    const conflict = await callOperation('adminUpdateGrower', {
      role: 'editor',
      pathParams: { growerId },
      body: { version: created.body.version, bio: 'Stale write.' },
      expectStatus: 409,
    });
    assert.equal(conflict.body.error.code, 'VERSION_CONFLICT');
  });

  it('404s an update to a grower that does not exist', { skip: needsEditor }, async () => {
    const result = await callOperation('adminUpdateGrower', {
      role: 'editor',
      pathParams: { growerId: 'grw_00000000000000000000000000' },
      body: { version: 1 },
      expectStatus: 404,
    });
    assert.equal(result.body.error.code, 'GROWER_NOT_FOUND');
  });

  it('rejects a grower update with no version', { skip: needsEditor }, async () => {
    const ids = await import('../discovery.js').then((module) => module.discoveredIds());
    const result = await callOperation('adminUpdateGrower', {
      role: 'editor',
      pathParams: { growerId: ids.growerId! },
      body: { bio: 'No optimistic concurrency here' },
      validateRequestBody: false,
      expectStatus: 400,
    });
    assert.equal(result.body.error.code, 'VALIDATION_FAILED');
  });

  it('rejects a grower create with an unknown property', { skip: needsEditor }, async () => {
    const result = await callOperation('adminCreateGrower', {
      role: 'editor',
      body: { name: 'Contract test grower', favouriteColour: 'green' },
      validateRequestBody: false,
      expectStatus: 400,
    });
    assert.equal(result.body.error.code, 'VALIDATION_FAILED');
  });
});
