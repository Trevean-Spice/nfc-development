#!/usr/bin/env node
/**
 * Trevean Spice NFC. Foundation assertions for the nfc-development repository.
 *
 * Destination: scripts/ci/assert-foundations.mjs
 * Runs in the Foundations job of .github/workflows/ci.yml, before any dependency install.
 *
 * WHY THIS EXISTS
 *
 * This repository had no CI at all until this consolidation. The defects CI is supposed
 * to catch had therefore been sitting in the default branch since June 2026 with nothing
 * to report them: two typos that stop jest parsing its own configuration, a typeRoots
 * setting that makes the root typecheck fail on one error and hide 326, three imports of
 * packages that are declared nowhere, two workspace manifests that do not exist, a lint
 * script for a linter that has no configuration file to start from, and no lockfile, so no
 * build is reproducible and no measurement is attributable.
 *
 * A CI system that installs and tests a repository in that state can go green while
 * proving nothing. This script runs first and refuses to let that happen. It reports every
 * failure it finds rather than stopping at the first, because a foundation problem is
 * usually several problems and fixing them one CI round trip at a time is how a day goes.
 *
 * No dependencies. Node standard library only. Node 20 or newer.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { builtinModules } from 'node:module';

const failures = [];
const notes = [];

const fail = (check, found, why, fix) => failures.push({ check, found, why, fix });
const read = (p) => readFileSync(p, 'utf8');

/**
 * Parse JSON that may carry // or block comments, as tsconfig files are allowed to.
 * Comments are stripped by a scanner rather than by a regular expression, because a
 * regular expression cannot tell a comment from a glob: "src/**\/*.ts" contains the
 * sequence that opens and closes a block comment, and a naive strip deletes the glob and
 * then reports a syntax error in a file that is perfectly valid.
 */
