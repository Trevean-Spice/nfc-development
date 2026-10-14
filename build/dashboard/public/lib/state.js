/**
 * The controls, as data.
 *
 * Self serve means the person asking the question can change the window without asking an
 * engineer, so the presets, the granularity rules and the contract's own range limits live
 * here as pure functions and are covered by tests rather than discovered by a 400.
 */

import { MAX_DAYS } from './api.js';
import { addDays, daysInclusive } from './format.js';

export const PRESETS = [
  { id: 'last7', label: 'Last 7 days', days: 7, granularity: 'day' },
  { id: 'last30', label: 'Last 30 days', days: 30, granularity: 'day' },
  { id: 'last90', label: 'Last 90 days', days: 90, granularity: 'day' },
  { id: 'last48h', label: 'Last 48 hours', days: 2, granularity: 'hour' },
];

/** Windows are inclusive of both ends and always UTC, because every rollup key is UTC. */
export function presetRange(preset, today) {
  const to = today;
  const from = addDays(today, -(preset.days - 1));
  return { from, to, granularity: preset.granularity };
}

export function granularityAllowed(from, to, granularity) {
  const span = daysInclusive(from, to);
  return span >= 1 && span <= MAX_DAYS[granularity];
}

/**
 * Keeps a selection legal against the contract without silently changing what was asked
 * for. An hour granularity request over more than 31 days is refused with a reason rather
 * than quietly downgraded, because a chart that answers a different question from the one
 * on the control is worse than an error.
 */
export function validateSelection(selection) {
  const span = daysInclusive(selection.from, selection.to);
  if (span < 1) {
    return { ok: false, reason: 'The end of the window is before its start.' };
  }
  if (span > MAX_DAYS[selection.granularity]) {
    return {
      ok: false,
      reason:
        `That window is ${span} days. The API serves ${MAX_DAYS[selection.granularity]} days at ` +
        `${selection.granularity} granularity.` +
        (selection.granularity === 'hour' ? ' Switch to day granularity for a longer window.' : ''),
    };
  }
  return { ok: true, reason: '' };
}

/** The selection encoded into the address bar, so a view can be sent to somebody else. */
export function selectionToQuery(selection) {
  const params = new URLSearchParams();
  params.set('from', selection.from);
  params.set('to', selection.to);
  params.set('granularity', selection.granularity);
  if (selection.blend) params.set('blend', selection.blend);
  return params.toString();
}

export function selectionFromQuery(queryString, fallback) {
  const params = new URLSearchParams(queryString);
  const from = params.get('from');
  const to = params.get('to');
  const granularity = params.get('granularity');
  const blend = params.get('blend');
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  return {
    from: dateOnly.test(from ?? '') ? from : fallback.from,
    to: dateOnly.test(to ?? '') ? to : fallback.to,
    granularity: granularity === 'hour' || granularity === 'day' ? granularity : fallback.granularity,
    blend: blend && blend !== '' ? blend : null,
  };
}
