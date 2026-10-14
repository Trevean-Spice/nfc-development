/**
 * The test this deliverable exists to be able to pass.
 *
 * It runs the real API from build/api, against a real DynamoDB compatible database, with a
 * recording proxy in between, and then performs a full dashboard load exactly as the
 * browser does. Every database operation the load caused is then inspected.
 *
 * The claim being tested is not "nobody wrote the word Scan in this package". It is that a
 * complete dashboard load, through code this package does not own, issued only bounded
 * queries against rollup partitions. A scan introduced three layers down would fail here.
 */

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { startStack } from '../../tools/lib/stack.mjs';
import { loadDashboard, fetchScanTimeSeries } from '../../public/lib/api.js';
import { renderDashboard } from '../../public/lib/render.js';
import { summarise } from '../../public/lib/derive.js';
import { addDays } from '../../public/lib/format.js';

const TODAY = '2026-08-22';
const SCAN_EVENTS_TABLE = 'ScanEvents';

let stack;
let config;

before(async () => {
  stack = await startStack({ today: TODAY, days: 90, hourlyDays: 3, qrRoute: 'distinct', quiet: true });
  config = { baseUrl: stack.apiBaseUrl, token: stack.viewerToken };
});

after(async () => {
  if (stack) await stack.stop();
});

function scanEventsOperations() {
  return stack.proxy.all().filter((operation) => operation.table === SCAN_EVENTS_TABLE);
}

test('the local stack seeds enough rollup data to make every panel meaningful', () => {
  assert.ok(stack.rollupCount > 500, `only ${stack.rollupCount} rollup items were seeded`);
});

test('a full dashboard load issues no Scan against any table', async () => {
  stack.proxy.reset();
  await loadDashboard({ from: addDays(TODAY, -29), to: TODAY, granularity: 'day', blend: null }, config);
  const operations = stack.proxy.all();
  assert.ok(operations.length > 0, 'the load reached the database at all');
  const scans = operations.filter((operation) => operation.operation === 'Scan');
  assert.deepEqual(scans, [], `a dashboard load issued ${scans.length} Scan operations`);
});

test('every read of the scan events table is a Query on one rollup partition', async () => {
  stack.proxy.reset();
  await loadDashboard({ from: addDays(TODAY, -29), to: TODAY, granularity: 'day', blend: null }, config);
  const operations = scanEventsOperations();
  assert.ok(operations.length > 0, 'the scan events table was read');
  for (const operation of operations) {
    assert.equal(operation.operation, 'Query', `unexpected ${operation.operation} on ${SCAN_EVENTS_TABLE}`);
    assert.equal(operation.keyCondition, 'pk = :p AND sk BETWEEN :from AND :to');
    assert.equal(operation.filterExpression, null, 'a filter on a read path is a scan wearing a hat');
    assert.equal(operation.indexName, null, 'rollups are read from the base table, not an index');
    assert.ok(operation.values[':p'].startsWith('ROLLUP#'), `partition ${operation.values[':p']} is not a rollup partition`);
    assert.equal(operation.values[':p'].startsWith('EVT#'), false, 'a raw event partition was read');
    assert.ok(typeof operation.values[':from'] === 'string' && operation.values[':from'].length > 0);
    assert.ok(typeof operation.values[':to'] === 'string' && operation.values[':to'].length > 0);
  }
});

test('no dashboard path reads a raw scan event partition, on any selection', async () => {
  const selections = [
    { from: addDays(TODAY, -6), to: TODAY, granularity: 'day', blend: null },
    { from: addDays(TODAY, -29), to: TODAY, granularity: 'day', blend: 'persian-sunrise' },
    { from: addDays(TODAY, -89), to: TODAY, granularity: 'day', blend: 'caribbean-sunset' },
    { from: addDays(TODAY, -1), to: TODAY, granularity: 'hour', blend: null },
    { from: addDays(TODAY, -1), to: TODAY, granularity: 'hour', blend: 'silk-road' },
    { from: addDays(TODAY, -29), to: TODAY, granularity: 'day', blend: 'kyoto-garden' },
  ];
  for (const selection of selections) {
    stack.proxy.reset();
    await loadDashboard(selection, config);
    const partitions = scanEventsOperations().map((operation) => operation.values[':p']);
    assert.ok(partitions.length > 0);
    for (const partition of partitions) {
      assert.ok(partition.startsWith('ROLLUP#'), `${JSON.stringify(selection)} read ${partition}`);
    }
    assert.deepEqual(stack.proxy.named('Scan'), []);
  }
});

test('the cost of a load is a function of the days requested, not the scans recorded', async () => {
  stack.proxy.reset();
  await loadDashboard({ from: addDays(TODAY, -6), to: TODAY, granularity: 'day', blend: 'persian-sunrise' }, config);
  const shortWindow = scanEventsOperations().length;

  stack.proxy.reset();
  await loadDashboard({ from: addDays(TODAY, -89), to: TODAY, granularity: 'day', blend: 'persian-sunrise' }, config);
  const longWindow = scanEventsOperations().length;

  // Thirteen times the days, and the same number of round trips. That is the property the
  // rollup design exists to give, and it is the difference between a dashboard that is
  // still fast at ten million scans and one that gets slower every month.
  assert.equal(shortWindow, longWindow, `${shortWindow} queries for 7 days, ${longWindow} for 90`);
});

