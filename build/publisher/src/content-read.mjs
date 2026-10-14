/*
 * HOW THE RENDER READS THE API. The last open correctness question in the publish path,
 * settled Friday 4 September 2026.
 *
 * ---------------------------------------------------------------------------------------
 * THE FAILURE THIS CLOSES, STATED BEFORE THE ANSWER
 *
 * The renderer has to read blend content from the API to render a page. Content reads on
 * /v1 are cacheable at the edge by the frozen contract, section 7: `public, max-age=60,
 * stale-while-revalidate=300`, and the cdn module's api_content policy honours it. So a
 * render that reads through the apex distribution can be handed a response cached BEFORE
 * the edit it was dispatched to publish. It renders that, publishes it, reads it back, and
 * the digests match, because stale was compared against stale. The pipeline reports success
 * and the page shows the old content.
 *
 * Coalescing makes that MORE likely rather than less. A render is about 200 seconds, so the
 * second publish in an editing session reads a cache entry roughly 200 seconds old: past
 * max-age, inside stale-while-revalidate, which is precisely when a cache serves stale
 * content while it refreshes.
 *
 * A STRONGER READ BACK DOES NOT CLOSE IT. Step 9 compares the published document against
 * what the renderer produced. If the renderer read stale content the comparison is stale
 * against stale and it passes. The fix has to be at the READ.
 *
 * ---------------------------------------------------------------------------------------
 * THE ANSWER: THE RENDERER READS THROUGH THE APEX DISTRIBUTION LIKE ANY OTHER /v1 CLIENT,
 * WITH A PER RENDER CACHE BUSTER, AND EVERY RESPONSE IS PROVED TO HAVE COME FROM THE ORIGIN.
 *
 * Two halves and both are needed.
 *
 *   BUST. Every read the render makes carries `_uncached={token}`, where the token is
 *   generated once per render. The cdn module's api_content cache policy sets
 *   query_string_behavior = "all" on BOTH the cache key and the origin request policy,
 *   because on /v1 a query parameter selects the resource. A query string CloudFront has
 *   never seen cannot be a cache hit, and an entry that has never existed cannot be served
 *   stale-while-revalidate. That is a property of a policy in this repository rather than
 *   an assumption about CDN behaviour, and modules/cdn is where it is written down.
 *
 *   PROVE. The render records, per request, the URL it fetched and the cache evidence the
 *   response carried. Before the build runs and before a byte moves, this module asserts
 *   that every read carried THIS render's token and that no response was claimed by a cache.
 *   If the buster is ever defeated, by a policy change, by a proxy nobody knew about, by a
 *   base URL pointed somewhere else, the publish FAILS AND SAYS WHY instead of publishing
 *   the previous version and reporting success.
 *
 * The second half is the part that matters for handover. The first half is correct today
 * and depends on a Terraform policy staying the way it is; the second half notices the day
 * it stops being true. A pipeline that reports success on stale content is worse than one
 * that fails.
 *
 * ---------------------------------------------------------------------------------------
 * WHAT WAS REJECTED, AND WHY
 *
 *   READ THE API ORIGIN DIRECTLY, bypassing the distribution. In a deployed environment the
 *   API's only front door is a Lambda function URL with authorization_type AWS_IAM whose
 *   resource policy admits exactly one principal, cloudfront.amazonaws.com, scoped to the
 *   apex distribution. Reading it directly means a second aws_lambda_permission and
 *   lambda:InvokeFunctionUrl on the renderer's role, which widens the one role this project
 *   deliberately did not widen, and it means SigV4 signing inside the read. The read lives
 *   in build/web/scripts/fetch-content.mjs, so that drags an AWS SDK and a credential into
 *   build/web, a package that today has neither, and breaks the rule that src/store/aws.mjs
 *   is the only file in this pipeline that knows AWS exists. It also puts the heaviest /v1
 *   caller outside the rate limiting the frozen contract, section 9, places at the edge.
 *   And it cannot be exercised on a laptop at all: there is no stand in for SigV4 against a
 *   function URL, so the one path that decides whether an editor's words reach a page would
 *   be the one path that is never run before it runs in production.
 *
 *   A SECOND DISTRIBUTION FOR THE RENDERER WITH CACHING DISABLED. Correct, and it costs a
 *   Terraform cycle that is real rather than theoretical. This module's revalidate_url
 *   feeds REVALIDATION_WEBHOOK_URL on admin_api, and admin_api and content_api are the same
 *   pooled for_each resource node in modules/compute. A renderer distribution needs
 *   content_api's function URL and a lambda permission scoped to itself, so the pipeline
 *   would be upstream and downstream of the same node. Breaking it means splitting
 *   content_api out of the pool with another `moved` block, in the week M3 is due, on eight
 *   functions whose plan has never been read. Set that aside and it is still a second
 *   public front door onto /v1 with caching deliberately switched off: every request through
 *   it is an origin hit on the content function, unauthenticated, created to serve one
 *   caller that makes about a dozen requests a day. The thing that protects /v1 today is the
 *   edge cache, and this option's whole purpose is to remove it.
 *
 *   A CACHE BUSTING HEADER RATHER THAN A PARAMETER. Rejected on determinism. The
 *   api_content cache policy sets header_behavior = "none", so no request header is in the
 *   cache key or forwarded, and whether CloudFront honours a viewer `Cache-Control:
 *   no-cache` is a question about CloudFront's behaviour rather than about a policy written
 *   in this repository. confirmLive in publish.mjs sends that header on the read back and it
 *   is a hint there, not a guarantee. On the one read that decides whether an editor's words
 *   reach a customer, a hint is not enough. The parameter is in the cache key by a line
 *   somebody can read.
 *
 *   READ DYNAMODB DIRECTLY. The fastest, and the one to think hardest about, because the
 *   renderer's role can already read the content tables so nothing stops it. It is rejected
 *   because it stops the renderer being a client of the contract, and the cost of that is
 *   not visible on day one.
 *
 *   The API's read is not a table scan. It filters to status published for an
 *   unauthenticated caller, resolves ?include=grower,recipes, drops draft recipes, hydrates
 *   media through getManyMedia, applies the mappers in build/api's services/mappers.ts, and
 *   returns heroImage null unless the media item is ready and has alt text and dimensions,
 *   which build/web's fetch-content.mjs explicitly depends on. Reading the tables means
 *   reimplementing all of it here, which is a SECOND DEFINITION OF WHAT A BLEND PAGE IS
 *   MADE OF. This package already refuses a second definition once, in render.mjs, and runs
 *   build/web's own build rather than a template of its own, for exactly this reason.
 *
 *   The drift would be invisible in the worst direction. The contract tests exercise the
 *   API. The admin previews through the API. Only the page a customer reads would come from
 *   somewhere else, and the read back would match, because it always compares the page to
 *   what the renderer produced. That is the same shape of failure as the one this file
 *   exists to close, moved one step further from anything that would notice it.
 *
 *   And it makes the frozen contract stop being the interface. Every other component here
 *   is a /v1 client. The moment the publish pipeline is not, "the contract is the interface"
 *   becomes "the contract is the interface except for the one component that decides what
 *   customers see", and the next data model change lands in two places instead of one, with
 *   nothing failing when it only lands in the first.
 *
 * ---------------------------------------------------------------------------------------
 * NOTHING IN THIS FILE TOUCHES AWS, AND THAT IS PART OF THE ARGUMENT.
 *
 * No SDK import, no new IAM permission, no new AWS resource, no change to src/store. The
 * seam in src/store/types.mjs is exactly where it was. The whole fix is exercised on a
 * laptop with expired credentials by test/content-read.test.mjs, which stands up a cache
 * that serves stale content and runs the real read against it.
 *
 * The tap path is untouched. This changes what the renderer asks for; it does not add a
 * behaviour, a header or a cache key to the apex distribution, and no customer request goes
 * anywhere near it.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The query parameter every read the renderer makes carries.
 *
 * Underscore prefixed so it cannot be mistaken for one of the contract's own parameters,
 * which are include, status, limit and cursor. The API ignores it: build/api's content
 * routes register no querystring schema and read only named parameters, so an extra one is
 * neither validated nor echoed. The contract is not modified and the renderer stays a client
 * of it like any other.
 */
