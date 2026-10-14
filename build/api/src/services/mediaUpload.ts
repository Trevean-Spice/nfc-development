import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config/env.js';
import { logger } from '../observability/logger.js';

/**
 * Presigned upload, step 1 of 3.
 *
 * A large photograph never passes through an application function. Premium brand
 * photography plus a function mediated upload is a timeout and a memory limit waiting to
 * happen, and it puts image bytes on a code path that has to stay fast for other reasons.
 * The browser PUTs directly to S3 and then calls the complete operation.
 *
 * ContentLength is part of the signature, so the declared size is enforced by S3 itself
 * rather than by a check the browser could skip.
 */

let s3: S3Client | undefined;

export function s3Client(): S3Client {
  if (!s3) {
    s3 = new S3Client({
      region: config.region,
      ...(config.media.s3Endpoint ? { endpoint: config.media.s3Endpoint, forcePathStyle: config.media.forcePathStyle } : {}),
      ...(config.stage === 'local'
        ? { credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'local', secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'local' } }
        : {}),
    });
  }
  return s3;
}

export function storageKeyFor(mediaId: string): string {
  return `incoming/${mediaId}`;
}

export function cdnUrlFor(mediaId: string, filename: string): string {
  const base = config.media.cdnBaseUrl.replace(/\/$/, '');
  return `${base}/media/${mediaId}/${filename}`;
}

export interface UploadTicket {
  mediaId: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  maxBytes: number;
  expiresAt: string;
}

export async function presignUpload(input: {
  mediaId: string;
  contentType: string;
  bytes: number;
}): Promise<UploadTicket> {
  const command = new PutObjectCommand({
    Bucket: config.media.bucket,
    Key: storageKeyFor(input.mediaId),
    ContentType: input.contentType,
    ContentLength: input.bytes,
  });
  const uploadUrl = await getSignedUrl(s3Client(), command, { expiresIn: config.media.presignExpirySeconds });
  return {
    mediaId: input.mediaId,
    uploadUrl,
    method: 'PUT',
    headers: { 'Content-Type': input.contentType },
    maxBytes: config.media.maxBytes,
    // Real clock on purpose, not the injectable one from util/clock.ts. This value has to
    // describe when the presigned URL above actually stops working, and that expiry is
    // computed by the AWS signer from real time. Reporting a pinned time here would hand
    // the caller a number that does not match the URL it was issued with.
    expiresAt: new Date(Date.now() + config.media.presignExpirySeconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
}

export interface UploadedObject {
  bytes: number | null;
  verified: boolean;
}

/**
 * Step 3 of 3 verification. Returns verified false when the object is genuinely absent.
 *
 * Local development has no S3 at all, so the check is skipped rather than failing every
 * upload on a developer machine. That skip is stage gated here, in code, so it cannot be
 * turned on in staging or production by an environment variable.
 */
export async function headUploadedObject(mediaId: string): Promise<UploadedObject> {
  if (config.stage === 'local' && !config.media.s3Endpoint) {
    logger.debug('skipping S3 verification, local stage with no S3 endpoint', { mediaId });
    return { bytes: null, verified: true };
  }
  try {
    const out = await s3Client().send(
      new HeadObjectCommand({ Bucket: config.media.bucket, Key: storageKeyFor(mediaId) }),
    );
    return { bytes: out.ContentLength ?? null, verified: true };
  } catch {
    return { bytes: null, verified: false };
  }
}
