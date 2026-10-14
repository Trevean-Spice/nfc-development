import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeJwt } from 'jose';
import type { FastifyInstance } from 'fastify';
import { setup, form, CONTRACT_PATH, FORM_HEADERS, type Harness, type Session } from '../helpers/harness.js';
import { loadContract } from '../../src/contract.js';
import { rankOf, ROLES, type Role } from '../../src/auth/roles.js';

/**
 * Role enforcement. This is the suite that matters.
 *
 * An admin write endpoint reachable by an unauthenticated or under privileged caller is the
 * worst thing this application could ship with, so every guarded route is asserted four ways:
 *
 *   1. Unauthenticated. A GET is sent to sign in; a POST is refused outright.
 *   2. Under privileged. Refused by the admin, server side, with 403 and never 404.
 *   3. Sufficiently privileged. The request has to actually succeed, in the terms that route
 *      succeeds in, not merely avoid a 401 and a 403. A route that answers 500, or 404, or a
 *      redirect to the sign in screen, is not enforcing anything, and a pair of assertions
 *      that only rule out two status codes cannot tell the difference.
 *   4. The API is refused too. The stub API reads the same x-minimum-role out of the same
 *      frozen document and verifies the token the admin actually minted, so a hole in the
 *      admin's own guard would still be caught one layer down.
 *
 * Plus the escalation case, which is the one that is usually the real bug: the token the
 * admin mints must carry exactly the session's role and never more.
 *
 * TWO THINGS ABOUT THE MATRIX ITSELF, because a matrix that is quietly incomplete is worse
 * than no matrix: it is counted as coverage.
 *
 *   The minimum role is not typed here. It is read from `x-minimum-role` in the same frozen
 *   OpenAPI document the application reads at startup, so if the contract lowers or raises an
 *   operation the negative and positive cases follow it in the same commit. The three routes
 *   that are not contract operations say so, by name, below.
 *
 *   The route list is checked against the routes the application actually registered, read
 *   back off the built Fastify instance. A route added later is either enrolled here or it
 *   fails the coverage test. It cannot be silently untested, which is what happened to eight
 *   of them, one of them a write.
 */

/**
 * The frozen contract, loaded directly from its path rather than through `contract()`.
 *
 * `contract()` reads `config`, and configuration in this application resolves once on first
 * access. Touching it at module load, before the harness has pointed the admin at its stand in
 * API, would freeze the wrong base URL for the whole file.
 */
const frozen = loadContract(CONTRACT_PATH);

/** The lowest role in the system, which is what `requireSignedIn` accepts. */
const LOWEST_ROLE = [...ROLES].sort((a, b) => rankOf(a) - rankOf(b))[0] as Role;

let h: Harness;
const sessions = {} as Record<Role, Session>;
/** Filled in once the local development identity provider has been read. */
let adminSubject = '';

beforeAll(async () => {
  h = await setup();
  sessions.Viewer = await h.signIn('Viewer');
  sessions.Editor = await h.signIn('Editor');
  sessions.Admin = await h.signIn('Admin');
  const { users } = await import('../../src/auth/users.js');
  adminSubject = users().list().find((u) => u.email === 'admin@treveanspice.com')?.subject ?? '';
  expect(adminSubject).not.toBe('');
});

afterAll(async () => {
  await h.close();
});

/**
 * What a caller who is allowed to make this request gets back.
 *
 * Stated per route because the shapes genuinely differ: a screen is 200 and HTML, a form post
 * is 302 to where the editor is sent next, and the two media calls answer JSON to the browser
 * uploader. Anything vaguer than this is the assertion that was here before.
 */
interface Success {
  status: number;
  location?: RegExp;
  contains?: string;
}

