/**
 * The page, built as strings by pure functions.
 *
 * renderDashboard takes one loaded payload and returns the whole main region. Keeping it a
 * pure function of the data is what lets the test suite assert the honesty requirements on
 * real rendered output rather than on intentions: that the measurement method appears on
 * the page and not in a footnote, that an empty window says so instead of looking broken,
 * and that nothing anywhere claims to be counting jars.
 */

import {
  AUDIENCE_NOTE,
  CHANNEL_LABEL,
  ENGAGEMENT_CAVEAT,
  GEOGRAPHY_CAVEAT,
  HEADLINE_MEASUREMENT_LINE,
  MEASUREMENT_POINTS,
  PANEL,
  PLATFORM_CAVEAT,
  PLATFORM_LABEL,
  QR_NOT_DISTINGUISHABLE,
  STATES,
  UNEXPECTED_METHOD,
  UNEXPECTED_SOURCE,
  WHY_NO_PER_TAG,
} from './copy.js';
import {
  escapeHtml,
  formatBucket,
  formatDateRange,
  formatInteger,
  formatMs,
  formatPercent,
  formatShare,
  slugToName,
} from './format.js';
import { channelSplit, engagement, mergeGeography, platformSplit, summarise, topPlaces } from './derive.js';
import { CHANNEL_SERIES, PLATFORM_SERIES, legend, rowBar, splitBar, stackedColumnChart } from './charts.js';

function panel(id, title, bodyHtml, caption = '') {
  return (
    `<section class="panel" id="${escapeHtml(id)}" aria-labelledby="${escapeHtml(id)}-title">` +
    `<h2 class="panel-title" id="${escapeHtml(id)}-title">${escapeHtml(title)}</h2>` +
    (caption ? `<p class="panel-caption">${escapeHtml(caption)}</p>` : '') +
    bodyHtml +
    '</section>'
  );
}

function note(kind, title, body, extra = '') {
  return (
    `<div class="note note-${escapeHtml(kind)}" role="note">` +
    `<p class="note-title">${escapeHtml(title)}</p>` +
    `<p>${escapeHtml(body)}</p>` +
    extra +
    '</div>'
  );
}

function statTile(label, value, sub = '') {
  return (
    '<div class="tile">' +
    `<p class="tile-label">${escapeHtml(label)}</p>` +
    `<p class="tile-value">${escapeHtml(value)}</p>` +
    (sub ? `<p class="tile-sub">${escapeHtml(sub)}</p>` : '') +
    '</div>'
  );
}

/**
 * The measurement block. On the page, above the numbers, never a footnote.
 *
 * The API states the method on every response and this renders what it said rather than a
 * copy of what it is expected to say. If the two ever diverge, the page reports the
 * divergence instead of labelling the numbers with a description that is no longer true.
 */
export function renderMeasurementBanner(series) {
  const method = series && series.measurementMethod;
  const source = series && series.source;
  const warnings = [];
  if (method !== 'browser_token') warnings.push(note('warn', 'Unrecognised measurement method', UNEXPECTED_METHOD(method)));
  if (source !== 'rollup') warnings.push(note('warn', 'Unexpected data source', UNEXPECTED_SOURCE(source)));

  const apiNote = series && typeof series.measurementNote === 'string' && series.measurementNote !== ''
    ? `<p class="api-note"><span class="api-note-label">Reported by the API:</span> ${escapeHtml(series.measurementNote)}</p>`
    : '';

  return (
    '<section class="measurement" aria-labelledby="measurement-title">' +
    '<h2 class="measurement-title" id="measurement-title">What these numbers are, and what they are not</h2>' +
    `<p class="measurement-headline">${escapeHtml(HEADLINE_MEASUREMENT_LINE)}</p>` +
    `<ul class="measurement-points">${MEASUREMENT_POINTS.map((point) => `<li>${escapeHtml(point)}</li>`).join('')}</ul>` +
    `<p class="measurement-why">${escapeHtml(WHY_NO_PER_TAG)}</p>` +
    apiNote +
    warnings.join('') +
    '</section>'
  );
}

