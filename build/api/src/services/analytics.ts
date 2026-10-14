import {
  queryGeoRange,
  queryRollupRange,
  TTR_BUCKETS,
  type RollupRow,
} from '../repositories/rollups.js';
import {
  parseGeoSk,
  rollupAllDayPk,
  rollupAllHourPk,
  rollupBlendDayPk,
  rollupBlendHourPk,
  rollupGeoDayPk,
} from '../db/keys.js';

/**
 * Pattern 7: the dashboard time series.
 *
 * There is no code path in this file that reads a raw scan event, and there is no Scan
 * anywhere in it. Every number comes from a pre-aggregated rollup row. That is the
 * difference between a dashboard that is still fast at ten million scans and one that gets
 * slower every month, and it is why the response carries source: "rollup" as the only
 * permitted value: it makes the rule a contract test assertion rather than a convention
 * people remember.
 */

export const MEASUREMENT_NOTE =
  'NFC and QR counts are deduplicated by the same browser side token, because per SKU tag ' +
  'encoding provides no per-tag counter. The two channels are directly comparable to each ' +
  'other and neither is a per-jar count.';

function num(row: RollupRow, field: string): number {
  const v = row[field];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Percentiles interpolated from stored histogram buckets rather than reconstructed from a
 * count and a sum, because a percentile derived from a mean is a fiction. The 2000 ms
 * boundary sits exactly on the acceptance number, so the fraction of real customer taps
 * readable inside 2.0 seconds is read off the rollup rather than calculated.
 */
export function percentileFromBuckets(row: RollupRow, p: number): number | null {
  const counts = TTR_BUCKETS.map((b) => num(row, b.field));
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const target = total * p;
  let cumulative = 0;
  let lower = 0;
  for (let i = 0; i < TTR_BUCKETS.length; i += 1) {
    const bucket = TTR_BUCKETS[i] as { field: string; upperMs: number };
    const count = counts[i] as number;
    if (cumulative + count >= target) {
      if (!Number.isFinite(bucket.upperMs)) return lower;
      if (count === 0) return Math.round(bucket.upperMs);
      const withinBucket = (target - cumulative) / count;
      return Math.round(lower + withinBucket * (bucket.upperMs - lower));
    }
    cumulative += count;
    lower = Number.isFinite(bucket.upperMs) ? bucket.upperMs : lower;
  }
  return lower;
}

export interface SeriesPoint {
  bucket: string;
  scans: number;
  byChannel: { nfc: number; qr: number; direct: number };
  byPlatform: { ios: number; android: number; other: number };
  reorderClicks: number;
  recipeOpens: number;
  cache: { hit: number; miss: number; stale: number };
  timeToReadable: { count: number; sumMs: number; p50Ms: number | null; p95Ms: number | null };
  topCities?: Array<{ country: string; region: string | null; city: string | null; scans: number }>;
}

export function rowToPoint(row: RollupRow): SeriesPoint {
  return {
    bucket: String(row.sk),
    scans: num(row, 'scans'),
    byChannel: { nfc: num(row, 'ch_nfc'), qr: num(row, 'ch_qr'), direct: num(row, 'ch_direct') },
    byPlatform: { ios: num(row, 'pf_ios'), android: num(row, 'pf_android'), other: num(row, 'pf_other') },
    reorderClicks: num(row, 'reorderClicks'),
    recipeOpens: num(row, 'recipeOpens'),
    cache: { hit: num(row, 'cache_hit'), miss: num(row, 'cache_miss'), stale: num(row, 'cache_stale') },
    timeToReadable: {
      count: num(row, 'ttr_count'),
      sumMs: num(row, 'ttr_sum_ms'),
      p50Ms: percentileFromBuckets(row, 0.5),
      p95Ms: percentileFromBuckets(row, 0.95),
    },
  };
}

export function seriesPk(blend: string | undefined, granularity: 'hour' | 'day'): string {
  if (blend) return granularity === 'hour' ? rollupBlendHourPk(blend) : rollupBlendDayPk(blend);
  return granularity === 'hour' ? rollupAllHourPk() : rollupAllDayPk();
}

export async function scanTimeSeries(options: {
  blend: string | undefined;
  granularity: 'hour' | 'day';
  from: string;
  to: string;
}): Promise<SeriesPoint[]> {
  const { blend, granularity, from, to } = options;
  // Hourly sort keys are YYYY-MM-DDTHH, so the range end has to reach the last hour of the
  // final day rather than stopping at midnight.
  const rangeFrom = granularity === 'hour' ? `${from}T00` : from;
  const rangeTo = granularity === 'hour' ? `${to}T23` : to;

  const rows = await queryRollupRange(seriesPk(blend, granularity), rangeFrom, rangeTo);
  const points = rows.map(rowToPoint);

  // Geography is stored per place per day, so it is only attached to daily series, and
  // only when a blend is named. Country, region and city only, never an IP.
  if (blend && granularity === 'day') {
    const geoRows = await queryGeoRange(rollupGeoDayPk(blend), from, to);
    const byDay = new Map<string, Array<{ country: string; region: string | null; city: string | null; scans: number }>>();
    for (const row of geoRows) {
      const parsed = parseGeoSk(String(row.sk));
      if (!parsed) continue;
      const list = byDay.get(parsed.day) ?? [];
      list.push({ country: parsed.country, region: parsed.region, city: parsed.city, scans: num(row, 'scans') });
      byDay.set(parsed.day, list);
    }
    for (const point of points) {
      const cities = byDay.get(point.bucket);
      if (!cities) continue;
      point.topCities = cities.sort((a, b) => b.scans - a.scans).slice(0, 25);
    }
  }

  return points;
}