const readJsonc = (p) => {
  const src = read(p);
  let out = '';
  let i = 0;
  let inString = false;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (inString) {
      out += c;
      if (c === '\\') { out += next ?? ''; i += 2; continue; }
      if (c === '"') inString = false;
      i += 1;
      continue;
    }
    if (c === '"') { inString = true; out += c; i += 1; continue; }
    if (c === '/' && next === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return JSON.parse(out);
};

/* ------------------------------------------------------------ 1. the lockfile -- */

if (!existsSync('package-lock.json')) {
  fail(
    'Lockfile present',
    'package-lock.json does not exist',
    'Without a lockfile every dependency resolves fresh on every install, so no build is ' +
      'reproducible and no performance number, licence row or CI result is attributable to ' +
      'a commit. Demonstrated drift on this dependency set between two installs in August ' +
      '2026: express 4.18.2 declared resolved to 4.22.2, next ^14.0.0 to 14.2.35, ' +
      'typescript ^5.3.0 to 5.9.3.',
    'npm install, then commit package-lock.json. Every CI job uses npm ci, which cannot ' +
      'run without it.'
  );
}

/* ---------------------------------------------------- 2. one node version, pinned -- */

if (!existsSync('.nvmrc')) {
  fail(
    'Node version pinned',
    '.nvmrc does not exist',
    'package.json engines says node >=18, which is a floor rather than a pin. The contract ' +
      'test suite requires >=20.11.0 and the budget scripts require >=20, so a developer on ' +
      'Node 18 gets a different answer from CI.',
    'Create .nvmrc containing 20. The workflows read it with setup-node node-version-file, ' +
      'so the version developers use and the version CI uses cannot drift apart.'
  );
} else {
  const major = parseInt(read('.nvmrc').trim().replace(/^v/, ''), 10);
  if (!(major >= 20)) {
    fail(
      'Node version at or above 20',
      `.nvmrc pins ${major}`,
      'The contract test suite declares engines.node >=20.11.0 and the performance budget ' +
        'scripts declare >=20.',
      'Set .nvmrc to 20 or newer and update package.json engines to match.'
    );
  }
}

/* ------------------------------------------------- 3. every workspace has a manifest -- */

let pkg;
try {
  pkg = JSON.parse(read('package.json'));
} catch (e) {
  fail('Root package.json parses', String(e), 'Nothing else can be checked.', 'Fix the JSON.');
}

if (pkg) {
  for (const ws of pkg.workspaces || []) {
    if (!existsSync(join(ws, 'package.json'))) {
      fail(
        `Workspace manifest: ${ws}`,
        `${ws} is declared in package.json workspaces and ${ws}/package.json does not exist`,
        'npm tolerates a declared workspace whose manifest is absent, so this fails silently ' +
          'rather than loudly: the workspace is simply never installed, and anything that ' +
          'depends on it fails later with a module resolution error that names the module ' +
          'rather than the cause.',
        `Add ${ws}/package.json, or remove ${ws} from the workspaces array. Do not leave it ` +
          'declared and absent.'
      );
    }
  }
}

/* -------------------------------------------- 4. files that npm scripts point at exist -- */

const requiredFiles = [
  ['src/api/tsconfig.json', 'the build:api script runs tsc -p against it'],
  ['jest.config.ts', 'the test script runs jest --config against it'],
];

for (const [file, why] of requiredFiles) {
  if (!existsSync(file)) {
    fail(
      `Referenced file exists: ${file}`,
      `${file} does not exist`,
      `An npm script names it: ${why}. A script that targets a file that does not exist ` +
        'fails at the point of use rather than at the point of review.',
      `Add ${file}, or change the script that references it.`
    );
  }
}

/* ------------------------------------------------- 5. the jest configuration parses -- */

if (existsSync('jest.config.ts')) {
  const jestSrc = read('jest.config.ts');
  const badKeys = [
    ['coverageThresholds', 'coverageThreshold'],
    ['setupFilesAfterSetup', 'setupFilesAfterEnv'],
  ];
  for (const [wrong, right] of badKeys) {
    if (new RegExp(`(^|[\\s{,])${wrong}\\s*:`, 'm').test(jestSrc)) {
      fail(
        `jest.config.ts key: ${wrong}`,
        `jest.config.ts declares ${wrong}`,
        'The typed Config object rejects the key, so ts-jest fails to compile the ' +
          'configuration and jest exits before discovering a single test file. This is why ' +
          'npm test in this repository has never run a test: it fails while parsing its own ' +
          'configuration.',
        `Rename ${wrong} to ${right}.`
      );
    }
  }

  const setupMatch = jestSrc.match(/setupFilesAfter\w+\s*:\s*\[\s*'([^']+)'/);
  if (setupMatch) {
    const target = setupMatch[1].replace('<rootDir>/', '');
    if (!existsSync(target)) {
      fail(
        'jest setup file exists',
        `jest.config.ts points setupFilesAfterEnv at ${setupMatch[1]}, which does not exist`,
        'Correcting the key name without creating the file only moves the failure one line ' +
          'further down, which is how this defect survived: the first error masked the second.',
        `Create ${target}, or remove the setupFilesAfterEnv entry.`
      );
    }
  }
}

/* ----------------------------------------- 6. the linter has a configuration to read -- */

/* Same class of defect as checks 3 and 4, and it was missed in the first version of this */
/* script. The root manifest has declared eslint, @typescript-eslint/parser,              */
/* @typescript-eslint/eslint-plugin and eslint-config-prettier since June 2026, plus lint */
/* and lint:fix scripts to run them, and there has never been a configuration file        */
/* anywhere in the repository. ESLint does not report that as a lint failure. It refuses  */
/* to start: "ESLint couldn't find a configuration file". A CI job that runs it therefore  */
/* cannot go green for any diff, which is item one on the list of things this package      */
/* exists to stop.                                                                         */

const declaresEslint =
  pkg &&
  (Object.keys((pkg.devDependencies || {})).includes('eslint') ||
    Object.keys((pkg.dependencies || {})).includes('eslint') ||
    Object.keys(pkg.scripts || {}).some((s) => s === 'lint' || s === 'lint:fix'));

if (declaresEslint) {
  const eslintConfigs = [
    '.eslintrc.json',
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.eslintrc.yml',
    '.eslintrc.yaml',
    '.eslintrc',
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs',
  ];
  const found = eslintConfigs.find((f) => existsSync(f)) || (pkg.eslintConfig ? 'package.json eslintConfig' : null);

  if (!found) {
    fail(
      'ESLint configuration present',
      'package.json declares eslint and a lint script, and no ESLint configuration file exists',
      'Without a configuration ESLint does not run at all. It does not report zero problems ' +
        'and it does not report a lint failure: it exits with "ESLint couldn\'t find a ' +
        'configuration file", which is the linter refusing to start. Every invocation of ' +
        'npm run lint in this repository since June 2026 has ended that way, and a Lint job ' +
        'in CI would be red on every pull request with nothing any author could do about it.',
      'Add .eslintrc.json. The one written for this repository, with the reasoning for the ' +
        'quarantine list inside it, is build/consolidation/files/eslintrc.json. It adds no ' +
        'dependency: every package it references is already declared.'
    );
  }
}

/* --------------------------------------------------- 7. the root tsconfig settings -- */

if (existsSync('tsconfig.json')) {
  let ts;
  try {
    ts = readJsonc('tsconfig.json');
  } catch (e) {
    fail('tsconfig.json parses', String(e), 'Nothing downstream can be checked.', 'Fix the JSON.');
  }

  if (ts) {
    const co = ts.compilerOptions || {};
    const include = ts.include || [];

    if (Array.isArray(co.typeRoots) && co.typeRoots.some((r) => r.includes('src/shared/types'))) {
      fail(
        'tsconfig typeRoots',
        'compilerOptions.typeRoots lists ./src/shared/types',
        'typeRoots names directories whose SUBDIRECTORIES are treated as ambient @types ' +
          'packages. src/shared/types holds ordinary source modules (api.ts, index.ts), so ' +
          'listing it contributes nothing and hides the real problem: naming typeRoots at all ' +
          'keeps automatic inclusion of every package under node_modules/@types, including the ' +
          'deprecated @types/react-native stub hoisted from the mobile workspace. That is the ' +
          'TS2688 that made tsc --noEmit fail on its first error and report nothing else, so a ' +
          'developer running the project typecheck saw one unrelated error and read it as ' +
          '"almost clean" while 326 errors sat behind it.',
        'Delete typeRoots and declare an explicit types array instead: "types": ["node"] at ' +
          'the root. Reach the shared types through the existing @shared/* path mapping, ' +
          'which is what it is for.'
      );
    }

    if (Array.isArray(co.typeRoots) && !co.types) {
      notes.push(
        'tsconfig.json still uses typeRoots without an explicit types array. Every @types ' +
          'package in the tree is included globally, so a transitive devDependency can break ' +
          'the typecheck for work unrelated to it.'
      );
    }

    const includesTsx = include.some((p) => p.includes('.tsx'));
    if (includesTsx && !co.jsx) {
      fail(
        'tsconfig jsx',
        'include covers **/*.tsx and compilerOptions.jsx is not set',
        'Every .tsx file in the include set raises TS17004, "Cannot use JSX unless the --jsx ' +
          'flag is provided". Measured on this repository: 78 of 326 errors, all from a ' +
          'workspace the Scope document says not to build.',
        'Two parts. Set "jsx": "react-jsx" so a stray .tsx cannot reproduce this. Then stop ' +
          'the root project typechecking the web and mobile trees at all: they have their own ' +
          'compiler settings and their own projects.'
      );
    }

    if (include.some((p) => p.startsWith('src/**')) && !(ts.exclude || []).some((p) => p.includes('src/mobile'))) {
      fail(
        'Root project excludes src/mobile',
        'tsconfig.json includes src/** and does not exclude src/mobile',
        'src/mobile is out of scope per the Scope document, section "Out of scope, deferred ' +
          'not dropped". It does not build, it has no native projects and no entry point, and ' +
          'it contributed 78 type errors to a typecheck that everyone else has to read. ' +
          'Excluding it from the root project does not remove it from version control and ' +
          'loses nothing.',
        'Add "src/mobile" to the exclude array. This is a repository layout change and needs ' +
          'no client decision. Removing src/mobile from the workspaces array is a separate ' +
          'change that does need one.'
      );
    }
  }
}

/* ------------------------------------------------- 8. no undeclared bare imports -- */

const SCAN_DIRS = ['config', 'scripts', 'src/api', 'src/shared', 'src/web'];
// scripts/ci is excluded on purpose: these assertion scripts use the Node standard
// library only, so that the Foundations job can run before any dependency install.
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'coverage', '.git', 'ci']);

