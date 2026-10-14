import { describe, expect, it } from 'vitest';
import { limitClassFor, rateLimitKey, LIMITS } from '../../src/http/rateLimit.js';
import { arrivedThroughCdn, geoFromHeaders, placeName, type GeoTrustSettings } from '../../src/services/geo.js';
import { boundedDeviceFamily } from '../../src/routes/scanEvents.js';
import { aggregate } from '../../src/stream/consumer.js';

/**
 * The four defects in this file were all reported CONFIRMED and left unfixed by the
 * adversarial review of Saturday 22 August, and all four were reproduced again before any
 * of them was touched. Each test here fails against the code as it was.
 */

function request(headers: Record<string, string>, url: string): { headers: Record<string, string>; url: string } {
  return { headers, url };
}

describe('the rate limiter counts per credential, and counts nothing without one', () => {
  /**
   * The limiter was registered as an onRequest hook reading request.principal, which is set
   * by requireRole, a route level preHandler. onRequest always runs first, so the subject
   * was undefined on every request and the key was always 'anonymous'. Observed with
   * RATE_LIMIT_ENABLED forced on: one subject limited after 301 requests, a DIFFERENT
   * authenticated subject on the same URL 429, and the beacon limited after 61 requests
   * globally for every customer at once.
   */
  it('gives two different credentials two different buckets', () => {
    const a = rateLimitKey(request({ authorization: 'Bearer token-for-subject-a' }, '/v1/admin/blends') as never);
    const b = rateLimitKey(request({ authorization: 'Bearer token-for-subject-b' }, '/v1/admin/blends') as never);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a).not.toBe(b);
  });

  it('gives one credential one bucket across the whole admin surface, not one per route', () => {
    const auth = { authorization: 'Bearer token-for-subject-a' };
    expect(rateLimitKey(request(auth, '/v1/admin/blends') as never)).toBe(
      rateLimitKey(request(auth, '/v1/admin/growers/gr_01?include=blends') as never),
    );
    // The media upload budget is its own line in contract section 9, so it is its own bucket.
    expect(rateLimitKey(request(auth, '/v1/admin/media/uploads') as never)).not.toBe(
      rateLimitKey(request(auth, '/v1/admin/blends') as never),
    );
  });

  it('never puts the credential itself in the key', () => {
    const key = rateLimitKey(request({ authorization: 'Bearer supersecrettokenvalue' }, '/v1/admin/blends') as never);
    expect(key).not.toContain('supersecrettokenvalue');
  });

  /**
   * The load bearing one. POST /v1/scan-events is the only endpoint on the tap path and is
   * unauthenticated by necessity, so it has no key that is not a source address, and the
   * Architecture document forbids storing one. A shared bucket is therefore not a rate limit
   * but a fuse the whole internet shares, and blowing it silences the measurement the
   * acceptance criteria are counted from.
   */
  it('has no in process bucket at all for a request with no credential', () => {
    expect(rateLimitKey(request({}, '/v1/scan-events') as never)).toBeUndefined();
    expect(rateLimitKey(request({}, '/v1/blends/persian-sunrise') as never)).toBeUndefined();
    expect(rateLimitKey(request({ authorization: 'Basic dXNlcjpwYXNz' }, '/v1/scan-events') as never)).toBeUndefined();
  });

  it('still classifies every path against the contract section 9 limits', () => {
    expect(LIMITS[limitClassFor('/v1/scan-events')]).toBe(60);
    expect(LIMITS[limitClassFor('/v1/admin/media/uploads')]).toBe(60);
    expect(LIMITS[limitClassFor('/v1/admin/blends')]).toBe(300);
    expect(LIMITS[limitClassFor('/v1/blends?status=published')]).toBe(600);
  });
});

