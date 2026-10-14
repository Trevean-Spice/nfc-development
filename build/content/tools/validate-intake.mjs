#!/usr/bin/env node
/**
 * Validate a content submission from Trevean before we accept it.
 *
 * The purpose is one round trip instead of three. Everything this tool reports is
 * something that would otherwise be found days later: a story paragraph that will not
 * fit above the fold, a hero photograph too small to make the 1280 px variant, a
 * recipe with ingredients written as one English string that no future translation can
 * parse, a date in the wrong format, a coordinate with the sign dropped.
 *
 * It checks against spec/content-field-spec.json, which is the same file the readiness
 * report and the intake specification are written from.
 *
 * Usage:
 *   node tools/validate-intake.mjs intake/incoming/persian-sunrise.json
 *   node tools/validate-intake.mjs intake/incoming/*.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadSpec, ROOT, SENTINEL, BLEND_ORDER } from './lib/fixtures.mjs';
import { imageSize } from './lib/imagesize.mjs';

const spec = loadSpec();
const files = process.argv.slice(2);

if (files.length === 0) {
  console.error('usage: node tools/validate-intake.mjs <submission.json> [...]');
  process.exit(2);
}

let errors = 0;
let warnings = 0;

for (const file of files) {
  console.log('');
  console.log('='.repeat(78));
  console.log(file);
  console.log('='.repeat(78));
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    error(`the file is not valid JSON: ${err.message}`);
    continue;
  }
  validateSubmission(doc, path.dirname(path.resolve(file)));
}

console.log('');
console.log(`${errors} error(s), ${warnings} warning(s).`);
console.log(
  errors === 0
    ? 'Accepted. This submission can be loaded into the fixtures without a round trip.'
    : 'Not accepted yet. Every error above has to be fixed before the content can be loaded.',
);
process.exit(errors === 0 ? 0 : 1);

/* ---------------------------------------------------------------- checking */

function error(msg) { errors++; console.log(`  ERROR    ${msg}`); }
function warn(msg) { warnings++; console.log(`  warning  ${msg}`); }
function ok(msg) { console.log(`  ok       ${msg}`); }

function validateSubmission(doc, baseDir) {
  const slug = doc.slug;
  if (!BLEND_ORDER.includes(slug)) {
    error(`slug "${slug}" is not one of the five blends: ${BLEND_ORDER.join(', ')}. The slug is fixed by the redirect table and cannot be changed: a thousand encoded tags resolve through it.`);
    return;
  }
  ok(`slug ${slug}`);

  checkEntity('blend', doc.blend ?? {}, baseDir, 'blend');
  checkEntity('grower', doc.grower ?? {}, baseDir, 'grower');

  const recipes = doc.recipes ?? [];
  const min = spec.entities.recipe.perBlendMin;
  const max = spec.entities.recipe.perBlendMax;
  if (recipes.length < min || recipes.length > max) {
    error(`${recipes.length} recipes supplied. The Scope document requires ${min} to ${max} per blend.`);
  } else {
    ok(`${recipes.length} recipes, inside the ${min} to ${max} range`);
  }
  recipes.forEach((r, i) => checkEntity('recipe', r, baseDir, `recipe ${i + 1}`));

  // Ingredients as four values rather than one string is the check most likely to be
  // missed, and the most expensive to fix after the fact.
  recipes.forEach((r, i) => {
    for (const ing of r.ingredients ?? []) {
      if (typeof ing === 'string') {
        error(`recipe ${i + 1}: ingredient supplied as a single string ("${ing.slice(0, 40)}..."). Each ingredient needs quantity, unit, item and an optional note as separate values.`);
      }
    }
  });
}

