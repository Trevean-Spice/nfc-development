/**
 * Formatting, and the one rule that matters here: a zero denominator produces null, never
 * NaN, never Infinity, and never a silent zero.
 *
 * Before launch almost every denominator on this page is zero. A dashboard that renders
 * "NaN%" in that state gets reported as broken, and a dashboard that renders "0%" is
 * telling the reader something it does not know. Both are worse than saying so.
 */

/** The escape used on every value that reaches the page. City names come from CDN headers. */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A share in 0..1, or null when the denominator is zero or either side is not a number. */
export function share(part, whole) {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  return part / whole;
}

/** A rate per 100 scans, or null. Kept separate from share so the label cannot drift. */
export function per100(part, whole) {
  const s = share(part, whole);
  return s === null ? null : s * 100;
}

export function formatInteger(value) {
  if (!Number.isFinite(value)) return 'not measured';
  return Math.round(value).toLocaleString('en-GB');
}

/**
 * A ratio rendered as a percentage. Use this only where the number is genuinely allowed to
 * exceed 100%, which on this page is the engagement rates: one counted session can open
 * more than one recipe, so "recipe opens as a percentage of counted scans" above 100% is a
 * real reading rather than a broken one.
 */
export function formatPercent(fraction, digits = 1) {
  if (fraction === null || !Number.isFinite(fraction)) return 'not measured';
  const pct = fraction * 100;
  // Whole numbers read better without a trailing zero, and a share below 0.1% is reported
  // as such rather than rounded to 0.0%, which would read as none at all.
  if (pct > 0 && pct < 0.1) return 'under 0.1%';
  return `${pct.toFixed(digits)}%`;
}

/**
 * A share OF A WHOLE, which is a different thing from a ratio and has a different
 * contract: it lives in 0..1, and a value outside that range is not a small error in a
 * percentage, it is a statement that a part is bigger than the whole it is part of.
 *
 * Everything here that divides one counter by a total of counters goes through this rather
 * than through formatPercent. The reason is the reason this dashboard exists: a legend
 * printing "400.0%" in the same weight and the same colour as "40.0%" is a confidently
 * wrong number, and a confidently wrong number is worse than a missing one. The page says
 * above the numbers that it will not imply a precision it does not have, so it must not
 * render an arithmetic impossibility as though it were a measurement.
 *
 * Out of range renders as a stated impossibility with the offending value beside it, not as
 * "not measured": the value was measured, it is the counters that disagree, and hiding it
 * would remove the only evidence of the disagreement.
 */
export function formatShare(fraction, digits = 1) {
  if (fraction === null || !Number.isFinite(fraction)) return 'not measured';
  if (fraction < 0 || fraction > 1) return `out of range, ${(fraction * 100).toFixed(digits)}%`;
  return formatPercent(fraction, digits);
}

export function formatMs(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'not measured';
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

/** YYYY-MM-DD or YYYY-MM-DDTHH, rendered for a person, always in UTC. */
export function formatBucket(bucket) {
  if (typeof bucket !== 'string') return '';
  const hourly = bucket.includes('T');
  const day = hourly ? bucket.slice(0, 10) : bucket;
  const parts = day.split('-');
  if (parts.length !== 3) return bucket;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthIndex = Number.parseInt(parts[1], 10) - 1;
  const month = months[monthIndex] ?? parts[1];
  const label = `${Number.parseInt(parts[2], 10)} ${month}`;
  return hourly ? `${label} ${bucket.slice(11, 13)}:00 UTC` : label;
}

export function formatDateRange(from, to) {
  return from === to ? formatBucket(from) : `${formatBucket(from)} to ${formatBucket(to)}`;
}

/** Blend slug to a readable name, used only as a fallback when the API list is unavailable. */
export function slugToName(slug) {
  if (typeof slug !== 'string' || slug === '') return 'All blends';
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** UTC date arithmetic, because every bucket key in the rollups is UTC. */
export function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDay(date);
}

export function daysInclusive(from, to) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.floor((b - a) / 86400000) + 1;
}
