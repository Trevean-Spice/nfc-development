# Third-party libraries and licences

**Component:** Trevean Spice tap-to-story REST API (`build/api`)
**Maintained from:** 17 August 2026, and updated in the same commit as any dependency change
**Why this file exists:** the Scope document, "IP and handoff", carries a background IP
obligation. Any pre-existing library or framework reused must be listed explicitly and
licensed to Trevean to run and maintain the product indefinitely. The instruction there is
to keep a running list from day one rather than reconstruct it at handoff, so this file is
part of the deliverable rather than a handoff artifact.

## The summary a lawyer needs

Every dependency, direct and transitive, is under a permissive licence: MIT, Apache-2.0,
ISC, BSD-3-Clause or 0BSD. **There is no copyleft anywhere in the tree.** No GPL, no LGPL,
no AGPL, no MPL, and no source-available or commercial licence. Trevean can run, modify and
redistribute this component, and can engage any third party to modify it, with no licence
obligation beyond retaining the copyright notices that ship inside the packages.

**The counts and the package by package list are both in "Every installed package,
enumerated" below**, and in `licenses.json` alongside it. Both are generated from
`node_modules` by `npm run licences`.

**Why that section exists.** Until Saturday 22 August 2026 this file carried the counts and
no list, while the consumer web package shipped an exhaustive machine generated enumeration
of its own tree. The background IP obligation asks for a list, and a reviewer comparing the
two would have seen one of them stop short. The counts are now a summary of a list rather
than a substitute for one, and they are generated rather than kept by hand so the two cannot
disagree.

**One number changed in the process, and it was not wrong before.** This file used to say
174 packages. That is the number of distinct package *names*. Seven packages are installed
at two versions each, so there are 181 installed copies, and each copy is its own licence
grant. Both figures now appear together below rather than one of them appearing alone.

## Runtime dependencies

These ship to production.

| Package | Version | Licence | What it does here | Why it, and what replacing it would cost |
|---|---|---|---|---|
| `fastify` | 4.29.1 | MIT | HTTP server, routing, lifecycle hooks | Chosen for its inject() test interface, which lets the whole suite run with no listening socket, and for a first-party Lambda adapter. Swapping it for Express is a day: the handlers take a request and return a value, and nothing framework-specific leaks into `services/` or `repositories/`. |
| `@fastify/aws-lambda` | 4.1.0 | MIT | Adapts the Fastify app to an API Gateway or function URL event | Only used by `src/lambda.ts`. Deleting it costs the Lambda entry point and nothing else. |
| `@aws-sdk/client-dynamodb` | 3.1112.0 | Apache-2.0 | DynamoDB client | First-party AWS SDK. Not replaceable in practice. |
| `@aws-sdk/lib-dynamodb` | 3.1112.0 | Apache-2.0 | Document client: plain JavaScript objects instead of attribute-value maps | Removable at the cost of hand marshalling every item. |
| `@aws-sdk/util-dynamodb` | 3.996.9 | Apache-2.0 | Unmarshals stream record images in the rollup consumer | Same. **The version number looks wrong next to its siblings and is not.** See "On the AWS SDK version numbers" below. |
| `@aws-sdk/client-s3` | 3.1112.0 | Apache-2.0 | Presigned upload target and the completion HeadObject | First-party AWS SDK. |
| `@aws-sdk/s3-request-presigner` | 3.1112.0 | Apache-2.0 | Signs the S3 PUT URL so a large photograph never passes through a function | Same. |
| `@aws-sdk/client-secrets-manager` | 3.1112.0 | Apache-2.0 | Reads secrets from the managed store, never from the repo | Same. |
| `ajv` | 8.20.0 | MIT | Compiles the frozen OpenAPI schemas into request validators | Load bearing by design: validation is compiled from the contract document rather than retyped, so the two cannot drift. Replacing it means replacing that property. |
| `ajv-formats` | 3.0.1 | MIT | `date-time`, `date`, `uri`, `email` format assertions | Small. |
| `jose` | 5.10.0 | MIT | JWT verification: signature, issuer, audience, expiry, plus JWKS fetching | The alternative is hand-rolled crypto on the authentication path, which is not a trade worth making. |
| `yaml` | 2.9.0 | ISC | Parses the frozen OpenAPI document at startup | Removable by committing a JSON copy of the contract, at the cost of a second file to keep in step. |

