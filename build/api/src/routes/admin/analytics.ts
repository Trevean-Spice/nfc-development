import type { FastifyInstance } from 'fastify';
import { requireRole } from '../../http/context.js';
import { badRequest } from '../../http/errors.js';
import { isKnownSlug } from '../../http/spec.js';
import { MEASUREMENT_NOTE, scanTimeSeries } from '../../services/analytics.js';
import { daysBetweenInclusive, isValidDateOnly } from '../../util/time.js';

/**
 * GET /v1/admin/analytics/scans.
 *
 * Reads pre-aggregated rollups. Never raw events, never a Scan. source is "rollup" as the
 * only permitted value in the frozen document, which turns that rule into a contract test
 * assertion rather than a convention somebody remembers.
 *
 * measurementMethod is "browser_token" on every response, and it is not decoration. Per
 * SKU tag encoding means there is no per-tag counter and no chip UID available to the
 * page, so NFC and QR are deduplicated by exactly the same browser side mechanism. The
 * dashboard states that rather than implying an NFC precision the encoding does not
 * provide.
 */

const MAX_DAYS = { day: 366, hour: 31 } as const;

export async function registerAdminAnalyticsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { from?: string; to?: string; granularity?: string; blend?: string } }>(
    '/v1/admin/analytics/scans',
    { preHandler: requireRole('Viewer') },
    async (request) => {
      const { from, to } = request.query;
      const granularity = (request.query.granularity ?? 'day') as 'hour' | 'day';
      const blend = request.query.blend;

      if (!from || !isValidDateOnly(from)) {
        throw badRequest('1 field failed validation.', [{ field: 'from', issue: from ? 'invalid_format' : 'required' }]);
      }
      if (!to || !isValidDateOnly(to)) {
        throw badRequest('1 field failed validation.', [{ field: 'to', issue: to ? 'invalid_format' : 'required' }]);
      }
      if (granularity !== 'day' && granularity !== 'hour') {
        throw badRequest('1 field failed validation.', [{ field: 'granularity', issue: 'not_in_enum' }]);
      }
      if (blend !== undefined && !isKnownSlug(blend)) {
        throw badRequest('1 field failed validation.', [{ field: 'blend', issue: 'not_in_enum' }]);
      }
      const span = daysBetweenInclusive(from, to);
      if (span < 1) {
        throw badRequest('1 field failed validation.', [{ field: 'to', issue: 'before_from' }]);
      }
      if (span > MAX_DAYS[granularity]) {
        throw badRequest(`Range exceeds ${MAX_DAYS[granularity]} days at ${granularity} granularity.`, [
          { field: 'to', issue: 'range_too_large' },
        ]);
      }

      const points = await scanTimeSeries({ blend, granularity, from, to });

      return {
        blend: blend ?? null,
        granularity,
        from,
        to,
        measurementMethod: 'browser_token',
        measurementNote: MEASUREMENT_NOTE,
        source: 'rollup',
        points,
      };
    },
  );
}
