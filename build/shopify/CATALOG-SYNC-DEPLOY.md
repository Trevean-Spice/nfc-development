# Catalog sync: what changed, and how to deploy it after approval

> **Placeholders.** Values in angle brackets, such as `<TREVEAN_DEV_ACCOUNT_ID>`, `<TREVEAN_MANAGEMENT_ACCOUNT_ID>`, `<TREVEAN_ORG_ID>`, `<TREVEAN_MANAGEMENT_ROOT_EMAIL>`, `<TREVEAN_DEV_ROOT_EMAIL>`, `<TREVEAN_PREFIX_SUFFIX>` and `<TREVEAN_DISTRIBUTION_DOMAIN>`, stand in for Trevean's real AWS identifiers. The real values are in Trevean's private record, not in this public repository.

Written Wednesday 14 October 2026 on branch `fleet/catalog-sync`. **Nothing here has been
deployed, applied, pushed, or run against AWS or Shopify.** Every step under "Deploy steps"
is for later, one approval item at a time.

---

## 1. Why catalog_sync was a placeholder

- The function `trevean-dev-<TREVEAN_PREFIX_SUFFIX>-catalog-sync` is created by
  `build/infrastructure/modules/compute/main.tf` (`aws_lambda_function.function`, key
  `catalog_sync`, handler `index.handler`, nodejs22.x, arm64). With no entry in
  `function_packages` it gets `data.archive_file.placeholder`, the zip of
  `modules/compute/placeholder/index.mjs` (1,406 bytes of source, about 848 bytes zipped),
  which logs an error and answers 501.
- **Nothing produced a package for it.** `build/api/scripts/package-lambda.mjs` exports the
  Fastify application as `index.handler` (and the stream consumer as `index.streamHandler`).
  Deploying that archive to catalog_sync would hand a scheduled event to an HTTP app. The
  `build/shopify` package had the sync library (`syncCatalog`, which by design does not
  write) and no Lambda entry point, no writer and no packager.
- **Nothing invokes it.** There was no EventBridge rule, function URL or route for
  catalog_sync anywhere in the Terraform.
- Code deploys are not done by Terraform: every function has `ignore_changes` on
  `filename` and `source_code_hash`, so naming a zip in `function_packages` does not
  update an existing function. Code goes out with `aws lambda update-function-code`, as
  in the operations runbook, section 3.

## 2. What changed

| File | Change |
|---|---|
| `src/sync/catalogWriter.ts` | **New.** Plans and builds the conditional `UpdateItem` for one CATALOG# row. Contract slug enum, key builder that refuses anything not `CATALOG#{contract slug}` / `v0`, the list of attributes the mirror owns, product id and variant id pins, the GetItem reader. |
| `src/sync/runCatalogSync.ts` | **New.** One run: read rows, walk the Admin API, plan, then write or log (dry run). |
| `src/lambda/catalogSyncHandler.ts` | **New.** The Lambda handler, settings from the environment, JSON logging. Throws if any row write failed or anything failed before the writes. |
| `src/lambda/aws.ts` | **New.** Secrets Manager credential provider and DynamoDB table adapter, using the AWS SDK v3 that ships in the nodejs22.x runtime (dynamic import). Refuses the Terraform placeholder secret value. |
| `src/mirror/map.ts`, `src/mirror/product.ts`, `src/admin/catalogSync.ts` | A product whose status is not ACTIVE (DRAFT, ARCHIVED) is mirrored as `available: false`, `out_of_stock` (the D58 rule, now in the shared mapper, so the webhook path gets it too). New `preferredVariantId` selection option, threaded through `syncCatalog` as `preferredVariantIdBySlug`. |
| `scripts/package-catalog-sync.mjs` | **New.** Builds `.lambda-build/catalog-sync.zip`: `index.mjs` re-exporting `handler`, `package.json` (`type: module`), `dist/src/**/*.js`. No node_modules. Deterministic zip (writer copied from the API packager). Imports the staged entry to check `handler` is a function; does not invoke it. |
| `package.json` | Script `package:catalog-sync`. **No dependency added**, runtime or dev. |
| `.gitignore` | `.lambda-build/`. |
| `test/catalog-sync-lambda.test.ts`, `test/helpers/memoryTable.ts` | **New.** 42 tests. The in memory table evaluates the condition and update expressions it receives and throws on any clause it does not understand. |
| `test/webhook-handlers.test.ts` | One test: a REST `status: draft` product is not purchasable. |
| `build/infrastructure/modules/compute/main.tf` | catalog_sync environment: `SHOPIFY_ADMIN_TOKEN_SECRET_NAME` (the secret ARN from `var.secret_arns`) and `CATALOG_SYNC_DRY_RUN`. Optional schedule: `aws_cloudwatch_event_rule`, `aws_cloudwatch_event_target`, `aws_lambda_permission`, all `count = 0` unless a schedule expression is set. |
| `build/infrastructure/modules/compute/variables.tf`, `modules/stack/{main,variables}.tf`, `envs/dev/{main,variables}.tf` | Two variables threaded dev, then stack, then compute: `catalog_sync_dry_run` (default `true`) and `catalog_sync_schedule_expression` (default `null`). Staging and prod pick up the defaults. |

