/*
 * The stand in. A directory that behaves like the site bucket, and a queue that behaves like
 * CloudFront invalidation.
 *
 * It exists because AWS credentials on this engagement are one hour tokens and have been
 * expired more often than not, and because the whole publish path has to be exercisable on a
 * machine with no AWS account at all.
 *
 * IT IS STRICTER THAN THE REAL THING AND NEVER LOOSER. Every rule in store/types.mjs is
 * applied here before anything is written, plus:
 *
 *   - a credential is required, because S3 and CloudFront refuse an unsigned request and a
 *     stand in that does not is a stand in that hides a missing IAM policy until the day it
 *     matters;
 *   - a write outside the configured root is refused rather than resolved;
 *   - an invalidation is not instant. CloudFront takes tens of seconds, and a stand in that
 *     completes in zero would let a publish path that never waits for propagation pass every
 *     local run. The delay is configurable and defaults to a small non zero value so the
 *     ordering is real without making the suite slow.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { assertInvalidationPaths, assertPublishableObject, assertPublishableKey, PublishRefused } from './types.mjs';

const META_SUFFIX = '.trevean-meta.json';

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export class LocalObjectStore {
  /**
   * @param {{root: string, credential?: string}} options
   */
  constructor({ root, credential }) {
    if (!root) throw new PublishRefused('the stand in object store was created with no root directory.');
    this.root = resolve(root);
    this.credential = credential ?? null;
    this.name = `local:${this.root}`;
  }

  #authorise() {
    // S3 refuses an unsigned PutObject. So does this.
    if (!this.credential) {
      throw new PublishRefused(
        'the stand in object store has no credential. S3 refuses an unsigned request and so ' +
          'does this, so that a missing IAM policy fails here rather than in the account.',
      );
    }
  }

  #pathFor(key) {
    assertPublishableKey(key);
    const full = resolve(join(this.root, key));
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new PublishRefused(`object key '${key}' resolves outside the site root.`);
    }
    return full;
  }

  head(key) {
    const file = this.#pathFor(key);
    const meta = `${file}${META_SUFFIX}`;
    if (!existsSync(file) || !existsSync(meta)) return null;
    return JSON.parse(readFileSync(meta, 'utf8'));
  }

  getText(key) {
    const file = this.#pathFor(key);
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
  }

  getBytes(key) {
    const file = this.#pathFor(key);
    return existsSync(file) ? readFileSync(file) : null;
  }

  put({ key, body, contentType, cacheControl }) {
    this.#authorise();
    assertPublishableObject({ key, body, contentType, cacheControl });
    const file = this.#pathFor(key);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
    const record = {
      sha256: sha256(body),
      bytes: body.length,
      contentType,
      cacheControl,
      publishedAt: new Date().toISOString(),
    };
    writeFileSync(`${file}${META_SUFFIX}`, `${JSON.stringify(record, null, 2)}\n`);
    return record;
  }
}

export class LocalCdn {
  /**
   * @param {{propagationMs?: number, credential?: string, edge?: {cache: Map}, invalidateUrl?: string}} options
   *
   * `edge` is the in process stand in edge, whose cache this clears. `invalidateUrl` is the
   * same thing over HTTP, for when the edge runs as its own process. One or neither: with
   * neither, an invalidation is recorded and clears nothing, which is what a publish against
   * a bucket with no CDN in front of it actually does.
   */
  constructor({ propagationMs = 50, credential, edge, invalidateUrl } = {}) {
    this.propagationMs = propagationMs;
    this.credential = credential ?? null;
    this.edge = edge ?? null;
    this.invalidateUrl = invalidateUrl ?? null;
    this.invalidations = new Map();
    this.name = 'local:cdn';
  }

  async createInvalidation(paths) {
    if (!this.credential) {
      throw new PublishRefused(
        'the stand in CDN has no credential. CloudFront refuses an unsigned CreateInvalidation ' +
          'and so does this.',
      );
    }
    assertInvalidationPaths(paths);
    const invalidationId = `I${randomUUID().replace(/-/g, '').slice(0, 13).toUpperCase()}`;
    const record = {
      invalidationId,
      paths: [...paths],
      status: 'InProgress',
      completesAt: Date.now() + this.propagationMs,
    };
    this.invalidations.set(invalidationId, record);

    if (this.edge) for (const path of record.paths) this.edge.cache.delete(path);
    if (this.invalidateUrl) {
      await fetch(this.invalidateUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paths: record.paths }),
      });
    }

    return { invalidationId, paths: record.paths };
  }

  getInvalidation(invalidationId) {
    const record = this.invalidations.get(invalidationId);
    if (!record) return null;
    if (record.status === 'InProgress' && Date.now() >= record.completesAt) record.status = 'Completed';
    return { invalidationId, status: record.status };
  }
}
