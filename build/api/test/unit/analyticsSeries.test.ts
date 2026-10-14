/**
 * The analytics dashboard, across the four dimensions that had never been exercised.
 *
 * On 11 September the client was told, correctly, that the scan pipeline works end to
 * end and that the dashboard on top of it was not tested: "the date range, the
 * granularity, the per blend filter and the platform breakdown have never been
 * exercised against meaningful data, because there are two test taps in the system."
 *
 * **Two test taps is the problem this file solves, and it solves it without AWS.**
 * Every number the dashboard shows comes from a pre-aggregated rollup row, so the
 * behaviour worth testing is how a range of rows is selected, bounded and folded into
 * points. That is pure given the rows, so the rows are synthesised at volume here
 * rather than waited for. **What this does not prove is the stream consumer that
 * writes those rows**; that was proven separately by a beacon reaching the live
 * distribution and the Scans screen reading the counter back.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryRollupRange = vi.fn();
const queryGeoRange = vi.fn();

vi.mock('../../src/repositories/rollups.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repositories/rollups.js')>();
  return { ...actual, queryRollupRange, queryGeoRange };
});

const { scanTimeSeries, rowToPoint, percentileFromBuckets, seriesPk } = await import(
  '../../src/services/analytics.js'
);
const { TTR_BUCKETS, ttrBucketField } = await import('../../src/repositories/rollups.js');

type Row = Record<string, unknown>;

/**
 * One rollup row with plausible internal consistency: the channel split and the platform
 * split each total the scan count, because that is what the consumer produces and a test
 * built on impossible rows proves nothing about real ones.
 */
function row(sk: string, scans: number, opts: Partial<{ ios: number; android: number; nfc: number; reorder: number }> = {}): Row {
  const ios = opts.ios ?? Math.floor(scans * 0.6);
  const android = opts.android ?? scans - ios;
  const nfc = opts.nfc ?? Math.floor(scans * 0.8);
  return {
    sk,
    scans,
    ch_nfc: nfc,
    ch_qr: scans - nfc,
    ch_direct: 0,
    pf_ios: ios,
    pf_android: android,
    pf_other: scans - ios - android,
    reorderClicks: opts.reorder ?? Math.floor(scans * 0.08),
    recipeOpens: Math.floor(scans * 0.3),
    cache_hit: Math.floor(scans * 0.9),
    cache_miss: scans - Math.floor(scans * 0.9),
    cache_stale: 0,
    ttr_count: scans,
    ttr_sum_ms: scans * 900,
    ttr_b_0_500: Math.floor(scans * 0.2),
    ttr_b_500_1000: Math.floor(scans * 0.5),
    ttr_b_1000_1500: Math.floor(scans * 0.2),
    ttr_b_1500_2000: Math.floor(scans * 0.07),
    ttr_b_2000_3000: Math.floor(scans * 0.02),
    ttr_b_3000_plus: Math.floor(scans * 0.01),
  };
}

/** Thirty days of daily rows, the shape a launched product actually produces. */
function thirtyDays(): Row[] {
  return Array.from({ length: 30 }, (_, i) => {
    const day = `2026-09-${String(i + 1).padStart(2, '0')}`;
    // A weekly rhythm, so a range query that silently returned the wrong window would
    // produce a visibly wrong shape rather than a plausible flat line.
    const weekday = (i + 2) % 7;
    return row(day, weekday === 0 || weekday === 6 ? 40 + i : 120 + i * 3);
  });
}

beforeEach(() => {
  queryRollupRange.mockReset();
  queryGeoRange.mockReset();
  queryGeoRange.mockResolvedValue([]);
});

