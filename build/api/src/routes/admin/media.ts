import type { FastifyInstance } from 'fastify';
import { config } from '../../config/env.js';
import { ENTITY, LIVE_SK, mediaPk } from '../../db/keys.js';
import { actorOf, requireRole } from '../../http/context.js';
import { badRequest, ErrorCodes, notFound, payloadTooLarge, unsupportedMediaType } from '../../http/errors.js';
import { decodeCursor, encodeCursor, parseLimit } from '../../http/pagination.js';
import { validateBody } from '../../http/validation.js';
import { getMedia, listMedia, markMediaProcessing, putMedia } from '../../repositories/media.js';
import { cdnUrlFor, headUploadedObject, presignUpload, storageKeyFor } from '../../services/mediaUpload.js';
import { toMedia } from '../../services/mappers.js';
import { isMediaId, newMediaId } from '../../util/ids.js';
import { nowIso } from '../../util/time.js';

/**
 * Media, in three calls, and the reason is worth restating where it will be read:
 *
 *   1. POST /v1/admin/media/uploads      returns a presigned S3 PUT URL and a mediaId
 *   2. the browser PUTs the file DIRECTLY to S3
 *   3. POST /v1/admin/media/{id}/complete marks it uploaded and enqueues derivatives
 *
 * A large photograph never passes through an application function. Premium brand
 * photography plus a function mediated upload is a timeout and a memory limit waiting to
 * happen.
 *
 * Two status codes are ordered deliberately. The frozen document declares 413 for a
 * declared size over the limit and 415 for an unsupported content type, and it ALSO
 * constrains both fields in the request schema, where a violation would be a 400. The
 * specific codes win: bytes and contentType are checked before schema validation runs.
 */

const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

export async function registerAdminMediaRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { kind?: string; limit?: string; cursor?: string } }>(
    '/v1/admin/media',
    { preHandler: requireRole('Viewer') },
    async (request) => {
      const limit = parseLimit(request.query.limit, false);
      const cursor = decodeCursor(request.query.cursor, false);
      const page = await listMedia(request.query.kind, limit, cursor?.['k'] as Record<string, unknown> | undefined);
      return {
        data: page.items.map(toMedia),
        nextCursor: page.lastKey ? encodeCursor({ k: page.lastKey }) : null,
      };
    },
  );

  app.post('/v1/admin/media/uploads', { preHandler: requireRole('Editor') }, async (request, reply) => {
    const raw = (request.body ?? {}) as Record<string, unknown>;

    const declaredBytes = raw['bytes'];
    if (typeof declaredBytes === 'number' && declaredBytes > config.media.maxBytes) {
      throw payloadTooLarge(config.media.maxBytes);
    }
    const contentType = raw['contentType'];
    if (typeof contentType === 'string' && !ALLOWED_CONTENT_TYPES.includes(contentType)) {
      throw unsupportedMediaType(contentType);
    }

    const input = validateBody<{
      filename: string;
      contentType: string;
      bytes: number;
      kind: 'hero' | 'gallery' | 'grower_portrait' | 'recipe';
      alt?: string | null;
    }>('#/components/schemas/MediaUploadRequest', raw);

    const mediaId = newMediaId();
    const ticket = await presignUpload({ mediaId, contentType: input.contentType, bytes: input.bytes });

    await putMedia({
      pk: mediaPk(mediaId),
      sk: LIVE_SK,
      entityType: ENTITY.media,
      mediaId,
      filename: input.filename,
      contentType: input.contentType,
      bytes: input.bytes,
      kind: input.kind,
      // pending means the presigned URL was issued but the object is not confirmed.
      mediaStatus: 'pending',
      alt: input.alt ?? null,
      width: null,
      height: null,
      cdnUrl: null,
      storageKey: storageKeyFor(mediaId),
      derivatives: [],
      uploadedBy: actorOf(request) ?? null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });

    reply.status(201);
    return ticket;
  });

  app.get<{ Params: { mediaId: string } }>(
    '/v1/admin/media/:mediaId',
    { preHandler: requireRole('Viewer') },
    async (request) => {
      const { mediaId } = request.params;
      const item = isMediaId(mediaId) ? await getMedia(mediaId) : undefined;
      if (!item) {
        throw notFound(ErrorCodes.MEDIA_NOT_FOUND, `No media exists with id '${mediaId}'.`, [
          { field: 'mediaId', issue: 'not_found' },
        ]);
      }
      return toMedia(item);
    },
  );

  app.post<{ Params: { mediaId: string } }>(
    '/v1/admin/media/:mediaId/complete',
    { preHandler: requireRole('Editor') },
    async (request, reply) => {
      const { mediaId } = request.params;
      const item = isMediaId(mediaId) ? await getMedia(mediaId) : undefined;
      if (!item) {
        throw notFound(ErrorCodes.MEDIA_NOT_FOUND, `No media exists with id '${mediaId}'.`, [
          { field: 'mediaId', issue: 'not_found' },
        ]);
      }

      const body = validateBody<{ alt?: string | null }>(
        '#/paths/~1v1~1admin~1media~1{mediaId}~1complete/post/requestBody/content/application~1json/schema',
        request.body ?? {},
      );

      const head = await headUploadedObject(mediaId);
      if (!head.verified) {
        throw badRequest('1 field failed validation.', [{ field: 'mediaId', issue: 'object_not_uploaded' }]);
      }

      const updated = await markMediaProcessing(mediaId, {
        bytes: head.bytes ?? item.bytes ?? null,
        alt: body?.alt ?? item.alt ?? null,
        cdnUrl: cdnUrlFor(mediaId, item.filename),
      });

      // 202, because derivatives are asynchronous. The CMS shows the processing state
      // rather than a broken image, and publish is blocked while a hero image is still
      // processing.
      reply.status(202);
      return toMedia(updated);
    },
  );
}
