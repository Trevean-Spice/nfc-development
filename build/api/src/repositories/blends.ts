import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { config } from '../config/env.js';
import { db, isConditionalCheckFailed } from '../db/client.js';
import { blendPk, blendSnapshotSk, ENTITY, LIVE_SK } from '../db/keys.js';
import { slugTaken, versionConflict } from '../http/errors.js';
import { nowIso } from '../util/time.js';

/**
 * Access patterns 1 and 2 from the Architecture document, "Data layer".
 *
 * Neither is on the tap path. Both run at build time, revalidate time, or on an admin
 * screen. There is no Scan in this file, and there must never be one: a Scan in this
 * codebase is a defect regardless of current table size (Data model document, section 8,
 * check 14).
 */

export type ContentStatus = 'draft' | 'published' | 'archived';

export interface BlendItem {
  pk: string;
  sk: string;
  entityType: string;
  slug: string;
  name: string;
  status: ContentStatus;
  tagline?: string | null;
  launchTier?: 'real' | 'seeded';
  tagCode?: string | null;
  originCountry?: string | null;
  originRegion?: string | null;
  originCity?: string | null;
  farm?: { latitude: number; longitude: number; label?: string | null } | null;
  storyBlocks?: Array<{ type: string; text: string }>;
  heroImageId?: string | null;
  galleryImageIds?: string[];
  freshness?: Record<string, unknown>;
  growerId?: string | null;
  shopify?: Record<string, unknown>;
  recipeCount?: number;
  version: number;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string | null;
}

const TABLE = () => config.tables.spiceBlends;
const STATUS_INDEX = () => config.indexes.blendsByStatus;

/** A generous upper bound on a per status Query. Five blends today; the bound is a guard. */
const MAX_PER_STATUS = 500;

export async function getBlend(slug: string): Promise<BlendItem | undefined> {
  const out = await db().send(
    new GetCommand({ TableName: TABLE(), Key: { pk: blendPk(slug), sk: LIVE_SK } }),
  );
  return out.Item as BlendItem | undefined;
}

export async function queryByStatus(
  status: ContentStatus,
  limit: number,
  startKey?: Record<string, unknown>,
): Promise<{ items: BlendItem[]; lastKey?: Record<string, unknown> }> {
  const out = await db().send(
    new QueryCommand({
      TableName: TABLE(),
      IndexName: STATUS_INDEX(),
      KeyConditionExpression: '#s = :s',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':s': status },
      ScanIndexForward: true,
      Limit: limit,
      ExclusiveStartKey: startKey as never,
    }),
  );
  return { items: (out.Items ?? []) as BlendItem[], lastKey: out.LastEvaluatedKey as Record<string, unknown> | undefined };
}

/**
 * The GSI projection is INCLUDE, deliberately, because storyBlocks is the largest
 * attribute on the item and projecting it doubles the write cost of every save for no read
 * benefit. Summaries are served from the index; anything needing the full item reads it.
 */
export async function listSummaries(
  statuses: ContentStatus[],
  limit: number,
  offset: number,
): Promise<{ items: BlendItem[]; nextOffset: number | undefined }> {
  const collected: BlendItem[] = [];
  for (const status of statuses) {
    let startKey: Record<string, unknown> | undefined;
    let fetched = 0;
    do {
      const page = await queryByStatus(status, Math.min(100, MAX_PER_STATUS - fetched), startKey);
      collected.push(...page.items);
      fetched += page.items.length;
      startKey = page.lastKey;
    } while (startKey && fetched < MAX_PER_STATUS);
  }
  collected.sort((a, b) => (a.updatedAt === b.updatedAt ? a.slug.localeCompare(b.slug) : a.updatedAt.localeCompare(b.updatedAt)));
  const window = collected.slice(offset, offset + limit);
  const nextOffset = offset + limit < collected.length ? offset + limit : undefined;
  return { items: window, nextOffset };
}

