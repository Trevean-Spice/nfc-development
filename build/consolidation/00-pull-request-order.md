# The consolidation, as twelve reviewable pull requests

**Prepared by:** Serene Labs Inc (Jacob Ralph)
**For:** the `nfc-development` repository, Trevean Spice
**Document date:** Saturday 22 August 2026
**Revised:** Tuesday 25 August 2026. The sequence was applied to a scratch copy of
`nfc-development` and every gate was run. Four positions changed and three claims in this
document were wrong. Section 6 records what changed and why.
**Revised again:** Thursday 27 August 2026. **PR 9 is no longer adopted red.** The
`pageVersion` bound was applied to the frozen OpenAPI document that day and the contract
test suite runs 202 of 202. Only the PR 9 expectation changed. No position moved and no
other claim in this document was affected.
**Specification:** M1 deliverable "Scaffold audit", and M2 plan section 1.2, which defers
this work into the M3 window at 23 to 37 hours

> **Nothing in `nfc-development` has been modified.** It was read to write this and copied
> out with `git archive HEAD` to test it. Every claim below was verified against the files
> rather than carried over from the audit summary, and where the audit turned out to be
> wrong the correction is recorded in section 5. Where **this document** turned out to be
> wrong, the correction is in section 6.

---

## 1. The order, in one table

| # | Pull request | Touches | Gated on Dan | Size |
|---|---|---|---|---|
| **1** | **Lockfile**, `.nvmrc`, `.npmrc`, root `.gitignore` | 4 new files | No | S |
| **2** | **Disable `scripts/deploy.sh`** | 1 file, 1 hunk | No | XS |
| **3** | **The two absent manifests**, the undeclared dependencies, the ten `Redis.Redis` sites, `engines`, `start`, `typecheck` | 9 files, 1 deletion | No | M |
| **4** | **The three instrument configurations**: `tsconfig.json`, `jest.config.ts`, `.eslintrc.json` | 3 files | No | S |
| **5** | **`config/.env.example`** | 1 new file | No | S |
| **6** | **Delete the dead test suite**, add `ci/test-floor.json` | 8 deletions, 1 new file | No | M |
| **7** | **CI**: `ci.yml` alone, two assertion scripts, branch protection | 3 new files | No | M |
| **8** | **The slug**, the canonical table, the guard, and the `Guards` job | 3 files renamed, 2 new files, `ci.yml` edited | No | S |
| **9** | **Contract tests**, the OpenAPI document, and `contract-tests.yml` | new directory, 2 new files | No | L |
| **10** | **Performance budget CI**, and `performance-budget.yml` | 6 new files, `package.json` and `budget.json` edited | No | M |
| **11** | **Remove `src/mobile` from `workspaces`** | 2 files | **YES** | XS |
| **12** | **Status headers on five documents**, `NFC-SPECS.md` first and alone | 5 files | **YES** | S |

**Ten of the twelve need nobody's permission and can start on Monday.** Two need Dan, and
they are deliberately at the end of the merge chain and at the front of the asking queue,
for the reason in section 4.

**The rule that decides where the three workflow files and the six CI jobs go, and it is
worth stating once because it settles four of the twelve positions on its own: a job lands
in the same pull request as the thing it measures.** `ci.yml` measures the foundations, the
types, the lint and the tests, all of which exist by PR 6, so it lands at PR 7. The `Guards`
job measures a rename against a table, so it lands at PR 8 with both. `contract-tests.yml`
measures a suite and a document that arrive at PR 9, so it lands there. `performance-budget.yml`
measures a build against a budget file that arrives at PR 10, so it lands there. The
alternative, which the first version of this plan chose, puts five red jobs on every pull
request page for three pull requests running.

---

## 2. Why each one is where it is, and what breaks if it moves

### PR 1. The lockfile, and the three files that go with it

**What it contains.** `package-lock.json`, `.nvmrc` pinning Node 20, an interim `.npmrc`
setting `legacy-peer-deps=true`, and a root `.gitignore`.

**Why it is first.** The audit puts it first and the audit is right, for a reason worth
stating precisely rather than as a slogan. Every dependency in this repository is declared
with a caret range and there is no lockfile, so the tree resolves fresh on every install.
Measured drift on this exact dependency set: `express ^4.18.2` resolved to 4.22.2,
`next ^14.0.0` to 14.2.35, `typescript ^5.3.0` to 5.9.3, `aws-sdk ^2.1500.0` to 2.1693.0.
**Until a lockfile exists, no red or green from any later pull request is attributable to
that pull request's diff**, because the tree underneath it moved too. The same applies to
every byte measurement, and to the background-IP licence table, which cannot be a
contractual artifact while the versions in it are whatever npm happened to resolve that
afternoon.

It is also mechanically first: **every CI job in PR 7 begins with `npm ci`, and `npm ci`
refuses to run without a lockfile.** There is no version of this plan where CI precedes it.

**What breaks if it moves later.** Everything between here and there is measured against a
floating tree. Concretely, PR 4 changes the typecheck configuration and the reviewer's
question is "did the error count change because of this diff". Without a lockfile that
question has no answer, because a minor version of `@types/node` can move it on its own.

