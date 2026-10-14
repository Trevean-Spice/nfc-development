#!/usr/bin/env node
/**
 * Validate the canonical redirect table on its own, without compiling anything.
 *
 *   node scripts/validate-table.mjs
 *   REDIRECT_TABLE_BASE_REF=origin/main node scripts/validate-table.mjs
 *   REDIRECT_TABLE_STRICT_REPOINT=1 REDIRECT_TABLE_BASE_REF=origin/main node scripts/validate-table.mjs
 *
 * Run this as a required status check on any pull request that touches
 * redirect-table.json. It is fast enough to run on every commit and it is the
 * check that stops a transposed entry reaching a deployment.
 *
 * STRICT MODE, which CI sets and a bench does not.
 *
 * With REDIRECT_TABLE_STRICT_REPOINT set, a repoint comparison that did not happen
 * is an error rather than an informational line. Two ways it does not happen: there
 * is no committed copy of the table to compare against, or the base ref resolves to
 * the checked out commit and the table there is byte identical to the working tree,
 * which is the table compared with itself. Both used to print one sentence above
 * "All checks pass", which is how the guard that protects 1,000 shipped tags went a
 * whole engagement without ever comparing anything.
 *
 * The vacuous case has no escape hatch, because it is the one that reports a
 * comparison and performs none. The absent baseline case has exactly one,
 * REDIRECT_TABLE_FIRST_COMMIT=1, for the single commit that first puts the table
 * under version control. That is deliberately the same shape as allowRepoint in the
 * table itself: the dangerous thing is allowed only when a person writes it down.
 *
 * Strict mode is off by default, because at a bench the useful comparison IS against
 * HEAD with an uncommitted edit in the working tree, and that case is neither absent
 * nor vacuous.
 */

import { loadTable, summarise, PATHS, PACKAGE_ROOT } from '../lib/table.mjs';
import { validate } from '../lib/validate.mjs';
import { previousTable, repointGuardProblem } from '../lib/previous.mjs';
import { relative } from 'node:path';

const strictRepoint = process.env.REDIRECT_TABLE_STRICT_REPOINT === '1';
const table = loadTable();
const previous = previousTable();
const { errors, warnings } = validate(table, { previous: previous.table });
const counts = summarise(table);

const guardProblem = repointGuardProblem(previous, {
  allowFirstCommit: process.env.REDIRECT_TABLE_FIRST_COMMIT === '1'
});
if (guardProblem !== null) {
  if (strictRepoint) errors.push(guardProblem);
  else warnings.push(guardProblem);
}

console.log(`Redirect table: ${relative(PACKAGE_ROOT, PATHS.table).split('\\').join('/')}`);
console.log(`Version ${table.version}, status ${table.redirectStatus}, ${counts.codes} codes, ${counts.unitsEncoded} units encoded.`);
console.log(`Repoint check: ${previous.reason}.`);
console.log(
  `Repoint guard: ${guardProblem === null ? 'ran against a real baseline' : 'DID NOT RUN'}${strictRepoint ? ', strict mode on' : ', strict mode off'}.`
);
console.log('');

for (const entry of table.entries) {
  const tag = entry.status === 'encoded' ? `${entry.unitsEncoded} tags` : 'reserved, no tag in this run';
  console.log(`  ${entry.requestPath.padEnd(6)} -> ${entry.targetPath.padEnd(52)} ${tag}`);
}
console.log('');

for (const warning of warnings) console.warn(`  warn  ${warning}`);
for (const error of errors) console.error(`  FAIL  ${error}`);

if (errors.length > 0) {
  console.error(`\n${errors.length} problem${errors.length === 1 ? '' : 's'}. The table must not be deployed.\n`);
  process.exit(1);
}

console.log(`All checks pass.\n`);
