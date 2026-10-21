# Architecture and the reasoning behind it

**M5 handoff deliverable. Written Saturday 22 August 2026. Sections 5, 9 and 11 revised Tuesday 25 August 2026.**

This document is the "why", not only the "what". A new developer can read the code and work out what it does. What the code cannot tell them is which of its odd looking shapes are load bearing, and those are exactly the ones that get undone by a reasonable person making a reasonable change.

Six decisions in this system look wrong until you know why they were made:

1. There is a redirect in front of every page, and it is served at the CDN edge.
2. Pages are rendered ahead of time rather than on request.
3. The admin is custom rather than a headless CMS product.
4. Attribution is per SKU, with no per jar identity.
5. The operating system confirmation step is measured on every run and never scored.
6. The redirect table lives in version control and cannot be edited through the admin by anybody, including an Admin.

Sections 3 to 8 take those one at a time. Read section 1 first, because it is the frame everything else sits inside.

---

## 1. The requirement, decomposed

> A real jar, tapped, correct blend page readable within 2.0 seconds of navigation start, at least 98% of the time, through an 8 mm bamboo lid.

That is one sentence and four independent problems that fail in four different places.

| Clause | Actual problem | Where it is solved |
|---|---|---|
| "through the lid", "98%" | Radio physics and materials | Physical layer. Mostly not software at all. See the Hardware and physical layer document. |
| "the correct blend page" | Identity and production discipline | The redirect table, the tag code map, and tag placement controls |
| "within 2.0 seconds" | Latency on a cold cellular connection | This document, sections 2 to 4 |
| Lighthouse at or above 90 | Page weight on a photography heavy page | The per page byte and speed budget, enforced in CI |

Keeping them separate matters. A team that treats this as one performance problem spends its time optimising the fast part, because the failure that costs 250 jars is a **wrong** page, not a slow one, and no speed measurement will ever see it.

**Status of each, as at Saturday 22 August 2026.** Read success and adjacent jar isolation are met on the 6 August bench data. Through lid validation on production materials is open and is Trevean's to close. The 2.0 second criterion is met on a corrected estimate with roughly 0.1 s of margin before the production page carries photography, and has never been measured on the production stack, because the production stack does not exist yet.

---

## 2. The tap path

Every millisecond in this diagram is spent from the customer's budget. There is no free hop.

```
  thumb on lid
       |
  [1]  tag energises, returns its URL record            platform, not ours
       |
  [2]  OS handoff                                       platform, EXCLUDED from acceptance
       |     iOS:     notification banner, user taps it
       |     Android: opens the URL directly
       |
  === navigation start, the 2.0 s clock begins here ===
       |
  [3]  DNS for treveanspice.com
  [4]  TCP + TLS to nearest edge, HTTP/3 where advertised
  [5]  GET /t/{code}  ->  307                           served at the edge, no origin
  [6]  GET /blend.html?blend={slug}&via=nfc             edge cache hit, no origin, no database
  [7]  HTML, critical CSS inlined, no blocking script
  [8]  hero image, modern format, sized, priority
       |
  === page readable, the clock stops ===
       |
  [9]  enhancement script, service worker, deferred work    after paint, blocks nothing
  [10] scan beacon, fire and forget                         after paint, blocks nothing
```

### The three rules that hold it together

**Rule 1. Steps 5 and 6 never involve origin compute or a database read.** A serverless function that queries a database and renders a page costs roughly 150 ms warm and up to 2500 ms cold. The cold start happens on the first request after a quiet period, which is the first tap of the morning in a customer's kitchen, and it is the case a lab test never catches because lab tests keep everything warm.

**Rule 2. The redirect is unavoidable, so it must be as close to free as it is possible to make it.** Section 3.

**Rule 3. Nothing that measures the tap may delay the tap.** Scan tracking is a post paint beacon delivered by the browser, never a blocking request and never a retry loop.

### Where the 2.0 seconds actually goes

Modelled at the design point, which assumes a 150 ms round trip time from handset to nearest edge. That figure is deliberately close to Lighthouse's simulated Slow 4G latency so the CI gate and the field budget agree on the term that dominates. Median LTE to a well peered edge is nearer 60 ms; budgeting there produces a page that passes in a lab and fails in a kitchen.

At the design point the path costs about 1,340 ms, of which roughly **900 ms is six network round trips, 215 ms is bytes on the wire, and 225 ms is edge and device compute.**

**This is a latency bound path, not a bandwidth bound one.** Every extra 10 ms of round trip time costs about 60 ms across the path. Every extra 10 KB before readable costs about 20 ms. That ratio is the single most useful thing to know before optimising anything here: the round trip decisions matter roughly three times more than the byte decisions, and they were decided once rather than defended continuously.

Three round trip decisions are load bearing and are written as constraints rather than intentions:

- **A. The 307 target must be same origin and relative.** If `/t/ps` redirects to a different hostname, an `app.` subdomain, a distribution domain, anything, then DNS, TCP and TLS all repeat: about 450 ms, and the budget fails outright. The edge package's validator rejects an absolute target so a future hosting change cannot quietly reintroduce it.
- **B. HTTP/3 has to be advertised in DNS to be used on the first navigation.** On a genuinely first navigation the browser has no cached `Alt-Svc` entry and opens TCP plus TLS unless a DNS HTTPS (SVCB) record advertises `alpn="h3"`. Worth about 150 ms. Route 53 supports the record type.
- **C. A `Link: rel=preload` header for the hero on the 307 response.** Worth up to 150 ms, costs nothing, and it is the only way to make an otherwise purely costly redirect hop do useful work. It is implemented in the edge package and currently switched off, because the final hero filenames do not exist yet. Setting `heroPreloadPath` on a row in the redirect table and rebuilding switches it on with no code change.

**Why all three are mandatory rather than recommended.** The 6 August 2026 measurements did not include the production 307, confirmed by the client on 19 August. Adding the hop costs roughly 0.2 to 0.3 s on cellular, which moves the iPhone XS worst case from a measured 1.6 s to a corrected **1.8 to 1.9 s against a 2.0 s requirement**. That was measured on a test page with no photography over an office network. The production pre readable payload costs a further 0.31 s at the design point. The three optimisations together recover roughly 300 ms against a roughly 210 ms modelled shortfall. **A cut to the hero image budget is held in reserve as a fourth lever and is deliberately not proposed**, because the first three cost engineering time and the fourth costs brand quality, and that is the right order to spend in.

### The byte budget, and what it is for

Before readable, per blend page: **150 KB and 5 requests**. Whole page fully loaded: **1,000 KB and 35 requests**. The HTML document including inlined critical CSS is capped at **14 KB Brotli**, because the initial TCP congestion window is about 14 KB and a document of 15 KB costs an entire extra round trip, 150 ms, to deliver 1 KB. That is the sharpest cliff in the whole budget. The hero image is capped at **90 KB**.

**The byte budget is not what makes 2.0 seconds achievable. It is what stops 2.0 seconds being lost later**, during months when attention is on the CMS and the dashboard rather than the page. It is enforced in CI: a commit over budget fails the build. Every number lives in exactly one machine readable file so the prose and the gate cannot drift, and changing a number requires a written decision naming who asked, what it costs in milliseconds, and what was traded for it.

---

## 3. Why the redirect exists, and why it is served at the edge

### Why it exists at all

**Because a thousand tags were encoded with it before this engagement began**, on 24 July 2026. The architecture originally specified no redirect: point the tag straight at the page. That option closed on that date.

It is a fact rather than a decision now, and the client's reason for it is sound and worth preserving: **destinations change by editing the redirect table, and tags are never re encoded.** A blend that gets renamed, a page that moves, a domain that migrates, all of those become a code review and a deploy instead of a recall of a thousand physical jars.

### Why at the edge rather than from an origin

An origin served redirect costs a full round trip plus a table lookup, and on a cold serverless origin up to 2500 ms. An edge served redirect costs one hop on a connection the browser already has and never touches a server.

The implementation is a **CloudFront Function at viewer request**. It executes in under a millisecond, before any cache lookup and before any origin call. The whole tap path inside it is one `toLowerCase`, one `slice`, one own property lookup and an object literal. Nothing is logged on it.

**"At the edge" is the requirement. "CloudFront" is the target and, as of Tuesday 25 August 2026, not necessarily the first host.** There is no AWS account this function can live in yet. **Section 9.1 sets out what an interim host has to preserve**, and the six properties there are what make a later move to CloudFront a deploy rather than a rebuild. Nothing in this subsection changes under an interim host: the argument is against an origin round trip, not for a particular vendor's edge.

The alternative of Lambda@Edge was evaluated and rejected: roughly 5 to 20 ms warm and materially worse cold, and the only thing it buys is the ability to make a network call during the redirect, which rule 1 forbids on this path anyway.

**The compiled artifact is 6,718 bytes against a 10,240 byte hard limit**, and the build refuses to emit anything above the limit and warns above 8 KB. The function has no network access and no filesystem: the tests evaluate it in an empty V8 context with no `require`, `fetch`, `process` or timers in scope and assert that its source references none of them.

### The specification of the redirect itself, and why each part

| Property | Value | Why |
|---|---|---|
| Status | **307, exactly** | A 301 is cached by browsers and intermediaries, in some cases indefinitely. It would make the destination permanently uneditable on every device that had ever tapped a jar, with no server side fix. That destroys the one property the whole design exists to provide. The compiler refuses to emit a function that can return any status other than 307 or 404. |
| `Location` | **Relative, same origin** | Constraint A in section 2. The validator rejects an absolute target. |
| `Cache-Control` | **`no-store`** | A cached redirect is an uneditable redirect. The only thing caching it would save is a round trip on a repeat tap of the same jar, which is rare and is not the measured case. |
| Query string | **Never read, on either route** | Attribution parameters must not enter the `Location` header or the cache key. The compiler refuses to emit a function referencing `querystring` or `cookies`. `/t/ps?via=qr` still answers `via=nfc`. |
| Normalisation | Lowercase, trailing slash stripped | Tags encode lowercase with no trailing slash, but hand typed URLs and the QR path exist. Free insurance. |
| Unknown code | **Branded 404, never the home page** | A generic landing page is a correct destination failure in the same way a wrong blend is. It is logged once, sanitised, so the rate can be alarmed: a spike in unknown codes means either a mis encoded batch or a table that lost a row. |
| Every response | `x-trevean-table: v2.<digest>` | How a distribution that came up without the table is detected from outside. The verification script compares it with what the working tree compiles to. |

