import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { config } from '../config/env.js';
import { db } from '../db/client.js';
import { catalogPk, ENTITY, LIVE_SK } from '../db/keys.js';
import { nowIso } from '../util/time.js';

/**
 * Access pattern 8: the Shopify catalog mirror, one GetItem, and most requests never reach
 * DynamoDB at all because of the 60 second CDN cache.
 *
 * The mirror is a separate item under the CATALOG# namespace in SpiceBlends rather than
 * extra attributes on the blend. The sync writes on a schedule and on every Shopify
 * product update webhook; the editorial record is written by humans a few times a week.
 * Keeping them apart means a sync can never overwrite an editor's work and a sync failure
 * can never mark a blend dirty.
 */

export interface CatalogItem {
  pk: string;
  sk: string;
  entityType: string;
  slug: string;
  sku?: string | null;
  shopifyProductId?: string | null;
  shopifyVariantId?: string | null;
  priceAmount?: number | null;
  priceCurrency?: string | null;
  compareAtAmount?: number | null;
  available: boolean;
  inventoryStatus: 'in_stock' | 'low_stock' | 'out_of_stock' | 'unknown';
  cartPermalinkUrl?: string | null;
  syncedAt: string;
  /**
   * Provenance. 'seed' from the seeder; the catalog sync writes shopify-sync-{time}, the
   * products/update webhook shopify-webhook-{time}, and the 7 October rows carry
   * manual-verified-2026-10-07 (D65). Not served by the API.
   */
  syncSource: string;
  variantPosition?: number | null;
}

const TABLE = () => config.tables.spiceBlends;

export async function getCatalogEntry(slug: string): Promise<CatalogItem | undefined> {
  const out = await db().send(new GetCommand({ TableName: TABLE(), Key: { pk: catalogPk(slug), sk: LIVE_SK } }));
  return out.Item as CatalogItem | undefined;
}

export async function putCatalogEntry(entry: Omit<CatalogItem, 'pk' | 'sk' | 'entityType'>): Promise<CatalogItem> {
  const item: CatalogItem = {
    ...entry,
    pk: catalogPk(entry.slug),
    sk: LIVE_SK,
    entityType: ENTITY.catalog,
    syncedAt: entry.syncedAt || nowIso(),
  };
  await db().send(new PutCommand({ TableName: TABLE(), Item: item }));
  return item;
}

/**
 * The CATALOG# rows for the given slugs, strongly consistent, so a webhook plans against the
 * latest write. One GetItem per slug: five contract slugs, never a Scan.
 */
export async function readCatalogRows(slugs: readonly string[]): Promise<Map<string, Record<string, unknown>>> {
  const rows = new Map<string, Record<string, unknown>>();
  for (const slug of slugs) {
    const out = await db().send(
      new GetCommand({ TableName: TABLE(), Key: { pk: catalogPk(slug), sk: LIVE_SK }, ConsistentRead: true }),
    );
    if (out.Item) rows.set(slug, out.Item as Record<string, unknown>);
  }
  return rows;
}

/**
 * The conditional, attribute scoped update planned by services/shopifyCatalogMirror.ts. The
 * key is built here from the slug and must be CATALOG#: this function cannot reach a BLEND#
 * item whatever plan it is handed.
 */
export async function updateCatalogMirror(
  slug: string,
  update: {
    UpdateExpression: string;
    ConditionExpression: string;
    ExpressionAttributeNames: Record<string, string>;
    ExpressionAttributeValues: Record<string, unknown>;
  },
): Promise<void> {
  const pk = catalogPk(slug);
  if (!pk.startsWith('CATALOG#')) throw new Error(`Refusing to write outside the CATALOG# namespace: ${pk}`);
  await db().send(new UpdateCommand({ TableName: TABLE(), Key: { pk, sk: LIVE_SK }, ...update }));
}