describe('CDN geography is only believed when the request came through the CDN', () => {
  const localNoHeader: GeoTrustSettings = { stage: 'local', geoTrustedHeader: undefined };
  const productionNoHeader: GeoTrustSettings = { stage: 'production', geoTrustedHeader: undefined };
  const withTrustHeader: GeoTrustSettings = {
    stage: 'production',
    geoTrustedHeader: { name: 'x-trevean-edge', value: 'edge-shared-value' },
  };

  const spoof = {
    'cloudfront-viewer-country': 'us',
    'cloudfront-viewer-country-region': 'NY#SPOOF#x',
    'cloudfront-viewer-city': 'Z'.repeat(200),
  };

  it('drops geography entirely on a request that shows no evidence of the CDN', () => {
    expect(arrivedThroughCdn(spoof, productionNoHeader)).toBe(false);
    expect(geoFromHeaders(spoof, productionNoHeader)).toEqual({ country: null, region: null, city: null });
    expect(geoFromHeaders(spoof, withTrustHeader)).toEqual({ country: null, region: null, city: null });
  });

  it('reads geography on a request carrying the CDN origin custom header', () => {
    const headers = {
      'x-trevean-edge': 'edge-shared-value',
      'cloudfront-viewer-country': 'us',
      'cloudfront-viewer-country-region': 'MA',
      'cloudfront-viewer-city': 'Boston',
    };
    expect(arrivedThroughCdn(headers, withTrustHeader)).toBe(true);
    expect(geoFromHeaders(headers, withTrustHeader)).toEqual({ country: 'US', region: 'MA', city: 'Boston' });
  });

  /**
   * '#' is the separator in rollupGeoSk. A region containing one shifted every later
   * component, so parseGeoSk read region 'NY' and city 'SPOOF#x#<real city>' and the
   * dashboard displayed a place name an unauthenticated caller wrote. Observed stored
   * region before the fix: 'NY#SPOOF#x'.
   */
  it('drops a geography value that is not a plausible place name, rather than repairing it', () => {
    const geo = geoFromHeaders(spoof, localNoHeader);
    expect(geo.country).toBe('US');
    expect(geo.region).toBeNull();
    expect(geo.city).toBeNull();
    expect(placeName('NY#SPOOF#x', 64)).toBeNull();
    expect(placeName('<script>', 64)).toBeNull();
    expect(placeName('Z'.repeat(200), 64)).toBeNull();
  });

  it('keeps every real place name it is asked to keep', () => {
    for (const name of ['Boston', 'New York', 'São Paulo', 'Stoke-on-Trent', "St. John's", 'Washington, D.C.', 'Ile-de-France']) {
      expect(placeName(name, 64), name).toBe(name);
    }
    // Region codes are letters or digits depending on the country.
    expect(placeName('MA', 64)).toBe('MA');
    expect(placeName('13', 64)).toBe('13');
  });
});

describe('deviceFamily is bounded to the documented pattern, contract section 5.2', () => {
  /**
   * The beacon "accepts no free text": every field is an enum, a bounded string matching a
   * documented pattern, or a number in a documented range. deviceFamily was maxLength 40
   * with no pattern. Observed stored verbatim from an unauthenticated caller before the
   * fix: 'iPhone EVIL', 'iPhone\nINJECTED', 'a" OR attribute_exists(pk) OR "' and an emoji.
   */
  it('keeps a coarse family and drops anything that is not one', () => {
    for (const good of ['iPhone', 'Pixel', 'Galaxy S23', 'unknown', 'iPad_Pro', 'Moto-G.5']) {
      expect(boundedDeviceFamily(good), good).toBe(good);
    }
    for (const bad of ['iPhone\nINJECTED', 'a" OR attribute_exists(pk) OR "', 'iPhone\u{1F4A9}', '<img src=x>', '', 'x'.repeat(41)]) {
      expect(boundedDeviceFamily(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(boundedDeviceFamily(null)).toBeNull();
    expect(boundedDeviceFamily(undefined)).toBeNull();
  });
});

describe('originAllowed reaches a consumer', () => {
  /**
   * Contract section 5.2 lists the Origin check as one of the five things protecting the
   * unauthenticated beacon in place of a credential. It was written correctly to every raw
   * event and then read by nothing: not by aggregate(), not by services/analytics.ts. A
   * computed value nothing acts on reads as enforcement and is not.
   */
  /**
   * The consumer joins its in memory rollup key with a literal U+0000, which is invisible in
   * an editor and is why grep reports consumer.ts as binary. Named here rather than pasted,
   * so this file survives any tooling that normalises whitespace.
   */
  const NUL = String.fromCharCode(0);

  const image = (originAllowed: boolean) => ({
    blendSlug: 'persian-sunrise',
    channel: 'nfc',
    platform: 'ios',
    pk: 'EVT#persian-sunrise#2026-08-17#a',
    originAllowed,
  });

  it('counts a scan from an unexpected origin into the rollup it lands in', () => {
    const rollups = aggregate([image(false), image(false), image(true)]);
    const day = rollups.get(`ROLLUP#BLEND#persian-sunrise#DAY${NUL}2026-08-17`);
    expect(day?.['scans']).toBe(3);
    expect(day?.['origin_unexpected']).toBe(2);
    const all = rollups.get(`ROLLUP#ALL#DAY${NUL}2026-08-17`);
    expect(all?.['origin_unexpected']).toBe(2);
  });

  it('writes no counter at all when every scan came from an expected origin', () => {
    const rollups = aggregate([image(true), image(true)]);
    const day = rollups.get(`ROLLUP#BLEND#persian-sunrise#DAY${NUL}2026-08-17`);
    expect(day?.['scans']).toBe(2);
    expect(day?.['origin_unexpected']).toBeUndefined();
  });
});
