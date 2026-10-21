# Third party libraries and licences

**M5 handoff deliverable. Written Saturday 22 August 2026. Corrected Tuesday 25 August 2026. Rebuilt from generated evidence on Friday 4 September 2026.**

**Satisfies:** the background IP obligation in the Scope document, "IP and handoff": any pre existing library or framework reused must be listed explicitly and licensed to Trevean Spice to run and maintain the product indefinitely, and the list is kept from day one rather than reconstructed at handoff.

---

## 0. What changed on Friday 4 September 2026, stated first because this is a contractual document and the previous version was incomplete

**The 25 August version said it consolidated every `MANIFEST.md` and then covered eleven. There are fifteen.** The four it did not cover are the publisher (`build/publisher`), the Vercel redirect (`build/vercel-redirect`), the measurement harness (`deliverables/m1/harness`) and the performance budget CI (`deliverables/m1/06-performance-budget-ci`). Two of those four install nothing, so the omission cost nothing. **Two of them did cost something:**

1. **The publisher was absent, and it carries 28 installed packages, three of them declared runtime dependencies, none of which appeared anywhere in this document.** It is also the only package in the build that runs inside a container image, and that image carries GPL and LGPL licensed programs. Section 5.
2. **The measurement harness was absent.** Three packages, all development, no obligation, but it is a delivered artifact with its own manifest and it belongs on the list.

**Two further corrections, both found by generating the list rather than reading it:**

3. **This document previously said there is no standalone LGPL anywhere. That was true of the installed tree on the machine it was read from and it is not true of the committed lockfiles.** `build/web`'s lockfile pins **twenty `@img/sharp-libvips-*` packages declared as bare `LGPL-3.0-or-later`**. They are optional binaries for macOS and Linux, so a Windows install never fetches them and a Linux CI machine always does. Section 5.2.
4. **The counts moved.** The previous figures were 459 package and version pairs across eleven packages. **Measured on Friday 4 September 2026 across all fifteen: 486 installed pairs, and 635 pairs resolved by the committed lockfiles.**

**The list is now generated, and the generator discovers packages rather than being told about them.** It looks for a `MANIFEST.md` in every directory under `build/` and `deliverables/`, so a package added next month appears here the first time the script runs. That is the actual fix. The count was wrong twice because a human maintained the list of lists.

---

## 1. What this document enumerates, and what it only summarises

**Read this section before quoting any figure out of this document.** The failure mode being avoided is the one that produced the last two corrections: a document that claims to be exhaustive, is not, and gives a reader no way to tell.

**Enumerated exhaustively, by name and version:**

- **Every package that ships third party code**, discovered by file rather than listed by hand. Section 3.
- **Every direct runtime dependency and every direct development dependency of every package**, with the declared range, the version actually installed, and its licence. Section 7.
- **Every distinct licence string that appears anywhere in any installed tree**, and separately every distinct licence string in the committed lockfiles. Section 4.
- **Every package and version pair whose licence is not plainly permissive.** Section 6.
- **Every copyleft licence, and where it is.** Section 5.

**Summarised rather than enumerated:**

- **Transitive dependencies are counted and broken down by licence here, not listed by name here.** The per package `MANIFEST.md` files carry the full per package enumeration, and each of the eight packages with an installed tree now has a machine generated list of every package in it. This document consolidates those; it does not reproduce 486 rows.
- **Trevean's own inherited `nfc-development` repository is not in scope of this document.** Section 11.
- **The `@lhci/cli` tree is not installed on any machine here**, so the performance budget CI package contributes a declared dependency and no transitive enumeration. Section 12, item 1.
- **The container image's Debian userland is described by class, not enumerated package by package.** Debian's own archives are the enumeration. Section 5.3.

**Three things about the figures themselves.**

**They are read from installs on one machine, running Windows on x64, and installs are platform specific.** Where a package resolves a different binary on macOS or Linux, the licence position is stated for both. That is why every table below carries an installed column and a resolved column.

**Nothing in this document has been verified against a deployed system**, because the counting happens against source trees rather than against running infrastructure. That does not weaken the conclusions, which are properties of packages rather than of environments.

**A package and version pair is the unit.** The same package appears in several trees, often at different versions, and each installed copy is its own licence grant. Counting names understates it and counting copies on disk overstates it.

---

## 2. The answer a lawyer needs, first

**Nothing in this build restricts Trevean Spice from running, modifying, or engaging any third party to modify this software indefinitely.**

**Nothing third party reaches a customer's browser. Not one byte.** The blend page ships hand written HTML, one inline stylesheet, one 172 byte inline loader, one first party enhancement module, and a field beacon that is itself work for hire. No framework runtime, no polyfill, no analytics, no font host, no map SDK. That is not an aspiration, it is checked on the built output by an automated verification step, which reports **211 checks passing**, and measured by the performance runs. The admin CMS and the analytics dashboard are internal tools and are the same: server rendered HTML and first party JavaScript, no client framework, no bundler, no CSS framework, no icon set, no web font, no charting library.

**Nothing third party reaches the CDN edge either.** The compiled redirect function and the branded 404 page compiled into it contain no third party code of any kind, on either of the two hosting routes. The same is true of the chip programming tool: `dist/` is the TypeScript compiler's output of files written for this engagement and imports nothing outside the Node standard library.

**Everything listed in this document therefore runs at build time, test time, deploy time, or on a server.**

**No Serene Labs background IP is used anywhere.** Every file written for this engagement is work for hire and vests in Trevean on full payment. No Serene Labs library, template, generator or proprietary tool is used, embedded, or required to build, test, deploy or operate any of it. Each of the fifteen package manifests states this separately and independently.

**One item needs a decision rather than a note, and it is the Terraform CLI licence.** Section 6.1.

---

## 3. Every package that ships third party code

Discovered by looking for a `MANIFEST.md` under `build/` and `deliverables/`, not read from a list. Counts are read from `node_modules` and from `package-lock.json` on Friday 4 September 2026.

<!-- BEGIN GENERATED inventory. Do not edit by hand: deliverables/m5-handoff/scripts/licences.mjs rewrites it. -->

| Package | What it is | Direct runtime | Direct development | Installed here | Resolved by lockfile |
|---|---|---|---|---|---|
| `build/admin` | Admin CMS. Blend, recipe and grower editors, roles, preview, media library. | 6 | 4 | 130 pairs, 126 names | 180 |
| `build/api` | REST API. Node and TypeScript over DynamoDB, implements the frozen contract. | 12 | 5 | 181 pairs, 174 names | 253 |
| `build/chip-cli` | Chip programming tooling. Encodes, reads back and password protects ST25TV02KC tags. | 0 | 2 | 3 | 3 |
| `build/consolidation` | Consolidation package. The pull requests that adopt this work into the client repository. | no package.json | no package.json | 0 | no lockfile |
| `build/content` | Content fixtures and seeding. Blends, growers, recipes, placeholder imagery, readiness tooling. | 0 | 0 | 0 | no lockfile |
| `build/contract-tests` | Contract tests. Enforces the frozen OpenAPI document against a running service. | 3 | 2 | 10 | 10 |
| `build/dashboard` | Analytics dashboard. Scan volume, NFC and QR split, device and geography, hand written SVG charts. | 0 | 0 | 0 | no lockfile |
| `build/edge` | Edge redirect. The /t/ and /q/ redirect function, its table, compiler and validator. | 0 | 0 | 0 | no lockfile |
| `build/infrastructure` | Infrastructure. Terraform for the whole stack. No npm tree. | no package.json | no package.json | 0 | no lockfile |
| `build/publisher` | Publisher. Uploads the built static pages to object storage and invalidates the CDN. | 3 | 0 | 28 | 28 |
| `build/shopify` | Shopify integration. Cart permalinks, webhook verification, catalog sync, reorder resolution. | 0 | 6 | 54 | 101 |
| `build/vercel-redirect` | Vercel redirect. The alternative hosting route for the same /t/ and /q/ behaviour. | 0 | 0 | 0 | no lockfile |
| `build/web` | Consumer blend pages. The page a customer reads after a tap. | 3 | 5 | 222 pairs, 217 names | 276 |
| `deliverables/m1/06-performance-budget-ci` | Performance budget CI. The workflow and assertions that hold the page to its byte and request budget. | 0 | 1 | 0 | no lockfile |
| `deliverables/m1/harness` | Measurement harness. The M1 instrumentation that produces the tap and page timings. | 0 | 2 | 3 | 3 |

