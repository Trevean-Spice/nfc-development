import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import { config, packageRoot } from './config.js';
import { contract } from './contract.js';
import { attachPrincipal, deniedStatus, markDenied } from './auth/guard.js';
import { ApiError, ApiUnreachable } from './api/errors.js';
import { apiFailure } from './views/components.js';
import { html } from './views/html.js';
import { page } from './views/layout.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerBlendRoutes } from './routes/blends.js';
import { registerRecipeRoutes } from './routes/recipes.js';
import { registerGrowerRoutes } from './routes/growers.js';
import { registerMediaRoutes } from './routes/media.js';
import { registerNfcRoutes } from './routes/nfc.js';
import { registerAnalyticsRoutes } from './routes/analytics.js';
import { registerUserRoutes } from './routes/users.js';
import { registerMiscRoutes } from './routes/misc.js';
import { sendHtml } from './routes/support.js';

/**
 * The admin application.
 *
 * Server rendered HTML with progressive enhancement and no client framework. That is a
 * decision, not a shortcut, and it has three reasons:
 *
 *   Authorisation is decided on the server, in one place, before any markup exists. A single
 *   page application decides in the browser what to render and then asks the server to agree,
 *   which means the interesting question is answered twice and the two answers can differ.
 *
 *   Every third party library has to be listed and licensed to Trevean indefinitely under the
 *   Scope document, "IP and handoff". Six runtime dependencies is a handoff. Six hundred is a
 *   liability somebody inherits.
 *
 *   A marketing team has to be able to use this without a developer, on whatever laptop they
 *   have. A form that posts and a page that reloads has no build step, no bundle to fail and
 *   no state to lose.
 */

export async function buildApp(): Promise<FastifyInstance> {
  // Fail at startup rather than at the first request if the contract cannot be read. Every
  // authorisation decision in this process comes from it.
  const loaded = contract();

  const app = Fastify({
    logger: {
      // Request logging is emitted at info level, so the default of warn suppresses it
      // without the deprecated disableRequestLogging switch.
      level: process.env.LOG_LEVEL ?? 'warn',
      // The admin holds a bearer token and a session cookie. Neither is ever logged.
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    },
  });

  await app.register(cookie, { secret: config.session.secret });
  await app.register(formbody);
  await app.register(fastifyStatic, {
    root: join(packageRoot, 'public'),
    prefix: '/static/',
    cacheControl: false,
  });

  app.addHook('onRequest', async (request) => {
    attachPrincipal(request);
  });

  app.decorate('contractVersion', loaded.version);

  await registerAuthRoutes(app);
  await registerBlendRoutes(app);
  await registerRecipeRoutes(app);
  await registerGrowerRoutes(app);
  await registerMediaRoutes(app);
  await registerNfcRoutes(app);
  await registerAnalyticsRoutes(app);
  await registerUserRoutes(app);
  await registerMiscRoutes(app);

  app.setNotFoundHandler(async (request, reply) => {
    const body = html`<section class="card narrow">
      <h1>Not here</h1>
      <p class="hint">No screen at <code>${request.url}</code>.</p>
      <p><a class="btn" href="/">Back to blends</a></p>
    </section>`;
    return sendHtml(reply, page({ title: 'Not found', principal: request.principal }, body), 404);
  });

  app.setErrorHandler(async (error, request, reply) => {
    const denied = deniedStatus(error);
    if (denied) {
      if (denied.status === 401) {
        // A signed out person following a link is sent to sign in and back again, rather
        // than being shown a refusal they cannot act on.
        if (request.method === 'GET') {
          const next = encodeURIComponent(request.url);
          return reply.redirect(`/sign-in?next=${next}`, 302);
        }
      }
      markDenied(reply, denied);
      const body = html`<section class="card narrow">
        <h1>${denied.status === 401 ? 'Not signed in' : 'Not allowed'}</h1>
        <div class="flash flash-error"><b>${denied.reason}</b><p>${denied.detail}</p></div>
        ${denied.status === 403
          ? html`<p class="hint">
              This is refused on the server and it is refused again by the API. Insufficient role
              returns 403 rather than 404 on purpose: hiding the existence of a screen from an
              authenticated colleague buys nothing and makes support harder.
            </p>`
          : ''}
        <p><a class="btn" href="/">Back to blends</a></p>
      </section>`;
      return sendHtml(reply, page({ title: 'Not allowed', principal: request.principal }, body), denied.status);
    }

    if (error instanceof ApiError || error instanceof ApiUnreachable) {
      const status = error instanceof ApiError ? error.status : 502;
      const body = html`<section class="card">
        <h1>The API refused that</h1>
        ${apiFailure(error)}
        <p><a class="btn" href="/">Back to blends</a></p>
      </section>`;
      return sendHtml(reply, page({ title: 'API error', principal: request.principal }, body), status);
    }

    request.log.error({ err: error }, 'unhandled admin error');
    const body = html`<section class="card narrow">
      <h1>Something went wrong</h1>
      <div class="flash flash-error"><b>Unhandled error</b><p>${(error as Error).message}</p></div>
      <p><a class="btn" href="/">Back to blends</a></p>
    </section>`;
    return sendHtml(reply, page({ title: 'Error', principal: request.principal }, body), 500);
  });

  /*
   * Mount prefix, applied on the way out rather than threaded through 38 call sites.
   *
   * The admin is served at /admin on the apex distribution, and a CloudFront function strips
   * that prefix before the origin sees it, so this application legitimately believes it lives
   * at the root. That works for incoming requests and breaks everything it emits: a redirect
   * to /, a link to /blends/persian-sunrise and a stylesheet at /static/admin.css all resolve
   * against the apex rather than under /admin, so signing in bounced the browser to the
   * marketing site.
   *
   * The alternative was a path helper wrapped around every generated URL, which is 27 hrefs
   * and 11 redirects today and an ongoing tax on everyone who adds a link afterwards. One
   * hook cannot be forgotten.
   *
   * Root absolute URLs only. A relative href is already correct, an absolute one with a
   * scheme belongs to somebody else, and // is protocol relative and also somebody else's.
   * Empty ADMIN_BASE_PATH makes the whole thing a no op, which is what a laptop runs.
   */
  if (config.basePath) {
    const prefix = config.basePath;

    app.addHook('onSend', async (_request, reply, payload) => {
      const location = reply.getHeader('location');
      if (typeof location === 'string' && location.startsWith('/') && !location.startsWith('//')) {
        reply.header('location', `${prefix}${location}`);
      }

      const type = String(reply.getHeader('content-type') ?? '');
      if (typeof payload === 'string' && type.includes('text/html')) {
        return payload.replace(
          /(href|action|src)="\/(?!\/)/g,
          (_match, attribute: string) => `${attribute}="${prefix}/`,
        );
      }

      return payload;
    });
  }

  return app;
}