There are two routes, not one. **`/t/{code}` is the tap and `/q/{code}` is the on pack QR.** They resolve through the same table to the same destination page and differ only in the `via` value. Pointing the QR straight at `/blend.html` would work today and would silently stop matching the tag the first time the table was edited, on artwork printed onto a carton that cannot be recalled.

### The redirect table is the load bearing artifact of the whole design

**It lives in version control, is reviewed like code, and is deployed with the application. Never as hand edited state in a hosting console.**

The distinction that matters, and it is the reason this rule is absolute: **a host migration that leaves the table behind does not break a deployment. Everything comes up green.** It strands a thousand jars that are already in customers' kitchens, and nobody finds out from a dashboard. That failure has no symptom on the deploying side. Every other failure in this system announces itself.

One file is the only place a code to blend mapping exists. Four artifacts are compiled from it and none of them is hand edited: the CloudFront Function itself, the `NFCTags` table seed that the admin reads, the chip encoding tool's input, and the QR artwork sheet. A code encoded onto silicon and a code served by the edge therefore cannot come from two different lists.

Six checks run in CI on any pull request touching it:

1. Every `code` matches `^[a-z]{2}$` and is unique.
2. Every `blendSlug` is one of the five real slugs and exists in the blend seed.
3. Every `ndefUri` ends with the same code as its row, and every `targetPath` carries `blend={blendSlug}` and `via=nfc`.
4. `unitsEncoded` summed across encoded rows equals 1000.
5. **A code present in the deployed table is never removed and never repointed to a different blend without an explicit `allowRepoint: true` in the pull request.** Repointing is the legitimate mechanism the whole design exists to provide, which is exactly why it must never happen by accident.
6. `redirectStatus` is 307 on every row.

**One limit is stated rather than hidden.** A transposed pair of rows is internally consistent: every row still repeats its own code three times and still carries its own slug, so all six checks pass. Two things catch it and both are deliberate: the test suite's expectations are **transcribed by hand** from the tag code map rather than read out of the file under test, and check 5 diffs against the previously committed table. Transposing `ps` and `cs` in the compiled artifact fails 11 tests.

---

## 4. Why pages are rendered ahead of time

**Each blend page is rendered at build time, regenerated on publish, and served from the edge cache. No origin compute and no database read on the tap path.**

### Why, beyond the obvious

The obvious reason is latency, and it is in section 2. Three less obvious reasons are why this is not revisited:

**It makes traffic free.** If a jar goes viral, every tap is a cache hit on a file rather than a function invocation and a database read. Cost stays flat and latency does not degrade under concurrency. A hundredfold traffic increase costs a hundred times a very small number and changes no design decision anywhere on this page.

**It makes demo day survivable.** On the day of the demo the only things that need to be alive are DNS and the CDN. Not the API, not DynamoDB, not a function, not the CMS. Fewer moving parts on the demo path is an explicit design goal, not a happy accident.

**It removes the whole class of "works in development" failures.** The build configuration is set to a static export, which means a route that has quietly opted out of static generation becomes a **build error** rather than a page that renders on demand in a customer's kitchen. That is the difference between a configuration and a guard.

### What stays dynamic, and what happens when it fails

Live price and availability from the Shopify catalog mirror, fetched **after paint** and treated as an optional refresh that overwrites a value already baked into the page. If it is slow, fails, is blocked, or the customer is offline, the page shows the price as of the last publish and the reorder button still works, because the Shopify cart permalink is a static URL requiring no API call at all.

### Two traps that this shape creates, both already handled

**The render cache must be externalised.** On serverless functions the default regeneration cache is the local filesystem, so every concurrent instance keeps its own copy and a cold instance starts empty. It needs shared object storage with a shared index. This is the most common serious mistake in this stack and it is invisible until it is an incident. The Terraform stands up a `render_cache` module for exactly this. **The definitive concurrency and cold request tests still have to be run against the real host, because configuration alone has fooled competent people.**

**Cache headers must be short in the browser and long at the CDN.** `public, max-age=60, s-maxage=31536000, stale-while-revalidate=86400` on HTML, with invalidation on publish. Everything else is `public, max-age=31536000, immutable`. The failure this prevents is worth naming: a blend page served with a one year browser max age is uneditable on every handset that has ever loaded it, for a year, with no server side fix. It defeats the five minute content update requirement completely, and it is one line.

