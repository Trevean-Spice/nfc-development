/**
 * The package itself: house style, dependencies, the branded 404 page, and the
 * rule that nothing outside the canonical table carries a target path.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PATHS, PACKAGE_ROOT, loadTable } from '../lib/table.mjs';

const table = loadTable();
const notFound = readFileSync(PATHS.notFound, 'utf8');

// ---------------------------------------------------------------------------
// The branded not found page
// ---------------------------------------------------------------------------

test('the not found page is branded and says what happened', () => {
  // SOW section 6.3 requires a graceful branded response and never a blank
  // screen, and SOW section 6.1 treats a generic landing page as a failure in
  // the same way a wrong blend is. Vercel's own unmatched response is
  // "The page could not be found" as text/plain, which is neither.
  assert.ok(notFound.includes('Trevean Spice'));
  assert.ok(notFound.includes('We could not find that.'));
  assert.ok(notFound.toLowerCase().includes('jar'), 'the page has to make sense to somebody holding a jar');
  assert.ok(notFound.includes('<title>'));
  assert.ok(notFound.includes('noindex'));
});

test('the not found page needs no network request of its own', () => {
  // It has to work when every origin is down, which is when it gets used.
  for (const forbidden of ['<script', 'src=', '<link', '@import', 'http://', 'https://']) {
    assert.ok(!notFound.includes(forbidden), `the not found page references ${forbidden}`);
  }
});

test('the not found page offers a way back and it is a relative path', () => {
  assert.ok(notFound.includes('href="/"'));
});

test('the not found page names no blend, so it cannot become a generic landing page', () => {
  for (const entry of table.entries) {
    assert.ok(!notFound.includes(entry.blendSlug), `the not found page links to ${entry.blendSlug}`);
    assert.ok(!notFound.includes(entry.blendName), `the not found page names ${entry.blendName}`);
  }
});

// ---------------------------------------------------------------------------
// No second copy of the load-bearing artifact
// ---------------------------------------------------------------------------

test('no file outside dist carries a target path', () => {
  // A literal "/blend.html?blend=...&via=nfc" anywhere but the generated
  // configuration is a second copy of the load-bearing artifact, waiting to
  // disagree with the first. Prose and the tests are the permitted exceptions,
  // and the tests hold theirs deliberately: their expectations are transcribed
  // from the contract documents rather than derived from the file under test.
  const allowed = new Set(
    [PATHS.distVercelJson, PATHS.distRedirects].map((path) => relative(PACKAGE_ROOT, path).split('\\').join('/'))
  );
  const offenders = [];
  for (const file of sourceFiles()) {
    const rel = relative(PACKAGE_ROOT, file).split('\\').join('/');
    if (allowed.has(rel) || rel.startsWith('test/') || rel.endsWith('.md')) continue;
    const contents = readFileSync(file, 'utf8');
    for (const entry of table.entries) {
      for (const [field, value] of [
        ['target', entry.targetPath],
        ['QR target', entry.qrTargetPath],
        ['QR URL', entry.qrUrl],
        ['NDEF URI', entry.ndefUri]
      ]) {
        if (value && contents.includes(value)) {
          offenders.push(`${rel} hard codes the ${field} for ${entry.code}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('this package writes nothing into the edge package', () => {
  const source = sourceFiles()
    .filter((file) => /\.mjs$/.test(file))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
  assert.ok(!/writeFileSync\([^)]*edge/.test(source), 'the canonical table and its package are read only from here');
});

// ---------------------------------------------------------------------------
// House style and dependencies
// ---------------------------------------------------------------------------

test('no file in this package contains an en dash or an em dash', () => {
  // The two characters are built from their code points so that this file, which
  // is itself scanned, does not report itself.
  const forbidden = [String.fromCharCode(0x2013), String.fromCharCode(0x2014)];
  const offenders = [];
  for (const file of sourceFiles()) {
    const contents = readFileSync(file, 'utf8');
    for (const [index, line] of contents.split('\n').entries()) {
      if (forbidden.some((character) => line.includes(character))) {
        offenders.push(`${relative(PACKAGE_ROOT, file).split('\\').join('/')}:${index + 1}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('the package has no runtime or development dependencies', () => {
  const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.dependencies ?? {}, {});
  assert.deepEqual(pkg.devDependencies ?? {}, {});
  assert.ok(!existsSync(join(PACKAGE_ROOT, 'node_modules')));
  assert.ok(!existsSync(join(PACKAGE_ROOT, 'package-lock.json')));
});

test('every module imported by this package is a Node standard library module', () => {
  const offenders = [];
  for (const file of sourceFiles().filter((candidate) => /\.mjs$/.test(candidate))) {
    const contents = readFileSync(file, 'utf8');
    for (const match of contents.matchAll(/from\s+'([^']+)'/g)) {
      const specifier = match[1];
      if (specifier.startsWith('node:') || specifier.startsWith('.')) continue;
      offenders.push(`${relative(PACKAGE_ROOT, file).split('\\').join('/')} imports ${specifier}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the manifest exists and states the dependency position', () => {
  const manifest = readFileSync(join(PACKAGE_ROOT, 'MANIFEST.md'), 'utf8');
  assert.ok(manifest.includes('Zero third-party libraries'));
  assert.ok(manifest.toLowerCase().includes('licence') || manifest.toLowerCase().includes('license'));
});

test('the README states the mechanism decision', () => {
  const readme = readFileSync(join(PACKAGE_ROOT, 'README.md'), 'utf8');
  assert.ok(readme.includes('vercel.json'));
  assert.ok(readme.toLowerCase().includes('middleware'), 'the rejected option has to be written down, not just the chosen one');
});

test('the adoption instructions exist and cover DNS and email', () => {
  const adoption = readFileSync(join(PACKAGE_ROOT, 'ADOPTION.md'), 'utf8');
  assert.ok(adoption.includes('MX'));
  assert.ok(adoption.includes('DKIM'));
  assert.ok(adoption.includes('SPF'));
  assert.ok(adoption.includes('DMARC'));
  assert.ok(adoption.toLowerCase().includes('nameserver'));
});

function sourceFiles(dir = PACKAGE_ROOT, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(mjs|js|json|md|html|csv)$/.test(entry)) out.push(full);
  }
  return out;
}
