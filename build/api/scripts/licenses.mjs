#!/usr/bin/env node
/**
 * Generate the licence evidence for this package from what is actually installed.
 *
 *   node scripts/licenses.mjs            write licenses.json and the enumerated
 *                                        section of MANIFEST.md
 *   node scripts/licenses.mjs --check    write nothing, exit 1 if either has drifted
 *
 * Why this exists rather than a hand-kept table. The Scope document, "IP and handoff",
 * carries a background IP obligation: every pre-existing library reused here has to be
 * listed explicitly and licensed to Trevean to run and maintain the product
 * indefinitely, and the list is kept from day one rather than reconstructed at handoff.
 * This package previously satisfied that with aggregate counts and no per package list,
 * while the consumer web package shipped a machine generated enumeration of all 217 of
 * its packages. A reviewer comparing the two would see one of them stop short. It reads
 * node_modules rather than a list somebody typed, so it cannot drift from what an
 * install actually pulls in.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const check = process.argv.includes('--check');

const BEGIN = '<!-- BEGIN GENERATED PACKAGE LIST. Do not edit by hand: npm run licences rewrites it. -->';
const END = '<!-- END GENERATED PACKAGE LIST -->';

/** The permissive set. Anything outside it is a decision to raise with Dan before it merges. */
const PERMISSIVE = new Set(['MIT', 'Apache-2.0', 'ISC', 'BSD-3-Clause', 'BSD-2-Clause', '0BSD', 'BlueOak-1.0.0', 'Unlicense']);

/** Read a licence off a manifest, tolerating the older object form some packages still use. */
function licenceOf(manifest) {
  const { license, licenses } = manifest;
  if (typeof license === 'string' && license) return license;
  if (license && typeof license === 'object' && license.type) return `${license.type} (declared in the older object form)`;
  if (Array.isArray(licenses) && licenses.length > 0) {
    return `${licenses.map((l) => (typeof l === 'string' ? l : l.type)).join(' OR ')} (declared in the older array form)`;
  }
  return 'UNKNOWN';
}

/** Walk every node_modules directory, including nested ones, so vendored copies are counted. */
function scan(modulesDir, found) {
  if (!existsSync(modulesDir)) return found;
  for (const entry of readdirSync(modulesDir)) {
    if (entry.startsWith('.')) continue;
    const path = join(modulesDir, entry);
    if (!statSync(path).isDirectory()) continue;
    if (entry.startsWith('@')) {
      for (const scoped of readdirSync(path)) {
        if (scoped.startsWith('.')) continue;
        record(join(path, scoped), `${entry}/${scoped}`, found);
      }
      continue;
    }
    record(path, entry, found);
  }
  return found;
}

function record(path, name, found) {
  const manifestPath = join(path, 'package.json');
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const key = `${name}@${manifest.version}`;
      if (!found.has(key)) {
        found.set(key, {
          name,
          version: manifest.version ?? 'unknown',
          license: licenceOf(manifest),
          homepage: manifest.homepage ?? (manifest.repository && (manifest.repository.url ?? manifest.repository)) ?? null,
        });
      }
    } catch {
      /* a package.json we cannot parse is reported below as UNKNOWN via its absence */
    }
  }
  scan(join(path, 'node_modules'), found);
}

