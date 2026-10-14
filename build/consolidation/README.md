# Consolidation package for `nfc-development`

**Prepared by:** Serene Labs Inc (Jacob Ralph)
**For:** Dan Blizinski, Trevean Spice
**Document date:** Saturday 22 August 2026
**Revised:** Tuesday 25 August 2026, after the whole sequence was applied to a scratch copy
and every gate was run. Four pull request positions changed. See
`00-pull-request-order.md`, section 6.
**Revised again:** Thursday 27 August 2026. **The contract test suite is no longer adopted
red.** The `pageVersion` bound was applied to the frozen OpenAPI document that day and the
suite runs 202 of 202. Sections 3.3 and 4.2 here, and the PR 9 section of
`00-pull-request-order.md`, all said to expect one failure and no longer do. Nothing else
in this package changed and no pull request position moved.
**Scheduled:** the M3 window, per M2 plan section 1.2, at 23 to 37 hours
**Applies to:** the `nfc-development` repository, default branch `main`, HEAD `2220c43`

> **Nothing in `nfc-development` has been modified.** This package was written by reading
> it and verified by copying it out with `git archive HEAD`. It is a set of branches
> waiting to be cut, not a change that has been made. `git status --porcelain` in the client
> repository is empty and HEAD is unchanged.

---

## 1. What this is, in one paragraph

The client repository has no continuous integration: `.github/workflows/` contains one
2 byte `.gitignore` and nothing else. It also has a set of defects that make CI pointless
until they are fixed, because a pipeline that installs a floating dependency tree, typechecks
a project that fails on its first configuration error, runs a linter that has no
configuration to start from, and runs a test suite that dies in its own parser is a pipeline
that reports nothing. This package contains a working CI workflow
set, an ordered plan for adopting it as twelve reviewable pull requests, and the exact
patches for the nine foundational fixes that have to land first. **The design rule
throughout is that a green build on a repository where nothing executes is worse than no CI**,
so every gate here is written to fail loudly and legibly rather than to pass vacuously.

---

## 2. What is in this directory

| Path | What it is |
|---|---|
| `00-pull-request-order.md` | **Start here.** Twelve pull requests, why each is where it is, what breaks if the order changes, and three corrections to the audit found while verifying it |
| `01-foundational-patches.md` | The nine foundational fixes, exactly. Which are mechanical, which need judgement, and who makes the judgement |
| `02-test-suite-decision.md` | The call on the 2,102 line test suite, the argument for it, and what replaces it |
| `03-slug-fix.md` | `the-silk-road` becomes `silk-road`, with every location and the guard that keeps it |
| `04-react-native-workspace.md` | The mobile workspace, the split that lets most of it land without asking, and the words to send Dan |
| `05-document-status-headers.md` | Exact status headers for five misleading documents, `NFC-SPECS.md` split out and sent first because its worst outcome is scrapped inventory |
| `MANIFEST.md` | Every third-party action and library with its licence, for the SOW section 7 background-IP obligation |
| `workflows/ci.yml` | Foundations, typecheck, lint, tests, build. **Five jobs. The Guards job is a separate patch and arrives in PR 8** |
| `workflows/contract-tests.yml` | The frozen API contract, enforced. Adapted from the live version. **PR 9**, with the suite and the document it needs |
| `workflows/performance-budget.yml` | The per-page byte and speed budget. Adapted from the M1 CI package. **PR 10**, with the scripts and the budget file it needs |
| `scripts/assert-foundations.mjs` | Ten foundation checks. Runs before any install, reports every failure at once |
| `scripts/assert-tests-executed.mjs` | Proof that the test run executed tests, rather than that jest exited zero. Treats "no tests found" as a first class outcome and hands it to the dated floor |
| `scripts/assert-slugs.mjs` | Blend slugs against the canonical redirect table. **PR 8** |
| `files/` | The concrete artifacts: corrected `tsconfig.json`, `jest.config.ts` and `.eslintrc.json`, the two absent manifests, `.env.example`, `.nvmrc`, `.npmrc`, `.gitignore`, `test-floor.json`, and three patch documents |

---

## 3. Adopting it

### 3.1 Before anything

**Confirm write access and branch protection rights on `nfc-development`.** Seven of the
twelve pull requests are worth little without the ability to mark a status check required,
because a check that reports rather than enforces is a check people learn to scroll past.

**Read `00-pull-request-order.md` in full before cutting the first branch.** Three of the
orderings are load bearing and one of them is about habit rather than dependencies, which is
the one most likely to be traded away under time pressure.

