import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../../src/config/env.js';
import { db } from '../../src/db/client.js';
import { handleStreamEvent, type StreamRecord } from '../../src/stream/consumer.js';
import { matchesSchema } from '../../src/http/validation.js';
import { authHeader, freezeClock, makeApp, resetAndSeed, unfreezeClock } from '../helpers/harness.js';

/**
 * The rollup path, end to end and then deliberately abused.
 *
 * Beacons are posted through the real endpoint, the rows they wrote are turned into the
 * stream records DynamoDB would deliver, the consumer runs, and the dashboard endpoint is
 * asked for the numbers. Then the rows the consumer itself wrote are fed back into it as
 * the stream would, which is the case that is an infinite self-billing loop without the
 * event source mapping filter.
 *
 * Server time is pinned to TEST_NOW for this file. Every date below is a fixed fixture
 * date, and the rollup keys the consumer writes are derived from server time, so without
 * the pin this file starts failing the day the real clock drifts more than the skew
 * allowance away from 17 August. See the harness for the full reasoning.
 */

let app: FastifyInstance;

function beacon(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
    ...overrides,
  };
}

async function itemsWithPrefix(prefix: string): Promise<Array<Record<string, unknown>>> {
  const out = await db().send(new ScanCommand({ TableName: config.tables.scanEvents }));
  return (out.Items ?? []).filter((i) => String(i['pk']).startsWith(prefix));
}

