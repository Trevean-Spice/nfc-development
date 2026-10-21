# API reference

**M5 handoff deliverable. Written Saturday 22 August 2026. Section 8 revised Tuesday 25 August 2026.**
**Verified against:** the frozen OpenAPI 3.1 document, contract version 1.0.0, frozen Wednesday 19 August 2026 under the tag `contract-v1.0.0-frozen`.
**Status of the implementation it describes:** the API package passes 144 tests and the contract suite passes 202 of 202 with no failures, both observed on Thursday 27 August 2026. **Both counts moved that day, from 125 and from 201 of 202, when the `pageVersion` bound was applied to the frozen contract and item 1 of section 8 below was closed.** **Both suites run against an in process database on a developer machine. The API has never been deployed or run against real DynamoDB**, so every latency, cold start and concurrency statement in this package is modelled rather than measured.

---

## 1. How this document cannot drift

Every operation table below was **extracted from the frozen OpenAPI document by machine**, not retyped. The counts are the counts in the document as it stands today:

| | |
|---|---|
| Paths | **22** |
| Operations | **25** |
| Schemas | **41** |
| Internal `$ref` values | 257, all local, all resolving. No external references. |

If any of those numbers disagrees with what you get from the document in your repository, **the document is right and this file is stale**. Regenerate this table rather than editing it by hand. That is the same rule the implementation follows: the API's request validation is compiled from the OpenAPI document at startup rather than hand written in TypeScript beside it, so validation and specification cannot diverge, and the contract test suite reads its expectations out of the document too.

Where the frozen prose contract and the OpenAPI document disagree, **the OpenAPI document governs the wire format and the prose governs the intent.**

---

## 2. The one sentence that matters more than the rest of this document

**Exactly one operation is on the tap critical path: `POST /v1/scan-events`, and it fires after the page is readable, as a browser beacon. Nothing else a customer's phone does between navigation start and page readable touches this API at all.**

Every content operation, blends, recipes, growers, is called at **build time and revalidate time**, by the build process and the publish pipeline. They are never called when a customer taps a jar. The blend page is pre rendered and served from the edge cache, so on a tap the sequence is: 307 at the edge, cached HTML from the edge, paint, then a beacon.

**Why this needs saying in bold rather than being obvious.** An engineer who wires the blend page to fetch `/v1/blends/{slug}` on load produces a page that works perfectly in development, passes review, and then adds a DNS lookup, a TLS handshake to a second host, a possible cold start and a database read to a 2.0 second budget with roughly 400 ms of headroom on cellular. It fails in a customer's kitchen on the first tap of the morning, which is the exact case a lab test never catches. The document titled "Architecture and the reasoning behind it", section 2, rule 1, is the same statement from the other end.

**A pleasant consequence for whoever operates this:** the content endpoints serve tens of requests per day, not tens of thousands. They are on the editorial path, not the consumer path.

---

## 3. The tap path discipline

Binding on anyone working on the consumer page, and enforced rather than remembered.

### 3.1 What must never be added to the blend page

- **No content fetch on load**, client side or server side.
- **No third party script before the page is readable.** Not analytics, not a tag manager, not a pixel, not chat.
- **No authentication, session or consent call.** There are no customer accounts and no cookies on the tap path.
- **No geolocation permission prompt.** Geography comes from CDN viewer headers, server side.
- **No font, stylesheet or image from a third party host.** A third party font host is forbidden outright, not budgeted.

### 3.2 The five rules the page package holds, and how they are checked

The consumer package's `npm run verify` checks all five, across **204 checks** against the built files and against a live server serving them, observed Thursday 27 August 2026. **This figure was 178 in the 22 August draft of this document and the suite has grown since; 204 is the observed number and is the one the rest of the delivery record carries.**

