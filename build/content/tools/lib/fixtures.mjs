/**
 * Fixture loading, and the one place that knows how to read the placeholder convention.
 *
 * Everything downstream (the readiness report, the seeder, the image generator, the
 * intake validator) reads fixtures through here, so there is exactly one definition of
 * "is this field still a placeholder".
 *
 * Node standard library only.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const SENTINEL = '[PLACEHOLDER]';
export const SECONDARY_MARKER = 'NOT REAL CONTENT';

export const BLEND_ORDER = [
  'persian-sunrise',
  'caribbean-sunset',
  'north-african-night-market',
  'silk-road',
  'kyoto-garden',
];

export const PLACEHOLDER_STATES = new Set([
  'placeholder_text',
  'placeholder_null',
  'placeholder_media',
]);

export function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), 'utf8'));
}

export function loadSpec() {
  return readJson('spec/content-field-spec.json');
}

function loadDir(dir) {
  const full = path.join(ROOT, dir);
  return fs
    .readdirSync(full)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ file: `${dir}/${f}`, ...JSON.parse(fs.readFileSync(path.join(full, f), 'utf8')) }))
    .sort((a, b) => bySlug(a) - bySlug(b));
}

function bySlug(rec) {
  const slug =
    rec.blend?.slug ?? rec.blendSlug ?? rec.catalog?.slug ?? rec.grower?.blendSlugs?.[0] ?? '';
  const i = BLEND_ORDER.indexOf(slug);
  return i === -1 ? 99 : i;
}

export function loadAllFixtures() {
  return {
    blends: loadDir('fixtures/blends'),
    growers: loadDir('fixtures/growers'),
    recipes: loadDir('fixtures/recipes'),
    catalog: loadDir('fixtures/catalog'),
  };
}

export function loadMediaManifest() {
  const p = path.join(ROOT, 'media', 'manifest.json');
  if (!fs.existsSync(p)) return { assets: [] };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/* ------------------------------------------------------- convention helpers */

/** Does this value carry the in-band sentinel anywhere inside it? */
export function carriesSentinel(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.includes(SENTINEL);
  if (Array.isArray(value)) return value.some(carriesSentinel);
  if (typeof value === 'object') return Object.values(value).some(carriesSentinel);
  return false;
}

/** Every field path in a record's placeholder flag whose state is a placeholder state. */
export function placeholderFields(record) {
  const fields = record._placeholder?.fields ?? {};
  return Object.entries(fields)
    .filter(([, state]) => PLACEHOLDER_STATES.has(state))
    .map(([p, state]) => ({ path: p, state }));
}

export function isPlaceholderRecord(record) {
  if (record._placeholder?.isPlaceholder === true) return true;
  return placeholderFields(record).length > 0;
}

/** Read a dotted path out of an object, tolerating nulls on the way down. */
export function getPath(obj, dotted) {
  const bare = dotted.replace(/\[\]$/, '');
  return bare.split('.').reduce((acc, key) => (acc === null || acc === undefined ? undefined : acc[key]), obj);
}

/**
 * The whole-fixture-set answer to "is any of this a placeholder", which is what the
 * production guard in the seeder asks. Deliberately conservative: an unrecognised
 * field state, a stray sentinel anywhere in the payload, or a missing flag all count
 * as placeholder. Failing towards "this is not real" is the safe direction.
 */
export function anyPlaceholder(fixtures) {
  const hits = [];
  const scan = (records, label, extract) => {
    for (const rec of records) {
      if (rec._placeholder?.isPlaceholder === true) {
        hits.push({ label, file: rec.file, reason: 'record is flagged isPlaceholder' });
        continue;
      }
      const payloads = extract(rec);
      for (const payload of payloads) {
        if (carriesSentinel(payload)) {
          hits.push({ label, file: rec.file, reason: 'payload carries the placeholder sentinel' });
          break;
        }
      }
    }
  };
  scan(fixtures.blends, 'blend', (r) => [r.blend]);
  scan(fixtures.growers, 'grower', (r) => [r.grower]);
  scan(fixtures.recipes, 'recipes', (r) => r.recipes.map((e) => e.recipe));
  scan(fixtures.catalog, 'catalog', (r) => [r.catalog]);
  return hits;
}

/** Strip the fixture-only underscore keys. What is left is the API and item shape. */
export function payloadOf(record, key) {
  const out = { ...record[key] };
  return out;
}
