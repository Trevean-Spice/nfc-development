# Trevean Spice Shopify Plus integration

Node and TypeScript. Implements the three jobs and three tools in the Architecture
document, "Shopify Plus", against the frozen M1 API contract, version 1.0.0.

This directory is self contained and portable: it carries its own copy of the frozen
OpenAPI document, its own fixtures, and its own tests. It can be moved into the client's
`nfc-development` repository as a directory. It has **no runtime dependencies at all**.

---

## Read this first

**We do not have Shopify Plus store access or credentials.** That is an outstanding client
dependency, listed in the Scope document, "What Trevean provides", and it has not been
delivered. What follows is written so that the line between what is proven and what is not
is visible without reading the code.

**Nothing in this component has ever spoken to a Shopify store.** No claim below is a claim
about Trevean's catalog, prices, SKUs, product handles, or webhook deliveries.

| Part | Status | Evidence |
|---|---|---|
| **Cart permalink construction** | **Proven.** Pure string building, no network, no credentials. | 40 tests, `test/permalink.test.ts`. The frozen contract's own `CatalogEntry` example is reproduced byte for byte. |
| **Webhook signature verification** | **Proven.** Pure cryptography over bytes we are given. | 39 tests, `test/webhook-verify.test.ts`, including six RFC 4231 known-answer vectors for HMAC-SHA-256. |
| **Reorder target resolution, including the no destination state** | **Proven**, and asserted against the real content fixtures in `build/content`. | 20 tests, `test/reorder.test.ts`. |
| **Money conversion and identifier handling** | **Proven.** | 33 tests, `test/ids-and-money.test.ts`. |
| **Order attribution and the no PII property** | **Proven** on a simulated payload deliberately stuffed with personal data. | 23 tests, `test/webhook-handlers.test.ts`. |
| **Storefront cart request building** | **Proven** as request construction. The request has never been sent. | 13 tests, `test/storefront-cart.test.ts`. |
| **Catalog sync: pagination, mapping, cost handling, retries** | **Proven against a simulated response shape.** The response shape itself is unverified. | 28 tests, `test/catalog-sync.test.ts`. |
| **Contract conformance of everything the mirror produces** | **Proven** against the schema compiled from the frozen document. | 8 tests, `test/contract.test.ts`. |
| **Configuration wiring** | **Proven.** | 10 tests, `test/config-wiring.test.ts`. |
| **No credential, key or token in any file** | **Proven** by a scan of the whole package. | 20 tests, `test/no-secrets.test.ts`. |
| **`HttpAdminTransport` and `HttpStorefrontTransport`** | **UNPROVEN. Never executed.** | None, and there will not be any until store access lands. A test that mocks `fetch` would prove only that the mock was called. |

Observed on Friday 4 September 2026, Node 20.19.0, vitest 2.1.9: **234 tests across 10
files, all passing**, wall clock 1.6 s, with no network, no AWS account, no Docker and no
credentials. `npm run typecheck` is clean.

---

## The three jobs and three tools

### 1. One tap reorder is a cart permalink

A URL that pre-fills a cart and drops the customer into checkout.

```
https://shop.treveanspice.com/cart/41802938471233:1?channel=nfc
```

Zero API calls, zero client credentials, zero latency, nothing to fail at request time, and
it bakes into the pre-rendered page. Deliberately boring, and the boring is the point: it
is the primary conversion action on a page whose entire design exists to avoid a live call,
so it must not depend on one. `src/permalink.ts`, `src/reorder.ts`.

**Why it is validated rather than interpolated.** The output is an `href` on a page a
customer taps two seconds after touching a jar. Every component is checked as a whole
value: the storefront base must be a bare `https` origin on an allowlist, a variant id is
digits only against a regex, a quantity is a bounded integer, and every query value goes
through `URLSearchParams`. Without the first of those, one wrong environment variable
points the reorder button at another checkout, on every jar, and the page still looks
perfect. There are 12 refusal cases in the test file for variant ids alone.

### 2. Anything richer uses the Storefront API

Multi-item carts, discount codes, and subscription selling plans. `src/storefront/`.

Each of these is something a permalink genuinely cannot do. A permalink carries one
discount code with no way to read back whether it was valid, gives no cart id so nothing
can be modified afterwards, and **cannot attach a selling plan at all**. The permalink
builder therefore refuses a selling plan rather than dropping it, because dropping it
silently sells a subscription as a one-off.

`buildCartCreate` takes a country code on `buyerIdentity` and nothing else. No email, no
phone, no customer access token. Subscription billing, customer accounts and customer login
are out of scope; reorder runs through Shopify's own checkout, which means Shopify holds
the customer relationship and this system holds none of it. Widening that object is how
that stops being true.

