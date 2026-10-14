import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signature verification on every inbound webhook, per the Architecture document,
 * "Security and privacy".
 *
 * Two properties matter and both are easy to get wrong:
 *
 *   1. The signature is computed over the RAW body bytes, not over a re-serialised object.
 *      JSON.stringify of a parsed body reorders nothing today and reorders something the
 *      day a library changes, and then every webhook fails at once with no explanation.
 *   2. The comparison is constant time. A fast string compare on an HMAC leaks the
 *      signature one byte at a time to anyone willing to make enough requests.
 */

export function computeHmacBase64(rawBody: string | Buffer, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('base64');
}

export function computeHmacHex(rawBody: string | Buffer, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Shopify sends a base64 HMAC of the raw body in X-Shopify-Hmac-Sha256. */
export function verifyShopifySignature(rawBody: string | Buffer, headerValue: string | undefined, secret: string): boolean {
  if (!headerValue) return false;
  return safeEqual(computeHmacBase64(rawBody, secret), headerValue);
}
