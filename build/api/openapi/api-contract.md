# Frozen API contract

**Deliverable:** M1, due Tuesday 18 August 2026, delivered Wednesday 19 August 2026
**Prepared by:** Serene Labs Inc (Jacob Ralph) for Trevean Spice
**Status:** frozen for M2 to M5. Changes follow the change control process in section 11.
**Machine-readable specification:** the OpenAPI 3.1 document delivered alongside this one. Where the two disagree, the OpenAPI document governs the wire format and this document governs the intent.

---

## 1. The answer first

**One endpoint is on the tap path: `POST /v1/scan-events`, and it fires after the page is readable, as a browser beacon. Nothing else the customer's phone does between navigation start and page readable touches this API at all.**

Every content endpoint (blends, recipes, growers) is called at **build time and revalidate time**, by the build process and by the publish pipeline. They are never called when a customer taps a jar. The blend page is pre-rendered and served from the edge cache, so on a tap the sequence is: 307 at the edge, cached HTML from the edge, paint, and only then a beacon.

**This is the single most important sentence in the contract.** An engineer who wires the blend page to fetch `/v1/blends/{slug}` on load will produce a page that works perfectly in development, passes review, and then adds a DNS lookup, a TLS handshake to a second host, a cold Lambda start and a DynamoDB read to a 2.0 second budget that has roughly 400 ms of headroom on cellular. It will fail in a customer's kitchen on the first tap of the morning, which is the exact case a lab test never catches. See the Architecture document, "The tap path", rule 1.

The rest of this document is the detail.

---

## 2. What is called when

Read this table before writing any client code.

| Endpoint | Called by | When | On the tap path |
|---|---|---|---|
| `GET /v1/blends` | Build process, sitemap generator, admin | Build, revalidate, admin page load | No |
| `GET /v1/blends/{slug}` | Build process, revalidation handler | Build, revalidate | No |
| `GET /v1/blends/{slug}/recipes` | Build process | Build, revalidate | No |
| `GET /v1/recipes/{recipeId}` | Admin, build process | Build, admin | No |
| `GET /v1/growers`, `GET /v1/growers/{growerId}` | Build process, admin | Build, revalidate, admin | No |
| `POST /v1/scan-events` | Customer's browser, `navigator.sendBeacon` | **Every tap and every QR scan, after paint** | **Yes, after paint, non-blocking** |
| `GET /v1/catalog/{slug}` | Customer's browser, optional refresh | After paint, optional | After paint only, and degradable (section 2.2) |
| `POST /v1/admin/*` | Admin CMS | Editor actions | No |
| `GET /v1/admin/analytics/scans` | Analytics dashboard | Dashboard load | No |
| `GET /v1/admin/tags` | Admin, ops verification | Admin | No |

### 2.1 Why the content endpoints are off the tap path

The blend page is statically generated and regenerated on publish (Decision D2, 30 July). The generated HTML already contains the origin story, the grower profile, the freshness timeline, the recipe carousel and the Shopify cart permalink. All of it was fetched from this API when the page was built, not when it was requested.

The consequence for the API is a pleasant one: **the content endpoints serve tens of requests per day, not tens of thousands.** They are on the editorial path, not the consumer path. The <200 ms p95 target in section 6 exists to keep publish-to-live inside the 5 minute requirement in SOW §6.2, not to keep the customer waiting.

### 2.2 The catalog read, and an honest ambiguity

The Architecture document says live price and availability are fetched after paint, and that if the fetch fails the page is still a good page. The instruction for this deliverable says the only thing firing on a tap is the scan beacon. Both are satisfiable and the contract resolves them this way:

**Price and availability are baked into the page at build and revalidate time from the catalog mirror, and `GET /v1/catalog/{slug}` is an optional after-paint refresh that overwrites the baked value only if it returns.** If it is slow, fails, is blocked, or the customer is offline, the page shows the last known price and the reorder button still works, because the Shopify cart permalink is a static URL requiring no API call at all.

That means the strict reading holds: nothing is required on the tap path except the beacon. And the architecture holds: the price on screen can be fresher than the last publish. **This is a decision for Dan to confirm**, because the alternative (no after-paint refresh at all, price only as fresh as the last catalog sync plus the last revalidate) is simpler and removes one request from the tap path entirely. See section 12.

