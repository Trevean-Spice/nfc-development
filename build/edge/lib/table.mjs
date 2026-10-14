/**
 * Loading and identifying the canonical redirect table.
 *
 * Everything that needs the table reads it through here. There is no second copy
 * anywhere in this package, and the compiled function in dist/ is generated from
 * this file rather than maintained alongside it.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const PATHS = {
  table: resolve(PACKAGE_ROOT, 'redirect-table.json'),
  template: resolve(PACKAGE_ROOT, 'src/handler.template.js'),
  notFound: resolve(PACKAGE_ROOT, 'src/not-found.html'),
  distFunction: resolve(PACKAGE_ROOT, 'dist/redirect.js'),
  distSeed: resolve(PACKAGE_ROOT, 'dist/nfc-tags.seed.json'),
  distEncoding: resolve(PACKAGE_ROOT, 'dist/tag-encoding.csv'),
  distQrArtwork: resolve(PACKAGE_ROOT, 'dist/qr-artwork.csv')
};

/** CloudFront Functions maximum function size, in bytes. */
export const MAX_FUNCTION_BYTES = 10240;

/** Warn above this, so the limit is not discovered on the day it is crossed. */
export const WARN_FUNCTION_BYTES = 8192;

/**
 * The five blend slugs, from Scope, section "The five blends". Held here rather
 * than derived from the table, because a validator that derives its expectations
 * from the thing it is validating cannot catch a wrong slug.
 */
export const KNOWN_BLEND_SLUGS = [
  'persian-sunrise',
  'caribbean-sunset',
  'silk-road',
  'north-african-night-market',
  'kyoto-garden'
];

export function loadTable(path = PATHS.table) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** The code to target mapping the function serves on the tap path, /t/{code}. */
export function targetsOf(table) {
  const targets = {};
  for (const entry of table.entries) {
    targets[entry.code] = entry.targetPath;
  }
  return targets;
}

/**
 * The code to target mapping the function serves on the QR path, /q/{code}.
 *
 * Same destination page, same table row, same 307. The only difference is the
 * via value, which the beacon reads after paint and which is excluded from the
 * cache key, so both routes are served the same bytes out of the same cache
 * entry. Held as its own literal map rather than derived at runtime by string
 * surgery on the tap target, because what ships must be the string the table
 * says, and because a validator can then compare the pair.
 */
export function qrTargetsOf(table) {
  const targets = {};
  for (const entry of table.entries) {
    targets[entry.code] = entry.qrTargetPath;
  }
  return targets;
}

/** Hero preload Link header values, for the codes that carry one. */
export function preloadsOf(table) {
  const preloads = {};
  for (const entry of table.entries) {
    if (entry.heroPreloadPath) {
      preloads[entry.code] = `<${entry.heroPreloadPath}>; rel=preload; as=image; fetchpriority=high`;
    }
  }
  return preloads;
}

/**
 * The identity of what is being served, surfaced on every response as
 * x-trevean-table so a deployed function can be checked from outside.
 *
 * The digest covers exactly the inputs that change what the function returns:
 * the mapping, the preload hints, the redirect status and the not found body.
 * It deliberately does not cover unitsEncoded, supplierOrderRef or the other
 * inventory fields, so an inventory correction does not make every deployed
 * function look stale when its behaviour has not changed.
 */
export function tableId(table, notFoundHtml) {
  const targets = targetsOf(table);
  const qrTargets = qrTargetsOf(table);
  const preloads = preloadsOf(table);
  const serving = Object.keys(targets)
    .sort()
    .map((code) => [code, targets[code], qrTargets[code] || null, preloads[code] || null]);
  const canonical = JSON.stringify({
    version: table.version,
    redirectStatus: table.redirectStatus,
    serving,
    notFound: notFoundHtml
  });
  const digest = createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 8);
  return `v${table.version}.${digest}`;
}

/** Counts used in the reporting lines, so no script recomputes them. */
export function summarise(table) {
  const encoded = table.entries.filter((e) => e.status === 'encoded');
  const reserved = table.entries.filter((e) => e.status !== 'encoded');
  return {
    codes: table.entries.length,
    physicalTags: encoded.length,
    unitsEncoded: encoded.reduce((sum, e) => sum + e.unitsEncoded, 0),
    reservedCodes: reserved.map((e) => e.code)
  };
}