### 3.2 Where each file goes

**Every row carries the pull request it belongs to. Nothing here is copied "whenever".**

```
PR 1
  files/nvmrc                       ->  .nvmrc
  files/npmrc                       ->  .npmrc          (deleted again in PR 11)
  files/gitignore                   ->  .gitignore

PR 3
  files/src-api-package.json        ->  src/api/package.json
  files/src-api-tsconfig.json       ->  src/api/tsconfig.json
  01-foundational-patches.md sec 8  ->  the ten Redis.Redis sites in six files under src/api

PR 4
  files/tsconfig.root.json          ->  tsconfig.json
  files/jest.config.ts              ->  jest.config.ts
  files/eslintrc.json               ->  .eslintrc.json

PR 5
  files/config-env.example          ->  config/.env.example

PR 6
  files/test-floor.json             ->  ci/test-floor.json

PR 7
  workflows/ci.yml                  ->  .github/workflows/ci.yml       (five jobs)
  scripts/assert-foundations.mjs    ->  scripts/ci/assert-foundations.mjs
  scripts/assert-tests-executed.mjs ->  scripts/ci/assert-tests-executed.mjs

PR 8
  build/edge/redirect-table.json    ->  config/redirect-table.json     (temporary copy)
  scripts/assert-slugs.mjs          ->  scripts/ci/assert-slugs.mjs
  files/ci-guards-job.patch.md      ->  the Guards job, inserted into .github/workflows/ci.yml

PR 9
  build/contract-tests/             ->  contract-tests/
  deliverables/m1/01-api-contract.openapi.yaml
                                    ->  docs/api/01-api-contract.openapi.yaml
  workflows/contract-tests.yml      ->  .github/workflows/contract-tests.yml

PR 10
  deliverables/m1/06-performance-budget-ci/budget.json  ->  budget.json
                                       plus the urls.directPages edit, see the plan, PR 10
  deliverables/m1/06-performance-budget-ci/scripts/*    ->  scripts/
  workflows/performance-budget.yml  ->  .github/workflows/performance-budget.yml
```

**The three workflow files and the three assertion scripts do not travel together, and that
is the point.** A job lands in the same pull request as the thing it measures. `ci.yml` at
PR 7 has five jobs and every one of them can be green; the `Guards` job, `contract-tests.yml`
and `performance-budget.yml` each wait for their own inputs. The reasoning is in
`00-pull-request-order.md`, section 6.

Four files carry their reasoning inside them in a key that the tool ignores
(`tsconfig.root.json`, the two `src-api-*` manifests and `eslintrc.json` use `//` or
`$comment`). That is deliberate: the reviewer of the pull request should not have to open a
second document, and the next reader should not have to ask. Leave the blocks in place. The
one exception is `src/api/package.json`. Its own last line says to remove the `$comment` key
before committing and an earlier version of this section said to leave every block in place,
which left the person applying PR 3 to choose. **Follow the file: remove that one key.** It
is a manifest rather than a configuration file, `package.json` has no comment convention,
and the reasoning is duplicated in `01-foundational-patches.md` sections 2 and 3. The `//`
blocks in `tsconfig.root.json`, `src-api-tsconfig.json` and `eslintrc.json` all stay:
TypeScript and ESLint both parse JSONC, verified by running `tsc` and `eslint` against those
exact files with the blocks present.

### 3.3 Branch protection, which is the step that turns this into a gate

**Each check is marked required after the pull request that makes it able to pass, never
before.** A required check that no author can turn green blocks every open branch until the
pull request that fixes it merges, and it teaches the team in the same week that a red check
is something you wait out.

