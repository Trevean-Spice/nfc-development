# The `/t/{code}` and `/q/{code}` redirect, served by Vercel

> **Placeholders.** Values in angle brackets, such as `<TREVEAN_DEV_ACCOUNT_ID>`, `<TREVEAN_MANAGEMENT_ACCOUNT_ID>`, `<TREVEAN_ORG_ID>`, `<TREVEAN_MANAGEMENT_ROOT_EMAIL>`, `<TREVEAN_DEV_ROOT_EMAIL>`, `<TREVEAN_PREFIX_SUFFIX>` and `<TREVEAN_DISTRIBUTION_DOMAIN>`, stand in for Trevean's real AWS identifiers. The real values are in Trevean's private record, not in this public repository.

This package serves the 1,000 encoded spice jars from the client's existing Vercel project, so the jars work now rather than waiting on an AWS environment.

**Corrected Thursday 27 August 2026.** This line said the jars were waiting on an AWS account that does not exist yet. **The account existed throughout:** `<TREVEAN_DEV_ACCOUNT_ID>` is `Trevean-NFC-Development`, and the Organization management account is `<TREVEAN_MANAGEMENT_ACCOUNT_ID>`. The development environment applied into it on Thursday 27 August 2026. **The reason for this package is unchanged and it was never the account:** Vercel needs no certificate and no nameserver change, so it is the fastest route to working jars on the real domain. See "Decision log", D25 and D32.

It is a **sibling** of `build/edge`, not a replacement for it. `build/edge` is the CloudFront implementation and is untouched. Both compile the same table into two serving surfaces.

Approved by the client on Tuesday 25 August 2026: "I am comfortable with your recommendation to serve the five tag routes through Vercel now, so the existing jars can work without waiting for the AWS environment."

---

## The one rule

**`build/edge/redirect-table.json` is the single source of truth.** This package reads it across the package boundary and never copies it. There is no redirect table in this directory and a test asserts one never appears.

That is not tidiness. "M1 Deliverable 3: Redirect-Serving Decision and Apex Domain Routing", section 6, failure mode 2, is a host migration that leaves the redirect table behind: nothing breaks on the deploying side, everything comes up green, and a thousand jars already in customers' kitchens are stranded. Moving the serving host is precisely what is being done here, so the table is read rather than forked.

`dist/` is generated. Never edit it. `npm run build:check` fails if it has drifted from the table.

---

## Layout

| Path | What it is |
|---|---|
| `lib/table.mjs` | Loads the canonical table from `build/edge`. Holds the five blend slugs transcribed from Scope. |
| `lib/variants.mjs` | Enumerates the request paths each row must answer, and why they are enumerated rather than pattern matched. |
| `lib/compile.mjs` | Compiles the table into Vercel configuration, and refuses to emit anything that breaks a guarantee. |
| `lib/router.mjs` | An exact model of the part of Vercel's router this configuration uses, so the routing tests mean something. |
| `lib/checks.mjs` | The pass, note and fail judgements the live verification makes, kept pure so they are themselves tested. |
| `src/not-found.html` | The branded 404 page. Self contained: no script, no stylesheet, no font, no external request. |
| `dist/vercel.json` | **The deployable file.** Complete, drop in whole. |
| `dist/redirects.json` | The `redirects` array alone, to merge into a project that already has a `vercel.json`. |
| `dist/404.html` | The branded 404 page, for the project's site root. |
| `scripts/build.mjs` | Compiles the table into `dist/`. `--check` fails on drift. |
| `scripts/verify-live.mjs` | Checks all five codes on both routes against a live deployment. |
| `ADOPTION.md` | **What the client actually has to do.** Written for someone who is not technical. |
| `MANIFEST.md` | Third party libraries and their licences, for the SOW section 7 background IP obligation. |

---

## Commands

```
npm run build          compile the table into dist/
npm run build:check    fail if dist/ has drifted from the table
npm test               the test suite
npm run ci             build:check, then test
npm run verify -- --base https://treveanspice.com
```

Node 20 or newer. No dependencies, no `node_modules`, nothing to install.

---

## What it serves

