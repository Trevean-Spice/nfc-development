# Trevean Spice tap-to-story REST API

Node and TypeScript. DynamoDB. Implements the frozen M1 API contract, version 1.0.0, and
the key schema and indexes in the companion Data model document.

This directory is self contained and portable: it carries its own copy of the frozen
OpenAPI document, its own local development stack, and its own tests. It can be moved into
the client's `nfc-development` repository as a directory, or reconciled against whatever
the audit finds there.

---

## The one rule

**Exactly one operation is on the tap critical path: `POST /v1/scan-events`, and it fires
after the page is readable, as a browser beacon.**

Every content operation (blends, recipes, growers) is called at **build time and revalidate
time only**, by the build process and the publish pipeline. They are never called when a
customer taps a jar. The blend page is pre-rendered and served from the CDN edge cache, so
on a tap the sequence is: 307 at the edge, cached HTML from the edge, paint, then a beacon.

An engineer who wires the blend page to fetch `/v1/blends/{slug}` on load will produce a
page that works perfectly in development, passes review, and then adds a DNS lookup, a TLS
handshake to a second host, a cold start and a database read to a 2.0 second budget that
has roughly 400 ms of headroom on cellular. It will fail in a customer's kitchen on the
first tap of the morning, which is the exact case a lab test never catches.

### On the <200 ms p95 figure

**It protects publish-to-live and the admin experience. It is not what protects the 2.0
second tap budget.** The pre-rendered page protects the tap budget. The two numbers sit
near each other in SOW section 6.2 and get conflated, so it is stated here, in the code
comments on the caching module, and in the latency test itself.

Observed locally, in process against a DynamoDB compatible server, for the full build time
payload (`GET /v1/blends/persian-sunrise?include=grower,recipes`), across four runs on
17 August 2026: **p50 15.7 to 19.1 ms, p95 22.1 to 46.6 ms**, 60 samples per run. The test
prints the numbers on every run and fails above 200 ms.

That is a regression guard on the shape of the work the handler does, not a measurement
against AWS. It excludes network, cold starts and real DynamoDB, so it is a floor rather
than a forecast. The number that counts gets measured against the Trevean account once
access lands.

---

## Running it with no AWS account

We do not have AWS access yet, so the whole thing runs locally, and the test suite needs
neither AWS nor Docker.

```bash
npm install
npm run local:up      # in process DynamoDB, five tables, seeded, API on :3001
```

Then:

```bash
curl localhost:3001/v1/blends
curl "localhost:3001/v1/blends/persian-sunrise?include=grower,recipes"
curl -X POST localhost:3001/v1/scan-events -H 'content-type: application/json' \
  -d '{"blendSlug":"persian-sunrise","tagCode":"ps","channel":"nfc","dedupToken":"9f2c41a7b6e04d8fa3c5d17e8b0f6a24","occurredAt":"2026-08-17T09:41:07Z"}'
```

### Against DynamoDB Local in Docker, which is closer to the real thing

```bash
docker compose up -d dynamodb
cp .env.example .env.local && set -a && . ./.env.local && set +a
npm run local:tables
npm run local:seed
npm run dev
```

Nothing in `src/` changes between the two. The only difference is what `DYNAMODB_ENDPOINT`
points at, which is also how this runs against the Trevean account: unset it.

### Admin endpoints locally

There is no identity provider on a laptop, so local and test stages accept a symmetric
development token. That path is refused outright when `STAGE` is production, in
`src/auth/jwt.ts`, not by configuration convention. Mint one the way the tests do, with
`test/helpers/harness.ts`.

```bash
npm test              # everything
npm run test:unit
npm run test:integration
npm run typecheck
```

---

## What is implemented