<!-- END GENERATED inventory -->

**The rows are not summable, and the summable figures are in section 4 instead.** The same package appears in more than one tree, often at more than one version: `ajv` and `yaml` are in the API, the contract tests, the admin and the Shopify integration; `typescript` and `@types/node` are in seven trees at five versions between them. Adding the column gives 631 and the deduplicated union is 486, and neither number would mean what a reader assumed.

### 3.1 Seven packages install nothing at all, which is a choice rather than an accident

**The edge redirect and the Vercel redirect both declare no dependencies, runtime or development, and a test in each asserts it stays that way.** The code path they protect is a thousand encoded tags that would have to be physically re encoded. A dependency there would be a supply chain with physical inventory behind it, for functionality the standard library already provides. The test runner is Node's own, which is why there is no Jest, Mocha, Vitest or Chai in either.

**The content package likewise.** The seeding tool has to run on a laptop with no AWS access, no install step and no network, on the day somebody needs it, so it signs its own request headers and speaks the database wire protocol directly in about 120 lines.

**The analytics dashboard likewise, and it is the most surprising**, because a dashboard is the kind of page that usually arrives with a charting library, a framework, a date library and a bundler. It has none: about 200 lines of hand written SVG for the marks, plain ES modules against pure render functions, `Date` with UTC methods, a fourteen line CSV writer, and no build step at all. Its local development tools borrow `dynalite`, two AWS SDK packages and `tsx` from `build/api` rather than installing a second copy, and those four are recorded in that package's manifest and enumerated under the REST API in section 7.

**The consolidation package installs nothing** because its three assertion scripts use `node:fs`, `node:path` and `node:module` only, deliberately, since the foundations check has to run before any dependency install has happened and on a repository whose dependency tree is broken. What it introduces into the client repository is section 7 as well.

**The infrastructure package has no `package.json` at all.** It is Terraform. Section 6.1 and 6.2.

**The performance budget CI declares one development dependency, `@lhci/cli`, and it has never been installed here.** That is the one place in this document where a list is reasoned rather than counted, and it is section 12, item 1.

**The chip programming tool has zero runtime dependencies and two development ones**, and a test asserts the runtime set stays empty. It writes physical inventory that cannot be recalled once it is on a jar. Its argument parser is `node:util` `parseArgs`, which is why there is no commander, yargs or minimist, and its test runner is `node:test`. **The one place a dependency will eventually arrive is the reader transport**: `src/transport/reader-stub.ts` is unimplemented, and whatever library the chosen reader needs becomes the first runtime dependency this package has ever had. It belongs in that package's manifest and in section 7 of this document on the day it is added, with its licence and its reason.

---

## 4. Totals, and every licence that appears anywhere

<!-- BEGIN GENERATED totals. Do not edit by hand: deliverables/m5-handoff/scripts/licences.mjs rewrites it. -->

**Installed on this machine, deduplicated across all 15 packages: 486 distinct package and version pairs, 405 distinct package names, 637 installed copies.** The three differ because the same package is installed in more than one tree, and often at more than one version, and each installed copy is its own licence grant. Pairs are the figure a licence review wants and the figure used throughout.

Every distinct licence string that appears anywhere in any installed tree, named rather than grouped:

| Licence, exactly as the package declares it | Package and version pairs | Copyleft |
|---|---|---|
| `MIT` | 315 | no |
| `Apache-2.0` | 118 | no |
| `ISC` | 18 | no |
| `BSD-3-Clause` | 14 | no |
| `BSD-2-Clause` | 7 | no |
| `BlueOak-1.0.0` | 5 | no |
| `Apache-2.0 AND LGPL-3.0-or-later` | 2 | **yes** |
| `(MIT OR CC0-1.0)` | 1 | no |
| `0BSD` | 1 | no |
| `Apache-2.0 AND LGPL-3.0-or-later AND MIT` | 1 | **yes** |
| `BSD (older array form)` | 1 | no |
| `CC-BY-4.0` | 1 | no |
| `MIT (older object form)` | 1 | no |
| `MPL-2.0` | 1 | **yes** |

**Resolved by the committed lockfiles, across every platform: 635 distinct package and version pairs.** This is the larger and the more conservative figure, and it is the one that describes a CI machine on Linux or an engineer on macOS rather than the Windows install these counts were read from.

| Licence, exactly as the lockfile declares it | Package and version pairs | Copyleft |
|---|---|---|
| `MIT` | 418 | no |
| `Apache-2.0` | 140 | no |
| `LGPL-3.0-or-later` | 20 | **yes** |
| `ISC` | 18 | no |
| `BSD-3-Clause` | 14 | no |
| `BSD-2-Clause` | 7 | no |
| `Apache-2.0 AND LGPL-3.0-or-later` | 6 | **yes** |
| `BlueOak-1.0.0` | 5 | no |
| `Apache-2.0 AND LGPL-3.0-or-later AND MIT` | 2 | **yes** |
| `(MIT OR CC0-1.0)` | 1 | no |
| `0BSD` | 1 | no |
| `CC-BY-4.0` | 1 | no |
| `declared nowhere in the lockfile` | 1 | no |
| `MPL-2.0` | 1 | **yes** |

<!-- END GENERATED totals -->

**What each of the permissive licences actually requires of Trevean**, since the tables above give counts rather than obligations:

| Licence | What it requires |
|---|---|
| MIT | Keep the copyright notice. Nothing else. |
| Apache-2.0 | Keep the notice, state changes if the source is redistributed, patent grant included. |
| ISC | Functionally identical to MIT. |
| BSD-3-Clause | Keep the notice. Do not use the contributors' names to endorse a product. |
| BSD-2-Clause | Keep the notice. |
| 0BSD | No obligation at all. |
| BlueOak-1.0.0 | Permissive, OSI approved, explicit patent grant, and unusually no notice retention obligation at all. Section 6.9. |

---

## 5. Copyleft, which is the class a client's counsel will actually ask about

<!-- BEGIN GENERATED copyleft. Do not edit by hand: deliverables/m5-handoff/scripts/licences.mjs rewrites it. -->

**4 installed package and version pairs carry a copyleft licence, named individually:**

- `@img/sharp-wasm32@0.35.3`, `Apache-2.0 AND LGPL-3.0-or-later AND MIT`, in `build/web`.
- `@img/sharp-win32-x64@0.34.5`, `Apache-2.0 AND LGPL-3.0-or-later`, in `build/web`.
- `@img/sharp-win32-x64@0.35.3`, `Apache-2.0 AND LGPL-3.0-or-later`, in `build/web`.
- `axe-core@4.13.0`, `MPL-2.0`, in `build/web`.

**25 further package and version pairs carry a copyleft licence in a committed lockfile and are not installed on this machine**, because they are optional binaries for other operating systems. An install on Linux or macOS fetches them:

- `@img/sharp-libvips-darwin-arm64@1.2.4`, `LGPL-3.0-or-later`, in `build/web`.
- `@img/sharp-libvips-darwin-arm64@1.3.2`, `LGPL-3.0-or-later`, in `build/web`.
- `@img/sharp-libvips-darwin-x64@1.2.4`, `LGPL-3.0-or-later`, in `build/web`.
- `@img/sharp-libvips-darwin-x64@1.3.2`, `LGPL-3.0-or-later`, in `build/web`.
- `@img/sharp-libvips-linux-arm@1.2.4`, `LGPL-3.0-or-later`, in `build/web`.
- `@img/sharp-libvips-linux-arm@1.3.2`, `LGPL-3.0-or-later`, in `build/web`.
- `@img/sharp-libvips-linux-arm64@1.2.4`, `LGPL-3.0-or-later`, in `build/web`.
- `@img/sharp-libvips-linux-arm64@1.3.2`, `LGPL-3.0-or-later`, in `build/web`.
- `@img/sharp-libvips-linux-ppc64@1.2.4`, `LGPL-3.0-or-later`, in `build/web`.
- `@img/sharp-libvips-linux-ppc64@1.3.2`, `LGPL-3.0-or-later`, in `build/web`.
- `@img/sharp-libvips-linux-riscv64@1.2.4`, `LGPL-3.0-or-later`, in `build/web`.
- `@img/sharp-libvips-linux-riscv64@1.3.2`, `LGPL-3.0-or-later`, in `build/web`.
- `@img/sharp-libvips-linux-s390x@1.2.4`, `LGPL-3.0-or-later`, in `build/web`.
- `@img/sharp-libvips-linux-s390x@1.3.2`, `LGPL-3.0-or-later`, in `build/web`.
- `@img/sharp-libvips-linux-x64@1.2.4`, `LGPL-3.0-or-later`, in `build/web`.
- `@img/sharp-libvips-linux-x64@1.3.2`, `LGPL-3.0-or-later`, in `build/web`.
- `@img/sharp-libvips-linuxmusl-arm64@1.2.4`, `LGPL-3.0-or-later`, in `build/web`.
- `@img/sharp-libvips-linuxmusl-arm64@1.3.2`, `LGPL-3.0-or-later`, in `build/web`.
- `@img/sharp-libvips-linuxmusl-x64@1.2.4`, `LGPL-3.0-or-later`, in `build/web`.
- `@img/sharp-libvips-linuxmusl-x64@1.3.2`, `LGPL-3.0-or-later`, in `build/web`.
- `@img/sharp-wasm32@0.34.5`, `Apache-2.0 AND LGPL-3.0-or-later AND MIT`, in `build/web`.
- `@img/sharp-win32-arm64@0.34.5`, `Apache-2.0 AND LGPL-3.0-or-later`, in `build/web`.
- `@img/sharp-win32-arm64@0.35.3`, `Apache-2.0 AND LGPL-3.0-or-later`, in `build/web`.
- `@img/sharp-win32-ia32@0.34.5`, `Apache-2.0 AND LGPL-3.0-or-later`, in `build/web`.
- `@img/sharp-win32-ia32@0.35.3`, `Apache-2.0 AND LGPL-3.0-or-later`, in `build/web`.

<!-- END GENERATED copyleft -->

**Three places carry a copyleft licence, and none of them reaches a customer or creates an obligation on Trevean today.** They are set out below in the order a reviewer will meet them.

### 5.1 The image processing binaries in the consumer pages tree

Prebuilt image library binaries under LGPL-3.0-or-later, shipped alongside the package's own Apache-2.0 code in a compound declaration. **Build time only:** they generate the placeholder imagery and enforce the hero byte cap. **None is present in the deployed output**, so none travels with the product a customer loads. Using an unmodified library under this licence carries no obligation beyond keeping the notices, which the bundled licence files do. Replaceable with any image pipeline if Trevean would rather avoid it.

**Two versions are installed** because two versions of `sharp` resolve in that tree. Both are the same licence and both are build time.

### 5.2 The twenty standalone LGPL packages in the lockfile that this machine never installed. **This is new on Friday 4 September 2026 and it corrects a sentence in the previous version of this document.**

The previous version said there is no standalone LGPL anywhere. **That was read from an installed tree on Windows, and it is not true of the committed lockfile.** `build/web`'s `package-lock.json` pins twenty `@img/sharp-libvips-*` packages, at two versions of the same ten platform targets, each declared as bare **`LGPL-3.0-or-later`** with no compound Apache-2.0 alongside it. They are the platform binaries for macOS, Linux and musl Linux. A Windows install skips every one of them. **A Linux CI machine installs two of them, and an engineer on a Mac installs two others.**

**The generated list above names twenty five rather than twenty**, because the other five are the compound licensed Windows arm64, Windows 32 bit and WebAssembly variants of `sharp` itself, which are not fetched on Windows x64 either. They are the same class as section 5.1 and carry the same answer.

**The licence position does not change and the sentence describing it did.** These are unmodified prebuilt shared libraries loaded by an unmodified consumer, at build time, never deployed and never modified. LGPL obliges anyone who modifies the library to publish the modification, and obliges a distributor to allow the library to be replaced. Neither arises here. **The reason it is written down is that a reviewer running a licence scan on a Linux machine will get a different answer from the one in this document if this document only ever described a Windows install**, and an unexplained twenty row LGPL block is exactly the kind of thing that stops a review.

### 5.3 The container image the publisher runs in

**Added Friday 4 September 2026 with the decision about where the render runs.** The publish pipeline is a small always on container. The image is the official Node image on Debian 12: the Node runtime is MIT, the image's own Dockerfiles are MIT, and **the Debian userland inside it is a mixture including GPL-2.0, GPL-3.0 and LGPL**. The Mozilla CA bundle in `ca-certificates` is MPL-2.0.

**What the copyleft actually obliges, stated plainly.** GPL and LGPL obligations attach to distribution. Building this image and running it in Trevean's own AWS account is not distribution, and no obligation arises. If Trevean ever hands the image itself to a third party, the obligation is the ordinary Debian one: an offer of source for the GPL licensed packages, which Debian satisfies through its own archives. Nothing in the build links against, statically includes, or derives from any of it. The application is a Node process that the operating system happens to start.

**No base image avoids this.** Alpine's busybox is GPL-2.0, Ubuntu and Debian are the same mixture, and the distroless images that do avoid it do not carry npm, which the render needs. Recorded so that "swap the base image" does not get proposed as the fix.

### 5.4 Two more copyleft items that are not npm packages

**The Terraform AWS provider and archive provider are MPL-2.0.** Downloaded at `terraform init`, not redistributed. File level copyleft that reaches only the provider's own files, which are not modified. Section 6.2.

**`git` is GPL-2.0** and is invoked read only, as an external program, by the edge package's repoint check, which reads the previously committed redirect table out of history. Not linked, not embedded, not redistributed, and its absence is handled and reported rather than fatal. Invoking a GPL program as a separate process creates no obligation on the invoking code.

---

## 6. Everything that is not plainly permissive, named individually

<!-- BEGIN GENERATED non-permissive. Do not edit by hand: deliverables/m5-handoff/scripts/licences.mjs rewrites it. -->

**8 installed package and version pairs declare something other than a plain MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD or Blue Oak licence. All 8 are named here rather than buried in a count.**

| Package | Version | Declared licence | Tree |
|---|---|---|---|
| `@img/sharp-wasm32` | 0.35.3 | `Apache-2.0 AND LGPL-3.0-or-later AND MIT` | `build/web` |
| `@img/sharp-win32-x64` | 0.34.5 | `Apache-2.0 AND LGPL-3.0-or-later` | `build/web` |
| `@img/sharp-win32-x64` | 0.35.3 | `Apache-2.0 AND LGPL-3.0-or-later` | `build/web` |
| `axe-core` | 4.13.0 | `MPL-2.0` | `build/web` |
| `caniuse-lite` | 1.0.30001809 | `CC-BY-4.0` | `build/web` |
| `lazy` | 1.0.11 | `MIT (older object form)` | `build/api` |
| `parse-cache-control` | 1.0.1 | `BSD (older array form)` | `build/web` |
| `type-fest` | 4.41.0 | `(MIT OR CC0-1.0)` | `build/web` |

