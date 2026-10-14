// The Shopify price and availability mirror.
//
// This is an optional after paint refresh, not a required tap path call. The tests below
// pin the two properties that make that true: it is cacheable, and a failure of it never
// takes the reorder button with it, because the cart permalink is a static URL.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { callOperation } from '../client.js';
import { LAUNCH_BLEND_SLUGS, UNKNOWN_BLEND_SLUG } from '../fixtures.js';

describe('GET /v1/catalog/{slug}', () => {
  it('is readable with no credential', async () => {
    const result = await callOperation('getCatalogEntry', {
      anonymous: true,
      pathParams: { slug: LAUNCH_BLEND_SLUGS[0]! },
      expectStatus: 200,
    });
    assert.equal(result.body.slug, LAUNCH_BLEND_SLUGS[0]);
  });

  it('prices in integer minor units with a currency code, never a float', async () => {
    const result = await callOperation('getCatalogEntry', {
      anonymous: true,
      pathParams: { slug: LAUNCH_BLEND_SLUGS[0]! },
      expectStatus: 200,
    });
    if (result.body.price !== null && result.body.price !== undefined) {
      assert.ok(Number.isInteger(result.body.price.amount), 'Money is an integer in minor units. Section 8.1.');
      assert.match(result.body.price.currency, /^[A-Z]{3}$/);
    }
  });

  it('carries a static cart permalink so reorder survives a mirror failure', async () => {
    const result = await callOperation('getCatalogEntry', {
      anonymous: true,
      pathParams: { slug: LAUNCH_BLEND_SLUGS[0]! },
      expectStatus: 200,
    });
    assert.ok(
      typeof result.body.cartPermalinkUrl === 'string' && result.body.cartPermalinkUrl.length > 0,
      'One tap reorder is a cart permalink. Zero API calls, nothing to fail.',
    );
  });

  it('is cacheable at the CDN, because a slightly stale price beats no price', async () => {
    const result = await callOperation('getCatalogEntry', {
      anonymous: true,
      pathParams: { slug: LAUNCH_BLEND_SLUGS[0]! },
      expectStatus: 200,
    });
    const cacheControl = result.headers.get('cache-control') ?? '';
    assert.match(cacheControl, /public/, 'Section 7 requires a public cache directive on the catalog read.');
    assert.match(cacheControl, /max-age=\d+/);
  });

  it('reports an unknown inventory status rather than failing when the mirror is behind', async () => {
    const result = await callOperation('getCatalogEntry', {
      anonymous: true,
      pathParams: { slug: LAUNCH_BLEND_SLUGS[0]! },
      expectStatus: 200,
    });
    assert.ok(
      ['in_stock', 'low_stock', 'out_of_stock', 'unknown'].includes(result.body.inventoryStatus),
      'unknown is a legitimate answer when the mirror is stale. It is not an error.',
    );
  });

  it('404s an unknown slug', async () => {
    const result = await callOperation('getCatalogEntry', {
      anonymous: true,
      pathParams: { slug: UNKNOWN_BLEND_SLUG },
      expectStatus: 404,
    });
    assert.match(result.body.error.code, /NOT_FOUND$/);
  });
});
