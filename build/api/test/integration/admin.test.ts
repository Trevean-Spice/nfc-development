import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matchesSchema } from '../../src/http/validation.js';
import { authHeader, freezeClock, makeApp, resetAndSeed, token, unfreezeClock } from '../helpers/harness.js';
import { computeHmacBase64 } from '../../src/webhooks/signature.js';

/**
 * Admin: authentication, roles, optimistic concurrency, publishing, media and the read
 * only tag records.
 *
 * The first test in this file is the one that matters most for the security posture: every
 * admin write endpoint rejects an unauthenticated request, enumerated from the frozen
 * document rather than from memory.
 */

let app: FastifyInstance;

const WRITE_ENDPOINTS: Array<{ method: 'POST' | 'PATCH' | 'DELETE'; url: string }> = [
  { method: 'POST', url: '/v1/admin/blends' },
  { method: 'PATCH', url: '/v1/admin/blends/persian-sunrise' },
  { method: 'POST', url: '/v1/admin/blends/persian-sunrise/publish' },
  { method: 'POST', url: '/v1/admin/recipes' },
  { method: 'PATCH', url: '/v1/admin/recipes/rcp_01J9Z91B2C3D4E5F6G7H8J9K0M' },
  { method: 'DELETE', url: '/v1/admin/recipes/rcp_01J9Z91B2C3D4E5F6G7H8J9K0M' },
  { method: 'POST', url: '/v1/admin/growers' },
  { method: 'PATCH', url: '/v1/admin/growers/grw_01J9Z900A1B2C3D4E5F6G7H8J9' },
  { method: 'POST', url: '/v1/admin/media/uploads' },
  { method: 'POST', url: '/v1/admin/media/med_01J9Z8XK4M2Q7T5V3N8R1B6C0D/complete' },
  { method: 'POST', url: '/v1/admin/revalidate' },
];

const READ_ENDPOINTS = [
  '/v1/admin/blends',
  '/v1/admin/blends/persian-sunrise',
  '/v1/admin/media',
  '/v1/admin/media/med_01J9Z8XK4M2Q7T5V3N8R1B6C0D',
  '/v1/admin/analytics/scans?from=2026-08-17&to=2026-08-17',
  '/v1/admin/tags',
];

beforeAll(async () => {
  // Pinned. Token expiry is deliberately NOT pinned with it: JWT validity is checked by
  // the jose library against real time, which is what will happen in production, and the
  // expired token test below depends on that staying true.
  freezeClock();
  await resetAndSeed();
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
  unfreezeClock();
});

describe('authentication', () => {
  it('rejects every admin write endpoint without a credential', async () => {
    for (const endpoint of WRITE_ENDPOINTS) {
      const res = await app.inject({ method: endpoint.method, url: endpoint.url, payload: {} });
      expect(`${endpoint.method} ${endpoint.url} -> ${res.statusCode}`).toBe(`${endpoint.method} ${endpoint.url} -> 401`);
      expect((res.json() as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
      expect(matchesSchema('#/components/schemas/ErrorEnvelope', res.json()).errors).toEqual([]);
    }
  });

  it('rejects every admin read endpoint without a credential', async () => {
    for (const url of READ_ENDPOINTS) {
      const res = await app.inject({ method: 'GET', url });
      expect(`${url} -> ${res.statusCode}`).toBe(`${url} -> 401`);
    }
  });

  it('rejects a token signed with the wrong key, a wrong issuer and a wrong audience', async () => {
    const cases = [
      'Bearer not.a.token',
      `Bearer ${await token(['Admin'], { issuer: 'https://evil.example' })}`,
      `Bearer ${await token(['Admin'], { audience: 'someone-else' })}`,
    ];
    for (const authorization of cases) {
      const res = await app.inject({ method: 'GET', url: '/v1/admin/blends', headers: { authorization } });
      expect(res.statusCode).toBe(401);
    }
  });

  it('reports an expired token distinctly, so the CMS can prompt a sign in', async () => {
    const expired = await token(['Editor'], { expiresIn: '-5m' });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/blends',
      headers: { authorization: `Bearer ${expired}` },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe('TOKEN_EXPIRED');
  });

  it('does not accept a bearer token on the beacon as a way in', async () => {
    // The beacon is unauthenticated by necessity. A token on it must change nothing.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/scan-events',
      headers: await authHeader(['Admin']),
      payload: {
        blendSlug: 'kyoto-garden',
        channel: 'direct',
        dedupToken: 'ab2c41a7b6e04d8fa3c5d17e8b0f6a24',
        occurredAt: '2026-08-17T09:41:07Z',
      },
    });
    expect(res.statusCode).toBe(202);
  });
});