### 2.3 What must never be added to the tap path

Binding on both engineers for the duration of the engagement:

- No content fetch on page load, client side or server side.
- No third-party script before the page is readable. Not analytics, not a tag manager, not a pixel, not chat.
- No authentication, session or consent call. There are no customer accounts and no cookies on the tap path.
- No geolocation permission prompt. Geography comes from CDN viewer headers, server side. See section 8.3.
- No font, stylesheet or image from a third-party host.

A pull request that adds any of these to the blend page route fails the CI performance budget from M2 onward.

---

## 3. Versioning

**Major version in the URL path: `/v1/...`. Additive changes only inside a major version.**

| Change | Allowed in v1 | Notes |
|---|---|---|
| Add a new endpoint | Yes | |
| Add an optional request field | Yes | Must have a documented default |
| Add a response field | Yes | Clients must ignore unknown fields |
| Add a new enum value | Yes, with care | Clients must treat unknown enum values as the documented fallback, not throw. Fallbacks are named in the OpenAPI document. |
| Relax a validation rule | Yes | |
| Rename or remove a field | No | v2 |
| Change a field type or format | No | v2 |
| Make an optional field required | No | v2 |
| Change an HTTP status code for an existing case | No | v2 |
| Change default sort order or pagination size | No | v2 |

**Deprecation:** a field or endpoint being retired is marked `deprecated: true` in the OpenAPI document and returns a `Deprecation` header with an RFC 9745 date, plus a `Sunset` header. Minimum overlap is 30 days, which given this schedule means nothing deprecated in this engagement is removed before handoff.

**Contract tests are the enforcement mechanism, not review.** M2 acceptance requires API contract tests passing (SOW Rev C §5). Those tests are generated from the OpenAPI document, so a response that drifts from the specification fails the build rather than surprising the other engineer.

**The freeze date is Wednesday 19 August 2026, the day M1 was delivered.** After that, section 11 applies.

---

## 4. Error envelope

Every non-2xx response from every endpoint has exactly this body. No endpoint invents its own shape.

```json
{
  "error": {
    "code": "BLEND_NOT_FOUND",
    "message": "No blend exists with slug 'persian-sunrize'.",
    "requestId": "01J9Z8XK4M2Q7T5V3N8R1B6C0D",
    "details": [
      { "field": "slug", "issue": "not_found" }
    ]
  }
}
```

| Field | Required | Purpose |
|---|---|---|
| `error.code` | Yes | Stable, machine-readable, SCREAMING_SNAKE_CASE. Never changes for a given condition. Clients branch on this, never on `message`. |
| `error.message` | Yes | Human-readable, English, for developers and admin users. Never rendered to a consumer. May change wording without a version bump. |
| `error.requestId` | Yes | ULID. Same value as the `X-Request-Id` response header and the structured log line. This is what gets pasted into a support message. |
| `error.details` | No | Present on validation failures. One entry per offending field. |

### 4.1 Status codes and their meanings

| Status | Used for | Example codes |
|---|---|---|
| 400 | Malformed request, failed validation | `VALIDATION_FAILED`, `MALFORMED_JSON` |
| 401 | Missing or invalid credentials on an admin endpoint | `UNAUTHENTICATED`, `TOKEN_EXPIRED` |
| 403 | Valid credentials, insufficient role | `INSUFFICIENT_ROLE` |
| 404 | Resource does not exist | `BLEND_NOT_FOUND`, `RECIPE_NOT_FOUND`, `GROWER_NOT_FOUND`, `MEDIA_NOT_FOUND` |
| 409 | Optimistic concurrency failure, or a uniqueness conflict | `VERSION_CONFLICT`, `SLUG_TAKEN` |
| 413 | Upload exceeds the declared size limit | `PAYLOAD_TOO_LARGE` |
| 415 | Unsupported media type on upload | `UNSUPPORTED_MEDIA_TYPE` |
| 422 | Well-formed but semantically impossible | `PUBLISH_BLOCKED`, `GROWER_REQUIRED` |
| 429 | Rate limited. Carries `Retry-After`. | `RATE_LIMITED` |
| 500 | Unhandled. Always logged with the same `requestId`. | `INTERNAL_ERROR` |
| 502, 504 | Upstream (Shopify Admin API, S3) failed or timed out | `UPSTREAM_UNAVAILABLE`, `UPSTREAM_TIMEOUT` |
| 503 | Deliberate shed, for example during a maintenance window | `SERVICE_UNAVAILABLE` |

