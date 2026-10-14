import test from 'node:test';
import assert from 'node:assert/strict';

import { renderBlendOptions, renderDashboard, renderError, renderMeasurementBanner } from '../../public/lib/render.js';
import { HEADLINE_MEASUREMENT_LINE } from '../../public/lib/copy.js';
import { CHANNEL_SERIES, legend } from '../../public/lib/charts.js';
import {
  MEASUREMENT_NOTE,
  SELECTION,
  emptySeries,
  point,
  populatedSeries,
  qrIndistinguishableSeries,
  series,
  sparseSeries,
} from '../helpers/fixtures.mjs';

function render(payload) {
  return renderDashboard({ selection: SELECTION, geographySeries: [], ...payload });
}

test('the measurement labelling is on the page, above the numbers, not in a footnote', () => {
  const html = render({ series: populatedSeries() });
  const bannerIndex = html.indexOf(HEADLINE_MEASUREMENT_LINE);
  const firstNumberIndex = html.indexOf('tile-value');
  assert.ok(bannerIndex > -1, 'the measurement line is rendered');
  assert.ok(firstNumberIndex > -1, 'there are numbers on the page');
  assert.ok(bannerIndex < firstNumberIndex, 'the labelling comes before the first number');
});

test('the note the API itself reports is rendered verbatim rather than paraphrased', () => {
  const html = render({ series: populatedSeries() });
  assert.ok(html.includes(MEASUREMENT_NOTE.slice(0, 60)));
  assert.ok(html.includes('Reported by the API:'));
});

test('both channels are described as measured by the same method', () => {
  const html = render({ series: populatedSeries() });
  assert.match(html, /deduplicated by the same browser side token/);
  assert.match(html, /Neither channel is more precise than the other/);
});

test('nothing on the page claims a per jar or per tag count', () => {
  const html = render({ series: populatedSeries() }) + render({ series: emptySeries() });
  const forbidden = [
    'jars scanned',
    'unique jars',
    'jars counted',
    'individual jars',
    'per tag count',
    'unique tags',
    'unique devices',
    'unique visitors',
    'unique users',
  ];
  const lowered = html.toLowerCase();
  for (const phrase of forbidden) {
    assert.equal(lowered.includes(phrase), false, `the page must not say "${phrase}"`);
  }
  // The API's own note contains the phrase, in a denial. Every occurrence on the page has
  // to be a denial, which is the check rather than banning the words outright.
  let index = lowered.indexOf('per-jar count');
  while (index !== -1) {
    const before = lowered.slice(Math.max(0, index - 40), index);
    assert.ok(before.includes('neither is a'), `a per jar count is stated rather than denied: ...${before}`);
    index = lowered.indexOf('per-jar count', index + 1);
  }
  assert.match(html, /Neither is a count of jars/);
  assert.match(html, /not jars/);
});

test('an empty window says so, and does not look like a fault', () => {
  const html = render({ series: emptySeries() });
  assert.match(html, /No scans recorded in this window/);
  assert.match(html, /before launch it is the expected result/);
  assert.equal(html.includes('NaN'), false);
  assert.equal(html.includes('Infinity'), false);
  assert.equal(html.includes('<svg class="chart"'), false, 'an empty chart frame is not drawn');
});

test('an empty window still says what was asked for, so the reader can widen it', () => {
  const html = render({ series: emptySeries() });
  assert.match(html, /All blends, 1 Aug to 3 Aug, by day/);
});

test('a sparse window shows its numbers and warns that shares are volatile', () => {
  const html = render({ series: sparseSeries() });
  assert.match(html, /Sparse window/);
  assert.match(html, /3 counted scans across 2 of 3 buckets/);
  assert.ok(html.includes('<svg class="chart"'), 'sparse data is still charted');
});

test('a window with no QR scans explains the printed QR position instead of showing a bare zero', () => {
  const html = render({ series: qrIndistinguishableSeries() });
  assert.match(html, /No QR scans counted in this window/);
  assert.match(html, /counted as direct/);
  assert.match(html, /That understates QR\. It does not inflate NFC\./);
  assert.match(html, /not available/, 'the NFC to QR ratio is withheld rather than divided by zero');
});

test('direct is its own channel and is never folded into NFC', () => {
  const html = render({ series: qrIndistinguishableSeries() });
  assert.match(html, /Direct/);
  assert.match(html, />105</, 'the direct count is shown at full size');
});

