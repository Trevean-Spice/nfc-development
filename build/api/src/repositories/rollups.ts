import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { config } from '../config/env.js';
import { db, isConditionalCheckFailed } from '../db/client.js';
import { checkpointPk } from '../db/keys.js';
import { LIVE_SK } from '../db/keys.js';
import { now } from '../util/clock.js';
import { nowIso } from '../util/time.js';

/**
 * Pre-aggregated rollups. Data model document, section 5.
 *
 * Every counter is a top level number updated with ADD, which is atomic in DynamoDB and
 * needs no read, no lock and no retry loop.
 *
 * The histogram buckets exist so percentiles are honest. A p95 reconstructed from a count
 * and a sum is a fiction. The 2000 ms bucket boundary is deliberately placed at the
 * acceptance number, so "what fraction of real customer taps were readable inside 2.0
 * seconds" is read directly off the rollup rather than calculated by somebody who has to
 * be trusted to have done it correctly.
 */

export const TTR_BUCKETS = [
  { field: 'ttr_b_0_500', upperMs: 500 },
  { field: 'ttr_b_500_1000', upperMs: 1000 },
  { field: 'ttr_b_1000_1500', upperMs: 1500 },
  { field: 'ttr_b_1500_2000', upperMs: 2000 },
  { field: 'ttr_b_2000_3000', upperMs: 3000 },
  { field: 'ttr_b_3000_plus', upperMs: Number.POSITIVE_INFINITY },
] as const;

export function ttrBucketField(ms: number): string {
  for (const bucket of TTR_BUCKETS) {
    if (ms < bucket.upperMs) return bucket.field;
  }
  return 'ttr_b_3000_plus';
}

export type Counters = Record<string, number>;

/** One atomic ADD per rollup row. Counters are pre-aggregated in memory by the consumer. */
export async function addCounters(pk: string, sk: string, counters: Counters): Promise<void> {
  const entries = Object.entries(counters).filter(([, v]) => v !== 0);
  if (entries.length === 0) return;
  const names: Record<string, string> = {};
  const values: Record<string, number> = {};
  const adds: string[] = [];
  entries.forEach(([field, value], i) => {
    names[`#c${i}`] = field;
    values[`:c${i}`] = value;
    adds.push(`#c${i} :c${i}`);
  });
  await db().send(
    new UpdateCommand({
      TableName: config.tables.scanEvents,
      Key: { pk, sk },
      UpdateExpression: `ADD ${adds.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

export interface RollupRow {
  pk: string;
  sk: string;
  [counter: string]: unknown;
}

/**
 * Pattern 7: one Query on one rollup partition, sort key BETWEEN from and to.
 * Never a Scan. Ninety days costs about 6 RCU, and ten million scans costs the same,
 * because the cost is a function of the number of days requested and nothing else.
 */
export async function queryRollupRange(pk: string, from: string, to: string): Promise<RollupRow[]> {
  const rows: RollupRow[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const out = await db().send(
      new QueryCommand({
        TableName: config.tables.scanEvents,
        KeyConditionExpression: 'pk = :p AND sk BETWEEN :from AND :to',
        ExpressionAttributeValues: { ':p': pk, ':from': from, ':to': to },
        ExclusiveStartKey: startKey as never,
      }),
    );
    rows.push(...((out.Items ?? []) as RollupRow[]));
    startKey = out.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  return rows;
}

/** Geography rows for a day range: begins_with is bounded and does not care how many cities exist. */
export async function queryGeoRange(pk: string, from: string, to: string): Promise<RollupRow[]> {
  return queryRollupRange(pk, `${from}#`, `${to}#￿`);
}

/**
 * Batch checkpoint. Stream delivery is at-least-once and ADD is not idempotent, so a
 * retried batch would double count. The checkpoint is written conditionally before the
 * increments, which causes a re-delivered batch to be skipped.
 *
 * The residual, stated plainly: a narrow failure window can still over-count by at most
 * one batch. That is acceptable because the number is an engagement metric, not a
 * financial one, and because raw events are retained, so any disputed period can be
 * recomputed exactly by a backfill job.
 */
export async function claimBatch(streamName: string, batchId: string, ttlSeconds = 7 * 86400): Promise<boolean> {
  try {
    await db().send(
      new PutCommand({
        TableName: config.tables.scanEvents,
        Item: {
          pk: checkpointPk(streamName, batchId),
          sk: LIVE_SK,
          claimedAt: nowIso(),
          expiresAt: Math.floor(now() / 1000) + ttlSeconds,
        },
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
    return true;
  } catch (err) {
    if (isConditionalCheckFailed(err)) return false;
    throw err;
  }
}
