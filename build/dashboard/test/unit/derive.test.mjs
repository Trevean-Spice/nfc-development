import test from 'node:test';
import assert from 'node:assert/strict';

import { channelSplit, engagement, mergeGeography, platformSplit, summarise, topPlaces } from '../../public/lib/derive.js';
import { emptySeries, point, populatedSeries, qrIndistinguishableSeries, series, sparseSeries, zeroedSeries } from '../helpers/fixtures.mjs';

test('totals are sums of the pre-aggregated counters and nothing is recomputed', () => {
  const summary = summarise(populatedSeries());
  assert.equal(summary.totals.scans, 255);
  assert.equal(summary.totals.byChannel.nfc, 161);
  assert.equal(summary.totals.byChannel.qr, 88);
  assert.equal(summary.totals.byChannel.direct, 6);
  assert.equal(summary.totals.recipeOpens, 128);
  assert.equal(summary.totals.reorderClicks, 28);
  assert.equal(summary.bucketsWithData, 3);
  assert.equal(summary.density, 'populated');
});

test('the mean time to readable is exact and no window percentile is invented', () => {
  const summary = summarise(populatedSeries());
  assert.equal(summary.meanTimeToReadableMs, (139240 + 111360 + 46740) / 255);
  // The worst single bucket is reported under its own name. There is no combined p95,
  // because per bucket percentiles cannot be averaged into one without making it up.
  assert.equal(summary.worstDailyP95Ms, 1720);
  assert.equal('windowP95Ms' in summary, false);
});

test('an empty window is empty, and a window of zero rows is also empty', () => {
  assert.equal(summarise(emptySeries()).density, 'empty');
  assert.equal(summarise(zeroedSeries()).density, 'empty');
  assert.equal(summarise(zeroedSeries()).bucketCount, 3);
});

test('a handful of scans is labelled sparse rather than presented as a trend', () => {
  const summary = summarise(sparseSeries());
  assert.equal(summary.density, 'sparse');
  assert.equal(summary.totals.scans, 3);
});

test('the channel split degrades honestly when nothing arrives on the QR route', () => {
  const split = channelSplit(summarise(qrIndistinguishableSeries()));
  assert.equal(split.qrDistinguishable, false);
  assert.equal(split.nfcToQr, null, 'no ratio is offered when one side is zero');
  assert.equal(split.directPresent, true);
  assert.equal(split.counts.direct, 105);
});

test('the NFC to QR ratio is produced only when both sides are counted', () => {
  const split = channelSplit(summarise(populatedSeries()));
  assert.equal(split.qrDistinguishable, true);
  assert.ok(Math.abs(split.nfcToQr - 161 / 88) < 1e-9);
});

test('channel counters that disagree with the scan counter are reported, not normalised', () => {
  const mismatched = series([
    point('2026-08-01', { scans: 100, byChannel: { nfc: 50, qr: 20, direct: 5 }, byPlatform: { ios: 100, android: 0, other: 0 } }),
  ]);
  const summary = summarise(mismatched);
  assert.equal(summary.channelReconciles, false);
  assert.equal(summary.channelTotal, 75);
  assert.equal(summary.totals.scans, 100);
});

test('platform shares sum to one whole and carry no handset model', () => {
  const platform = platformSplit(summarise(populatedSeries()));
  assert.equal(platform.total, 170 + 79 + 6);
  const sum = platform.shares.ios + platform.shares.android + platform.shares.other;
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.deepEqual(Object.keys(platform.counts), ['ios', 'android', 'other']);
});

test('engagement rates share the scan denominator and go null when there are no scans', () => {
  const rates = engagement(summarise(populatedSeries()));
  assert.equal(rates.recipeOpens, 128);
  assert.ok(Math.abs(rates.recipeOpensPer100 - 128 / 255) < 1e-9);
  assert.equal(engagement(summarise(emptySeries())).recipeOpensPer100, null);
});

test('geography merges across buckets and across series, keeping country region and city only', () => {
  const geography = mergeGeography([populatedSeries()]);
  const boston = geography.places.find((place) => place.city === 'Boston');
  assert.equal(boston.scans, 77);
  assert.equal(boston.region, 'MA');
  assert.equal(geography.total, 44 + 21 + 9 + 33 + 8);
  const unknown = geography.places.find((place) => place.city === null);
  assert.equal(unknown.country, 'US', 'a country with no city is kept as unknown rather than dropped');
  for (const place of geography.places) {
    assert.deepEqual(Object.keys(place).sort(), ['city', 'country', 'region', 'scans']);
  }
});

test('ranked places are ordered by volume and carry a share of the placed total', () => {
  const geography = mergeGeography([populatedSeries()]);
  const places = topPlaces(geography, 3);
  assert.equal(places.length, 3);
  assert.equal(places[0].city, 'Boston');
  assert.ok(places[0].share > places[1].share);
});

test('a malformed or absent counter reads as zero rather than breaking the page', () => {
  const summary = summarise({ points: [{ bucket: '2026-08-01', scans: 5 }] });
  assert.equal(summary.totals.byChannel.nfc, 0);
  assert.equal(summary.totals.scans, 5);
  assert.equal(summary.meanTimeToReadableMs, null);
});