### 4.2 The scan beacon never returns an error the client acts on

`POST /v1/scan-events` returns `202 Accepted` with an empty body for a well-formed request, **and also returns 202 for a duplicate**. The client cannot distinguish the two and must not try. A malformed body returns 400, but the client does not retry: a beacon that retries is a beacon that can block navigation, which violates rule 3 of the Architecture document, "Three rules".

### 4.3 Consumer-facing errors are not this envelope

SOW §6.3 requires a graceful branded error and never a blank screen. That is a page-level concern served from the edge (a branded offline page and a branded unknown-code page), not an API response. The envelope above is for developers and the admin CMS.

---

## 5. Authentication and authorisation

Three zones, three postures.

### 5.1 Public content reads: unauthenticated

`GET /v1/blends`, `GET /v1/blends/{slug}`, `GET /v1/blends/{slug}/recipes`, `GET /v1/recipes/{recipeId}`, `GET /v1/growers`, `GET /v1/growers/{growerId}`, `GET /v1/catalog/{slug}`.

**No credential required, because every byte these return is already public in the rendered page.** Adding a secret to the build process would protect nothing and would put a credential into a CI environment for no gain.

Two qualifications:

1. **Only `status: "published"` content is served unauthenticated.** Draft and archived blends return 404 to an unauthenticated caller, and are readable only through `GET /v1/admin/blends/{slug}?include=draft` with an Editor or Admin role. Preview before publish (an M3 scope item) uses a short-lived signed preview token, not the public route.
2. Rate limits and a WAF apply. See section 9.

### 5.2 The scan beacon: unauthenticated by necessity, constrained by design

A browser beacon cannot hold a secret. Anything shipped to the page is public. So the beacon is protected by what it is worth attacking rather than by a credential:

- **It accepts no free text and no identifiers of value.** Every field is an enum, a bounded string matching a documented pattern, or a number in a documented range. Anything else is rejected with 400.
- **It stores no IP address and no PII.** See section 8.3.
- **`Origin` is checked** against the allowed hosts and a mismatch is recorded rather than trusted.
- **Rate limited per source** at the edge.
- **The dedup token is generated by the browser** and is not a user identifier: see section 8.2.

The realistic attack is inflating a scan count. The honest mitigation is that the dashboard already labels these counts as measured by a browser-side method rather than a per-tag counter (SOW §6.2, and Decision D6), so the number never claimed more precision than it has.

### 5.3 Admin: role-based, bearer token

`Authorization: Bearer <JWT>` on every `/v1/admin/*` endpoint. Tokens are issued by the managed identity provider on the Trevean AWS account, carry a `roles` claim, and are validated on the request path by signature, issuer, audience and expiry.

Three roles, per the Scope document, "In scope", row 3:

| Role | Can |
|---|---|
| **Viewer** | Read everything including drafts and analytics. Write nothing. |
| **Editor** | Everything Viewer can, plus create and edit blends, recipes and growers, upload media, and publish. Cannot manage users, cannot edit the tag or redirect data. |
| **Admin** | Everything Editor can, plus user and role management, and read access to the tag records. |

**The redirect table is not editable through the API by anyone, including Admin.** It is a version-controlled artifact deployed with the application (Decision D10). `GET /v1/admin/tags` is read-only, and its purpose is so an operator can verify what is deployed without cloning the repo. See the Data model document, section 7.

Insufficient role returns **403 with `INSUFFICIENT_ROLE`**, not 404. Hiding the existence of admin routes from an authenticated internal user buys nothing and makes support harder.

### 5.4 Machine callers

The build process and the revalidation handler call the public content endpoints with no credential. The Shopify catalog sync and the order webhook consumer are internal services, not API clients, and are authorised by IAM rather than by a bearer token. Inbound Shopify webhooks are signature verified (HMAC) before any processing, per the Architecture document, "Security and privacy".

---

## 6. Latency

**Target: <200 ms p95 for content retrieval, per SOW §6.2.**