**Not changed:** `build/content/tools/seed-dynamodb.mjs`, the chip-cli write protection
probe gate, `build/api` (including its inline webhook routes), IAM policies, DNS, secrets. (That is this branch, `fleet/catalog-sync`. `fleet/order-webhook` then changes `build/api` and the admin_api IAM: section 4.)

### What a run does

1. `GetItem` (strongly consistent) on `CATALOG#{slug}` / `v0` for each of the five
   contract slugs. A read failure stops the run before Shopify is called.
2. Builds the explicit product to blend map from the rows' `shopifyProductId` (the
   7 October values) and the variant pins from the rows' `shopifyVariantId`.
3. Walks the Admin GraphQL API with the existing `syncCatalog` (pagination, cost aware
   waits, retries on THROTTLED, 429 and 5xx). Any error it cannot retry through throws:
   **no writes at all**, never a partial or empty mirror.
4. For each matched product, plans one `UpdateItem`:
   - `SET` only `sku, shopifyProductId, shopifyVariantId, priceAmount, priceCurrency,
     compareAtAmount, available, inventoryStatus, variantPosition, syncedAt, syncSource`.
     Never `REMOVE`, never `PutItem`, **never `cartPermalinkUrl`** (stays null, the API
     derives it from `SHOPIFY_STORE_DOMAIN`), never `entityType`, `slug` or any other
     attribute.
   - `syncSource = shopify-sync-<ISO time of the run>`, `syncedAt` = the same time.
   - `ConditionExpression`: `attribute_exists(#pk) AND begins_with(#pk, :catalogPrefix)
     AND #entityType = :catalogEntity`, plus `AND #shopifyProductId = :expectedProductId`
     when the row carries a product id.
   - A price Shopify sends that cannot be converted exactly is left out (last known price
     kept). A null compare at price is written (clears an ended sale).
   - **Skipped and reported, row untouched:** no row (`row_missing`, the sync never
     creates rows), wrong entity at that key (`not_a_catalog_row`), product with no
     variant (`no_variant`), row pinned to a different product (`product_id_mismatch`),
     row's variant no longer on the product (`variant_id_mismatch`).
5. Dry run: logs each planned update (`changes` with `from` and `to`, plus the update and
   condition expressions) and sends nothing. **Dry run is the default.** Writes happen only
   when `CATALOG_SYNC_DRY_RUN` is exactly `false`. `{"dryRun": true}` on the event forces a
   dry run; no event can turn writes on.
6. A row whose condition fails (changed between read and write) is reported as
   `condition_failed`; the other rows are still written; the invocation then throws.

BLEND# items cannot be reached: the key is built only from a contract slug and asserted to
start with `CATALOG#`, and the catalog_sync IAM role is limited to leading keys `CATALOG#*`.