**One cache key rule, and it is the one most likely to be got wrong.** The cache key for `/blend.html` is the path plus the `blend` parameter **only**. `via` and every `utm_*` parameter are neither in the key nor forwarded to the origin. If they are included, `?blend=persian-sunrise&via=nfc` and `?blend=persian-sunrise&via=qr` become two cache entries, the hit ratio halves, and the first tap of each variant pays a cold path; `utm_*` is worse still, because campaign links generate unbounded values and each one is a separate entry. The client side beacon reads `via` from `window.location` after paint, so nothing is lost.

The mirror image error, **excluding `blend` from the key and serving one blend's page for another**, is worth knowing about because it is silent and it is a correct destination failure. It is unreachable while the identifier is a path segment and becomes reachable the moment it moves into a query parameter, which is what the current URL shape does. That is why the cache key is specified rather than defaulted.

---

## 5. Why the admin is custom rather than a headless CMS product

**The admin is built inside the same application. This was recommended against a headless product explicitly, rather than skipped quietly, because the original job post listed headless CMS as a nice to have.**

Three reasons, in the order they matter:

**1. The content model already exists and everything depends on it.** Five DynamoDB tables define it. A CMS product wants to own the content model. Adopting one means either two sources of truth, whose failure mode in this product is literally "the page shows the wrong story", or abandoning the schema the API, the page build, the analytics and the redirect table all sit on.

**2. The screens this operation needs are not screens any generic product models.** Tag batches, encoding runs, lot data, a read only view of the deployed redirect table. A generic CMS models blog posts.

**3. Publishing regenerates the page directly.** No webhook plumbing between two vendors, no second dashboard, no second on call surface, no second bill. Publish writes an immutable snapshot and enqueues regeneration of exactly the affected pages, and returns before regeneration finishes so no editor waits for a deploy and no customer waits for a render.

**Acceptance of the admin is not a screenshot.** It is a member of Trevean's marketing team publishing a blend end to end while the contractor watches and says nothing.

**Status, corrected Tuesday 25 August 2026: the admin is an M3 deliverable and it is built.** The 22 August version of this document said it was not, which was wrong. `build/admin` carries source, tests, a lockfile and its own dependency manifest, and **169 tests pass**. It runs locally against the API package with no AWS account, and it is built against the frozen contract so every minimum role is read out of the contract document rather than retyped.

**What is not true is that it works, in the sense the milestone means.** It has never been deployed and no member of Trevean's marketing team has ever opened it. **The M3 acceptance bar is a person from marketing publishing a blend end to end while we watch and say nothing**, and that has not happened. Treat the tests as evidence that the tool does what it was written to do, and treat the acceptance bar as untested.

The API surface it sits on is complete and tested: seventeen admin operations across content, media, publishing, analytics and tags, with three roles.

---

## 6. Why attribution is per SKU

**Because the thousand tags were encoded per SKU before this engagement began, and that is not a design choice to relitigate.**

The chip is capable of more. Augmented NDEF can insert dynamic fields into the URL at read time, including the chip UID, a tap counter, and a Unique Tap Code that changes on every tap. TruST25 provides a cryptographic anti counterfeit signature. **Both are present on the chip and both are deliberately off.**

The consequences were accepted with eyes open and are written into the contract rather than discovered later:

- Individual jars are not distinguishable. There is no per tag identifier and no chip UID available to the page.
- Scan deduplication falls back to a **browser generated token**, the same mechanism the QR path uses. Measurably weaker than a per tag counter.
- **The dashboard states the measurement method rather than implying precision it does not have.** Every analytics response carries `measurementMethod: browser_token` and a note saying NFC and QR are deduplicated identically and neither is a per jar count. That is a schema requirement, not a convention someone remembers.
- Freshness is per blend, not per lot or per jar.

**The single most important sentence about this, and it is in the "Limitations and future work" document too because it decides money:** enabling ANDEF or TruST25 is a decision made **at encoding time**, when the next tag order is placed. A tag written today without ANDEF cannot be given it later without being re encoded. If per jar attribution or a defensible anti counterfeit claim ever matters commercially, the moment to choose is when the purchase order goes out, not when someone asks for the feature.

---

## 7. Why the OS confirmation step is measured but never scored

**Because on iOS the phrase "successful read on first tap" has no stable meaning, and the contract was rewritten to say what it actually meant.**

The original acceptance clause required "at least 98% successful reads on first tap". On iOS the operating system interposes a confirmation banner between the tag read and the page load, and no encoding, hosting or application change removes it. Under the original wording, a perfect system could be marked as failing every iPhone tap, or the clause could be read to mean whatever whoever was reading it wanted it to mean.

Raising that before agreeing to it is why Serene Labs holds this contract. The clause is now **two obligations the contractor carries and one behaviour explicitly excluded from them**:

