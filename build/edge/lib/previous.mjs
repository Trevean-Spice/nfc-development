/**
 * The previously committed redirect table, for the repoint check.
 *
 * Read from git rather than from a checked in lock file, because the thing the
 * check protects against is a pull request, and the pull request's own baseline
 * is what git already has. A missing git history is not a failure; it means the
 * comparison has nothing to compare against and is skipped, which is reported
 * rather than passed over in silence.
 *
 * THE VACUOUS COMPARISON, and why this file now detects it.
 *
 * The base ref used to default to HEAD, unconditionally. That is right at a bench,
 * where HEAD is the last commit and the working tree holds the edit you are about
 * to propose. It is exactly wrong in CI, where the checkout IS HEAD: the table is
 * then compared against itself, every comparison succeeds by construction, and the
 * script reports "compared against HEAD", which reads like a comparison happened.
 * The repoint guard, the only thing standing between a one line edit and 1,000
 * shipped tags resolving somewhere else, had never compared anything.
 *
 * So the result now carries `compared` and `vacuous` as facts rather than leaving
 * them to be inferred from prose, and validate-table.mjs fails on either when
 * REDIRECT_TABLE_STRICT_REPOINT is set, which the workflow sets. Vacuous means the
 * base ref resolves to the same commit as HEAD AND the file at that commit is byte
 * identical to the working tree: nothing was compared. It deliberately does not
 * fire at a bench with an uncommitted edit against HEAD, which is the case where
 * comparing against HEAD is the useful thing to do.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { PATHS, PACKAGE_ROOT } from './table.mjs';

export const DEFAULT_BASE_REF = 'HEAD';

/**
 * @param {string} [ref] git ref to read the previous table from
 * @param {object} [options]
 * @param {string} [options.tablePath] the working tree table, for the vacuity check
 * @param {string} [options.cwd] where to run git
 * @returns {{table: object|null, reason: string, ref: string, compared: boolean, vacuous: boolean}}
 */
export function previousTable(
  ref = process.env.REDIRECT_TABLE_BASE_REF || DEFAULT_BASE_REF,
  options = {}
) {
  const tablePath = options.tablePath ?? PATHS.table;
  const cwd = options.cwd ?? PACKAGE_ROOT;

  const repoRoot = run(['rev-parse', '--show-toplevel'], cwd);
  if (repoRoot === null) {
    return { table: null, reason: 'not a git working tree', ref, compared: false, vacuous: false };
  }

  const pathInRepo = relative(repoRoot.trim(), tablePath).split('\\').join('/');
  const contents = run(['show', `${ref}:${pathInRepo}`], cwd);
  if (contents === null) {
    return {
      table: null,
      reason: `no ${pathInRepo} at ${ref}, so there is no committed baseline to compare against`,
      ref,
      compared: false,
      vacuous: false
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return { table: null, reason: `${pathInRepo} at ${ref} is not valid JSON`, ref, compared: false, vacuous: false };
  }

  // Same commit as HEAD, and the same bytes as the working tree, means the table was
  // compared with itself. That is not a passing check, it is an absent one.
  const refCommit = run(['rev-parse', `${ref}^{commit}`], cwd);
  const headCommit = run(['rev-parse', 'HEAD^{commit}'], cwd);
  const sameCommit = refCommit !== null && headCommit !== null && refCommit.trim() === headCommit.trim();
  const working = existsSync(tablePath) ? readFileSync(tablePath, 'utf8') : null;
  const sameBytes = working !== null && working === contents;

  if (sameCommit && sameBytes) {
    return {
      table: parsed,
      reason:
        `${ref} resolves to the checked out commit and the table there is byte identical to the working tree, ` +
        'so this compared the table with itself and proved nothing. Set REDIRECT_TABLE_BASE_REF to the branch ' +
        'this change will merge into, for example origin/main',
      ref,
      compared: true,
      vacuous: true
    };
  }

  return { table: parsed, reason: `compared against ${ref}`, ref, compared: true, vacuous: false };
}

/**
 * The repoint guard's own health, as an error string or null.
 *
 * Separate from validate() because it is a statement about whether the check ran at all,
 * not about the table's contents, and the two failures need different words in front of a
 * person deciding whether to deploy.
 */
export function repointGuardProblem(previous, options = {}) {
  if (previous.vacuous) {
    // Never excusable. This is the state that reports a comparison and performs none.
    return `The repoint guard ran vacuously: ${previous.reason}.`;
  }
  if (!previous.compared) {
    if (options.allowFirstCommit === true) return null;
    return (
      `The repoint guard did not run: ${previous.reason}. Nothing was compared, so a repointed code would pass. ` +
      'If this really is the commit that first puts the table under version control, set ' +
      'REDIRECT_TABLE_FIRST_COMMIT=1 on this one run, the same way allowRepoint makes a repoint ' +
      'something a person writes down rather than something that happens quietly.'
    );
  }
  return null;
}

function run(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  return result.stdout;
}
