import test from 'node:test';
import assert from 'node:assert/strict';

import { csvFilename, geographyToCsv, seriesToCsv } from '../../public/lib/csv.js';
import { PRESETS, presetRange, selectionFromQuery, selectionToQuery, validateSelection } from '../../public/lib/state.js';
import { mergeGeography } from '../../public/lib/derive.js';
import { populatedSeries, emptySeries } from '../helpers/fixtures.mjs';

test('an exported row carries the measurement method with it, on every row', () => {
  const csv = seriesToCsv(populatedSeries());
  const lines = csv.split('\r\n');
  assert.equal(lines.length, 4);
  assert.match(lines[0], /measurement_method,source,measurement_note$/);
  for (const line of lines.slice(1)) {
    assert.ok(line.includes('browser_token'), 'the method travels with the number');
    assert.ok(line.includes('rollup'));
    assert.ok(line.includes('Neither is a count of jars'));
  }
});

test('a field containing a comma or a quote is escaped so the file does not shear', () => {
  const csv = geographyToCsv(
    [
      { country: 'US', region: 'MA', city: 'Boston, Suffolk', scans: 12 },
      { country: 'GB', region: 'ENG', city: 'Stoke "on" Trent', scans: 3 },
    ],
    populatedSeries(),
  );
  const lines = csv.split('\r\n');
  assert.ok(lines[1].includes('"Boston, Suffolk"'));
  assert.ok(lines[2].includes('"Stoke ""on"" Trent"'));
  assert.equal(lines.length, 3, 'an embedded comma did not add a row');
});

test('an empty series exports a header and no rows rather than failing', () => {
  assert.equal(seriesToCsv(emptySeries()), seriesToCsv(emptySeries()).split('\r\n')[0]);
});

test('places export with country region and city, and nothing finer', () => {
  const geography = mergeGeography([populatedSeries()]);
  const csv = geographyToCsv(geography.places, populatedSeries());
  assert.match(csv.split('\r\n')[0], /^country,region,city,counted_scans,measurement_method,measurement_note$/);
  assert.equal(csv.includes('latitude'), false);
  assert.equal(csv.includes('ip'), false);
});

test('the file name says what the file is, so a spreadsheet on a desktop is still identifiable', () => {
  assert.equal(
    csvFilename({ blend: 'persian-sunrise', from: '2026-08-01', to: '2026-08-17', granularity: 'day' }),
    'trevean-scans-persian-sunrise-2026-08-01-to-2026-08-17-by-day.csv',
  );
  assert.match(csvFilename({ blend: null, from: '2026-08-01', to: '2026-08-17', granularity: 'day' }), /all-blends/);
});

test('presets produce inclusive windows of the length they promise', () => {
  const last7 = presetRange(PRESETS[0], '2026-08-22');
  assert.deepEqual(last7, { from: '2026-08-16', to: '2026-08-22', granularity: 'day' });
  const last90 = presetRange(PRESETS[2], '2026-08-22');
  assert.equal(last90.from, '2026-05-25');
});

test('the hourly preset stays inside the contract limit', () => {
  const hourly = presetRange(PRESETS[3], '2026-08-22');
  assert.equal(hourly.granularity, 'hour');
  assert.equal(validateSelection({ ...hourly }).ok, true);
});

test('an illegal window is refused with a reason rather than silently downgraded', () => {
  const result = validateSelection({ from: '2026-01-01', to: '2026-08-01', granularity: 'hour' });
  assert.equal(result.ok, false);
  assert.match(result.reason, /Switch to day granularity/);
  assert.equal(validateSelection({ from: '2026-08-02', to: '2026-08-01', granularity: 'day' }).ok, false);
});

test('a selection survives a round trip through the address bar so a view can be shared', () => {
  const selection = { from: '2026-08-01', to: '2026-08-17', granularity: 'hour', blend: 'silk-road' };
  const query = selectionToQuery(selection);
  assert.deepEqual(selectionFromQuery(query, selection), selection);
});

test('a malformed address bar falls back rather than sending nonsense to the API', () => {
  const fallback = { from: '2026-08-01', to: '2026-08-17', granularity: 'day', blend: null };
  const parsed = selectionFromQuery('?from=yesterday&granularity=fortnight', fallback);
  assert.equal(parsed.from, '2026-08-01');
  assert.equal(parsed.granularity, 'day');
  assert.equal(parsed.blend, null);
});
