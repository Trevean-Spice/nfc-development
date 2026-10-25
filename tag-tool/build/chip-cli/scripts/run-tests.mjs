#!/usr/bin/env node
/**
 * Runs every compiled test file, on any Node version this package supports.
 *
 * `node --test dist/test/` worked on Node 20 and finds nothing on Node 22 and later,
 * which read the argument as a file name or a glob rather than a directory. Globs in
 * turn do not exist on Node 20. Listing the files here works on both, and on Windows,
 * where npm scripts run under cmd.exe and nothing expands a wildcard.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'test');
const files = readdirSync(dir)
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => join(dir, name));

if (files.length === 0) {
  console.error(`No compiled tests in ${dir}. Run "npm run build" first.`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
