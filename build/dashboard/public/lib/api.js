/**
 * The only file in this package that knows a URL.
 *
 * Two operations from the frozen API contract, version 1.0.0, and nothing else:
 *
 *   GET /v1/admin/analytics/scans   adminGetScanTimeSeries, minimum role Viewer
 *   GET /v1/admin/blends            adminListBlends, minimum role Viewer
 *
 * No endpoint here is invented and no query parameter is sent that the contract does not
 * declare. Where the dashboard wants something the contract does not offer, it is written
 * down as a gap in the README rather than worked around with a new path.
 *
 * The contract's own range limits are enforced before the request leaves, so an over long
 * window produces a sentence the reader can act on rather than a 400 they have to
 * interpret.
 */

export const OPERATIONS = {
  scanTimeSeries: { method: 'GET', path: '/v1/admin/analytics/scans', minimumRole: 'Viewer' },
  listBlends: { method: 'GET', path: '/v1/admin/blends', minimumRole: 'Viewer' },
};

/** From the contract's own description of the to parameter. */
export const MAX_DAYS = { day: 366, hour: 31 };

export class ApiError extends Error {
  constructor(message, { status, code, requestId, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status ?? 0;
    this.code = code ?? 'REQUEST_FAILED';
    this.requestId = requestId ?? null;
    this.details = details ?? [];
  }
}

function daysInclusive(from, to) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.floor((b - a) / 86400000) + 1;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Builds the query string for adminGetScanTimeSeries. Exported so a test can assert the
 * exact URL against the contract without a running server.
 */
export function scanTimeSeriesUrl({ from, to, granularity = 'day', blend = null }, baseUrl = '') {
  if (!DATE_ONLY.test(String(from))) throw new ApiError('from must be a date in YYYY-MM-DD form.', { code: 'VALIDATION_FAILED' });
  if (!DATE_ONLY.test(String(to))) throw new ApiError('to must be a date in YYYY-MM-DD form.', { code: 'VALIDATION_FAILED' });
  if (granularity !== 'day' && granularity !== 'hour') {
    throw new ApiError('granularity must be day or hour.', { code: 'VALIDATION_FAILED' });
  }
  const span = daysInclusive(from, to);
  if (span < 1) throw new ApiError('The end of the window is before its start.', { code: 'VALIDATION_FAILED' });
  if (span > MAX_DAYS[granularity]) {
    throw new ApiError(
      `That window is ${span} days. The contract allows ${MAX_DAYS[granularity]} at ${granularity} granularity. ` +
        (granularity === 'hour' ? 'Switch to day granularity for a longer window.' : 'Shorten the window.'),
      { code: 'VALIDATION_FAILED' },
    );
  }
  const params = new URLSearchParams();
  params.set('from', from);
  params.set('to', to);
  params.set('granularity', granularity);
  if (blend) params.set('blend', blend);
  return `${baseUrl}${OPERATIONS.scanTimeSeries.path}?${params.toString()}`;
}

export function listBlendsUrl(baseUrl = '') {
  return `${baseUrl}${OPERATIONS.listBlends.path}?limit=25`;
}

async function request(url, { token, fetchImpl = fetch, signal } = {}) {
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetchImpl(url, { headers, signal });
  } catch (cause) {
    throw new ApiError('The analytics API could not be reached.', { code: 'NETWORK_UNAVAILABLE' });
  }
  const text = await response.text();
  let body = null;
  if (text !== '') {
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiError('The analytics API returned something that is not JSON.', {
        status: response.status,
        code: 'MALFORMED_RESPONSE',
      });
    }
  }
  if (!response.ok) {
    const envelope = body && body.error ? body.error : {};
    throw new ApiError(envelope.message ?? `The request failed with status ${response.status}.`, {
      status: response.status,
      code: envelope.code ?? 'REQUEST_FAILED',
      requestId: envelope.requestId ?? response.headers.get('x-request-id'),
      details: envelope.details ?? [],
    });
  }
  return body;
}

export async function fetchScanTimeSeries(options, config = {}) {
  const url = scanTimeSeriesUrl(options, config.baseUrl ?? '');
  return request(url, config);
}

export async function fetchBlends(config = {}) {
  return request(listBlendsUrl(config.baseUrl ?? ''), config);
}

/**
 * The five real slugs. Read from the API when it answers, and only used as a fallback for
 * the geography fan out below when the blend list is unavailable, so a failed list request
 * degrades the picker rather than emptying the page.
 */
export const FALLBACK_SLUGS = [
  'persian-sunrise',
  'caribbean-sunset',
  'silk-road',
  'north-african-night-market',
  'kyoto-garden',
];

/**
 * One dashboard load.
 *
 * Every request this issues is a rollup range query behind adminGetScanTimeSeries, plus one
 * blend list. There is no request here for a raw scan event, because the contract exposes
 * no such read and this page would not use it if it did.
 *
 * The geography fan out, stated plainly because it is the one place the shape is not
 * obvious: the contract returns topCities only on a daily series for a named blend. For the
 * all blends view the dashboard therefore issues one daily series per blend and sums the
 * place rows. That is five bounded partition queries, not a scan, and it is bounded by the
 * number of blends rather than by the number of scans. A ROLLUP#ALL#GEO#DAY partition would
 * make it one query and is recommended as an additive change. See the README, "Gaps".
 */
export async function loadDashboard({ from, to, granularity = 'day', blend = null }, config = {}) {
  const [seriesResult, blendsResult] = await Promise.allSettled([
    fetchScanTimeSeries({ from, to, granularity, blend }, config),
    fetchBlends(config),
  ]);

  if (seriesResult.status === 'rejected') throw seriesResult.reason;
  const series = seriesResult.value;
  const blends = blendsResult.status === 'fulfilled' && blendsResult.value && Array.isArray(blendsResult.value.data)
    ? blendsResult.value.data
    : [];

  const geographySeries = [];
  const geographyRequests = [];

  if (blend && granularity === 'day') {
    // The main series already carries the place rows. No second request.
    geographySeries.push(series);
  } else {
    const slugs = blend ? [blend] : (blends.length > 0 ? blends.map((item) => item.slug) : FALLBACK_SLUGS);
    for (const slug of slugs) {
      geographyRequests.push(fetchScanTimeSeries({ from, to, granularity: 'day', blend: slug }, config));
    }
  }

  const geographyResults = await Promise.allSettled(geographyRequests);
  const geographyFailures = [];
  for (const result of geographyResults) {
    if (result.status === 'fulfilled') geographySeries.push(result.value);
    else geographyFailures.push(result.reason);
  }

  return { series, blends, geographySeries, geographyFailures };
}
