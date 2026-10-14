import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../../src/config/env.js';
import { db } from '../../src/db/client.js';
import { freezeClock, makeApp, resetAndSeed, unfreezeClock } from '../helpers/harness.js';

/**
 * The tap path endpoint.
 *
 * These tests exist to pin four properties that are easy to lose in a refactor and
 * expensive to lose in production:
 *
 *   1. one conditional write, no read in front of it
 *   2. a duplicate is a 202, indistinguishable from a first write
 *   3. it is callable by navigator.sendBeacon, which cannot set headers
 *   4. no IP address is stored, and geography comes from CDN viewer headers only
 *
 * Server time is pinned to TEST_NOW for this file. The write derives its partition key,
 * its deduplication window and its TTL from server time, so on the real clock the fixture
 * timestamps below eventually fall outside the 24 hour skew allowance, get bucketed
 * against server time instead, and collapse into one window. See the harness.
 */

let app: FastifyInstance;

const body = {
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

async function rawEvents(): Promise<Array<Record<string, unknown>>> {
  const out = await db().send(new ScanCommand({ TableName: config.tables.scanEvents }));
  return (out.Items ?? []).filter((i) => String(i['pk']).startsWith('EVT#'));
}

beforeAll(async () => {
  freezeClock();
  await resetAndSeed();
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
  unfreezeClock();
});

describe('POST /v1/scan-events', () => {
  it('accepts a tap with 202, an empty body and no-store', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/scan-events', payload: body });
    expect(res.statusCode).toBe(202);
    expect(res.body).toBe('');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-request-id']).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('returns 202 for a duplicate and stores exactly one row', async () => {
    const first = await app.inject({ method: 'POST', url: '/v1/scan-events', payload: body });
    const second = await app.inject({ method: 'POST', url: '/v1/scan-events', payload: body });
    const third = await app.inject({ method: 'POST', url: '/v1/scan-events', payload: body });
    expect([first.statusCode, second.statusCode, third.statusCode]).toEqual([202, 202, 202]);
    // The client cannot tell a duplicate from a first write, and must not try.
    expect(first.body).toBe(second.body);
    const events = await rawEvents();
    expect(events.filter((e) => e['dedupToken'] === body.dedupToken)).toHaveLength(1);
  });

  it('counts a different browser on the same jar separately', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/scan-events',
      payload: { ...body, dedupToken: 'aa2c41a7b6e04d8fa3c5d17e8b0f6a24' },
    });
    const events = await rawEvents();
    expect(events.filter((e) => e['blendSlug'] === 'persian-sunrise').length).toBeGreaterThanOrEqual(2);
  });

  it('counts the same browser again in the next 30 minute window', async () => {
    const token = 'bb2c41a7b6e04d8fa3c5d17e8b0f6a24';
    await app.inject({ method: 'POST', url: '/v1/scan-events', payload: { ...body, dedupToken: token, occurredAt: '2026-08-17T09:05:00Z' } });
    await app.inject({ method: 'POST', url: '/v1/scan-events', payload: { ...body, dedupToken: token, occurredAt: '2026-08-17T09:20:00Z' } });
    await app.inject({ method: 'POST', url: '/v1/scan-events', payload: { ...body, dedupToken: token, occurredAt: '2026-08-17T09:40:00Z' } });
    const events = (await rawEvents()).filter((e) => e['dedupToken'] === token);
    expect(events).toHaveLength(2);
  });

  it('is callable the way navigator.sendBeacon actually calls it', async () => {
    // sendBeacon cannot set headers. Depending on what the page hands it the body arrives
    // as text/plain, as application/json, or with no useful type at all.
    for (const contentType of ['text/plain;charset=UTF-8', 'application/json', 'application/octet-stream']) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/scan-events',
        headers: { 'content-type': contentType },
        payload: JSON.stringify({ ...body, dedupToken: `cc${contentType.length}c41a7b6e04d8fa3c5d17e8b0f6a24`.slice(0, 32) }),
      });
      expect(res.statusCode).toBe(202);
    }
  });

  it('needs no credential and no cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/scan-events',
      payload: { ...body, dedupToken: 'dd2c41a7b6e04d8fa3c5d17e8b0f6a24' },
    });
    expect(res.statusCode).toBe(202);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('records geography from CDN viewer headers and stores no IP address', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/scan-events',
      headers: {
        'cloudfront-viewer-country': 'US',
        'cloudfront-viewer-country-region': 'MA',
        'cloudfront-viewer-city': 'Boston',
        'x-forwarded-for': '203.0.113.7',
        'cloudfront-viewer-address': '203.0.113.7:52734',
      },
      payload: { ...body, dedupToken: 'ee2c41a7b6e04d8fa3c5d17e8b0f6a24' },
    });
    const event = (await rawEvents()).find((e) => e['dedupToken'] === 'ee2c41a7b6e04d8fa3c5d17e8b0f6a24');
    expect(event?.['geoCountry']).toBe('US');
    expect(event?.['geoRegion']).toBe('MA');
    expect(event?.['geoCity']).toBe('Boston');
    const serialised = JSON.stringify(event);
    expect(serialised).not.toContain('203.0.113.7');
    for (const forbidden of ['ip', 'clientIp', 'sourceIp', 'userAgent', 'email']) {
      expect(Object.keys(event ?? {})).not.toContain(forbidden);
    }
  });

  it('records an Origin mismatch rather than trusting or rejecting it', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/scan-events',
      headers: { origin: 'https://not-trevean.example' },
      payload: { ...body, dedupToken: 'ff2c41a7b6e04d8fa3c5d17e8b0f6a24' },
    });
    const event = (await rawEvents()).find((e) => e['dedupToken'] === 'ff2c41a7b6e04d8fa3c5d17e8b0f6a24');
    expect(event).toBeDefined();
    expect(event?.['originAllowed']).toBe(false);
  });

  it('sets a TTL on every raw event', async () => {
    const events = await rawEvents();
    expect(events.length).toBeGreaterThan(0);

    // The canonical row, anchored on the fixture timestamp rather than on anything the row
    // itself reports back. Exact rather than a tolerance: with server time pinned there is
    // no drift left to absorb, and the tolerance this replaces was two days wide, which is
    // wide enough to hide a retention error of nearly two days.
    const canonical = events.find((e) => e['dedupToken'] === body.dedupToken);
    expect(canonical).toBeDefined();
    expect(canonical?.['expiresAt']).toBe(
      Math.floor(Date.parse(body.occurredAt) / 1000) + config.scan.rawRetentionDays * 86400,
    );

    // And then every row, including the ones earlier tests in this file wrote with their
    // own timestamps: retention runs from the instant the row was actually bucketed
    // against, which is what a TTL sweep will use.
    for (const event of events) {
      expect(typeof event['expiresAt']).toBe('number');
      expect(event['expiresAt']).toBe(
        Math.floor(Date.parse(String(event['effectiveAt'])) / 1000) + config.scan.rawRetentionDays * 86400,
      );
    }
  });

  it('rejects a malformed body with 400 and the error envelope', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/scan-events', payload: { ...body, blendSlug: 'not-a-blend' } });
    expect(res.statusCode).toBe(400);
    const json = res.json() as { error: { code: string; details: Array<{ field: string; issue: string }> } };
    expect(json.error.code).toBe('VALIDATION_FAILED');
    expect(json.error.details).toContainEqual({ field: 'blendSlug', issue: 'not_in_enum' });
  });

  /**
   * Erratum E14. pageVersion carried minimum 1 and no maximum, and 1e308 is an integer as
   * far as JSON Schema is concerned, so the value passed validation and only failed at the
   * stored attribute. That is a 500 from an unauthenticated endpoint on the tap path.
   *
   * The bound is declared in the frozen document, so these assertions are on the contract
   * rather than on a hand written guard in this handler. They are written as raw payload
   * strings because JSON.stringify(1e308) is what a hostile caller actually sends, and
   * 1e999 parses to Infinity, which the old integer check also let through.
   */
  it('rejects a pageVersion above the declared maximum with 400 rather than 500', async () => {
    const over = [
      ['1e308', '1e308'],
      ['Infinity via 1e999', '1e999'],
      ['above the safe integer range', '9007199254740993'],
      ['one past the declared maximum', '2147483648'],
    ] as const;
    for (const [label, literal] of over) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/scan-events',
        headers: { 'content-type': 'application/json' },
        payload: `{"blendSlug":"persian-sunrise","tagCode":"ps","channel":"nfc","dedupToken":"a02c41a7b6e04d8fa3c5d17e8b0f6a24","occurredAt":"2026-08-17T09:41:07Z","pageVersion":${literal}}`,
      });
      expect(res.statusCode, label).toBe(400);
      const json = res.json() as { error: { code: string; details: Array<{ field: string; issue: string }> } };
      expect(json.error.code, label).toBe('VALIDATION_FAILED');
      expect(json.error.details, label).toContainEqual({ field: 'pageVersion', issue: 'out_of_range' });
    }
  });

  it('still accepts the largest legitimate pageVersion', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/scan-events',
      headers: { 'content-type': 'application/json' },
      payload: `{"blendSlug":"persian-sunrise","tagCode":"ps","channel":"nfc","dedupToken":"a12c41a7b6e04d8fa3c5d17e8b0f6a24","occurredAt":"2026-08-17T09:41:07Z","pageVersion":2147483647}`,
    });
    expect(res.statusCode).toBe(202);
  });

  it('rejects an attempt to smuggle a customer identifier into the beacon', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/scan-events',
      payload: { ...body, email: 'someone@example.com', latitude: 42.3601 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects malformed JSON without pretending it succeeded', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/scan-events',
      headers: { 'content-type': 'application/json' },
      payload: '{"blendSlug": ',
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('MALFORMED_JSON');
  });

  it('shards raw events across partitions rather than writing to one hot key', async () => {
    for (const prefix of ['1', '4', '8', 'c']) {
      await app.inject({
        method: 'POST',
        url: '/v1/scan-events',
        payload: { ...body, dedupToken: `${prefix}12c41a7b6e04d8fa3c5d17e8b0f6a24`.slice(0, 32) },
      });
    }
    const partitions = new Set((await rawEvents()).map((e) => String(e['pk'])));
    expect(partitions.size).toBeGreaterThan(1);
    for (const pk of partitions) expect(pk).toMatch(/^EVT#[a-z-]+#\d{4}-\d{2}-\d{2}#[0-9a-f]$/);
  });
});