describe('the per blend filter and granularity choose the partition', () => {
  it.each([
    [undefined, 'hour'],
    [undefined, 'day'],
    ['persian-sunrise', 'hour'],
    ['persian-sunrise', 'day'],
  ] as const)('blend=%s granularity=%s resolves to a distinct partition', (blend, granularity) => {
    expect(seriesPk(blend, granularity)).toBeTruthy();
  });

  it('all four partitions are different, so no filter can silently read another', () => {
    const keys = [
      seriesPk(undefined, 'hour'),
      seriesPk(undefined, 'day'),
      seriesPk('persian-sunrise', 'hour'),
      seriesPk('persian-sunrise', 'day'),
    ];
    expect(new Set(keys).size).toBe(4);
  });

  it('two blends never share a partition', () => {
    expect(seriesPk('persian-sunrise', 'day')).not.toBe(seriesPk('caribbean-sunset', 'day'));
  });

  it('a named blend queries that blend partition and not the all partition', async () => {
    queryRollupRange.mockResolvedValue(thirtyDays());
    await scanTimeSeries({ blend: 'caribbean-sunset', granularity: 'day', from: '2026-09-01', to: '2026-09-30' });

    const [pk] = queryRollupRange.mock.calls[0]!;
    expect(pk).toBe(seriesPk('caribbean-sunset', 'day'));
    expect(pk).not.toBe(seriesPk(undefined, 'day'));
  });
});

describe('the date range is bounded correctly, which is where an off by one hides', () => {
  it('a daily range passes the dates through untouched', async () => {
    queryRollupRange.mockResolvedValue(thirtyDays());
    await scanTimeSeries({ blend: undefined, granularity: 'day', from: '2026-09-01', to: '2026-09-30' });

    const [, from, to] = queryRollupRange.mock.calls[0]!;
    expect(from).toBe('2026-09-01');
    expect(to).toBe('2026-09-30');
  });

  it('an hourly range reaches the LAST hour of the final day rather than stopping at midnight', async () => {
    // This is the bug worth having a test for. Hourly sort keys are YYYY-MM-DDTHH, so an
    // unextended end bound returns 00:00 and silently drops 23 hours of the last day,
    // which on a demo day is most of the data anybody is looking at.
    queryRollupRange.mockResolvedValue([]);
    await scanTimeSeries({ blend: undefined, granularity: 'hour', from: '2026-09-26', to: '2026-09-27' });

    const [, from, to] = queryRollupRange.mock.calls[0]!;
    expect(from).toBe('2026-09-26T00');
    expect(to).toBe('2026-09-27T23');
  });

  it('a single day hourly range still spans the whole day', async () => {
    queryRollupRange.mockResolvedValue([]);
    await scanTimeSeries({ blend: undefined, granularity: 'hour', from: '2026-09-27', to: '2026-09-27' });

    const [, from, to] = queryRollupRange.mock.calls[0]!;
    expect(from).toBe('2026-09-27T00');
    expect(to).toBe('2026-09-27T23');
  });

  it('returns one point per row over thirty days, in the order the store returned them', async () => {
    const rows = thirtyDays();
    queryRollupRange.mockResolvedValue(rows);

    const points = await scanTimeSeries({ blend: undefined, granularity: 'day', from: '2026-09-01', to: '2026-09-30' });

    expect(points).toHaveLength(30);
    expect(points[0]!.bucket).toBe('2026-09-01');
    expect(points[29]!.bucket).toBe('2026-09-30');
  });

  it('an empty range is an empty series rather than an error', async () => {
    queryRollupRange.mockResolvedValue([]);
    const points = await scanTimeSeries({ blend: undefined, granularity: 'day', from: '2026-01-01', to: '2026-01-31' });
    expect(points).toEqual([]);
  });

  it('a full 24 hour day of hourly rows folds to 24 points', async () => {
    const hours = Array.from({ length: 24 }, (_, h) => row(`2026-09-27T${String(h).padStart(2, '0')}`, h * 7));
    queryRollupRange.mockResolvedValue(hours);

    const points = await scanTimeSeries({ blend: 'persian-sunrise', granularity: 'hour', from: '2026-09-27', to: '2026-09-27' });

    expect(points).toHaveLength(24);
    expect(points.reduce((sum, p) => sum + p.scans, 0)).toBe(hours.reduce((s, r) => s + (r.scans as number), 0));
  });
});