Every path and operation in the frozen OpenAPI document.

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/blends` | Access pattern 2. Published only without a credential. |
| GET | `/v1/blends/{slug}` | Access pattern 1. `?include=grower,recipes`. ETag and 304. |
| GET | `/v1/blends/{slug}/recipes` | Access pattern 3. One Query, carousel order. |
| GET | `/v1/recipes/{recipeId}` | Via the `recipeId-index`. |
| GET | `/v1/growers`, `/v1/growers/{growerId}` | Access pattern 4. |
| GET | `/v1/catalog/{slug}` | Access pattern 8. Optional after-paint refresh, degradable. |
| POST | `/v1/scan-events` | Access pattern 5. **The tap path.** One conditional write. |
| GET, POST | `/v1/admin/blends` | Viewer, Editor. |
| GET, PATCH | `/v1/admin/blends/{slug}` | Viewer, Editor. Optimistic concurrency. |
| POST | `/v1/admin/blends/{slug}/publish` | Editor. 202, snapshot, revalidation queued. |
| POST | `/v1/admin/revalidate` | Editor. The manual escape hatch. |
| POST, PATCH, DELETE | `/v1/admin/recipes...` | Editor. Delete is a soft archive. |
| POST, PATCH | `/v1/admin/growers...` | Editor. Returns `republishRequiredFor`. |
| GET, POST | `/v1/admin/media`, `/v1/admin/media/uploads` | Viewer, Editor. Presigned S3 PUT. |
| GET, POST | `/v1/admin/media/{mediaId}`, `.../complete` | Viewer, Editor. 202, async derivatives. |
| GET | `/v1/admin/analytics/scans` | Viewer. Rollups only, never raw events. |
| GET | `/v1/admin/tags` | Admin. Read only, for every role including Admin. |

Plus, outside the frozen `/v1` surface and by design:

| Method | Path | Notes |
|---|---|---|
| POST | `/internal/webhooks/shopify/products-update` | HMAC verified. Updates the catalog mirror. |
| POST | `/internal/webhooks/shopify/orders-create` | HMAC verified. Reorder attribution, per SKU. |
| GET | `/health` | Liveness. |

The API contract, section 5.4, classifies the Shopify sync and the order webhook consumer
as internal services rather than API clients, and the frozen document therefore does not
describe them. Putting them under `/v1` would add endpoints to the public contract that no
client calls.

---

## How it is put together

```
src/
  app.ts                 Fastify wiring, error envelope, content type parsing
  index.ts               local and container entry point
  lambda.ts              AWS Lambda entry point
  auth/                  bearer JWT verification, three roles
  config/                configuration, and secrets from a managed store
  db/                    client, key builders, table definitions, seed
  http/                  errors, validation compiled from the contract, caching, paging
  observability/         structured logging with a redaction rule that is not optional
  repositories/          one file per access pattern group, no Scan anywhere
  routes/                one file per contract tag
  services/              redirect table, geography, publishing, analytics, mappers
  stream/                THE EVENT SOURCE MAPPING FILTER, and the rollup consumer
  util/                  ULID, ids, time and the deduplication window
config/
  redirect-table.json    the version controlled redirect table
  stream-filter.json     the filter, for the infrastructure deliverable to apply
  iam-least-privilege.json  the exact actions this code calls, and what is not granted
openapi/                 a byte identical copy of the frozen contract, loaded at startup
```

### Validation is compiled from the contract, not retyped

`src/http/validation.ts` loads `openapi/openapi.yaml` and compiles its schemas with Ajv. A
request body is validated against the same JSON pointer the contract test suite reads. This
is deliberate: a contract frozen for seven weeks, with validation hand written in
TypeScript beside it, drifts silently. Validation compiled from the document cannot.

The same mechanism validates responses inside the test suite, so a response that drifts
from the contract fails here rather than in the other engineer's suite.

### The stream filter, which is the thing most likely to be dropped

Rollup items live in `ScanEvents` under the `ROLLUP#` namespace, so **rollup writes appear
in the same stream that triggers the consumer that produced them.** Without a filter that
is an infinite loop that bills for itself.

The filter is `eventName = INSERT` **and** `pk` beginning with `EVT#`. Both halves are load
bearing:

- INSERT only: a rollup increment is a MODIFY, a TTL expiry is a REMOVE, both excluded.
- The `EVT#` prefix: **the first rollup write of a new day is an INSERT, not a MODIFY.**
  Filtering on the event name alone would let that through, once per blend per day, and
  start the loop.

It lives in `src/stream/filter.ts`, is exported for the infrastructure deliverable as
`config/stream-filter.json` with a test asserting the two match, and **the consumer applies
the same rule again in process**, so a mapping deployed without its filter still cannot
start the loop. `test/unit/streamFilter.test.ts` and the loop-prevention case in
`test/integration/rollups.test.ts` are the proof.

### Access patterns and cost

| # | Pattern | Implementation | On the tap path |
|---|---|---|---|
| 1 | Blend by slug with grower and recipes | GetItem plus a parallel Query and GetItem | No |
| 2 | List blends by status | Query on `status-updatedAt-index` | No |
| 3 | Recipes for a blend | One Query, padded sort key gives carousel order | No |
| 4 | Grower for a blend | One GetItem | No |
| 5 | Write a scan event | **One conditional PutItem. Zero reads.** | **Yes, after paint** |
| 6 | Rollup counters | Stream triggered, batched, atomic ADD | No |
| 7 | Dashboard time series | One Query per series on a rollup partition | No |
| 8 | Catalog mirror read | One GetItem, mostly absorbed by a 60 second CDN cache | After paint, optional |

**There is no `Scan` in application code.** The only Scan in this package is in
`test/helpers/harness.ts`, to truncate tables between test files.

---

## Security and privacy

- **No IP address is stored, logged or read.** Geography comes from CDN viewer headers only,
  to country, region and city. The logger redacts `x-forwarded-for`,
  `cloudfront-viewer-address`, `user-agent`, `authorization`, `cookie` and `email` by leaf
  key name, and a unit test asserts it.
- **No PII and no customer accounts.** There is no customer credential surface at all.
- **No per-tag identifier and no chip UID.** Attribution is per SKU because the 1,000
  shipped tags were encoded per SKU before this engagement began. Deduplication uses a
  browser generated token, the same mechanism the QR path uses, and every analytics response
  says so in `measurementMethod`.
- **Secrets come from a managed store**, never the repository. The environment variable path
  exists for local development and is refused when `STAGE` is production.
- **Signature verification on every inbound webhook**, over the raw body, with a constant
  time comparison, before any processing.