export function renderHeadline(summary, split, rates) {
  const ratio = split.nfcToQr === null ? 'not available' : `${split.nfcToQr.toFixed(2)} to 1`;
  const ratioSub = split.nfcToQr === null ? 'No QR scans counted in this window' : 'Both channels counted the same way';
  return (
    '<div class="tiles">' +
    statTile('Counted scans', formatInteger(summary.totals.scans), 'Deduplicated browser sessions, not jars') +
    statTile('NFC to QR', ratio, ratioSub) +
    statTile('Recipe opens per 100 scans', rates.recipeOpensPer100 === null ? 'not measured' : (rates.recipeOpensPer100 * 100).toFixed(1), 'Same sessions as the scan count') +
    statTile('Reorder clicks per 100 scans', rates.reorderClicksPer100 === null ? 'not measured' : (rates.reorderClicksPer100 * 100).toFixed(1), 'A click, not an order') +
    statTile('Mean time to readable', formatMs(summary.meanTimeToReadableMs), summary.worstDailyP95Ms === null ? 'No timing samples in this window' : `Worst single day p95 ${formatMs(summary.worstDailyP95Ms)}`) +
    '</div>'
  );
}

function volumeTable(points) {
  const rows = points
    .map(
      (point) =>
        '<tr>' +
        `<th scope="row">${escapeHtml(formatBucket(point.bucket))}</th>` +
        `<td>${escapeHtml(formatInteger(point.scans))}</td>` +
        `<td>${escapeHtml(formatInteger(point.byChannel.nfc))}</td>` +
        `<td>${escapeHtml(formatInteger(point.byChannel.qr))}</td>` +
        `<td>${escapeHtml(formatInteger(point.byChannel.direct))}</td>` +
        `<td>${escapeHtml(formatInteger(point.recipeOpens))}</td>` +
        `<td>${escapeHtml(formatInteger(point.reorderClicks))}</td>` +
        '</tr>',
    )
    .join('');
  return (
    '<details class="table-view"><summary>Table view</summary>' +
    '<div class="table-scroll"><table>' +
    '<thead><tr><th scope="col">Bucket</th><th scope="col">Scans</th><th scope="col">NFC</th><th scope="col">QR</th>' +
    '<th scope="col">Direct</th><th scope="col">Recipe opens</th><th scope="col">Reorder clicks</th></tr></thead>' +
    `<tbody>${rows}</tbody></table></div></details>`
  );
}

/**
 * The volume panel.
 *
 * ONE DENOMINATOR, AND WHY IT IS THE CHANNEL TOTAL.
 *
 * The legend under this chart used to divide each channel count by summary.totals.scans
 * while the split panel below divided the same three counts by nfc + qr + direct. Those two
 * counters are pre-aggregated independently, so when they disagreed the page printed two
 * different percentage sets for the same three numbers and attached its one warning to only
 * one of them. Worse in the over count direction: scans 10 against channel counters
 * totalling 40 rendered a silent 400.0% in the legend.
 *
 * The denominator is now the channel total in both places. The legend labels a stacked
 * column chart whose columns are stacks of the channel counts, so the question it is
 * answering is "how much of this stack is NFC", and the stack is the channel total. It is
 * also the choice that makes this panel consistent with the platform panel, which has
 * always divided by the platform total. The scan counter is still on the page in its own
 * right, as the headline "Counted scans" tile and as the Scans column of the table view, so
 * nothing is hidden by not dividing by it.
 *
 * When the two counters disagree, the same reconciliation warning now appears here as well
 * as in the split panel, because this is where the reader first meets a percentage of a
 * total that is not the scan total.
 */
