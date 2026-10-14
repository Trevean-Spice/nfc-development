import { config } from '../config.js';
import type { ApiClient } from '../api/client.js';
import { ApiError, ApiUnreachable } from '../api/errors.js';
import type { PublishResult } from '../api/types.js';

/**
 * Did it actually work.
 *
 * Publish returns 202 and does not wait for regeneration, which is correct: the previous
 * version keeps serving until the new one is ready, so no customer waits for a render and
 * no editor waits for a deploy. The cost of that design is that a 202 on its own tells an
 * editor nothing about whether their change is live, and "content live within 5 minutes"
 * is a contractual criterion, SOW section 6.2.
 *
 * GAP IN THE FROZEN CONTRACT. Section 10.2 of the contract says the publish response is
 * "202 with a status URL". The PublishResult schema has no status URL, and there is no
 * operation anywhere in the document that reads the state of a revalidationId. There is
 * therefore no contract legal way to ask the API whether a revalidation finished. Reported
 * rather than invented. See the README, "Gaps found in the frozen contract".
 *
 * What this does instead, entirely within the frozen surface: re-read the public content
 * route, which is unauthenticated and returns published content only, and compare the
 * version it serves with the version that was just published. That confirms the origin is
 * serving the new version. It does NOT confirm the CDN has regenerated the HTML, and this
 * module says so rather than implying a stronger guarantee than it earns.
 */

export type VerifyOutcome = 'confirmed' | 'not_yet' | 'unavailable';

export interface VerifyResult {
  outcome: VerifyOutcome;
  attempts: number;
  elapsedMs: number;
  observedVersion: number | null;
  expectedVersion: number;
  message: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function verifyPublished(
  api: ApiClient,
  result: PublishResult,
  options: { attempts?: number; intervalMs?: number } = {},
): Promise<VerifyResult> {
  const attempts = options.attempts ?? config.publish.verifyAttempts;
  const intervalMs = options.intervalMs ?? config.publish.verifyIntervalMs;
  const started = Date.now();
  let observedVersion: number | null = null;
  let lastFailure: string | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const served = await api.publicBlend(result.slug);
      observedVersion = typeof served.version === 'number' ? served.version : null;
      if (observedVersion !== null && observedVersion >= result.version) {
        return {
          outcome: 'confirmed',
          attempts: attempt,
          elapsedMs: Date.now() - started,
          observedVersion,
          expectedVersion: result.version,
          message: `The public content route is serving version ${observedVersion}. The regenerated page follows from the CDN; the contractual requirement is within ${config.publish.liveWithinMinutes} minutes and this normally takes seconds.`,
        };
      }
    } catch (err) {
      if (err instanceof ApiUnreachable) {
        lastFailure = err.message;
      } else if (err instanceof ApiError) {
        lastFailure = `${err.code}: ${err.message}`;
      } else {
        lastFailure = (err as Error).message;
      }
    }
    if (attempt < attempts) await sleep(intervalMs);
  }

  if (lastFailure) {
    return {
      outcome: 'unavailable',
      attempts,
      elapsedMs: Date.now() - started,
      observedVersion,
      expectedVersion: result.version,
      message: `The publish was accepted, but the confirming read failed: ${lastFailure}. The content is saved. Check the API and use Revalidate paths if the page does not update.`,
    };
  }

  return {
    outcome: 'not_yet',
    attempts,
    elapsedMs: Date.now() - started,
    observedVersion,
    expectedVersion: result.version,
    message: `The publish was accepted and version ${result.version} was written, but the public route was still serving version ${observedVersion ?? 'unknown'} after ${Math.round((Date.now() - started) / 1000)} seconds. That is inside the ${config.publish.liveWithinMinutes} minute requirement, so it is not yet a failure. Reload this page to check again.`,
  };
}
