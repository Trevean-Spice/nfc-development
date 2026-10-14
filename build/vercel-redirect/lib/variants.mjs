/**
 * The request paths each table row has to answer, enumerated rather than
 * pattern matched.
 *
 * The CloudFront Function normalised in code: it lowercased the code and
 * stripped trailing slashes before the lookup. Vercel's routing layer runs
 * before any compute, so there is no code to normalise in. Whatever
 * normalisation the redirect keeps has to be expressed as configuration.
 *
 * WHY LITERAL STRINGS RATHER THAN A PATTERN
 *
 * Vercel's `source` field is path-to-regexp, so `/:route(t|T)/:code(ps|PS|Ps|pS)`
 * would collapse the eight casing variants into one line. It is rejected here
 * for two reasons, in this order.
 *
 *   1. A path parameter that the destination does not consume is not obviously
 *      discarded. Next.js documents unused route parameters being appended to
 *      the destination as query parameters, and the one thing this redirect must
 *      never do is let anything from the request reach the destination. A source
 *      with no parameters in it cannot append a parameter.
 *   2. A literal source has exactly one meaning, so the router model in
 *      lib/router.mjs is an exact model rather than a re-implementation of
 *      path-to-regexp that would have to be trusted. That is what makes the test
 *      suite in this package worth as much as the one in build/edge, which runs
 *      the deployable artifact in a VM.
 *
 * The cost is 160 redirect entries instead of 20. They are generated, they are
 * never hand edited, and Vercel's ceiling is well above them.
 *
 * WHAT IS COVERED, AND WHAT THE PLATFORM COVERS
 *
 * Covered here, per code and per route: both casings of the route letter, all
 * four casings of the two letter code, each with and without a single trailing
 * slash. Sixteen paths per code per route.
 *
 * Not enumerated: repeated trailing slashes. Vercel collapses them itself. This
 * was measured against the client's own project on 25 August 2026:
 * `/blend.html//` and `/blend.html///` both answered 308 to `/blend.html/`,
 * which is a path this package serves. Enumerating `//` was dropped rather than
 * guessed at, because a `source` string containing a double slash is a construct
 * whose validation behaviour could not be confirmed without deploying, and a
 * vercel.json that fails validation takes the client's marketing site with it.
 *
 * Casing is enumerated rather than assumed, and that was measured too, on the
 * same project and the same day: `/Blend.html` answered 404 where `/blend.html`
 * answered 200. Vercel's router is case sensitive. Without these entries,
 * `/T/PS` would be a 404.
 */

/** Every casing permutation of a string. Mask 0 is all lowercase, so the canonical form comes first. */
export function casings(text) {
  const results = [];
  const seen = new Set();
  const total = 2 ** text.length;
  for (let mask = 0; mask < total; mask += 1) {
    let out = '';
    for (let index = 0; index < text.length; index += 1) {
      out += mask & (1 << index) ? text[index].toUpperCase() : text[index].toLowerCase();
    }
    if (!seen.has(out)) {
      seen.add(out);
      results.push(out);
    }
  }
  return results;
}

/** The trailing forms a request path may arrive in. The empty one is canonical. */
export const SUFFIXES = ['', '/'];

/**
 * Every request path that must resolve to one table row on one route.
 *
 * The first element is always the canonical form, `/t/ps`, which is the exact
 * string the 1,000 encoded tags carry and the only one that has to work for the
 * shipped inventory. Everything after it is the free insurance the redirect
 * specification asks for, per "M1 Deliverable 3", section 5, "Normalisation and
 * the unknown code".
 */
export function sourcesFor(routePrefix, code) {
  const prefixes = [routePrefix.toLowerCase(), routePrefix.toUpperCase()];
  const sources = [];
  const seen = new Set();
  for (const prefix of prefixes) {
    for (const cased of casings(code)) {
      for (const suffix of SUFFIXES) {
        const source = `/${prefix}/${cased}${suffix}`;
        if (seen.has(source)) continue;
        seen.add(source);
        sources.push(source);
      }
    }
  }
  return sources;
}

/** How many paths one row on one route generates. Asserted by the tests so a silent drop is caught. */
export function sourcesPerRow(code) {
  return 2 * casings(code).length * SUFFIXES.length;
}

/**
 * Characters that give a `source` meaning beyond an exact string match in
 * path-to-regexp. A source containing any of them is rejected at build time.
 */
const PATTERN_CHARACTERS = /[:*?+()[\]{}\\!|]/;

export function isLiteralSource(source) {
  return typeof source === 'string' && source.startsWith('/') && !PATTERN_CHARACTERS.test(source);
}
