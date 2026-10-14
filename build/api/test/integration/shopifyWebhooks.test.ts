import { DeleteCommand, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../../src/config/env.js';
import { EnvSecretProvider, setSecretProvider, type SecretProvider } from '../../src/config/secrets.js';
import { db, isConditionalCheckFailed } from '../../src/db/client.js';
import { knownSlugs } from '../../src/http/spec.js';
import { readCatalogRows, updateCatalogMirror } from '../../src/repositories/catalog.js';
import { applyProductUpdate } from '../../src/services/shopifyCatalogMirror.js';
import { computeHmacBase64 } from '../../src/webhooks/signature.js';
import { freezeClock, makeApp, resetAndSeed, unfreezeClock } from '../helpers/harness.js';

/**
 * The two Shopify webhook routes against the in process DynamoDB, which evaluates the real
 * condition and update expressions: a malformed expression or a wrong condition fails here
 * the way it would fail in AWS.
 *
 * The rows are set up the way the deployed rows were written on 7 October 2026 (D65): a
 * product id and a verified variant id, a price, cartPermalinkUrl null, a manual provenance.
 */

const SECRET = process.env.SECRET_TREVEAN_API_SHOPIFY_WEBHOOK_SECRET as string;
const PRODUCTS = '/internal/webhooks/shopify/products-update';
const ORDERS = '/internal/webhooks/shopify/orders-create';

const PRODUCT = 'gid://shopify/Product/8001';
const VARIANT = 'gid://shopify/ProductVariant/44647352336487';
const VARIANT_2 = 'gid://shopify/ProductVariant/44647352336488';

let app: FastifyInstance;

function row(slug: string, extra: Record<string, unknown> = {}) {
  return {
    pk: `CATALOG#${slug}`,
    sk: 'v0',
    entityType: 'CATALOG',
    slug,
    sku: null,
    shopifyProductId: PRODUCT,
    shopifyVariantId: VARIANT,
    priceAmount: 1800,
    priceCurrency: 'USD',
    compareAtAmount: null,
    available: true,
    inventoryStatus: 'in_stock',
    cartPermalinkUrl: null,
    syncedAt: '2026-10-07T15:00:00Z',
    syncSource: 'manual-verified-2026-10-07',
    verifiedBy: 'hand, 7 October',
    ...extra,
  };
}

async function putRow(item: Record<string, unknown>) {
  await db().send(new PutCommand({ TableName: config.tables.spiceBlends, Item: item }));
}

async function getItem(table: string, pk: string, sk = 'v0') {
  return (await db().send(new GetCommand({ TableName: table, Key: { pk, sk }, ConsistentRead: true }))).Item;
}

function product(overrides: Record<string, unknown> = {}, variants?: Array<Record<string, unknown>>) {
  return {
    id: 8001,
    admin_graphql_api_id: PRODUCT,
    handle: 'caribbean-sunset-46g',
    title: 'Caribbean Sunset',
    status: 'active',
    tags: 'spice, blend',
    variants: variants ?? [
      {
        id: 44647352336487,
        admin_graphql_api_id: VARIANT,
        sku: '',
        price: '24.00',
        compare_at_price: null,
        position: 1,
        inventory_management: 'shopify',
        inventory_policy: 'deny',
        inventory_quantity: 7,
      },
    ],
    ...overrides,
  };
}

function signed(raw: string, topic: string, extra: Record<string, string> = {}, secret = SECRET) {
  return {
    'content-type': 'application/json',
    'x-shopify-hmac-sha256': computeHmacBase64(raw, secret),
    'x-shopify-topic': topic,
    'x-shopify-shop-domain': 'dmt009-91.myshopify.com',
    'x-shopify-webhook-id': 'b54557e4-bdd9-4b37-8a5f-bf7d70bcd043',
    ...extra,
  };
}

async function postProduct(body: unknown, extra: Record<string, string> = {}) {
  const raw = JSON.stringify(body);
  return app.inject({ method: 'POST', url: PRODUCTS, headers: signed(raw, 'products/update', extra), payload: raw });
}

async function scanAll(table: string) {
  return (await db().send(new ScanCommand({ TableName: table }))).Items ?? [];
}

beforeAll(async () => {
  freezeClock('2026-10-14T12:00:00Z');
  await resetAndSeed();
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
  unfreezeClock();
});

beforeEach(async () => {
  await putRow(row('caribbean-sunset'));
});

afterEach(() => {
  setSecretProvider(undefined);
  config.shopify.storeDomain = '';
});

describe('products/update: happy path', () => {
  it('updates only mirror owned attributes and derives availability from inventory', async () => {
    const blendBefore = await getItem(config.tables.spiceBlends, 'BLEND#caribbean-sunset');

    const res = await postProduct(product());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, matched: true, slug: 'caribbean-sunset' });

    const after = await getItem(config.tables.spiceBlends, 'CATALOG#caribbean-sunset');
    expect(after).toMatchObject({
      priceAmount: 2400,
      available: true,
      inventoryStatus: 'in_stock',
      shopifyVariantId: VARIANT,
      shopifyProductId: PRODUCT,
      variantPosition: 1,
      cartPermalinkUrl: null,
      verifiedBy: 'hand, 7 October',
      syncedAt: '2026-10-14T12:00:00Z',
      syncSource: 'shopify-webhook-2026-10-14T12:00:00Z',
    });
    expect(await getItem(config.tables.spiceBlends, 'BLEND#caribbean-sunset')).toEqual(blendBefore);

    const served = (await app.inject({ method: 'GET', url: '/v1/catalog/caribbean-sunset' })).json() as {
      price: { amount: number };
      available: boolean;
      stale: boolean;
    };
    expect(served.price.amount).toBe(2400);
    expect(served.available).toBe(true);
    expect(served.stale).toBe(false);
  });

  it('marks a tracked variant at zero out of stock, and an untracked one available', async () => {
    await postProduct(product({}, [{ admin_graphql_api_id: VARIANT, price: '18.00', position: 1, inventory_management: 'shopify', inventory_policy: 'deny', inventory_quantity: 0 }]));
    expect(await getItem(config.tables.spiceBlends, 'CATALOG#caribbean-sunset')).toMatchObject({ available: false, inventoryStatus: 'out_of_stock' });

    await postProduct(product({}, [{ admin_graphql_api_id: VARIANT, price: '18.00', position: 1, inventory_management: null }]));
    expect(await getItem(config.tables.spiceBlends, 'CATALOG#caribbean-sunset')).toMatchObject({ available: true, inventoryStatus: 'in_stock' });
  });
});