**The judgement inside this one.** `npm install` on a clean checkout fails with `ERESOLVE`
because of a React peer conflict in `src/mobile`, a workspace nobody builds. The clean fix
is PR 11, and PR 11 needs Dan. So the lockfile is generated with `--legacy-peer-deps` and
that fact is recorded in the pull request body and in a committed `.npmrc`, rather than
living in a command line flag that no document mentions and everyone has to remember. The
`.npmrc` is deleted in PR 11 and the lockfile regenerated without the flag. See
`files/npmrc`.

**One thing checked rather than assumed.** The root manifest declares `src/api` as a
workspace and `src/api/package.json` does not exist, which raised the question of whether
`npm install` would refuse and force PR 3 ahead of PR 1. It does not: verified on npm
10.8.2 against a minimal reproduction, a declared workspace with an absent manifest
installs without warning. That is worse behaviour than an error, and it is why PR 3
contains a CI check for it, but it does not disturb the order.

---

### PR 2. Disable `scripts/deploy.sh`

**Why it is second.** It is the only item in the whole consolidation whose worst outcome
happens to somebody else's infrastructure. `deploy.sh` names no AWS account, no profile
and no role, so it runs against whatever ambient credentials the operator holds; with
credentials from the previous engagement it updates that account's Lambda and runs
`aws s3 sync --delete` against that account's bucket. It cannot succeed in any case,
because it consumes `dist/api` and `dist/web` and `build.sh` produces neither.

It is second rather than first only because PR 1 is a prerequisite for everything and this
is a prerequisite for nothing. It depends on no other pull request and could merge on its
own in ten minutes. **If the order has to change under time pressure, this is the one to
move earlier, never later.**

**What breaks if it moves later.** Nothing mechanical, and that is exactly the risk
profile that gets things deferred. The exposure is a person with a checkout and a set of
credentials, and it is present every day the file is runnable. The detail is in
`files/deploy-sh-guard.patch.md`.

---

### PR 3. The two absent manifests, the undeclared dependencies, and the code that cannot compile

**What it contains.** `src/api/package.json`, `src/api/tsconfig.json`, the two AWS SDK
packages declared, `config/redis.ts` deleted, **the ten `Redis.Redis` sites corrected**,
and three manifest edits (`engines`, a `start` script that does not currently exist, a
`typecheck` script).

**Why it is here.** These are the things that make the next pull request legible. Three
imports resolve to packages that are installed nowhere, so `config/` cannot compile; the
`build:api` script targets a tsconfig that does not exist, so `npm run build` has never
succeeded; and a declared workspace with no manifest is silently never installed.
**Until they are fixed, a typecheck run reports errors that have nothing to do with the
code being reviewed**, and a reviewer cannot tell a real regression from the standing
noise.

It goes after the lockfile because it changes the dependency set, and changing the
dependency set before there is a lockfile to record the change means the change is not
recorded.

**What breaks if it moves later, after PR 4.** PR 4's whole claim is "the typecheck now
reports the truth". If the three undeclared imports are still there, the truth it reports
includes sixteen `TS2307` errors caused by packages that are simply not installed, and the
pull request looks like it made things worse.

**The judgement inside this one.** Two of the three undeclared imports get declared. The
third, `redis` at `config/redis.ts:1`, does not: that file is imported by nothing, verified
by grepping for `config/redis`, `./redis` and `RedisCache` across the repository and
finding only the file's own definitions, and it is a second, competing client for a service
the rest of the code reaches through `ioredis`. **Declaring a package so that dead code can
compile is the wrong direction.** The file is deleted instead. Owner of that judgement:
Serene Labs, technical, no client decision needed.

**The second judgement, added on 25 August after running it.** `src/api/tsconfig.json` is a
compiler configuration for a project that does not compile. Ten `TS2702` errors sit in six
files, all of one shape: `let redis: Redis.Redis` against `ioredis@5`, which exports `Redis`
as a class rather than as a namespace, so `Redis.Redis` is not a type. Shipping the tsconfig
without the fix is the same defect as the `build:api` script naming a tsconfig that does not
exist, one level up, so the two travel in one pull request. Ten lines, six files, one
substitution, no dependency change and no behaviour change, because `Redis.Redis` never
resolved to anything. The exact command and the transcript are in
`01-foundational-patches.md`, section 8. Owner: Serene Labs, technical.

**Verified on a scratch copy, 25 August 2026, Node 20.19.0, npm 10.8.2.** With PRs 1 to 3
applied and the substitution NOT yet made, `npx tsc --noEmit -p src/api/tsconfig.json`
returns the ten errors and exits 2. With it made, the same command exits 0 with no output.
That is the only point in the sequence at which either result is observable, which is why
the check belongs here.

---

### PR 4. The three instrument configurations

**Why it is here.** This is the pull request that makes all three instruments tell the
truth, and it must come after PR 3 so that what they then say is about the code rather than
about missing packages and code that cannot compile.

**What it contains.** `tsconfig.json`, `jest.config.ts` and **`.eslintrc.json`**.

Before it: `tsc --noEmit -p tsconfig.json` fails on one configuration level error and stops
before checking a single file, which reads to a developer as "almost clean" while 326
errors sit behind it. `npm test` fails while parsing its own configuration, so no test file
is ever discovered. And `npx eslint` does not run at all: it exits with "ESLint couldn't
find a configuration file", which is the linter refusing to start rather than reporting.

After it: the typecheck reports every error it has, jest reaches the test files and fails on
eight suites that cannot compile, and the linter runs. **The first two are worse looking and
both are more useful.** That is the point of the ordering: PR 6 deletes those eight suites,
and the evidence for doing so is a legible failing run that only exists after this pull
request.