export function renderVolume(summary, granularity) {
  const points = summary.points.map((point) => ({ bucket: point.bucket, values: point.byChannel }));
  const chart = stackedColumnChart(points, CHANNEL_SERIES, {
    ariaLabel: `Scan volume by ${granularity}, stacked by channel: NFC, QR and direct`,
  });
  const caption =
    granularity === 'hour'
      ? 'One column per hour, UTC. Read from the hourly rollup partition. Legend shares are of the channel total, the same denominator as the channel split below.'
      : 'One column per day, UTC. Read from the daily rollup partition. Legend shares are of the channel total, the same denominator as the channel split below.';
  return panel(
    'volume',
    PANEL.volume,
    chart +
      legend(CHANNEL_SERIES, summary.totals.byChannel, summary.channelTotal) +
      channelReconciliationNote(summary) +
      volumeTable(summary.points),
    caption,
  );
}

/**
 * The one warning, written once and shown in both panels that divide by the channel total.
 *
 * It used to sit only in the split panel, which meant a reader comparing the chart legend
 * with the table below it saw two answers and one explanation.
 */
function channelReconciliationNote(summary) {
  if (summary.channelReconciles) return '';
  return note(
    'warn',
    'Channel counters do not add up to the scan counter',
    `The channel counters total ${formatInteger(summary.channelTotal)} against ${formatInteger(summary.totals.scans)} counted scans. ` +
      'Both are pre-aggregated independently, so a gap means a beacon arrived without a channel or a rollup increment was lost. ' +
      'Every channel share on this page is of the channel total, so the shares still add to 100% while the two totals disagree. ' +
      'The difference is shown rather than normalised away.',
  );
}

export function renderSplit(summary) {
  const split = channelSplit(summary);
  const segments = CHANNEL_SERIES.map((item) => ({
    label: CHANNEL_LABEL[item.key],
    value: split.counts[item.key],
    colorVar: item.colorVar,
  }));
  const bar = splitBar(segments, { ariaLabel: 'Share of counted scans by channel' });
  const rows = CHANNEL_SERIES.map(
    (item) =>
      '<tr>' +
      `<th scope="row"><span class="swatch" style="background:var(${item.colorVar})" aria-hidden="true"></span>${escapeHtml(CHANNEL_LABEL[item.key])}</th>` +
      `<td>${escapeHtml(formatInteger(split.counts[item.key]))}</td>` +
      `<td>${escapeHtml(formatShare(split.shares[item.key]))}</td>` +
      '</tr>',
  ).join('');

  const notes = [];
  if (!split.qrDistinguishable) {
    notes.push(
      note(
        'caution',
        QR_NOT_DISTINGUISHABLE.title,
        QR_NOT_DISTINGUISHABLE.body,
        `<p class="note-secondary">${escapeHtml(QR_NOT_DISTINGUISHABLE.ifTrulyZero)}</p>`,
      ),
    );
  }
  const reconciliation = channelReconciliationNote(summary);
  if (reconciliation) notes.push(reconciliation);

  const body =
    bar +
    '<div class="table-scroll"><table class="split-table">' +
    '<thead><tr><th scope="col">Channel</th><th scope="col">Counted scans</th><th scope="col">Share</th></tr></thead>' +
    `<tbody>${rows}</tbody></table></div>` +
    notes.join('');

  return panel(
    'split',
    PANEL.split,
    body,
    'Both channels are deduplicated by the same browser side token. The ratio is the reliable number, the totals are a floor.',
  );
}

export function renderPlatform(summary) {
  const platform = platformSplit(summary);
  const maximum = Math.max(...PLATFORM_SERIES.map((item) => platform.counts[item.key]), 0);
  const rows = PLATFORM_SERIES.map(
    (item) =>
      '<tr>' +
      `<th scope="row">${escapeHtml(PLATFORM_LABEL[item.key])}</th>` +
      `<td class="bar-cell">${rowBar(platform.counts[item.key], maximum, item.colorVar)}</td>` +
      `<td>${escapeHtml(formatInteger(platform.counts[item.key]))}</td>` +
      `<td>${escapeHtml(formatShare(platform.shares[item.key]))}</td>` +
      '</tr>',
  ).join('');
  return panel(
    'platform',
    PANEL.platform,
    '<div class="table-scroll"><table class="ranked">' +
      '<thead><tr><th scope="col">Platform</th><th scope="col"><span class="visually-hidden">Relative volume</span></th>' +
      '<th scope="col">Counted scans</th><th scope="col">Share</th></tr></thead>' +
      `<tbody>${rows}</tbody></table></div>`,
    PLATFORM_CAVEAT,
  );
}