1. **No page fetches the API on load.** Content is baked in at build time. The only after paint network calls are the scan beacon and the optional catalog price refresh, and the page is complete and correct without either.
2. **No JavaScript before readable.** The only script in the document is a 172 byte inline loader that registers one `load` listener. The framework's client runtime, about 97 KB of hydration plus a copy of every prop as inline JSON, is removed from the export by a post build step, which then asserts that no `<script src>`, no framework path reference and no serialised props survive.
3. **The beacon fires after paint and cannot block.** One JSON document handed to `navigator.sendBeacon`, so the browser owns delivery and it survives an immediate navigation away.
4. **The service worker never touches the first navigation.** Registered after `load`, so it is not even installed on the tap that matters. Once installed it is network first for navigations with the cache only as a fallback, so a customer can never be shown a stale story after a publish.
5. **One priority image, everything else lazy.** Exactly one `fetchpriority="high"` per page, on the hero, never `loading="lazy"`, always with explicit width and height.

### 3.3 The CI gate

A per page byte and request budget runs in CI from M2 to handoff. **150 KB and 5 requests before readable, 1,000 KB and 35 requests in total, at 375 px and 428 px, three runs each, median taken.** A commit that exceeds it fails the build and does not merge. A pull request that adds anything in section 3.1 to the blend page route fails it.

**What CI certifies and what it does not.** CI certifies the byte and request budget on the real tap path including the 307, a Lighthouse performance score at or above 90, no render blocking resources, no unsized images, no third party request before readable, and no third party font host. **CI does not certify the 2.0 seconds.** Lighthouse throttling is a simulation on a datacentre CPU, not an iPhone XS in a kitchen on a loaded cell. The 2.0 s is measured on real handsets by the measurement harness, run by Trevean staff on Trevean materials. **A green build and a passed gate are two different claims and they are kept separate in every report.**

### 3.4 On the under 200 ms figure, which gets conflated with the 2.0 seconds

**The under 200 ms p95 content retrieval target protects publish to live and the admin experience. It is not what protects the tap budget.** The pre rendered page protects the tap budget. The two numbers sit near each other in the same section of the SOW and are constantly conflated, so it is stated here, in the code comments on the caching module, and printed alongside every latency test result.

Observed locally, in process against a DynamoDB compatible server, for the full build time payload, across four runs on 17 August 2026: **p50 15.7 to 19.1 ms, p95 22.1 to 46.6 ms**, 60 samples per run. That is a regression guard on the shape of the work the handler does, not a measurement against AWS. It excludes network, cold starts and real DynamoDB. **It is a floor, not a forecast**, and the number that counts has not been measured because nothing is deployed.

---

## 4. Every operation, extracted from the frozen document

`x-tap-path` and `x-minimum-role` are extensions carried on each operation in the document itself, so the classification below is the document's own rather than this author's opinion. The contract test suite asserts against the same extensions.

### 4.1 Public content. Build and revalidate time only. Not on the tap path.

Unauthenticated, because every byte these return is already public in the rendered page. Adding a secret to the build process would protect nothing and would put a credential into a CI environment for no gain. **Only `published` content is served without a credential**; drafts and archived items return 404 to an unauthenticated caller.

| Method | Path | `operationId` | Called at | Tap path |
|---|---|---|---|---|
| GET | `/v1/blends` | `listBlends` | build, revalidate, admin page load | false |
| GET | `/v1/blends/{slug}` | `getBlendBySlug` | build, revalidate | false |
| GET | `/v1/blends/{slug}/recipes` | `listRecipesForBlend` | build, revalidate | false |
| GET | `/v1/recipes/{recipeId}` | `getRecipe` | build, admin | false |
| GET | `/v1/growers` | `listGrowers` | build, admin | false |
| GET | `/v1/growers/{growerId}` | `getGrower` | build, revalidate | false |

`GET /v1/blends/{slug}?include=grower,recipes` returns the entire payload the blend page needs in one call, which is exactly what the build process asks for. **The grower record is snapshotted into the generated page**, so editing a grower does not change any page already built; the grower update operation returns `republishRequiredFor` so the CMS can prompt rather than leaving an editor to remember.

