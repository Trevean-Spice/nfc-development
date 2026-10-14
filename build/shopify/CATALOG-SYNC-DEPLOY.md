# Catalog sync: what changed, and how to deploy it after approval

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
probe gate, `build/api` (including its inline webhook routes), IAM policies, DNS, secrets.

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

**Short answer: no webhook path is live, nothing registers webhooks with the store, and
the one handler that is deployed must not be subscribed as it stands.**

### shopify_webhook Lambda

- Still the inert placeholder (D58 lists it with catalog_sync and media_derivatives; no
  package has been built for it).
- **No way in:** not in `http_invoke_functions` (no function URL), no API Gateway route,
  no CloudFront behaviour. Shopify cannot reach it.
- Its IAM grants `CATALOG#*` and `ORDER#*` on SpiceBlends. Order attribution (both in
  `build/api` and in this package) writes `ROLLUP#` counters into ScanEvents, which this
  role cannot do. If this function becomes the endpoint, its policy needs changing.

### The API's inline handler (`build/api/src/routes/webhooks.ts`)

- In the API build deployed on 7 October (D65) to content-api, scan-ingest and admin-api.
- **Reachable on the public internet** only through the admin API's HTTP API, whose route
  is `$default` (`https://<admin-api id>.execute-api.us-east-1.amazonaws.com/internal/webhooks/shopify/...`).
  CloudFront forwards `/v1/*` only, and the content and scan function URLs are AWS_IAM.
- **Every delivery there would fail closed (500):** `SHOPIFY_WEBHOOK_SECRET_NAME` is not
  set by Terraform, so it reads `trevean/api/shopify-webhook-secret`, which is not the name
  the secrets module creates (`trevean/dev/shopify-webhook-secret`), and the admin_api
  role has no `GetSecretValue` on any Shopify secret.
- **And it would do damage if the secret were fixed:** products-update does a full
  `PutItem` of the CATALOG# row (admin_api has unconditioned write on SpiceBlends) and
  reads availability from `variant.available`, which Shopify's REST product payload does
  not carry (per this package's README, not verified against a live delivery), so every
  product update would mark the blend unavailable and drop attributes the sync owns.
  orders-create writes ROLLUP# to ScanEvents, where admin_api is read only, so it would
  fail.

### What registers webhooks

Nothing. No script, no Terraform, no Shopify app configuration in this repository (searched
for `webhookSubscriptionCreate`, webhook TOML and registration code). The topics and routes
are only declared in `src/webhooks/topics.ts`.

### The exact step needed, not done

1. **Decide the endpoint** (a design decision, not made here): either (a) give
   shopify_webhook real code built on this package (`verifyWebhook`,
   `handleProductsUpdate`, `attributeOrder`), a public entry point Shopify can call (a
   function URL with auth NONE or an HTTP API route, because Shopify cannot sign SigV4),
   a ROLLUP# grant on ScanEvents and a conditional writer like the sync's; or (b) change
   the API's inline handler to delegate to this package and give admin_api the webhook
   secret. (a) keeps the least privilege design.
2. **Put the signing secret** in `trevean/dev/shopify-webhook-secret`, out of band.
   Which secret signs depends on how the subscription is created: an app created
   subscription is signed with that app's client secret; one created in the store admin
   under Notifications, Webhooks is signed with the key shown on that page.
3. **Register** two subscriptions with the store, for example with the custom app's token
   through Admin GraphQL `webhookSubscriptionCreate` for `PRODUCTS_UPDATE` and
   `ORDERS_CREATE`, callback URLs ending `/internal/webhooks/shopify/products-update` and
   `/internal/webhooks/shopify/orders-create`, format JSON. orders/create needs order
   access on the app, and Shopify gates order webhooks behind protected customer data
   settings; whether that applies to this app is unknown.

**Do not register products/update against the current admin API endpoint.** The hourly
sync below makes prices follow the store without any webhook, so webhooks are optional for
the catalog and needed only for order attribution.

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
11. **Webhooks:** see section 4. The admin API's inline products-update handler would
    damage rows if it ever received verified deliveries; reconciling it with this package
    is outstanding work.
12. **Low stock** stays off (`SHOPIFY_LOW_STOCK_THRESHOLD` unset), so in stock items read
    `in_stock` whatever the quantity.
