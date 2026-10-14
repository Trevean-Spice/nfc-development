import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config/env.js';
import { secrets } from '../config/secrets.js';
import { ApiError, ErrorCodes } from '../http/errors.js';
import { logger } from '../observability/logger.js';
import { readCatalogRows, updateCatalogMirror } from '../repositories/catalog.js';
import { addCounters, claimBatch, releaseBatch } from '../repositories/rollups.js';
import { rollupAllDayPk, rollupBlendDayPk } from '../db/keys.js';
import { isConditionalCheckFailed } from '../db/client.js';
import { knownSlugs } from '../http/spec.js';
import { isWellFormedSignature, verifyShopifySignature, webhookSecretFrom } from '../webhooks/signature.js';
import { redirectTable } from '../services/redirectTable.js';
import { applyProductUpdate } from '../services/shopifyCatalogMirror.js';
import { attributeOrderLines } from '../services/orderAttribution.js';
import { nowIso } from '../util/time.js';

/**
 * Inbound Shopify webhooks.
 *
 * These sit OUTSIDE the frozen /v1 surface, deliberately. The API contract, section 5.4,
 * classifies the Shopify catalog sync and the order webhook consumer as internal services
 * rather than API clients, and the frozen OpenAPI document therefore does not describe
 * them. Adding paths under /v1 would put endpoints in the public contract that no client
 * calls. They are mounted under /internal/webhooks and are authorised by HMAC signature,
 * not by a bearer token.
 *
 * Every one of them verifies its signature over the raw body before any processing. A
 * webhook endpoint that parses first and verifies second has already done work on behalf
 * of an unauthenticated caller.
 */

interface WithRawBody {
  rawBody?: string;
}

/** The checkpoint namespace orders/create claims under: CKPT#shopify-orders-create#{webhook id}#{rollup pk}. */
export const ORDERS_CREATE_CLAIM = 'shopify-orders-create';

/** The shop's currency. The REST product payload carries none; the store sells in USD (D64). */
const STORE_CURRENCY = 'USD';

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

type Admission = { admitted: true; webhookId: string | undefined } | { admitted: false; reason: 'topic_mismatch' | 'shop_not_allowed' };

/**
 * Signature first, everything else after. The order is the point:
 *
 *   1. No header, or not the shape of a SHA-256 base64 digest: 401, before the secret is
 *      read. An unsigned request can never become a 500 or cost a Secrets Manager call.
 *   2. Secret unreadable, unset, or still the Terraform placeholder: 503. Fail closed, and
 *      a 5xx makes Shopify retry the delivery once the secret is fixed instead of losing it.
 *   3. HMAC over the raw body, constant time: 401 on any mismatch.
 *   4. Only on a request proven authentic: the topic must be the route's own, and the shop
 *      must be SHOPIFY_STORE_DOMAIN when that is set. A mismatch is acknowledged (200) and
 *      not processed, so a misregistered subscription is visible in the log and does no harm.
 */
async function admit(request: FastifyRequest, expectedTopic: string): Promise<Admission> {
  const raw = (request as FastifyRequest & WithRawBody).rawBody ?? '';
  const provided = header(request, 'x-shopify-hmac-sha256');

  if (!isWellFormedSignature(provided)) {
    logger.warn('shopify webhook unsigned or malformed signature, rejected', { requestId: request.requestId, path: request.url });
    throw new ApiError(401, ErrorCodes.INVALID_SIGNATURE, 'The webhook signature could not be verified.');
  }

  let secret: string | undefined;
  try {
    secret = webhookSecretFrom(await secrets().getOptional(config.shopify.webhookSecretName));
  } catch {
    secret = undefined;
  }
  if (!secret) {
    // The name is logged, never a value. Unset and placeholder look the same from here on purpose.
    logger.error('shopify webhook secret unavailable or still the placeholder, refusing the request', {
      requestId: request.requestId,
      secretName: config.shopify.webhookSecretName,
    });
    throw new ApiError(503, ErrorCodes.SERVICE_UNAVAILABLE, 'Webhook verification is unavailable.');
  }

  if (!verifyShopifySignature(raw, provided, secret)) {
    logger.warn('shopify webhook signature rejected', { requestId: request.requestId, path: request.url });
    throw new ApiError(401, ErrorCodes.INVALID_SIGNATURE, 'The webhook signature could not be verified.');
  }

  const topic = header(request, 'x-shopify-topic');
  if (topic !== expectedTopic) {
    logger.warn('shopify webhook topic does not match the route, ignored', { requestId: request.requestId, topic: topic ?? null, expectedTopic });
    return { admitted: false, reason: 'topic_mismatch' };
  }
  const shop = header(request, 'x-shopify-shop-domain');
  if (config.shopify.storeDomain && (shop ?? '').toLowerCase() !== config.shopify.storeDomain.toLowerCase()) {
    logger.warn('shopify webhook from a shop this API does not mirror, ignored', { requestId: request.requestId, shop: shop ?? null });
    return { admitted: false, reason: 'shop_not_allowed' };
  }
  return { admitted: true, webhookId: header(request, 'x-shopify-webhook-id') || undefined };
}

