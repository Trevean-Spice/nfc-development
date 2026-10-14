/*
 * Configuration, resolved once, so a misconfiguration is a startup failure rather than a
 * half finished publish discovered by a customer.
 *
 * The only value that changes behaviour rather than wiring is STAGE. Every guard in this
 * package is written as a comparison against the exact string 'production', which is the
 * same rule build/api states in its own configuration module, and for the same reason: an
 * unrecognised value decides the permissive way on every one of those comparisons. So an
 * unrecognised stage refuses to start.
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** build/publisher/src -> build */
const BUILD_ROOT = resolve(here, '..', '..');

export const STAGES = ['local', 'staging', 'production'];

function str(env, name, fallback) {
  const v = env[name];
  return v === undefined || v === '' ? fallback : v;
}

function int(env, name, fallback) {
  const v = env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function stageFrom(value) {
  const stage = value === undefined || value === '' ? 'local' : value;
  if (!STAGES.includes(stage)) {
    throw new Error(
      `STAGE='${stage}' is not a recognised stage. Set it to one of ${STAGES.join(', ')}. ` +
        'The placeholder deployment guard is gated on this value, so an unrecognised one is ' +
        'refused rather than treated as non production.',
    );
  }
  return stage;
}

/**
 * Where published objects go. 's3' is the real thing. 'local' is the stand in, which lives
 * in this package and refuses everything the real one refuses. There is no third value and
 * no default that silently reaches AWS.
 */
export const TARGETS = ['local', 's3'];

function targetFrom(value, stage) {
  const target = value === undefined || value === '' ? (stage === 'local' ? 'local' : 's3') : value;
  if (!TARGETS.includes(target)) {
    throw new Error(`PUBLISH_TARGET='${target}' is not one of ${TARGETS.join(', ')}.`);
  }
  if (stage === 'production' && target !== 's3') {
    throw new Error(
      "PUBLISH_TARGET='local' with STAGE='production' would write a production publish to a " +
        'directory on somebody’s laptop and report it as live. Refused.',
    );
  }
  return target;
}

export function loadConfig(env = process.env) {
  const stage = stageFrom(env.STAGE);
  const target = targetFrom(env.PUBLISH_TARGET, stage);

  return {
    stage,
    target,
    port: int(env, 'PUBLISHER_PORT', 3003),
    host: str(env, 'PUBLISHER_HOST', '127.0.0.1'),

    /** The rendered document tree. build/web writes it. */
    renderDir: resolve(str(env, 'PUBLISHER_RENDER_DIR', resolve(BUILD_ROOT, 'web', 'out'))),
    webDir: resolve(str(env, 'PUBLISHER_WEB_DIR', resolve(BUILD_ROOT, 'web'))),
    contentDir: resolve(str(env, 'PUBLISHER_CONTENT_DIR', resolve(BUILD_ROOT, 'content'))),

    /**
     * 'build' re-runs the web build before publishing, which is what makes an edit in the
     * admin reach a page. 'prebuilt' publishes whatever is already in renderDir, which is
     * what a re-publish of unchanged content and most of the test suite need.
     */
    renderMode: str(env, 'PUBLISHER_RENDER_MODE', 'prebuilt'),
    renderTimeoutMs: int(env, 'PUBLISHER_RENDER_TIMEOUT_MS', 240000),

    /** Passed to the web build so getStaticProps reads the API rather than the fixtures. */
    contentApiBaseUrl: str(env, 'TREVEAN_CONTENT_API', ''),

    site: {
      bucket: str(env, 'SITE_BUCKET', ''),
      /** The stand in bucket. A directory, never reachable from the internet. */
      localDir: resolve(str(env, 'PUBLISHER_LOCAL_SITE_DIR', resolve(BUILD_ROOT, 'publisher', '.local-site'))),
      region: str(env, 'AWS_REGION', 'us-east-1'),
    },

    cdn: {
      distributionId: str(env, 'CLOUDFRONT_DISTRIBUTION_ID', ''),
      /** Where a published document is read back from to confirm it is actually live. */
      publicBaseUrl: str(env, 'PUBLISHER_PUBLIC_BASE_URL', ''),
    },

    /**
     * The shared secret the API signs its revalidation dispatch with. Local development
     * carries a value here; a deployed environment reads it from the managed store, which
     * is what REVALIDATION_SECRET_NAME is for.
     */
    revalidation: {
      secret: str(env, 'REVALIDATION_SECRET', ''),
      secretName: str(env, 'REVALIDATION_SECRET_NAME', 'trevean/api/revalidation-secret'),
      /** Rejects a replayed signature whose body is older than this. */
      maxSkewMs: int(env, 'REVALIDATION_MAX_SKEW_MS', 300000),
    },

    /**
     * Confirming that the change is live. The contractual number is five minutes, SOW
     * section 6.2. These are the polling parameters, not the requirement, and the job
     * records the requirement alongside the observed elapsed time so the two are never
     * confused for each other.
     */
    verify: {
      attempts: int(env, 'PUBLISHER_VERIFY_ATTEMPTS', 20),
      intervalMs: int(env, 'PUBLISHER_VERIFY_INTERVAL_MS', 1000),
      liveWithinMs: int(env, 'PUBLISHER_LIVE_WITHIN_MS', 300000),
    },

    /** Retained job records. Read by the admin publish screen. */
    jobRetention: int(env, 'PUBLISHER_JOB_RETENTION', 200),
  };
}

export const config = loadConfig();
