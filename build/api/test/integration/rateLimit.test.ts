import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

/**
 * The in process rate limiter, with RATE_LIMIT_ENABLED forced on for this file only.
 *
 * Configuration is read once at module load, so this file must set the environment variable
 * before any src module is imported and must therefore import everything dynamically. A
 * static import would load config with the limiter off and prove nothing.
 *
 * What this file exists to stop coming back, measured against the code as it was:
 *
 *   Admin subject limited after 301 requests (limit is 300)
 *   a DIFFERENT authenticated subject on the same URL -> 429
 *   beacon limited after 61 requests, globally, for every customer at once
 */

process.env.RATE_LIMIT_ENABLED = 'true';

let app: FastifyInstance;
let mintToken: (roles: Array<'Viewer' | 'Editor' | 'Admin'>, options?: { subject?: string }) => Promise<string>;

beforeAll(async () => {
  const harness = await import('../helpers/harness.js');
  harness.freezeClock();
  app = await harness.makeApp();
  await harness.resetAndSeed();
  mintToken = harness.token;

  const { config } = await import('../../src/config/env.js');
  // If this is false the rest of the file asserts nothing, so it is asserted rather than
  // assumed. The limiter is off by default and that default is deliberate.
  expect(config.rateLimit.enabled).toBe(true);
});

afterAll(async () => {
  await app.close();
  const harness = await import('../helpers/harness.js');
  harness.unfreezeClock();
});

describe('one caller cannot spend another caller budget', () => {
  it('limits the credential that is spending and leaves a different credential alone', async () => {
    // POST /v1/admin/media/uploads is 60 per minute per subject, contract section 9, and a
    // Viewer is refused by the route guard, so each request is a cheap 403 that still
    // passes through the limiter first.
    const spender = await mintToken(['Viewer'], { subject: 'user_spender' });
    const bystander = await mintToken(['Viewer'], { subject: 'user_bystander' });

    let limitedAfter = 0;
    for (let i = 1; i <= 80; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/admin/media/uploads',
        headers: { authorization: `Bearer ${spender}`, 'content-type': 'application/json' },
        payload: {},
      });
      if (res.statusCode === 429) {
        limitedAfter = i;
        break;
      }
      expect(res.statusCode).toBe(403);
    }
    expect(limitedAfter).toBe(61);

    const other = await app.inject({
      method: 'POST',
      url: '/v1/admin/media/uploads',
      headers: { authorization: `Bearer ${bystander}`, 'content-type': 'application/json' },
      payload: {},
    });
    expect(other.statusCode).not.toBe(429);
    expect(other.statusCode).toBe(403);
  });
});

describe('the beacon has no global bucket, because a global bucket is a global outage', () => {
  /**
   * POST /v1/scan-events is the only endpoint on the tap path. It is unauthenticated by
   * necessity, and the only key that would make an in process counter per source is a
   * source address, which the Architecture document forbids storing. So one noisy client
   * blowing a shared 60 per minute bucket silenced real scans for every customer at once,
   * and the scan count is the number the acceptance criteria are measured with.
   *
   * Contract section 9 puts the beacon's 60 per minute per source IP at the edge, where the
   * CDN can key on an address the API never sees.
   */
  it('answers 202 to far more beacons than the old shared bucket allowed', async () => {
    const attempts = 100;
    const statuses = new Set<number>();
    for (let i = 1; i <= attempts; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/scan-events',
        headers: { 'content-type': 'application/json' },
        payload: {
          blendSlug: 'persian-sunrise',
          channel: 'nfc',
          dedupToken: `c0ffee${String(i).padStart(26, '0')}`,
          occurredAt: '2026-08-17T09:41:07Z',
        },
      });
      statuses.add(res.statusCode);
    }
    expect([...statuses]).toEqual([202]);
  });
});