test('the number of queries for the all blends view is bounded by the blend count', async () => {
  stack.proxy.reset();
  await loadDashboard({ from: addDays(TODAY, -29), to: TODAY, granularity: 'day', blend: null }, config);
  const operations = scanEventsOperations().length;
  // One headline series, plus one series and one geography query per blend for the fan out.
  assert.ok(operations <= 12, `${operations} queries for the all blends view`);
});

test('the response says it came from the rollups and how it was measured, every time', async () => {
  const series = await fetchScanTimeSeries(
    { from: addDays(TODAY, -29), to: TODAY, granularity: 'day', blend: 'persian-sunrise' },
    config,
  );
  assert.equal(series.source, 'rollup');
  assert.equal(series.measurementMethod, 'browser_token');
  assert.match(series.measurementNote, /no per-tag counter/);
  assert.match(series.measurementNote, /neither is a per-jar count/);
});

test('a real load renders a page with real numbers on it', async () => {
  const selection = { from: addDays(TODAY, -29), to: TODAY, granularity: 'day', blend: null };
  const payload = await loadDashboard(selection, config);
  const summary = summarise(payload.series);
  assert.ok(summary.totals.scans > 200, `only ${summary.totals.scans} scans in the seeded window`);
  assert.ok(summary.totals.byChannel.qr > 0);
  assert.ok(summary.totals.byChannel.direct > 0);
  assert.ok(summary.totals.recipeOpens > 0);
  assert.ok(summary.totals.reorderClicks > 0);

  const html = renderDashboard({ ...payload, selection });
  assert.match(html, /Scan volume over time/);
  assert.match(html, /NFC and QR split/);
  assert.match(html, /Platform breakdown/);
  assert.match(html, /Where scans happened/);
  assert.match(html, /Content engagement and reorder clicks/);
  assert.match(html, /Neither is a count of jars/);
  assert.equal(html.includes('NaN'), false);
  assert.equal(html.includes('undefined'), false);
});

test('city level geography arrives from the rollups and carries no coordinates', async () => {
  const payload = await loadDashboard(
    { from: addDays(TODAY, -29), to: TODAY, granularity: 'day', blend: 'persian-sunrise' },
    config,
  );
  const cities = payload.series.points.flatMap((point) => point.topCities ?? []);
  assert.ok(cities.length > 0, 'no places came back');
  for (const city of cities) {
    assert.deepEqual(Object.keys(city).sort(), ['city', 'country', 'region', 'scans']);
    assert.match(city.country, /^[A-Z]{2}$/);
  }
});

test('a blend with no data renders the empty state rather than a broken page', async () => {
  const selection = { from: addDays(TODAY, -29), to: TODAY, granularity: 'day', blend: 'kyoto-garden' };
  const payload = await loadDashboard(selection, config);
  assert.equal(summarise(payload.series).totals.scans, 0);
  const html = renderDashboard({ ...payload, selection });
  assert.match(html, /No scans recorded in this window/);
  assert.match(html, /expected result/);
  assert.equal(html.includes('NaN'), false);
});

test('the hourly view reads the hourly partition and covers the whole final day', async () => {
  stack.proxy.reset();
  const series = await fetchScanTimeSeries({ from: TODAY, to: TODAY, granularity: 'hour', blend: 'persian-sunrise' }, config);
  const operation = scanEventsOperations()[0];
  assert.equal(operation.values[':p'], 'ROLLUP#BLEND#persian-sunrise#HOUR');
  assert.equal(operation.values[':from'], `${TODAY}T00`);
  assert.equal(operation.values[':to'], `${TODAY}T23`);
  assert.ok(series.points.length > 0);
  for (const point of series.points) assert.match(point.bucket, /^\d{4}-\d{2}-\d{2}T\d{2}$/);
});

test('the endpoint refuses a caller with no credential', async () => {
  const response = await fetch(`${stack.apiBaseUrl}/v1/admin/analytics/scans?from=${TODAY}&to=${TODAY}`);
  assert.equal(response.status, 401);
});

test('a Viewer credential is enough, which is what makes this self serve', async () => {
  const response = await fetch(`${stack.apiBaseUrl}/v1/admin/analytics/scans?from=${TODAY}&to=${TODAY}&granularity=day`, {
    headers: { authorization: `Bearer ${stack.viewerToken}` },
  });
  assert.equal(response.status, 200);
});

test('an over long window is refused by the API as well as by this package', async () => {
  const response = await fetch(
    `${stack.apiBaseUrl}/v1/admin/analytics/scans?from=2026-01-01&to=2026-08-01&granularity=hour`,
    { headers: { authorization: `Bearer ${stack.viewerToken}` } },
  );
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, 'VALIDATION_FAILED');
});
