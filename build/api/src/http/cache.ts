import { createHash } from 'node:crypto';

/**
 * Cache headers, API contract section 7.
 *
 * Worth stating where the code can see it: the <200 ms p95 target these headers support is
 * NOT what protects the 2.0 second tap budget. The pre-rendered page protects the tap
 * budget. Content endpoints are called at build and revalidate time, tens of times a day,
 * so this cache protects publish-to-live and the admin experience. See the API contract,
 * section 6, and the Architecture document, "The tap path".
 */

export const CACHE_PUBLIC_CONTENT = 'public, max-age=60, stale-while-revalidate=300';
export const CACHE_PUBLIC_CATALOG = 'public, max-age=60, stale-while-revalidate=600';
export const CACHE_NO_STORE = 'no-store';
export const CACHE_ADMIN = 'private, no-store';

/**
 * ETag in the shape the frozen document's example uses: "W/{version}-{epochSeconds}".
 * The W/ sits inside the quotes in the contract example rather than outside, which is not
 * how RFC 9110 writes a weak validator. It is reproduced exactly as specified because the
 * contract is frozen and a build caller comparing strings does not care.
 */
export function entityTag(version: number, updatedAt: string): string {
  const seconds = Math.floor(new Date(updatedAt).getTime() / 1000);
  return `"W/${version}-${Number.isFinite(seconds) ? seconds : 0}"`;
}

/** For collections, where there is no single version to hang an ETag on. */
export function collectionTag(payload: unknown): string {
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('base64url').slice(0, 22);
  return `"W/c-${hash}"`;
}

/** True when the caller's If-None-Match matches, so the response can be a 304. */
export function ifNoneMatchSatisfied(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header
    .split(',')
    .map((s) => s.trim())
    .some((candidate) => candidate === etag || candidate === '*');
}
