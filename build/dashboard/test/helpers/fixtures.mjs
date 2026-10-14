/** Fixtures shaped exactly like the frozen contract's ScanTimeSeries. */

export const MEASUREMENT_NOTE =
  'NFC and QR counts are deduplicated by the same browser side token, because per SKU tag ' +
  'encoding provides no per-tag counter. The two channels are directly comparable to each ' +
  'other and neither is a per-jar count.';

export function point(bucket, overrides = {}) {
  const scans = overrides.scans ?? 0;
  return {
    bucket,
    scans,
    byChannel: { nfc: 0, qr: 0, direct: 0, ...(overrides.byChannel ?? {}) },
    byPlatform: { ios: 0, android: 0, other: 0, ...(overrides.byPlatform ?? {}) },
    reorderClicks: overrides.reorderClicks ?? 0,
    recipeOpens: overrides.recipeOpens ?? 0,
    cache: { hit: scans, miss: 0, stale: 0, ...(overrides.cache ?? {}) },
    timeToReadable: { count: 0, sumMs: 0, p50Ms: null, p95Ms: null, ...(overrides.timeToReadable ?? {}) },
    ...(overrides.topCities ? { topCities: overrides.topCities } : {}),
  };
}

export function series(points, overrides = {}) {
  return {
    blend: null,
    granularity: 'day',
    from: '2026-08-01',
    to: '2026-08-03',
    measurementMethod: 'browser_token',
    measurementNote: MEASUREMENT_NOTE,
    source: 'rollup',
    points,
    ...overrides,
  };
}

/** A populated three day window with both channels present. */
export function populatedSeries() {
  return series([
    point('2026-08-01', {
      scans: 118,
      byChannel: { nfc: 74, qr: 41, direct: 3 },
      byPlatform: { ios: 79, android: 36, other: 3 },
      reorderClicks: 14,
      recipeOpens: 61,
      cache: { hit: 115, miss: 3, stale: 0 },
      timeToReadable: { count: 118, sumMs: 139240, p50Ms: 1150, p95Ms: 1720 },
      topCities: [
        { country: 'US', region: 'MA', city: 'Boston', scans: 44 },
        { country: 'US', region: 'NY', city: 'Brooklyn', scans: 21 },
        { country: 'US', region: null, city: null, scans: 9 },
      ],
    }),
    point('2026-08-02', {
      scans: 96,
      byChannel: { nfc: 60, qr: 34, direct: 2 },
      byPlatform: { ios: 63, android: 31, other: 2 },
      reorderClicks: 9,
      recipeOpens: 48,
      cache: { hit: 96, miss: 0, stale: 0 },
      timeToReadable: { count: 96, sumMs: 111360, p50Ms: 1130, p95Ms: 1690 },
      topCities: [{ country: 'US', region: 'MA', city: 'Boston', scans: 33 }],
    }),
    point('2026-08-03', {
      scans: 41,
      byChannel: { nfc: 27, qr: 13, direct: 1 },
      byPlatform: { ios: 28, android: 12, other: 1 },
      reorderClicks: 5,
      recipeOpens: 19,
      cache: { hit: 41, miss: 0, stale: 0 },
      timeToReadable: { count: 41, sumMs: 46740, p50Ms: 1120, p95Ms: 1660 },
      topCities: [{ country: 'GB', region: 'ENG', city: 'London', scans: 8 }],
    }),
  ]);
}

/** The world where the printed QR does not arrive on a route of its own. */
export function qrIndistinguishableSeries() {
  return series([
    point('2026-08-01', {
      scans: 100,
      byChannel: { nfc: 62, qr: 0, direct: 38 },
      byPlatform: { ios: 66, android: 31, other: 3 },
      reorderClicks: 11,
      recipeOpens: 52,
      timeToReadable: { count: 100, sumMs: 124000, p50Ms: 1180, p95Ms: 1780 },
    }),
    point('2026-08-02', {
      scans: 90,
      byChannel: { nfc: 56, qr: 0, direct: 34 },
      byPlatform: { ios: 59, android: 28, other: 3 },
      reorderClicks: 10,
      recipeOpens: 47,
      timeToReadable: { count: 90, sumMs: 111600, p50Ms: 1170, p95Ms: 1760 },
    }),
    point('2026-08-03', {
      scans: 88,
      byChannel: { nfc: 55, qr: 0, direct: 33 },
      byPlatform: { ios: 58, android: 27, other: 3 },
      reorderClicks: 9,
      recipeOpens: 44,
      timeToReadable: { count: 88, sumMs: 109120, p50Ms: 1160, p95Ms: 1750 },
    }),
  ]);
}

/** Nothing at all. The state the dashboard is in before launch. */
export function emptySeries() {
  return series([]);
}

/** Rollup rows exist but every counter is zero, which is a different empty. */
export function zeroedSeries() {
  return series([point('2026-08-01'), point('2026-08-02'), point('2026-08-03')]);
}

export function sparseSeries() {
  return series([
    point('2026-08-01', { scans: 1, byChannel: { nfc: 1, qr: 0, direct: 0 }, byPlatform: { ios: 1, android: 0, other: 0 } }),
    point('2026-08-02'),
    point('2026-08-03', { scans: 2, byChannel: { nfc: 1, qr: 1, direct: 0 }, byPlatform: { ios: 1, android: 1, other: 0 } }),
  ]);
}

export const SELECTION = { from: '2026-08-01', to: '2026-08-03', granularity: 'day', blend: null };
