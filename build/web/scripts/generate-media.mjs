#!/usr/bin/env node
/**
 * Derivative generation.
 *
 * This is the build-time half of the media pipeline the Architecture document
 * describes: a master lands once, derivatives are generated asynchronously into
 * responsive modern formats, and no image is ever optimised on the request path.
 * Here the masters are files rather than S3 objects, and the derivatives go into
 * public/media, but the shape is the same and the byte rules are identical.
 *
 * Masters come from the content package at build/content, which registers every
 * asset in media/manifest.json with its dimensions, its byte budget and its alt
 * text. Those masters are PNG, deliberately, because they are generated with no
 * native codec so they are reproducible anywhere. The wire format is not PNG:
 * the budget fixes AVIF primary with a WebP fallback through <picture>, srcset
 * at 640 / 900 / 1280, explicit width and height, fetchpriority high on the
 * hero, decoding async, never loading lazy on the hero.
 *
 * If the content package is not present, synthetic placeholders are generated
 * instead so the page still builds. That path says so loudly.
 *
 * The hero cap is 90 KB on the largest variant and it is fixed. The photograph
 * is chosen to fit it, not the other way round (budget section 4.3), so this
 * script searches downward through encoder quality until the largest hero
 * variant fits and reports the quality it had to use. If even the floor does
 * not fit, it fails rather than shipping an over-budget hero.
 */

import sharp from 'sharp';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(root, 'public', 'media');
const contentDir = resolve(root, '..', 'content');

/** Per-page byte and speed budget, section 4.1: hero 90 KB, largest variant. */
const HERO_CAP_BYTES = 92160;

/* Quality search bounds. The lower bound is where photographic AVIF starts to
   show visible softening on detailed texture; the upper bound is where extra
   bytes stop buying anything a customer can see on a phone at arm's length. */
const QUALITY_FLOOR = 24;
const QUALITY_CEILING = 80;

/**
 * Variant widths per slot. A derivative is never wider than its master: an
 * upscale is bytes spent on invented detail.
 */
const SLOTS = {
  hero: { base: 'hero', widths: [640, 900, 1280], cap: HERO_CAP_BYTES },
  grower_portrait: { base: 'grower', widths: [320, 640], cap: null },
  farm_map: { base: 'map', widths: [320, 640, 900], cap: null },
  recipe: { base: 'recipe', widths: [300, 600], cap: null },
};

const BLENDS = [
  { slug: 'persian-sunrise', tint: '#b4531f', wash: '#f2c14b' },
  { slug: 'caribbean-sunset', tint: '#9c2b1f', wash: '#e8703a' },
  { slug: 'silk-road', tint: '#6b5320', wash: '#d8b45c' },
  { slug: 'north-african-night-market', tint: '#5a3a52', wash: '#c98a6b' },
  { slug: 'kyoto-garden', tint: '#2f5140', wash: '#a8c08c' },
];

/* ------------------------------------------------------------- encoding -- */

const avifAt = (input, width, height, quality) =>
  sharp(input, { density: 200 }).resize(width, height).avif({ quality, effort: 6 }).toBuffer();
const webpAt = (input, width, height, quality) =>
  sharp(input, { density: 200 }).resize(width, height).webp({ quality }).toBuffer();

/**
 * The highest quality that still fits the cap, found by bisection.
 *
 * Searching upward rather than downward matters. The budget says the byte cap
 * is fixed and the image is chosen to fit it, so an image should spend its
 * allowance rather than come in far under and make the measurement flattering.
 * If the source is easy to compress the search simply stops at the ceiling and
 * the file is whatever it is.
 */
