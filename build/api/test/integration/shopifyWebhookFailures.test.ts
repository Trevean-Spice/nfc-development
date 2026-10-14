import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { config } from '../../src/config/env.js';
import { db } from '../../src/db/client.js';
import { computeHmacBase64 } from '../../src/webhooks/signature.js';
import { freezeClock, makeApp, resetAndSeed, unfreezeClock } from '../helpers/harness.js';

/**
 * What the routes answer when a write fails, so Shopify's retry does the right thing.
 *
 * The two writes are replaced with ones that fail on demand and otherwise call the real
 * repository, so everything around them (signature, read, plan, claim) is the real path.
 */

const failures = vi.hoisted(() => ({ catalogUpdate: 0, rollupAdd: 0 }));

vi.mock('../../src/repositories/catalog.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/repositories/catalog.js')>();
  return {
    ...real,
    updateCatalogMirror: async (...args: Parameters<typeof real.updateCatalogMirror>) => {
      if (failures.catalogUpdate > 0) {
        failures.catalogUpdate -= 1;
        throw Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });
      }
      return real.updateCatalogMirror(...args);
    },
  };
});

vi.mock('../../src/repositories/rollups.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/repositories/rollups.js')>();
  return {
    ...real,
    addCounters: async (...args: Parameters<typeof real.addCounters>) => {
      // Fail the second ADD of a delivery: the blend row has been written, the ALL row has not.
      if (failures.rollupAdd > 0 && args[0] === 'ROLLUP#ALL#DAY') {
        failures.rollupAdd -= 1;
        throw new Error('ProvisionedThroughputExceededException');
      }
      return real.addCounters(...args);
    },
  };
});

const SECRET = process.env.SECRET_TREVEAN_API_SHOPIFY_WEBHOOK_SECRET as string;
const VARIANT = 'gid://shopify/ProductVariant/44647352336487';
let app: FastifyInstance;

function post(url: string, topic: string, body: unknown, webhookId: string) {
  const raw = JSON.stringify(body);
  return app.inject({
    method: 'POST',
    url,
    headers: {
      'content-type': 'application/json',
      'x-shopify-hmac-sha256': computeHmacBase64(raw, SECRET),
      'x-shopify-topic': topic,
      'x-shopify-webhook-id': webhookId,
    },
    payload: raw,
  });
}

async function get(table: string, pk: string, sk: string) {
  return (await db().send(new GetCommand({ TableName: table, Key: { pk, sk }, ConsistentRead: true }))).Item;
}

beforeAll(async () => {
  freezeClock('2026-10-14T12:00:00Z');
  await resetAndSeed();
  await db().send(
    new PutCommand({
      TableName: config.tables.spiceBlends,
      Item: {
        pk: 'CATALOG#silk-road',
        sk: 'v0',
        entityType: 'CATALOG',
        slug: 'silk-road',
        shopifyProductId: 'gid://shopify/Product/8002',
        shopifyVariantId: VARIANT,
        priceAmount: 1800,
        priceCurrency: 'USD',
        available: true,
        inventoryStatus: 'in_stock',
        cartPermalinkUrl: null,
        syncedAt: '2026-10-07T15:00:00Z',
        syncSource: 'manual-verified-2026-10-07',
      },
    }),
  );
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
  unfreezeClock();
});

describe('products/update when the conditional write fails', () => {
  const product = {
    id: 8002,
    admin_graphql_api_id: 'gid://shopify/Product/8002',
    handle: 'silk-road',
    status: 'active',
    variants: [{ admin_graphql_api_id: VARIANT, price: '21.00', position: 1, inventory_management: null }],
  };

  it('answers 409 so Shopify retries, leaves the row alone, and the retry applies', async () => {
    failures.catalogUpdate = 1;
    const lost = await post('/internal/webhooks/shopify/products-update', 'products/update', product, 'wh-p-1');
    expect(lost.statusCode).toBe(409);
    expect(await get(config.tables.spiceBlends, 'CATALOG#silk-road', 'v0')).toMatchObject({ priceAmount: 1800 });

    const retry = await post('/internal/webhooks/shopify/products-update', 'products/update', product, 'wh-p-1');
    expect(retry.statusCode).toBe(200);
    expect(await get(config.tables.spiceBlends, 'CATALOG#silk-road', 'v0')).toMatchObject({ priceAmount: 2100 });
  });
});

describe('orders/create when a rollup write fails', () => {
  const order = { created_at: '2026-10-14T10:00:00Z', line_items: [{ variant_id: 44647352336487, quantity: 1 }] };

  it('answers 503, releases the failed row, and the retry completes without double counting', async () => {
    failures.rollupAdd = 1;
    const failed = await post('/internal/webhooks/shopify/orders-create', 'orders/create', order, 'wh-o-1');
    expect(failed.statusCode).toBe(503);
    expect(await get(config.tables.scanEvents, 'ROLLUP#BLEND#silk-road#DAY', '2026-10-14')).toMatchObject({ orders: 1, units: 1 });
    expect(await get(config.tables.scanEvents, 'ROLLUP#ALL#DAY', '2026-10-14')).toBeUndefined();

    const retry = await post('/internal/webhooks/shopify/orders-create', 'orders/create', order, 'wh-o-1');
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual({ ok: true, counted: 1 });
    expect(await get(config.tables.scanEvents, 'ROLLUP#BLEND#silk-road#DAY', '2026-10-14')).toMatchObject({ orders: 1, units: 1 });
    expect(await get(config.tables.scanEvents, 'ROLLUP#ALL#DAY', '2026-10-14')).toMatchObject({ orders: 1, units: 1 });
  });
});
