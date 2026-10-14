/**
 * Export, so a marketing question that ends in a spreadsheet does not end in a ticket.
 *
 * The measurement method and the source are columns on every row rather than a header
 * comment. A note at the top of a file is the first thing lost when somebody copies three
 * rows into a slide, and the whole point of the labelling requirement is that the number
 * never travels without it.
 */

import { HEADLINE_MEASUREMENT_LINE } from './copy.js';
import { normalisePoint } from './derive.js';

const COLUMNS = [
  'bucket',
  'blend',
  'granularity',
  'counted_scans',
  'nfc',
  'qr',
  'direct',
  'ios',
  'android',
  'other',
  'recipe_opens',
  'reorder_clicks',
  'cache_hit',
  'cache_miss',
  'cache_stale',
  'time_to_readable_count',
  'time_to_readable_sum_ms',
  'time_to_readable_p50_ms',
  'time_to_readable_p95_ms',
  'measurement_method',
  'source',
  'measurement_note',
];

function cell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function seriesToCsv(series) {
  const blend = series && series.blend ? series.blend : 'all-blends';
  const granularity = series && series.granularity ? series.granularity : 'day';
  const method = series && series.measurementMethod ? series.measurementMethod : 'unknown';
  const source = series && series.source ? series.source : 'unknown';
  const points = (series && Array.isArray(series.points) ? series.points : []).map(normalisePoint);

  const rows = points.map((point) =>
    [
      point.bucket,
      blend,
      granularity,
      point.scans,
      point.byChannel.nfc,
      point.byChannel.qr,
      point.byChannel.direct,
      point.byPlatform.ios,
      point.byPlatform.android,
      point.byPlatform.other,
      point.recipeOpens,
      point.reorderClicks,
      point.cache.hit,
      point.cache.miss,
      point.cache.stale,
      point.timeToReadable.count,
      point.timeToReadable.sumMs,
      point.timeToReadable.p50Ms,
      point.timeToReadable.p95Ms,
      method,
      source,
      HEADLINE_MEASUREMENT_LINE,
    ]
      .map(cell)
      .join(','),
  );

  return [COLUMNS.join(','), ...rows].join('\r\n');
}

export function geographyToCsv(places, series) {
  const method = series && series.measurementMethod ? series.measurementMethod : 'unknown';
  const header = ['country', 'region', 'city', 'counted_scans', 'measurement_method', 'measurement_note'].join(',');
  const rows = places.map((place) =>
    [place.country, place.region ?? '', place.city ?? '', place.scans, method, HEADLINE_MEASUREMENT_LINE]
      .map(cell)
      .join(','),
  );
  return [header, ...rows].join('\r\n');
}

export function csvFilename(selection) {
  const blend = selection.blend ?? 'all-blends';
  return `trevean-scans-${blend}-${selection.from}-to-${selection.to}-by-${selection.granularity}.csv`;
}