<!-- END GENERATED non-permissive -->

Not all of these create an obligation, and several create none at all. They are named because a reviewer who meets an unfamiliar or compound licence in a list of 486 with no explanation attached will stop and escalate, and that is a cost a paragraph removes.

### 6.1 Terraform CLI, BUSL-1.1. **This is the one item that needs a decision rather than a note.**

Terraform moved from MPL-2.0 to BUSL-1.1 at version 1.6, in August 2023. Version 1.5.x and earlier remain MPL-2.0. This project uses 1.15.2 and requires 1.10.0 or later. It is not an npm package, so it appears in no table above and would be missed by any scan of `node_modules`.

**What BUSL-1.1 permits, which is everything this engagement does:** internal use, modification, production deployment, and use by any third party Trevean engages to modify these deliverables.

**What it prohibits:** offering Terraform itself, or a derivative of it, as a commercial service competing with the vendor. Nothing here comes near that, and nothing a spice company would plausibly do with its own infrastructure comes near it either.

**Why it is raised anyway:** it is a licence change on a tool being handed over under an IP clause. Raising it costs a paragraph. Having Trevean's counsel find it later costs a conversation nobody has prepared for.

**If Trevean's counsel objects to BUSL on principle, the answer is OpenTofu**, an MPL-2.0 fork under Linux Foundation governance. It is drop in compatible with this configuration and the migration is changing the binary name in the commands. **That option was kept available on purpose:** this configuration uses no vendor cloud features, no BUSL only functionality, and no proprietary providers.

**Recommendation: stay on Terraform, note the licence, record OpenTofu as the available alternative. It is Trevean's call, and it costs nothing to make now and quite a lot to make later.**

### 6.2 Terraform AWS provider and archive provider, MPL-2.0

Downloaded at `terraform init`, not redistributed. Permissive with a file level copyleft that reaches only the provider's own files, which are not modified. No obligation beyond retaining the notice, which the download does automatically.

`.terraform.lock.hcl` in each environment directory pins exact provider versions and their checksums, and it is committed. That is what makes "the same versions, six months from now, on somebody else's machine" a fact rather than a hope.

### 6.3 The image processing binaries, LGPL-3.0-or-later inside a compound declaration

Sections 5.1 and 5.2. Build time only, never deployed, never modified. **These are Windows binaries in the installed tree.** An install on macOS or Linux resolves the darwin or linux equivalents instead, under the same compound licence, plus the standalone LGPL libvips binaries in section 5.2. The names change with the platform, the licence position does not.

### 6.4 `axe-core`, MPL-2.0

File level copyleft. A transitive dependency of the performance measurement tool, used only to measure. Never shipped, never modified, and the Lighthouse configuration in use does not run the accessibility category that invokes it. It obliges anyone who modifies an MPL covered source file to publish that file under the same licence, and it places no obligation on a project that depends on it unmodified. **No obligation is triggered.** Recorded so it is seen rather than discovered.

### 6.5 `caniuse-lite`, CC-BY-4.0

Browser support **data**, not code, used by the build toolchain. Not shipped. The attribution travels in its bundled licence file. Named here rather than left in a count because an attribution licence in a dependency tree is exactly the kind of thing that surprises a reviewer.

### 6.6 `git`, GPL-2.0

Section 5.4. Invoked read only, as an external program. Not an npm package and not in any table above.

### 6.7 `type-fest`, `(MIT OR CC0-1.0)`

Dual licensed. Trevean may take either arm, and both are permissive: MIT requires the notice, CC0-1.0 requires nothing at all. Type declarations only, no emitted code, development only. Named because an automated scanner reports a compound expression rather than a licence name, and a reviewer who sees one unresolved expression in a list of 486 will want to know somebody looked at it.

### 6.8 `parse-cache-control` 1.0.1, declared as "BSD" with no clause count. **The one licence in this set that cannot be determined from the package's own manifest.**

Its `package.json` carries no `license` field. It carries the deprecated `licenses` array form, and the value there is the bare string `BSD`, which is not an SPDX identifier and does not say whether it is the two clause, three clause or four clause variant. It is also the one package in the whole set that declares **nothing at all** in its lockfile entry. **An automated scan cannot classify it, and this document says so rather than rounding it to "permissive" and moving on.**

**What was done about it, because "cannot be determined automatically" is not the same as "unknown".** The bundled `LICENSE` file was read. It is the three condition text, Copyright 2012 to 2014 Walmart and other contributors, with the retain notice, reproduce in binary, and no endorsement conditions. **That is BSD-3-Clause.** So the obligation is the BSD-3-Clause obligation: keep the notice, do not use the contributors' names to endorse a product.

It is a transitive dependency of the performance measurement tool in the consumer pages package. It is build and measurement time only, it is never shipped, and it is the only package in the whole set in this position. **If a licence review wants this closed formally rather than by reading the file, the answer is to ask the upstream project to declare an SPDX identifier, or to drop the measurement tool.** Neither is urgent and both are cheaper than a reviewer finding an unclassifiable row without a note attached to it.

### 6.9 BlueOak-1.0.0, five packages. **Permissive, and named because it appears nowhere else in this package.**

All five are in the admin CMS tree, all development or server side, none shipped to a browser. They are enumerated in that package's own manifest and appear in the generated table in section 4.

Blue Oak Model License 1.0.0 is OSI approved and permissive. It carries an explicit patent grant and, unusually, **no notice retention obligation at all**: it is written to be simpler than MIT rather than more demanding. **It creates no obligation on Trevean.**

It is named individually here for one reason: it appeared in no document in this package before Tuesday 25 August 2026, and a reviewer meeting an unfamiliar licence name in a dependency tree with no explanation attached will stop and escalate. That is a cost this paragraph removes.

### 6.10 One package declares MIT in a form a scanner may not read

`lazy` 1.0.11, in the REST API tree, declares its licence in the older object form rather than as a string. **It is MIT.** It is a transitive dependency of the in process test database and it never ships. It is called out because a scanner that only reads the string form reports it as unknown, and an unexplained unknown is an escalation.

### 6.11 Things that are not licensed to us or by us, recorded for completeness

The CloudFront Functions JavaScript runtime is proprietary to the cloud provider and is one of two candidate execution environments for the compiled redirect. See the document titled "Architecture and the reasoning behind it", section 9.1, for the interim alternative and what it must preserve. Either way it is provided as part of a service, on Trevean's own account, and nothing is licensed to us or by us. The same is true of the alternative hosting platform. Node.js is MIT and is not redistributed; npm ships with it under Artistic-2.0 and installs nothing in the seven zero install packages. Google Chrome, used by the measurement runs, is proprietary freeware over a BSD-3-Clause Chromium base, executed on the machine running the measurement and never redistributed.

---

## 7. Direct dependencies, per package, in full

**This is the exhaustive part.** Every direct runtime dependency and every direct development dependency of every package, with the range declared, the version installed, and its licence. Transitive dependencies are counted and broken down by licence at the foot of each package and enumerated by name in that package's own `MANIFEST.md`.

<!-- BEGIN GENERATED direct. Do not edit by hand: deliverables/m5-handoff/scripts/licences.mjs rewrites it. -->

#### `build/admin`, `@trevean/admin-cms`

