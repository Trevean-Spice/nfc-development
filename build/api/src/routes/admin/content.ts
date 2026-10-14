import type { FastifyInstance, FastifyRequest } from 'fastify';
import { actorOf, requireRole } from '../../http/context.js';
import { ErrorCodes, notFound, versionConflict } from '../../http/errors.js';
import { parseInclude, validateBody } from '../../http/validation.js';
import { isKnownSlug } from '../../http/spec.js';
import { createBlend, getBlend, setRecipeCount, updateBlend } from '../../repositories/blends.js';
import { attachBlend, createGrower, detachBlend, getGrower, updateGrower } from '../../repositories/growers.js';
import { archiveRecipe, countPublishedRecipes, createRecipe, getRecipe, updateRecipe } from '../../repositories/recipes.js';
import { recall, remember } from '../../repositories/idempotency.js';
import { toBlend, toGrower, toRecipe } from '../../services/mappers.js';
import { tagCodeForSlug } from '../../services/redirectTable.js';
import { newGrowerId, newRecipeId, isGrowerId, isRecipeId } from '../../util/ids.js';
import { buildBlendPayload, hydrateMedia, listBlendsHandler } from '../content.js';

/**
 * Admin content authoring. Every operation in this file is behind a bearer JWT and a role
 * check, and every write is conditional on the version the editor read.
 *
 * The failure mode optimistic concurrency prevents in this product is not an abstract lost
 * update. It is two editors saving over each other and the page a customer reaches by
 * tapping a jar showing the wrong story.
 */

async function withIdempotency<T>(
  request: FastifyRequest,
  subject: string,
  produce: () => Promise<{ status: number; body: T }>,
): Promise<{ status: number; body: T; replayed: boolean }> {
  const key = request.headers['idempotency-key'];
  const idempotencyKey = Array.isArray(key) ? key[0] : key;
  if (!idempotencyKey) {
    const fresh = await produce();
    return { ...fresh, replayed: false };
  }
  const previous = await recall(subject, idempotencyKey);
  if (previous) return { status: previous.status, body: previous.body as T, replayed: true };
  const fresh = await produce();
  await remember(subject, idempotencyKey, { status: fresh.status, body: fresh.body });
  return { ...fresh, replayed: false };
}

function requireBlend(slug: string) {
  return async () => {
    const blend = await getBlend(slug);
    if (!blend) {
      throw notFound(ErrorCodes.BLEND_NOT_FOUND, `No blend exists with slug '${slug}'.`, [
        { field: 'slug', issue: 'not_found' },
      ]);
    }
    return blend;
  };
}

