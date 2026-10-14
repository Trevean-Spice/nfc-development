/*
 * Shopify webhook signature verification.
 *
 * "Signature verification on every inbound webhook" is one line in the Architecture
 * document, "Security and privacy", and it is the whole of the security posture on this
 * surface. There is no bearer token here, no IP allowlist, no mutual TLS. An unverified
 * webhook endpoint is an open door: anyone who learns the URL can rewrite a price on a
 * customer-facing page or inject reorder attribution into the analytics that the
 * engagement is measured on.
 *
 * This is pure cryptography over bytes we are given, so it is fully buildable and fully
 * testable today, with no store access. It is proven against RFC 4231 known-answer vectors
 * for HMAC-SHA-256 in test/webhook-verify.test.ts, so the primitive and the wiring around
 * it are established independently of anything Shopify sends.
 *
 * FOUR THINGS THIS GETS RIGHT, each of which is a way real implementations get it wrong.
 *
 * 1. The digest is computed over the RAW BODY BYTES. Not over a parsed object, not over
 *    JSON.stringify of a parsed object. Re-serialising reorders nothing today and reorders
 *    something the day a JSON library changes, and then every webhook in production fails
 *    at once with no explanation. The function refuses a non-string, non-Buffer body
 *    outright rather than stringifying it for the caller's convenience.
 *
 * 2. The comparison is CONSTANT TIME, over decoded bytes. A fast string compare on an HMAC
 *    leaks the correct signature one byte at a time to anyone willing to make enough
 *    requests, and a webhook endpoint is precisely somewhere an attacker can make enough
 *    requests.
 *
 * 3. VERIFY BEFORE PARSE. The exported helper returns the raw body and leaves parsing to
 *    the caller after a pass. An endpoint that parses first has already done work, and
 *    allocated memory proportional to an attacker-controlled body, on behalf of a caller
 *    it has not authenticated.
 *
 * 4. The header is validated for SHAPE before decoding. Buffer.from(x, 'base64') is
 *    lenient: it discards characters it does not recognise and returns a short buffer, so
 *    a malformed header can decode to something that then gets length-compared. The regex
 *    below fixes the length at exactly one SHA-256 digest.
 *
 * WHAT THIS DOES NOT DO, stated rather than assumed. Shopify's HMAC covers the body only.
 * It carries no timestamp, so a captured request replays forever and no signature check
 * can detect it. Replay protection is webhook-id deduplication, which needs somewhere to
 * keep state, and that is a decision recorded in the README rather than a default chosen
 * here.
 *
 * WHAT THE REPLAY GUARD DOES WHEN THE ID IS ABSENT, and why it changed.
 *
 * It used to pass. `if (options.hasSeenWebhookId && webhookId)` skipped the check when the
 * header was missing, so deleting one header from a captured delivery defeated the only
 * replay control this package offers. Since the signature covers the body alone and never
 * expires, that is unlimited replays of a genuine, correctly signed request.
 *
 * It now fails closed: supplying `hasSeenWebhookId` is a caller saying "this endpoint is
 * replay protected", and a webhook with no id cannot be replay protected, so it is refused
 * with `missing_webhook_id` rather than waved through. Shopify sends
 * X-Shopify-Webhook-Id on every delivery, so the only requests this rejects are ones
 * Shopify did not send, or ones something stripped the header from.
 *
 * The cost is a widened `WebhookRejection` union, which is why this was left to the
 * author rather than taken by a reviewer: a consumer switching exhaustively over the
 * union gets a compile error on the new member. That error is the point. It is a
 * type checked notification that the endpoint now has a rejection reason it did not have,
 * arriving at build time rather than as a silently accepted replay. Callers that do not
 * supply `hasSeenWebhookId` are unaffected: no guard was asked for, so an absent id is
 * still accepted and still reported as null.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Base64 of exactly 32 bytes: 43 payload characters and one pad. */
const BASE64_SHA256 = /^[A-Za-z0-9+/]{43}=$/;

export type WebhookRejection =
  | 'missing_signature'
  | 'malformed_signature'
  | 'signature_mismatch'
  | 'body_not_raw'
  | 'secret_missing'
  | 'missing_topic'
  | 'topic_not_subscribed'
  | 'missing_shop_domain'
  | 'shop_not_allowed'
  | 'missing_webhook_id'
  | 'replayed_webhook_id';

export interface ShopifyWebhookHeaders {
  /** X-Shopify-Hmac-Sha256 */
  hmac?: string | string[] | undefined;
  /** X-Shopify-Topic, for example products/update */
  topic?: string | string[] | undefined;
  /** X-Shopify-Shop-Domain, for example trevean-spice.myshopify.com */
  shopDomain?: string | string[] | undefined;
  /** X-Shopify-Webhook-Id, a UUID, stable across Shopify's retries of the same delivery */
  webhookId?: string | string[] | undefined;
  /** X-Shopify-API-Version */
  apiVersion?: string | string[] | undefined;
}

export interface VerifyOptions {
  secret: string;
  /** Topics this endpoint accepts. Omit to accept any topic. */
  allowedTopics?: string[];
  /** Shop domains this endpoint accepts. Strongly recommended in production. */
  allowedShopDomains?: string[];
  /**
   * Optional replay guard. Returns true when this webhook id has been seen before.
   * Shopify retries a failed delivery with the SAME webhook id, so a naive guard that
   * rejects every repeat also rejects every legitimate retry. See the README.
   *
   * Supplying this is what switches replay protection on, and switching it on means a
   * delivery with no webhook id is refused with `missing_webhook_id`. There is no
   * "guard present but not enforced" state, because that state is indistinguishable from
   * no guard at all to everyone except the person reading the configuration.
   */
  hasSeenWebhookId?: (webhookId: string) => boolean | Promise<boolean>;
}

