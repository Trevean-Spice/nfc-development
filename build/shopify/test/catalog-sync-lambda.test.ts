import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  FailingAdminTransport,
  RecordedAdminTransport,
  type AdminGraphQLResponse,
  type AdminTransport,
} from '../src/admin/transport.js';
import { secretValueFrom } from '../src/lambda/aws.js';
import { catalogSyncSettingsFromEnv, createCatalogSyncHandler } from '../src/lambda/catalogSyncHandler.js';
import {
  CONTRACT_SLUGS,
  MIRROR_OWNED_ATTRIBUTES,
  catalogKey,
  marshal,
  planCatalogWrite,
  unmarshalItem,
  type Item,
} from '../src/sync/catalogWriter.js';
import { runCatalogSync } from '../src/sync/runCatalogSync.js';
import { MemoryTable } from './helpers/memoryTable.js';

/*
 * The catalog_sync Lambda: the handler, the planner and the conditional writer, end to
 * end against SIMULATED Admin API responses (fixtures/admin, labelled as such) and a
 * DynamoDB table held in memory that evaluates the expressions it is sent.
 *
 * WHAT THIS PROVES: which rows and which attributes a run writes, that BLEND# items and
 * attributes the sync does not own survive every run, dry run writes nothing, a failed
 * Admin API walk writes nothing, throttling is waited through, and a row that changed
 * between read and write is not overwritten.
 *
 * WHAT THIS DOES NOT PROVE: that the live store returns this shape, that the pinned API
 * version still serves it, that the token exists or has the scopes, or that the AWS SDK
 * calls in src/lambda/aws.ts behave as the in memory table does. Nothing here has spoken
 * to Shopify or AWS.
 */

const TABLE = 'trevean-test-spice-blends';
const NOW = new Date('2026-10-14T12:00:00.000Z');
const ENV = {
  TABLE_SPICE_BLENDS: TABLE,
  SHOPIFY_STORE_DOMAIN: 'dmt009-91.myshopify.com',
  TREVEAN_ENV: 'test',
  STAGE: 'staging',
  CATALOG_SYNC_DRY_RUN: 'false',
};

function fixture(name: string): AdminGraphQLResponse {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/admin/${name}`, import.meta.url)), 'utf8'));
}

type Page = { data: { products: { nodes: Array<Record<string, any>> } } };

function pages(edit?: (p1: Page, p2: Page) => void): AdminGraphQLResponse[] {
  const p1 = fixture('products.page1.json');
  const p2 = fixture('products.page2.json');
  edit?.(p1 as unknown as Page, p2 as unknown as Page);
  return [p1, p2];
}

function node(p: Page, handle: string): Record<string, any> {
  const found = p.data.products.nodes.find((n) => n['handle'] === handle);
  if (!found) throw new Error(`no fixture product ${handle}`);
  return found;
}

const PRODUCT = {
  'persian-sunrise': 'gid://shopify/Product/7391043289601',
  'caribbean-sunset': 'gid://shopify/Product/7391043355137',
  'silk-road': 'gid://shopify/Product/7391043466673',
  'north-african-night-market': 'gid://shopify/Product/7391043532209',
} as const;

const VARIANT: Record<string, string> = {
  'persian-sunrise': 'gid://shopify/ProductVariant/41802938471233',
  'caribbean-sunset': 'gid://shopify/ProductVariant/41802938536769',
  'silk-road': 'gid://shopify/ProductVariant/41802938602305',
  'north-african-night-market': 'gid://shopify/ProductVariant/41802938667841',
};

/** A row as the hand written update-item calls of 7 October 2026 left it, plus one attribute the sync does not own. */
function handWrittenRow(slug: string, productId: string | null, priceAmount: number, variantId: string | null = VARIANT[slug] ?? null): Item {
  return {
    pk: { S: `CATALOG#${slug}` },
    sk: { S: 'v0' },
    entityType: { S: 'CATALOG' },
    slug: { S: slug },
    sku: { S: `HAND-${slug}` },
    shopifyProductId: productId === null ? { NULL: true } : { S: productId },
    shopifyVariantId: variantId === null ? { NULL: true } : { S: variantId },
    priceAmount: { N: String(priceAmount) },
    priceCurrency: { S: 'USD' },
    compareAtAmount: { NULL: true },
    available: { BOOL: true },
    inventoryStatus: { S: 'in_stock' },
    cartPermalinkUrl: { NULL: true },
    syncedAt: { S: '2026-10-07T18:00:00.000Z' },
    syncSource: { S: 'manual-verified-2026-10-07' },
    editorNote: { S: 'not the sync\'s to touch' },
  };
}

