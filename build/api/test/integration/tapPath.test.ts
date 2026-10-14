import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../src/db/client.js';
import { freezeClock, makeApp, resetAndSeed, unfreezeClock } from '../helpers/harness.js';

/**
 * Tap path discipline, asserted rather than described.
 *
 * The Data model document says pattern 5 is exactly one conditional write with zero reads.
 * That is the sort of claim that stays true for six weeks and then quietly stops being
 * true when somebody adds a lookup "just to validate the blend exists". This test counts
 * the DynamoDB calls the beacon actually makes, so the day that happens it fails here.
 */

let app: FastifyInstance;
const calls: Array<Record<string, unknown>> = [];

const body = {
  blendSlug: 'persian-sunrise',
  tagCode: 'ps',
  channel: 'nfc',
  dedupToken: '7a2c41a7b6e04d8fa3c5d17e8b0f6a24',
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

beforeAll(async () => {
  // Pinned so the duplicate below is genuinely a duplicate. On the real clock the two
  // writes could straddle a 30 minute deduplication window boundary and land on different
  // keys, which would still pass here but for the wrong reason.
  freezeClock();
  await resetAndSeed();
  app = await makeApp();
  db().middlewareStack.add(
    (next) => async (args) => {
      calls.push(args.input as Record<string, unknown>);
      return next(args);
    },
    { step: 'initialize', name: 'countDynamoCalls' },
  );
});

afterAll(async () => {
  await app.close();
  unfreezeClock();
});

describe('the scan beacon', () => {
  it('makes exactly one DynamoDB call, and it is the conditional write', async () => {
    calls.length = 0;
    const res = await app.inject({ method: 'POST', url: '/v1/scan-events', payload: body });
    expect(res.statusCode).toBe(202);

    expect(calls).toHaveLength(1);
    const call = calls[0] as { Item?: Record<string, unknown>; ConditionExpression?: string; Key?: unknown };
    expect(call.Item).toBeDefined();
    // Deduplication is the condition on the write itself. A read-then-write would double
    // the cost, double the latency and still race.
    expect(call.ConditionExpression).toBe('attribute_not_exists(pk)');
    expect(call.Key).toBeUndefined();
  });

  it('still makes exactly one call when the write is a duplicate', async () => {
    await app.inject({ method: 'POST', url: '/v1/scan-events', payload: body });
    calls.length = 0;
    const res = await app.inject({ method: 'POST', url: '/v1/scan-events', payload: body });
    expect(res.statusCode).toBe(202);
    expect(calls).toHaveLength(1);
  });

  it('makes no DynamoDB call at all when the body is rejected', async () => {
    calls.length = 0;
    const res = await app.inject({ method: 'POST', url: '/v1/scan-events', payload: { ...body, blendSlug: 'not-a-blend' } });
    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe('content retrieval latency', () => {
  /**
   * The <200 ms p95 target from SOW section 6.2, measured server side.
   *
   * READ THIS BEFORE QUOTING THE NUMBER. This figure protects publish-to-live and the
   * admin experience. It is NOT what protects the 2.0 second tap budget: the tap path does
   * not call this API at all, because the blend page is pre-rendered and served from the
   * edge cache. The two numbers sit near each other in SOW section 6.2 and get conflated.
   *
   * This run measures the handler and an in process DynamoDB, not AWS. It is a regression
   * guard on the shape of the work the handler does, not a substitute for measuring against
   * the real account, which happens once access lands.
   */
  it('serves the full build time payload well inside the target locally', async () => {
    const samples: number[] = [];
    for (let i = 0; i < 60; i += 1) {
      const started = process.hrtime.bigint();
      const res = await app.inject({ method: 'GET', url: '/v1/blends/persian-sunrise?include=grower,recipes' });
      samples.push(Number(process.hrtime.bigint() - started) / 1e6);
      expect(res.statusCode).toBe(200);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)] as number;
    const p50 = samples[Math.floor(samples.length * 0.5)] as number;
    // Printed rather than only asserted, so a run leaves a number behind in the log the way
    // the formal gate runs do.
    process.stdout.write(`content retrieval, in process: p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms
`);
    expect(p95).toBeLessThan(200);
  });

  it('answers a conditional request without rebuilding the payload', async () => {
    const first = await app.inject({ method: 'GET', url: '/v1/blends/persian-sunrise' });
    calls.length = 0;
    const second = await app.inject({
      method: 'GET',
      url: '/v1/blends/persian-sunrise',
      headers: { 'if-none-match': first.headers['etag'] as string },
    });
    expect(second.statusCode).toBe(304);
    // One GetItem to read the version, and nothing else: no recipes query, no grower read,
    // no media batch get.
    expect(calls).toHaveLength(1);
  });
});
