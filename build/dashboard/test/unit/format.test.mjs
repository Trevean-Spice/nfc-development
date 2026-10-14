import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addDays,
  daysInclusive,
  escapeHtml,
  formatBucket,
  formatDateRange,
  formatMs,
  formatPercent,
  formatShare,
  per100,
  share,
  slugToName,
} from '../../public/lib/format.js';

test('a zero denominator produces null, never NaN and never a confident zero', () => {
  assert.equal(share(0, 0), null);
  assert.equal(share(5, 0), null);
  assert.equal(per100(0, 0), null);
  assert.equal(formatPercent(share(0, 0)), 'not measured');
});

test('percentages never render as NaN or Infinity for any pair of counters', () => {
  const values = [0, 1, 7, 1000, -1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined];
  for (const part of values) {
    for (const whole of values) {
      const rendered = formatPercent(share(part, whole));
      assert.ok(!rendered.includes('NaN'), `NaN for ${part}/${whole}`);
      assert.ok(!rendered.includes('Infinity'), `Infinity for ${part}/${whole}`);
    }
  }
});

test('a share below a tenth of a percent is said rather than rounded to nothing', () => {
  assert.equal(formatPercent(share(1, 5000)), 'under 0.1%');
  assert.equal(formatPercent(share(0, 5000)), '0.0%');
});

test('timings render in the unit a reader can compare to the 2.0 second requirement', () => {
  assert.equal(formatMs(940), '940 ms');
  assert.equal(formatMs(1810), '1.81 s');
  assert.equal(formatMs(null), 'not measured');
});

test('escaping covers every value that reaches the page, including CDN supplied city names', () => {
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(escapeHtml('O"Neill & co'), 'O&quot;Neill &amp; co');
});

test('bucket labels read as dates and hourly buckets say UTC', () => {
  assert.equal(formatBucket('2026-08-17'), '17 Aug');
  assert.equal(formatBucket('2026-08-17T14'), '17 Aug 14:00 UTC');
  assert.equal(formatDateRange('2026-08-17', '2026-08-17'), '17 Aug');
});

test('UTC date arithmetic does not drift across a month boundary', () => {
  assert.equal(addDays('2026-09-01', -1), '2026-08-31');
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(daysInclusive('2026-08-01', '2026-08-31'), 31);
  assert.equal(daysInclusive('2026-08-01', '2026-08-01'), 1);
});

test('slugs become readable names for the picker', () => {
  assert.equal(slugToName('north-african-night-market'), 'North African Night Market');
  assert.equal(slugToName(null), 'All blends');
});

/*
 * A share of a whole, and the value that must never render as a percentage.
 *
 * The dashboard's contract is that it labels NFC and QR counts as measured by the same
 * method rather than implying a precision it does not have. A legend that can print
 * "400.0%" in the same weight as "40.0%" undermines exactly that, so an impossible share
 * is a stated impossibility and not a number.
 */
test('a share outside zero to one renders as a stated impossibility, not as a percentage', () => {
  assert.equal(formatShare(0.4), '40.0%');
  assert.equal(formatShare(1), '100.0%');
  assert.equal(formatShare(0), '0.0%');
  assert.equal(formatShare(null), 'not measured');
  assert.equal(formatShare(Number.NaN), 'not measured');

  // 40 counted against a total of 10, which is what a lost rollup increment looks like.
  assert.equal(formatShare(4), 'out of range, 400.0%');
  // The offending value stays visible: it was measured, it is the counters that disagree.
  assert.equal(formatShare(-0.2), 'out of range, -20.0%');
  assert.equal(formatShare(1.0001), 'out of range, 100.0%');
});

test('a rate is still allowed above 100 percent, because recipe opens per scan genuinely can be', () => {
  // formatPercent and formatShare are deliberately different contracts. One session can
  // open more than one recipe, so this reading is real and must not be reported as broken.
  assert.equal(formatPercent(1.4), '140.0%');
});
