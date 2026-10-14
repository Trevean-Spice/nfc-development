import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readShopifyHeaders, signBody, SHOPIFY_HEADERS, verifySignature, verifyWebhook } from '../src/webhooks/verify.js';
import { TOPIC_ORDERS_CREATE, TOPIC_PRODUCTS_UPDATE } from '../src/webhooks/topics.js';

/*
 * An unverified webhook endpoint is an open door. There is no bearer token on this
 * surface, no IP allowlist and no mutual TLS: the signature is the whole of the security
 * posture, so it gets the most thorough file in the suite.
 *
 * The vectors come from RFC 4231, which is a source outside this repository. That matters:
 * a test that signs with our own code and then verifies with our own code proves only that
 * the two halves agree with each other, which they would even if both were wrong. The RFC
 * vectors pin the primitive to a published answer.
 */

const VECTORS = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/vectors/rfc4231-hmac-sha256.json', import.meta.url)), 'utf8'),
) as {
  vectors: Array<{ case: number; note: string; keyHex: string; dataHex: string; hmacSha256: string }>;
};

const SECRET = 'shpss_test_secret_not_a_real_credential';

describe('RFC 4231 known answer vectors', () => {
  it.each(VECTORS.vectors.map((v) => [v.case, v.note, v] as const))(
    'case %i, %s, matches the published HMAC-SHA-256',
    (_case, _note, vector) => {
      const key = Buffer.from(vector.keyHex, 'hex');
      const data = Buffer.from(vector.dataHex, 'hex');
      const expectedHex = vector.hmacSha256;
      const expectedBase64 = Buffer.from(expectedHex, 'hex').toString('base64');

      // signBody is the exact function the endpoint path uses to compute what it compares
      // against, so proving it here proves the production code path and not a copy of it.
      expect(signBody(data, key as unknown as string)).toBe(expectedBase64);
      expect(verifySignature(data, expectedBase64, key as unknown as string)).toEqual({ ok: true });
    },
  );

  it('rejects a vector signature presented against a different vector body', () => {
    const [first, second] = VECTORS.vectors as [(typeof VECTORS.vectors)[0], (typeof VECTORS.vectors)[0]];
    const key = Buffer.from(first.keyHex, 'hex');
    const otherBody = Buffer.from(second.dataHex, 'hex');
    const signature = Buffer.from(first.hmacSha256, 'hex').toString('base64');
    expect(verifySignature(otherBody, signature, key as unknown as string)).toEqual({
      ok: false,
      reason: 'signature_mismatch',
    });
  });
});