**The third instrument, and why it is here rather than in PR 7.** There is no ESLint
configuration anywhere in `nfc-development` and there never has been, while the root
manifest has declared `eslint`, two `@typescript-eslint` packages, `eslint-config-prettier`
and two scripts to run them since June 2026. That is the same defect as the two absent
workspace manifests and the absent `src/api/tsconfig.json`: a script naming a thing that
does not exist, failing at the point of use rather than the point of review. It belongs in
the foundational set. Adding it in PR 7 instead would put a Lint check on every pull request
that no author could ever turn green, which is item one on the list of things this whole
package exists to stop.

`files/eslintrc.json` is the whole file and it carries its own argument. In one paragraph:
`eslint:recommended` and `plugin:@typescript-eslint/recommended` are adopted whole, they
report fourteen problems in nine inherited files, and those nine files are quarantined by
name in a committed block rather than the two rules being switched off globally. That is the
same shape as `ci/test-floor.json` and it is chosen for the same reason. It adds no
dependency, so `MANIFEST.md` gains no row.

**Verified rather than asserted.** With PRs 1 to 4 applied on a scratch copy, the exact CI
command `npx eslint 'src/**/*.{ts,tsx}' 'config/**/*.ts' 'scripts/**/*.ts' --max-warnings=0`
exits 0 with no output. With the quarantine block emptied it reports the fourteen problems
by file, rule and line and exits 1. With one unused variable added to `src/api/server.ts`,
which is not on the list, it names that variable and exits 1.

**What the root typecheck reports at this pull request, and it is not zero.** After PR 4 and
before PR 6, `tsc --noEmit -p tsconfig.json` reports **27 errors, every one of them inside
`tests/`**: unresolvable module paths, two untyped test-only imports and two implicit `any`.
That is the legible failing run PR 6 rests on, seen from the compiler rather than from jest,
and it clears when the eight suites are deleted. It is why CI arrives at PR 7 and not here.
The API project and the web project both exit 0 at this point.

**What breaks if it moves earlier, before PR 3.** The typecheck still cannot report
cleanly, so the improvement is invisible and the change looks unmotivated.

**What breaks if it moves later, after PR 7.** CI arrives with a typecheck job that is red
for configuration reasons and a test job that dies in a config parser. Reviewers learn in
the first week that red is normal, which is the failure mode this entire package is written
to avoid, and it is not recoverable by later discipline.

**The judgement inside this one**, and it is the largest in the mechanical set: the
inherited `coverageThreshold` of 80 percent lines is not carried forward. The full argument
is in `files/jest.config.ts`. In one sentence: reinstating an 80 percent global threshold
on the day the only suite is deleted creates a gate that cannot be met for weeks, and a
gate that cannot be met is a gate somebody disables. It is replaced by `ci/test-floor.json`,
which asserts that tests actually executed and ratchets upward. Owner: Serene Labs,
technical.

---

### PR 5. `config/.env.example`

**Why it is here.** It is the one pull request in the set whose position is genuinely
arbitrary, and saying so is more useful than inventing a reason. It depends on nothing and
nothing depends on it, except that **it must land before PR 7**, because the CI foundations
check asserts the file exists and asserts that every variable read from source appears in
it. Twenty seven variables are read from source under `config/`, `scripts/`, `src/api/`,
`src/shared/` and `src/web/`, measured on 22 August 2026 rather than recalled, and none of
them is documented anywhere.

It sits at 5 because by this point the reader of the pull request has the context to
understand the four warnings embedded in it, all of which are findings rather than
settings: an unset `API_KEY` makes the auth middleware fail open, `NFC_CHIP_TYPE` defaults
to the wrong chip family, `NEXT_PUBLIC_API_URL` has two different defaults in one
repository and one of them names a protocol the API does not speak, and `REDIS_URL` and
`REDIS_HOST`/`REDIS_PORT` are two mechanisms for one connection belonging to two competing
clients.

---

### PR 6. Delete the dead test suite

**Why it is here and not earlier.** Because the case for deletion has to be visible in CI
output rather than asserted in a pull request body. After PR 4, `npm test` produces eight
suites that fail to compile with named missing modules. That run is pasted into the pull
request. Before PR 4 the same command produces a TypeScript error inside
`jest.config.ts`, which proves only that the configuration is broken.

**Why it is not later.** Because PR 7 adds a test job, and a test job that is red for eight
files everyone already agrees are being deleted teaches exactly the wrong lesson in the
week CI is introduced.

The decision, the argument and the replacement are in `02-test-suite-decision.md`. This
pull request also adds `ci/test-floor.json` with a floor of zero, an expiry of Friday 11
September 2026 and a recorded reason, because the honest way to say "there is nothing to
run for the next three weeks" is a dated zero that warns on every build and fails the day
after it expires, not a green check.

---

### PR 7. CI, and only the CI that has something to measure

**What it contains.** `.github/workflows/ci.yml`, `scripts/ci/assert-foundations.mjs` and
`scripts/ci/assert-tests-executed.mjs`. Three new files. Plus the branch protection
settings, which are part of the pull request description even though they are not part of
the diff.

**What it deliberately does NOT contain**, and this is the change that matters most in the
25 August revision:

