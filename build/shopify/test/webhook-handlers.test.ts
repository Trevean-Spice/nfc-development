import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { handleProductsUpdate, normaliseRestProduct } from '../src/webhooks/productsUpdate.js';
import { attributeOrder, channelFromNoteAttributes, skuMapFromCatalog } from '../src/webhooks/ordersCreate.js';
import { deriveAvailability } from '../src/mirror/product.js';

const KNOWN_SLUGS = ['persian-sunrise', 'caribbean-sunset', 'silk-road', 'north-african-night-market', 'kyoto-garden'];
const BASE = 'https://shop.treveanspice.com';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/webhooks/${name}`, import.meta.url)), 'utf8'));
}

describe('products/update', () => {
  const payload = fixture('products-update.json');

  it('maps the REST payload onto the same mirror record shape the scheduled sync produces', () => {
    const result = handleProductsUpdate(payload, {
      knownSlugs: KNOWN_SLUGS,
      storefrontBase: BASE,
      syncedAt: '2026-08-22T09:00:00Z',
      defaultCurrency: 'USD',
    });
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.via).toBe('handle');
    expect(result.result.record).toMatchObject({
      slug: 'persian-sunrise',
      sku: 'TRV-PS-60G',
      shopifyProductId: 'gid://shopify/Product/7391043289601',
      shopifyVariantId: 'gid://shopify/ProductVariant/41802938471233',
      price: { amount: 2400, currency: 'USD' },
      available: true,
      inventoryStatus: 'in_stock',
      cartPermalinkUrl: 'https://shop.treveanspice.com/cart/41802938471233:1?channel=nfc',
      syncSource: 'webhook',
    });
  });

  it('parses the comma separated tag string Shopify sends on REST', () => {
    expect(normaliseRestProduct(payload).tags).toEqual(['spice-blend', 'launch']);
  });

  it('resolves by tag when the handle is not a blend slug', () => {
    const tagged = { ...(payload as Record<string, unknown>), handle: 'persian-sunrise-60g', tags: 'silk-road' };
    const result = handleProductsUpdate(tagged, { knownSlugs: KNOWN_SLUGS, syncedAt: '2026-08-22T09:00:00Z' });
    expect(result).toMatchObject({ matched: true, slug: 'silk-road', via: 'tag' });
  });

  it('reports an unresolved product rather than guessing, so a store and blend mismatch is visible', () => {
    const other = { ...(payload as Record<string, unknown>), handle: 'trevean-tote-bag', tags: 'merch' };
    expect(handleProductsUpdate(other, { knownSlugs: KNOWN_SLUGS, syncedAt: '2026-08-22T09:00:00Z' })).toEqual({
      matched: false,
      reason: 'unresolved_slug',
      handle: 'trevean-tote-bag',
      tags: ['merch'],
    });
  });

  it('survives a payload with no variants at all', () => {
    const empty = { ...(payload as Record<string, unknown>), variants: [] };
    const result = handleProductsUpdate(empty, { knownSlugs: KNOWN_SLUGS, syncedAt: '2026-08-22T09:00:00Z', storefrontBase: BASE });
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.result.record.shopifyVariantId).toBeNull();
    expect(result.result.record.cartPermalinkUrl).toBeNull();
    expect(result.result.warnings.join(' ')).toMatch(/no variants/);
  });

  it('mirrors a draft product as not purchasable, whatever its stock says (D58)', () => {
    const draft = { ...(payload as Record<string, unknown>), status: 'draft' };
    const result = handleProductsUpdate(draft, { knownSlugs: KNOWN_SLUGS, syncedAt: '2026-08-22T09:00:00Z', storefrontBase: BASE });
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.result.record).toMatchObject({ available: false, inventoryStatus: 'out_of_stock' });
    expect(result.result.warnings.join(' ')).toMatch(/status draft/);
  });

  it('survives an empty object without throwing', () => {
    expect(() => handleProductsUpdate({}, { knownSlugs: KNOWN_SLUGS, syncedAt: '2026-08-22T09:00:00Z' })).not.toThrow();
  });
});

describe('availability, derived from three Shopify signals rather than one', () => {
  it('is available when Shopify is not tracking inventory, which is the case most often mis-modelled', () => {
    expect(deriveAvailability({ inventoryManagement: null, inventoryQuantity: 0 })).toBe(true);
  });

  it('is available when overselling is allowed, regardless of quantity', () => {
    expect(deriveAvailability({ inventoryManagement: 'shopify', inventoryPolicy: 'continue', inventoryQuantity: 0 })).toBe(true);
  });

  it('follows the quantity when inventory is tracked and overselling is denied', () => {
    expect(deriveAvailability({ inventoryManagement: 'shopify', inventoryPolicy: 'deny', inventoryQuantity: 3 })).toBe(true);
    expect(deriveAvailability({ inventoryManagement: 'shopify', inventoryPolicy: 'deny', inventoryQuantity: 0 })).toBe(false);
  });

  it('answers null when there is not enough to decide, rather than guessing available', () => {
    expect(deriveAvailability({ inventoryManagement: 'shopify', inventoryPolicy: 'deny', inventoryQuantity: null })).toBeNull();
  });
});

describe('orders/create attribution', () => {
  const payload = fixture('orders-create.json') as Record<string, unknown>;
  const skuToSlug = { 'TRV-PS-60G': 'persian-sunrise', 'TRV-CS-60G': 'caribbean-sunset' };

  it('attributes per SKU and sums repeated lines into units', () => {
    const result = attributeOrder(payload, { skuToSlug });
    expect(result.attributions).toEqual([
      { blendSlug: 'caribbean-sunset', sku: 'TRV-CS-60G', quantity: 1, channel: 'nfc', occurredOn: '2026-08-21' },
      { blendSlug: 'persian-sunrise', sku: 'TRV-PS-60G', quantity: 3, channel: 'nfc', occurredOn: '2026-08-21' },
    ]);
  });

  it('records an unmatched SKU rather than dropping it silently', () => {
    expect(attributeOrder(payload, { skuToSlug }).unmatchedSkus).toEqual(['GIFT-CARD-25']);
  });

  it('converts the order timestamp to a UTC day for the rollup partition', () => {
    // created_at is 2026-08-21T14:22:09-04:00, which is 18:22 UTC on the same day.
    expect(attributeOrder(payload, { skuToSlug }).attributions[0]?.occurredOn).toBe('2026-08-21');
  });

  it('reads the channel from a cart attribute, which is the only way it can reach an order', () => {
    expect(channelFromNoteAttributes(payload)).toBe('nfc');
    expect(channelFromNoteAttributes({ note_attributes: [{ name: 'channel', value: 'sms' }] })).toBe('unknown');
    expect(channelFromNoteAttributes({})).toBe('unknown');
  });

  it('reports unknown channel when the permalink was built in the frozen contract shape', () => {
    // channel=nfc as a bare query parameter is inert: Shopify does not persist it, so it
    // reaches no order. See the README, "Two gaps".
    const { note_attributes, ...withoutAttributes } = payload;
    expect(note_attributes).toBeDefined();
    expect(attributeOrder(withoutAttributes, { skuToSlug }).attributions[0]?.channel).toBe('unknown');
  });

  it('attributes nothing when the SKU map is empty, which is the state today', () => {
    const result = attributeOrder(payload, { skuToSlug: {} });
    expect(result.attributions).toEqual([]);
    expect(result.unmatchedSkus.sort()).toEqual(['GIFT-CARD-25', 'TRV-CS-60G', 'TRV-PS-60G']);
  });

  it('builds the SKU map from the catalog mirror rather than from a guess', () => {
    expect(
      skuMapFromCatalog([
        { slug: 'persian-sunrise', sku: 'TRV-PS-60G' },
        { slug: 'kyoto-garden', sku: null },
      ]),
    ).toEqual({ 'TRV-PS-60G': 'persian-sunrise' });
  });

  it('does not count a line with no SKU or an unusable quantity, and says so', () => {
    const broken = {
      created_at: '2026-08-21T14:22:09Z',
      line_items: [{ quantity: 1 }, { sku: 'TRV-PS-60G', quantity: 0 }, { sku: 'TRV-PS-60G' }],
    };
    const result = attributeOrder(broken, { skuToSlug });
    expect(result.attributions).toEqual([]);
    expect(result.warnings).toHaveLength(3);
  });

  it('counts nothing when the order carries no usable created_at', () => {
    const result = attributeOrder({ line_items: [{ sku: 'TRV-PS-60G', quantity: 1 }] }, { skuToSlug });
    expect(result.attributions).toEqual([]);
    expect(result.warnings[0]).toMatch(/created_at/);
  });

  it('matches case insensitively only when asked', () => {
    const lower = { created_at: '2026-08-21T14:22:09Z', line_items: [{ sku: 'trv-ps-60g', quantity: 1 }] };
    expect(attributeOrder(lower, { skuToSlug }).attributions).toEqual([]);
    expect(attributeOrder(lower, { skuToSlug, caseInsensitive: true }).attributions).toHaveLength(1);
  });
});

describe('no personal data leaves the orders/create handler', () => {
  const payload = fixture('orders-create.json') as Record<string, unknown>;

  // Every one of these values is present in the fixture on purpose. The Architecture
  // document says no PII and no IP storage; the Data model document says no customer PII
  // and no IP address in any table. This is that commitment enforced rather than promised.
  const MUST_NOT_APPEAR = [
    'fake.customer@example.invalid',
    '+15550001111',
    '203.0.113.42',
    'Fictional',
    'Persona',
    '44 Nowhere Street',
    '02108',
    'Mozilla/5.0',
    '5432109876543',
    '#1042',
  ];

  it('produces output containing none of the personal data in the payload', () => {
    const result = attributeOrder(payload, {
      skuToSlug: { 'TRV-PS-60G': 'persian-sunrise', 'TRV-CS-60G': 'caribbean-sunset' },
    });
    const serialised = JSON.stringify(result);
    for (const value of MUST_NOT_APPEAR) {
      expect(serialised).not.toContain(value);
    }
  });

  it('the fixture really does contain all of it, so the assertion above is not vacuous', () => {
    const serialised = JSON.stringify(payload);
    for (const value of MUST_NOT_APPEAR) {
      expect(serialised).toContain(value);
    }
  });

  it('emits only the five documented fields per attribution, so a later addition is a deliberate act', () => {
    const result = attributeOrder(payload, { skuToSlug: { 'TRV-PS-60G': 'persian-sunrise' } });
    expect(Object.keys(result.attributions[0] ?? {}).sort()).toEqual([
      'blendSlug',
      'channel',
      'occurredOn',
      'quantity',
      'sku',
    ]);
  });
});
