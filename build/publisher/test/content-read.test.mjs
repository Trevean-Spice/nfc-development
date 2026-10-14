/*
 * THE STALE READ, AND THE PROOF THAT IT IS CLOSED.
 *
 * The failure being tested is the one that reports success. An editor changes a blend and
 * presses publish; the renderer reads the API through an edge cache and is handed the
 * version from before the edit; it renders that, publishes it, reads it back, and the digests
 * match because stale was compared against stale. The pipeline says the change is live and
 * the page shows the old words.
 *
 * So this file does not test the assertion in isolation. It stands up a cache that behaves
 * the way CloudFront behaves inside stale-while-revalidate, runs THE REAL READ,
 * build/web/scripts/fetch-content.mjs, as a child process against it, and looks at what
 * actually landed in the snapshot the build would have rendered.
 *
 * Two cache shapes, because they fail differently and both have to be covered:
 *
 *   keyed on the full URL      what the apex distribution does. The api_content cache policy
 *                              sets query_string_behavior = "all", so the cache buster
 *                              produces a key that has never existed. The read is fresh.
 *   keyed on the path only     a cache that ignores the buster, which is what a changed
 *                              policy or an unexpected proxy would look like. The read is
 *                              stale and MUST fail loudly rather than publish.
 *
 * No AWS, no credential, no network beyond loopback.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import {
  assertFreshContentRead,
  bustCache,
  EVIDENCE_HEADERS,
  FRESHNESS_PARAM,
  judgeCacheEvidence,
  newReadToken,
  StaleContentRead,
  TOKEN_ENV,
} from '../src/content-read.mjs';
import { runWebBuild } from '../src/render.mjs';
import { close, listen, publisherRoot } from './helpers/fixture.mjs';

const FETCH_CONTENT = join(publisherRoot, '..', 'web', 'scripts', 'fetch-content.mjs');
const WEB_DIR = join(publisherRoot, '..', 'web');

/* ------------------------------------------------------------- the stand ins -- */

/**
 * The API, reduced to the four operations the read makes, with a version an "editor" can
 * move. The Cache-Control it emits is the frozen contract's, section 7, verbatim, because
 * that header is the whole reason this problem exists.
 */
function standInApi() {
  const state = { version: 1, originHits: 0 };

  const server = createServer((req, res) => {
    state.originHits += 1;
    const url = new URL(req.url, 'http://127.0.0.1');
    const v = state.version;
    const json = (body) => {
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=60, stale-while-revalidate=300',
        etag: `"v${v}"`,
      });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === '/v1/blends') return json({ data: [{ slug: 'persian-sunrise', name: 'Persian Sunrise' }], nextCursor: null });
    if (url.pathname === '/v1/blends/persian-sunrise') {
      return json({
        slug: 'persian-sunrise',
        name: 'Persian Sunrise',
        status: 'published',
        version: v,
        tagline: `origin story, version ${v}`,
        storyBlocks: [],
        grower: null,
        recipes: [],
      });
    }
    if (url.pathname === '/v1/catalog/persian-sunrise') return json({ slug: 'persian-sunrise', version: v });

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{}');
  });

  return { server, state };
}

/**
 * The cache. It answers a repeat request for the same key with the bytes it stored, marked
 * the way CloudFront marks a response it has been holding: an Age past the max-age, and
 * X-Cache: Hit from cloudfront. That is exactly the stale-while-revalidate window a second
 * publish in an editing session lands in, roughly 200 seconds after the first.
 */
function standInCache({ upstream, keyOn }) {
  const entries = new Map();
  const state = { hits: 0, misses: 0 };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const key = keyOn === 'path' ? url.pathname : `${url.pathname}${url.search}`;

    const held = entries.get(key);
    if (held) {
      state.hits += 1;
      res.writeHead(200, {
        ...held.headers,
        age: '200',
        'x-cache': 'Hit from cloudfront',
      });
      res.end(held.body);
      return;
    }

    state.misses += 1;
    const upstreamRes = await fetch(`${upstream}${req.url}`, { headers: { accept: 'application/json' } });
    const body = Buffer.from(await upstreamRes.arrayBuffer());
    const headers = {
      'content-type': upstreamRes.headers.get('content-type') ?? 'application/json',
      'cache-control': upstreamRes.headers.get('cache-control') ?? '',
      etag: upstreamRes.headers.get('etag') ?? '',
    };
    if (upstreamRes.ok) entries.set(key, { headers, body });

    res.writeHead(upstreamRes.status, { ...headers, 'x-cache': 'Miss from cloudfront' });
    res.end(body);
  });

  return { server, state, clear: () => entries.clear() };
}