## Development and test dependencies

These do not ship.

| Package | Version | Licence | What it does here |
|---|---|---|---|
| `typescript` | 5.9.3 | Apache-2.0 | Compiler and type checking |
| `tsx` | 4.23.12 | MIT | Runs TypeScript directly for the dev server and the local scripts |
| `vitest` | 2.1.9 | MIT | Test runner |
| `dynalite` | 3.2.2 | MIT | In process DynamoDB compatible server, so the suite runs with no AWS account and no Docker |
| `@types/node` | 20.19.43 | MIT | Node type definitions |

### What actually ships, added Thursday 27 August 2026

Until this date nothing shipped anywhere, because no function had an HTTP invoke path and
every one of them carried the infrastructure placeholder. `scripts/package-lambda.mjs` now
builds the Lambda deployment package, so "these ship to production" and "these do not"
became checkable rather than intended.

**The script adds no dependency.** It is Node standard library only, including the zip
writer at the bottom of it, and that is deliberate: the one script whose job is to ship the
dependency list is the one that must not add to it. `@fastify/aws-lambda`, the adapter the
Lambda entry point needs, was already declared above as MIT and was already imported by
`src/lambda.ts`.

**The package contains the production tree and nothing else.** It is installed with
`npm ci --omit=dev` from `package-lock.json`, so the compiler, the test runner and the in
process DynamoDB server are absent by construction rather than by an ignore list. Observed
on the first build: 6,746 files, 6.3 MiB. Five scoped directories from the development tree
(`@esbuild`, `@rollup`, `@vitest`, `@types`, `@napi-rs`) are left behind **empty** by npm
and were checked to contain zero files; the archive carries files only, so none of them
reaches the artifact.

`dynalite` pulls in `lazy@1.0.11`, which declares MIT in the older `{"type":"MIT"}` object
form that some licence scanners report as unknown. It is MIT, it is test-only, and it never
ships.

### On the AWS SDK version numbers

**`@aws-sdk/util-dynamodb` resolves to 3.996.9 while the five service clients resolve to
3.1112.0. That is correct, it is not a pin, and it is not drift.** It is written down here
because it looks like an accident and somebody will otherwise "fix" it.

- **Nothing in this package is pinned.** All six AWS entries in `package.json` are caret
  ranges. The only real inconsistency is a cosmetic one: five declare a floor of `^3.658.0`
  and `util-dynamodb` declares `^3.996.9`.
- **3.1112.0 is the newer version, not the older one.** Semver compares each part
  numerically, so minor 1112 is greater than minor 996. The string intuition that reads
  "996" as later is what makes this look inverted.
- **AWS versions its utility and internal packages on a lower minor track than its service
  clients.** Nineteen of the twenty five `@aws-sdk/*` packages in this tree sit in the same
  3.97x to 3.100x band as `util-dynamodb`.
- **The decisive evidence is upstream's own metadata.** `@aws-sdk/lib-dynamodb@3.1112.0`
  declares a dependency on `@aws-sdk/util-dynamodb` at `^3.996.9`, and `util-dynamodb@3.996.9`
  declares a peer dependency on `@aws-sdk/client-dynamodb` at `^3.1111.0`. A stale version
  left behind could not peer depend on a client newer than itself. 3.996.9 is the release
  that ships alongside the 3.1112.0 clients.
- **Consequently there is nothing to upgrade.** The caret range already permits 3.1112.0 if
  such a version of this package is ever published; npm resolved 3.996.9 because that is the
  latest published `util-dynamodb`, not because anything is holding it back.

## Every installed package, enumerated

<!-- BEGIN GENERATED PACKAGE LIST. Do not edit by hand: npm run licences rewrites it. -->

