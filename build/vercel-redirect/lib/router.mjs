/**
 * A model of the part of Vercel's routing layer this configuration uses.
 *
 * The edge package tests the bytes that ship, by evaluating dist/redirect.js in
 * an empty VM context. That is not available here: what ships is configuration,
 * and the thing that interprets it is Vercel's router, which is not something
 * that can be run locally without deploying.
 *
 * So the model is kept exact instead of complete. It implements one rule:
 *
 *   A redirect whose `source` is a literal path matches a request whose
 *   pathname is that exact string, and nothing else. Entries are evaluated in
 *   order and the first match wins. A match produces the declared status and a
 *   Location header equal to the declared destination. A request that matches
 *   nothing falls through to the filesystem, and a path that is not a file is a
 *   404 carrying the project's 404 page.
 *
 * That is a complete description of Vercel's behaviour for literal sources, and
 * the build refuses to emit a source that is not literal (lib/compile.mjs), so
 * there is no case this model quietly gets wrong. The moment somebody replaces
 * an enumerated casing list with `/:code(ps|PS)`, the build fails rather than
 * this model becoming a re-implementation nobody checked.
 *
 * TWO PLATFORM BEHAVIOURS THIS MODEL DELIBERATELY DOES NOT SIMULATE
 *
 *   1. Vercel appends the incoming query string to the redirect destination.
 *      Observed on a live Vercel declarative redirect on 25 August 2026. It is
 *      recorded in the README as the one guarantee that does not carry over from
 *      CloudFront, and it is checked against the real deployment by
 *      scripts/verify-live.mjs rather than asserted against a model.
 *   2. Vercel collapses repeated slashes with its own 308 before matching.
 *      Also measured, also checked live rather than modelled.
 *
 * Modelling either one would mean encoding a guess about someone else's router
 * into a passing test, which is worth less than nothing.
 */

/**
 * @param {{redirects: Array<{source: string, destination: string, statusCode: number}>}} config
 * @param {string} pathname the request path, query string excluded
 * @returns {{status: number, location?: string, matched?: object}}
 */
export function route(config, pathname) {
  for (const redirect of config.redirects) {
    if (redirect.source === pathname) {
      return { status: redirect.statusCode, location: redirect.destination, matched: redirect };
    }
  }
  return { status: 404 };
}

/** Convenience for the tests: the Location a path resolves to, or undefined. */
export function locationOf(config, pathname) {
  return route(config, pathname).location;
}
