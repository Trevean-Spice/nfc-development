/*
 * Queued content paths to objects, and objects to cache paths.
 *
 * These are two different mappings and conflating them is the defect this file exists to
 * prevent, so both are stated with their reasoning.
 *
 * -- Content path to object key --------------------------------------------------------
 *
 * build/api, services/revalidation.ts, queues these for a blend change:
 *
 *     /blend.html?blend={slug}      the URL the customer's address bar shows
 *     /blends/{slug}                the pre-rendered document, without its extension
 *     /sitemap.xml
 *
 * The first two are the same document seen from two ends. The origin is a bucket and a
 * bucket does not vary its answer by query string, so the document lives at
 * `blends/{slug}.html` and a CloudFront Function rewrites the request onto it.
 *
 * -- Object key to cache path ----------------------------------------------------------
 *
 * The rewrite runs at VIEWER REQUEST, which is before the cache lookup, so the cache key
 * carries the REWRITTEN uri. Invalidating `/blend.html` therefore does not clear the entry
 * a tap actually reads, which is stored under `/blends/{slug}.html`. This is the subtle one
 * and it is the reason the invalidation set is computed from object keys rather than from
 * the paths the API queued.
 *
 * `/blend.html` is still a real object: it is the branded "jar not recognised" document
 * served when no rewrite matched. It is invalidated when its own bytes change and not
 * otherwise.
 */

/** A blend change affects the blend's document, its media, and the sitemap. */
export function objectKeysForContentPath(contentPath) {
  const path = String(contentPath ?? '');

  const blendQuery = /^\/blend\.html\?blend=([a-z0-9-]+)$/.exec(path);
  if (blendQuery) return [`blends/${blendQuery[1]}.html`, `media/${blendQuery[1]}/`];

  const blendDoc = /^\/blends\/([a-z0-9-]+)$/.exec(path);
  if (blendDoc) return [`blends/${blendDoc[1]}.html`, `media/${blendDoc[1]}/`];

  const blendDocHtml = /^\/blends\/([a-z0-9-]+)\.html$/.exec(path);
  if (blendDocHtml) return [`blends/${blendDocHtml[1]}.html`, `media/${blendDocHtml[1]}/`];

  if (path === '/sitemap.xml') return ['sitemap.xml'];
  if (path === '/blend.html') return ['blend.html'];
  if (path === '/404.html') return ['404.html'];
  if (path === '/') return ['index.html'];

  // Anything else is taken literally, minus the leading slash, and is checked against the
  // rendered tree before it is published. An unrecognised path publishes nothing rather
  // than publishing everything, because the manual revalidate endpoint is an escape hatch
  // for an operator and a typo in it must not become a full site sync.
  return path.startsWith('/') ? [path.slice(1)] : [path];
}

/**
 * The selector set for a job: exact keys and directory prefixes.
 * A trailing slash means a prefix.
 */
export function selectorsFor(contentPaths) {
  const keys = new Set();
  const prefixes = new Set();
  for (const contentPath of contentPaths) {
    for (const selector of objectKeysForContentPath(contentPath)) {
      if (selector.endsWith('/')) prefixes.add(selector);
      else keys.add(selector);
    }
  }
  return { keys: [...keys].sort(), prefixes: [...prefixes].sort() };
}

export function selects(selectors, key) {
  if (selectors.keys.includes(key)) return true;
  return selectors.prefixes.some((prefix) => key.startsWith(prefix));
}

/**
 * Object key to the path CloudFront caches it under. Identity plus a leading slash.
 *
 * That is only true because every viewer request for a document arrives at, or is rewritten
 * to, the document's own path. If a second rewrite is ever added that does not hold, this
 * function is where it has to be reflected, and an invalidation computed anywhere else will
 * be quietly wrong.
 */
export function cachePathFor(objectKey) {
  return `/${objectKey}`;
}
