import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(here, '../..');
const API_KEYS_FILE = resolve(here, '../../../api/src/db/keys.ts');

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.json', '.css', '.html', '.md', '.yaml', '.yml', '.txt']);

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'tmp') continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else if (TEXT_EXTENSIONS.has(extname(path))) files.push(path);
  }
  return files;
}

const FILES = walk(PACKAGE_ROOT);

/**
 * The characters being banned are written as escapes rather than literally, so that this
 * file can look for them without containing them and failing itself.
 */
const DASHES = new RegExp('[\\u2013\\u2014\\u2015\\u2212]');
const SMART_QUOTES = new RegExp('[\\u2018\\u2019\\u201c\\u201d]');

test('the package has files to check', () => {
  assert.ok(FILES.length > 15, `only ${FILES.length} files found`);
});

test('no en dash and no em dash anywhere, including code comments and UI copy', () => {
  const offenders = [];
  for (const file of FILES) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (DASHES.test(line)) {
        offenders.push(`${file.slice(PACKAGE_ROOT.length + 1)}:${index + 1}: ${line.trim().slice(0, 80)}`);
      }
    });
  }
  assert.deepEqual(offenders, [], `dash characters found:\n${offenders.join('\n')}`);
});

test('no smart quotes either, so a copied string is the string that was written', () => {
  const offenders = FILES.filter((file) => SMART_QUOTES.test(readFileSync(file, 'utf8')));
  assert.deepEqual(offenders.map((file) => file.slice(PACKAGE_ROOT.length + 1)), []);
});

/**
 * The shipped code and copy are checked, and the test directory is not. A test that forbids
 * a phrase has to contain the phrase, and excluding it here is the only way that check can
 * exist at all. The phrases the tests do contain are all inside assertions that ban them.
 */
const SHIPPED = FILES.filter((file) => !file.includes(`${'test'}${process.platform === 'win32' ? '\\' : '/'}`));

test('no shipped file claims a per jar or per tag measurement', () => {
  const forbidden = [
    'jars scanned',
    'unique jars',
    'jars counted',
    'scans per jar',
    'individual jars',
    'unique tags',
    'unique devices',
    'unique visitors',
    'unique users',
  ];
  const offenders = [];
  for (const file of SHIPPED) {
    const text = readFileSync(file, 'utf8').toLowerCase();
    for (const phrase of forbidden) {
      if (text.includes(phrase)) offenders.push(`${file.slice(PACKAGE_ROOT.length + 1)}: ${phrase}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the phrase per jar count appears only as a denial, never as a claim', () => {
  for (const file of SHIPPED) {
    const text = readFileSync(file, 'utf8').toLowerCase();
    let index = text.indexOf('per-jar count');
    while (index !== -1) {
      const before = text.slice(Math.max(0, index - 40), index);
      assert.ok(
        before.includes('neither is a') || before.includes('not a') || before.includes('no '),
        `${file.slice(PACKAGE_ROOT.length + 1)} states a per jar count without denying it: ...${before}`,
      );
      index = text.indexOf('per-jar count', index + 1);
    }
  }
});

test('the package declares no third party dependency, which is what the manifest says', () => {
  const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.dependencies, {});
  assert.deepEqual(manifest.devDependencies, {});
});

test('the manifest exists and names the licence position', () => {
  const text = readFileSync(join(PACKAGE_ROOT, 'MANIFEST.md'), 'utf8');
  assert.match(text, /Licence/);
  assert.match(text, /zero/i);
});

test('the browser code loads nothing from a third party origin', () => {
  const browserFiles = FILES.filter((file) => file.includes(`${'public'}`) && ['.js', '.html', '.css'].includes(extname(file)));
  assert.ok(browserFiles.length > 5);
  for (const file of browserFiles) {
    const text = readFileSync(file, 'utf8');
    const matches = [...text.matchAll(/https?:\/\/[^\s"'`)]+/g)].map((match) => match[0]);
    for (const url of matches) {
      assert.ok(
        url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1') || url.startsWith('https://auth.local.'),
        `${file.slice(PACKAGE_ROOT.length + 1)} references ${url}`,
      );
    }
  }
});

test('the rollup key builders in the seeder match the API package byte for byte in shape', () => {
  const keys = readFileSync(API_KEYS_FILE, 'utf8');
  const seeder = readFileSync(join(PACKAGE_ROOT, 'tools', 'seed-rollups.mjs'), 'utf8');
  const expectations = [
    'ROLLUP#BLEND#${slug}#DAY',
    'ROLLUP#BLEND#${slug}#HOUR',
    'ROLLUP#ALL#DAY',
    'ROLLUP#ALL#HOUR',
    'ROLLUP#BLEND#${slug}#GEO#DAY',
  ];
  for (const expected of expectations) {
    const inKeysFile = keys.includes(expected) || keys.includes(expected.replace('ROLLUP#', '${KEY_PREFIX.rollup}'));
    assert.ok(inKeysFile, `${expected} is not the shape the API builds`);
    assert.ok(seeder.includes(expected), `${expected} is not the shape the seeder writes`);
  }
  // The geography sort key: day, country, region and city, with a placeholder for absent
  // parts. If the API changes the placeholder, the seeded data stops parsing and this fails.
  assert.ok(keys.includes("${day}#${country}#${region ?? '-'}#${city ?? '-'}"));
  assert.ok(seeder.includes("${day}#${country}#${region ?? '-'}#${city ?? '-'}"));
});
