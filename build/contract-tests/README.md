# API contract tests

**Component:** M2 deliverable, Trevean Spice tap-to-story MVP
**Prepared by:** Serene Labs Inc (Jacob Ralph) for Trevean Spice
**Enforces:** the frozen API contract and the OpenAPI 3.1 document delivered as M1 on 18 August 2026
**Gates:** SOW Rev C section 5, "API contract tests pass", at the M2 gate

---

## Why this exists

The API contract was frozen so that two engineers could build against it for seven weeks without
talking to each other. **A frozen contract with no executable enforcement is a document, not a
contract.** This suite is what makes the freeze real.

It is driven by the OpenAPI document rather than transcribed from it. Paths, methods, status codes,
request schemas, response schemas, security requirements and the `x-tap-path` extension are all read
at run time. Change the document and the tests change with it; change the implementation without the
document and the tests fail.

---

## Running it

```
npm install
npm run test:stub      # starts the stub, runs the whole suite against it, stops the stub
```

That needs no credentials, no network and no running API. It is the command CI runs on every push.

```
npm run stub           # start the stub on port 3001 and leave it running
npm test               # run the suite against CONTRACT_TEST_BASE_URL
npm run typecheck      # types only
```

Against a real host:

```
CONTRACT_TEST_BASE_URL=https://api.staging.treveanspice.com \
CONTRACT_TEST_TOKEN_ADMIN=... \
CONTRACT_TEST_TOKEN_EDITOR=... \
CONTRACT_TEST_TOKEN_VIEWER=... \
npm test
```

Against the real API being built in `build/api/`, which listens on port 3001 by default. Nothing in
this suite references that directory; it is reached by configuration alone, which is what lets the
same suite serve the stub, a local implementation, staging and production without a code change:

```
CONTRACT_TEST_BASE_URL=http://127.0.0.1:3001 \
CONTRACT_TEST_TOKEN_ADMIN=... CONTRACT_TEST_TOKEN_EDITOR=... CONTRACT_TEST_TOKEN_VIEWER=... \
npm test
```

Against production, read only:

```
CONTRACT_TEST_BASE_URL=https://api.treveanspice.com \
CONTRACT_TEST_ALLOW_WRITES=false \
npm test
```

**`CONTRACT_TEST_ALLOW_WRITES=false` is the production safety.** It skips everything that creates,
updates, publishes or archives. It does **not** skip the tests that assert an anonymous caller is
refused, because a request that is correctly refused changes nothing, and that is the check most
worth having against production.

Every setting is an environment variable and every one is documented with its default in
[`.env.example`](.env.example). Nothing about a target host appears anywhere else in the suite.

---

## What it covers

### Driven by the specification, in every call

`callOperation` is the only way a test reaches the API, and before the test asserts anything of its
own the call has already checked five things:

1. the request body against the declared request schema, so a fixture cannot drift from the contract,
2. that the observed status is one the operation declares, because changing a status code for an
   existing case is a v2 change under section 3 of the contract,
3. the response body against the schema declared for that exact status,
4. that `X-Request-Id` is present, per section 8.1,
5. that a status the document declares with no body returns no body.

A test that merely calls an endpoint therefore already enforces most of the contract for it.

### The things a schema check will not catch

**The tap path.** Exactly one operation is on it: `POST /v1/scan-events`, fired after paint. The
suite asserts that from the document (`x-tap-path`) and then asserts something the document cannot
express: that `navigator.sendBeacon` can actually make the call. See
[`src/tests/05-beacon-transport.ts`](src/tests/05-beacon-transport.ts). sendBeacon sends POST and
nothing else, sets no header except a `Content-Type` taken from the Blob type, cannot send
`Authorization` or any custom header, is cross origin here, and shares a budget of roughly 64 KB. The
suite sends a request carrying exactly those headers and nothing more, checks the CORS preflight, and
measures the body size. **An endpoint the beacon cannot legally call is a contract that fails only in
the field, on a customer's phone, with nothing in any log to say so.**

**Latency.** Measured, with the number printed alongside a note stating what it is for. The
under 200 ms p95 target protects publish to live and the admin experience. **It does not protect the
2.0 second tap budget, because the tap path does not call this API at all.** The pre-rendered page
served from the edge is what protects the tap budget. The two numbers sit near each other in SOW
section 6.2 and get conflated, so the note is printed with every result rather than left in a
document nobody opens. The measurement is taken from the test client, so it includes client network
time, which the contract excludes: it is an upper bound on the server side figure, and a pass here
means a pass there. The reverse does not follow, which is also printed.

