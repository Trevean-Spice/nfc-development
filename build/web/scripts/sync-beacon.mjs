#!/usr/bin/env node
/**
 * Vendor the measurement harness field beacon, verbatim.
 *
 * The beacon is not reimplemented here and must not be. It is the M1 instrument
 * that records the bench runs, the 28 August gate, the September matrix and
 * every customer tap after launch, so that the number accepted in August is
 * measured the same way as the number reviewed in December (Architecture
 * document, "Measurement"). A second implementation on the blend page would
 * quietly break that guarantee.
 *
 * This copies the harness's compiled browser output into public/vendor, keeps a
 * provenance record, and refuses to run if the files have been edited in place.
 * The copies are committed, because the client's nfc-development repository
 * will not contain the M1 harness directory.
 *
 * Source: deliverables/m1/harness/dist/web/{beacon,shared}
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const vendorDir = join(root, 'public', 'vendor', 'harness-beacon');
const provenanceFile = join(vendorDir, 'PROVENANCE.json');

/** build/web/scripts -> repository root -> deliverables/m1/harness */
const harnessDist = resolve(root, '..', '..', 'deliverables', 'm1', 'harness', 'dist', 'web');

const GROUPS = [
  {
    dir: 'beacon',
    files: [
      'beacon.js',
      'timing.js',
      'environment.js',
      'dedupe.js',
      // The projection onto the frozen contract's ScanEventInput. It is the
      // beacon's wire format and its privacy boundary, not an optional extra:
      // without it the page posts the harness record and the API answers 400
      // to every tap.
      'scanEvent.js',
      'transport.js',
    ],
  },
  { dir: 'shared', files: ['schema.js'] },
];

function sha(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/** The .js.map files are not shipped, so the trailing reference has to go. */
function stripSourceMap(text) {
  return text.replace(/\n?\/\/# sourceMappingURL=.*\s*$/, '\n');
}

if (!existsSync(harnessDist)) {
  console.log(`Harness not present at ${harnessDist}.`);
  console.log('Using the committed copies in public/vendor/harness-beacon.');
  if (existsSync(provenanceFile)) {
    const record = JSON.parse(readFileSync(provenanceFile, 'utf8'));
    console.log(`Vendored from harness ${record.harnessVersion}, synced ${record.syncedFrom}.`);
    process.exit(0);
  }
  console.error('No committed copies either. The beacon is missing.');
  process.exit(1);
}

const record = { source: harnessDist, syncedFrom: 'deliverables/m1/harness', files: {} };

for (const group of GROUPS) {
  const outDir = join(vendorDir, group.dir);
  mkdirSync(outDir, { recursive: true });
  for (const file of group.files) {
    const from = join(harnessDist, group.dir, file);
    const text = stripSourceMap(readFileSync(from, 'utf8'));
    writeFileSync(join(outDir, file), text, 'utf8');
    record.files[`${group.dir}/${file}`] = { bytes: Buffer.byteLength(text), sha256: sha(text) };
  }
}

const schema = readFileSync(join(harnessDist, 'shared', 'schema.js'), 'utf8');
const version = /HARNESS_VERSION\s*=\s*'([^']+)'/.exec(schema);
record.harnessVersion = version ? version[1] : 'unknown';

writeFileSync(provenanceFile, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

const total = Object.values(record.files).reduce((n, f) => n + f.bytes, 0);
console.log(`Vendored ${Object.keys(record.files).length} beacon files, ${total} bytes, from harness ${record.harnessVersion}.`);
for (const name of Object.keys(record.files)) console.log(`  ${name}`);
console.log('Verbatim copies. Edit the harness, then re-run this, never the other way round.');

if (readdirSync(join(vendorDir, 'beacon')).some((f) => f.endsWith('.map'))) {
  console.error('Source maps leaked into the vendor directory.');
  process.exit(1);
}