| Measurement | Where measured | Target |
|---|---|---|
| Content retrieval (`GET /v1/blends/*`, `/v1/recipes/*`, `/v1/growers/*`) | Server side, at the API edge, excluding client network | **<200 ms p95** |
| Scan beacon (`POST /v1/scan-events`) | Server side | <100 ms p95. It is a conditional write and nothing else. |
| Catalog read (`GET /v1/catalog/{slug}`) | Server side | <100 ms p95, cacheable at the CDN for 60 seconds |
| Admin writes | Server side | <500 ms p95 |
| Publish to live | Publish request to new HTML served from the edge | **<5 minutes required by SOW §6.2, expected in seconds** |
| Analytics time series | Server side | <500 ms p95 for a 90 day range |

**The <200 ms figure is not what protects the 2.0 second tap budget.** The pre-rendered page is what protects the tap budget. The <200 ms figure protects publish-to-live and the admin experience. Stating this plainly here because the two numbers appear near each other in SOW §6.2 and get conflated.

The tap budget is spent elsewhere: see the Architecture document, "The tap path", steps 3 to 8, and note that the clock starts at the request for `/t/{code}` and the 307 hop is inside the budget (Decision D11).

---

## 7. Caching

| Endpoint class | `Cache-Control` | Notes |
|---|---|---|
| Public content reads | `public, max-age=60, stale-while-revalidate=300` | Also emit `ETag`. Build callers send `If-None-Match` and take 304s. |
| `GET /v1/catalog/{slug}` | `public, max-age=60, stale-while-revalidate=600` | Price moves rarely. Serving stale beats serving nothing. |
| `POST /v1/scan-events` | `no-store` | |
| All `/v1/admin/*` | `private, no-store` | |

**Cache key rule for the blend page itself, not the API, and it is the one most likely to be got wrong:** `via`, `utm_*` and any other attribution parameter **must be excluded from the CDN cache key** for `/blend.html`. If they are included, `?blend=persian-sunrise&via=nfc` and `?blend=persian-sunrise&via=qr` become two cache entries, the hit ratio halves, and the first tap of each variant pays a cold path. The parameters are still readable by the client script for the beacon. This is hypothesis 3 in the Architecture document, "Hypotheses to confirm in the audit", and is **TO CONFIRM IN AUDIT**.

---

## 8. Conventions

### 8.1 Wire format

- JSON only. `Content-Type: application/json; charset=utf-8`.
- `camelCase` field names.
- Timestamps are RFC 3339 in UTC with a `Z` suffix, for example `2026-08-17T09:41:07Z`. No local times anywhere.
- Dates without times are `YYYY-MM-DD`.
- Slugs are lowercase, hyphen separated, matching `^[a-z0-9]+(-[a-z0-9]+)*$`.
- Money is an integer in minor units plus an ISO 4217 currency code, never a float. `{"amount": 2400, "currency": "USD"}` is $24.00.
- Absent and null are distinguished on PATCH: an omitted field is unchanged, an explicit `null` clears it.
- Every response carries `X-Request-Id`.

### 8.2 Idempotency

- `POST /v1/scan-events` is idempotent on `(blendSlug, dedupToken, windowId)` through a single conditional write. No `Idempotency-Key` header, no read before write. See the Data model document, section 4, pattern 5.
- Admin writes that create a resource accept an optional `Idempotency-Key` header, retained 24 hours.
- Admin updates use optimistic concurrency: the client sends the `version` it read, and a mismatch returns 409 `VERSION_CONFLICT`. This is what stops two editors silently overwriting each other in the CMS.

### 8.3 What the scan beacon may and may not contain

**May:** blend slug, tag code, channel (`nfc`, `qr`, `direct`), a browser-generated dedup token, coarse device and platform strings, connection type, cache hit or miss, and two timing numbers (time to first byte and time to readable).

**Must not, and is rejected or dropped server side if sent:** IP address (never stored, per the Architecture document, "Security and privacy"), precise geolocation, any customer identifier, email, order number, or free-text field.

**Geography is derived server side from CDN viewer headers, to country, region and city only.** The client never sends it and the browser is never asked for permission. A location prompt two seconds after a customer touched a jar is hostile, and it would also cost time inside a budget that has none to spare.