### 4.2 The catalog mirror. After paint, optional, degradable.

| Method | Path | `operationId` | Called at | Tap path |
|---|---|---|---|---|
| GET | `/v1/catalog/{slug}` | `getCatalogEntry` | build, revalidate, optional after paint refresh | **after-paint-optional** |

A mirror of Shopify populated by a scheduled sync and by product update webhooks, so Shopify latency is never inside the 2.0 second budget and a Shopify incident degrades a price label rather than breaking a page. The same values are baked into the page at build time. If this call is slow, fails, or the customer is offline, the page keeps the baked value and the reorder button still works, because the cart permalink is a static URL requiring no API call at all.

**One genuine ambiguity, honestly flagged and still open.** The strict reading of the tap path rule says the only thing firing on a tap is the beacon. This operation is an optional refresh on top of a baked value, so both readings hold. The simpler alternative, dropping the refresh entirely and letting price be only as fresh as the last publish, removes one request from the tap path. **This was flagged for the client before M2 and has not been answered.** The recommendation is to keep the refresh: it is cheap and it degrades cleanly.

### 4.3 The tap path. One operation.

| Method | Path | `operationId` | Called at | Tap path |
|---|---|---|---|---|
| POST | `/v1/scan-events` | `recordScanEvent` | every tap and every QR scan, after paint, non blocking | **true** |

**Delivery.** Sent with `navigator.sendBeacon` so the browser owns delivery. If `sendBeacon` is unavailable, `fetch` with `keepalive: true`. **Never a blocking XHR, never before paint, never with a retry loop.**

**Responses.** `202 Accepted` with an empty body for a well formed request, **and 202 for a duplicate as well**. The client cannot distinguish the two and must not try. A malformed body returns 400 and **the client still does not retry**, because a beacon that retries is a beacon that can interfere with navigation.

**Idempotency.** Deduplicated server side on `(blendSlug, dedupToken, deduplication window)` through a single conditional write with no read beforehand. The deduplication window is proposed at 30 minutes and **was never confirmed by the client**: 30 minutes counts a customer showing the jar to three people at dinner as three browsers and one repeated tap as one scan.

**What the body may carry:** blend slug, tag code, channel (`nfc`, `qr`, `direct`), the browser generated dedup token, coarse device and platform strings, connection type, cache hit or miss, two timing numbers, the page version, and whether the request was redirected.

**What it must never carry, and is rejected or dropped server side if sent:** IP address, precise geolocation, any customer identifier, email, order number, or any free text field. `additionalProperties` is false.

**The dedup token** is a random value generated in the browser and kept in `localStorage`. It is not a user identifier and carries no personal data. It exists because per SKU encoding provides no per tag counter, which is why NFC and QR are deduplicated identically and why the dashboard can honestly compare the two.

### 4.4 Admin. Role based, bearer JWT. Seventeen operations.

| Method | Path | `operationId` | Minimum role |
|---|---|---|---|
| GET | `/v1/admin/blends` | `adminListBlends` | Viewer |
| POST | `/v1/admin/blends` | `adminCreateBlend` | Editor |
| GET | `/v1/admin/blends/{slug}` | `adminGetBlend` | Viewer |
| PATCH | `/v1/admin/blends/{slug}` | `adminUpdateBlend` | Editor |
| POST | `/v1/admin/blends/{slug}/publish` | `adminPublishBlend` | Editor |
| POST | `/v1/admin/revalidate` | `adminRevalidate` | Editor |
| POST | `/v1/admin/recipes` | `adminCreateRecipe` | Editor |
| PATCH | `/v1/admin/recipes/{recipeId}` | `adminUpdateRecipe` | Editor |
| DELETE | `/v1/admin/recipes/{recipeId}` | `adminDeleteRecipe` | Editor |
| POST | `/v1/admin/growers` | `adminCreateGrower` | Editor |
| PATCH | `/v1/admin/growers/{growerId}` | `adminUpdateGrower` | Editor |
| GET | `/v1/admin/media` | `adminListMedia` | Viewer |
| POST | `/v1/admin/media/uploads` | `adminCreateMediaUpload` | Editor |
| GET | `/v1/admin/media/{mediaId}` | `adminGetMedia` | Viewer |
| POST | `/v1/admin/media/{mediaId}/complete` | `adminCompleteMediaUpload` | Editor |
| GET | `/v1/admin/analytics/scans` | `adminGetScanTimeSeries` | Viewer |
| GET | `/v1/admin/tags` | `adminListTagRecords` | Admin |