Admin CMS. Blend, recipe and grower editors, roles, preview, media library.

**Direct runtime dependencies, 6 declared:**

| Package | Declared range | Installed version | Licence |
|---|---|---|---|
| `@fastify/cookie` | `^11.1.2` | 11.1.2 | `MIT` |
| `@fastify/formbody` | `^8.0.2` | 8.0.2 | `MIT` |
| `@fastify/static` | `^10.1.3` | 10.1.3 | `MIT` |
| `fastify` | `^5.12.1` | 5.12.1 | `MIT` |
| `jose` | `^5.9.3` | 5.10.0 | `MIT` |
| `yaml` | `^2.5.1` | 2.9.0 | `ISC` |

**Direct development dependencies, 4 declared:**

| Package | Declared range | Installed version | Licence |
|---|---|---|---|
| `@types/node` | `^20.16.10` | 20.19.43 | `MIT` |
| `tsx` | `^4.19.1` | 4.23.12 | `MIT` |
| `typescript` | `^5.6.2` | 5.9.3 | `Apache-2.0` |
| `vitest` | `^3.2.7` | 3.2.7 | `MIT` |

**130 installed package and version pairs, 126 distinct names, 130 copies on disk.** Licence breakdown: `MIT` 110, `ISC` 8, `BlueOak-1.0.0` 5, `BSD-3-Clause` 5, `Apache-2.0` 2. Installed at more than one version: `fastify-plugin` (5.1.0, 6.0.0), `fast-uri` (3.1.5, 4.1.2), `cookie` (1.1.1, 2.0.1), `process-warning` (4.0.1, 5.1.0). The committed lockfile resolves 180 pairs, which is 50 more, being optional binaries for other platforms.

#### `build/api`, `@trevean/tap-to-story-api`

REST API. Node and TypeScript over DynamoDB, implements the frozen contract.

**Direct runtime dependencies, 12 declared:**

| Package | Declared range | Installed version | Licence |
|---|---|---|---|
| `@aws-sdk/client-dynamodb` | `^3.658.0` | 3.1112.0 | `Apache-2.0` |
| `@aws-sdk/client-s3` | `^3.658.0` | 3.1112.0 | `Apache-2.0` |
| `@aws-sdk/client-secrets-manager` | `^3.658.0` | 3.1112.0 | `Apache-2.0` |
| `@aws-sdk/lib-dynamodb` | `^3.658.0` | 3.1112.0 | `Apache-2.0` |
| `@aws-sdk/s3-request-presigner` | `^3.658.0` | 3.1112.0 | `Apache-2.0` |
| `@aws-sdk/util-dynamodb` | `^3.996.9` | 3.996.9 | `Apache-2.0` |
| `@fastify/aws-lambda` | `^4.1.0` | 4.1.0 | `MIT` |
| `ajv` | `^8.17.1` | 8.20.0 | `MIT` |
| `ajv-formats` | `^3.0.1` | 2.1.1 | `MIT` |
| `ajv-formats` | `^3.0.1` | 3.0.1 | `MIT` |
| `fastify` | `^4.28.1` | 4.29.1 | `MIT` |
| `jose` | `^5.9.3` | 5.10.0 | `MIT` |
| `yaml` | `^2.5.1` | 2.9.0 | `ISC` |

The table has 13 rows for 12 declared dependencies, because `ajv-formats` resolves at more than one version in this tree. Each installed copy is its own licence grant, so both are listed.

**Direct development dependencies, 5 declared:**

| Package | Declared range | Installed version | Licence |
|---|---|---|---|
| `@types/node` | `^20.16.10` | 20.19.43 | `MIT` |
| `dynalite` | `^3.2.2` | 3.2.2 | `MIT` |
| `tsx` | `^4.19.1` | 4.23.12 | `MIT` |
| `typescript` | `^5.6.2` | 5.9.3 | `Apache-2.0` |
| `vitest` | `^2.1.2` | 2.1.9 | `MIT` |

**181 installed package and version pairs, 174 distinct names, 182 copies on disk.** Licence breakdown: `MIT` 131, `Apache-2.0` 34, `ISC` 9, `BSD-3-Clause` 5, `0BSD` 1, `MIT (older object form)` 1. Installed at more than one version: `@esbuild/win32-x64` (0.21.5, 0.28.2), `ajv-formats` (2.1.1, 3.0.1), `fast-uri` (2.4.4, 3.1.5), `abstract-leveldown` (6.2.3, 6.3.0), `esbuild` (0.21.5, 0.28.2), `immediate` (3.2.3, 3.3.0), `process-warning` (3.0.0, 5.1.0). The committed lockfile resolves 253 pairs, which is 72 more, being optional binaries for other platforms.

#### `build/chip-cli`, `@trevean/chip-cli`

Chip programming tooling. Encodes, reads back and password protects ST25TV02KC tags.

**Direct runtime dependencies: none declared.**

**Direct development dependencies, 2 declared:**

| Package | Declared range | Installed version | Licence |
|---|---|---|---|
| `@types/node` | `^20.16.10` | 20.19.43 | `MIT` |
| `typescript` | `^5.9.3` | 5.9.3 | `Apache-2.0` |

**3 installed package and version pairs, 3 distinct names, 3 copies on disk.** Licence breakdown: `MIT` 2, `Apache-2.0` 1. No package is installed at more than one version. The committed lockfile resolves 3 pairs, which is the same set.

#### `build/consolidation`

No `package.json`. Nothing is installed and nothing is declared. Consolidation package. The pull requests that adopt this work into the client repository.

#### `build/content`, `@trevean/content-fixtures`

Content fixtures and seeding. Blends, growers, recipes, placeholder imagery, readiness tooling.

**Direct runtime dependencies: none declared.**

**Direct development dependencies: none declared.**

**Nothing is installed in this package.**

#### `build/contract-tests`, `trevean-spice-contract-tests`

Contract tests. Enforces the frozen OpenAPI document against a running service.

**Direct runtime dependencies, 3 declared:**

| Package | Declared range | Installed version | Licence |
|---|---|---|---|
| `ajv` | `^8.17.1` | 8.20.0 | `MIT` |
| `ajv-formats` | `^3.0.1` | 3.0.1 | `MIT` |
| `yaml` | `^2.8.1` | 2.9.0 | `ISC` |

**Direct development dependencies, 2 declared:**

| Package | Declared range | Installed version | Licence |
|---|---|---|---|
| `@types/node` | `^20.19.0` | 20.19.43 | `MIT` |
| `typescript` | `^5.9.2` | 5.9.3 | `Apache-2.0` |

**10 installed package and version pairs, 10 distinct names, 10 copies on disk.** Licence breakdown: `MIT` 7, `Apache-2.0` 1, `BSD-3-Clause` 1, `ISC` 1. No package is installed at more than one version. The committed lockfile resolves 10 pairs, which is the same set.

#### `build/dashboard`, `@trevean/analytics-dashboard`

Analytics dashboard. Scan volume, NFC and QR split, device and geography, hand written SVG charts.

**Direct runtime dependencies: none declared.**

**Direct development dependencies: none declared.**

**Nothing is installed in this package.**

#### `build/edge`, `trevean-edge-redirect`

Edge redirect. The /t/ and /q/ redirect function, its table, compiler and validator.

**Direct runtime dependencies: none declared.**

**Direct development dependencies: none declared.**

**Nothing is installed in this package.**

#### `build/infrastructure`

No `package.json`. Nothing is installed and nothing is declared. Infrastructure. Terraform for the whole stack. No npm tree.

#### `build/publisher`, `@trevean/publisher`

Publisher. Uploads the built static pages to object storage and invalidates the CDN.

**Direct runtime dependencies, 3 declared:**

