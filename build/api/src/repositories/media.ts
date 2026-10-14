import { BatchGetCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { config } from '../config/env.js';
import { db } from '../db/client.js';
import { ENTITY, LIVE_SK, mediaPk } from '../db/keys.js';
import { nowIso } from '../util/time.js';

/**
 * Media records.
 *
 * The Data model document specifies five tables and says no sixth table is introduced, and
 * it does not say where media records live, because it describes the content and telemetry
 * model rather than the media library. They are stored in SpiceBlends under a MEDIA# key
 * namespace, which is the same mechanism the document already uses to put the Shopify
 * catalog mirror in SpiceBlends without a sixth table.
 *
 * The media library list needs a partition to query, so media items carry
 * entityType = MEDIA and are listed from an entity-createdAt-index GSI. This is an index
 * addition, which is exactly the class of change open question Q15 exists to settle at the
 * audit. It is flagged in the delivery summary rather than assumed.
 *
 * Media status is stored as mediaStatus, not status, so media items never appear in the
 * status-updatedAt-index that serves the blend list.
 */

export interface MediaItem {
  pk: string;
  sk: string;
  entityType: string;
  mediaId: string;
  filename: string;
  contentType: string;
  bytes?: number | null;
  kind: 'hero' | 'gallery' | 'grower_portrait' | 'recipe';
  mediaStatus: 'pending' | 'processing' | 'ready' | 'failed';
  alt?: string | null;
  width?: number | null;
  height?: number | null;
  cdnUrl?: string | null;
  storageKey: string;
  derivatives?: Array<{ format: string; width: number; cdnUrl: string }>;
  uploadedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

const TABLE = () => config.tables.spiceBlends;
const BY_ENTITY = () => config.indexes.blendsByEntity;

export async function putMedia(item: MediaItem): Promise<MediaItem> {
  await db().send(new PutCommand({ TableName: TABLE(), Item: item, ConditionExpression: 'attribute_not_exists(pk)' }));
  return item;
}

export async function getMedia(mediaId: string): Promise<MediaItem | undefined> {
  const out = await db().send(new GetCommand({ TableName: TABLE(), Key: { pk: mediaPk(mediaId), sk: LIVE_SK } }));
  return out.Item as MediaItem | undefined;
}

export async function getManyMedia(mediaIds: string[]): Promise<Map<string, MediaItem>> {
  const unique = [...new Set(mediaIds.filter(Boolean))];
  const found = new Map<string, MediaItem>();
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const out = await db().send(
      new BatchGetCommand({
        RequestItems: { [TABLE()]: { Keys: chunk.map((id) => ({ pk: mediaPk(id), sk: LIVE_SK })) } },
      }),
    );
    for (const item of (out.Responses?.[TABLE()] ?? []) as MediaItem[]) found.set(item.mediaId, item);
  }
  return found;
}

export async function listMedia(
  kind: string | undefined,
  limit: number,
  startKey?: Record<string, unknown>,
): Promise<{ items: MediaItem[]; lastKey?: Record<string, unknown> }> {
  const out = await db().send(
    new QueryCommand({
      TableName: TABLE(),
      IndexName: BY_ENTITY(),
      KeyConditionExpression: 'entityType = :e',
      ...(kind ? { FilterExpression: '#k = :k', ExpressionAttributeNames: { '#k': 'kind' } } : {}),
      ExpressionAttributeValues: kind ? { ':e': ENTITY.media, ':k': kind } : { ':e': ENTITY.media },
      ScanIndexForward: false,
      Limit: limit,
      ExclusiveStartKey: startKey as never,
    }),
  );
  return { items: (out.Items ?? []) as MediaItem[], lastKey: out.LastEvaluatedKey as Record<string, unknown> | undefined };
}

export async function markMediaProcessing(
  mediaId: string,
  patch: { bytes?: number | null; width?: number | null; height?: number | null; alt?: string | null; cdnUrl?: string | null },
): Promise<MediaItem> {
  const names: Record<string, string> = { '#s': 'mediaStatus' };
  const values: Record<string, unknown> = { ':s': 'processing', ':now': nowIso() };
  const sets = ['#s = :s', 'updatedAt = :now'];
  let i = 0;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    i += 1;
    names[`#f${i}`] = key;
    values[`:f${i}`] = value;
    sets.push(`#f${i} = :f${i}`);
  }
  const out = await db().send(
    new UpdateCommand({
      TableName: TABLE(),
      Key: { pk: mediaPk(mediaId), sk: LIVE_SK },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ConditionExpression: 'attribute_exists(pk)',
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    }),
  );
  return out.Attributes as MediaItem;
}

/** Called by the derivative generation worker once responsive formats exist. */
export async function markMediaReady(
  mediaId: string,
  derivatives: Array<{ format: string; width: number; cdnUrl: string }>,
  cdnUrl: string,
): Promise<void> {
  await db().send(
    new UpdateCommand({
      TableName: TABLE(),
      Key: { pk: mediaPk(mediaId), sk: LIVE_SK },
      UpdateExpression: 'SET #s = :ready, derivatives = :d, cdnUrl = :c, updatedAt = :now',
      ExpressionAttributeNames: { '#s': 'mediaStatus' },
      ExpressionAttributeValues: { ':ready': 'ready', ':d': derivatives, ':c': cdnUrl, ':now': nowIso() },
    }),
  );
}