| Not here | Where | Why |
|---|---|---|
| the `Guards` job and `assert-slugs.mjs` | PR 8 | The script reads `config/redirect-table.json` and forbids the older blend spelling in tracked source. The table arrives in PR 8 and the rename is PR 8. A `Guards` job here is red on the pull request that introduces it and red on `main` until PR 8 merges |
| `contract-tests.yml` | PR 9 | It sets `working-directory: contract-tests`, caches on `contract-tests/package-lock.json` and checks for `docs/api/01-api-contract.openapi.yaml`. All three arrive in PR 9 |
| `performance-budget.yml` | PR 10 | Five jobs, every one of which runs a script or reads a file that arrives in PR 10: `check-static-budget.mjs`, `make-lhci-config.mjs`, `check-budget.mjs`, `licenses.mjs`, `budget.json` |

`ci.yml` therefore lands with five jobs, `Foundations`, `Typecheck`, `Lint`, `Tests` and
`Build`, and a sixth arrives at PR 8.

**Why it is exactly here.** This is the first point in the sequence at which every gate it
runs can be green for a real reason:

- **Foundations** passes because PR 1, 3, 4 and 5 landed: lockfile, node pin, both workspace
  manifests, both jest keys, the ESLint configuration, the tsconfig settings, no undeclared
  imports, a complete `.env.example`, and a workflow file in `.github/workflows/`.
- **Typecheck** passes on all three projects because PR 3 declared the two AWS SDK packages,
  deleted `config/redis.ts` and cleared the ten `TS2702` sites, PR 4 replaced `typeRoots`
  and stopped the root project compiling `.tsx`, and PR 6 removed the eight suites that
  contributed the remaining 27 errors.
- **Lint** passes because PR 4 added `.eslintrc.json` with the nine file quarantine list.
  Before PR 4 the linter does not run at all.
- **Tests** passes because PR 6 deleted the suites that could not compile and recorded a
  dated zero floor instead of pretending. jest finds no test file, refuses, exits 1 and
  writes no result file, which is its documented behaviour and not a crash; the assertion
  script recognises that from jest's own output, hands it to the floor, and the floor accepts
  it while the dated window is open, printing "This job CANNOT FAIL while that is true" on
  every build.
- **Build** passes because `src/api/tsconfig.json` now exists **and the project it configures
  compiles**, and because `next build` pre-renders five blend pages, which the job counts.

**Verified rather than asserted, and this time every line of it was run.** On a scratch copy
of `nfc-development` at HEAD `2220c43`, taken with `git archive HEAD`, Node 20.19.0, npm
10.8.2, 25 August 2026, with PRs 1 to 6 applied in order and every job's own commands
executed:

```
Foundations   node scripts/ci/assert-foundations.mjs      exit 0
              "Foundations: all checks passed."
              npm ci                                      exit 0
Typecheck     npx tsc --noEmit -p tsconfig.json           exit 0, no output
              npx tsc --noEmit -p src/api/tsconfig.json   exit 0, no output
              npx tsc --noEmit -p src/web/tsconfig.json   exit 0, no output
Lint          npx eslint 'src/**/*.{ts,tsx}' ...          exit 0, no output
Tests         npx jest --config jest.config.ts --ci ...   exit 1, "No tests found"
              node scripts/ci/assert-tests-executed.mjs   exit 0
              "Tests gate passed under the dated zero floor: 0 tests executed,
               floor 0, window open until 2026-09-11."
Build         npm run build                               exit 0
              pre-rendered blend pages: 5                 exit 0
```

Against the same tree **as inherited**, `assert-foundations.mjs` reports **sixteen** distinct
problems in one pass and exits 1. Sixteen rather than the fifteen an earlier version of this
document quoted, because the absent ESLint configuration is now one of them.

**What breaks if it moves earlier.** Every gate is red on arrival for reasons no reviewer
can fix inside their own pull request. The specific damage is cultural rather than
technical and it does not undo: a team that spends its first fortnight merging past a red
check has learned that the check is advisory, and no later configuration change unlearns
it. **This is the ordering constraint in the whole plan that is least about dependencies
and most about what CI is for.**

**What breaks if it moves later, after PR 9 or 10.** The contract tests and the budget
scripts each bring their own workflow. Adding them before the shared CI exists means three
workflows arrive with no agreed shape, no shared Node pin, and no foundations job in front
of them, so a missing lockfile produces three separate npm stack traces instead of one
sentence. That argument is sound and it is an argument for `ci.yml` arriving here. It is not
an argument for the other two workflows arriving here, which is the mistake the first version
of this document made: shipping the shape and shipping the workflows are different things,
and PR 7 giving them the shape costs nothing.

---

### PR 8. The slug, the table, the guard, and the job that runs the guard

**What it contains.** Five renamed occurrences in three files, `config/redirect-table.json`
as a temporary copy of the canonical table, `scripts/ci/assert-slugs.mjs`, and **the
`Guards` job added to `.github/workflows/ci.yml`**. The exact job block is in
`files/ci-guards-job.patch.md`.

**Why it is not earlier**, given that it is the cheapest fix in the entire audit at fifteen
minutes and lands on the tap path. Two reasons, and the second is the real one.

First, under the M2 plan the tap path is served by the edge package, not by this
repository, so a wrong slug here does not reach a customer this month. It reaches a
customer when this repository starts serving blend pages, which is after the transplant.