**Authorisation.** Every operation the document marks as authenticated is probed individually,
anonymously, and with a junk bearer token. The operation list comes from the document, so adding an
admin endpoint to the specification automatically adds it to these tests. Insufficient role must be
403 rather than 404. **A write endpoint that quietly accepts anonymous callers is the single worst
thing this suite could miss, so no sampling.**

**The five real slugs and the tag code map.** [`src/fixtures.ts`](src/fixtures.ts) writes out the
five slugs, the four encoded codes plus the reserved fifth, the request and target paths, the unit
counts and the 1,000 tag total, deliberately by hand rather than reading them from the document. The
suite then asserts that the document's `Slug` and `TagCode` enums, the document's worked examples,
and the live `GET /v1/admin/tags` all agree with it. **A renamed slug or a repointed code fails
here, which is the only place it can be caught before it strands inventory.**

### Coverage of the document

The final suite asserts that every operation in the document was exercised, and that every declared
status code was either observed or accounted for. Statuses that no contract test may provoke on a
shared host (429 from the CDN and WAF layer, 500, 502, 503, 504) are listed as such. Statuses that
nothing can currently reach are listed with the reason. The list is in
[`src/coverage.ts`](src/coverage.ts) and the assertion is that nothing falls outside it.

---

## Observed result, 17 August 2026, against the stub

```
tests 202
pass  200
fail  2

Operations exercised:            25 of 25
Declared status codes observed:  87 of 128
  34 not provoked by design (429, 500, 502 across the operations that declare them)
   7 structurally unreachable as the frozen document stands, listed with reasons
   0 unaccounted for
```

**Both failures are defects in the frozen OpenAPI document, not in any implementation.** They are
listed below. The suite is red until they are fixed, which is the suite doing its job on its first
run rather than a problem with the suite.

## Observed result, Thursday 27 August 2026, against the stub

```
tests 202
pass  202
fail  0

Operations exercised:            25 of 25
Declared status codes observed:  87 of 128
  34 not provoked by design (429, 500, 502 across the operations that declare them)
   7 structurally unreachable as the frozen document stands, listed with reasons
   0 unaccounted for
```

**Both defects are closed and no test was weakened to close them.** Finding 1 was corrected on
17 August. Finding 2, the `pageVersion` bound, was corrected on 27 August under change control and is
recorded in section 15 of the contract errata. The assertions are unchanged from the day they were
written; the document moved to meet them.

---

## Findings against the frozen contract

Raised for the change control process in section 11 of the frozen API contract. Every one of these is
additive or documentation only, so all are allowed inside v1 under the table in section 3. None is a
schedule event.

### 1. Three worked examples violate their own declared patterns. FAILING TEST.

The ULID pattern `^[0-9A-HJKMNP-TV-Z]{26}$` is Crockford base 32: it excludes `I`, `L`, `O` and `U`.
Three example identifiers in the document contain `L`.

| Location | Value | Fix |
|---|---|---|
| `GET /v1/blends/{slug}` 200, example `persianSunriseFull` | `rcp_01J9Z91B2C3D4E5F6G7H8J9K0L` | `rcp_01J9Z91B2C3D4E5F6G7H8J9K0M` |
| `GET /v1/blends/{slug}/recipes` 200, example `caribbeanSunset` | `rcp_01J9Z92C3D4E5F6G7H8J9K0L1M` | `rcp_01J9Z92C3D4E5F6G7H8J9K0M1N` |
| `POST /v1/admin/blends/{slug}/publish` 202, example `published` | `rvl_01J9Z95D6E7F8G9H0J1K2L3M4N` | `rvl_01J9Z95D6E7F8G9H0J1K2M3N4P` |
| `components/parameters/RecipeId` schema example | `rcp_01J9Z91B2C3D4E5F6G7H8J9K0L` | as above |

Why it matters rather than being a typo: the examples are what an engineer copies when writing a
client, what a reviewer reads instead of the schema, and what a mock server is seeded from. The stub
in this directory was seeded from them and failed its own contract until they were corrected here.
Documentation only, no wire change.

### 2. `ScanEventInput.pageVersion` is unbounded above. CLOSED Thursday 27 August 2026.