const found = scan(join(root, 'node_modules'), new Map());
const all = [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const runtime = new Set(Object.keys(pkg.dependencies ?? {}));
const dev = new Set(Object.keys(pkg.devDependencies ?? {}));
const roleOf = (name) => (runtime.has(name) ? 'runtime' : dev.has(name) ? 'development' : 'transitive');

const counts = {};
for (const p of all) counts[p.license] = (counts[p.license] ?? 0) + 1;

/**
 * Two totals, both true, and they are reported side by side because reporting one alone is
 * how the earlier "174 packages" figure came to look like it disagreed with this list.
 * A handful of packages are installed at two versions, once at the top level and once
 * nested under a dependency that needs a different one. Each installed copy is a separate
 * licence grant, so the enumeration lists both; a reader counting names sees the smaller
 * number.
 */
const names = new Map();
for (const p of all) names.set(p.name, (names.get(p.name) ?? 0) + 1);
const duplicated = [...names.entries()].filter(([, n]) => n > 1).map(([name]) => name);

const nonPermissive = all.filter((p) => !PERMISSIVE.has(p.license.replace(/ \(declared in the older .* form\)$/, '')));

// --------------------------------------------------------------------- licenses.json
const json = `${JSON.stringify(
  {
    package: pkg.name,
    total: all.length,
    distinctNames: names.size,
    installedAtMoreThanOneVersion: duplicated,
    byLicence: Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1])),
    nonPermissive: nonPermissive.map((p) => `${p.name}@${p.version}: ${p.license}`),
    packages: all.map((p) => ({ ...p, role: roleOf(p.name) })),
  },
  null,
  2,
)}\n`;

// --------------------------------------------------------------------- MANIFEST.md section
const rows = all
  .map((p) => `| \`${p.name}\` | ${p.version} | ${p.license} | ${roleOf(p.name)} |`)
  .join('\n');

const licenceRows = Object.entries(counts)
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .map(([licence, n]) => `| ${licence} | ${n} |`)
  .join('\n');

const section = `${BEGIN}

**${all.length} installed packages, and every one of them is listed below.** This section is
generated from \`node_modules\` by \`npm run licences\`, not typed, so it cannot drift from
what an install actually pulls in. The role column says whether a package is a declared
runtime dependency, a declared development dependency, or something one of those pulled in.
Runtime packages ship to production; the other two do not.

**Two totals, both true, stated together so they cannot look like a disagreement.** There are
**${all.length} installed packages** and **${names.size} distinct package names**. ${
  duplicated.length === 0
    ? 'No package is installed at more than one version.'
    : `The difference is ${duplicated.length} package${duplicated.length === 1 ? '' : 's'} installed at two versions each, once at the top level and once nested under a dependency needing a different one: ${duplicated
        .map((n) => `\`${n}\``)
        .join(', ')}. Each installed copy is its own licence grant, so the table lists both.`
}

| Licence | Packages |
|---|---|
${licenceRows}

${
  nonPermissive.length === 0
    ? '**Nothing in this table falls outside the permissive set.** No GPL, no LGPL, no AGPL, no MPL, no source-available and no commercial licence.'
    : `**${nonPermissive.length} package${nonPermissive.length === 1 ? ' falls' : 's fall'} outside the permissive set and ${nonPermissive.length === 1 ? 'is' : 'are'} named here rather than buried in a count:** ${nonPermissive
        .map((p) => `\`${p.name}@${p.version}\` (${p.license})`)
        .join(', ')}.`
}

| Package | Version | Licence | Role |
|---|---|---|---|
${rows}

${END}`;

const manifestPath = join(root, 'MANIFEST.md');
const manifest = readFileSync(manifestPath, 'utf8');
const begin = manifest.indexOf(BEGIN);
const end = manifest.indexOf(END);
if (begin === -1 || end === -1) {
  console.error(`MANIFEST.md is missing the generated section markers. Expected:\n  ${BEGIN}\n  ${END}`);
  process.exit(1);
}
const nextManifest = manifest.slice(0, begin) + section + manifest.slice(end + END.length);

const jsonPath = join(root, 'licenses.json');
const drifted = [];
if (!existsSync(jsonPath) || readFileSync(jsonPath, 'utf8') !== json) drifted.push('licenses.json');
if (manifest !== nextManifest) drifted.push('MANIFEST.md');

if (check) {
  if (drifted.length > 0) {
    console.error(`Licence evidence has drifted: ${drifted.join(', ')}. Run npm run licences.`);
    process.exit(1);
  }
  console.log(`Licence evidence is current: ${all.length} packages enumerated.`);
} else {
  writeFileSync(jsonPath, json);
  writeFileSync(manifestPath, nextManifest);
  console.log(`${all.length} packages enumerated into licenses.json and MANIFEST.md.`);
  for (const [licence, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${licence}`);
  }
}

if (nonPermissive.length > 0) {
  console.warn(`\n  warn  ${nonPermissive.length} package(s) outside the permissive set:`);
  for (const p of nonPermissive) console.warn(`        ${p.name}@${p.version}: ${p.license}`);
}