async function bestFitting(encoder, input, width, height, cap) {
  if (!cap) {
    const buffer = await encoder(input, width, height, QUALITY_CEILING - 20);
    return { buffer, quality: QUALITY_CEILING - 20 };
  }

  let low = QUALITY_FLOOR;
  let high = QUALITY_CEILING;
  let best = null;

  const floorBuffer = await encoder(input, width, height, QUALITY_FLOOR);
  if (floorBuffer.length > cap) {
    throw new Error(
      `${width} px variant is ${floorBuffer.length} bytes even at quality ${QUALITY_FLOOR}, over the ${cap} byte cap. ` +
        'The cap is fixed and the image is chosen to fit it. See the budget document, section 4.3.',
    );
  }
  best = { buffer: floorBuffer, quality: QUALITY_FLOOR };

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const buffer = await encoder(input, width, height, mid);
    if (buffer.length <= cap) {
      best = { buffer, quality: mid };
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

async function encode(input, { width, height, cap, quality }) {
  const avif = quality
    ? { buffer: await avifAt(input, width, height, quality), quality }
    : await bestFitting(avifAt, input, width, height, cap);
  const webp = cap
    ? await bestFitting(webpAt, input, width, height, cap)
    : { buffer: await webpAt(input, width, height, quality || 72), quality: quality || 72 };
  return { avif, webp };
}

async function writeVariants({ input, dir, base, widths, ratio, cap, masterWidth }) {
  mkdirSync(dir, { recursive: true });
  const written = [];
  const usable = widths.filter((w) => !masterWidth || w <= masterWidth);
  if (usable.length === 0) usable.push(Math.min(widths[0], masterWidth));

  // The largest variant sets the quality, because it is the one the cap is
  // written against. The smaller variants reuse it so the set looks consistent
  // and so a small screen is never served a visibly worse crop than a large one.
  const largest = usable[usable.length - 1];
  const chosen = await encode(input, {
    width: largest,
    height: Math.round(largest / ratio),
    cap,
    quality: null,
  });

  for (const width of usable) {
    const height = Math.round(width / ratio);
    const encoded =
      width === largest
        ? chosen
        : await encode(input, { width, height, cap: null, quality: chosen.avif.quality });
    for (const format of ['avif', 'webp']) {
      const file = join(dir, `${base}-${width}.${format}`);
      writeFileSync(file, encoded[format].buffer);
      written.push({
        file: `${base}-${width}.${format}`,
        bytes: encoded[format].buffer.length,
        width,
        height,
        quality: encoded[format].quality ?? null,
      });
    }
  }
  return written;
}

/* ------------------------------------------------- synthetic placeholders -- */

function stripes(id, colour) {
  return `<pattern id="${id}" width="56" height="56" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
    <rect width="56" height="56" fill="none"/>
    <rect width="28" height="56" fill="${colour}" opacity="0.22"/>
  </pattern>`;
}

function placeholderSvg({ width, height, tint, wash, title, subtitle, note }) {
  const titleSize = Math.round(width / 11);
  const subSize = Math.round(width / 30);
  const noteSize = Math.round(width / 40);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${wash}"/><stop offset="1" stop-color="${tint}"/>
    </linearGradient>
    ${stripes('s', '#1a1410')}
  </defs>
  <rect width="${width}" height="${height}" fill="url(#g)"/>
  <rect width="${width}" height="${height}" fill="url(#s)"/>
  <rect x="${width * 0.04}" y="${height * 0.06}" width="${width * 0.92}" height="${height * 0.88}"
        fill="none" stroke="#1a1410" stroke-width="${Math.max(2, width / 200)}"
        stroke-dasharray="${width / 40} ${width / 60}" opacity="0.75"/>
  <text x="50%" y="${height * 0.47}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
        font-size="${titleSize}" font-weight="bold" fill="#1a1410">${title}</text>
  <text x="50%" y="${height * 0.605}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
        font-size="${subSize}" font-weight="bold" fill="#1a1410" opacity="0.85">${subtitle}</text>
  <text x="50%" y="${height * 0.7}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
        font-size="${noteSize}" fill="#1a1410" opacity="0.7">${note}</text>
</svg>`;
}

async function synthetic() {
  console.log('Content package not found at build/content. Generating synthetic placeholders.');
  console.log('These are a fallback so the page still builds. The content package is the source of truth.');
  const written = [];
  for (const blend of BLENDS) {
    const dir = join(outDir, blend.slug);
    written.push(
      ...(await writeVariants({
        input: Buffer.from(
          placeholderSvg({
            width: 1280,
            height: 955,
            tint: blend.tint,
            wash: blend.wash,
            title: 'PLACEHOLDER',
            subtitle: 'HERO PHOTOGRAPHY NOT SUPPLIED',
            note: blend.slug,
          }),
        ),
        dir,
        base: 'hero',
        widths: SLOTS.hero.widths,
        ratio: 1280 / 955,
        cap: HERO_CAP_BYTES,
        masterWidth: 1280,
      })),
    );
    written.push(
      ...(await writeVariants({
        input: Buffer.from(
          placeholderSvg({
            width: 640,
            height: 640,
            tint: '#4a4038',
            wash: '#c9bdaa',
            title: 'PLACEHOLDER',
            subtitle: 'GROWER PHOTOGRAPH',
            note: 'NOT SUPPLIED',
          }),
        ),
        dir,
        base: 'grower',
        widths: SLOTS.grower_portrait.widths,
        ratio: 1,
        cap: null,
        masterWidth: 640,
      })),
    );
    written.push(
      ...(await writeVariants({
        input: Buffer.from(
          placeholderSvg({
            width: 640,
            height: 400,
            tint: '#33503f',
            wash: '#bcc9ae',
            title: 'PLACEHOLDER',
            subtitle: 'STATIC FARM MAP',
            note: 'COORDINATES NOT SUPPLIED',
          }),
        ),
        dir,
        base: 'map',
        widths: SLOTS.farm_map.widths,
        ratio: 1.6,
        cap: null,
        masterWidth: 640,
      })),
    );
  }
  return { written, source: 'synthetic placeholders generated by this script' };
}

/* ----------------------------------------------- derivatives from masters -- */

async function fromContentPackage() {
  const manifestFile = join(contentDir, 'media', 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const written = [];
  const index = {};
  const recipeCounter = {};

  for (const asset of manifest.assets) {
    const slot = SLOTS[asset.kind];
    if (!slot) continue;
    const master = join(contentDir, asset.localPath);
    if (!existsSync(master)) {
      throw new Error(`Master missing for ${asset.mediaId}: ${master}`);
    }
    const dir = join(outDir, asset.blendSlug);
    const ratio = asset.width / asset.height;
    // Several recipe assets share one slot name inside a blend, so they are
    // numbered in manifest order. The media id stays the lookup key, so a
    // reordered manifest changes filenames but never mismatches an image to a
    // recipe.
    let base = slot.base;
    if (asset.kind === 'recipe') {
      recipeCounter[asset.blendSlug] = (recipeCounter[asset.blendSlug] || 0) + 1;
      base = `recipe-${String(recipeCounter[asset.blendSlug]).padStart(2, '0')}`;
    }

    const variants = await writeVariants({
      input: readFileSync(master),
      dir,
      base,
      widths: slot.widths,
      ratio,
      cap: slot.cap,
      masterWidth: asset.width,
    });
    written.push(...variants);

    const widths = [...new Set(variants.map((v) => v.width))].sort((a, b) => a - b);
    index[asset.mediaId] = {
      mediaId: asset.mediaId,
      kind: asset.kind,
      blendSlug: asset.blendSlug,
      alt: asset.alt,
      placeholder: asset.placeholder === true,
      masterBytes: asset.bytes,
      intrinsicWidth: asset.width,
      intrinsicHeight: asset.height,
      largestWidth: widths[widths.length - 1],
      largestHeight: Math.round(widths[widths.length - 1] / ratio),
      fallbackSrc: `/media/${asset.blendSlug}/${base}-${widths[Math.max(0, widths.length - 2)]}.webp`,
      sources: [
        { type: 'image/avif', srcset: widths.map((w) => `/media/${asset.blendSlug}/${base}-${w}.avif ${w}w`).join(', ') },
        { type: 'image/webp', srcset: widths.map((w) => `/media/${asset.blendSlug}/${base}-${w}.webp ${w}w`).join(', ') },
      ],
    };
  }

  writeFileSync(join(root, 'src', 'content', 'media-index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  return { written, source: `content package masters (${manifestFile})` };
}

/* -------------------------------------------------------------------- run -- */

/*
 * Every derivative this script would write, already written and still there.
 *
 * WHY THIS EXISTS, and it is worth the paragraph because the number is absurd. This script
 * opened by deleting its own output directory and re-encoding all 122 derivatives from the
 * masters, and AVIF at effort 6 is one of the most expensive encodes in common use. On the
 * deployed two vCPU Fargate task, measured Monday 7 September 2026 from the task log:
 *
 *   generate-media.mjs   731,905 ms
 *   next build              22,000 ms
 *   publish to S3            1,984 ms
 *
 * So 97 percent of a 12.7 minute publish was this script re-encoding images that had not
 * changed, against a contractual requirement of 5 minutes for the whole job. The container
 * image already carries every one of those files from its own build, and the first act of
 * every render was to delete them.
 *
 * The guard is deliberately conservative: it skips only when the index AND every file that
 * index references are present. A missing or partial set falls through to the full rebuild,
 * so the failure mode is the old slow behaviour rather than a page with no images.
 *
 * TREVEAN_MEDIA_FORCE=1 forces the rebuild, which is what to use when a master changes.
 * Masters live in the content package and change when Trevean supplies real photography, so
 * that is a content event with a human attached rather than something to detect here.
 */
function derivativesAlreadyPresent() {
  if (process.env.TREVEAN_MEDIA_FORCE === '1') return false;
  const indexFile = join(root, 'src', 'content', 'media-index.json');
  if (!existsSync(indexFile)) return false;

  let index;
  try {
    index = JSON.parse(readFileSync(indexFile, 'utf8'));
  } catch {
    return false;
  }

  const referenced = new Set();
  for (const entry of Object.values(index ?? {})) {
    if (entry?.fallbackSrc) referenced.add(entry.fallbackSrc);
    for (const source of entry?.sources ?? []) {
      for (const candidate of String(source.srcset ?? '').split(',')) {
        const path = candidate.trim().split(/\s+/)[0];
        if (path) referenced.add(path);
      }
    }
  }
  if (referenced.size === 0) return false;

  for (const path of referenced) {
    if (!existsSync(join(root, 'public', path.replace(/^\//, '')))) return false;
  }
  return true;
}

async function main() {
  if (derivativesAlreadyPresent()) {
    process.stdout.write(
      'Media derivatives are already present and complete, so nothing was re-encoded. ' +
        'Set TREVEAN_MEDIA_FORCE=1 to rebuild them.\n',
    );
    return;
  }

  rmSync(outDir, { recursive: true, force: true });
  const usePackage = existsSync(join(contentDir, 'media', 'manifest.json'));
  const { written, source } = usePackage ? await fromContentPackage() : await synthetic();

  const total = written.reduce((n, w) => n + w.bytes, 0);

  // Install icons for the web app manifest. A mark, not a photograph, so these
  // are not placeholder content and carry no placeholder treatment.
  const iconsDir = join(root, 'public', 'icons');
  mkdirSync(iconsDir, { recursive: true });
  const mark = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
      <rect width="512" height="512" rx="112" fill="#1d1611"/>
      <path d="M144 336c48-144 176-144 224 0" stroke="#b5651d" stroke-width="48" fill="none" stroke-linecap="round"/>
      <circle cx="256" cy="176" r="26" fill="#f2c14b"/>
    </svg>`,
  );
  for (const size of [192, 512]) {
    const png = await sharp(mark, { density: 300 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
    writeFileSync(join(iconsDir, `icon-${size}.png`), png);
  }

  console.log(`Derivatives from ${source}`);
  console.log(`${written.length} files, ${(total / 1024).toFixed(1)} KB total.`);
  console.log('');
  console.log('Largest hero variant per blend, against the 90.0 KB cap:');
  for (const w of written.filter((x) => x.file === 'hero-1280.avif')) {
    console.log(`  hero-1280.avif  ${(w.bytes / 1024).toFixed(1)} KB  AVIF quality ${w.quality}`);
  }
  console.log('');
  console.log('Real photography replaces these masters and must fit the same cap.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
