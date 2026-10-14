/*
 * Content loading, at build and revalidate time only.
 *
 * This module runs inside getStaticProps. It never runs in a browser and it
 * never runs on the request path. Frozen API contract, section 2: an engineer
 * who wires the blend page to fetch /v1/blends/{slug} on load produces a page
 * that works perfectly in development and fails in a customer's kitchen on the
 * first tap of the morning.
 *
 * Three sources, in order:
 *
 *   1. TREVEAN_CONTENT_API   the real API, at build and revalidate time. WIRED,
 *                            and in two steps rather than one. scripts/fetch-content.mjs
 *                            reads GET /v1/blends and GET /v1/blends/{slug}
 *                            ?include=grower,recipes and writes a snapshot in the
 *                            content package's own shape; this module then reads
 *                            the snapshot through the adapter below.
 *
 *                            Two steps rather than one because getStaticProps
 *                            calls loadContent synchronously and there is no
 *                            synchronous fetch, and because a render that is a
 *                            pure function of a file on disk is reproducible and
 *                            diffable. The snapshot is the exact input to the
 *                            build, so "why did the page change" is answerable
 *                            without re-querying a database that has moved on.
 *
 *                            If the variable is set and no snapshot exists, this
 *                            throws with the command to run rather than falling
 *                            through to the fixtures, because falling through
 *                            would publish the fixtures under the belief that
 *                            the API had been read.
 *   2. build/content         the content package: fixtures for blends, growers,
 *                            recipes and the catalog mirror, plus a media
 *                            manifest. This is the source of truth today.
 *   3. src/content/fallback  fixtures that ship with this package, so a checkout
 *                            without the content package still builds.
 *
 * The content package speaks the storage shape (storyBlocks, growerId, media
 * ids, a catalog mirror record). The page speaks a render shape. The adapter
 * between them lives here, in one place, so that when the API is wired the only
 * thing that changes is where the storage shape comes from.
 *
 * One rule the adapter never breaks: it invents nothing. A null in the fixture
 * stays null and reaches the page as a pending slot, because a slot that
 * collapses makes the page smaller than the real one and turns the above the
 * fold measurement into a lie.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mediaIndexJson from './media-index.json';
import type { Blend, ContentBundle, FreshnessStep, Recipe, ResponsiveImage } from './types';

const here = dirname(fileURLToPath(import.meta.url));

/** build/web/src/content -> build/content */
const PACKAGE_CONTENT_DIR = resolve(here, '..', '..', '..', 'content');

/** build/web/src/content -> build/web/.content-snapshot */
const SNAPSHOT_DIR = resolve(
  process.env.TREVEAN_CONTENT_SNAPSHOT ?? resolve(here, '..', '..', '.content-snapshot'),
);

const FALLBACK_DIR = join(here, 'fallback');

/**
 * The directory the adapter reads. The snapshot and the content package are the same shape
 * on purpose: one adapter, one definition of how storage becomes a page, whichever source
 * the bytes came from.
 */
let CONTENT_DIR = PACKAGE_CONTENT_DIR;

interface MediaEntry {
  mediaId: string;
  kind: string;
  blendSlug: string;
  alt: string;
  placeholder: boolean;
  intrinsicWidth: number;
  intrinsicHeight: number;
  largestWidth: number;
  largestHeight: number;
  fallbackSrc: string;
  sources: { type: string; srcset: string }[];
}

const mediaIndex = mediaIndexJson as unknown as Record<string, MediaEntry>;

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/* ------------------------------------------------------------------ media -- */

function imageFor(mediaId: string | null, sizes: string, fallbackAlt: string): ResponsiveImage {
  const entry = mediaId ? mediaIndex[mediaId] : undefined;
  if (!entry) {
    // No master registered. Rather than render a broken image or silently drop
    // the slot, hand back an empty image the page renders as a pending slot.
    return { src: '', alt: fallbackAlt, width: 0, height: 0, sizes, sources: [] };
  }
  return {
    src: entry.fallbackSrc,
    alt: entry.alt,
    width: entry.largestWidth,
    height: entry.largestHeight,
    sizes,
    sources: entry.sources,
  };
}

function mediaOfKind(blendSlug: string, kind: string): string | null {
  for (const entry of Object.values(mediaIndex)) {
    if (entry.blendSlug === blendSlug && entry.kind === kind) return entry.mediaId;
  }
  return null;
}

/* ---------------------------------------------------- the content package -- */