export async function registerAdminContentRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { status?: string; limit?: string; cursor?: string } }>(
    '/v1/admin/blends',
    { preHandler: requireRole('Viewer') },
    async (request, reply) =>
      // This operation declares no 400 response, so query parameters are clamped rather
      // than rejected.
      listBlendsHandler(request, reply, { authenticated: true, strictValidation: false }),
  );

  app.post('/v1/admin/blends', { preHandler: requireRole('Editor') }, async (request, reply) => {
    const input = validateBody<Record<string, unknown>>('#/components/schemas/BlendCreate', request.body);
    const actor = actorOf(request);
    const slug = input['slug'] as string;

    const outcome = await withIdempotency(request, request.principal?.subject ?? 'unknown', async () => {
      const { slug: _slug, name, ...rest } = input as { slug: string; name: string } & Record<string, unknown>;
      const created = await createBlend({
        slug,
        name,
        actor,
        // A blend is always created as a draft. Creating never publishes, so an accidental
        // save can never put a page live.
        fields: { ...rest, status: 'draft', tagCode: tagCodeForSlug(slug) } as never,
      });
      if (created.growerId) await attachBlend(created.growerId, slug);
      const media = await hydrateMedia([created.heroImageId]);
      return { status: 201, body: toBlend(created, media) };
    });

    reply.status(outcome.status);
    reply.header('location', `/v1/blends/${slug}`);
    return outcome.body;
  });

  app.get<{ Params: { slug: string }; Querystring: { include?: string | string[] } }>(
    '/v1/admin/blends/:slug',
    { preHandler: requireRole('Viewer') },
    async (request) => {
      const { slug } = request.params;
      if (!isKnownSlug(slug)) {
        throw notFound(ErrorCodes.BLEND_NOT_FOUND, `No blend exists with slug '${slug}'.`, [
          { field: 'slug', issue: 'not_found' },
        ]);
      }
      const blend = await requireBlend(slug)();
      const include = parseInclude(request.query.include);
      // Draft recipes are visible here and nowhere else. Preview before publish uses a
      // short lived signed preview token on the rendering side, not the public route.
      return buildBlendPayload(blend, include, { includeDraftRecipes: true });
    },
  );

  app.patch<{ Params: { slug: string } }>(
    '/v1/admin/blends/:slug',
    { preHandler: requireRole('Editor') },
    async (request) => {
      const { slug } = request.params;
      if (!isKnownSlug(slug)) {
        throw notFound(ErrorCodes.BLEND_NOT_FOUND, `No blend exists with slug '${slug}'.`, [
          { field: 'slug', issue: 'not_found' },
        ]);
      }
      const existing = await requireBlend(slug)();
      const input = validateBody<Record<string, unknown>>('#/components/schemas/BlendUpdate', request.body);
      const { version, ...changes } = input as { version: number } & Record<string, unknown>;

      const updated = await updateBlend(slug, version, changes, actorOf(request));

      // The grower back-pointer is what lets the CMS tell an editor which blends need
      // republishing after a grower edit, so it has to be maintained on both sides of a
      // reassignment.
      if ('growerId' in changes && changes['growerId'] !== existing.growerId) {
        if (existing.growerId) await detachBlend(existing.growerId, slug);
        if (typeof changes['growerId'] === 'string') await attachBlend(changes['growerId'], slug);
      }

      const media = await hydrateMedia([updated.heroImageId, ...(updated.galleryImageIds ?? [])]);
      return toBlend(updated, media);
    },
  );

  app.post('/v1/admin/recipes', { preHandler: requireRole('Editor') }, async (request, reply) => {
    const input = validateBody<Record<string, unknown>>('#/components/schemas/RecipeCreate', request.body);
    const blendSlug = input['blendSlug'] as string;
    await requireBlend(blendSlug)();

    const outcome = await withIdempotency(request, request.principal?.subject ?? 'unknown', async () => {
      const recipeId = newRecipeId();
      const created = await createRecipe({
        recipeId,
        blendSlug,
        title: input['title'] as string,
        summary: (input['summary'] as string | null) ?? null,
        servings: (input['servings'] as number | null) ?? null,
        prepMinutes: (input['prepMinutes'] as number | null) ?? null,
        cookMinutes: (input['cookMinutes'] as number | null) ?? null,
        difficulty: (input['difficulty'] as string | null) ?? null,
        ingredients: (input['ingredients'] as Array<Record<string, unknown>>) ?? [],
        steps: (input['steps'] as string[]) ?? [],
        imageId: (input['imageId'] as string | null) ?? null,
        sortOrder: (input['sortOrder'] as number) ?? 0,
        status: ((input['status'] as string) ?? 'draft') as 'draft' | 'published',
      });
      await setRecipeCount(blendSlug, await countPublishedRecipes(blendSlug));
      const media = await hydrateMedia([created.imageId]);
      return { status: 201, body: toRecipe(created, media) };
    });

    reply.status(outcome.status);
    return outcome.body;
  });

  app.patch<{ Params: { recipeId: string } }>(
    '/v1/admin/recipes/:recipeId',
    { preHandler: requireRole('Editor') },
    async (request) => {
      const { recipeId } = request.params;
      const current = isRecipeId(recipeId) ? await getRecipe(recipeId) : undefined;
      if (!current) {
        throw notFound(ErrorCodes.RECIPE_NOT_FOUND, `No recipe exists with id '${recipeId}'.`, [
          { field: 'recipeId', issue: 'not_found' },
        ]);
      }
      const input = validateBody<Record<string, unknown>>('#/components/schemas/RecipeUpdate', request.body);
      const { version, ...changes } = input as { version: number } & Record<string, unknown>;
      if (current.version !== version) {
        throw versionConflict(`This recipe was changed at ${current.updatedAt}. Reload before saving.`);
      }
      const updated = await updateRecipe(current, version, changes);
      await setRecipeCount(current.blendSlug, await countPublishedRecipes(current.blendSlug));
      const media = await hydrateMedia([updated.imageId]);
      return toRecipe(updated, media);
    },
  );

  app.delete<{ Params: { recipeId: string } }>(
    '/v1/admin/recipes/:recipeId',
    { preHandler: requireRole('Editor') },
    async (request, reply) => {
      const { recipeId } = request.params;
      const current = isRecipeId(recipeId) ? await getRecipe(recipeId) : undefined;
      if (!current) {
        throw notFound(ErrorCodes.RECIPE_NOT_FOUND, `No recipe exists with id '${recipeId}'.`, [
          { field: 'recipeId', issue: 'not_found' },
        ]);
      }
      await archiveRecipe(current);
      await setRecipeCount(current.blendSlug, await countPublishedRecipes(current.blendSlug));
      return reply.status(204).send();
    },
  );

  app.post('/v1/admin/growers', { preHandler: requireRole('Editor') }, async (request, reply) => {
    const input = validateBody<Record<string, unknown>>('#/components/schemas/GrowerCreate', request.body);
    const outcome = await withIdempotency(request, request.principal?.subject ?? 'unknown', async () => {
      const created = await createGrower({
        growerId: newGrowerId(),
        name: input['name'] as string,
        farmName: (input['farmName'] as string | null) ?? null,
        country: (input['country'] as string | null) ?? null,
        region: (input['region'] as string | null) ?? null,
        bio: (input['bio'] as string | null) ?? null,
        yearsFarming: (input['yearsFarming'] as number | null) ?? null,
        portraitId: (input['portraitId'] as string | null) ?? null,
        farm: (input['farm'] as { latitude: number; longitude: number } | null) ?? null,
        blendSlugs: [],
      });
      const media = await hydrateMedia([created.portraitId]);
      return { status: 201, body: toGrower(created, media) };
    });
    reply.status(outcome.status);
    return outcome.body;
  });

  app.patch<{ Params: { growerId: string } }>(
    '/v1/admin/growers/:growerId',
    { preHandler: requireRole('Editor') },
    async (request) => {
      const { growerId } = request.params;
      const current = isGrowerId(growerId) ? await getGrower(growerId) : undefined;
      if (!current) {
        throw notFound(ErrorCodes.GROWER_NOT_FOUND, `No grower exists with id '${growerId}'.`, [
          { field: 'growerId', issue: 'not_found' },
        ]);
      }
      const input = validateBody<Record<string, unknown>>('#/components/schemas/GrowerUpdate', request.body);
      const { version, ...changes } = input as { version: number } & Record<string, unknown>;
      const updated = await updateGrower(growerId, version, changes);

      // A grower edit does not change any already generated page, because the grower record
      // is snapshotted into the page at build time. Rather than leave the editor to
      // remember that, the response says exactly which published blends now hold a stale
      // snapshot.
      const affected: string[] = [];
      for (const slug of updated.blendSlugs ?? []) {
        const blend = await getBlend(slug);
        if (blend?.status === 'published') affected.push(slug);
      }

      const media = await hydrateMedia([updated.portraitId]);
      return { ...toGrower(updated, media), republishRequiredFor: affected };
    },
  );
}