export function renderGeography(geographySeries, summary, options = {}) {
  const geography = mergeGeography(geographySeries);
  if (geography.total === 0) {
    return panel(
      'geography',
      PANEL.geography,
      note(
        'empty',
        'No places recorded in this window',
        'Geography is written as its own rollup row per place per day. No place row exists in this window, which is what an ' +
          'empty geography looks like before launch. It is not an error and it says nothing about the scan counts elsewhere ' +
          'on this page.',
      ),
      GEOGRAPHY_CAVEAT,
    );
  }
  const places = topPlaces(geography, options.limit ?? 12);
  const maximum = places.length > 0 ? places[0].scans : 0;
  const rows = places
    .map((place) => {
      const city = place.city === null || place.city === '' ? 'Unknown city' : place.city;
      const region = place.region === null || place.region === '' ? '' : place.region;
      const where = region ? `${city}, ${region}` : city;
      return (
        '<tr>' +
        `<th scope="row">${escapeHtml(where)}</th>` +
        `<td>${escapeHtml(place.country)}</td>` +
        `<td class="bar-cell">${rowBar(place.scans, maximum)}</td>` +
        `<td>${escapeHtml(formatInteger(place.scans))}</td>` +
        `<td>${escapeHtml(formatShare(place.share))}</td>` +
        '</tr>'
      );
    })
    .join('');

  const shortfall = summary.totals.scans - geography.total;
  const shortfallNote =
    shortfall > 0
      ? note(
          'info',
          'Placed scans are fewer than counted scans',
          `${formatInteger(geography.total)} of ${formatInteger(summary.totals.scans)} counted scans carry a place. ` +
            'A scan whose CDN headers carried no country has no place row, so the shares in this panel are of placed ' +
            'scans rather than of all scans.',
        )
      : '';

  return panel(
    'geography',
    PANEL.geography,
    '<div class="table-scroll"><table class="ranked">' +
      '<thead><tr><th scope="col">City</th><th scope="col">Country</th>' +
      '<th scope="col"><span class="visually-hidden">Relative volume</span></th>' +
      '<th scope="col">Counted scans</th><th scope="col">Share of placed</th></tr></thead>' +
      `<tbody>${rows}</tbody></table></div>` +
      shortfallNote,
    GEOGRAPHY_CAVEAT,
  );
}

/**
 * Engagement, and the one place formatPercent is still correct.
 *
 * These are rates, not shares: one counted session can open more than one recipe, so a
 * value above 100% here is a real reading rather than an arithmetic impossibility. They are
 * deliberately not put through formatShare, which would report a genuine number as out of
 * range.
 */
export function renderEngagement(summary) {
  const rates = engagement(summary);
  const body =
    '<div class="tiles tiles-inline">' +
    statTile('Recipe opens', formatInteger(rates.recipeOpens), rates.recipeOpensPer100 === null ? 'No scans to compare against' : `${formatPercent(rates.recipeOpensPer100)} of counted scans`) +
    statTile('Reorder clicks', formatInteger(rates.reorderClicks), rates.reorderClicksPer100 === null ? 'No scans to compare against' : `${formatPercent(rates.reorderClicksPer100)} of counted scans`) +
    '</div>';
  return panel('engagement', PANEL.engagement, body, ENGAGEMENT_CAVEAT);
}

