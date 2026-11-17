// A stub implementation of the frozen contract.
//
// Purpose: prove the suite is correct today, before the real API exists. It is in memory,
// single process, has no persistence, no rate limiting and no real authentication, and it
// must never be deployed. The routing table is built from the OpenAPI document itself, so
// the stub cannot answer a path the contract does not define, and cannot silently miss one
// the contract does define.

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { operationList, type OperationContract } from '../spec.js';
import { validate } from '../validator.js';
import { ALLOWED_ORIGINS, EXPIRED_TOKEN, TOKENS, freshState, type StubState } from './data.js';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function ulid(): string {
  let out = '';
  for (let index = 0; index < 26; index += 1) {
    out += CROCKFORD[Math.floor(Math.random() * CROCKFORD.length)];
  }
  return out;
}

function prefixedId(prefix: string): string {
  return `${prefix}_${ulid()}`;
}

const ROLE_RANK: Record<string, number> = { Viewer: 1, Editor: 2, Admin: 3 };

interface Route {
  op: OperationContract;
  method: string;
  regex: RegExp;
  paramNames: string[];
}

function buildRoutes(): Route[] {
  const routes = operationList.map((op) => {
    const paramNames: string[] = [];
    const pattern = op.path
      .split('/')
      .map((segment) => {
        const match = /^\{([^}]+)\}$/.exec(segment);
        if (match) {
          paramNames.push(match[1]!);
          return '([^/]+)';
        }
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    return {
      op,
      method: op.method.toUpperCase(),
      regex: new RegExp(`^${pattern}$`),
      paramNames,
    };
  });
  // Literal paths win over templated ones.
  return routes.sort((a, b) => a.paramNames.length - b.paramNames.length);
}

const ROUTES = buildRoutes();

interface Ctx {
  state: StubState;
  requestId: string;
  op: OperationContract;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
  bodyText: string;
  role: 'Admin' | 'Editor' | 'Viewer' | null;
  headers: http.IncomingHttpHeaders;
  res: http.ServerResponse;
}

function send(ctx: Ctx | null, res: http.ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  for (const [key, value] of Object.entries(extra)) res.setHeader(key, value);
  if (body === undefined || body === null) {
    res.writeHead(status);
    res.end();
    return;
  }
  const text = JSON.stringify(body);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(text));
  res.writeHead(status);
  res.end(text);
}

function fail(
  ctx: Ctx,
  status: number,
  code: string,
  message: string,
  details?: Array<{ field: string; issue: string }>,
  extra: Record<string, string> = {},
): void {
  const error: Record<string, unknown> = { code, message, requestId: ctx.requestId };
  if (details && details.length > 0) error.details = details;
  send(ctx, ctx.res, status, { error }, extra);
}

function cacheControlFor(op: OperationContract): string {
  if (op.tags.some((tag) => tag.startsWith('Admin'))) return 'private, no-store';
  if (op.tags.includes('Tap')) return 'no-store';
  if (op.tags.includes('Catalog')) return 'public, max-age=60, stale-while-revalidate=600';
  return 'public, max-age=60, stale-while-revalidate=300';
}

