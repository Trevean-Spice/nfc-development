/*
 * The acceptance criterion, exercised end to end with no AWS.
 *
 * "Content editable end to end without a developer, changes live within 5 minutes."
 *
 * The shape of the run below is the shape of the real one: the API dispatches a signed job,
 * the publisher renders (here, prebuilt), guards, diffs, puts, invalidates, and then READS
 * THE PAGE BACK THROUGH THE EDGE and compares the bytes. The edge holds a cache, so a
 * publish that failed to invalidate the right path fails this test rather than passing it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createStandInEdge } from '../src/stand-in-edge.mjs';
import { createPublisherServer } from '../src/server.mjs';
import { sign } from '../src/signature.mjs';
import { LocalCdn, LocalObjectStore } from '../src/store/local.mjs';
import { newJob, toWire } from '../src/jobs.mjs';
import { runPublish } from '../src/publish.mjs';
import { REAL_BLEND_HTML, close, listen, makeFixture } from './helpers/fixture.mjs';

const SECRET = 'test-revalidation-secret';

async function harness({ stage = 'local', placeholder = false } = {}) {
  const fixture = makeFixture({ stage, placeholder });
  const edge = createStandInEdge({ root: fixture.siteDir });
  const baseUrl = await listen(edge);
  const config = { ...fixture.config, cdn: { ...fixture.config.cdn, publicBaseUrl: baseUrl } };
  const store = new LocalObjectStore({ root: fixture.siteDir, credential: 'test' });
  const cdn = new LocalCdn({ credential: 'test', edge: edge.trevean });
  return {
    fixture,
    edge,
    baseUrl,
    config,
    store,
    cdn,
    async cleanup() {
      await close(edge);
      fixture.cleanup();
    },
  };
}

test('an edit reaches the page a customer reads, and the elapsed time is recorded', async () => {
  const h = await harness();
  try {
    const paths = ['/blend.html?blend=persian-sunrise', '/blends/persian-sunrise', '/sitemap.xml'];

    // First publish. The bucket is empty, so everything selected is new.
    const first = newJob({ revalidationId: 'rvl_first', paths, stage: 'local', target: 'local' });
    await runPublish(first, { config: h.config, store: h.store, cdn: h.cdn });
    assert.equal(first.status, 'complete', JSON.stringify(first.failure));
    assert.ok(first.live.confirmed);

    // Warm the edge cache the way a customer's tap would.
    const before = await fetch(`${h.baseUrl}/blend.html?blend=persian-sunrise`);
    assert.equal(before.status, 200);
    assert.match(await before.text(), /persian-sunrise/);
    assert.equal(before.headers.get('cache-control'), 'public, max-age=60, s-maxage=31536000, stale-while-revalidate=86400');

    // The editor changes the origin story.
    h.fixture.writeRendered(
      'blends/persian-sunrise.html',
      REAL_BLEND_HTML('persian-sunrise').replace('<h1>persian-sunrise</h1>', '<h1>Persian Sunrise, edited</h1>'),
    );

    const second = newJob({ revalidationId: 'rvl_second', paths, stage: 'local', target: 'local' });
    await runPublish(second, { config: h.config, store: h.store, cdn: h.cdn });

    assert.equal(second.status, 'complete', JSON.stringify(second.failure));
    assert.equal(second.published.length, 1, 'exactly one object changed, so exactly one is published');
    assert.equal(second.published[0].key, 'blends/persian-sunrise.html');
    assert.deepEqual(second.invalidation.paths, ['/blends/persian-sunrise.html']);
    assert.ok(second.unchanged.includes('sitemap.xml'), 'an unchanged object is not re-published');

    // The customer's URL now serves the edit, through the same cache that was warm.
    const after = await fetch(`${h.baseUrl}/blend.html?blend=persian-sunrise`);
    assert.match(await after.text(), /Persian Sunrise, edited/);

    const wire = toWire(second);
    assert.ok(typeof wire.timings.acceptedToLiveMs === 'number');
    assert.equal(wire.timings.withinRequirement, true);
    assert.equal(wire.timings.liveWithinMs, 300000);
    process.stdout.write(
      `    observed publish to live: ${wire.timings.acceptedToLiveMs} ms ` +
        `(requirement ${wire.timings.liveWithinMs} ms)\n`,
    );
  } finally {
    await h.cleanup();
  }
});

test('a publish that invalidated nothing does not report the change as live', async () => {
  const h = await harness();
  try {
    const paths = ['/blends/persian-sunrise'];
    const first = newJob({ revalidationId: 'rvl_a', paths, stage: 'local', target: 'local' });
    await runPublish(first, { config: h.config, store: h.store, cdn: h.cdn });
    assert.equal(first.status, 'complete');

    await fetch(`${h.baseUrl}/blends/persian-sunrise.html`);

    h.fixture.writeRendered('blends/persian-sunrise.html', REAL_BLEND_HTML('edited-but-not-invalidated'));

    // A CDN that accepts the invalidation and clears nothing. This is the failure the read
    // back exists to catch, and the job must not claim the change is live.
    const deafCdn = { createInvalidation: async (p) => ({ invalidationId: 'IDEAF', paths: p }) };
    const second = newJob({ revalidationId: 'rvl_b', paths, stage: 'local', target: 'local' });
    await runPublish(second, {
      config: { ...h.config, verify: { ...h.config.verify, attempts: 3, intervalMs: 5 } },
      store: h.store,
      cdn: deafCdn,
    });

    assert.equal(second.status, 'published_unconfirmed');
    assert.equal(second.live.confirmed, false);
    assert.match(second.live.detail, /still serving the previous version/);
    assert.equal(second.timings.acceptedToLiveMs, null);
    assert.equal(second.timings.withinRequirement, null);
  } finally {
    await h.cleanup();
  }
});

test('a production publish of placeholder content refuses before a byte moves', async () => {
  const fixture = makeFixture({ stage: 'production', placeholder: true });
  const edge = createStandInEdge({ root: fixture.siteDir });
  const baseUrl = await listen(edge);
  try {
    const config = { ...fixture.config, stage: 'production', cdn: { ...fixture.config.cdn, publicBaseUrl: baseUrl } };
    const store = new LocalObjectStore({ root: fixture.siteDir, credential: 'test' });
    const cdn = new LocalCdn({ credential: 'test', edge: edge.trevean });
    const job = newJob({
      revalidationId: 'rvl_prod',
      paths: ['/blends/persian-sunrise'],
      stage: 'production',
      target: 'local',
    });

    await assert.rejects(async () => runPublish(job, { config, store, cdn }), /PlaceholderRefusal|Refused/);
    assert.equal(job.published.length, 0);
    assert.equal(job.invalidation, null);
    assert.equal(store.head('blends/persian-sunrise.html'), null, 'nothing was written');
  } finally {
    await close(edge);
    fixture.cleanup();
  }
});

test('the server refuses an unsigned or wrongly signed job and answers 202 to a valid one', async () => {
  const h = await harness();
  let server;
  try {
    server = createPublisherServer({ config: h.config, store: h.store, cdn: h.cdn, secret: SECRET });
    const base = await listen(server);
    const body = JSON.stringify({ revalidationId: 'rvl_signed', paths: ['/blends/persian-sunrise'], reason: null });

    const unsigned = await fetch(`${base}/revalidate`, { method: 'POST', body });
    assert.equal(unsigned.status, 401);
    assert.match((await unsigned.json()).error.message, /header is missing/);

    const wrong = await fetch(`${base}/revalidate`, {
      method: 'POST',
      headers: { 'x-trevean-signature': sign(body, 'the-wrong-secret') },
      body,
    });
    assert.equal(wrong.status, 401);
    assert.match((await wrong.json()).error.message, /does not match/);

    const accepted = await fetch(`${base}/revalidate`, {
      method: 'POST',
      headers: { 'x-trevean-signature': sign(body, SECRET) },
      body,
    });
    assert.equal(accepted.status, 202);
    const queued = await accepted.json();
    assert.equal(queued.status, 'queued');
    assert.equal(queued.statusUrl, '/revalidations/rvl_signed');

    await server.trevean.settle();

    const status = await fetch(`${base}/revalidations/rvl_signed`);
    assert.equal(status.status, 200);
    const job = await status.json();
    assert.equal(job.status, 'complete');
    assert.equal(job.live.confirmed, true);
    assert.ok(job.timings.acceptedToLiveMs >= 0);

    const missing = await fetch(`${base}/revalidations/rvl_nope`);
    assert.equal(missing.status, 404);
  } finally {
    if (server) await close(server);
    await h.cleanup();
  }
});

test('a publish never waits for regeneration: the 202 comes back before the work finishes', async () => {
  const h = await harness();
  let server;
  try {
    server = createPublisherServer({ config: h.config, store: h.store, cdn: h.cdn, secret: SECRET });
    const base = await listen(server);
    const body = JSON.stringify({ revalidationId: 'rvl_async', paths: ['/blends/caribbean-sunset'] });

    const accepted = await fetch(`${base}/revalidate`, {
      method: 'POST',
      headers: { 'x-trevean-signature': sign(body, SECRET) },
      body,
    });
    assert.equal(accepted.status, 202);

    const immediately = await (await fetch(`${base}/revalidations/rvl_async`)).json();
    assert.ok(['queued', 'running', 'complete'].includes(immediately.status));

    await server.trevean.settle();
    const settled = await (await fetch(`${base}/revalidations/rvl_async`)).json();
    assert.equal(settled.status, 'complete');
  } finally {
    if (server) await close(server);
    await h.cleanup();
  }
});

test('a queued path that matches no rendered object publishes nothing and says so', async () => {
  const h = await harness();
  try {
    const job = newJob({ revalidationId: 'rvl_typo', paths: ['/blends/no-such-blend'], stage: 'local', target: 'local' });
    await assert.rejects(
      async () => runPublish(job, { config: h.config, store: h.store, cdn: h.cdn }),
      /none of the queued paths matched a rendered object/,
    );
  } finally {
    await h.cleanup();
  }
});