Second, and decisive: **the rename and the guard that keeps it must land in the same pull
request**, and the guard is a CI check. Renaming five occurrences without a guard leaves a
repository in which the correct spelling is one careless merge from being undone, silently,
with no test and no crash to say so. The guard needs PR 7. So the pair waits for PR 7, and
they travel together.

**Carried one step further than it was carried the first time.** If the rename and the guard
must not travel separately, then neither must the guard and the CI job that runs it. The
first version of this plan put `assert-slugs.mjs` and the `Guards` job in PR 7 and the table
and the rename in PR 8, and marked `Guards` required on `main` at PR 7. That job cannot pass
at PR 7 for two independent reasons: the script exits 1 when `config/redirect-table.json` is
absent, and it exits 1 while the older spelling is present, which at HEAD `2220c43` it is,
five times in three files. Required at PR 7, it would have blocked every other open branch
until PR 8 merged. All four parts now land together and `Guards` is marked required after
PR 8, not after PR 7.

**Verified, and run twice on purpose.** On the scratch copy with PRs 1 to 7 applied and the
canonical table copied in but the rename **not** applied, `node scripts/ci/assert-slugs.mjs`
reports the five occurrences with their file and line and exits 1. After the scoped
substitution across the three named files it prints the five canonical slugs and
`Slug guard passed: 5 canonical slugs, no forbidden spellings` and exits 0. The guard was
then re-run with the `Guards` job block inserted into `ci.yml`, because the guard scans
`.yml` as well as source and the block's own comment discusses the forbidden spelling
without quoting it: still exit 0, and the file parses to six jobs. The full transcript is in
`files/ci-guards-job.patch.md`.

**One consequence worth naming for the reviewer.** The build job's pre-rendered page count
does not change, but the filenames do: `blend/the-silk-road.html` becomes
`blend/silk-road.html`. Five pages before, five after. Verified.

**What breaks if it moves earlier.** Nothing, on the day. The risk is that the rename lands
alone, the guard is deferred, and the deferral becomes permanent, which is how the wrong
spelling got into three separate datasets in the first place.

Full detail, with every location, in `03-slug-fix.md`.

---

### PR 9. Contract tests

**What it contains.** `contract-tests/` as a directory,
`docs/api/01-api-contract.openapi.yaml`, and **`.github/workflows/contract-tests.yml`**.

**Why it is here.** It is the replacement for what PR 6 deleted, so it follows it. It needs
PR 7 for a workflow shape to slot into. It is self contained, with its own lockfile, its own
Node floor of 20.11.0 and no workspace assumptions, so it does not disturb anything before
it.

It also carries the OpenAPI document into the repository, which is the step that makes the
change control process in section 11 of the frozen contract operate on an artifact that
lives with the code rather than in a deliverables folder.

**The workflow arrives here rather than in PR 7**, because every path it names arrives here:
`defaults.run.working-directory: contract-tests`, `cache-dependency-path:
contract-tests/package-lock.json`, and the specification-present check on
`docs/api/01-api-contract.openapi.yaml`. Shipped at PR 7 it fails on all three for two pull
requests running, and the third of those failures is a message written to be legible,
arriving two pull requests before the thing it is legible about.

**Expect it to be green on adoption. Corrected Thursday 27 August 2026, and this is the second
correction to this paragraph.** The first version said to expect two failures, from the
position on 17 August 2026: three worked examples violating the ULID pattern they declare, and
`ScanEventInput.pageVersion` unbounded above on an endpoint that takes no credential. **The
worked examples were corrected on 17 August, which took it to one.** **The `pageVersion` bound
was applied to the frozen document on Thursday 27 August 2026, under the change control
procedure in section 8 of the contract errata, which takes it to none.** Run on 27 August 2026
against the document as it now stands:

```
$ CONTRACT_TEST_SPEC_PATH=../docs/api/01-api-contract.openapi.yaml npm run test:stub
tests 202
suites 36
pass 202
fail 0
exit 0
```

**So adopt it green, and treat any failure as a finding.** A suite that goes green on its
first run against a document nobody has checked would be a suite that is not checking. That
is not what this is: this suite found two defects in the frozen document, held one of them
visible for ten days, and went green because the defect was fixed rather than because the
test was relaxed. Nothing was skipped, relaxed or deleted to get there. **The adopter should
be looking for zero failures. If there is one, the document has drifted from what was
delivered and that is the thing to chase.**

The install and the typecheck both exit 0 at this pull request, verified on the scratch copy:
`npm ci` in `contract-tests/` adds 10 packages, `npm run typecheck` exits 0.

---

### PR 10. Performance budget CI

**What it contains.** `budget.json`, `scripts/check-static-budget.mjs`,
`check-budget.mjs`, `make-lhci-config.mjs`, `licenses.mjs`, the `@lhci/cli` devDependency,
and **`.github/workflows/performance-budget.yml`**.

**Why it is last among the technical ones.** It is the only workflow that measures routes
which do not exist in this repository. There is no `/t/{code}` anywhere: `treveanspice`,
`/t/`, `blend.html`, `via=nfc` and `via=qr` return zero matches repository wide. Adopting it
earlier means a permanently red required check with no pull request able to fix it, which is
the failure mode PR 7 exists to prevent.

**The workflow arrives here rather than in PR 7**, for the same reason and more sharply.
Every one of its five jobs runs a script or reads a file that does not exist until this pull
request: `check-static-budget.mjs`, `make-lhci-config.mjs`, `check-budget.mjs`,
`licenses.mjs` and `budget.json`. Shipped at PR 7, five jobs are red on every pull request
for three pull requests running, and one of them is the job the background IP obligation
depends on.