/** The real read, as a child process, exactly as the render runs it. */
function runTheRealRead({ baseUrl, snapshotDir, token }) {
  return new Promise((resolveRun, rejectRun) => {
    const env = { ...process.env, TREVEAN_CONTENT_API: baseUrl, TREVEAN_CONTENT_SNAPSHOT: snapshotDir };
    if (token) env[TOKEN_ENV] = token;
    else delete env[TOKEN_ENV];

    const child = spawn(process.execPath, [FETCH_CONTENT], { env });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', rejectRun);
    child.on('close', (code) => {
      if (code !== 0) rejectRun(new Error(`fetch-content exited ${code}: ${stderr}`));
      else resolveRun(JSON.parse(readFileSync(join(snapshotDir, 'snapshot.json'), 'utf8')));
    });
  });
}

/** assert.throws returns nothing, and these tests care what the refusal SAYS. */
function refusalFrom(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return assert.fail('expected a refusal and got a successful return');
}

function renderedVersion(snapshotDir) {
  const blend = JSON.parse(readFileSync(join(snapshotDir, 'fixtures', 'blends', 'persian-sunrise.json'), 'utf8'));
  return blend.blend.tagline;
}

/* ---------------------------------------------------------------- the tests -- */

test('THE BUG, REPRODUCED: with no cache buster the render is handed the version from before the edit', async () => {
  const api = standInApi();
  const apiUrl = await listen(api.server);
  const cache = standInCache({ upstream: apiUrl, keyOn: 'full' });
  const cacheUrl = await listen(cache.server);
  const snapshotDir = mkdtempSync(join(tmpdir(), 'trevean-read-'));

  try {
    // A render before the edit. It warms the cache, which is the normal state of an API
    // that anything has read in the last few minutes.
    await runTheRealRead({ baseUrl: cacheUrl, snapshotDir, token: null });
    assert.equal(renderedVersion(snapshotDir), 'origin story, version 1');

    // The editor changes the blend and presses publish.
    api.state.version = 2;

    // The render dispatched for that edit, reading the same way.
    const snapshot = await runTheRealRead({ baseUrl: cacheUrl, snapshotDir, token: null });

    assert.equal(
      renderedVersion(snapshotDir),
      'origin story, version 1',
      'this is the failure being closed: the render rendered the previous version and nothing complained',
    );
    assert.ok(cache.state.hits > 0, 'the cache answered without going to the origin');

    // And it is caught rather than published, because a snapshot with no token is not
    // evidence about this render at all.
    assert.throws(
      () => assertFreshContentRead({ snapshotDir, baseUrl: cacheUrl, token: newReadToken() }),
      StaleContentRead,
    );
    assert.equal(snapshot.readToken, null);
  } finally {
    rmSync(snapshotDir, { recursive: true, force: true });
    await close(cache.server);
    await close(api.server);
  }
});

