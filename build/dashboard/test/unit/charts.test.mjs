import test from 'node:test';
import assert from 'node:assert/strict';

import { CHANNEL_SERIES, legend, roundedTopRect, rowBar, splitBar, stackedColumnChart } from '../../public/lib/charts.js';

function pointsFrom(rows) {
  return rows.map(([bucket, nfc, qr, direct]) => ({ bucket, values: { nfc, qr, direct } }));
}

test('a stacked column chart draws one group per bucket and one mark per non zero segment', () => {
  const svg = stackedColumnChart(pointsFrom([['2026-08-01', 10, 5, 0], ['2026-08-02', 8, 0, 2]]), CHANNEL_SERIES);
  assert.equal((svg.match(/class="column"/g) ?? []).length, 2);
  // Two segments in the first column, two in the second. A zero segment is not drawn.
  assert.equal((svg.match(/class="mark"/g) ?? []).length, 4);
});

test('an empty series draws nothing at all rather than an empty frame', () => {
  assert.equal(stackedColumnChart([], CHANNEL_SERIES), '');
  assert.equal(splitBar([{ label: 'NFC tap', value: 0, colorVar: '--series-1' }]), '');
});

test('colour is referenced by role, never as a literal hex, so dark mode is a set of steps', () => {
  const svg = stackedColumnChart(pointsFrom([['2026-08-01', 10, 5, 1]]), CHANNEL_SERIES);
  assert.equal(/#[0-9a-fA-F]{6}/.test(svg), false);
  assert.match(svg, /var\(--series-1\)/);
  assert.match(svg, /var\(--series-2\)/);
  assert.match(svg, /var\(--series-3\)/);
});

test('every column carries a title, so the hover layer needs no script', () => {
  const svg = stackedColumnChart(pointsFrom([['2026-08-01', 10, 5, 1]]), CHANNEL_SERIES);
  assert.match(svg, /<title>1 Aug \| 16 scans \| NFC tap: 10 \| QR scan: 5 \| Direct: 1<\/title>/);
});

test('the chart is labelled for a screen reader', () => {
  const svg = stackedColumnChart(pointsFrom([['2026-08-01', 1, 0, 0]]), CHANNEL_SERIES, { ariaLabel: 'Scan volume by day' });
  assert.match(svg, /role="img"/);
  assert.match(svg, /aria-label="Scan volume by day"/);
});

test('the rounded end is on the top of a column only, and never wider than the column', () => {
  const path = roundedTopRect(0, 0, 6, 40, 4);
  assert.match(path, /^M0 3a3 3 0 0 1 3 -3/, 'the radius is clamped to half the column width');
  // A segment shorter than the radius gets a radius no taller than itself, so a one scan
  // day is a small square rather than a lens.
  assert.match(roundedTopRect(0, 0, 10, 0.5, 4), /^M0 0\.5a0\.5 0\.5 /);
  assert.equal(roundedTopRect(0, 0, 10, 8, 0), 'M0 0h10v8h-10Z');
});

test('axis labels are thinned rather than overprinted on a long window', () => {
  const rows = Array.from({ length: 90 }, (_, index) => [`2026-06-${String((index % 28) + 1).padStart(2, '0')}`, 5, 2, 0]);
  const svg = stackedColumnChart(pointsFrom(rows), CHANNEL_SERIES);
  const labels = (svg.match(/class="axis" x=/g) ?? []).length;
  // Five gridline labels plus at most nine date labels.
  assert.ok(labels <= 14, `too many axis labels: ${labels}`);
});

test('a hostile bucket label cannot break out of the markup', () => {
  const svg = stackedColumnChart([{ bucket: '"><script>x</script>', values: { nfc: 1, qr: 0, direct: 0 } }], CHANNEL_SERIES);
  assert.equal(svg.includes('<script>'), false);
});

test('the split bar leaves a surface gap between segments and none after the last', () => {
  const svg = splitBar([
    { label: 'NFC tap', value: 60, colorVar: '--series-1' },
    { label: 'QR scan', value: 40, colorVar: '--series-2' },
  ], { width: 100 });
  const widths = [...svg.matchAll(/width="([\d.]+)"/g)].map((match) => Number(match[1]));
  assert.deepEqual(widths, [58, 40]);
});

test('a legend is present for more than one series and carries the value beside the swatch', () => {
  const html = legend(CHANNEL_SERIES, { nfc: 161, qr: 88, direct: 6 }, 255);
  assert.equal((html.match(/<li>/g) ?? []).length, 3);
  assert.match(html, /NFC tap/);
  assert.match(html, /161/);
  assert.match(html, /63.1%/);
});

test('a row bar of zero draws no mark at all', () => {
  assert.equal(rowBar(0, 100).includes('<rect'), false);
  assert.ok(rowBar(50, 100).includes('<rect'));
});
