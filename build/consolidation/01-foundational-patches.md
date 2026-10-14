# The foundational fixes, exactly

**Document date:** Saturday 22 August 2026
**Revised:** Tuesday 25 August 2026, after the sequence was applied to a scratch copy of
`nfc-development` and run. Two defects were added to the set, numbers 8 and 9, and the
reason they were missed is recorded in section 10.

Nine foundational defects, the exact change for each, and for the three that need
judgement, what the judgement is and who makes it.

Where the change is mechanical, the file to copy is in `files/`. Where it is a hunk in an
existing file, the diff is in `files/*.patch.md`. Nothing here is a description of a change
that somebody then has to reconstruct.

---

## The nine, at a glance

| # | Defect | Verified how | Mechanical or judgement | Artifact | PR |
|---|---|---|---|---|---|
| 1 | No lockfile | `git ls-files` shows no `package-lock.json`, `yarn.lock` or `pnpm-lock.yaml` | **Judgement**, on one point | commands below, plus `files/npmrc` | 1 |
| 2 | `src/api/package.json` absent | Declared at `package.json:7`, absent from `git ls-files` | Mechanical | `files/src-api-package.json` | 3 |
| 3 | `src/api/tsconfig.json` absent | Targeted by `package.json:15`, absent from `git ls-files` | Mechanical | `files/src-api-tsconfig.json` | 3 |
| 4 | Three undeclared imports | Read at `config/database.ts:1`, `config/redis.ts:1`, `scripts/seed.ts:1` and `:2` | **Judgement**, on one of the three | `files/root-package-json.patch.md` hunk 1 | 3 |
| 5 | No `.env.example` | Absent from `git ls-files`; instructed by `README.md:83` | Mechanical, once the variable set is measured | `files/config-env.example` | 5 |
| 6 | `typeRoots` and `jsx` | Read at `tsconfig.json:26` and by the absence of a `jsx` key | **Judgement**, on scope | `files/tsconfig.root.json` | 4 |
| 7 | Two `jest.config.ts` typos | Read at `jest.config.ts:27` and `:35` | Mechanical, with one judgement attached | `files/jest.config.ts` | 4 |
| **8** | **Ten `TS2702` at `Redis.Redis` in `src/api`** | `npx tsc --noEmit -p src/api/tsconfig.json` with PRs 1 to 3 applied. Ten errors, six files | Mechanical, one substitution | section 8 below | **3** |
| **9** | **No ESLint configuration anywhere** | `git ls-files` matches nothing on `eslint`; `npx eslint` exits with "couldn't find a configuration file" | **Judgement**, on the quarantine list | `files/eslintrc.json` | **4** |

---

## 1. The lockfile

**The change.**

```bash
git checkout -b consolidation/01-lockfile
cp <consolidation>/files/nvmrc   .nvmrc
cp <consolidation>/files/npmrc   .npmrc
cp <consolidation>/files/gitignore .gitignore
npm install
git add package-lock.json .nvmrc .npmrc .gitignore
```

Commit `package-lock.json` exactly as npm produces it. Do not hand edit it, do not prune
it, and do not regenerate it on a different Node major version than `.nvmrc` names.

**The judgement, and it is ours.** `npm install` on a clean checkout fails with `ERESOLVE`:
`@react-native-community/async-storage@1.12.1` declares a peer of `react@^16.8` against the
`react@18.3.1` the tree resolves. The conflict is entirely inside `src/mobile`, and because
npm installs workspaces together it blocks the web app and the API too.

Three ways to produce a lockfile in that situation:

1. **Fix the conflict first**, by removing `src/mobile` from `workspaces`. Cleanest, and it
   needs Dan, so it cannot gate the first pull request in the plan.
2. **Generate with `--legacy-peer-deps` and record the fact in a committed `.npmrc`.**
   Chosen. It makes today's install deterministic and visible in the repository rather than
   in a flag every developer and every CI job has to remember, which is the state the audit
   found: the flag was required and neither `README.md` nor `CONTRIBUTING.md` mentions it.
3. **Generate with the flag and mention it in the README.** Rejected. A README is not read
   by `npm ci`.

The cost of option 2 is that genuine peer conflicts stop being reported at install time.
That is acceptable for exactly as long as the only conflict is a deprecated package in a
workspace nobody builds, which is why the deletion of `.npmrc` is written into PR 11
rather than left to memory.