**One edit to `budget.json` is part of this pull request, and without it two required checks
cannot pass.** The file's own comment says so: "TO CONFIRM IN AUDIT: the built route shape in
the nfc-development repo. Adjust these two lists and nothing else." The list as shipped names
the shape the tags reach, which is not the shape this repository serves. Measured against a
real build with the application running, 25 August 2026:

```
GET /blend.html?blend=persian-sunrise&via=nfc  ->  404
GET /blend.html?blend=caribbean-sunset&via=nfc ->  404
GET /blend/persian-sunrise                     ->  200
GET /blend/silk-road                           ->  200
```

```diff
   "directPages": [
-    "/blend.html?blend=persian-sunrise&via=nfc",
-    "/blend.html?blend=caribbean-sunset&via=nfc"
+    "/blend/persian-sunrise",
+    "/blend/caribbean-sunset"
   ]
```

Nothing else in the file changes, and no number in it changes. The document measured is the
same pre-rendered document either way. When the route-shape gap is closed, by a `rewrites()`
entry in `src/web/next.config.js` or at the CDN, the list moves back and the numbers still do
not change. Without this edit the `Budget at 375 px` and `Budget at 428 px` jobs fail at the
step that asserts the measured URLs are real pages, on the day they are marked required, and
no author can fix that inside a diff. That step is the best anti-vacuity control in the set
and it is doing its job: a Lighthouse score against a 404 measures beautifully and certifies
nothing.

**How it is adopted without either lying or being useless.** The static byte gate is required
from day one and, run rather than predicted, it is **green with warnings**:

```
Checking 8 pre-rendered page(s).
PASS  HTML, Brotli q11    3.1 KB / 14.0 KB   blend/persian-sunrise.html
PASS  inline CSS, raw     0.0 KB /  9.0 KB   blend/persian-sunrise.html
WARN  1 apparently render-blocking <link rel="stylesheet">   (on all 8 pages)
Static budget met across 8 page(s).
exit 0
```

An earlier version of this section said to expect it red, for two reasons: zero inlined
critical CSS against a 9 KB allowance, and one render-blocking stylesheet. That was written
rather than run. The 9 KB figure is a **ceiling**, so zero bytes passes it, and the blocking
stylesheet is a warning by design, because only Lighthouse can distinguish a stylesheet the
browser blocks on from one it defers. Both remain real defects, D13, and both are caught by
the direct-phase Lighthouse assertion rather than by the static one. The static gate is still
a gate: it fails on an HTML document over 14 KB Brotli, on inlined CSS over 9 KB, on a
third-party font host, and on finding no pre-rendered HTML at all.

The tap path job is advisory, and it **arms itself**: before it measures anything it probes
`/t/ps`, and if that path answers 307 the job fails and prints the two line edit that turns
the advisory into a gate. Verified: `/t/ps` returns 404 today, so the probe passes and the
job stays advisory. The advisory therefore cannot outlive its reason, which is the usual way
advisory checks become permanent.

**One change to `assert-foundations.mjs` belongs to this pull request even though the script
lands in PR 7.** The four budget scripts go into `scripts/`, which the foundations check
scans, and three of them read `BUDGET_BASE_URL`, `BUDGET_HTML_DIRS` and
`BUDGET_STATIC_OPTIONAL` while the workflow writes to `GITHUB_STEP_SUMMARY`. The
`.env.example` completeness check derived those four as undocumented application variables
and failed:

```
$ node scripts/ci/assert-foundations.mjs
FOUNDATIONS FAILED. 1 problem(s).
1. .env.example is complete
   Found: 4 variable(s) are read from source and not documented in config/.env.example:
   BUDGET_BASE_URL, BUDGET_HTML_DIRS, BUDGET_STATIC_OPTIONAL, GITHUB_STEP_SUMMARY
exit 1
```

**Every job in `ci.yml` needs `foundations`, so that is the whole CI system red at PR 10**,
five pull requests after CI was introduced, for a reason no author of a later pull request
could fix. The wrong cure is to add four CI-only names to a file a developer copies to
`config/.env`. The right one is that `config/.env.example` documents what the **application**
reads, and `scripts/*.mjs` in this repository is CI tooling whose environment is declared in
the workflow file. The script now excludes that one path shape from the environment
derivation and from nothing else: the undeclared import scan still covers those files, and
they still pass it, because they use the Node standard library only. It is scoped by path
rather than by extension because `src/web/next.config.js` is also not TypeScript and does
read application configuration.

**Verified both ways.** At the PR 10 state the foundations check passes. With one
undocumented variable added to `config/default.ts` it names that variable and exits 1, so the
check is still live rather than weakened.

**This one surfaces only if you run the sequence to the end.** Stopping at PR 7, where every
gate is green, hides it completely.

**Not verified here, and said rather than glossed.** The four Lighthouse jobs need Chrome and
a running server on a Linux runner and were not executed on this machine. What was executed
is everything upstream of Lighthouse in each of them: the build, the server start, and the
URL reality check that gates the measurement. Those are the steps that fail for ordering
reasons. The Lighthouse assertions fail or pass on the numbers, which is what they are for.

**What breaks if it moves earlier.** A required check that no author can turn green.
**What breaks if it is skipped.** The per page budget is contractually enforced in CI from
M2 to handoff, so it is not optional, only late.