- **Least privilege**: `config/iam-least-privilege.json` lists the exact actions the code
  calls, and what is deliberately not granted, including `dynamodb:Scan` on any table.
- **Rate limits are enforced at the CDN and WAF**, per the API contract section 9, so a flood
  never reaches a function.

### The three authorisation zones

| Zone | Posture |
|---|---|
| Public content reads | Unauthenticated. Every byte is already public in the rendered page, and only `published` content is served without a credential. |
| The scan beacon | Unauthenticated by necessity: a browser beacon cannot hold a secret. Constrained by shape instead. Every field is an enum, a bounded string or a number in a range, `additionalProperties` is false, and `Origin` is recorded rather than trusted. |
| Admin | Bearer JWT, validated on signature, issuer, audience and expiry, with Viewer, Editor and Admin roles. Insufficient role is 403, not 404. |

---

## Deploying

### Building the package

```bash
npm run package:lambda        # writes .lambda-build/api.zip and prints its sha256
```

`scripts/package-lambda.mjs` compiles, installs the production dependency tree from the
lock file with `npm ci --omit=dev`, and writes a deterministic archive: fixed timestamps, so
the same inputs give the same bytes and the same hash. That is what lets "is the deployed
package the one I built" be answered by comparing the printed sha256 against the
`CodeSha256` AWS reports, instead of by trusting a deployment log.

`index.mjs` at the archive root exports **both** entry points, `handler` for the API and
`streamHandler` for the rollup consumer, because the infrastructure sets
`handler = "index.handler"` on every function and one package for both is one build to keep
in step instead of two.

**Terraform does not deploy this.** Every function in `build/infrastructure` carries
`ignore_changes` on `filename` and `source_code_hash` on purpose, so the package goes up
with `aws lambda update-function-code`. Terraform owns identity, permissions and wiring; the
application pipeline owns code.

### The two handlers

- `src/lambda.ts` for the API, behind API Gateway or a function URL, fronted by CloudFront.
  **As deployed it is a Lambda function URL with `AWS_IAM` authorisation**, invoked only by
  CloudFront through an origin access control, with `/v1/scan-events` and `/v1/*` as two
  ordered behaviours on the same distribution that serves the blend pages. Same origin is
  the point: it is what means the beacon's POST raises no CORS preflight on the tap path.
  The argument for a function URL over API Gateway is in `build/infrastructure`, in
  `modules/compute/main.tf`.
- `src/lambda.ts` again, deployed a second time to the scan function. Same package, a
  different role: that function may `PutItem` an `EVT#` item into `ScanEvents` and may do
  nothing else, and the content function may read three tables and write nothing. Which
  routes each is asked to serve is a CloudFront behaviour; which routes each can complete is
  IAM.
- `src/stream/consumer.ts` for the rollup consumer, on the `ScanEvents` stream, with the
  filter in `config/stream-filter.json`, batch size 500, a 5 second window, and
  **bisect on error disabled** with failures going to a dead letter queue.

Table definitions are in `src/db/schema.ts` so a local stack and the AWS account are
provably the same shape. **The production tables belong to the infrastructure deliverable**,
which owns on-demand capacity, point in time recovery, TTL on `expiresAt` and the stream.
`npm run local:tables` refuses to run against a real account without an explicit override.

Alarms to set, per the Architecture document, "Measurement": stream iterator age, consumer
error rate, dead letter queue depth, DynamoDB throttling, API error rate, and the CDN cache
hit ratio, which is the earliest warning that something broke the rendering strategy.

---

## Things the audit has to reconcile

This was built against the frozen documents, not against the client's existing scaffold,
which we have not seen. Where the real tables differ, these are the seams:

1. **`SpiceBlends` key names and whether a sort key exists.** Everything goes through
   `src/db/keys.ts`. A partition-key-only table moves published snapshots to their own
   namespace and changes nothing else.
2. **Whether `SpiceBlends` is keyed on the slug or a synthetic id.** `slug-index` is already
   in the table definition for that case. Pattern 1 must never need a Scan to turn a slug
   into an id.
3. **`Recipes` key schema.** Built as `blendSlug` plus a padded sort key with a
   `recipeId-index`. If the real table is keyed on `recipeId` alone, the requirement
   inverts to a `blendSlug-sortOrder-index` and `listRecipesForBlend` changes to query it.
4. **Whether the existing scaffold exposes routes under a different prefix.** Every route is
   declared with its full path, so a prefix change is one edit per file.
5. **Media records.** The Data model document does not say where they live. They are in
   `SpiceBlends` under `MEDIA#`, listed through an `entity-createdAt-index` GSI. That index
   is an addition and is flagged, not assumed.

---

## Related documents

Cross-references are by document title and section number, never by filename.

- The frozen API contract, sections 1, 2, 4, 5, 6, 7, 8 and 10
- The Data model document, sections 3, 4, 5 and 7
- The Architecture document, "The tap path", "Data layer", "Scan tracking", "Security and
  privacy", "Measurement"
- The Acceptance criteria document, section 6.2
- The Scope document, "In scope" and "IP and handoff"