const SIZES = {
  hero: '100vw',
  grower: '(min-width:400px) 104px, 88px',
  map: '(min-width:672px) 608px, calc(100vw - 32px)',
  recipe: '(min-width:672px) 280px, 78vw',
};

interface PackageBlendFile {
  _placeholder?: { isPlaceholder?: boolean; sentinel?: string; reason?: string };
  _clientFacts?: { spices?: string[]; originAsStatedByClient?: string };
  blend: Record<string, any>;
}

function capitalise(text: string): string {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}

function freshnessSteps(freshness: Record<string, any>): FreshnessStep[] {
  const steps: [string, string, string][] = [
    ['harvestedOn', 'Harvested', 'From the lot record for this batch.'],
    ['blendedOn', 'Milled and blended', 'From the lot record for this batch.'],
    ['bestBefore', 'At its best until', 'Derived from the blend date and the shelf life.'],
  ];
  return steps.map(([field, label, detail], i) => ({
    label,
    date: (freshness?.[field] as string | null) ?? null,
    displayDate: 'Date not supplied',
    state: freshness?.[field] ? (i === steps.length - 1 ? 'upcoming' : 'done') : 'upcoming',
    detail,
  }));
}

function adaptRecipes(blendSlug: string, file: any): Recipe[] {
  const entries: any[] = Array.isArray(file?.recipes) ? file.recipes : [];
  return entries
    .map((wrapper) => wrapper.recipe ?? wrapper)
    .filter((r) => r && r.status !== 'archived')
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((r) => {
      const prep = typeof r.prepMinutes === 'number' ? r.prepMinutes : null;
      const cook = typeof r.cookMinutes === 'number' ? r.cookMinutes : null;
      const total = prep === null && cook === null ? null : (prep ?? 0) + (cook ?? 0);
      return {
        recipeId: r.recipeId,
        title: r.title,
        summary: r.summary,
        timeMinutes: total,
        difficulty: typeof r.difficulty === 'string' ? r.difficulty : null,
        servings: typeof r.servings === 'number' ? r.servings : null,
        image: imageFor(r.imageId ?? null, SIZES.recipe, 'Recipe photograph not supplied'),
        url: null,
      };
    });
}

function adaptPackageBlend(slug: string): Blend | null {
  const blendFile = join(CONTENT_DIR, 'fixtures', 'blends', `${slug}.json`);
  if (!existsSync(blendFile)) return null;

  const file = readJson<PackageBlendFile>(blendFile);
  const blend = file.blend;
  const facts = file._clientFacts ?? {};
  const sentinel = file._placeholder?.sentinel ?? null;

  const grower = readJson<any>(join(CONTENT_DIR, 'fixtures', 'growers', `${slug}.json`)).grower;
  const catalog = readJson<any>(join(CONTENT_DIR, 'fixtures', 'catalog', `${slug}.json`)).catalog;
  const recipesFile = existsSync(join(CONTENT_DIR, 'fixtures', 'recipes', `${slug}.json`))
    ? readJson<any>(join(CONTENT_DIR, 'fixtures', 'recipes', `${slug}.json`))
    : { recipes: [] };

  const storyBlocks: any[] = Array.isArray(blend.storyBlocks) ? blend.storyBlocks : [];
  const heading = storyBlocks.find((b) => b.type === 'heading')?.text ?? `Where ${blend.name} comes from`;
  const paragraphs = storyBlocks.filter((b) => b.type === 'paragraph').map((b) => b.text as string);

  // originAsStatedByClient is deliberately NOT read here, and it used to be,
  // ahead of everything else. It is a record of the client's words, kept so a
  // copywriter can see them in one place, and rendering it walks straight past
  // the provenance markers on the structured fields below. That is the exact
  // route by which "Isfahan, Iran" reached the masthead of a blend that
  // contains no Iranian ingredient, and it would have survived those fields
  // being nulled. The structured fields are the only render source.
  // See "Decision log", D29 and D39.
  const region =
    [blend.originCity, blend.originRegion, blend.originCountry].filter(Boolean).join(', ') || null;

  const growerLocation = [grower.region, grower.country].filter(Boolean).join(', ') || null;

  const latitude = typeof blend.farm?.latitude === 'number' ? blend.farm.latitude : null;
  const longitude = typeof blend.farm?.longitude === 'number' ? blend.farm.longitude : null;

  return {
    slug: blend.slug,
    name: blend.name,
    status: blend.status,
    placeholder: file._placeholder?.isPlaceholder === true,
    placeholderNote: file._placeholder?.reason ?? null,
    sentinel,
    tagline: blend.tagline ?? '',
    originRegion: region,
    keyNotes: (facts.spices ?? []).map(capitalise),
    hero: imageFor(blend.heroImageId ?? null, SIZES.hero, 'Hero photograph not supplied'),
    originStory: {
      heading,
      lede: paragraphs[0] ?? '',
      paragraphs: paragraphs.slice(1),
    },
    grower: {
      growerId: grower.growerId,
      name: grower.name,
      role: grower.farmName ?? null,
      location: growerLocation,
      bio: grower.bio,
      yearsFarming: typeof grower.yearsFarming === 'number' ? grower.yearsFarming : null,
      photo: imageFor(grower.portraitId ?? null, SIZES.grower, 'Grower photograph not supplied'),
      farm: {
        label: grower.farmName ?? null,
        latitude,
        longitude,
        staticMap: imageFor(mediaOfKind(slug, 'farm_map'), SIZES.map, 'Farm map not supplied'),
        // Only built once real coordinates exist. A link to a map of nowhere is
        // worse than no link.
        mapLinkUrl:
          latitude !== null && longitude !== null
            ? `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=12/${latitude}/${longitude}`
            : null,
      },
    },
    freshness: {
      lotCode: blend.freshness?.lotLabel ?? null,
      note: blend.freshness?.note ?? null,
      steps: freshnessSteps(blend.freshness ?? {}),
    },
    recipes: adaptRecipes(slug, recipesFile),
    commerce: {
      cartPermalink: catalog?.cartPermalinkUrl ?? blend.shopify?.cartPermalinkUrl ?? null,
      price:
        catalog?.price && typeof catalog.price.amount === 'number'
          ? { amount: catalog.price.amount, currency: catalog.price.currency ?? 'USD' }
          : null,
      available: typeof catalog?.available === 'boolean' ? catalog.available : null,
      inventoryStatus: catalog?.inventoryStatus ?? null,
      sku: catalog?.sku ?? null,
    },
  };
}