---

### PR 11. `src/mobile` out of `workspaces`. **Needs Dan.**

**Why it is last in the merge chain.** It is the second of the two items that cannot merge
without the client, and a client gated change in the middle of a chain stalls everything
behind it. Placing both at the end means the ten that need nobody proceed at their own pace.

**Why that costs less than it looks.** The two harms this change removes are separable, and
PR 4 already removed the more painful one. Excluding `src/mobile` from the root tsconfig
needs no permission, because it changes nothing about whether the files are in version
control, and it removes 78 of 326 type errors and restores a typecheck that reports
something. What is left for PR 11 is the 552 MB install and the `ERESOLVE` peer conflict.
Those are real, they are paid daily by everyone, and they are worth asking for, but nobody
is blocked by them.

Detail, and the exact words to send, in `04-react-native-workspace.md`.

---

### PR 12. Status headers on five documents. **Needs Dan.**

**Why it is last in the merge chain and first in the asking queue.** It is markdown. It
touches no code, depends on nothing and blocks nothing, so its position among the merges is
free. But one of the five, `docs/NFC-SPECS.md`, specifies "Write Lock Bytes" at step 3 and
verification at step 4, against a chip whose generic ISO 15693 block lock is permanent,
cannot be undone by any password, and leaves the tag as scrap. **That is the only defect
anywhere in this consolidation whose worst outcome is irreversible and applied at batch
scale**, and the cost of not fixing it is paid by whoever reads the document next, silently.

So the ask goes out on its own, before the other four, phrased so that Dan can approve one
short header in one reply. The other four follow whenever convenient.

Exact headers in `05-document-status-headers.md`.

---

## 3. The dependency graph, if the table is not enough

```
PR 1 lockfile
  |
  +--> PR 3 manifests + deps + Redis types ---> PR 4 tsconfig + jest + eslint ---.
  |                                                                              |
  |                                                          PR 6 delete tests <-+
  |                                                                   |
  +--> PR 5 .env.example --------------------------------------------->+--> PR 7 ci.yml
  |                                                                              |
  +--> PR 2 disable deploy.sh (independent, do it whenever, do it early)         |
                                                                                 |
              PR 8  slug + table + guard + Guards job         <------------------+
              PR 9  contract tests + OpenAPI + workflow       <------------------+
              PR 10 budget scripts + budget.json + workflow   <------------------+

PR 11 mobile workspace   ) both gated on Dan, neither blocks anything above,
PR 12 document headers   ) both asked for on day one
```

**Four orderings are load bearing and the rest is convenience:**

1. **Lockfile before anything that installs.** Mechanical: `npm ci` cannot run without it.
2. **PR 3 and 4 before PR 7.** Otherwise CI arrives red for reasons unrelated to any diff,
   and the habit of merging past red forms in the first week. Necessary, and on its own **not
   sufficient**: PR 3 must also clear the ten `TS2702` sites and PR 4 must also add the
   ESLint configuration, or the Typecheck, Build and Lint jobs are red on arrival anyway.
   That was the gap in the first version of this plan and it is the whole of its cost.
3. **PR 6 before PR 7, and PR 4 before PR 6.** Otherwise the deletion is either unjustified
   by evidence, or it is justified against a test job that has already taught people to
   ignore it.
4. **Every CI job lands in the same pull request as the thing it measures.** Not a
   dependency constraint, a legibility one, and it is what puts the `Guards` job at PR 8,
   `contract-tests.yml` at PR 9 and `performance-budget.yml` at PR 10. The cost of breaking
   it is not a broken merge, it is a pull request page on which most of the checks are red
   for three pull requests running, which trains the reflex this whole package is written
   against.

Everything else can be resequenced without consequence, and PR 2 in particular should move
earlier rather than later if anything slips.

---

## 4. What needs the client's agreement

| # | Item | Why it is Dan's | What it costs him | What we do meanwhile |
|---|---|---|---|---|
| **A** | `docs/NFC-SPECS.md` status header | A change to Trevean's repository, and it contradicts a document his previous supplier wrote | One reply. The header is drafted, he approves or edits the wording | Nothing. This one is asked for alone and first, because its downside is scrapped inventory |
| **B** | Status headers on `README.md`, `ARCHITECTURE.md`, `GUIDE.md`, `DIRECTORY-GUIDE.md` | Same | One reply, roughly one hour of our time to apply | Nothing blocked |
| **C** | Removing `src/mobile` from `workspaces` | It changes how his repository installs, and the mobile app is a thing he may still intend to build | One reply. The files stay in version control; the decision is reversible in one line | PR 4 already removes the typecheck damage without permission. Only the 552 MB and the peer conflict wait |

**Dan last replied at 10:12 on Wednesday 19 August 2026.** All three asks fit in one short
message and none of them blocks a single line of the other ten pull requests. That
separation is the point of the ordering.

---

## 5. Corrections to the audit, found while verifying it

Recorded because the standing rule is that when something is wrong we say so, including
when it is ours.