describe('roles', () => {
  it('lets a Viewer read drafts and refuses every write with 403, not 404', async () => {
    const viewer = await authHeader(['Viewer']);
    const list = await app.inject({ method: 'GET', url: '/v1/admin/blends', headers: viewer });
    expect(list.statusCode).toBe(200);
    const body = list.json() as { data: Array<{ slug: string; status: string }> };
    expect(body.data.map((b) => b.slug)).toContain('kyoto-garden');

    for (const endpoint of WRITE_ENDPOINTS) {
      const res = await app.inject({ method: endpoint.method, url: endpoint.url, headers: viewer, payload: {} });
      expect(`${endpoint.method} ${endpoint.url} -> ${res.statusCode}`).toBe(`${endpoint.method} ${endpoint.url} -> 403`);
      expect((res.json() as { error: { code: string } }).error.code).toBe('INSUFFICIENT_ROLE');
    }
  });

  it('refuses the tag records to an Editor and allows them to an Admin', async () => {
    const editor = await app.inject({ method: 'GET', url: '/v1/admin/tags', headers: await authHeader(['Editor']) });
    expect(editor.statusCode).toBe(403);

    const admin = await app.inject({ method: 'GET', url: '/v1/admin/tags', headers: await authHeader(['Admin']) });
    expect(admin.statusCode).toBe(200);
    const body = admin.json() as { sourceCommit: string; data: Array<Record<string, unknown>> };
    expect(matchesSchema('#/components/schemas/TagRecordList', body).errors).toEqual([]);
    expect(body.data).toHaveLength(5);
    expect(body.sourceCommit).toBe('testcommit');
    const ps = body.data.find((t) => t['code'] === 'ps');
    expect(ps?.['blendSlug']).toBe('persian-sunrise');
    expect(ps?.['redirectStatus']).toBe(307);
    expect(ps?.['chipPartNumber']).toBe('ST25TV02KC');
    // TRUE since Friday 11 September 2026. This asserted false on the strength of D18, an
    // answer Dan gave from memory on 19 August about a run that had already shipped. His own
    // SO4731 instruction to the supplier asked for the NDEF area to be locked, and with the
    // box in front of him he confirmed it was. Two specific pieces of evidence against one
    // recollection. See build/edge/test/table.test.mjs for the full reasoning and for why
    // the area password holder now matters.
    expect(ps?.['writeProtected']).toBe(true);
    expect(body.data.reduce((n, t) => n + ((t['status'] === 'encoded' ? t['unitsEncoded'] : 0) as number), 0)).toBe(1000);
  });

  it('offers no way to write the redirect table, to any role', async () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE'] as const) {
      const res = await app.inject({ method, url: '/v1/admin/tags', headers: await authHeader(['Admin']), payload: {} });
      expect(res.statusCode).toBe(404);
    }
  });
});

