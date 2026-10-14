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

/** Base64 of exactly 32 bytes: 43 payload characters and one pad. The only shape Shopify sends. */
const BASE64_SHA256 = /^[A-Za-z0-9+/]{43}=$/;

/**
 * Whether the header could be a Shopify signature at all. Checked BEFORE the secret is read,
 * so an unsigned or garbage request is a 401 that costs no Secrets Manager call and can
 * never become a 500 because the secret happens to be unavailable.
 */
export function isWellFormedSignature(headerValue: string | undefined): headerValue is string {
  return typeof headerValue === 'string' && BASE64_SHA256.test(headerValue);
}

/**
 * The signing secret from what the secret store returned, or undefined when it is not usable.
 *
 * Accepts the raw value, or a JSON object with a string "value". REFUSES the Terraform
 * placeholder: modules/secrets creates every secret holding
 * {"value":"FILL IN WHEN ACCESS LANDS","set_by":"terraform-placeholder"}, and that string is
 * written in the repository. Used as an HMAC key it would let anybody who has read the
 * repository sign a delivery the endpoint accepts. Undefined here means the endpoint fails
 * closed, which is the only safe answer to "the secret has not been set yet".
 */
export function webhookSecretFrom(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  let value = raw.trim();
  if (value === '') return undefined;
  if (value.startsWith('{')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      return undefined;
    }
    const obj = parsed as { value?: unknown; set_by?: unknown };
    if (obj.set_by === 'terraform-placeholder') return undefined;
    if (typeof obj.value !== 'string') return undefined;
    value = obj.value.trim();
  }
  if (value === '' || /^FILL IN/i.test(value)) return undefined;
  return value;
}
