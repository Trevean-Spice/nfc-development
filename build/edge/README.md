# The `/t/{code}` and `/q/{code}` edge redirect

**M1 deliverable, Monday 17 August 2026. Deploys Wednesday 19 August, verified Thursday 20 August, closes R1 on Friday 21 August.**

One thousand encoded, possibly write-protected tags resolve through this directory. It is about forty lines of running code, and the reason the rest of the package exists is that those forty lines cannot be wrong.

Everything here derives from three frozen M1 documents: "M1 Deliverable 3: Redirect-Serving Decision and Apex Domain Routing", section 5; "M1 Deliverable 2: Data model", section 7; and "Per-page byte and speed budget", section 3. Where this package adds something those documents do not specify, it says so below.

---

## The one rule

**`redirect-table.json` is the only place a code to blend mapping exists.**

The CloudFront Function, the `NFCTags` seed, the chip encoding input and the QR artwork sheet are all compiled from it and are written into `dist/`. `dist/` is output. Editing it by hand fails CI, and a test asserts that no other file in the package carries a target path.

The failure this protects against has no symptom on the deploying side. Per D10 and the Architecture document, a host migration that leaves the table behind does not break a deployment. Everything comes up green and 1,000 jars in customers' kitchens stop working, and nobody finds out from a dashboard.

---

## Layout

```
redirect-table.json          THE table. Reviewed like code, deployed with the application.
src/handler.template.js      The CloudFront Function, with five substitution tokens.
src/not-found.html           The branded 404 page, compiled into the function body.
lib/                         table loading, validation, compilation, derived artifacts.
scripts/build.mjs            Compiles the table into dist/. Fails over 10 KB.
scripts/validate-table.mjs   The six CI checks on the table, plus three more.
scripts/verify-live.mjs      Cutover day end to end check against a running distribution.
test/                        140 tests. Run them before touching anything.
dist/redirect.js             The artifact Terraform uploads. Generated. Committed. Never edited.
dist/nfc-tags.seed.json      The NFCTags mirror rows. Generated.
dist/tag-encoding.csv        Input for the M4 chip programming tooling. Generated.
dist/qr-artwork.csv          The exact URL Trevean encodes into each on-pack QR. Generated.
```

## Commands

```bash
npm run validate      # check the table on its own, fast enough for every commit
npm run build         # compile the table into dist/
npm run build:check   # CI: fail if dist/ has drifted from the table
npm test              # 140 tests against the compiled artifact
npm run ci            # all three, in that order
```

Node 20 or newer. **No dependencies, runtime or development.** See `MANIFEST.md`.

---

## What the function does

Two routes, one table. `/t/{code}` is the tap and is what the 1,000 shipped tags carry. `/q/{code}` is the on-pack QR. They reach the same destination page and differ only in the `via` value, which the beacon reads after paint and which is excluded from the cache key.

| Request | Response |
|---|---|
| `/t/ps` | `307` to `/blend.html?blend=persian-sunrise&via=nfc` |
| `/t/cs` | `307` to `/blend.html?blend=caribbean-sunset&via=nfc` |
| `/t/sr` | `307` to `/blend.html?blend=silk-road&via=nfc` |
| `/t/nm` | `307` to `/blend.html?blend=north-african-night-market&via=nfc` |
| `/t/kg` | `307` to `/blend.html?blend=kyoto-garden&via=nfc` (reserved, no jar carries it) |
| `/q/ps` | `307` to `/blend.html?blend=persian-sunrise&via=qr` |
| `/q/cs` | `307` to `/blend.html?blend=caribbean-sunset&via=qr` |
| `/q/sr` | `307` to `/blend.html?blend=silk-road&via=qr` |
| `/q/nm` | `307` to `/blend.html?blend=north-african-night-market&via=qr` |
| `/q/kg` | `307` to `/blend.html?blend=kyoto-garden&via=qr` |
| Anything else under `/t/` or `/q/` | `404` with the branded not-found page in the response body |

