import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authHeader, freezeClock, makeApp, resetAndSeed, unfreezeClock } from '../helpers/harness.js';
import { matchesSchema } from '../../src/http/validation.js';

/**
 * Public content reads, against a real DynamoDB wire protocol implementation.
 *
 * Every response is checked against the schema in the frozen OpenAPI document as well as
 * against the expected values, so a response that drifts from the contract fails here
 * rather than in the other engineer's contract test suite.
 */

let app: FastifyInstance;

beforeAll(async () => {
  // Pinned for the same reason as the rest of the integration suite. Nothing in this file
  // reads a date today, but the catalog mirror goes stale six hours after its sync
  // timestamp, so leaving it on the real clock would put a six hour fuse under it.
  freezeClock();
  await resetAndSeed();
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
  unfreezeClock();
});

describe('GET /v1/blends', () => {
  it('returns published blends only to an unauthenticated caller', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/blends' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ slug: string; status: string }>; nextCursor: string | null };
    expect(body.data.map((b) => b.slug)).toEqual([
      'persian-sunrise',
      'caribbean-sunset',
      'north-african-night-market',
      'silk-road',
    ]);
    expect(body.data.every((b) => b.status === 'published')).toBe(true);
    expect(body.nextCursor).toBeNull();
    expect(matchesSchema('#/components/schemas/BlendSummaryList', body).errors).toEqual([]);
  });

  it('carries the documented cache headers and a request id', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/blends' });
    expect(res.headers['cache-control']).toBe('public, max-age=60, stale-while-revalidate=300');
    expect(res.headers['etag']).toBeDefined();
    expect(res.headers['x-request-id']).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('never leaks a draft, whatever status is asked for', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/blends?status=draft' });
    const body = res.json() as { data: Array<{ status: string }> };
    expect(body.data.every((b) => b.status === 'published')).toBe(true);
  });

  it('rejects an out of range limit, because this operation documents a 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/blends?limit=500' });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string; details: Array<{ field: string }> } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details[0]?.field).toBe('limit');
    expect(matchesSchema('#/components/schemas/ErrorEnvelope', body).errors).toEqual([]);
  });

  it('paginates with an opaque cursor', async () => {
    const first = await app.inject({ method: 'GET', url: '/v1/blends?limit=2' });
    const firstBody = first.json() as { data: unknown[]; nextCursor: string };
    expect(firstBody.data).toHaveLength(2);
    expect(firstBody.nextCursor).toBeTruthy();
    const second = await app.inject({ method: 'GET', url: `/v1/blends?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor)}` });
    const secondBody = second.json() as { data: Array<{ slug: string }> };
    expect(secondBody.data).toHaveLength(2);
    expect(secondBody.data.map((b) => b.slug)).not.toContain('persian-sunrise');
  });
});

describe('GET /v1/blends/{slug}', () => {
  it('returns the whole page payload in one call with include=grower,recipes', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/blends/persian-sunrise?include=grower,recipes' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { slug: string; grower: { growerId: string }; recipes: unknown[]; storyBlocks: unknown[] };
    expect(body.slug).toBe('persian-sunrise');
    expect(body.grower.growerId).toMatch(/^grw_/);
    expect(body.recipes).toHaveLength(1);
    expect(body.storyBlocks.length).toBeGreaterThan(0);
    expect(matchesSchema('#/components/schemas/Blend', body).errors).toEqual([]);
  });

  it('omits grower and recipes when they are not asked for', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/blends/persian-sunrise' });
    const body = res.json() as Record<string, unknown>;
    expect(body['grower']).toBeUndefined();
    expect(body['recipes']).toBeUndefined();
  });

  it('answers 304 to a build caller sending If-None-Match', async () => {
    const first = await app.inject({ method: 'GET', url: '/v1/blends/persian-sunrise' });
    const etag = first.headers['etag'] as string;
    const second = await app.inject({
      method: 'GET',
      url: '/v1/blends/persian-sunrise',
      headers: { 'if-none-match': etag },
    });
    expect(second.statusCode).toBe(304);
  });

  it('returns 404 for a draft blend to an unauthenticated caller', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/blends/kyoto-garden' });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe('BLEND_NOT_FOUND');
  });

  /**
   * A token on this route only ever widens what is visible. That is deliberate, and it is
   * safe only for as long as a widened response is not also marked publicly cacheable.
   *
   * This is a public route with no Vary header on it. Marked "public, max-age=60" a shared
   * cache in front of the API stores whatever the last caller saw and keys it on the URL
   * alone, so one authenticated request for a draft blend leaves the unpublished story
   * sitting in front of anonymous customers for the next minute. The API contract, section
   * 7, is explicit that anything not public is private, no-store.
   */
  it('never marks a draft it revealed to a credential as publicly cacheable', async () => {
    const anonymous = await app.inject({ method: 'GET', url: '/v1/blends/kyoto-garden' });
    expect(anonymous.statusCode).toBe(404);

    for (const role of [['Viewer'], ['Editor'], ['Admin']] as Array<['Viewer' | 'Editor' | 'Admin']>) {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/blends/kyoto-garden',
        headers: await authHeader(role),
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { status: string }).status).toBe('draft');
      expect(res.headers['cache-control']).toBe('private, no-store');
    }

    // The published case is unchanged: it is public content and stays publicly cacheable.
    const published = await app.inject({ method: 'GET', url: '/v1/blends/persian-sunrise' });
    expect(published.statusCode).toBe(200);
    expect(published.headers['cache-control']).toBe('public, max-age=60, stale-while-revalidate=300');
  });

  it('does not publicly cache the existence of a draft blend on its recipe list either', async () => {
    const widened = await app.inject({
      method: 'GET',
      url: '/v1/blends/kyoto-garden/recipes',
      headers: await authHeader(['Viewer']),
    });
    expect(widened.statusCode).toBe(200);
    expect(widened.headers['cache-control']).toBe('private, no-store');

    const anonymous = await app.inject({ method: 'GET', url: '/v1/blends/persian-sunrise/recipes' });
    expect(anonymous.statusCode).toBe(200);
    expect(anonymous.headers['cache-control']).toBe('public, max-age=60, stale-while-revalidate=300');
  });

  it('returns 404, not 400, for a misspelt slug', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/blends/persian-sunrize' });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe('BLEND_NOT_FOUND');
    expect(body.error.requestId).toBe(res.headers['x-request-id']);
  });
});