**Who decides:** Serene Labs, technical. Dan is told, not asked.

---

## 2 and 3. The two absent manifests

**Mechanical.** Copy `files/src-api-package.json` to `src/api/package.json` and
`files/src-api-tsconfig.json` to `src/api/tsconfig.json`. Both carry their reasoning in a
comment key that TypeScript and npm both ignore, so the reviewer does not have to
reconstruct it and the next reader does not have to ask.

Two things worth naming, because they are easy to read as bigger than they are.

**`src/api/tsconfig.json` emits to `dist/api`.** That is one of the two directories
`scripts/deploy.sh` consumes and `scripts/build.sh` has never produced. Producing it does
not make `deploy.sh` usable: that script also requires a Lambda function, a CloudFormation
stack and an S3 bucket that are declared nowhere, and it runs against ambient credentials.
PR 2 disables it. This is a build output, not a step toward a deploy.

**Verified, and it is the sharper half of the finding.** npm does not object to a declared
workspace whose manifest is absent. Tested on npm 10.8.2 with a minimal reproduction: a
root manifest declaring two workspaces, one of which has no `package.json`, installs
cleanly with no error and no warning. So this defect has never announced itself and never
would have. That is why `scripts/ci/assert-foundations.mjs` checks it explicitly rather
than trusting the install to complain.

---

## 4. The three undeclared imports

| Import | Read at | Declared? | What happens to it |
|---|---|---|---|
| `@aws-sdk/client-dynamodb` | `config/database.ts:1`, `scripts/seed.ts:2` | No | **Declared**, `^3.658.0` |
| `@aws-sdk/lib-dynamodb` | `scripts/seed.ts:1` | No | **Declared**, `^3.658.0` |
| `redis` | `config/redis.ts:1` | No. `ioredis` is declared instead, and it is a different package | **Not declared. The file is deleted** |

**The judgement, and it is ours.** `config/redis.ts` is imported by nothing. Verified by
grepping the repository for `config/redis`, `./redis` and `RedisCache`: the only matches
are the definitions inside the file itself. It is a second, competing Redis client for a
service every live path reaches through `ioredis`, and it exists alongside a second piece
of dead cache code, `src/api/middleware/cache.ts`, which nothing imports either.

Declaring a package so that dead code can compile adds a dependency, a licence row, a
supply chain surface and a maintenance obligation, in order to preserve 165 lines nothing
calls. **The fix for an undeclared import in a file nobody uses is to delete the file.**

`src/api/middleware/cache.ts` is dead on the same evidence but imports `ioredis`, which is
already declared, so it is not part of this pull request. It goes with the Redis removal,
which is separate work and a separate argument.

**Who decides:** Serene Labs, technical. Both AWS SDK packages get a row in `MANIFEST.md`
in the same pull request, because a dependency added without one is a defect.

---

## 5. `config/.env.example`

**Mechanical, once the variable set is measured rather than recalled.** Copy
`files/config-env.example` to `config/.env.example`.

**Twenty seven variables**, read from source under `config/`, `scripts/`, `src/api/`,
`src/shared/` and `src/web/` on 22 August 2026. The audit said nineteen; the correction and
its consequence are in `00-pull-request-order.md`, section 5. Two further variables exist
and are deliberately excluded: `REACT_APP_API_URL`, read only by `src/mobile`, and
`WEB_URL`, read only by the two e2e files deleted in PR 6.

**The file does not silently fall behind the code.**
`scripts/ci/assert-foundations.mjs` re-derives the set on every CI run and fails if a
variable is read from source and not listed. A partial `.env.example` is worse than none,
because it reads as complete and the omissions are then found one restart at a time.

**Four warnings are embedded in the file rather than kept in a document**, because the
people who read `.env.example` are the people who most need them: `API_KEY` unset makes the
auth middleware fail open; `NFC_CHIP_TYPE` defaults to `NTAG216` and the chip is an
ST25TV02KC; `NEXT_PUBLIC_API_URL` has two different defaults in this repository and one of
them names a GraphQL endpoint the Express REST API does not speak; `REDIS_URL` and
`REDIS_HOST`/`REDIS_PORT` are two mechanisms for one connection belonging to two competing
clients.