/**
 * CI TOOLING, EXCLUDED FROM THE .env.example COMPLETENESS CHECK ONLY.
 *
 * config/.env.example documents what the APPLICATION reads. The performance budget
 * scripts that PR 10 drops into scripts/ are CI tooling: their environment is declared in
 * .github/workflows/performance-budget.yml and it is meaningless on a developer machine.
 * Without this exclusion, PR 10 turns the Foundations job red by demanding that
 * BUDGET_BASE_URL, BUDGET_HTML_DIRS, BUDGET_STATIC_OPTIONAL and GITHUB_STEP_SUMMARY be
 * added to a file a developer copies to config/.env. Every job in ci.yml needs
 * foundations, so that is the whole CI system red at PR 10, for a reason no author of a
 * later pull request could fix. Found on 25 August 2026 by applying the sequence through
 * PR 10 rather than stopping at PR 7, which is the only way it surfaces.
 *
 * Scoped by path rather than by extension on purpose: src/web/next.config.js is also not
 * TypeScript, and it reads NEXT_PUBLIC_API_URL and NEXT_PUBLIC_BASE_PATH, which ARE
 * application configuration and must stay in the check.
 *
 * This exclusion applies to the environment variable derivation and to nothing else. The
 * undeclared import scan still covers these files, and they still pass it, because they
 * use the Node standard library only.
 */
