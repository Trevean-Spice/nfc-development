# Third party manifest, chip programming tooling

**For the SOW section 7 background IP obligation:** any pre existing library or framework we reuse must be listed explicitly and licensed to Trevean Spice to run and maintain the product indefinitely. The Scope document, "IP and handoff", names the chip encoding tooling and batch workflow among the deliverables this applies to.

**Status: Saturday 22 August 2026, updated Sunday 25 October 2026** for the PC/SC binding in section 3a, **and Monday 26 October 2026** for the Tag Tool (`src/app/`, standard library only, section 5) and the browser check in section 6. Reviewed on every change to `package.json`, and a test in `test/house-style.test.ts` fails if a dependency appears here without being listed below.

---

## 1. The short version

**Zero required runtime dependencies. One optional runtime dependency, `pcsc-mini`, loaded only by `--transport reader`. Two development dependencies, both of them the TypeScript compiler and its type definitions, and neither of them is present when a tag is written.**

On the simulator, nothing third party executes. **On a real reader, one third party component does: the `pcsc-mini` native binding, which carries APDUs between this tool and the operating system's own PC/SC service.** Every byte it sends is built and checked by code in this package, and the protection gate sits above it (README section 6.4). The code path this protects is a physical inventory that cannot be recalled once it is on a jar, so the standard library is preferred over a package in every case where the standard library can do the job. Talking to a USB reader is the one case where it cannot.

---

## 2. Serene Labs background IP used in this deliverable

**None.** Every file in this directory is work for hire owned by Trevean Spice on full payment. No Serene Labs library, template or proprietary tool is used, embedded or required to build, test, deploy or operate it.

---

## 3. npm packages, runtime

**None required.** `package.json` declares an empty `dependencies` object and a test asserts it stays empty.

## 3a. npm packages, optional runtime: the PC/SC binding

| Package | Version | Licence | Why it is here |
|---|---|---|---|
| `pcsc-mini` | 0.1.3, pinned exactly | MIT | The JavaScript side of the binding to the operating system's PC/SC service, which is how `--transport reader` reaches the ACR1552U. Loaded lazily by `src/transport/pcsc.ts` and never by the simulator |
| `@pcsc-mini/<platform>` | 0.1.3 | MIT | One prebuilt native binary for the machine it is installed on, chosen by npm from fourteen in the lockfile. The ones that matter here are `windows-x86_64-node`, `macos-aarch64` and `macos-x86_64` |

**Why this one.** It replaced `@pokusew/pcsclite` on Sunday 25 October 2026. That package was pinned at `^1.0.1`, a version that does not exist (its latest is 0.6.0), so npm skipped it without a word. At 0.6.0 it compiles from C++ on install, needing Python and a C++ toolchain on the operator's machine, and on Windows its constructor requests administrator rights to reconfigure the Smart Card service. `pcsc-mini` ships prebuilt binaries, **runs no install script**, links only the operating system's own PC/SC library (`WinSCard.dll` on Windows, `PCSC.framework` on macOS, `libpcsclite.so.1` on Linux), and is N-API, so one binary serves Node 20, 22, 24 and 26. Its registry signatures and SLSA provenance attestations verify with `npm audit signatures`.

**What it is not.** A small project: one maintainer, version 0.x, last published Sunday 3 August 2025, about 1,400 downloads a month in October 2026. That is acceptable for a binding this thin, pinned exactly with integrity hashes in the lockfile, and it is the reason it is pinned rather than ranged.

**The generated table in section 4a lists these as `transitive`.** That column is derived from `dependencies` and `devDependencies` only, by a script kept byte identical across packages, so it has no word for an optional dependency. This section is the correct statement of their role.

---

## 4. npm packages, development only

Present to compile TypeScript to JavaScript and to type check it. Neither ships, neither is imported by any file under `src/`, and neither is needed to run the compiled tool.

| Package | Version | Licence | Why it is here |
|---|---|---|---|
| `typescript` | ^5.9.3 | Apache-2.0 | Compiles `src/` and `test/` into `dist/`. The published artifact is plain JavaScript |
| `@types/node` | ^20.16.10 | MIT | Type definitions for the Node.js standard library. Types only, no code |

`@types/node` is published from the DefinitelyTyped repository. It contains no executable code, only TypeScript declaration files.

**Transitive dependencies: none.** Both packages have zero dependencies of their own. `npm install` in this directory installs three packages in total: the two above and `undici-types`, a types only package pulled in by `@types/node`.

| Package | Version | Licence | Why it is here |
|---|---|---|---|
| `undici-types` | ^6.x | MIT | Type definitions only, a transitive dependency of `@types/node` |

---

## 4a. Full dependency tree

Every package resolved into `node_modules`, direct and transitive. Generated by
`node scripts/licenses.mjs`, not typed, so it cannot drift from what an install pulls in.

<!-- BEGIN GENERATED PACKAGE LIST. Do not edit by hand: node scripts/licenses.mjs rewrites it. -->

**6 installed package and version pairs, and every one of them is listed below.** This
section is generated from `node_modules` by `node scripts/licenses.mjs`, not typed, so it cannot
drift from what an install actually pulls in. The role column says whether a package is a declared
runtime dependency, a declared development dependency, or something one of those pulled in.

**Three totals, all true, stated together so they cannot look like a disagreement.** 6
package and version pairs, 6 distinct package names, 6 copies on disk. No package is installed at more than one version.

**The committed lockfile resolves 18 pairs**, which is 12 more than are installed here. The difference is optional binary packages for operating systems this machine is not, and they install on any machine that is.

