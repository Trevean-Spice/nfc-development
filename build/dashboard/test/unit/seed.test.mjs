import test from 'node:test';
import assert from 'node:assert/strict';

import { BLENDS, allocate, buildRollupItems, dayCounters } from '../../tools/seed-rollups.mjs';

const TODAY = '2026-08-22';

test('integer allocation always sums to the whole, at every size', () => {
  for (const total of [0, 1, 2, 3, 7, 41, 118, 9999]) {
    const parts = allocate(total, [62, 33, 5]);
    assert.equal(parts.reduce((a, b) => a + b, 0), total, `total ${total}`);
    for (const part of parts) assert.ok(Number.isInteger(part) && part >= 0);
  }
});

test('allocation of nothing is nothing, not a division by zero', () => {
  assert.deepEqual(allocate(10, [0, 0, 0]), [0, 0, 0]);
  assert.deepEqual(allocate(-5, [1, 1]), [0, 0]);
});

test('one day of counters is internally consistent', () => {
  const counters = dayCounters({
    slug: 'persian-sunrise',
    day: '2026-08-20',
    dayIndex: 89,
    launchIndex: 44,
    baseScans: 62,
    qrRoute: 'distinct',
  });
  assert.ok(counters.scans > 0);
  assert.equal(counters.ch_nfc + counters.ch_qr + counters.ch_direct, counters.scans);
  assert.equal(counters.pf_ios + counters.pf_android + counters.pf_other, counters.scans);
  assert.equal(counters.cache_hit + counters.cache_miss + counters.cache_stale, counters.scans);
  assert.equal(counters.ttr_count, counters.scans);
  const buckets =
    counters.ttr_b_0_500 +
    counters.ttr_b_500_1000 +
    counters.ttr_b_1000_1500 +
    counters.ttr_b_1500_2000 +
    counters.ttr_b_2000_3000 +
    counters.ttr_b_3000_plus;
  assert.equal(buckets, counters.scans);
});

test('the not distinct QR world puts nothing on the QR channel and everything else in direct', () => {
  const counters = dayCounters({
    slug: 'persian-sunrise',
    day: '2026-08-20',
    dayIndex: 89,
    launchIndex: 44,
    baseScans: 62,
    qrRoute: 'not-distinct',
  });
  assert.equal(counters.ch_qr, 0);
  assert.ok(counters.ch_direct > counters.scans * 0.3);
  assert.equal(counters.ch_nfc + counters.ch_direct, counters.scans);
});

test('the seeder writes rollup items only, and never a raw event', () => {
  const items = buildRollupItems({ today: TODAY, days: 30, hourlyDays: 2 });
  assert.ok(items.length > 100);
  for (const item of items) {
    assert.ok(item.pk.startsWith('ROLLUP#'), `unexpected partition key ${item.pk}`);
    assert.equal(item.pk.startsWith('EVT#'), false);
  }
});

test('the all blends rows are the sum of the per blend rows, day by day', () => {
  const items = buildRollupItems({ today: TODAY, days: 30, hourlyDays: 0 });
  const allDays = new Map(items.filter((item) => item.pk === 'ROLLUP#ALL#DAY').map((item) => [item.sk, item]));
  const perDay = new Map();
  for (const item of items) {
    if (!/^ROLLUP#BLEND#[a-z-]+#DAY$/.test(item.pk)) continue;
    perDay.set(item.sk, (perDay.get(item.sk) ?? 0) + item.scans);
  }
  assert.ok(perDay.size > 0);
  for (const [day, total] of perDay) {
    assert.equal(allDays.get(day).scans, total, `mismatch on ${day}`);
  }
});

test('Kyoto Garden produces no rows at all, so the empty state is reachable on a real selection', () => {
  const items = buildRollupItems({ today: TODAY, days: 90 });
  assert.equal(items.some((item) => item.pk.includes('kyoto-garden')), false);
  assert.equal(BLENDS.find((blend) => blend.slug === 'kyoto-garden').baseScans, 0);
});

test('geography rows carry country, region and city, and nothing that could identify a person', () => {
  const items = buildRollupItems({ today: TODAY, days: 30, hourlyDays: 0 });
  const geo = items.filter((item) => item.pk.includes('#GEO#DAY'));
  assert.ok(geo.length > 20);
  for (const item of geo) {
    const parts = item.sk.split('#');
    assert.equal(parts.length, 4, `unexpected geography sort key ${item.sk}`);
    assert.match(parts[0], /^\d{4}-\d{2}-\d{2}$/);
    assert.match(parts[1], /^[A-Z]{2}$/);
    assert.deepEqual(Object.keys(item).sort(), ['pk', 'scans', 'sk']);
  }
});

test('hourly rows exist only for the recent days and keep the day scan count exact', () => {
  const items = buildRollupItems({ today: TODAY, days: 30, hourlyDays: 2 });
  const hourly = items.filter((item) => item.pk.endsWith('#HOUR') && item.pk.startsWith('ROLLUP#BLEND#'));
  assert.ok(hourly.length > 0);
  const days = new Set(hourly.map((item) => item.sk.slice(0, 10)));
  assert.equal(days.size, 2);
  const persianHourly = hourly.filter((item) => item.pk.includes('persian-sunrise') && item.sk.startsWith(TODAY));
  const persianDay = items.find((item) => item.pk === 'ROLLUP#BLEND#persian-sunrise#DAY' && item.sk === TODAY);
  assert.equal(
    persianHourly.reduce((sum, item) => sum + item.scans, 0),
    persianDay.scans,
  );
});

test('the window before launch is mostly empty, which is what makes the sparse state real', () => {
  const items = buildRollupItems({ today: TODAY, days: 90, hourlyDays: 0 });
  const early = items.filter((item) => item.pk === 'ROLLUP#ALL#DAY' && item.sk < '2026-06-20');
  const late = items.filter((item) => item.pk === 'ROLLUP#ALL#DAY' && item.sk > '2026-08-01');
  const earlyMean = early.reduce((sum, item) => sum + item.scans, 0) / Math.max(1, early.length);
  const lateMean = late.reduce((sum, item) => sum + item.scans, 0) / Math.max(1, late.length);
  assert.ok(lateMean > earlyMean * 10, `pre launch mean ${earlyMean}, post launch mean ${lateMean}`);
});

test('the same seed produces the same numbers twice', () => {
  const a = buildRollupItems({ today: TODAY, days: 20 });
  const b = buildRollupItems({ today: TODAY, days: 20 });
  assert.deepEqual(a, b);
});