/** Turns stored items into the stream records DynamoDB would deliver for them. */
function asStreamRecords(items: Array<Record<string, unknown>>, eventName: string): StreamRecord[] {
  return items.map((item, index) => ({
    eventID: `${eventName}-${index}-${String(item['pk'])}-${String(item['sk'])}`,
    eventName,
    dynamodb: {
      Keys: { pk: { S: String(item['pk']) }, sk: { S: String(item['sk']) } },
      NewImage: marshall(item, { removeUndefinedValues: true }) as unknown as Record<string, unknown>,
    },
  }));
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

describe('scan events to rollups to dashboard', () => {
  it('turns beacons into atomic rollup increments and a dashboard series', async () => {
    const geo = {
      'cloudfront-viewer-country': 'US',
      'cloudfront-viewer-country-region': 'MA',
      'cloudfront-viewer-city': 'Boston',
    };
    const posts = [
      beacon({ dedupToken: '01'.padEnd(32, 'a') }),
      beacon({ dedupToken: '02'.padEnd(32, 'b'), channel: 'qr', platform: 'android', deviceFamily: 'Pixel', timeToReadableMs: 1900 }),
      beacon({ dedupToken: '03'.padEnd(32, 'c'), channel: 'direct', platform: 'other', cacheStatus: 'miss', timeToReadableMs: 2400 }),
      beacon({ dedupToken: '04'.padEnd(32, 'd'), blendSlug: 'caribbean-sunset', tagCode: 'cs', timeToReadableMs: 900 }),
    ];
    for (const payload of posts) {
      const res = await app.inject({ method: 'POST', url: '/v1/scan-events', headers: geo, payload });
      expect(res.statusCode).toBe(202);
    }

    const raw = await itemsWithPrefix('EVT#');
    expect(raw).toHaveLength(4);

    const result = await handleStreamEvent({ Records: asStreamRecords(raw, 'INSERT') });
    expect(result.accepted).toBe(4);
    expect(result.rejected).toBe(0);
    // Four events across two blends collapse into a handful of writes, not one per event.
    expect(result.rollupWrites).toBeLessThanOrEqual(10);

    const auth = await authHeader(['Viewer']);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/analytics/scans?from=2026-08-17&to=2026-08-17&granularity=day&blend=persian-sunrise',
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    const series = res.json() as {
      source: string;
      measurementMethod: string;
      points: Array<{
        bucket: string;
        scans: number;
        byChannel: { nfc: number; qr: number; direct: number };
        byPlatform: { ios: number; android: number; other: number };
        cache: { hit: number; miss: number };
        timeToReadable: { count: number; sumMs: number; p50Ms: number | null; p95Ms: number | null };
        topCities: Array<{ country: string; region: string | null; city: string | null; scans: number }>;
      }>;
    };
    expect(series.source).toBe('rollup');
    expect(series.measurementMethod).toBe('browser_token');
    expect(matchesSchema('#/components/schemas/ScanTimeSeries', series).errors).toEqual([]);

    const point = series.points[0];
    expect(point?.bucket).toBe('2026-08-17');
    expect(point?.scans).toBe(3);
    expect(point?.byChannel).toEqual({ nfc: 1, qr: 1, direct: 1 });
    expect(point?.byPlatform).toEqual({ ios: 1, android: 1, other: 1 });
    expect(point?.cache).toEqual({ hit: 2, miss: 1, stale: 0 });
    expect(point?.timeToReadable.count).toBe(3);
    expect(point?.timeToReadable.sumMs).toBe(1120 + 1900 + 2400);
    expect(point?.timeToReadable.p95Ms).not.toBeNull();
    expect(point?.topCities?.[0]).toEqual({ country: 'US', region: 'MA', city: 'Boston', scans: 3 });

    const all = await app.inject({
      method: 'GET',
      url: '/v1/admin/analytics/scans?from=2026-08-17&to=2026-08-17',
      headers: auth,
    });
    const allSeries = all.json() as { blend: string | null; points: Array<{ scans: number }> };
    expect(allSeries.blend).toBeNull();
    expect(allSeries.points[0]?.scans).toBe(4);
  });

  it('does not double count a re-delivered batch', async () => {
    const raw = await itemsWithPrefix('EVT#');
    const records = asStreamRecords(raw, 'INSERT');
    const replay = await handleStreamEvent({ Records: records });
    expect(replay.skippedAsDuplicateBatch).toBe(true);
    expect(replay.rollupWrites).toBe(0);

    const auth = await authHeader(['Viewer']);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/analytics/scans?from=2026-08-17&to=2026-08-17&blend=persian-sunrise',
      headers: auth,
    });
    expect((res.json() as { points: Array<{ scans: number }> }).points[0]?.scans).toBe(3);
  });

  it('does not retrigger itself on the rollups it just wrote', async () => {
    // This is the loop. Rollup rows live in ScanEvents, so every increment the consumer
    // made appears in the same stream. Without the filter, the consumer would process its
    // own output, write more rollups, and be woken again, indefinitely and billably.
    const rollupRows = await itemsWithPrefix('ROLLUP#');
    expect(rollupRows.length).toBeGreaterThan(0);

    const asModify = await handleStreamEvent({ Records: asStreamRecords(rollupRows, 'MODIFY') });
    expect(asModify.accepted).toBe(0);
    expect(asModify.rollupWrites).toBe(0);
    expect(asModify.rejected).toBe(rollupRows.length);

    // And the harder half: the first rollup write of a new day arrives as INSERT, not
    // MODIFY, so filtering on the event name alone would not stop it.
    const asInsert = await handleStreamEvent({ Records: asStreamRecords(rollupRows, 'INSERT') });
    expect(asInsert.accepted).toBe(0);
    expect(asInsert.rollupWrites).toBe(0);

    // The checkpoint rows the consumer writes are in the same table and must not feed back
    // either.
    const checkpoints = await itemsWithPrefix('CKPT#');
    expect(checkpoints.length).toBeGreaterThan(0);
    const fromCheckpoints = await handleStreamEvent({ Records: asStreamRecords(checkpoints, 'INSERT') });
    expect(fromCheckpoints.accepted).toBe(0);

    // A TTL expiry of a raw event, which arrives as REMOVE, must not decrement anything.
    const rawRows = await itemsWithPrefix('EVT#');
    const fromTtl = await handleStreamEvent({ Records: asStreamRecords(rawRows, 'REMOVE') });
    expect(fromTtl.accepted).toBe(0);

    const auth = await authHeader(['Viewer']);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/analytics/scans?from=2026-08-17&to=2026-08-17&blend=persian-sunrise',
      headers: auth,
    });
    expect((res.json() as { points: Array<{ scans: number }> }).points[0]?.scans).toBe(3);
  });

  it('serves an hourly series from its own rollup rows', async () => {
    const auth = await authHeader(['Viewer']);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/analytics/scans?from=2026-08-17&to=2026-08-17&granularity=hour&blend=persian-sunrise',
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    const series = res.json() as { points: Array<{ bucket: string; scans: number }> };
    expect(series.points[0]?.bucket).toBe('2026-08-17T09');
    expect(series.points[0]?.scans).toBe(3);
  });

  it('refuses a range wider than the documented maximum', async () => {
    const auth = await authHeader(['Viewer']);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/analytics/scans?from=2026-01-01&to=2026-08-17&granularity=hour',
      headers: auth,
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { details: Array<{ field: string; issue: string }> } };
    expect(body.error.details).toContainEqual({ field: 'to', issue: 'range_too_large' });
  });
});