describe('the Shopify shape', () => {
  const body = JSON.stringify({ id: 1, handle: 'persian-sunrise' });

  it('accepts a correctly signed body', () => {
    expect(verifySignature(body, signBody(body, SECRET), SECRET)).toEqual({ ok: true });
  });

  it('signs over raw bytes, so a re-serialised body fails', () => {
    // This is the failure mode the module's header comment describes: the day a JSON
    // library changes key order or spacing, every webhook fails at once. Asserting it here
    // means the refusal to accept a parsed body is a tested behaviour rather than a note.
    const signature = signBody(body, SECRET);
    const reserialised = JSON.stringify(JSON.parse(body), null, 2);
    expect(reserialised).not.toBe(body);
    expect(verifySignature(reserialised, signature, SECRET)).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('treats a string body and the equivalent Buffer identically', () => {
    expect(signBody(body, SECRET)).toBe(signBody(Buffer.from(body, 'utf8'), SECRET));
  });

  it('handles a body with multibyte characters without corrupting the digest', () => {
    const utf8 = JSON.stringify({ title: 'Persian Sunrise, saffron and rose' , note: 'cafe creme, 25 C' });
    const buffer = Buffer.from(utf8, 'utf8');
    expect(verifySignature(buffer, signBody(utf8, SECRET), SECRET)).toEqual({ ok: true });
  });

  it('rejects a body signed with a different secret', () => {
    expect(verifySignature(body, signBody(body, 'another-secret'), SECRET)).toEqual({
      ok: false,
      reason: 'signature_mismatch',
    });
  });

  it('rejects a body altered after signing, down to one byte', () => {
    const signature = signBody(body, SECRET);
    const altered = body.replace('persian-sunrise', 'persian-sunrisf');
    expect(altered.length).toBe(body.length);
    expect(verifySignature(altered, signature, SECRET)).toEqual({ ok: false, reason: 'signature_mismatch' });
  });
});

describe('signature header shapes that must not fail open', () => {
  const body = '{"id":1}';

  it.each([
    ['missing', undefined, 'missing_signature'],
    ['null', null, 'missing_signature'],
    ['empty', '', 'missing_signature'],
    ['too short', 'YWJj', 'malformed_signature'],
    ['too long', `${'A'.repeat(43)}=${'A'.repeat(4)}`, 'malformed_signature'],
    ['hex rather than base64', createHmac('sha256', SECRET).update(body).digest('hex'), 'malformed_signature'],
    ['base64url rather than base64', `${'-'.repeat(43)}=`, 'malformed_signature'],
    ['unpadded', 'A'.repeat(43), 'malformed_signature'],
    ['whitespace padded', ` ${'A'.repeat(43)}=`, 'malformed_signature'],
    ['the literal string undefined', 'undefined', 'malformed_signature'],
  ])('rejects a %s signature header', (_label, header, reason) => {
    expect(verifySignature(body, header as string | undefined, SECRET)).toEqual({ ok: false, reason });
  });

  it('does not accept a truncated prefix of a valid signature', () => {
    const valid = signBody(body, SECRET);
    expect(verifySignature(body, valid.slice(0, 20), SECRET).ok).toBe(false);
  });

  it('never returns ok for a random 32 byte signature, over many attempts', () => {
    for (let i = 0; i < 200; i += 1) {
      const random = randomBytes(32).toString('base64');
      expect(verifySignature(body, random, SECRET).ok).toBe(false);
    }
  });
});

describe('the full endpoint check', () => {
  const body = JSON.stringify({ id: 7391043289601, handle: 'persian-sunrise' });

  function headers(overrides: Record<string, string | undefined> = {}) {
    return readShopifyHeaders({
      [SHOPIFY_HEADERS.hmac]: signBody(body, SECRET),
      [SHOPIFY_HEADERS.topic]: TOPIC_PRODUCTS_UPDATE,
      [SHOPIFY_HEADERS.shopDomain]: 'trevean-spice.myshopify.com',
      [SHOPIFY_HEADERS.webhookId]: '5f1c1f7e-0000-4000-8000-000000000001',
      [SHOPIFY_HEADERS.apiVersion]: '2025-01',
      ...overrides,
    });
  }

  const options = {
    secret: SECRET,
    allowedTopics: [TOPIC_PRODUCTS_UPDATE, TOPIC_ORDERS_CREATE],
    allowedShopDomains: ['trevean-spice.myshopify.com'],
  };

  it('passes a well formed request and returns the metadata the handler needs', async () => {
    const result = await verifyWebhook(body, headers(), options);
    expect(result).toEqual({
      ok: true,
      topic: TOPIC_PRODUCTS_UPDATE,
      shopDomain: 'trevean-spice.myshopify.com',
      webhookId: '5f1c1f7e-0000-4000-8000-000000000001',
      apiVersion: '2025-01',
    });
  });

  it('refuses a parsed body outright rather than re-serialising it', async () => {
    const parsed = JSON.parse(body) as unknown;
    expect(await verifyWebhook(parsed, headers(), options)).toEqual({ ok: false, reason: 'body_not_raw' });
  });

  it('refuses when no secret is configured, rather than verifying against an empty string', async () => {
    expect(await verifyWebhook(body, headers(), { ...options, secret: '' })).toEqual({
      ok: false,
      reason: 'secret_missing',
    });
  });

  it('rejects a topic the endpoint is not subscribed to', async () => {
    expect(
      await verifyWebhook(body, headers({ [SHOPIFY_HEADERS.topic]: 'customers/create' }), options),
    ).toEqual({ ok: false, reason: 'topic_not_subscribed' });
  });

  it('checks the topic before the signature, so an unauthenticated caller learns nothing from the ordering', async () => {
    const result = await verifyWebhook(
      body,
      headers({ [SHOPIFY_HEADERS.topic]: 'customers/create', [SHOPIFY_HEADERS.hmac]: 'A'.repeat(43) + '=' }),
      options,
    );
    expect(result).toEqual({ ok: false, reason: 'topic_not_subscribed' });
  });

  it('checks the shop domain only after the signature passes, so it cannot be probed', async () => {
    const result = await verifyWebhook(
      body,
      headers({
        [SHOPIFY_HEADERS.shopDomain]: 'someone-else.myshopify.com',
        [SHOPIFY_HEADERS.hmac]: signBody(body, 'wrong-secret'),
      }),
      options,
    );
    // Signature mismatch, not shop_not_allowed: the caller is told nothing about which
    // shops this endpoint accepts.
    expect(result).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('rejects an authentic signature from a shop that is not ours', async () => {
    expect(
      await verifyWebhook(body, headers({ [SHOPIFY_HEADERS.shopDomain]: 'someone-else.myshopify.com' }), options),
    ).toEqual({ ok: false, reason: 'shop_not_allowed' });
  });

  it('applies the optional replay guard on webhook id', async () => {
    const seen = new Set(['5f1c1f7e-0000-4000-8000-000000000001']);
    expect(
      await verifyWebhook(body, headers(), { ...options, hasSeenWebhookId: (id) => seen.has(id) }),
    ).toEqual({ ok: false, reason: 'replayed_webhook_id' });
  });

  /*
   * The replay guard fails closed on an absent id.
   *
   * Shopify's HMAC covers the body and carries no timestamp, so a captured delivery stays
   * valid forever and deduplication on the webhook id is the only replay control this
   * package has. The guard used to run only when an id was present, which made deleting
   * one header a complete bypass. These four cases pin the decision: opting in to the
   * guard means an unidentifiable delivery is refused, and not opting in changes nothing.
   */
  describe('the replay guard when the webhook id header is absent', () => {
    const alwaysSeen = { ...options, hasSeenWebhookId: () => true };

    it('refuses a correctly signed request that carries no webhook id', async () => {
      expect(await verifyWebhook(body, headers({ [SHOPIFY_HEADERS.webhookId]: undefined }), alwaysSeen)).toEqual({
        ok: false,
        reason: 'missing_webhook_id',
      });
    });

    it('refuses an empty webhook id, which is the same bypass one character longer', async () => {
      expect(await verifyWebhook(body, headers({ [SHOPIFY_HEADERS.webhookId]: '' }), alwaysSeen)).toEqual({
        ok: false,
        reason: 'missing_webhook_id',
      });
    });

    it('still accepts an id that has not been seen, so legitimate deliveries are unaffected', async () => {
      const result = await verifyWebhook(body, headers(), { ...options, hasSeenWebhookId: () => false });
      expect(result.ok).toBe(true);
    });

    it('leaves callers that asked for no guard exactly as they were', async () => {
      // No hasSeenWebhookId, so no replay protection was requested and an absent id is
      // reported as null rather than refused. Widening the union must not widen behaviour
      // for the callers that did not opt in.
      const result = await verifyWebhook(body, headers({ [SHOPIFY_HEADERS.webhookId]: undefined }), options);
      expect(result).toEqual({
        ok: true,
        topic: TOPIC_PRODUCTS_UPDATE,
        shopDomain: 'trevean-spice.myshopify.com',
        webhookId: null,
        apiVersion: '2025-01',
      });
    });
  });

  it('tolerates a header arriving as an array, which is what a proxy can produce', async () => {
    const bag = {
      [SHOPIFY_HEADERS.hmac]: [signBody(body, SECRET)],
      [SHOPIFY_HEADERS.topic]: [TOPIC_PRODUCTS_UPDATE],
      [SHOPIFY_HEADERS.shopDomain]: ['trevean-spice.myshopify.com'],
    };
    const result = await verifyWebhook(body, readShopifyHeaders(bag), options);
    expect(result.ok).toBe(true);
  });

  it('accepts any topic when no allowlist is configured, and still requires a signature', async () => {
    expect((await verifyWebhook(body, headers({ [SHOPIFY_HEADERS.topic]: 'anything/at-all' }), { secret: SECRET })).ok).toBe(true);
    expect(
      await verifyWebhook(body, headers({ [SHOPIFY_HEADERS.hmac]: undefined }), { secret: SECRET }),
    ).toEqual({ ok: false, reason: 'missing_signature' });
  });
});