| Request | Response |
|---|---|
| `/t/ps` | `307` to `/blend.html?blend=persian-sunrise&via=nfc` |
| `/t/cs` | `307` to `/blend.html?blend=caribbean-sunset&via=nfc` |
| `/t/sr` | `307` to `/blend.html?blend=silk-road&via=nfc` |
| `/t/nm` | `307` to `/blend.html?blend=north-african-night-market&via=nfc` |
| `/t/kg` | `307` to `/blend.html?blend=kyoto-garden&via=nfc` (reserved, no jar carries it) |
| `/q/{code}` | The same five destinations, carrying `via=qr` instead of `via=nfc` |
| Anything else under `/t/` or `/q/` | `404`, with the branded not found page |

**Five blends, confirmed by the client on Tuesday 25 August 2026. Four are on physical tags.** `/t/kg` is reserved: it resolves, but no jar in the shipped run carries it.

---

## 1. How Vercel expresses a 307, and how that was verified

**Mechanism: the `redirects` array in `vercel.json`, with an explicit `"statusCode": 307` on every entry.**

```json
{ "source": "/t/ps", "destination": "/blend.html?blend=persian-sunrise&via=nfc", "statusCode": 307 }
```

Vercel offers two ways to say 307 and they are mutually exclusive. From the `vercel.json` redirect object reference:

> `permanent` An optional boolean to toggle between permanent and temporary redirect (default `true`). When `true`, the status code is 308. When `false` the status code is 307.

> `statusCode` An optional integer to define the status code of the redirect. Used when you need a value other than 307/308 from `permanent`, and therefore cannot be used with `permanent` boolean.

So `permanent: false` and `statusCode: 307` both produce a 307, and setting both is invalid. `statusCode` is separately documented as accepting 301, 302, 303, 307 or 308, so 307 is a permitted value and not an abuse of the field.

**`statusCode: 307` was chosen over `permanent: false` for two reasons.**

1. **It names the number the specification names.** Whoever opens `dist/vercel.json` in six months sees `307` on every line. `permanent: false` requires knowing that the negation of "permanent" is 307 and not 302, which is a piece of Vercel trivia standing between a reader and the one number in this project that must never be wrong.
2. **The documented default of `permanent` is not consistent, and its unsafe direction is the catastrophic one.** The `vercel.json` redirect reference says the default is `true`, meaning 308. The bulk redirect reference says the default is `false`, meaning 307. A redirect entry that lost its `permanent` line in an edit could therefore become a **308 permanent redirect**, which browsers cache and which would make the destination un-editable on every device that had ever tapped a jar. An entry that lost its `statusCode` line has no such failure direction available to it. Being explicit removes the question rather than answering it.

The build enforces both halves of this. `lib/compile.mjs` throws if any entry declares `permanent` in either sense, and throws if any entry declares a status other than 307. `test/routing.test.mjs` asserts the string `"permanent"` does not appear in the deployable file at all.

**What was verified, and what was not.** The mechanism, the two spellings, their mutual exclusivity and the permitted `statusCode` values were read from Vercel's own current documentation rather than assumed, and the relevant sentences are quoted above. The status code that a deployed Vercel host actually returns has **not** been observed, because that requires the configuration to be adopted into the client's project and deployed, which has not happened yet. That observation is exactly what `scripts/verify-live.mjs` exists to make, and it is the first thing to run after adoption. Nothing in this README claims a 307 was seen on the wire.

### Mechanisms considered and rejected