**No real value goes in this file, ever.** It is committed.

---

## 6. `typeRoots` and `jsx`

The whole corrected file is `files/tsconfig.root.json`, with the reasoning in a `//` key
that TypeScript ignores. Four changes, of which two are the ones named in the brief.

### `typeRoots`

As inherited, `tsconfig.json:26`:

```json
"typeRoots": ["./node_modules/@types", "./src/shared/types"]
```

Two separate things are wrong, and only fixing the visible one leaves the damage in place.

`./src/shared/types` is **not a type root**. `typeRoots` names directories whose
*subdirectories* are each treated as an ambient `@types` package. `src/shared/types` holds
ordinary source modules, `api.ts` and `index.ts`, with no subdirectories at all, so the
entry contributes nothing. Those types are already reachable through the `@shared/*` path
mapping declared four lines above, which is what path mappings are for.

`./node_modules/@types` is the one that does the damage, and it does it by being ordinary.
Naming it preserves the default behaviour of including **every** package under
`node_modules/@types` globally, whether or not any file imports it. A deprecated
`@types/react-native` stub, a devDependency of a workspace nobody builds, hoists into the
root `node_modules` and produces `TS2688: Cannot find type definition file for
'react-native'` before a single source file is examined. tsc stops there. **A developer
running the project typecheck sees one unrelated error and no others, which reads as
"almost clean", while 326 errors sit behind it.**

**The fix is to stop naming type roots and to name types instead:**

```diff
-    "typeRoots": ["./node_modules/@types", "./src/shared/types"]
+    "types": ["node", "jest"]
```

Only what is listed is included. A transitive `@types` package can no longer break the
typecheck for work unrelated to it.

### `jsx`

As inherited there is no `jsx` key, while `include` covers `src/**/*.tsx`. Every `.tsx`
file in the include set therefore raises `TS17004`, "Cannot use JSX unless the --jsx flag
is provided": 78 of the 326 errors, all of them from `src/mobile`.

**The judgement, and it is about scope rather than about the flag.** There are two ways to
clear `TS17004` and they are not equivalent:

- **Set `"jsx": "preserve"` at the root and keep compiling `.tsx`.** Clears the error and
  keeps a root project that typechecks the Next.js app with none of the settings the
  Next.js app needs: no `next-env.d.ts`, no plugin, a different module resolution, a
  different target. It trades 78 errors for a new set.
- **Stop the root project compiling `.tsx` at all.** Chosen. `src/web` has its own project
  at `src/web/tsconfig.json` with `jsx: preserve`, the Next plugin and `next-env.d.ts`, and
  it is the only configuration that can check it correctly. `src/mobile` is out of scope per
  the Scope document and does not build. The root project covers the node side: `config`,
  `scripts`, `src/api`, `src/shared`.

`jsx` is still set, to `react-jsx`, as a defence rather than as a load bearing setting. After
the include change nothing in this project is a `.tsx` file, and the value exists so that a
stray component added at the root cannot bring the error class back.

**`src/mobile` is excluded from the root project in this pull request, and that needs no
client agreement**, because excluding a directory from a typecheck says nothing about
whether it is in version control. Removing it from `workspaces` is the separate change that
does need agreement, and it is PR 11. Splitting them this way is what lets the painful half
land on Monday.

**A fourth change, small and worth naming:** `@nfc/*` is removed from `paths`. It maps to
`src/nfc/*`, a directory that does not exist and never has. A path alias to an absent
directory is part of how `docs/DIRECTORY-GUIDE.md` came to describe four files in it in
detail.

**Who decides:** Serene Labs, technical, all four.

---

## 7. The two `jest.config.ts` typos

The whole corrected file is `files/jest.config.ts`.

| Line | As inherited | Correct | Effect of the typo |
|---|---|---|---|
| 27 | `coverageThresholds` | `coverageThreshold` | Not a property of jest's `Config` type, so ts-jest fails to compile the configuration and jest exits before discovering a single test file |
| 35 | `setupFilesAfterSetup` | `setupFilesAfterEnv` | Same class of error, and it is the reason correcting only the first typo does not help |

The recorded failure, reproduced three times during the audit:

