#!/usr/bin/env node
/*
 * The API, read at build and revalidate time, written out as a snapshot in the content
 * package's own shape.
 *
 * This is the step that makes "content editable end to end" true. Without it the build reads
 * the fixtures in build/content, an editor's change lands in DynamoDB and never reaches a
 * page, and every local run looks fine.
 *
 * WHAT IT READS. GET /v1/blends for the published set, then
 * GET /v1/blends/{slug}?include=grower,recipes for each one, plus GET /v1/catalog/{slug}.
 * All unauthenticated, all published only, which is what the frozen API contract, section 2,
 * says these operations are for. No admin credential is used and none is needed: every byte
 * these return is already public in the rendered page.
 *
 * WHAT IT DOES NOT DO, and this is the part that has to be said plainly.
 *
 * No response in the frozen contract carries a content readiness or placeholder flag, and
 * that is deliberate: several response schemas set additionalProperties false, so adding one
 * would put the API in breach of its own contract on the first contract test. See the
 * contract errata, E9, and build/admin's README, section 9, item 7.
 *
 * So the placeholder state on the snapshot is carried over from build/content, per slug, in
 * exactly the way build/admin does it. The consequence is worth stating rather than
 * discovering: WHEN REAL CONTENT LANDS IN THE DATABASE, build/content HAS TO BE UPDATED TO
 * MARK THOSE FIELDS REAL, or the page will keep rendering the hazard banner over content
 * that is no longer placeholder. That is the content package remaining the single source of
 * truth for what Trevean has actually supplied, which is the right answer, and it is a step
 * somebody has to remember. It is in the README next to this script.
 *
 * A blend with no readiness record in the content package is treated as placeholder. Failing
 * towards "this is not real" costs an unnecessary hazard banner. Failing the other way ships
 * a fabricated grower profile to a page that 1,000 encoded jars resolve to.
 *
 * READING THROUGH A CACHE, WHICH IS THE OTHER THING THIS SCRIPT HAS TO GET RIGHT.
 *
 * In a deployed environment the base URL is the apex distribution, and /v1 content reads are
 * cacheable at the edge by the frozen contract, section 7: public, max-age=60,
 * stale-while-revalidate=300. So a read taken here a couple of minutes after an edit can be
 * answered from the cache with the version from BEFORE the edit, and every downstream step,
 * including the publish pipeline's read back, would then compare stale against stale and
 * pass.
 *
 * So when TREVEAN_CONTENT_READ_TOKEN is set, every request carries it as the _uncached query
 * parameter. The apex distribution's api_content cache policy puts query strings in the cache
 * key, because on /v1 a query parameter selects the resource, so a value no cache has ever
 * seen cannot be a hit and cannot be inside stale-while-revalidate.
 *
 * THIS SCRIPT RECORDS EVIDENCE AND JUDGES NOTHING. Every response's cache related headers go
 * into snapshot.json next to the URL that produced them. build/publisher/src/content-read.mjs
 * decides what they mean and refuses the publish if any read cannot be shown to have come
 * from the origin. One definition of "this came from a cache", kept next to the argument for
 * why it matters, rather than two that drift.
 *
 * With no token set this behaves exactly as it did before: no parameter, no requirement, and
 * the evidence is written down anyway because it costs nothing.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = resolve(here, '..');
const PACKAGE_CONTENT_DIR = resolve(WEB_DIR, '..', 'content');
const SNAPSHOT_DIR = resolve(process.env.TREVEAN_CONTENT_SNAPSHOT ?? join(WEB_DIR, '.content-snapshot'));

const base = process.env.TREVEAN_CONTENT_API;
if (!base) {
  process.stderr.write(
    'TREVEAN_CONTENT_API is not set. Set it to the API base URL, for example http://127.0.0.1:3001\n',
  );
  process.exit(2);
}

/*
 * Kept byte identical with FRESHNESS_PARAM, TOKEN_ENV and EVIDENCE_HEADERS in
 * build/publisher/src/content-read.mjs, and test/content-read.test.mjs there asserts it,
 * because this package does not depend on that one and must not start to: build/web builds
 * on its own, and a developer running `npm run content:fetch` by hand has no publisher.
 */
const READ_TOKEN = process.env.TREVEAN_CONTENT_READ_TOKEN ?? '';
const FRESHNESS_PARAM = '_uncached';
const EVIDENCE_HEADERS = ['age', 'x-cache', 'cf-cache-status', 'cache-control', 'etag', 'date'];

