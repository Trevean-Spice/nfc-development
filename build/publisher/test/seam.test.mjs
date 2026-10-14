/*
 * The seam, and the rule that the stand in is never more permissive than the real thing.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LocalCdn, LocalObjectStore } from '../src/store/local.mjs';
import { assertInvalidationPaths, assertPublishableObject, PublishRefused } from '../src/store/types.mjs';
import { ASSET_CACHE_CONTROL, DOCUMENT_CACHE_CONTROL, cacheControlFor, contentTypeFor } from '../src/tree.mjs';
import { makeFixture, publisherRoot } from './helpers/fixture.mjs';

test('the stand in refuses an object with no Cache-Control, which is the header that defeats the five minute requirement', () => {
  const fixture = makeFixture();
  try {
    const store = new LocalObjectStore({ root: fixture.siteDir, credential: 'test' });
    assert.throws(
      () => store.put({ key: 'blends/x.html', body: Buffer.from('<p>x</p>'), contentType: 'text/html' }),
      /has no Cache-Control/,
    );
    assert.throws(
      () => store.put({ key: 'blends/x.html', body: Buffer.from('<p>x</p>'), cacheControl: 'no-store' }),
      /has no Content-Type/,
    );
  } finally {
    fixture.cleanup();
  }
});

test('the stand in refuses an unsigned write, because S3 does', () => {
  const fixture = makeFixture();
  try {
    const store = new LocalObjectStore({ root: fixture.siteDir });
    assert.throws(
      () =>
        store.put({
          key: 'blends/x.html',
          body: Buffer.from('<p>x</p>'),
          contentType: 'text/html',
          cacheControl: 'no-store',
        }),
      /refuses an unsigned request/,
    );
  } finally {
    fixture.cleanup();
  }
});

test('the stand in refuses a key that escapes the site root or is not a valid S3 key', () => {
  const fixture = makeFixture();
  try {
    const store = new LocalObjectStore({ root: fixture.siteDir, credential: 'test' });
    const bad = ['/blends/x.html', '../escape.html', 'blends//x.html', 'a/./b.html', ''];
    for (const key of bad) {
      assert.throws(
        () =>
          store.put({ key, body: Buffer.from('x'), contentType: 'text/html', cacheControl: 'no-store' }),
        PublishRefused,
        `key '${key}' should be refused`,
      );
    }
  } finally {
    fixture.cleanup();
  }
});

test('an invalidation of the whole distribution is refused, and so is a badly formed path', () => {
  assert.throws(() => assertInvalidationPaths(['/*']), /whole distribution/);
  assert.throws(() => assertInvalidationPaths(['/**']), /whole distribution/);
  assert.throws(() => assertInvalidationPaths(['blends/x.html']), /does not begin with a slash/);
  assert.throws(() => assertInvalidationPaths(['/blends/*/x.html']), /wildcard that is not at the end/);
  assert.throws(() => assertInvalidationPaths([]), /no paths/);
  assert.throws(() => assertInvalidationPaths(new Array(3001).fill('/x')), /at most 3000/);
  assert.doesNotThrow(() => assertInvalidationPaths(['/blends/persian-sunrise.html']));
});

test('the stand in CDN refuses an unsigned invalidation', async () => {
  const cdn = new LocalCdn({});
  await assert.rejects(async () => cdn.createInvalidation(['/x']), /refuses an unsigned CreateInvalidation/);
});

test('the AWS adapter applies the same assertions before it calls AWS', async () => {
  // Imported for its assertions only. The SDK is loaded lazily inside the client, so this
  // does not need @aws-sdk installed and does not reach the network.
  const { S3ObjectStore } = await import('../src/store/aws.mjs');
  const store = new S3ObjectStore({ bucket: 'b', region: 'us-east-1', client: {} });
  await assert.rejects(
    async () => store.put({ key: '/leading-slash.html', body: Buffer.from('x'), contentType: 't', cacheControl: 'c' }),
    /starts with a slash/,
  );
  await assert.rejects(
    async () => store.put({ key: 'x.html', body: Buffer.from('x'), contentType: 'text/html' }),
    /has no Cache-Control/,
  );
});

test('the two cache headers are the ones build/web already serves', () => {
  const serve = readFileSync(join(publisherRoot, '..', 'web', 'scripts', 'serve.mjs'), 'utf8');
  assert.ok(
    serve.includes(DOCUMENT_CACHE_CONTROL),
    'the document Cache-Control must match the one the edge stand in in build/web serves',
  );
  assert.ok(
    serve.includes(ASSET_CACHE_CONTROL),
    'the asset Cache-Control must match the one the edge stand in in build/web serves',
  );
});

test('documents get the short browser max-age and assets get immutable', () => {
  assert.equal(cacheControlFor('blends/persian-sunrise.html'), DOCUMENT_CACHE_CONTROL);
  assert.equal(cacheControlFor('sitemap.xml'), DOCUMENT_CACHE_CONTROL);
  // A service worker cached immutably can never be replaced.
  assert.equal(cacheControlFor('sw.js'), DOCUMENT_CACHE_CONTROL);
  assert.equal(cacheControlFor('js/enhance.js'), ASSET_CACHE_CONTROL);
  assert.equal(cacheControlFor('media/persian-sunrise/hero.avif'), ASSET_CACHE_CONTROL);
});

test('an unregistered file type refuses rather than being published as octet-stream', () => {
  assert.throws(() => contentTypeFor('blends/x.weird'), /no Content-Type is registered/);
});

test('assertPublishableObject requires a buffer body', () => {
  assert.throws(
    () => assertPublishableObject({ key: 'x.html', body: 'a string', contentType: 't', cacheControl: 'c' }),
    /no body buffer/,
  );
});
