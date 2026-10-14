#!/usr/bin/env node
/**
 * Generate the placeholder imagery.
 *
 * The point of this script, stated once so nobody optimises it away:
 *
 *   A performance budget validated against a 5 KB grey rectangle proves nothing.
 *   Every image produced here is EXACTLY the dimensions and EXACTLY the byte weight
 *   the M1 performance budget allows for its slot, so a page built and measured
 *   against these placeholders is measured against the weight real photography will
 *   carry. When the real photographs land, nothing about the page weight changes.
 *
 * Every image is also stamped, in type large enough to read on a phone, as a
 * placeholder. It cannot be mistaken for photography by anyone who looks at it.
 *
 * Node standard library only. Deterministic: same bytes on every machine.
 *
 * Usage:
 *   node tools/generate-placeholder-images.mjs
 *   node tools/generate-placeholder-images.mjs --check    (regenerate and fail on drift)
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  createCanvas, cloneCanvas, fillRect, strokeRect, diagonalStripes,
  drawText, drawTextCentred, textWidth, encodePng, addNoise,
} from './lib/png.mjs';
import { loadAllFixtures, ROOT } from './lib/fixtures.mjs';

const OUT_DIR = path.join(ROOT, 'media', 'placeholder');
const MANIFEST = path.join(ROOT, 'media', 'manifest.json');
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'content-field-spec.json'), 'utf8'));
const KINDS = SPEC.imageSpecification.kinds;

const INK = [0x1a, 0x18, 0x16];
const PAPER = [0xf2, 0xef, 0xe9];
const HAZARD = [0xff, 0x00, 0x8c];
const PLATE = [0xff, 0xff, 0xff];

const args = new Set(process.argv.slice(2));
const CHECK_ONLY = args.has('--check');

/* ------------------------------------------------------------------ drawing */

function drawPlaceholder(width, height, lines) {
  const c = createCanvas(width, height, PAPER);
  diagonalStripes(c, HAZARD, Math.max(6, Math.round(width / 64)), Math.max(18, Math.round(width / 20)));
  strokeRect(c, 0, 0, width, height, Math.max(4, Math.round(width / 160)), HAZARD);

  // Size the type to the canvas, then lay out a white plate behind it so the text
  // stays legible over the stripes.
  const unit = Math.max(1, Math.round(width / 320));
  const scales = lines.map((l) => Math.max(1, Math.round(unit * l.weight)));
  const gaps = scales.map((s) => Math.round(s * 3.5));
  const blockHeight = scales.reduce((sum, s, i) => sum + s * 7 + gaps[i], 0) - gaps[gaps.length - 1];

  let widest = 0;
  lines.forEach((l, i) => { widest = Math.max(widest, textWidth(l.text, scales[i])); });

  const padX = Math.round(width * 0.04);
  const padY = Math.round(height * 0.05);
  const plateW = Math.min(width - unit * 4, widest + padX * 2);
  const plateH = blockHeight + padY * 2;
  const plateX = Math.round((width - plateW) / 2);
  const plateY = Math.round((height - plateH) / 2);

  fillRect(c, plateX, plateY, plateW, plateH, PLATE);
  strokeRect(c, plateX, plateY, plateW, plateH, Math.max(2, unit), INK);

  let y = plateY + padY;
  lines.forEach((l, i) => {
    drawTextCentred(c, l.text, y, scales[i], l.colour ?? INK);
    y += scales[i] * 7 + gaps[i];
  });

  return c;
}

/* ------------------------------------------------- exact byte weight search */

/**
 * Find the noise level whose encoded PNG lands just under the byte target, then pad
 * the file to the target exactly. The search is a bracketed linear interpolation
 * rather than a bisection so it converges in six or seven compressions instead of
 * eighteen.
 */
function encodeToExactBytes(base, targetBytes, seed, comments) {
  const aim = targetBytes - 1200; // leave room for the padding chunk framing
  let lo = { p: 0, size: sizeAt(base, 0, seed, comments) };
  if (lo.size > targetBytes) {
    throw new Error(`base image already exceeds the ${targetBytes} byte budget at ${lo.size} bytes`);
  }
  let hi = { p: 1, size: sizeAt(base, 1, seed, comments) };
  if (hi.size < aim) {
    throw new Error(`maximum entropy still under target: ${hi.size} < ${aim}. Raise the noise amplitude.`);
  }

  let best = lo;
  for (let i = 0; i < 14; i++) {
    if (best.size >= aim - 1500 && best.size <= targetBytes - 60) break;
    const span = hi.size - lo.size;
    let p = span === 0 ? (lo.p + hi.p) / 2 : lo.p + ((aim - lo.size) * (hi.p - lo.p)) / span;
    const margin = (hi.p - lo.p) * 0.05;
    p = Math.min(hi.p - margin, Math.max(lo.p + margin, p));
    const size = sizeAt(base, p, seed, comments);
    const point = { p, size };
    if (size <= targetBytes - 60) { lo = point; if (size > best.size) best = point; }
    else hi = point;
    if (hi.p - lo.p < 1e-6) break;
  }

  const c = cloneCanvas(base);
  addNoise(c, best.p, 10, seed);
  const buf = encodePng(c, { comments, padToBytes: targetBytes });
  if (!buf) throw new Error('could not pad to the exact target; adjust the search window');
  return { buffer: buf, noiseProbability: Number(best.p.toFixed(6)), unpaddedBytes: best.size };
}

