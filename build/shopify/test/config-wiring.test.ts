import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  catalogSyncOptionsFromConfig,
  loadConfig,
  mapOptionsFromConfig,
  validateConfig,
  verifyOptionsFromConfig,
  type ShopifyConfig,
} from '../src/config.js';
import { syncCatalog } from '../src/admin/catalogSync.js';
import { RecordedAdminTransport, type AdminGraphQLResponse } from '../src/admin/transport.js';
import { mapProductToMirror } from '../src/mirror/map.js';
import { readShopifyHeaders, signBody, SHOPIFY_HEADERS, verifyWebhook } from '../src/webhooks/verify.js';
import { TOPIC_PRODUCTS_UPDATE } from '../src/webhooks/topics.js';

/*
 * The two allowlists, and the fact that they now reach something.
 *
 * Before these tests, allowedStorefrontHosts and allowedShopDomains were read from the
 * environment, reported on by validateConfig, and consumed by nothing at all. The whole
 * defect was that the configuration check went green on a guard that did not exist, which
 * is the shape of check that stops people looking. So every test here asserts the
 * allowlist changes an outcome rather than asserting it was set.
 *
 * Nothing in this file speaks to Shopify. The Admin responses are the same hand built
 * fixtures the catalog sync suite uses.
 */

const KNOWN_SLUGS = ['persian-sunrise', 'caribbean-sunset', 'silk-road', 'north-african-night-market', 'kyoto-garden'];
const FIXED_NOW = new Date('2026-09-04T09:00:00.000Z');
const SECRET = 'shpss_test_secret_not_a_real_credential';

