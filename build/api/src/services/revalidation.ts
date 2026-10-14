import { createHmac } from 'node:crypto';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { config } from '../config/env.js';
import { secrets } from '../config/secrets.js';
import { db } from '../db/client.js';
import { LIVE_SK, revalidationPk } from '../db/keys.js';
import { logger } from '../observability/logger.js';
import { now } from '../util/clock.js';
import { newRevalidationId } from '../util/ids.js';
import { nowIso } from '../util/time.js';

/**
 * Publish and revalidate enqueue regeneration of exactly the affected pages, and do not
 * wait for it.
 *
 * The previous version keeps serving until the new one is ready, so no customer waits for
 * a render and no editor waits for a deploy. That is the whole point of the rendering
 * strategy: SOW section 6.2 requires content live within 5 minutes, and this is expected
 * to complete in seconds.
 *
 * The request to the renderer is signed, because it can invalidate cached pages and an
 * unauthenticated invalidation endpoint is a denial of service primitive pointed at the
 * one thing that protects the 2.0 second tap budget.
 */

export interface RevalidationJob {
  revalidationId: string;
  paths: string[];
  status: 'queued';
}

/** Exactly the paths a blend change affects. */
export function pathsForBlend(slug: string): string[] {
  return [`/blend.html?blend=${slug}`, `/blends/${slug}`, '/sitemap.xml'];
}

export function dedupePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}

async function dispatch(job: RevalidationJob, reason: string | null): Promise<void> {
  if (!config.revalidation.webhookUrl) {
    logger.info('revalidation queued, no renderer webhook configured', {
      revalidationId: job.revalidationId,
      paths: job.paths,
    });
    return;
  }
  const body = JSON.stringify({ revalidationId: job.revalidationId, paths: job.paths, reason });
  let signature = '';
  try {
    const secret = await secrets().get(config.revalidation.secretName);
    signature = createHmac('sha256', secret).update(body).digest('hex');
  } catch (err) {
    logger.error('revalidation secret unavailable, not dispatching', { revalidationId: job.revalidationId });
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(config.revalidation.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-trevean-signature': `sha256=${signature}` },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.error('renderer rejected revalidation', { revalidationId: job.revalidationId, status: res.status });
    }
  } catch {
    // A failed dispatch is recorded and retried by the operator through the manual
    // revalidate endpoint. It is never allowed to fail the publish that produced it,
    // because the content is already saved and the previous page is still serving.
    logger.error('revalidation dispatch failed', { revalidationId: job.revalidationId });
  } finally {
    clearTimeout(timer);
  }
}

export async function enqueueRevalidation(
  paths: string[],
  reason: string | null,
  actor: string | undefined,
): Promise<RevalidationJob> {
  const job: RevalidationJob = { revalidationId: newRevalidationId(), paths: dedupePaths(paths), status: 'queued' };
  await db().send(
    new PutCommand({
      TableName: config.tables.spiceBlends,
      Item: {
        pk: revalidationPk(job.revalidationId),
        sk: LIVE_SK,
        revalidationId: job.revalidationId,
        paths: job.paths,
        reason,
        requestedBy: actor ?? null,
        status: 'queued',
        createdAt: nowIso(),
        expiresAt: Math.floor(now() / 1000) + 30 * 86400,
      },
    }),
  );
  await dispatch(job, reason);
  return job;
}