describe('products/update: edges', () => {
  it('a draft product is mirrored as not purchasable', async () => {
    const res = await postProduct(product({ status: 'draft' }));
    expect(res.statusCode).toBe(200);
    expect(await getItem(config.tables.spiceBlends, 'CATALOG#caribbean-sunset')).toMatchObject({ available: false, inventoryStatus: 'out_of_stock' });
  });

  it('an unknown product is acknowledged and writes nothing', async () => {
    const before = await scanAll(config.tables.spiceBlends);
    const res = await postProduct(product({ id: 9999, admin_graphql_api_id: 'gid://shopify/Product/9999', handle: 'tote-bag', tags: 'merch' }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, matched: false });
    expect(await scanAll(config.tables.spiceBlends)).toEqual(before);
  });

  it('with several variants keeps the row pinned variant, not the first by position', async () => {
    const res = await postProduct(
      product({}, [
        { admin_graphql_api_id: VARIANT_2, price: '40.00', position: 1, inventory_management: null },
        { admin_graphql_api_id: VARIANT, price: '19.00', position: 2, inventory_management: null },
      ]),
    );
    expect(res.statusCode).toBe(200);
    expect(await getItem(config.tables.spiceBlends, 'CATALOG#caribbean-sunset')).toMatchObject({
      shopifyVariantId: VARIANT,
      priceAmount: 1900,
      variantPosition: 2,
    });
  });

  it('skips, untouched, when the pinned variant is gone or the row mirrors another product', async () => {
    const before = await getItem(config.tables.spiceBlends, 'CATALOG#caribbean-sunset');
    const gone = await postProduct(product({}, [{ admin_graphql_api_id: VARIANT_2, price: '40.00', position: 1 }]));
    expect(gone.json()).toMatchObject({ skipped: 'variant_id_mismatch' });

    // Same handle as a slug, different product id: not repointed.
    const other = await postProduct(product({ id: 7777, admin_graphql_api_id: 'gid://shopify/Product/7777', handle: 'caribbean-sunset' }));
    expect(other.json()).toMatchObject({ skipped: 'product_id_mismatch' });

    expect(await getItem(config.tables.spiceBlends, 'CATALOG#caribbean-sunset')).toEqual(before);
  });

  it('never creates a row that does not exist', async () => {
    await db().send(new DeleteCommand({ TableName: config.tables.spiceBlends, Key: { pk: 'CATALOG#kyoto-garden', sk: 'v0' } }));
    const res = await postProduct(product({ id: 6006, admin_graphql_api_id: 'gid://shopify/Product/6006', handle: 'kyoto-garden' }));
    expect(res.json()).toMatchObject({ skipped: 'row_missing' });
    expect(await getItem(config.tables.spiceBlends, 'CATALOG#kyoto-garden')).toBeUndefined();
  });

  it('a duplicate delivery leaves the row exactly as the first one did', async () => {
    await postProduct(product());
    const first = await getItem(config.tables.spiceBlends, 'CATALOG#caribbean-sunset');
    const again = await postProduct(product());
    expect(again.statusCode).toBe(200);
    expect(await getItem(config.tables.spiceBlends, 'CATALOG#caribbean-sunset')).toEqual(first);
  });

  it('a topic that is not the route, or a shop that is not ours, is acknowledged and not applied', async () => {
    const before = await getItem(config.tables.spiceBlends, 'CATALOG#caribbean-sunset');
    const raw = JSON.stringify(product());
    const wrongTopic = await app.inject({ method: 'POST', url: PRODUCTS, headers: signed(raw, 'orders/create'), payload: raw });
    expect(wrongTopic.json()).toEqual({ ok: true, ignored: 'topic_mismatch' });

    config.shopify.storeDomain = 'dmt009-91.myshopify.com';
    const wrongShop = await postProduct(product(), { 'x-shopify-shop-domain': 'someone-else.myshopify.com' });
    expect(wrongShop.json()).toEqual({ ok: true, ignored: 'shop_not_allowed' });
    expect(await getItem(config.tables.spiceBlends, 'CATALOG#caribbean-sunset')).toEqual(before);

    const ours = await postProduct(product());
    expect(ours.json()).toMatchObject({ matched: true });
  });
});