test('THE FIX: with the per render cache buster the same second render gets the edited words', async () => {
  const api = standInApi();
  const apiUrl = await listen(api.server);
  const cache = standInCache({ upstream: apiUrl, keyOn: 'full' });
  const cacheUrl = await listen(cache.server);
  const snapshotDir = mkdtempSync(join(tmpdir(), 'trevean-read-'));

  try {
    const first = newReadToken();
    await runTheRealRead({ baseUrl: cacheUrl, snapshotDir, token: first });
    assert.equal(renderedVersion(snapshotDir), 'origin story, version 1');

    api.state.version = 2;

    const second = newReadToken();
    const snapshot = await runTheRealRead({ baseUrl: cacheUrl, snapshotDir, token: second });

    assert.equal(
      renderedVersion(snapshotDir),
      'origin story, version 2',
      'the render must read what the editor just saved, not what the cache was holding',
    );
    assert.equal(cache.state.hits, 0, 'a query string the cache has never seen cannot be a hit');

    const proof = assertFreshContentRead({ snapshotDir, baseUrl: cacheUrl, token: second });
    assert.ok(proof.reads >= 3, 'the list, the blend and the catalog are all read');
    assert.equal(proof.token, second);
    assert.ok(snapshot.reads.every((r) => r.url.includes(`${FRESHNESS_PARAM}=${second}`)));
  } finally {
    rmSync(snapshotDir, { recursive: true, force: true });
    await close(cache.server);
    await close(api.server);
  }
});

test('A CACHE THAT IGNORES THE BUSTER FAILS LOUDLY RATHER THAN PUBLISHING STALE BYTES', async () => {
  const api = standInApi();
  const apiUrl = await listen(api.server);
  // Keyed on the path only: the buster is in the URL and the cache pays no attention to it,
  // which is what a changed cache policy or an unexpected proxy looks like from here.
  const cache = standInCache({ upstream: apiUrl, keyOn: 'path' });
  const cacheUrl = await listen(cache.server);
  const snapshotDir = mkdtempSync(join(tmpdir(), 'trevean-read-'));

  try {
    await runTheRealRead({ baseUrl: cacheUrl, snapshotDir, token: newReadToken() });
    api.state.version = 2;

    const token = newReadToken();
    await runTheRealRead({ baseUrl: cacheUrl, snapshotDir, token });

    // The bytes ARE stale. The buster did not work against this cache.
    assert.equal(renderedVersion(snapshotDir), 'origin story, version 1');

    // And the publish stops here, before the guard, the diff, the put or the invalidation.
    const err = refusalFrom(() => assertFreshContentRead({ snapshotDir, baseUrl: cacheUrl, token }));
    assert.ok(err instanceof StaleContentRead);
    assert.match(err.message, /could not be shown to have come from the origin/);
    // It names the signal and every URL that carried it, so whoever reads the log knows
    // which reads were stale rather than being told the render "failed".
    assert.match(err.detail, /Age: 200/);
    assert.match(err.detail, /\/v1\/blends\?/);
    assert.match(err.detail, /\/v1\/blends\/persian-sunrise\?/);
    assert.match(err.detail, /\/v1\/catalog\/persian-sunrise\?/);
    assert.match(err.detail, /Nothing was published/);
  } finally {
    rmSync(snapshotDir, { recursive: true, force: true });
    await close(cache.server);
    await close(api.server);
  }
});

test('the render refuses to build on a stale read, so a stale publish never costs a render', async (t) => {
  t.diagnostic('spawns npm in build/web, so it is the slowest test here and still finishes in seconds');

  const api = standInApi();
  const apiUrl = await listen(api.server);
  const cache = standInCache({ upstream: apiUrl, keyOn: 'path' });
  const cacheUrl = await listen(cache.server);
  const snapshotDir = mkdtempSync(join(tmpdir(), 'trevean-read-'));

  try {
    // Warm the cache the way any earlier reader would have.
    await runTheRealRead({ baseUrl: cacheUrl, snapshotDir, token: newReadToken() });
    api.state.version = 2;

    await assert.rejects(
      async () =>
        runWebBuild({
          webDir: WEB_DIR,
          contentApiBaseUrl: cacheUrl,
          timeoutMs: 120000,
          env: { ...process.env, TREVEAN_CONTENT_SNAPSHOT: snapshotDir },
        }),
      (err) => {
        assert.equal(err.name, 'StaleContentRead');
        assert.match(err.message, /could not be shown to have come from the origin/);
        return true;
      },
      'runWebBuild must throw before `next build` runs, not after two hundred seconds of rendering',
    );
  } finally {
    rmSync(snapshotDir, { recursive: true, force: true });
    await close(cache.server);
    await close(api.server);
  }
});

