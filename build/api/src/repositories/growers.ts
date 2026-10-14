import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { config } from '../config/env.js';
import { db, isConditionalCheckFailed } from '../db/client.js';
import { ENTITY } from '../db/keys.js';
import { versionConflict } from '../http/errors.js';
import { nowIso } from '../util/time.js';

/**
 * Access pattern 4: grower for a blend, a single GetItem, because the blend item already
 * carries growerId.
 *
 * blendSlugs is a denormalised back-pointer maintained whenever a blend's growerId
 * changes. It exists for one purpose: the grower record is snapshotted into the generated
 * page, so editing a grower does not change any page already built. The back-pointer is
 * what lets the CMS say "these two blends need republishing" instead of leaving an editor
 * to remember.
 */

export interface GrowerItem {
  growerId: string;
  entityType: string;
  name: string;
  farmName?: string | null;
  country?: string | null;
  region?: string | null;
  bio?: string | null;
  yearsFarming?: number | null;
  portraitId?: string | null;
  farm?: { latitude: number; longitude: number; label?: string | null } | null;
  blendSlugs?: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

const TABLE = () => config.tables.growers;
const BY_NAME = () => config.indexes.growersByEntityName;

export async function getGrower(growerId: string): Promise<GrowerItem | undefined> {
  const out = await db().send(new GetCommand({ TableName: TABLE(), Key: { growerId } }));
  return out.Item as GrowerItem | undefined;
}

export async function listGrowers(
  limit: number,
  startKey?: Record<string, unknown>,
): Promise<{ items: GrowerItem[]; lastKey?: Record<string, unknown> }> {
  const out = await db().send(
    new QueryCommand({
      TableName: TABLE(),
      IndexName: BY_NAME(),
      KeyConditionExpression: 'entityType = :e',
      ExpressionAttributeValues: { ':e': ENTITY.grower },
      ScanIndexForward: true,
      Limit: limit,
      ExclusiveStartKey: startKey as never,
    }),
  );
  return { items: (out.Items ?? []) as GrowerItem[], lastKey: out.LastEvaluatedKey as Record<string, unknown> | undefined };
}

export async function createGrower(item: Omit<GrowerItem, 'version' | 'createdAt' | 'updatedAt' | 'entityType'>): Promise<GrowerItem> {
  const now = nowIso();
  const full: GrowerItem = { ...item, entityType: ENTITY.grower, version: 1, createdAt: now, updatedAt: now };
  await db().send(new PutCommand({ TableName: TABLE(), Item: full, ConditionExpression: 'attribute_not_exists(growerId)' }));
  return full;
}

export async function updateGrower(
  growerId: string,
  expectedVersion: number,
  changes: Record<string, unknown>,
): Promise<GrowerItem> {
  const names: Record<string, string> = { '#v': 'version', '#u': 'updatedAt' };
  const values: Record<string, unknown> = { ':expected': expectedVersion, ':one': 1, ':now': nowIso() };
  const sets = ['#u = :now'];
  let i = 0;
  for (const [key, value] of Object.entries(changes)) {
    i += 1;
    names[`#f${i}`] = key;
    values[`:f${i}`] = value;
    sets.push(`#f${i} = :f${i}`);
  }
  try {
    const out = await db().send(
      new UpdateCommand({
        TableName: TABLE(),
        Key: { growerId },
        UpdateExpression: `SET ${sets.join(', ')} ADD #v :one`,
        ConditionExpression: 'attribute_exists(growerId) AND #v = :expected',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      }),
    );
    return out.Attributes as GrowerItem;
  } catch (err) {
    if (isConditionalCheckFailed(err)) {
      const current = await getGrower(growerId);
      if (!current) throw err;
      throw versionConflict(`This grower was changed at ${current.updatedAt}. Reload before saving.`);
    }
    throw err;
  }
}

/** Maintains the back-pointer when a blend is attached to or detached from a grower. */
export async function attachBlend(growerId: string, blendSlug: string): Promise<void> {
  await db()
    .send(
      new UpdateCommand({
        TableName: TABLE(),
        Key: { growerId },
        UpdateExpression: 'SET blendSlugs = list_append(if_not_exists(blendSlugs, :empty), :one), updatedAt = :now',
        ConditionExpression: 'attribute_exists(growerId) AND (attribute_not_exists(blendSlugs) OR NOT contains(blendSlugs, :slug))',
        ExpressionAttributeValues: { ':empty': [], ':one': [blendSlug], ':slug': blendSlug, ':now': nowIso() },
      }),
    )
    .catch((err) => {
      if (!isConditionalCheckFailed(err)) throw err;
    });
}

export async function detachBlend(growerId: string, blendSlug: string): Promise<void> {
  const current = await getGrower(growerId);
  if (!current || !current.blendSlugs?.includes(blendSlug)) return;
  const next = current.blendSlugs.filter((s) => s !== blendSlug);
  await db().send(
    new UpdateCommand({
      TableName: TABLE(),
      Key: { growerId },
      UpdateExpression: 'SET blendSlugs = :next, updatedAt = :now',
      ExpressionAttributeValues: { ':next': next, ':now': nowIso() },
    }),
  );
}