export const FRESHNESS_PARAM = '_uncached';

/** How the token reaches the read, which runs as a child process in build/web. */
export const TOKEN_ENV = 'TREVEAN_CONTENT_READ_TOKEN';

/**
 * Response headers the read records. Recording rather than judging is deliberate: build/web
 * writes down what it saw, this package decides what it means, so there is one definition of
 * "this came from a cache" and it lives next to the argument for why that matters.
 */
export const EVIDENCE_HEADERS = ['age', 'x-cache', 'cf-cache-status', 'cache-control', 'etag', 'date'];

/**
 * A read that a cache claimed, or that cannot be shown not to have been. Never caught and
 * turned into a warning anywhere in this package: it fails the publish before the guard, the
 * diff, the put or the invalidation, so the previous version keeps serving.
 */
export class StaleContentRead extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'StaleContentRead';
    this.detail = detail ?? null;
  }
}

/**
 * One token per render, never per request. Per request would still be correct against the
 * cache and would make the assertion below unable to tell a fresh render from a snapshot
 * left behind by a previous one, which is a real failure: build/web's loadContent renders
 * whatever snapshot is on disk whenever TREVEAN_CONTENT_API is set.
 */
export function newReadToken(now = Date.now(), random = randomBytes) {
  return `${now.toString(36)}${random(8).toString('hex')}`;
}

/** Append the buster to a URL a read is about to make. Exported so the test uses the real one. */
export function bustCache(url, token) {
  if (!token) return url;
  const parsed = new URL(url);
  parsed.searchParams.set(FRESHNESS_PARAM, token);
  return parsed.toString();
}

const CACHED_CF_STATUS = new Set(['hit', 'stale', 'revalidated', 'updating', 'expired']);