### 3. Catalog sync uses the Admin API

Products, variants, prices and availability mirrored into DynamoDB on a schedule and on
product-update webhooks, so Shopify latency is never inside the 2.0 second budget and a
Shopify incident degrades a price label rather than breaking a page. `src/admin/`,
`src/mirror/`.

`syncCatalog` walks the Admin GraphQL API, maps what it finds, and returns records plus a
report. **It does not write.** Persistence belongs to the API component, which owns the
DynamoDB client and the `CATALOG#` key namespace, and keeping the write out of here is what
lets the whole sync be tested without a database as well as without a store.

**Added 14 October 2026, not yet deployed:** the catalog_sync Lambda itself,
`src/lambda/catalogSyncHandler.ts`, with a conditional writer in `src/sync/` that updates
only existing `CATALOG#` rows and only the attributes the mirror owns, dry run by default,
and its own packager (`npm run package:catalog-sync`). It still adds no dependency: the
AWS SDK is the one in the Lambda runtime. What changed, the test results, the deploy steps
and what is still unknown: `CATALOG-SYNC-DEPLOY.md`.

### 4. Order webhook, signature verified

`src/webhooks/`. Feeds reorder attribution, per SKU.

---

## The degradation property, and the test that defends it

The catalog mirror is read **after paint, never on the tap critical path**, and if it fails
the page is still a good page. That is access pattern 8 in the Architecture document, "Data
layer", and the frozen contract marks the operation `x-tap-path: after-paint-optional`.

`toApiCatalogEntry` makes exactly two changes when an entry goes stale: `stale` becomes
true, and `inventoryStatus` becomes `unknown`, because availability is the field that goes
bad fastest and claiming `in_stock` from a three hour old read is a claim we cannot support.
That matches the frozen contract's own `staleMirror` example.

**Price is kept.** A slightly old price labelled stale is useful and honest; removing it
leaves a blank where a number was, which reads as broken rather than as old.

**The cart permalink is kept, unconditionally.** It is a static URL derived from a variant
id, it needs no API call, and a Shopify outage has no bearing on whether it works. Blanking
it would disable the primary conversion action for a reason that does not apply to it.
There is a test asserting exactly this, and it exists because the tempting one-line "if
stale, clear everything" is wrong in a way nobody would notice until reorders stopped.

---

## The reorder button has no destination today, and that is rendered honestly

Content fixtures in `build/content` carry **null Shopify product ids and null variant ids**
on all five blends, because there is no store access. A cart permalink is derived from a
variant id. **Until a variant id exists there is no permalink, so the reorder button has no
destination.**

There are three ways to handle that and two of them are wrong.

- **Wrong: render it anyway**, pointing at the shop home page or at `/cart`. It looks
  finished, it demos well, and it sends a customer who just tapped a jar to a page that does
  not have their blend in a cart. The failure is invisible to us and visible to them.
- **Wrong: hide it.** The page then changes shape depending on data nobody is looking at,
  the layout moves the day a variant id lands, and an outstanding contracted dependency
  becomes invisible.
- **Right: render it disabled and labelled**, in the position and at the size it will occupy
  when it works. That is the placeholder render contract the consumer blend page already
  implements, and `resolveReorderTarget` is the decision that drives it.

`resolveReorderTarget` returns a discriminated union rather than a string or a null, so a
caller cannot use the result without handling the unavailable case. That is the property
that stops a dead button reaching a jar.

`test/reorder.test.ts` reads the real fixtures out of `build/content` and asserts the
durable invariant: **a fixture with no variant id must never produce a destination.** When
real ids land, that test keeps passing and starts proving the other branch instead. It also
records the state as measured rather than typed: on 22 August 2026, zero of five blends
have a reorder destination.

One deliberate subtlety. `available: false` in those fixtures means "we cannot say it is
available", not "it is out of stock", per `build/content`'s own fixture notes. So
`disableWhenUnavailable` defaults to **false**: treating that as out of stock would disable
every button on every blend for a reason that is not true. Switch it on once the mirror is
fed by a real store, where `false` means what it says.

---

## Webhook signature verification

An unverified webhook endpoint is an open door. There is no bearer token on this surface,
no IP allowlist and no mutual TLS: the signature is the whole of the security posture.
Anyone who learns the URL could otherwise rewrite a price on a customer-facing page or
inject reorder attribution into the analytics the engagement is measured on.

Four things `src/webhooks/verify.ts` gets right, each of which is a way real
implementations get it wrong:

