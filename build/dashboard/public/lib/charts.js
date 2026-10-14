/**
 * Chart marks, drawn as SVG strings by first party code.
 *
 * No charting library. That is a deliberate choice and it has a contractual edge to it: the
 * Scope document, "IP and handoff", requires every pre-existing library reused here to be
 * listed and licensed to Trevean to run and maintain indefinitely. The cheapest version of
 * that obligation is not to acquire it. See MANIFEST.md.
 *
 * Every function here is pure and returns a string, so the test suite asserts on the markup
 * without a browser and without a DOM library.
 *
 * Colour is by role, resolved from CSS custom properties defined once in styles.css, so
 * light and dark are two validated sets of steps rather than one set flipped.
 */

import { escapeHtml, formatBucket, formatInteger, formatShare } from './format.js';

/** Series identity is fixed per chart. Colour follows the channel, never its rank. */
export const CHANNEL_SERIES = [
  { key: 'nfc', label: 'NFC tap', colorVar: '--series-1' },
  { key: 'qr', label: 'QR scan', colorVar: '--series-2' },
  { key: 'direct', label: 'Direct', colorVar: '--series-3' },
];

export const PLATFORM_SERIES = [
  { key: 'ios', label: 'iOS', colorVar: '--series-1' },
  { key: 'android', label: 'Android', colorVar: '--series-2' },
  { key: 'other', label: 'Other', colorVar: '--series-3' },
];

function niceCeiling(value) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

/** A rectangle with rounded top corners, anchored square to the baseline. */
export function roundedTopRect(x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height));
  if (r === 0) return `M${x} ${y}h${width}v${height}h${-width}Z`;
  return [
    `M${x} ${y + r}`,
    `a${r} ${r} 0 0 1 ${r} ${-r}`,
    `h${width - 2 * r}`,
    `a${r} ${r} 0 0 1 ${r} ${r}`,
    `v${height - r}`,
    `h${-width}`,
    'Z',
  ].join('');
}

function xLabelIndices(count, maximum) {
  if (count <= maximum) return [...Array(count).keys()];
  const step = Math.ceil(count / maximum);
  const indices = [];
  for (let i = 0; i < count; i += step) indices.push(i);
  if (indices[indices.length - 1] !== count - 1) {
    // The final bucket always gets a label, and the one before it is dropped if labelling
    // both would print two dates on top of each other at the right hand edge.
    if (count - 1 - indices[indices.length - 1] < step * 0.7) indices.pop();
    indices.push(count - 1);
  }
  return indices;
}

/**
 * Stacked columns over time. Magnitude by length from a zero baseline, which is the only
 * encoding that survives being read quickly.
 *
 * Segments are separated by a 2 px surface gap, and only the topmost segment of a column
 * carries the 4 px rounded end, so a stack reads as one column rather than three lozenges.
 */
