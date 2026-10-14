/*
 * Queued content paths to objects, and objects to cache paths. The second mapping is the one
 * that is easy to get wrong, and getting it wrong means an editor sees the old page.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { cachePathFor, objectKeysForContentPath, selectorsFor, selects } from '../src/paths.mjs';

test('the three paths the API queues for a blend all resolve to the pre-rendered document', () => {
  // build/api, services/revalidation.ts, pathsForBlend.
  const queued = ['/blend.html?blend=persian-sunrise', '/blends/persian-sunrise', '/sitemap.xml'];
  const selectors = selectorsFor(queued);

  assert.ok(selectors.keys.includes('blends/persian-sunrise.html'));
  assert.ok(selectors.keys.includes('sitemap.xml'));
  assert.ok(selectors.prefixes.includes('media/persian-sunrise/'));

  assert.ok(selects(selectors, 'blends/persian-sunrise.html'));
  assert.ok(selects(selectors, 'media/persian-sunrise/hero.avif'));
  assert.ok(!selects(selectors, 'blends/caribbean-sunset.html'), 'one blend publish must not touch another blend');
  assert.ok(!selects(selectors, 'js/enhance.js'));
});

test('the fallback document is its own object and is not selected by a blend publish', () => {
  assert.deepEqual(objectKeysForContentPath('/blend.html'), ['blend.html']);
  const selectors = selectorsFor(['/blend.html?blend=silk-road']);
  assert.ok(!selects(selectors, 'blend.html'));
});

test('an unrecognised path selects itself and nothing else, so a typo publishes nothing rather than everything', () => {
  const selectors = selectorsFor(['/not/a/real/path']);
  assert.deepEqual(selectors.keys, ['not/a/real/path']);
  assert.deepEqual(selectors.prefixes, []);
});

test('the cache path is the rewritten uri, because the rewrite runs at viewer request', () => {
  // Invalidating /blend.html would not clear the entry a tap reads. That entry is stored
  // under the rewritten path.
  assert.equal(cachePathFor('blends/persian-sunrise.html'), '/blends/persian-sunrise.html');
  assert.notEqual(cachePathFor('blends/persian-sunrise.html'), '/blend.html');
});

test('a slug is not interpolated into a path from an arbitrary string', () => {
  assert.deepEqual(objectKeysForContentPath('/blend.html?blend=../../etc/passwd'), ['blend.html?blend=../../etc/passwd']);
  // and that value is then refused by the object key assertions rather than published.
});
