// The analytics time series.
//
// Two things are pinned here and both are honesty requirements rather than performance
// ones: the series says it came from rollups, and it says how it was measured. Per SKU tag
// encoding provides no per-tag counter, so NFC and QR are deduplicated identically and the
// dashboard must not imply a precision the hardware does not give.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { callOperation } from '../client.js';
import { config } from '../config.js';
import { LAUNCH_BLEND_SLUGS } from '../fixtures.js';

const needsViewer = config.tokens.viewer ? false : 'no viewer token configured';

describe('GET /v1/admin/analytics/scans', () => {
  it('returns a day series that states it came from rollups', { skip: needsViewer }, async () => {
    const result = await callOperation('adminGetScanTimeSeries', {
      role: 'viewer',
      query: { from: '2026-08-15', to: '2026-08-17', granularity: 'day' },
      expectStatus: 200,
    });
    assert.equal(result.body.source, 'rollup', 'Never a raw event query and never a table scan.');
    assert.equal(result.body.measurementMethod, 'browser_token');
    assert.ok(
      typeof result.body.measurementNote === 'string' && result.body.measurementNote.length > 0,
      'The dashboard renders the measurement note. Without it the counts imply a precision they do not have.',
    );
    assert.equal(result.body.granularity, 'day');
    assert.equal(result.body.from, '2026-08-15');
    assert.equal(result.body.to, '2026-08-17');
  });

  it('buckets a day series as YYYY-MM-DD', { skip: needsViewer }, async () => {
    const result = await callOperation('adminGetScanTimeSeries', {
      role: 'viewer',
      query: { from: '2026-08-15', to: '2026-08-17', granularity: 'day' },
      expectStatus: 200,
    });
    for (const point of result.body.points) {
      assert.match(point.bucket, /^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('buckets an hour series as YYYY-MM-DDTHH', { skip: needsViewer }, async () => {
    const result = await callOperation('adminGetScanTimeSeries', {
      role: 'viewer',
      query: { from: '2026-08-16', to: '2026-08-17', granularity: 'hour' },
      expectStatus: 200,
    });
    for (const point of result.body.points) {
      assert.match(point.bucket, /^\d{4}-\d{2}-\d{2}T\d{2}$/);
    }
  });

  it('restricts to one blend', { skip: needsViewer }, async () => {
    const result = await callOperation('adminGetScanTimeSeries', {
      role: 'viewer',
      query: { from: '2026-08-15', to: '2026-08-17', blend: LAUNCH_BLEND_SLUGS[0]! },
      expectStatus: 200,
    });
    assert.equal(result.body.blend, LAUNCH_BLEND_SLUGS[0]);
  });

  it('reports percentiles alongside the count and the sum', { skip: needsViewer }, async () => {
    const result = await callOperation('adminGetScanTimeSeries', {
      role: 'viewer',
      query: { from: '2026-08-15', to: '2026-08-17' },
      expectStatus: 200,
    });
    for (const point of result.body.points) {
      if (!point.timeToReadable) continue;
      assert.ok(
        Object.hasOwn(point.timeToReadable, 'count') && Object.hasOwn(point.timeToReadable, 'sumMs'),
        'A percentile derived from a mean is a fiction. The count and the sum have to be there too.',
      );
    }
  });

  it('rejects a request with no range', { skip: needsViewer }, async () => {
    const result = await callOperation('adminGetScanTimeSeries', {
      role: 'viewer',
      expectStatus: 400,
    });
    assert.equal(result.body.error.code, 'VALIDATION_FAILED');
  });

  it('rejects a range beyond 31 days at hour granularity', { skip: needsViewer }, async () => {
    const result = await callOperation('adminGetScanTimeSeries', {
      role: 'viewer',
      query: { from: '2026-01-01', to: '2026-08-17', granularity: 'hour' },
      expectStatus: 400,
    });
    assert.equal(result.body.error.code, 'VALIDATION_FAILED');
    assert.ok(Array.isArray(result.body.error.details));
  });

  it('rejects a range beyond 366 days at day granularity', { skip: needsViewer }, async () => {
    const result = await callOperation('adminGetScanTimeSeries', {
      role: 'viewer',
      query: { from: '2020-01-01', to: '2026-08-17', granularity: 'day' },
      expectStatus: 400,
    });
    assert.equal(result.body.error.code, 'VALIDATION_FAILED');
  });
});