Idempotent: the same store state produces the same mirror values; only `syncedAt` and
`syncSource` advance (they must, because `syncedAt` drives the API's staleness rule).

---

## 3. Test results

Run on this host, Node v22.23.3, vitest 2.1.9 from the lock file, no network access by
the tests, no AWS, no Shopify:

```
$ npm test

 RUN  v2.1.9 /home/c-trevean/projects/trevean-spice-nfc/build/shopify

 ✓ test/catalog-sync-lambda.test.ts (42 tests) 341ms
 ✓ test/catalog-sync.test.ts (28 tests) 31ms
 ✓ test/webhook-verify.test.ts (39 tests) 26ms
 ✓ test/webhook-handlers.test.ts (24 tests) 10ms
 ✓ test/permalink.test.ts (40 tests) 21ms
 ✓ test/config-wiring.test.ts (10 tests) 7ms
 ✓ test/reorder.test.ts (20 tests) 9ms
 ✓ test/contract.test.ts (8 tests) 797ms
   ✓ the vendored copy of the contract > is byte identical to the M1 deliverable 470ms
 ✓ test/no-secrets.test.ts (20 tests) 24ms
 ✓ test/storefront-cart.test.ts (13 tests) 7ms
 ✓ test/ids-and-money.test.ts (33 tests) 8ms

 Test Files  11 passed (11)
      Tests  277 passed (277)

$ npm run typecheck
> tsc -p tsconfig.json --noEmit
(clean, no output)
```

Baseline before any change: 10 files, 234 tests, all passing; typecheck clean.

What the 42 new tests cover:

- **Happy path:** four blends updated, values in the flat row shape the API reads,
  `cartPermalinkUrl` stays null, BLEND# items byte identical before and after, attributes
  the sync does not own kept, Kyoto Garden reported missing and the tote bag unmatched
  (neither written), price change reported as `from 1800 to 2400`, a later price change
  followed, an unconvertible price keeps the last known price, a second run changes no
  mirror value.
- **Dry run:** default when unset, forced by the event, cannot be turned off by the event,
  only the exact string `false` writes.
- **Edge cases:** DRAFT and ARCHIVED products not purchasable, product with no variant
  skipped, row pinned to another product skipped, row's variant kept over position order,
  row's variant gone means skipped (not repointed), rows' product ids used as the explicit
  map, missing row never created, non CATALOG entity at a CATALOG# key not written.
- **Failure modes:** non retryable Admin API error, GraphQL `ACCESS_DENIED`, a failed
  second page, throttling waited through (THROTTLED twice, then success), HTTP 429/5xx
  retried, retry budget exhausted (no writes), row changed between read and write
  (`ConditionalCheckFailedException`: that row untouched, others written, run fails), any
  other write error, row read failure (Shopify never called).
- **Fences:** contract slug list equals the frozen OpenAPI `Slug` enum, key builder refuses
  `BLEND#...` and non contract slugs, exact condition expression, configuration problems
  all reported at once, secret value parsing refuses the Terraform placeholder.

Mutation check: with each of these removed in turn, the suite failed (2, 3, 2 and 1
tests): the product id condition, the dry run default, the draft rule, the "keep last
known price" rule. Each was restored before the final run.

**Package build:**

```
$ npm run package:catalog-sync
staged index.mjs exports handler (loaded, not invoked)
archiving 25 files
bytes  47519
sha256 ZWLAMpd2EVE7k6S/FFlTV+KuyCuKO2ZbMSzbjUQEHdQ=
```

Built twice, same sha256 both times. The zip passes Python's `zipfile.testzip()`. The
unzipped archive, driven by an offline script with recorded Admin API responses and a
fake table, ran a dry run with zero writes. **The sha256 above is from this commit on this
host; rebuild at deploy time and use the value the packager prints.**

**Not run:** `terraform fmt` and `terraform validate`. Terraform is not installed on this
host and was not installed. The HCL was written to the existing `fmt` alignment by hand and
has not been parsed by Terraform. The `build/api` test suite was not run (nothing in
`build/api` changed).

---

## 4. The webhook path (products/update, orders/create)

**Rewritten Wednesday 14 October 2026 on branch `fleet/order-webhook`** (built on
`fleet/catalog-sync`). **Nothing has been deployed, applied, pushed, or registered with
Shopify.** The endpoint is the API's existing webhook handler, reached through the admin
API's HTTP API. The `shopify_webhook` Lambda stays the 848 byte placeholder, untouched, with
no way in.

### 4.1 What was wrong (each one checked in the code and Terraform, not against a live request)

1. **Every signed delivery would have failed with a 500. Confirmed.** `build/api` reads
   `SHOPIFY_WEBHOOK_SECRET_NAME`, default `trevean/api/shopify-webhook-secret`. Terraform did
   not set it on `admin_api`, and the secrets module creates `trevean/dev/shopify-webhook-secret`.
   The `admin_api` policy granted `GetSecretValue` on the admin signing key and the
   revalidation secret only. **Found while fixing it, and worse:** had the secret become
   readable while still holding the Terraform placeholder, the API would have used the
   placeholder string, which is written in this repository, as the HMAC key, so anybody who
   had read the repository could sign a delivery it accepted.
2. **products/update would have damaged the rows. Confirmed.** A full `PutItem` of the
   CATALOG# row (dropping `variantPosition`, the 7 October provenance and anything else not
   named), and availability from `variant.available` through `isPurchasable`, which answers
   false when the field is absent. Shopify's REST product payload carries
   `inventory_management`, `inventory_policy` and `inventory_quantity` on a variant and no
   `available` (per Shopify's REST product resource, not verified against a live delivery),
   so every update would have marked the blend unavailable. Also: the first variant rather
   than the row's verified one, price by `Math.round(parseFloat(x) * 100)`, and currency from
   a `currency` field the payload does not carry.
3. **orders/create could not write its counters. Confirmed.** `admin_api` had `Query` and
   `GetItem` on `ROLLUP#*` in ScanEvents and nothing else, so the `UpdateItem` (ADD) failed.
   Also: no deduplication (Shopify retries a delivery with the same webhook id, and ADD
   counted it again), the day was the delivery time rather than the order's `created_at`, the
   ALL row counted lines rather than orders, and lines were matched on SKU tokens only, while
   the reorder permalink puts a variant id in the cart.

### 4.2 What changed

| File | Change |
|---|---|
| `build/api/src/routes/webhooks.ts` | Rewritten. Signature check first (4.3), then the services. Status codes chosen for Shopify's retry behaviour. |
| `build/api/src/webhooks/signature.ts` | `isWellFormedSignature` (exactly one base64 SHA-256 digest, checked before the secret is read) and `webhookSecretFrom` (raw value or `{"value": ...}`; refuses the Terraform placeholder). The constant time compare is unchanged. |
| `build/api/src/services/shopifyCatalogMirror.ts` | **New.** products/update with the catalog sync's rules: REST normalisation, availability from the three inventory signals, draft or archived means not purchasable, the row's variant pinned, exact price conversion, a plan identical in shape to `planCatalogWrite` (SET of `MIRROR_OWNED_ATTRIBUTES` only, never `cartPermalinkUrl`, never REMOVE or PutItem, the same condition expression, the same skip reasons). |
| `build/api/src/services/orderAttribution.ts` | **New.** Reads only `created_at` and `line_items[].variant_id/sku/quantity`. Matches by the row's variant id, then the row's SKU, then `slugForSku`. Sums units per blend. |
| `build/api/src/repositories/catalog.ts` | `readCatalogRows` (consistent GetItem per contract slug) and `updateCatalogMirror` (UpdateItem, key forced to `CATALOG#`). `syncSource` typed as a string. `putCatalogEntry` (the seeder's) unchanged. |
| `build/api/src/repositories/rollups.ts` | `releaseBatch`, the inverse of the existing `claimBatch`. |
| `build/api/test/helpers/global-setup.ts` | The in process DynamoDB the tests start listens on 127.0.0.1 instead of every interface. |
| `build/api/test/unit/shopifyWebhookRules.test.ts`, `test/integration/shopifyWebhooks.test.ts`, `test/integration/shopifyWebhookFailures.test.ts` | **New**, 36 tests. One existing test (`admin.test.ts`) now sends `X-Shopify-Topic`, as Shopify does. |
| `build/infrastructure/modules/compute/main.tf` | `admin_api`: environment `SHOPIFY_WEBHOOK_SECRET_NAME = "trevean/${var.environment}/shopify-webhook-secret"`; policy statements `VerifyShopifyWebhooks` (`GetSecretValue` on that secret's ARN), `CountWebhookOrdersOnDailyRollups` (`UpdateItem` on ScanEvents, leading keys exactly `ROLLUP#ALL#DAY` and `ROLLUP#BLEND#{slug}#DAY` for the five contract slugs; a new slug needs a line here), `ClaimWebhookOrderDeliveries` (`PutItem`, `DeleteItem` on ScanEvents, leading keys `CKPT#shopify-orders-create#*`). The `shopify_webhook` function and role are untouched. |
| `build/shopify/README.md` | "Relationship to the API component" now says what was reconciled and how drift is caught. |

**Not changed:** `build/content/tools/seed-dynamodb.mjs`, the chip-cli write protection probe
gate, the `shopify_webhook` placeholder, the catalog sync code, DNS, secret values.

**Why the rules are restated rather than imported.** `build/api` and `build/shopify` are
separate packages with separate Lambda archives, and the API's packager ships only its own
`dist/src`. `test/unit/shopifyWebhookRules.test.ts` reads
`build/shopify/src/sync/catalogWriter.ts` and fails if `MIRROR_OWNED_ATTRIBUTES`,
`CONTRACT_SLUGS` or the condition expression differ, so the two writers cannot drift silently.

### 4.3 What each delivery gets back

| Case | Answer | Effect |
|---|---|---|
| No `X-Shopify-Hmac-Sha256`, or not the shape of a SHA-256 base64 digest | **401** | The secret is not read. An unsigned request can never become a 5xx. |
| Secret unreadable, unset, or still the Terraform placeholder | **503** | Fails closed. Shopify retries, so deliveries made before the secret is fixed are not lost while it keeps retrying. |
| HMAC over the raw body does not match (constant time) | **401** | Nothing read or written. |
| Authentic, but `X-Shopify-Topic` is not the route's topic, or `X-Shopify-Shop-Domain` is not `SHOPIFY_STORE_DOMAIN` | 200, `ignored` | Logged as a warning, nothing written. A misregistered subscription shows in the log and does no harm. |
| products/update for a product that is no blend | 200, `matched: false` | Logged. |
| products/update skipped (`row_missing`, `not_a_catalog_row`, `no_variant`, `product_id_mismatch`, `variant_id_mismatch`) | 200, `skipped` | Row untouched, warning logged with the reason. A retry cannot change the answer. |
| products/update condition fails (row changed between read and write) | **409** | Row untouched. Shopify retries and the retry plans against the row as it is then. |
| products/update applied | 200 | `changes` (from and to) logged. `syncSource = shopify-webhook-<time>`. |
| orders/create without `X-Shopify-Webhook-Id` | **400** | Not counted, because it cannot be deduplicated. Shopify always sends the header. |
| orders/create without a usable `created_at`, or nothing we sell | 200, `counted: 0` | Logged. |
| orders/create counted | 200, `counted: n` | Per blend row: `orders` +1, `units` +quantity. ALL row: `orders` +1, `units` +total. Day from the order's `created_at`, UTC. |
| orders/create duplicate (same webhook id) | 200, `counted: 0` | Nothing added. |
| orders/create counter write fails | **503** | That row's claim is released, so Shopify's retry writes it once; rows already written are not written again. |

**Idempotency.** orders/create is deduplicated on `X-Shopify-Webhook-Id`, using the code base's
existing conditional claim (`claimBatch`, a `CKPT#` item with a 7 day TTL), one claim per
rollup row: `CKPT#shopify-orders-create#{webhook id}#{rollup pk}`. products/update needs no
record: every write is a SET of values derived from the payload, so a duplicate writes the
same values again (only `syncedAt` and `syncSource` advance).

### 4.4 Test results

Run on this host, Node v22.23.3, vitest 2.1.9, no network, no AWS, no Shopify. The in
process DynamoDB (dynalite) evaluates the real condition and update expressions.

```
build/api       $ npm test            Test Files  19 passed (19)   Tests  293 passed (293)
                $ npm run typecheck   (clean)
build/shopify   $ npm test            Test Files  11 passed (11)   Tests  277 passed (277)
                $ npm run typecheck   (clean)
```

Baseline before any change on this branch: `build/api` 16 files, 257 tests;
`build/shopify` 11 files, 277 tests; both typechecks clean.

The 36 new tests cover: **happy path** (price, availability from inventory, BLEND# item
identical, attributes the mirror does not own kept, `cartPermalinkUrl` stays null, served by
`GET /v1/catalog`; an order counted on the blend and ALL rows with no PII stored anywhere in
ScanEvents); **edges** (unknown product, product with several variants keeping the pinned one,
pinned variant gone, row pinned to another product, missing row never created, draft product,
duplicate products/update leaving the row identical, duplicate and distinct order deliveries,
an order of nothing we sell, wrong topic, wrong shop, order day from `created_at` across a
time zone); **failures** (no signature, malformed signature, wrong secret, tampered body,
missing secret answers 503 while unsigned and malformed requests still answer 401, the
Terraform placeholder refused even when a request is signed with it, a real conditional check
failure leaving the row untouched, the route answering 409 and the retry applying, a failed
counter write answering 503 and the retry counting exactly once, missing webhook id).

Mutation check: each of these removed in turn made the suite fail (1 to 5 tests each): the
availability rule, the draft rule, the product id condition, the order claim, the claim
release, the signature shape check before the secret read, the placeholder guard.

**Package:** `node scripts/package-lambda.mjs` in `build/api` built
`.lambda-build/api.zip`, 6,664,121 bytes, sha256
`wh7LnRhJ41HoiCjdLPrYZuzpUHBWewki2ggGEox8x7c=` on this host (rebuild at deploy time and use the
value the packager prints). The unzipped archive's own `index.handler`, driven offline with
API Gateway HTTP API (payload 2.0) events against a loopback dynalite, answered 401 unsigned,
401 wrong signature, 200 signed, 200 signed with a body the gateway base64 encoded, and the row
read back with the new price, `available true`, `cartPermalinkUrl` null.

**Not run:** `terraform fmt`, `validate`, `plan`. Terraform is not installed on this host.

### 4.5 Going live (each step an approval item; none run)

Environment: dev, account <TREVEAN_DEV_ACCOUNT_ID>, us-east-1, prefix `trevean-dev-<TREVEAN_PREFIX_SUFFIX>`. **The
order matters:** new code first (it fails closed with the old environment), then Terraform,
then the secret, then the subscriptions. Never the other way round: the old code with the
new permissions and a real secret is the handler that damages rows.

**W0. Precondition (client side, outside this repo).** The Shopify custom app on
`dmt009-91.myshopify.com` from section 5, Step 0, with `read_products` and, for
orders/create, `read_orders`. Shopify treats order webhooks as protected customer data, so
the app may need that access approved before the ORDERS_CREATE subscription is accepted.
**Unverified.**

**W1. Build and test the API** (local, no approval needed):

```
cd build/api
npm ci --ignore-scripts
npm test                          # expect 293 passed
npm run typecheck
node scripts/package-lambda.mjs   # prints bytes and sha256; keep the sha256
```

**W2. Deploy the API code** (approval: `deploy.trevean`), as the operations runbook,
section 3, does, to all three API functions so they stay on one build (D58, D65):

```
for f in content-api scan-ingest admin-api; do
  aws lambda update-function-code --function-name trevean-dev-<TREVEAN_PREFIX_SUFFIX>-$f \
    --zip-file fileb://build/api/.lambda-build/api.zip
  aws lambda wait function-updated --function-name trevean-dev-<TREVEAN_PREFIX_SUFFIX>-$f
done
```

Confirm each returned `CodeSha256` equals the packager's sha256. Then `demo-readiness` must
still be 10 passing, 0 failing, and `GET /v1/catalog/caribbean-sunset` must still return the
`dmt009-91.myshopify.com/cart/...` permalink at $18.00. With the old environment the new code
looks for `trevean/api/shopify-webhook-secret`, cannot read it, and answers every signed
delivery 503: inert.

**W3. Terraform** (approval: `deploy.trevean`):

```
cd build/infrastructure/envs/dev
terraform init
terraform validate
terraform plan -out order-webhook.tfplan
```

**Expected plan: 0 to add, 2 to change, 0 to destroy**, both in place:

- `module.stack.module.compute.aws_lambda_function.function["admin_api"]`:
  `environment.variables` gains `SHOPIFY_WEBHOOK_SECRET_NAME = "trevean/dev/shopify-webhook-secret"`.
  Nothing else on the function changes (code is in `ignore_changes`).
- `module.stack.module.compute.aws_iam_role_policy.admin_api`: the policy JSON gains three
  statements, `VerifyShopifyWebhooks`, `CountWebhookOrdersOnDailyRollups` and
  `ClaimWebhookOrderDeliveries`, and loses none.

**If section 5, Step 2 (the catalog sync environment) has not been applied yet, the plan is
0 to add, 3 to change, 0 to destroy**: the third is
`aws_lambda_function.function["catalog_sync"]`, exactly as Step 2 describes, because this
branch contains that change. **Anything else in the plan is drift or someone else's change:
stop and read it.** Then apply the saved plan file.

**W4. Set the signing secret** (approval; done by the holder, out of band):

- Secret: **`trevean/dev/shopify-webhook-secret`** in Secrets Manager (us-east-1). The ARN is
  in the stack's `secret_arns` output or the console.
- Value: **the API secret key (client secret) of the Shopify custom app that creates the
  subscriptions in W6.** Shopify signs an app's subscriptions with that app's client secret.
  It is shown with the app's credentials in the Shopify admin or the Dev Dashboard.
- Stored as the raw string, or as `{"value":"<the key>"}`. Set in the console. **Never on a
  command line, in a file in the repository, or in a message.**
- If the subscriptions are instead created by hand in the store admin (Settings,
  Notifications, Webhooks), Shopify signs them with the key shown on that page, and that key
  goes here instead. **Use one method only**: two subscriptions for one topic means two
  signing keys (one of them always 401) and, for orders, two webhook ids per order.
- Until it is set, every signed delivery answers 503.

**W5. Check the endpoint** (approval; calls our own API only, not Shopify):

```
API=$(aws lambda get-function-configuration --function-name trevean-dev-<TREVEAN_PREFIX_SUFFIX>-admin-ui \
  --query Environment.Variables.API_BASE_URL --output text)
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$API/internal/webhooks/shopify/products-update" \
  -H 'content-type: application/json' -d '{}'          # expect 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$API/internal/webhooks/shopify/orders-create" \
  -H 'content-type: application/json' -d '{}'          # expect 401
```

A 500 or 502 here is a stop: read `/aws/lambda/trevean-dev-<TREVEAN_PREFIX_SUFFIX>-admin-api`.

**W6. Register the two subscriptions** (approval; writes to the client's store, through the
custom app's Admin API token, the same one as section 5, Step 0):

| Topic (GraphQL enum) | Address | Format |
|---|---|---|
| `PRODUCTS_UPDATE` (`products/update`) | `$API/internal/webhooks/shopify/products-update` | JSON |
| `ORDERS_CREATE` (`orders/create`) | `$API/internal/webhooks/shopify/orders-create` | JSON |

`$API` is the `https://<id>.execute-api.us-east-1.amazonaws.com` value from W5. With Admin
GraphQL, one `webhookSubscriptionCreate` per row (the address field is `callbackUrl` in
older API versions and `uri` in newer ones; check against the version used):

```
mutation {
  webhookSubscriptionCreate(
    topic: PRODUCTS_UPDATE
    webhookSubscription: { callbackUrl: "<$API>/internal/webhooks/shopify/products-update", format: JSON }
  ) { webhookSubscription { id topic } userErrors { field message } }
}
```

Then the same for `ORDERS_CREATE` and `/orders-create`. Record both subscription ids.

**After W6, check** `/aws/lambda/trevean-dev-<TREVEAN_PREFIX_SUFFIX>-admin-api` for
`shopify product update applied` or `skipped` (with its reason) on the next product edit,
and for `shopify webhook signature rejected` (wrong key in W4) or `secret unavailable` (W4
not done or W3 not applied). Deliveries ignored as `shop_not_allowed` mean
`SHOPIFY_STORE_DOMAIN` is not the shop's myshopify host; `dmt009-91.myshopify.com` was set on
7 October (D64, D65).

**Rollback.** Fastest: `webhookSubscriptionDelete` for the two subscription ids, after which
nothing calls the endpoint. A products/update that wrote a wrong value is restored the same
way as the sync (section 6): `update-item` on the CATALOG# key, SET only the attributes in the
logged `changes.from`. Order counters are additive: subtract with an `ADD` of the negative
values on the logged rows. Code: redeploy the archive built from the commit deployed on
7 October (D65), with the subscriptions deleted first.

### 4.6 Open risks

1. **No real delivery has ever been received.** The REST payload shape (no `variant.available`,
   numeric `variant_id` on order lines) is from Shopify's documentation and this package's
   fixtures, not from this store.
2. **Out of order deliveries.** Shopify does not guarantee order. An older products/update
   that arrives late overwrites newer values until the next delivery or sync run. A guard on
   `updated_at` would need an attribute the sync also maintains; not done.
3. **Body limit.** The API refuses bodies over 256 KiB (413). A product with a very long
   description or many images could exceed it and never be applied. Unknown for this store.
4. **Under count, never double count.** If the function dies between an order's claim and its
   ADD, that row misses one order. Raw orders are not stored, so there is no backfill source
   other than Shopify itself.
5. **The order counters are recorded, not shown.** The dashboard reads scan rollups; nothing
   reads `orders` or `units` yet. The cart's channel (`note_attributes`) is not read.
6. **`admin_api` still has unconditioned write on all of SpiceBlends** (pre-existing, for the
   editorial admin). The webhook code builds only `CATALOG#` keys; IAM does not enforce that
   for this function.
7. **Rotation.** The secrets module classes this secret "overlap two values"; the API accepts
   one. Rotating means a short window of 401s, which Shopify retries through.
8. **Shopify retries for a limited time and can remove a subscription that keeps failing**, so
   W4 must be done before W6, and a long 503 outage can cost deliveries.
9. **Terraform not validated** on this host (not installed). The HCL follows the existing
   statements' shape and `fmt` alignment by hand.
10. **Protected customer data** approval for orders/create on this custom app: unknown (W0).

---

## 5. Deploy steps (each one an approval item; none run)

Environment: dev, account <TREVEAN_DEV_ACCOUNT_ID>, us-east-1, prefix `trevean-dev-<TREVEAN_PREFIX_SUFFIX>`.

### Step 0. Precondition: an Admin API token exists (client side, outside this repo)

- A custom app on `dmt009-91.myshopify.com` with at least `read_products`. `read_inventory`
  is probably also needed for `inventoryQuantity` and `inventoryItem.tracked`. **Unverified.**
- Jacob has a staff account. Creating an app needs the "develop apps" permission from the
  store owner, and Shopify may now require the Dev Dashboard rather than the admin for new
  custom apps. Confirm at the time.
- The token goes into `trevean/dev/shopify-admin-api-token` (Secrets Manager), set out of
  band by its holder in the console, as the raw token string. Never on a command line, in
  a file in the repo, or in a message. Until it is set, the function stops with "still
  holds the terraform placeholder" and never calls Shopify.

### Step 1. Build the package

```
cd build/shopify
npm ci --ignore-scripts
npm test                       # expect 277 passed
npm run typecheck
npm run package:catalog-sync   # prints bytes and sha256; keep the sha256
```

### Step 2. Terraform: environment only, still dry run (approval: `deploy.trevean`)

```
cd build/infrastructure/envs/dev
terraform init
terraform validate
terraform plan -out catalog-sync-env.tfplan
```

**Expected plan: 0 to add, 1 to change, 0 to destroy.** The one change is
`module.stack.module.compute.aws_lambda_function.function["catalog_sync"]`, in place,
`environment.variables` gaining `CATALOG_SYNC_DRY_RUN = "true"` and
`SHOPIFY_ADMIN_TOKEN_SECRET_NAME = <arn of trevean/dev/shopify-admin-api-token>`. No IAM
change, no EventBridge resource. **Anything else in the plan is drift or someone else's
change: stop and read it before applying.** Then `terraform apply catalog-sync-env.tfplan`.

### Step 3. Code: replace the placeholder (approval: `deploy.trevean`)

```
aws lambda update-function-code --function-name trevean-dev-<TREVEAN_PREFIX_SUFFIX>-catalog-sync \
  --zip-file fileb://build/shopify/.lambda-build/catalog-sync.zip --publish
aws lambda wait function-updated --function-name trevean-dev-<TREVEAN_PREFIX_SUFFIX>-catalog-sync
```

Confirm the returned `CodeSha256` equals the packager's sha256. Only catalog_sync changes;
content-api, scan-ingest, admin-api, admin-ui and shopify-webhook are untouched. Steps 2
and 3 are safe in either order: the code is a dry run unless the variable says `false`.

### Step 4. First live run: a dry run (approval: it calls the Shopify Admin API, read only)

```
aws lambda invoke --function-name trevean-dev-<TREVEAN_PREFIX_SUFFIX>-catalog-sync \
  --cli-binary-format raw-in-base64-out --payload '{"dryRun":true}' \
  --log-type Tail out.json
```

Then read `/aws/lambda/trevean-dev-<TREVEAN_PREFIX_SUFFIX>-catalog-sync` in CloudWatch. Check:

- `catalog sync starting, DRY RUN` with `adminDomain dmt009-91.myshopify.com`.
- One `DRY RUN: catalog row would be updated` per mirrored blend, and for each, the
  `changes`. Against the 7 October values (D64, D65: all $18.00, so `priceAmount 1800`,
  the four verified variant ids) the expected change set is empty or explainable. **Any
  `shopifyVariantId` or `shopifyProductId` change, or any `product_id_mismatch` or
  `variant_id_mismatch` skip, is a stop.**
- `missingSlugs`, `unmatched` and `warnings` in the final line. A blend in `missingSlugs`
  means the store's product could not be matched (no product id on the row, and the handle
  and tags are not the slug): fix with `CATALOG_SYNC_PRODUCT_MAP` rather than guessing.
- A GraphQL error naming a field means the pinned API version (`2025-01`) or the scopes
  do not serve the query. See "Unknowns".

Before Step 5, save the five rows (read only) as the rollback copy:

```
for s in persian-sunrise caribbean-sunset north-african-night-market silk-road kyoto-garden; do
  aws dynamodb get-item --table-name <SpiceBlends table name> \
    --key "{\"pk\":{\"S\":\"CATALOG#$s\"},\"sk\":{\"S\":\"v0\"}}" > catalog-row-$s-before.json
done
```

(The table name is the function's `TABLE_SPICE_BLENDS` environment variable.)

### Step 5. Turn writes on and run once by hand (approval: `prod_db_write.trevean`)

`terraform.tfvars` in `envs/dev`: `catalog_sync_dry_run = false`. Plan: **0 to add, 1 to
change, 0 to destroy** (`CATALOG_SYNC_DRY_RUN` becomes `"false"`). Apply, then:

```
aws lambda invoke --function-name trevean-dev-<TREVEAN_PREFIX_SUFFIX>-catalog-sync \
  --cli-binary-format raw-in-base64-out --payload '{}' out.json
```

Check: each row now has `syncSource shopify-sync-...`, `cartPermalinkUrl` still null,
`GET /v1/catalog/caribbean-sunset` still returns the `dmt009-91.myshopify.com/cart/...`
permalink and the right price, and `demo-readiness` is still 10 passing, 0 failing.

### Step 6. Turn the schedule on (approval: `deploy.trevean`)

`terraform.tfvars`: `catalog_sync_schedule_expression = "rate(1 hour)"`. Plan: **3 to add,
0 to change, 0 to destroy**: `aws_cloudwatch_event_rule.catalog_sync[0]`,
`aws_cloudwatch_event_target.catalog_sync[0]`,
`aws_lambda_permission.catalog_sync_schedule[0]`. Apply. Cadence is not agreed with the
client (README, "What the client must decide", item 3); hourly is the package default.

---

## 6. Rollback

- **Stop writing, fastest:** set `catalog_sync_dry_run = true` and apply (1 change), or
  `aws lambda put-function-concurrency --function-name trevean-dev-<TREVEAN_PREFIX_SUFFIX>-catalog-sync
  --reserved-concurrent-executions 0` (stops every invocation at once; undo with
  `delete-function-concurrency`). Both are approval items.
- **Stop the schedule:** `catalog_sync_schedule_expression = null`, apply: 3 to destroy.
- **Restore rows:** the before values are in the Step 4 files and in every run's log
  (`changes.from`). Restore with `update-item` on the CATALOG# keys only, SET only the
  attributes that changed, the same way as 7 October (D65). Never `seed-dynamodb.mjs`.
  Point in time recovery is enabled by default in the data module
  (`enable_point_in_time_recovery = true`); that it is on in the live table is not
  verified (`aws dynamodb describe-continuous-backups`, read only).
- **Code:** usually unnecessary (dry run plus no schedule makes the code inert). If needed,
  `update-function-code` with `build/infrastructure/modules/compute/.build/placeholder.zip`
  (Terraform writes it on plan) or a previous published version's code.

---

## 7. Unknowns and open risks

1. **The Admin API has never been called.** `HttpAdminTransport` and the AWS adapters in
   `src/lambda/aws.ts` have never executed; everything above them is tested against
   simulated responses and an in memory table.
2. **No Admin API token is known to exist.** A staff account is not a token. Step 0 is a
   client side dependency.
3. **API version `2025-01` is pinned and is likely past Shopify's support window** by
   October 2026. Shopify then serves the oldest supported version instead, so field
   availability is not guaranteed. The Step 4 dry run is where this shows. A newer
   version needs `SHOPIFY_ADMIN_API_VERSION` on the function (not yet wired in Terraform).
4. **Scopes:** `read_products`, and probably `read_inventory`. Unverified.
5. **Multi variant products.** D65 records the live variant as "46 g / Black", so live
   products may have several variants. The sync keeps whatever variant the row already
   points at, and refuses to repoint a row whose variant disappears; it does not decide
   which variant a new row should use.
6. **Product matching** relies on the rows' `shopifyProductId`. If the 7 October rows hold
   no product id, matching falls back to handle and tag, which are unknown for this store.
   Unmatched blends are reported and left alone.
7. **Currency** is taken from configuration (`USD`), not from the store.
8. **AWS SDK version** is whatever the nodejs22.x runtime ships; not pinned.
9. **Draft rule changes behaviour on purpose:** a blend set to DRAFT in Shopify will show
   `available false`, `out_of_stock` after the next run. On 7 October all five were active.
10. **Terraform not validated** on this host (not installed).
11. **Webhooks:** see section 4. Reconciled with this package on 14 October 2026
    (`fleet/order-webhook`), not deployed; its own risks are in section 4.6.
12. **Low stock** stays off (`SHOPIFY_LOW_STOCK_THRESHOLD` unset), so in stock items read
    `in_stock` whatever the quantity.