/**
 * Where the route's minimum role comes from. `operation` is an operation id in the frozen
 * contract. The other two exist because three routes are not contract operations at all:
 *
 *   `signedIn`  the screen reads nothing behind an admin operation, or reads a public one, so
 *               the guard is `requireSignedIn` and the minimum is the lowest role there is.
 *   `role`      the frozen contract defines no user or role management operation at any path,
 *               deliberately, because on the Trevean account roles come from the managed
 *               identity provider. See the admin README, section 9, item 3. So `/users` names
 *               its role in code and this is the one place it is restated.
 */
type Guard = { operation: string } | { signedIn: true } | { role: Role };

interface Route {
  name: string;
  method: 'GET' | 'POST';
  /** The path as Fastify registered it, which is what the coverage test matches on. */
  path: string;
  /** The concrete request, which may need a value that only exists at run time. */
  url: string | (() => string);
  guard: Guard;
  payload?: (session: Session) => string;
  success: Success;
}

function urlOf(route: Route): string {
  return typeof route.url === 'function' ? route.url() : route.url;
}

function minimumOf(route: Route): Role {
  if ('operation' in route.guard) return frozen.minimumRole(route.guard.operation);
  if ('role' in route.guard) return route.guard.role;
  return LOWEST_ROLE;
}

const SEEDED_GROWER = 'grw_01J9Z900A1B2C3D4E5F6G7H8J9';
const SEEDED_RECIPE = 'rcp_01J9Z91B2C3D4E5F6G7H8J9K0M';
const SEEDED_MEDIA = 'med_01J9Z8XK4M2Q7T5V3N8R1B6C0D';
const OVERRIDE_PHRASE = 'PUBLISH PLACEHOLDER CONTENT';

