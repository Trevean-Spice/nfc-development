# Third-party manifest, edge redirect

**For the SOW section 7 background-IP obligation:** any pre-existing library or framework we reuse must be listed explicitly and licensed to Trevean Spice to run and maintain the product indefinitely.

**Status: 17 August 2026.**

---

## 1. The short version

**Zero third-party libraries. Zero runtime dependencies. Zero development dependencies. No `node_modules`, no lockfile, nothing to audit and nothing to renew.**

`package.json` declares no `dependencies` and no `devDependencies`, and a test asserts it stays that way. Every line in this directory was written for this engagement.

This is a deliberate choice rather than an accident of a small package. The code path it protects is one thousand encoded tags that cannot be re-encoded, and it executes inside a runtime with a 10 KB code limit and no network access. A dependency here would be a supply chain with physical inventory behind it, for functionality the standard library already provides.

---

## 2. Serene Labs background IP used in this deliverable

**None.** Every file in this directory is work-for-hire owned by Trevean Spice on full payment. No Serene Labs library, template or proprietary tool is used, embedded or required to build, test, deploy or operate it.

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
| `node:fs` | build, validate, verify, tests | reading the table, the template and the not-found page, writing `dist/` |
| `node:crypto` | `lib/table.mjs` | the SHA-256 digest behind the `x-trevean-table` identifier |
| `node:path`, `node:url` | throughout | resolving paths relative to the package, on Windows and on Linux |
| `node:child_process` | `lib/previous.mjs` | reading the previously committed table out of git for the repoint check |
| `node:vm` | tests | evaluating the compiled function in an empty context, which is the closest available approximation of the CloudFront Functions sandbox |
| `node:https`, `node:http`, `node:dns` | `scripts/verify-live.mjs` | the cutover day requests, including the `curl --resolve` equivalent |
| `node:test`, `node:assert` | tests | the test runner, built into Node 20 and later. This is why there is no Jest, Mocha, Vitest or Chai in this package |

---

## 6. Runtime and tooling, used but not redistributed

| Component | Licence | Note |
|---|---|---|
| Node.js 20 or newer | MIT | Build and test time only. Nothing from it is shipped to the edge or to a browser. |
| npm | Artistic-2.0 | Bundled with Node.js. Used only to invoke scripts; it installs nothing. |
| git | GPL-2.0 | Invoked read only by the repoint check, as an external program. Not linked, not embedded, not redistributed. Its absence is handled and reported rather than fatal. |
| CloudFront Functions JavaScript runtime 2.0 | Proprietary, AWS | The execution environment for `dist/redirect.js`. Provided by AWS as part of the service, on Trevean's own account. Nothing is licensed to us or by us. |

---

## 7. What ships to the edge

`dist/redirect.js`, generated from `redirect-table.json` and `src/`. **It contains no third-party code of any kind.** The same is true of the branded 404 page compiled into it: no script, no stylesheet, no font, no image, no analytics, no external request. That is enforced by a test, and it is also what makes the page work when every origin is down.

---

## 8. Standing obligation

Keep this list current from day one rather than reconstructing it at handoff. If a dependency is ever added here, it belongs in this file with its licence and its reason on the same day it is added, and the "zero dependencies" test in `test/artifacts.test.mjs` will fail until this file is revisited deliberately.

Risk R13 exists because the existing `nfc-development` repository may contain proprietary libraries left by the previous contractor. The same discipline that catches that has to apply to everything we add.
