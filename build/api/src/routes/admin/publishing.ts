import type { FastifyInstance } from 'fastify';
import { actorOf, requireRole } from '../../http/context.js';
import { ErrorCodes, notFound, publishBlocked, versionConflict } from '../../http/errors.js';
import { bodyPointer, validateBody } from '../../http/validation.js';
import { isKnownSlug } from '../../http/spec.js';
import { getBlend, updateBlend, writeSnapshot } from '../../repositories/blends.js';
import { publishBlockers } from '../../services/publish.js';
import { enqueueRevalidation, pathsForBlend } from '../../services/revalidation.js';
import { nowIso } from '../../util/time.js';

/**
 * Publish and revalidate.
 *
 * Publish returns 202 rather than 200 because it does NOT wait for regeneration. The
 * previous version keeps serving until the new one is ready, so no customer waits for a
 * render and no editor waits for a deploy. SOW section 6.2 requires content live within 5
 * minutes; this is expected to complete in seconds.
 *
 * The manual revalidate endpoint is the escape hatch for the case where the cache and the
 * data disagree. It will be needed at least once during this engagement, and building it
 * now is cheaper than needing it at 22:00 on 26 September.
 */

export async function registerAdminPublishingRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { slug: string } }>(
    '/v1/admin/blends/:slug/publish',
    { preHandler: requireRole('Editor') },
    async (request, reply) => {
      const { slug } = request.params;
      if (!isKnownSlug(slug)) {
        throw notFound(ErrorCodes.BLEND_NOT_FOUND, `No blend exists with slug '${slug}'.`, [
          { field: 'slug', issue: 'not_found' },
        ]);
      }
      const blend = await getBlend(slug);
      if (!blend) {
        throw notFound(ErrorCodes.BLEND_NOT_FOUND, `No blend exists with slug '${slug}'.`, [
          { field: 'slug', issue: 'not_found' },
        ]);
      }

      const body = validateBody<{ version?: number; note?: string | null }>(
        bodyPointer('/v1/admin/blends/{slug}/publish', 'post'),
        request.body ?? {},
      );

      // The version guard exists so a publish cannot put a stale draft live after somebody
      // else has saved over it.
      if (typeof body?.version === 'number' && body.version !== blend.version) {
        throw versionConflict(
          `This blend was changed by ${blend.updatedBy ?? 'another editor'} at ${blend.updatedAt}. Reload before publishing.`,
        );
      }

      const blockers = await publishBlockers(blend);
      if (blockers.length > 0) throw publishBlocked(blockers);

      const publishedAt = nowIso();
      const updated = await updateBlend(
        slug,
        blend.version,
        { status: 'published', publishedAt, publishNote: body?.note ?? null },
        actorOf(request),
      );

      // An immutable published snapshot, so what was live at a point in time can be read
      // back rather than reconstructed.
      await writeSnapshot(updated);

      const paths = pathsForBlend(slug);
      const job = await enqueueRevalidation(paths, body?.note ?? null, actorOf(request));

      reply.status(202);
      return {
        slug,
        status: updated.status,
        version: updated.version,
        publishedAt,
        revalidationId: job.revalidationId,
        paths: job.paths,
      };
    },
  );

  app.post('/v1/admin/revalidate', { preHandler: requireRole('Editor') }, async (request, reply) => {
    const input = validateBody<{ blendSlugs?: string[]; paths?: string[]; reason?: string | null }>(
      '#/components/schemas/RevalidateRequest',
      request.body ?? {},
    );

    const paths = [
      ...(input.blendSlugs ?? []).flatMap((slug) => pathsForBlend(slug)),
      ...(input.paths ?? []),
    ];

    const job = await enqueueRevalidation(paths, input.reason ?? null, actorOf(request));
    reply.status(202);
    return job;
  });
}