| | |
|---|---|
| **Contractor carries** | Tag read success at or above 98%, on the matrix in supported states. |
| **Contractor carries** | Correct blend page readable within 2.0 s of navigation start. |
| **EXCLUDED** | The OS confirmation step. iOS raises a banner and the page does not open until it is tapped, measured 0.6 to 1.2 s. Android shows no banner and opens directly, measured 0.7 to 0.9 s. **Logged and reported on every run. Never scored. Not a defect on either platform.** |

Plus two preconditions, which are part of the criteria rather than caveats to them: the device matrix, and the device state.

**Why the excluded step is still measured.** Deleting it from the report would be convenient and dishonest. It is real time that a real customer experiences, it differs by platform by a factor of two, and it is the difference between "the tap is slow" and "the OS is doing what the OS does". Reporting it every run means nobody at the demo mistakes a banner for a bug. It also solved a real mystery: the client's team remembered "the thing worked" but nobody remembered a banner, which is very strong evidence those informal tests were done on a sleeping phone, which reads nothing at all.

**The same instrument records the bench runs, the M2 gate, the M5 matrix and every customer tap after launch**, so the number accepted in August is measured the same way as the number reviewed in December. The 2,000 ms histogram bucket boundary in the analytics rollups is deliberately placed at the acceptance number, so "what fraction of real customer taps were readable inside 2.0 seconds" is read directly off a rollup rather than calculated by someone who has to be trusted to have done it right.

---

## 8. The data layer

Five DynamoDB tables: `SpiceBlends`, `ScanEvents`, `Recipes`, `Growers`, `NFCTags`. **No sixth table is introduced**, which is why the Shopify catalog mirror lives in `SpiceBlends` under a `CATALOG#` key namespace and the analytics rollups live in `ScanEvents` under a `ROLLUP#` namespace.

In this kind of database the access patterns **are** the design, not a tuning exercise added later. There are eight of them, and exactly one is on the tap path.

| # | Pattern | Operation | On the tap path |
|---|---|---|---|
| 1 | Blend by slug with grower and recipes | GetItem plus a parallel Query and GetItem | No. Build and revalidate only. |
| 2 | List blends by status | Query on a `status-updatedAt` index | No. Admin, sitemap, build manifest. |
| 3 | Recipes for a blend in carousel order | One Query on a zero padded sort key | No. Page build. |
| 4 | Grower for a blend | One GetItem | No. Page build, snapshotted into the page. |
| 5 | **Write a scan event** | **One conditional PutItem. Zero reads.** | **Yes, after paint, non blocking.** |
| 6 | Rollup counters | Stream triggered, batched, atomic `ADD` | No. Asynchronous. |
| 7 | Dashboard time series | One Query per series on a rollup partition | No. Dashboard load. |
| 8 | Catalog mirror read | One GetItem, mostly absorbed by a 60 second CDN cache | After paint, optional, degradable. |

**There is no `Scan` operation on any of the five tables anywhere in application code.** The only one in the whole build is in a test helper that truncates tables between test files. A `Scan` in this codebase is a defect regardless of current table size, because a `Scan` written in August because "there are only five rows" is still there in a year when there are not, and because it is the pattern that gets copied into the next query somebody writes.

### Pattern 5, the only one a customer triggers

One `PutItem` with `ConditionExpression: attribute_not_exists(pk)`. The deduplication check **is** the condition: no read before the write, no lock, no retry. A `ConditionalCheckFailedException` means a duplicate and is a success, and the API returns 202 for it exactly as it does for a new event. The client cannot tell the difference and must not try, because a beacon that inspects a response and retries is a beacon that can interfere with navigation.

The partition key is `EVT#{blendSlug}#{date}#{shard}` where the shard is the first hex character of the deduplication token, giving 16 partitions per blend per day. Without it, five blends produce five write hot partitions per day, which is a known failure shape and one that only appears under the traffic you most want to survive. Deriving the shard from the token rather than at random is what keeps deduplication working.

### The rollups, and the one thing most likely to be dropped

**The dashboard reads pre aggregated rollups and never raw events, and never scans a table.** That is the difference between a dashboard that is still fast at ten million scans and one that gets slower every month. Ninety days of chart costs about 6 RCU whether the underlying data is a thousand events or ten million, because the cost is a function of the number of days requested and nothing else.

Rollups live in `ScanEvents` under `ROLLUP#`. That has one consequence which is easy to miss and expensive to miss:

> **Rollup writes appear in the same DynamoDB stream that triggers the consumer that produced them. Without a filter this is an infinite loop that will happily bill for itself.**

The event source mapping filters to `eventName = INSERT` **and** `pk` beginning with `EVT#`. Both halves are load bearing. INSERT only excludes a rollup increment, which is a MODIFY, and a TTL expiry, which is a REMOVE. The `EVT#` prefix is needed because **the first rollup write of a new day is an INSERT, not a MODIFY**, so filtering on event name alone would let one through per blend per day and start the loop. The consumer applies the same rule again in process, so a mapping deployed without its filter still cannot start the loop, and there are unit and integration tests for both halves.

