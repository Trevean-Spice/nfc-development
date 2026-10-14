/**
 * Loading the canonical redirect table.
 *
 * There is no redirect table in this package and there must never be one.
 * `build/edge/redirect-table.json` is the single source of truth for
 * `/t/{code}` and `/q/{code}`, per "M1 Deliverable 2: Data model", section 7.1,
 * and this package compiles it into a second serving surface exactly as the
 * CloudFront package compiles it into a function. Two hosts, one table.
 *
 * The one failure mode this arrangement exists to prevent is "M1 Deliverable 3:
 * Redirect-Serving Decision and Apex Domain Routing", section 6, failure mode 2:
 * a host migration that leaves the redirect table behind. It does not break a
 * deployment, everything comes up green, and it strands a thousand jars that are
 * already in customers' kitchens. Moving the serving host is precisely the thing
 * being done here, so the table is read across the package boundary rather than
 * copied into it, and a test asserts that no copy has appeared.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The canonical table, in the edge package. Read only, never written by this package. */
export const CANONICAL_TABLE_PATH = resolve(PACKAGE_ROOT, '..', 'edge', 'redirect-table.json');

export const PATHS = {
  table: CANONICAL_TABLE_PATH,
  notFound: resolve(PACKAGE_ROOT, 'src/not-found.html'),
  distVercelJson: resolve(PACKAGE_ROOT, 'dist/vercel.json'),
  distRedirects: resolve(PACKAGE_ROOT, 'dist/redirects.json'),
  distNotFound: resolve(PACKAGE_ROOT, 'dist/404.html')
};

/**
 * The five blend slugs, transcribed from Scope, section "Tag code map". Held
 * here rather than derived from the table, because a validator that derives its
 * expectations from the thing it is validating cannot catch a wrong slug. The
 * client confirmed on 25 August 2026 that there are five blends, not six.
 */
export const KNOWN_BLEND_SLUGS = [
  'persian-sunrise',
  'caribbean-sunset',
  'silk-road',
  'north-african-night-market',
  'kyoto-garden'
];

/** The two routes this package serves, and the `via` value each one carries. */
export const ROUTES = [
  { prefix: 't', via: 'nfc', label: 'tap', targetField: 'targetPath' },
  { prefix: 'q', via: 'qr', label: 'QR', targetField: 'qrTargetPath' }
];

export function loadTable(path = PATHS.table) {
  if (!existsSync(path)) {
    throw new Error(
      `The canonical redirect table was not found at ${path}. This package does not ` +
        'carry its own copy on purpose: it compiles build/edge/redirect-table.json, ' +
        'which is the single source of truth for every encoded tag. Restore that file ' +
        'or run this package from inside the repository that contains it. Do not create ' +
        'a second table here.'
    );
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Counts used in the reporting lines, so no script recomputes them. */
export function summarise(table) {
  const encoded = table.entries.filter((entry) => entry.status === 'encoded');
  const reserved = table.entries.filter((entry) => entry.status !== 'encoded');
  return {
    codes: table.entries.length,
    physicalTags: encoded.length,
    unitsEncoded: encoded.reduce((sum, entry) => sum + entry.unitsEncoded, 0),
    reservedCodes: reserved.map((entry) => entry.code),
    reservedNames: reserved.map((entry) => entry.blendName)
  };
}
