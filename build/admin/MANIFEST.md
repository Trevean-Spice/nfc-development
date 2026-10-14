# Background IP manifest: admin CMS

**Package:** `@trevean/admin-cms`
**Prepared by:** Serene Labs Inc for Trevean Spice
**As of:** Saturday 22 August 2026
**Machine readable companion:** `licenses.json`, regenerated from `node_modules` and carrying every package, version and licence in this document.

---

## 1. Why this file exists

The Scope document, "IP and handoff", carries a background IP obligation: any pre-existing library or framework reused in a deliverable must be listed explicitly and licensed to Trevean to run and maintain the product indefinitely. It also says to keep a running list from day one rather than reconstructing it at handoff. This is that list for the admin CMS.

**Everything Serene Labs wrote in this directory is work for hire and becomes Trevean's on full payment.** Everything below is somebody else's, reused under the licence stated, and none of it restricts Trevean from running, modifying or paying a third party to modify this application.

---

## 2. The answer first

**155 package and version pairs resolve into `node_modules`, across 151 distinct names. Eight of them are runtime dependencies this application declares directly. Every licence in the tree is permissive: MIT, ISC, Apache 2.0, BSD 3-Clause, Blue Oak 1.0.0 or 0BSD. There is no copyleft licence anywhere in the tree, installed or resolved, no dual licence requiring a commercial purchase, and no package under a source available or "fair use" licence.**

**Counted by pair rather than by name, because four packages are installed at two versions each and each installed copy is its own licence grant.**

**These totals moved on Tuesday 8 September 2026** when the admin gained a Lambda adapter and the Cognito client, so it could be deployed with a managed identity provider instead of the accounts whose passwords are in this repository. **The Apache 2.0 count went from 2 to 24**, almost all of it the AWS SDK's own modules, which is the visible price of that decision and is recorded rather than absorbed.

| Licence | Package and version pairs | What it requires of Trevean |
|---|---|---|
| MIT | 112 | Keep the copyright notice. Nothing else. |
| Apache-2.0 | 24 | Keep the notice, state changes if the source is redistributed, patent grant included. |
| ISC | 8 | Functionally identical to MIT. |
| BlueOak-1.0.0 | 5 | Permissive, OSI approved, with an explicit patent grant. No notice retention obligation. |
| BSD-3-Clause | 5 | Keep the notice. Do not use the contributors' names to endorse a product. |
| 0BSD | 1 | Public domain equivalent. No notice retention obligation at all. |

**Zero known vulnerabilities at the time of writing**, in the runtime tree and in the development tree, verified with `npm audit`. That is not free: see section 5, which records a deliberate divergence from the API package.

---

## 3. Runtime dependencies, which are the ones that ship

Eight. Each one is listed with why it is here and what replacing it would cost, because a handoff document that lists a dependency without saying what it does is a list somebody has to research before they can act on it.

| Package | Version | Licence | Why it is here | Cost to replace |
|---|---|---|---|---|
| `fastify` | 5.12.1 | MIT | The HTTP server. The same framework the API uses, so one engineer reads both. | Moderate. Routing, hooks and the error handler would be rewritten against `node:http` or another framework. |
| `@fastify/cookie` | 11.1.2 | MIT | Reads and writes the session cookie. | Low. Cookie parsing and serialisation is roughly forty lines. |
| `@fastify/formbody` | 8.0.2 | MIT | Parses `application/x-www-form-urlencoded`, which is what every screen in this tool posts. | Low. `URLSearchParams` does the parsing. |
| `@fastify/static` | 10.1.3 | MIT | Serves the two stylesheets and the one script. | Low, and it could be removed entirely by inlining them. |
| `@fastify/aws-lambda` | 6.4.1 | MIT | Adapts the Fastify app to a Lambda function URL event, which is where the admin is hosted. The same shape the API uses. Added Tuesday 8 September 2026. | Low. It translates one event shape into a request and the response back again, and the admin would otherwise need a container and an always on bill. |
| `@aws-sdk/client-cognito-identity-provider` | 3.1130.0 | Apache-2.0 | Verifies the password and reads the role from Cognito groups, which is the managed identity provider the frozen API contract, section 5.3, requires. Added Tuesday 8 September 2026 so the admin could be deployed with an identity provider rather than the seeded accounts. | Moderate, and the alternative is worse: hand rolling SigV4 against the Cognito API, or running an identity provider of our own. |
| `jose` | 5.10.0 | MIT | Signs the bearer token the admin presents to the API, in the same shape the managed identity provider issues and the API verifies. | Moderate. Writing JWT signing by hand is possible and is not advisable. |
| `yaml` | 2.9.0 | ISC | Parses the frozen OpenAPI document at startup so every minimum role is read from the contract rather than retyped. | Low if the contract were also published as JSON, which it is not. |