export function stackedColumnChart(points, series, options = {}) {
  const width = options.width ?? 960;
  const height = options.height ?? 280;
  const padding = { top: 14, right: 10, bottom: 30, left: 48 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const count = points.length;

  if (count === 0) return '';

  const stackTotal = (point) => series.reduce((sum, item) => sum + (point.values[item.key] ?? 0), 0);
  const maximum = niceCeiling(Math.max(...points.map(stackTotal), 1));
  const slot = plotWidth / count;
  const gap = count > 45 ? 1.5 : count > 20 ? 3 : 6;
  const columnWidth = Math.max(1.5, slot - gap);
  const yOf = (value) => padding.top + plotHeight - (value / maximum) * plotHeight;

  const gridLines = [0, 0.25, 0.5, 0.75, 1]
    .map((fraction) => {
      const value = maximum * fraction;
      const y = yOf(value);
      return (
        `<line class="grid" x1="${padding.left}" y1="${y.toFixed(1)}" x2="${(width - padding.right).toFixed(1)}" y2="${y.toFixed(1)}"></line>` +
        `<text class="axis" x="${padding.left - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end">${escapeHtml(formatInteger(value))}</text>`
      );
    })
    .join('');

  const columns = points
    .map((point, index) => {
      const x = padding.left + index * slot + (slot - columnWidth) / 2;
      let cursor = 0;
      const total = stackTotal(point);
      const segments = [];
      const drawable = series.filter((item) => (point.values[item.key] ?? 0) > 0);
      drawable.forEach((item, position) => {
        const value = point.values[item.key] ?? 0;
        const top = yOf(cursor + value);
        const bottom = yOf(cursor);
        const isTop = position === drawable.length - 1;
        // The 2 px surface gap between stacked segments, taken off the top of each segment
        // except the highest, so the baseline stays exact.
        const rawHeight = bottom - top;
        const segmentHeight = Math.max(0.75, isTop ? rawHeight : rawHeight - 2);
        const y = bottom - segmentHeight;
        const path = isTop
          ? roundedTopRect(x, y, columnWidth, segmentHeight, 4)
          : `M${x} ${y}h${columnWidth}v${segmentHeight}h${-columnWidth}Z`;
        segments.push(`<path class="mark" d="${path}" fill="var(${item.colorVar})"></path>`);
        cursor += value;
      });
      const tooltip = [
        formatBucket(point.bucket),
        `${formatInteger(total)} scans`,
        ...series.map((item) => `${item.label}: ${formatInteger(point.values[item.key] ?? 0)}`),
      ].join(' | ');
      return (
        `<g class="column"><title>${escapeHtml(tooltip)}</title>` +
        `<rect class="hit" x="${(padding.left + index * slot).toFixed(2)}" y="${padding.top}" width="${slot.toFixed(2)}" height="${plotHeight}"></rect>` +
        segments.join('') +
        '</g>'
      );
    })
    .join('');

  const labels = xLabelIndices(count, 8)
    .map((index) => {
      const x = padding.left + index * slot + slot / 2;
      const anchor = index === 0 ? 'start' : index === count - 1 ? 'end' : 'middle';
      const clamped = index === 0 ? padding.left : index === count - 1 ? width - padding.right : x;
      return `<text class="axis" x="${clamped.toFixed(1)}" y="${height - 10}" text-anchor="${anchor}">${escapeHtml(formatBucket(points[index].bucket))}</text>`;
    })
    .join('');

  const baseline = `<line class="axis-line" x1="${padding.left}" y1="${(padding.top + plotHeight).toFixed(1)}" x2="${(width - padding.right).toFixed(1)}" y2="${(padding.top + plotHeight).toFixed(1)}"></line>`;

  return (
    `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" preserveAspectRatio="none" ` +
    `aria-label="${escapeHtml(options.ariaLabel ?? 'Scan volume over time, stacked by channel')}">` +
    gridLines +
    columns +
    baseline +
    labels +
    '</svg>'
  );
}

/**
 * A single 100% stacked bar. Used for a split of one whole into three parts, where the
 * question is the ratio rather than the trend.
 */
export function splitBar(segments, options = {}) {
  const width = options.width ?? 960;
  const height = options.height ?? 34;
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (total <= 0) return '';
  const gap = 2;
  let cursor = 0;
  const marks = segments
    .filter((segment) => segment.value > 0)
    .map((segment, index, drawable) => {
      const raw = (segment.value / total) * width;
      const isLast = index === drawable.length - 1;
      const segmentWidth = Math.max(1, isLast ? raw : raw - gap);
      const x = cursor;
      cursor += raw;
      const tooltip = `${segment.label}: ${formatInteger(segment.value)} (${formatShare(segment.value / total)})`;
      return (
        `<g><title>${escapeHtml(tooltip)}</title>` +
        `<rect class="mark" x="${x.toFixed(2)}" y="0" width="${segmentWidth.toFixed(2)}" height="${height}" rx="4" fill="var(${segment.colorVar})"></rect>` +
        '</g>'
      );
    })
    .join('');
  return (
    `<svg class="split-bar" viewBox="0 0 ${width} ${height}" role="img" preserveAspectRatio="none" ` +
    `aria-label="${escapeHtml(options.ariaLabel ?? 'Split')}">${marks}</svg>`
  );
}

/** A horizontal bar for a ranked list row. Length from zero, one hue, direct label outside. */
export function rowBar(value, maximum, colorVar = '--series-1') {
  const width = 160;
  const height = 10;
  const fraction = maximum > 0 ? Math.min(1, value / maximum) : 0;
  const barWidth = Math.max(fraction > 0 ? 2 : 0, fraction * width);
  if (barWidth === 0) return `<svg class="row-bar" viewBox="0 0 ${width} ${height}" role="presentation"></svg>`;
  return (
    `<svg class="row-bar" viewBox="0 0 ${width} ${height}" role="presentation">` +
    `<rect x="0" y="0" width="${barWidth.toFixed(1)}" height="${height}" rx="4" fill="var(${colorVar})"></rect>` +
    '</svg>'
  );
}

/**
 * The legend. Always present for two or more series, so identity is never colour alone.
 *
 * `totals` is the denominator the shares are of, and it is the caller's job to pass the one
 * the series actually add up to. It used to be handed the scan counter while the series
 * were the channel counters, which are aggregated independently, so the legend and the
 * split table below it printed two different percentage sets for the same three counts.
 * The share now goes through formatShare, so a count larger than the total it is being
 * divided by renders as an out of range statement rather than as a percentage.
 */
export function legend(series, counts = null, totals = null) {
  const items = series
    .map((item) => {
      const count = counts ? counts[item.key] : null;
      const value = count === null || count === undefined ? '' : ` <span class="legend-value">${escapeHtml(formatInteger(count))}</span>`;
      const pct =
        totals && totals > 0 && count !== null && count !== undefined
          ? ` <span class="legend-share">${escapeHtml(formatShare(count / totals))}</span>`
          : '';
      return (
        `<li><span class="swatch" style="background:var(${item.colorVar})" aria-hidden="true"></span>` +
        `<span class="legend-label">${escapeHtml(item.label)}</span>${value}${pct}</li>`
      );
    })
    .join('');
  return `<ul class="legend">${items}</ul>`;
}