export function renderEmpty(selection) {
  const checks = STATES.emptyChecks.map((line) => `<li>${escapeHtml(line)}</li>`).join('');
  return (
    '<section class="panel panel-empty" aria-labelledby="empty-title">' +
    `<h2 class="panel-title" id="empty-title">${escapeHtml(STATES.emptyTitle)}</h2>` +
    `<p class="empty-window">${escapeHtml(selectionLabel(selection))}</p>` +
    `<p>${escapeHtml(STATES.emptyBody)}</p>` +
    `<ul class="empty-checks">${checks}</ul>` +
    '</section>'
  );
}

export function renderSparse(summary) {
  return note(
    'caution',
    STATES.sparseTitle,
    `${formatInteger(summary.totals.scans)} counted scans across ${formatInteger(summary.bucketsWithData)} of ` +
      `${formatInteger(summary.bucketCount)} buckets. ${STATES.sparseBody}`,
  );
}

/**
 * The blend picker's options.
 *
 * A pure function rather than a template inside the DOM wiring, for the same reason every
 * other string on this page is built here: the blend name and slug are API values, written
 * by whoever edits a blend in the admin CMS, and they reach the page through innerHTML.
 * Interpolating them raw put CMS text into markup on a page that holds a bearer token in
 * session storage. Escaping belongs next to the other escaping, and next to a test.
 */
export function renderBlendOptions(blends, selectedSlug) {
  const list = Array.isArray(blends) ? blends : [];
  const options = [
    `<option value=""${selectedSlug === null || selectedSlug === undefined ? ' selected' : ''}>All blends</option>`,
  ];
  for (const blend of list) {
    if (!blend || typeof blend.slug !== 'string') continue;
    const name = typeof blend.name === 'string' && blend.name !== '' ? blend.name : blend.slug;
    const label = blend.status === 'published' ? name : `${name} (${String(blend.status ?? 'unknown')})`;
    options.push(
      `<option value="${escapeHtml(blend.slug)}"${blend.slug === selectedSlug ? ' selected' : ''}>${escapeHtml(label)}</option>`,
    );
  }
  return options.join('');
}

export function selectionLabel(selection) {
  const blend = selection.blend ? slugToName(selection.blend) : 'All blends';
  return `${blend}, ${formatDateRange(selection.from, selection.to)}, by ${selection.granularity}`;
}

/**
 * The whole main region, from one loaded payload.
 *
 * The order is deliberate: what the numbers mean comes before the numbers.
 */
export function renderDashboard(payload) {
  const { series, geographySeries = [], selection } = payload;
  const summary = summarise(series);
  const split = channelSplit(summary);
  const rates = engagement(summary);

  const header =
    '<div class="context">' +
    `<p class="context-selection">${escapeHtml(selectionLabel(selection))}</p>` +
    `<p class="context-audience">${escapeHtml(AUDIENCE_NOTE)}</p>` +
    '</div>';

  const banner = renderMeasurementBanner(series);

  if (summary.density === 'empty') {
    return header + banner + renderEmpty(selection) + renderGeography(geographySeries, summary);
  }

  const sparse = summary.density === 'sparse' ? renderSparse(summary) : '';

  return (
    header +
    banner +
    sparse +
    renderHeadline(summary, split, rates) +
    renderVolume(summary, selection.granularity) +
    renderSplit(summary) +
    renderPlatform(summary) +
    renderGeography(geographySeries, summary) +
    renderEngagement(summary)
  );
}

/** Rendered when a request fails outright, so the page never goes blank. */
export function renderError(error) {
  const requestId = error && error.requestId ? `<p class="note-secondary">Request id ${escapeHtml(error.requestId)}</p>` : '';
  return (
    '<section class="panel panel-error" role="alert">' +
    '<h2 class="panel-title">The dashboard could not load</h2>' +
    `<p>${escapeHtml(error && error.message ? error.message : 'The request failed.')}</p>` +
    requestId +
    '<p class="note-secondary">Nothing is shown rather than something stale. This page holds no cached copy of a number.</p>' +
    '</section>'
  );
}
