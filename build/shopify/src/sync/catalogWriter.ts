/*
 * Persisting the catalog mirror. The write half that syncCatalog deliberately does not do.
 *
 * Added Wednesday 14 October 2026 to retire the 848 byte placeholder on the catalog_sync
 * function. Until then the CATALOG# rows were hand written on 7 October 2026 with five
 * update-item calls, syncSource manual-verified-2026-10-07, and would not follow a price
 * change. See "Decision log", D65.
 *
 * WHAT THIS MAY TOUCH, stated as code rather than as a convention:
 *
 *   only items whose key is CATALOG#{slug} / v0, for a slug in the frozen contract's Slug
 *   enum, and only when the item already exists and says entityType CATALOG;
 *
 *   only the attributes in MIRROR_OWNED_ATTRIBUTES, with SET and never REMOVE, and never a
 *   PutItem, so an attribute somebody else wrote survives every run;
 *
 *   never cartPermalinkUrl, which is null in the row on purpose so the API derives it from
 *   SHOPIFY_STORE_DOMAIN and a domain change stays one variable rather than a re seed;
 *
 *   never a BLEND# item. The key is built here from a validated slug and asserted to start
 *   with CATALOG# before any request is made, and the catalog_sync role can only write
 *   leading keys CATALOG#* anyway. Two independent fences, because the cost of crossing
 *   this one is the placeholder banner back on pages the client shows investors.
 *
 * Every write is conditional on the row still being the row that was read: present, a
 * CATALOG entity, and (when it carries one) mirroring the same Shopify product. A row
 * pinned to a product id by hand is not repointed at a different product by a handle that
 * happens to match; that is reported and skipped.
 *
 * It speaks the low level DynamoDB shapes (AttributeValue maps) through a two method
 * interface, so the package keeps zero runtime dependencies and the tests run against an
 * in memory table rather than a mocked SDK.
 */

import { canonicalProductGid, canonicalVariantGid } from '../ids.js';
import type { CatalogMirrorRecord } from '../types.js';

/** The frozen contract's Slug enum. test/catalog-writer.test.ts asserts it against openapi/openapi.yaml. */
export const CONTRACT_SLUGS = [
  'persian-sunrise',
  'caribbean-sunset',
  'north-african-night-market',
  'silk-road',
  'kyoto-garden',
] as const;

export const CATALOG_PREFIX = 'CATALOG#';
export const CATALOG_LIVE_SK = 'v0';
export const CATALOG_ENTITY = 'CATALOG';

/**
 * The attributes the sync owns on a CATALOG# row, in the flat shape the API reads
 * (build/api, repositories/catalog.ts). Nothing outside this list is ever written.
 */
export const MIRROR_OWNED_ATTRIBUTES = [
  'sku',
  'shopifyProductId',
  'shopifyVariantId',
  'priceAmount',
  'priceCurrency',
  'compareAtAmount',
  'available',
  'inventoryStatus',
  'variantPosition',
  'syncedAt',
  'syncSource',
] as const;

export type MirrorOwnedAttribute = (typeof MIRROR_OWNED_ATTRIBUTES)[number];

/** The subset of DynamoDB's AttributeValue this module reads and writes. */
export type AttributeValue =
  | { S: string }
  | { N: string }
  | { BOOL: boolean }
  | { NULL: true }
  | { M: Record<string, AttributeValue> }
  | { L: AttributeValue[] };

export type Item = Record<string, AttributeValue>;

export interface GetItemInput {
  TableName: string;
  Key: Item;
  ConsistentRead?: boolean;
}

export interface UpdateItemInput {
  TableName: string;
  Key: Item;
  UpdateExpression: string;
  ConditionExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues: Item;
}

/** Two calls, nothing else. The Lambda adapter wraps the AWS SDK; the tests use a table in memory. */
export interface CatalogTable {
  getItem(input: GetItemInput): Promise<{ Item?: Item | undefined }>;
  updateItem(input: UpdateItemInput): Promise<unknown>;
}

type Scalar = string | number | boolean | null;

export function marshal(value: Scalar): AttributeValue {
  if (value === null) return { NULL: true };
  if (typeof value === 'string') return { S: value };
  if (typeof value === 'boolean') return { BOOL: value };
  if (!Number.isFinite(value)) throw new Error(`Refusing to write a non finite number: ${value}`);
  return { N: String(value) };
}

