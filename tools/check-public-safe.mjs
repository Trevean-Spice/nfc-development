#!/usr/bin/env node
/**
 * Checks that the files going into Trevean's PUBLIC repository carry no AWS
 * identifiers and no legal or export text.
 *
 * WHY THIS EXISTS. Trevean-Spice/nfc-development is public. The deployment
 * record that built this code names real AWS accounts, the Organization, its
 * root mailboxes, a Cognito pool and an ACM certificate. Those values live in
 * Trevean's private record (the private bundle, see
 * build/infrastructure/deploy-items/README.md). The public tree carries
 * placeholders such as <TREVEAN_ACCOUNT_ID> instead. A placeholder that one
 * edit turns back into a real value has no failing test unless something
 * scans for it, so this is that scan, and CI runs it on every pull request.
 *
 *   node tools/check-public-safe.mjs            the public paths (see PUBLIC)
 *   node tools/check-public-safe.mjs --all      every tracked file
 *   node tools/check-public-safe.mjs <path>...  just these files or folders
 *
 * WHAT IT REPORTS. file:line and the kind of finding. NEVER the value: the
 * output of this script goes into CI logs, which are public too.
 *
 * WHAT IT LOOKS FOR, by pattern, not by a list of real values (a list of real
 * values in a public file would be the leak):
 *
 *   aws-account-id     any standalone 12-digit number. A 12-digit tail of a
 *                      UUID, a decimal fraction, a phone number and the AWS
 *                      documentation dummies (123456789012, one digit
 *                      repeated) are not findings.
 *   aws-account-fragment  "tsn" plus 6 digits, the account suffix the dev
 *                      resource prefix was built from.
 *   aws-org-id         o-xxxxxxxxxx Organization ids and ou-xxxx-xxxxxxxx
 *                      organizational unit ids.
 *   root-email         a mailbox whose local part names aws or root, outside
 *                      the example.com/.org/.net and .test/.invalid domains.
 *   cognito-pool-id    region_xxxxxxxxx user pools and region:uuid identity
 *                      pools.
 *   acm-certificate    an ACM certificate ARN, or a UUID on a line that says
 *                      "certificate" or "acm".
 *   cloudfront-host    dxxxxxxxxxxxxx.cloudfront.net, except the AWS
 *                      documentation example d111111abcdef8.
 *   cloudfront-id      E plus 12 or 13 upper-case letters and digits, except
 *                      ids that contain EXAMPLE.
 *   export-text        OFAC, EAR99, ITAR, sanctions, export control, embargo.
 *   counsel-text       counsel, lawyer, attorney, legal advice, UNLESS a
 *                      licence or dependency is named within eight lines
 *                      (the licence reports and the BUSL notes are meant to
 *                      be read by Trevean's counsel, and that is fine).
 *   persian-sunrise-legal  legal advice or risk, compliance, customs or
 *                      Treasury wording within five lines of Persian Sunrise
 *                      or Iran, outside licence context. The
 *                      blend's provenance notes ("Isfahan, Iran", "no Iranian
 *                      ingredient") are content and are not findings.
 *
 * WHAT IT DOES NOT DO. It reads the files at this commit, not git history and
 * not commit messages; the history is cleaned and checked separately. It is
 * not a secret scanner.
 *
 * Exit 0 when nothing is found, 1 when anything is, 2 on a usage error.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// The paths this import brings into Trevean's repository. Everything else in
// the knowledge base this branch was cut from stays private and is dropped
// before the push. The frozen API contract comes too: the api, shopify,
// contract-tests and dashboard suites read it from that path.
const PUBLIC = [
  'build/',
  'tools/',
  '.github/',
  'deliverables/m1/01-api-contract.openapi.yaml',
  '.gitattributes',
  '.gitignore',
  'Start Tag Tool.cmd',
  'start-tag-tool.command',
];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'out', '.terraform', '.lambda-build']);
// This scanner and its tests describe the patterns, so they would match themselves.
// They hold no identifier values; the tests build every sample at run time.
const SELF = new Set(['tools/check-public-safe.mjs', 'tools/check-public-safe.test.mjs']);
const MAX_BYTES = 8 * 1024 * 1024;

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const DUMMY_ACCOUNTS = new Set(['123456789012', '210987654321']);
const LICENCE = /licen[cs]|\bBUSL\b|\bMIT\b|\bSPDX\b|copyleft|\bGPL|dependenc|third-party/i;

/** Each rule returns the match indexes that count as findings on one line. */
const LINE_RULES = [
  {
    kind: 'aws-account-id',
    re: /(?<![0-9A-Za-z_.+])[0-9]{12}(?![0-9A-Za-z_])/g,
    keep: (m, line) => {
      if (DUMMY_ACCOUNTS.has(m[0]) || /^(\d)\1{11}$/.test(m[0])) return false;
      // The 12-hex tail of a UUID that happens to be all digits.
      const before = line.slice(Math.max(0, m.index - 24), m.index);
      if (/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-$/.test(before)) return false;
      return true;
    },
  },
  { kind: 'aws-account-fragment', re: /tsn[0-9]{6}(?![0-9])/g },
  {
    kind: 'aws-org-id',
    re: /(?<![A-Za-z0-9-])(?:o-[a-z0-9]{10,32}|ou-[a-z0-9]{4,32}-[a-z0-9]{8,32})(?![A-Za-z0-9-])/g,
    // A real id mixes letters and digits; o-xxxxxxxxxx and o-exampleorgid do not.
    keep: (m) => /[0-9]/.test(m[0].slice(2)) && /[a-z]/.test(m[0].slice(2)),
  },
  {
    kind: 'root-email',
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    keep: (m) => {
      const [local, domain] = m[0].toLowerCase().split('@');
      if (!/aws|root/.test(local)) return false;
      return !/(^|\.)example\.(com|org|net)$|\.(test|invalid|example|localhost)$/.test(domain);
    },
  },
  {
    kind: 'cognito-pool-id',
    re: new RegExp(`(?<![A-Za-z0-9])(?:[a-z]{2}(?:-gov)?-[a-z]+-[0-9]_[A-Za-z0-9]{9}|[a-z]{2}(?:-gov)?-[a-z]+-[0-9]:${UUID})(?![A-Za-z0-9])`, 'g'),
    keep: (m) => !/EXAMPLE|xxxxxxxxx|XXXXXXXXX/.test(m[0]),
  },
  {
    kind: 'acm-certificate',
    re: new RegExp(`arn:aws[a-z-]*:acm:[^:\\s]*:[^:\\s]*:certificate/${UUID}`, 'g'),
  },
  {
    kind: 'acm-certificate',
    re: new RegExp(`(?<![0-9a-fA-F-])${UUID}(?![0-9a-fA-F-])`, 'g'),
    keep: (m, line) =>
      /certificate|\bacm\b/i.test(line) && !line.includes(`certificate/${m[0]}`) && !/^[0-]+$/.test(m[0].replace(/-/g, '')),
  },
  {
    kind: 'cloudfront-host',
    re: /(?<![A-Za-z0-9])d[a-z0-9]{12,14}\.cloudfront\.net/gi,
    keep: (m) => !/^d111111abcdef8\./i.test(m[0]),
  },
  {
    kind: 'cloudfront-id',
    re: /(?<![A-Za-z0-9_])E[0-9A-Z]{12,13}(?![A-Za-z0-9_])/g,
    keep: (m) => /[0-9]/.test(m[0]) && /[A-Z]/.test(m[0].slice(1)) && !m[0].includes('EXAMPLE'),
  },
  { kind: 'export-text', re: /\bOFAC\b|\bEAR99\b|\bITAR\b|\bsanction(?:s|ed)?\b|export[- ]control|\bembargo/gi,
    keep: (m) => !/^(ofac|ear99|itar)$/.test(m[0]) || m[0] === m[0].toUpperCase() },
];

