/*
 * THE SEAM.
 *
 * Everything AWS specific in this package is behind these two interfaces and nothing else
 * imports an AWS SDK. That is what lets the whole publish path be exercised on a laptop with
 * expired credentials, which is the condition this project has been in for most of its life.
 *
 * The rule that makes the seam worth having, and it is a rule this project already learned
 * the expensive way: A LOCAL SERVER THAT IS MORE PERMISSIVE THAN PRODUCTION DOES NOT SAVE
 * TIME, IT CONVERTS A LOUD FAILURE INTO A SILENT ONE. The page once posted the measurement
 * harness's own record to a stand in that accepted any JSON, passed every local run, and
 * would have been rejected by the real API on every customer tap. See the Decision log, D28.
 *
 * So the constraints below are declared here, once, and asserted by BOTH implementations.
 * The stand in in local.mjs runs them itself; the AWS adapters run them before the call, so
 * a refusal is identical in shape and wording whichever end you are against.
 *
 * -- ObjectStore -----------------------------------------------------------------------
 *   head(key)                                   -> {sha256, bytes, cacheControl, contentType} or null
 *   put({key, body, contentType, cacheControl}) -> {sha256, bytes}
 *   getText(key)                                -> string or null
 *
 * -- Cdn -------------------------------------------------------------------------------
 *   createInvalidation(paths)                   -> {invalidationId, paths}
 *   getInvalidation(invalidationId)             -> {invalidationId, status}
 */

/** S3 object key limit. Bytes, not characters, and it is a hard AWS refusal. */
export const MAX_KEY_BYTES = 1024;

/**
 * CloudFront refuses more than 3,000 paths in one invalidation request. The publisher never
 * gets near it, and the check exists so that the day something loops and asks for ten
 * thousand, the refusal reads as a refusal rather than as an AWS error nobody can place.
 */
export const MAX_INVALIDATION_PATHS = 3000;

export class PublishRefused extends Error {
  constructor(message) {
    super(message);
    this.name = 'PublishRefused';
  }
}

function hasControlCharacter(value) {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Every rule the real thing enforces, plus the two this project enforces on top, applied
 * before a byte moves. The two extra ones are marked, because a stand in may be stricter
 * than production and must never be looser.
 */
export function assertPublishableKey(key) {
  if (typeof key !== 'string' || key === '') throw new PublishRefused('object key is empty.');
  if (key.startsWith('/')) throw new PublishRefused(`object key '${key}' starts with a slash. S3 keys do not.`);
  if (key.includes('//')) throw new PublishRefused(`object key '${key}' contains an empty path segment.`);
  if (key.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new PublishRefused(`object key '${key}' contains a relative path segment.`);
  }
  if (Buffer.byteLength(key, 'utf8') > MAX_KEY_BYTES) {
    throw new PublishRefused(`object key '${key}' is longer than the ${MAX_KEY_BYTES} byte S3 limit.`);
  }
  if (hasControlCharacter(key)) {
    throw new PublishRefused(`object key '${key}' contains a control character.`);
  }
}

export function assertPublishableObject({ key, body, contentType, cacheControl }) {
  assertPublishableKey(key);
  if (!Buffer.isBuffer(body)) throw new PublishRefused(`object '${key}' has no body buffer.`);

  // PROJECT RULE, stricter than S3. S3 will happily store an object with no Cache-Control
  // and no Content-Type, and CloudFront will then serve a blend page with whatever default
  // the distribution has. The deploy script that synced every object, HTML included, with a
  // one year max-age is the reason this is a refusal rather than a convention: a blend page
  // served with a one year browser max-age is uneditable on every handset that has ever
  // loaded it, for a year, with no server side fix, and it defeats the five minute
  // requirement completely. See the Architecture document, "Rendering".
  if (!contentType) throw new PublishRefused(`object '${key}' has no Content-Type. Refusing to guess.`);
  if (!cacheControl) throw new PublishRefused(`object '${key}' has no Cache-Control. Refusing to guess.`);
}

export function assertInvalidationPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new PublishRefused('an invalidation was requested with no paths.');
  }
  if (paths.length > MAX_INVALIDATION_PATHS) {
    throw new PublishRefused(
      `${paths.length} invalidation paths were requested and CloudFront accepts at most ${MAX_INVALIDATION_PATHS}.`,
    );
  }
  for (const path of paths) {
    if (typeof path !== 'string' || !path.startsWith('/')) {
      throw new PublishRefused(`invalidation path '${path}' does not begin with a slash.`);
    }
    // PROJECT RULE, stricter than CloudFront. CloudFront accepts /*; this publisher does
    // not. Invalidating the whole distribution on every publish is slow, it is billed per
    // path above the free allowance, and it throws away the cache that is the only thing
    // keeping the tap path off the origin.
    if (path === '/*' || path === '/**') {
      throw new PublishRefused(
        `invalidation path '${path}' would invalidate the whole distribution. The publisher ` +
          'invalidates exactly the objects whose bytes changed.',
      );
    }
    if (path.slice(0, -1).includes('*')) {
      throw new PublishRefused(`invalidation path '${path}' has a wildcard that is not at the end.`);
    }
  }
}
