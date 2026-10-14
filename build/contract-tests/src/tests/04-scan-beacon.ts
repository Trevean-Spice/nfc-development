// POST /v1/scan-events, the only operation on the tap critical path.
//
// Semantics here, transport in the next suite. The two are separated because they fail
// for different reasons: a wrong status code is caught in review, an endpoint a beacon
// cannot legally call is not caught until a customer taps a jar.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { callOperation } from '../client.js';
import { isoNow, newDedupToken, scanEventBody } from '../fixtures.js';

describe('POST /v1/scan-events accepts what a browser sends', () => {
  it('accepts an NFC tap and returns 202 with an empty body', async () => {
    const result = await callOperation('recordScanEvent', {
      anonymous: true,
      body: scanEventBody(),
      expectStatus: 202,
    });
    assert.equal(result.bodyText.trim(), '', 'The beacon response is empty. The client never reads it.');
  });

  it('accepts a QR scan, the sole recovery route when a handset is asleep or locked', async () => {
    await callOperation('recordScanEvent', {
      anonymous: true,
      body: scanEventBody({
        blendSlug: 'caribbean-sunset',
        tagCode: 'cs',
        channel: 'qr',
        platform: 'android',
        deviceFamily: 'Pixel',
      }),
      expectStatus: 202,
    });
  });

  it('accepts a direct visit with no tag code at all', async () => {
    await callOperation('recordScanEvent', {
      anonymous: true,
      body: scanEventBody({
        blendSlug: 'silk-road',
        tagCode: null,
        channel: 'direct',
        platform: 'other',
        deviceFamily: 'unknown',
        connectionType: 'wifi',
        cacheStatus: 'miss',
        redirected: false,
      }),
      expectStatus: 202,
    });
  });

  it('accepts the four required fields alone', async () => {
    await callOperation('recordScanEvent', {
      anonymous: true,
      body: {
        blendSlug: 'persian-sunrise',
        channel: 'nfc',
        dedupToken: newDedupToken(),
        occurredAt: isoNow(),
      },
      expectStatus: 202,
    });
  });

  it('needs no credential, because a browser beacon cannot hold a secret', async () => {
    await callOperation('recordScanEvent', {
      anonymous: true,
      body: scanEventBody(),
      expectStatus: 202,
    });
  });

  it('is never cached', async () => {
    const result = await callOperation('recordScanEvent', {
      anonymous: true,
      body: scanEventBody(),
      expectStatus: 202,
    });
    assert.match(result.headers.get('cache-control') ?? '', /no-store/);
  });
});

describe('POST /v1/scan-events deduplicates without telling the client', () => {
  it('returns 202 for a duplicate exactly as for a first write', async () => {
    const body = scanEventBody();
    const first = await callOperation('recordScanEvent', { anonymous: true, body, expectStatus: 202 });
    const second = await callOperation('recordScanEvent', { anonymous: true, body, expectStatus: 202 });
    assert.equal(second.status, first.status);
    assert.equal(second.bodyText.trim(), first.bodyText.trim());
  });

  it('leaks no header that would let a client distinguish a duplicate', async () => {
    const body = scanEventBody();
    await callOperation('recordScanEvent', { anonymous: true, body, expectStatus: 202 });
    const second = await callOperation('recordScanEvent', { anonymous: true, body, expectStatus: 202 });
    for (const [name] of second.headers) {
      assert.ok(
        !/dup|duplicate|dedup|conflict/i.test(name),
        `The response carries ${name}, which lets a client detect a duplicate. The client must not be able to try.`,
      );
    }
  });
});

describe('POST /v1/scan-events rejects what it must reject', () => {
  it('rejects an unknown property with 400 and the error envelope', async () => {
    const result = await callOperation('recordScanEvent', {
      anonymous: true,
      body: { ...scanEventBody(), ipAddress: '203.0.113.7' },
      validateRequestBody: false,
      expectStatus: 400,
    });
    assert.equal(result.body.error.code, 'VALIDATION_FAILED');
  });

  it('rejects a blend slug that is not one of the five', async () => {
    const result = await callOperation('recordScanEvent', {
      anonymous: true,
      body: { ...scanEventBody(), blendSlug: 'persian-sunrize' },
      validateRequestBody: false,
      expectStatus: 400,
    });
    assert.equal(result.body.error.code, 'VALIDATION_FAILED');
  });

  it('rejects a dedup token that is not 128 bits of lowercase hex', async () => {
    await callOperation('recordScanEvent', {
      anonymous: true,
      body: { ...scanEventBody(), dedupToken: 'not-a-token' },
      validateRequestBody: false,
      expectStatus: 400,
    });
  });

  it('rejects a free text field', async () => {
    await callOperation('recordScanEvent', {
      anonymous: true,
      body: { ...scanEventBody(), note: 'anything at all' },
      validateRequestBody: false,
      expectStatus: 400,
    });
  });

  it('rejects a timing value outside the documented range', async () => {
    await callOperation('recordScanEvent', {
      anonymous: true,
      body: { ...scanEventBody(), timeToReadableMs: 999999 },
      validateRequestBody: false,
      expectStatus: 400,
    });
  });

  it('rejects a malformed body', async () => {
    const result = await callOperation('recordScanEvent', {
      anonymous: true,
      rawBody: '{"blendSlug": "persian-sunrise",',
      expectStatus: 400,
    });
    assert.ok(['MALFORMED_JSON', 'VALIDATION_FAILED'].includes(result.body.error.code));
  });

  it('never answers a rejection with a status that invites a retry', async () => {
    const result = await callOperation('recordScanEvent', {
      anonymous: true,
      body: { ...scanEventBody(), channel: 'carrier-pigeon' },
      validateRequestBody: false,
      expectStatus: 400,
    });
    assert.equal(
      result.headers.get('retry-after'),
      null,
      'A beacon that retries is a beacon that can interfere with navigation.',
    );
  });
});