**181 installed packages, and every one of them is listed below.** This section is
generated from `node_modules` by `npm run licences`, not typed, so it cannot drift from
what an install actually pulls in. The role column says whether a package is a declared
runtime dependency, a declared development dependency, or something one of those pulled in.
Runtime packages ship to production; the other two do not.

**Two totals, both true, stated together so they cannot look like a disagreement.** There are
**181 installed packages** and **174 distinct package names**. The difference is 7 packages installed at two versions each, once at the top level and once nested under a dependency needing a different one: `@esbuild/win32-x64`, `abstract-leveldown`, `ajv-formats`, `esbuild`, `fast-uri`, `immediate`, `process-warning`. Each installed copy is its own licence grant, so the table lists both.

| Licence | Packages |
|---|---|
| MIT | 131 |
| Apache-2.0 | 34 |
| ISC | 9 |
| BSD-3-Clause | 5 |
| 0BSD | 1 |
| MIT (declared in the older object form) | 1 |

**Nothing in this table falls outside the permissive set.** No GPL, no LGPL, no AGPL, no MPL, no source-available and no commercial licence.

| Package | Version | Licence | Role |
|---|---|---|---|
| `@aws-sdk/checksums` | 3.1000.28 | Apache-2.0 | transitive |
| `@aws-sdk/client-dynamodb` | 3.1112.0 | Apache-2.0 | runtime |
| `@aws-sdk/client-s3` | 3.1112.0 | Apache-2.0 | runtime |
| `@aws-sdk/client-secrets-manager` | 3.1112.0 | Apache-2.0 | runtime |
| `@aws-sdk/core` | 3.977.8 | Apache-2.0 | transitive |
| `@aws-sdk/credential-provider-env` | 3.972.69 | Apache-2.0 | transitive |
| `@aws-sdk/credential-provider-http` | 3.972.71 | Apache-2.0 | transitive |
| `@aws-sdk/credential-provider-ini` | 3.973.14 | Apache-2.0 | transitive |
| `@aws-sdk/credential-provider-login` | 3.972.76 | Apache-2.0 | transitive |
| `@aws-sdk/credential-provider-node` | 3.972.80 | Apache-2.0 | transitive |
| `@aws-sdk/credential-provider-process` | 3.972.69 | Apache-2.0 | transitive |
| `@aws-sdk/credential-provider-sso` | 3.973.13 | Apache-2.0 | transitive |
| `@aws-sdk/credential-provider-web-identity` | 3.972.75 | Apache-2.0 | transitive |
| `@aws-sdk/dynamodb-codec` | 3.973.43 | Apache-2.0 | transitive |
| `@aws-sdk/endpoint-cache` | 3.972.11 | Apache-2.0 | transitive |
| `@aws-sdk/lib-dynamodb` | 3.1112.0 | Apache-2.0 | runtime |
| `@aws-sdk/middleware-endpoint-discovery` | 3.972.29 | Apache-2.0 | transitive |
| `@aws-sdk/middleware-sdk-s3` | 3.972.74 | Apache-2.0 | transitive |
| `@aws-sdk/nested-clients` | 3.997.43 | Apache-2.0 | transitive |
| `@aws-sdk/s3-request-presigner` | 3.1112.0 | Apache-2.0 | runtime |
| `@aws-sdk/signature-v4-multi-region` | 3.996.45 | Apache-2.0 | transitive |
| `@aws-sdk/token-providers` | 3.1111.0 | Apache-2.0 | transitive |
| `@aws-sdk/types` | 3.974.4 | Apache-2.0 | transitive |
| `@aws-sdk/util-dynamodb` | 3.996.9 | Apache-2.0 | runtime |
| `@aws-sdk/xml-builder` | 3.972.39 | Apache-2.0 | transitive |
| `@aws/lambda-invoke-store` | 0.3.0 | Apache-2.0 | transitive |
| `@esbuild/win32-x64` | 0.21.5 | MIT | transitive |
| `@esbuild/win32-x64` | 0.28.2 | MIT | transitive |
| `@fastify/ajv-compiler` | 3.6.0 | MIT | transitive |
| `@fastify/aws-lambda` | 4.1.0 | MIT | runtime |
| `@fastify/error` | 3.4.1 | MIT | transitive |
| `@fastify/fast-json-stringify-compiler` | 4.3.0 | MIT | transitive |
| `@fastify/merge-json-schemas` | 0.1.1 | MIT | transitive |
| `@jridgewell/sourcemap-codec` | 1.5.5 | MIT | transitive |
| `@pinojs/redact` | 0.4.0 | MIT | transitive |
| `@rollup/rollup-win32-x64-gnu` | 4.62.4 | MIT | transitive |
| `@rollup/rollup-win32-x64-msvc` | 4.62.4 | MIT | transitive |
| `@smithy/core` | 3.33.2 | Apache-2.0 | transitive |
| `@smithy/credential-provider-imds` | 4.5.2 | Apache-2.0 | transitive |
| `@smithy/fetch-http-handler` | 5.7.2 | Apache-2.0 | transitive |
| `@smithy/node-http-handler` | 4.11.2 | Apache-2.0 | transitive |
| `@smithy/signature-v4` | 5.7.2 | Apache-2.0 | transitive |
| `@smithy/types` | 4.17.2 | Apache-2.0 | transitive |
| `@types/estree` | 1.0.9 | MIT | transitive |
| `@types/node` | 20.19.43 | MIT | development |
| `@vitest/expect` | 2.1.9 | MIT | transitive |
| `@vitest/mocker` | 2.1.9 | MIT | transitive |
| `@vitest/pretty-format` | 2.1.9 | MIT | transitive |
| `@vitest/runner` | 2.1.9 | MIT | transitive |
| `@vitest/snapshot` | 2.1.9 | MIT | transitive |
| `@vitest/spy` | 2.1.9 | MIT | transitive |
| `@vitest/utils` | 2.1.9 | MIT | transitive |
| `abstract-leveldown` | 6.2.3 | MIT | transitive |
| `abstract-leveldown` | 6.3.0 | MIT | transitive |
| `abstract-logging` | 2.0.1 | MIT | transitive |
| `ajv` | 8.20.0 | MIT | runtime |
| `ajv-formats` | 2.1.1 | MIT | runtime |
| `ajv-formats` | 3.0.1 | MIT | runtime |
| `assertion-error` | 2.0.1 | MIT | transitive |
| `async` | 2.6.4 | MIT | transitive |
| `atomic-sleep` | 1.0.0 | MIT | transitive |
| `avvio` | 8.4.0 | MIT | transitive |
| `base64-js` | 1.5.1 | MIT | transitive |
| `big.js` | 5.2.2 | MIT | transitive |
| `bowser` | 2.14.1 | MIT | transitive |
| `buffer` | 5.7.1 | MIT | transitive |
| `buffer-crc32` | 0.2.13 | MIT | transitive |
| `cac` | 6.7.14 | MIT | transitive |
| `chai` | 5.3.3 | MIT | transitive |
| `check-error` | 2.1.3 | MIT | transitive |
| `cookie` | 0.7.2 | MIT | transitive |
| `debug` | 4.4.3 | MIT | transitive |
| `deep-eql` | 5.0.2 | MIT | transitive |
| `deferred-leveldown` | 5.3.0 | MIT | transitive |
| `defined` | 0.0.0 | MIT | transitive |
| `dynalite` | 3.2.2 | MIT | development |
| `encoding-down` | 6.3.0 | MIT | transitive |
| `errno` | 0.1.8 | MIT | transitive |
| `es-module-lexer` | 1.7.0 | MIT | transitive |
| `esbuild` | 0.21.5 | MIT | transitive |
| `esbuild` | 0.28.2 | MIT | transitive |
| `estree-walker` | 3.0.3 | MIT | transitive |
| `expect-type` | 1.4.0 | Apache-2.0 | transitive |
| `fast-content-type-parse` | 1.1.0 | MIT | transitive |
| `fast-decode-uri-component` | 1.0.1 | MIT | transitive |
| `fast-deep-equal` | 3.1.3 | MIT | transitive |
| `fast-json-stringify` | 5.16.1 | MIT | transitive |
| `fast-querystring` | 1.1.2 | MIT | transitive |
| `fast-uri` | 2.4.4 | MIT | transitive |
| `fast-uri` | 3.1.5 | BSD-3-Clause | transitive |
| `fastify` | 4.29.1 | MIT | runtime |
| `fastq` | 1.20.1 | ISC | transitive |
| `find-my-way` | 8.2.2 | MIT | transitive |
| `forwarded` | 0.2.0 | MIT | transitive |
| `functional-red-black-tree` | 1.0.1 | MIT | transitive |
| `ieee754` | 1.2.1 | BSD-3-Clause | transitive |
| `immediate` | 3.2.3 | MIT | transitive |
| `immediate` | 3.3.0 | MIT | transitive |
| `inherits` | 2.0.4 | ISC | transitive |
| `ipaddr.js` | 1.9.1 | MIT | transitive |
| `jose` | 5.10.0 | MIT | runtime |
| `json-schema-ref-resolver` | 1.0.1 | MIT | transitive |
| `json-schema-traverse` | 1.0.0 | MIT | transitive |
| `lazy` | 1.0.11 | MIT (declared in the older object form) | transitive |
| `level-codec` | 9.0.2 | MIT | transitive |
| `level-concat-iterator` | 2.0.1 | MIT | transitive |
| `level-errors` | 2.0.1 | MIT | transitive |
| `level-iterator-stream` | 4.0.2 | MIT | transitive |
| `level-option-wrap` | 1.1.0 | MIT | transitive |
| `level-supports` | 1.0.1 | MIT | transitive |
| `leveldown` | 5.6.0 | MIT | transitive |
| `levelup` | 4.4.0 | MIT | transitive |
| `light-my-request` | 5.14.0 | BSD-3-Clause | transitive |
| `lock` | 1.1.0 | MIT | transitive |
| `lodash` | 4.18.1 | MIT | transitive |
| `loupe` | 3.2.1 | MIT | transitive |
| `ltgt` | 2.2.1 | MIT | transitive |
| `magic-string` | 0.30.21 | MIT | transitive |
| `memdown` | 5.1.0 | MIT | transitive |
| `minimist` | 1.2.8 | MIT | transitive |
| `mnemonist` | 0.38.3 | MIT | transitive |
| `ms` | 2.1.3 | MIT | transitive |
| `nanoid` | 3.3.18 | MIT | transitive |
| `napi-macros` | 2.0.0 | MIT | transitive |
| `node-gyp-build` | 4.1.1 | MIT | transitive |
| `obliterator` | 1.6.1 | MIT | transitive |
| `on-exit-leak-free` | 2.1.2 | MIT | transitive |
| `once` | 1.4.0 | ISC | transitive |
| `pathe` | 1.1.2 | MIT | transitive |
| `pathval` | 2.0.1 | MIT | transitive |
| `picocolors` | 1.1.1 | ISC | transitive |
| `pino` | 9.14.0 | MIT | transitive |
| `pino-abstract-transport` | 2.0.0 | MIT | transitive |
| `pino-std-serializers` | 7.1.0 | MIT | transitive |
| `postcss` | 8.5.26 | MIT | transitive |
| `process-warning` | 3.0.0 | MIT | transitive |
| `process-warning` | 5.1.0 | MIT | transitive |
| `proxy-addr` | 2.0.7 | MIT | transitive |
| `prr` | 1.0.1 | MIT | transitive |
| `quick-format-unescaped` | 4.0.4 | MIT | transitive |
| `reachdown` | 1.1.0 | MIT | transitive |
| `readable-stream` | 3.6.2 | MIT | transitive |
| `real-require` | 0.2.0 | MIT | transitive |
| `require-from-string` | 2.0.2 | MIT | transitive |
| `ret` | 0.4.3 | MIT | transitive |
| `reusify` | 1.1.0 | MIT | transitive |
| `rfdc` | 1.4.1 | MIT | transitive |
| `rollup` | 4.62.4 | MIT | transitive |
| `safe-buffer` | 5.2.1 | MIT | transitive |
| `safe-regex2` | 3.1.0 | MIT | transitive |
| `safe-stable-stringify` | 2.5.0 | MIT | transitive |
| `secure-json-parse` | 2.7.0 | BSD-3-Clause | transitive |
| `semver` | 7.8.5 | ISC | transitive |
| `set-cookie-parser` | 2.7.2 | MIT | transitive |
| `siginfo` | 2.0.0 | ISC | transitive |
| `sonic-boom` | 4.2.1 | MIT | transitive |
| `source-map-js` | 1.2.1 | BSD-3-Clause | transitive |
| `split2` | 4.2.0 | ISC | transitive |
| `stackback` | 0.0.2 | MIT | transitive |
| `std-env` | 3.10.0 | MIT | transitive |
| `string_decoder` | 1.3.0 | MIT | transitive |
| `subleveldown` | 5.0.1 | MIT | transitive |
| `thread-stream` | 3.2.0 | MIT | transitive |
| `tinybench` | 2.9.0 | MIT | transitive |
| `tinyexec` | 0.3.2 | MIT | transitive |
| `tinypool` | 1.1.1 | MIT | transitive |
| `tinyrainbow` | 1.2.0 | MIT | transitive |
| `tinyspy` | 3.0.2 | MIT | transitive |
| `toad-cache` | 3.7.4 | MIT | transitive |
| `tslib` | 2.8.1 | 0BSD | transitive |
| `tsx` | 4.23.12 | MIT | development |
| `typescript` | 5.9.3 | Apache-2.0 | development |
| `undici-types` | 6.21.0 | MIT | transitive |
| `util-deprecate` | 1.0.2 | MIT | transitive |
| `vite` | 5.4.21 | MIT | transitive |
| `vite-node` | 2.1.9 | MIT | transitive |
| `vitest` | 2.1.9 | MIT | development |
| `why-is-node-running` | 2.3.0 | MIT | transitive |
| `wrappy` | 1.0.2 | ISC | transitive |
| `xtend` | 4.0.2 | MIT | transitive |
| `yaml` | 2.9.0 | ISC | runtime |

