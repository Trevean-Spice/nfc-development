import { config } from '../config.js';

/**
 * Reading the publish pipeline, so the confirmation on the publish screen is a fact rather
 * than a hope.
 *
 * WHY THIS IS NOT THE API CLIENT, because it looks like a rule being bent and it is not.
 *
 * `src/api/client.ts` is the one door to the API and it throws if asked for an operation the
 * frozen OpenAPI document does not define. That rule stands and nothing here weakens it. The
 * publisher is a different service: it is not described by the frozen contract at all, in the
 * same way the Shopify webhook consumers are not, per the contract's section 5.4. Asking it a
 * question is not adding a surface to the API.
 *
 * WHAT IT REPLACES, AND WHAT IT DOES NOT. The existing confirmation re-reads the public
 * content route and compares versions. That proves the origin is serving the new version and
 * does not prove the CDN regenerated the HTML, and the screen has always said so. The
 * publisher does prove it, because it reads the published document back through the edge and
 * compares its sha256. So this is the stronger check and the version check stays, because
 * they fail differently: the version check catches a publish the API did not commit, and this
 * one catches a publish the edge is not serving.
 *
 * THE GAP IN THE FROZEN CONTRACT IS STILL OPEN. Section 10.2 says the publish response is
 * "202 with a status URL"; the PublishResult schema has no such field and no operation reads
 * the state of a revalidationId. The contract errata, E9 gap 4, recommends adding
 * `GET /v1/admin/revalidations/{revalidationId}` at minimum role Viewer, which is additive
 * and allowed inside v1, and that is Dan's decision. When it is taken, this module points at
 * the API instead of at the publisher and nothing else changes.
 */

export interface PublisherJob {
  revalidationId: string;
  status: 'queued' | 'running' | 'complete' | 'published_unconfirmed' | 'failed';
  stage: string;
  target: string;
  paths: string[];
  rendered: { mode: string; elapsedMs: number } | null;
  published: Array<{ path: string; bytes: number; sha256: string; cacheControl: string }>;
  unchanged: string[];
  invalidation: { invalidationId: string | null; paths: string[]; note?: string } | null;
  placeholder: { objects: Array<{ key: string; markers: string[] }>; note: string | null };
  live: { confirmed: boolean; checked: number; url: string | null; detail: string | null };
  timings: {
    renderMs: number | null;
    publishMs: number | null;
    acceptedToPublishedMs: number | null;
    acceptedToLiveMs: number | null;
    liveWithinMs: number;
    withinRequirement: boolean | null;
  };
  failure: { name: string; message: string } | null;
}

export type PipelineOutcome = 'not_configured' | 'live' | 'running' | 'unconfirmed' | 'failed' | 'unreachable';

export interface PipelineResult {
  outcome: PipelineOutcome;
  job: PublisherJob | null;
  message: string;
  /** Publish accepted to the new bytes served at the edge. The contractual number. */
  elapsedMs: number | null;
}

const TERMINAL = new Set(['complete', 'published_unconfirmed', 'failed']);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchJob(revalidationId: string): Promise<PublisherJob | null> {
  const base = config.publish.publisherBaseUrl;
  if (!base) return null;
  const res = await fetch(`${base}/revalidations/${encodeURIComponent(revalidationId)}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(config.api.timeoutMs),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`the publish pipeline answered HTTP ${res.status}`);
  return (await res.json()) as PublisherJob;
}

export function describe(job: PublisherJob | null): PipelineResult {
  if (!job) {
    return {
      outcome: 'running',
      job: null,
      message:
        'The publish pipeline has not recorded this job yet. The API accepted the publish and the ' +
        'previous version is still serving. Reload to check again.',
      elapsedMs: null,
    };
  }

  if (job.status === 'failed') {
    return {
      outcome: 'failed',
      job,
      message:
        `The publish pipeline refused or failed: ${job.failure?.message ?? 'no reason was recorded'} ` +
        'Nothing was published and the previous version is still serving.',
      elapsedMs: null,
    };
  }

  if (job.status === 'complete' && job.live.confirmed) {
    const seconds = job.timings.acceptedToLiveMs === null ? null : Math.round(job.timings.acceptedToLiveMs / 100) / 10;
    return {
      outcome: 'live',
      job,
      message:
        `The change is live. The edge served the newly published document ${seconds === null ? '' : `${seconds} seconds `}` +
        `after the pipeline accepted the job, against a ${config.publish.liveWithinMinutes} minute requirement. ` +
        `${job.published.length} object${job.published.length === 1 ? '' : 's'} published, ` +
        `${job.invalidation?.paths.length ?? 0} path${(job.invalidation?.paths.length ?? 0) === 1 ? '' : 's'} invalidated.`,
      elapsedMs: job.timings.acceptedToLiveMs,
    };
  }

  if (job.status === 'published_unconfirmed') {
    return {
      outcome: 'unconfirmed',
      job,
      message:
        'The objects were published and the invalidation was created, but reading the page back ' +
        `did not return the new document: ${job.live.detail ?? 'no detail was recorded'}. ` +
        'Do not treat this as live. Use Revalidate paths, and if it repeats the invalidation is ' +
        'not clearing the path the page is actually cached under.',
      elapsedMs: null,
    };
  }

  return {
    outcome: 'running',
    job,
    message:
      `The publish pipeline is ${job.status}. The previous version keeps serving until the new one ` +
      `is ready, and the contractual requirement is within ${config.publish.liveWithinMinutes} minutes. ` +
      'Reload to check again.',
    elapsedMs: null,
  };
}

/**
 * Poll for a bounded time and then report where it got to.
 *
 * The bound matters. A full render is measured in minutes on a cold machine, and an admin
 * screen that blocks for that long is a screen a person reloads or abandons, after which
 * nobody knows whether the publish worked. So it waits briefly, says exactly what it knows,
 * and gives the editor a way to ask again.
 */
export async function confirmThroughPipeline(revalidationId: string): Promise<PipelineResult> {
  if (!config.publish.publisherBaseUrl) {
    return {
      outcome: 'not_configured',
      job: null,
      message:
        'No publish pipeline is configured for this environment, so nothing here can confirm that ' +
        'the regenerated page reached the edge. Only the origin check above applies.',
      elapsedMs: null,
    };
  }

  let job: PublisherJob | null = null;
  for (let attempt = 1; attempt <= config.publish.publisherAttempts; attempt += 1) {
    try {
      job = await fetchJob(revalidationId);
    } catch (err) {
      return {
        outcome: 'unreachable',
        job: null,
        message:
          `The publish pipeline could not be reached: ${(err as Error).message}. The content is saved ` +
          'and the API accepted the publish. Nothing here claims the page is live.',
        elapsedMs: null,
      };
    }
    if (job && TERMINAL.has(job.status)) break;
    if (attempt < config.publish.publisherAttempts) await sleep(config.publish.publisherIntervalMs);
  }

  return describe(job);
}