| Check | From | Required after | Why not earlier |
|---|---|---|---|
| `Foundations` | `ci.yml` | PR 7 | It is green from the pull request that introduces it |
| `Typecheck` | `ci.yml` | PR 7 | Green because PR 3 cleared the ten `TS2702` sites and PR 6 removed the eight suites |
| `Lint` | `ci.yml` | PR 7 | Green because PR 4 added `.eslintrc.json`. Before PR 4 the linter does not start at all |
| `Tests` | `ci.yml` | PR 7 | Green under the dated zero floor in `ci/test-floor.json`, loudly and with an expiry |
| `Build` | `ci.yml` | PR 7 | Green because `src/api/tsconfig.json` exists **and** the project it configures compiles |
| `Guards` | `ci.yml` | **PR 8** | The job arrives in PR 8. `assert-slugs.mjs` needs `config/redirect-table.json` and needs the older blend spelling to be gone, and both are PR 8. An earlier version of this table said PR 7 |
| `Contract tests against the stub` | `contract-tests.yml` | **PR 9** | **Green on adoption since Thursday 27 August 2026.** It was red on one test, `pageVersion` unbounded above, from 17 August until that bound was applied to the frozen document. Observed on 27 August: 202 of 202. **If it is red when you adopt it, the document has drifted and that is the finding, not a known state to accept** |
| `Static budget` | `performance-budget.yml` | PR 10 | Green with warnings on adoption. Verified rather than predicted |
| `Budget at 375 px`, `Budget at 428 px` | `performance-budget.yml` | PR 10 | Only after `budget.json` `urls.directPages` is set to the route shape this repository serves, which is part of PR 10. See the plan, PR 10 |
| `Tap-path budget at 375 px`, `at 428 px` | `performance-budget.yml` | **when the redirect exists.** The job fails and tells you when that day comes. See section 5 |

**This is the step most often skipped, and skipping it converts the whole package into a
report.**

### 3.4 Running it locally

```bash
node scripts/ci/assert-foundations.mjs
node scripts/ci/assert-slugs.mjs                          # from PR 8
npx eslint 'src/**/*.{ts,tsx}' 'config/**/*.ts' 'scripts/**/*.ts' --max-warnings=0
npx jest --config jest.config.ts --ci --json --outputFile=jest-results.json 2>&1 | tee jest-output.txt
node scripts/ci/assert-tests-executed.mjs --results jest-results.json --floor ci/test-floor.json \
  --jest-output jest-output.txt --jest-exit-code $?
```

The first two need no install and take under a second. **Pass `--jest-output`.** Without it
the assertion script cannot tell a jest that found no tests from a jest that crashed, and it
will say so rather than guess.

---

## 4. What was verified, and how

Not "reviewed". Run.

**Method.** `git archive HEAD` from `nfc-development` into a scratch directory outside any
working tree, to avoid touching the repository and to avoid OneDrive locking. The client
repository was opened read only throughout: `git status --porcelain` in it is empty and HEAD
is unchanged at `2220c43`. Node 20.19.0, npm 10.8.2.

### 4.1 The scripts, in isolation

| What | Result |
|---|---|
| `assert-foundations.mjs` against the repository **as inherited** | **16 problems reported**, in one pass, each with what is wrong, why it matters and the exact fix. Exit 1. Sixteen rather than fifteen: the absent ESLint configuration is now one of them |
| `assert-foundations.mjs` against the same tree with PRs 1 to 6 applied | **All checks passed.** Exit 0. The consolidation passes its own gate |
| `assert-slugs.mjs` before the rename, table present | Found exactly 5 occurrences of `the-silk-road`, in 3 files, at the line numbers listed in `03-slug-fix.md`. Exit 1 |
| `assert-slugs.mjs` after the rename | `Slug guard passed: 5 canonical slugs, no forbidden spellings`. Exit 0 |
| `assert-slugs.mjs` after the `Guards` job block is inserted into `ci.yml` | Still exit 0. The guard scans `.yml`, and that block discusses the forbidden spelling without quoting it |
| `assert-tests-executed.mjs`, no result file and jest did **not** report an empty run | Fails, states that it cannot classify the cause, points at the jest step's own output, and offers the historic jest configuration defect as history rather than as diagnosis |
| `assert-tests-executed.mjs`, no result file and jest reported "No tests found" | **Passes under the dated zero floor**, printing the floor, the reason and the expiry. This is the state between PR 6 and the replacement suite |
| `assert-tests-executed.mjs`, 8 suites failing to compile, 0 tests | Fails on **both** counts: suites that could not run at all, and zero tests against the floor |
| `assert-tests-executed.mjs`, zero floor with no expiry | **Refuses.** A zero floor that cannot expire is rejected outright |
| `assert-tests-executed.mjs`, zero floor past its expiry | Fails, quoting the recorded reason and the date |
| `assert-tests-executed.mjs`, zero floor inside the window | Passes, after printing "This job CANNOT FAIL while that is true" |
| `assert-tests-executed.mjs`, 202 tests against a floor of 150 | Passes, and advises raising the floor |
| Does npm object to a declared workspace with no manifest? | **No.** npm 10.8.2, minimal reproduction, installs with no error and no warning. That is why the check exists |

### 4.2 The sequence, end to end

Added 25 August 2026, because the first version of this package verified the foundations
script and then made three written claims about what the other gates would do. Two of the
three were wrong. The whole sequence was applied to the scratch copy, in order, and every
gate run at the pull request that introduces it.

