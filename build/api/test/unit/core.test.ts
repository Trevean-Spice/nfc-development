import { describe, expect, it } from 'vitest';
import { deriveScanBuckets, daysBetweenInclusive, isValidDateOnly, nowIso } from '../../src/util/time.js';
import { ulid, ULID_PATTERN } from '../../src/util/ulid.js';
import { newGrowerId, newMediaId, newRecipeId, newRevalidationId } from '../../src/util/ids.js';
import { entityTag, ifNoneMatchSatisfied } from '../../src/http/cache.js';
import { decodeCursor, encodeCursor, parseLimit } from '../../src/http/pagination.js';
import { highestRole, satisfies } from '../../src/auth/roles.js';
import { geoFromHeaders } from '../../src/services/geo.js';
import { __testing as loggerTesting } from '../../src/observability/logger.js';
import { computeHmacBase64, safeEqual, verifyShopifySignature } from '../../src/webhooks/signature.js';
import { percentileFromBuckets } from '../../src/services/analytics.js';
import { loadRedirectTable, validateRedirectTable, type RedirectTable } from '../../src/services/redirectTable.js';
import { eventPk, eventSk, recipeSk, rollupGeoSk, parseGeoSk } from '../../src/db/keys.js';
import { matchesSchema, validateBody } from '../../src/http/validation.js';
import { ApiError } from '../../src/http/errors.js';

