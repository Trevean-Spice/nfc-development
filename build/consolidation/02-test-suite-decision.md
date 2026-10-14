# The test suite: delete it

**Document date:** Saturday 22 August 2026
**Decision:** delete all eight suites, 2,102 lines, in one pull request. Do not repair them.
**Who decides:** Serene Labs, technical. It needs no client agreement. Dan is told in one
sentence, because "we deleted the tests" reads badly on its own and reads correctly
alongside "they had never run".
**Reversibility:** total. Deletion in git is recoverable, and the commit is tagged
`pre-consolidation-tests` so the files are one command away for anyone who wants to read
them.

---

## 1. The decision, first

**Delete all eight files.** The audit recommends deleting two of them,
`tests/unit/encoder.test.ts` and `tests/e2e/nfc-flow.test.ts`, and repairing the rest by
implication. **That is half a decision and it is the wrong half**, for the reason in
section 3: the argument that condemns those two applies with equal force to the other six,
and leaving six behind creates exactly the tidy-up invitation the recommendation exists to
prevent.

| File | Lines | Deleted | Why |
|---|---|---|---|
| `tests/unit/encoder.test.ts` | 215 | Yes | Tests `src/nfc/encoder`, which does not exist, against NTAG216 memory figures |
| `tests/e2e/nfc-flow.test.ts` | 230 | Yes | Tests `src/nfc/simulator`, which does not exist, on the retired per-tag identity model |
| `tests/unit/utils.test.ts` | 221 | Yes | Asserts an 840 character payload limit and a function signature the repository does not have |
| `tests/unit/blend.resolver.test.ts` | 240 | Yes | Imports `src/controllers/`, `src/models/`, `src/types/`. None of those paths exists |
| `tests/unit/scan.resolver.test.ts` | 295 | Yes | Same, plus the retired identity model |
| `tests/integrations/api.test.ts` | 378 | Yes | Same paths, plus calls `BlendModel.scan()`, a method that does not exist |
| `tests/integrations/database.test.ts` | 285 | Yes | Same |
| `tests/e2e/web-navigation.test.ts` | 238 | Yes | Imports `node-fetch`, which is declared nowhere, so it cannot compile. A second `@playwright/test` suite is pasted below it inside a block comment at lines 214 to 238, against a framework the repository does not declare |
| | **2,102** | | |

Line counts measured with `wc -l` on 22 August 2026, not carried over.

---

## 2. What is actually true about these files

Four facts, each verified by reading the files rather than by reading the audit.

**They have never executed.** `npm test` fails while parsing `jest.config.ts`. Bypassing
that with a corrected inline configuration: eight suites, eight failures, **zero tests**.
Every suite fails at compile time because every one imports module paths this repository
has never had: `../../src/nfc/encoder`, `../../src/nfc/simulator`, `../../src/types/index`,
`../../src/types/nfc`, `../../src/utils/index`, `../../src/models/*`,
`../../src/controllers/*`. The real directories are `src/shared/types`, `src/shared/utils`,
`src/api/models` and `src/api/controllers`, and `src/nfc` does not exist at all.

**They describe a different product.** `tests/unit/blend.resolver.test.ts:18` is
`name: 'Ethiopian Yirgacheffe'` with `grower: 'Muldhima Cooperative'`. That is coffee. The
same file puts `roastDate` and `expiryDate` on a blend; the real interface has
`harvestDate` and `freshnessWindowDays`. `tests/unit/utils.test.ts` calls
`calculateFreshnessStatus(roastDate, today)` with two dates against a real signature of
`(harvestDate: Date, windowDays: number)`, and expects the string `'Fair'` against a real
enum of `FRESH`, `GOOD`, `AGING`, `EXPIRED`.

**They assert the wrong chip, in nine places across three files.** `toBeLessThanOrEqual(840)`
at `encoder.test.ts:82`, `:163` and, inverted, `:190`; at `nfc-flow.test.ts:35`; and four
more in `utils.test.ts:100` to `:114`. **840 is `888 minus 48`: NTAG216 total memory less an
assumed NDEF header.** The tag is an ST25TV02KC with 2 Kbit, **256 bytes**. The assertions
are wrong by a factor of roughly 3.3 in the permissive direction.

They are also wrong about the record structure. `encoder.test.ts:123` to `:134` asserts that
a message combining a URI record and a text record produces two records and that this is
supported. The tag carries **one NDEF record, a URI record, nothing else**, and read-back
verification check 1 in the tag writing instructions is "One record only, not two". **The
test asserts that the opposite behaviour works.**