describe('recipes and growers', () => {
  it('returns recipes in carousel order', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/blends/caribbean-sunset/recipes' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ recipeId: string; sortOrder: number }> };
    expect(body.data).toHaveLength(1);
    expect(matchesSchema('#/components/schemas/RecipeList', body).errors).toEqual([]);
  });

  it('serves one recipe and one grower', async () => {
    const recipes = (await app.inject({ method: 'GET', url: '/v1/blends/persian-sunrise/recipes' })).json() as {
      data: Array<{ recipeId: string }>;
    };
    const recipeId = recipes.data[0]?.recipeId as string;
    const recipe = await app.inject({ method: 'GET', url: `/v1/recipes/${recipeId}` });
    expect(recipe.statusCode).toBe(200);
    expect(matchesSchema('#/components/schemas/Recipe', recipe.json()).errors).toEqual([]);

    const growers = (await app.inject({ method: 'GET', url: '/v1/growers' })).json() as {
      data: Array<{ growerId: string }>;
    };
    expect(growers.data.length).toBeGreaterThan(0);
    const grower = await app.inject({ method: 'GET', url: `/v1/growers/${growers.data[0]?.growerId}` });
    expect(grower.statusCode).toBe(200);
    expect(matchesSchema('#/components/schemas/Grower', grower.json()).errors).toEqual([]);
  });

  it('404s an unknown recipe and an unknown grower', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/recipes/rcp_01J9Z91B2C3D4E5F6G7H8J9K00' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/v1/growers/grw_01J9Z900A1B2C3D4E5F6G7H8J0' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/v1/recipes/not-an-id' })).statusCode).toBe(404);
  });
});

describe('GET /v1/catalog/{slug}', () => {
  it('returns the mirror, cacheable, and degradable by design', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/catalog/persian-sunrise' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60, stale-while-revalidate=600');
    const body = res.json() as { slug: string; price: { amount: number } | null; cartPermalinkUrl: string | null };
    expect(body.slug).toBe('persian-sunrise');
    // Price and the reorder permalink are held null until Shopify Plus store access
    // lands. Seeding a plausible price would put an invented number in front of a
    // customer, and a plausible variant id would give the reorder button a
    // destination that does not exist. The mirror degrades rather than inventing.
    expect(body.price).toBeNull();
    expect(body.cartPermalinkUrl).toBeNull();
    expect(matchesSchema('#/components/schemas/CatalogEntry', body).errors).toEqual([]);
  });
});

describe('unknown routes', () => {
  it('answers the error envelope rather than a framework page', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/nothing-here' });
    expect(res.statusCode).toBe(404);
    expect(matchesSchema('#/components/schemas/ErrorEnvelope', res.json()).errors).toEqual([]);
  });
});

describe("the publish pipeline's cache buster", () => {
  /*
   * The renderer reads /v1 through the apex distribution, which caches content reads because
   * the frozen contract, section 7, says to. A render dispatched for an edit could otherwise
   * be handed the version from BEFORE that edit, publish it, and report success. So every
   * read the renderer makes carries a per render value in the query string, which makes a
   * cache key CloudFront has never seen.
   *
   * That only works if the API ignores the parameter, and this is where that is asserted
   * rather than assumed. The frozen contract is not modified: it declares no such parameter
   * and OpenAPI does not forbid one, and the renderer stays a client of the document like any
   * other. See build/publisher/src/content-read.mjs.
   */
  const buster = '_uncached=mtoj5ka9c1f0e2d3a4b5';

  it('is ignored, so the renderer gets the same bytes any other caller gets', async () => {
    for (const [plain, busted] of [
      ['/v1/blends', `/v1/blends?${buster}`],
      [
        '/v1/blends/persian-sunrise?include=grower,recipes',
        `/v1/blends/persian-sunrise?include=grower,recipes&${buster}`,
      ],
      ['/v1/catalog/persian-sunrise', `/v1/catalog/persian-sunrise?${buster}`],
    ]) {
      const before = await app.inject({ method: 'GET', url: plain as string });
      const after = await app.inject({ method: 'GET', url: busted as string });

      expect(after.statusCode, `${busted} must not be a 400`).toBe(200);
      expect(after.body).toBe(before.body);
      expect(after.headers['cache-control']).toBe(before.headers['cache-control']);
      expect(after.headers['etag']).toBe(before.headers['etag']);
    }
  });

  it('does not disturb the parameters the contract does declare', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/blends?limit=2&${buster}` });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: unknown[] }).data).toHaveLength(2);
  });
});