function loadFromPackage(): Blend[] {
  const dir = join(CONTENT_DIR, 'fixtures', 'blends');
  if (!existsSync(dir)) return [];
  const blends: Blend[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const adapted = adaptPackageBlend(name.replace(/\.json$/, ''));
    if (adapted) blends.push(adapted);
  }
  return blends;
}

/* ------------------------------------------------------------- fallback -- */

function loadFallback(): Blend[] {
  const dir = join(FALLBACK_DIR, 'blends');
  if (!existsSync(dir)) return [];
  const blends: Blend[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      blends.push(readJson<Blend>(join(dir, name)));
    } catch {
      /* a malformed fallback fixture is skipped rather than failing the build */
    }
  }
  return blends;
}

/* ------------------------------------------------------------------- api -- */

let cached: ContentBundle | null = null;

export function loadContent(): ContentBundle {
  if (cached) return cached;

  if (process.env.TREVEAN_CONTENT_API) {
    if (!existsSync(join(SNAPSHOT_DIR, 'fixtures', 'blends'))) {
      throw new Error(
        `TREVEAN_CONTENT_API is set to ${process.env.TREVEAN_CONTENT_API} but no content snapshot ` +
          `exists at ${SNAPSHOT_DIR}. Run 'npm run content:fetch' first, which reads the API at ` +
          'build and revalidate time and writes the snapshot this module renders from. Refusing to ' +
          'fall through to the fixtures, because that would publish fixture copy under the belief ' +
          'that the API had been read.',
      );
    }
    CONTENT_DIR = SNAPSHOT_DIR;
  }

  let blends = loadFromPackage();
  let sourceLabel =
    CONTENT_DIR === SNAPSHOT_DIR
      ? `API snapshot (${CONTENT_DIR}) taken from ${process.env.TREVEAN_CONTENT_API}`
      : `content package (${CONTENT_DIR})`;

  if (blends.length === 0) {
    blends = loadFallback();
    sourceLabel = 'built-in fallback fixtures (src/content/fallback)';
  }

  if (blends.length === 0) {
    throw new Error('No blend content found in any source. The build cannot continue.');
  }

  blends.sort((a, b) => a.slug.localeCompare(b.slug));
  cached = { sourceLabel, blends };
  return cached;
}

export function listPublishedBlends(): Blend[] {
  return loadContent().blends.filter((b) => b.status === 'published');
}

export function getBlend(slug: string): Blend | null {
  return listPublishedBlends().find((b) => b.slug === slug) ?? null;
}