describe('editing, optimistic concurrency and publishing', () => {
  it('rejects a stale version with 409 rather than overwriting another editor', async () => {
    const editor = await authHeader(['Editor']);
    const current = (await app.inject({ method: 'GET', url: '/v1/admin/blends/silk-road', headers: editor })).json() as {
      version: number;
    };

    const ok = await app.inject({
      method: 'PATCH',
      url: '/v1/admin/blends/silk-road',
      headers: editor,
      payload: { version: current.version, tagline: 'Cumin, coriander, fenugreek and turmeric' },
    });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { version: number }).version).toBe(current.version + 1);

    const stale = await app.inject({
      method: 'PATCH',
      url: '/v1/admin/blends/silk-road',
      headers: editor,
      payload: { version: current.version, tagline: 'A second editor saving over the first' },
    });
    expect(stale.statusCode).toBe(409);
    expect((stale.json() as { error: { code: string } }).error.code).toBe('VERSION_CONFLICT');
  });

  it('refuses to publish a blend with no grower, and lists every blocker at once', async () => {
    const editor = await authHeader(['Editor']);
    const res = await app.inject({ method: 'POST', url: '/v1/admin/blends/kyoto-garden/publish', headers: editor, payload: {} });
    expect(res.statusCode).toBe(422);
    const body = res.json() as { error: { code: string; details: Array<{ field: string; issue: string }> } };
    expect(body.error.code).toBe('PUBLISH_BLOCKED');
    expect(body.error.details).toContainEqual({ field: 'growerId', issue: 'required_for_publish' });
  });

  it('publishes with 202 and returns exactly the paths queued for regeneration', async () => {
    const editor = await authHeader(['Editor']);
    const grower = await app.inject({
      method: 'POST',
      url: '/v1/admin/growers',
      headers: editor,
      payload: { name: 'Placeholder pending content delivery', country: 'JP', region: 'Kyoto' },
    });
    expect(grower.statusCode).toBe(201);
    const growerId = (grower.json() as { growerId: string }).growerId;

    const blend = (await app.inject({ method: 'GET', url: '/v1/admin/blends/kyoto-garden', headers: editor })).json() as {
      version: number;
    };
    const patched = await app.inject({
      method: 'PATCH',
      url: '/v1/admin/blends/kyoto-garden',
      headers: editor,
      payload: { version: blend.version, growerId },
    });
    expect(patched.statusCode).toBe(200);

    const publish = await app.inject({
      method: 'POST',
      url: '/v1/admin/blends/kyoto-garden/publish',
      headers: editor,
      payload: { version: (patched.json() as { version: number }).version, note: 'Seeding the reserved fifth code.' },
    });
    expect(publish.statusCode).toBe(202);
    const result = publish.json() as { slug: string; status: string; revalidationId: string; paths: string[] };
    expect(matchesSchema('#/components/schemas/PublishResult', result).errors).toEqual([]);
    expect(result.status).toBe('published');
    expect(result.revalidationId).toMatch(/^rvl_/);
    expect(result.paths).toEqual(['/blend.html?blend=kyoto-garden', '/blends/kyoto-garden', '/sitemap.xml']);

    // Published means the public route serves it, which is the whole point of publishing.
    const publicRead = await app.inject({ method: 'GET', url: '/v1/blends/kyoto-garden' });
    expect(publicRead.statusCode).toBe(200);

    // And the immutable snapshot the publish wrote stays out of the blend list. It shares a
    // table with the live record, so a snapshot carrying an indexed status would put every
    // published blend into the list once per version ever published.
    const list = (await app.inject({ method: 'GET', url: '/v1/blends' })).json() as {
      data: Array<{ slug: string }>;
    };
    const slugs = list.data.map((b) => b.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs.filter((s) => s === 'kyoto-garden')).toHaveLength(1);
  });

  it('refuses to publish a stale draft', async () => {
    const editor = await authHeader(['Editor']);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/blends/kyoto-garden/publish',
      headers: editor,
      payload: { version: 1 },
    });
    expect(res.statusCode).toBe(409);
  });

  it('tells the editor which published blends need republishing after a grower edit', async () => {
    const editor = await authHeader(['Editor']);
    const growers = (await app.inject({ method: 'GET', url: '/v1/growers' })).json() as {
      data: Array<{ growerId: string; version: number; blendSlugs: string[] }>;
    };
    const grower = growers.data.find((g) => g.blendSlugs.includes('persian-sunrise'));
    expect(grower).toBeDefined();

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/growers/${grower?.growerId}`,
      headers: editor,
      payload: { version: grower?.version, bio: 'Updated placeholder copy pending content delivery.' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { republishRequiredFor: string[] };
    // The grower is snapshotted into the generated page, so an edit does not change a page
    // already built. The CMS is told rather than the editor being left to remember.
    expect(body.republishRequiredFor).toContain('persian-sunrise');
  });

  it('runs the manual revalidate escape hatch', async () => {
    const editor = await authHeader(['Editor']);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/revalidate',
      headers: editor,
      payload: { blendSlugs: ['persian-sunrise', 'caribbean-sunset'], reason: 'Cache and data disagreed after the 08:00 catalog sync.' },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { revalidationId: string; paths: string[]; status: string };
    expect(matchesSchema('#/components/schemas/RevalidateResult', body).errors).toEqual([]);
    expect(body.status).toBe('queued');
    expect(body.paths).toContain('/blend.html?blend=persian-sunrise');
    expect(body.paths.filter((p) => p === '/sitemap.xml')).toHaveLength(1);
  });

  it('requires at least one of blendSlugs or paths', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/revalidate',
      headers: await authHeader(['Editor']),
      payload: { reason: 'nothing to do' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('replays an Idempotency-Key rather than creating a second record', async () => {
    const editor = await authHeader(['Editor']);
    const payload = { name: 'Idempotency probe grower' };
    const headers = { ...editor, 'idempotency-key': 'probe-key-0001' };
    const first = await app.inject({ method: 'POST', url: '/v1/admin/growers', headers, payload });
    const second = await app.inject({ method: 'POST', url: '/v1/admin/growers', headers, payload });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect((second.json() as { growerId: string }).growerId).toBe((first.json() as { growerId: string }).growerId);
  });

  it('creates, reorders and archives a recipe', async () => {
    const editor = await authHeader(['Editor']);
    const created = await app.inject({
      method: 'POST',
      url: '/v1/admin/recipes',
      headers: editor,
      payload: {
        blendSlug: 'silk-road',
        title: 'Roasted carrots with cumin and coriander',
        summary: 'One tray, forty minutes, very little attention.',
        servings: 4,
        sortOrder: 2,
        status: 'published',
      },
    });
    expect(created.statusCode).toBe(201);
    const recipe = created.json() as { recipeId: string; version: number };
    expect(matchesSchema('#/components/schemas/Recipe', recipe).errors).toEqual([]);

    const moved = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/recipes/${recipe.recipeId}`,
      headers: editor,
      payload: { version: recipe.version, sortOrder: 1 },
    });
    expect(moved.statusCode).toBe(200);
    expect((moved.json() as { sortOrder: number }).sortOrder).toBe(1);

    const stillThere = await app.inject({ method: 'GET', url: `/v1/recipes/${recipe.recipeId}` });
    expect(stillThere.statusCode).toBe(200);

    const archived = await app.inject({
      method: 'DELETE',
      url: `/v1/admin/recipes/${recipe.recipeId}`,
      headers: editor,
    });
    expect(archived.statusCode).toBe(204);

    // Soft delete: it stops appearing on the page but nothing is destroyed, because content
    // that has been on a printed jar's page is worth keeping.
    const gone = await app.inject({ method: 'GET', url: `/v1/recipes/${recipe.recipeId}` });
    expect(gone.statusCode).toBe(404);
    const adminView = await app.inject({
      method: 'GET',
      url: '/v1/admin/blends/silk-road?include=recipes',
      headers: editor,
    });
    const recipes = (adminView.json() as { recipes: Array<{ recipeId: string; status: string }> }).recipes;
    expect(recipes.find((r) => r.recipeId === recipe.recipeId)?.status).toBe('archived');
  });
});

