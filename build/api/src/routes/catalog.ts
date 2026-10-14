import type { FastifyInstance } from 'fastify';
import { CACHE_PUBLIC_CATALOG } from '../http/cache.js';
import { ErrorCodes, notFound } from '../http/errors.js';
import { isKnownSlug } from '../http/spec.js';
import { getCatalogEntry } from '../repositories/catalog.js';
import { toCatalogEntry } from '../services/mappers.js';

/**
 * GET /v1/catalog/{slug}: the Shopify price and availability mirror.
 *
 * The same values are baked into the page at build and revalidate time. This operation is
 * an OPTIONAL after paint refresh that overwrites the baked value only if it returns. If
 * it is slow, fails, is blocked, or the customer is offline, the page shows the last known
 * price and the reorder button still works, because the Shopify cart permalink is a static
 * URL requiring no API call at all.
 *
 * Whether the after paint refresh runs at all is an open item for Dan (API contract,
 * section 12, item 5). This endpoint is built either way: if the answer is no, the build
 * still reads it, and nothing on the tap path changes.
 */

export async function registerCatalogRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { slug: string } }>('/v1/catalog/:slug', async (request, reply) => {
    const { slug } = request.params;
    if (!isKnownSlug(slug)) {
      throw notFound(ErrorCodes.BLEND_NOT_FOUND, `No published blend exists with slug '${slug}'.`, [
        { field: 'slug', issue: 'not_found' },
      ]);
    }
    const item = await getCatalogEntry(slug);
    if (!item) {
      throw notFound(ErrorCodes.CATALOG_NOT_FOUND, `No catalog mirror entry exists for blend '${slug}'.`, [
        { field: 'slug', issue: 'not_found' },
      ]);
    }
    reply.header('cache-control', CACHE_PUBLIC_CATALOG);
    return toCatalogEntry(item);
  });
}
