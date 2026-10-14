import { now as clockNow } from './clock.js';

/**
 * Time handling. RFC 3339, UTC, Z suffix, per the API contract, section 8.1.
 * There are no local times anywhere in this API.
 *
 * Server time comes from clock.ts rather than Date.now() directly, so that a test can
 * pin it. See that file for which uses of time sit behind the seam and which do not.
 */

/** Milliseconds in the 30 minute deduplication window from the Data model document, section 3.5. */
export const DEDUP_WINDOW_SECONDS = 1800;

/**
 * How far a browser supplied occurredAt may sit from server time before the server stops
 * trusting it for bucketing. A phone with a wrong clock still gets its scan counted, it is
 * just bucketed against server time instead of being allowed to write into the wrong day.
 */
export const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

export function nowIso(now: number = clockNow()): string {
  return new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function toIso(value: Date | number | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function epochSeconds(value: Date | number | string): number {
  const d = value instanceof Date ? value : new Date(value);
  return Math.floor(d.getTime() / 1000);
}

export function dayKey(value: Date | number | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 10);
}

export function hourKey(value: Date | number | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 13);
}

export function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function daysBetweenInclusive(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.floor((b - a) / 86400000) + 1;
}

/** Every UTC day from `from` to `to` inclusive. */
export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  while (cursor <= end) {
    out.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += 86400000;
  }
  return out;
}

export interface ScanBuckets {
  /** The timestamp actually used for bucketing, ISO 8601. */
  effectiveAt: string;
  /** YYYY-MM-DD, the date component of the raw event partition key. */
  day: string;
  /** YYYY-MM-DDTHH, the hourly rollup sort key. */
  hour: string;
  /** floor(epochSeconds / 1800), the deduplication window from the Data model document. */
  windowId: number;
  /** First hex character of the dedup token: 16 write partitions per blend per day. */
  shard: string;
  /** Whether the client supplied occurredAt was trusted for bucketing. */
  clientClockTrusted: boolean;
}

/**
 * Derives every key component the scan write needs, from the request body and server time
 * alone. No read, no lookup, no round trip. See the Data model document, section 4.1.
 *
 * Deduplication has to be a pure function of the request body, otherwise the same beacon
 * delivered twice by the browser lands on two different keys and the conditional write
 * stops deduplicating anything.
 */
export function deriveScanBuckets(
  occurredAt: string,
  dedupToken: string,
  receivedAtMs: number = clockNow(),
): ScanBuckets {
  const occurredMs = Date.parse(occurredAt);
  const usable = Number.isFinite(occurredMs) && Math.abs(occurredMs - receivedAtMs) <= MAX_CLOCK_SKEW_MS;
  const effectiveMs = usable ? occurredMs : receivedAtMs;
  const effective = new Date(effectiveMs);
  return {
    effectiveAt: toIso(effective),
    day: effective.toISOString().slice(0, 10),
    hour: effective.toISOString().slice(0, 13),
    windowId: Math.floor(effectiveMs / 1000 / DEDUP_WINDOW_SECONDS),
    shard: (dedupToken[0] ?? '0').toLowerCase(),
    clientClockTrusted: usable,
  };
}