export async function createBlend(input: {
  slug: string;
  name: string;
  actor: string | undefined;
  fields: Partial<BlendItem>;
}): Promise<BlendItem> {
  const now = nowIso();
  const item: BlendItem = {
    pk: blendPk(input.slug),
    sk: LIVE_SK,
    entityType: ENTITY.blend,
    slug: input.slug,
    name: input.name,
    status: 'draft',
    launchTier: 'seeded',
    recipeCount: 0,
    version: 1,
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
    updatedBy: input.actor ?? null,
    ...input.fields,
  };
  try {
    await db().send(
      new PutCommand({
        TableName: TABLE(),
        Item: item,
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailed(err)) throw slugTaken(input.slug);
    throw err;
  }
  return item;
}

/**
 * Optimistic concurrency, Data model document, section 2: writes from the admin are
 * conditional on version. The failure mode this prevents in this product is two editors
 * overwriting each other and the page showing the wrong story.
 */
export async function updateBlend(
  slug: string,
  expectedVersion: number,
  changes: Record<string, unknown>,
  actor: string | undefined,
): Promise<BlendItem> {
  const names: Record<string, string> = { '#v': 'version', '#u': 'updatedAt', '#ub': 'updatedBy' };
  const values: Record<string, unknown> = { ':expected': expectedVersion, ':one': 1, ':now': nowIso(), ':actor': actor ?? null };
  const sets: string[] = ['#u = :now', '#ub = :actor'];

  // API contract, section 8.1: absent and null are distinguished on PATCH. An omitted
  // field never reaches this loop, so it is unchanged. An explicit null is written as
  // null, which is what "clears it" means on the wire: the field keeps appearing in the
  // response as null rather than vanishing from a schema that declares it.
  let i = 0;
  for (const [key, value] of Object.entries(changes)) {
    i += 1;
    const nameRef = `#f${i}`;
    const valueRef = `:f${i}`;
    names[nameRef] = key;
    values[valueRef] = value;
    sets.push(`${nameRef} = ${valueRef}`);
  }

  const expression = `SET ${sets.join(', ')} ADD #v :one`;

  try {
    const out = await db().send(
      new UpdateCommand({
        TableName: TABLE(),
        Key: { pk: blendPk(slug), sk: LIVE_SK },
        UpdateExpression: expression,
        ConditionExpression: 'attribute_exists(pk) AND #v = :expected',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      }),
    );
    return out.Attributes as BlendItem;
  } catch (err) {
    if (isConditionalCheckFailed(err)) {
      const current = await getBlend(slug);
      if (!current) throw err;
      throw versionConflict(
        `This blend was changed by ${current.updatedBy ?? 'another editor'} at ${current.updatedAt}. Reload before saving.`,
      );
    }
    throw err;
  }
}

/**
 * Publish writes an immutable snapshot alongside the live record.
 *
 * The snapshot deliberately carries snapshotStatus rather than status. A DynamoDB item is
 * only projected into a composite key index when it has both key attributes, so dropping
 * status keeps snapshots out of the status-updatedAt-index entirely. Leaving it on would
 * mean every published blend appeared in the blend list once for the live record and once
 * more for every version ever published, which is the sort of duplicate that shows up on a
 * sitemap weeks later.
 */
export async function writeSnapshot(item: BlendItem): Promise<void> {
  const { status, ...rest } = item;
  await db().send(
    new PutCommand({
      TableName: TABLE(),
      Item: {
        ...rest,
        sk: blendSnapshotSk(item.version),
        snapshotOf: item.version,
        snapshotStatus: status,
        snapshotAt: nowIso(),
        entityType: 'BLEND_SNAPSHOT',
      },
    }),
  );
}

/**
 * recipeCount is a system maintained field, so it does not consume an editor's version.
 * updatedAt moves with it, because it is what the ETag is derived from and a build caller
 * taking a 304 would otherwise keep serving a stale recipe count.
 */
export async function setRecipeCount(slug: string, count: number): Promise<void> {
  await db().send(
    new UpdateCommand({
      TableName: TABLE(),
      Key: { pk: blendPk(slug), sk: LIVE_SK },
      UpdateExpression: 'SET recipeCount = :c, updatedAt = :now',
      ConditionExpression: 'attribute_exists(pk)',
      ExpressionAttributeValues: { ':c': count, ':now': nowIso() },
    }),
  ).catch((err) => {
    if (!isConditionalCheckFailed(err)) throw err;
  });
}

export async function deleteBlendForTests(slug: string): Promise<void> {
  await db().send(new DeleteCommand({ TableName: TABLE(), Key: { pk: blendPk(slug), sk: LIVE_SK } }));
}
