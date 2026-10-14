/*
 * The placeholder guard. These are the tests that must never be relaxed.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { enforce, findPlaceholderObjects, markersFrom } from '../src/guard.mjs';
import { makeFixture } from './helpers/fixture.mjs';

const objectsWith = (text) => [
  { key: 'blends/persian-sunrise.html', body: Buffer.from(text, 'utf8'), contentType: 'text/html; charset=utf-8' },
];

test('the sentinel and the secondary marker both count, and both come from the content package', () => {
  const fixture = makeFixture();
  try {
    const markers = markersFrom(fixture.contentDir);
    assert.equal(markers.sentinel, '[PLACEHOLDER]');
    assert.equal(markers.secondaryMarker, 'NOT REAL CONTENT');

    assert.equal(findPlaceholderObjects(objectsWith('<p>[PLACEHOLDER]</p>'), markers).length, 1);
    assert.equal(findPlaceholderObjects(objectsWith('<p>NOT REAL CONTENT</p>'), markers).length, 1);
    assert.equal(findPlaceholderObjects(objectsWith('<p>real copy</p>'), markers).length, 0);
  } finally {
    fixture.cleanup();
  }
});

test('production refuses placeholder content and there is no override that changes it', () => {
  const fixture = makeFixture();
  try {
    assert.throws(
      () =>
        enforce({
          stage: 'production',
          objects: objectsWith('<p>[PLACEHOLDER] NOT REAL CONTENT</p>'),
          contentDir: fixture.contentDir,
        }),
      (err) => {
        assert.equal(err.name, 'PlaceholderRefusal');
        assert.match(err.message, /has no override/);
        assert.equal(err.placeholderObjects.length, 1);
        return true;
      },
    );

    // There is no argument, environment variable or job field that gets past it. This test
    // asserts the shape of the function rather than its behaviour on a flag, because the
    // way this guard gets weakened is by somebody adding the flag.
    assert.equal(enforce.length, 1, 'enforce takes one options object and no override parameter');
    const source = enforce.toString();
    assert.match(
      source,
      /^function enforce\(\{ stage, objects, contentDir \}\)/,
      'the deployment guard takes exactly stage, objects and contentDir. Anything else is a way past it.',
    );
    assert.ok(!source.includes('process.env'), 'the deployment guard must not read an environment variable');
  } finally {
    fixture.cleanup();
  }
});

test('a stage that is not production records the placeholder objects and allows the publish', () => {
  const fixture = makeFixture();
  try {
    const result = enforce({
      stage: 'staging',
      objects: objectsWith('<p>[PLACEHOLDER]</p>'),
      contentDir: fixture.contentDir,
    });
    assert.equal(result.refused, false);
    assert.equal(result.placeholderObjects.length, 1);
    assert.match(result.note, /would be refused outright on production/);
  } finally {
    fixture.cleanup();
  }
});

test('a missing content package falls back to the documented markers rather than to permissiveness', () => {
  const markers = markersFrom('/no/such/content/package');
  assert.equal(markers.sentinel, '[PLACEHOLDER]');
  assert.match(markers.source, /fallback literals/);
  assert.throws(
    () =>
      enforce({
        stage: 'production',
        objects: objectsWith('<p>[PLACEHOLDER]</p>'),
        contentDir: '/no/such/content/package',
      }),
    /PlaceholderRefusal|Refused/,
  );
});

test('a binary object is not scanned for markers and does not block', () => {
  const fixture = makeFixture();
  try {
    const result = enforce({
      stage: 'production',
      objects: [
        { key: 'media/x/hero.avif', body: Buffer.from('[PLACEHOLDER]', 'utf8'), contentType: 'image/avif' },
      ],
      contentDir: fixture.contentDir,
    });
    assert.equal(result.placeholderObjects.length, 0);
  } finally {
    fixture.cleanup();
  }
});