describe('media', () => {
  it('issues a presigned upload, then completes it into processing', async () => {
    const editor = await authHeader(['Editor']);
    const ticket = await app.inject({
      method: 'POST',
      url: '/v1/admin/media/uploads',
      headers: editor,
      payload: {
        filename: 'persian-sunrise-hero.jpg',
        contentType: 'image/jpeg',
        bytes: 4831244,
        kind: 'hero',
        alt: 'A copper bowl of saffron threads and dried rose petals',
      },
    });
    expect(ticket.statusCode).toBe(201);
    const body = ticket.json() as { mediaId: string; uploadUrl: string; method: string; headers: Record<string, string> };
    expect(matchesSchema('#/components/schemas/MediaUploadTicket', body).errors).toEqual([]);
    expect(body.method).toBe('PUT');
    // The browser uploads directly to S3. A large photograph never passes through a
    // function.
    expect(body.uploadUrl).toContain('X-Amz-Signature');
    expect(body.headers['Content-Type']).toBe('image/jpeg');

    const pending = await app.inject({ method: 'GET', url: `/v1/admin/media/${body.mediaId}`, headers: editor });
    expect((pending.json() as { status: string }).status).toBe('pending');

    const complete = await app.inject({
      method: 'POST',
      url: `/v1/admin/media/${body.mediaId}/complete`,
      headers: editor,
      payload: { alt: 'A copper bowl of saffron threads and dried rose petals' },
    });
    expect(complete.statusCode).toBe(202);
    const media = complete.json() as { status: string; cdnUrl: string };
    expect(matchesSchema('#/components/schemas/Media', media).errors).toEqual([]);
    expect(media.status).toBe('processing');

    const list = await app.inject({ method: 'GET', url: '/v1/admin/media?kind=hero', headers: editor });
    expect(list.statusCode).toBe(200);
    expect(matchesSchema('#/components/schemas/MediaList', list.json()).errors).toEqual([]);
  });

  it('returns 413 for an oversized declaration and 415 for an unsupported type', async () => {
    const editor = await authHeader(['Editor']);
    const tooBig = await app.inject({
      method: 'POST',
      url: '/v1/admin/media/uploads',
      headers: editor,
      payload: { filename: 'huge.jpg', contentType: 'image/jpeg', bytes: 26214401, kind: 'hero' },
    });
    expect(tooBig.statusCode).toBe(413);
    expect((tooBig.json() as { error: { code: string } }).error.code).toBe('PAYLOAD_TOO_LARGE');

    const wrongType = await app.inject({
      method: 'POST',
      url: '/v1/admin/media/uploads',
      headers: editor,
      payload: { filename: 'brochure.pdf', contentType: 'application/pdf', bytes: 1000, kind: 'hero' },
    });
    expect(wrongType.statusCode).toBe(415);
    expect((wrongType.json() as { error: { code: string } }).error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('blocks publish while a hero image is still processing', async () => {
    const editor = await authHeader(['Editor']);
    const ticket = (
      await app.inject({
        method: 'POST',
        url: '/v1/admin/media/uploads',
        headers: editor,
        payload: { filename: 'hero.jpg', contentType: 'image/jpeg', bytes: 1000, kind: 'hero', alt: 'Hero' },
      })
    ).json() as { mediaId: string };
    await app.inject({ method: 'POST', url: `/v1/admin/media/${ticket.mediaId}/complete`, headers: editor, payload: {} });

    const blend = (await app.inject({ method: 'GET', url: '/v1/admin/blends/north-african-night-market', headers: editor })).json() as {
      version: number;
    };
    const patched = await app.inject({
      method: 'PATCH',
      url: '/v1/admin/blends/north-african-night-market',
      headers: editor,
      payload: { version: blend.version, heroImageId: ticket.mediaId },
    });
    expect(patched.statusCode).toBe(200);

    const publish = await app.inject({
      method: 'POST',
      url: '/v1/admin/blends/north-african-night-market/publish',
      headers: editor,
      payload: {},
    });
    expect(publish.statusCode).toBe(422);
    const details = (publish.json() as { error: { details: Array<{ field: string; issue: string }> } }).error.details;
    expect(details).toContainEqual({ field: 'heroImageId', issue: 'media_still_processing' });
  });
});

describe('inbound webhooks', () => {
  const path = '/internal/webhooks/shopify/products-update';
  const payload = {
    handle: 'persian-sunrise',
    admin_graphql_api_id: 'gid://shopify/Product/7391043289601',
    currency: 'USD',
    variants: [{ sku: 'TRV-PS-60G', price: '26.00', available: true, admin_graphql_api_id: 'gid://shopify/ProductVariant/41802938471233' }],
  };

  it('refuses an unsigned webhook before doing any work', async () => {
    // Capture the mirror before, so this asserts that nothing changed rather than
    // asserting a particular seeded value. It then keeps working whatever the seed holds.
    const before = await app.inject({ method: 'GET', url: '/v1/catalog/persian-sunrise' });

    const res = await app.inject({ method: 'POST', url: path, payload });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe('INVALID_SIGNATURE');

    const after = await app.inject({ method: 'GET', url: '/v1/catalog/persian-sunrise' });
    expect(after.json()).toEqual(before.json());
  });

  it('refuses a tampered body', async () => {
    const raw = JSON.stringify(payload);
    const signature = computeHmacBase64(raw, process.env.SECRET_TREVEAN_API_SHOPIFY_WEBHOOK_SECRET as string);
    const res = await app.inject({
      method: 'POST',
      url: path,
      headers: { 'content-type': 'application/json', 'x-shopify-hmac-sha256': signature },
      payload: JSON.stringify({ ...payload, handle: 'silk-road' }),
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts a correctly signed webhook and updates the catalog mirror', async () => {
    const raw = JSON.stringify(payload);
    const signature = computeHmacBase64(raw, process.env.SECRET_TREVEAN_API_SHOPIFY_WEBHOOK_SECRET as string);
    const res = await app.inject({
      method: 'POST',
      url: path,
      headers: { 'content-type': 'application/json', 'x-shopify-hmac-sha256': signature },
      payload: raw,
    });
    expect(res.statusCode).toBe(200);

    const catalog = await app.inject({ method: 'GET', url: '/v1/catalog/persian-sunrise' });
    const body = catalog.json() as { price: { amount: number }; stale: boolean };
    expect(body.price.amount).toBe(2600);
    expect(body.stale).toBe(false);
  });
});