const ROUTES: Route[] = [
  // Reads.
  {
    name: 'blend list',
    method: 'GET',
    path: '/',
    url: '/',
    guard: { operation: 'adminListBlends' },
    success: { status: 200, contains: '<h1>Blends</h1>' },
  },
  {
    name: 'blend editor',
    method: 'GET',
    path: '/blends/:slug',
    url: '/blends/persian-sunrise',
    guard: { operation: 'adminGetBlend' },
    success: { status: 200, contains: '<title>Persian Sunrise | Trevean Spice admin</title>' },
  },
  {
    name: 'preview frame',
    method: 'GET',
    path: '/blends/:slug/preview',
    url: '/blends/persian-sunrise/preview',
    guard: { operation: 'adminGetBlend' },
    success: { status: 200, contains: '<h1>Preview</h1>' },
  },
  {
    name: 'preview document',
    method: 'GET',
    path: '/blends/:slug/preview.html',
    url: '/blends/persian-sunrise/preview.html',
    guard: { operation: 'adminGetBlend' },
    success: { status: 200, contains: '<title>Preview: Persian Sunrise</title>' },
  },
  {
    name: 'media list',
    method: 'GET',
    path: '/media',
    url: '/media',
    guard: { operation: 'adminListMedia' },
    success: { status: 200, contains: '<h1>Media</h1>' },
  },
  {
    name: 'media record',
    method: 'GET',
    path: '/media/:mediaId',
    url: `/media/${SEEDED_MEDIA}`,
    guard: { operation: 'adminGetMedia' },
    success: { status: 200, contains: '<h1>hero.jpg</h1>' },
  },
  {
    name: 'analytics',
    method: 'GET',
    path: '/analytics',
    url: '/analytics',
    guard: { operation: 'adminGetScanTimeSeries' },
    success: { status: 200, contains: '<h1>Scans</h1>' },
  },
  {
    name: 'growers',
    method: 'GET',
    path: '/growers',
    url: '/growers',
    guard: { signedIn: true },
    success: { status: 200, contains: '<h1>Growers</h1>' },
  },
  {
    name: 'grower record',
    method: 'GET',
    path: '/growers/:growerId',
    url: `/growers/${SEEDED_GROWER}`,
    guard: { signedIn: true },
    success: { status: 200, contains: 'GROWER NAME PENDING' },
  },
  {
    name: 'recipe editor',
    method: 'GET',
    path: '/recipes/:recipeId',
    url: `/recipes/${SEEDED_RECIPE}`,
    guard: { operation: 'adminListBlends' },
    success: { status: 200, contains: 'RECIPE 1 PENDING' },
  },
  {
    name: 'content readiness',
    method: 'GET',
    path: '/content-readiness',
    url: '/content-readiness',
    guard: { signedIn: true },
    success: { status: 200, contains: '<h1>Content readiness</h1>' },
  },
  {
    name: 'audit log',
    method: 'GET',
    path: '/audit',
    url: '/audit',
    guard: { signedIn: true },
    success: { status: 200, contains: '<h1>Audit</h1>' },
  },
  {
    name: 'authorisation table',
    method: 'GET',
    path: '/authorisation',
    url: '/authorisation',
    guard: { signedIn: true },
    success: { status: 200, contains: '<h1>Authorisation</h1>' },
  },
  {
    name: 'new blend form',
    method: 'GET',
    path: '/blends/new',
    url: '/blends/new',
    guard: { operation: 'adminCreateBlend' },
    success: { status: 200, contains: '<h1>New blend</h1>' },
  },
  {
    name: 'publish screen',
    method: 'GET',
    path: '/blends/:slug/publish',
    url: '/blends/persian-sunrise/publish',
    guard: { operation: 'adminPublishBlend' },
    success: { status: 200, contains: 'Publish Persian Sunrise' },
  },
  {
    /*
     * The publish pipeline status read. Signed in, because it reads a job record and writes
     * nothing, and because the person who needs to know whether their change reached the page
     * is the person who published it. It is enrolled here for the same reason every other
     * route is: a route added to the application and not enrolled in this table fails the
     * completeness assertion at the end of this file rather than shipping unguarded.
     */
    name: 'publish pipeline status',
    method: 'GET',
    path: '/blends/:slug/publish/status/:revalidationId',
    url: '/blends/persian-sunrise/publish/status/rvl_01J9Z95D6E7F8G9H0J1K2M3N4P',
    guard: { signedIn: true },
    success: { status: 200, contains: '<h1>Publish status</h1>' },
  },
  {
    name: 'new recipe form',
    method: 'GET',
    path: '/recipes/new',
    url: '/recipes/new?blend=persian-sunrise',
    guard: { operation: 'adminCreateRecipe' },
    success: { status: 200, contains: '<h1>New recipe' },
  },
  {
    name: 'new grower form',
    method: 'GET',
    path: '/growers/new',
    url: '/growers/new',
    guard: { operation: 'adminCreateGrower' },
    success: { status: 200, contains: '<h1>New grower</h1>' },
  },
  {
    name: 'tag records',
    method: 'GET',
    path: '/nfc',
    url: '/nfc',
    guard: { operation: 'adminListTagRecords' },
    success: { status: 200, contains: 'NFC, tags and the redirect table' },
  },
  {
    name: 'role list',
    method: 'GET',
    path: '/users',
    url: '/users',
    guard: { role: 'Admin' },
    success: { status: 200, contains: '<h1>Roles</h1>' },
  },

  // Writes. Ordered so that each one runs against state the one before it left behind.
  {
    name: 'save blend',
    method: 'POST',
    path: '/blends/:slug',
    url: '/blends/persian-sunrise',
    guard: { operation: 'adminUpdateBlend' },
    payload: (s) => form(s, { version: 1, name: 'Persian Sunrise' }),
    success: { status: 302, location: /^\/blends\/persian-sunrise\?saved=1$/ },
  },
  {
    name: 'create blend',
    method: 'POST',
    path: '/blends',
    url: '/blends',
    guard: { operation: 'adminCreateBlend' },
    payload: (s) => form(s, { slug: 'silk-road', name: 'The Silk Road' }),
    success: { status: 302, location: /^\/blends\/silk-road\?saved=1$/ },
  },
  {
    /**
     * The version is deliberately not sent: the route falls back to the blend's own current
     * version, so this case does not go stale behind the save above. The override is supplied
     * because every seeded blend still carries placeholder content, and a publish this suite
     * cannot complete would leave the positive case asserting a refusal again. The guard's own
     * refusal paths are covered in the publish flow suite.
     */
    name: 'publish blend',
    method: 'POST',
    path: '/blends/:slug/publish',
    url: '/blends/persian-sunrise/publish',
    guard: { operation: 'adminPublishBlend' },
    payload: (s) =>
      form(s, {
        override_phrase: OVERRIDE_PHRASE,
        override_reason: 'The role matrix publishes once so the permitted case is a publish and not a refusal.',
        override_ack: 'on',
      }),
    success: { status: 200, contains: 'The API accepted the publish and queued regeneration' },
  },
  {
    name: 'revalidate',
    method: 'POST',
    path: '/revalidate',
    url: '/revalidate',
    guard: { operation: 'adminRevalidate' },
    payload: (s) => form(s, { slug: 'persian-sunrise', reason: 'cache and data disagreed' }),
    success: { status: 200, contains: '<h1>Revalidation queued</h1>' },
  },
  {
    name: 'create recipe',
    method: 'POST',
    path: '/recipes',
    url: '/recipes',
    guard: { operation: 'adminCreateRecipe' },
    payload: (s) => form(s, { blendSlug: 'persian-sunrise', title: 'A recipe' }),
    success: { status: 302, location: /^\/recipes\/rcp_[A-Za-z0-9]+\?saved=1$/ },
  },
  {
    name: 'update recipe',
    method: 'POST',
    path: '/recipes/:recipeId',
    url: `/recipes/${SEEDED_RECIPE}`,
    guard: { operation: 'adminUpdateRecipe' },
    payload: (s) => form(s, { version: 1, title: 'Changed' }),
    success: { status: 302, location: new RegExp(`^/recipes/${SEEDED_RECIPE}\\?saved=1$`) },
  },
  {
    name: 'archive recipe',
    method: 'POST',
    path: '/recipes/:recipeId/archive',
    url: `/recipes/${SEEDED_RECIPE}/archive`,
    guard: { operation: 'adminDeleteRecipe' },
    payload: (s) => form(s, {}),
    success: { status: 302, location: /^\/$/ },
  },
  {
    name: 'create grower',
    method: 'POST',
    path: '/growers',
    url: '/growers',
    guard: { operation: 'adminCreateGrower' },
    payload: (s) => form(s, { name: 'A grower' }),
    success: { status: 302, location: /^\/growers\/grw_[A-Za-z0-9]+$/ },
  },
  {
    name: 'update grower',
    method: 'POST',
    path: '/growers/:growerId',
    url: `/growers/${SEEDED_GROWER}`,
    guard: { operation: 'adminUpdateGrower' },
    payload: (s) => form(s, { version: 3, name: 'A grower' }),
    success: { status: 200, contains: '<h1>A grower</h1>' },
  },
  {
    name: 'media ticket',
    method: 'POST',
    path: '/media/ticket',
    url: '/media/ticket',
    guard: { operation: 'adminCreateMediaUpload' },
    payload: (s) => form(s, { filename: 'hero.jpg', contentType: 'image/jpeg', bytes: 1024, kind: 'hero' }),
    success: { status: 200, contains: '"uploadUrl"' },
  },
  {
    name: 'complete media upload',
    method: 'POST',
    path: '/media/:mediaId/complete',
    url: `/media/${SEEDED_MEDIA}/complete`,
    guard: { operation: 'adminCompleteMediaUpload' },
    payload: (s) => form(s, { alt: 'A jar of Persian Sunrise' }),
    success: { status: 200, contains: '"status":"processing"' },
  },
  {
    /** The Admin's own account, set to the role it already holds, so this is a real 302. */
    name: 'role change',
    method: 'POST',
    path: '/users/:subject/role',
    url: () => `/users/${adminSubject}/role`,
    guard: { role: 'Admin' },
    payload: (s) => form(s, { role: 'Admin' }),
    success: { status: 302, location: /^\/users$/ },
  },
];

