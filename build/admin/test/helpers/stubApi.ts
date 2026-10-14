import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { jwtVerify } from 'jose';
import { loadContract } from '../../src/contract.js';
import { isRole, satisfies, type Role } from '../../src/auth/roles.js';

/**
 * A stand in for the tap-to-story API, implementing the admin subset of the frozen contract.
 *
 * Why a stand in rather than the real API in every test: the suite has to be able to prove
 * that an admin write endpoint is unreachable by an under privileged caller, deterministically,
 * on any machine, with no second process to start and no ordering between two packages. The
 * real API is exercised separately by `npm run test:live`, which runs the same assertions
 * against `build/api` on port 3001 and skips with a printed notice when it is not up.
 *
 * The one thing this stub does NOT fake is the authorisation decision. It reads the same
 * `x-minimum-role` values out of the same frozen OpenAPI document the API and the admin both
 * read, and it verifies the bearer token the admin actually minted. So a test that passes here
 * is a test about the real rule, not about a convenience the stub granted.
 */

export interface StubState {
  requests: Array<{ method: string; url: string; role: Role | null; authorization: string | undefined }>;
  blends: Map<string, Record<string, unknown>>;
  growers: Map<string, Record<string, unknown>>;
  recipes: Map<string, Record<string, unknown>>;
  publishCalls: number;
}

const ISSUER = 'https://auth.local.treveanspice.com';
const AUDIENCE = 'trevean-admin';

function requestId(): string {
  return '01J9Z8XK4M2Q7T5V3N8R1B6C0D';
}

function envelope(code: string, message: string, details: Array<{ field: string; issue: string }> = []): unknown {
  return { error: { code, message, requestId: requestId(), details } };
}

function seedBlend(slug: string, name: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug,
    name,
    status: 'published',
    tagline: null,
    originCountry: null,
    originRegion: null,
    originCity: null,
    launchTier: 'seeded',
    tagCode: slug.slice(0, 2),
    heroImage: null,
    recipeCount: 0,
    version: 1,
    publishedAt: '2026-08-17T09:00:00Z',
    updatedAt: '2026-08-17T09:00:00Z',
    farm: null,
    storyBlocks: [],
    gallery: [],
    freshness: { harvestedOn: null, blendedOn: null, bestBefore: null, lotLabel: null, note: null },
    growerId: null,
    shopify: { productId: null, variantId: null, sku: null, cartPermalinkUrl: null },
    ...overrides,
  };
}