```
Error: Jest: Failed to parse the TypeScript config file .../jest.config.ts
  TSError: jest.config.ts(27,3): error TS2561: Object literal may only specify known
  properties, but 'coverageThresholds' does not exist in type 'Partial<Config>'.
  Did you mean to write 'coverageThreshold'?
```

**The trap in fixing these mechanically.** Correcting `setupFilesAfterSetup` to
`setupFilesAfterEnv` makes jest read the entry it points at, `<rootDir>/tests/setup.ts`,
which does not exist. The failure moves one line down. So the entry is **removed** rather
than the file invented: there is nothing for a setup file to do in this repository today,
and inventing one to satisfy a configuration key is how empty files accumulate. Add it back
when there is a reason.

**The judgement attached to this one, and it is the largest in the mechanical set.**
`coverageThreshold` is corrected and then **not carried forward at all**. The inherited file
demanded 80 percent lines and statements globally, from a suite that had never executed. On
the day the dead suite is deleted, reinstating that threshold creates a gate that cannot be
met for weeks, and **a gate that cannot be met is a gate somebody disables**, at which point
the repository has a disabled coverage gate rather than an honest absent one.

What replaces it: `ci/test-floor.json`, asserting that tests **actually executed**, refusing
to sit at zero without a dated expiry, warning loudly on every build while the zero window
is open, and failing the build the day after it closes. Coverage percentage returns when
the replacement suite is stable, set from the number it achieves rather than from an
aspiration.

**Who decides:** Serene Labs, technical. It is worth telling Dan in one sentence, because
"we removed the coverage threshold" sounds like a lowering of standards read on its own and
is the opposite read alongside "the suite it applied to had never run".

`passWithNoTests` is also set explicitly to `false`. It is already the default. It is
written down because that default is the only thing standing between this repository and a
green test job that ran nothing, and a default can be changed in a pull request without
anybody reading a diff line that says so.

**One consequence of that setting is handled in the Tests job rather than here.** From the
moment PR 6 deletes the eight suites until the replacement lands, jest finds no test file,
refuses, exits 1 and writes no result file. That is jest's documented behaviour and it is
not a crash, so `scripts/ci/assert-tests-executed.mjs` treats it as a first class outcome
and hands it to the dated zero floor. See `02-test-suite-decision.md` and the head of that
script.

---

## 8. Ten `TS2702` errors at `Redis.Redis`

**Mechanical. One substitution, ten sites, six files. PR 3.**

`ioredis@5` exports `Redis` as a **class**. The inherited code treats it as a namespace:

```ts
import Redis from 'ioredis';
let redis: Redis.Redis;
```

A class is already a type, so `Redis.Redis` is not one. The compiler says so ten times:

```
$ npx tsc --noEmit -p src/api/tsconfig.json
src/api/controllers/blend.controller.ts(11,45): error TS2702: 'Redis' only refers to a type, but is being used as a namespace here.
src/api/controllers/blend.controller.ts(49,45): error TS2702: ...
src/api/controllers/blend.controller.ts(98,45): error TS2702: ...
src/api/controllers/recipe.controller.ts(11,45): error TS2702: ...
src/api/controllers/scan.controller.ts(10,45): error TS2702: ...
src/api/controllers/scan.controller.ts(52,45): error TS2702: ...
src/api/controllers/tag.controller.ts(11,45): error TS2702: ...
src/api/middleware/cache.ts(10,30): error TS2702: ...
src/api/middleware/cache.ts(58,46): error TS2702: ...
src/api/server.ts(7,12): error TS2702: ...
exit status 2
```

**The change.** Scoped to the six files that carry the ten sites, because the string occurs
nowhere else:

```bash
sed -i "s/Redis\.Redis/Redis/g" \
  src/api/server.ts \
  src/api/middleware/cache.ts \
  src/api/controllers/blend.controller.ts \
  src/api/controllers/recipe.controller.ts \
  src/api/controllers/scan.controller.ts \
  src/api/controllers/tag.controller.ts
```

`import Redis from 'ioredis'` is left exactly as it is. The imported binding is both the
constructor used at `src/api/server.ts:12` and the instance type, so nothing else moves.
After the substitution `tsc --noEmit -p src/api/tsconfig.json` exits 0 with no output,
verified on a scratch copy on 25 August 2026.