| Licence, exactly as the package declares it | Pairs | Copyleft |
|---|---|---|
| `MIT` | 5 | no |
| `Apache-2.0` | 1 | no |

**Nothing in this table falls outside the permissive set.** No GPL, no LGPL, no AGPL, no MPL, no source available and no commercial licence.

**No copyleft licence appears in this package, installed or resolved.**

| Package | Version | Licence | Role |
|---|---|---|---|
| `@pcsc-mini/linux-x86_64-gnu` | 0.1.3 | MIT | transitive |
| `@pcsc-mini/linux-x86_64-musl` | 0.1.3 | MIT | transitive |
| `@types/node` | 20.19.43 | MIT | development |
| `pcsc-mini` | 0.1.3 | MIT | transitive |
| `typescript` | 5.9.3 | Apache-2.0 | development |
| `undici-types` | 6.21.0 | MIT | transitive |

<!-- END GENERATED PACKAGE LIST -->

## 5. Node.js standard library modules used

Built into Node.js and covered by the Node.js licence. Not redistributed, not vendored, not pinned.

| Module | Used by | For |
|---|---|---|
| `node:crypto` | `chip/password.ts`, `table/redirect-table.ts`, `workflow/journal.ts`, `workflow/unit.ts`, `app/controller.ts` | SHA-256 for password fingerprints, the redirect table digest, journal record digests and the verification receipt digest. `timingSafeEqual` for password comparison. `randomUUID` for run identifiers |
| `node:fs` | `table/redirect-table.ts`, `workflow/journal.ts`, `cli/main.ts`, `app/` | Reading the redirect table and password files, appending and flushing the batch journal. In the Tag Tool, reading its page and creating its journal folder |
| `node:os` | `workflow/batch.ts`, `app/controller.ts`, tests | Operator and host names in the run header, temporary directories in tests |
| `node:path`, `node:url` | throughout | Resolving the redirect table path relative to this package, on Windows and on Linux |
| `node:util` | `cli/main.ts`, `app/main.ts` | `parseArgs`, the standard library argument parser. This is why there is no commander, yargs or minimist in this package |
| `node:http` | `app/server.ts` | The Tag Tool's page and its live feed, served on 127.0.0.1 only. This is why there is no Express or similar in this package |
| `node:net` | `app/server.ts` (a type only), tests | The listening address type; in the tests, checking the server cannot be reached on any address but 127.0.0.1 |
| `node:child_process` | `app/main.ts` | Opening the default browser on the Tag Tool page (`start` on Windows, `open` on a Mac) |
| `node:readline/promises` | `cli/main.ts` | Waiting for the operator between tags in interactive batch mode |
| `node:test`, `node:assert` | tests | The test runner, built into Node 20 and later. This is why there is no Jest, Mocha, Vitest or Chai in this package |

`Buffer` is used for hexadecimal and UTF-8 conversion. It is a Node.js global, not a package.

---

## 6. Runtime and tooling, used but not redistributed

| Component | Licence | Note |
|---|---|---|
| Node.js 20 or newer | MIT | Required to run the tool. Nothing from it is redistributed by us |
| npm | Artistic-2.0 | Bundled with Node.js. Used to install the development dependencies and the optional PC/SC binding, and to invoke scripts |
| Playwright 1.64.1 and its Chromium build | Apache-2.0 (Playwright), BSD-3-Clause (Chromium) | Used once, by hand, on Monday 26 October 2026, to drive the Tag Tool page in a real browser. Installed in a scratch folder outside this package: **not in `package.json`, not a dependency, not shipped, and not needed to build, test or run the tool** |

---

## 7. Hardware and specifications referenced, not embedded

| Item | Holder | Note |
|---|---|---|
| ST25TV02KC datasheet, DS13304 Rev 7 (February 2025) | STMicroelectronics | Read and cited. The memory geometry in `src/chip/st25tv02kc.ts`, 320 bytes in 80 blocks of 4 with END_MEM 4Fh, comes from its page 1 and sections 4.1 and 4.2. Short phrases are quoted in comments as citations of fact. No code, figure or table is copied into this package |
| Application note AN5658 | STMicroelectronics | As above |
| NFC Forum URI Record Type Definition | NFC Forum | The abbreviation table in `src/ndef/uri-prefixes.ts` is the published list of URI prefixes, which is a specification fact rather than a copyrightable work. Cited in the file |
| NFC Forum Type 5 Tag Operation Specification | NFC Forum | The capability container and TLV layout in `src/chip/st25tv02kc.ts` and `src/ndef/tlv.ts` follow it. Not reproduced |

**No reader vendor SDK is used, linked or required.** The reader is reached through the operating system's own PC/SC service, with the optional binding in section 3a, and the ACS commands it sends are written in `src/transport/pcsc.ts`. A driver library in this path is a supply chain with physical inventory behind it, which is why the binding is pinned exactly and listed with its reason.

---

## 8. What ships to Trevean

The contents of this directory as source, plus `dist/` if a built copy is wanted. **`dist/` contains no third party code of any kind**: it is the TypeScript compiler's output of files written for this engagement, and it imports nothing outside the Node.js standard library except the optional PC/SC binding in section 3a, loaded only for a real reader.

---

## 9. Standing obligation

Keep this list current from the day a dependency is added rather than reconstructing it at handoff. The zero dependency test in `test/house-style.test.ts` fails if `dependencies` becomes non empty, and it fails if a development dependency is added without being named in this file.

Risk R13 exists because the existing `nfc-development` repository may contain proprietary libraries left by the previous contractor. Nothing from that repository is used here.
