// Media upload, in three calls, and the reason it is three.
//
// The upload URL must not point at the API. A premium photograph passing through an
// application function is a timeout and a memory limit waiting to happen, and it puts image
// bytes on a code path that has to stay fast for other reasons.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { callOperation } from '../client.js';
import { config } from '../config.js';
import { discoveredIds } from '../discovery.js';

const needsEditor = config.allowWrites && config.tokens.editor ? false : 'writes disabled or no editor token';
const needsViewer = config.tokens.viewer ? false : 'no viewer token configured';

describe('Admin media library', () => {
  it('lists media', { skip: needsViewer }, async () => {
    const result = await callOperation('adminListMedia', { role: 'viewer', expectStatus: 200 });
    assert.ok(Array.isArray(result.body.data));
  });

  it('filters by kind', { skip: needsViewer }, async () => {
    const result = await callOperation('adminListMedia', {
      role: 'viewer',
      query: { kind: 'hero' },
      expectStatus: 200,
    });
    for (const item of result.body.data) assert.equal(item.kind, 'hero');
  });

  it('reads one media record', { skip: needsViewer }, async () => {
    const ids = await discoveredIds();
    const result = await callOperation('adminGetMedia', {
      role: 'viewer',
      pathParams: { mediaId: ids.mediaId! },
      expectStatus: 200,
    });
    assert.equal(result.body.mediaId, ids.mediaId);
  });

  it('404s an unknown media id', { skip: needsViewer }, async () => {
    const result = await callOperation('adminGetMedia', {
      role: 'viewer',
      pathParams: { mediaId: 'med_00000000000000000000000000' },
      expectStatus: 404,
    });
    assert.equal(result.body.error.code, 'MEDIA_NOT_FOUND');
  });
});

describe('Presigned upload', () => {
  it('issues a PUT ticket that does not point at this API', { skip: needsEditor }, async () => {
    const result = await callOperation('adminCreateMediaUpload', {
      role: 'editor',
      body: {
        filename: 'contract-test-hero.jpg',
        contentType: 'image/jpeg',
        bytes: 4831244,
        kind: 'hero',
        alt: 'A copper bowl of saffron threads and dried rose petals',
      },
      expectStatus: 201,
    });
    assert.equal(result.body.method, 'PUT');
    assert.match(result.body.mediaId, /^med_[0-9A-HJKMNP-TV-Z]{26}$/);
    const uploadHost = new URL(result.body.uploadUrl).host;
    const apiHost = new URL(config.baseUrl).host;
    assert.notEqual(
      uploadHost,
      apiHost,
      `The upload URL points at ${uploadHost}, which is this API. The browser uploads directly to ` +
        'object storage precisely so a large photograph never passes through an application function.',
    );
    assert.ok(
      Date.parse(result.body.expiresAt) > Date.now(),
      'The presigned URL is already expired when it is issued.',
    );
    assert.ok(result.body.maxBytes > 0);
  });

  it('rejects an unsupported image type with 415', { skip: needsEditor }, async () => {
    const result = await callOperation('adminCreateMediaUpload', {
      role: 'editor',
      body: { filename: 'animation.gif', contentType: 'image/gif', bytes: 1024, kind: 'gallery' },
      validateRequestBody: false,
      expectStatus: 415,
    });
    assert.equal(result.body.error.code, 'UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects an oversized declaration with 413 rather than a blanket 400', { skip: needsEditor }, async () => {
    const result = await callOperation('adminCreateMediaUpload', {
      role: 'editor',
      body: { filename: 'enormous.jpg', contentType: 'image/jpeg', bytes: 999999999, kind: 'hero' },
      validateRequestBody: false,
      expectStatus: 413,
    });
    assert.equal(result.body.error.code, 'PAYLOAD_TOO_LARGE');
  });

  it('rejects a missing required field with 400', { skip: needsEditor }, async () => {
    const result = await callOperation('adminCreateMediaUpload', {
      role: 'editor',
      body: { filename: 'no-kind.jpg', contentType: 'image/jpeg', bytes: 1024 },
      validateRequestBody: false,
      expectStatus: 400,
    });
    assert.equal(result.body.error.code, 'VALIDATION_FAILED');
  });

  it('completes an upload with 202 and reports the processing state', { skip: needsEditor }, async () => {
    const ticket = await callOperation('adminCreateMediaUpload', {
      role: 'editor',
      body: { filename: 'contract-test-complete.jpg', contentType: 'image/jpeg', bytes: 204800, kind: 'gallery' },
      expectStatus: 201,
    });
    const result = await callOperation('adminCompleteMediaUpload', {
      role: 'editor',
      pathParams: { mediaId: ticket.body.mediaId },
      body: { alt: 'Alternative text supplied at completion.' },
      expectStatus: 202,
    });
    assert.ok(
      ['pending', 'processing', 'ready', 'failed'].includes(result.body.status),
      'Derivatives are asynchronous. The CMS shows the state rather than a broken image.',
    );
  });

  it('rejects a completion body carrying an unknown property', { skip: needsEditor }, async () => {
    const ticket = await callOperation('adminCreateMediaUpload', {
      role: 'editor',
      body: { filename: 'contract-test-bad-complete.jpg', contentType: 'image/jpeg', bytes: 4096, kind: 'gallery' },
      expectStatus: 201,
    });
    const result = await callOperation('adminCompleteMediaUpload', {
      role: 'editor',
      pathParams: { mediaId: ticket.body.mediaId },
      body: { alt: 'Fine', checksum: 'not a documented field' },
      validateRequestBody: false,
      expectStatus: 400,
    });
    assert.equal(result.body.error.code, 'VALIDATION_FAILED');
  });

  it('404s completion of a media id that does not exist', { skip: needsEditor }, async () => {
    const result = await callOperation('adminCompleteMediaUpload', {
      role: 'editor',
      pathParams: { mediaId: 'med_00000000000000000000000000' },
      expectStatus: 404,
    });
    assert.equal(result.body.error.code, 'MEDIA_NOT_FOUND');
  });
});
