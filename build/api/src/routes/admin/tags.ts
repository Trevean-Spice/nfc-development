import type { FastifyInstance } from 'fastify';
import { requireRole } from '../../http/context.js';
import { listTagRecords } from '../../repositories/tags.js';
import { toTagRecord } from '../../services/mappers.js';

/**
 * GET /v1/admin/tags. READ ONLY, for every role including Admin.
 *
 * The redirect table is a version controlled artifact deployed with the application, never
 * hand edited state in a hosting console. A thousand encoded and possibly write protected
 * tags resolve through it, so a change is a code review and a deployment, not a form
 * submission. There is no write operation here and there must not be one added.
 *
 * This exists so an operator can verify what is actually deployed without cloning the
 * repository, and so verification against physical tags before and after a change of
 * production host can be recorded.
 */

export async function registerAdminTagRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/admin/tags', { preHandler: requireRole('Admin') }, async () => {
    const items = await listTagRecords();
    const deployedAt = items.map((i) => i.deployedAt).filter((v): v is string => Boolean(v)).sort().at(-1);
    const sourceCommit = items.find((i) => i.sourceCommit)?.sourceCommit ?? null;
    return {
      ...(deployedAt ? { deployedAt } : {}),
      sourceCommit,
      data: items.map(toTagRecord),
    };
  });
}
