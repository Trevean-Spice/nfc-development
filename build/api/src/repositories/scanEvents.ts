import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { config } from '../config/env.js';
import { db, isConditionalCheckFailed } from '../db/client.js';
import { eventPk, eventSk } from '../db/keys.js';
import { epochSeconds } from '../util/time.js';

/**
 * Access pattern 5, and the only pattern a customer's phone triggers.
 *
 * ONE CONDITIONAL WRITE. NO READ IN FRONT OF IT.
 *
 * The duplicate check is the condition, not a query. A read-then-write would double the
 * cost, double the latency and still race. A ConditionalCheckFailedException here is a
 * success: it means a duplicate, and the endpoint returns 202 exactly as it does for a new
 * event, because the client cannot tell the difference and must not try.
 *
 * If you are about to add a lookup to this function, for example to validate the blend
 * exists or to resolve the tag code, do not. Validation is by enum against the frozen
 * contract, in memory, and geography comes from CDN viewer headers already attached to the
 * request. See the Data model document, section 4.1.
 */

export interface ScanEventRecord {
  pk: string;
  sk: string;
  eventId: string;
  blendSlug: string;
  tagCode: string | null;
  channel: 'nfc' | 'qr' | 'direct';
  dedupToken: string;
  occurredAt: string;
  receivedAt: string;
  /**
   * The timestamp actually used for bucketing, which is occurredAt unless the client clock
   * is more than a day out, in which case it is server time. The rollup consumer reads
   * this, so a phone with a wrong clock cannot write counts into the wrong day.
   */
  effectiveAt: string;
  windowId: number;
  platform: 'ios' | 'android' | 'other';
  deviceFamily: string | null;
  connectionType: string;
  cacheStatus: string;
  ttfbMs: number | null;
  timeToReadableMs: number | null;
  pageVersion: number | null;
  redirected: boolean | null;
  geoCountry: string | null;
  geoRegion: string | null;
  geoCity: string | null;
  originAllowed: boolean;
  expiresAt: number;
}

export interface WriteResult {
  /** False means the conditional write found the item already there: a duplicate. */
  stored: boolean;
}

export function ttlFor(effectiveAt: string, retentionDays = config.scan.rawRetentionDays): number {
  return epochSeconds(effectiveAt) + retentionDays * 86400;
}

export async function putScanEvent(
  event: Omit<ScanEventRecord, 'pk' | 'sk'>,
  buckets: { day: string; shard: string; windowId: number },
): Promise<WriteResult> {
  const item: ScanEventRecord = {
    ...event,
    pk: eventPk(event.blendSlug, buckets.day, buckets.shard),
    sk: eventSk(event.dedupToken, buckets.windowId),
  };
  try {
    await db().send(
      new PutCommand({
        TableName: config.tables.scanEvents,
        Item: item,
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
    return { stored: true };
  } catch (err) {
    if (isConditionalCheckFailed(err)) return { stored: false };
    throw err;
  }
}
