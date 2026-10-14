import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { CACHE_ADMIN, CACHE_PUBLIC_CONTENT, collectionTag, entityTag, ifNoneMatchSatisfied } from '../http/cache.js';
import { attachOptionalPrincipal } from '../http/context.js';
import { ErrorCodes, notFound } from '../http/errors.js';
import { decodeCursor, encodeCursor, parseLimit } from '../http/pagination.js';
import { isKnownSlug } from '../http/spec.js';
import { parseInclude } from '../http/validation.js';
import { getBlend, listSummaries, queryByStatus, type BlendItem, type ContentStatus } from '../repositories/blends.js';
import { getGrower, listGrowers } from '../repositories/growers.js';
import { getManyMedia, type MediaItem } from '../repositories/media.js';
import { getRecipe, listRecipesForBlend, type RecipeItem } from '../repositories/recipes.js';
import { toBlend, toBlendSummary, toGrower, toRecipe } from '../services/mappers.js';
import { isGrowerId, isRecipeId } from '../util/ids.js';

/**
 * Public content reads. BUILD AND REVALIDATE TIME ONLY. NEVER ON A TAP.
 *
 * Unauthenticated, because every byte these return is already public in the rendered page.
 * Adding a secret to the build process would protect nothing and would put a credential
 * into a CI environment for no gain. Only published content is served without a
 * credential: draft and archived content returns 404 to an unauthenticated caller.
 *
 * A note on status codes, because it is the one place this implementation had to choose.
 * The path parameter schema enumerates the five real slugs, but these operations do not
 * declare a 400 response, and the contract's own 404 example is a misspelt slug
 * ('persian-sunrize') answered with BLEND_NOT_FOUND. An unknown or malformed slug on a
 * path therefore returns 404, never 400, so no response falls outside the documented set.
 * Request bodies are different: there the enum is enforced and the answer is 400.
 */

export async function hydrateMedia(ids: Array<string | null | undefined>): Promise<Map<string, MediaItem>> {
  const wanted = ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (wanted.length === 0) return new Map();
  return getManyMedia(wanted);
}

function isVisible(item: BlendItem | undefined, authenticated: boolean): item is BlendItem {
  if (!item) return false;
  return authenticated || item.status === 'published';
}

function blendNotFound(slug: string): never {
  throw notFound(ErrorCodes.BLEND_NOT_FOUND, `No published blend exists with slug '${slug}'.`, [
    { field: 'slug', issue: 'not_found' },
  ]);
}

interface ListQuery {
  status?: string;
  limit?: string;
  cursor?: string;
}

export async function listBlendsHandler(
  request: FastifyRequest<{ Querystring: ListQuery }>,
  reply: FastifyReply,
  options: { authenticated: boolean; strictValidation: boolean },
): Promise<unknown> {
  const limit = parseLimit(request.query.limit, options.strictValidation);
  const cursor = decodeCursor(request.query.cursor, options.strictValidation);

  // An unauthenticated caller may only request published, and any other value returns
  // published only rather than an error. Frozen document, StatusFilter parameter.
  const requested = request.query.status as ContentStatus | undefined;
  const statuses: ContentStatus[] = options.authenticated
    ? requested && ['draft', 'published', 'archived'].includes(requested)
      ? [requested]
      : ['draft', 'published', 'archived']
    : ['published'];

  let items: BlendItem[];
  let nextCursor: string | null = null;

  if (statuses.length === 1) {
    const page = await queryByStatus(statuses[0] as ContentStatus, limit, cursor?.['k'] as Record<string, unknown> | undefined);
    items = page.items;
    nextCursor = page.lastKey ? encodeCursor({ k: page.lastKey }) : null;
  } else {
    const offset = typeof cursor?.['o'] === 'number' ? (cursor['o'] as number) : 0;
    const page = await listSummaries(statuses, limit, offset);
    items = page.items;
    nextCursor = page.nextOffset === undefined ? null : encodeCursor({ o: page.nextOffset });
  }

  const media = await hydrateMedia(items.map((i) => i.heroImageId));
  const body = { data: items.map((item) => toBlendSummary(item, media)), nextCursor };
  if (!options.authenticated) {
    reply.header('cache-control', CACHE_PUBLIC_CONTENT);
    reply.header('etag', collectionTag(body));
  }
  return body;
}

export async function buildBlendPayload(
  item: BlendItem,
  include: string[],
  options: { includeDraftRecipes: boolean },
): Promise<Record<string, unknown>> {
  const wantGrower = include.includes('grower');
  const wantRecipes = include.includes('recipes');

  const [grower, recipes] = await Promise.all([
    wantGrower && item.growerId ? getGrower(item.growerId) : Promise.resolve(undefined),
    wantRecipes ? listRecipesForBlend(item.slug, 100) : Promise.resolve(undefined),
  ]);

  const visibleRecipes: RecipeItem[] = (recipes?.items ?? []).filter(
    (r) => options.includeDraftRecipes || r.status === 'published',
  );

  const media = await hydrateMedia([
    item.heroImageId,
    ...(item.galleryImageIds ?? []),
    grower?.portraitId,
    ...visibleRecipes.map((r) => r.imageId),
  ]);

  const embed: { grower?: Record<string, unknown> | null; recipes?: Array<Record<string, unknown>> } = {};
  if (wantGrower) embed.grower = grower ? toGrower(grower, media) : null;
  if (wantRecipes) embed.recipes = visibleRecipes.map((r) => toRecipe(r, media));

  return toBlend(item, media, embed);
}