/**
 * Every route the application registered, read back off the built Fastify instance.
 *
 * Fastify has no public list, so this reconstructs one from `printRoutes()`, whose tree nests
 * each node under the prefix it extends: concatenating the labels from the root down gives the
 * registered path exactly. The parser refuses an indentation it does not understand rather
 * than guessing, and the coverage test below compares the result with the matrix in both
 * directions, so an enumeration that quietly returned nothing fails rather than passes.
 */
function registeredRoutes(app: FastifyInstance): Array<{ method: string; path: string }> {
  const prefixes: string[] = [];
  const out: Array<{ method: string; path: string }> = [];
  for (const line of app.printRoutes().split('\n')) {
    if (line.trim() === '') continue;
    const connector = line.indexOf('── ');
    const start = connector >= 0 ? connector + 3 : 0;
    if (start % 4 !== 0) throw new Error(`Route tree line was not understood: ${JSON.stringify(line)}`);
    const depth = start / 4;
    const rest = line.slice(start);
    const withMethods = /^(.*) \(([A-Z]+(?:, [A-Z]+)*)\)$/.exec(rest);
    prefixes.length = Math.max(depth - 1, 0);
    prefixes.push(withMethods ? (withMethods[1] as string) : rest);
    if (!withMethods) continue;
    const path = prefixes.join('');
    for (const method of (withMethods[2] as string).split(', ')) out.push({ method, path });
  }
  return out;
}