describe('products/update: failures', () => {
  it('rejects unsigned, malformed and wrongly signed deliveries with 401 and writes nothing', async () => {
    const before = await getItem(config.tables.spiceBlends, 'CATALOG#caribbean-sunset');
    const raw = JSON.stringify(product());
    const cases: Array<Record<string, string>> = [
      { 'content-type': 'application/json', 'x-shopify-topic': 'products/update' },
      { ...signed(raw, 'products/update'), 'x-shopify-hmac-sha256': 'not-base64' },
      signed(raw, 'products/update', {}, 'some-other-secret'),
    ];
    for (const headers of cases) {
      const res = await app.inject({ method: 'POST', url: PRODUCTS, headers, payload: raw });
      expect(res.statusCode).toBe(401);
      expect((res.json() as { error: { code: string } }).error.code).toBe('INVALID_SIGNATURE');
    }
    // Signed over one body, delivered with another.
    const tampered = await app.inject({ method: 'POST', url: PRODUCTS, headers: signed(raw, 'products/update'), payload: JSON.stringify(product({ status: 'draft' })) });
    expect(tampered.statusCode).toBe(401);
    expect(await getItem(config.tables.spiceBlends, 'CATALOG#caribbean-sunset')).toEqual(before);
  });

  it('fails closed with 503 when the secret is missing, and an unsigned request is still 401', async () => {
    const missing: SecretProvider = { get: async () => { throw new Error('absent'); }, getOptional: async () => undefined };
    setSecretProvider(missing);
    const signedRes = await postProduct(product());
    expect(signedRes.statusCode).toBe(503);
    expect((signedRes.json() as { error: { code: string } }).error.code).toBe('SERVICE_UNAVAILABLE');

    const unsigned = await app.inject({ method: 'POST', url: PRODUCTS, headers: { 'content-type': 'application/json' }, payload: '{}' });
    expect(unsigned.statusCode).toBe(401);
    const malformed = await app.inject({
      method: 'POST',
      url: PRODUCTS,
      headers: { 'content-type': 'application/json', 'x-shopify-hmac-sha256': 'forged', 'x-shopify-topic': 'products/update' },
      payload: '{}',
    });
    expect(malformed.statusCode).toBe(401);
  });

  it('treats the terraform placeholder as no secret, so a body signed with the public placeholder is refused', async () => {
    const placeholder = JSON.stringify({ value: 'FILL IN WHEN ACCESS LANDS', set_by: 'terraform-placeholder' });
    setSecretProvider(new EnvSecretProvider({ SECRET_TREVEAN_API_SHOPIFY_WEBHOOK_SECRET: placeholder }));
    const raw = JSON.stringify(product());
    for (const key of [placeholder, 'FILL IN WHEN ACCESS LANDS']) {
      const res = await app.inject({ method: 'POST', url: PRODUCTS, headers: signed(raw, 'products/update', {}, key), payload: raw });
      expect(res.statusCode).toBe(503);
    }
  });

  it('a row that changes between read and write is not written (real conditional check)', async () => {
    const stale = await readCatalogRows(knownSlugs());
    // Somebody repoints the row by hand after the webhook read it.
    await putRow(row('caribbean-sunset', { shopifyProductId: 'gid://shopify/Product/5005', priceAmount: 1700 }));

    let conditionFailures = 0;
    const outcome = await applyProductUpdate(product(), {
      slugs: knownSlugs(),
      readRows: async () => stale,
      update: updateCatalogMirror,
      isConditionFailure: (e) => {
        if (isConditionalCheckFailed(e)) conditionFailures += 1;
        return isConditionalCheckFailed(e);
      },
      syncedAt: '2026-10-14T12:00:00Z',
      currency: 'USD',
    });
    expect(outcome).toEqual({ outcome: 'condition_failed', slug: 'caribbean-sunset' });
    expect(conditionFailures).toBe(1);
    expect(await getItem(config.tables.spiceBlends, 'CATALOG#caribbean-sunset')).toMatchObject({
      shopifyProductId: 'gid://shopify/Product/5005',
      priceAmount: 1700,
    });
  });
});