const COUNSEL = /\b(?:counsel|lawyers?|attorneys?|legal advice)\b/i;
const PERSIAN = /Persian Sunrise|\bIran(?:ian)?\b/i;
const PERSIAN_LEGAL = /\blegal (?:advice|review|risk|exposure|opinion)|illegal|complian|\bcustoms\b|Treasury|counsel|lawyer|attorney|\bimport ban/i;

function trackedFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return out.split('\0').filter(Boolean);
  } catch {
    return walk(ROOT).map((p) => relative(ROOT, p).split(sep).join('/'));
  }
}

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) files.push(...walk(p));
    else if (s.isFile()) files.push(p);
  }
  return files;
}

function inScope(file, scopes) {
  return scopes.some((s) => (s.endsWith('/') ? file.startsWith(s) : file === s || file.startsWith(`${s}/`)));
}

function scanText(text) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const rule of LINE_RULES) {
      for (const m of line.matchAll(rule.re)) {
        if (!rule.keep || rule.keep(m, line)) findings.push({ line: i + 1, kind: rule.kind });
      }
    }
    if (COUNSEL.test(line)) {
      const near = lines.slice(Math.max(0, i - 8), i + 9).join('\n');
      if (!LICENCE.test(near)) findings.push({ line: i + 1, kind: 'counsel-text' });
    }
    if (PERSIAN_LEGAL.test(line)) {
      const near = lines.slice(Math.max(0, i - 5), i + 6).join('\n');
      if (PERSIAN.test(near) && !(LICENCE.test(near) && !/complian|customs|Treasury|import ban/i.test(line))) {
        findings.push({ line: i + 1, kind: 'persian-sunrise-legal' });
      }
    }
  });
  return findings;
}