test('the platform panel says platform family rather than implying a handset model', () => {
  const html = render({ series: populatedSeries() });
  assert.match(html, /Platform family, not handset model/);
  assert.match(html, /iOS/);
  assert.match(html, /Android/);
});

test('geography states its source and its privacy posture on the panel', () => {
  const html = renderDashboard({
    selection: SELECTION,
    series: populatedSeries(),
    geographySeries: [populatedSeries()],
  });
  assert.match(html, /derived server side from CDN viewer headers/);
  assert.match(html, /No IP address is stored/);
  assert.match(html, /never asked for location permission/);
  assert.match(html, /Boston/);
  assert.match(html, /Unknown city/);
});

test('geography reports the gap between placed scans and counted scans', () => {
  const html = renderDashboard({
    selection: SELECTION,
    series: populatedSeries(),
    geographySeries: [populatedSeries()],
  });
  assert.match(html, /of 255 counted scans carry a place/);
});

test('a response with an unexpected measurement method is flagged rather than relabelled', () => {
  const html = renderMeasurementBanner(series([], { measurementMethod: 'chip_counter' }));
  assert.match(html, /Unrecognised measurement method/);
  assert.match(html, /chip_counter/);
});

test('a response that did not come from the rollups is flagged loudly', () => {
  const html = renderMeasurementBanner(series([], { source: 'raw_events' }));
  assert.match(html, /Unexpected data source/);
  assert.match(html, /Nothing below should be trusted/);
});

test('channel counters that do not reconcile are surfaced on the split panel', () => {
  const html = render({
    series: series([
      point('2026-08-01', {
        scans: 100,
        byChannel: { nfc: 50, qr: 20, direct: 5 },
        byPlatform: { ios: 100, android: 0, other: 0 },
      }),
    ]),
  });
  assert.match(html, /Channel counters do not add up to the scan counter/);
});

test('values coming from the API are escaped before they reach the page', () => {
  const hostile = series([
    point('2026-08-01', {
      scans: 10,
      byChannel: { nfc: 10, qr: 0, direct: 0 },
      byPlatform: { ios: 10, android: 0, other: 0 },
      topCities: [{ country: 'US', region: '<script>', city: '"><img src=x onerror=alert(1)>', scans: 10 }],
    }),
  ]);
  const html = renderDashboard({ selection: SELECTION, series: hostile, geographySeries: [hostile] });
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('<img'), false, 'no tag is opened by data');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;'), 'the value survives as text');
});

/**
 * The blend picker is built from the blend list the API returns, which is CMS text. It used
 * to be interpolated raw inside the DOM wiring, where nothing tested it, and this page
 * keeps a bearer token in session storage. These assert the escaping at both the attribute
 * and the text position.
 */
test('the blend picker escapes the name and the slug it gets from the API', () => {
  const html = renderBlendOptions(
    [
      { slug: 'x" onfocus=alert(1) autofocus="', name: '<img src=x onerror=alert(1)>', status: 'draft' },
      { slug: 'persian-sunrise', name: 'Persian Sunrise', status: 'published' },
    ],
    null,
  );
  // The quote is what ends the attribute, so that is the character the assertion is about.
  // The rest of the hostile slug surviving as inert text inside the value is fine.
  assert.ok(
    html.includes('<option value="x&quot; onfocus=alert(1) autofocus=&quot;">'),
    'a slug must not break out of the value attribute',
  );
  assert.equal(html.includes('<img'), false, 'a name must not open a tag');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt; (draft)'), 'the name survives as text, with its status');
  assert.ok(html.includes('<option value="persian-sunrise">Persian Sunrise</option>'));
});

test('the blend picker selects what is selected and survives a malformed blend list', () => {
  assert.match(renderBlendOptions([], null), /^<option value="" selected>All blends<\/option>$/);
  assert.match(renderBlendOptions(undefined, null), /All blends/);
  const chosen = renderBlendOptions([{ slug: 'silk-road', name: 'The Silk Road', status: 'published' }], 'silk-road');
  assert.ok(chosen.includes('<option value="silk-road" selected>The Silk Road</option>'));
  assert.equal(chosen.includes('<option value="" selected>'), false, 'All blends is not selected when a blend is');
  // A row with no usable slug is dropped rather than rendered as an option that selects nothing.
  assert.equal(renderBlendOptions([{ name: 'No slug', status: 'draft' }], null).match(/<option/g).length, 1);
  // A row with no name falls back to the slug rather than printing the word undefined.
  assert.ok(renderBlendOptions([{ slug: 'kyoto-garden', status: 'draft' }], null).includes('kyoto-garden (draft)'));
});

