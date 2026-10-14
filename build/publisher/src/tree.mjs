/*
 * The rendered tree, and the two cache headers.
 *
 * The headers are not invented here. They are the ones build/web already serves in
 * scripts/serve.mjs and the ones the M1 deliverable "Redirect-Serving Decision and Apex
 * Domain Routing", section 5, specifies:
 *
 *   documents  public, max-age=60, s-maxage=31536000, stale-while-revalidate=86400
 *   everything else  public, max-age=31536000, immutable
 *
 * Short in the browser, long at the CDN, invalidated on publish. That combination is what
 * makes a five minute content update possible at all: a long browser max-age on a document
 * is uneditable on every handset that has ever loaded it, for as long as the max-age says,
 * with no server side fix.
 *
 * They are asserted by a test against serve.mjs, so the stand in edge and the published
 * objects cannot drift apart.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, posix, relative } from 'node:path';

export const DOCUMENT_CACHE_CONTROL = 'public, max-age=60, s-maxage=31536000, stale-while-revalidate=86400';
export const ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/**
 * A document for caching purposes is anything a customer navigates to. Those are the objects
 * whose bytes change on a publish and whose browser cache has to be short.
 */
export function isDocument(key) {
  const ext = extname(key).toLowerCase();
  return ext === '.html' || ext === '.xml' || key === 'sw.js';
}

export function contentTypeFor(key) {
  const ext = extname(key).toLowerCase();
  const type = TYPES[ext];
  if (!type) {
    // Refusing to guess is deliberate. An object published as application/octet-stream is
    // downloaded rather than rendered, and it is not obvious from any dashboard.
    throw new Error(
      `no Content-Type is registered for '${key}'. Add it to tree.mjs rather than letting the ` +
        'publisher guess, because a blend page served as octet-stream downloads instead of rendering.',
    );
  }
  return type;
}

export function cacheControlFor(key) {
  // sw.js is an asset by extension and a document by behaviour. A service worker script
  // cached immutably in a browser is a service worker that can never be replaced, which is
  // the same uneditable failure as a long lived HTML max-age wearing a different extension.
  return isDocument(key) ? DOCUMENT_CACHE_CONTROL : ASSET_CACHE_CONTROL;
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Every file under the render directory, as forward slashed object keys. */
export function walk(root) {
  const out = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) out.push(posix.join(...relative(root, full).split(/[\\/]/)));
    }
  };
  visit(root);
  return out.sort();
}

export function readObject(root, key) {
  const file = join(root, ...key.split('/'));
  const body = readFileSync(file);
  return {
    key,
    body,
    bytes: body.length,
    sha256: sha256(body),
    contentType: contentTypeFor(key),
    cacheControl: cacheControlFor(key),
    modifiedAt: statSync(file).mtime.toISOString(),
  };
}