Every response carries `Cache-Control: no-store` and `x-trevean-table: v2.a16abe5b`.

**The function never reads the request query string, on either route.** The route is one character of the path. `/t/ps?via=qr` still answers `via=nfc`, which is what keeps an attacker-supplied value out of the `Location` header and an attribution value out of the cache key. See "M1 Deliverable 14: QR attribution", section 2.

**Five codes. Four physical tags.** `/t/kg` is reserved and was not in this production run. Several earlier documents say "all five codes verified against physical tags"; that is wrong and the correction is already recorded in "M1 Deliverable 3", section 7.

### Why each of those choices, in one line each

- **307, never 301, 302 or 308.** A permanent redirect is cached by browsers and intermediaries, in some cases indefinitely. It would make the destination un-editable on every device that had ever tapped a jar, which destroys the one property the whole design is built on: destinations change by editing this table, tags are never re-encoded. The compiler refuses to emit a function that can return any status other than 307 or 404.
- **Relative `Location`, same origin.** The browser keeps the connection it already has. A different hostname costs a second DNS lookup plus a second TCP and TLS handshake: 450 ms at the design point, and the budget fails. The validator rejects an absolute target so a later hosting change cannot quietly reintroduce it.
- **`Cache-Control: no-store`.** A cached redirect is an uneditable redirect. The only thing caching it would save is a round trip on a repeat tap of the same jar, which is rare and is not the measured case.
- **No query string is ever read.** Attribution parameters must not enter the cache key. The compiler refuses to emit a function that references `querystring` or `cookies`, and a test asserts a request arriving with `utm_source`, `gclid` and even a conflicting `blend` parameter redirects to exactly the same place.
- **Lowercase and trailing slash normalisation.** Tags encode lowercase with no trailing slash, but the QR path and hand typed URLs exist. Free insurance.
- **An unknown code gets a branded 404, never the home page.** Per SOW section 6.1, a generic landing page is a failure in the same way a wrong blend is. It is also logged, once, sanitised, so the rate can be alarmed: a spike in unknown codes means either a mis-encoded batch or a table that lost a row.
- **`x-trevean-table` on every response.** This is how a distribution that came up without the table is detected from outside. The verification script compares it against what the working tree compiles to.

### Runtime limits, honoured rather than assumed

| Limit | How it is honoured |
|---|---|
| 10 KB maximum function size | The build computes the exact byte count, warns above 8 KB and refuses to emit above 10,240. Currently **6,718 bytes, 65.6%**. |
| No network access, no filesystem | Nothing is looked up. The tests evaluate the artifact in an empty V8 context with no `require`, `fetch`, `process` or timers in scope, and assert the source references none of them. |
| Sub millisecond execution | The tap path is one `toLowerCase`, one `slice`, one own-property lookup and an object literal. Nothing is logged on it. |

---

## The 404 page, and one thing to confirm

The function returns the branded not-found page **in the body of its own 404 response**. It is compiled in from `src/not-found.html`, is entirely self contained (no script, no stylesheet, no image, no font, no external request of any kind) and costs about 1.2 KB of the 10 KB budget.

**TO CONFIRM IN AUDIT: that generated-response bodies are enabled on the distribution.** A CloudFront Function at viewer request cannot both rewrite a URI and set a status, so "rewritten to the branded not-found page and returned with a 404" from "M1 Deliverable 3", section 5, has to be resolved one way or the other. The two ways:

1. **What is built here.** The function carries the page. No origin fetch, no extra configuration, and it works even if every origin is down.
2. **The alternative, if the brand page has to be a real deployed asset with photography.** The function leaves the URI alone, the origin returns 404, and a CloudFront custom error response serves `/not-found.html` with response code 404. That is a distribution setting, not a code change, and it costs an origin round trip on a path no shipped tag can reach.

