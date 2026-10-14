import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ApiError, MAX_DAYS, OPERATIONS, listBlendsUrl, scanTimeSeriesUrl } from '../../public/lib/api.js';

const here = dirname(fileURLToPath(import.meta.url));
const FROZEN_CONTRACT = resolve(here, '../../../../deliverables/m1/01-api-contract.openapi.yaml');
const API_COPY = resolve(here, '../../../api/openapi/openapi.yaml');

const contract = readFileSync(FROZEN_CONTRACT, 'utf8');

test('the API package carries a byte identical copy of the frozen contract', () => {
  const hashOf = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
  assert.equal(hashOf(API_COPY), hashOf(FROZEN_CONTRACT));
});

test('every endpoint this dashboard calls exists in the frozen contract', () => {
  for (const operation of Object.values(OPERATIONS)) {
    assert.ok(contract.includes(`\n  ${operation.path}:`), `${operation.path} is not a path in the frozen contract`);
  }
});

test('the dashboard calls exactly two operations and invents none', () => {
  assert.deepEqual(Object.keys(OPERATIONS).sort(), ['listBlends', 'scanTimeSeries']);
  assert.equal(OPERATIONS.scanTimeSeries.path, '/v1/admin/analytics/scans');
  assert.equal(OPERATIONS.listBlends.path, '/v1/admin/blends');
});

test('the range limits match the ones the contract states', () => {
  assert.equal(MAX_DAYS.day, 366);
  assert.equal(MAX_DAYS.hour, 31);
  assert.ok(contract.includes('Maximum range is 366 days at day granularity and 31 days at hour granularity.'));
});

test('the time series URL carries only parameters the contract declares', () => {
  const url = scanTimeSeriesUrl({ from: '2026-08-01', to: '2026-08-17', granularity: 'day', blend: 'persian-sunrise' });
  assert.equal(url, '/v1/admin/analytics/scans?from=2026-08-01&to=2026-08-17&granularity=day&blend=persian-sunrise');
  const parameters = [...new URL(url, 'http://x').searchParams.keys()];
  for (const name of parameters) {
    assert.ok(['from', 'to', 'granularity', 'blend'].includes(name), `${name} is not a contract parameter`);
  }
});

test('the all blends series omits the blend parameter rather than sending an empty one', () => {
  const url = scanTimeSeriesUrl({ from: '2026-08-01', to: '2026-08-17', granularity: 'day', blend: null });
  assert.equal(url.includes('blend='), false);
});

test('a base URL is prefixed without mangling the path', () => {
  const url = scanTimeSeriesUrl({ from: '2026-08-01', to: '2026-08-01' }, 'http://127.0.0.1:3001');
  assert.ok(url.startsWith('http://127.0.0.1:3001/v1/admin/analytics/scans?'));
  assert.equal(listBlendsUrl('http://127.0.0.1:3001'), 'http://127.0.0.1:3001/v1/admin/blends?limit=25');
});

test('an over long window is refused here, with a sentence, rather than sent and rejected', () => {
  assert.throws(
    () => scanTimeSeriesUrl({ from: '2026-01-01', to: '2026-08-01', granularity: 'hour' }),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.match(error.message, /31 at hour granularity/);
      assert.match(error.message, /Switch to day granularity/);
      return true;
    },
  );
  assert.throws(() => scanTimeSeriesUrl({ from: '2025-01-01', to: '2026-08-01', granularity: 'day' }), /366/);
});

test('a reversed or malformed window is refused', () => {
  assert.throws(() => scanTimeSeriesUrl({ from: '2026-08-17', to: '2026-08-01' }), /before its start/);
  assert.throws(() => scanTimeSeriesUrl({ from: 'last tuesday', to: '2026-08-01' }), /YYYY-MM-DD/);
  assert.throws(() => scanTimeSeriesUrl({ from: '2026-08-01', to: '2026-08-02', granularity: 'week' }), /day or hour/);
});

test('the maximum legal window is accepted at both granularities', () => {
  assert.ok(scanTimeSeriesUrl({ from: '2026-08-01', to: '2026-08-31', granularity: 'hour' }));
  assert.ok(scanTimeSeriesUrl({ from: '2025-08-01', to: '2026-08-01', granularity: 'day' }));
});