function blendRow(slug: string): Item {
  return {
    pk: { S: `BLEND#${slug}` },
    sk: { S: 'v0' },
    entityType: { S: 'BLEND' },
    slug: { S: slug },
    name: { S: `Editorial ${slug}` },
    price: { S: 'editorial copy, not a mirror value' },
    available: { BOOL: true },
  };
}

function seededTable(): MemoryTable {
  const t = new MemoryTable();
  for (const [slug, id] of Object.entries(PRODUCT)) {
    t.put(handWrittenRow(slug, id, 1800));
    t.put(blendRow(slug));
  }
  t.put(handWrittenRow('kyoto-garden', null, 1800));
  t.put(blendRow('kyoto-garden'));
  return t;
}

function row(t: MemoryTable, slug: string): Record<string, unknown> {
  const it = t.item(`CATALOG#${slug}`);
  if (!it) throw new Error(`no row ${slug}`);
  return unmarshalItem(it);
}

function blendSnapshot(t: MemoryTable): string {
  return JSON.stringify(
    [...t.items.entries()].filter(([k]) => !k.startsWith('CATALOG#')).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function handlerFor(table: MemoryTable, transport: AdminTransport, env: Record<string, string> = ENV, extra: { maxRetries?: number } = {}) {
  const logs: Array<Record<string, unknown>> = [];
  const slept: number[] = [];
  const handler = createCatalogSyncHandler({
    env,
    transport: () => transport,
    table: async () => table,
    now: () => NOW,
    sleep: async (ms) => {
      slept.push(ms);
    },
    log: (e) => logs.push(e),
    ...extra,
  });
  return { handler, logs, slept };
}

let table: MemoryTable;
beforeEach(() => {
  table = seededTable();
});

/* ------------------------------------------------------------------ happy path */

describe('a scheduled run against the hand written rows', () => {
  it('updates the four mirrored blends and nothing else', async () => {
    const { handler } = handlerFor(table, new RecordedAdminTransport(pages()));
    const summary = await handler({});

    expect(summary.dryRun).toBe(false);
    expect(summary.outcomes.map((o) => [o.slug, o.action]).sort()).toEqual([
      ['caribbean-sunset', 'updated'],
      ['north-african-night-market', 'updated'],
      ['persian-sunrise', 'updated'],
      ['silk-road', 'updated'],
    ]);
    expect(table.updates).toHaveLength(4);
    for (const u of table.updates) {
      expect((u.Key['pk'] as { S: string }).S.startsWith('CATALOG#')).toBe(true);
    }
  });

  it('writes the mirror values Shopify returned, in the flat shape the API reads', async () => {
    await handlerFor(table, new RecordedAdminTransport(pages())).handler({});
    const ps = row(table, 'persian-sunrise');
    expect(ps).toMatchObject({
      sku: 'TRV-PS-60G',
      shopifyProductId: PRODUCT['persian-sunrise'],
      shopifyVariantId: 'gid://shopify/ProductVariant/41802938471233',
      priceAmount: 2400,
      priceCurrency: 'USD',
      compareAtAmount: null,
      available: true,
      inventoryStatus: 'in_stock',
      variantPosition: 1,
      syncedAt: '2026-10-14T12:00:00.000Z',
      syncSource: 'shopify-sync-2026-10-14T12:00:00.000Z',
    });
    expect(row(table, 'caribbean-sunset')).toMatchObject({ priceAmount: 2200, compareAtAmount: 2600 });
    expect(row(table, 'silk-road')).toMatchObject({ available: false, inventoryStatus: 'out_of_stock' });
  });

  it('leaves cartPermalinkUrl null so the API keeps deriving it from SHOPIFY_STORE_DOMAIN', async () => {
    await handlerFor(table, new RecordedAdminTransport(pages())).handler({});
    for (const slug of Object.keys(PRODUCT)) expect(row(table, slug)['cartPermalinkUrl']).toBeNull();
    for (const u of table.updates) expect(Object.values(u.ExpressionAttributeNames)).not.toContain('cartPermalinkUrl');
  });

  it('never touches a BLEND# item', async () => {
    const before = blendSnapshot(table);
    await handlerFor(table, new RecordedAdminTransport(pages())).handler({});
    expect(blendSnapshot(table)).toBe(before);
  });

  it('keeps every attribute it does not own, and sets only the ones it does', async () => {
    await handlerFor(table, new RecordedAdminTransport(pages())).handler({});
    expect(row(table, 'persian-sunrise')).toMatchObject({
      editorNote: 'not the sync\'s to touch',
      entityType: 'CATALOG',
      slug: 'persian-sunrise',
    });
    for (const u of table.updates) {
      const written = Object.values(u.ExpressionAttributeNames).filter((n) => u.UpdateExpression.includes(`#${n} =`));
      for (const n of written) expect(MIRROR_OWNED_ATTRIBUTES as readonly string[]).toContain(n);
      expect(u.UpdateExpression).not.toMatch(/REMOVE|ADD|DELETE/);
    }
  });

  it('reports Kyoto Garden as missing and the tote bag as unmatched, and writes neither', async () => {
    const kgBefore = JSON.stringify(table.item('CATALOG#kyoto-garden'));
    const summary = await handlerFor(table, new RecordedAdminTransport(pages())).handler({});
    expect(summary.missingSlugs).toEqual(['kyoto-garden']);
    expect(summary.unmatched.map((u) => u.handle)).toEqual(['trevean-tote-bag']);
    expect(JSON.stringify(table.item('CATALOG#kyoto-garden'))).toBe(kgBefore);
  });

  it('reports a price change as a change from the hand written value', async () => {
    const summary = await handlerFor(table, new RecordedAdminTransport(pages())).handler({});
    const ps = summary.outcomes.find((o) => o.slug === 'persian-sunrise');
    expect(ps && 'changes' in ps ? ps.changes['priceAmount'] : undefined).toEqual({ from: 1800, to: 2400 });
  });

  it('follows a later price change in Shopify', async () => {
    await handlerFor(table, new RecordedAdminTransport(pages())).handler({});
    const raised = pages((p1) => {
      node(p1, 'persian-sunrise')['variants'].nodes[0].price = '26.50';
    });
    const summary = await handlerFor(table, new RecordedAdminTransport(raised)).handler({});
    expect(row(table, 'persian-sunrise')['priceAmount']).toBe(2650);
    const ps = summary.outcomes.find((o) => o.slug === 'persian-sunrise');
    expect(ps && 'changes' in ps ? ps.changes : undefined).toEqual({ priceAmount: { from: 2400, to: 2650 } });
  });

  it('keeps the last known price when Shopify sends one that cannot be converted exactly', async () => {
    await handlerFor(table, new RecordedAdminTransport(pages())).handler({});
    // north-african-night-market is 23.995 in the fixture, deliberately.
    expect(row(table, 'north-african-night-market')['priceAmount']).toBe(1800);
  });

  it('is idempotent: a second run over the same store changes no mirror value', async () => {
    await handlerFor(table, new RecordedAdminTransport(pages())).handler({});
    const first = Object.keys(PRODUCT).map((s) => ({ ...row(table, s), syncedAt: null, syncSource: null }));
    const later = new Date('2026-10-14T13:00:00.000Z');
    const summary = await createCatalogSyncHandler({
      env: ENV,
      transport: () => new RecordedAdminTransport(pages()),
      table: async () => table,
      now: () => later,
      sleep: async () => {},
      log: () => {},
    })({});
    const second = Object.keys(PRODUCT).map((s) => ({ ...row(table, s), syncedAt: null, syncSource: null }));
    expect(second).toEqual(first);
    for (const o of summary.outcomes) expect('changes' in o ? o.changes : null).toEqual({});
    expect(row(table, 'persian-sunrise')['syncSource']).toBe('shopify-sync-2026-10-14T13:00:00.000Z');
  });
});

/* -------------------------------------------------------------------- dry run */

describe('dry run', () => {
  it('is the default when CATALOG_SYNC_DRY_RUN is unset, and writes nothing', async () => {
    const { CATALOG_SYNC_DRY_RUN: _omit, ...env } = ENV;
    const before = table.snapshot();
    const { handler, logs } = handlerFor(table, new RecordedAdminTransport(pages()), env);
    const summary = await handler({});
    expect(summary.dryRun).toBe(true);
    expect(table.updates).toHaveLength(0);
    expect(table.snapshot()).toBe(before);
    expect(summary.outcomes.every((o) => o.action === 'would_update')).toBe(true);
    const intent = logs.filter((l) => String(l['message']).startsWith('DRY RUN'));
    expect(intent).toHaveLength(4);
    expect(intent.find((l) => l['slug'] === 'persian-sunrise')?.['changes']).toMatchObject({
      priceAmount: { from: 1800, to: 2400 },
    });
  });

  it('is forced by { "dryRun": true } on the event even when writes are enabled', async () => {
    const before = table.snapshot();
    const summary = await handlerFor(table, new RecordedAdminTransport(pages())).handler({ dryRun: true });
    expect(summary.dryRun).toBe(true);
    expect(table.snapshot()).toBe(before);
  });

  it('cannot be turned off by the event', async () => {
    const { CATALOG_SYNC_DRY_RUN: _omit, ...env } = ENV;
    const summary = await handlerFor(table, new RecordedAdminTransport(pages()), env).handler({ dryRun: false });
    expect(summary.dryRun).toBe(true);
    expect(table.updates).toHaveLength(0);
  });

  it('writes only when CATALOG_SYNC_DRY_RUN is exactly "false"', () => {
    for (const value of ['true', 'FALSE', '0', 'no', '']) {
      expect(catalogSyncSettingsFromEnv({ ...ENV, CATALOG_SYNC_DRY_RUN: value }).dryRun).toBe(true);
    }
    expect(catalogSyncSettingsFromEnv(ENV).dryRun).toBe(false);
  });
});

/* ------------------------------------------------------------------ edge cases */

describe('edge cases in what Shopify returns', () => {
  it('mirrors a draft product as not purchasable', async () => {
    const drafted = pages((p1) => {
      node(p1, 'persian-sunrise')['status'] = 'DRAFT';
    });
    await handlerFor(table, new RecordedAdminTransport(drafted)).handler({});
    expect(row(table, 'persian-sunrise')).toMatchObject({ available: false, inventoryStatus: 'out_of_stock' });
    expect(row(table, 'caribbean-sunset')).toMatchObject({ available: true });
  });

  it('mirrors an archived product as not purchasable', async () => {
    const archived = pages((p1) => {
      node(p1, 'caribbean-sunset')['status'] = 'ARCHIVED';
    });
    await handlerFor(table, new RecordedAdminTransport(archived)).handler({});
    expect(row(table, 'caribbean-sunset')).toMatchObject({ available: false, inventoryStatus: 'out_of_stock' });
  });

  it('skips a product that came back with no variant, leaving the verified row as it was', async () => {
    const before = JSON.stringify(table.item('CATALOG#persian-sunrise'));
    const empty = pages((p1) => {
      node(p1, 'persian-sunrise')['variants'].nodes = [];
    });
    const summary = await handlerFor(table, new RecordedAdminTransport(empty)).handler({});
    expect(summary.outcomes.find((o) => o.slug === 'persian-sunrise')).toMatchObject({ action: 'skipped', reason: 'no_variant' });
    expect(JSON.stringify(table.item('CATALOG#persian-sunrise'))).toBe(before);
    expect(row(table, 'caribbean-sunset')['syncSource']).toMatch(/^shopify-sync-/);
  });

  it('does not repoint a row pinned to one product at a different product that matches by handle', async () => {
    table.put(handWrittenRow('persian-sunrise', 'gid://shopify/Product/999', 1800));
    const before = JSON.stringify(table.item('CATALOG#persian-sunrise'));
    const summary = await handlerFor(table, new RecordedAdminTransport(pages())).handler({});
    expect(summary.outcomes.find((o) => o.slug === 'persian-sunrise')).toMatchObject({
      action: 'skipped',
      reason: 'product_id_mismatch',
    });
    expect(JSON.stringify(table.item('CATALOG#persian-sunrise'))).toBe(before);
  });

  it('keeps the variant the row already points at, rather than the first by position', async () => {
    table.put(handWrittenRow('caribbean-sunset', PRODUCT['caribbean-sunset'], 1800, 'gid://shopify/ProductVariant/41802938536770'));
    await handlerFor(table, new RecordedAdminTransport(pages())).handler({});
    expect(row(table, 'caribbean-sunset')).toMatchObject({
      shopifyVariantId: 'gid://shopify/ProductVariant/41802938536770',
      sku: 'TRV-CS-120G',
      priceAmount: 3800,
      variantPosition: 2,
    });
  });

  it('does not repoint the reorder button when the row\'s variant is gone from the product', async () => {
    table.put(handWrittenRow('persian-sunrise', PRODUCT['persian-sunrise'], 1800, 'gid://shopify/ProductVariant/5555'));
    const before = JSON.stringify(table.item('CATALOG#persian-sunrise'));
    const summary = await handlerFor(table, new RecordedAdminTransport(pages())).handler({});
    expect(summary.outcomes.find((o) => o.slug === 'persian-sunrise')).toMatchObject({
      action: 'skipped',
      reason: 'variant_id_mismatch',
    });
    expect(JSON.stringify(table.item('CATALOG#persian-sunrise'))).toBe(before);
    expect(summary.warnings.join(' ')).toMatch(/no longer on the product/);
  });

  it('uses the product ids on the rows as the explicit map, ahead of the handle', async () => {
    // The row for silk-road is pinned to the product whose handle is persian-sunrise. The
    // pin wins; the handle match then finds the slug already taken and is ignored.
    table.put(handWrittenRow('silk-road', PRODUCT['persian-sunrise'], 1800, VARIANT['persian-sunrise']));
    table.put(handWrittenRow('persian-sunrise', null, 1800, null));
    await handlerFor(table, new RecordedAdminTransport(pages())).handler({});
    expect(row(table, 'silk-road')['sku']).toBe('TRV-PS-60G');
  });

  it('never creates a row that does not exist', async () => {
    table.items.delete('CATALOG#silk-road|v0');
    const summary = await handlerFor(table, new RecordedAdminTransport(pages())).handler({});
    expect(summary.outcomes.find((o) => o.slug === 'silk-road')).toMatchObject({ action: 'skipped', reason: 'row_missing' });
    expect(table.item('CATALOG#silk-road')).toBeUndefined();
  });

  it('does not write an item at a CATALOG# key that is not a CATALOG entity', async () => {
    const odd = handWrittenRow('silk-road', PRODUCT['silk-road'], 1800);
    odd['entityType'] = { S: 'SOMETHING_ELSE' };
    table.put(odd);
    const summary = await handlerFor(table, new RecordedAdminTransport(pages())).handler({});
    expect(summary.outcomes.find((o) => o.slug === 'silk-road')).toMatchObject({ action: 'skipped', reason: 'not_a_catalog_row' });
  });
});

/* -------------------------------------------------------------- failure modes */

describe('failure modes', () => {
  it('writes nothing when the Admin API refuses the request', async () => {
    const before = table.snapshot();
    const transport = new FailingAdminTransport(1, new RecordedAdminTransport(pages()), false);
    await expect(handlerFor(table, transport).handler({})).rejects.toThrow(/Simulated upstream failure/);
    expect(table.updates).toHaveLength(0);
    expect(table.snapshot()).toBe(before);
  });

  it('writes nothing when the Admin API answers with GraphQL errors', async () => {
    const transport = new RecordedAdminTransport([
      { errors: [{ message: 'Access denied for products field.', extensions: { code: 'ACCESS_DENIED' } }] },
    ]);
    await expect(handlerFor(table, transport).handler({})).rejects.toThrow(/Access denied/);
    expect(table.updates).toHaveLength(0);
  });

  it('writes nothing when a later page fails, rather than a partial mirror', async () => {
    const transport = new RecordedAdminTransport([pages()[0]!]);
    await expect(handlerFor(table, transport).handler({})).rejects.toThrow(/ran out of responses/);
    expect(table.updates).toHaveLength(0);
  });

  it('waits through throttling and then writes', async () => {
    const throttled: AdminGraphQLResponse = { errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] };
    const transport = new RecordedAdminTransport([throttled, throttled, ...pages()]);
    const { handler, slept } = handlerFor(table, transport);
    const summary = await handler({});
    expect(summary.report.retries).toBe(2);
    expect(slept.slice(0, 2)).toEqual([1000, 2000]);
    expect(table.updates).toHaveLength(4);
  });

  it('retries an HTTP 429 or 5xx and then writes', async () => {
    const transport = new FailingAdminTransport(2, new RecordedAdminTransport(pages()), true);
    const summary = await handlerFor(table, transport).handler({});
    expect(summary.report.retries).toBe(2);
    expect(table.updates).toHaveLength(4);
  });

  it('gives up after the retry budget and writes nothing', async () => {
    const throttled: AdminGraphQLResponse = { errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] };
    const transport = new RecordedAdminTransport([throttled, throttled, throttled, throttled, ...pages()]);
    await expect(handlerFor(table, transport, ENV, { maxRetries: 3 }).handler({})).rejects.toThrow(/Throttled/);
    expect(table.updates).toHaveLength(0);
  });

  it('does not overwrite a row that changed between read and write, writes the others, and fails the run', async () => {
    table.beforeUpdate = (input, t) => {
      if ((input.Key['pk'] as { S: string }).S === 'CATALOG#caribbean-sunset') {
        // Someone repoints the row while the sync is walking Shopify.
        const current = t.items.get('CATALOG#caribbean-sunset|v0')!;
        current['shopifyProductId'] = marshal('gid://shopify/Product/424242');
      }
    };
    const { handler } = handlerFor(table, new RecordedAdminTransport(pages()));
    await expect(handler({})).rejects.toThrow(/1 row write\(s\) failed/);
    expect(row(table, 'caribbean-sunset')).toMatchObject({
      shopifyProductId: 'gid://shopify/Product/424242',
      priceAmount: 1800,
      syncSource: 'manual-verified-2026-10-07',
    });
    expect(row(table, 'persian-sunrise')['priceAmount']).toBe(2400);
  });

  it('reports the condition failure by slug and reason', async () => {
    table.beforeUpdate = (input, t) => {
      if ((input.Key['pk'] as { S: string }).S === 'CATALOG#silk-road') t.items.delete('CATALOG#silk-road|v0');
    };
    const summary = await runCatalogSync({
      transport: new RecordedAdminTransport(pages()),
      table,
      tableName: TABLE,
      knownSlugs: CONTRACT_SLUGS,
      dryRun: false,
      now: () => NOW,
      sleep: async () => {},
    });
    expect(summary.failures).toBe(1);
    expect(summary.outcomes.find((o) => o.slug === 'silk-road')).toMatchObject({ action: 'failed', reason: 'condition_failed' });
    expect(table.item('CATALOG#silk-road')).toBeUndefined();
  });

  it('reports any other write error as a write error and fails the run', async () => {
    table.beforeUpdate = (input) => {
      if ((input.Key['pk'] as { S: string }).S === 'CATALOG#silk-road') throw new Error('ProvisionedThroughputExceededException');
    };
    const { handler, logs } = handlerFor(table, new RecordedAdminTransport(pages()));
    await expect(handler({})).rejects.toThrow(/row write/);
    expect(logs.some((l) => l['slug'] === 'silk-road' && String(l['detail']).includes('ProvisionedThroughput'))).toBe(true);
  });

  it('stops before calling Shopify when the rows cannot be read', async () => {
    table.beforeGet = () => {
      throw new Error('AccessDeniedException');
    };
    const transport = new RecordedAdminTransport(pages());
    await expect(handlerFor(table, transport).handler({})).rejects.toThrow(/AccessDenied/);
    expect(transport.requests).toHaveLength(0);
    expect(table.updates).toHaveLength(0);
  });
});