**The three roles:**

| Role | Can |
|---|---|
| **Viewer** | Read everything including drafts and analytics. Write nothing. |
| **Editor** | Everything Viewer can, plus create and edit blends, recipes and growers, upload media, and publish. Cannot manage users. Cannot edit tag or redirect data. |
| **Admin** | Everything Editor can, plus user and role management, and read access to the tag records. |

Four things about this table are decisions rather than defaults:

**`DELETE` on a recipe is a soft archive.** The record moves to `archived` and stops appearing on the page at the next revalidation. Nothing is destroyed, because content that has been on a printed jar's page is worth keeping.

**Media upload is three calls, and that is the point.** Request a presigned S3 `PUT` URL, upload **directly to S3 from the browser**, then mark it complete, which triggers asynchronous derivative generation into responsive modern formats. **A large photograph never passes through an application function.** Premium brand photography plus a function mediated upload is a timeout and a memory limit waiting to happen, and it puts image bytes on a code path that has to stay fast for other reasons.

**Publish returns 202, not 200.** Publishing does not wait for regeneration. The previous version keeps serving until the new one is ready, so no editor waits for a deploy and no customer waits for a render. A blend that cannot be published yet returns 422 listing **every** blocking reason at once, because an editor fixing five problems in five round trips will stop using the tool.

**`GET /v1/admin/tags` is read only for every role including Admin, and that is deliberate.** The redirect table is a version controlled artifact deployed with the application. A thousand encoded tags resolve through it, so a change to it is a code review and a deployment, not a form submission. This operation exists so an operator can verify what is actually deployed without cloning the repository, and so a pre cutover and post cutover verification against physical tags can be recorded. See the document titled "Runbooks", section 5.

`POST /v1/admin/revalidate` is the manual escape hatch: revalidate given paths with no content change. It exists for the case where the cache and the data disagree, which will happen at least once, and building it in advance is cheaper than needing it at ten at night the day before a demo.

### 4.5 Outside the frozen surface, and deliberately so

| Method | Path | Notes |
|---|---|---|
| POST | `/internal/webhooks/shopify/products-update` | HMAC verified. Updates the catalog mirror. |
| POST | `/internal/webhooks/shopify/orders-create` | HMAC verified. Reorder attribution, per SKU. |
| GET | `/health` | Liveness. |

The Shopify sync and the order webhook consumer are internal services rather than API clients, authorised by IAM rather than by a bearer token, so the frozen document does not describe them. Putting them under `/v1` would add endpoints to a public contract that no client calls.

---

## 5. Conventions

