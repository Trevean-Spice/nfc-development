# Third-party libraries and licences

**Component:** Trevean Spice publish pipeline (`build/publisher`)
**Maintained from:** Friday 4 September 2026, and updated in the same commit as any dependency change
**Why this file exists:** the Scope document, "IP and handoff", carries a background IP
obligation. Any pre-existing library or framework reused must be listed explicitly and
licensed to Trevean to run and maintain the product indefinitely. The instruction there is
to keep a running list from day one rather than reconstruct it at handoff, so this file is
part of the deliverable rather than a handoff artifact.

## The summary a lawyer needs

**28 installed packages, all permissive: 26 Apache-2.0, 1 MIT, 1 0BSD. There is no copyleft
in the npm tree.** No GPL, no LGPL, no AGPL, no MPL, and no source-available or
commercial licence. Trevean can run, modify and redistribute this component, and can engage
any third party to modify it, with no licence obligation beyond retaining the copyright
notices that ship inside the packages.

**There is copyleft in the CONTAINER IMAGE, and it arrived on Friday 4 September 2026 when
the host decision was taken.** That statement used to read "no copyleft anywhere in the
tree" and it is corrected rather than quietly narrowed. See "The container image" below.
The short version: the operating system inside the image is Debian, Debian contains GPL and
LGPL licensed programs, and every Linux base image on the market does, including Alpine.
Nothing links against them and nothing derives from them, and the obligation they carry does
not arise unless Trevean distributes the image outside their own account.

**Three declared dependencies, and all three are AWS SDK clients.** Everything else in this
package is the Node standard library. That is deliberate rather than minimalist for its own
sake: this is the component whose job is to ship other people's code to customers, it has to
run on a laptop with expired credentials and inside CI, and the fewer things that can be
missing the better. The HTTP server is `node:http`, the signature is `node:crypto`, the test
suite is `node:test`, and there is no build step.

**None of the three is imported at module load.** They are dynamically imported inside the
AWS adapters in `src/store/aws.mjs` and `src/index.mjs`, so the entire publish path, the
stand in origin, the stand in edge and the whole test suite run with no node_modules at all.
A package that is only loaded on the AWS path is still a background IP obligation and is
still listed here.

## Runtime dependencies

These ship to whatever runs the pipeline.

| Package | Version | Licence | What it does here | Why it, and what replacing it would cost |
|---|---|---|---|---|
| `@aws-sdk/client-s3` | ^3.658.0 | Apache-2.0 | Puts the rendered documents into the site bucket and reads the published manifest back. | The alternative is signing SigV4 requests by hand against the S3 REST API, which is about a hundred lines of well understood cryptography that cannot be tested against AWS from here. Hand rolled request signing that has never met the service it signs for is not a saving. The same SDK generation is already declared in `build/api`. |
| `@aws-sdk/client-cloudfront` | ^3.658.0 | Apache-2.0 | Creates and reads the invalidation for exactly the paths that changed. | Same argument. This is the only new AWS client this work introduces; the other two were already in the tree elsewhere. |
| `@aws-sdk/client-secrets-manager` | ^3.658.0 | Apache-2.0 | Reads the revalidation secret the dispatch signature is verified against, on a deployed stage. | Secrets come from a managed store and never from the repository, per the Architecture document, "Security and privacy". Already declared in `build/api` for the same purpose. |

## Development dependencies

**None.** The test suite is `node --test` and there is no compiler, bundler or test framework
in this package.

## The container image

**Added Friday 4 September 2026, with the decision about where the render runs.** The
pipeline is a small always on container on Fargate. That is not a new npm dependency, but it
is new background IP and it has to be on this list: an image is software Trevean will run,
and it contains code neither of us wrote.

| Component | Version | Licence | Why it is here |
|---|---|---|---|
| `node` official image, `22-bookworm-slim` variant | 22.x on Debian 12 | The Node.js runtime is **MIT**. The image's own Dockerfiles are **MIT**. The Debian userland inside it is **a mixture, including GPL-2.0, GPL-3.0 and LGPL** | The render is `next build` as a child process, so the image has to carry a Node runtime and npm. Distroless was considered and does not work: the build needs npm and a shell. |
| `tini` | Debian package, 0.19.x | **MIT** | PID 1 in this container spawns npm which spawns next. Without an init that reaps children, every publish leaves a zombie. |
| `ca-certificates` | Debian package | **MPL-2.0** for the Mozilla CA bundle, public domain for the packaging | The render reads the content API over HTTPS. Without it every publish fails on certificate verification. |
| Everything else in the base layer | Debian 12 | Mixture, including copyleft | Not chosen, inherited. It is the operating system. |