describe('identifiers', () => {
  it('produces ULIDs matching the pattern the contract requires', () => {
    for (let i = 0; i < 200; i += 1) expect(ulid()).toMatch(ULID_PATTERN);
  });

  it('produces prefixed ids matching the OpenAPI patterns', () => {
    expect(newRecipeId()).toMatch(/^rcp_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(newGrowerId()).toMatch(/^grw_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(newMediaId()).toMatch(/^med_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(newRevalidationId()).toMatch(/^rvl_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('formats timestamps as RFC 3339 UTC with a Z suffix and no milliseconds', () => {
    expect(nowIso(Date.parse('2026-08-17T09:41:07.123Z'))).toBe('2026-08-17T09:41:07Z');
  });
});

describe('scan deduplication keys', () => {
  const token = '9f2c41a7b6e04d8fa3c5d17e8b0f6a24';

  it('is a pure function of the request body, so a re-delivered beacon lands on one key', () => {
    const a = deriveScanBuckets('2026-08-17T09:41:07Z', token, Date.parse('2026-08-17T09:41:08Z'));
    const b = deriveScanBuckets('2026-08-17T09:41:07Z', token, Date.parse('2026-08-17T09:44:00Z'));
    expect(eventSk(token, a.windowId)).toBe(eventSk(token, b.windowId));
    expect(eventPk('persian-sunrise', a.day, a.shard)).toBe(eventPk('persian-sunrise', b.day, b.shard));
  });

  it('shards on the first hex character of the token, giving 16 partitions per blend per day', () => {
    const shards = new Set(
      ['0', '3', '9', 'a', 'f'].map((c) => deriveScanBuckets('2026-08-17T09:41:07Z', `${c}${token.slice(1)}`).shard),
    );
    expect(shards).toEqual(new Set(['0', '3', '9', 'a', 'f']));
  });

  it('puts the same browser and jar in one 30 minute window and separates the next', () => {
    const first = deriveScanBuckets('2026-08-17T09:05:00Z', token, Date.parse('2026-08-17T09:05:00Z'));
    const same = deriveScanBuckets('2026-08-17T09:29:59Z', token, Date.parse('2026-08-17T09:29:59Z'));
    const next = deriveScanBuckets('2026-08-17T09:30:01Z', token, Date.parse('2026-08-17T09:30:01Z'));
    expect(same.windowId).toBe(first.windowId);
    expect(next.windowId).toBe(first.windowId + 1);
  });

  it('falls back to server time when the handset clock is more than a day out', () => {
    const skewed = deriveScanBuckets('2019-01-01T00:00:00Z', token, Date.parse('2026-08-17T09:41:07Z'));
    expect(skewed.clientClockTrusted).toBe(false);
    expect(skewed.day).toBe('2026-08-17');
  });
});

describe('keys', () => {
  it('pads recipe sort keys so string order is carousel order', () => {
    const ids = [
      recipeSk(10, 'rcp_B'),
      recipeSk(2, 'rcp_A'),
      recipeSk(1, 'rcp_C'),
    ].sort();
    expect(ids[0]).toContain('0001#');
    expect(ids[1]).toContain('0002#');
    expect(ids[2]).toContain('0010#');
  });

  it('round trips a geography sort key including a city with a space in it', () => {
    const sk = rollupGeoSk('2026-08-17', 'US', 'NY', 'New York');
    expect(parseGeoSk(sk)).toEqual({ day: '2026-08-17', country: 'US', region: 'NY', city: 'New York' });
    expect(parseGeoSk(rollupGeoSk('2026-08-17', 'US', null, null))).toEqual({
      day: '2026-08-17',
      country: 'US',
      region: null,
      city: null,
    });
  });
});

describe('caching', () => {
  it('emits the ETag shape the frozen document specifies', () => {
    expect(entityTag(12, '2026-08-17T09:41:07Z')).toMatch(/^"W\/12-\d+"$/);
  });

  it('matches If-None-Match on an exact value or a wildcard', () => {
    const tag = entityTag(12, '2026-08-17T09:41:07Z');
    expect(ifNoneMatchSatisfied(tag, tag)).toBe(true);
    expect(ifNoneMatchSatisfied(`"W/1-0", ${tag}`, tag)).toBe(true);
    expect(ifNoneMatchSatisfied('*', tag)).toBe(true);
    expect(ifNoneMatchSatisfied('"W/11-0"', tag)).toBe(false);
    expect(ifNoneMatchSatisfied(undefined, tag)).toBe(false);
  });
});

describe('pagination', () => {
  it('round trips an opaque cursor', () => {
    const key = { pk: 'BLEND#persian-sunrise', sk: 'v0' };
    const cursor = encodeCursor(key) as string;
    expect(cursor.length).toBeLessThanOrEqual(2048);
    expect(decodeCursor(cursor, true)).toEqual(key);
  });

  it('rejects a malformed cursor where 400 is documented and ignores it where it is not', () => {
    expect(() => decodeCursor('not-a-cursor', true)).toThrow(ApiError);
    expect(decodeCursor('not-a-cursor', false)).toBeUndefined();
  });

  it('defaults, bounds and clamps the limit', () => {
    expect(parseLimit(undefined, true)).toBe(25);
    expect(parseLimit('50', true)).toBe(50);
    expect(() => parseLimit('101', true)).toThrow(ApiError);
    expect(parseLimit('101', false)).toBe(100);
    expect(parseLimit('0', false)).toBe(1);
  });
});

describe('roles', () => {
  it('ranks Viewer below Editor below Admin', () => {
    expect(satisfies(['Viewer'], 'Editor')).toBe(false);
    expect(satisfies(['Editor'], 'Editor')).toBe(true);
    expect(satisfies(['Admin'], 'Editor')).toBe(true);
    expect(satisfies(['Editor'], 'Admin')).toBe(false);
    expect(highestRole(['Viewer', 'Editor'])).toBe('Editor');
  });
});

describe('geography', () => {
  it('reads country, region and city from CDN viewer headers only', () => {
    expect(
      geoFromHeaders({
        'cloudfront-viewer-country': 'us',
        'cloudfront-viewer-country-region': 'MA',
        'cloudfront-viewer-city': 'Boston',
      }),
    ).toEqual({ country: 'US', region: 'MA', city: 'Boston' });
  });

  it('returns nulls rather than inventing a location, and never reads an address header', () => {
    expect(geoFromHeaders({ 'x-forwarded-for': '203.0.113.7', 'cloudfront-viewer-address': '203.0.113.7:443' })).toEqual({
      country: null,
      region: null,
      city: null,
    });
  });

  it('decodes a percent encoded city without throwing on a malformed escape', () => {
    // A lone '%' makes decodeURIComponent throw URIError. This runs on the one
    // unauthenticated write in the system, so a throw here is a 500 and a lost scan.
    expect(geoFromHeaders({ 'cloudfront-viewer-city': 'S%C3%A3o%20Paulo' }).city).toBe('São Paulo');
    expect(() => geoFromHeaders({ 'cloudfront-viewer-city': '%' })).not.toThrow();
    // A value that does not decode is still taken literally rather than thrown on, which is
    // what this test is for. It is then dropped rather than stored, because a lone '%' is
    // not a place name and every geography value now has to look like one before it can
    // reach a rollup sort key. Was toBe('%').
    expect(geoFromHeaders({ 'cloudfront-viewer-city': '%' }).city).toBeNull();
    expect(() => geoFromHeaders({ 'cloudfront-viewer-country-region': '%E0%A4%A' })).not.toThrow();
  });

  it('strips control characters, because NUL is the rollup key separator', () => {
    // '%00' decodes to NUL, which is what the rollup consumer joins a partition key and a
    // sort key with. A NUL inside a city name would split a rollup key in the wrong place.
    const nul = String.fromCharCode(0);
    const geo = geoFromHeaders({ 'cloudfront-viewer-city': '%00EVIL' });
    expect(geo.city).toBe('EVIL');
    expect(geo.city).not.toContain(nul);
    expect(geoFromHeaders({ 'cloudfront-viewer-city': '%00' }).city).toBeNull();
    // A legitimate multi word city is untouched.
    expect(geoFromHeaders({ 'cloudfront-viewer-city': 'New York' }).city).toBe('New York');
  });
});

describe('logging redaction', () => {
  it('redacts every field that could carry an address or a person', () => {
    const redacted = loggerTesting.redact({
      requestId: '01J9Z8XK4M2Q7T5V3N8R1B6C0D',
      headers: { 'x-forwarded-for': '203.0.113.7', 'user-agent': 'Mozilla', authorization: 'Bearer x' },
      nested: { email: 'someone@example.com', ip: '203.0.113.7' },
      blendSlug: 'persian-sunrise',
    }) as Record<string, Record<string, string>>;
    expect(redacted['headers']?.['x-forwarded-for']).toBe('[redacted]');
    expect(redacted['headers']?.['user-agent']).toBe('[redacted]');
    expect(redacted['headers']?.['authorization']).toBe('[redacted]');
    expect(redacted['nested']?.['email']).toBe('[redacted]');
    expect(redacted['nested']?.['ip']).toBe('[redacted]');
    expect(redacted['blendSlug']).toBe('persian-sunrise');
  });
});

describe('webhook signatures', () => {
  const secret = 'shhh';
  const body = JSON.stringify({ id: 1, handle: 'persian-sunrise' });

  it('verifies a correct Shopify signature over the raw body', () => {
    expect(verifyShopifySignature(body, computeHmacBase64(body, secret), secret)).toBe(true);
  });

  it('rejects a tampered body, a wrong secret and a missing header', () => {
    const signature = computeHmacBase64(body, secret);
    expect(verifyShopifySignature(`${body} `, signature, secret)).toBe(false);
    expect(verifyShopifySignature(body, signature, 'wrong')).toBe(false);
    expect(verifyShopifySignature(body, undefined, secret)).toBe(false);
  });

  it('compares in constant time without throwing on a length mismatch', () => {
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('abc', 'abc')).toBe(true);
  });
});

describe('percentiles', () => {
  it('returns null with no observations rather than a fabricated number', () => {
    expect(percentileFromBuckets({ pk: 'x', sk: 'y' }, 0.95)).toBeNull();
  });

  it('reads the acceptance boundary straight off the histogram', () => {
    // 98 taps readable inside 2.0 s, 2 outside. p95 must land inside the 2000 ms boundary.
    const row = { pk: 'x', sk: 'y', ttr_b_1000_1500: 98, ttr_b_3000_plus: 2 };
    const p95 = percentileFromBuckets(row, 0.95) as number;
    expect(p95).toBeLessThan(2000);
    const p50 = percentileFromBuckets(row, 0.5) as number;
    expect(p50).toBeGreaterThanOrEqual(1000);
    expect(p50).toBeLessThanOrEqual(1500);
  });
});

describe('redirect table', () => {
  it('passes every CI check on the deployed file', () => {
    const table = loadRedirectTable();
    expect(validateRedirectTable(table)).toEqual([]);
    expect(table.entries).toHaveLength(5);
    expect(table.entries.filter((e) => e.status === 'encoded')).toHaveLength(4);
    expect(table.redirectStatus).toBe(307);
    // Answered Wednesday 19 August 2026 (decision log D18, closing Q4): SO4731 shipped with no
    // write protection, so the encoded rows carry false. The reserved kg row stays null, because
    // no tag exists in this run to have a protection state.
    // Locked, confirmed Friday 11 September 2026 against the physical stock and matching the
    // SO4731 instruction to the supplier. See build/edge/test/table.test.mjs for why this
    // outweighs the August answer it replaces.
    expect(table.entries.filter((e) => e.status === 'encoded').every((e) => e.writeProtected === true)).toBe(true);
    expect(table.entries.filter((e) => e.status !== 'encoded').every((e) => e.writeProtected === null)).toBe(true);
  });

  it('catches the two key typo that deploys green and opens the wrong blend on 250 jars', () => {
    const table = loadRedirectTable();
    const broken = JSON.parse(JSON.stringify(table)) as RedirectTable;
    (broken.entries[0] as { ndefUri: string }).ndefUri = 'https://treveanspice.com/t/pd';
    expect(validateRedirectTable(broken).join(' ')).toContain('does not end with its own code');
  });

  it('catches a repointed target path and a units total that no longer sums to 1,000', () => {
    const table = loadRedirectTable();
    const broken = JSON.parse(JSON.stringify(table)) as RedirectTable;
    (broken.entries[0] as { targetPath: string }).targetPath = '/blend.html?blend=silk-road&via=nfc';
    (broken.entries[1] as { unitsEncoded: number }).unitsEncoded = 240;
    const problems = validateRedirectTable(broken).join(' ');
    expect(problems).toContain('targetPath missing');
    expect(problems).toContain('Encoded units sum to 990');
  });

  it('serves an on-pack QR route for every code, reaching the same page as the tap', () => {
    // Without this the dashboard cannot produce the NFC versus QR split the Scope document,
    // "In scope", item 6 requires, because nothing in the system would ever emit via=qr.
    for (const entry of loadRedirectTable().entries) {
      expect(entry.qrRequestPath).toBe(`/q/${entry.code}`);
      expect(entry.qrUrl).toBe(`https://treveanspice.com/q/${entry.code}`);
      expect(entry.qrTargetPath).toBe(`/blend.html?blend=${entry.blendSlug}&via=qr`);
      expect(entry.qrTargetPath).toBe(entry.targetPath.replace('via=nfc', 'via=qr'));
    }
  });

  it('catches a QR target that reaches a different blend than the tap', () => {
    const broken = JSON.parse(JSON.stringify(loadRedirectTable())) as RedirectTable;
    (broken.entries[0] as { qrTargetPath: string }).qrTargetPath = '/blend.html?blend=silk-road&via=qr';
    expect(validateRedirectTable(broken).join(' ')).toContain('not the same destination');
  });

  it('catches a QR target still carrying via=nfc, which counts every scan as a tap', () => {
    const broken = JSON.parse(JSON.stringify(loadRedirectTable())) as RedirectTable;
    const first = broken.entries[0] as { qrTargetPath: string; targetPath: string };
    first.qrTargetPath = first.targetPath;
    expect(validateRedirectTable(broken).join(' ')).toContain('via=qr');
  });

  it('catches a qrUrl that would be printed pointing at another code', () => {
    const broken = JSON.parse(JSON.stringify(loadRedirectTable())) as RedirectTable;
    (broken.entries[0] as { qrUrl: string }).qrUrl = 'https://treveanspice.com/q/pd';
    expect(validateRedirectTable(broken).join(' ')).toContain('cannot be fixed after it is printed');
  });

  it('catches a 301, which would be cached permanently and strand inventory', () => {
    const broken = { ...loadRedirectTable(), redirectStatus: 301 };
    expect(validateRedirectTable(broken).join(' ')).toContain('expected 307');
  });
});

describe('request validation compiled from the frozen document', () => {
  const valid = {
    blendSlug: 'persian-sunrise',
    tagCode: 'ps',
    channel: 'nfc',
    dedupToken: '9f2c41a7b6e04d8fa3c5d17e8b0f6a24',
    occurredAt: '2026-08-17T09:41:07Z',
    platform: 'ios',
    deviceFamily: 'iPhone',
    connectionType: '4g',
    cacheStatus: 'hit',
    ttfbMs: 184,
    timeToReadableMs: 1120,
    pageVersion: 12,
    redirected: true,
  };

  it('accepts the worked example from the frozen document', () => {
    expect(validateBody('#/components/schemas/ScanEventInput', valid)).toEqual(valid);
  });

  it('rejects a blend slug outside the enum, with the issue the contract example uses', () => {
    try {
      validateBody('#/components/schemas/ScanEventInput', { ...valid, blendSlug: 'persian-sunrize' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(400);
      expect((err as ApiError).details).toContainEqual({ field: 'blendSlug', issue: 'not_in_enum' });
    }
  });

  it('rejects anything the beacon must never carry, because the schema is closed', () => {
    for (const extra of [
      { ip: '203.0.113.7' },
      { latitude: 42.36 },
      { email: 'someone@example.com' },
      { orderNumber: '1001' },
      { note: 'free text' },
    ]) {
      expect(() => validateBody('#/components/schemas/ScanEventInput', { ...valid, ...extra })).toThrow(ApiError);
    }
  });

  it('rejects a dedup token that is not 128 bits of hex', () => {
    expect(() => validateBody('#/components/schemas/ScanEventInput', { ...valid, dedupToken: 'short' })).toThrow(ApiError);
  });

  it('validates responses against the frozen schemas too', () => {
    expect(matchesSchema('#/components/schemas/ScanTimeSeries', {
      blend: 'persian-sunrise',
      granularity: 'day',
      from: '2026-08-15',
      to: '2026-08-17',
      measurementMethod: 'browser_token',
      measurementNote: 'note',
      source: 'rollup',
      points: [],
    }).valid).toBe(true);

    // source has exactly one permitted value, which is what makes "never a raw event read"
    // a contract test assertion rather than a convention.
    expect(matchesSchema('#/components/schemas/ScanTimeSeries', {
      granularity: 'day',
      from: '2026-08-15',
      to: '2026-08-17',
      measurementMethod: 'browser_token',
      source: 'raw',
      points: [],
    }).valid).toBe(false);
  });
});

describe('dates', () => {
  it('validates a date only string', () => {
    expect(isValidDateOnly('2026-08-17')).toBe(true);
    expect(isValidDateOnly('2026-02-30')).toBe(false);
    expect(isValidDateOnly('17-08-2026')).toBe(false);
  });

  it('counts an inclusive day span', () => {
    expect(daysBetweenInclusive('2026-08-17', '2026-08-17')).toBe(1);
    expect(daysBetweenInclusive('2026-08-01', '2026-08-31')).toBe(31);
  });
});