Section 5.2 says every beacon field is "an enum, a bounded string matching a documented pattern, or a
number in a documented range". `pageVersion` declared `minimum: 1` and no maximum, on an endpoint
that takes no credential. `ttfbMs` and `timeToReadableMs` are bounded at both ends.

**Closed.** The document now declares `maximum: 2147483647` on `pageVersion`, and `bounds every
number field at both ends` passes. The suite is 202 of 202 against the stub.

The bound is not the `1000000` originally proposed here. It is derived from the producer instead:
`Blend.version` starts at 1 and is incremented by exactly one per accepted admin write, and section 9
of the frozen contract caps admin writes at 300 per minute per subject, which is 1576800000 over ten
years of continuous saturation. 2147483647 sits above that and is also the largest signed 32 bit
integer, so every accepted value is representable without loss all the way to the stored attribute.
That last property is the one that matters: before the change, `pageVersion: 1e308` passed validation,
because a double that large is an integer as far as JSON Schema is concerned, and produced a 500 from
an unauthenticated endpoint on the tap path.

Classified breaking under section 8.2 of the contract errata, taken deliberately under change control
while nothing has shipped against the frozen version, and recorded in section 15 of that document.

### 3. CORS is not documented anywhere in the contract, and the beacon needs it. DECISION REQUIRED.

The blend page is served from `treveanspice.com`. The API is on `api.treveanspice.com`. The beacon is
therefore a cross origin request, and `application/json` is not a CORS safelisted content type, so the
browser sends a preflight `OPTIONS` first and **silently drops the beacon if that preflight does not
succeed**. The OpenAPI document declares no `OPTIONS` operation, no CORS response headers and no
allowed origin list.

This suite asserts the preflight works, because an implementation that satisfies the document exactly
and omits CORS produces zero scan events in the field with no error anywhere. Two ways to close it:

- **Recommended: document CORS and keep `application/json`.** Add an allowed origin list, an
  `OPTIONS` response and `Access-Control-Allow-Origin` on the beacon response, to the OpenAPI
  document as an additive change. Costs one preflight per origin per browser, cached for the
  `Access-Control-Max-Age` window, and it is not on the tap path anyway because the beacon fires
  after paint.
- **Alternative: send the beacon as `text/plain;charset=UTF-8`.** That content type is CORS
  safelisted, so no preflight happens at all. It means the server parses a JSON body arriving under a
  text content type, which is a wart, and it changes section 8.1. Worth having on the table only if
  the preflight turns out to be unacceptable for some reason none of us has thought of.

**This is for Dan and both engineers.** It is the one finding here that changes behaviour rather than
documentation.

### 4. `POST /v1/admin/blends` can never return 201. OBSERVATION.

`BlendCreate.slug` references the `Slug` enum, which is closed to the five blends that already exist.
Creating a blend can therefore only ever answer 409 `SLUG_TAKEN`. The same closure makes the declared
404 on `POST /v1/admin/recipes` unreachable, because a blend that does not exist cannot be named in a
valid request.

That may be exactly right for this engagement: five blends is the scope and a closed enum is a strong
guard against a slug that no tag resolves to. If so, the create operation is dead code for the
duration and could be marked `deprecated: true` rather than left looking usable. If a sixth blend is
expected before handoff, the enum has to open and that is a v2 change, which is a schedule event.
**Worth deciding on purpose rather than discovering in M4.**

### 5. `POST /v1/admin/blends/{slug}/publish` accepts a body but declares no 400. OBSERVATION.

Every other operation with a request body declares 400. This one declares 202, 401, 403, 404, 409,
422 and 500. A malformed publish body has no documented answer. Proposed fix: add 400 to the declared
responses. Additive, allowed in v1.

### 6. 403 is declared on five operations whose minimum role is Viewer. OBSERVATION.

Viewer is the lowest of the three roles, so no authenticated caller sits below it and 403 cannot
occur on `adminListBlends`, `adminGetBlend`, `adminListMedia`, `adminGetMedia` or
`adminGetScanTimeSeries`. Harmless, and arguably correct as future proofing if a fourth role below
Viewer is ever added. Recorded so the coverage number is honest rather than looking like a gap in the
tests.

---

## The stub

[`src/stub/`](src/stub/) is an in memory implementation of the whole contract. It exists so this
suite is demonstrably correct today, before the real API is written, and so CI has something to run
against on every push with no credentials and no network.