function fixture(name: string): AdminGraphQLResponse {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/admin/${name}`, import.meta.url)), 'utf8'));
}

function pages(): AdminGraphQLResponse[] {
  return [fixture('products.page1.json'), fixture('products.page2.json')];
}

function configWith(overrides: Partial<ShopifyConfig>): ShopifyConfig {
  return { ...DEFAULT_CONFIG, stage: 'production', ...overrides };
}

describe('the storefront host allowlist reaches the permalink builder', () => {
  it('binds the config allowlist into a catalog sync, so an off allowlist base builds no permalink', async () => {
    // The failure this reproduces: one wrong environment variable, a base that looks
    // right, and a permalink baked into a pre rendered page on every jar of the blend.
    const config = configWith({
      storefrontBase: 'https://shop.trevean.com.evil.com',
      allowedStorefrontHosts: ['shop.treveanspice.com'],
    });

    const result = await syncCatalog(
      catalogSyncOptionsFromConfig(config, {
        transport: new RecordedAdminTransport(pages()),
        knownSlugs: KNOWN_SLUGS,
        now: () => FIXED_NOW,
        sleep: async () => {},
      }),
    );

    expect(result.records.length).toBeGreaterThan(0);
    for (const record of result.records) {
      expect(record.cartPermalinkUrl).toBeNull();
    }
    expect(result.report.warnings.join(' ')).toContain('is not on the allowlist');
  });

  it('builds the permalink when the base is on the allowlist, so the guard is not simply refusing everything', async () => {
    const config = configWith({
      storefrontBase: 'https://shop.treveanspice.com',
      allowedStorefrontHosts: ['shop.treveanspice.com'],
    });

    const result = await syncCatalog(
      catalogSyncOptionsFromConfig(config, {
        transport: new RecordedAdminTransport(pages()),
        knownSlugs: KNOWN_SLUGS,
        now: () => FIXED_NOW,
        sleep: async () => {},
      }),
    );

    const withPermalink = result.records.filter((record) => record.cartPermalinkUrl !== null);
    expect(withPermalink.length).toBeGreaterThan(0);
    for (const record of withPermalink) {
      expect(record.cartPermalinkUrl).toMatch(/^https:\/\/shop\.treveanspice\.com\/cart\//);
    }
  });

  it('binds the same two fields for a single product mapped outside a sync', () => {
    const config = configWith({
      storefrontBase: 'https://shop.trevean.com.evil.com',
      allowedStorefrontHosts: ['shop.treveanspice.com'],
    });

    const options = mapOptionsFromConfig(config, {
      slug: 'persian-sunrise',
      syncedAt: FIXED_NOW.toISOString(),
      syncSource: 'webhook',
    });
    expect(options.allowedHosts).toEqual(['shop.treveanspice.com']);

    const mapped = mapProductToMirror(
      {
        gid: 'gid://shopify/Product/1',
        handle: 'persian-sunrise',
        title: 'Persian Sunrise',
        status: 'ACTIVE',
        tags: [],
        variants: [
          {
            gid: 'gid://shopify/ProductVariant/418029',
            sku: 'PS-100',
            price: '18.00',
            compareAtPrice: null,
            currency: 'USD',
            position: 1,
            available: true,
            inventoryQuantity: 20,
          },
        ],
      },
      options,
    );
    expect(mapped.record.cartPermalinkUrl).toBeNull();
  });
});

describe('the shop domain allowlist reaches the webhook check', () => {
  const body = JSON.stringify({ id: 7391043289601, handle: 'persian-sunrise' });

  function headers(shopDomain: string) {
    return readShopifyHeaders({
      [SHOPIFY_HEADERS.hmac]: signBody(body, SECRET),
      [SHOPIFY_HEADERS.topic]: TOPIC_PRODUCTS_UPDATE,
      [SHOPIFY_HEADERS.shopDomain]: shopDomain,
      [SHOPIFY_HEADERS.webhookId]: '5f1c1f7e-0000-4000-8000-000000000002',
      [SHOPIFY_HEADERS.apiVersion]: '2025-01',
    });
  }

  it('refuses an authentic delivery from a shop the config does not list', async () => {
    const config = configWith({ allowedShopDomains: ['trevean-spice.myshopify.com'] });
    const result = await verifyWebhook(body, headers('someone-else.myshopify.com'), verifyOptionsFromConfig(config, SECRET));
    expect(result).toEqual({ ok: false, reason: 'shop_not_allowed' });
  });

  it('accepts the shop the config does list', async () => {
    const config = configWith({ allowedShopDomains: ['trevean-spice.myshopify.com'] });
    const result = await verifyWebhook(body, headers('trevean-spice.myshopify.com'), verifyOptionsFromConfig(config, SECRET));
    expect(result.ok).toBe(true);
  });

  it('carries the secret by parameter and never from the config, which holds only names', () => {
    const config = configWith({ allowedShopDomains: ['trevean-spice.myshopify.com'] });
    const options = verifyOptionsFromConfig(config, SECRET);
    expect(options.secret).toBe(SECRET);
    expect(JSON.stringify(config)).not.toContain(SECRET);
  });
});

describe('validateConfig checks the allowlist against the value it constrains', () => {
  it('reports a storefront base its own allowlist refuses, instead of counting both as present', () => {
    // Both fields are set, so the old check reported no problems at all. That green
    // result on a base pointing at another domain is the defect.
    const problems = validateConfig(
      configWith({
        storefrontBase: 'https://shop.trevean.com.evil.com',
        allowedStorefrontHosts: ['shop.treveanspice.com'],
        allowedShopDomains: ['trevean-spice.myshopify.com'],
        adminDomain: 'trevean-spice.myshopify.com',
      }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('refused by the storefront host allowlist');
  });

  it('reports nothing when the base and the allowlist agree', () => {
    expect(
      validateConfig(
        configWith({
          storefrontBase: 'https://shop.treveanspice.com',
          allowedStorefrontHosts: ['shop.treveanspice.com'],
          allowedShopDomains: ['trevean-spice.myshopify.com'],
          adminDomain: 'trevean-spice.myshopify.com',
        }),
      ),
    ).toEqual([]);
  });

  it('checks the pair at every stage, not only in production', () => {
    const problems = validateConfig(
      configWith({
        stage: 'staging',
        storefrontBase: 'https://shop.trevean.com.evil.com',
        allowedStorefrontHosts: ['shop.treveanspice.com'],
      }),
    );
    expect(problems.join(' ')).toContain('refused by the storefront host allowlist');
  });

  it('reads both allowlists out of the environment as comma separated lists', () => {
    const config = loadConfig({
      STAGE: 'production',
      SHOPIFY_ALLOWED_STOREFRONT_HOSTS: 'shop.treveanspice.com, treveanspice.com',
      SHOPIFY_ALLOWED_SHOP_DOMAINS: 'trevean-spice.myshopify.com',
    } as NodeJS.ProcessEnv);
    expect(config.allowedStorefrontHosts).toEqual(['shop.treveanspice.com', 'treveanspice.com']);
    expect(config.allowedShopDomains).toEqual(['trevean-spice.myshopify.com']);
  });
});
