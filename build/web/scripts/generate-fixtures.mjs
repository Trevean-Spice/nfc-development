#!/usr/bin/env node
/**
 * Placeholder content fixtures.
 *
 * Real content for the two launch blends has not arrived. This writes fixtures
 * that are STRUCTURALLY COMPLETE (every field the page renders is present, at
 * roughly the length the delivered copy needs to be) and VISIBLY PLACEHOLDER
 * (every invented string starts with the word PLACEHOLDER).
 *
 * The rule this enforces: no grower name, no farm location, no origin story and
 * no lot date is invented and presented as real. Two categories of field are
 * genuinely known and are used as such, with the source named:
 *
 *   blend name, region of origin, key notes
 *       Scope document, "The five blends". These are facts already in the
 *       knowledge base, not inventions.
 *   slug, tag code
 *       Scope document, "Tag code map".
 *
 * Everything else is filler and says so on screen.
 *
 * If build/content exists and holds blend bundles, those win and these are never
 * read. See src/content/load.ts.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'src', 'content', 'fallback', 'blends');

const PLACEHOLDER_NOTE =
  'No name, story, location, date or price on this page is real.';

const LEDE =
  'PLACEHOLDER ORIGIN STORY. This opening paragraph is filler set at the length the delivered ' +
  'copy needs to be, so that the layout can be tested against the requirement that the origin ' +
  'story is readable without scrolling. It describes no real farm, no real family and no real ' +
  'harvest, and it must be replaced before this page is shown to a customer.';

const PARAGRAPHS = [
  'PLACEHOLDER PARAGRAPH TWO. Filler at the length a second paragraph of the delivered story is ' +
    'expected to run to, so the page can be measured, reviewed and signed off on shape before the ' +
    'words exist. Replace it with the supplied copy.',
  'PLACEHOLDER PARAGRAPH THREE. Filler at the length a closing paragraph is expected to run to. ' +
    'It exists so that the type scale, the measure and the scroll depth of the finished page can ' +
    'be judged now rather than on the day the copy arrives.',
];

const GROWER_BIO =
  'PLACEHOLDER GROWER BIOGRAPHY. Filler at roughly the length of the delivered biography. No real ' +
  'person is described here. The grower name, role, farm and photograph are all outstanding from ' +
  'the client and must be supplied before release.';

const RECIPE_SUMMARY =
  'PLACEHOLDER RECIPE SUMMARY. Two lines of filler standing in for the delivered summary, so the ' +
  'carousel card can be sized and tested before the recipes exist.';

/** Facts from the Scope document, "The five blends" and "Tag code map". */
const BLENDS = [
  {
    slug: 'persian-sunrise',
    name: 'Persian Sunrise',
    tagCode: 'ps',
    originRegion: 'Isfahan, Iran',
    keyNotes: ['Saffron', 'Cardamom', 'Rose petals', 'Lime'],
    launch: true,
  },
  {
    slug: 'caribbean-sunset',
    name: 'Caribbean Sunset',
    tagCode: 'cs',
    originRegion: 'Trinidad and Tobago',
    keyNotes: ['Scotch bonnet', 'Allspice', 'Thyme'],
    launch: true,
  },
  {
    slug: 'north-african-night-market',
    name: 'North African Night Market',
    tagCode: 'nm',
    originRegion: 'Fez, Morocco',
    keyNotes: ['Aleppo pepper', 'Cumin', 'Preserved lemon'],
    launch: false,
  },
  {
    slug: 'silk-road',
    name: 'The Silk Road',
    tagCode: 'sr',
    originRegion: 'Central Asia',
    keyNotes: ['Cumin', 'Coriander', 'Fenugreek', 'Turmeric'],
    launch: false,
  },
  {
    slug: 'kyoto-garden',
    name: 'Kyoto Garden',
    tagCode: 'kg',
    originRegion: 'Kyoto, Japan',
    keyNotes: ['Sesame', 'Nori', 'Yuzu', 'Green tea'],
    launch: false,
  },
];

const RECIPE_TITLES = [
  'PLACEHOLDER RECIPE ONE',
  'PLACEHOLDER RECIPE TWO',
  'PLACEHOLDER RECIPE THREE',
  'PLACEHOLDER RECIPE FOUR',
  'PLACEHOLDER RECIPE FIVE',
  'PLACEHOLDER RECIPE SIX',
];

function srcset(slug, base, widths, ext) {
  return widths.map((w) => `/media/${slug}/${base}-${w}.${ext} ${w}w`).join(', ');
}

