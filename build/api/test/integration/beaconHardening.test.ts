import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { config } from '../../src/config/env.js';
import { db } from '../../src/db/client.js';
import { freezeClock, makeApp, resetAndSeed, unfreezeClock, TEST_NOW } from '../helpers/harness.js';

/**
 * The wiring, not the pure functions. test/unit/beaconHardening.test.ts proves the rules;
 * this file proves the one unauthenticated write actually applies them, because a correct
 * helper that nothing calls is the shape of two of the defects it closes.
 */

let app: FastifyInstance;

const body = {
  blendSlug: 'persian-sunrise',
  tagCode: 'ps',
  channel: 'nfc',
  dedupToken: '9f2c41a7b6e04d8fa3c5d17e8b0f6a24',
  occurredAt: TEST_NOW,
  platform: 'ios',
  connectionType: '4g',
  cacheStatus: 'hit',
};

beforeAll(async () => {
  freezeClock();
  app = await makeApp();
  await resetAndSeed();
});

afterAll(async () => {
  await app.close();
  unfreezeClock();
});

async function eventFor(dedupToken: string): Promise<Record<string, unknown> | undefined> {
  const out = await db().send(new ScanCommand({ TableName: config.tables.scanEvents }));
  return (out.Items ?? []).find(
    (item) => String(item['pk']).startsWith('EVT#') && item['dedupToken'] === dedupToken,
  ) as Record<string, unknown> | undefined;
}

describe('the beacon stores no free text in deviceFamily', () => {
  it('accepts the tap and drops a value outside the documented pattern', async () => {
    const dedupToken = 'a92c41a7b6e04d8fa3c5d17e8b0f6a24';
    const res = await app.inject({
      method: 'POST',
      url: '/v1/scan-events',
      headers: { 'content-type': 'application/json' },
      payload: { ...body, dedupToken, deviceFamily: 'a" OR attribute_exists(pk) OR "' },
    });
    // 202, not 400. Contract section 8.3 says a free text field is "rejected or dropped
    // server side", and a 400 on the tap path for a field nothing reads is the wrong trade.
    expect(res.statusCode).toBe(202);
    expect((await eventFor(dedupToken))?.['deviceFamily']).toBeNull();
  });

  it('still stores a coarse family unchanged', async () => {
    const dedupToken = 'b92c41a7b6e04d8fa3c5d17e8b0f6a24';
    await app.inject({
      method: 'POST',
      url: '/v1/scan-events',
      headers: { 'content-type': 'application/json' },
      payload: { ...body, dedupToken, deviceFamily: 'iPhone' },
    });
    expect((await eventFor(dedupToken))?.['deviceFamily']).toBe('iPhone');
  });
});

describe('the beacon stores no injected geography', () => {
  it('drops a region carrying the rollup key separator and an oversized city', async () => {
    const dedupToken = 'c92c41a7b6e04d8fa3c5d17e8b0f6a24';
    const res = await app.inject({
      method: 'POST',
      url: '/v1/scan-events',
      headers: {
        'content-type': 'application/json',
        'cloudfront-viewer-country': 'us',
        'cloudfront-viewer-country-region': 'NY#SPOOF#x',
        'cloudfront-viewer-city': 'Z'.repeat(200),
      },
      payload: { ...body, dedupToken },
    });
    expect(res.statusCode).toBe(202);
    const event = await eventFor(dedupToken);
    expect(event?.['geoCountry']).toBe('US');
    expect(event?.['geoRegion']).toBeNull();
    expect(event?.['geoCity']).toBeNull();
    // The stored row can never shift a rollup sort key, whatever the caller sent.
    expect(JSON.stringify(event)).not.toContain('SPOOF');
  });
});
