import Fastify, { type FastifyInstance } from 'fastify';
import { config } from './config/env.js';
import { ApiError, ErrorCodes, internalError, malformedJson } from './http/errors.js';
import { logger } from './observability/logger.js';
import { ulid } from './util/ulid.js';
import { registerContentRoutes } from './routes/content.js';
import { registerScanRoutes } from './routes/scanEvents.js';
import { registerCatalogRoutes } from './routes/catalog.js';
import { registerAdminContentRoutes } from './routes/admin/content.js';
import { registerAdminMediaRoutes } from './routes/admin/media.js';
import { registerAdminPublishingRoutes } from './routes/admin/publishing.js';
import { registerAdminAnalyticsRoutes } from './routes/admin/analytics.js';
import { registerAdminTagRoutes } from './routes/admin/tags.js';
import { registerWebhookRoutes } from './routes/webhooks.js';
import { registerRateLimit } from './http/rateLimit.js';

/**
 * The HTTP application.
 *
 * A note that belongs where an engineer will read it before wiring anything up:
 *
 *   NOTHING IN THIS FILE IS ON THE TAP CRITICAL PATH EXCEPT POST /v1/scan-events, AND
 *   THAT FIRES AFTER THE PAGE IS READABLE.
 *
 * The blend page is pre-rendered and served from the CDN edge cache. On a tap the sequence
 * is: 307 at the edge, cached HTML from the edge, paint, then a beacon. A page that
 * fetches content from this API on load adds a DNS lookup, a TLS handshake to a second
 * host, a possible cold start and a database read to a 2.0 second budget that has roughly
 * 400 ms of headroom on cellular. It will work perfectly in development and fail in a
 * customer's kitchen on the first tap of the morning.
 *
 * The <200 ms p95 content retrieval target protects publish-to-live and the admin
 * experience. It is not what protects the tap budget. The pre-rendered page is.
 */

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    disableRequestLogging: true,
    trustProxy: false,
    bodyLimit: 256 * 1024,
    // The API is behind a CDN that terminates and normalises requests. Keeping Fastify's
    // own request id off avoids two competing ids in the logs: there is exactly one, it is
    // a ULID, and it is the value in X-Request-Id, in error.requestId and in the log line.
    genReqId: () => ulid(),
  });

  app.addHook('onRequest', async (request, reply) => {
    request.requestId = String(request.id);
    reply.header('x-request-id', request.requestId);
  });

  /**
   * navigator.sendBeacon cannot set headers. Depending on what the page passes it, the
   * body arrives as application/json (a Blob with that type) or text/plain (a string), and
   * some browsers send it with no useful type at all. All three parse the same way here,
   * because a telemetry endpoint that 415s the browser's own beacon is a telemetry
   * endpoint that measures nothing.
   */
  const parseJson = (req: { url?: string; rawBody?: string }, body: string, done: (err: Error | null, value?: unknown) => void): void => {
    // Webhook signatures are computed over the raw bytes, so the raw string is kept for
    // those routes only. Keeping it for every request would retain body bytes on the tap
    // path for no reason.
    if (req.url?.startsWith('/internal/webhooks')) req.rawBody = body;
    if (body === undefined || body === null || body === '') {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(body));
    } catch {
      done(malformedJson());
    }
  };
  app.addContentTypeParser('application/json', { parseAs: 'string' }, parseJson as never);
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, parseJson as never);
  app.addContentTypeParser('*', { parseAs: 'string' }, parseJson as never);

  app.setErrorHandler((error, request, reply) => {
    const requestId = request.requestId ?? ulid();
    reply.header('x-request-id', requestId);

    if (error instanceof ApiError) {
      if (error.headers) {
        for (const [k, v] of Object.entries(error.headers)) reply.header(k, v);
      }
      if (error.status >= 500) {
        logger.error('request failed', { requestId, code: error.code, status: error.status, path: request.url });
      }
      reply.status(error.status).send(error.toBody(requestId));
      return;
    }

    if ((error as { statusCode?: number }).statusCode === 413) {
      reply.status(413).send({
        error: { code: ErrorCodes.PAYLOAD_TOO_LARGE, message: 'The request body is too large.', requestId },
      });
      return;
    }

    logger.error('unhandled error', {
      requestId,
      path: request.url,
      method: request.method,
      name: (error as Error).name,
      message: (error as Error).message,
    });
    const fallback = internalError();
    reply.status(500).send(fallback.toBody(requestId));
  });

  app.setNotFoundHandler((request, reply) => {
    const requestId = request.requestId ?? ulid();
    reply.header('x-request-id', requestId);
    reply.status(404).send({
      error: {
        code: ErrorCodes.NOT_FOUND,
        message: `No operation exists at ${request.method} ${request.url}.`,
        requestId,
      },
    });
  });

  await registerRateLimit(app);

  app.get('/health', async () => ({ status: 'ok', stage: config.stage }));

  await app.register(registerContentRoutes);
  await app.register(registerScanRoutes);
  await app.register(registerCatalogRoutes);
  await app.register(registerAdminContentRoutes);
  await app.register(registerAdminMediaRoutes);
  await app.register(registerAdminPublishingRoutes);
  await app.register(registerAdminAnalyticsRoutes);
  await app.register(registerAdminTagRoutes);
  await app.register(registerWebhookRoutes);

  return app;
}