1. **The digest is over the raw body bytes.** Not a parsed object, not `JSON.stringify` of
   one. Re-serialising reorders nothing today and reorders something the day a JSON library
   changes, and then every webhook fails at once with no explanation. `verifyWebhook`
   refuses a non-string, non-Buffer body outright rather than stringifying it for the
   caller's convenience, and there is a test for that refusal.
2. **The comparison is constant time, over decoded bytes.** A fast string compare on an HMAC
   leaks the correct signature one byte at a time to anyone willing to make enough requests,
   and a webhook endpoint is precisely somewhere an attacker can make enough requests.
3. **Verify before parse.** An endpoint that parses first has already allocated memory
   proportional to an attacker-controlled body on behalf of a caller it has not
   authenticated.
4. **The header is shape-checked before decoding.** `Buffer.from(x, 'base64')` is lenient:
   it discards characters it does not recognise and returns a short buffer, so a malformed
   header can decode to something that then gets length-compared. The regex fixes the length
   at exactly one SHA-256 digest. Ten malformed header shapes are tested.

Check order is deliberate: cheap secret-independent rejections, then the signature, then
checks that only make sense on a request already proven authentic. Checking the shop domain
before the signature would let an unauthenticated caller probe which shops the endpoint is
configured for, and there is a test asserting it does not.

**The vectors come from RFC 4231**, a source outside this repository. That matters: a test
that signs with our own code and verifies with our own code proves only that the two halves
agree with each other, which they would even if both were wrong.

### What signature verification cannot do, stated rather than assumed

**Shopify's HMAC covers the body only. It carries no timestamp, so a captured request
replays forever and no signature check can detect it.** Replay protection is webhook-id
deduplication, which needs somewhere to keep state. The hook is provided
(`hasSeenWebhookId`) and is not wired to a store, because where that state lives is a
decision, not a default. See "What the client must decide", item 5.

**Supplying `hasSeenWebhookId` fails closed on a missing id.** A delivery with no
`X-Shopify-Webhook-Id` is refused with `missing_webhook_id` rather than accepted. It used to
be accepted, which meant deleting one header from a captured delivery bypassed the only
replay control this package has, on a signature that never expires. Shopify sends the header
on every delivery, so the only requests this refuses are ones Shopify did not send or ones
something stripped the header from. Callers that do not supply the hook are unaffected: no
guard was asked for, so an absent id is still accepted and still reported as `null`.

### Binding the two allowlists

`allowedStorefrontHosts` and `allowedShopDomains` are configuration, and configuration that
nothing reads is worse than no configuration, because the deployment check goes green on a
guard that does not exist. Three helpers in `config.ts` bind them to the code that enforces
them, and they are the supported way to build the options objects:

```ts
syncCatalog(catalogSyncOptionsFromConfig(config, { transport, knownSlugs }));
mapProductToMirror(product, mapOptionsFromConfig(config, { slug, syncedAt, syncSource }));
verifyWebhook(rawBody, headers, verifyOptionsFromConfig(config, secret, { allowedTopics }));
```

`validateConfig` also runs the configured `storefrontBase` through the same normaliser the
permalink builder uses, so a base the allowlist refuses is a reported configuration problem
rather than two present fields that happen to disagree.

---

## No personal data leaves the order handler

An `orders/create` payload is the largest concentration of customer personal data anywhere
near this system: email, phone, billing and shipping addresses, full name, IP address,
browser fingerprint and the whole customer object. The Architecture document, "Security and
privacy", says no PII and no IP storage; the Data model document says no customer PII and no
IP address in any table.

That commitment gets broken by convenience rather than by decision: someone passes the whole
payload to a logger or a rollup writer, and personal data lands in DynamoDB or CloudWatch
where it is now a retention and a deletion problem.

So `attributeOrder` reads an **allowlist of four fields**: `created_at`, `line_items[].sku`,
`line_items[].quantity`, and `note_attributes`. It emits five: `blendSlug`, `sku`,
`quantity`, `channel`, `occurredOn`. The order id and order number are not among them.

`fixtures/webhooks/orders-create.json` is deliberately stuffed with fake personal data, and
the test asserts that none of those ten values appears anywhere in the serialised output,
plus a second test asserting the fixture really does contain them so the first is not
vacuous.

---

## Gaps against the frozen contract

Reported, not silently closed.

### Gap 1: `channel=nfc` on the permalink does not reach the order

