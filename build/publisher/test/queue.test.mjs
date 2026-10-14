/*
 * The publish queue: one render at a time, and several publishes sharing one render.
 *
 * These are correctness assertions rather than performance ones. The render is `npm run
 * build` in one working directory and the publish steps read, diff and rewrite one manifest,
 * so two of either running at once is a page assembled from two renders or a manifest
 * describing neither. See src/queue.mjs.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { newJob, recomputeTimings } from '../src/jobs.mjs';
import { PublishQueue } from '../src/queue.mjs';

/*
 * A render that has just finished starts the next batch inside its own finally, one turn
 * after the job that led it settled. So a test that releases batch n and then reaches for
 * batch n's successor has to let that turn happen. This is the queue's real behaviour rather
 * than a test artifact: it is why the 202 reports queue.busy at the moment of acceptance and
 * not a moment later.
 */
const tick = () => new Promise((resolve) => setImmediate(resolve));

const job = (id, paths) =>
  newJob({ revalidationId: id, paths, reason: null, requestedBy: null, stage: 'local', target: 'local' });

/** A runner that records how many were in flight at once and finishes when released. */
function runner() {
  const state = { started: [], concurrent: 0, maxConcurrent: 0, releases: [] };
  const run = (lead) => {
    state.started.push(lead.revalidationId);
    state.concurrent += 1;
    state.maxConcurrent = Math.max(state.maxConcurrent, state.concurrent);
    return new Promise((resolve, reject) => {
      state.releases.push({
        resolve: () => {
          state.concurrent -= 1;
          lead.status = 'complete';
          lead.liveAtMs = lead.acceptedAtMs + 1000;
          // runPublish recomputes the lead's timings itself, so the fake does too. The queue
          // deliberately does not touch the lead: it owns the followers and nothing else.
          recomputeTimings(lead);
          resolve(lead);
        },
        reject: (err) => {
          state.concurrent -= 1;
          reject(err);
        },
      });
    });
  };
  return { state, run };
}

test('two publishes never render at the same time', async () => {
  const { state, run } = runner();
  const queue = new PublishQueue({ run });

  queue.submit(job('a', ['/blend.html?blend=persian-sunrise']));
  queue.submit(job('b', ['/blend.html?blend=silk-road']));
  queue.submit(job('c', ['/blend.html?blend=caribbean-sunset']));

  assert.equal(state.maxConcurrent, 1, 'a second render started while the first was running');
  assert.equal(state.started.length, 1);

  state.releases[0].resolve();
  await tick();

  assert.equal(state.maxConcurrent, 1);
  state.releases[1].resolve();
  await queue.settle();

  assert.equal(state.maxConcurrent, 1);
});

test('jobs that arrive during a render share the next one rather than each getting their own', async () => {
  const { state, run } = runner();
  const queue = new PublishQueue({ run });

  const a = job('a', ['/blend.html?blend=persian-sunrise']);
  const b = job('b', ['/blend.html?blend=silk-road']);
  const c = job('c', ['/blend.html?blend=caribbean-sunset']);

  const settledA = queue.submit(a);
  const settledB = queue.submit(b);
  const settledC = queue.submit(c);

  state.releases[0].resolve();
  await settledA;
  await tick();
  state.releases[1].resolve();
  await Promise.all([settledB, settledC]);

  // Three publishes, two renders: the first ran alone because nothing was in flight, and the
  // two that arrived while it ran shared one. That is the whole point.
  assert.equal(queue.rendersRun, 2);
  assert.equal(queue.jobsCoalesced, 1);
  assert.deepEqual(state.started, ['a', 'b']);
});

test('a coalesced batch publishes the union of its paths and says who it was coalesced with', async () => {
  const { state, run } = runner();
  const queue = new PublishQueue({ run });

  const a = job('a', ['/first']);
  const b = job('b', ['/second', '/sitemap.xml']);
  const c = job('c', ['/third', '/sitemap.xml']);

  const settledA = queue.submit(a);
  queue.submit(b);
  queue.submit(c);

  state.releases[0].resolve();
  await settledA;

  assert.deepEqual(a.paths, ['/first'], 'the job that ran alone must not gain paths it never asked for');
  assert.deepEqual(a.coalescedWith, []);

  await tick();
  state.releases[1].resolve();
  await queue.settle();

  assert.deepEqual(b.paths, ['/second', '/sitemap.xml', '/third'], 'union, in first-seen order, deduplicated');
  assert.deepEqual(c.paths, ['/second', '/sitemap.xml', '/third']);
  assert.deepEqual(b.coalescedWith, ['c']);
  assert.deepEqual(c.coalescedWith, ['b']);
});

/*
 * THE FIRST JOB NEVER COALESCES WITH ANYTHING, and these two tests are written the long way
 * round because of it. A job submitted when nothing is running renders immediately and
 * alone: waiting for a companion would be adding latency to the common case, which is one
 * editor publishing one blend, in order to speed up the uncommon one. So producing a
 * coalesced batch takes three jobs, not two, and the first of them is the lead of the render
 * the other two wait behind.
 */

test('every job in a coalesced batch gets the outcome, and each keeps its own clock', async () => {
  const { state, run } = runner();
  const queue = new PublishQueue({ run });

  const a = job('a', ['/first']);
  const b = job('b', ['/second']);
  const c = job('c', ['/third']);
  // c was accepted later than b, so its accepted-to-live is SHORTER: it waited less for the
  // same instant. The absolute instants are shared, the intervals are not.
  b.acceptedAtMs = a.acceptedAtMs;
  c.acceptedAtMs = a.acceptedAtMs + 3000;

  const settledA = queue.submit(a);
  const settledB = queue.submit(b);
  const settledC = queue.submit(c);

  state.releases[0].resolve();
  await settledA;
  await tick();
  state.releases[1].resolve();
  await Promise.all([settledB, settledC]);

  assert.equal(c.status, 'complete');
  assert.equal(c.liveAtMs, b.liveAtMs, 'the same instant reached the edge for both');
  assert.equal(b.timings.acceptedToLiveMs, 1000);
  assert.equal(c.timings.acceptedToLiveMs, -2000, 'accepted three seconds later, so three seconds less waiting');
  assert.equal(b.timings.withinRequirement, true);
});

test('a failed render fails every job in the batch rather than only the one that led it', async () => {
  const { state, run } = runner();
  const queue = new PublishQueue({ run });

  const a = job('a', ['/first']);
  const b = job('b', ['/second']);
  const c = job('c', ['/third']);
  const settledA = queue.submit(a);
  const settledB = queue.submit(b);
  const settledC = queue.submit(c);

  state.releases[0].resolve();
  await settledA;
  await tick();
  state.releases[1].reject(new Error('the web build exited 1.'));
  await Promise.all([settledB, settledC]);

  assert.equal(a.status, 'complete', 'a batch that failed must not retrospectively fail one that succeeded');
  assert.equal(b.status, 'failed');
  assert.equal(c.status, 'failed', 'a follower reported as queued forever is worse than a follower reported as failed');
  assert.equal(c.failure.message, 'the web build exited 1.');
});

test('submit never rejects, because the 202 has already gone out', async () => {
  const queue = new PublishQueue({
    run: () => {
      throw new Error('thrown synchronously, before any promise exists');
    },
  });

  const a = job('a', ['/first']);
  const settled = await queue.submit(a);

  assert.equal(settled, a);
  assert.equal(a.status, 'failed');
});