**What the copyleft actually obliges, stated plainly rather than left to be discovered.** GPL
and LGPL obligations attach to *distribution*. Building this image and running it in
Trevean's own AWS account is not distribution, and no obligation arises. If Trevean ever
hands the image itself to a third party, the obligation is the ordinary Debian one: an offer
of source for the GPL licensed packages, which Debian satisfies through its own archives.
Nothing in `build/publisher`, `build/web` or `build/content` links against, statically
includes, or derives from any of it. The application is a Node process that the operating
system happens to start.

**No base image avoids this.** Alpine's busybox is GPL-2.0, Ubuntu and Debian are the same
mixture, and the distroless images that do avoid it do not carry npm, which the render needs.
Recorded so that "swap the base image" does not get proposed as the fix.

**Everything else in the image is already on this list.** `build/web`'s dependency tree has
its own manifest in that package and is unchanged by this; the three AWS SDK clients above
are installed the same way they are on a laptop; and the layout inside the image mirrors the
repository so that nothing had to be re-pathed and no build step was added.

## Every installed package, enumerated

Generated from `node_modules` by `node scripts/licenses.mjs`. `licenses.json` alongside this
file carries the same list in machine readable form, and `node scripts/licenses.mjs --check`
fails if either has drifted from what is installed.

<!-- BEGIN GENERATED PACKAGE LIST. Do not edit by hand: node scripts/licenses.mjs rewrites it. -->

**28 installed package and version pairs, and every one of them is listed below.** This
section is generated from `node_modules` by `node scripts/licenses.mjs`, not typed, so it cannot
drift from what an install actually pulls in. The role column says whether a package is a declared
runtime dependency, a declared development dependency, or something one of those pulled in.

**Three totals, all true, stated together so they cannot look like a disagreement.** 28
package and version pairs, 28 distinct package names, 28 copies on disk. No package is installed at more than one version.

**The committed lockfile resolves 28 pairs**, which is the same set that is installed here.

| Licence, exactly as the package declares it | Pairs | Copyleft |
|---|---|---|
| `Apache-2.0` | 26 | no |
| `0BSD` | 1 | no |
| `MIT` | 1 | no |

**Nothing in this table falls outside the permissive set.** No GPL, no LGPL, no AGPL, no MPL, no source available and no commercial licence.

**No copyleft licence appears in this package, installed or resolved.**

| Package | Version | Licence | Role |
|---|---|---|---|
| `@aws-sdk/checksums` | 3.1000.29 | Apache-2.0 | transitive |
| `@aws-sdk/client-cloudfront` | 3.1127.0 | Apache-2.0 | runtime |
| `@aws-sdk/client-s3` | 3.1127.0 | Apache-2.0 | runtime |
| `@aws-sdk/client-secrets-manager` | 3.1127.0 | Apache-2.0 | runtime |
| `@aws-sdk/core` | 3.977.9 | Apache-2.0 | transitive |
| `@aws-sdk/credential-provider-env` | 3.972.70 | Apache-2.0 | transitive |
| `@aws-sdk/credential-provider-http` | 3.972.72 | Apache-2.0 | transitive |
| `@aws-sdk/credential-provider-ini` | 3.973.15 | Apache-2.0 | transitive |
| `@aws-sdk/credential-provider-login` | 3.972.77 | Apache-2.0 | transitive |
| `@aws-sdk/credential-provider-node` | 3.972.82 | Apache-2.0 | transitive |
| `@aws-sdk/credential-provider-process` | 3.972.70 | Apache-2.0 | transitive |
| `@aws-sdk/credential-provider-sso` | 3.973.14 | Apache-2.0 | transitive |
| `@aws-sdk/credential-provider-web-identity` | 3.972.76 | Apache-2.0 | transitive |
| `@aws-sdk/middleware-sdk-s3` | 3.972.75 | Apache-2.0 | transitive |
| `@aws-sdk/nested-clients` | 3.997.44 | Apache-2.0 | transitive |
| `@aws-sdk/signature-v4-multi-region` | 3.996.46 | Apache-2.0 | transitive |
| `@aws-sdk/token-providers` | 3.1116.0 | Apache-2.0 | transitive |
| `@aws-sdk/types` | 3.974.5 | Apache-2.0 | transitive |
| `@aws-sdk/xml-builder` | 3.972.40 | Apache-2.0 | transitive |
| `@aws/lambda-invoke-store` | 0.3.0 | Apache-2.0 | transitive |
| `@smithy/core` | 3.33.3 | Apache-2.0 | transitive |
| `@smithy/credential-provider-imds` | 4.5.2 | Apache-2.0 | transitive |
| `@smithy/fetch-http-handler` | 5.8.0 | Apache-2.0 | transitive |
| `@smithy/node-http-handler` | 4.12.1 | Apache-2.0 | transitive |
| `@smithy/signature-v4` | 5.7.3 | Apache-2.0 | transitive |
| `@smithy/types` | 4.18.0 | Apache-2.0 | transitive |
| `bowser` | 2.14.1 | MIT | transitive |
| `tslib` | 2.8.1 | 0BSD | transitive |

<!-- END GENERATED PACKAGE LIST -->