**The dedup token** is a random value generated in the browser, stored in `localStorage`, scoped to the site, carrying no personal data and no server-side identity. It exists because per-SKU encoding means there is no per-tag counter (Decision D6). It is the same mechanism the QR path uses, which is why the dashboard can honestly compare the two.

### 8.4 Pagination

Cursor based. `?limit=` (default 25, maximum 100) and `?cursor=`, with `nextCursor` in the response envelope and `null` when exhausted. Offset pagination is not offered, because it does not exist cheaply in DynamoDB and pretending otherwise produces a table scan. See the Data model document, section 4.

List responses are always enveloped:

```json
{ "data": [ ... ], "nextCursor": null }
```

Single-resource responses are the object itself, not wrapped. This asymmetry is deliberate and is the only one in the contract.

---

## 9. Rate limiting

| Caller | Limit |
|---|---|
| `POST /v1/scan-events` | 60 requests per minute per source IP at the edge, burst 20. A real customer sends one. |
| Public content reads | 600 per minute per source IP |
| `/v1/admin/*` | 300 per minute per authenticated subject |
| `POST /v1/admin/media/uploads` | 60 per minute per subject |

429 responses carry `Retry-After` in seconds. Limits are enforced at the CDN and WAF layer, not in application code, so a flood never reaches a function.

---

## 10. Endpoint reference in brief

Full request and response schemas, with worked examples on the five real blends, are in the OpenAPI 3.1 document delivered alongside this one. Summary:

**Public content, build and revalidate time only**

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/blends` | List blends. Filter by `status`. Access pattern 2. |
| GET | `/v1/blends/{slug}` | One blend. `?include=grower,recipes` returns the full page payload in one call. Access pattern 1. |
| GET | `/v1/blends/{slug}/recipes` | Recipes for a blend, in carousel order, 5 to 10 per blend. Access pattern 3. |
| GET | `/v1/recipes/{recipeId}` | One recipe. |
| GET | `/v1/growers` | List growers. |
| GET | `/v1/growers/{growerId}` | One grower. Access pattern 4. |
| GET | `/v1/catalog/{slug}` | Shopify price and availability mirror. Access pattern 8. |

**Tap path**

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/scan-events` | The beacon. 202 always, for both new and duplicate. Access pattern 5. |

**Admin, role-based**

| Method | Path | Minimum role |
|---|---|---|
| GET | `/v1/admin/blends` | Viewer |
| POST | `/v1/admin/blends` | Editor |
| GET | `/v1/admin/blends/{slug}` | Viewer |
| PATCH | `/v1/admin/blends/{slug}` | Editor |
| POST | `/v1/admin/blends/{slug}/publish` | Editor |
| POST | `/v1/admin/recipes` | Editor |
| PATCH | `/v1/admin/recipes/{recipeId}` | Editor |
| DELETE | `/v1/admin/recipes/{recipeId}` | Editor |
| POST | `/v1/admin/growers` | Editor |
| PATCH | `/v1/admin/growers/{growerId}` | Editor |
| GET | `/v1/admin/media` | Viewer |
| POST | `/v1/admin/media/uploads` | Editor |
| POST | `/v1/admin/media/{mediaId}/complete` | Editor |
| POST | `/v1/admin/revalidate` | Editor |
| GET | `/v1/admin/analytics/scans` | Viewer |
| GET | `/v1/admin/tags` | Admin |

### 10.1 Media upload, and why it is three calls

`POST /v1/admin/media/uploads` returns a presigned S3 `PUT` URL and a `mediaId`. The browser uploads **directly to S3**. Then `POST /v1/admin/media/{mediaId}/complete` marks it uploaded and triggers asynchronous derivative generation into responsive modern formats.

**A large photograph never passes through an application function.** Premium brand photography plus a function-mediated upload is a timeout and a memory limit waiting to happen, and it puts image bytes on a code path that has to stay fast for other reasons. This is the media pipeline described in the Architecture document, "Page weight and the performance budget".

Derivatives are asynchronous, so `GET /v1/admin/media/{mediaId}` may report `status: "processing"` for a few seconds after completion. The CMS shows that state rather than a broken image.

### 10.2 Publish and revalidate