export type VerifyResult =
  | {
      ok: true;
      topic: string | null;
      shopDomain: string | null;
      webhookId: string | null;
      apiVersion: string | null;
    }
  | { ok: false; reason: WebhookRejection };

function single(value: string | string[] | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.length > 0 ? (value[0] ?? null) : null;
  return value;
}

/** The HMAC Shopify sends: base64 of HMAC-SHA-256 over the raw body, keyed with the app secret. */
export function signBody(rawBody: string | Buffer, secret: string): string {
  return createHmac('sha256', secret).update(toBytes(rawBody)).digest('base64');
}

function toBytes(rawBody: string | Buffer): Buffer {
  return Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
}

/**
 * Constant time comparison of a provided base64 signature against a freshly computed one.
 *
 * Both sides are decoded to 32 byte buffers before comparison, so the compare is over the
 * digest rather than over its text encoding. A shape failure on the provided header is
 * reported as malformed rather than as a mismatch, which is a real distinction when
 * reading logs at two in the morning: malformed means a misconfigured sender, mismatch
 * means a wrong secret or a forged request.
 */
export function verifySignature(
  rawBody: string | Buffer,
  providedBase64: string | null | undefined,
  secret: string,
): { ok: true } | { ok: false; reason: 'missing_signature' | 'malformed_signature' | 'signature_mismatch' } {
  if (providedBase64 === null || providedBase64 === undefined || providedBase64 === '') {
    return { ok: false, reason: 'missing_signature' };
  }
  if (!BASE64_SHA256.test(providedBase64)) {
    return { ok: false, reason: 'malformed_signature' };
  }
  const provided = Buffer.from(providedBase64, 'base64');
  if (provided.length !== 32) {
    return { ok: false, reason: 'malformed_signature' };
  }
  const expected = createHmac('sha256', secret).update(toBytes(rawBody)).digest();
  return timingSafeEqual(expected, provided) ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
}

/**
 * The full check an endpoint should run before it parses anything.
 *
 * Order matters and is deliberate: the cheapest rejections that do not depend on the
 * secret come first, then the signature, then the checks that only make sense on a request
 * already proven authentic. Checking the shop domain before the signature would let an
 * unauthenticated caller probe which shops the endpoint is configured for.
 */
export async function verifyWebhook(
  rawBody: unknown,
  headers: ShopifyWebhookHeaders,
  options: VerifyOptions,
): Promise<VerifyResult> {
  if (typeof rawBody !== 'string' && !Buffer.isBuffer(rawBody)) {
    // A parsed object reached here. The signature cannot be recomputed from it, and
    // re-serialising to try is the bug this refusal exists to prevent.
    return { ok: false, reason: 'body_not_raw' };
  }
  if (typeof options.secret !== 'string' || options.secret === '') {
    return { ok: false, reason: 'secret_missing' };
  }

  const topic = single(headers.topic);
  if (options.allowedTopics && options.allowedTopics.length > 0) {
    if (!topic) return { ok: false, reason: 'missing_topic' };
    if (!options.allowedTopics.includes(topic)) return { ok: false, reason: 'topic_not_subscribed' };
  }

  const signature = verifySignature(rawBody, single(headers.hmac), options.secret);
  if (!signature.ok) return { ok: false, reason: signature.reason };

  const shopDomain = single(headers.shopDomain);
  if (options.allowedShopDomains && options.allowedShopDomains.length > 0) {
    if (!shopDomain) return { ok: false, reason: 'missing_shop_domain' };
    const permitted = options.allowedShopDomains.map((d) => d.toLowerCase());
    if (!permitted.includes(shopDomain.toLowerCase())) return { ok: false, reason: 'shop_not_allowed' };
  }

  const webhookId = single(headers.webhookId);
  if (options.hasSeenWebhookId) {
    // Fail closed. An absent or empty id is not a delivery this endpoint can deduplicate,
    // and a request that cannot be deduplicated is exactly the request a replay looks like.
    if (!webhookId) return { ok: false, reason: 'missing_webhook_id' };
    const seen = await options.hasSeenWebhookId(webhookId);
    if (seen) return { ok: false, reason: 'replayed_webhook_id' };
  }

  return {
    ok: true,
    topic,
    shopDomain,
    webhookId,
    apiVersion: single(headers.apiVersion),
  };
}

/**
 * Header names, so the string is written once. Shopify sends them lowercase over HTTP/2
 * and Node lowercases them anyway, but the constant removes the chance of a typo that
 * fails open on a missing header.
 */
export const SHOPIFY_HEADERS = {
  hmac: 'x-shopify-hmac-sha256',
  topic: 'x-shopify-topic',
  shopDomain: 'x-shopify-shop-domain',
  webhookId: 'x-shopify-webhook-id',
  apiVersion: 'x-shopify-api-version',
} as const;

/** Pull the five headers out of a Node style incoming headers bag. */
export function readShopifyHeaders(bag: Record<string, string | string[] | undefined>): ShopifyWebhookHeaders {
  return {
    hmac: bag[SHOPIFY_HEADERS.hmac],
    topic: bag[SHOPIFY_HEADERS.topic],
    shopDomain: bag[SHOPIFY_HEADERS.shopDomain],
    webhookId: bag[SHOPIFY_HEADERS.webhookId],
    apiVersion: bag[SHOPIFY_HEADERS.apiVersion],
  };
}
