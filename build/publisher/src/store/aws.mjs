/*
 * The real thing. The only file in this package that knows AWS exists.
 *
 * Both SDK clients are imported dynamically, inside the constructor, for one reason that is
 * not tidiness: the whole publish path has to run on a machine with no AWS packages
 * installed and no credentials, and a top level import would make that impossible. Nothing
 * in the test suite reaches this file, and nothing outside it imports an SDK.
 *
 * Every rule in store/types.mjs is applied here BEFORE the call, so a refusal reads
 * identically against AWS and against the stand in. That is the point of asserting them in
 * a shared module rather than in each implementation.
 */

import { createHash } from 'node:crypto';
import { assertInvalidationPaths, assertPublishableObject, assertPublishableKey } from './types.mjs';

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export class S3ObjectStore {
  constructor({ bucket, region, client }) {
    if (!bucket) throw new Error('SITE_BUCKET is not set, so there is nowhere to publish to.');
    this.bucket = bucket;
    this.region = region;
    this.client = client ?? null;
    this.name = `s3://${bucket}`;
  }

  async #sdk() {
    if (!this.client) {
      const mod = await import('@aws-sdk/client-s3');
      this.sdk = mod;
      this.client = new mod.S3Client({ region: this.region });
    } else if (!this.sdk) {
      this.sdk = await import('@aws-sdk/client-s3');
    }
    return this.sdk;
  }

  /**
   * The published manifest carries the sha256 of every object we put there, so the usual
   * answer comes from one small object rather than from a HeadObject per file. This exists
   * for the case where the manifest is missing or disagrees.
   *
   * The sha256 is read from object metadata rather than from the ETag. An ETag is only an
   * MD5 for a single part upload and is documented as opaque otherwise, so treating it as a
   * content hash is the kind of assumption that holds until the day a file crosses the
   * multipart threshold.
   */
  async head(key) {
    assertPublishableKey(key);
    const sdk = await this.#sdk();
    try {
      const out = await this.client.send(new sdk.HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return {
        sha256: out.Metadata?.['content-sha256'] ?? null,
        bytes: out.ContentLength ?? null,
        contentType: out.ContentType ?? null,
        cacheControl: out.CacheControl ?? null,
        publishedAt: out.LastModified ? out.LastModified.toISOString() : null,
      };
    } catch (err) {
      if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') return null;
      throw err;
    }
  }

  async getText(key) {
    assertPublishableKey(key);
    const sdk = await this.#sdk();
    try {
      const out = await this.client.send(new sdk.GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return await out.Body.transformToString('utf8');
    } catch (err) {
      if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NoSuchKey') return null;
      throw err;
    }
  }

  async put({ key, body, contentType, cacheControl }) {
    assertPublishableObject({ key, body, contentType, cacheControl });
    const sdk = await this.#sdk();
    const digest = sha256(body);
    await this.client.send(
      new sdk.PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: cacheControl,
        Metadata: { 'content-sha256': digest },
      }),
    );
    return { sha256: digest, bytes: body.length, contentType, cacheControl, publishedAt: new Date().toISOString() };
  }
}

export class CloudFrontCdn {
  constructor({ distributionId, region, client }) {
    if (!distributionId) {
      throw new Error('CLOUDFRONT_DISTRIBUTION_ID is not set, so a publish could not be invalidated.');
    }
    this.distributionId = distributionId;
    this.region = region;
    this.client = client ?? null;
    this.name = `cloudfront:${distributionId}`;
  }

  async #sdk() {
    if (!this.client) {
      const mod = await import('@aws-sdk/client-cloudfront');
      this.sdk = mod;
      // CloudFront is a global service and its control plane lives in us-east-1.
      this.client = new mod.CloudFrontClient({ region: 'us-east-1' });
    } else if (!this.sdk) {
      this.sdk = await import('@aws-sdk/client-cloudfront');
    }
    return this.sdk;
  }

  async createInvalidation(paths) {
    assertInvalidationPaths(paths);
    const sdk = await this.#sdk();
    const out = await this.client.send(
      new sdk.CreateInvalidationCommand({
        DistributionId: this.distributionId,
        InvalidationBatch: {
          // The reference has to be unique per request. CloudFront returns the previous
          // invalidation if it is reused, which would look like success and clear nothing.
          CallerReference: `trevean-publish-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          Paths: { Quantity: paths.length, Items: [...paths] },
        },
      }),
    );
    return { invalidationId: out.Invalidation?.Id ?? null, paths: [...paths] };
  }

  async getInvalidation(invalidationId) {
    const sdk = await this.#sdk();
    const out = await this.client.send(
      new sdk.GetInvalidationCommand({ DistributionId: this.distributionId, Id: invalidationId }),
    );
    return { invalidationId, status: out.Invalidation?.Status ?? 'Unknown' };
  }
}
