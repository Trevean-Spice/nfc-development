import type { FastifyInstance } from 'fastify';
import { requireOperation } from '../auth/guard.js';
import type { ScanTimeSeries } from '../api/types.js';
import { apiFailure } from '../views/components.js';
import { html, join, type RawHtml } from '../views/html.js';
import { page } from '../views/layout.js';
import { apiFor, sendHtml } from './support.js';

/**
 * Scan analytics, read from pre-aggregated rollups and never from raw events.
 *
 * Two statements on this screen are not decoration and must not be removed:
 *
 *   Every count is deduplicated by a browser side token, for NFC and for QR alike, because
 *   per SKU tag encoding provides no per tag counter. The two channels are directly
 *   comparable to each other and neither is a per jar count. The API returns that on every
 *   response as `measurementMethod`, and this screen renders it rather than quietly dropping
 *   it, so the dashboard never implies a precision the hardware does not give.
 *
 *   The source is the rollup. The API declares `source: rollup` as its only permitted value.
 *   A dashboard reading raw events is the failure the data model exists to prevent.
 */

function bar(value: number, max: number): RawHtml {
  const width = max <= 0 ? 0 : Math.round((value / max) * 100);
  return html`<span class="bar"><span style="width:${width}%"></span></span>`;
}

export async function registerAnalyticsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { from?: string; to?: string; blend?: string; granularity?: string } }>(
    '/analytics',
    async (request, reply) => {
      const principal = requireOperation(request, 'adminGetScanTimeSeries');
      const api = apiFor(request);

      const today = new Date();
      const iso = (d: Date): string => d.toISOString().slice(0, 10);
      const to = request.query.to ?? iso(today);
      const from = request.query.from ?? iso(new Date(today.getTime() - 29 * 86400000));
      const blend = request.query.blend ?? '';
      const granularity = request.query.granularity === 'hour' ? 'hour' : 'day';

      let series: ScanTimeSeries | undefined;
      let failure: RawHtml | undefined;
      try {
        series = await api.scanTimeSeries({ from, to, granularity, blend: blend || undefined });
      } catch (err) {
        failure = apiFailure(err);
      }

      const points = series?.points ?? [];
      const maxScans = points.reduce((m, p) => Math.max(m, p.scans), 0);
      const total = points.reduce((sum, p) => sum + p.scans, 0);

      const body = html`<section class="card">
        <h1>Scans</h1>
        <form method="get" action="/analytics" class="filters">
          <label>From <input type="date" name="from" value="${from}" /></label>
          <label>To <input type="date" name="to" value="${to}" /></label>
          <label>Blend
            <select name="blend">
              <option value="">all blends</option>
              ${join(
                ['persian-sunrise', 'caribbean-sunset', 'north-african-night-market', 'silk-road', 'kyoto-garden'].map(
                  (s) => html`<option value="${s}"${s === blend ? html` selected` : ''}>${s}</option>`,
                ),
              )}
            </select>
          </label>
          <label>Granularity
            <select name="granularity">
              <option value="day"${granularity === 'day' ? html` selected` : ''}>day</option>
              <option value="hour"${granularity === 'hour' ? html` selected` : ''}>hour</option>
            </select>
          </label>
          <button class="btn" type="submit">Show</button>
        </form>

        ${failure ?? ''}

        ${series
          ? html`<div class="flash flash-warn">
              <b>How these numbers are counted</b>
              <p>${series.measurementNote ?? 'NFC and QR counts are deduplicated by the same browser side token, because per SKU tag encoding provides no per tag counter.'}</p>
              <p class="hint">Measurement method: ${series.measurementMethod}. Source: ${series.source}, which is a pre-aggregated rollup and never a table scan.</p>
            </div>`
          : ''}

        <p class="hint">${total} scan${total === 1 ? '' : 's'} across ${points.length} bucket${points.length === 1 ? '' : 's'}.</p>

        <table class="grid">
          <thead>
            <tr><th>Bucket</th><th>Scans</th><th></th><th>NFC</th><th>QR</th><th>Direct</th><th>iOS</th><th>Android</th><th>Reorder clicks</th><th>Readable p95</th></tr>
          </thead>
          <tbody>
            ${join(
              points.map(
                (p) => html`<tr>
                  <td>${p.bucket}</td>
                  <td>${p.scans}</td>
                  <td class="barcell">${bar(p.scans, maxScans)}</td>
                  <td>${p.byChannel?.nfc ?? 0}</td>
                  <td>${p.byChannel?.qr ?? 0}</td>
                  <td>${p.byChannel?.direct ?? 0}</td>
                  <td>${p.byPlatform?.ios ?? 0}</td>
                  <td>${p.byPlatform?.android ?? 0}</td>
                  <td>${p.reorderClicks ?? 0}</td>
                  <td>${p.timeToReadable?.p95Ms ? `${p.timeToReadable.p95Ms} ms` : 'no data'}</td>
                </tr>`,
              ),
            )}
          </tbody>
        </table>
        ${points.length === 0 && !failure
          ? html`<p class="empty">No rollup rows in this range. On a fresh local stack there are no scans yet, which is not a failure.</p>`
          : ''}
      </section>`;

      return sendHtml(reply, page({ title: 'Scans', principal, active: 'analytics', wide: true }, body));
    },
  );
}
