import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { bearerFrom } from '../auth/jwt.js';
import { config } from '../config/env.js';
import { rateLimited } from './errors.js';

/**
 * Rate limits are enforced at the CDN and WAF layer, not in application code, so a flood
 * never reaches a function. API contract, section 9:
 *
 *   POST /v1/scan-events           60 per minute per source IP, burst 20     EDGE ONLY
 *   Public content reads           600 per minute per source IP              EDGE ONLY
 *   /v1/admin/*                    300 per minute per authenticated subject
 *   POST /v1/admin/media/uploads   60 per minute per subject
 *
 * This in process limiter exists only for an environment with nothing in front of it, and
 * is off unless RATE_LIMIT_ENABLED is set.
 *
 * WHAT IT KEYS ON, AND WHY THAT IS THE ONLY HONEST ANSWER
 *
 * It counts per credential, and it counts nothing else. Two rules decide that, and they
 * are not negotiable by anyone tuning a number in this file:
 *
 *   1. NO IP ADDRESS. The Architecture document says no IP storage, and a counter keyed on
 *      an IP is storing an IP. Edge rate limiting can key on a source address because the
 *      CDN never hands it to us and never persists it here.
 *   2. A REQUEST WITH NO CREDENTIAL IS NOT LIMITED IN PROCESS. There is no key for it that
 *      is not rule 1, and a bucket shared by every anonymous caller is not a rate limit at
 *      all: it is a fuse that one noisy source blows on behalf of the entire internet.
 *
 * Rule 2 is load bearing on exactly one route. POST /v1/scan-events is the only endpoint on
 * the tap path, it is unauthenticated by necessity because a browser beacon cannot hold a
 * secret, and a shared bucket of 60 per minute in front of it means one client sending 61
 * beacons a minute denies telemetry to every real customer at once. The scan count is the
 * number the acceptance criteria are measured with, so silencing it globally is not a
 * degraded control, it is a fabricated measurement. The beacon's limit is per source IP at
 * the edge, per contract section 9, and only the CDN can key on that.
 *
 * This was previously registered as an onRequest hook reading request.principal. In Fastify
 * onRequest always runs before a route level preHandler, and request.principal is set by
 * requireRole, which is a preHandler. So the subject was undefined on every request and
 * every bucket was shared: one admin exhausted the budget for all admins, and the beacon
 * had a single global bucket for the whole internet. Moving the hook does not fix it,
 * because an instance level preHandler still runs before a route level one. The credential
 * is read from the Authorization header here instead, which is available in onRequest.
 *
 * The bearer token is HASHED and only the hash is used as a map key. The token itself is
 * never stored, never logged and never compared. The hash is not verified either: this is a
 * counter, not an authorisation decision, and requireRole does the real check a few
 * microseconds later. An unverifiable token gets its own bucket and then a 401.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;

/**
 * Bounded because the key is derived from an unverified credential, so a caller sending
 * fresh garbage tokens would otherwise grow this map without limit. At capacity, expired
 * buckets are pruned and a genuinely new key is simply not counted. That fails towards not
 * limiting rather than towards exhausting memory, which is the correct direction for a
 * defence in depth control that is off by default.
 */
const MAX_BUCKETS = 10_000;

export const LIMITS = {
  scanEvents: 60,
  publicContent: 600,
  admin: 300,
  mediaUploads: 60,
} as const;

export type LimitClass = keyof typeof LIMITS;

/**
 * The bucket class, not the path. The contract says 300 per minute per authenticated
 * subject for /v1/admin/*, which is one budget across the seventeen admin operations, not
 * 300 each. Keying on the path would have given a caller 300 per route.
 */
export function limitClassFor(url: string): LimitClass {
  const path = url.split('?')[0] ?? url;
  if (path.startsWith('/v1/scan-events')) return 'scanEvents';
  if (path.startsWith('/v1/admin/media/uploads')) return 'mediaUploads';
  if (path.startsWith('/v1/admin')) return 'admin';
  return 'publicContent';
}

/**
 * The bucket key, or undefined when the request carries no credential and therefore has no
 * key that is not a source address. Exported so the keying is testable on its own, because
 * the previous defect was invisible from outside: the limiter worked, it just counted
 * everybody together.
 */
export function rateLimitKey(request: Pick<FastifyRequest, 'headers' | 'url'>): string | undefined {
  const token = bearerFrom(request.headers.authorization);
  if (!token) return undefined;
  const credential = createHash('sha256').update(token).digest('hex').slice(0, 32);
  return `cred:${credential}:${limitClassFor(request.url)}`;
}

export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  if (!config.rateLimit.enabled) return;
  const buckets = new Map<string, Bucket>();

  app.addHook('onRequest', async (request) => {
    const key = rateLimitKey(request);
    if (key === undefined) return;
    const limit = LIMITS[limitClassFor(request.url)];

    // Real clock on purpose. This measures elapsed wall time inside one process and the
    // value never leaves it, so it is not a business timestamp and does not belong behind
    // the injectable clock in util/clock.ts.
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (!bucket && buckets.size >= MAX_BUCKETS) {
        for (const [existing, value] of buckets) {
          if (value.resetAt <= now) buckets.delete(existing);
        }
        if (buckets.size >= MAX_BUCKETS) return;
      }
      buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
      return;
    }
    bucket.count += 1;
    if (bucket.count > limit) {
      throw rateLimited(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)));
    }
  });
}
