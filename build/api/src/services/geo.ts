import { config } from '../config/env.js';

/**
 * Geography, derived server side from CDN viewer headers only.
 *
 * Country, region and city. Nothing finer, and no IP address is read, logged or stored.
 * The browser is never asked for location permission: a location prompt two seconds after
 * a customer touched a jar would be hostile, and it would also cost time inside a budget
 * that has none to spare. The privacy posture and the performance decision point the same
 * way, which is why there is no consent banner on this product at all.
 *
 * If the client sends geography in the body it is rejected by the request schema, which
 * sets additionalProperties false. There is no code path here that reads it.
 *
 * THE HEADERS ARE ONLY TRUE WHEN THE REQUEST CAME THROUGH THE CDN
 *
 * "Geography from CDN viewer headers" is correct for a request that genuinely arrived
 * through CloudFront. A request that reaches the origin directly carries whatever headers
 * its sender chose, and this API runs with trustProxy false and no allowlist of who may set
 * them. The beacon is unauthenticated by necessity, so "whoever asks" is the entire
 * internet. Two things were measured coming out of that:
 *
 *   1. ANALYTICS POISONING. '#' is the separator in rollupGeoSk, so a region containing it
 *      shifted every later component and wrote an arbitrary place name into the rollup the
 *      dashboard displays. Observed stored region: 'NY#SPOOF#x'.
 *   2. UNBOUNDED ROLLUP CARDINALITY. Every distinct country, region and city triple is its
 *      own rollup row, deliberately, to stay under the 400 KB item limit. With the city
 *      attacker controlled the number of rows per blend per day was bounded only by the
 *      caller's request budget. Observed stored city: 120 arbitrary characters.
 *
 * So there are two gates here, and they are separate on purpose.
 *
 * TRUST. Set GEO_TRUSTED_HEADER_NAME and GEO_TRUSTED_HEADER_VALUE to a CloudFront origin
 * custom header. CloudFront adds those to the origin request and a viewer cannot set them,
 * which is the only signal available that distinguishes "through the CDN" from "at the
 * origin". When the pair is configured, viewer geo headers are read only on a request that
 * carries it. When it is NOT configured, geography is read on stage local and is dropped
 * everywhere else, because outside local an unverified geography is an attacker's geography
 * and no geography is better than a poisoned one. This is a deployment configuration item:
 * until it is set, the dashboard's geography is empty rather than wrong.
 *
 * SHAPE. Even on a trusted request the values are sanitised, because the trust gate is a
 * deployment fact and this is code. A value that is not a plausible place name is dropped
 * rather than repaired, so nothing derived from a mangled value can reach a rollup key.
 */

export interface Geo {
  country: string | null;
  region: string | null;
  city: string | null;
}

export const EMPTY_GEO: Geo = { country: null, region: null, city: null };

/** Headers CloudFront attaches when the viewer geo headers behaviour is enabled. */
const COUNTRY_HEADERS = ['cloudfront-viewer-country', 'cf-ipcountry', 'x-vercel-ip-country'];
const REGION_HEADERS = ['cloudfront-viewer-country-region', 'x-vercel-ip-country-region'];
const CITY_HEADERS = ['cloudfront-viewer-city', 'x-vercel-ip-city'];

/**
 * Conservative, and conservative in the direction of dropping a real place rather than
 * accepting an invented one. Letters in any script with their combining marks, digits,
 * space, and the five punctuation marks that appear in real place names: apostrophe,
 * hyphen, full stop, comma and parentheses. Sao Paulo, Stoke-on-Trent, St. John's,
 * Washington, D.C. and Ile-de-France all survive it.
 *
 * '#' is excluded first and foremost, because it is the rollupGeoSk separator. So are the
 * NUL that the consumer joins its in memory key with, every other control character, and
 * every character that has ever been interesting to a downstream renderer.
 */
const PLACE_NAME = /^[\p{L}\p{M}\p{N} '’\-.,()]+$/u;

/** Shorter than the CloudFront maximums on purpose: no real region or city needs more. */
const MAX_REGION = 64;
const MAX_CITY = 64;

/**
 * decodeURIComponent throws URIError on a malformed escape such as a lone '%'. On the tap
 * path that is a 500 and a lost scan, so a value that does not decode is taken literally
 * rather than thrown on.
 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Control characters are stripped before the allowlist rather than rejected by it, which
 * keeps the original defence intact and visible: '%00' decodes to NUL, and NUL is the
 * separator the rollup consumer joins a partition key and a sort key with, so a NUL inside
 * a city name would split a rollup key in the wrong place.
 */
function stripControl(value: string): string {
  let out = '';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) out += character;
  }
  return out;
}

/**
 * A place name, or null. Never a partially repaired string: stripping the offending
 * characters out would turn 'NY#SPOOF#x' into 'NYSPOOFx', which is still a row in the
 * dashboard that nobody wrote.
 */
export function placeName(raw: string, maxLength: number): string | null {
  const value = stripControl(safeDecode(raw)).trim();
  if (value === '' || value.length > maxLength) return null;
  if (!PLACE_NAME.test(value)) return null;
  return value;
}

function pick(headers: Record<string, string | string[] | undefined>, names: string[]): string | undefined {
  for (const name of names) {
    const raw = headers[name];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return undefined;
}

/**
 * Whether this request carries the evidence that it came through the CDN. Never throws and
 * never reads an address header: the only thing it looks at is a header the CDN adds and a
 * viewer cannot.
 */
export interface GeoTrustSettings {
  stage: string;
  geoTrustedHeader: { name: string; value: string } | undefined;
}

function currentTrustSettings(): GeoTrustSettings {
  return { stage: config.stage, geoTrustedHeader: config.scan.geoTrustedHeader };
}

export function arrivedThroughCdn(
  headers: Record<string, string | string[] | undefined>,
  settings: GeoTrustSettings = currentTrustSettings(),
): boolean {
  const trusted = settings.geoTrustedHeader;
  if (!trusted) return settings.stage === 'local';
  const raw = headers[trusted.name.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === trusted.value;
}

export function geoFromHeaders(
  headers: Record<string, string | string[] | undefined>,
  settings: GeoTrustSettings = currentTrustSettings(),
): Geo {
  if (!arrivedThroughCdn(headers, settings)) return { ...EMPTY_GEO };

  const rawCountry = pick(headers, COUNTRY_HEADERS);
  const rawRegion = pick(headers, REGION_HEADERS);
  const rawCity = pick(headers, CITY_HEADERS);

  const country = rawCountry === undefined ? null : stripControl(safeDecode(rawCountry)).trim();
  return {
    country: country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null,
    region: rawRegion === undefined ? null : placeName(rawRegion, MAX_REGION),
    city: rawCity === undefined ? null : placeName(rawCity, MAX_CITY),
  };
}