/* --------------------------------------------------------------- unit rules -- */

test('a snapshot left behind by an earlier render is refused rather than rendered as fresh', async () => {
  const api = standInApi();
  const apiUrl = await listen(api.server);
  const snapshotDir = mkdtempSync(join(tmpdir(), 'trevean-read-'));

  try {
    const earlier = newReadToken();
    await runTheRealRead({ baseUrl: apiUrl, snapshotDir, token: earlier });

    // build/web's loadContent renders whatever snapshot is on disk whenever
    // TREVEAN_CONTENT_API is set, so "the fetch did not run this time" has to be caught here.
    const err = refusalFrom(() => assertFreshContentRead({ snapshotDir, baseUrl: apiUrl, token: newReadToken() }));
    assert.ok(err instanceof StaleContentRead);
    assert.match(err.message, /was not taken by this render/);

    // The same snapshot read against a different API is refused too.
    assert.throws(
      () => assertFreshContentRead({ snapshotDir, baseUrl: 'https://somewhere.else', token: earlier }),
      /this publish was configured to read/,
    );
  } finally {
    rmSync(snapshotDir, { recursive: true, force: true });
    await close(api.server);
  }
});

test('no snapshot at all is a refusal, not a fall through', () => {
  const empty = mkdtempSync(join(tmpdir(), 'trevean-read-'));
  try {
    assert.throws(
      () => assertFreshContentRead({ snapshotDir: empty, baseUrl: 'http://127.0.0.1:3001', token: 'abc' }),
      /recorded no content read/,
    );
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('the three signals that mean a cache served it, and the absence that means it did not', () => {
  assert.equal(judgeCacheEvidence({}).cached, false);
  assert.equal(judgeCacheEvidence({ age: '0', 'x-cache': 'Miss from cloudfront' }).cached, false);

  // The exact shape of the failure: past max-age, inside stale-while-revalidate.
  assert.equal(judgeCacheEvidence({ age: '200', 'cache-control': 'public, max-age=60, stale-while-revalidate=300' }).cached, true);
  assert.equal(judgeCacheEvidence({ 'x-cache': 'Hit from cloudfront' }).cached, true);
  assert.equal(judgeCacheEvidence({ 'x-cache': 'RefreshHit from cloudfront' }).cached, true);
  assert.equal(judgeCacheEvidence({ 'CF-Cache-Status': 'STALE' }).cached, true);
});

test('the buster is a query parameter, because that is what the apex cache key is built from', () => {
  const busted = bustCache('https://example.test/v1/blends/persian-sunrise?include=grower,recipes', 'tok');
  const parsed = new URL(busted);
  assert.equal(parsed.searchParams.get(FRESHNESS_PARAM), 'tok');
  assert.equal(parsed.searchParams.get('include'), 'grower,recipes');
  assert.equal(bustCache('https://example.test/v1/blends', ''), 'https://example.test/v1/blends');
});

test('two tokens from the same millisecond still differ, because a render is not a clock tick', () => {
  const now = 1757000000000;
  assert.notEqual(newReadToken(now), newReadToken(now));
});

test('build/web carries the same parameter, the same variable and the same evidence list, and does not import this package', () => {
  const script = readFileSync(FETCH_CONTENT, 'utf8');

  assert.match(script, new RegExp(`FRESHNESS_PARAM = '${FRESHNESS_PARAM}'`));
  assert.match(script, new RegExp(`process\\.env\\.${TOKEN_ENV}`));
  for (const header of EVIDENCE_HEADERS) {
    assert.ok(script.includes(`'${header}'`), `build/web must record the ${header} header`);
  }

  // build/web builds on its own and a developer running the fetch by hand has no publish
  // pipeline, so the dependency must not exist in that direction. This assertion is what
  // makes the duplicated literals above safe: they are duplicated deliberately, and the
  // duplication is checked here rather than left to hold by luck.
  assert.ok(
    !/^\s*import[^\n]*publisher/m.test(script),
    'build/web must not import from build/publisher. Naming it in a comment is fine and is how the two stay in step.',
  );
});