- JSON only. `Content-Type: application/json; charset=utf-8`.
- `camelCase` field names.
- Timestamps are RFC 3339 in UTC with a `Z` suffix. Dates without times are `YYYY-MM-DD`. No local times anywhere.
- Slugs match `^[a-z0-9]+(-[a-z0-9]+)*$`.
- **Money is an integer in minor units plus an ISO 4217 code, never a float.** `{"amount": 2400, "currency": "USD"}` is 24.00 dollars.
- On PATCH, absent and null are different: an omitted field is unchanged, an explicit `null` clears it.
- Every response carries `X-Request-Id`, a ULID, identical to `error.requestId` and to the structured log line. That is what gets pasted into a support message.
- **Pagination is cursor based only.** `?limit=` (default 25, maximum 100) and `?cursor=`, with `nextCursor` in the envelope and `null` when exhausted. Offset pagination is not offered, because it does not exist cheaply in DynamoDB and pretending otherwise produces a table scan.
- List responses are enveloped as `{ "data": [...], "nextCursor": null }`. Single resource responses are the object itself. **That asymmetry is deliberate and is the only one in the contract.**
- Admin updates use optimistic concurrency: send the `version` you read, and a mismatch returns 409. This is what stops two editors silently overwriting each other, whose failure mode in this product is literally the page showing the wrong story.

### 5.1 The error envelope

Every non 2xx response from every endpoint has exactly this shape. No endpoint invents its own.

```json
{
  "error": {
    "code": "BLEND_NOT_FOUND",
    "message": "No blend exists with slug 'persian-sunrize'.",
    "requestId": "01J9Z8XK4M2Q7T5V3N8R1B6C0D",
    "details": [ { "field": "slug", "issue": "not_found" } ]
  }
}
```

**Clients branch on `error.code`, never on `error.message`.** The code is stable and never changes for a given condition; the message is for developers and admin users, is never rendered to a consumer, and may change wording without a version bump.

**Consumer facing errors are not this envelope.** The requirement for a graceful branded error and never a blank screen is a page level concern served from the edge: a branded offline page and a branded unknown code page, the latter compiled into the edge function itself so it works even when every origin is down.

### 5.2 Caching

| Endpoint class | `Cache-Control` |
|---|---|
| Public content reads | `public, max-age=60, stale-while-revalidate=300`, plus `ETag`. Build callers send `If-None-Match` and take 304s. |
| `GET /v1/catalog/{slug}` | `public, max-age=60, stale-while-revalidate=600`. Price moves rarely and serving stale beats serving nothing. |
| `POST /v1/scan-events` | `no-store` |
| All `/v1/admin/*` | `private, no-store` |

### 5.3 Rate limiting

Enforced at the CDN and WAF layer, not in application code, so a flood never reaches a function. 60 requests per minute per source IP on the beacon with a burst of 20, because a real customer sends one. 600 per minute on public content reads. 300 per minute per authenticated subject on admin, 60 per minute on media uploads. 429 responses carry `Retry-After` in seconds.

---

## 6. Versioning and change control on a frozen contract

**Major version in the URL path. Additive changes only inside a major version.**

| Change | Allowed in v1 |
|---|---|
| Add an endpoint, an optional request field, or a response field | Yes. Clients must ignore unknown fields. |
| Add an enum value | Yes, with care. Clients must treat an unknown enum value as the documented fallback rather than throwing. |
| Relax a validation rule | Yes |
| Rename or remove a field, change a type or format, make an optional field required, change a status code for an existing case, change default sort order or page size | **No. v2.** |

**Frozen does not mean unchangeable, it means changes are visible.** A change is proposed as a pull request against the OpenAPI document, classified against the table above, approved by both engineers, and a breaking change also needs the client because it costs schedule. **Contract tests are the enforcement mechanism, not review**: they are generated from the document, so a response that drifts from the specification fails the build rather than surprising the other engineer.

Deprecation is marked `deprecated: true` in the document with `Deprecation` and `Sunset` headers and a minimum 30 day overlap.

---

## 7. The contract test suite, and what it catches that a schema check cannot

The suite is **driven by the OpenAPI document rather than transcribed from it**. Paths, methods, status codes, schemas, security requirements and the `x-tap-path` extension are all read at run time. Change the document and the tests change with it; change the implementation without the document and the tests fail.

Every call the suite makes has already checked five things before the test asserts anything of its own: the request body against the declared request schema, that the observed status is one the operation declares, the response body against the schema declared for that exact status, that `X-Request-Id` is present, and that a status declared with no body returns no body.

