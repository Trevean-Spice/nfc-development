/*
 * Catalog sync. Job three of the three in the Architecture document, "Shopify Plus".
 *
 * Products, variants, prices and availability mirrored into DynamoDB on a schedule and on
 * product update webhooks, so Shopify latency is never inside the 2.0 second budget and a
 * Shopify incident degrades a price label rather than breaking a page.
 *
 * This module walks the Admin API, maps what it finds, and returns records plus a report.
 * IT DOES NOT WRITE. Persistence belongs to the API package, which owns the DynamoDB
 * client and the CATALOG# key namespace, and keeping the write out of here is what lets
 * the entire sync be tested without a database as well as without a store.
 *
 * THREE BEHAVIOURS WORTH READING BEFORE CHANGING ANYTHING.
 *
 * 1. A partial result is a result. If one product fails to map, the other four are still
 *    returned and the failure is in the report. A sync that refuses to write anything
 *    because one blend has a malformed price leaves five stale price labels instead of one.
 *
 * 2. Cost aware, not retry aware. Shopify's Admin GraphQL API bills against a leaky
 *    bucket and reports the bucket state on every response. Waiting when the bucket is low
 *    is cheaper and politer than being throttled and retrying, so the throttle status is
 *    read and respected rather than ignored until a 429 arrives.
 *
 * 3. The clock and the sleep are injected. A retry test that really sleeps is a test
 *    nobody runs.
 */

import { mapProductToMirror, type MapOptions } from '../mirror/map.js';
import { deriveAvailability, resolveSlug, type NormalisedProduct, type SlugResolutionOptions } from '../mirror/product.js';
import type { CatalogMirrorRecord } from '../types.js';
import { PRODUCTS_PAGE_QUERY, type ProductsPageData } from './queries.js';
import { AdminTransportError, type AdminTransport } from './transport.js';

export interface CatalogSyncOptions extends SlugResolutionOptions {
  transport: AdminTransport;
  /** Storefront origin for permalink construction. Omit to mirror without permalinks. */
  storefrontBase?: string | null;
  allowedHosts?: string[];
  /** Shopify search query narrowing the product set, for example a collection or tag filter. */
  productQuery?: string | null;
  pageSize?: number;
  /** Preferred SKU per blend slug, when a blend has more than one variant. */
  preferredSkuBySlug?: Record<string, string>;
  /** The variant each slug already mirrors. Wins over the SKU preference and over position. */
  preferredVariantIdBySlug?: Record<string, string>;
  lowStockThreshold?: number | null;
  defaultCurrency?: string;
  attributionMode?: MapOptions['attributionMode'];
  channel?: string;
  maxRetries?: number;
  /** Wait when the leaky bucket falls below this many points. */
  costFloor?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export interface CatalogSyncReport {
  pagesFetched: number;
  productsSeen: number;
  matched: number;
  unmatched: Array<{ handle: string | null; title: string | null }>;
  warnings: string[];
  throttleWaitsMs: number;
  retries: number;
  startedAt: string;
  finishedAt: string;
}

export interface CatalogSyncResult {
  records: CatalogMirrorRecord[];
  report: CatalogSyncReport;
  /**
   * Slugs the sync expected to find and did not. Non empty means a blend page will keep
   * serving whatever the mirror held before, which is the correct degradation and is also
   * something somebody should be told about.
   */
  missingSlugs: string[];
}

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_COST_FLOOR = 200;
const DEFAULT_MAX_RETRIES = 3;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Admin GraphQL variant node to the normalised shape. */
function normaliseGraphQLProduct(node: ProductsPageData['products']['nodes'][number], defaultCurrency: string | undefined): NormalisedProduct {
  return {
    gid: node.id,
    handle: node.handle,
    title: node.title,
    status: node.status,
    tags: Array.isArray(node.tags) ? node.tags : [],
    variants: (node.variants?.nodes ?? []).map((v) => ({
      gid: v.id,
      sku: v.sku,
      price: v.price,
      compareAtPrice: v.compareAtPrice,
      currency: defaultCurrency ?? null,
      position: v.position,
      available: deriveAvailability({
        availableForSale: v.availableForSale,
        // inventoryItem.tracked false is the GraphQL equivalent of a null
        // inventory_management on REST: Shopify is not tracking, so it is purchasable.
        inventoryManagement: v.inventoryItem?.tracked === false ? null : 'shopify',
        inventoryPolicy: v.inventoryPolicy,
        inventoryQuantity: v.inventoryQuantity,
      }),
      inventoryQuantity: v.inventoryQuantity,
    })),
  };
}

async function executeWithRetry(
  options: CatalogSyncOptions,
  variables: Record<string, unknown>,
  report: { retries: number; throttleWaitsMs: number; warnings: string[] },
): Promise<ProductsPageData> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const sleep = options.sleep ?? defaultSleep;
  let attempt = 0;