/**
 * The routes that are reachable without a session, on purpose. Everything else in the
 * application has to be in the matrix.
 *
 * HEAD is excluded rather than listed: Fastify derives a HEAD route from every GET handler, so
 * it runs the same guard in the same function and asserting it separately would double the
 * matrix without testing anything new.
 */
const PUBLIC_ROUTES = new Set([
  'GET /sign-in', // the sign in screen itself
  'POST /sign-in', // and the credential post
  'GET /sign-out', // clears the cookie, useful to a caller who no longer has one
  'GET /health', // liveness, no content and no principal
  'GET /static/*', // the stylesheet and the 90 lines of upload JavaScript
]);

function guardedRouteKeys(app: FastifyInstance): string[] {
  return registeredRoutes(app)
    .filter((r) => r.method !== 'HEAD')
    .map((r) => `${r.method} ${r.path}`)
    .filter((key) => !PUBLIC_ROUTES.has(key))
    .sort();
}

describe('the matrix is every guarded route, not a hand picked subset', () => {
  it('covers every route the application registered, and nothing it did not', () => {
    const registered = guardedRouteKeys(h.app);
    const declared = ROUTES.map((r) => `${r.method} ${r.path}`).sort();

    // A route added to the application and not enrolled here would otherwise never be tested.
    expect(registered.filter((key) => !declared.includes(key))).toEqual([]);
    // And an entry left behind for a route that no longer exists is a test that proves nothing.
    expect(declared.filter((key) => !registered.includes(key))).toEqual([]);
    expect(new Set(declared).size).toBe(declared.length);
  });

  it('and the enumeration cannot shrink silently, because the contract sets the floor', () => {
    const registered = guardedRouteKeys(h.app);
    const adminOperations = frozen.adminOperations().map((op) => op.operationId).sort();
    const exercised = new Set(ROUTES.flatMap((r) => ('operation' in r.guard ? [r.guard.operation] : [])));

    // The frozen contract declares 17 admin operations. If reading it ever returns fewer, or
    // if the route enumeration returns fewer routes than there are operations to reach them
    // through, both the coverage test above and this one would be checking an empty set.
    expect(adminOperations.length).toBeGreaterThanOrEqual(17);
    expect(registered.length).toBeGreaterThanOrEqual(adminOperations.length);

    // Every admin operation the contract declares is reachable through a route in the matrix.
    // An eighteenth operation added to the contract fails here until somebody decides whether
    // the admin exposes it, rather than being untested by omission.
    expect(adminOperations.filter((id) => !exercised.has(id))).toEqual([]);
  });

  it('and takes every minimum role from the frozen contract rather than restating it', () => {
    for (const route of ROUTES) {
      if (!('operation' in route.guard)) continue;
      const op = frozen.operation(route.guard.operation);
      expect(op.path.startsWith('/v1/admin/') || op.minimumRole !== null).toBe(true);
      expect(ROLES).toContain(minimumOf(route));
    }
  });
});

