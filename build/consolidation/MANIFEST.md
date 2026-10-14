# Third-party manifest, consolidation package

**For the SOW section 7 background-IP obligation:** any pre-existing library or framework we
reuse must be listed explicitly and licensed to Trevean Spice to run and maintain the
product indefinitely.

**Status: Saturday 22 August 2026.** Every version and licence below was read from an
installed manifest or from a pinned action reference on this machine, not recalled, except
where a row says otherwise. Rows marked **INDICATIVE** are to be replaced by generated
output at adoption.

**The standing rule for this engagement: a dependency added anywhere in `nfc-development`
without a row in a manifest like this one is a defect.** Reconstructing the list in the last
week of September, against a fixed demo date, is exactly the avoidable problem the
obligation was written to prevent.

---

## 1. Serene Labs background IP used in this package

**None.** Every file in `build/consolidation/` was written for this engagement and is
work-for-hire owned by Trevean Spice on full payment. No Serene Labs library, template or
proprietary tool is used, embedded or required to run any of it.

The three assertion scripts in `scripts/` use the **Node standard library only**:
`node:fs`, `node:path`, `node:module`. They have no dependencies at all, which is not an
aesthetic choice: the Foundations job has to be able to run and report before any dependency
install has happened, and it has to keep working on a repository whose dependency tree is
broken.

---

## 2. GitHub Actions

Every action used by the three workflows in `workflows/`.

| Action | Version | Licence | Publisher | Used by |
|---|---|---|---|---|
| `actions/checkout` | v4 | MIT | GitHub, Inc. | all three workflows |
| `actions/setup-node` | v4 | MIT | GitHub, Inc. | all three workflows |
| `actions/upload-artifact` | v4 | MIT | GitHub, Inc. | `ci.yml`, `performance-budget.yml` |

**No third-party marketplace action is used anywhere.** That is deliberate and it is worth
recording as a decision rather than a coincidence: a marketplace action is code executing
with repository credentials on every build, and the common Lighthouse and test-reporter
actions add a supply-chain dependency for convenience that the CLI already provides.

---

## 3. npm packages this consolidation ADDS to `nfc-development`

These are the rows that did not exist in the audit's section 12.1 table and are being
introduced by this work. Everything already in the repository is listed in that table and is
not duplicated here.

| Package | Declared | Licence | Copyright holder | Why, and which PR |
|---|---|---|---|---|
| `@aws-sdk/client-dynamodb` | `^3.658.0` | Apache-2.0 | Amazon.com, Inc. | Imported at `config/database.ts:1` and `scripts/seed.ts:2` and declared nowhere. PR 3 |
| `@aws-sdk/lib-dynamodb` | `^3.658.0` | Apache-2.0 | Amazon.com, Inc. | Imported at `scripts/seed.ts:1` and declared nowhere. PR 3 |
| `@lhci/cli` | `^0.14.0` | Apache-2.0 | Google LLC | Runs Lighthouse, aggregates runs, asserts metric and resource-summary thresholds. The only npm dependency of the performance budget CI. PR 10 |

**`.eslintrc.json` adds nothing to this table, and that is worth one line rather than
silence.** PR 4 introduces the first ESLint configuration this repository has ever had. It
references `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin` and
`eslint-config-prettier`, all three of which are already declared in the root manifest and
already installed, so no dependency is added, no licence row is created and no obligation
changes. Verified by installing from the committed lockfile and running the CI lint command,
25 August 2026.

**Not added, and worth recording as an absence.** `redis` is imported at `config/redis.ts:1`
and is declared nowhere. It is **not** being declared: the file that imports it is dead code,
verified by grepping the repository for `config/redis`, `./redis` and `RedisCache` and
finding only its own definitions, and it is a second client for a service everything live
reaches through the already declared `ioredis`. The file is deleted instead, so no licence
row is created. Adding a dependency to make dead code compile creates a permanent obligation
for a temporary convenience.

---

## 4. npm packages in the contract test suite

Read from the installed tree in `build/contract-tests/node_modules` on 22 August 2026. This
package is self contained, with its own lockfile and its own Node floor, and it moves into
`nfc-development` as a directory in PR 9.

**Direct:**