function build(blend) {
  const { slug } = blend;
  return {
    slug,
    name: blend.name,
    status: 'published',
    placeholder: true,
    placeholderNote: PLACEHOLDER_NOTE,
    tagline: 'PLACEHOLDER TAGLINE, one line, supplied by the client',
    originRegion: blend.originRegion,
    keyNotes: blend.keyNotes,
    hero: {
      src: `/media/${slug}/hero-900.webp`,
      alt: `Placeholder graphic standing in for the ${blend.name} hero photograph, which has not been supplied`,
      width: 1280,
      height: 955,
      sizes: '100vw',
      sources: [
        { type: 'image/avif', srcset: srcset(slug, 'hero', [640, 900, 1280], 'avif') },
        { type: 'image/webp', srcset: srcset(slug, 'hero', [640, 900, 1280], 'webp') },
      ],
    },
    originStory: {
      heading: `Where ${blend.name} comes from`,
      lede: LEDE,
      paragraphs: PARAGRAPHS,
    },
    grower: {
      growerId: `placeholder-grower-${slug}`,
      name: 'PLACEHOLDER GROWER NAME',
      role: 'PLACEHOLDER ROLE',
      location: 'PLACEHOLDER FARM LOCATION',
      bio: GROWER_BIO,
      photo: {
        src: `/media/${slug}/grower-320.webp`,
        alt: 'Placeholder graphic standing in for the grower photograph, which has not been supplied',
        width: 640,
        height: 640,
        sizes: '(min-width:400px) 104px, 88px',
        sources: [
          { type: 'image/avif', srcset: srcset(slug, 'grower', [320, 640], 'avif') },
          { type: 'image/webp', srcset: srcset(slug, 'grower', [320, 640], 'webp') },
        ],
      },
      farm: {
        label: 'PLACEHOLDER FARM NAME',
        latitude: null,
        longitude: null,
        staticMap: {
          src: `/media/${slug}/map-640.webp`,
          alt: 'Placeholder graphic standing in for the static farm map. Coordinates have not been supplied',
          width: 900,
          height: 506,
          sizes: '(min-width:672px) 608px, calc(100vw - 32px)',
          sources: [
            { type: 'image/avif', srcset: srcset(slug, 'map', [640, 900], 'avif') },
            { type: 'image/webp', srcset: srcset(slug, 'map', [640, 900], 'webp') },
          ],
        },
        mapLinkUrl: null,
      },
    },
    freshness: {
      lotCode: 'PLACEHOLDER-LOT-CODE',
      shelfLifeDays: null,
      steps: [
        {
          label: 'Harvested',
          date: null,
          displayDate: 'DATE NOT SUPPLIED',
          state: 'done',
          detail: 'PLACEHOLDER. The harvest window comes from the lot record.',
        },
        {
          label: 'Milled and blended',
          date: null,
          displayDate: 'DATE NOT SUPPLIED',
          state: 'done',
          detail: 'PLACEHOLDER. Milling date comes from the lot record.',
        },
        {
          label: 'Packed into this jar',
          date: null,
          displayDate: 'DATE NOT SUPPLIED',
          state: 'current',
          detail: 'PLACEHOLDER. Pack date comes from the lot record.',
        },
        {
          label: 'At its best until',
          date: null,
          displayDate: 'DATE NOT SUPPLIED',
          state: 'upcoming',
          detail: 'PLACEHOLDER. Derived from the pack date and the shelf life.',
        },
      ],
    },
    recipes: RECIPE_TITLES.map((title, i) => ({
      recipeId: `placeholder-recipe-${slug}-${i + 1}`,
      title,
      summary: RECIPE_SUMMARY,
      timeMinutes: null,
      difficulty: 'PLACEHOLDER',
      url: null,
    })),
    commerce: {
      cartPermalink: null,
      price: null,
      available: null,
      variantLabel: 'PLACEHOLDER SIZE',
    },
  };
}

mkdirSync(outDir, { recursive: true });
for (const blend of BLENDS) {
  const file = join(outDir, `${blend.slug}.json`);
  writeFileSync(file, `${JSON.stringify(build(blend), null, 2)}\n`, 'utf8');
  console.log(`wrote ${blend.slug}.json  (tag code /t/${blend.tagCode})`);
}
console.log('');
console.log('All five fixtures carry placeholder: true. The release guard in');
console.log('scripts/verify-output.mjs refuses to pass a release build while that is so.');