The frozen contract's `CatalogEntry` example carries
`https://shop.treveanspice.com/cart/41802938471233:1?channel=nfc`. **Shopify does not
recognise `channel` as a cart permalink parameter**, so it is inert: it reaches nothing,
persists to nothing, and appears on no order. An `orders/create` webhook therefore cannot
tell an NFC-sourced reorder from any other.

The mechanism that would work is `attributes[channel]=nfc`. Cart attributes persist through
checkout onto the order as note attributes, where the order webhook can read them.

**This package defaults to the frozen contract shape.** `attributionMode: 'cart-attributes'`
produces the working form and is off by default, because switching it on changes a value the
frozen contract specifies and that is the client's call. Both forms are built and tested.

**Consequence if it stays as it is:** reorder attribution can say "an order contained
Persian Sunrise on this day". It cannot say "this reorder came from a tap". Given that
Attribution is per SKU anyway, that may be an acceptable answer, but it should be a chosen
one.

### Gap 2: the contract has no home for the multi-variant case

`CatalogEntry` carries one `sku` and one `shopifyVariantId`. If Trevean sells more than one
size of a blend, the mirror stores one of them and the page reorders that one.
`selectVariant` makes the choice explicit (preferred SKU, else first by position) and
records `variantPosition` on the mirror record so a later change of rule is auditable, and
the sync emits a warning when a product has more than one variant. **Extending the contract
to carry a variant list would be a contract revision and has not been made.**

### Gap 3: nothing in the contract maps a Shopify product to a blend slug

The mirror is keyed by our slug. Shopify keys by handle. There is no reason for a Shopify
handle, which is a marketing URL, to equal our blend slug, and the Architecture document has
already recorded one slug mismatch of exactly this kind between the scaffold and the
redirect table (`the-silk-road` against `silk-road`). A wrong slug on a shipped jar is a 404
or the wrong page, and per section 6.1 that fails regardless of speed.

`resolveSlug` implements three ordered strategies: an explicit product-to-slug map, then the
handle, then a tag. **No fuzzy matching and no substring inference**, because substring
matching a SKU against a slug prefix works until the day it maps something else. The
explicit map is the mechanism that should be used in production and it is empty until the
store is visible. See "What the client must decide", item 1.

---

## What awaits Shopify Plus store access

Precisely, so it can be checked off rather than remembered.

1. **The Admin API access token, and confirmation of its scopes.** `read_products` at
   minimum. Nothing here has ever authenticated.
2. **The webhook shared secret**, created with the webhook subscriptions. Until it exists,
   the verification code is proven against RFC vectors but has never checked a Shopify
   signature.
3. **The myshopify admin domain**, and confirmation of the public storefront domain used in
   permalinks. The contract's examples use `shop.treveanspice.com`; whether that is the real
   storefront origin is unconfirmed.
4. **Whether the Admin GraphQL query in `src/admin/queries.ts` is accepted as written**, and
   whether `inventoryItem { tracked }` is available on the pinned API version for this plan.
   The query is built to the documented schema and has never been executed.
5. **Product handles, tags and SKUs.** Every one of these is a property of the store. The
   fixtures use `TRV-{code}-60G` because that is the convention in the frozen contract's
   examples, not because anyone has seen a Trevean SKU.
6. **Real prices, currency and inventory settings.** No price in this component is real.
7. **The webhook subscriptions themselves**, registered against the two topics in
   `src/webhooks/topics.ts`, with the endpoint URLs from the API component.
8. **`HttpAdminTransport` and `HttpStorefrontTransport` executing once against the real
   store.** These are the only two files in the package with no test coverage, deliberately,
   and they are roughly twenty lines of `fetch` each. Pointing the sync at a real store is
   **configuration, not a rewrite**: `syncCatalog` takes an `AdminTransport`, and swapping
   `RecordedAdminTransport` for `HttpAdminTransport` is a one line change at the call site.

Until item 8 happens, **no claim of verified behaviour against a live store is made
anywhere in this component**, and any statement to a client that suggests otherwise is
wrong.

---

## What the client must decide

1. **How a Shopify product maps to a blend.** Handle, tag, metafield, or an explicit map we
   maintain. This is Gap 3 and it is the one with a shipped-inventory consequence.
2. **Whether reorder attribution needs to know the channel.** If yes, the permalink moves to
   `attributes[channel]=nfc` and the frozen contract's `cartPermalinkUrl` example changes.
   This is Gap 1. Cheap now, awkward after the pages are built.
3. **Sync cadence and the staleness threshold.** The default is a three hour threshold,
   chosen as three missed runs of an hourly schedule: one miss is noise, three is a fault
   worth telling the reader about. Both numbers are configuration and neither has been
   agreed.