export async function startStubApi(
  contractPath: string,
  signingKey: string,
): Promise<{ app: FastifyInstance; url: string; state: StubState }> {
  const contract = loadContract(contractPath);
  const key = new TextEncoder().encode(signingKey);

  const state: StubState = {
    requests: [],
    blends: new Map(),
    growers: new Map(),
    recipes: new Map(),
    publishCalls: 0,
  };

  state.blends.set(
    'persian-sunrise',
    seedBlend('persian-sunrise', 'Persian Sunrise', {
      launchTier: 'real',
      tagCode: 'ps',
      tagline: 'Saffron, cardamom, rose petals and lime from Isfahan',
      originCountry: 'IR',
      originRegion: 'Isfahan',
      growerId: 'grw_01J9Z900A1B2C3D4E5F6G7H8J9',
    }),
  );
  state.blends.set('kyoto-garden', seedBlend('kyoto-garden', 'Kyoto Garden', { status: 'draft', tagCode: 'kg' }));

  state.growers.set('grw_01J9Z900A1B2C3D4E5F6G7H8J9', {
    growerId: 'grw_01J9Z900A1B2C3D4E5F6G7H8J9',
    name: '[PLACEHOLDER] GROWER NAME PENDING, NOT REAL CONTENT',
    farmName: null,
    country: null,
    region: null,
    bio: null,
    yearsFarming: null,
    portrait: null,
    farm: null,
    blendSlugs: ['persian-sunrise'],
    version: 3,
    updatedAt: '2026-08-17T09:00:00Z',
  });

  state.recipes.set('rcp_01J9Z91B2C3D4E5F6G7H8J9K0M', {
    recipeId: 'rcp_01J9Z91B2C3D4E5F6G7H8J9K0M',
    blendSlug: 'persian-sunrise',
    title: '[PLACEHOLDER] RECIPE 1 PENDING, NOT REAL CONTENT',
    summary: null,
    servings: null,
    prepMinutes: null,
    cookMinutes: null,
    difficulty: null,
    ingredients: [],
    steps: [],
    image: null,
    sortOrder: 1,
    status: 'published',
    version: 1,
    updatedAt: '2026-08-17T09:00:00Z',
  });

  const app = Fastify({ logger: false });

  async function roleOf(request: FastifyRequest): Promise<Role | null> {
    const header = request.headers.authorization;
    const match = header ? /^Bearer\s+(.+)$/i.exec(header) : null;
    if (!match) return null;
    try {
      const { payload } = await jwtVerify(match[1] as string, key, { issuer: ISSUER, audience: AUDIENCE });
      const roles = Array.isArray((payload as Record<string, unknown>)['roles'])
        ? ((payload as Record<string, unknown>)['roles'] as unknown[]).filter(isRole)
        : [];
      return roles.length > 0 ? (roles[0] as Role) : null;
    } catch {
      return null;
    }
  }

  /** The whole point of the stub. Refuse first, exactly as the API does. */
  function guard(operationId: string) {
    return async (request: FastifyRequest, reply: { status: (n: number) => { send: (b: unknown) => unknown } }) => {
      const required = contract.minimumRole(operationId);
      const role = await roleOf(request);
      state.requests.push({
        method: request.method,
        url: request.url,
        role,
        authorization: request.headers.authorization,
      });
      if (!contract.operation(operationId).path.startsWith('/v1/admin/')) return undefined;
      if (!role) return reply.status(401).send(envelope('UNAUTHENTICATED', 'No valid bearer token.'));
      if (!satisfies(role, required)) {
        return reply
          .status(403)
          .send(envelope('INSUFFICIENT_ROLE', `This action requires the ${required} role. Your role is ${role}.`));
      }
      return undefined;
    };
  }

  const notFound = (reply: { status: (n: number) => { send: (b: unknown) => unknown } }, code: string): unknown =>
    reply.status(404).send(envelope(code, 'No such record.', [{ field: 'id', issue: 'not_found' }]));

  // Admin blends
  app.get('/v1/admin/blends', { preHandler: guard('adminListBlends') }, async () => ({
    data: [...state.blends.values()],
    nextCursor: null,
  }));

  app.post('/v1/admin/blends', { preHandler: guard('adminCreateBlend') }, async (request, reply) => {
    const input = request.body as Record<string, unknown>;
    const slug = String(input['slug']);
    if (state.blends.has(slug)) return reply.status(409).send(envelope('SLUG_TAKEN', 'Taken.'));
    const created = seedBlend(slug, String(input['name'] ?? slug), { status: 'draft' });
    state.blends.set(slug, created);
    return reply.status(201).send(created);
  });

  app.get<{ Params: { slug: string } }>(
    '/v1/admin/blends/:slug',
    { preHandler: guard('adminGetBlend') },
    async (request, reply) => {
      const blend = state.blends.get(request.params.slug);
      if (!blend) return notFound(reply, 'BLEND_NOT_FOUND');
      const include = String((request.query as Record<string, string>)['include'] ?? '').split(',');
      const payload: Record<string, unknown> = { ...blend };
      if (include.includes('grower')) payload['grower'] = state.growers.get(String(blend['growerId'])) ?? null;
      if (include.includes('recipes')) {
        payload['recipes'] = [...state.recipes.values()].filter((r) => r['blendSlug'] === request.params.slug);
      }
      return payload;
    },
  );

  app.patch<{ Params: { slug: string } }>(
    '/v1/admin/blends/:slug',
    { preHandler: guard('adminUpdateBlend') },
    async (request, reply) => {
      const blend = state.blends.get(request.params.slug);
      if (!blend) return notFound(reply, 'BLEND_NOT_FOUND');
      const input = request.body as Record<string, unknown>;
      if (input['version'] !== blend['version']) {
        return reply
          .status(409)
          .send(envelope('VERSION_CONFLICT', 'Someone else saved first.', [{ field: 'version', issue: 'stale' }]));
      }
      const { version: _v, ...changes } = input;
      Object.assign(blend, changes, { version: (blend['version'] as number) + 1 });
      return blend;
    },
  );

  app.post<{ Params: { slug: string } }>(
    '/v1/admin/blends/:slug/publish',
    { preHandler: guard('adminPublishBlend') },
    async (request, reply) => {
      const blend = state.blends.get(request.params.slug);
      if (!blend) return notFound(reply, 'BLEND_NOT_FOUND');
      state.publishCalls += 1;
      if (!blend['growerId']) {
        return reply
          .status(422)
          .send(envelope('PUBLISH_BLOCKED', '1 problem must be fixed.', [{ field: 'growerId', issue: 'required_for_publish' }]));
      }
      blend['status'] = 'published';
      blend['version'] = (blend['version'] as number) + 1;
      blend['publishedAt'] = '2026-08-22T12:00:00Z';
      return reply.status(202).send({
        slug: request.params.slug,
        status: 'published',
        version: blend['version'],
        publishedAt: blend['publishedAt'],
        revalidationId: 'rvl_01J9Z95D6E7F8G9H0J1K2M3N4P',
        paths: [`/blend.html?blend=${request.params.slug}`, `/blends/${request.params.slug}`, '/sitemap.xml'],
      });
    },
  );

  app.post('/v1/admin/revalidate', { preHandler: guard('adminRevalidate') }, async (request, reply) =>
    reply.status(202).send({
      revalidationId: 'rvl_01J9Z95D6E7F8G9H0J1K2M3N4Q',
      paths: ((request.body as Record<string, string[]>)['blendSlugs'] ?? []).map((s) => `/blends/${s}`),
      status: 'queued',
    }),
  );

  // Recipes
  app.post('/v1/admin/recipes', { preHandler: guard('adminCreateRecipe') }, async (request, reply) => {
    const input = request.body as Record<string, unknown>;
    const recipeId = `rcp_01J9Z91B2C3D4E5F6G7H8J9K${String(state.recipes.size).padStart(2, '0')}`;
    const created = {
      recipeId,
      blendSlug: input['blendSlug'],
      title: input['title'],
      summary: input['summary'] ?? null,
      servings: input['servings'] ?? null,
      prepMinutes: input['prepMinutes'] ?? null,
      cookMinutes: input['cookMinutes'] ?? null,
      difficulty: input['difficulty'] ?? null,
      ingredients: input['ingredients'] ?? [],
      steps: input['steps'] ?? [],
      image: null,
      sortOrder: input['sortOrder'] ?? 0,
      status: input['status'] ?? 'draft',
      version: 1,
      updatedAt: '2026-08-22T12:00:00Z',
    };
    state.recipes.set(recipeId, created);
    return reply.status(201).send(created);
  });

  app.patch<{ Params: { recipeId: string } }>(
    '/v1/admin/recipes/:recipeId',
    { preHandler: guard('adminUpdateRecipe') },
    async (request, reply) => {
      const recipe = state.recipes.get(request.params.recipeId);
      if (!recipe) return notFound(reply, 'RECIPE_NOT_FOUND');
      const input = request.body as Record<string, unknown>;
      if (input['version'] !== recipe['version']) {
        return reply.status(409).send(envelope('VERSION_CONFLICT', 'Stale.', [{ field: 'version', issue: 'stale' }]));
      }
      const { version: _v, ...changes } = input;
      Object.assign(recipe, changes, { version: (recipe['version'] as number) + 1 });
      return recipe;
    },
  );

  app.delete<{ Params: { recipeId: string } }>(
    '/v1/admin/recipes/:recipeId',
    { preHandler: guard('adminDeleteRecipe') },
    async (request, reply) => {
      const recipe = state.recipes.get(request.params.recipeId);
      if (!recipe) return notFound(reply, 'RECIPE_NOT_FOUND');
      recipe['status'] = 'archived';
      return reply.status(204).send();
    },
  );

  // Growers
  app.post('/v1/admin/growers', { preHandler: guard('adminCreateGrower') }, async (request, reply) => {
    const input = request.body as Record<string, unknown>;
    const growerId = `grw_01J9Z900A1B2C3D4E5F6G7H8${String(state.growers.size).padStart(2, '0')}`;
    const created = { growerId, ...input, blendSlugs: [], version: 1, updatedAt: '2026-08-22T12:00:00Z' };
    state.growers.set(growerId, created);
    return reply.status(201).send(created);
  });

  app.patch<{ Params: { growerId: string } }>(
    '/v1/admin/growers/:growerId',
    { preHandler: guard('adminUpdateGrower') },
    async (request, reply) => {
      const grower = state.growers.get(request.params.growerId);
      if (!grower) return notFound(reply, 'GROWER_NOT_FOUND');
      const input = request.body as Record<string, unknown>;
      if (input['version'] !== grower['version']) {
        return reply.status(409).send(envelope('VERSION_CONFLICT', 'Stale.', [{ field: 'version', issue: 'stale' }]));
      }
      const { version: _v, ...changes } = input;
      Object.assign(grower, changes, { version: (grower['version'] as number) + 1 });
      return { ...grower, republishRequiredFor: grower['blendSlugs'] };
    },
  );

  // Media
  app.get('/v1/admin/media', { preHandler: guard('adminListMedia') }, async () => ({ data: [], nextCursor: null }));

  app.post('/v1/admin/media/uploads', { preHandler: guard('adminCreateMediaUpload') }, async (_request, reply) =>
    reply.status(201).send({
      mediaId: 'med_01J9Z8XK4M2Q7T5V3N8R1B6C0D',
      uploadUrl: 'https://example.invalid/upload',
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      maxBytes: 26214400,
      expiresAt: '2026-08-22T12:15:00Z',
    }),
  );

  app.get<{ Params: { mediaId: string } }>(
    '/v1/admin/media/:mediaId',
    { preHandler: guard('adminGetMedia') },
    async (request) => ({
      mediaId: request.params.mediaId,
      filename: 'hero.jpg',
      contentType: 'image/jpeg',
      kind: 'hero',
      status: 'ready',
      alt: null,
      createdAt: '2026-08-22T12:00:00Z',
    }),
  );

  app.post<{ Params: { mediaId: string } }>(
    '/v1/admin/media/:mediaId/complete',
    { preHandler: guard('adminCompleteMediaUpload') },
    async (request, reply) =>
      reply.status(202).send({
        mediaId: request.params.mediaId,
        filename: 'hero.jpg',
        contentType: 'image/jpeg',
        kind: 'hero',
        status: 'processing',
        alt: null,
        createdAt: '2026-08-22T12:00:00Z',
      }),
  );

  // Analytics and tags
  app.get('/v1/admin/analytics/scans', { preHandler: guard('adminGetScanTimeSeries') }, async () => ({
    blend: null,
    granularity: 'day',
    from: '2026-08-01',
    to: '2026-08-22',
    measurementMethod: 'browser_token',
    measurementNote:
      'NFC and QR counts are deduplicated by the same browser side token, because per SKU tag encoding provides no per tag counter.',
    source: 'rollup',
    points: [],
  }));

  app.get('/v1/admin/tags', { preHandler: guard('adminListTagRecords') }, async () => ({
    deployedAt: '2026-08-16T18:30:00Z',
    sourceCommit: '13cce96',
    data: [
      {
        code: 'ps',
        blendSlug: 'persian-sunrise',
        requestPath: '/t/ps',
        targetPath: '/blend.html?blend=persian-sunrise&via=nfc',
        redirectStatus: 307,
        unitsEncoded: 250,
        status: 'encoded',
        encodedOn: '2026-07-24',
        supplierOrderRef: 'SO4731',
        chipPartNumber: 'ST25TV02KC',
        writeProtected: null,
        ndefUri: 'https://treveanspice.com/t/ps',
        lastVerifiedAgainstPhysicalTag: null,
      },
      {
        code: 'kg',
        blendSlug: 'kyoto-garden',
        requestPath: '/t/kg',
        targetPath: '/blend.html?blend=kyoto-garden&via=nfc',
        redirectStatus: 307,
        unitsEncoded: 0,
        status: 'reserved',
        encodedOn: null,
        supplierOrderRef: null,
        chipPartNumber: null,
        writeProtected: null,
        ndefUri: null,
        lastVerifiedAgainstPhysicalTag: null,
      },
    ],
  }));

  // Public content reads. Unauthenticated by design.
  app.get<{ Params: { slug: string } }>('/v1/blends/:slug', { preHandler: guard('getBlendBySlug') }, async (request, reply) => {
    const blend = state.blends.get(request.params.slug);
    if (!blend || blend['status'] !== 'published') return notFound(reply, 'BLEND_NOT_FOUND');
    return blend;
  });

  app.get('/v1/growers', { preHandler: guard('listGrowers') }, async () => ({
    data: [...state.growers.values()],
    nextCursor: null,
  }));

  app.get<{ Params: { growerId: string } }>('/v1/growers/:growerId', { preHandler: guard('getGrower') }, async (request, reply) => {
    const grower = state.growers.get(request.params.growerId);
    if (!grower) return notFound(reply, 'GROWER_NOT_FOUND');
    return grower;
  });

  app.get<{ Params: { recipeId: string } }>('/v1/recipes/:recipeId', { preHandler: guard('getRecipe') }, async (request, reply) => {
    const recipe = state.recipes.get(request.params.recipeId);
    if (!recipe) return notFound(reply, 'RECIPE_NOT_FOUND');
    return recipe;
  });

  app.get<{ Params: { slug: string } }>(
    '/v1/blends/:slug/recipes',
    { preHandler: guard('listRecipesForBlend') },
    async (request) => ({
      data: [...state.recipes.values()].filter((r) => r['blendSlug'] === request.params.slug),
      nextCursor: null,
    }),
  );

  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { app, url: `http://127.0.0.1:${port}`, state };
}