The counters are updated with atomic `ADD`, which needs no read and no lock. Histogram buckets are stored rather than only a count and a sum, because **a p95 reconstructed from a count and a sum is a fiction**.

Stream delivery is at least once and `ADD` is not idempotent, so a retried batch would double count. Three guards: the INSERT only filter, a batch checkpoint item written conditionally before the increments, and bisect on error **disabled** with failures going to a dead letter queue so a batch is never split into a shape the checkpoint does not recognise. **The residual is stated rather than hidden: a narrow failure window can over count by at most one batch.** That is acceptable because the number is an engagement metric rather than a financial one, and because raw events are retained, so any disputed period can be recomputed exactly by a backfill.

### Privacy, which is also a performance decision

No IP address is stored, logged or read. Geography is derived **server side from CDN viewer headers** to country, region and city only. The browser is never asked for location permission. There are no customer accounts, so there is no customer credential surface at all, and no cookies or third party trackers on the tap path.

The privacy posture and the performance decision point the same way, which is why there is no consent banner two seconds after a customer has touched a spice jar.

---

## 9. Domain routing

`treveanspice.com` has to serve three things: the marketing site, the `/t/` and `/q/` redirects, and the blend pages.

**CloudFront owns the apex.** One distribution, routing by path:

```
/t/*, /q/*      -> CloudFront Function at viewer request. No origin. Never reaches a server.
/blend.html     -> AWS origin
/_next/*, /assets/*, /images/*   -> AWS origin
* (default)     -> the marketing site, reached as a custom origin
```

**Why the apex is not negotiable:** the tags carry `treveanspice.com/t/{code}`, so whatever serves the apex must serve `/t/*`. There is no arrangement in which the marketing site keeps the apex and the redirect lives elsewhere, short of a proxy hop or a cross origin redirect, and a cross origin redirect costs 300 to 600 ms of a 2.0 second budget that does not have it. This is the tempting option and it is the expensive one.

**Why CloudFront rather than putting the redirect on the marketing platform's edge:** the redirect table would then live with the marketing site rather than with the application, and when the application moved fully to AWS the table would have to move with it. That is precisely the migration that strands inventory. Choosing CloudFront at the apex means the migration never has to happen.

**That reasoning is still right and it is not the whole answer, which is section 9.1.**

### 9.1 Serving the redirect somewhere other than CloudFront, and the six properties that decide whether it costs anything

**This section was added Tuesday 25 August 2026 and it exists because the architecture above had exactly one specified host and nothing deployed to host it on.**

> **CORRECTED Thursday 27 August 2026 on one fact and one only. The decision in this section stands and is not reopened.** The account statements below were wrong: `888348806392` is `Trevean-NFC-Development`, the development account, and the Organization management account is `[account id withheld]`, `Trevean Spice`, org `o-q36zht9ztn`. The two were recorded the wrong way round from Monday 24 August to Thursday 27 August 2026. **Serving the tag routes from Vercel was and is the fastest route to working jars on the real domain, because it needs no certificate and no nameserver change.** What the correction removes is an argument that made the decision look more forced than it was. See "Decision log", D32 and D25, and the document titled "The deployed development environment".

**What changed.** The client's marketing site is live on Vercel with real content. ~~The AWS Development account does not exist yet, and the only AWS account available is the Organization management account.~~ **Wrong: the development account existed throughout, and the development environment was applied into it on Thursday 27 August 2026, 169 resources, distribution `d1uyspgs0bmg3a.cloudfront.net`.** **`treveanspice.com` resolves, at Bluehost, and answers HTTP 403 on the apex and HTTP 500 on `/t/ps`.** **A thousand encoded jars are the only part of this system that cannot be changed later, and they are behind a production chain, a certificate and a nameserver change, that does not exist yet.**

**So the near term answer is that the apex and the five tag routes are served from Vercel, and the AWS environment is built alongside without a deadline pressing on it.** The 22 August version of this package contemplated no such thing, and a reader following it would conclude there is exactly one way to get a thousand jars resolving and it runs through a certificate and a nameserver change on a domain that is carrying live company email.

**This stopped being a recommendation on Tuesday 25 August 2026. The client approved it**, and the implementation exists: **109 of 109 tests passing**, compiled from the same canonical redirect table the CloudFront package uses and never copying it, with a test asserting no second table ever appears alongside it. **Three of the six properties below survive by construction and three CloudFront behaviours do not survive the move at all: query strings are appended to the redirect destination rather than dropped, the table identity header in property 5 is gone, and unknown code logging is gone.** All three are documented with the implementation and all three come back with CloudFront. **Property 6 is the one that decides whether the eventual move is a deploy or a rebuild, and it is the one that is enforced by a test rather than by intention.**

**The decision about where the redirect lives permanently is not reopened here.** The reasoning above is unchanged: the redirect table belongs with the application, and a table that lives in a marketing platform's console is a table that strands inventory when the application moves. **What changes is that an interim host is now a legitimate answer, provided it preserves six properties.** Get these six right and the eventual move to CloudFront is a deploy rather than a rebuild. Get any one of them wrong and the move is a rebuild with physical inventory behind it.