/* ---------------------------------------------------- keys, plans, configuration */

describe('the fences around the write', () => {
  it('knows exactly the slugs in the frozen contract', () => {
    const doc = parseYaml(readFileSync(fileURLToPath(new URL('../openapi/openapi.yaml', import.meta.url)), 'utf8'));
    expect([...CONTRACT_SLUGS].sort()).toEqual([...doc.components.schemas.Slug.enum].sort());
  });

  it('refuses to build a key for anything that is not a contract slug', () => {
    for (const bad of ['BLEND#persian-sunrise', 'persian-sunrise#x', '', 'tote-bag', '../persian-sunrise']) {
      expect(() => catalogKey(bad)).toThrow(/Refusing/);
    }
    expect(catalogKey('silk-road')).toEqual({ pk: { S: 'CATALOG#silk-road' }, sk: { S: 'v0' } });
  });

  it('conditions every write on the row existing as a CATALOG entity under CATALOG#', () => {
    const plan = planCatalogWrite(
      {
        slug: 'silk-road',
        sku: 'X',
        shopifyProductId: PRODUCT['silk-road'],
        shopifyVariantId: VARIANT['silk-road']!,
        price: { amount: 100, currency: 'USD' },
        compareAtPrice: null,
        available: true,
        inventoryStatus: 'in_stock',
        cartPermalinkUrl: 'https://example.invalid/should-not-be-written',
        syncedAt: NOW.toISOString(),
        stale: false,
        syncSource: 'schedule',
        variantPosition: 1,
      },
      unmarshalItem(handWrittenRow('silk-road', PRODUCT['silk-road'], 1800)),
      { tableName: TABLE, syncedAt: NOW.toISOString(), syncSource: 'shopify-sync-x' },
    );
    expect(plan.action).toBe('update');
    if (plan.action !== 'update') return;
    expect(plan.input.ConditionExpression).toBe(
      'attribute_exists(#pk) AND begins_with(#pk, :catalogPrefix) AND #entityType = :catalogEntity AND #shopifyProductId = :expectedProductId',
    );
    expect(plan.input.UpdateExpression).not.toContain('cartPermalinkUrl');
    expect(plan.input.UpdateExpression).not.toContain('#entityType =');
    expect(plan.input.UpdateExpression).not.toContain('#slug');
  });

  it('reports every configuration problem at once, before anything is constructed', () => {
    expect(() => catalogSyncSettingsFromEnv({ SHOPIFY_STORE_DOMAIN: 'shop.treveanliving.com', CATALOG_SYNC_KNOWN_SLUGS: 'tote-bag' })).toThrow(
      /TABLE_SPICE_BLENDS is not set\. shop\.treveanliving\.com is not a myshopify admin domain\. CATALOG_SYNC_KNOWN_SLUGS names slugs outside the contract: tote-bag\./,
    );
  });

  it('takes the admin domain from SHOPIFY_STORE_DOMAIN and the secret name from the environment name', () => {
    const s = catalogSyncSettingsFromEnv({ TABLE_SPICE_BLENDS: TABLE, SHOPIFY_STORE_DOMAIN: 'dmt009-91.myshopify.com', TREVEAN_ENV: 'dev' });
    expect(s.adminDomain).toBe('dmt009-91.myshopify.com');
    expect(s.tokenSecretName).toBe('trevean/dev/shopify-admin-api-token');
    expect(s.apiVersion).toMatch(/^\d{4}-\d{2}$/);
    expect(s.knownSlugs).toEqual([...CONTRACT_SLUGS]);
  });

  it('refuses a malformed product map rather than ignoring it', () => {
    expect(() => catalogSyncSettingsFromEnv({ ...ENV, CATALOG_SYNC_PRODUCT_MAP: '{not json' })).toThrow(/PRODUCT_MAP/);
  });
});

describe('reading the token out of Secrets Manager', () => {
  it('accepts a raw token or a JSON object with a value', () => {
    expect(secretValueFrom('  token-value  ', 'n')).toBe('token-value');
    expect(secretValueFrom('{"value":"token-value"}', 'n')).toBe('token-value');
  });

  it('refuses the terraform placeholder rather than sending it to Shopify', () => {
    expect(() => secretValueFrom('{"value":"FILL IN WHEN ACCESS LANDS","set_by":"terraform-placeholder"}', 'n')).toThrow(/placeholder/);
    expect(() => secretValueFrom('FILL IN WHEN ACCESS LANDS', 'n')).toThrow(/placeholder/);
  });

  it('refuses an empty or unreadable value', () => {
    expect(() => secretValueFrom(undefined, 'n')).toThrow(/no value/);
    expect(() => secretValueFrom('   ', 'n')).toThrow(/no value/);
    expect(() => secretValueFrom('{oops', 'n')).toThrow(/does not parse/);
    expect(() => secretValueFrom('{"other":1}', 'n')).toThrow(/without a string/);
  });
});
