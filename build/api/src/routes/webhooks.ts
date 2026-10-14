import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config/env.js';
import { secrets } from '../config/secrets.js';
import { ApiError, ErrorCodes } from '../http/errors.js';
import { logger } from '../observability/logger.js';
import { putCatalogEntry } from '../repositories/catalog.js';
import { addCounters } from '../repositories/rollups.js';
import { rollupAllDayPk, rollupBlendDayPk } from '../db/keys.js';
import { knownSlugs } from '../http/spec.js';
import { verifyShopifySignature } from '../webhooks/signature.js';
import { redirectTable } from '../services/redirectTable.js';
import { slugForSku, isPurchasable } from '../services/skuAttribution.js';
import { now } from '../util/clock.js';
import { dayKey, nowIso } from '../util/time.js';

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

async function requireSignature(request: FastifyRequest): Promise<void> {
  const raw = (request as FastifyRequest & WithRawBody).rawBody ?? '';
  const header = request.headers['x-shopify-hmac-sha256'];
  const provided = Array.isArray(header) ? header[0] : header;

  let secret: string;
  try {
    secret = await secrets().get(config.shopify.webhookSecretName);
  } catch {
    logger.error('shopify webhook secret unavailable, refusing the request', { requestId: request.requestId });
    throw new ApiError(500, ErrorCodes.INTERNAL_ERROR, 'Webhook verification is unavailable.');
  }

  if (!verifyShopifySignature(raw, provided, secret)) {
    logger.warn('shopify webhook signature rejected', { requestId: request.requestId, path: request.url });
    throw new ApiError(401, ErrorCodes.INVALID_SIGNATURE, 'The webhook signature could not be verified.');
  }
}

function slugFromProduct(body: Record<string, unknown>): string | undefined {
  const handle = typeof body['handle'] === 'string' ? (body['handle'] as string) : undefined;
  if (handle && knownSlugs().includes(handle)) return handle;
  const tags = typeof body['tags'] === 'string' ? (body['tags'] as string).split(',').map((t) => t.trim()) : [];
  return tags.find((t) => knownSlugs().includes(t));
}

export async function registerWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.post('/internal/webhooks/shopify/products-update', async (request, reply) => {
    await requireSignature(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const slug = slugFromProduct(body);
    if (!slug) {
      // Not one of ours. Acknowledged so Shopify stops retrying, and recorded so a
      // mismatch between the store and the blend list is visible rather than silent.
      logger.info('shopify product update ignored, no matching blend', { requestId: request.requestId });
      return { ok: true, matched: false };
    }

    const variant = (Array.isArray(body['variants']) ? (body['variants'] as Array<Record<string, unknown>>)[0] : undefined) ?? {};
    const priceMinor = typeof variant['price'] === 'string' ? Math.round(Number.parseFloat(variant['price'] as string) * 100) : null;
    const compareMinor =
      typeof variant['compare_at_price'] === 'string'
        ? Math.round(Number.parseFloat(variant['compare_at_price'] as string) * 100)
        : null;
    // Shopify's product payload carries `status`: active, draft or archived. It used to be
    // ignored here, and `available` defaulted to TRUE when absent, so a draft product would
    // have been mirrored as in stock and the page would have rendered a working reorder
    // button into a checkout that refuses. The client confirmed on Thursday 17 September 2026
    // that all five blends are currently drafts, so this was about to happen for real.
    const available = isPurchasable(body['status'], variant['available']);

    await putCatalogEntry({
      slug,
      sku: (variant['sku'] as string) ?? null,
      shopifyProductId: body['admin_graphql_api_id'] as string,
      shopifyVariantId: (variant['admin_graphql_api_id'] as string) ?? null,
      priceAmount: Number.isFinite(priceMinor) ? priceMinor : null,
      priceCurrency: (body['currency'] as string) ?? 'USD',
      compareAtAmount: Number.isFinite(compareMinor) ? compareMinor : null,
      available,
      inventoryStatus: available ? 'in_stock' : 'out_of_stock',
      cartPermalinkUrl: null,
      syncedAt: nowIso(),
      syncSource: 'webhook',
    });

    reply.status(200);
    return { ok: true, matched: true, slug };
  });

  app.post('/internal/webhooks/shopify/orders-create', async (request, reply) => {
    await requireSignature(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const lines = Array.isArray(body['line_items']) ? (body['line_items'] as Array<Record<string, unknown>>) : [];
    const day = dayKey(now());

    // Reorder attribution is per SKU, because tag encoding is per SKU. There is no per-tag
    // identifier and no chip UID, so an order can be attributed to a blend and to a day and
    // no further. Nothing here reads or stores a customer identifier.
    const codeToSlug = Object.fromEntries(redirectTable().entries.map((e) => [e.code, e.blendSlug]));

    for (const line of lines) {
      const sku = line['sku'];
      const slug = slugForSku(sku, { slugs: knownSlugs(), codeToSlug });
      if (!slug) {
        // Logged rather than dropped silently. An unattributed order is a visible gap that
        // can be reconciled later; a confidently misattributed one is a wrong number on a
        // dashboard that nobody ever questions.
        logger.info('order line not attributed to a blend', { requestId: request.requestId, sku: typeof sku === 'string' ? sku : null });
        continue;
      }
      await addCounters(rollupBlendDayPk(slug), day, { orders: 1 });
      await addCounters(rollupAllDayPk(), day, { orders: 1 });
    }

    reply.status(200);
    return { ok: true };
  });
}