4. **Whether one blend can have more than one purchasable variant**, and if so which one the
   jar's page reorders. This is Gap 2.
5. **Where webhook replay state lives.** A DynamoDB item with a TTL is the obvious answer and
   costs almost nothing. Note the trap: Shopify retries a failed delivery with the **same**
   webhook id, so a naive guard that rejects every repeat also rejects every legitimate
   retry. The guard must be applied after successful processing, not before.
6. **Whether the after-paint catalog refresh runs at all.** Already open as item 4 in the
   Data model document, section 9. Dropping it is simpler and removes one request from the
   page; keeping it means a price can update without a republish. This component works
   either way.
7. **Low stock threshold**, or whether `low_stock` is used at all. Currently null, meaning
   the distinction is off and everything purchasable reads `in_stock`.
8. **Which Shopify API version to pin.** Currently `2025-01` on both APIs. Pinned rather than
   tracking latest, because an unpinned version changes the payload shape without a deploy,
   which is a production incident that arrives on Shopify's schedule rather than ours.

---

## Running it

```bash
npm install
npm test          # 234 tests, no network, no credentials, no AWS, no Docker
npm run typecheck
npm run licences  # regenerates MANIFEST.md from node_modules
```

There is no `npm run dev`, no local server and no local Shopify. Every test is either pure
computation or a fixture read, which is exactly what makes the whole suite runnable with no
store access.

---

## How it is put together

```
src/
  index.ts                 the public surface
  types.ts                 CatalogEntry, mirrored from the frozen contract
  ids.ts                   GID and numeric id conversion, validated not extracted
  money.ts                 decimal string to minor units, without floating point
  permalink.ts             CART PERMALINK CONSTRUCTION. Pure. Proven.
  reorder.ts               does the button have a destination, and what if not
  config.ts                secret NAMES, never secret VALUES
  mirror/
    product.ts             the normalised product, and the availability rule
    map.ts                 normalised product to mirror record, the one mapping
    degrade.ts             staleness policy, and the permalink that survives it
  webhooks/
    verify.ts              HMAC-SHA-256, constant time, raw body. Proven.
    topics.ts              the two topics, and nothing else
    productsUpdate.ts      REST payload to mirror record
    ordersCreate.ts        per SKU attribution, four fields in, five fields out
  admin/
    transport.ts           THE NETWORK BOUNDARY. Http, Recorded, Failing.
    queries.ts             one GraphQL document, minimum field list
    catalogSync.ts         pagination, cost aware waiting, retries, partial results
  storefront/
    transport.ts           the network boundary again
    cart.ts                cartCreate request building, pure
fixtures/
  vectors/                 RFC 4231 known-answer HMAC vectors
  admin/                   SIMULATED Admin API responses, labelled as such
  webhooks/                SIMULATED webhook payloads, labelled as such
openapi/openapi.yaml       byte identical copy of the frozen contract
```

### On the fixtures

The Admin API fixtures are **simulated, not recorded**. There is no store to record from.
They are hand built to the documented response shape and say so in their own `_fixture`
block, which also names what each one is there to exercise: an untracked variant, a two
variant product, a product that resolves by tag rather than handle, an out of stock variant,
a price that cannot be converted to minor units exactly, and a throttle bucket below the
floor. They prove that pagination, cost handling and mapping behave correctly on a response
of that shape. **They are not evidence about Trevean's catalog.**

### Relationship to the API component

`build/api` already carries a small inline Shopify webhook handler at
`/internal/webhooks/shopify/*`, written before this component existed. That handler and this
one differ in three ways worth reconciling when the two are wired together, and none of them
is urgent:

- it derives availability from a `variant.available` field that the REST payload does not
  carry, where this component derives it from `inventory_management`, `inventory_policy` and
  `inventory_quantity`;
- it converts price with `Math.round(parseFloat(x) * 100)`, which is correct for two-decimal
  currencies and wrong for JPY and KWD, where this component converts on the string;
- it maps a SKU to a blend by substring inference, where this component requires an explicit
  map.

`build/api` was not modified. The reconciliation is a small change on its side to delegate
to this package, and it belongs in a commit that says so.

---

## Related documents

Cross-references are by document title and section number, never by filename.

- The Architecture document, "Shopify Plus", "Rendering", "Data layer", "Security and privacy"
- The frozen API contract, `CatalogEntry` and `GET /v1/catalog/{slug}`
- The Data model document, sections 3.1 and 4.3
- The Acceptance criteria document, section 6.2
- The Scope document, "In scope" item 7, and "IP and handoff"