test('a failed load says so rather than leaving a blank page or a stale number', () => {
  const html = renderError({ message: 'The analytics API could not be reached.', requestId: '01J9Z8XK4M2Q7T5V3N8R1B6C0D' });
  assert.match(html, /The dashboard could not load/);
  assert.match(html, /01J9Z8XK4M2Q7T5V3N8R1B6C0D/);
  assert.match(html, /holds no cached copy of a number/);
});

test('the audience decision is stated on the page rather than left to a document', () => {
  const html = render({ series: populatedSeries() });
  assert.match(html, /Built for marketing self serve/);
});

/*
 * The two panels that divide the same three counts, and the one denominator between them.
 *
 * summary.totals.scans and summary.totals.byChannel are pre-aggregated independently. When
 * they disagree, the volume legend and the split table used to answer the same question
 * with two different percentage sets, and the page warned about only one of them. The data
 * model's own section 5.4 says a narrow failure window can over count by up to one batch,
 * so this is a state the page has to handle rather than a hypothetical.
 */

/**
 * The distinct percentages rendered inside one panel, in first appearance order. Distinct
 * because the split panel states each share twice, once in the bar's own tooltip and once
 * in the table, and the question here is which percentages the panel claims rather than
 * how many times it repeats them.
 */
function percentagesIn(html, panelId) {
  const start = html.indexOf(`id="${panelId}"`);
  assert.notEqual(start, -1, `panel ${panelId} is on the page`);
  const end = html.indexOf('<section class="panel"', start + 1);
  const section = end === -1 ? html.slice(start) : html.slice(start, end);
  return [...new Set([...section.matchAll(/-?\d+\.\d%/g)].map((match) => match[0]))];
}

function divergentSeries(scans) {
  // One bucket, one lost or duplicated rollup increment. 40 + 15 + 5 channel counts.
  return series([
    point('2026-08-01', { scans, byChannel: { nfc: 40, qr: 15, direct: 5 }, byPlatform: { ios: scans } }),
  ]);
}

test('the volume legend and the split table print one set of percentages, not two', () => {
  const html = render({ series: divergentSeries(100) });
  const legendShares = percentagesIn(html, 'volume');
  const splitShares = percentagesIn(html, 'split');
  assert.deepEqual(legendShares, ['66.7%', '25.0%', '8.3%']);
  assert.deepEqual(splitShares, ['66.7%', '25.0%', '8.3%']);
  // The denominator is the channel total, so the shares add to 100 and the reader is not
  // handed two answers to one question.
  assert.deepEqual(legendShares, splitShares);
});

test('an over count renders as a stated impossibility rather than as 400 percent', () => {
  // The direct call is the reachable path: legend takes the denominator from its caller,
  // so a caller passing a smaller total must not produce a confident percentage.
  const html = legend(CHANNEL_SERIES, { nfc: 40, qr: 15, direct: 5 }, 10);
  assert.match(html, /out of range, 400\.0%/);
  assert.equal(/>400\.0%</.test(html), false, 'an impossible share must never render bare');
});

test('the reconciliation warning appears in both panels that divide by the channel total', () => {
  const html = render({ series: divergentSeries(100) });
  const warnings = [...html.matchAll(/Channel counters do not add up to the scan counter/g)];
  assert.equal(warnings.length, 2, 'the warning sits with the legend as well as with the table');
  const volumeWarning = html.indexOf('Channel counters do not add up');
  assert.ok(volumeWarning > html.indexOf('id="volume"'), 'the first one is inside the volume panel');
  assert.ok(volumeWarning < html.indexOf('id="split"'), 'and before the split panel');
  assert.match(html, /channel counters total 60 against 100 counted scans/i);
});

test('no warning and no out of range value when the two counters agree', () => {
  const html = render({ series: divergentSeries(60) });
  assert.equal(html.includes('Channel counters do not add up'), false);
  assert.equal(html.includes('out of range'), false);
  assert.deepEqual(percentagesIn(html, 'volume'), ['66.7%', '25.0%', '8.3%']);
});