Option 1 is the recommendation. The blast radius if it turns out to need option 2 is zero encoded inventory, because it only affects codes no tag carries, and Thursday's verification catches it.

---

## The hero preload hint, built and currently off

"Per-page byte and speed budget", section 3, decision C, calls for a `Link: rel=preload` header for the hero image on the 307. It saves up to 150 ms, costs nothing, and is the only way to make the redirect hop do useful work. It is **mandatory** if Q2 comes back saying the 307 was not in the 6 August measured path.

It is implemented and switched off, because the hero filenames do not exist yet. Set `heroPreloadPath` on an entry in the table and rebuild. There is no code change, and a test covers both states.

```json
"heroPreloadPath": "/img/hero-persian-sunrise-1280.avif"
```

Two things to settle before switching it on: the final hero filenames, and whether they are content hashed. Because the 307 is `no-store`, the hint is regenerated on every tap and can never go stale against a re-published hero.

---

## Changing where a code points

This is the supported operation. It is the reason Dan chose a redirect and the reason 1,000 tags never need re-encoding.

1. Edit `targetPath` and `blendSlug` on the row in `redirect-table.json`.
2. Set `"allowRepoint": true` and increment `version`.
3. `npm run ci`, commit both the table and `dist/`, open the pull request. Say in the description which physical jars are affected.
4. Deploy. Propagation is under a minute.
5. Run `npm run verify` against production, and tap a real jar.

Without step 2 the build fails, because a repoint that nobody meant to make is indistinguishable from a repoint that somebody did. Removing a code fails the same way: 250 jars would start returning 404.

### The repoint guard needs a base ref, and it has to be told which one

`previousTable()` reads the previous table out of git and defaults to `HEAD`. At a bench that is the right default: `HEAD` is the last commit and the working tree holds the edit you are proposing, so the comparison is real. **In a CI checkout the working tree is `HEAD`, so the default compares the table with itself, passes by construction, and prints "compared against HEAD", which reads like a comparison happened.** For most of this engagement the guard had never compared anything, and the only line hinting at it sat above "All checks pass."

Two things fixed that, and both are in `.github/workflows/edge-and-chip-cli.yml`:

- `REDIRECT_TABLE_BASE_REF` is set to what the change will merge on top of: `origin/<base branch>` on a pull request, `HEAD^` on a push. The checkout uses `fetch-depth: 0`, because a shallow clone has no history to read.
- `REDIRECT_TABLE_STRICT_REPOINT=1` turns "the guard did not run" and "the guard ran vacuously" into failures rather than into an informational sentence. `previousTable()` returns `compared` and `vacuous` as facts, and vacuous means the base ref resolves to the checked out commit *and* the table there is byte identical to the working tree.

The vacuous case has no escape hatch. The absent baseline case has exactly one, `REDIRECT_TABLE_FIRST_COMMIT=1`, for the single commit that first puts the table under version control. That is deliberately the same shape as `allowRepoint`: the dangerous thing is allowed only when a person writes it down.

Strict mode is off by default, so `npm run validate` at a bench still behaves as before.

---

## Cutover day, Thursday 20 August

The verification script is the Thursday and Friday instrument. It is meant to be run by somebody who did not write it.

**Morning, before any DNS change.** Point it at the distribution with the Host header and TLS server name kept intact, which is exactly what `curl --resolve` does:

```bash
npm run verify -- --base https://treveanspice.com --resolve <distribution IP>
```

or, hitting the CloudFront domain name directly:

```bash
npm run verify -- --base https://d111111abcdef8.cloudfront.net --host treveanspice.com
```

**Afternoon, after the nameserver flip, and again on Friday 21 August:**

```bash
npm run verify -- --base https://treveanspice.com
```

Add `--no-follow` if `/blend.html` does not have real content yet. Add `--json` to keep a machine readable record alongside the printed table.