Four things it checks that no schema can express:

**Whether `sendBeacon` can actually make the call.** `sendBeacon` sends POST and nothing else, sets no header except a `Content-Type` taken from the Blob type, cannot send `Authorization` or any custom header, and shares a budget of roughly 64 KB. The suite sends a request carrying exactly those headers and nothing more, checks the CORS preflight, and measures the body size. **An endpoint the beacon cannot legally call is a contract that fails only in the field, on a customer's phone, with nothing in any log to say so.**

**Authorisation, on every authenticated operation individually, with no sampling.** Anonymously and with a junk bearer token. The operation list comes from the document, so adding an admin endpoint to the specification automatically adds it to these tests. **A write endpoint that quietly accepts anonymous callers is the single worst thing this suite could miss.**

**The five real slugs and the tag code map, transcribed by hand.** Five slugs, four encoded codes plus the reserved fifth, the request and target paths, the unit counts and the 1,000 tag total, written out deliberately rather than read from the document. The suite then asserts that the document's enums, its worked examples, and the live tag records all agree with that hand written list. **A renamed slug or a repointed code fails here, which is the only place it can be caught before it strands inventory.**

**Coverage of the document itself.** The final suite asserts that every operation was exercised and every declared status code was either observed or accounted for with a reason.

Observed 17 August 2026 against the in memory stub: 202 tests, 200 passing, 2 failing; 25 of 25 operations exercised; 87 of 128 declared status codes observed, 34 not provokable by design, 7 structurally unreachable and listed with reasons, 0 unaccounted for. **Both failures were defects in the frozen document rather than in any implementation.** Two example corrections were applied on 17 August and the suite went to 201 of 202.

**Observed again on Thursday 27 August 2026 against the same stub: 202 tests, 202 passing, 0 failing, across 36 suites.** The one remaining deliberate failure, item 1 in section 8 below, was closed that day. **It went green because the defect was fixed in the frozen document, not because any test was skipped, relaxed or deleted.**

**The stub has no persistence, no real authentication and no rate limiting, and must never be deployed anywhere.**

---

## 8. Open items against the contract, stated rather than buried

These are live as at Tuesday 25 August 2026, **except item 1, which was closed on Thursday 27 August 2026 and is kept below with the closure marked rather than deleted.** Anyone picking this up should resolve the rest before writing a client.

**One of them has moved from theoretical to imminent.** Item 3 below says a sixth blend would be a v2 change and a schedule event, and that it is far cheaper to know in advance. **The client's live marketing site lists six blends.** Whether that is a sixth product or marketing copy is unanswered and has been asked. Read item 3 with that in mind.

**1. `ScanEventInput.pageVersion` was unbounded above. CLOSED Thursday 27 August 2026.** The contract states that every beacon field is an enum, a bounded string, or a number in a documented range. `pageVersion` declared `minimum: 1` and no maximum, on an endpoint that takes no credential, and every other numeric field on the beacon was bounded at both ends. **An adversarial review sent `pageVersion: 1e308` and got a 500 from that unauthenticated endpoint, so "safe in practice" did not reproduce.**

**`maximum: 2147483647` is now in the frozen document**, taken as a change control action under section 8 of the contract errata and classified breaking, with both engineers on it. **Do not quote the `maximum: 1000000` that earlier drafts of this section and of the errata proposed.** That was headroom against the worked examples rather than a bound derived from the producer. The producer is `Blend.version`, incremented by one per accepted admin write, and section 9 of the contract caps admin writes at 300 per minute per subject, so ten years at that saturated rate reaches 1576800000 and any lower bound is one the contract's own rate limit can outrun on paper. 2147483647 sits above it and is the largest signed 32 bit integer, so every accepted value is representable without loss between the browser and the stored attribute. **The beacon now answers 400 with the contract's error envelope on every value that produced a 500 before, and this stopped being the suite's one deliberate failing test.**

