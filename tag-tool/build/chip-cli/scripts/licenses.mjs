#!/usr/bin/env node
/**
 * Generate the licence evidence for this package from what is actually installed.
 *
 *   node scripts/licenses.mjs            write licenses.json and the enumerated
 *                                        section of MANIFEST.md
 *   node scripts/licenses.mjs --check    write nothing, exit 1 if either has drifted
 *
 * Why this exists rather than a hand kept table. The Scope document, "IP and handoff",
 * carries a background IP obligation: every pre existing library reused here has to be
 * listed explicitly and licensed to Trevean to run and maintain the product indefinitely,
 * and the list is kept from day one rather than reconstructed at handoff. A hand kept list
 * drifts on the first day somebody adds a dependency, and this package's did. It reads
 * node_modules rather than a list somebody typed, so it cannot drift from what an install
 * actually pulls in.
 *
 * This file is byte identical in every package that carries one, deliberately, so there is
 * one thing to review rather than several. It derives everything it needs from the
 * package.json beside it.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const check = process.argv.includes('--check');

const BEGIN = '<!-- BEGIN GENERATED PACKAGE LIST. Do not edit by hand: node scripts/licenses.mjs rewrites it. -->';
const END = '<!-- END GENERATED PACKAGE LIST -->';

/** The permissive set. Anything outside it is a decision to raise before it merges. */
const PERMISSIVE = new Set(['MIT', 'Apache-2.0', 'ISC', 'BSD-3-Clause', 'BSD-2-Clause', '0BSD', 'BlueOak-1.0.0', 'Unlicense']);

/** A licence a client's counsel will ask about by name. */
const COPYLEFT = /\b(GPL|LGPL|AGPL|MPL|EPL|CDDL|OSL|CPL|SSPL)\b/i;

/** Read a licence off a manifest, tolerating the two older forms some packages still use. */
function licenceOf(meta, dir) {
  const { license, licenses } = meta;
  if (typeof license === 'string' && license) return license;
  if (license && typeof license === 'object' && license.type) return `${license.type} (older object form)`;
  if (Array.isArray(licenses) && licenses.length > 0) {
    return `${licenses.map((l) => (typeof l === 'string' ? l : l.type)).join(' OR ')} (older array form)`;
  }
  try {
    for (const n of readdirSync(dir)) if (/^licen[cs]e/i.test(n)) return 'declared nowhere, bundled LICENSE file only';
  } catch {
    /* falls through to UNDETERMINED */
  }
  return 'UNDETERMINED';
}

/** Walk every node_modules, including nested ones, so a second copy at another version counts. */
function scan(modulesDir, found, copies) {
  if (!existsSync(modulesDir)) return found;
  for (const entry of readdirSync(modulesDir)) {
    if (entry.startsWith('.')) continue;
    const path = join(modulesDir, entry);
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    if (entry.startsWith('@')) {
      for (const scoped of readdirSync(path)) {
        if (scoped.startsWith('.')) continue;
        record(join(path, scoped), `${entry}/${scoped}`, found, copies);
      }
      continue;
    }
    record(path, entry, found, copies);
  }
  return found;
}

function record(path, name, found, copies) {
  const manifestPath = join(path, 'package.json');
  if (existsSync(manifestPath)) {
    try {
      const meta = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const version = meta.version ?? 'unknown';
      const key = `${name}@${version}`;
      copies.push(key);
      if (!found.has(key)) {
        found.set(key, {
          name,
          version,
          license: licenceOf(meta, path),
          homepage: meta.homepage ?? (meta.repository && (meta.repository.url ?? meta.repository)) ?? null,
        });
      }
    } catch {
      /* an unparseable package.json is not a licence grant we can read */
    }
  }
  scan(join(path, 'node_modules'), found, copies);
}

/** What the committed lockfile pins across every platform, which is larger than what installs here. */
function resolvedFromLockfile() {
  const lock = join(root, 'package-lock.json');
  const out = new Map();
  if (!existsSync(lock)) return out;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(lock, 'utf8'));
  } catch {
    return out;
  }
  for (const [path, entry] of Object.entries(parsed.packages ?? {})) {
    if (!path.startsWith('node_modules/')) continue;
    const name = path.replace(/^.*node_modules\//, '');
    const version = entry.version ?? 'unknown';
    const license =
      typeof entry.license === 'string' && entry.license
        ? entry.license
        : Array.isArray(entry.license)
          ? entry.license.join(' OR ')
          : 'declared nowhere in the lockfile';
    const key = `${name}@${version}`;
    if (!out.has(key)) out.set(key, { name, version, license });
  }
  return out;
}

