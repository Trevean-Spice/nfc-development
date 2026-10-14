/**
 * Seeds pre-aggregated rollup rows so every panel on the dashboard has something to show.
 *
 * It writes rollup items only. It does not write raw scan events, and it does not pretend
 * to be the stream consumer: the consumer that produces these rows in the real system lives
 * in the API package and is tested there. What this produces is the shape the dashboard
 * reads, in the key namespaces the Data model document, section 5.2, defines, so that a
 * local run exercises the same query as production.
 *
 * The numbers are generated from a fixed seed, so two runs produce the same charts and a
 * screenshot in a status report can be reproduced.
 */

import { loadDynamoClients } from './lib/deps.mjs';

/**
 * Key builders. These MUST match build/api/src/db/keys.ts, and a test asserts that they do
 * by reading that file rather than by trusting this comment.
 */
export const rollupBlendDayPk = (slug) => `ROLLUP#BLEND#${slug}#DAY`;
export const rollupBlendHourPk = (slug) => `ROLLUP#BLEND#${slug}#HOUR`;
export const rollupAllDayPk = () => 'ROLLUP#ALL#DAY';
export const rollupAllHourPk = () => 'ROLLUP#ALL#HOUR';
export const rollupGeoDayPk = (slug) => `ROLLUP#BLEND#${slug}#GEO#DAY`;
export const rollupGeoSk = (day, country, region, city) => `${day}#${country}#${region ?? '-'}#${city ?? '-'}`;

/**
 * The time to readable histogram, from the Data model document, section 5.3.
 *
 * The weights are shaped so the seeded p95 lands just inside 2.0 seconds, because that is
 * where the real measurements put it: the corrected iPhone XS worst case is 1.8 to 1.9
 * seconds once the 307 hop is counted. Seeding a comfortable distribution would make the
 * dashboard look reassuring about the one number with the least margin on this project.
 */
const TTR_BUCKETS = [
  { field: 'ttr_b_0_500', midpointMs: 300, weight: 2 },
  { field: 'ttr_b_500_1000', midpointMs: 800, weight: 28 },
  { field: 'ttr_b_1000_1500', midpointMs: 1240, weight: 48 },
  { field: 'ttr_b_1500_2000', midpointMs: 1720, weight: 20 },
  { field: 'ttr_b_2000_3000', midpointMs: 2350, weight: 1.7 },
  { field: 'ttr_b_3000_plus', midpointMs: 4100, weight: 0.3 },
];

/**
 * The four encoded blends plus the reserved fifth.
 *
 * Kyoto Garden is seeded with nothing on purpose. No tag in the SO4731 run carries its
 * code and the blend is a draft, so selecting it is the fastest way to see what an honest
 * empty state looks like without waiting for a real empty window.
 */
export const BLENDS = [
  { slug: 'persian-sunrise', baseScans: 62 },
  { slug: 'caribbean-sunset', baseScans: 44 },
  { slug: 'north-african-night-market', baseScans: 21 },
  { slug: 'silk-road', baseScans: 17 },
  { slug: 'kyoto-garden', baseScans: 0 },
];

const PLACES = [
  { country: 'US', region: 'MA', city: 'Boston', weight: 24 },
  { country: 'US', region: 'NY', city: 'Brooklyn', weight: 12 },
  { country: 'US', region: 'NY', city: 'New York', weight: 10 },
  { country: 'US', region: 'IL', city: 'Chicago', weight: 8 },
  { country: 'US', region: 'CA', city: 'San Francisco', weight: 7 },
  { country: 'US', region: 'TX', city: 'Austin', weight: 6 },
  { country: 'US', region: 'WA', city: 'Seattle', weight: 5 },
  { country: 'US', region: 'OR', city: 'Portland', weight: 4 },
  { country: 'CA', region: 'ON', city: 'Toronto', weight: 5 },
  { country: 'CA', region: 'BC', city: 'Vancouver', weight: 3 },
  { country: 'GB', region: 'ENG', city: 'London', weight: 6 },
  // A CDN viewer header that carried a country and nothing finer. Stored as unknown rather
  // than guessed, and shown on the dashboard as unknown rather than dropped.
  { country: 'US', region: null, city: null, weight: 10 },
];

/** Hour of day weights, UTC. Cooking happens in the evening and the peak is not flat. */
const HOUR_WEIGHTS = [1, 1, 1, 1, 2, 3, 5, 7, 8, 7, 6, 6, 7, 8, 9, 11, 14, 18, 22, 21, 16, 11, 7, 4];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Integer allocation by largest remainder, so the parts always sum to the whole. */
export function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const exact = weights.map((weight) => (weight / sum) * total);
  const counts = exact.map((value) => Math.floor(value));
  let remaining = total - counts.reduce((a, b) => a + b, 0);
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder);
  let cursor = 0;
  while (remaining > 0) {
    counts[order[cursor % order.length].index] += 1;
    remaining -= 1;
    cursor += 1;
  }
  return counts;
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekdayFactor(isoDate) {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  // Saturday and Sunday are the days people cook from a jar they were given.
  return [0.95, 0.85, 0.88, 0.92, 1.0, 1.18, 1.25][day];
}

/**
 * Daily counters for one blend.
 *
 * qrRoute is the whole point of the option: "distinct" is the world in which the printed QR
 * resolves through a route of its own and the split is real. "not-distinct" is the world in
 * which it does not, where those scans arrive without a channel and are counted as direct.
 * Both are seedable, because both are live possibilities and the dashboard has to be honest
 * in each.
 */