**2. CORS is not documented anywhere in the contract, and the beacon needs it.** This is the one open item that changes behaviour rather than documentation. As the frozen document stands, the API's declared server is `api.treveanspice.com` while the page is served from `treveanspice.com`, which makes the beacon a cross origin request; `application/json` is not a CORS safelisted content type, so the browser sends a preflight first and **silently drops the beacon if that preflight does not succeed**. The document declares no `OPTIONS` operation, no CORS response headers and no allowed origin list. An implementation that satisfies the document exactly produces zero scan events in production with nothing in any log to say so, and the first symptom is an empty dashboard several weeks after launch.

Two ways to close it, and the recommendation was to do both: **serve the beacon from the apex so it is same origin from the first deploy**, and document CORS additively with an allowed origin list, an `OPTIONS` response and `Access-Control-Allow-Origin` on the beacon response. Accepting `text/plain;charset=UTF-8` as well as `application/json` removes the preflight entirely, at the cost of parsing a JSON body arriving under a text content type. **None of this is settled in the frozen document today**, and the document's `servers` block still names `api.treveanspice.com`.

**The first half of that recommendation named a CloudFront distribution, and there is no distribution.** Nothing is deployed and there is no AWS account it could live in yet. **The recommendation survives in substance and not in mechanism: the requirement is that the beacon is same origin with the page, and the mechanism is whatever the host serving the apex calls a rewrite or a route.** See the document titled "Architecture and the reasoning behind it", section 9.1. **Do not read this item as blocked on AWS**, because the second half, documenting CORS additively in the contract, is available today and closes the failure mode on its own.

**3. `POST /v1/admin/blends` can never return 201.** `BlendCreate.slug` references the `Slug` enum, which is closed to the five blends that already exist, so creating a blend can only ever answer 409. The same closure makes the declared 404 on recipe creation unreachable. That may be exactly right: five blends is the scope, and a closed enum is a strong guard against a slug no tag resolves to. If so, mark the operation `deprecated: true` rather than leaving it looking usable. **If a sixth blend is ever expected, opening the enum is a v2 change and a schedule event, and it is far cheaper to know that in advance.**

**4. Twelve operations declare no 400 response**, including publish, which accepts a body. Additive to fix.

**5. 403 is declared on five operations whose minimum role is Viewer**, which is the lowest role, so no authenticated caller sits below it and 403 cannot occur. Harmless, arguably correct as future proofing, recorded so the coverage number reads honestly rather than looking like a gap in the tests.

**6. `writeProtected` was `null`, meaning unknown, on every row of the tag records, and both the data model and the OpenAPI description said this was pending the supplier's answer. That was stale and it has been corrected.** The client answered on Wednesday 19 August 2026 that order SO4731 shipped with **no** write protection (decision log D18, closing Q4). **The rows and the descriptions were updated on Saturday 22 August 2026:** the four encoded codes carry `false`, the reserved code stays `null` because no tag exists to have a state, and the data model, the frozen OpenAPI document and the deployed redirect table now agree. **What remains outstanding is the verification, not the record:** this is the client's answer rather than the supplier's written one, so it is confirmed by read back against our own bare stock and against one shipped jar before anything depends on rewritability. See the document titled "Runbooks", section 4.2.

**7. Three record types have no declared home in the data model:** media records, idempotency keys, and revalidation records. The implementation puts media in `SpiceBlends` under a `MEDIA#` namespace with an `entity-createdAt` index, consistent with how the catalog mirror lives there under `CATALOG#`. **That index is an addition, and the content package still describes the namespace as a proposal**, so the two packages do not yet agree in writing even though they agree in behaviour. Reconcile in one place.

**8. Never confirmed by the client, and each one is a real product decision:** the 30 minute deduplication window, raw scan event retention (proposed 400 days with rollups kept indefinitely), whether the after paint catalog refresh runs at all, whether the analytics dashboard is one person or marketing self serve, and whether an editor ever sees publish progress.