It prints one row per code plus a row for an unknown code, and exits non-zero if anything fails. It checks the status is exactly 307, the `Location` matches this table byte for byte, the `Location` is relative, `Cache-Control` is `no-store`, `x-trevean-table` matches what this working tree compiles to, the destination returns 200, and **the destination page actually names the right blend**. That last one is the check a status code smoke test cannot make, and it is the difference between a green run and a customer tapping Persian Sunrise and reading about Caribbean Sunset.

**What it does not do is replace tapping a jar.** Four physical tags exist in this run. Tap all four, on the handsets in the section 6.4 matrix, with the display awake on iPhone and unlocked on Android, and read the blend name off the screen. See "M1 Deliverable 4: Tap test protocol".

---

## For whoever wires this into Terraform

The Terraform lives in a sibling directory and is not owned here.

| | |
|---|---|
| Function source | `build/edge/dist/redirect.js` |
| Export shape | A single global `function handler(event)`. No module system, no exports, no `require`. Upload the file verbatim as the `code` argument to `aws_cloudfront_function`. |
| Runtime | `cloudfront-js-2.0` |
| Event type | `viewer-request` |
| Cache behaviour | `/t/*` and `/q/*`, each associated as `function_association`. No origin is reached, so neither behaviour's origin is ever used. |
| Byte size | 6,718 bytes, against a 10,240 byte limit |

```hcl
resource "aws_cloudfront_function" "tag_redirect" {
  name    = "trevean-tag-redirect"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = file("${path.module}/../edge/dist/redirect.js")
}
```

**Associate it with the `/t/*` and `/q/*` behaviours and nothing else.** The function answers a request it does not recognise with a 404, which is correct for `/t/*` and `/q/*` and catastrophic anywhere else: attached to the default behaviour it would return 404 for the entire marketing site. It cannot defend against that itself, because a viewer request function is not told which behaviour invoked it.

Three things the infrastructure has to get right that this package cannot enforce:

1. **The `/blend.html` cache policy must exclude `via` and every `utm_*` parameter from the cache key and must not forward them to the origin.** Architecture, "Hypotheses to confirm in the audit", item 3. `utm_*` is the larger fragmentation source, because campaign links generate unbounded parameter values and every distinct value is a separate cache entry paying origin latency on first request. The client side scan beacon reads `via` from `window.location` after paint, so nothing is lost.
2. **Deployment must run `npm run ci` first.** A pipeline that uploads `dist/redirect.js` without the drift check can ship a hand edited function, which is the second copy of the table this whole package exists to prevent.

---

## The tests, and why there are so many of them for forty lines

A transposed table entry produces a fast, successful, 200 returning page showing the wrong blend, and passes every smoke test that looks at status codes. It is a SOW section 6.1 correct-destination failure, it costs 250 jars, and no speed measurement will ever see it.

So the tests run against `dist/redirect.js` itself, evaluated in an empty V8 context, and their expectations are **transcribed by hand** from Scope, "Tag code map", and "M1 Deliverable 3", section 5. A test that reads its expectations out of the file it is testing cannot catch a transposition.

Verified by mutation: transposing `ps` and `cs` in `dist/redirect.js` fails 11 tests.

One test is worth calling out because it states a limit rather than a guarantee: *"a transposed pair is internally consistent, so the validator alone cannot see it."* Every row still repeats its own code three times and still carries `blend={its own blendSlug}`, so all six CI checks from the data model pass. Two things catch it: the hand transcribed expectation, and the repoint check against the previously committed table. That is why both exist.

Coverage: all five codes to the correct slug on both routes, the QR target proved equal to the tap target with only the `via` value changed, every casing permutation of every code, trailing and repeated trailing slashes, `/T/` prefixes, the exact status, the exact `Location`, the exact header set, `no-store` on both responses, the query string being ignored, fifteen named malformed inputs, 2,000 generated junk codes never producing a redirect, prototype chain keys (`/t/constructor`, `/t/__proto__`, `/q/__proto__`) not resolving, `?via=` never reaching a `Location` header on either route, log sanitisation, the 10 KB limit, the drift check, the derived artifacts, and a scan for en dashes and em dashes across the whole package.

