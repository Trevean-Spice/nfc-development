/**
 * Everything the page shows is derived here, from one ScanTimeSeries response, as pure
 * functions over the frozen contract's own shapes.
 *
 * Nothing in this file fetches, and nothing in it computes a number the rollups do not
 * already carry. Every total is a sum of counters that were pre-aggregated by the stream
 * consumer; no percentile is reconstructed from a mean, and no per bucket percentile is
 * averaged into a window percentile, because both of those are fictions that look like
 * numbers.
 */

import { share } from './format.js';

/**
 * Below this many counted scans the window is labelled sparse and the reader is told that
 * shares are volatile. It is a judgement, and it is written down in one place so it is
 * arguable rather than buried: at 25 scans one extra scan moves a share by 4 points.
 */
export const SPARSE_SCAN_THRESHOLD = 25;
export const SPARSE_BUCKET_THRESHOLD = 3;

const CHANNELS = ['nfc', 'qr', 'direct'];
const PLATFORMS = ['ios', 'android', 'other'];

function n(value) {
  return Number.isFinite(value) ? value : 0;
}

/** One bucket, normalised so a rollup row with absent counters reads as zeroes, not gaps. */
export function normalisePoint(point) {
  const channel = point && point.byChannel ? point.byChannel : {};
  const platform = point && point.byPlatform ? point.byPlatform : {};
  const cache = point && point.cache ? point.cache : {};
  const ttr = point && point.timeToReadable ? point.timeToReadable : {};
  return {
    bucket: point && typeof point.bucket === 'string' ? point.bucket : '',
    scans: n(point && point.scans),
    byChannel: { nfc: n(channel.nfc), qr: n(channel.qr), direct: n(channel.direct) },
    byPlatform: { ios: n(platform.ios), android: n(platform.android), other: n(platform.other) },
    reorderClicks: n(point && point.reorderClicks),
    recipeOpens: n(point && point.recipeOpens),
    cache: { hit: n(cache.hit), miss: n(cache.miss), stale: n(cache.stale) },
    timeToReadable: {
      count: n(ttr.count),
      sumMs: n(ttr.sumMs),
      p50Ms: Number.isFinite(ttr.p50Ms) ? ttr.p50Ms : null,
      p95Ms: Number.isFinite(ttr.p95Ms) ? ttr.p95Ms : null,
    },
    topCities: Array.isArray(point && point.topCities) ? point.topCities : [],
  };
}

export function summarise(series) {
  const points = (series && Array.isArray(series.points) ? series.points : []).map(normalisePoint);
  const totals = {
    scans: 0,
    byChannel: { nfc: 0, qr: 0, direct: 0 },
    byPlatform: { ios: 0, android: 0, other: 0 },
    reorderClicks: 0,
    recipeOpens: 0,
    cache: { hit: 0, miss: 0, stale: 0 },
    ttrCount: 0,
    ttrSumMs: 0,
  };
  let bucketsWithData = 0;
  let worstDailyP95Ms = null;
  let peak = null;

  for (const point of points) {
    totals.scans += point.scans;
    for (const key of CHANNELS) totals.byChannel[key] += point.byChannel[key];
    for (const key of PLATFORMS) totals.byPlatform[key] += point.byPlatform[key];
    totals.reorderClicks += point.reorderClicks;
    totals.recipeOpens += point.recipeOpens;
    totals.cache.hit += point.cache.hit;
    totals.cache.miss += point.cache.miss;
    totals.cache.stale += point.cache.stale;
    totals.ttrCount += point.timeToReadable.count;
    totals.ttrSumMs += point.timeToReadable.sumMs;
    if (point.scans > 0) bucketsWithData += 1;
    if (point.timeToReadable.p95Ms !== null) {
      worstDailyP95Ms = worstDailyP95Ms === null ? point.timeToReadable.p95Ms : Math.max(worstDailyP95Ms, point.timeToReadable.p95Ms);
    }
    if (peak === null || point.scans > peak.scans) peak = { bucket: point.bucket, scans: point.scans };
  }

  const attributed = totals.byChannel.nfc + totals.byChannel.qr + totals.byChannel.direct;

  return {
    points,
    totals,
    bucketCount: points.length,
    bucketsWithData,
    peak: peak && peak.scans > 0 ? peak : null,
    /**
     * The mean is exact, because count and sum are both carried on the rollup. The window
     * percentile is deliberately absent: per bucket percentiles cannot be averaged into a
     * window percentile without inventing a number, so the worst single bucket is reported
     * under its own name instead.
     */
    meanTimeToReadableMs: totals.ttrCount > 0 ? totals.ttrSumMs / totals.ttrCount : null,
    worstDailyP95Ms,
    /**
     * Channel counters are pre-aggregated independently of the scan counter. If they ever
     * disagree, that is worth surfacing rather than hiding behind a normalised percentage.
     */
    channelTotal: attributed,
    channelReconciles: attributed === totals.scans,
    density: densityOf(totals.scans, bucketsWithData),
  };
}

