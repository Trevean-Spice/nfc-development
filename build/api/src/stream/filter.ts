/**
 * THE EVENT SOURCE MAPPING FILTER.
 *
 * Rollup items live in ScanEvents under the ROLLUP# key namespace, which means rollup
 * writes appear in the same DynamoDB stream that triggers the consumer that produced them.
 * Without a filter that is an infinite loop which will happily bill for itself: every
 * rollup UpdateItem wakes the consumer, which writes another rollup, which wakes the
 * consumer.
 *
 * The filter is INSERT only, AND partition key beginning with EVT#.
 *
 *   INSERT only     a rollup write arrives as MODIFY, and a TTL expiry arrives as REMOVE,
 *                   so both are excluded by the event name alone
 *   pk prefix EVT#  the first rollup write for a new day arrives as INSERT, not MODIFY,
 *                   so the event name alone is NOT enough. The prefix is what closes it.
 *
 * Both halves are load bearing. Dropping either one reopens the loop. This is written down
 * in bold in the Data model document, section 5.1, because it is the single thing most
 * likely to be dropped when someone re-implements this from a summary.
 *
 * The filter is declared here, in application code, for two reasons: the infrastructure
 * that configures the event source mapping imports this exact pattern rather than retyping
 * it, and the consumer applies the same rule again itself, so a misconfigured mapping
 * cannot start the loop either.
 */

export const EVENT_PREFIX = 'EVT#';

/** The AWS Lambda event source mapping filter pattern, as AWS expects it. */
export const STREAM_FILTER_PATTERN = {
  eventName: ['INSERT'],
  dynamodb: { Keys: { pk: { S: [{ prefix: EVENT_PREFIX }] } } },
} as const;

/** The FilterCriteria block for an event source mapping, ready to hand to infrastructure. */
export const STREAM_FILTER_CRITERIA = {
  Filters: [{ Pattern: JSON.stringify(STREAM_FILTER_PATTERN) }],
} as const;

export interface StreamRecordLike {
  eventName?: string;
  dynamodb?: {
    Keys?: Record<string, { S?: string } | undefined>;
    NewImage?: Record<string, unknown>;
  };
}

/**
 * The same rule the event source mapping applies, applied again in process.
 *
 * Defence in depth, not belt and braces for its own sake: if the mapping is deployed
 * without its filter, this is what stops a self-triggering, self-billing loop from
 * starting.
 */
export function matchesStreamFilter(record: StreamRecordLike): boolean {
  if (record.eventName !== 'INSERT') return false;
  const pk = record.dynamodb?.Keys?.['pk']?.S;
  return typeof pk === 'string' && pk.startsWith(EVENT_PREFIX);
}

export function partitionByFilter<T extends StreamRecordLike>(records: T[]): { accepted: T[]; rejected: T[] } {
  const accepted: T[] = [];
  const rejected: T[] = [];
  for (const record of records) {
    (matchesStreamFilter(record) ? accepted : rejected).push(record);
  }
  return { accepted, rejected };
}
