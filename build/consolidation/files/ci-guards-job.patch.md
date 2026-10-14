# The `Guards` job, the exact change

Destination: `.github/workflows/ci.yml` in `nfc-development`. **PR 8** of the consolidation
plan, not PR 7.

---

## Why this is a separate patch document rather than part of `workflows/ci.yml`

`ci.yml` lands in PR 7. The `Guards` job runs `scripts/ci/assert-slugs.mjs`, and that script
cannot pass in PR 7 for two independent reasons, neither of which any author of a later
pull request can fix inside their own diff:

1. `assert-slugs.mjs` reads `config/redirect-table.json` and exits 1 if it is absent. That
   file is a copy of the canonical redirect table and it arrives in PR 8.
2. `assert-slugs.mjs` forbids the older blend slug spelling anywhere in tracked source. It
   is present five times in three files at HEAD `2220c43`. The rename is PR 8.

So a `Guards` job in PR 7 is a job that is red on the pull request that introduces it, and
red on `main` until PR 8 merges. Marking it required at PR 7, which is what an earlier
version of `README.md` did, blocks every other open branch for that whole gap.

**The rule the plan now applies, in one sentence: a job lands in the same pull request as
the thing it measures.** The slug rename, the canonical table it is checked against, the
script that does the checking and the CI job that runs the script are one change with four
parts, and `00-pull-request-order.md` section 2, PR 8, already argues that the rename and
the guard must not travel separately. This patch is that argument carried one step further
than it was carried the first time.

The same rule sends `contract-tests.yml` to PR 9 and `performance-budget.yml` to PR 10.

---

## The change

Insert this job into `.github/workflows/ci.yml` immediately after the `foundations` job and
before the `typecheck` job. Nothing else in the file is touched.

```diff
       - name: Install from the lockfile
         run: npm ci
 
+  # --------------------------------------------------------------------- guards --
+  # Invariants that need no dependency install and must never regress. Kept separate so
+  # they still report when the dependency tree is broken.
+  #
+  # This job arrives in PR 8, with the rename it protects and the canonical table it
+  # reads. It is deliberately not in the pull request that introduces this workflow: the
+  # script it runs needs config/redirect-table.json and needs the older spelling to be
+  # gone, and both of those are in the same diff as this job.
+  guards:
+    name: Guards
+    runs-on: ubuntu-latest
+    timeout-minutes: 5
+    steps:
+      - uses: actions/checkout@v4
+
+      - uses: actions/setup-node@v4
+        with:
+          node-version-file: .nvmrc
+
+      # The blend slugs in this repository against the canonical redirect table. One
+      # thousand tags are encoded and shipped, /t/sr resolves to silk-road, and the tags
+      # cannot change, so the application must not drift back to the older spelling that
+      # three separate datasets in this repository once carried. This is the only check
+      # in the repository that catches a renamed slug before a customer taps a jar.
+      #
+      # Note for whoever edits this file: the guard forbids that spelling ANYWHERE in
+      # tracked source, prose included, so do not quote it in a comment. That is
+      # deliberate. A denylist with prose exemptions is a denylist with a hole in it,
+      # and this one was caught by running the guard against this workflow.
+      - name: Blend slugs match the canonical redirect table
+        run: node scripts/ci/assert-slugs.mjs
+
   # ------------------------------------------------------------------ typecheck --
```

One further line changes, in the header comment of the same file:

```diff
-# Required status checks on the default branch as this file stands: Foundations,
-# Typecheck, Lint, Tests, Build.
+# Required status checks on the default branch: Foundations, Guards, Typecheck, Lint,
+# Tests, Build.
```

---

## What lands with it

The rest of PR 8, from `03-slug-fix.md`:

| File | What |
|---|---|
| `config/redirect-table.json` | Copy of the canonical table from the edge package. Temporary, and says so in its own comment |
| `scripts/ci/assert-slugs.mjs` | The guard |
| `src/shared/constants/index.ts` | One occurrence renamed |
| `src/web/pages/blend/[id].tsx` | Three occurrences renamed |
| `src/web/pages/index.tsx` | One occurrence renamed |

Mark `Guards` required on `main` after this pull request merges, not after PR 7.

---

## Verified, not asserted

Run on a scratch copy of `nfc-development` at HEAD `2220c43`, with PRs 1 to 8 applied in
order, on Tuesday 25 August 2026. Node 20.19.0, npm 10.8.2.

At PR 7, with this job absent, `ci.yml` defines five jobs and every one of them exits 0.

At PR 8 the guard is run twice, deliberately: once with the canonical table copied in and
the rename **not yet applied**, to prove the check is live, and once after it.

Before the rename, with `config/redirect-table.json` present:

```
$ node scripts/ci/assert-slugs.mjs
Canonical slugs, from config/redirect-table.json version 2:
  /t/ps  ->  persian-sunrise  (encoded, 250 units encoded)
  /t/cs  ->  caribbean-sunset  (encoded, 250 units encoded)
  /t/sr  ->  silk-road  (encoded, 250 units encoded)
  /t/nm  ->  north-african-night-market  (encoded, 250 units encoded)
  /t/kg  ->  kyoto-garden  (reserved, 0 units encoded)

SLUG GUARD FAILED. 1 problem(s).

1. The forbidden slug "the-silk-road" appears 5 time(s).
    src\shared\constants\index.ts:52: id: 'the-silk-road',
    src\web\pages\blend\[id].tsx:194: 'the-silk-road',
    src\web\pages\blend\[id].tsx:340: 'the-silk-road': {
    src\web\pages\blend\[id].tsx:341: id: 'the-silk-road',
    src\web\pages\index.tsx:146: id: 'the-silk-road',
exit 1
```

After the substitution:

```
$ node scripts/ci/assert-slugs.mjs
Canonical slugs, from config/redirect-table.json version 2:
  /t/ps  ->  persian-sunrise  (encoded, 250 units encoded)
  /t/cs  ->  caribbean-sunset  (encoded, 250 units encoded)
  /t/sr  ->  silk-road  (encoded, 250 units encoded)
  /t/nm  ->  north-african-night-market  (encoded, 250 units encoded)
  /t/kg  ->  kyoto-garden  (reserved, 0 units encoded)

Slug guard passed: 5 canonical slugs, no forbidden spellings.
exit 0
```

Then the block above was inserted into `.github/workflows/ci.yml` and the guard re-run,
because it scans `.yml` as well as source and this comment quotes the rule about not
quoting the forbidden spelling. It still exits 0, and the file parses to six jobs:
`Foundations`, `Guards`, `Typecheck`, `Lint`, `Tests`, `Build`.

**One correction to an earlier version of this document.** It printed a five line
transcript giving the north African code as `/t/nn` and listing the entries in a different
order from the file. The canonical table gives `nm`, and the order is `ps`, `cs`, `sr`,
`nm`, `kg`. The transcript above is copied from a terminal rather than composed. A quoted
run that was not run is the same defect as a claim of green that was not run, and this
package exists to argue against it.