**They test the identity model that was retired.** `tests/e2e/nfc-flow.test.ts` sends
`tagUid` on every scan write, eight times. Attribution is per SKU: there is no per-tag
identifier and no chip UID available to the page.

---

## 3. Why repair is the wrong answer, stated as the failure it produces

The repair path looks cheap. Fix seven import paths, rename a few types, and 2,102 lines of
test coverage come back. It is the obvious next action for anybody tidying this repository,
and it is precisely the action that does the damage.

**Here is the sequence, written out, because the argument only lands as a sequence.**

1. An engineer fixes the imports. The suites compile.
2. Most assertions fail, because the domain model is different. The engineer fixes the ones
   that fail: renames `roastDate` to `harvestDate`, changes `'Fair'` to `GOOD`, adjusts the
   `calculateFreshnessStatus` signature.
3. **The nine payload-size assertions do not fail.** `toBeLessThanOrEqual(840)` passes
   against any payload smaller than 840 bytes, and every payload this project produces is.
   `https://treveanspice.com/t/ps` is 29 characters. There is nothing to notice.
4. The suite goes green.
5. From that moment, CI asserts on every commit that a payload of up to 840 bytes fits on
   the tag. **It does not. The tag has 256 bytes.** A 500 byte payload passes CI and does
   not fit on the chip.

**The green is the problem, not the red.** A failing test gets read. A passing test gets
trusted, and this one would be trusted about hardware that has already shipped in a
thousand units. The audit puts it precisely: the risk is not currently live because the
files cannot run, and **it becomes live the moment somebody fixes the imports without
reading the assertions**.

Two things make that outcome likely rather than hypothetical. The assertions are numeric
constants with no unit and no comment, so nothing about them invites a second look. And
they are consistent with `src/shared/constants/index.ts:83` to `:85`, `NTAG216_MEMORY_BYTES:
888` and `MAX_URL_LENGTH: 840`, so an engineer who checks the test against the codebase
finds agreement. **The wrong number is corroborated inside the repository.** That is the
strongest possible argument for deletion over repair: repair is checkable against a source
of truth that is itself wrong.

---

## 4. Why all eight rather than the two the audit names

The audit names `encoder.test.ts` and `nfc-flow.test.ts` because those two are where the
chip assertions are most concentrated. But `utils.test.ts` carries four of the nine 840
assertions as well, and the deeper reason applies to every file:

**Nothing in any of the eight tests a module that exists.** Not one import resolves. The
suites do not test this repository with the wrong assertions; they test a repository that
was never built. There is no partial value to preserve, because there is no file among the
eight in which a working import sits next to a broken one.

And the practical point. Deleting six of eight leaves a `tests/` directory that still looks
substantial, is still referenced by five npm scripts, and still invites exactly the repair
described in section 3. **A half-deleted suite preserves the hazard and loses the argument
for it**, because the next engineer sees six surviving files and reasonably concludes the
project decided repair was fine.

---

## 5. What replaces them

Deletion is not "no tests". It is the removal of tests that do not run, in a plan where
their replacements are already written or already scheduled. Each of the four things the
old suite claimed to cover has a named successor.

| The old suite claimed | Actually provided | Replaced by | State |
|---|---|---|---|
| API behaviour: `api.test.ts`, `database.test.ts`, `blend.resolver`, `scan.resolver`, 1,198 lines | Nothing. Every import unresolved | **`contract-tests/`**, 202 tests across 15 suites, driven by the OpenAPI document rather than transcribed from it, with an operation-coverage assertion that fails if any declared operation goes unexercised | **Written.** Lands in PR 9 |
| NDEF encoding and chip limits: `encoder.test.ts`, `nfc-flow.test.ts`, 445 lines | Assertions against a 256 byte chip using an 840 byte NTAG216 constant | **The tag writing and verification instructions**, and the chip tooling built in M4 against ST25TV02KC figures. Any successor test asserts **256 bytes** and **exactly one URI record** | **Scheduled**, M4. Nothing in the deleted files survives into it |
| The redirect and the tap path: `web-navigation.test.ts`, 238 lines | Nothing. The scaffold contains no concept of `/t/{code}` at all | **The edge package's own test suite**, plus the tap-path assertions in the performance budget CI, including the exactly-one-redirect and 307 checks | **Written.** Budget CI lands in PR 10 |
| Utility behaviour: `utils.test.ts`, 221 lines | Wrong signatures, wrong enum, wrong payload constant | **A new unit suite** in `tests/unit/`, written against the real signatures once the blend dataset is consolidated to one source of truth | **Scheduled.** This is the only genuinely new writing the deletion creates |

