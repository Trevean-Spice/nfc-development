import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MIRROR_OWNED_ATTRIBUTES,
  applyProductUpdate,
  decimalToMinorUnits,
  deriveAvailability,
  normaliseRestProduct,
  planProductUpdate,
} from '../../src/services/shopifyCatalogMirror.js';
import { attributeOrderLines } from '../../src/services/orderAttribution.js';
import { computeHmacBase64, isWellFormedSignature, webhookSecretFrom } from '../../src/webhooks/signature.js';
import { knownSlugs } from '../../src/http/spec.js';

/**
 * The products/update and orders/create rules, without a database.
 *
 * The first block is the fence against the two writers drifting: the catalog sync in
 * build/shopify and this webhook path must agree about what a CATALOG# row may contain.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SYNC_WRITER = resolve(HERE, '../../../shopify/src/sync/catalogWriter.ts');

function listFromSource(source: string, constant: string): string[] {
  const match = new RegExp(`export const ${constant} = \\[([\\s\\S]*?)\\] as const;`).exec(source);
  if (!match) throw new Error(`${constant} not found in the catalog sync writer`);
  return [...(match[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
}

describe('agreement with the catalog sync writer', () => {
  const source = readFileSync(SYNC_WRITER, 'utf8');

  it('owns exactly the same attributes, in the same order', () => {
    expect([...MIRROR_OWNED_ATTRIBUTES]).toEqual(listFromSource(source, 'MIRROR_OWNED_ATTRIBUTES'));
  });

  it('knows exactly the same slugs', () => {
    expect(knownSlugs()).toEqual(listFromSource(source, 'CONTRACT_SLUGS'));
  });

  it('writes the same condition expression shape', () => {
    expect(source).toContain("'attribute_exists(#pk)', 'begins_with(#pk, :catalogPrefix)', '#entityType = :catalogEntity'");
    expect(source).toContain("conditions.push('#shopifyProductId = :expectedProductId')");
  });
});

const PRODUCT = 'gid://shopify/Product/8001';
const VARIANT_A = 'gid://shopify/ProductVariant/44647352336487';
const VARIANT_B = 'gid://shopify/ProductVariant/44647352336488';

function restProduct(overrides: Record<string, unknown> = {}, variants?: Array<Record<string, unknown>>) {
  return {
    id: 8001,
    admin_graphql_api_id: PRODUCT,
    handle: 'caribbean-sunset',
    status: 'active',
    tags: '',
    variants: variants ?? [
      {
        id: 44647352336487,
        admin_graphql_api_id: VARIANT_A,
        sku: '',
        price: '18.00',
        compare_at_price: null,
        position: 1,
        inventory_management: 'shopify',
        inventory_policy: 'deny',
        inventory_quantity: 12,
      },
    ],
    ...overrides,
  };
}

const ROW = {
  pk: 'CATALOG#caribbean-sunset',
  sk: 'v0',
  entityType: 'CATALOG',
  slug: 'caribbean-sunset',
  shopifyProductId: PRODUCT,
  shopifyVariantId: VARIANT_A,
  priceAmount: 1800,
  available: true,
};

const OPTIONS = { syncedAt: '2026-10-14T12:00:00Z', syncSource: 'shopify-webhook-2026-10-14T12:00:00Z', currency: 'USD' };

describe('availability from the REST payload', () => {
  it('never reads variant.available, which Shopify REST does not send', () => {
    const product = normaliseRestProduct(restProduct());
    expect(product.variants[0]?.available).toBe(true);
    const tracked0 = normaliseRestProduct(restProduct({}, [{ admin_graphql_api_id: VARIANT_A, price: '18.00', inventory_management: 'shopify', inventory_policy: 'deny', inventory_quantity: 0, available: true }]));
    expect(tracked0.variants[0]?.available).toBe(false);
  });

  it('untracked is available, continue is available, unknown quantity is unknown', () => {
    expect(deriveAvailability({ inventory_management: null })).toBe(true);
    expect(deriveAvailability({})).toBe(true);
    expect(deriveAvailability({ inventory_management: 'shopify', inventory_policy: 'continue', inventory_quantity: 0 })).toBe(true);
    expect(deriveAvailability({ inventory_management: 'shopify', inventory_policy: 'deny' })).toBeNull();
  });
});

describe('planProductUpdate', () => {
  it('sets only mirror owned attributes, conditionally, never cartPermalinkUrl', () => {
    const plan = planProductUpdate(normaliseRestProduct(restProduct()), 'caribbean-sunset', ROW, OPTIONS);
    expect(plan.action).toBe('update');
    if (plan.action !== 'update') return;
    const written = Object.values(plan.update.ExpressionAttributeNames);
    for (const name of written) expect(['pk', 'entityType', ...MIRROR_OWNED_ATTRIBUTES]).toContain(name);
    expect(plan.update.UpdateExpression).not.toMatch(/REMOVE|cartPermalinkUrl/);
    expect(plan.update.ConditionExpression).toBe(
      'attribute_exists(#pk) AND begins_with(#pk, :catalogPrefix) AND #entityType = :catalogEntity AND #shopifyProductId = :expectedProductId',
    );
    expect(plan.update.ExpressionAttributeValues[':available']).toBe(true);
    expect(plan.update.ExpressionAttributeValues[':inventoryStatus']).toBe('in_stock');
    expect(plan.update.ExpressionAttributeValues[':priceAmount']).toBe(1800);
  });

  it('a draft product is not purchasable whatever its stock says', () => {
    const plan = planProductUpdate(normaliseRestProduct(restProduct({ status: 'draft' })), 'caribbean-sunset', ROW, OPTIONS);
    if (plan.action !== 'update') throw new Error('expected an update');
    expect(plan.update.ExpressionAttributeValues[':available']).toBe(false);
    expect(plan.update.ExpressionAttributeValues[':inventoryStatus']).toBe('out_of_stock');
  });

  it('keeps the pinned variant over position order, with several variants', () => {
    const variants = [
      { admin_graphql_api_id: VARIANT_B, price: '30.00', position: 1, inventory_management: null },
      { admin_graphql_api_id: VARIANT_A, price: '18.00', position: 2, inventory_management: null },
    ];
    const plan = planProductUpdate(normaliseRestProduct(restProduct({}, variants)), 'caribbean-sunset', ROW, OPTIONS);
    if (plan.action !== 'update') throw new Error('expected an update');
    expect(plan.update.ExpressionAttributeValues[':shopifyVariantId']).toBe(VARIANT_A);
    expect(plan.update.ExpressionAttributeValues[':priceAmount']).toBe(1800);
    expect(plan.update.ExpressionAttributeValues[':variantPosition']).toBe(2);
    expect(plan.warnings.join(' ')).toMatch(/2 variants/);
  });

  it('skips rather than repoints when the pinned variant is gone', () => {
    const variants = [{ admin_graphql_api_id: VARIANT_B, price: '30.00', position: 1 }];
    const plan = planProductUpdate(normaliseRestProduct(restProduct({}, variants)), 'caribbean-sunset', ROW, OPTIONS);
    expect(plan).toMatchObject({ action: 'skip', reason: 'variant_id_mismatch' });
  });

  it('skips a row pinned to another product, a missing row, a non catalog item and a product with no variant', () => {
    const product = normaliseRestProduct(restProduct());
    expect(planProductUpdate(product, 'caribbean-sunset', { ...ROW, shopifyProductId: 'gid://shopify/Product/9' }, OPTIONS)).toMatchObject({ reason: 'product_id_mismatch' });
    expect(planProductUpdate(product, 'caribbean-sunset', undefined, OPTIONS)).toMatchObject({ reason: 'row_missing' });
    expect(planProductUpdate(product, 'caribbean-sunset', { ...ROW, entityType: 'BLEND' }, OPTIONS)).toMatchObject({ reason: 'not_a_catalog_row' });
    expect(planProductUpdate(normaliseRestProduct(restProduct({}, [])), 'caribbean-sunset', ROW, OPTIONS)).toMatchObject({ reason: 'no_variant' });
  });

  it('keeps the last known price when a price is not exact, and clears an ended sale', () => {
    const variants = [{ admin_graphql_api_id: VARIANT_A, price: '18.005', compare_at_price: null, position: 1 }];
    const plan = planProductUpdate(normaliseRestProduct(restProduct({}, variants)), 'caribbean-sunset', { ...ROW, compareAtAmount: 2400 }, OPTIONS);
    if (plan.action !== 'update') throw new Error('expected an update');
    expect(plan.update.UpdateExpression).not.toContain('#priceAmount');
    expect(plan.update.ExpressionAttributeValues[':compareAtAmount']).toBeNull();
    expect(decimalToMinorUnits('24.000', 'USD')).toBe(2400);
    expect(decimalToMinorUnits('24.001', 'USD')).toBeNull();
  });

  it('reports a conditional failure instead of throwing it', async () => {
    const failure = Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });
    const outcome = await applyProductUpdate(restProduct(), {
      slugs: knownSlugs(),
      readRows: async () => new Map([['caribbean-sunset', ROW]]),
      update: async () => {
        throw failure;
      },
      isConditionFailure: (e) => (e as Error).name === 'ConditionalCheckFailedException',
      syncedAt: OPTIONS.syncedAt,
      currency: 'USD',
    });
    expect(outcome).toEqual({ outcome: 'condition_failed', slug: 'caribbean-sunset' });
  });
});

describe('order attribution', () => {
  const rows = new Map<string, Record<string, unknown>>([
    ['caribbean-sunset', { ...ROW }],
    ['silk-road', { ...ROW, slug: 'silk-road', shopifyVariantId: 'gid://shopify/ProductVariant/7', sku: 'TS-SR-46G' }],
  ]);
  const options = { slugs: knownSlugs(), codeToSlug: { ps: 'persian-sunrise' } };

  it('matches by variant id, then exact sku, then whole token rules, and sums units', () => {
    const result = attributeOrderLines(
      {
        created_at: '2026-10-13T23:30:00-04:00',
        line_items: [
          { variant_id: 44647352336487, sku: '', quantity: 2 },
          { variant_id: 44647352336487, sku: null, quantity: 1 },
          { variant_id: 999, sku: 'TS-SR-46G', quantity: 1 },
          { variant_id: null, sku: 'TS-PS-100G', quantity: 3 },
          { variant_id: 5, sku: 'TOTE-BAG', quantity: 1 },
          { variant_id: 5, sku: 'X', quantity: 0 },
        ],
      },
      rows,
      options,
    );
    expect(result.day).toBe('2026-10-14');
    expect(result.bySlug).toEqual([
      { slug: 'caribbean-sunset', units: 3 },
      { slug: 'persian-sunrise', units: 3 },
      { slug: 'silk-road', units: 1 },
    ]);
    expect(result.unmatchedLines).toBe(1);
    expect(result.unusableLines).toBe(1);
  });

  it('has no day without a usable created_at', () => {
    expect(attributeOrderLines({ line_items: [] }, rows, options).day).toBeNull();
  });
});

describe('signature and secret helpers', () => {
  it('accepts only the shape of a SHA-256 base64 digest', () => {
    expect(isWellFormedSignature(computeHmacBase64('{}', 'k'))).toBe(true);
    for (const bad of [undefined, '', 'abc', computeHmacBase64('{}', 'k').slice(0, 43), `${computeHmacBase64('{}', 'k')}x`]) {
      expect(isWellFormedSignature(bad)).toBe(false);
    }
  });

  it('refuses the terraform placeholder, which is written in the repository', () => {
    expect(webhookSecretFrom(JSON.stringify({ value: 'FILL IN WHEN ACCESS LANDS', set_by: 'terraform-placeholder' }))).toBeUndefined();
    expect(webhookSecretFrom('FILL IN WHEN ACCESS LANDS')).toBeUndefined();
    expect(webhookSecretFrom(undefined)).toBeUndefined();
    expect(webhookSecretFrom('  ')).toBeUndefined();
    expect(webhookSecretFrom('{not json')).toBeUndefined();
    expect(webhookSecretFrom('raw-secret')).toBe('raw-secret');
    expect(webhookSecretFrom(JSON.stringify({ value: 'json-secret' }))).toBe('json-secret');
  });
});