**There is no client side framework, no bundler, no CSS framework, no icon set, no web font and no charting library.** Every screen is server rendered HTML and one plain stylesheet. The only client script is 90 lines of vanilla JavaScript that performs the browser to S3 media upload, which is the one thing a form post cannot do. That is a decision made for this obligation as much as for performance: eight runtime dependencies is a handoff, eight hundred is a liability somebody inherits.

---

## 4. Development dependencies

Not shipped, not part of the running product, and listed because the obligation is about anything reused rather than anything deployed. Trevean needs them to build and test what it now owns.

| Package | Version | Licence | Purpose |
|---|---|---|---|
| `typescript` | 5.9.3 | Apache-2.0 | Type checking and the build. |
| `tsx` | 4.23.12 | MIT | Runs TypeScript directly in development, so there is no build step between an edit and a reload. |
| `vitest` | 3.2.7 | MIT | The test runner. |
| `@types/node` | 20.19.43 | MIT | Type declarations for the Node standard library. |

---

## 5. One deliberate divergence from the API package, recorded rather than left to be discovered

**This package is on Fastify 5. `build/api` is on Fastify 4.**

Fastify 4 and `@fastify/static` 7 carry published high severity advisories, including GHSA-83w8-p2f5-377r, a route guard bypass via path traversal in `@fastify/static`. A route guard bypass in the tool whose entire purpose is enforcing who may publish is not an advisory to carry, so this package took the major version rather than matching its sibling.

**This is worth raising with whoever owns the API build**, because the same advisories apply there and that package additionally serves the scan beacon. It is not this deliverable's to change. Recorded here so nobody concludes the version difference was an accident.

---

## 6. Assets

**No third party image, photograph, font, icon or stock asset is used or embedded anywhere in this package.** The interface uses the system font stack, so no font file is loaded from anywhere, including from this server. The placeholder hazard colour and the two stylesheets are original.

**The preview screen reproduces the placeholder render contract published in `build/content/render-contract/placeholder.css`.** That file is Serene Labs work for hire under the same terms as this package, not a third party asset.

---

## 7. Full dependency tree

Every package resolved into `node_modules`, direct and transitive, with its version and licence. The table below is generated, not typed. Regenerate it with the command in section 8 after any dependency change.

<!-- BEGIN GENERATED PACKAGE LIST. Do not edit by hand: node scripts/licenses.mjs rewrites it. -->

**155 installed package and version pairs, and every one of them is listed below.** This
section is generated from `node_modules` by `node scripts/licenses.mjs`, not typed, so it cannot
drift from what an install actually pulls in. The role column says whether a package is a declared
runtime dependency, a declared development dependency, or something one of those pulled in.

**Three totals, all true, stated together so they cannot look like a disagreement.** 155
package and version pairs, 151 distinct package names, 155 copies on disk. 4 packages are installed at more than one version, and each installed copy is its own licence grant: `cookie (1.1.1, 2.0.1)`, `fast-uri (3.1.5, 4.1.2)`, `fastify-plugin (5.1.0, 6.0.0)`, `process-warning (4.0.1, 5.1.0)`.

**The committed lockfile resolves 205 pairs**, which is 50 more than are installed here. The difference is optional binary packages for operating systems this machine is not, and they install on any machine that is.

| Licence, exactly as the package declares it | Pairs | Copyleft |
|---|---|---|
| `MIT` | 112 | no |
| `Apache-2.0` | 24 | no |
| `ISC` | 8 | no |
| `BlueOak-1.0.0` | 5 | no |
| `BSD-3-Clause` | 5 | no |
| `0BSD` | 1 | no |

**Nothing in this table falls outside the permissive set.** No GPL, no LGPL, no AGPL, no MPL, no source available and no commercial licence.