export function unmarshal(value: AttributeValue | undefined): unknown {
  if (value === undefined) return undefined;
  if ('S' in value) return value.S;
  if ('N' in value) return Number(value.N);
  if ('BOOL' in value) return value.BOOL;
  if ('NULL' in value) return null;
  if ('M' in value) return Object.fromEntries(Object.entries(value.M).map(([k, v]) => [k, unmarshal(v)]));
  if ('L' in value) return value.L.map((v) => unmarshal(v));
  return undefined;
}

export function unmarshalItem(item: Item): Record<string, unknown> {
  return Object.fromEntries(Object.entries(item).map(([k, v]) => [k, unmarshal(v)]));
}

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The key of a catalog row. Throws rather than build anything that is not CATALOG#. */
export function catalogKey(slug: string): Item {
  if (!SLUG_PATTERN.test(slug) || !(CONTRACT_SLUGS as readonly string[]).includes(slug)) {
    throw new Error(`Refusing to build a catalog key for ${JSON.stringify(slug)}: not a contract slug.`);
  }
  const pk = `${CATALOG_PREFIX}${slug}`;
  if (!pk.startsWith(CATALOG_PREFIX) || pk.startsWith('BLEND#')) {
    throw new Error(`Refusing to write outside the CATALOG# namespace: ${pk}`);
  }
  return { pk: { S: pk }, sk: { S: CATALOG_LIVE_SK } };
}

/**
 * The mirror's values for a row, excluding the two provenance attributes.
 *
 * A null price is left out rather than written. The mapper returns null when Shopify's
 * amount cannot be converted to minor units exactly, and overwriting a verified price with
 * a blank reads as a broken page; the last known price, ageing towards stale, is the
 * honest degradation. A null compare at price IS written, because no compare at price is
 * the normal state and leaving an old one would keep a sale label after the sale ended.
 */
export function mirrorValues(record: CatalogMirrorRecord): Partial<Record<MirrorOwnedAttribute, Scalar>> {
  const values: Partial<Record<MirrorOwnedAttribute, Scalar>> = {
    sku: record.sku,
    shopifyProductId: record.shopifyProductId,
    shopifyVariantId: record.shopifyVariantId,
    compareAtAmount: record.compareAtPrice?.amount ?? null,
    available: record.available,
    inventoryStatus: record.inventoryStatus,
    variantPosition: record.variantPosition,
  };
  if (record.price) {
    values.priceAmount = record.price.amount;
    values.priceCurrency = record.price.currency;
  }
  return values;
}

export type SkipReason = 'row_missing' | 'not_a_catalog_row' | 'product_id_mismatch' | 'variant_id_mismatch' | 'no_variant';

export type WritePlan =
  | {
      action: 'update';
      slug: string;
      changes: Record<string, { from: unknown; to: unknown }>;
      input: UpdateItemInput;
    }
  | { action: 'skip'; slug: string; reason: SkipReason; detail: string };

export interface PlanOptions {
  tableName: string;
  syncedAt: string;
  syncSource: string;
}

/**
 * What the sync would do to one row, given what is in it now. Pure: no table access, so
 * the dry run and the real run share every decision and differ only in whether the
 * returned input is sent.
 */
