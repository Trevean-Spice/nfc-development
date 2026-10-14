/*
 * The revalidation dispatch is signed, and this is the half that checks it.
 *
 * build/api, services/revalidation.ts, signs the body with HMAC SHA-256 under the shared
 * secret and sends it as `x-trevean-signature: sha256=<hex>`. It signs because this endpoint
 * renders pages and invalidates cached ones, and an unauthenticated invalidation endpoint is
 * a denial of service primitive pointed at the one thing that protects the 2.0 second tap
 * budget.
 *
 * Three rules that are easy to get wrong and are therefore written here rather than inline:
 *
 *   1. The signature is computed over the RAW bytes, before any JSON parsing. A body parsed
 *      and re-serialised is not the body that was signed.
 *   2. The comparison is constant time, over buffers of equal length, with the length
 *      checked first, because timingSafeEqual throws on a length mismatch and a thrown
 *      exception is itself a timing signal.
 *   3. An absent secret is a refusal, never a pass. A publisher that accepts unsigned jobs
 *      because nobody configured a secret is the failure this module exists to prevent.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-trevean-signature';

export function sign(rawBody, secret) {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

/**
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function verify(rawBody, headerValue, secret) {
  if (!secret) {
    return {
      ok: false,
      reason:
        'no revalidation secret is configured, so no signature can be checked. Refusing rather ' +
        'than accepting an unsigned job.',
    };
  }
  if (typeof headerValue !== 'string' || headerValue === '') {
    return { ok: false, reason: `the ${SIGNATURE_HEADER} header is missing.` };
  }
  if (!headerValue.startsWith('sha256=')) {
    return { ok: false, reason: `the ${SIGNATURE_HEADER} header is not in the sha256=<hex> form.` };
  }

  const expected = Buffer.from(sign(rawBody, secret), 'utf8');
  const presented = Buffer.from(headerValue, 'utf8');

  if (expected.length !== presented.length) return { ok: false, reason: 'the signature does not match.' };
  if (!timingSafeEqual(expected, presented)) return { ok: false, reason: 'the signature does not match.' };

  return { ok: true };
}