// The comment chunks are part of the file, so they have to be part of the measurement.
function sizeAt(base, p, seed, comments) {
  const c = cloneCanvas(base);
  if (p > 0) addNoise(c, p, 10, seed);
  return encodePng(c, { comments }).length;
}

/* ------------------------------------------------------------ asset catalog */

function buildCatalog(fixtures) {
  const assets = [];
  for (const b of fixtures.blends) {
    const blend = b.blend;
    const name = blend.name.toUpperCase();

    assets.push({
      mediaId: blend.heroImageId,
      kind: 'hero',
      blendSlug: blend.slug,
      role: 'Blend hero photograph, the largest contentful paint on the tap path',
      lines: [
        { text: 'PLACEHOLDER', weight: 4.2, colour: HAZARD },
        { text: 'NOT REAL CONTENT', weight: 1.8 },
        { text: name, weight: 2.2 },
        { text: 'HERO IMAGE 1280 X 955 90 KB', weight: 1.2 },
        { text: 'TREVEAN TO SUPPLY PHOTOGRAPHY', weight: 1.0 },
        { text: 'SIZED AND WEIGHTED TO THE M1 PERFORMANCE BUDGET', weight: 0.9 },
      ],
    });

    assets.push({
      mediaId: `med_FAKEFM${blendCode(blend.slug)}010000000000000000`,
      kind: 'farm_map',
      blendSlug: blend.slug,
      role: 'Static farm map raster. Not an interactive map SDK: a mapping library is 200 to 800 KB of JavaScript.',
      lines: [
        { text: 'PLACEHOLDER', weight: 3.0, colour: HAZARD },
        { text: 'NO FARM COORDINATES', weight: 1.5 },
        { text: name, weight: 1.4 },
        { text: 'MAP 640 X 400 40 KB', weight: 1.0 },
        { text: 'NO LOCATION IS INVENTED', weight: 1.0 },
      ],
    });
  }

  for (const g of fixtures.growers) {
    const grower = g.grower;
    const slug = grower.blendSlugs[0];
    assets.push({
      mediaId: grower.portraitId,
      kind: 'grower_portrait',
      blendSlug: slug,
      growerId: grower.growerId,
      role: 'Grower portrait',
      lines: [
        { text: 'PLACEHOLDER', weight: 3.2, colour: HAZARD },
        { text: 'NOT A REAL PERSON', weight: 1.8 },
        { text: 'NO GROWER SUPPLIED', weight: 1.2 },
        { text: slug.toUpperCase().replace(/-/g, ' '), weight: 1.0 },
        { text: 'PORTRAIT 640 X 640 80 KB', weight: 1.0 },
      ],
    });
  }

  for (const r of fixtures.recipes) {
    for (const entry of r.recipes) {
      const recipe = entry.recipe;
      assets.push({
        mediaId: recipe.imageId,
        kind: 'recipe',
        blendSlug: recipe.blendSlug,
        recipeId: recipe.recipeId,
        seq: recipe.sortOrder,
        role: `Recipe carousel card ${recipe.sortOrder}`,
        lines: [
          { text: 'PLACEHOLDER', weight: 3.0, colour: HAZARD },
          { text: 'NOT REAL CONTENT', weight: 1.4 },
          { text: `RECIPE ${recipe.sortOrder}`, weight: 1.6 },
          { text: recipe.blendSlug.toUpperCase().replace(/-/g, ' '), weight: 0.9 },
          { text: '600 X 450 38 KB', weight: 0.9 },
        ],
      });
    }
  }

  return assets;
}

function blendCode(slug) {
  return {
    'persian-sunrise': 'PS',
    'caribbean-sunset': 'CS',
    'north-african-night-market': 'NM',
    'silk-road': 'SR',
    'kyoto-garden': 'KG',
  }[slug];
}

function altFor(asset) {
  const human = asset.blendSlug.replace(/-/g, ' ');
  switch (asset.kind) {
    case 'hero':
      return `[PLACEHOLDER] Generated placeholder standing in for the ${human} hero photograph. NOT REAL CONTENT.`;
    case 'grower_portrait':
      return `[PLACEHOLDER] Generated placeholder standing in for a grower portrait. There is no grower on file for ${human}. NOT REAL CONTENT.`;
    case 'recipe':
      return `[PLACEHOLDER] Generated placeholder standing in for a ${human} recipe photograph. NOT REAL CONTENT.`;
    case 'farm_map':
      return `[PLACEHOLDER] Generated placeholder standing in for the ${human} farm map. No coordinates have been supplied and none are invented. NOT REAL CONTENT.`;
    default:
      return '[PLACEHOLDER] NOT REAL CONTENT.';
  }
}

