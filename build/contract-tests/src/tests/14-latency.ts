// The latency target, measured rather than assumed.
//
// READ THIS BEFORE QUOTING THE NUMBER THIS SUITE PRINTS.
//
// The <200 ms p95 target in SOW section 6.2 applies to content retrieval. It protects
// publish to live and the admin experience. It does NOT protect the 2.0 second tap budget,
// because the tap path does not call this API at all. On a tap the sequence is a 307 at the
// edge, cached HTML from the edge, paint, and only then a beacon. The pre-rendered page is
// what protects the tap budget.
//
// The two numbers sit near each other in SOW section 6.2 and get conflated, so the note is
// printed with every result rather than left in a document nobody opens.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { callOperation } from '../client.js';
import { config } from '../config.js';
import { LAUNCH_BLEND_SLUGS, scanEventBody } from '../fixtures.js';

function percentile(samples: number[], fraction: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[Math.max(0, index)]!;
}

async function measure(run: () => Promise<number>, samples: number, warmup: number): Promise<number[]> {
  for (let index = 0; index < warmup; index += 1) await run();
  const durations: number[] = [];
  for (let index = 0; index < samples; index += 1) durations.push(await run());
  return durations;
}

const NOTE = [
  'This figure protects publish to live and the admin experience, per section 6 of the',
  'frozen API contract. It does NOT protect the 2.0 second tap budget: the tap path does',
  'not call this API at all. The pre-rendered page served from the edge is what protects',
  'the tap budget.',
].join(' ');

describe('Latency', () => {
  it(`content retrieval p95 is under ${config.latency.budgetMs} ms`, async () => {
    const durations = await measure(
      async () => {
        const result = await callOperation('getBlendBySlug', {
          anonymous: true,
          pathParams: { slug: LAUNCH_BLEND_SLUGS[0]! },
          query: { include: 'grower,recipes' },
          expectStatus: 200,
        });
        return result.durationMs;
      },
      config.latency.samples,
      config.latency.warmup,
    );

    const p50 = percentile(durations, 0.5);
    const p95 = percentile(durations, 0.95);
    const max = Math.max(...durations);

    console.log('');
    console.log('      Content retrieval, GET /v1/blends/{slug}?include=grower,recipes');
    console.log(`      base URL   ${config.baseUrl}`);
    console.log(`      samples    ${durations.length} after ${config.latency.warmup} warmup calls`);
    console.log(`      p50        ${p50.toFixed(1)} ms`);
    console.log(`      p95        ${p95.toFixed(1)} ms   target under ${config.latency.budgetMs} ms`);
    console.log(`      max        ${max.toFixed(1)} ms`);
    console.log('');
    console.log(`      WHAT THIS NUMBER IS FOR: ${NOTE}`);
    console.log('');
    console.log(
      '      Measured from this client, so it includes client network time, which the contract',
    );
    console.log(
      '      excludes. It is therefore an upper bound on the server side figure: a p95 inside the',
    );
    console.log('      target here means the server side p95 is inside it too. The reverse does not follow.');
    console.log('');

    if (!config.latency.enforce) {
      console.log('      CONTRACT_TEST_LATENCY_ENFORCE is false, so this result is reported and not gated.');
      return;
    }

    assert.ok(
      p95 < config.latency.budgetMs,
      `Content retrieval p95 was ${p95.toFixed(1)} ms against a target of under ` +
        `${config.latency.budgetMs} ms. ${NOTE}`,
    );
  });

  it('reports the beacon write latency against its own separate target', async () => {
    const durations = await measure(
      async () => {
        const result = await callOperation('recordScanEvent', {
          anonymous: true,
          body: scanEventBody(),
          expectStatus: 202,
        });
        return result.durationMs;
      },
      Math.min(config.latency.samples, 20),
      2,
    );
    const p95 = percentile(durations, 0.95);
    console.log('');
    console.log('      Scan beacon, POST /v1/scan-events');
    console.log(`      p95        ${p95.toFixed(1)} ms   target under 100 ms, one conditional write`);
    console.log(
      '      The beacon fires after paint and cannot block anything, so this number is a cost',
    );
    console.log('      control rather than a user experience one.');
    console.log('');
    assert.ok(durations.length > 0);
  });
});