export function dayCounters({ slug, day, dayIndex, launchIndex, baseScans, qrRoute }) {
  const random = mulberry32(hashString(`${slug}#${day}`));
  let scans;
  if (baseScans === 0) {
    scans = 0;
  } else if (dayIndex < launchIndex) {
    // Before launch: a handful of internal taps and a lot of nothing. This is the state the
    // dashboard is in today, and it is why the empty and sparse states matter.
    scans = random() < 0.72 ? 0 : Math.round(random() * 2);
  } else {
    const ramp = Math.min(1, 0.35 + (dayIndex - launchIndex) / 30);
    const noise = 0.8 + random() * 0.45;
    scans = Math.max(0, Math.round(baseScans * ramp * weekdayFactor(day) * noise));
  }

  if (scans === 0) {
    return { scans: 0 };
  }

  const channelWeights = qrRoute === 'distinct' ? [62, 33, 5] : [62, 0, 38];
  const [nfc, qr, direct] = allocate(scans, channelWeights);
  const [ios, android, other] = allocate(scans, [66, 31, 3]);
  const [cacheHit, cacheMiss, cacheStale] = allocate(scans, [96, 3, 1]);
  const ttrCounts = allocate(scans, TTR_BUCKETS.map((bucket) => bucket.weight));
  const sumMs = ttrCounts.reduce((sum, count, index) => sum + count * TTR_BUCKETS[index].midpointMs, 0);

  const counters = {
    scans,
    ch_nfc: nfc,
    ch_qr: qr,
    ch_direct: direct,
    pf_ios: ios,
    pf_android: android,
    pf_other: other,
    recipeOpens: Math.round(scans * (0.42 + random() * 0.2)),
    reorderClicks: Math.round(scans * (0.06 + random() * 0.09)),
    cache_hit: cacheHit,
    cache_miss: cacheMiss,
    cache_stale: cacheStale,
    ttr_count: scans,
    ttr_sum_ms: sumMs,
  };
  TTR_BUCKETS.forEach((bucket, index) => {
    counters[bucket.field] = ttrCounts[index];
  });
  return counters;
}

function mergeCounters(target, source) {
  for (const [field, value] of Object.entries(source)) {
    if (typeof value !== 'number') continue;
    target[field] = (target[field] ?? 0) + value;
  }
  return target;
}

/**
 * Builds every rollup item for the window. Pure, so the test suite can assert the shapes
 * without a database.
 */
export function buildRollupItems({ today, days = 90, hourlyDays = 3, qrRoute = 'distinct' } = {}) {
  const items = [];
  const launchIndex = Math.max(0, days - 46);
  const allDays = new Map();
  const allHours = new Map();

  for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
    const day = addDays(today, -(days - 1 - dayIndex));
    for (const blend of BLENDS) {
      const counters = dayCounters({
        slug: blend.slug,
        day,
        dayIndex,
        launchIndex,
        baseScans: blend.baseScans,
        qrRoute,
      });
      if (counters.scans === 0) continue;

      items.push({ pk: rollupBlendDayPk(blend.slug), sk: day, ...counters });
      if (!allDays.has(day)) allDays.set(day, {});
      mergeCounters(allDays.get(day), counters);

      // Geography, one row per place per day. Country, region and city only.
      const placeCounts = allocate(counters.scans, PLACES.map((place) => place.weight));
      PLACES.forEach((place, index) => {
        if (placeCounts[index] <= 0) return;
        items.push({
          pk: rollupGeoDayPk(blend.slug),
          sk: rollupGeoSk(day, place.country, place.region, place.city),
          scans: placeCounts[index],
        });
      });

      // Hourly rows for the most recent days only, which is what the gate and demo day use.
      if (dayIndex >= days - hourlyDays) {
        const hourCounts = allocate(counters.scans, HOUR_WEIGHTS);
        hourCounts.forEach((hourScans, hour) => {
          if (hourScans <= 0) return;
          const fraction = hourScans / counters.scans;
          const hourly = scaleCounters(counters, fraction, hourScans);
          const sk = `${day}T${String(hour).padStart(2, '0')}`;
          items.push({ pk: rollupBlendHourPk(blend.slug), sk, ...hourly });
          if (!allHours.has(sk)) allHours.set(sk, {});
          mergeCounters(allHours.get(sk), hourly);
        });
      }
    }
  }

  for (const [day, counters] of allDays) items.push({ pk: rollupAllDayPk(), sk: day, ...counters });
  for (const [sk, counters] of allHours) items.push({ pk: rollupAllHourPk(), sk, ...counters });

  return items;
}

/** Scales a day's counters down to one hour, keeping the scan count exact. */
function scaleCounters(counters, fraction, hourScans) {
  const scaled = { scans: hourScans };
  for (const [field, value] of Object.entries(counters)) {
    if (field === 'scans' || typeof value !== 'number') continue;
    scaled[field] = Math.round(value * fraction);
  }
  scaled.ttr_count = hourScans;
  return scaled;
}

export async function seedRollups({ endpoint, table = 'ScanEvents', today, days = 90, hourlyDays = 3, qrRoute = 'distinct' }) {
  const { DynamoDBClient, DynamoDBDocumentClient, BatchWriteCommand } = loadDynamoClients();
  const client = DynamoDBDocumentClient.from(
    new DynamoDBClient({
      endpoint,
      region: process.env.AWS_REGION ?? 'us-east-1',
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    }),
  );

  const items = buildRollupItems({ today, days, hourlyDays, qrRoute });
  for (let i = 0; i < items.length; i += 25) {
    const chunk = items.slice(i, i + 25);
    await client.send(
      new BatchWriteCommand({ RequestItems: { [table]: chunk.map((item) => ({ PutRequest: { Item: item } })) } }),
    );
  }
  return items.length;
}