`POST /v1/admin/blends/{slug}/publish` moves the blend to `published`, writes an immutable published snapshot, and enqueues a revalidation of exactly the affected pages. The response returns `revalidationId` and the list of paths queued.

`POST /v1/admin/revalidate` is the manual escape hatch: revalidate given paths without a content change. It exists for the case where the cache and the data disagree, which will happen at least once during this engagement.

**Publish does not wait for revalidation.** The previous version keeps serving until the new one is ready, which is the whole point of the rendering strategy (Decision D2). The response is 202 with a status URL.

### 10.3 Analytics

`GET /v1/admin/analytics/scans?from=&to=&granularity=day&blend=` returns a time series **read from pre-aggregated rollups, never from raw events, never with a table scan**. See the Data model document, section 5. The response labels every count with the measurement method, so the dashboard can state that NFC and QR are counted the same way rather than implying NFC precision that per-SKU encoding does not provide.

---

## 11. Change control on a frozen contract

Frozen does not mean unchangeable, it means changes are visible.

1. The change is proposed as a pull request against the OpenAPI document in the client repo.
2. It is classified against the table in section 3 as additive (allowed in v1) or breaking (v2).
3. Both engineers approve. A breaking change also needs Dan, because it costs schedule.
4. Contract tests regenerate and pass before merge.
5. The change is recorded in the decision log if it was expensive to decide.

**Between Wednesday 19 August and the 27 September demo, expect additive changes and treat any breaking change as a schedule event.** Two engineers building against this for seven weeks is the reason it is frozen at all.

---

## 12. Open items

Marked explicitly.

**Corrected Saturday 22 August 2026.** This document previously said we did not have access to the `nfc-development` repository and that it was not present on this machine. **That was wrong when it was written.** Repository access landed on **Monday 10 August 2026** and was confirmed in writing to Dan the same evening (decision log D15). The scaffold audit ran on **Wednesday 19 August 2026** (D19). Items still marked **TO CONFIRM IN AUDIT** below are answered in that audit rather than outstanding, and nothing here was ever waiting on Trevean on the repository side.

| # | Item | Resolves |
|---|---|---|
| 1 | **TO CONFIRM IN AUDIT.** Whether the existing scaffold already exposes routes under a different shape or version prefix, and what the migration cost is if so. | Audit, 18 Aug. Related to Q14. |
| 2 | **TO CONFIRM IN AUDIT.** Whether the existing DynamoDB indexes support these endpoints at the stated read costs, or whether index additions are required. | Audit, 18 Aug. **Q15.** See the Data model document, section 8. |
| 3 | **TO CONFIRM IN AUDIT.** Whether the CDN currently includes `via` and `utm_*` in the cache key for `/blend.html`. See section 7. | Audit, 18 Aug. Architecture hypothesis 3. |
| 4 | **TO CONFIRM IN AUDIT.** Which identity provider, if any, the scaffold already uses for admin, and whether roles exist. | Audit, 18 Aug. Related to Q11 and Q14. |
| 5 | **For Dan to confirm.** Whether `GET /v1/catalog/{slug}` runs as an after-paint refresh at all, or whether price is only as fresh as the last publish. See section 2.2. Recommendation: keep the refresh, it is cheap and degradable. | Before M2 |
| 6 | **For Dan to confirm.** Whether the analytics dashboard is Dan only or marketing self-serve, which decides whether Viewer is a real role with real users. Recommendation: build for self-serve, same effort. | Q19, before M3 |
| 7 | **For Dan to confirm.** Retention on raw scan events. Proposed 400 days with rollups retained indefinitely. See the Data model document, section 3.5. | Before M2 |
| 8 | **Closed, and the first answer was reversed.** Q4 was answered on Wednesday 19 August 2026 (D18) as no write protection, and that answer was reversed on Friday 11 September 2026 (D45): SO4731 shipped **write protected**, with an ST25TV area password nobody at Trevean holds. `GET /v1/admin/tags` reports `writeProtected: true` on the four encoded codes and `null` on the reserved code, where no tag exists to have a state. Still to do, and not a contract item: read back one shipped tag on a physical reader, because that is the client's check against the stock rather than Tagstand's written answer. **Corrected Thursday 22 October 2026 as erratum E20 in the contract errata, documentation only.** | **Q4, re-answered by D45. D18 superseded** |