/* -------------------------------------------------------------------- main */

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const fixtures = loadAllFixtures();
  const assets = buildCatalog(fixtures);

  const records = [];
  let drift = 0;

  for (const asset of assets) {
    const spec = KINDS[asset.kind];
    const suffix = asset.seq === undefined ? '' : `-${String(asset.seq).padStart(2, '0')}`;
    const filename = `${asset.kind.replace(/_/g, '-')}-${asset.blendSlug}${suffix}.png`;
    const filePath = path.join(OUT_DIR, filename);

    const base = drawPlaceholder(spec.servedWidth, spec.servedHeight, asset.lines);
    const seed = hashSeed(asset.mediaId);
    const { buffer, noiseProbability, unpaddedBytes } = encodeToExactBytes(
      base,
      spec.servedMaxBytes,
      seed,
      [
        ['Title', 'TREVEAN SPICE PLACEHOLDER, NOT REAL CONTENT'],
        ['Description', `Generated placeholder for ${asset.blendSlug}, kind ${asset.kind}. Not a photograph. Sized and weighted to the M1 performance budget so the page is a truthful weight test. Replace before launch.`],
        ['Author', 'Serene Labs Inc, generated for Trevean Spice'],
        ['Copyright', 'Work for hire, owned by Trevean Spice on full payment. Generated from first principles, no third-party image, font or asset used.'],
        ['Software', 'build/content/tools/generate-placeholder-images.mjs'],
      ],
    );

    if (buffer.length !== spec.servedMaxBytes) {
      throw new Error(`${filename}: produced ${buffer.length} bytes, wanted exactly ${spec.servedMaxBytes}`);
    }

    if (CHECK_ONLY) {
      const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
      if (!existing || !existing.equals(buffer)) {
        console.error(`DRIFT: ${filename}`);
        drift++;
      }
    } else {
      fs.writeFileSync(filePath, buffer);
    }

    records.push({
      mediaId: asset.mediaId,
      kind: asset.kind,
      blendSlug: asset.blendSlug,
      ...(asset.growerId ? { growerId: asset.growerId } : {}),
      ...(asset.recipeId ? { recipeId: asset.recipeId } : {}),
      role: asset.role,
      filename,
      localPath: `media/placeholder/${filename}`,
      contentType: 'image/png',
      width: spec.servedWidth,
      height: spec.servedHeight,
      bytes: buffer.length,
      budgetBytes: spec.servedMaxBytes,
      atBudget: buffer.length === spec.servedMaxBytes,
      onTapPath: spec.onTapPath === true,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      alt: altFor(asset),
      status: 'ready',
      placeholder: true,
      noiseProbability,
      unpaddedBytes,
      licence: 'Work for hire, owned by Trevean Spice on full payment. Generated procedurally by this repository. No third-party image, photograph, font, icon or stock asset is used or embedded.',
    });

    console.log(
      `${records.length.toString().padStart(2)} ${filename.padEnd(46)} ${spec.servedWidth}x${spec.servedHeight}  ${buffer.length} bytes (exactly at budget)`,
    );
  }

  const manifest = {
    $comment: [
      'Generated by tools/generate-placeholder-images.mjs. Do not hand edit.',
      'Every asset is EXACTLY the dimensions and EXACTLY the byte weight its slot is allowed',
      'by the M1 performance budget, so a page measured against these placeholders is measured',
      'against the weight real photography will carry.',
      'Every asset is stamped PLACEHOLDER and NOT REAL CONTENT in readable type.',
    ],
    generatedOn: '2026-08-17',
    conventionVersion: 1,
    budgetSource: 'M1 deliverable, per-page byte and speed budget, section 4, and its budget.json',
    format: {
      note: 'PNG. The production pipeline serves AVIF with a WebP fallback. PNG is used here because these files are generated with the Node standard library and no native image codec, which keeps them reproducible on any machine with no install step. What the budget measures is bytes on the wire and pixel dimensions, and both are exact. The one thing a PNG placeholder does not reproduce is AVIF decode cost, which is the smaller half of the hero cost line (50 ms of the 385 ms) and is measured for real the moment the first genuine photograph is processed.',
    },
    assets: records,
  };

  if (CHECK_ONLY) {
    const existing = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : null;
    if (JSON.stringify(existing?.assets) !== JSON.stringify(records)) {
      console.error('DRIFT: media/manifest.json');
      drift++;
    }
    if (drift > 0) {
      console.error(`\n${drift} generated file(s) differ from what this script produces. Run it without --check.`);
      process.exit(1);
    }
    console.log('\nNo drift. Every generated asset matches this script exactly.');
    return;
  }

  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  const total = records.reduce((n, r) => n + r.bytes, 0);
  console.log(`\n${records.length} assets, ${total} bytes total. Manifest written to media/manifest.json.`);
}

function hashSeed(text) {
  return crypto.createHash('sha256').update(text).digest().readUInt32BE(0);
}

main();
