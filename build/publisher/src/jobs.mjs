/*
 * Publish jobs, and the clock the acceptance criterion is measured on.
 *
 * "Content editable end to end without a developer, changes live within 5 minutes" is the M3
 * acceptance criterion and it is a number, so it is measured rather than asserted. Every job
 * records four instants and the intervals between them:
 *
 *   acceptedAt    the publisher took the job off the wire
 *   renderedAt    the affected documents exist as bytes
 *   publishedAt   the changed objects are in the origin and the invalidation is created
 *   liveAt        the public URL was read back and served the new bytes
 *
 * liveAt minus acceptedAt is the number the criterion is about, and it is the only one that
 * may be quoted as publish to live. It is deliberately measured by reading the page back
 * rather than by trusting the two calls that preceded it, because "the API returned 200" and
 * "a customer's phone gets the new story" are different claims and this project has already
 * been bitten once by treating the first as evidence of the second.
 *
 * The clock starts when the publisher accepts the job, not when the editor pressed the
 * button. The gap between the two is the API write plus one dispatch, and the admin measures
 * its own end separately, so neither number quietly absorbs the other.
 */

export const LIVE_WITHIN_MS = 300000;

export function newJob({ revalidationId, paths, reason, requestedBy, stage, target }) {
  return {
    revalidationId,
    paths: [...paths],
    reason: reason ?? null,
    requestedBy: requestedBy ?? null,
    stage,
    target,
    status: 'queued',
    acceptedAt: new Date().toISOString(),
    acceptedAtMs: Date.now(),
    renderedAtMs: null,
    publishedAtMs: null,
    liveAtMs: null,
    timings: {},
    rendered: null,
    placeholder: { objects: [], note: null },
    published: [],
    unchanged: [],
    invalidation: null,
    live: { confirmed: false, checked: 0, url: null, detail: null },
    failure: null,
    liveWithinMs: LIVE_WITHIN_MS,
  };
}

export function mark(job, field) {
  job[field] = Date.now();
  recomputeTimings(job);
}

export function recomputeTimings(job) {
  const since = (ms) => (ms === null ? null : ms - job.acceptedAtMs);
  job.timings = {
    renderMs: since(job.renderedAtMs),
    publishMs: job.renderedAtMs === null || job.publishedAtMs === null ? null : job.publishedAtMs - job.renderedAtMs,
    acceptedToPublishedMs: since(job.publishedAtMs),
    /** THE CONTRACTUAL NUMBER. Publish accepted to the new bytes served from the edge. */
    acceptedToLiveMs: since(job.liveAtMs),
    liveWithinMs: job.liveWithinMs,
    withinRequirement: job.liveAtMs === null ? null : job.liveAtMs - job.acceptedAtMs <= job.liveWithinMs,
  };
}

export function fail(job, error) {
  job.status = 'failed';
  job.failure = {
    name: error?.name ?? 'Error',
    message: error?.message ?? String(error),
    placeholderObjects: error?.placeholderObjects ?? undefined,
  };
  recomputeTimings(job);
  return job;
}

/**
 * The public shape, which is what the admin publish screen reads. Buffers and absolute
 * machine paths never leave this module.
 */
export function toWire(job) {
  return {
    revalidationId: job.revalidationId,
    status: job.status,
    stage: job.stage,
    target: job.target,
    paths: job.paths,
    reason: job.reason,
    requestedBy: job.requestedBy,
    acceptedAt: job.acceptedAt,
    rendered: job.rendered,
    published: job.published.map((o) => ({
      path: `/${o.key}`,
      key: o.key,
      bytes: o.bytes,
      sha256: o.sha256,
      cacheControl: o.cacheControl,
      contentType: o.contentType,
    })),
    unchanged: job.unchanged.map((key) => `/${key}`),
    invalidation: job.invalidation,
    placeholder: job.placeholder,
    live: job.live,
    timings: job.timings,
    failure: job.failure,
  };
}

export class JobStore {
  constructor(retention = 200) {
    this.retention = retention;
    this.jobs = new Map();
  }

  put(job) {
    this.jobs.set(job.revalidationId, job);
    while (this.jobs.size > this.retention) {
      const oldest = this.jobs.keys().next().value;
      this.jobs.delete(oldest);
    }
    return job;
  }

  get(revalidationId) {
    return this.jobs.get(revalidationId) ?? null;
  }

  list() {
    return [...this.jobs.values()];
  }
}