describe('unauthenticated callers reach nothing', () => {
  for (const route of ROUTES) {
    it(`${route.method} ${route.path} (${route.name})`, async () => {
      const response = await h.app.inject({
        method: route.method,
        url: urlOf(route),
        payload: route.method === 'POST' ? route.payload?.({ csrf: 'x', cookie: '', role: 'Admin' }) : undefined,
        headers: route.method === 'POST' ? FORM_HEADERS : {},
      });
      if (route.method === 'GET') {
        // A signed out person following a link is sent to sign in and back again.
        expect(response.statusCode).toBe(302);
        expect(response.headers['location']).toContain('/sign-in');
      } else {
        expect(response.statusCode).toBe(401);
        expect(response.headers['x-admin-denied']).toBe('UNAUTHENTICATED');
      }
    });
  }
});

describe('under privileged callers are refused with 403 and never 404', () => {
  for (const route of ROUTES) {
    const minimum = minimumOf(route);
    for (const role of ROLES) {
      if (rankOf(role) >= rankOf(minimum)) continue;
      it(`${role} cannot ${route.method} ${route.path} (${route.name}, needs ${minimum})`, async () => {
        const session = sessions[role];
        const response = await h.app.inject({
          method: route.method,
          url: urlOf(route),
          payload: route.method === 'POST' ? route.payload?.(session) : undefined,
          headers: { cookie: session.cookie, ...(route.method === 'POST' ? FORM_HEADERS : {}) },
        });
        expect(response.statusCode).toBe(403);
        expect(response.headers['x-admin-denied']).toBe('INSUFFICIENT_ROLE');
      });
    }
  }
});

describe('sufficiently privileged callers are not refused, and the request actually succeeds', () => {
  for (const route of ROUTES) {
    const minimum = minimumOf(route);
    it(`${minimum} may ${route.method} ${route.path} (${route.name})`, async () => {
      const session = sessions[minimum];
      const response = await h.app.inject({
        method: route.method,
        url: urlOf(route),
        payload: route.method === 'POST' ? route.payload?.(session) : undefined,
        headers: { cookie: session.cookie, ...(route.method === 'POST' ? FORM_HEADERS : {}) },
      });

      expect(response.statusCode).not.toBe(401);
      expect(response.statusCode).not.toBe(403);
      expect(response.headers['x-admin-denied']).toBeUndefined();

      // The part the pair above cannot see. Each of these outcomes passed the old assertion.
      expect(response.body).not.toContain('<h1>Sign in</h1>');
      expect(response.body).not.toContain('<h1>Not here</h1>');
      expect(response.body).not.toContain('<h1>Something went wrong</h1>');
      expect(response.body).not.toContain('<h1>The API refused that</h1>');

      expect(response.statusCode).toBe(route.success.status);
      if (route.success.location !== undefined) {
        expect(response.headers['location']).toMatch(route.success.location);
      }
      if (route.success.contains !== undefined) {
        expect(response.body).toContain(route.success.contains);
      }
    });
  }
});