/**
 * Did a cache serve this, on the evidence the response carried.
 *
 * Three signals, and any one of them is enough:
 *
 *   Age above zero. A response an intermediary has been holding. This is the signal that
 *   catches the exact failure: an entry inside stale-while-revalidate is served with an Age
 *   larger than its max-age.
 *   X-Cache containing 'hit'. CloudFront answers 'Miss from cloudfront' on an origin fetch
 *   and 'Hit from cloudfront' or 'RefreshHit from cloudfront' otherwise.
 *   CF-Cache-Status, for any other CDN somebody puts in front of this later.
 *
 * Absence of all three is treated as fresh, which is the right answer for a read straight at
 * a process on a laptop, where none of these headers exists.
 */
export function judgeCacheEvidence(evidence = {}) {
  const headers = {};
  for (const [name, value] of Object.entries(evidence ?? {})) {
    if (value !== null && value !== undefined) headers[String(name).toLowerCase()] = String(value);
  }

  const age = Number.parseInt(headers.age ?? '', 10);
  if (Number.isFinite(age) && age > 0) {
    return { cached: true, why: `the response carried Age: ${age}, so a cache had been holding it for ${age} seconds` };
  }

  const xCache = (headers['x-cache'] ?? '').toLowerCase();
  if (xCache.includes('hit')) {
    return { cached: true, why: `the response carried X-Cache: ${headers['x-cache']}` };
  }

  const cfStatus = (headers['cf-cache-status'] ?? '').toLowerCase();
  if (CACHED_CF_STATUS.has(cfStatus)) {
    return { cached: true, why: `the response carried CF-Cache-Status: ${headers['cf-cache-status']}` };
  }

  return { cached: false, why: null };
}

function snapshotFile(snapshotDir) {
  return join(snapshotDir, 'snapshot.json');
}

/**
 * The assertion, run after the content fetch and BEFORE the build, so a stale read costs a
 * refusal rather than 200 seconds of rendering followed by a refusal.
 *
 * @param {object} options
 * @param {string} options.snapshotDir  where build/web wrote the snapshot
 * @param {string} options.baseUrl      the API the render was configured to read
 * @param {string} options.token        the token this render generated
 * @returns {{reads: number, api: string, token: string, note: string}}
 */
export function assertFreshContentRead({ snapshotDir, baseUrl, token }) {
  const file = snapshotFile(snapshotDir);
  if (!existsSync(file)) {
    throw new StaleContentRead(
      `the render recorded no content read at ${file}, so there is no evidence the API was read at all.`,
      'Nothing was published. build/web/scripts/fetch-content.mjs writes this file, and a build ' +
        'that renders without it renders whatever snapshot happened to be on disk.',
    );
  }

  let snapshot;
  try {
    snapshot = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new StaleContentRead(`the content read record at ${file} could not be parsed: ${err.message}.`, null);
  }

  if (snapshot.api !== baseUrl) {
    throw new StaleContentRead(
      `the render read '${snapshot.api}' and this publish was configured to read '${baseUrl}'.`,
      'A snapshot taken from a different API is not evidence about this one. Nothing was published.',
    );
  }

  if (snapshot.readToken !== token) {
    throw new StaleContentRead(
      'the content snapshot was not taken by this render.',
      `Expected the read token '${token}' and found '${snapshot.readToken ?? 'none'}'. Either the ` +
        'content fetch did not run, or an older snapshot is still on disk and the build would ' +
        'have rendered it as though the API had just been read.',
    );
  }

  const reads = Array.isArray(snapshot.reads) ? snapshot.reads : [];
  if (reads.length === 0) {
    throw new StaleContentRead(
      'the content snapshot records no individual reads, so no response can be shown to have come from the origin.',
      'Nothing was published.',
    );
  }

  const problems = [];
  for (const read of reads) {
    const url = typeof read?.url === 'string' ? read.url : '(no url recorded)';

    if (!String(url).includes(`${FRESHNESS_PARAM}=${token}`)) {
      problems.push(`${url} did not carry ${FRESHNESS_PARAM}=${token}, so a cache entry could have answered it`);
      continue;
    }

    const verdict = judgeCacheEvidence(read?.evidence);
    if (verdict.cached) problems.push(`${url} was served from a cache: ${verdict.why}`);
  }

  if (problems.length > 0) {
    throw new StaleContentRead(
      `${problems.length} of ${reads.length} content reads could not be shown to have come from the origin, ` +
        'so the render may have been handed the version from before the edit it was dispatched to publish.',
      problems.join('\n') +
        '\n\nNothing was published and the previous version is still serving. The cache buster is ' +
        `the ${FRESHNESS_PARAM} query parameter, and it works because the cdn module's api_content ` +
        'cache policy puts query strings in the cache key. If that policy has changed, or if ' +
        'something other than the apex distribution is now in front of the API, this is the ' +
        'message that says so rather than a page that quietly shows last week\'s words.',
    );
  }

  return {
    reads: reads.length,
    api: snapshot.api,
    token,
    note:
      `${reads.length} content reads, every one carrying ${FRESHNESS_PARAM}=${token} and every one ` +
      'answered by the origin rather than by a cache.',
  };
}