| # | The audit says | The files say | Why it matters |
|---|---|---|---|
| **1** | Section 8.4: `"test:integration": "jest --testPathPattern=tests/integration"` "matches nothing" because the directory is `tests/integrations`, plural | `--testPathPattern` takes an unanchored regular expression matched against the full test path, so on a POSIX runner `tests/integration` **does** match `tests/integrations/api.test.ts` as a substring. The script was not broken in the way recorded | It changes the fix. The real defect is that the pattern uses a forward slash and so behaves differently on Windows, where test paths use backslashes. Recorded in `files/root-package-json.patch.md`, hunk 4 |
| **2** | Section 8.7: "Nineteen undocumented environment variables, counted from source" | Twenty seven are read from source under `config/`, `scripts/`, `src/api/`, `src/shared/` and `src/web/`. Twenty nine if `src/mobile` and the e2e tests are included. Enumerated in `files/config-env.example` and re-derived by CI on every run | Nineteen would have produced a `.env.example` missing eight variables, which is the specific failure the file exists to prevent. The CI check makes the count self maintaining rather than a number in a document |
| **3** | Section 7.9, blocker 4: "Add `src/api/package.json`. Declared as a workspace, does not exist" implies npm would object | Verified on npm 10.8.2: a declared workspace with an absent manifest installs with **no error and no warning** | It is worse than the audit implies, not better. Nothing reports it, which is why PR 7's foundations check asserts it explicitly rather than relying on the install |

None of the three changes a conclusion. The first two change an instruction, and the third
changes a check.

---

## 6. Corrections to this document, found by running it

**Tuesday 25 August 2026.** The plan above was written by reading `nfc-development` and
reasoning about what would happen. That was enough for its factual claims, which held, and
it was not enough for its claims about colour. The sequence was then applied to a scratch
copy and every gate was run. Five things were wrong and all five are fixed above.

| # | What this document said | What running it showed | What changed |
|---|---|---|---|
| **1** | PR 7: "typecheck passes because PR 3 and 4 landed" and "the build job passes because `src/api/tsconfig.json` now exists" | Ten `TS2702` errors remained in six files under `src/api`, from `Redis.Redis` against `ioredis@5`, which exports a class rather than a namespace. `npm run build` fails on the same ten, because its first half is `tsc -p src/api/tsconfig.json` | The ten sites are cleared in **PR 3**, with the tsconfig that exposes them. `01-foundational-patches.md` section 8 |
| **2** | PR 7: "the test gate passes because PR 6 deleted the suites" | jest found no test file, exited 1 and wrote no result file. The assertion script read the absent file as a crash and named two jest configuration typos that PR 4 had already fixed. The dated zero floor never engaged | `assert-tests-executed.mjs` now classifies the run from jest's own output, which the Tests job captures, and hands "no tests found" to the floor as a first class outcome. `passWithNoTests` stays false |
| **3** | `README.md`: `Guards` required on `main` at PR 7 | `assert-slugs.mjs` exits 1 without `config/redirect-table.json`, and exits 1 while the older spelling is present. Both arrive in PR 8 | The `Guards` job moves to **PR 8** with the table, the rename and the script. Required after PR 8 |
| **4** | PR 7 ships three workflows | Two of them measure files that arrive in PR 9 and PR 10. Five jobs red on every pull request for three pull requests | `contract-tests.yml` moves to **PR 9**, `performance-budget.yml` to **PR 10** |
| **5** | The seven foundational fixes | There is no ESLint configuration anywhere in the repository, so `npx eslint` does not start and the Lint job could never pass. Same defect class as the two absent manifests, and missed | `.eslintrc.json` lands in **PR 4** as foundational fix number 9, and `assert-foundations.mjs` gained a check for it. The inherited tree now reports sixteen problems, not fifteen |

**A sixth, found only because the sequence was run to PR 10 rather than to PR 7.** The
foundations check scans `scripts/` for environment variables and asserts they are documented
in `config/.env.example`. PR 10 puts four budget scripts in `scripts/`, which read three
`BUDGET_*` variables and write to `GITHUB_STEP_SUMMARY`. The check failed on all four, and
because every job in `ci.yml` needs `foundations`, the whole CI system would have gone red at
PR 10, five pull requests after it was introduced. The environment derivation now excludes
`scripts/*.mjs`, which in this repository is the CI tool set, and nothing else changes. The
detail is in the PR 10 section above.

Two smaller corrections found in the same pass, both in this document:

- **PR 9 told the adopter to expect two open contract defects.** One of the two, the three
  worked examples violating the ULID pattern, was corrected on 17 August. The suite ran
  201 of 202. Corrected to one. **Corrected again on Thursday 27 August 2026 to none:** the
  `pageVersion` bound was applied to the frozen document that day, the suite runs 202 of 202,
  and PR 9 is now adopted green. See the PR 9 section above and the contract errata,
  section 15.
- **PR 10 told the adopter to expect the static budget gate red.** Run, it is green with
  eight warnings, because the 9 KB inline CSS figure is a ceiling rather than a floor.
  Corrected, and the reason the two defects it named are still real is stated.

**Recorded here rather than quietly amended, and it is worth saying why.** This package's
entire argument is that a green build on a repository where nothing executes is worse than
no CI, because it converts "we do not know" into "we checked". A written claim that a gate
will be green, made without running the gate, is the same conversion performed by a document
instead of by a workflow. Two of the three claims the ordering rested on were of that kind.
The correction is not only the five fixes: it is that **the sequence is now applied and run
end to end before it is published**, and the transcripts above are copied from a terminal
rather than composed.

**Nothing in `nfc-development` was modified to do any of this.** The verification ran against
`git archive HEAD` copies outside any working tree. `git status --porcelain` in the client
repository is empty and HEAD is unchanged at `2220c43`.
