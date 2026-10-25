/**
 * House rules, enforced rather than remembered.
 *
 * Two of these look pedantic and are not. The dash rule is a client-facing style
 * rule that applies to everything including code comments, and this package's
 * README and error strings are read by Trevean staff. The lock bit rule is the one
 * that stops this tool drifting back into being NTAG tooling, which is the mistake
 * the previous team's work is built on.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function collect(dir: string, extensions: string[]): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'runs' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      found.push(...collect(path, extensions));
    } else if (extensions.some((ext) => name.endsWith(ext))) {
      found.push(path);
    }
  }
  return found;
}

const SOURCES = collect(PACKAGE_ROOT, ['.ts', '.mjs', '.md', '.json']);

test('the package has source files to check', () => {
  assert.ok(SOURCES.length > 10, `expected the package to have sources, found ${SOURCES.length}`);
});

test('no en dashes and no em dashes anywhere, including code comments', () => {
  const EN_DASH = String.fromCharCode(0x2013);
  const EM_DASH = String.fromCharCode(0x2014);
  const offenders: string[] = [];

  for (const path of SOURCES) {
    const text = readFileSync(path, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, index) => {
      if (line.includes(EN_DASH) || line.includes(EM_DASH)) {
        offenders.push(`${path.slice(PACKAGE_ROOT.length + 1)}:${index + 1}`);
      }
    });
  }

  assert.deepEqual(offenders, [], 'use commas, colons, parentheses and full stops instead');
});

test('no lock bit concept has crept in from NTAG tooling', () => {
  const pattern = /\block_?bits?\b/i;
  const offenders: string[] = [];
  for (const path of SOURCES) {
    if (path.endsWith('house-style.test.ts')) continue;
    const text = readFileSync(path, 'utf8');
    text.split('\n').forEach((line, index) => {
      // "lock bits" as two words appears in the explanations of what this is not.
      // An identifier is what would mean the concept had actually been imported.
      if (pattern.test(line.replace(/lock bits?/gi, ''))) {
        offenders.push(`${path.slice(PACKAGE_ROOT.length + 1)}:${index + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(offenders, [], 'this chip has an area based 64 bit password, not lock bits');
});

test('the package declares no runtime dependencies', () => {
  const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert.deepEqual(manifest.dependencies ?? {}, {}, 'nothing third party runs when a tag is written');
  // Development dependencies are allowed and must be in MANIFEST.md.
  const declared = Object.keys(manifest.devDependencies ?? {});
  const manifestText = readFileSync(join(PACKAGE_ROOT, 'MANIFEST.md'), 'utf8');
  for (const name of declared) {
    assert.ok(manifestText.includes(name), `${name} is a dependency and must be listed in MANIFEST.md with its licence`);
  }
});

test('the README states what is unproven without hardware', () => {
  const readme = readFileSync(join(PACKAGE_ROOT, 'README.md'), 'utf8');
  assert.match(readme, /not been (run|tested) against (a )?(physical|real)/i);
  assert.match(readme, /ST25TV02KC/);
  assert.match(readme, /simulator/i);
});

test('the redirect table is read from the edge package rather than copied into this one', () => {
  const localCopies = SOURCES.filter((p) => p.endsWith('redirect-table.json'));
  assert.deepEqual(localCopies, [], 'the table has exactly one home and this is not it');
});