| Package | Declared range | Installed version | Licence |
|---|---|---|---|
| `@aws-sdk/client-cloudfront` | `^3.658.0` | 3.1127.0 | `Apache-2.0` |
| `@aws-sdk/client-s3` | `^3.658.0` | 3.1127.0 | `Apache-2.0` |
| `@aws-sdk/client-secrets-manager` | `^3.658.0` | 3.1127.0 | `Apache-2.0` |

**Direct development dependencies: none declared.**

**28 installed package and version pairs, 28 distinct names, 28 copies on disk.** Licence breakdown: `Apache-2.0` 26, `0BSD` 1, `MIT` 1. No package is installed at more than one version. The committed lockfile resolves 28 pairs, which is the same set.

#### `build/shopify`, `@trevean/shopify-integration`

Shopify integration. Cart permalinks, webhook verification, catalog sync, reorder resolution.

**Direct runtime dependencies: none declared.**

**Direct development dependencies, 6 declared:**

| Package | Declared range | Installed version | Licence |
|---|---|---|---|
| `@types/node` | `^20.16.10` | 20.19.43 | `MIT` |
| `ajv` | `^8.17.1` | 8.20.0 | `MIT` |
| `ajv-formats` | `^3.0.1` | 3.0.1 | `MIT` |
| `typescript` | `^5.6.2` | 5.9.3 | `Apache-2.0` |
| `vitest` | `^2.1.2` | 2.1.9 | `MIT` |
| `yaml` | `^2.5.1` | 2.9.0 | `ISC` |

**54 installed package and version pairs, 54 distinct names, 54 copies on disk.** Licence breakdown: `MIT` 47, `ISC` 3, `Apache-2.0` 2, `BSD-3-Clause` 2. No package is installed at more than one version. The committed lockfile resolves 101 pairs, which is 47 more, being optional binaries for other platforms.

#### `build/vercel-redirect`, `trevean-vercel-redirect`

Vercel redirect. The alternative hosting route for the same /t/ and /q/ behaviour.

**Direct runtime dependencies: none declared.**

**Direct development dependencies: none declared.**

**Nothing is installed in this package.**

#### `build/web`, `@trevean/consumer-blend-pages`

Consumer blend pages. The page a customer reads after a tap.

**Direct runtime dependencies, 3 declared:**

| Package | Declared range | Installed version | Licence |
|---|---|---|---|
| `next` | `15.5.23` | 15.5.23 | `MIT` |
| `react` | `19.2.8` | 19.2.8 | `MIT` |
| `react-dom` | `19.2.8` | 19.2.8 | `MIT` |

**Direct development dependencies, 5 declared:**

| Package | Declared range | Installed version | Licence |
|---|---|---|---|
| `@types/node` | `22.10.5` | 22.10.5 | `MIT` |
| `@types/react` | `19.0.7` | 19.0.7 | `MIT` |
| `lighthouse` | `12.8.2` | 12.8.2 | `Apache-2.0` |
| `sharp` | `0.35.3` | 0.34.5 | `Apache-2.0` |
| `sharp` | `0.35.3` | 0.35.3 | `Apache-2.0` |
| `typescript` | `5.7.3` | 5.7.3 | `Apache-2.0` |

The table has 6 rows for 5 declared dependencies, because `sharp` resolves at more than one version in this tree. Each installed copy is its own licence grant, so both are listed.

**222 installed package and version pairs, 217 distinct names, 227 copies on disk.** Licence breakdown: `MIT` 129, `Apache-2.0` 59, `ISC` 12, `BSD-2-Clause` 7, `BSD-3-Clause` 7, `Apache-2.0 AND LGPL-3.0-or-later` 2, `(MIT OR CC0-1.0)` 1, `0BSD` 1, `Apache-2.0 AND LGPL-3.0-or-later AND MIT` 1, `BSD (older array form)` 1, `CC-BY-4.0` 1, `MPL-2.0` 1. Installed at more than one version: `@img/sharp-win32-x64` (0.34.5, 0.35.3), `@opentelemetry/semantic-conventions` (1.28.0, 1.43.0), `devtools-protocol` (0.0.1507524, 0.0.1608973), `sharp` (0.34.5, 0.35.3), `ws` (7.5.13, 8.21.3). The committed lockfile resolves 276 pairs, which is 54 more, being optional binaries for other platforms.

#### `deliverables/m1/06-performance-budget-ci`, `trevean-performance-budget`

Performance budget CI. The workflow and assertions that hold the page to its byte and request budget.

**Direct runtime dependencies: none declared.**

**Direct development dependencies, 1 declared:**

| Package | Declared range | Installed version | Licence |
|---|---|---|---|
| `@lhci/cli` | `^0.14.0` | not installed here | not installed here |

**Nothing is installed in this package.**

#### `deliverables/m1/harness`, `trevean-measurement-harness`

Measurement harness. The M1 instrumentation that produces the tap and page timings.

**Direct runtime dependencies: none declared.**

**Direct development dependencies, 2 declared:**

| Package | Declared range | Installed version | Licence |
|---|---|---|---|
| `typescript` | `5.5.4` | 5.5.4 | `Apache-2.0` |
| `@types/node` | `20.14.10` | 20.14.10 | `MIT` |

**3 installed package and version pairs, 3 distinct names, 3 copies on disk.** Licence breakdown: `MIT` 2, `Apache-2.0` 1. No package is installed at more than one version. The committed lockfile resolves 3 pairs, which is the same set.

<!-- END GENERATED direct -->

### 7.1 Why the load bearing ones were chosen, and what replacing them would cost

The tables above say what is installed. This says why, because that is the question a maintainer actually asks.

| Package | Where | Why it, and the cost of replacing it |
|---|---|---|
| `fastify` | REST API, admin CMS | Chosen for its injection test interface, which lets the whole suite run with no listening socket, and for a first party Lambda adapter. Handlers take a request and return a value, and nothing framework specific leaks into the service or repository layers. About a day to replace in the API. |
| `ajv` and `ajv-formats` | REST API, contract tests, Shopify tests | **Load bearing by design.** Validation is compiled from the frozen OpenAPI document rather than retyped, so the two cannot drift. OpenAPI 3.1 schema objects **are** JSON Schema 2020-12, so they are used directly rather than converted. Replacing it means replacing that property. |
| `jose` | REST API, admin CMS | JWT verification and signing: signature, issuer, audience, expiry, key set fetching. The alternative is hand rolled cryptography on the authentication path, which is not a trade worth making. |
| `yaml` | REST API, admin CMS, contract tests, Shopify tests | Parses the frozen OpenAPI document at startup, so every minimum role is read from the contract rather than retyped. Removable by committing a JSON copy of the contract, at the cost of a second file to keep in step. |
| The AWS SDK clients | REST API, publisher | First party SDK for the services in use. Not replaceable in practice. The publisher's three are dynamically imported inside the AWS adapters, so the whole publish path, the stand in origin and the entire test suite run with no `node_modules` at all. |
| `next`, `react`, `react-dom` | Consumer pages | Build time only. **The client runtime is removed by the post build step and never shipped.** |
| `sharp` | Consumer pages | Build time. Generates the placeholder imagery and enforces the hero byte cap. Sections 5.1 and 5.2. |
| `lighthouse` | Consumer pages | Measurement only. Pinned so the measured numbers are reproducible. It is the sole source of every non permissive row in section 6 except the Terraform ones. |
| `dynalite` | REST API, borrowed by the dashboard | An in process database compatible server, so the suite runs with no cloud account and no Docker. |