Its routing table is **built from the OpenAPI document**, so it cannot answer a path the contract
does not define and cannot silently miss one it does. `npm run test:stub` refuses to start if the
document declares an operation the stub has no handler for.

It validates request bodies using the same OpenAPI document the tests validate against. That is what
a real implementation should also do, and it means these tests prove the contract is self consistent
and implementable rather than that two independent implementations happen to agree. The checks that
are genuinely independent of the stub are the specification integrity suite, the fixtures, and the
beacon transport suite.

**The stub has no persistence, no real authentication and no rate limiting, and must never be
deployed anywhere.** Its tokens are `stub-admin-token`, `stub-editor-token`, `stub-viewer-token` and
`stub-expired-token`.

---

## Adopting this into `nfc-development`

We do not have access to the client repository, so this is written as instructions rather than as a
pull request.

**1. Copy the directory.** Everything in `build/contract-tests/` goes to `contract-tests/` at the
root of `nfc-development`, or wherever the repository keeps test packages. It is self contained: one
`package.json`, one `tsconfig.json`, no workspace assumptions, no path references outside itself
except the one below.

**2. Point it at the OpenAPI document in that repository.** The only outward path reference is the
default value of `CONTRACT_TEST_SPEC_PATH` in [`src/config.ts`](src/config.ts), which currently
resolves to `deliverables/m1/01-api-contract.openapi.yaml` two directories up. Change that default
to wherever `nfc-development` keeps the specification, and **check the specification into that
repository**, because from that point it is the artifact the change control process in section 11
operates on.

**3. Copy the workflow.** [`.github/workflows/contract-tests.yml`](../../.github/workflows/contract-tests.yml)
in this repository is the live version. Two changes when it moves:

```diff
 defaults:
   run:
-    working-directory: build/contract-tests
+    working-directory: contract-tests
...
-          cache-dependency-path: build/contract-tests/package-lock.json
+          cache-dependency-path: contract-tests/package-lock.json
```

**4. Add the repository secrets.** `CONTRACT_TEST_TOKEN_ADMIN`, `CONTRACT_TEST_TOKEN_EDITOR` and
`CONTRACT_TEST_TOKEN_VIEWER`, in a `staging` and a `production` GitHub environment. The stub job
needs none of them, so contract testing works on a fork and on a first party pull request before any
secret exists.

**5. Make the stub job a required status check on the default branch.** That is the mechanism by
which "API contract tests pass" stops being a thing someone remembers to run.

**6. Add the specification to the same required check.** A pull request that edits the OpenAPI
document runs this suite against the stub, which validates the document against itself. That is the
step in section 11 that says "contract tests regenerate and pass before merge".

---

## Layout

```
src/
  config.ts          every environment variable, with defaults, in one place
  spec.ts            loads the OpenAPI document, builds the operation inventory
  specExamples.ts    validates the worked examples against the schemas beside them
  validator.ts       ajv against the OpenAPI schemas directly, no duplication
  client.ts          the only way a test reaches the API, plus the five automatic checks
  coverage.ts        what was exercised, and what was not and why
  discovery.ts       finds real identifiers on the target so the suite is portable
  fixtures.ts        the five slugs, the tag code map, and the beacon body
  tests/
    01-spec-integrity.ts   the document against itself and against the engagement
    02-content.ts          public content reads
    03-catalog.ts          the Shopify mirror, and why a failure of it is survivable
    04-scan-beacon.ts      beacon semantics
    05-beacon-transport.ts whether sendBeacon can actually call it
    06-auth.ts             every authenticated operation, probed individually
    07-admin-content.ts    blends, recipes, growers, optimistic concurrency
    08-admin-media.ts      presigned upload, 415 and 413 before 400
    09-admin-publishing.ts publish and revalidate
    10-admin-analytics.ts  rollups only, and the measurement note
    11-admin-tags.ts       the deployed redirect table against the tag code map
    12-error-envelope.ts   one shape at every status, requestId matching the header
    13-conventions.ts      wire format and caching
    14-latency.ts          measured, with the note about what it protects
    99-coverage.ts         runs last, asserts the whole document was exercised
  stub/                    the in memory implementation
  scripts/                 start stub, run suite, stop stub
```

Dependencies and their licences are in [`MANIFEST.md`](MANIFEST.md).