export function scanFiles(files, root = ROOT) {
  const results = [];
  for (const file of files) {
    let buf;
    try {
      const st = statSync(join(root, file));
      if (!st.isFile() || st.size > MAX_BYTES) continue;
      buf = readFileSync(join(root, file));
    } catch {
      continue; // listed by git but deleted in the working tree
    }
    if (buf.subarray(0, 8000).includes(0)) continue; // binary
    for (const f of scanText(buf.toString('utf8'))) results.push({ file, ...f });
  }
  return results;
}

export { scanText };

function main(argv) {
  const all = argv.includes('--all');
  const paths = argv.filter((a) => !a.startsWith('--'));
  if (argv.some((a) => a.startsWith('--') && a !== '--all')) {
    console.error('usage: node tools/check-public-safe.mjs [--all] [path ...]');
    return 2;
  }
  const tracked = trackedFiles();
  const scopes = paths.length ? paths.map((p) => relative(ROOT, join(process.cwd(), p)).split(sep).join('/')) : PUBLIC;
  const files = (all ? tracked : tracked.filter((f) => inScope(f, scopes))).filter((f) => !SELF.has(f));
  const findings = scanFiles(files);

  const seen = new Set();
  for (const f of findings) {
    const key = `${f.file}:${f.line}: ${f.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(key);
  }
  const byKind = {};
  for (const f of findings) byKind[f.kind] = (byKind[f.kind] || 0) + 1;
  const scope = all ? 'every tracked file' : paths.length ? paths.join(', ') : 'the public paths';
  if (findings.length === 0) {
    console.log(`OK. ${files.length} file(s) in ${scope}, nothing found.`);
    return 0;
  }
  const files_ = new Set(findings.map((f) => f.file)).size;
  console.log(`FAIL. ${findings.length} finding(s) in ${files_} of ${files.length} file(s) in ${scope}:`);
  for (const [k, n] of Object.entries(byKind).sort()) console.log(`  ${k}: ${n}`);
  console.log('Replace each value with a placeholder such as <TREVEAN_ACCOUNT_ID>; the real value belongs in the private record.');
  return 1;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