describe('the API refuses independently of the admin', () => {
  it('a Viewer token is refused by the API on an Editor operation', async () => {
    const { ApiClient } = await import('../../src/api/client.js');
    const { mintApiToken } = await import('../../src/auth/tokens.js');
    // Deliberately bypass the admin's own guard by calling the client with a Viewer
    // principal on an Editor operation. The client refuses first, which is the point.
    const client = new ApiClient(
      { subject: 'usr_test', email: 'viewer@treveanspice.com', name: 'Viewer', role: 'Viewer' },
      mintApiToken,
      h.stub.url,
    );
    await expect(client.publishBlend('persian-sunrise', { version: 1 })).rejects.toMatchObject({
      code: 'INSUFFICIENT_ROLE',
    });
  });

  it('and if the client guard were removed, the API still refuses the minted token', async () => {
    const { mintApiToken } = await import('../../src/auth/tokens.js');
    const token = await mintApiToken({
      subject: 'usr_test',
      email: 'viewer@treveanspice.com',
      name: 'Viewer',
      role: 'Viewer',
    });
    const response = await fetch(`${h.stub.url}/v1/admin/blends/persian-sunrise/publish`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1 }),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INSUFFICIENT_ROLE');
  });

  it('an unauthenticated call to an admin operation is 401 at the API', async () => {
    const response = await fetch(`${h.stub.url}/v1/admin/tags`);
    expect(response.status).toBe(401);
  });
});

describe('the token the admin mints carries exactly the session role', () => {
  it('never more than one role, and never a role the caller does not hold', async () => {
    const { mintApiToken } = await import('../../src/auth/tokens.js');
    for (const role of ['Viewer', 'Editor', 'Admin'] as Role[]) {
      const token = await mintApiToken({ subject: 'usr_x', email: 'x@treveanspice.com', name: 'X', role });
      const claims = decodeJwt(token) as { roles?: string[] };
      expect(claims.roles).toEqual([role]);
    }
  });

  it('a request made through the admin as Editor reaches the API as Editor', async () => {
    const before = h.stub.state.requests.length;
    await h.app.inject({
      method: 'POST',
      url: '/revalidate',
      payload: form(sessions.Editor, { slug: 'persian-sunrise', reason: 'checking the role on the wire' }),
      headers: { cookie: sessions.Editor.cookie, ...FORM_HEADERS },
    });
    const seen = h.stub.state.requests.slice(before).filter((r) => r.url.includes('/v1/admin/revalidate'));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]?.role).toBe('Editor');
  });
});

describe('a role revoked in the store takes effect on the next request', () => {
  it('does not wait for the session to expire, because the cookie role is a cache and not an authority', async () => {
    const { users } = await import('../../src/auth/users.js');
    const editor = users().list().find((u) => u.email === 'editor@treveanspice.com');
    expect(editor).toBeDefined();

    const allowed = await h.app.inject({
      method: 'GET',
      url: '/blends/new',
      headers: { cookie: sessions.Editor.cookie },
    });
    expect(allowed.statusCode).toBe(200);

    users().setRole(editor!.subject, 'Viewer');
    const refused = await h.app.inject({
      method: 'GET',
      url: '/blends/new',
      headers: { cookie: sessions.Editor.cookie },
    });
    expect(refused.statusCode).toBe(403);

    users().setRole(editor!.subject, 'Editor');
  });
});

describe('CSRF', () => {
  it('a write without the session token is refused even with the right role', async () => {
    const response = await h.app.inject({
      method: 'POST',
      url: '/blends/persian-sunrise',
      payload: 'version=1&name=Changed',
      headers: { cookie: sessions.Editor.cookie, ...FORM_HEADERS },
    });
    expect(response.statusCode).toBe(403);
    expect(response.headers['x-admin-denied']).toBe('CSRF_FAILED');
  });

  it('another session token is not accepted', async () => {
    const response = await h.app.inject({
      method: 'POST',
      url: '/blends/persian-sunrise',
      payload: form(sessions.Admin, { version: 1, name: 'Changed' }),
      headers: { cookie: sessions.Editor.cookie, ...FORM_HEADERS },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('a tampered session cookie is not a role', () => {
  it('editing the cookie fails the signature rather than granting Admin', async () => {
    const tampered = sessions.Viewer.cookie.replace(/=.*$/, '=forged.forged');
    const response = await h.app.inject({ method: 'GET', url: '/users', headers: { cookie: tampered } });
    expect(response.statusCode).toBe(302);
    expect(response.headers['location']).toContain('/sign-in');
  });
});