---

## Additive fields

The table matches "M1 Deliverable 2: Data model", section 7.2, with these additions:

- `qrRequestPath`, `qrTargetPath` and `qrUrl`, the on-pack QR route. Required on every row. See "M1 Deliverable 14: QR attribution", section 4. `qrTargetPath` must equal `targetPath` with `via=nfc` replaced by `via=qr`, and the validator, the compiler and the test suite each assert it independently.
- `heroPreloadPath`, `null` on every row today, defaulting to a no-op. See above.
- `blendName`, the display name, used by the verification script to check the destination page names the right blend and by the QR artwork sheet. It is not compiled into the function and costs nothing at runtime.

  **It reaches a print vendor through `dist/qr-artwork.csv`, so it is constrained rather than passed through.** A comma is allowed, because a comma in a marketing name is an ordinary decision: "Kyoto Garden, Limited Edition". Both generated sheets now quote a field containing a comma or a quote per RFC 4180, and the test suite parses them with a real RFC 4180 parser and asserts every row has exactly as many columns as its header. Before that, one comma shifted every column to its right and the vendor reading `encodeInQr` got ` Limited Edition` instead of a URL, with the validator returning zero errors and the artifact test still passing because it only checked that the QR URL appeared somewhere in the row. A carriage return or a line feed in a blend name is refused outright by the validator: RFC 4180 permits it inside a quoted field, plenty of vendor tooling mishandles it, and no blend name has any business containing one.

---

## Open items

| # | Item | Owner | Needed by |
|---|---|---|---|
| 1 | **Confirm `/t/kg` resolves at launch** even though no jar carries it. Built that way, per "M1 Deliverable 3", section 9, item 5. If it should instead point at a branded holding page until Kyoto Garden is published, that is a one line `targetPath` edit and no code change. | Dan | Wed 19 Aug |
| 2 | **Q2: was the 307 in the 6 August measured path?** Decides whether the hero preload hint is recommended or mandatory. | Dan | Immediately |
| 3 | Hero filenames and whether they are content hashed, to switch the preload hint on. | Trevean and Serene Labs | Before M2 |
| 4 | Generated-response bodies enabled on the distribution, else the custom error response fallback. See above. | Serene Labs | Wed 19 Aug |
| 5 | **Answered, then REVERSED, and the table records the reversal.** `writeProtected` is **`true`** on every encoded row. Dan answered "no write protections" from memory on 19 August (D18); on **Friday 11 September 2026**, with the stock in front of him, he said "yes the tags are locked per the supplier", matching his own written instruction to the supplier. **The 1,000 tags CANNOT be re-encoded, because nobody at Trevean holds the ST25TV area password**, so the redirect table is the only recovery path rather than the first of two. It stays `null` on the reserved `kg` row, where no tag exists to have a state. **Still to do:** confirm by read-back on a physical reader, which the client can now do. See "Decision log", **D45**. | Trevean and Serene Labs | Read-back, and find out who holds the area password |
| 6 | This package lives in the knowledge base repository until `nfc-development` access lands. It is written to drop in whole. | Serene Labs | On repo access |
| 7 | **Approve the wording change to Scope, in scope, item 5**, which currently says the QR resolves to "the same URL as the tap" and so contradicts item 6's NFC versus QR split. See "M1 Deliverable 14: QR attribution", section 3. | Dan | Before M2, Fri 28 Aug |
| 8 | **Produce the on-pack QR artwork from `dist/qr-artwork.csv`**, not from a retyped URL. Whether Kyoto Garden packs carry a QR at all is Trevean's call; `/q/kg` resolves either way. | Trevean | Artwork lead time |
