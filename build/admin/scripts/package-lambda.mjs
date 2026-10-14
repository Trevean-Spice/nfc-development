#!/usr/bin/env node
/**
 * Build the deployment package for the API Lambda functions.
 *
 * Written Thursday 27 August 2026, when the functions got an HTTP invoke path and there
 * was finally somewhere for this code to run. Until then eight functions in the deployed
 * environment carried the infrastructure placeholder, which answers 501.
 *
 * WHAT IT PRODUCES, and why the layout is what it is.
 *
 *   index.mjs                     re-exports the handler at the archive root, because the
 *                                 Terraform in build/infrastructure sets handler =
 *                                 "index.handler" for every function and that value is
 *                                 NOT in the ignore_changes list. Matching the convention
 *                                 here costs one file. Changing it there would mean the
 *                                 handler differs per function, which is a permanent
 *                                 divergence bought to save one file.
 *   package.json                  {"type":"module"} and nothing else. Without it Node
 *                                 reads every compiled .js under dist/ as CommonJS and
 *                                 the first `import` statement is a SyntaxError.
 *   dist/src/**                   the compiled application
 *   dist/openapi/openapi.yaml     loaded at startup by src/http/spec.ts, which resolves it
 *                                 relative to its own file. Validation is compiled from
 *                                 the frozen contract rather than retyped, so this file is
 *                                 not documentation in the bundle, it is the validator.
 *   dist/config/*.json            the version controlled redirect table and the stream
 *                                 filter, resolved the same relative way.
 *   node_modules/**               production dependencies only, installed from the lock
 *                                 file with npm ci --omit=dev. The test runner, the
 *                                 TypeScript compiler and the in process DynamoDB server
 *                                 do not ship.
 *
 * THE ARCHIVE IS WRITTEN BY HAND, in ~120 lines at the bottom of this file, and that
 * deserves a sentence. There is no zip on this machine, PowerShell's Compress-Archive has
 * historically written entry names with backslashes on Windows, and Lambda then unpacks a
 * single file called "dist\src\lambda.js" and reports a missing handler. Writing the
 * central directory here means the separator is a forward slash because this code puts one
 * there, on every platform, and the file mode is 0644 because this code sets it.
 *
 * Node standard library only. No new dependency, which is deliberate: this script exists to
 * ship the dependency list, so it is the one place that must not add to it.
 *
 * Usage:
 *   node scripts/package-lambda.mjs
 *   node scripts/package-lambda.mjs --out ../../some/path/api.zip
 *   node scripts/package-lambda.mjs --skip-install     # reuse the staged node_modules
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const flag = (name) => argv.includes(name);

const STAGE_DIR = path.join(ROOT, '.lambda-build', 'stage');
const OUT = path.resolve(ROOT, opt('--out', path.join('.lambda-build', 'admin.zip')));

/* ------------------------------------------------------------------ helpers */

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else if (entry.isFile()) fs.copyFileSync(src, dst);
  }
}

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    // Symlinks are not followed and not preserved. npm creates them for bin
    // shims, which a Lambda never executes.
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

/* ------------------------------------------------------------ 1. compile TS */

console.log('compiling TypeScript');
run('npm', ['run', 'build'], ROOT);

const DIST = path.join(ROOT, 'dist');
if (!fs.existsSync(path.join(DIST, 'src', 'lambda.js'))) {
  console.error('REFUSED: dist/src/lambda.js was not produced by the build. Nothing to package.');
  process.exit(1);
}

/* -------------------------------------------- 2. production dependency tree */

const lock = path.join(ROOT, 'package-lock.json');
const lockHash = createHash('sha256').update(fs.readFileSync(lock)).digest('hex');
const marker = path.join(STAGE_DIR, '.node-modules-from-lock');
const stagedLock = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim() : null;

if (flag('--skip-install') && fs.existsSync(path.join(STAGE_DIR, 'node_modules'))) {
  console.log('reusing staged node_modules (--skip-install)');
} else if (stagedLock === lockHash) {
  console.log('staged node_modules already matches package-lock.json');
} else {
  console.log('installing production dependencies (npm ci --omit=dev)');
  fs.rmSync(STAGE_DIR, { recursive: true, force: true });
  fs.mkdirSync(STAGE_DIR, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(STAGE_DIR, 'package.json'));
  fs.copyFileSync(lock, path.join(STAGE_DIR, 'package-lock.json'));
  run('npm', ['ci', '--omit=dev', '--ignore-scripts'], STAGE_DIR);
  fs.writeFileSync(marker, lockHash);
}

/* ------------------------------------------------------------ 3. stage code */

console.log('staging application files');
for (const stale of ['dist', 'index.mjs']) {
  fs.rmSync(path.join(STAGE_DIR, stale), { recursive: true, force: true });
}

copyDir(path.join(DIST, 'src'), path.join(STAGE_DIR, 'dist', 'src'));
copyDir(path.resolve(ROOT, '..', 'api', 'openapi'), path.join(STAGE_DIR, 'api', 'openapi'));
copyDir(path.resolve(ROOT, '..', 'content'), path.join(STAGE_DIR, 'content'));