| At | Command | Observed |
|---|---|---|
| PR 1 | `npm install` | Exit 0, `package-lock.json` written, 1,261 packages. `ERESOLVE` does not occur because `.npmrc` sets `legacy-peer-deps` |
| PR 3, before the Redis fix | `npx tsc --noEmit -p src/api/tsconfig.json` | **Exit 2. Ten `TS2702`** across six files, all `Redis.Redis` |
| PR 3, after it | same command | **Exit 0**, no output |
| PR 4 | `npx tsc --noEmit -p tsconfig.json` | Exit 2, **27 errors, every one inside `tests/`**. This is the evidence PR 6 rests on, seen from the compiler |
| PR 4 | `npx tsc --noEmit -p src/web/tsconfig.json` | Exit 0 |
| PR 4 | `npx eslint 'src/**/*.{ts,tsx}' 'config/**/*.ts' 'scripts/**/*.ts' --max-warnings=0` | **Exit 0**, no output. With the quarantine block emptied: 14 problems in 9 files, exit 1. With an unused variable added to `src/api/server.ts`: named, exit 1 |
| PR 6, before deletion | `npx jest --config jest.config.ts --ci` | `Test Suites: 8 failed, 8 total. Tests: 0 total`. Exit 1. This is the run pasted into PR 6 |
| PR 6, after deletion | the same, plus the gate | jest exits 1 with "No tests found" and writes no result file. **The gate exits 0** under the dated zero floor, having said so loudly |
| **PR 7, all five jobs** | `assert-foundations.mjs`, `npm ci`, three `tsc` invocations, `eslint`, `jest` plus the gate, `npm run build`, the pre-render count | **Every one exit 0.** Pre-rendered blend pages: 5 |
| PR 8 | `assert-slugs.mjs`, then all six jobs again | Guard exit 1 before the rename, exit 0 after. All six jobs exit 0. Pre-rendered pages still 5, with `the-silk-road.html` now `silk-road.html` |
| PR 9 | `npm ci` and `npm run typecheck` in `contract-tests/` | Exit 0, 10 packages |
| PR 9 | `npm run test:stub` against the checked-in OpenAPI document | **202 of 202 pass, none fail.** Exit 0. **Re-run Thursday 27 August 2026.** The 25 August run was 201 of 202, failing on `pageVersion` unbounded above; that bound was applied to the frozen document on 27 August and the suite went green. See the contract errata, section 15 |
| PR 10 | `check-static-budget.mjs` with the workflow's own env | **Exit 0.** 8 pages, HTML 3.1 KB against 14.0 KB, inline CSS 0.0 KB against a 9.0 KB ceiling, 8 render-blocking-stylesheet warnings |
| PR 10 | the direct-page URL reality check, application running | `/blend.html?blend=...` returns 404 twice; `/blend/persian-sunrise` and `/blend/silk-road` return 200. Hence the `budget.json` edit in PR 10 |
| **PR 10, all six `ci.yml` jobs re-run** | `assert-foundations.mjs`, `assert-slugs.mjs`, three `tsc` invocations, `eslint`, `jest` plus the gate | Foundations **failed** on four CI-only environment variables the budget scripts introduced. Fixed in the script, see 4.3 item 5. After the fix: **every one exit 0**, and the check is still live against an undocumented application variable |

**Not run, and said rather than glossed:** the four Lighthouse jobs in
`performance-budget.yml` need Chrome and a Linux runner. Everything upstream of Lighthouse in
each of them was run, including the URL reality check that gates the measurement, because
those are the steps that fail for ordering reasons. The Lighthouse assertions fail or pass on
the numbers, which is what they are for.

### 4.3 Defects in this package found by running it

Four in the scripts, all fixed, all recorded here rather than quietly corrected, because a
checker that has never been run against a real repository is a checker with unknown
behaviour, which is the same criticism this package makes of the test suite it deletes.

1. A comment stripper that mangled `"src/**/*.ts"`, because a glob contains the sequence
   that opens and closes a block comment.
2. An import scanner that matched the word "from" inside an English sentence in a string
   literal.
3. `assert-tests-executed.mjs` treated an absent result file as a crash and named two jest
   configuration typos that PR 4 had already fixed. For the whole dated zero window the Tests
   check would have been red with an explanation that was false, and the floor would never
   have engaged. It now classifies the run from jest's own output.
4. `assert-foundations.mjs` had no check for an ESLint configuration, so the defect that
   makes the Lint job impossible was invisible to the tool written to find exactly that class
   of defect.