<!-- END GENERATED PACKAGE LIST -->

## Written here rather than taken from a library

Listed because the honest version of a background IP list also says what was deliberately
not imported.

- **ULID generation** (`src/util/ulid.ts`). About thirty lines. The contract requires
  `^[0-9A-HJKMNP-TV-Z]{26}$` and a dependency is not worth it for that.
- **Rate limiting** (`src/http/rateLimit.ts`). Limits are enforced at the CDN and WAF per
  the API contract, section 9. The in process limiter is a small fallback, not a library.
- **Structured logging** (`src/observability/logger.ts`). Written by hand because the
  redaction rule is the point: no IP address, no user agent, no authorisation header and no
  email ever reaches a log line, and that is easier to prove in forty lines we own than to
  configure in a logging framework.
- **HMAC webhook verification** (`src/webhooks/signature.ts`). Node's own `crypto`, with a
  constant time comparison.

## Assets and data

- `openapi/openapi.yaml` and `openapi/api-contract.md` are copies of the frozen M1
  deliverables, owned by Trevean as work for hire. A test asserts the copy is byte
  identical to the original.
- `config/redirect-table.json` is the version controlled redirect table. It is Trevean's
  operational data, not a third-party asset. The canonical copy lives in the application
  repository.

## Keeping this file true

```
npm run licences
```

That regenerates `licenses.json` and the enumerated section above from `node_modules`, so
neither can drift from what an install actually pulls in. `npm run licences:check` writes
nothing and exits 1 if either has drifted, which is what a pull request should run. Both
read `license` from every `package.json` in the installed tree, including nested copies, and
tolerate the older object and array declaration forms rather than reporting them as unknown.

A package reporting anything outside the permissive set is named at the top of the generated
section rather than buried in a count, and it is a decision to raise with Dan before it
merges, not after.

The hand-written tables above, which say what each direct dependency does and what replacing
it would cost, are not generated and are still updated by hand in the same commit as any
dependency change.
