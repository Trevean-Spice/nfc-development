import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveReorderTarget, reorderUnavailableLabel } from '../src/reorder.js';
import type { CatalogEntry } from '../src/types.js';

/*
 * The state of the reorder button, and the fixtures that prove what that state is today.
 *
 * The second block reads the real content fixtures out of build/content. That is the whole
 * point of it: the claim "there is no cart permalink today because there is no variant id"
 * is not a sentence in a README here, it is an assertion against the files the page build
 * actually consumes.
 */

const BASE = 'https://shop.treveanspice.com';

function entry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    slug: 'persian-sunrise',
    sku: null,
    shopifyProductId: null,
    shopifyVariantId: null,
    price: null,
    compareAtPrice: null,
    available: false,
    inventoryStatus: 'unknown',
    cartPermalinkUrl: null,
    syncedAt: '2026-08-22T09:00:00Z',
    stale: true,
    ...overrides,
  };
}

describe('resolving the reorder target', () => {
  it('is ready when a variant id and a storefront exist', () => {
    const target = resolveReorderTarget(entry({ shopifyVariantId: 'gid://shopify/ProductVariant/41802938471233', available: true }), {
      storefrontBase: BASE,
    });
    expect(target).toEqual({
      state: 'ready',
      url: 'https://shop.treveanspice.com/cart/41802938471233:1?channel=nfc',
      variantId: '41802938471233',
      quantity: 1,
    });
  });

  it('is unavailable with reason no_variant_id when the mirror carries none, which is every blend today', () => {
    const target = resolveReorderTarget(entry(), { storefrontBase: BASE });
    expect(target.state).toBe('unavailable');
    if (target.state === 'unavailable') {
      expect(target.reason).toBe('no_variant_id');
      expect(target.render).toBe('disabled-labelled');
      expect(target.detail).toMatch(/store access/i);
    }
  });

  it('is unavailable rather than throwing when the variant id is present but malformed', () => {
    const target = resolveReorderTarget(entry({ shopifyVariantId: '../../evil' }), { storefrontBase: BASE });
    expect(target).toMatchObject({ state: 'unavailable', reason: 'invalid_variant_id', render: 'disabled-labelled' });
  });

  it('is unavailable when no storefront is configured', () => {
    const target = resolveReorderTarget(entry({ shopifyVariantId: '41802938471233' }), { storefrontBase: null });
    expect(target).toMatchObject({ state: 'unavailable', reason: 'no_storefront_domain' });
  });

  it('degrades a rejected storefront configuration to a disabled button rather than a failed build', () => {
    const target = resolveReorderTarget(entry({ shopifyVariantId: '41802938471233' }), {
      storefrontBase: 'https://shop.attacker.example',
      allowedHosts: ['shop.treveanspice.com'],
    });
    expect(target).toMatchObject({ state: 'unavailable', reason: 'no_storefront_domain' });
  });

  it('does NOT disable on available false by default, because false currently means "we cannot say"', () => {
    // build/content's own fixture note: available is stored as false meaning we cannot say
    // it is available, not that it is out of stock. Treating that as out of stock would
    // disable every button on every blend for a reason that is not true.
    const target = resolveReorderTarget(entry({ shopifyVariantId: '41802938471233', available: false }), {
      storefrontBase: BASE,
    });
    expect(target.state).toBe('ready');
  });

  it('does disable on available false once explicitly configured to, for a real store', () => {
    const target = resolveReorderTarget(entry({ shopifyVariantId: '41802938471233', available: false }), {
      storefrontBase: BASE,
      disableWhenUnavailable: true,
    });
    expect(target).toMatchObject({ state: 'unavailable', reason: 'not_purchasable' });
    expect(reorderUnavailableLabel(target)).toBe('Not available to order');
  });

  it('gives the disabled state a label, so the page and the CMS say the same thing', () => {
    const target = resolveReorderTarget(entry(), { storefrontBase: BASE });
    expect(reorderUnavailableLabel(target)).toBe('Reorder is not connected yet');
    expect(reorderUnavailableLabel({ state: 'ready', url: 'x', variantId: '1', quantity: 1 })).toBeNull();
  });
});

/*
 * Against the real content fixtures.
 */
const FIXTURE_DIR = fileURLToPath(new URL('../../content/fixtures/catalog', import.meta.url));

function loadCatalogFixtures(): Array<{ file: string; catalog: CatalogEntry }> {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((file) => ({
      file,
      catalog: (JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8')) as { catalog: CatalogEntry }).catalog,
    }));
}

describe('the real content fixtures in build/content', () => {
  const fixtures = loadCatalogFixtures();

  it('finds all five blends', () => {
    expect(fixtures.map((f) => f.catalog.slug).sort()).toEqual([
      'caribbean-sunset',
      'kyoto-garden',
      'north-african-night-market',
      'persian-sunrise',
      'silk-road',
    ]);
  });

  it.each(fixtures.map((f) => [f.file, f] as const))(
    '%s: a null variant id yields a disabled labelled button and never a URL',
    (_file, fixture) => {
      // THE INVARIANT THAT MATTERS, and it is durable rather than a snapshot of today: a
      // fixture with no variant id must never produce a destination. When real ids land
      // this test keeps passing and starts proving the other branch instead.
      const target = resolveReorderTarget(fixture.catalog, { storefrontBase: BASE });
      if (fixture.catalog.shopifyVariantId === null) {
        expect(target).toMatchObject({ state: 'unavailable', reason: 'no_variant_id', render: 'disabled-labelled' });
        expect(JSON.stringify(target)).not.toContain('/cart/');
      } else {
        expect(target.state).toBe('ready');
      }
    },
  );

  it.each(fixtures.map((f) => [f.file, f] as const))(
    '%s: the stored cartPermalinkUrl is null exactly when the variant id is null',
    (_file, fixture) => {
      // A permalink present without a variant id would be a fabricated destination, which
      // is the failure this whole module exists to prevent.
      expect(fixture.catalog.cartPermalinkUrl === null).toBe(fixture.catalog.shopifyVariantId === null);
    },
  );

  it('records the state as observed on 22 August 2026: no blend has a reorder destination', () => {
    const ready = fixtures.filter(
      (f) => resolveReorderTarget(f.catalog, { storefrontBase: BASE }).state === 'ready',
    );
    // Not an assertion that this must stay true. It is the honest measurement that goes
    // into the delivery note, computed rather than typed. When store access lands and ids
    // are populated, this expectation is updated in the same commit as the fixtures.
    expect(ready).toHaveLength(0);
    expect(fixtures).toHaveLength(5);
  });
});