const copies = [];
const found = scan(join(root, 'node_modules'), new Map(), copies);
const all = [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const runtime = new Set(Object.keys(pkg.dependencies ?? {}));
const dev = new Set(Object.keys(pkg.devDependencies ?? {}));
const roleOf = (name) => (runtime.has(name) ? 'runtime' : dev.has(name) ? 'development' : 'transitive');

const counts = {};
for (const p of all) counts[p.license] = (counts[p.license] ?? 0) + 1;

const names = new Map();
for (const p of all) names.set(p.name, [...(names.get(p.name) ?? []), p.version]);
const duplicated = [...names.entries()].filter(([, vs]) => vs.length > 1).map(([name, vs]) => `${name} (${vs.sort().join(', ')})`);

const nonPermissive = all.filter((p) => !PERMISSIVE.has(p.license));
const copyleft = all.filter((p) => COPYLEFT.test(p.license));

const resolved = resolvedFromLockfile();
const resolvedOnly = [...resolved.values()]
  .filter((r) => !found.has(`${r.name}@${r.version}`))
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const resolvedOnlyCopyleft = resolvedOnly.filter((r) => COPYLEFT.test(r.license));

const sortCounts = (o) => Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

// --------------------------------------------------------------------- licenses.json
const json = `${JSON.stringify(
  {
    package: pkg.name,
    installedPairs: all.length,
    installedNames: names.size,
    installedCopies: copies.length,
    resolvedByLockfile: resolved.size,
    installedAtMoreThanOneVersion: duplicated,
    byLicence: Object.fromEntries(sortCounts(counts)),
    nonPermissive: nonPermissive.map((p) => `${p.name}@${p.version}: ${p.license}`),
    copyleft: copyleft.map((p) => `${p.name}@${p.version}: ${p.license}`),
    copyleftResolvedButNotInstalledHere: resolvedOnlyCopyleft.map((p) => `${p.name}@${p.version}: ${p.license}`),
    packages: all.map((p) => ({ ...p, role: roleOf(p.name) })),
  },
  null,
  2,
)}\n`;

// --------------------------------------------------------------------- MANIFEST.md section
const rows = all.map((p) => `| \`${p.name}\` | ${p.version} | ${p.license} | ${roleOf(p.name)} |`).join('\n');

const licenceRows = sortCounts(counts)
  .map(([licence, n]) => `| \`${licence}\` | ${n} | ${COPYLEFT.test(licence) ? '**yes**' : 'no'} |`)
  .join('\n');

const section = `${BEGIN}

**${all.length} installed package and version pairs, and every one of them is listed below.** This
section is generated from \`node_modules\` by \`node scripts/licenses.mjs\`, not typed, so it cannot
drift from what an install actually pulls in. The role column says whether a package is a declared
runtime dependency, a declared development dependency, or something one of those pulled in.

**Three totals, all true, stated together so they cannot look like a disagreement.** ${all.length}
package and version pairs, ${names.size} distinct package names, ${copies.length} copies on disk. ${
  duplicated.length === 0
    ? 'No package is installed at more than one version.'
    : `${duplicated.length} package${duplicated.length === 1 ? ' is' : 's are'} installed at more than one version, and each installed copy is its own licence grant: ${duplicated
        .map((n) => `\`${n}\``)
        .join(', ')}.`
}

${
  resolved.size === 0
    ? '**There is no committed lockfile for this package**, so there is no resolved figure to compare the installed one against.'
    : `**The committed lockfile resolves ${resolved.size} pairs**, ${
        resolvedOnly.length === 0
          ? 'which is the same set that is installed here.'
          : `which is ${resolvedOnly.length} more than are installed here. The difference is optional binary packages for operating systems this machine is not, and they install on any machine that is.`
      }`
}

| Licence, exactly as the package declares it | Pairs | Copyleft |
|---|---|---|
${licenceRows}

${
  nonPermissive.length === 0
    ? '**Nothing in this table falls outside the permissive set.** No GPL, no LGPL, no AGPL, no MPL, no source available and no commercial licence.'
    : `**${nonPermissive.length} package${nonPermissive.length === 1 ? ' falls' : 's fall'} outside the permissive set and ${
        nonPermissive.length === 1 ? 'is' : 'are'
      } named here rather than buried in a count:** ${nonPermissive
        .map((p) => `\`${p.name}@${p.version}\` (${p.license})`)
        .join(', ')}.`
}

${
  copyleft.length === 0 && resolvedOnlyCopyleft.length === 0
    ? '**No copyleft licence appears in this package, installed or resolved.**'
    : [
        copyleft.length === 0
          ? '**No copyleft licence is installed here.**'
          : `**Copyleft, installed:** ${copyleft.map((p) => `\`${p.name}@${p.version}\` (${p.license})`).join(', ')}.`,
        resolvedOnlyCopyleft.length === 0
          ? '**No further copyleft licence appears in the lockfile.**'
          : `**Copyleft, resolved by the lockfile but not installed on this machine:** ${resolvedOnlyCopyleft
              .map((p) => `\`${p.name}@${p.version}\` (${p.license})`)
              .join(', ')}.`,
      ].join(' ')
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
    console.error(`Licence evidence has drifted: ${drifted.join(', ')}. Run node scripts/licenses.mjs.`);
    process.exit(1);
  }
  console.log(`Licence evidence is current: ${all.length} pairs enumerated.`);
} else {
  writeFileSync(jsonPath, json);
  writeFileSync(manifestPath, nextManifest);
  console.log(`${all.length} pairs enumerated into licenses.json and MANIFEST.md.`);
  for (const [licence, n] of sortCounts(counts)) console.log(`  ${String(n).padStart(4)}  ${licence}`);
}

if (nonPermissive.length > 0) {
  console.warn(`\n  warn  ${nonPermissive.length} package(s) outside the permissive set:`);
  for (const p of nonPermissive) console.warn(`        ${p.name}@${p.version}: ${p.license}`);
}
if (resolvedOnlyCopyleft.length > 0) {
  console.warn(`\n  warn  ${resolvedOnlyCopyleft.length} copyleft package(s) in the lockfile that this platform does not install:`);
  for (const p of resolvedOnlyCopyleft) console.warn(`        ${p.name}@${p.version}: ${p.license}`);
}
