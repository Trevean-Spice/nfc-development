/*
 * ONE PUBLISH AT A TIME, AND SEVERAL PUBLISHES SHARE ONE RENDER.
 *
 * Added Friday 4 September 2026, with the decision about where the render runs. Section 7 of
 * this package's README listed coalescing as the cheapest of three unbuilt improvements and
 * called it an improvement. It is not an improvement any more, it is a correctness
 * requirement, and the host decision is what changed that.
 *
 * WHY IT IS NOT OPTIONAL. The render is `npm run build` in build/web, as a child process, in
 * one working directory. Two of those running at once write `.next`, `out`, `public/media`
 * and `.content-snapshot` underneath each other. The failure is not a slow publish; it is a
 * page assembled from two different renders, or an export that half exists when the publish
 * step walks it. On top of that, the publish steps read the published manifest, diff against
 * it, put the changed objects and write the manifest back, so two publishes interleaved
 * leave a manifest describing neither, which makes the NEXT publish's diff wrong and
 * invalidates the wrong paths.
 *
 * Before the host was decided this was reachable but unlikely: one process on a laptop, one
 * publish at a time by hand. It stopped being unlikely the moment the pipeline became a long
 * lived service with a marketing team in front of it, and M3's acceptance scenario is a
 * person editing several blends in a session, which is exactly the case that produces two
 * dispatches inside one render window.
 *
 * The Terraform holds the other half of the same rule: the service runs exactly one task and
 * its deployment maximum is 100 percent, so it never briefly runs two. Two processes cannot
 * be serialised by a lock inside one of them.
 *
 * ---------------------------------------------------------------------------------------
 * THE RULE, STATED ONCE
 *
 *   A job that arrives while a publish is running waits for the NEXT one. It is never
 *   served by the render already in flight.
 *
 * That is deliberate and it is the conservative direction. The API writes the published
 * snapshot before it dispatches, so a render already in progress MIGHT read an edit
 * dispatched a moment ago, depending on where in the render its content fetch happened. It
 * might not. Serving a job from a render that may have started before the edit was readable
 * would mean reporting a change live that is not on the page, which is the one failure this
 * whole pipeline exists to prevent. Waiting costs one render. Guessing costs an editor's
 * trust in the confirmation.
 *
 * Every job that waits is then coalesced: the whole batch runs as ONE render and ONE
 * publish, over the union of their paths, and every job in it gets the same outcome with its
 * own clock. A batch of four blends costs one render rather than four, which is where the
 * five minute requirement is actually won when somebody is working through a session.
 */

import { fail, recomputeTimings } from './jobs.mjs';

/** Fields runPublish writes on a job, mirrored onto the rest of a coalesced batch. */
const OUTCOME_FIELDS = [
  'status',
  'rendered',
  'placeholder',
  'published',
  'unchanged',
  'invalidation',
  'live',
  'renderedAtMs',
  'publishedAtMs',
  'liveAtMs',
];

/**
 * The absolute instants are copied and the intervals are recomputed per job, which is the
 * point rather than an implementation detail. A job accepted three seconds after the lead
 * reached the edge at the same instant, so its accepted-to-live is three seconds SHORTER.
 * Each job's number is the truth about that job's own publish.
 */
function mirror(lead, follower) {
  for (const field of OUTCOME_FIELDS) follower[field] = lead[field];
  follower.failure = lead.failure;
  recomputeTimings(follower);
}

export class PublishQueue {
  /**
   * @param {object} options
   * @param {(job: object, batch: object[]) => Promise<object>} options.run  normally runPublish
   */
  constructor({ run }) {
    this.run = run;
    this.pending = [];
    this.inFlight = null;
    /** Observable, for the tests and for anyone reading a job record and asking why it waited. */
    this.rendersRun = 0;
    this.jobsCoalesced = 0;
  }

  /** True while a render is in progress. A job submitted now waits for the next one. */
  get busy() {
    return this.inFlight !== null;
  }

  get waiting() {
    return this.pending.length;
  }

  /**
   * @returns {Promise<object>} the job, settled. It never rejects: a failed publish is a
   *   recorded outcome on the job, because the caller has already answered 202 and the only
   *   thing an exception here could do is take the process down.
   */
  submit(job) {
    const entry = { job, resolve: null };
    const settled = new Promise((resolve) => {
      entry.resolve = resolve;
    });
    this.pending.push(entry);
    this.#drain();
    return settled;
  }

  /**
   * Everything currently queued or running, for a clean shutdown and for the tests.
   *
   * The loop rather than a single await is not defensive padding: a batch that finishes
   * while another job is waiting starts the next batch inside its own finally, so there is
   * always exactly one promise to await and it is not always the same one.
   */
  async settle() {
    while (this.inFlight) await this.inFlight;
  }

  #drain() {
    if (this.inFlight || this.pending.length === 0) return;

    const batch = this.pending;
    this.pending = [];

    const jobs = batch.map((entry) => entry.job);
    const [lead, ...followers] = jobs;

    // The union, in first-seen order, because the order a publish selects objects in is the
    // order they are reported to the editor and a set would scramble it.
    const union = [];
    for (const job of jobs) {
      for (const path of job.paths) if (!union.includes(path)) union.push(path);
    }

    // Every job in the batch carries the union, because that is honestly what its publish
    // covered, and the ids of the others, because an editor asking why their publish reports
    // paths they did not touch deserves an answer in the record rather than in the logs.
    for (const job of jobs) {
      job.paths = [...union];
      job.coalescedWith = jobs.filter((other) => other !== job).map((other) => other.revalidationId);
    }
    if (followers.length > 0) this.jobsCoalesced += followers.length;
    this.rendersRun += 1;

    // The runner is called SYNCHRONOUSLY, inside the async function rather than after a
    // Promise.resolve().then(). Deferring it by a microtask would mean a window in which a
    // job has been accepted, nothing is running, and a second submit in the same tick could
    // not tell. The try also catches a synchronous throw from the runner, which a .catch()
    // chained onto a deferred call would have caught in a different order.
    this.inFlight = (async () => {
      try {
        await this.run(lead, jobs);
      } catch (err) {
        fail(lead, err);
      }
      for (const follower of followers) mirror(lead, follower);
      for (const entry of batch) entry.resolve(entry.job);
    })().finally(() => {
      this.inFlight = null;
      this.#drain();
    });
  }
}