  for (;;) {
    try {
      const response = await options.transport.execute<ProductsPageData>({
        query: PRODUCTS_PAGE_QUERY,
        variables,
      });

      if (response.errors && response.errors.length > 0) {
        const throttled = response.errors.some((e) => String(e.extensions?.['code'] ?? '') === 'THROTTLED');
        if (throttled && attempt < maxRetries) {
          attempt += 1;
          report.retries += 1;
          const waitMs = 1000 * 2 ** (attempt - 1);
          report.throttleWaitsMs += waitMs;
          await sleep(waitMs);
          continue;
        }
        throw new AdminTransportError(
          `Admin API returned errors: ${response.errors.map((e) => e.message).join('; ')}`,
          null,
          false,
        );
      }

      if (!response.data) {
        throw new AdminTransportError('Admin API returned no data and no errors.', null, false);
      }

      // Cost aware pause. Cheaper than being throttled, and it keeps a scheduled sync from
      // starving an interactive admin call sharing the same bucket.
      const throttle = response.extensions?.cost?.throttleStatus;
      const floor = options.costFloor ?? DEFAULT_COST_FLOOR;
      if (
        throttle &&
        typeof throttle.currentlyAvailable === 'number' &&
        typeof throttle.restoreRate === 'number' &&
        throttle.restoreRate > 0 &&
        throttle.currentlyAvailable < floor
      ) {
        const deficit = floor - throttle.currentlyAvailable;
        const waitMs = Math.ceil((deficit / throttle.restoreRate) * 1000);
        report.throttleWaitsMs += waitMs;
        await sleep(waitMs);
      }

      return response.data;
    } catch (error) {
      const retryable = error instanceof AdminTransportError && error.retryable;
      if (!retryable || attempt >= maxRetries) throw error;
      attempt += 1;
      report.retries += 1;
      const waitMs = 1000 * 2 ** (attempt - 1);
      report.throttleWaitsMs += waitMs;
      await sleep(waitMs);
    }
  }
}

export async function syncCatalog(options: CatalogSyncOptions): Promise<CatalogSyncResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const counters = { retries: 0, throttleWaitsMs: 0, warnings: [] as string[] };

  const records: CatalogMirrorRecord[] = [];
  const unmatched: CatalogSyncReport['unmatched'] = [];
  const seenSlugs = new Set<string>();
  let pagesFetched = 0;
  let productsSeen = 0;
  let after: string | null = null;

  for (;;) {
    const data: ProductsPageData = await executeWithRetry(
      options,
      {
        first: options.pageSize ?? DEFAULT_PAGE_SIZE,
        after,
        query: options.productQuery ?? null,
      },
      counters,
    );
    pagesFetched += 1;

    for (const node of data.products?.nodes ?? []) {
      productsSeen += 1;
      const product = normaliseGraphQLProduct(node, options.defaultCurrency);
      const resolution = resolveSlug(product, options);

      if (resolution.slug === null) {
        unmatched.push({ handle: product.handle, title: product.title });
        continue;
      }
      if (seenSlugs.has(resolution.slug)) {
        counters.warnings.push(
          `More than one Shopify product resolves to ${resolution.slug}. The first one seen is mirrored and the rest are ignored. Confirm the product to blend mapping with the client.`,
        );
        continue;
      }

      const mapped = mapProductToMirror(product, {
        slug: resolution.slug,
        syncedAt: now().toISOString(),
        syncSource: 'schedule',
        ...(options.storefrontBase !== undefined ? { storefrontBase: options.storefrontBase } : {}),
        ...(options.allowedHosts ? { allowedHosts: options.allowedHosts } : {}),
        ...(options.attributionMode ? { attributionMode: options.attributionMode } : {}),
        ...(options.channel ? { channel: options.channel } : {}),
        ...(options.lowStockThreshold !== undefined ? { lowStockThreshold: options.lowStockThreshold } : {}),
        ...(options.defaultCurrency ? { defaultCurrency: options.defaultCurrency } : {}),
        ...(options.preferredSkuBySlug?.[resolution.slug]
          ? { preferredSku: options.preferredSkuBySlug[resolution.slug] }
          : {}),
        ...(options.preferredVariantIdBySlug?.[resolution.slug]
          ? { preferredVariantId: options.preferredVariantIdBySlug[resolution.slug] }
          : {}),
      });

      records.push(mapped.record);
      counters.warnings.push(...mapped.warnings);
      seenSlugs.add(resolution.slug);
    }

    const pageInfo = data.products?.pageInfo;
    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
    after = pageInfo.endCursor;
  }

  const missingSlugs = options.knownSlugs.filter((slug) => !seenSlugs.has(slug));

  return {
    records,
    missingSlugs,
    report: {
      pagesFetched,
      productsSeen,
      matched: records.length,
      unmatched,
      warnings: counters.warnings,
      throttleWaitsMs: counters.throttleWaitsMs,
      retries: counters.retries,
      startedAt,
      finishedAt: now().toISOString(),
    },
  };
}