const isCiTooling = (file) => /^scripts[\\/][^\\/]+\.mjs$/.test(file);
const ALIAS_PREFIXES = ['@shared/', '@api/', '@web/', '@mobile/', '@nfc/', '@config/', '@/'];
const builtins = new Set(builtinModules);

const walk = (dir) => {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (['.ts', '.tsx', '.js', '.mjs'].includes(extname(p))) out.push(p);
  }
  return out;
};

const declared = new Set();
const collectDeclared = (manifestPath) => {
  if (!existsSync(manifestPath)) return;
  const m = JSON.parse(read(manifestPath));
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(m[field] || {})) declared.add(name);
  }
  if (m.name) declared.add(m.name);
};

collectDeclared('package.json');
for (const ws of (pkg && pkg.workspaces) || []) collectDeclared(join(ws, 'package.json'));

const packageOf = (spec) => {
  if (spec.startsWith('node:')) return null;
  const parts = spec.split('/');
  return spec.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
};

const undeclared = new Map();
// The specifier is required to contain no whitespace. A module specifier never does, and
// without that constraint the word "from" inside an ordinary sentence in a string literal
// matches the closing quote of that literal and the opening quote of the next one.
const importRe = /(?:\bfrom|\brequire\(|\bimport\()\s*['"]([^'"\s]+)['"]/g;

for (const dir of SCAN_DIRS) {
  for (const file of walk(dir)) {
    const src = read(file);
    for (const m of src.matchAll(importRe)) {
      const spec = m[1];
      if (spec.startsWith('.') || spec.startsWith('/')) continue;
      if (ALIAS_PREFIXES.some((a) => spec.startsWith(a))) continue;
      const name = packageOf(spec);
      if (!name || builtins.has(name)) continue;
      if (declared.has(name)) continue;
      if (!undeclared.has(name)) undeclared.set(name, []);
      undeclared.get(name).push(file);
    }
  }
}

for (const [name, files] of undeclared) {
  fail(
    `Declared dependency: ${name}`,
    `${name} is imported at ${files.slice(0, 3).join(', ')}${files.length > 3 ? ` and ${files.length - 3} more` : ''} and is declared in no package.json`,
    'An undeclared import is not installed, so the file cannot compile and the module cannot ' +
      'be listed in the background-IP licence table that SOW section 7 requires. This is how ' +
      'the config layer in this repository came to be uncompilable: three packages imported, ' +
      'none declared, and two competing clients for the same service.',
    `Add ${name} to the dependencies of the manifest that owns those files, or remove the ` +
      'import. Then add its licence row to MANIFEST.md, because a dependency added without a ' +
      'row in that table is a defect.'
  );
}

/* ------------------------------------------------ 9. .env.example, and completeness -- */

const envCandidates = ['config/.env.example', '.env.example', 'src/web/.env.example'];
const envFile = envCandidates.find((p) => existsSync(p));

if (!envFile) {
  fail(
    '.env.example present',
    'no .env.example exists anywhere in the repository',
    'README.md line 83 and docs/DIRECTORY-GUIDE.md line 241 both instruct a new developer to ' +
      'copy config/.env.example, and the file has never been committed, so the documented ' +
      'setup path cannot be followed by anyone. Every environment variable this repository ' +
      'reads is therefore undocumented, and one of them fails open rather than loudly.',
    'Add config/.env.example listing every variable with a comment, a safe default where one ' +
      'exists, and no real value anywhere.'
  );
} else {
  const documented = new Set(
    read(envFile)
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.split('=')[0].trim())
  );

  const used = new Set();
  for (const dir of SCAN_DIRS) {
    for (const file of walk(dir)) {
      if (isCiTooling(file)) continue;
      for (const m of read(file).matchAll(/process\.env\.([A-Z0-9_]+)/g)) used.add(m[1]);
    }
  }

  const missing = [...used].filter((v) => !documented.has(v)).sort();
  if (missing.length) {
    fail(
      '.env.example is complete',
      `${missing.length} variable(s) are read from source and not documented in ${envFile}: ${missing.join(', ')}`,
      'A partial .env.example is worse than none: it reads as the complete list, so the ' +
        'variables it omits are discovered at run time, one restart at a time. One of the ' +
        'omissions in this repository fails open rather than loudly (an unset API_KEY makes ' +
        'the auth middleware log a warning and call next()).',
      `Add the missing names to ${envFile}. Never add a real value.`
    );
  }
}

/* ------------------------------------------ 10. .github/workflows holds real workflows -- */

const wfDir = '.github/workflows';
const workflows = existsSync(wfDir)
  ? readdirSync(wfDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  : [];

if (workflows.length === 0) {
  fail(
    'CI workflows exist',
    `${wfDir} contains no workflow file`,
    'As inherited, this directory held exactly one 2 byte .gitignore, while ' +
      'docs/DIRECTORY-GUIDE.md lines 335 to 348 documented two workflows in detail and ' +
      'README.md line 56 described the directory as containing them. Anyone reading the ' +
      'documentation rather than the file tree concluded CI existed.',
    'This script is itself run by ci.yml, so seeing this failure means the workflow was ' +
      'invoked from somewhere other than that directory. Adopt the workflow set from ' +
      'build/consolidation/workflows/.'
  );
}

/* ---------------------------------------------------------------------- report -- */

for (const n of notes) console.warn(`NOTE: ${n}`);

if (failures.length === 0) {
  console.log('Foundations: all checks passed.');
  console.log(`  lockfile, node pin, ${(pkg && pkg.workspaces ? pkg.workspaces.length : 0)} workspace manifest(s), jest config, eslint config, tsconfig, imports, .env.example, workflows.`);
  process.exit(0);
}

console.error('');
console.error(`FOUNDATIONS FAILED. ${failures.length} problem(s), all of them reported so none costs a second CI round trip.`);
console.error('');
for (const [i, f] of failures.entries()) {
  console.error(`${i + 1}. ${f.check}`);
  console.error(`   Found: ${f.found}`);
  console.error(`   Why it matters: ${f.why}`);
  console.error(`   Fix: ${f.fix}`);
  console.error('');
}
console.error('Nothing downstream of this job is trustworthy until these are cleared. A test');
console.error('run, a typecheck or a budget measurement taken on a repository in this state');
console.error('reports on a tree that nobody else will reproduce.');
process.exit(1);