| # | Property | Why it is load bearing |
|---|---|---|
| 1 | **307, never 301 and never 308** | A 301 is cached by browsers and intermediaries, in some cases indefinitely, and there is no server side fix on a device that already holds one. If a 301 ever reaches production for `/t/*`, it is an incident with a permanent blast radius on every device that tapped during the window. See the document titled "Runbooks", section 3. |
| 2 | **`Cache-Control: no-store` on the redirect response** | Same reason, from the other direction. The redirect must stay repointable, and a cached redirect is not. |
| 3 | **A relative, same origin `Location`** | A cross origin redirect costs 300 to 600 ms of a 2.0 second budget that does not have it. The budget starts at the request for `/t/{code}`, so the hop is inside it. |
| 4 | **The query string is never read** | Attribution parameters are read by the page after paint, never by the redirect. A redirect that reads the query string is a redirect whose behaviour depends on a value a customer can type. |
| 5 | **The `x-trevean-table` digest header** | It is how anybody proves the deployed table matches the table in version control, which is the check in the document titled "Runbooks", section 7.2, step 3. Without it a hand edited redirect is undetectable. |
| 6 | **The table is compiled from `build/edge/redirect-table.json`, never hand entered in a console** | This is the one that decides whether the eventual migration is a deploy or a rebuild, and it is the reason CloudFront was chosen in the first place. A table typed into a hosting console is a second copy of the truth, and the failure mode of a second copy is a customer reading about the wrong blend. |

**What an interim host does not have to preserve.** The compiled artifact's 10,240 byte code limit is a CloudFront Functions constraint and the edge package's compiler enforces it. A different platform's edge function has a different limit or none. **Keep enforcing it anyway**, because the artifact has to remain deployable to CloudFront without a rewrite, and an artifact that grew past the limit on a permissive platform cannot go back.

**What is not solved by moving the redirect, and should not be assumed to be.** Three things in this package are CloudFront mechanics with no automatic equivalent elsewhere, and each needs an answer from whichever platform serves the apex: the `/t/*` and `/q/*` behaviour association, which is what stops the redirect answering 404 for the entire marketing site; the `/blend.html` cache key excluding `via` and every `utm_*` parameter, which is the most likely cause of a collapsed cache hit ratio; and the `CacheHitRate` monitoring subscription, which is what makes the alarm in the document titled "Runbooks", section 6, mean anything. **An alarm on a metric that is never published sits in insufficient data forever, which looks exactly like health**, and that is true on any platform.

**The CORS gap on the scan beacon is affected too.** The document titled "API reference", section 8, recommends closing it by serving the beacon from the apex as a cache behaviour on the same distribution. There is no distribution. **The recommendation survives the platform change in substance, which is that the beacon should be same origin with the page, and the mechanism is whatever the interim host calls a rewrite.**

### What is genuinely unresolved here, and it is not a technicality

**Where the marketing site lives is now known and the record should say so plainly: it is live on Vercel**, confirmed on Monday 24 August 2026, with real content including named growers and farm coordinates. The earlier uncertainty, in which the client described both the 6 August tap destination and the printed QR destination as Squarespace, is resolved in favour of Vercel for the current site. **It does not resolve where the printed QR codes point**, which is a separate question about ink on labels that were printed before any of this, and it is still open. See the document titled "Limitations and future work", section 5.

**Two content questions opened when the site was read, and both would be visible to a customer. One closed on Tuesday 25 August 2026 and the other escalated.**

**Closed: the blend count.** The range is **five blends, confirmed by the client**, and the sixth listing on the marketing site is not a product. Four codes are on physical tags, a fifth is reserved. **The closed slug enum therefore stays closed**, which is load bearing rather than tidy: it is what lets the unauthenticated scan beacon reject an unknown slug at the schema boundary before any handler runs, and opening it would have touched eleven schemas.

**Escalated: the Persian Sunrise origin.** The site places the grower near Kashan and the packaging conversation recorded Isfahan, about 150 km apart. **As at Tuesday 25 August 2026 the question is unresolved, the farmer cannot be contacted, and the client reports that United States export controls may prevent using either origin.** It is with the client and a colleague. **No view is offered on that here: it is not an engineering question.** What follows for a developer is narrow and it is binding: **nothing is copied from the live site into the content fixtures for Persian Sunrise**, the grower record cannot be written until an origin exists or the blend changes, and **if the blend changes, that is one edit to the redirect table row and the 1,000 shipped tags are untouched.** That is exactly the property the redirect table exists to provide.

**Also unresolved and consequential: the on pack QR codes are already printed and point at Squarespace rather than at the tap destination.** Unlike a tag, printed stock cannot be re pointed by editing a table. Three routes exist and one has to be chosen: make those URLs resolve to the same destination, reprint, or renegotiate the parity clause. The last is not recommended, because the QR is the sole recovery route for a sleeping handset, a locked Android, and every device outside the matrix. **The photograph of a printed label is still outstanding from the client, and until somebody reads the exact address inside that QR code the question cannot be answered at all.**