/** Every read this script made, in order, with what the response said about caches. */
const reads = [];

/*
 * A counter, because the token alone is not enough and one render proved it.
 *
 * The token is minted once per render, so it makes a URL unique against every OTHER render
 * and not against this one. The first read of a given URL misses the edge cache and is
 * provably fresh. A REPEAT of that same URL inside the same render is then a perfectly
 * legitimate hit on a response that is seconds old, and the guard in
 * build/publisher/src/content-read.mjs cannot tell that apart from a hit on last week's
 * content: all it sees is `X-Cache: Hit from cloudfront`. So it refuses the publish.
 *
 * That is what "8 of 17 content reads could not be shown to have come from the origin" was on
 * the first Fargate render, Monday 7 September 2026. Seventeen reads across a list, five
 * blends, their growers and their catalog entries contain repeats by construction.
 *
 * Suffixing the counter makes every read its own cache key, so no read in a render can be
 * answered by another read in the same render. The assertion is unaffected: it checks that
 * the URL contains `_uncached=<token>`, and `_uncached=<token>.4` contains exactly that.
 *
 * THE GUARD IS NOT WEAKENED BY THIS. A cached response still fails, a missing token still
 * fails, and the token still has to be the one this render was given. What changes is that a
 * render no longer fails on its own freshness.
 */
let readSequence = 0;