**No copyleft licence appears in this package, installed or resolved.**

| Package | Version | Licence | Role |
|---|---|---|---|
| `@aws-sdk/client-cognito-identity-provider` | 3.1130.0 | Apache-2.0 | runtime |
| `@aws-sdk/core` | 3.978.0 | Apache-2.0 | transitive |
| `@aws-sdk/credential-provider-env` | 3.972.71 | Apache-2.0 | transitive |
| `@aws-sdk/credential-provider-http` | 3.972.73 | Apache-2.0 | transitive |
| `@aws-sdk/credential-provider-ini` | 3.973.16 | Apache-2.0 | transitive |
| `@aws-sdk/credential-provider-login` | 3.972.78 | Apache-2.0 | transitive |
| `@aws-sdk/credential-provider-node` | 3.972.83 | Apache-2.0 | transitive |
| `@aws-sdk/credential-provider-process` | 3.972.71 | Apache-2.0 | transitive |
| `@aws-sdk/credential-provider-sso` | 3.973.15 | Apache-2.0 | transitive |
| `@aws-sdk/credential-provider-web-identity` | 3.972.77 | Apache-2.0 | transitive |
| `@aws-sdk/nested-clients` | 3.997.45 | Apache-2.0 | transitive |
| `@aws-sdk/signature-v4-multi-region` | 3.996.46 | Apache-2.0 | transitive |
| `@aws-sdk/token-providers` | 3.1129.0 | Apache-2.0 | transitive |
| `@aws-sdk/types` | 3.974.5 | Apache-2.0 | transitive |
| `@aws-sdk/xml-builder` | 3.972.40 | Apache-2.0 | transitive |
| `@aws/lambda-invoke-store` | 0.3.0 | Apache-2.0 | transitive |
| `@esbuild/win32-x64` | 0.28.2 | MIT | transitive |
| `@fastify/accept-negotiator` | 2.1.0 | MIT | transitive |
| `@fastify/ajv-compiler` | 4.0.6 | MIT | transitive |
| `@fastify/aws-lambda` | 6.4.1 | MIT | runtime |
| `@fastify/cookie` | 11.1.2 | MIT | runtime |
| `@fastify/error` | 4.2.0 | MIT | transitive |
| `@fastify/fast-json-stringify-compiler` | 5.1.0 | MIT | transitive |
| `@fastify/formbody` | 8.0.2 | MIT | runtime |
| `@fastify/forwarded` | 3.0.2 | MIT | transitive |
| `@fastify/merge-json-schemas` | 0.2.1 | MIT | transitive |
| `@fastify/proxy-addr` | 5.1.0 | MIT | transitive |
| `@fastify/send` | 4.1.1 | MIT | transitive |
| `@fastify/static` | 10.1.3 | MIT | runtime |
| `@jridgewell/sourcemap-codec` | 1.5.5 | MIT | transitive |
| `@lukeed/ms` | 2.0.2 | MIT | transitive |
| `@pinojs/redact` | 0.4.0 | MIT | transitive |
| `@rollup/rollup-win32-x64-gnu` | 4.62.5 | MIT | transitive |
| `@rollup/rollup-win32-x64-msvc` | 4.62.5 | MIT | transitive |
| `@smithy/core` | 3.34.0 | Apache-2.0 | transitive |
| `@smithy/credential-provider-imds` | 4.5.2 | Apache-2.0 | transitive |
| `@smithy/fetch-http-handler` | 5.8.0 | Apache-2.0 | transitive |
| `@smithy/node-http-handler` | 4.12.1 | Apache-2.0 | transitive |
| `@smithy/signature-v4` | 5.7.3 | Apache-2.0 | transitive |
| `@smithy/types` | 4.18.0 | Apache-2.0 | transitive |
| `@types/chai` | 5.2.3 | MIT | transitive |
| `@types/deep-eql` | 4.0.2 | MIT | transitive |
| `@types/estree` | 1.0.9 | MIT | transitive |
| `@types/node` | 20.19.43 | MIT | development |
| `@vitest/expect` | 3.2.7 | MIT | transitive |
| `@vitest/mocker` | 3.2.7 | MIT | transitive |
| `@vitest/pretty-format` | 3.2.7 | MIT | transitive |
| `@vitest/runner` | 3.2.7 | MIT | transitive |
| `@vitest/snapshot` | 3.2.7 | MIT | transitive |
| `@vitest/spy` | 3.2.7 | MIT | transitive |
| `@vitest/utils` | 3.2.7 | MIT | transitive |
| `abstract-logging` | 2.0.1 | MIT | transitive |
| `ajv` | 8.20.0 | MIT | transitive |
| `ajv-formats` | 3.0.1 | MIT | transitive |
| `assertion-error` | 2.0.1 | MIT | transitive |
| `atomic-sleep` | 1.0.0 | MIT | transitive |
| `avvio` | 9.3.0 | MIT | transitive |
| `balanced-match` | 4.0.4 | MIT | transitive |
| `bowser` | 2.14.1 | MIT | transitive |
| `brace-expansion` | 5.0.9 | MIT | transitive |
| `cac` | 6.7.14 | MIT | transitive |
| `chai` | 5.3.3 | MIT | transitive |
| `check-error` | 2.1.3 | MIT | transitive |
| `content-disposition` | 2.0.1 | MIT | transitive |
| `cookie` | 1.1.1 | MIT | transitive |
| `cookie` | 2.0.1 | MIT | transitive |
| `debug` | 4.4.3 | MIT | transitive |
| `deep-eql` | 5.0.2 | MIT | transitive |
| `depd` | 2.0.0 | MIT | transitive |
| `dequal` | 2.0.3 | MIT | transitive |
| `es-module-lexer` | 1.7.0 | MIT | transitive |
| `esbuild` | 0.28.2 | MIT | transitive |
| `escape-html` | 1.0.3 | MIT | transitive |
| `estree-walker` | 3.0.3 | MIT | transitive |
| `expect-type` | 1.4.0 | Apache-2.0 | transitive |
| `fast-decode-uri-component` | 1.0.1 | MIT | transitive |
| `fast-deep-equal` | 3.1.3 | MIT | transitive |
| `fast-json-stringify` | 7.0.1 | MIT | transitive |
| `fast-querystring` | 1.1.2 | MIT | transitive |
| `fast-uri` | 3.1.5 | BSD-3-Clause | transitive |
| `fast-uri` | 4.1.2 | BSD-3-Clause | transitive |
| `fastify` | 5.12.1 | MIT | runtime |
| `fastify-plugin` | 5.1.0 | MIT | transitive |
| `fastify-plugin` | 6.0.0 | MIT | transitive |
| `fastq` | 1.20.1 | ISC | transitive |
| `fdir` | 6.5.0 | MIT | transitive |
| `find-my-way` | 9.9.0 | MIT | transitive |
| `glob` | 13.0.6 | BlueOak-1.0.0 | transitive |
| `http-errors` | 2.0.1 | MIT | transitive |
| `inherits` | 2.0.4 | ISC | transitive |
| `ipaddr.js` | 2.5.0 | MIT | transitive |
| `jose` | 5.10.0 | MIT | runtime |
| `js-tokens` | 9.0.1 | MIT | transitive |
| `json-schema-ref-resolver` | 3.0.0 | MIT | transitive |
| `json-schema-traverse` | 1.0.0 | MIT | transitive |
| `light-my-request` | 6.6.0 | BSD-3-Clause | transitive |
| `loupe` | 3.2.1 | MIT | transitive |
| `lru-cache` | 11.5.2 | BlueOak-1.0.0 | transitive |
| `magic-string` | 0.30.21 | MIT | transitive |
| `mime` | 3.0.0 | MIT | transitive |
| `minimatch` | 10.2.6 | BlueOak-1.0.0 | transitive |
| `minipass` | 7.1.3 | BlueOak-1.0.0 | transitive |
| `ms` | 2.1.3 | MIT | transitive |
| `nanoid` | 3.3.18 | MIT | transitive |
| `on-exit-leak-free` | 2.1.2 | MIT | transitive |
| `path-scurry` | 2.0.2 | BlueOak-1.0.0 | transitive |
| `pathe` | 2.0.3 | MIT | transitive |
| `pathval` | 2.0.1 | MIT | transitive |
| `picocolors` | 1.1.1 | ISC | transitive |
| `picomatch` | 4.0.5 | MIT | transitive |
| `pino` | 9.14.0 | MIT | transitive |
| `pino-abstract-transport` | 2.0.0 | MIT | transitive |
| `pino-std-serializers` | 7.1.0 | MIT | transitive |
| `postcss` | 8.5.26 | MIT | transitive |
| `process-warning` | 4.0.1 | MIT | transitive |
| `process-warning` | 5.1.0 | MIT | transitive |
| `quick-format-unescaped` | 4.0.4 | MIT | transitive |
| `real-require` | 0.2.0 | MIT | transitive |
| `require-from-string` | 2.0.2 | MIT | transitive |
| `ret` | 0.5.0 | MIT | transitive |
| `reusify` | 1.1.0 | MIT | transitive |
| `rfdc` | 1.4.1 | MIT | transitive |
| `rollup` | 4.62.5 | MIT | transitive |
| `safe-regex2` | 5.1.1 | MIT | transitive |
| `safe-stable-stringify` | 2.5.0 | MIT | transitive |
| `secure-json-parse` | 4.1.0 | BSD-3-Clause | transitive |
| `semver` | 7.8.5 | ISC | transitive |
| `set-cookie-parser` | 2.7.2 | MIT | transitive |
| `setprototypeof` | 1.2.0 | ISC | transitive |
| `siginfo` | 2.0.0 | ISC | transitive |
| `sonic-boom` | 4.2.1 | MIT | transitive |
| `source-map-js` | 1.2.1 | BSD-3-Clause | transitive |
| `split2` | 4.2.0 | ISC | transitive |
| `stackback` | 0.0.2 | MIT | transitive |
| `statuses` | 2.0.2 | MIT | transitive |
| `std-env` | 3.10.0 | MIT | transitive |
| `strip-literal` | 3.1.0 | MIT | transitive |
| `thread-stream` | 3.2.0 | MIT | transitive |
| `tinybench` | 2.9.0 | MIT | transitive |
| `tinyexec` | 0.3.2 | MIT | transitive |
| `tinyglobby` | 0.2.17 | MIT | transitive |
| `tinypool` | 1.1.1 | MIT | transitive |
| `tinyrainbow` | 2.0.0 | MIT | transitive |
| `tinyspy` | 4.0.4 | MIT | transitive |
| `toad-cache` | 3.7.4 | MIT | transitive |
| `toidentifier` | 1.0.1 | MIT | transitive |
| `tslib` | 2.8.1 | 0BSD | transitive |
| `tsx` | 4.23.12 | MIT | development |
| `typescript` | 5.9.3 | Apache-2.0 | development |
| `undici-types` | 6.21.0 | MIT | transitive |
| `vite` | 7.3.6 | MIT | transitive |
| `vite-node` | 3.2.4 | MIT | transitive |
| `vitest` | 3.2.7 | MIT | development |
| `why-is-node-running` | 2.3.0 | MIT | transitive |
| `yaml` | 2.9.0 | ISC | runtime |

<!-- END GENERATED PACKAGE LIST -->

---

## 8. How to regenerate this list

Any dependency change invalidates sections 3, 4 and 7. Regenerate before a handoff and before any release:

```bash
npm run licences          # rewrites licenses.json and section 7 from node_modules
npm run licences:check    # writes nothing, exits 1 if either has drifted
npm audit
```

**Section 7 used to be produced by a command pasted into this file, which is a hand kept list wearing a script's clothes.** It is now `scripts/licenses.mjs`, the same file that runs in every other package with an installed tree, and it also reads `package-lock.json` so the manifest states what a Linux or macOS install resolves rather than only what this machine has. Put `npm run licences:check` in CI: a manifest regenerated by whoever remembers is the manifest that was wrong.

`test/unit/housekeeping.test.ts` asserts that every direct dependency in `package.json` appears in this file, so a dependency added without being listed fails the test suite rather than being noticed at handoff.

---

## 9. What this application is not licensed to do, and does not

- It embeds no third party content, imagery or typography.
- It sends nothing to any third party service. The only network destination is the Trevean API, at the address in `API_BASE_URL`.
- It loads nothing from a CDN at runtime, including fonts and stylesheets.
- It contains no analytics, no telemetry and no error reporting client.
