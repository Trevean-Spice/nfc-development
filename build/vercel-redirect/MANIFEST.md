# Third party manifest, Vercel redirect

**For the SOW section 7 background IP obligation:** any pre-existing library or framework we reuse must be listed explicitly and licensed to Trevean Spice to run and maintain the product indefinitely.

**Status: Tuesday 25 August 2026.**

---

## 1. The short version

**Zero third-party libraries. Zero runtime dependencies. Zero development dependencies. No `node_modules`, no lockfile, nothing to audit and nothing to renew.**

`package.json` declares no `dependencies` and no `devDependencies`, and a test asserts it stays that way. A second test asserts every `import` in this package resolves either to a `node:` standard library module or to a relative path inside the package. Every line in this directory was written for this engagement.

This is a deliberate choice rather than an accident of a small package. What it protects is 1,000 encoded tags that cannot be re-encoded. A dependency here would be a supply chain with physical inventory behind it, for functionality the standard library already provides.

---

## 2. Serene Labs background IP used in this deliverable

**None.** Every file in this directory is work for hire owned by Trevean Spice on full payment. No Serene Labs library, template or proprietary tool is used, embedded or required to build, test, deploy or operate it.

---

## 3. npm packages, direct

**None.**

---

## 4. npm packages, transitive

**None.** There is nothing to be transitive from.

---

## 5. Node.js standard library modules used

Built into Node.js and covered by the Node.js licence. Not redistributed, not vendored, not pinned.

| Module | Used by | For |
|---|---|---|
| `node:fs` | build, tests | reading the canonical table and the not found page, writing `dist/` |
| `node:path`, `node:url` | throughout | resolving paths relative to the package, on Windows and on Linux |
| `node:https`, `node:http` | `scripts/verify-live.mjs` | the live verification requests |
| `node:test`, `node:assert` | tests | the test runner, built into Node 20 and later. This is why there is no Jest, Mocha, Vitest or Chai in this package |

---

## 6. Runtime and tooling, used but not redistributed

| Component | Licence | Note |
|---|---|---|
| Node.js 20 or newer | MIT | Build and test time only. Nothing from it is shipped to Vercel or to a browser. |
| npm | Artistic-2.0 | Bundled with Node.js. Used only to invoke scripts; it installs nothing. |
| Vercel platform routing | Proprietary, Vercel Inc. | The execution environment for `dist/vercel.json`. Provided by Vercel as part of the service, on Trevean's own account and existing project. Nothing is licensed to us or by us. `vercel.json` is a configuration file consumed by that service, not a library, and it contains no Vercel code. |

---

## 7. Cross package dependency, and it is not a library

This package reads **`build/edge/redirect-table.json`** at build time. That file is Trevean Spice's own data, produced under this engagement, and it is the single source of truth for every encoded tag. It is read and never copied, so the two serving surfaces cannot drift.

It is recorded here for completeness rather than as a licensing matter: it is the client's own content, not third party code. The practical consequence for handover is that **this package does not stand alone**. It must be kept alongside `build/edge`, or the table it compiles must travel with it. `lib/table.mjs` fails loudly with an explanation rather than emitting an empty configuration if the table is absent.

---

## 8. What ships to Vercel

`dist/vercel.json`, `dist/redirects.json` and `dist/404.html`, all generated from `redirect-table.json` and `src/`. **They contain no third party code of any kind.**

The same is true of the branded 404 page: no script, no stylesheet, no font, no image, no analytics and no external request. That is enforced by a test, and it is also what makes the page work when every origin is down.

---

## 9. Standing obligation

Keep this list current from day one rather than reconstructing it at handoff. If a dependency is ever added here, it belongs in this file with its licence and its reason on the same day it is added, and the zero dependencies test in `test/package.test.mjs` will fail until this file is revisited deliberately.

Risk R13 exists because the existing `nfc-development` repository may contain proprietary libraries left by the previous contractor. The same discipline that catches that has to apply to everything we add.