// The stylesheets and the upload script. @fastify/static serves these from
// packageRoot/public, so without them the deployed admin renders correct HTML with
// no styling at all and a 404 on every asset. The API bundle this script was adapted
// from has no static assets, which is why the line was missing.
copyDir(path.join(ROOT, 'public'), path.join(STAGE_DIR, 'public'));

fs.writeFileSync(
  path.join(STAGE_DIR, 'index.mjs'),
  [
    '// Generated by scripts/package-lambda.mjs. Not source.',
    '//',
    '// The Terraform in build/infrastructure sets handler = "index.handler" on every',
    '// function, so the archive root has to answer to that name. Both handlers are',
    '// exported from here: the API functions are configured with index.handler and the',
    '// one handler here, unlike the API bundle, because the admin is one service.',
    "export { handler } from './dist/src/lambda.js';",
    '',
  ].join('\n'),
);

// The nearest package.json decides whether a .js file is ESM or CommonJS, and every
// compiled file under dist/ uses import syntax. Only "type" is carried over: name,
// version, scripts and the dependency list are not read at runtime and a stale copy of
// them in the artifact is one more thing that can disagree with the real one.
fs.writeFileSync(
  path.join(STAGE_DIR, 'package.json'),
  JSON.stringify({ name: '@trevean/admin-cms-bundle', private: true, type: 'module' }, null, 2) + '\n',
);

/* --------------------------------------------------------------- 4. archive */

const entries = walk(STAGE_DIR)
  .filter((name) => name !== '.node-modules-from-lock' && name !== 'package-lock.json')
  .sort();

console.log(`archiving ${entries.length} files`);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, buildZip(STAGE_DIR, entries));

const bytes = fs.statSync(OUT).size;
const sha = createHash('sha256').update(fs.readFileSync(OUT)).digest('base64');
console.log(`\nwrote  ${OUT}`);
console.log(`bytes  ${bytes} (${(bytes / 1048576).toFixed(1)} MiB)`);
console.log(`sha256 ${sha}`);
console.log('\nThat sha256 is the value AWS reports as CodeSha256 once the package is deployed.');

/* ------------------------------------------------------------- the zip file */

// Built on first use rather than at module load, and declared with var rather than let or
// const. This section sits BELOW the code that calls it, and only function declarations and
// var hoist: let and const are in their temporal dead zone until execution reaches them, so
// either one here throws when buildZip runs. The alternative is moving the whole archive
// section above the steps that use it, which puts 120 lines of zip format between the file
// header and the first thing the script does.
var crcTable;

function crc32(buffer) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buffer.length; i += 1) c = crcTable[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/**
 * A minimal but correct zip writer.
 *
 * Deterministic on purpose: the modification time on every entry is a fixed value rather
 * than the clock, so the same inputs produce a byte identical archive and the same
 * CodeSha256. That is what lets "is the deployed package the one I built" be answered by
 * comparing two hashes instead of by trusting a deployment log.
 *
 * No zip64. It is not needed below 65,535 entries and 4 GiB, and this package is two
 * orders of magnitude under both, but the count is asserted rather than assumed because
 * the failure mode of silently overflowing a 16 bit field is an archive that unpacks
 * short.
 */
function buildZip(root, names) {
  if (names.length > 0xffff) {
    throw new Error(`${names.length} entries exceeds the 65,535 the non zip64 central directory can address.`);
  }

  // 1980-01-01 00:00:00 in MS-DOS date and time fields.
  const DOS_TIME = 0;
  const DOS_DATE = 33;

  const locals = [];
  const central = [];
  let offset = 0;

  for (const name of names) {
    const nameBytes = Buffer.from(name, 'utf8');
    const contents = fs.readFileSync(path.join(root, name));
    const deflated = deflateRawSync(contents, { level: 9 });
    // Storing is smaller than deflating for already compressed or tiny files.
    const stored = deflated.length >= contents.length;
    const payload = stored ? contents : deflated;
    const method = stored ? 0 : 8;
    const crc = crc32(contents);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags. Bit 11 (UTF-8) is unset: every name here is ASCII.
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(contents.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, payload);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    // Version made by: 3 (Unix) << 8 | 20. The high byte is what makes the external
    // attributes below be read as a Unix mode rather than as DOS attribute bits.
    dir.writeUInt16LE((3 << 8) | 20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(DOS_TIME, 12);
    dir.writeUInt16LE(DOS_DATE, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(payload.length, 20);
    dir.writeUInt32LE(contents.length, 24);
    dir.writeUInt16LE(nameBytes.length, 28);
    dir.writeUInt16LE(0, 30); // extra
    dir.writeUInt16LE(0, 32); // comment
    dir.writeUInt16LE(0, 34); // disk
    dir.writeUInt16LE(0, 36); // internal attributes
    // 0100644: a regular file, readable by everyone, writable by nobody. A Lambda only
    // ever reads its own package.
    //
    // Multiplied rather than shifted. JavaScript's << coerces to a SIGNED 32 bit integer,
    // so 0o100644 << 16 is negative and writeUInt32LE rejects it.
    dir.writeUInt32LE(0o100644 * 0x10000, 38);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBytes);

    offset += local.length + nameBytes.length + payload.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuffer, end]);
}