**Two packages are used directly but declared only transitively, and that is deliberate.** `puppeteer-core` and `chrome-launcher`, both Apache-2.0, both already installed as dependencies of the measurement tool, drive headless Chrome to produce the user experience evidence. **Adding a second copy of Chrome tooling to the tree to run one screenshot script would be a worse trade than depending on the copy the measurement runs already require.** If the measurement tool is ever removed, add both to development dependencies in the same commit.

### 7.2 One version divergence, recorded rather than left to be discovered

**The admin CMS is on Fastify 5 and the REST API is on Fastify 4.** Fastify 4 and `@fastify/static` 7 carry published high severity advisories including a route guard bypass by path traversal, and a route guard bypass in the tool whose entire purpose is enforcing who may publish is not an advisory to carry. **The same advisories apply to the REST API package, which additionally serves the scan beacon. That is a live item for whoever owns the API build**, and it is named here because a consolidated licence document is where somebody will notice two versions of the same framework.

### 7.3 What the consolidation package introduces into the client repository

It installs nothing itself. It carries twelve pull requests that adopt this work into the client's `nfc-development` repository, and those pull requests declare the following there:

| Item | Version | Licence | Publisher | Why |
|---|---|---|---|---|
| `actions/checkout` | v4 | MIT | GitHub, Inc. | All three workflows |
| `actions/setup-node` | v4 | MIT | GitHub, Inc. | All three workflows |
| `actions/upload-artifact` | v4 | MIT | GitHub, Inc. | Two of the three workflows |
| `@aws-sdk/client-dynamodb` | ^3.658.0 | Apache-2.0 | Amazon.com, Inc. | Imported in the inherited code and declared nowhere. PR 3 |
| `@aws-sdk/lib-dynamodb` | ^3.658.0 | Apache-2.0 | Amazon.com, Inc. | Same. PR 3 |
| `@lhci/cli` | ^0.14.0 | Apache-2.0 | Google LLC | Runs Lighthouse, aggregates runs, asserts thresholds. The only npm dependency of the performance budget CI. PR 10 |

**No third party marketplace action is used anywhere.** That is deliberate: a marketplace action is code executing with repository credentials on every build, and the common Lighthouse and test reporter actions add a supply chain dependency for convenience the CLI already provides.

**Not added, and worth recording as an absence.** `redis` is imported in the inherited code and declared nowhere. It is not being declared, because the file importing it is dead code and it is a second client for a service everything live reaches through the already declared `ioredis`. The file is deleted instead, so no licence row is created. **Adding a dependency to make dead code compile creates a permanent obligation for a temporary convenience.**

### 7.4 No third party Terraform registry modules are used

Three rows rather than forty, and that is also deliberate. Community modules are convenient and each one adds an upstream, a licence and a maintenance dependency that would appear on this list and be tracked forever.

| Component | Version | Licence | Ships |
|---|---|---|---|
| Terraform CLI | 1.15.2 used, 1.10.0 or later required | **BUSL-1.1** | No. Section 6.1. |
| Terraform AWS provider | `~> 5.70`, resolved 5.100.0 | MPL-2.0 | No. Downloaded at init. |
| Terraform archive provider | `~> 2.4`, resolved 2.8.0 | MPL-2.0 | No. Used for one thing: zipping the placeholder function package. |

**Deliberately not used, recorded so their absence reads as a decision:** Terragrunt, any hosted Terraform service, any Lambda layer with shared code, and any policy as code linter. **The last one is a recommendation rather than a rejection:** it is worth adding in CI and was not added here because CI did not exist yet, and a tool nobody runs is background IP with no benefit.

---

## 8. How this list is maintained, and why that matters more than the list

The obligation says to keep a running list from day one rather than reconstruct it at handoff. **Every package under `build/` and every packaged deliverable carries its own `MANIFEST.md`, updated in the same commit as any dependency change.**

<!-- BEGIN GENERATED health. Do not edit by hand: deliverables/m5-handoff/scripts/licences.mjs rewrites it. -->

**15 packages carry a `MANIFEST.md` and all 15 are covered above.** They were discovered by looking for the file, not read from a list, so a new package appears here the first time this runs after it is added.

**7 of them install nothing at all:** `build/consolidation`, `build/content`, `build/dashboard`, `build/edge`, `build/infrastructure`, `build/vercel-redirect`, `deliverables/m1/06-performance-budget-ci`. For those the licence position is that there is nothing to license.

**Every package with an installed tree carries its own `scripts/licenses.mjs`**, so its own manifest is generated from `node_modules` rather than typed.

<!-- END GENERATED health -->

**Regenerate this document, and the machine readable companion beside it, with one command from the repository root:**

```bash
node deliverables/m5-handoff/scripts/licences.mjs
node deliverables/m5-handoff/scripts/licences.mjs --check   # writes nothing, exits 1 on drift
```

It writes the generated sections of this file and `licences.json` alongside it. **The `--check` form belongs in CI**, because a licence document that is regenerated by whoever remembers is the same document that was wrong twice.

**Each package regenerates its own manifest the same way**, with `node scripts/licenses.mjs` in that package, which writes that package's `licenses.json` and the enumerated section of its `MANIFEST.md`. The four packages that had an installed tree and no generator on Friday 4 September 2026 now have one, in the same shape as the others: the admin CMS, the contract tests, the publisher and the measurement harness. **That is the actual repair.** The counts in this document were wrong twice, and both times the cause was a person maintaining a list rather than a script reading a tree.

**Four packages enforce their manifest with a test instead**, because they declare no dependencies at all: the edge redirect, the Vercel redirect, the content package and the analytics dashboard. The test fails if a dependency is ever added.

**Two disciplines that travel with this document:**

1. **A package reporting a licence outside the permissive set is a decision to raise before it merges, not after.** That applies to any new dependency in any of the fifteen packages. Every generator prints a warning for anything outside the set, and anything it warns about must appear by name in section 6 here.
2. **If a dependency is ever added to one of the zero dependency packages, three things happen in the same commit:** the package goes into that package's manifest with its licence and its reason, any non permissive licence gets its own explanation the way the ones in section 6 have, and the "zero dependencies" claim in that package's README comes out.

**A package that declares no licence in any form is a stop.** The generators report it as `UNDETERMINED`. There is one today and it is `parse-cache-control`, which is section 6.8 and which was resolved by reading its bundled licence text. Another one appearing is a decision to raise before it merges rather than after.

---

## 9. Written by hand rather than imported, and why

An honest background IP list also says what was deliberately **not** brought in, because each of these is a place a future maintainer might reasonably reach for a library and should know why nobody did.

| Component | Why it is hand written |
|---|---|
| **ULID generation** | About thirty lines against a documented pattern. A dependency is not worth it. |
| **Rate limiting** | Limits are enforced at the CDN and WAF, so a flood never reaches a function. The in process limiter is a small fallback, not a library. |
| **Structured logging** | The redaction rule is the point: no IP address, no user agent, no authorisation header and no email ever reaches a log line. **That is easier to prove in forty lines we own than to configure in a logging framework**, and a unit test asserts it. |
| **HMAC webhook verification** | Node's own cryptography, with a constant time comparison, in both the API and the Shopify integration. |
| **The database seeding client** | Signs its own requests and speaks the wire protocol directly, so the tool runs with no install step and no network on the day somebody needs it. |
| **The PNG encoder for placeholder imagery** | Written against the public specification using Node's own compression. No image library, which is what makes the imagery reproducible on any machine with no install step. |
| **The dashboard's charts, date handling and CSV export** | About 200 lines of SVG, `Date` with UTC methods, and fourteen lines of CSV quoting with tests for the comma and quote cases. A charting library, a framework, a date library and a bundler were all declined for one screen. |
| **The chip tool's NDEF encoder, TLV layout and command line parser** | Written against the NFC Forum specifications and `node:util` `parseArgs`. Nothing third party executes at the moment a chip is programmed. |
| **The admin's one client side script** | 90 lines of plain JavaScript that upload a photograph from the browser straight to object storage, which is the one thing a form post cannot do. |
| **The publisher's HTTP server, signature check and test runner** | `node:http`, `node:crypto` and `node:test`. Three declared dependencies, all AWS clients, all dynamically imported. |