async function getJson(path) {
  const parsed = new URL(path, base);
  if (READ_TOKEN) parsed.searchParams.set(FRESHNESS_PARAM, `${READ_TOKEN}.${readSequence++}`);
  const url = parsed.toString();

  const res = await fetch(url, { headers: { accept: 'application/json' } });

  const evidence = {};
  for (const name of EVIDENCE_HEADERS) {
    const value = res.headers.get(name);
    if (value !== null) evidence[name] = value;
  }
  reads.push({ url, status: res.status, evidence });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${url} returned HTTP ${res.status}`);
  return res.json();
}

function readPackageJson(relativePath) {
  const file = join(PACKAGE_CONTENT_DIR, relativePath);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

const UNVERIFIED = (entity, slug) => ({
  isPlaceholder: true,
  sentinel: '[PLACEHOLDER]',
  reason:
    `The content package holds no readiness record for the ${entity} of '${slug}', so nothing on ` +
    'it can be confirmed as real content supplied by Trevean. Treated as placeholder, because ' +
    'failing towards "this is not real" costs a banner and failing the other way ships a ' +
    'fabricated claim about a real supply chain.',
  fields: {},
});

function write(relativePath, document) {
  const file = join(SNAPSHOT_DIR, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
}

const list = await getJson('/v1/blends');
const summaries = list?.data ?? [];
if (summaries.length === 0) throw new Error(`GET ${base}/v1/blends returned no published blends.`);

if (existsSync(SNAPSHOT_DIR)) rmSync(SNAPSHOT_DIR, { recursive: true, force: true });

const taken = [];

for (const summary of summaries) {
  const slug = summary.slug;
  const blend = await getJson(`/v1/blends/${slug}?include=grower,recipes`);
  if (!blend) throw new Error(`GET /v1/blends/${slug} returned 404 for a blend the list had just returned.`);

  const packageBlend = readPackageJson(join('fixtures', 'blends', `${slug}.json`));
  const packageGrower = readPackageJson(join('fixtures', 'growers', `${slug}.json`));
  const packageRecipes = readPackageJson(join('fixtures', 'recipes', `${slug}.json`));

  write(join('fixtures', 'blends', `${slug}.json`), {
    _source: {
      api: base,
      operation: `GET /v1/blends/${slug}?include=grower,recipes`,
      version: blend.version ?? null,
      updatedAt: blend.updatedAt ?? null,
      takenAt: new Date().toISOString(),
    },
    _placeholder: packageBlend?._placeholder ?? UNVERIFIED('blend', slug),
    _clientFacts: packageBlend?._clientFacts ?? {},
    blend: {
      slug: blend.slug,
      name: blend.name,
      status: blend.status,
      tagline: blend.tagline ?? null,
      originCountry: blend.originCountry ?? null,
      originRegion: blend.originRegion ?? null,
      originCity: blend.originCity ?? null,
      launchTier: blend.launchTier ?? null,
      tagCode: blend.tagCode ?? null,
      farm: blend.farm ?? null,
      storyBlocks: blend.storyBlocks ?? [],
      /*
       * The page resolves media through its own media index, which is built from the masters
       * in the content package. The API hands back a reference; the id is the join.
       *
       * THE FALLBACK IS NOT TIDINESS AND IT IS NOT INVENTING ANYTHING. The API returns
       * heroImage: null for a media item that is not `ready`, has no alt text or has no
       * dimensions, which is correct: a half populated reference is layout shift. Today it
       * returns null for every blend, because the media pipeline needs an S3 bucket and there
       * is none. Taking that at face value would drop the hero slot out of the rendered page
       * entirely, and a collapsed slot makes the page smaller than the delivered page, which
       * turns the above the fold measurement and the byte budget into lies and would have to
       * be re-measured on the day the photography lands.
       *
       * So the content package's own placeholder master is used when the API has nothing
       * ready. It is a placeholder image, it renders inside the placeholder contract, and the
       * page keeps the shape it will have when the real photograph arrives. The API's value
       * always wins when it exists.
       */
      heroImageId: blend.heroImage?.mediaId ?? packageBlend?.blend?.heroImageId ?? null,
      galleryImageIds: (blend.gallery ?? []).map((m) => m.mediaId),
      freshness: blend.freshness ?? {},
      growerId: blend.growerId ?? null,
      shopify: blend.shopify ?? {},
    },
  });

  const grower = blend.grower ?? null;
  write(join('fixtures', 'growers', `${slug}.json`), {
    _placeholder: packageGrower?._placeholder ?? UNVERIFIED('grower', slug),
    grower: grower
      ? {
          growerId: grower.growerId,
          name: grower.name,
          farmName: grower.farmName ?? null,
          country: grower.country ?? null,
          region: grower.region ?? null,
          bio: grower.bio ?? null,
          yearsFarming: grower.yearsFarming ?? null,
          // Same reasoning as the hero, above: the portrait slot must occupy the space the
          // real portrait will, rather than collapsing.
          portraitId: grower.portrait?.mediaId ?? packageGrower?.grower?.portraitId ?? null,
          farm: grower.farm ?? null,
        }
      : // A blend with no grower renders the pending slot at the size the real value will
        // occupy, rather than collapsing it, which is the content package's own rule.
        { growerId: null, name: null, farmName: null, country: null, region: null, bio: null, yearsFarming: null, portraitId: null, farm: null },
  });

  write(join('fixtures', 'recipes', `${slug}.json`), {
    _placeholder: packageRecipes?._placeholder ?? UNVERIFIED('recipe', slug),
    recipes: (blend.recipes ?? []).map((recipe) => ({
      recipe: {
        recipeId: recipe.recipeId,
        blendSlug: recipe.blendSlug,
        title: recipe.title,
        summary: recipe.summary ?? null,
        servings: recipe.servings ?? null,
        prepMinutes: recipe.prepMinutes ?? null,
        cookMinutes: recipe.cookMinutes ?? null,
        difficulty: recipe.difficulty ?? null,
        ingredients: recipe.ingredients ?? [],
        steps: recipe.steps ?? [],
        imageId: recipe.image?.mediaId ?? null,
        sortOrder: recipe.sortOrder ?? 0,
        status: recipe.status,
      },
    })),
  });

  const catalog = await getJson(`/v1/catalog/${slug}`);
  const packageCatalog = readPackageJson(join('fixtures', 'catalog', `${slug}.json`));
  write(join('fixtures', 'catalog', `${slug}.json`), {
    _placeholder: packageCatalog?._placeholder ?? UNVERIFIED('catalog', slug),
    catalog: catalog ?? packageCatalog?.catalog ?? {},
  });

  taken.push({ slug, version: blend.version ?? null, status: blend.status });
}

write('snapshot.json', {
  api: base,
  takenAt: new Date().toISOString(),
  /*
   * One token per render, not per request, so a snapshot left behind by an earlier render is
   * distinguishable from one this render took. build/web's loadContent renders whatever
   * snapshot is on disk whenever TREVEAN_CONTENT_API is set, so that distinction is load
   * bearing rather than tidy.
   */
  readToken: READ_TOKEN || null,
  reads,
  blends: taken,
  note:
    'Placeholder state is carried from build/content, because no response in the frozen contract ' +
    'carries a readiness flag. Update build/content when real content lands, or the page will ' +
    'keep rendering the hazard banner over content that is no longer placeholder.',
});

process.stdout.write(
  `content snapshot written to ${SNAPSHOT_DIR}\n` +
    taken.map((b) => `  ${b.slug} v${b.version} ${b.status}`).join('\n') +
    '\n',
);