| Mechanism | Why not |
|---|---|
| **Middleware** (`middleware.js`, Vercel's edge compute) | It would work, and it is the only option that could reproduce every CloudFront property including dropping the query string. It is rejected because it puts compute on the tap path. The whole reason a CloudFront Function was chosen in "M1 Deliverable 3", section 3, option A, is one hop, no origin, no server. Middleware reintroduces an invocation, a cold start risk, a runtime to maintain and a per request cost, for ten static routes that change by table edit. A test asserts no middleware file exists in this package. |
| **`routes`** (the legacy low level property) | Vercel rejects a `vercel.json` that carries `routes` alongside `redirects`, `headers`, `rewrites`, `cleanUrls` or `trailingSlash`. Using it would take the client's existing and future configuration hostage on a live marketing site. |
| **Bulk redirects** (`bulkRedirectsPath`) | Genuinely attractive: it supports `preserveQueryParams: false`, which would restore the one property lost below, and `caseSensitive: false`, which would replace 160 enumerated entries with 10. Rejected because it is a separate metered product with its own limits and pricing page, it is a second deployment lifecycle for the client to understand, and it does not work under `vercel dev`. Ten routes do not justify it. **If the query string passthrough in section 5 ever becomes a real problem, this is the mechanism to revisit first.** |
| **A serverless function** | Same objection as middleware, with a worse cold start. |

---

## 2. Why 160 redirect entries for 10 routes

The CloudFront Function normalised in code: it lowercased the code and stripped trailing slashes before the lookup. Vercel's routing layer runs before any compute, so there is no code to normalise in. Whatever normalisation survives has to be expressed as configuration.

**Vercel's router is case sensitive.** Measured against the client's own live project on Tuesday 25 August 2026: `https://trevean-spice-website.vercel.app/blend.html` answered `200` and `/Blend.html` answered `404`. Without enumerated entries, `/T/PS` would be a 404.

So each row on each route generates sixteen literal paths: two casings of the route letter, four casings of the two letter code, each with and without a single trailing slash. Five codes, two routes, sixteen paths: **160 entries**. Vercel's documented ceiling is 2,048 redirects and 4,096 characters per `source` and `destination`. The compiled file is 21,223 bytes.

**They are literal strings rather than a `path-to-regexp` pattern**, which would have collapsed them into ten lines. That is deliberate, for two reasons in this order:

1. A path parameter the destination does not consume is not obviously discarded. Unused route parameters are documented as being appended to the destination as query parameters, and the one thing this redirect must never do is let anything from the request reach the destination. **A source with no parameters in it cannot append a parameter.**
2. A literal source has exactly one meaning, so `lib/router.mjs` is an exact model of the router rather than a re-implementation of `path-to-regexp` that would have to be trusted. That is what makes this package's test suite worth as much as the CloudFront package's, which runs the deployable artifact in a VM. The build refuses to emit a non literal source, so the moment somebody shortens the file, the build fails rather than the model quietly becoming wrong.

Repeated trailing slashes are not enumerated. Vercel collapses them itself, measured on the same project the same day: `/blend.html//` and `/blend.html///` both answered `308` to `/blend.html/`, which is a path this package serves.

---

## 3. Properties carried over from the CloudFront implementation

Enumerated from `build/edge/README.md`, "What the function does", and `build/edge/src/handler.template.js`, rather than recalled.

| # | Guarantee | Status on Vercel | How |
|---|---|---|---|
| 1 | **307 exactly, never 301, 302 or 308** | **Preserved** | Explicit `statusCode: 307` on all 160 entries. The build refuses any other status and refuses `permanent`. |
| 2 | **`Location` is the exact table string, including `via=nfc` and `via=qr`** | **Preserved** | Destinations are copied verbatim from the table's `targetPath` and `qrTargetPath`. The build asserts each carries `blend={slug}` and the right `via`, that the two routes differ in the `via` value and in nothing else, and that the query carries `blend` and `via` in that order and nothing else. |
| 3 | **`Location` is relative and same origin** | **Preserved** | The build rejects any destination that is absolute, protocol relative or contains `://`. A cross origin target costs a second DNS lookup plus a second TCP and TLS handshake, 450 ms at the design point. |
| 4 | **Lowercase and trailing slash normalisation** | **Preserved**, by enumeration rather than by code | Section 2 above. All sixteen variants per row are asserted present in the deployable file and resolve to the same destination. |
| 5 | **An unknown code gets a branded 404, never the home page and never a generic landing page** | **Preserved, but it depends on a file being placed** | No rule matches an unknown code, so it falls through to the project's 404 page. `dist/404.html` must be deployed into the project root, per ADOPTION.md step 2. **Until it is, Vercel serves its own "The page could not be found", which fails SOW section 6.3.** The live verification fails on this rather than warning. |
| 6 | **No origin, no server, one hop** | **Preserved** | Declarative routing, evaluated in Vercel's CDN before any function. The configuration declares no `functions`, no `middleware`, no `runtime`, no `crons` and no `builds`, and tests assert each of those strings is absent. |
| 7 | **Nothing from the request enters the routing decision** | **Preserved** | Every source is a literal path. There is no `has`, no `missing`, no cookie match and no query match anywhere in the configuration, and a test asserts those strings never appear. |
| 8 | **`Cache-Control: no-store` on the redirect** | **Requested, and reported honestly** | See section 4. |
| 9 | **No attribution parameter reaches the destination** | **Not preserved.** | See section 5. |
| 10 | **`x-trevean-table` on every response** | **Not preserved.** | See section 6. |
| 11 | **Unknown codes logged once, sanitised, so the rate can be alarmed** | **Not preserved.** | See section 6. |

---

## 4. The cache directive, stated rather than assumed

The specification asks for `Cache-Control: no-store` on the redirect, because a cached redirect is an uneditable redirect, and destinations changing by table edit rather than by re-encoding a tag is the single property the whole design rests on.

This package sets it explicitly, with four `headers` rules covering `/t/`, `/T/`, `/q/` and `/Q/`.

**What is not certain is whether a `headers` rule applies to a response generated by the routing layer rather than served from the filesystem.** It was not possible to confirm that without deploying. So the behaviour is not asserted anywhere in the test suite, and `scripts/verify-live.mjs` reports which header actually arrived:

- `no-store` arrives: **PASS**.
- Vercel's own default for a declarative redirect, `public, max-age=0, must-revalidate`, arrives: **NOTE**, not a failure. The browser has to revalidate before every reuse, so the destination stays editable and the load bearing property holds. But the rule in `vercel.json` did not take effect, and whoever runs the script is told so rather than having the difference smoothed over.
- Anything that permits reuse without revalidation: **FAIL**.

That default was observed on the client's live project on Tuesday 25 August 2026.

---

## 5. The one guarantee that does not survive: the query string

**Vercel appends the incoming query string to a declarative redirect's destination. The CloudFront Function dropped it, and there is no setting on the `redirects` array that turns the appending off.**

From Vercel's own knowledge base on redirects and query strings:

> By default, all query strings that are found in the **source** path will be passed to the **destination** path.

Their worked example: source `/?baz=10` with destination `/lol/?path=foo` produces `/lol/?path=foo&baz=10`.

So on CloudFront, `/t/ps?utm_source=x` answered `/blend.html?blend=persian-sunrise&via=nfc`. On Vercel it will answer something like `/blend.html?blend=persian-sunrise&via=nfc&utm_source=x`.

**This is stated plainly rather than dropped quietly, and it is not a failure, for three reasons.**

1. `blend` and `via` are **literals in the configuration**, not captures. They cannot be overridden by anything in the request, so the customer still opens the right blend with the right attribution. A jar tapped with a hostile or accidental `?blend=silk-road` still opens its own blend, because the literal comes first in the destination and the appended parameter comes after it.
2. Nothing reads the extra parameters. The page takes `blend` and `via` and ignores the rest.
3. **No shipped tag can produce one.** The 1,000 encoded tags carry `https://treveanspice.com/t/{code}` with no query string, and so does the on-pack QR artwork. The passthrough can only be reached by a hand typed or externally linked URL.

**What it does cost.** The original reason for never reading the query string, from Architecture, "Hypotheses to confirm in the audit", item 3, is that attribution parameters must not enter the cache key. On Vercel they can now reach the destination URL, so a link carrying `?utm_source=x` produces a distinct destination URL from a bare tap. On a static `/blend.html` served from Vercel's CDN this is a fragmentation of the destination page's cache, not of the redirect's, and the redirect itself is uncached by design. It is bounded and it is worth knowing about.

`scripts/verify-live.mjs` probes this with a real request carrying `utm_source` and `fbclid` and reports what came back, rather than asserting a guess about somebody else's router. If it turns out the query is dropped after all, the script says so and reports PASS.

**If this ever needs fixing**, bulk redirects support `preserveQueryParams: false`. See the rejected mechanisms table in section 1.

---

## 6. Two things a declarative configuration simply cannot do

Both are losses. Neither affects which blend a customer sees.

**`x-trevean-table` is gone.** The CloudFront Function put `x-trevean-table: v2.{digest}` on every response, where the digest covered the mapping, the preload hints, the status and the 404 body. That is how a host that came up without the redirect table was detected from outside, and the CloudFront verification script compared it against what the working tree compiles to. A declarative redirect computes nothing, so there is no equivalent here. **The consequence:** `scripts/verify-live.mjs` can tell you the deployed host serves the right destinations, but it cannot tell you the deployment was built from this exact table by reading one header. It tells you by checking all ten destinations byte for byte instead, which is slower but not weaker.

This is recoverable if the client ever wants it: the digest is a build time constant, so it could be emitted as a static `headers` rule alongside the `Cache-Control` one. It is not built here because it was not asked for, and because it would share the section 4 uncertainty about whether header rules apply to redirect responses.

**Unknown code logging is gone.** The function logged `unknown_tag_code` once per unknown code, sanitised, so a rising rate could be alarmed: a spike means either a mis-encoded batch or a table that lost a row. There is no compute here to log from. Vercel's own request logs still record the 404s, so the signal exists, but it is not the structured event the data model, section 7.6, describes and nothing alarms on it. **This should go back on the open items list for the AWS environment rather than being treated as solved.**

---

## 7. The test suite, and the one test that matters

109 tests. `npm test`.

The failure this suite exists for **does not throw**. A transposed pair of table entries produces a fast, successful, `307` to a `200` page showing the wrong blend. It passes every smoke test that looks at status codes, every timing budget and every byte count. A customer holding a Persian Sunrise jar reads about Caribbean Sunset, and nobody finds out from a dashboard.

Only an expectation **transcribed from the contract documents rather than derived from the table under test** can see it. That is `test/expectations.mjs`: the five codes, their blends and their exact destination strings, typed out by hand from Scope, section "Tag code map", and from "M1 Deliverable 3", section 5. Nothing in that file is generated from `redirect-table.json`, from the compiler or from `dist/`. A test whose expectations come from the thing under test cannot catch a wrong slug.

On top of that:

- `test/routing.test.mjs` exercises the deployable `dist/vercel.json` read from disk, not a recompile in memory.
- Transpositions are **injected on purpose**, both a full swap and a half swap where one row's tap and QR routes disagree, and the suite asserts each is caught.
- 2,000 junk codes are swept and asserted never to redirect.
- The marketing site's own paths (`/`, `/blend.html`, `/index.html`, `/about`, `/shop`) are asserted **not** to be captured by this configuration, because it is being added to a live site.
- The build is asserted to refuse: a non 307 status, a transposed row, a row whose routes disagree, an absolute destination, an extra query parameter, parameters in the wrong order, an unknown blend slug, a duplicate code and an empty table.

---

## 8. Changing where a code points

Edit `targetPath` and `qrTargetPath` in `build/edge/redirect-table.json`, set `allowRepoint` to `true`, bump `version`, run `npm run build` in **both** `build/edge` and `build/vercel-redirect`, and redeploy.

**Do not edit `dist/` and do not edit the mapping anywhere but the canonical table.** Two serving surfaces now compile from one table, which is the arrangement that makes a repoint safe. It is also the arrangement that fails silently if somebody edits one surface directly, so `npm run build:check` runs in CI for both.

---

## 9. Open items

| # | Item | Owner |
|---|---|---|
| 1 | **Point the apex and `www` at Vercel.** Both currently point at Bluehost, which is why `treveanspice.com/` returns `403` and `/t/ps` returns `500` today. See ADOPTION.md. | Dan |
| 2 | **Leave the email DNS records alone during that change.** MX, SPF, DKIM and DMARC were just restored. Breaking them again would be worse than the tags not working. See ADOPTION.md, step 4. | Dan |
| 3 | **Deploy `dist/404.html`**, or an unknown code lands on Vercel's plain text page, which fails SOW section 6.3. | Trevean |
| 4 | **Run `npm run verify` against the live domain** the moment DNS resolves to Vercel. Nothing in this package has been observed on a deployed Vercel host yet. | Serene Labs |
| 5 | **Confirm the `Cache-Control` outcome** from that run, per section 4, and record which of the two headers arrived. | Serene Labs |
| 6 | **Restore unknown code alarming** when the AWS environment lands, per section 6. It is not solved here. | Serene Labs |
| 7 | This is a stopgap that keeps the jars working. The CloudFront implementation in `build/edge` remains the target once the AWS account exists, and both compile from the same table so moving back is a DNS change and not a rewrite. | Serene Labs and Dan |
