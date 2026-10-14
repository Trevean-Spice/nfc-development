/**
 * Every key this API writes or reads, in one file, as pure functions.
 *
 * The key namespaces come from the Data model document. Two of them are load bearing:
 *
 *   EVT#{blendSlug}#{YYYY-MM-DD}#{shard}   raw scan events, sharded on the first hex
 *                                          character of the dedup token so five blends do
 *                                          not produce five write hot partitions per day
 *   ROLLUP#...                             pre-aggregated counters the dashboard reads
 *
 * Both live in ScanEvents, which is why the stream consumer filter matters so much: the
 * rollup writes land in the same stream that triggers them. See stream/filter.ts.
 */

export const KEY_PREFIX = {
  blend: 'BLEND#',
  catalog: 'CATALOG#',
  media: 'MEDIA#',
  idempotency: 'IDEM#',
  revalidation: 'REVAL#',
  event: 'EVT#',
  rollup: 'ROLLUP#',
  checkpoint: 'CKPT#',
} as const;

/** The live editorial record's sort key. Published snapshots use PUB#{version}. */
export const LIVE_SK = 'v0';

export const blendPk = (slug: string): string => `${KEY_PREFIX.blend}${slug}`;
export const blendSnapshotSk = (version: number): string => `PUB#${String(version).padStart(6, '0')}`;
export const catalogPk = (slug: string): string => `${KEY_PREFIX.catalog}${slug}`;
export const mediaPk = (mediaId: string): string => `${KEY_PREFIX.media}${mediaId}`;
export const idempotencyPk = (subject: string, key: string): string => `${KEY_PREFIX.idempotency}${subject}#${key}`;
export const revalidationPk = (revalidationId: string): string => `${KEY_PREFIX.revalidation}${revalidationId}`;

/** Raw scan event partition key. Data model document, section 3.5. */
export const eventPk = (blendSlug: string, day: string, shard: string): string =>
  `${KEY_PREFIX.event}${blendSlug}#${day}#${shard}`;

/** Raw scan event sort key: dedup token then deduplication window. */
export const eventSk = (dedupToken: string, windowId: number): string => `${dedupToken}#${windowId}`;

/** Rollup partition keys. Data model document, section 5.2. */
export const rollupBlendDayPk = (slug: string): string => `${KEY_PREFIX.rollup}BLEND#${slug}#DAY`;
export const rollupBlendHourPk = (slug: string): string => `${KEY_PREFIX.rollup}BLEND#${slug}#HOUR`;
export const rollupAllDayPk = (): string => `${KEY_PREFIX.rollup}ALL#DAY`;
/**
 * ROLLUP#ALL#HOUR is not in the Data model document's table, which lists per blend hourly
 * and all blends daily but not all blends hourly. The analytics endpoint accepts
 * granularity=hour with no blend filter, so the row has to exist for that request to be
 * answerable without summing five series or reading raw events. Same namespace, same
 * consumer, no new table. Flagged in the delivery summary.
 */
export const rollupAllHourPk = (): string => `${KEY_PREFIX.rollup}ALL#HOUR`;
export const rollupGeoDayPk = (slug: string): string => `${KEY_PREFIX.rollup}BLEND#${slug}#GEO#DAY`;

/** Geography sort key: day, then country, region and city only. No IP, ever. */
export const rollupGeoSk = (day: string, country: string, region: string | null, city: string | null): string =>
  `${day}#${country}#${region ?? '-'}#${city ?? '-'}`;

export function parseGeoSk(sk: string): { day: string; country: string; region: string | null; city: string | null } | undefined {
  const parts = sk.split('#');
  if (parts.length < 4) return undefined;
  const [day, country, region, ...rest] = parts;
  const city = rest.join('#');
  if (!day || !country) return undefined;
  return {
    day,
    country,
    region: region === '-' || region === undefined ? null : region,
    city: city === '-' || city === '' ? null : city,
  };
}

/** Stream consumer batch checkpoint, written into ScanEvents under its own namespace. */
export const checkpointPk = (streamArnOrName: string, batchId: string): string =>
  `${KEY_PREFIX.checkpoint}${streamArnOrName}#${batchId}`;

/** Recipes sort key: zero padded sortOrder then recipeId, so string order is carousel order. */
export const recipeSk = (sortOrder: number, recipeId: string): string =>
  `${String(Math.max(0, Math.trunc(sortOrder))).padStart(4, '0')}#${recipeId}`;

export const ENTITY = {
  blend: 'BLEND',
  catalog: 'CATALOG',
  media: 'MEDIA',
  grower: 'GROWER',
} as const;
