import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml, html, raw } from '../../src/views/html.js';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..', '..');

function walk(dir: string, into: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'data' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, into);
    else into.push(full);
  }
  return into;
}

const TEXT = ['.ts', '.js', '.css', '.md', '.json', '.html'];
const files = walk(packageRoot).filter((f) => TEXT.includes(extname(f)));

// Built from code points rather than written literally, so this file does not fail its own
// check. U+2013 en dash, U+2014 em dash.
const EN_DASH = String.fromCharCode(0x2013);
const EM_DASH = String.fromCharCode(0x2014);

describe('house style', () => {
  it('has no en dash and no em dash anywhere, including code comments and interface copy', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const lines = text.split(/\r?\n/);
      lines.forEach((line, i) => {
        if (line.includes(EN_DASH) || line.includes(EM_DASH)) {
          offenders.push(`${file.replace(packageRoot, '')}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('scanned a meaningful number of files, so a passing result is not an empty scan', () => {
    expect(files.length).toBeGreaterThan(20);
  });
});

describe('escaping', () => {
  it('escapes interpolated values by default', () => {
    const evil = '<script>alert(1)</script>';
    expect(html`<p>${evil}</p>`.value).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });

  it('escapes quotes so a value cannot break out of an attribute', () => {
    expect(escapeHtml('" onmouseover="alert(1)')).toBe('&quot; onmouseover=&quot;alert(1)');
  });

  it('emits raw only when raw is asked for by name', () => {
    expect(html`${raw('<b>bold</b>')}`.value).toBe('<b>bold</b>');
  });

  it('renders an array without a separator and drops null, undefined and false', () => {
    expect(html`${['a', null, undefined, false, 'b']}`.value).toBe('ab');
  });
});

describe('dependencies', () => {
  const manifest = readFileSync(join(packageRoot, 'MANIFEST.md'), 'utf8');
  const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  it('lists every direct dependency in MANIFEST.md, which is the background IP obligation', () => {
    for (const name of [...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)]) {
      expect(manifest, `${name} is not listed in MANIFEST.md`).toContain(name);
    }
  });

  it('keeps the runtime dependency count small enough to be a handoff rather than a liability', () => {
    expect(Object.keys(pkg.dependencies).length).toBeLessThanOrEqual(8);
  });
});
