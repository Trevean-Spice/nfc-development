import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';

/**
 * The same assertions, against the real API in `build/api` rather than the stub.
 *
 * Run it with the API up:
 *
 *   cd build/api && npm run local:up
 *   cd build/admin && npm run test:live
 *
 * If the API is not running this file skips with a printed notice rather than failing. That
 * is deliberate: `npm test` has to be runnable on any machine with nothing else started, and
 * a suite that fails when a second process is not up teaches people to ignore red.
 */

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..', '..');
const API = process.env['API_BASE_URL'] ?? 'http://localhost:3001';

let reachable = false;
try {
  const response = await fetch(`${API}/health`, { signal: AbortSignal.timeout(2000) });
  reachable = response.ok;
} catch {
  reachable = false;
}

if (!reachable) {
  process.stdout.write(
    `\nSKIPPED: the API at ${API} is not running. Start it with "npm run local:up" in build/api.\n\n`,
  );
}

let app: FastifyInstance;
const cookies: Record<string, string> = {};
const csrf: Record<string, string> = {};

describe.skipIf(!reachable)('against the real API', () => {
  beforeAll(async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'trevean-admin-live-'));
    process.env['STAGE'] = 'local';
    process.env['API_BASE_URL'] = API;
    process.env['SESSION_SECRET'] = 'live-test-session-secret';
    process.env['USERS_FILE'] = join(scratch, 'users.json');
    process.env['AUDIT_FILE'] = join(scratch, 'audit.log');
    process.env['PUBLISH_VERIFY_ATTEMPTS'] = '4';
    process.env['PUBLISH_VERIFY_INTERVAL_MS'] = '250';
    process.env['LOG_LEVEL'] = 'silent';

    const { buildApp } = await import('../../src/server.js');
    const { decodeSession } = await import('../../src/auth/session.js');
    app = await buildApp();
    await app.ready();

    for (const [role, email] of [
      ['Viewer', 'viewer@treveanspice.com'],
      ['Editor', 'editor@treveanspice.com'],
      ['Admin', 'admin@treveanspice.com'],
    ] as const) {
      const response = await app.inject({
        method: 'POST',
        url: '/sign-in',
        payload: `email=${encodeURIComponent(email)}&password=${role.toLowerCase()}-local-only`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      const setCookie = response.headers['set-cookie'];
      const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      const cookie = String(raw).split(';')[0] as string;
      cookies[role] = cookie;
      const session = decodeSession(decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)));
      csrf[role] = session?.csrf ?? '';
    }
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('lists the five real blends', async () => {
    const response = await app.inject({ method: 'GET', url: '/', headers: { cookie: cookies['Editor'] as string } });
    expect(response.statusCode).toBe(200);
    for (const slug of [
      'persian-sunrise',
      'caribbean-sunset',
      'north-african-night-market',
      'silk-road',
      'kyoto-garden',
    ]) {
      expect(response.body).toContain(slug);
    }
  });

  it('the real API refuses a Viewer token on a write', async () => {
    const { mintApiToken } = await import('../../src/auth/tokens.js');
    const token = await mintApiToken({
      subject: 'usr_live',
      email: 'viewer@treveanspice.com',
      name: 'Viewer',
      role: 'Viewer',
    });
    const response = await fetch(`${API}/v1/admin/blends/persian-sunrise/publish`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INSUFFICIENT_ROLE');
  });

  it('the real API refuses an unauthenticated admin call', async () => {
    const response = await fetch(`${API}/v1/admin/tags`);
    expect(response.status).toBe(401);
  });

  it('the real API refuses an Editor token on the tag records', async () => {
    const { mintApiToken } = await import('../../src/auth/tokens.js');
    const token = await mintApiToken({
      subject: 'usr_live',
      email: 'editor@treveanspice.com',
      name: 'Editor',
      role: 'Editor',
    });
    const response = await fetch(`${API}/v1/admin/tags`, { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(403);
  });

  it('reads the deployed redirect table as Admin, with 1,000 units across four codes', async () => {
    const response = await app.inject({ method: 'GET', url: '/nfc', headers: { cookie: cookies['Admin'] as string } });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('SO4731');
    expect(response.body).toContain('ST25TV02KC');
    expect(response.body).toContain('1000');
    expect(response.body).toContain('/t/ps');
  });

  it('previews a real blend', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/blends/persian-sunrise/preview.html',
      headers: { cookie: cookies['Editor'] as string },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Persian Sunrise');
  });

  it('refuses to publish placeholder content with no override', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/blends/silk-road/publish',
      payload: `_csrf=${encodeURIComponent(csrf['Editor'] as string)}`,
      headers: { cookie: cookies['Editor'] as string, 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(422);
    expect(response.body).toContain('PUBLISH PLACEHOLDER CONTENT');
  });

  it('refuses at the API when the blend has no grower, and shows the blocking field', async () => {
    // The Silk Road is seeded with no grower record, which is exactly what the API refuses
    // a publish on. The override gets past the admin's own guard and the API refuses next,
    // which is the two layer behaviour this whole design depends on.
    const response = await app.inject({
      method: 'POST',
      url: '/blends/silk-road/publish',
      payload: new URLSearchParams({
        _csrf: csrf['Editor'] as string,
        override_phrase: 'PUBLISH PLACEHOLDER CONTENT',
        override_reason: 'Checking that the API refuses a blend with no grower, on purpose.',
        override_ack: 'on',
      }).toString(),
      headers: { cookie: cookies['Editor'] as string, 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(422);
    expect(response.body).toContain('PUBLISH_BLOCKED');
    expect(response.body).toContain('growerId');
  });

  it('publishes end to end with an override, and confirms the new version is being served', async () => {
    const before = await app.inject({
      method: 'GET',
      url: '/blends/persian-sunrise',
      headers: { cookie: cookies['Editor'] as string },
    });
    const version = Number(/name="version" value="(\d+)"/.exec(before.body)?.[1] ?? '1');

    const response = await app.inject({
      method: 'POST',
      url: '/blends/persian-sunrise/publish',
      payload: new URLSearchParams({
        _csrf: csrf['Editor'] as string,
        version: String(version),
        override_phrase: 'PUBLISH PLACEHOLDER CONTENT',
        override_reason: 'Live test of the publish path against the real API, content still outstanding.',
        override_ack: 'on',
      }).toString(),
      headers: { cookie: cookies['Editor'] as string, 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('/blend.html?blend=persian-sunrise');
    expect(response.body).toContain('/sitemap.xml');
    expect(response.body).toContain('Confirmed live at the origin');
  });

  it('saves an edit through the real API and reads it back', async () => {
    const before = await app.inject({
      method: 'GET',
      url: '/blends/kyoto-garden',
      headers: { cookie: cookies['Editor'] as string },
    });
    const version = Number(/name="version" value="(\d+)"/.exec(before.body)?.[1] ?? '1');
    const tagline = `Live test tagline ${Date.now()}`;

    const save = await app.inject({
      method: 'POST',
      url: '/blends/kyoto-garden',
      payload: new URLSearchParams({
        _csrf: csrf['Editor'] as string,
        version: String(version),
        name: 'Kyoto Garden',
        tagline,
        launchTier: 'seeded',
      }).toString(),
      headers: { cookie: cookies['Editor'] as string, 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(save.statusCode).toBe(302);

    const after = await app.inject({
      method: 'GET',
      url: '/blends/kyoto-garden',
      headers: { cookie: cookies['Editor'] as string },
    });
    expect(after.body).toContain(tagline);
  });

  it('a Viewer cannot write through the admin against the real API either', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/blends/kyoto-garden',
      payload: `_csrf=${encodeURIComponent(csrf['Viewer'] as string)}&version=1&name=Hijacked`,
      headers: { cookie: cookies['Viewer'] as string, 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(403);
  });
});