describe('orders/create', () => {
  const order = {
    id: 5550001,
    created_at: '2026-10-13T21:15:00-04:00',
    email: 'customer@example.com',
    phone: '+15555550123',
    browser_ip: '203.0.113.9',
    customer: { first_name: 'Pat', last_name: 'Doe', email: 'customer@example.com' },
    billing_address: { address1: '1 Example St', city: 'Springfield' },
    note_attributes: [],
    line_items: [
      { variant_id: 44647352336487, sku: '', quantity: 2, name: 'Caribbean Sunset - 46 g / Black' },
      { variant_id: 44647352336487, sku: '', quantity: 1 },
      { variant_id: 1, sku: 'TOTE-BAG', quantity: 1 },
    ],
  };

  async function postOrder(body: unknown, webhookId: string, extra: Record<string, string> = {}) {
    const raw = JSON.stringify(body);
    return app.inject({ method: 'POST', url: ORDERS, headers: signed(raw, 'orders/create', { 'x-shopify-webhook-id': webhookId, ...extra }), payload: raw });
  }

  it('counts one order and its units on the blend and ALL rows, on the order day, and stores no PII', async () => {
    const res = await postOrder(order, 'wh-order-1');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, counted: 2 });

    // 21:15 at -04:00 is 01:15 UTC on the 14th.
    expect(await getItem(config.tables.scanEvents, 'ROLLUP#BLEND#caribbean-sunset#DAY', '2026-10-14')).toMatchObject({ orders: 1, units: 3 });
    expect(await getItem(config.tables.scanEvents, 'ROLLUP#ALL#DAY', '2026-10-14')).toMatchObject({ orders: 1, units: 3 });

    const everything = JSON.stringify(await scanAll(config.tables.scanEvents));
    for (const pii of ['customer@example.com', '5555550123', '203.0.113.9', 'Doe', 'Example St']) {
      expect(everything).not.toContain(pii);
    }
  });

  it('a duplicate delivery adds nothing; a different delivery id counts', async () => {
    const again = await postOrder(order, 'wh-order-1');
    expect(again.json()).toEqual({ ok: true, counted: 0 });
    expect(await getItem(config.tables.scanEvents, 'ROLLUP#ALL#DAY', '2026-10-14')).toMatchObject({ orders: 1, units: 3 });

    await postOrder(order, 'wh-order-2');
    expect(await getItem(config.tables.scanEvents, 'ROLLUP#ALL#DAY', '2026-10-14')).toMatchObject({ orders: 2, units: 6 });
  });

  it('refuses a delivery with no webhook id, because it cannot be deduplicated', async () => {
    const raw = JSON.stringify(order);
    const headers = signed(raw, 'orders/create');
    delete (headers as Record<string, string>)['x-shopify-webhook-id'];
    const res = await app.inject({ method: 'POST', url: ORDERS, headers, payload: raw });
    expect(res.statusCode).toBe(400);
    expect(await getItem(config.tables.scanEvents, 'ROLLUP#ALL#DAY', '2026-10-14')).toMatchObject({ orders: 2 });
  });

  it('an order of nothing we sell counts nothing', async () => {
    const res = await postOrder({ ...order, line_items: [{ variant_id: 1, sku: 'TOTE-BAG', quantity: 1 }] }, 'wh-order-3');
    expect(res.json()).toEqual({ ok: true, counted: 0 });
  });

  it('rejects a wrongly signed order with 401', async () => {
    const raw = JSON.stringify(order);
    const res = await app.inject({ method: 'POST', url: ORDERS, headers: signed(raw, 'orders/create', { 'x-shopify-webhook-id': 'wh-x' }, 'wrong'), payload: raw });
    expect(res.statusCode).toBe(401);
  });
});