| Package | Installed | Licence | Why |
|---|---|---|---|
| `ajv` | 8.20.0 | MIT | Validates request and response bodies against the OpenAPI schemas directly, so the tests cannot duplicate the contract and drift from it |
| `ajv-formats` | 3.0.1 | MIT | Format assertions the OpenAPI document relies on |
| `yaml` | 2.9.0 | ISC | Reads the OpenAPI 3.1 document at run time |
| `typescript` | 5.9.x | Apache-2.0 | dev only |
| `@types/node` | 20.19.x | MIT | dev only |

**Transitive, complete for this tree:**

| Package | Licence |
|---|---|
| `fast-deep-equal` | MIT |
| `json-schema-traverse` | MIT |
| `require-from-string` | MIT |
| `fast-uri` | **BSD-3-Clause** |
| `undici-types` | MIT |

Ten packages in total, which is the whole tree. **No copyleft licence appears in it.**

---

## 5. npm packages under `@lhci/cli`

**INDICATIVE.** Not produced from an installed tree on this machine. `scripts/licenses.mjs`
regenerates this list from the real tree on every CI build and `--check` exits non-zero if
any installed package declares no licence at all.

| Package | Licence | Note |
|---|---|---|
| `lighthouse` | Apache-2.0 | Google LLC. The measurement engine |
| `chrome-launcher` | Apache-2.0 | Google LLC |
| `puppeteer-core` | Apache-2.0 | Drives the browser |
| `axe-core` | **MPL-2.0** | Deque Systems. See section 6 |
| `express` | MIT | Used by the optional Lighthouse CI server, which this configuration does not run |
| `better-sqlite3` | MIT | Same: installed by `@lhci/cli`, unused here |
| `yargs`, `inquirer`, `lodash`, `debug`, `chalk` | MIT | Standard CLI utilities |

---

## 6. Licences that are not plain permissive

**One package in everything above, and it constrains nothing.**

**`axe-core`, MPL-2.0.** Mozilla Public License 2.0 is file-level weak copyleft. It obliges
anyone who **modifies** an MPL-covered source file to publish that file's source under the
same licence. It places no obligation on a project that merely depends on the package
unmodified, and it does not affect the licensing of Trevean's own source.

**Position: no obligation is triggered.** It arrives as an unmodified transitive dependency
of a build-time development tool, it is never shipped to a browser, and the Lighthouse
configuration in this package does not run the accessibility category that uses it. Recorded
so it is seen rather than discovered.

**`fast-uri`, BSD-3-Clause.** Permissive. The only obligation is attribution in
redistributions, and nothing here is redistributed in source or binary form to anyone
outside Trevean.

**Everything else is MIT, Apache-2.0 or ISC.** `scripts/licenses.mjs` flags MPL, LGPL, GPL,
AGPL, EPL, CDDL, SSPL, BUSL and Elastic licences automatically, so a future dependency change
surfaces the same way rather than needing somebody to remember to look.

**No GPL, AGPL, LGPL, SSPL or non-commercial licence appears anywhere in this package or in
the repository's own resolved tree of 1,167 packages.**

---

## 7. Runtime, executed but not redistributed

| Component | Licence | Note |
|---|---|---|
| Node.js 20 | MIT | Provided by `actions/setup-node`, pinned by `.nvmrc` |
| npm | Artistic-2.0 | Bundled with Node.js |
| Google Chrome, stable, preinstalled on the GitHub Actions runner | Proprietary freeware; underlying Chromium is BSD-3-Clause | Executed on the runner by Lighthouse, never redistributed by us and never vendored into the repository |

---

## 8. What is not covered here

**The repository's own 1,167 package resolved tree** is inventoried in the M1 scaffold
audit, section 12.1, with resolved versions as of 19 August 2026. That table carries a
caveat that it cannot be a stable contractual artifact until a lockfile exists.

**PR 1 of this consolidation removes that caveat.** The licence list must be regenerated
against the committed lockfile at that point, with `npm run licenses`, and the result
becomes the version of record. Three items the audit could not resolve should be itemised in
the same pass: the single instances of CC-BY-4.0, Python-2.0 and an unversioned BSD were not
traced to their packages. None is copyleft and none restricts running or modifying the
product, so no conclusion changes, but "not traced" is not the same as "listed".
