import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { config } from '../config/env.js';
import { db, isConditionalCheckFailed } from '../db/client.js';
import { idempotencyPk, LIVE_SK } from '../db/keys.js';
import { now } from '../util/clock.js';
import { nowIso } from '../util/time.js';

/**
 * Idempotency-Key on admin creates, retained 24 hours, API contract section 8.2.
 *
 * Records live in SpiceBlends under the IDEM# key namespace with a TTL, for the same
 * reason the catalog mirror does: no sixth table.
 *
 * The scan beacon does NOT use this. It has no Idempotency-Key header and no read before
 * write: its deduplication is the condition on the write itself.
 */

const TABLE = () => config.tables.spiceBlends;
const TTL_SECONDS = 24 * 60 * 60;

export interface IdempotencyRecord {
  status: number;
  body: unknown;
}

export async function recall(subject: string, key: string): Promise<IdempotencyRecord | undefined> {
  const out = await db().send(new GetCommand({ TableName: TABLE(), Key: { pk: idempotencyPk(subject, key), sk: LIVE_SK } }));
  if (!out.Item) return undefined;
  return { status: out.Item['httpStatus'] as number, body: out.Item['responseBody'] };
}

export async function remember(subject: string, key: string, record: IdempotencyRecord): Promise<void> {
  try {
    await db().send(
      new PutCommand({
        TableName: TABLE(),
        Item: {
          pk: idempotencyPk(subject, key),
          sk: LIVE_SK,
          httpStatus: record.status,
          responseBody: record.body,
          createdAt: nowIso(),
          expiresAt: Math.floor(now() / 1000) + TTL_SECONDS,
        },
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
  } catch (err) {
    if (!isConditionalCheckFailed(err)) throw err;
  }
}