function schemaProblems(op: OperationContract, body: unknown): Array<{ field: string; issue: string }> {
  if (!op.requestSchema) return [];
  return validate(op.requestSchema, body).map((problem) => ({
    field: problem.instancePath.replace(/^\//, '').replace(/\//g, '.') || '(body)',
    issue: problem.message.slice(0, 120),
  }));
}

function intParam(value: string | null): number | null {
  if (value === null) return null;
  if (!/^-?\d+$/.test(value)) return Number.NaN;
  return Number(value);
}

function isDateOnly(value: string | null): boolean {
  return value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function summarise(blend: any): any {
  const {
    originCity,
    farm,
    storyBlocks,
    gallery,
    freshness,
    growerId,
    shopify,
    updatedBy,
    ...summary
  } = blend;
  return summary;
}

function withEnvelope(data: any[], nextCursor: string | null = null): any {
  return { data, nextCursor };
}

// ---------------------------------------------------------------------------
// Handlers, one per operationId in the OpenAPI document.
// ---------------------------------------------------------------------------

type Handler = (ctx: Ctx) => void;

const handlers: Record<string, Handler> = {
  listBlends(ctx) {
    const limit = intParam(ctx.query.get('limit'));
    if (limit !== null && (Number.isNaN(limit) || limit < 1 || limit > 100)) {
      return fail(ctx, 400, 'VALIDATION_FAILED', '1 field failed validation.', [
        { field: 'limit', issue: 'out_of_range' },
      ]);
    }
    const cursor = ctx.query.get('cursor');
    if (cursor !== null && cursor.length > 2048) {
      return fail(ctx, 400, 'VALIDATION_FAILED', '1 field failed validation.', [
        { field: 'cursor', issue: 'too_long' },
      ]);
    }
    const all = [...ctx.state.blends.values()].filter((blend) => blend.status === 'published');
    const page = all.slice(0, limit ?? 25).map(summarise);
    send(ctx, ctx.res, 200, withEnvelope(page), {
      'Cache-Control': cacheControlFor(ctx.op),
      ETag: `W/"blends-${all.length}-${page.length}"`,
    });
  },

  getBlendBySlug(ctx) {
    const blend = ctx.state.blends.get(ctx.params.slug!);
    if (!blend || blend.status !== 'published') {
      return fail(
        ctx,
        404,
        'BLEND_NOT_FOUND',
        `No published blend exists with slug '${ctx.params.slug}'.`,
        [{ field: 'slug', issue: 'not_found' }],
      );
    }
    const etag = `W/"${blend.slug}-${blend.version}"`;
    if (ctx.headers['if-none-match'] === etag) {
      return send(ctx, ctx.res, 304, null, { ETag: etag, 'Cache-Control': cacheControlFor(ctx.op) });
    }
    const include = (ctx.query.get('include') ?? '').split(',').filter(Boolean);
    const payload: any = { ...blend };
    if (include.includes('grower')) {
      payload.grower = blend.growerId ? (ctx.state.growers.get(blend.growerId) ?? null) : null;
    }
    if (include.includes('recipes')) {
      payload.recipes = [...ctx.state.recipes.values()]
        .filter((recipe) => recipe.blendSlug === blend.slug && recipe.status === 'published')
        .sort((a, b) => a.sortOrder - b.sortOrder || a.recipeId.localeCompare(b.recipeId));
    }
    send(ctx, ctx.res, 200, payload, {
      'Cache-Control': cacheControlFor(ctx.op),
      ETag: etag,
    });
  },

  listRecipesForBlend(ctx) {
    const blend = ctx.state.blends.get(ctx.params.slug!);
    if (!blend || blend.status !== 'published') {
      return fail(ctx, 404, 'BLEND_NOT_FOUND', `No published blend exists with slug '${ctx.params.slug}'.`, [
        { field: 'slug', issue: 'not_found' },
      ]);
    }
    const data = [...ctx.state.recipes.values()]
      .filter((recipe) => recipe.blendSlug === blend.slug && recipe.status === 'published')
      .sort((a, b) => a.sortOrder - b.sortOrder || a.recipeId.localeCompare(b.recipeId));
    send(ctx, ctx.res, 200, withEnvelope(data), { 'Cache-Control': cacheControlFor(ctx.op) });
  },

  getRecipe(ctx) {
    const recipe = ctx.state.recipes.get(ctx.params.recipeId!);
    if (!recipe || recipe.status === 'archived') {
      return fail(ctx, 404, 'RECIPE_NOT_FOUND', `No recipe exists with id '${ctx.params.recipeId}'.`, [
        { field: 'recipeId', issue: 'not_found' },
      ]);
    }
    send(ctx, ctx.res, 200, recipe, { 'Cache-Control': cacheControlFor(ctx.op) });
  },

  listGrowers(ctx) {
    send(ctx, ctx.res, 200, withEnvelope([...ctx.state.growers.values()]), {
      'Cache-Control': cacheControlFor(ctx.op),
    });
  },

  getGrower(ctx) {
    const grower = ctx.state.growers.get(ctx.params.growerId!);
    if (!grower) {
      return fail(ctx, 404, 'GROWER_NOT_FOUND', `No grower exists with id '${ctx.params.growerId}'.`, [
        { field: 'growerId', issue: 'not_found' },
      ]);
    }
    send(ctx, ctx.res, 200, grower, { 'Cache-Control': cacheControlFor(ctx.op) });
  },

  getCatalogEntry(ctx) {
    const entry = ctx.state.catalog.get(ctx.params.slug!);
    if (!entry) {
      return fail(ctx, 404, 'BLEND_NOT_FOUND', `No catalog entry exists for slug '${ctx.params.slug}'.`, [
        { field: 'slug', issue: 'not_found' },
      ]);
    }
    send(ctx, ctx.res, 200, entry, { 'Cache-Control': cacheControlFor(ctx.op) });
  },

  recordScanEvent(ctx) {
    if (ctx.bodyText.length === 0) {
      return fail(ctx, 400, 'VALIDATION_FAILED', 'A body is required.', [
        { field: '(body)', issue: 'missing' },
      ]);
    }
    if (ctx.body === undefined) {
      return fail(ctx, 400, 'MALFORMED_JSON', 'The request body is not valid JSON.');
    }
    const problems = schemaProblems(ctx.op, ctx.body);
    if (problems.length > 0) {
      return fail(ctx, 400, 'VALIDATION_FAILED', 'The beacon body was rejected.', problems.slice(0, 50));
    }
    // Deduplication is a condition on the write, per the data model, section 4.1.
    const occurredAt = Date.parse(ctx.body.occurredAt);
    const windowId = Math.floor(occurredAt / 1000 / 1800);
    const key = `${ctx.body.blendSlug}#${ctx.body.dedupToken}#${windowId}`;
    if (!ctx.state.scanKeys.has(key)) {
      ctx.state.scanKeys.add(key);
      ctx.state.scanCount += 1;
    }
    // 202 for a new event and for a duplicate alike. Empty body. The client cannot tell.
    send(ctx, ctx.res, 202, null, { 'Cache-Control': 'no-store' });
  },

  adminListBlends(ctx) {
    const status = ctx.query.get('status');
    const all = [...ctx.state.blends.values()].filter((blend) => !status || blend.status === status);
    send(ctx, ctx.res, 200, withEnvelope(all.map(summarise)), { 'Cache-Control': cacheControlFor(ctx.op) });
  },

  adminCreateBlend(ctx) {
    const problems = schemaProblems(ctx.op, ctx.body);
    if (problems.length > 0) {
      return fail(ctx, 400, 'VALIDATION_FAILED', `${problems.length} field failed validation.`, problems);
    }
    if (ctx.state.blends.has(ctx.body.slug)) {
      return fail(ctx, 409, 'SLUG_TAKEN', `A blend already exists with slug '${ctx.body.slug}'.`);
    }
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const created = {
      tagline: null,
      launchTier: 'seeded',
      tagCode: null,
      originCountry: null,
      originRegion: null,
      originCity: null,
      farm: null,
      storyBlocks: [],
      heroImage: null,
      gallery: [],
      freshness: {},
      growerId: null,
      shopify: {},
      recipeCount: 0,
      publishedAt: null,
      updatedBy: 'editor@example.com',
      ...ctx.body,
      status: 'draft',
      version: 1,
      updatedAt: now,
    };
    delete (created as any).heroImageId;
    delete (created as any).galleryImageIds;
    ctx.state.blends.set(created.slug, created);
    send(ctx, ctx.res, 201, created, {
      Location: `/v1/blends/${created.slug}`,
      'Cache-Control': cacheControlFor(ctx.op),
    });
  },

  adminGetBlend(ctx) {
    const blend = ctx.state.blends.get(ctx.params.slug!);
    if (!blend) {
      return fail(ctx, 404, 'BLEND_NOT_FOUND', `No blend exists with slug '${ctx.params.slug}'.`, [
        { field: 'slug', issue: 'not_found' },
      ]);
    }
    const include = (ctx.query.get('include') ?? '').split(',').filter(Boolean);
    const payload: any = { ...blend };
    if (include.includes('grower')) {
      payload.grower = blend.growerId ? (ctx.state.growers.get(blend.growerId) ?? null) : null;
    }
    if (include.includes('recipes')) {
      payload.recipes = [...ctx.state.recipes.values()].filter((recipe) => recipe.blendSlug === blend.slug);
    }
    send(ctx, ctx.res, 200, payload, { 'Cache-Control': cacheControlFor(ctx.op) });
  },

  adminUpdateBlend(ctx) {
    const blend = ctx.state.blends.get(ctx.params.slug!);
    const problems = schemaProblems(ctx.op, ctx.body);
    if (problems.length > 0) {
      return fail(ctx, 400, 'VALIDATION_FAILED', `${problems.length} field failed validation.`, problems);
    }
    if (!blend) {
      return fail(ctx, 404, 'BLEND_NOT_FOUND', `No blend exists with slug '${ctx.params.slug}'.`, [
        { field: 'slug', issue: 'not_found' },
      ]);
    }
    if (ctx.body.version !== blend.version) {
      return fail(ctx, 409, 'VERSION_CONFLICT', 'This blend was changed by another editor. Reload before saving.', [
        { field: 'version', issue: 'stale' },
      ]);
    }
    const { version, heroImageId, galleryImageIds, ...rest } = ctx.body;
    Object.assign(blend, rest);
    if (heroImageId !== undefined) {
      const media = heroImageId ? ctx.state.media.get(heroImageId) : null;
      blend.heroImage = media
        ? {
            mediaId: media.mediaId,
            cdnUrl: media.cdnUrl,
            alt: media.alt ?? '',
            width: media.width ?? 1,
            height: media.height ?? 1,
          }
        : null;
    }
    blend.version = blend.version + 1;
    blend.updatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    send(ctx, ctx.res, 200, blend, { 'Cache-Control': cacheControlFor(ctx.op) });
  },

  adminPublishBlend(ctx) {
    const blend = ctx.state.blends.get(ctx.params.slug!);
    if (!blend) {
      return fail(ctx, 404, 'BLEND_NOT_FOUND', `No blend exists with slug '${ctx.params.slug}'.`, [
        { field: 'slug', issue: 'not_found' },
      ]);
    }
    if (ctx.body && ctx.body.version !== undefined && ctx.body.version !== blend.version) {
      return fail(ctx, 409, 'VERSION_CONFLICT', 'The version supplied is not the stored version.', [
        { field: 'version', issue: 'stale' },
      ]);
    }
    const blockers: Array<{ field: string; issue: string }> = [];
    if (!blend.growerId) blockers.push({ field: 'growerId', issue: 'required_for_publish' });
    if (blend.heroImage) {
      const media = ctx.state.media.get(blend.heroImage.mediaId);
      if (media && media.status !== 'ready') {
        blockers.push({ field: 'heroImageId', issue: 'media_still_processing' });
      }
    }
    if (blockers.length > 0) {
      return fail(
        ctx,
        422,
        'PUBLISH_BLOCKED',
        `This blend cannot be published yet. ${blockers.length} problems must be fixed.`,
        blockers,
      );
    }
    blend.status = 'published';
    blend.publishedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    send(
      ctx,
      ctx.res,
      202,
      {
        slug: blend.slug,
        status: blend.status,
        version: blend.version,
        publishedAt: blend.publishedAt,
        revalidationId: prefixedId('rvl'),
        paths: [`/blend.html?blend=${blend.slug}`, `/blends/${blend.slug}`, '/sitemap.xml'],
      },
      { 'Cache-Control': cacheControlFor(ctx.op) },
    );
  },

  adminRevalidate(ctx) {
    const problems = schemaProblems(ctx.op, ctx.body);
    if (problems.length > 0) {
      return fail(ctx, 400, 'VALIDATION_FAILED', `${problems.length} field failed validation.`, problems);
    }
    const paths = [
      ...((ctx.body.blendSlugs ?? []) as string[]).map((slug) => `/blend.html?blend=${slug}`),
      ...((ctx.body.paths ?? []) as string[]),
    ];
    send(ctx, ctx.res, 202, { revalidationId: prefixedId('rvl'), paths, status: 'queued' }, {
      'Cache-Control': cacheControlFor(ctx.op),
    });
  },

  adminCreateRecipe(ctx) {
    const problems = schemaProblems(ctx.op, ctx.body);
    if (problems.length > 0) {
      return fail(ctx, 400, 'VALIDATION_FAILED', `${problems.length} field failed validation.`, problems);
    }
    if (!ctx.state.blends.has(ctx.body.blendSlug)) {
      return fail(ctx, 404, 'BLEND_NOT_FOUND', `No blend exists with slug '${ctx.body.blendSlug}'.`, [
        { field: 'blendSlug', issue: 'not_found' },
      ]);
    }
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const { imageId, ...rest } = ctx.body;
    const created = {
      summary: null,
      servings: null,
      prepMinutes: null,
      cookMinutes: null,
      difficulty: null,
      ingredients: [],
      steps: [],
      image: null,
      sortOrder: 0,
      status: 'draft',
      ...rest,
      recipeId: prefixedId('rcp'),
      version: 1,
      updatedAt: now,
    };
    ctx.state.recipes.set(created.recipeId, created);
    send(ctx, ctx.res, 201, created, { 'Cache-Control': cacheControlFor(ctx.op) });
  },

  adminUpdateRecipe(ctx) {
    const problems = schemaProblems(ctx.op, ctx.body);
    if (problems.length > 0) {
      return fail(ctx, 400, 'VALIDATION_FAILED', `${problems.length} field failed validation.`, problems);
    }
    const recipe = ctx.state.recipes.get(ctx.params.recipeId!);
    if (!recipe) {
      return fail(ctx, 404, 'RECIPE_NOT_FOUND', `No recipe exists with id '${ctx.params.recipeId}'.`, [
        { field: 'recipeId', issue: 'not_found' },
      ]);
    }
    if (ctx.body.version !== recipe.version) {
      return fail(ctx, 409, 'VERSION_CONFLICT', 'This recipe was changed by another editor.', [
        { field: 'version', issue: 'stale' },
      ]);
    }
    const { version, imageId, ...rest } = ctx.body;
    Object.assign(recipe, rest);
    recipe.version += 1;
    recipe.updatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    send(ctx, ctx.res, 200, recipe, { 'Cache-Control': cacheControlFor(ctx.op) });
  },

  adminDeleteRecipe(ctx) {
    const recipe = ctx.state.recipes.get(ctx.params.recipeId!);
    if (!recipe) {
      return fail(ctx, 404, 'RECIPE_NOT_FOUND', `No recipe exists with id '${ctx.params.recipeId}'.`, [
        { field: 'recipeId', issue: 'not_found' },
      ]);
    }
    // Soft delete. Nothing is destroyed, because content that has been on a jar is worth keeping.
    recipe.status = 'archived';
    recipe.version += 1;
    send(ctx, ctx.res, 204, null, { 'Cache-Control': cacheControlFor(ctx.op) });
  },

  adminCreateGrower(ctx) {
    const problems = schemaProblems(ctx.op, ctx.body);
    if (problems.length > 0) {
      return fail(ctx, 400, 'VALIDATION_FAILED', `${problems.length} field failed validation.`, problems);
    }
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const { portraitId, ...rest } = ctx.body;
    const created = {
      farmName: null,
      country: null,
      region: null,
      bio: null,
      yearsFarming: null,
      portrait: null,
      farm: null,
      blendSlugs: [],
      ...rest,
      growerId: prefixedId('grw'),
      version: 1,
      updatedAt: now,
    };
    ctx.state.growers.set(created.growerId, created);
    send(ctx, ctx.res, 201, created, { 'Cache-Control': cacheControlFor(ctx.op) });
  },

  adminUpdateGrower(ctx) {
    const problems = schemaProblems(ctx.op, ctx.body);
    if (problems.length > 0) {
      return fail(ctx, 400, 'VALIDATION_FAILED', `${problems.length} field failed validation.`, problems);
    }
    const grower = ctx.state.growers.get(ctx.params.growerId!);
    if (!grower) {
      return fail(ctx, 404, 'GROWER_NOT_FOUND', `No grower exists with id '${ctx.params.growerId}'.`, [
        { field: 'growerId', issue: 'not_found' },
      ]);
    }
    if (ctx.body.version !== grower.version) {
      return fail(ctx, 409, 'VERSION_CONFLICT', 'This grower was changed by another editor.', [
        { field: 'version', issue: 'stale' },
      ]);
    }
    const { version, portraitId, ...rest } = ctx.body;
    Object.assign(grower, rest);
    grower.version += 1;
    grower.updatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    // The grower is snapshotted into the generated page, so published blends need republishing.
    const republishRequiredFor = (grower.blendSlugs ?? []).filter(
      (slug: string) => ctx.state.blends.get(slug)?.status === 'published',
    );
    send(ctx, ctx.res, 200, { ...grower, republishRequiredFor }, {
      'Cache-Control': cacheControlFor(ctx.op),
    });
  },

  adminListMedia(ctx) {
    const kind = ctx.query.get('kind');
    const data = [...ctx.state.media.values()].filter((item) => !kind || item.kind === kind);
    send(ctx, ctx.res, 200, withEnvelope(data), { 'Cache-Control': cacheControlFor(ctx.op) });
  },

  adminCreateMediaUpload(ctx) {
    if (ctx.body === undefined || ctx.body === null || typeof ctx.body !== 'object') {
      return fail(ctx, 400, 'MALFORMED_JSON', 'The request body is not valid JSON.');
    }
    // Order matters: media type before size before generic validation, so the caller sees
    // the specific status the contract promises rather than a blanket 400.
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
    if (typeof ctx.body.contentType === 'string' && !allowedTypes.includes(ctx.body.contentType)) {
      return fail(ctx, 415, 'UNSUPPORTED_MEDIA_TYPE', `${ctx.body.contentType} is not an accepted image type.`, [
        { field: 'contentType', issue: 'unsupported' },
      ]);
    }
    const maxBytes = 26214400;
    if (typeof ctx.body.bytes === 'number' && ctx.body.bytes > maxBytes) {
      return fail(ctx, 413, 'PAYLOAD_TOO_LARGE', `The declared size exceeds ${maxBytes} bytes.`, [
        { field: 'bytes', issue: 'too_large' },
      ]);
    }
    const problems = schemaProblems(ctx.op, ctx.body);
    if (problems.length > 0) {
      return fail(ctx, 400, 'VALIDATION_FAILED', `${problems.length} field failed validation.`, problems);
    }
    const mediaId = prefixedId('med');
    ctx.state.media.set(mediaId, {
      mediaId,
      filename: ctx.body.filename,
      contentType: ctx.body.contentType,
      bytes: ctx.body.bytes,
      kind: ctx.body.kind,
      status: 'pending',
      alt: ctx.body.alt ?? null,
      width: null,
      height: null,
      cdnUrl: null,
      derivatives: [],
      uploadedBy: 'editor@example.com',
      createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    });
    send(
      ctx,
      ctx.res,
      201,
      {
        mediaId,
        // The browser PUTs directly to S3. A photograph never passes through a function.
        uploadUrl: `https://trevean-media-stub.s3.us-east-1.amazonaws.com/incoming/${mediaId}?X-Amz-Signature=STUB`,
        method: 'PUT',
        headers: { 'Content-Type': ctx.body.contentType },
        maxBytes,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      },
      { 'Cache-Control': cacheControlFor(ctx.op) },
    );
  },

  adminGetMedia(ctx) {
    const media = ctx.state.media.get(ctx.params.mediaId!);
    if (!media) {
      return fail(ctx, 404, 'MEDIA_NOT_FOUND', `No media exists with id '${ctx.params.mediaId}'.`, [
        { field: 'mediaId', issue: 'not_found' },
      ]);
    }
    send(ctx, ctx.res, 200, media, { 'Cache-Control': cacheControlFor(ctx.op) });
  },

  adminCompleteMediaUpload(ctx) {
    const media = ctx.state.media.get(ctx.params.mediaId!);
    if (!media) {
      return fail(ctx, 404, 'MEDIA_NOT_FOUND', `No media exists with id '${ctx.params.mediaId}'.`, [
        { field: 'mediaId', issue: 'not_found' },
      ]);
    }
    if (ctx.bodyText.length > 0 && ctx.body === undefined) {
      return fail(ctx, 400, 'MALFORMED_JSON', 'The request body is not valid JSON.');
    }
    if (ctx.bodyText.length > 0) {
      const problems = schemaProblems(ctx.op, ctx.body);
      if (problems.length > 0) {
        return fail(ctx, 400, 'VALIDATION_FAILED', `${problems.length} field failed validation.`, problems);
      }
    }
    if (ctx.body && ctx.body.alt !== undefined) media.alt = ctx.body.alt;
    // Derivatives are asynchronous, so the record reports processing for a few seconds.
    media.status = 'processing';
    media.width = 4000;
    media.height = 2667;
    send(ctx, ctx.res, 202, media, { 'Cache-Control': cacheControlFor(ctx.op) });
  },

  adminGetScanTimeSeries(ctx) {
    const from = ctx.query.get('from');
    const to = ctx.query.get('to');
    const granularity = ctx.query.get('granularity') ?? 'day';
    const blend = ctx.query.get('blend');
    const details: Array<{ field: string; issue: string }> = [];
    if (!isDateOnly(from)) details.push({ field: 'from', issue: from === null ? 'required' : 'not_a_date' });
    if (!isDateOnly(to)) details.push({ field: 'to', issue: to === null ? 'required' : 'not_a_date' });
    if (!['hour', 'day'].includes(granularity)) details.push({ field: 'granularity', issue: 'not_in_enum' });
    if (details.length > 0) {
      return fail(ctx, 400, 'VALIDATION_FAILED', `${details.length} field failed validation.`, details);
    }
    const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
    if (days < 1) {
      return fail(ctx, 400, 'VALIDATION_FAILED', 'The range ends before it starts.', [
        { field: 'to', issue: 'before_from' },
      ]);
    }
    const maxDays = granularity === 'hour' ? 31 : 366;
    if (days > maxDays) {
      return fail(ctx, 400, 'VALIDATION_FAILED', `Range exceeds ${maxDays} days at ${granularity} granularity.`, [
        { field: 'to', issue: 'range_too_large' },
      ]);
    }
    if (blend !== null && !ctx.state.blends.has(blend)) {
      return fail(ctx, 400, 'VALIDATION_FAILED', '1 field failed validation.', [
        { field: 'blend', issue: 'not_in_enum' },
      ]);
    }
    const points = [];
    for (let index = 0; index < Math.min(days, 31); index += 1) {
      const bucketDate = new Date(Date.parse(`${from}T00:00:00Z`) + index * 86400000);
      const bucket =
        granularity === 'day'
          ? bucketDate.toISOString().slice(0, 10)
          : `${bucketDate.toISOString().slice(0, 10)}T00`;
      points.push({
        bucket,
        scans: 41 + index,
        byChannel: { nfc: 27 + index, qr: 13, direct: 1 },
        byPlatform: { ios: 28 + index, android: 12, other: 1 },
        reorderClicks: 5,
        recipeOpens: 19,
        cache: { hit: 41 + index, miss: 0, stale: 0 },
        timeToReadable: { count: 41 + index, sumMs: 46740, p50Ms: 1120, p95Ms: 1660 },
        topCities: [{ country: 'US', region: 'MA', city: 'Boston', scans: 16 }],
      });
    }
    send(
      ctx,
      ctx.res,
      200,
      {
        blend: blend ?? null,
        granularity,
        from,
        to,
        measurementMethod: 'browser_token',
        measurementNote:
          'NFC and QR counts are deduplicated by the same browser side token, because per SKU tag encoding provides no per-tag counter. The two channels are directly comparable to each other and neither is a per-jar count.',
        source: 'rollup',
        points,
      },
      { 'Cache-Control': cacheControlFor(ctx.op) },
    );
  },

  adminListTagRecords(ctx) {
    send(
      ctx,
      ctx.res,
      200,
      {
        deployedAt: '2026-08-16T18:30:00Z',
        sourceCommit: '13cce96',
        data: ctx.state.tags,
      },
      { 'Cache-Control': cacheControlFor(ctx.op) },
    );
  },
};

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

function applyCommonHeaders(res: http.ServerResponse, requestId: string, origin: string | undefined): void {
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id, ETag, Retry-After, Location');
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk as Buffer));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export interface StubHandle {
  url: string;
  port: number;
  close: () => Promise<void>;
  state: StubState;
}

export function createStubServer(): { server: http.Server; state: StubState } {
  const state = freshState();

  const server = http.createServer((req, res) => {
    const requestId = ulid();
    const origin = req.headers.origin as string | undefined;
    applyCommonHeaders(res, requestId, origin);

    const url = new URL(req.url ?? '/', 'http://placeholder');
    const pathname = url.pathname;

    // CORS preflight. The beacon posts application/json cross origin, which is not a
    // CORS safelisted content type, so the browser preflights before it will send.
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, If-None-Match, Idempotency-Key',
      );
      res.setHeader('Access-Control-Max-Age', '600');
      res.writeHead(204);
      res.end();
      return;
    }

    const route = ROUTES.find((candidate) => candidate.method === req.method && candidate.regex.test(pathname));

    if (!route) {
      const pathMatchesOtherMethod = ROUTES.some((candidate) => candidate.regex.test(pathname));
      const status = pathMatchesOtherMethod ? 405 : 404;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(status);
      res.end(
        JSON.stringify({
          error: {
            code: pathMatchesOtherMethod ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND',
            message: `No operation for ${req.method} ${pathname}.`,
            requestId,
          },
        }),
      );
      return;
    }

    const params: Record<string, string> = {};
    const match = route.regex.exec(pathname)!;
    route.paramNames.forEach((name, index) => {
      params[name] = decodeURIComponent(match[index + 1]!);
    });

    readBody(req)
      .then((bodyText) => {
        let body: any = undefined;
        if (bodyText.length > 0) {
          try {
            body = JSON.parse(bodyText);
          } catch {
            body = undefined;
          }
        }

        const ctx: Ctx = {
          state,
          requestId,
          op: route.op,
          params,
          query: url.searchParams,
          body,
          bodyText,
          role: null,
          headers: req.headers,
          res,
        };

        if (route.op.requiresAuth) {
          const header = req.headers.authorization;
          if (!header || !/^Bearer\s+\S+$/i.test(header)) {
            return fail(ctx, 401, 'UNAUTHENTICATED', 'A bearer token is required for this operation.');
          }
          const token = header.replace(/^Bearer\s+/i, '');
          if (token === EXPIRED_TOKEN) {
            return fail(ctx, 401, 'TOKEN_EXPIRED', 'The access token has expired. Sign in again.');
          }
          const role = TOKENS[token];
          if (!role) {
            return fail(ctx, 401, 'UNAUTHENTICATED', 'The bearer token is not valid.');
          }
          ctx.role = role;
          const required = route.op.minimumRole ?? 'Viewer';
          if ((ROLE_RANK[role] ?? 0) < (ROLE_RANK[required] ?? 99)) {
            return fail(
              ctx,
              403,
              'INSUFFICIENT_ROLE',
              `${route.op.summary} requires the ${required} role. Your role is ${role}.`,
            );
          }
        }

        if (route.op.requestBodyRequired && bodyText.length === 0) {
          return fail(ctx, route.op.declaredStatuses.includes(400) ? 400 : 422, 'VALIDATION_FAILED', 'A body is required.', [
            { field: '(body)', issue: 'missing' },
          ]);
        }
        if (bodyText.length > 0 && body === undefined && route.op.operationId !== 'recordScanEvent') {
          return fail(ctx, 400, 'MALFORMED_JSON', 'The request body is not valid JSON.');
        }

        const handler = handlers[route.op.operationId];
        if (!handler) {
          return fail(
            ctx,
            500,
            'INTERNAL_ERROR',
            `The stub has no handler for ${route.op.operationId}. The OpenAPI document defines an operation the stub does not implement.`,
          );
        }
        handler(ctx);
      })
      .catch((error: Error) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(500);
        res.end(
          JSON.stringify({
            error: { code: 'INTERNAL_ERROR', message: error.message, requestId },
          }),
        );
      });
  });

  return { server, state };
}

export function startStub(port = 0): Promise<StubHandle> {
  const { server, state } = createStubServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        port: address.port,
        state,
        close: () =>
          new Promise<void>((done, fail2) => {
            server.close((error) => (error ? fail2(error) : done()));
          }),
      });
    });
  });
}

/** Operations in the document that the stub does not implement. Should always be empty. */
export function unimplementedOperations(): string[] {
  return operationList.filter((op) => !handlers[op.operationId]).map((op) => op.operationId);
}