function checkEntity(entityKey, payload, baseDir, label) {
  const fields = spec.entities[entityKey].fields.filter((f) => !f.path.includes('[]'));
  for (const field of fields) {
    if (field.owner === 'Serene Labs' || field.owner === 'Shopify') continue;
    const value = getPath(payload, field.path);
    const present = value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0);

    if (!present) {
      if (field.requiredForPublish) error(`${label}.${field.path} is missing and is required before the page can publish. ${field.guidance}`);
      else warn(`${label}.${field.path} is missing. Optional. ${field.guidance}`);
      continue;
    }

    if (typeof value === 'string' && value.includes(SENTINEL)) {
      error(`${label}.${field.path} still carries the ${SENTINEL} sentinel. This is our placeholder text, not content.`);
      continue;
    }

    if (typeof value === 'string' && field.maxLength && value.length > field.maxLength) {
      error(`${label}.${field.path} is ${value.length} characters, over the ${field.maxLength} the API contract allows.`);
      continue;
    }
    if (typeof value === 'string' && field.targetMin && value.length < field.targetMin) {
      warn(`${label}.${field.path} is ${value.length} characters, under the ${field.targetMin} we asked for. Shorter is allowed but the layout was designed around the longer length.`);
    }
    if (typeof value === 'string' && field.targetMax && value.length > field.targetMax) {
      warn(`${label}.${field.path} is ${value.length} characters, over the ${field.targetMax} we asked for. It will still render, but check it above the fold at 375 px.`);
    }

    switch (field.type) {
      case 'iso3166-alpha2':
        if (!/^[A-Z]{2}$/.test(value)) error(`${label}.${field.path} is "${value}". It must be a two letter uppercase ISO 3166-1 code, for example IR or TT.`);
        break;
      case 'date':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
          error(`${label}.${field.path} is "${value}". It must be YYYY-MM-DD.`);
        }
        break;
      case 'number':
        if (typeof value !== 'number') error(`${label}.${field.path} is "${value}". It must be a number, not a string, and not degrees and minutes.`);
        else if (field.path.endsWith('latitude') && (value < -90 || value > 90)) error(`${label}.${field.path} is ${value}, outside -90 to 90.`);
        else if (field.path.endsWith('longitude') && (value < -180 || value > 180)) error(`${label}.${field.path} is ${value}, outside -180 to 180.`);
        break;
      case 'integer':
        if (!Number.isInteger(value)) error(`${label}.${field.path} is "${value}". It must be a whole number.`);
        break;
      case 'enum':
        if (field.enum && !field.enum.includes(value)) error(`${label}.${field.path} is "${value}". It must be one of ${field.enum.join(', ')}.`);
        break;
      case 'media':
        checkImage(`${label}.${field.path}`, value, field.mediaKind, baseDir);
        break;
      case 'blocks':
        checkStoryBlocks(label, value);
        break;
      case 'list':
        if (!Array.isArray(value)) {
          error(`${label}.${field.path} must be a list.`);
        } else if (field.minItems && value.length < field.minItems) {
          error(`${label}.${field.path} has ${value.length} entries, fewer than the ${field.minItems} required.`);
        } else {
          value.forEach((entry, i) => {
            const text = typeof entry === 'string' ? entry : entry?.item;
            if (typeof text !== 'string' || text.trim() === '') {
              error(`${label}.${field.path}[${i}] is empty. An empty entry is not the same as a shorter list: delete the row or fill it in.`);
            }
          });
        }
        break;
      default:
        break;
    }
  }
}

function checkStoryBlocks(label, blocks) {
  if (!Array.isArray(blocks)) {
    error(`${label}.storyBlocks must be a list of blocks, each with a type of heading, paragraph or quote and a text value.`);
    return;
  }
  const field = spec.entities.blend.fields.find((f) => f.path === 'storyBlocks[].text');
  blocks.forEach((b, i) => {
    if (!['heading', 'paragraph', 'quote'].includes(b?.type)) {
      error(`${label}.storyBlocks[${i}].type is "${b?.type}". It must be heading, paragraph or quote. There is no HTML block type, deliberately.`);
    }
    if (typeof b?.text !== 'string' || b.text.trim() === '') {
      error(`${label}.storyBlocks[${i}].text is empty.`);
      return;
    }
    if (/<[a-z][\s\S]*>/i.test(b.text)) {
      error(`${label}.storyBlocks[${i}].text contains HTML markup. Blocks carry plain text only: raw HTML from a CMS is how a blocking script gets onto the tap path without anyone deciding to put it there.`);
    }
    if (b.type === 'paragraph' && field.targetMin && b.text.length < field.targetMin) {
      warn(`${label}.storyBlocks[${i}].text is ${b.text.length} characters, under the ${field.targetMin} we asked for.`);
    }
  });
  const firstParagraph = blocks.find((b) => b?.type === 'paragraph');
  if (!firstParagraph) {
    error(`${label}.storyBlocks has no paragraph. The Acceptance criteria document section 6.3 requires the origin story visible without scrolling, so there has to be an opening paragraph.`);
  }
}

function checkImage(label, value, kind, baseDir) {
  const kindSpec = spec.imageSpecification.kinds[kind];
  const filePath = path.resolve(baseDir, value);
  if (!fs.existsSync(filePath)) {
    error(`${label} points at "${value}", which is not in the submission. Deliver the image files alongside the JSON.`);
    return;
  }
  const bytes = fs.statSync(filePath).size;
  if (bytes > spec.imageSpecification.maximumSourceBytes) {
    error(`${label}: ${value} is ${Math.round(bytes / 1048576)} MB, over the ${Math.round(spec.imageSpecification.maximumSourceBytes / 1048576)} MB upload limit.`);
  }
  const size = imageSize(filePath);
  if (size.width === null) {
    warn(`${label}: could not read the dimensions of ${value} (format ${size.format}). Send JPEG, PNG or WebP.`);
    return;
  }
  if (kindSpec.minimumSourceWidth && size.width < kindSpec.minimumSourceWidth) {
    error(`${label}: ${value} is ${size.width} by ${size.height}. We need at least ${kindSpec.minimumSourceWidth} px wide to produce the ${kindSpec.servedWidth} px variant without upscaling.`);
  } else {
    ok(`${label}: ${value} is ${size.width} by ${size.height} ${size.format}, ${bytes} bytes`);
  }
  const wanted = kindSpec.servedWidth / kindSpec.servedHeight;
  const actual = size.width / size.height;
  if (Math.abs(actual - wanted) / wanted > 0.12) {
    warn(`${label}: aspect ratio is ${actual.toFixed(2)}:1 and the slot is ${wanted.toFixed(2)}:1. It will be cropped. Tell us where the crop should favour, or send it pre-cropped.`);
  }
}

function getPath(obj, dotted) {
  return dotted.split('.').reduce((acc, k) => (acc === null || acc === undefined ? undefined : acc[k]), obj);
}
