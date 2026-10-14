import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { startStubApi, type StubState } from './stubApi.js';
import type { Role } from '../../src/auth/roles.js';

/**
 * Test harness.
 *
 * Configuration in this application is read once at module load, deliberately, so that a
 * misconfiguration is a startup failure rather than a 500 discovered by an editor. That means
 * the environment has to be set before anything under `src/` is imported, which is why every
 * import below the environment block is dynamic.
 */

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..', '..');

export const CONTRACT_PATH = resolve(packageRoot, '..', 'api', 'openapi', 'openapi.yaml');
export const CONTENT_DIR = resolve(packageRoot, '..', 'content');
export const SIGNING_KEY = 'local-development-signing-key-not-for-any-real-environment';

export const CREDENTIALS: Record<Role, { email: string; password: string }> = {
  Viewer: { email: 'viewer@treveanspice.com', password: 'viewer-local-only' },
  Editor: { email: 'editor@treveanspice.com', password: 'editor-local-only' },
  Admin: { email: 'admin@treveanspice.com', password: 'admin-local-only' },
};

export interface Harness {
  app: FastifyInstance;
  stub: { app: FastifyInstance; url: string; state: StubState };
  signIn(role: Role): Promise<Session>;
  close(): Promise<void>;
}

export interface Session {
  cookie: string;
  csrf: string;
  role: Role;
}

export interface HarnessOptions {
  /** Point the content readiness source at a directory that does not exist. */
  contentDir?: string;
}

export async function setup(options: HarnessOptions = {}): Promise<Harness> {
  const stub = await startStubApi(CONTRACT_PATH, SIGNING_KEY);
  const scratch = mkdtempSync(join(tmpdir(), 'trevean-admin-test-'));

  process.env['STAGE'] = 'local';
  // The seeded identity provider is off unless asked for by name, so the harness asks. It
  // used to come on by itself anywhere that was not production, which is how it nearly
  // reached a deployed environment. See loadConfig in src/config.ts.
  process.env['ADMIN_DEV_IDENTITY'] = '1';
  process.env['API_BASE_URL'] = stub.url;
  process.env['CONTRACT_PATH'] = CONTRACT_PATH;
  process.env['CONTENT_DIR'] = options.contentDir ?? CONTENT_DIR;
  process.env['SESSION_SECRET'] = 'test-session-secret';
  process.env['API_DEV_JWT_SECRET'] = SIGNING_KEY;
  process.env['USERS_FILE'] = join(scratch, 'users.json');
  process.env['AUDIT_FILE'] = join(scratch, 'audit.log');
  process.env['PUBLISH_VERIFY_ATTEMPTS'] = '2';
  process.env['PUBLISH_VERIFY_INTERVAL_MS'] = '10';
  process.env['LOG_LEVEL'] = 'silent';

  const { buildApp } = await import('../../src/server.js');
  const { decodeSession } = await import('../../src/auth/session.js');
  const app = await buildApp();
  await app.ready();

  async function signIn(role: Role): Promise<Session> {
    const credentials = CREDENTIALS[role];
    const response = await app.inject({
      method: 'POST',
      url: '/sign-in',
      payload: `email=${encodeURIComponent(credentials.email)}&password=${encodeURIComponent(credentials.password)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const setCookie = response.headers['set-cookie'];
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (!raw) throw new Error(`Sign in as ${role} returned no session cookie. Status ${response.statusCode}.`);
    const cookie = String(raw).split(';')[0] as string;
    const value = cookie.slice(cookie.indexOf('=') + 1);
    const session = decodeSession(decodeURIComponent(value));
    if (!session) throw new Error('The session cookie could not be decoded by the application that issued it.');
    return { cookie, csrf: session.csrf, role };
  }

  return {
    app,
    stub,
    signIn,
    async close() {
      await app.close();
      await stub.app.close();
    },
  };
}

export function form(session: Session | undefined, fields: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  if (session) params.set('_csrf', session.csrf);
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return params.toString();
}

export const FORM_HEADERS = { 'content-type': 'application/x-www-form-urlencoded' };