export async function registerWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.post('/internal/webhooks/shopify/products-update', async (request, reply) => {
    const admission = await admit(request, 'products/update');
    if (!admission.admitted) return { ok: true, ignored: admission.reason };

    // Conditional, attribute scoped, variant pinned: the catalog sync's rules. See
    // services/shopifyCatalogMirror.ts. Naturally idempotent, so no deduplication record.
    const result = await applyProductUpdate(request.body, {
      slugs: knownSlugs(),
      readRows: readCatalogRows,
      update: updateCatalogMirror,
      isConditionFailure: isConditionalCheckFailed,
      syncedAt: nowIso(),
      currency: STORE_CURRENCY,
    });

    const log = { requestId: request.requestId, webhookId: admission.webhookId ?? null };
    switch (result.outcome) {
      case 'unmatched':
        // Not one of ours. Acknowledged so Shopify stops retrying, recorded so a mismatch
        // between the store and the blend list is visible rather than silent.
        logger.info('shopify product update ignored, no matching blend', { ...log, handle: result.handle });
        return { ok: true, matched: false };
      case 'skipped':
        // Retrying cannot change the answer, so acknowledged. The row is untouched.
        logger.warn('shopify product update skipped, row untouched', { ...log, slug: result.slug, reason: result.reason, detail: result.detail });
        return { ok: true, matched: true, slug: result.slug, skipped: result.reason };
      case 'condition_failed':
        // The row changed between read and write. Not acknowledged, so Shopify retries and the
        // retry plans against the row as it is then.
        logger.warn('shopify product update lost a race, row untouched, asking for a retry', { ...log, slug: result.slug });
        throw new ApiError(409, ErrorCodes.VERSION_CONFLICT, 'The catalog row changed while this delivery was applied. Retry.');
      case 'updated':
        logger.info('shopify product update applied', { ...log, slug: result.slug, via: result.via, changes: result.changes, warnings: result.warnings });
        reply.status(200);
        return { ok: true, matched: true, slug: result.slug };
    }
  });

  app.post('/internal/webhooks/shopify/orders-create', async (request, reply) => {
    const admission = await admit(request, 'orders/create');
    if (!admission.admitted) return { ok: true, ignored: admission.reason };
    if (!admission.webhookId) {
      // ADD is not idempotent, so a delivery that cannot be deduplicated is not counted.
      // Shopify sends X-Shopify-Webhook-Id on every delivery, so only a request something
      // stripped the header from ends up here.
      throw new ApiError(400, ErrorCodes.VALIDATION_FAILED, 'X-Shopify-Webhook-Id is required.', [
        { field: 'x-shopify-webhook-id', issue: 'missing' },
      ]);
    }
    const webhookId = admission.webhookId;

    // Reorder attribution is per SKU, because tag encoding is per SKU. Nothing here reads or
    // stores a customer identifier: see services/orderAttribution.ts for the allowlist.
    const slugs = knownSlugs();
    const codeToSlug = Object.fromEntries(redirectTable().entries.map((e) => [e.code, e.blendSlug]));
    const attribution = attributeOrderLines(request.body, await readCatalogRows(slugs), { slugs, codeToSlug });
    const log = { requestId: request.requestId, webhookId };

    if (!attribution.day) {
      logger.warn('shopify order carried no usable created_at, not counted', log);
      return { ok: true, counted: 0 };
    }
    if (attribution.unmatchedLines > 0 || attribution.unusableLines > 0) {
      // Logged rather than dropped silently. An unattributed order is a visible gap that can
      // be reconciled later; a confidently misattributed one is a wrong number nobody questions.
      logger.info('order lines not attributed to a blend', { ...log, unmatched: attribution.unmatchedLines, unusable: attribution.unusableLines });
    }
    if (attribution.bySlug.length === 0) return { ok: true, counted: 0 };

    // One order is one order on each blend row it touched and once on the ALL row; units are
    // summed. Each row is claimed per webhook id before its ADD, so a duplicate or retried
    // delivery adds nothing twice, and a failed ADD gives its claim back for the retry.
    const writes = [
      ...attribution.bySlug.map((entry) => ({ pk: rollupBlendDayPk(entry.slug), counters: { orders: 1, units: entry.units } })),
      { pk: rollupAllDayPk(), counters: { orders: 1, units: attribution.bySlug.reduce((sum, e) => sum + e.units, 0) } },
    ];
    let counted = 0;
    for (const write of writes) {
      const claimId = `${webhookId}#${write.pk}`;
      if (!(await claimBatch(ORDERS_CREATE_CLAIM, claimId))) continue;
      try {
        await addCounters(write.pk, attribution.day, write.counters);
        counted += 1;
      } catch {
        await releaseBatch(ORDERS_CREATE_CLAIM, claimId).catch(() => undefined);
        logger.error('order rollup write failed, claim released for the retry', { ...log, pk: write.pk });
        throw new ApiError(503, ErrorCodes.SERVICE_UNAVAILABLE, 'The order could not be counted. Retry.');
      }
    }
    if (counted === 0) logger.info('shopify order delivery already counted, duplicate ignored', log);

    reply.status(200);
    return { ok: true, counted };
  });
}