**Why it belongs in PR 3 and not in a pull request of its own.** PR 3 introduces
`src/api/tsconfig.json`. The entire point of that file is that `src/api` is a project that
compiles, and shipping a compiler configuration for a project that does not compile is the
same defect as the `build:api` script naming a tsconfig that does not exist. The two travel
together or the first one is decoration.

**Why it was missed the first time, and it is worth saying plainly.** These errors are
invisible until PR 3 exists, because before it there is no `src/api/tsconfig.json` to point
`tsc` at, and they are invisible at the root project until PR 4, because the inherited
`typeRoots` makes the root typecheck stop on `TS2688` before it reaches a source file. The
first version of this plan asserted that the typecheck and build jobs would be green after
PR 6 without running either of them. They would not have been. Recorded rather than quietly
corrected, for the same reason the two script defects in `README.md` section 4 are.

**Who decides:** Serene Labs, technical. No client decision, no dependency change, no
behaviour change: `Redis.Redis` never resolved to anything, so no runtime path moves.

**Deliberately not fixed here.** `src/api/middleware/cache.ts` is dead code on the same
evidence as `config/redis.ts`, and two of the ten sites are in it. It is corrected rather
than deleted, because deleting it belongs with the Redis removal, which is separate M3 work
with its own argument. Correcting a line in a file that is going to be deleted costs
nothing; deleting the file inside a foundational pull request would smuggle a design
decision into a mechanical one.

---

## 9. No ESLint configuration anywhere in the repository

**Judgement, on one point. PR 4.** The whole file is `files/eslintrc.json`, with the
argument for the quarantine list inside it.

The root manifest has declared `eslint`, `@typescript-eslint/parser`,
`@typescript-eslint/eslint-plugin` and `eslint-config-prettier` since June 2026, plus `lint`
and `lint:fix` scripts to run them. There has never been a configuration file for them:

```
$ npx eslint 'src/**/*.{ts,tsx}' 'config/**/*.ts' 'scripts/**/*.ts' --max-warnings=0
Oops! Something went wrong! :(
ESLint: 8.57.1
ESLint couldn't find a configuration file.
```

That is not a lint failure. It is the linter refusing to start, so **no invocation of
`npm run lint` in this repository has ever produced a result**, and a Lint job in CI could
not go green for any diff by any author.

**It is the same defect as numbers 2, 3 and 4 and it belongs with them:** a script that
names a thing which does not exist, failing at the point of use rather than at the point of
review. It sits in PR 4 rather than PR 3 because PR 4 is the pull request whose whole claim
is that the instruments now tell the truth, and this is the third instrument.

**The judgement, and it is the only one in the file.** `eslint:recommended` and
`plugin:@typescript-eslint/recommended` are adopted whole. Against the inherited tree they
report **fourteen problems in nine files**, twelve unused variables or imports and two
explicit `any`, measured on 25 August 2026 and reproduced with the quarantine block
removed. Nine inherited files are quarantined **by name**, in a committed block, rather than
either turning the two rules off globally or folding fourteen source edits into a
configuration pull request. The full argument for that choice, and the instruction to delete
entries rather than add them, is at the head of `files/eslintrc.json`.

It **adds no dependency**: every package it references is already declared and already
installed, so no row is added to `MANIFEST.md`.

**Verified.** With PRs 1 to 4 applied on a scratch copy, the exact CI command exits 0 with
no output. With the quarantine block emptied it reports the fourteen problems and exits 1.
With one unused variable added to a file outside the list it reports that variable by name
and exits 1. The gate is live rather than green by construction.

**Who decides:** Serene Labs, technical.

---

## 10. Why the set was seven and is now nine

Both additions were found the same way, and it is the way the first seven should have been
confirmed: the sequence was applied to a scratch copy of `nfc-development` and every gate
was run, rather than reasoned about. Defect 8 is invisible until PR 3 creates the project
that exposes it. Defect 9 is invisible to anyone who reads `package.json`, sees `eslint`
declared with two plugins and a script, and does not run it.

The general lesson is written into `scripts/ci/assert-foundations.mjs` rather than left
here: check 6 now asserts that a repository declaring a linter has a configuration for it,
so this class of defect announces itself on the first CI run rather than after a fortnight
of red checks. Against the inherited tree the script now reports **sixteen** problems in one
pass, not fifteen.