export function densityOf(scans, bucketsWithData) {
  if (scans <= 0) return 'empty';
  if (scans < SPARSE_SCAN_THRESHOLD || bucketsWithData < SPARSE_BUCKET_THRESHOLD) return 'sparse';
  return 'populated';
}

/**
 * Channel split, with the honest degradation the printed QR forces.
 *
 * qrDistinguishable is false when nothing arrived on the QR channel in the window. That is
 * either a genuine absence of QR scans or the unresolved printed code landing without a
 * channel and being counted as direct. The page cannot tell those apart from the rollups,
 * so it says both rather than picking the flattering one.
 */
export function channelSplit(summary) {
  const { nfc, qr, direct } = summary.totals.byChannel;
  const total = nfc + qr + direct;
  return {
    total,
    counts: { nfc, qr, direct },
    shares: {
      nfc: share(nfc, total),
      qr: share(qr, total),
      direct: share(direct, total),
    },
    /** The ratio is the trustworthy number, because both sides carry the same bias. */
    nfcToQr: qr > 0 ? nfc / qr : null,
    qrDistinguishable: qr > 0,
    directPresent: direct > 0,
  };
}

export function platformSplit(summary) {
  const { ios, android, other } = summary.totals.byPlatform;
  const total = ios + android + other;
  return {
    total,
    counts: { ios, android, other },
    shares: { ios: share(ios, total), android: share(android, total), other: share(other, total) },
  };
}

export function engagement(summary) {
  const scans = summary.totals.scans;
  return {
    scans,
    recipeOpens: summary.totals.recipeOpens,
    reorderClicks: summary.totals.reorderClicks,
    recipeOpensPer100: share(summary.totals.recipeOpens, scans),
    reorderClicksPer100: share(summary.totals.reorderClicks, scans),
  };
}

/**
 * Geography, merged across every bucket in the window and across every series fetched.
 *
 * Country, region and city only. The rollup carries one row per place per day, so merging
 * is a sum over a bounded list and never touches a raw event.
 */
export function mergeGeography(seriesList) {
  const byPlace = new Map();
  for (const series of seriesList) {
    const points = series && Array.isArray(series.points) ? series.points : [];
    for (const point of points) {
      const cities = Array.isArray(point.topCities) ? point.topCities : [];
      for (const row of cities) {
        if (!row || typeof row.country !== 'string') continue;
        const region = row.region === undefined ? null : row.region;
        const city = row.city === undefined ? null : row.city;
        const key = `${row.country}|${region ?? ''}|${city ?? ''}`;
        const existing = byPlace.get(key);
        if (existing) existing.scans += n(row.scans);
        else byPlace.set(key, { country: row.country, region, city, scans: n(row.scans) });
      }
    }
  }
  const places = [...byPlace.values()].sort((a, b) => b.scans - a.scans || a.country.localeCompare(b.country));
  const total = places.reduce((sum, place) => sum + place.scans, 0);
  const byCountry = new Map();
  for (const place of places) {
    byCountry.set(place.country, (byCountry.get(place.country) ?? 0) + place.scans);
  }
  return {
    places,
    total,
    countries: [...byCountry.entries()]
      .map(([country, scans]) => ({ country, scans }))
      .sort((a, b) => b.scans - a.scans),
    /**
     * Geography totals are counted from the geography rollup, which is written per place.
     * A scan whose CDN headers carried no country has no place row, so this total is at or
     * below the scan total and the gap is reported rather than papered over.
     */
    unplacedNote: true,
  };
}

/** Ranked cities with a share of the placed total, capped for display. */
export function topPlaces(geography, limit = 12) {
  return geography.places.slice(0, limit).map((place) => ({
    ...place,
    share: share(place.scans, geography.total),
  }));
}