describe('the platform breakdown', () => {
  it('splits ios, android and other, and they total the scan count', async () => {
    queryRollupRange.mockResolvedValue(thirtyDays());
    const points = await scanTimeSeries({ blend: undefined, granularity: 'day', from: '2026-09-01', to: '2026-09-30' });

    for (const point of points) {
      const { ios, android, other } = point.byPlatform;
      expect(ios + android + other).toBe(point.scans);
    }
  });

  it('a platform absent from the row reads zero rather than undefined', () => {
    // A rollup row only carries the fields the consumer has ever incremented, so a day
    // with no Android taps has no pf_android attribute at all. Rendering that as
    // undefined puts "NaN" on a chart in front of an investor.
    const point = rowToPoint({ sk: '2026-09-27', scans: 5, pf_ios: 5 } as never);
    expect(point.byPlatform).toEqual({ ios: 5, android: 0, other: 0 });
    expect(point.byChannel).toEqual({ nfc: 0, qr: 0, direct: 0 });
    expect(point.reorderClicks).toBe(0);
  });

  it('the channel split also totals the scan count, so NFC and QR are comparable', async () => {
    queryRollupRange.mockResolvedValue(thirtyDays());
    const points = await scanTimeSeries({ blend: undefined, granularity: 'day', from: '2026-09-01', to: '2026-09-30' });

    for (const point of points) {
      const { nfc, qr, direct } = point.byChannel;
      expect(nfc + qr + direct).toBe(point.scans);
    }
  });
});

describe('time to readable percentiles, which is the number the acceptance criterion turns on', () => {
  it('interpolates p50 and p95 from the stored histogram', () => {
    const point = rowToPoint(row('2026-09-27', 1000) as never);
    expect(point.timeToReadable.p50Ms).not.toBeNull();
    expect(point.timeToReadable.p95Ms).not.toBeNull();
    expect(point.timeToReadable.p95Ms!).toBeGreaterThanOrEqual(point.timeToReadable.p50Ms!);
  });

  it('returns null rather than zero when nothing was measured', () => {
    // Zero would read as an impossibly fast tap. Null renders as "no data", which is true.
    expect(percentileFromBuckets({ sk: '2026-09-27' } as never, 0.5)).toBeNull();
  });

  it('every latency lands in exactly one bucket, including the boundaries', () => {
    const boundaries = [0, 499, 500, 999, 1000, 1999, 2000, 2999, 3000, 10_000];
    for (const ms of boundaries) {
      const field = ttrBucketField(ms);
      expect(TTR_BUCKETS.some((b) => b.field === field)).toBe(true);
    }
    // The 2000 ms contractual line must be the edge of a bucket, or the criterion cannot
    // be read off the histogram at all.
    expect(TTR_BUCKETS.some((b) => b.upperMs === 2000)).toBe(true);
    expect(ttrBucketField(1999)).not.toBe(ttrBucketField(2000));
  });
});

describe('geography is attached only where it exists, and never guessed', () => {
  it('is not queried for an all blends series', async () => {
    queryRollupRange.mockResolvedValue(thirtyDays());
    await scanTimeSeries({ blend: undefined, granularity: 'day', from: '2026-09-01', to: '2026-09-30' });
    expect(queryGeoRange).not.toHaveBeenCalled();
  });

  it('is not queried for an hourly series, because it is only stored per day', async () => {
    queryRollupRange.mockResolvedValue([]);
    await scanTimeSeries({ blend: 'persian-sunrise', granularity: 'hour', from: '2026-09-27', to: '2026-09-27' });
    expect(queryGeoRange).not.toHaveBeenCalled();
  });

  it('leaves topCities undefined when geography returns nothing, rather than an empty list', async () => {
    // Undefined means "not collected". An empty array would claim we looked and found
    // nowhere, and geography is deliberately switched off on this deployment (Q31).
    queryRollupRange.mockResolvedValue(thirtyDays());
    const points = await scanTimeSeries({ blend: 'persian-sunrise', granularity: 'day', from: '2026-09-01', to: '2026-09-30' });
    expect(points.every((p) => p.topCities === undefined)).toBe(true);
  });
});