---

## 10. Security posture, in one place

- No customer login, no accounts, no customer credential surface at all.
- No IP storage. No cookies and no third party trackers on the tap path.
- Admin behind role based auth: a bearer JWT validated on signature, issuer, audience and expiry, with Viewer, Editor and Admin roles. Insufficient role returns **403, not 404**, because hiding admin routes from an authenticated internal user buys nothing and makes support harder.
- Secrets in a managed store, never in the repository, including the tag area password with a named holder and a documented rotation path. The environment variable path exists for local development and is **refused outright when the stage is production**, in code rather than by configuration convention.
- Signature verification on every inbound webhook, over the raw body, with a constant time comparison, before any processing.
- Least privilege IAM: eight functions, eight roles, eight policies. No shared execution role, no wildcard on a table, a bucket or a secret. The exact actions the code calls are enumerated in the API package, including what is deliberately not granted.
- Structured logging with a redaction rule that is not optional: `x-forwarded-for`, `cloudfront-viewer-address`, `user-agent`, `authorization`, `cookie` and `email` are redacted by leaf key name, asserted by a unit test.
- Rate limits enforced at the CDN and WAF layer rather than in application code, so a flood never reaches a function.
- The scan beacon cannot hold a secret, because a browser beacon never can. It is protected by shape instead: every field is an enum, a bounded string matching a documented pattern, or a number in a documented range; unknown properties are rejected; `Origin` is recorded rather than trusted. The realistic attack is inflating a scan count, and the honest mitigation is that the dashboard already labels these counts by method.

---

## 11. What is deployed, and what is not

> **CORRECTED Thursday 27 August 2026. The development environment is deployed, and the account fact this section rested on was wrong.** `888348806392` is `Trevean-NFC-Development`, the development account, not the management account, which is `[account id withheld]`. **169 resources applied on Thursday 27 August 2026, distribution `d1uyspgs0bmg3a.cloudfront.net`, all five tag codes verified end to end.** See the document titled "The deployed development environment", and "Decision log", D32.

**Nothing was deployed as at Tuesday 25 August 2026**, when the AWS account contained one Terraform state bucket and nothing else. The Terraform is written, formatted, validated and was planned against the real account: 140 resources, of which 24 are IAM resources the current principal cannot create. Nothing has been applied, deliberately, because an apply today would create roughly 116 resources and then fail on the first IAM role, leaving a half built environment and a partial state file in a client account.

**One thing about that account was written down wrong after this document was written, and the correction is in the document titled "Runbooks", section 2.2.**

~~**It is the management account of an Organization and there is no member account beneath it.** Every environment in this stack would therefore land in the same account as production, with nothing above it to enforce a guardrail.~~ **WITHDRAWN Thursday 27 August 2026. It is the development account, it sits beneath the management account `[account id withheld]`, and it was the correct place for `envs/dev` all along.** **The saved 140 resource plan should still be deleted rather than trusted**, because it is superseded by the 169 resource apply, not because it was aimed at the wrong account.

**`treveanspice.com` resolves, and it answers the wrong thing. Corrected later on Tuesday 25 August 2026: an earlier line here said it returns SERVFAIL, and that is superseded.** Nameservers `ns1.bluehost.com` and `ns2.bluehost.com`, apex A record `50.6.2.51`, **and email on the zone is fully restored across MX, SPF, a Google DKIM selector and DMARC, all four verified.** **The apex returns HTTP 403 and `/t/ps` returns HTTP 500**, because the domain points at Bluehost rather than at the deployment, so a thousand encoded jars reach an error rather than nothing. **The DNS cutover procedure is a cutover again rather than a bring up, and what blocks it is that there is nowhere to cut over to.** One task is available today and is not done: exporting the zone verbatim as the rollback record. See the document titled "Runbooks", section 9.1.

**The M2 gate has not run and it has no date.** Under decision D7 it is Trevean staff, on Trevean materials, at Trevean's facility, and it needs a named tester with one to two full days booked, Q6 answered, and physical jars with interim lids at 8 mm or thicker, none of which exists. **Our own M2 delivery is held at Friday 28 August 2026 and the day for day slip from Friday 21 August is withdrawn, absorbed on our side** (D27). **The two are different things and Friday 28 August is not a gate date.** **Monday 31 August 2026 and Thursday 3 September 2026 are superseded.**

**Everything in sections 2 to 10 above therefore describes a system that is built and tested on developer machines and specified end to end, not a system that has served a customer.** Eleven packages exist under `build/`, every one of them passes its own suite, and **not one of them has met a physical tag, a live store, a real editor, a real scan, or real content.** The document titled "M5 handoff package" has the package by package version of that sentence.

That distinction is maintained deliberately throughout this package. See the document titled "Runbooks", section 1, for which procedures can be executed today and which are waiting.