**Specifications referenced and not embedded:** the ST25TV02KC datasheet and application note AN5658 (STMicroelectronics), read and cited with no text, code or figure copied; the NFC Forum URI Record Type Definition, whose published prefix abbreviation table is a specification fact rather than a copyrightable work and is cited in the file that uses it; and the NFC Forum Type 5 Tag Operation Specification, which the capability container and TLV layout follow and do not reproduce.

**No reader vendor SDK is used, linked or required, and that is the open item.** Section 3.1.

---

## 10. Assets and data, which a code only manifest would miss

| Item | Origin | Rights |
|---|---|---|
| Placeholder imagery, 28 files | Generated procedurally: rectangles, diagonal stripes, a 5 by 7 bitmap alphabet drawn character by character for this deliverable, and seeded noise. **No stock photography, no clip art, no icon set, no downloaded texture, no scraped image, no generated image, no third party font.** | Work for hire, owned by Trevean. The generator ships with them, so they can be regenerated or restyled without us. Each file also carries the same statement inside it in image metadata, which survives the file being copied out of the repository in a way a manifest does not. |
| The field beacon vendored into the page package | Serene Labs, from the M1 measurement harness. Copied verbatim by a sync command with its provenance and a checksum recorded. | Work for hire. Not third party. |
| The frozen OpenAPI document, copied into the API, the Shopify and the admin packages | The M1 deliverable. A test in each package asserts the copy is byte identical to the original. | Work for hire. |
| The placeholder render contract, copied into the page package and reproduced by the admin preview screen | The content package. The page build fails if the two ever differ. | Work for hire. Deleted with the last placeholder. |
| HMAC-SHA-256 known answer vectors in the Shopify package | Reproduced from RFC 4231 as test data. | IETF specification text, not software. No obligation on this deliverable. |
| Simulated Shopify responses in the Shopify package | Hand built to the documented API shapes. **Not recordings, because there is no store access.** | Work for hire. |
| The redirect table | Trevean's operational data, not a third party asset. | Trevean's. |
| Seeded content fixtures | **No real person is named anywhere. No coordinates, dates, prices or provenance claims are invented**; those fields are held null or carry an explicit placeholder marker. No customer data, no personal data, no PII of any kind, and no credential, key, token or password in any file. | Trevean's. |
| No fonts are shipped | The page uses the platform system font stack. The 45 KB across two font files that the byte budget allows is unspent and reserved for the brand faces, which must be self hosted, subset to the glyphs actually used, preloaded, and paired with a metric compatible fallback. **A third party font host is forbidden outright rather than budgeted**, and the build fails if one appears. | Not applicable. |

**The placeholder imagery is meant to be deleted.** It exists so the page can be built and measured at the real weight before real photography lands. Nothing should still be pointing at it at launch, and the content readiness report is what makes that visible.

**One thing changed on Monday 24 August 2026 that touches this section.** The client's marketing site is live and carries real content including named growers and farm coordinates. **That content is Trevean's and is not third party**, but it is also not the content in the content package, and the two disagree in at least one place: the site places the Persian Sunrise grower near Kashan, and the packaging conversation recorded Isfahan, about 150 km apart. **Nothing should be copied from the live site into the fixtures until that is settled with the client**, and when it is, the copied content is Trevean's own and creates no third party obligation.

---

## 11. The other direction: what came with the inherited repository

This document lists what Serene Labs brought. **The client's existing `nfc-development` repository is a separate question, and it was audited on Wednesday 19 August 2026.**

**Findings, and they are good ones.** No code owned by the previous contractor. No private registry, no submodule, no vendored directory, no copyright header naming anyone. **Nothing there needs a licence from anyone and nothing needed an emergency rotation.** No live secret exists in the working tree or in any commit on any reference: all 70 unique objects across all three references were swept for cloud key identifiers and secret literals, third party service tokens, private key blocks, JWT literals, credentialed connection strings, and the 16 hexadecimal character shape of a tag area password. One hit, a self describing placeholder guarded by a validator that throws in production.

**Two things are stated as caveats rather than buried.**

1. **No dedicated history aware secret scanner was available at the time**, so that finding is defensible rather than evidenced. Re running one against a mirror clone is ten minutes on a machine that has the tool and it should be done.
2. **The exposure that does exist is documentary rather than technical.** The inherited repository's README and contributing guide name the previous contractor as having done the platform development and technical architecture, while its licence file asserts Trevean's copyright and grants MIT outbound. **An outbound MIT grant is not an inbound assignment.** The question worth asking plainly is whether copyright was assigned in writing. If it was, this is a documentation fix. If it was not, it is cheap to settle now and expensive later. It is Trevean's exposure rather than the contractor's.

---

## 12. What is still incomplete in this consolidation, stated

**Closed on Friday 4 September 2026:**

- **Four of the fifteen package manifests were not consolidated at all**, and two of those four had installed trees. They are now, in sections 3, 4 and 7.
- **The claim that no standalone LGPL appears anywhere was true of one platform's install and not of the committed lockfiles.** Corrected in section 5.2 and now measured on both.
- **Four packages with installed trees had no generator and were therefore hand kept.** They now have one, in the same shape as the packages that already did.
- **This document's own consolidation was hand kept and had a hand kept list of which packages to consolidate.** It is now generated, and the list of packages is discovered from the filesystem rather than typed. That is the difference between the fix and a fourth correction.

**Still open, in the order a reviewer will meet them:**

1. **The `@lhci/cli` subtree has never been installed on any machine here**, so the performance budget CI package contributes one declared dependency and no transitive enumeration. Closing it is one install and one run of the generator, and it should happen the first time PR 10 lands and CI runs. Until then it is the one list in this document that is reasoned rather than counted.
2. **`parse-cache-control` 1.0.1 cannot be classified from its own manifest** and was classified by reading its bundled licence file. Section 6.8. That is a defensible answer rather than a machine checkable one, and it is the only such row in 486.
3. **The client repository's own 1,167 package resolved tree is inventoried in the M1 scaffold audit rather than here**, and it cannot become a stable contractual artifact until the lockfile lands in PR 1 of the consolidation. Three items the audit could not trace to a package must be itemised in the same pass: single instances of CC-BY-4.0, Python-2.0 and an unversioned BSD. None is copyleft and none restricts running or modifying the product, but **"not traced" is not the same as "listed"**, and the unversioned BSD is very likely the same `parse-cache-control` shape described in section 6.8.
4. **Nothing in this document has been verified against a deployed system, because nothing is deployed.** Every figure is read from an installed tree or a lockfile on a developer machine. That does not weaken the licence conclusions, which are properties of packages rather than of environments, and it does mean the deployed artifact has never been scanned. **Scanning the built artifact rather than the source tree is the check that closes this**, and it belongs in CI rather than in a document.
5. **The generator's drift check is not yet wired into CI.** `--check` exists and passes today. Until something runs it on every commit, this document is accurate rather than guaranteed, and the difference between those two is the entire history of the corrections in section 0.
6. **If the tag redirect is served from the alternative hosting platform rather than the CDN**, as the document titled "Architecture and the reasoning behind it", section 9.1, now contemplates, the hosting platform changes and the licence position does not: the compiled redirect still contains no third party code, and a platform runtime is a service on Trevean's own account rather than a licence to us or by us. **No row in this document changes.** It is stated because a reader who notices the hosting question will reasonably wonder whether it reaches this document, and it does not.