export function planCatalogWrite(
  record: CatalogMirrorRecord,
  current: Record<string, unknown> | undefined,
  options: PlanOptions,
): WritePlan {
  const slug = record.slug;
  const key = catalogKey(slug);

  if (!current) {
    return {
      action: 'skip',
      slug,
      reason: 'row_missing',
      detail: `No CATALOG# row exists for ${slug}. The sync updates rows and never creates them; seed it deliberately if it should exist.`,
    };
  }
  if (current['entityType'] !== CATALOG_ENTITY) {
    return {
      action: 'skip',
      slug,
      reason: 'not_a_catalog_row',
      detail: `The item at CATALOG#${slug} has entityType ${JSON.stringify(current['entityType'])}, not CATALOG. Not touched.`,
    };
  }
  if (!record.shopifyVariantId) {
    // A product with no variant has nothing to reorder. Writing that would null the
    // variant id a person verified against the live store, which disables the button on
    // the strength of one response from a query that has never run against this store.
    // Skipped and reported; the row ages to stale, which degrades the page honestly.
    return {
      action: 'skip',
      slug,
      reason: 'no_variant',
      detail: `The Shopify product for ${slug} returned no variant. Row left as it was.`,
    };
  }

  const storedProductId = typeof current['shopifyProductId'] === 'string' && current['shopifyProductId'] !== ''
    ? (current['shopifyProductId'] as string)
    : null;
  if (storedProductId && canonicalProductGid(storedProductId) !== canonicalProductGid(record.shopifyProductId)) {
    return {
      action: 'skip',
      slug,
      reason: 'product_id_mismatch',
      detail: `The row for ${slug} mirrors ${storedProductId} and Shopify resolved ${record.shopifyProductId} to this slug. Not repointed; confirm the product to blend mapping.`,
    };
  }

  // The variant is where the reorder button sends a customer. The sync selects the stored
  // variant whenever the product still has it (runCatalogSync passes it as the preferred
  // variant), so a different one here means the stored variant is gone. Repointing the
  // button is a person's decision, not a scheduled job's: skipped and reported.
  const storedVariantId = typeof current['shopifyVariantId'] === 'string' && current['shopifyVariantId'] !== ''
    ? (current['shopifyVariantId'] as string)
    : null;
  if (storedVariantId && canonicalVariantGid(storedVariantId) !== canonicalVariantGid(record.shopifyVariantId)) {
    return {
      action: 'skip',
      slug,
      reason: 'variant_id_mismatch',
      detail: `The row for ${slug} points at ${storedVariantId}, which the Shopify product no longer carries; the sync would select ${record.shopifyVariantId}. Not repointed; update the row deliberately if the new variant is right.`,
    };
  }

  const values: Partial<Record<MirrorOwnedAttribute, Scalar>> = {
    ...mirrorValues(record),
    syncedAt: options.syncedAt,
    syncSource: options.syncSource,
  };

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [name, to] of Object.entries(values)) {
    if (name === 'syncedAt' || name === 'syncSource') continue;
    // Absent and null are the same answer to "what does the mirror say".
    const from = current[name] ?? null;
    if (from !== to) changes[name] = { from, to };
  }

  const names: Record<string, string> = {
    '#pk': 'pk',
    '#entityType': 'entityType',
  };
  const exprValues: Item = {
    ':catalogPrefix': { S: CATALOG_PREFIX },
    ':catalogEntity': { S: CATALOG_ENTITY },
  };
  const sets: string[] = [];
  for (const name of MIRROR_OWNED_ATTRIBUTES) {
    if (!(name in values)) continue;
    names[`#${name}`] = name;
    exprValues[`:${name}`] = marshal(values[name] as Scalar);
    sets.push(`#${name} = :${name}`);
  }

  const conditions = ['attribute_exists(#pk)', 'begins_with(#pk, :catalogPrefix)', '#entityType = :catalogEntity'];
  if (storedProductId) {
    names['#shopifyProductId'] = 'shopifyProductId';
    exprValues[':expectedProductId'] = { S: storedProductId };
    conditions.push('#shopifyProductId = :expectedProductId');
  }

  return {
    action: 'update',
    slug,
    changes,
    input: {
      TableName: options.tableName,
      Key: key,
      UpdateExpression: `SET ${sets.join(', ')}`,
      ConditionExpression: conditions.join(' AND '),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: exprValues,
    },
  };
}

/** Reads the current CATALOG# row for each slug. Strongly consistent, so the plan sees the latest write. */
export async function readCatalogRows(
  table: CatalogTable,
  tableName: string,
  slugs: readonly string[],
): Promise<Map<string, Record<string, unknown>>> {
  const rows = new Map<string, Record<string, unknown>>();
  for (const slug of slugs) {
    const out = await table.getItem({ TableName: tableName, Key: catalogKey(slug), ConsistentRead: true });
    if (out.Item) rows.set(slug, unmarshalItem(out.Item));
  }
  return rows;
}

/**
 * The explicit product to blend map, built from the rows themselves.
 *
 * The rows written on 7 October 2026 carry the Shopify product id each blend was verified
 * against. That is the explicit map the README says production should use, and it already
 * exists, so it is read rather than retyped into configuration.
 */
export function productMapFromRows(rows: Map<string, Record<string, unknown>>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [slug, row] of rows) {
    const gid = canonicalProductGid(row['shopifyProductId']);
    if (gid) map[gid] = slug;
  }
  return map;
}

/** The variant each row already mirrors, so the sync keeps selecting it. */
export function variantPinsFromRows(rows: Map<string, Record<string, unknown>>): Record<string, string> {
  const pins: Record<string, string> = {};
  for (const [slug, row] of rows) {
    const gid = canonicalVariantGid(row['shopifyVariantId']);
    if (gid) pins[slug] = gid;
  }
  return pins;
}

export function isConditionalCheckFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    ((error as { name?: unknown }).name === 'ConditionalCheckFailedException' ||
      (error as { __type?: unknown }).__type === 'com.amazonaws.dynamodb.v20120810#ConditionalCheckFailedException')
  );
}