5. `assert-foundations.mjs` derived environment variables from `scripts/` without
   distinguishing application code from CI tooling, so PR 10's four budget scripts made the
   `.env.example` completeness check fail on `BUDGET_BASE_URL`, `BUDGET_HTML_DIRS`,
   `BUDGET_STATIC_OPTIONAL` and `GITHUB_STEP_SUMMARY`. Every job needs `foundations`, so
   that was the whole CI system red at PR 10. **This one only appears if you run the sequence
   to the end.** Stopping at PR 7, where every gate is green, hides it.

And four in the documents, all fixed: the ordering claims corrected in
`00-pull-request-order.md` section 6, and a five line transcript in
`files/ci-guards-job.patch.md` that gave one of the two-letter codes as `nn` when the
canonical table says `nm`. That transcript had been composed rather than copied. **A quoted
run that was not run is the same defect as a claim of green that was not run**, and this
package exists to argue against it.

---

## 5. How this CI avoids passing vacuously

The concrete mechanisms, in one place, because it is the thing the package is for.

| Vacuity mode | What stops it |
|---|---|
| Install silently re-resolves the tree | `npm ci`, never `npm install`. It refuses without a lockfile and refuses against a lockfile that disagrees with `package.json` |
| Six jobs each fail with a different npm stack trace | Every job depends on `Foundations`, which runs before any install and produces one legible message |
| jest exits zero having discovered nothing | `passWithNoTests: false` written down explicitly, plus a committed floor in `ci/test-floor.json` |
| Suites that fail to COMPILE read as "0 tests failed" | The gate reads `numRuntimeErrorTestSuites` from the result file and fails on it. This is the exact shape of the failure in this repository |
| jest dies before writing a result file, and the step is read as a flake | Absence of the result file is its own named failure with the reproduce command. The workflow captures jest's output so the script can tell a crash from an empty run, and it refuses to guess when that capture is missing |
| A gate goes red for a reason no author can fix, and the team learns to merge past red | Every check is marked required only after the pull request that makes it able to pass, and every job ships in the same pull request as the thing it measures. See section 3.3 |
| A linter that is configured to run and has no configuration to run from | The foundations check fails if a manifest declares a linter and a `lint` script and no configuration file exists anywhere. This is how the Lint job came to be impossible in the first version of this package |
| A temporary zero floor becomes permanent | A zero floor without an expiry is refused; with one, it warns on every build and fails the day after |
| Coverage percentage gate that cannot be met, so it gets disabled | Not adopted. Replaced by an executed-test floor that ratchets. The reasoning is in `files/jest.config.ts` |
| A Lighthouse score taken against a 404 | The direct-phase job curls every URL in `budget.json` first and fails on anything that is not a 200 |
| A byte budget passing because no HTML was found | `BUDGET_STATIC_OPTIONAL` is deliberately not set, so an empty search fails rather than warns |
| An advisory check that stays advisory forever | The tap-path job probes `/t/ps` before measuring and **fails** if the redirect now answers, printing the two line edit that arms the gate. It also fails on a 301 or 308, because a permanent redirect on shipped tags is its own defect |
| A slug rename quietly reverted | `assert-slugs.mjs` runs on every pull request, needs no install, and reads the canonical redirect table |
| A blend page that stops being pre-rendered | The build job counts the pre-rendered HTML files and fails below five |
| `.env.example` falling behind the code | The foundations check re-derives the variable set from source on every run |

---

## 6. Facts this package assumes, which are counterintuitive and get assumed wrong

Anyone editing these files should have these in hand.

1. **The tag is an ST25TV02KC: NFC Forum Type 5, ISO 15693, 256 bytes.** It is not
   NTAG21x, not Type 2, not ISO 14443, not 888 bytes and not 840 bytes. Area based 64 bit
   password protection, not lock bits. Most NFC material online is about NTAG and does not
   apply here.
2. **One thousand tags are already encoded and shipped.** `treveanspice.com/t/{code}` and
   its 307 are facts, not design choices. When the application and the tags disagree, the
   application moves.
3. **Attribution is per SKU.** No per-tag identifier, no chip UID available to the page.
4. **The blend pages are pre-rendered ahead of time and that is correct.** It is the one
   thing the scaffold gets right. Nothing in this package changes it and nothing should.
5. **`src/mobile` is out of scope.** Not broken and awaiting repair: out of scope. Do not
   build it.
6. **No en dashes and no em dashes**, in any file in this package including workflow
   comments and generated CI output.
