import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { syncCatalog } from '../src/admin/catalogSync.js';
import {
  AdminTransportError,
  FailingAdminTransport,
  HttpAdminTransport,
  RecordedAdminTransport,
  type AdminGraphQLResponse,
} from '../src/admin/transport.js';
import { StaticCredentialProvider } from '../src/config.js';
import { toApiCatalogEntry } from '../src/mirror/degrade.js';

/*
 * The catalog sync, against simulated Admin API responses.
 *
 * WHAT THIS PROVES: pagination, slug resolution, variant selection, availability
 * derivation, exact price conversion, permalink construction, cost aware waiting, retry on
 * a retryable failure, and partial results on a bad row.
 *
 * WHAT THIS DOES NOT PROVE: that Trevean's store returns this shape, that the query is
 * accepted, that the access scopes are sufficient, or that any value here resembles a real
 * price. The fixtures are hand built to the documented response shape and say so in their
 * own _fixture block. Nothing in this file has ever spoken to Shopify.
 */

const KNOWN_SLUGS = ['persian-sunrise', 'caribbean-sunset', 'silk-road', 'north-african-night-market', 'kyoto-garden'];
const BASE = 'https://shop.treveanspice.com';

function fixture(name: string): AdminGraphQLResponse {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/admin/${name}`, import.meta.url)), 'utf8'));
}

function pages(): AdminGraphQLResponse[] {
  return [fixture('products.page1.json'), fixture('products.page2.json')];
}

const FIXED_NOW = new Date('2026-08-22T09:00:00.000Z');

async function run(overrides: Partial<Parameters<typeof syncCatalog>[0]> = {}) {
  const slept: number[] = [];
  const result = await syncCatalog({
    transport: new RecordedAdminTransport(pages()),
    knownSlugs: KNOWN_SLUGS,
    storefrontBase: BASE,
    allowedHosts: ['shop.treveanspice.com'],
    defaultCurrency: 'USD',
    lowStockThreshold: 5,
    now: () => FIXED_NOW,
    sleep: async (ms) => {
      slept.push(ms);
    },
    ...overrides,
  });
  return { result, slept };
}

describe('walking the Admin API', () => {
  it('follows the cursor to the end and stops', async () => {
    const { result } = await run();
    expect(result.report.pagesFetched).toBe(2);
    expect(result.report.productsSeen).toBe(5);
  });

  it('sends the cursor from the previous page', async () => {
    const transport = new RecordedAdminTransport(pages());
    await run({ transport });
    expect(transport.requests[0]?.variables?.['after']).toBeNull();
    expect(transport.requests[1]?.variables?.['after']).toBe('eyJsYXN0X2lkIjoxfQ==');
  });

  it('mirrors four blends and skips the product that is not a blend', async () => {
    const { result } = await run();
    expect(result.records.map((r) => r.slug).sort()).toEqual([
      'caribbean-sunset',
      'north-african-night-market',
      'persian-sunrise',
      'silk-road',
    ]);
    expect(result.report.unmatched).toEqual([{ handle: 'trevean-tote-bag', title: 'Trevean tote bag' }]);
  });

  it('reports Kyoto Garden as a missing slug rather than inventing an entry for it', async () => {
    const { result } = await run();
    expect(result.missingSlugs).toEqual(['kyoto-garden']);
  });

  it('resolves a blend by tag when the Shopify handle is not our slug', async () => {
    // the-silk-road-blend is the handle, silk-road is the tag. This is the mismatch the
    // Architecture document already found between the scaffold and the redirect table, in
    // a second place, and it is why an explicit product to blend map is the mechanism we
    // are asking the client to confirm.
    const { result } = await run();
    const silkRoad = result.records.find((r) => r.slug === 'silk-road');
    expect(silkRoad?.shopifyProductId).toBe('gid://shopify/Product/7391043466673');
  });

  it('honours an explicit product to blend map ahead of the handle and the tag', async () => {
    const { result } = await run({ productToSlug: { 'trevean-tote-bag': 'kyoto-garden' } });
    expect(result.records.find((r) => r.slug === 'kyoto-garden')?.sku).toBe('TRV-TOTE');
    expect(result.report.unmatched).toEqual([]);
  });
});

describe('what lands on the mirror record', () => {
  it('carries the contract shape, with a working permalink', async () => {
    const { result } = await run();
    const persian = result.records.find((r) => r.slug === 'persian-sunrise');
    expect(persian).toMatchObject({
      slug: 'persian-sunrise',
      sku: 'TRV-PS-60G',
      shopifyProductId: 'gid://shopify/Product/7391043289601',
      shopifyVariantId: 'gid://shopify/ProductVariant/41802938471233',
      price: { amount: 2400, currency: 'USD' },
      compareAtPrice: null,
      available: true,
      inventoryStatus: 'in_stock',
      cartPermalinkUrl: 'https://shop.treveanspice.com/cart/41802938471233:1?channel=nfc',
      syncSource: 'schedule',
      stale: false,
    });
  });

  it('marks low stock at or below the threshold and carries a compare at price', async () => {
    const { result } = await run();
    const caribbean = result.records.find((r) => r.slug === 'caribbean-sunset');
    expect(caribbean?.inventoryStatus).toBe('low_stock');
    expect(caribbean?.compareAtPrice).toEqual({ amount: 2600, currency: 'USD' });
  });

  it('reports out of stock when the variant cannot be sold', async () => {
    const { result } = await run();
    expect(result.records.find((r) => r.slug === 'silk-road')?.inventoryStatus).toBe('out_of_stock');
    expect(result.records.find((r) => r.slug === 'silk-road')?.available).toBe(false);
  });

  it('stores no price rather than a rounded one when the amount cannot be converted exactly', async () => {
    const { result } = await run();
    const nightMarket = result.records.find((r) => r.slug === 'north-african-night-market');
    expect(nightMarket?.price).toBeNull();
    expect(result.report.warnings.join(' ')).toMatch(/could not be converted to minor units exactly/);
    // And the reorder button still works, which is the degradation the architecture asks for.
    expect(nightMarket?.cartPermalinkUrl).toBe('https://shop.treveanspice.com/cart/41802938667841:1?channel=nfc');
  });

  it('warns when a product has more than one variant, because the mirror stores one', async () => {
    const { result } = await run();
    expect(result.report.warnings.join(' ')).toMatch(/has 2 variants/);
  });

  it('selects the preferred SKU when one is configured', async () => {
    const { result } = await run({ preferredSkuBySlug: { 'caribbean-sunset': 'TRV-CS-120G' } });
    const caribbean = result.records.find((r) => r.slug === 'caribbean-sunset');
    expect(caribbean?.sku).toBe('TRV-CS-120G');
    expect(caribbean?.price).toEqual({ amount: 3800, currency: 'USD' });
    expect(caribbean?.variantPosition).toBe(2);
  });

  it('warns and falls back rather than failing when the preferred SKU is absent', async () => {
    const { result } = await run({ preferredSkuBySlug: { 'persian-sunrise': 'TRV-PS-250G' } });
    expect(result.records.find((r) => r.slug === 'persian-sunrise')?.sku).toBe('TRV-PS-60G');
    expect(result.report.warnings.join(' ')).toMatch(/was not found/);
  });

  it('mirrors without a permalink when no storefront is configured, rather than guessing one', async () => {
    const { result } = await run({ storefrontBase: null });
    expect(result.records.every((r) => r.cartPermalinkUrl === null)).toBe(true);
  });

  it('keeps mirroring every other blend when the storefront configuration is rejected', async () => {
    const { result } = await run({ storefrontBase: 'https://shop.attacker.example' });
    expect(result.records).toHaveLength(4);
    expect(result.records.every((r) => r.cartPermalinkUrl === null)).toBe(true);
    expect(result.report.warnings.join(' ')).toMatch(/not on the allowlist/);
  });
});

describe('behaviour under a misbehaving upstream', () => {
  it('waits when the leaky bucket falls below the floor, rather than waiting to be throttled', async () => {
    const { slept } = await run({ costFloor: 200 });
    // Page 2 reports 120 points available with a restore rate of 100 per second, so the
    // deficit of 80 costs 800 ms. Page 1 reports 1882 and costs nothing.
    expect(slept).toEqual([800]);
  });

  it('does not wait when the bucket is healthy', async () => {
    const { slept } = await run({ costFloor: 100 });
    expect(slept).toEqual([]);
  });

  it('retries a retryable failure with exponential backoff and then succeeds', async () => {
    const slept: number[] = [];
    const result = await syncCatalog({
      transport: new FailingAdminTransport(2, new RecordedAdminTransport(pages()), true),
      knownSlugs: KNOWN_SLUGS,
      storefrontBase: BASE,
      defaultCurrency: 'USD',
      now: () => FIXED_NOW,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    expect(result.report.retries).toBe(2);
    expect(slept.slice(0, 2)).toEqual([1000, 2000]);
    expect(result.records).toHaveLength(4);
  });

  it('does not retry a failure that is not retryable', async () => {
    await expect(
      syncCatalog({
        transport: new FailingAdminTransport(1, new RecordedAdminTransport(pages()), false),
        knownSlugs: KNOWN_SLUGS,
        now: () => FIXED_NOW,
        sleep: async () => {},
      }),
    ).rejects.toBeInstanceOf(AdminTransportError);
  });

  it('gives up after the retry budget rather than looping forever', async () => {
    await expect(
      syncCatalog({
        transport: new FailingAdminTransport(99, new RecordedAdminTransport(pages()), true),
        knownSlugs: KNOWN_SLUGS,
        maxRetries: 2,
        now: () => FIXED_NOW,
        sleep: async () => {},
      }),
    ).rejects.toBeInstanceOf(AdminTransportError);
  });

  it('surfaces GraphQL errors rather than writing an empty mirror over a good one', async () => {
    await expect(
      syncCatalog({
        transport: new RecordedAdminTransport([{ errors: [{ message: 'Access denied for products field' }] }]),
        knownSlugs: KNOWN_SLUGS,
        now: () => FIXED_NOW,
        sleep: async () => {},
      }),
    ).rejects.toThrow(/Access denied/);
  });

  it('retries a THROTTLED GraphQL error', async () => {
    const slept: number[] = [];
    const throttled: AdminGraphQLResponse = {
      errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
    };
    const result = await syncCatalog({
      transport: new RecordedAdminTransport([throttled, ...pages()]),
      knownSlugs: KNOWN_SLUGS,
      now: () => FIXED_NOW,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    expect(result.report.retries).toBe(1);
    expect(slept[0]).toBe(1000);
  });
});

describe('the transport boundary itself', () => {
  const credentials = new StaticCredentialProvider({ 'trevean/shopify/admin-access-token': 'not-a-real-token' });

  it('builds the endpoint from a pinned API version', () => {
    const transport = new HttpAdminTransport({
      shopDomain: 'trevean-spice.myshopify.com',
      apiVersion: '2025-01',
      accessTokenSecretName: 'trevean/shopify/admin-access-token',
      credentials,
    });
    expect(transport.endpoint).toBe('https://trevean-spice.myshopify.com/admin/api/2025-01/graphql.json');
  });

  it('refuses an unpinned API version, because the payload shape would change without a deploy', () => {
    expect(
      () =>
        new HttpAdminTransport({
          shopDomain: 'trevean-spice.myshopify.com',
          apiVersion: 'unstable',
          accessTokenSecretName: 'x',
          credentials,
        }),
    ).toThrow(/pinned/);
  });

  it('refuses a shop domain that is not a myshopify admin domain', () => {
    expect(
      () =>
        new HttpAdminTransport({
          shopDomain: 'treveanspice.com',
          apiVersion: '2025-01',
          accessTokenSecretName: 'x',
          credentials,
        }),
    ).toThrow(/myshopify/);
  });
});

describe('the entry the API actually serves', () => {
  it('degrades a stale entry to unknown availability but keeps the reorder destination', async () => {
    const { result } = await run();
    const record = result.records.find((r) => r.slug === 'persian-sunrise');
    const entry = toApiCatalogEntry(record!, { now: new Date('2026-08-22T13:00:00.000Z') });
    expect(entry.stale).toBe(true);
    expect(entry.inventoryStatus).toBe('unknown');
    // THE PROPERTY: the permalink is a static URL and needs no API call, so a sync outage
    // has no bearing on whether reorder works. Blanking it here would disable the primary
    // conversion action for a reason that does not apply to it.
    expect(entry.cartPermalinkUrl).toBe('https://shop.treveanspice.com/cart/41802938471233:1?channel=nfc');
    expect(entry.price).toEqual({ amount: 2400, currency: 'USD' });
  });

  it('is not stale inside the window', async () => {
    const { result } = await run();
    const record = result.records.find((r) => r.slug === 'persian-sunrise');
    const entry = toApiCatalogEntry(record!, { now: new Date('2026-08-22T10:30:00.000Z') });
    expect(entry.stale).toBe(false);
    expect(entry.inventoryStatus).toBe('in_stock');
  });

  it('treats an unparseable syncedAt as stale rather than as fresh', async () => {
    const { result } = await run();
    const record = { ...result.records[0]!, syncedAt: 'not a date' };
    expect(toApiCatalogEntry(record, { now: FIXED_NOW }).stale).toBe(true);
  });
});