export async function registerContentRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: ListQuery }>('/v1/blends', { preHandler: attachOptionalPrincipal }, async (request, reply) => {
    // Draft content is never served to an anonymous caller, and a token on this route only
    // ever widens what is visible. It is never required.
    return listBlendsHandler(request, reply, {
      authenticated: Boolean(request.principal),
      strictValidation: true,
    });
  });

  app.get<{ Params: { slug: string }; Querystring: { include?: string | string[] } }>(
    '/v1/blends/:slug',
    { preHandler: attachOptionalPrincipal },
    async (request, reply) => {
      const { slug } = request.params;
      if (!isKnownSlug(slug)) blendNotFound(slug);
      const item = await getBlend(slug);
      const widened = Boolean(request.principal);
      if (!isVisible(item, widened)) blendNotFound(slug);

      const etag = entityTag(item.version, item.updatedAt);
      // A token on this route only ever widens what is visible, so a response it widened is
      // not public content and must not be marked as such. Without this a caller holding any
      // valid token reads a DRAFT blend and the response still says
      // "public, max-age=60, stale-while-revalidate=300" with no Vary, so a shared cache in
      // front of the API stores the unpublished story and serves it to anonymous customers.
      // The same rule the list handler above already applies. API contract, section 7: all
      // private content is private, no-store.
      reply.header('cache-control', widened ? CACHE_ADMIN : CACHE_PUBLIC_CONTENT);
      reply.header('etag', etag);
      if (ifNoneMatchSatisfied(request.headers['if-none-match'], etag)) {
        // The build process sends If-None-Match and takes 304s, which is what keeps
        // publish-to-live cheap when only one blend of five changed.
        return reply.status(304).send();
      }

      const include = parseInclude(request.query.include);
      return buildBlendPayload(item, include, { includeDraftRecipes: false });
    },
  );

  app.get<{ Params: { slug: string }; Querystring: ListQuery }>(
    '/v1/blends/:slug/recipes',
    { preHandler: attachOptionalPrincipal },
    async (request, reply) => {
      const { slug } = request.params;
      if (!isKnownSlug(slug)) blendNotFound(slug);
      const blend = await getBlend(slug);
      // Only published recipes are ever returned here, so the body is public either way.
      // What a token widens is whether a DRAFT blend answers 200 or 404, and that existence
      // signal must not be publicly cached either.
      const widened = Boolean(request.principal);
      if (!isVisible(blend, widened)) blendNotFound(slug);

      // This operation declares no 400, so an out of range limit is clamped rather than
      // rejected. See the note at the top of this file.
      const limit = parseLimit(request.query.limit, false);
      const cursor = decodeCursor(request.query.cursor, false);
      const page = await listRecipesForBlend(slug, limit, cursor?.['k'] as Record<string, unknown> | undefined);
      const visible = page.items.filter((r) => r.status === 'published');
      const media = await hydrateMedia(visible.map((r) => r.imageId));

      reply.header('cache-control', widened ? CACHE_ADMIN : CACHE_PUBLIC_CONTENT);
      return {
        data: visible.map((r) => toRecipe(r, media)),
        nextCursor: page.lastKey ? encodeCursor({ k: page.lastKey }) : null,
      };
    },
  );

  app.get<{ Params: { recipeId: string } }>('/v1/recipes/:recipeId', async (request, reply) => {
    const { recipeId } = request.params;
    if (!isRecipeId(recipeId)) {
      throw notFound(ErrorCodes.RECIPE_NOT_FOUND, `No published recipe exists with id '${recipeId}'.`, [
        { field: 'recipeId', issue: 'not_found' },
      ]);
    }
    const item = await getRecipe(recipeId);
    if (!item || item.status !== 'published') {
      throw notFound(ErrorCodes.RECIPE_NOT_FOUND, `No published recipe exists with id '${recipeId}'.`, [
        { field: 'recipeId', issue: 'not_found' },
      ]);
    }
    const media = await hydrateMedia([item.imageId]);
    reply.header('cache-control', CACHE_PUBLIC_CONTENT);
    return toRecipe(item, media);
  });

  app.get<{ Querystring: ListQuery }>('/v1/growers', async (request, reply) => {
    const limit = parseLimit(request.query.limit, false);
    const cursor = decodeCursor(request.query.cursor, false);
    const page = await listGrowers(limit, cursor?.['k'] as Record<string, unknown> | undefined);
    const media = await hydrateMedia(page.items.map((g) => g.portraitId));
    reply.header('cache-control', CACHE_PUBLIC_CONTENT);
    return {
      data: page.items.map((g) => toGrower(g, media)),
      nextCursor: page.lastKey ? encodeCursor({ k: page.lastKey }) : null,
    };
  });

  app.get<{ Params: { growerId: string } }>('/v1/growers/:growerId', async (request, reply) => {
    const { growerId } = request.params;
    const item = isGrowerId(growerId) ? await getGrower(growerId) : undefined;
    if (!item) {
      throw notFound(ErrorCodes.GROWER_NOT_FOUND, `No grower exists with id '${growerId}'.`, [
        { field: 'growerId', issue: 'not_found' },
      ]);
    }
    const media = await hydrateMedia([item.portraitId]);
    reply.header('cache-control', CACHE_PUBLIC_CONTENT);
    return toGrower(item, media);
  });
}