**Three test names worth re-creating**, read out of the old files before deleting them,
because the intent behind them was sound even though the implementation was not:

1. Freshness at the exact boundary. `utils.test.ts` tested the day the window closes. Keep
   the case, fix the signature to `(harvestDate: Date, windowDays: number)` and the
   expected values to the real enum.
2. Payload size at the exact limit. `utils.test.ts:107` tested a payload exactly at the
   limit. Keep the shape, change 840 to **256**, and assert bytes rather than characters,
   because the old test conflated the two and on a URI containing no multi-byte character
   the difference is invisible until it is not.
3. Duplicate scan handling. `nfc-flow.test.ts` reached for it and used `tagUid` to express
   it. The successor expresses it with `dedupToken` and `windowId`, which is what the
   frozen contract specifies.

---

## 6. The gap, named and dated rather than papered over

Between PR 6 and the replacement suites there is a window in which jest has nothing to run.
**The honest instrument for that is a dated zero, not a green check.**

`ci/test-floor.json` is committed in the same pull request as the deletion:

```json
{ "minimumTests": 0, "expires": "2026-09-11",
  "reason": "Window between deleting the eight dead suites (PR 6) and landing their replacement." }
```

`scripts/ci/assert-tests-executed.mjs` enforces three things about that zero:

- it **refuses** a zero floor with no expiry, because an undated zero is the old situation
  with a configuration file in front of it,
- it **warns on every single build** while the window is open, in these words: "This job
  CANNOT FAIL while that is true. Do not read a green Tests check as evidence that this
  repository is tested",
- it **fails the build** the day after the expiry.

**One mechanical detail that had to be corrected before any of the above could happen.**
`jest.config.ts` sets `passWithNoTests: false`, so once the eight suites are deleted jest
finds no test file, exits 1 and **writes no result file at all**. That is its documented
behaviour and it is not a crash. The first version of the assertion script read an absent
result file as a crash and named the two jest configuration typos as the cause, which PR 4
had already fixed, so for the whole of this window the Tests check would have been red with
an explanation that was false and the dated zero would never have been consulted. The Tests
job now captures jest's own output, the script classifies the run from it, and "no tests
found" is a first class outcome handed straight to the floor. Observed on a scratch copy with
PRs 1 to 6 applied, 25 August 2026:

```
$ npx jest --config jest.config.ts --ci --json --outputFile=jest-results.json
No tests found, exiting with code 1
exit 1

$ node scripts/ci/assert-tests-executed.mjs --results jest-results.json \
    --floor ci/test-floor.json --jest-output jest-output.txt --jest-exit-code 1
WARNING: the test floor is 0 until 2026-09-11.
This job CANNOT FAIL while that is true.
  suites  0 discovered. jest found no test file to run.
  tests   0 executed
  floor   0
Tests gate passed under the dated zero floor.
exit 0
```

`passWithNoTests` stays `false`. The point was never that jest should tolerate an empty run.
It is that the decision about an empty run belongs to a committed, dated floor that warns on
every build and expires, rather than to a flag any pull request can flip.

Friday 11 September 2026 is the end of the M3 window. If the replacement is not in by then,
extending the date is a decision about a contractual gate and belongs in the decision log
naming who asked and what moved, not in a quiet edit to a JSON file.

Note that the window is narrower than it looks: the contract test suite lands in PR 9,
inside the window, and it runs under `node --test` with its own required status check
rather than under jest. **So the repository is not untested during the window. It is
un-unit-tested**, which is a smaller claim and the accurate one.

---

## 7. What this costs and what it saves

**Cost.** The 24 to 40 hours the audit estimates for regenerating tests from the OpenAPI
document is largely already spent: `contract-tests/` exists and has 202 tests. What remains
is the unit suite in row 4 of section 5, which is small because the surface it covers is
small.

**Saved.** Not the deletion itself, which takes minutes. What is saved is the repair that
does not happen: seven import paths, a domain model translation across eight files, and the
half day of somebody's confusion when the freshness enum does not match. That work would
have produced a suite testing a product nobody is building, and one green assertion about a
chip that would have been believed.

**The single sentence for Dan:** the repository contains 2,102 lines of test code that have
never run and cannot run, they assert an 840 byte memory limit against a tag that has 256
bytes, and repairing them would turn that assertion green rather than fix it, so they are
being deleted and replaced by the contract test suite that is already written.
