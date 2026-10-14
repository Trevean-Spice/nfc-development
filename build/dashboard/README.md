# Trevean Spice scan analytics dashboard

Scan volume, the NFC and QR split, platform breakdown, city level geography, content
engagement and reorder clicks. One screen, built against the frozen M1 API contract,
version 1.0.0.

**M4 deliverable, due Friday 18 September 2026.**

---

## The two rules this page is built around

**1. It reads pre-aggregated rollups. Never raw events, never a table scan.**

Access pattern 7 in the Architecture document, "Data layer": one Query on one rollup
partition, sort key `BETWEEN` from and to. A 90 day chart costs the same as a 30 day chart
plus sixty more rows, and ten million scans costs exactly what ten scans costs, because the
cost is a function of the days requested and nothing else. A scan on a read path is a
design failure rather than an optimisation problem, and this package proves the absence
rather than asserting it: see "The test that matters" below.

**2. NFC and QR are labelled as measured by the same method, on the page, above the
numbers.**

The 1,000 tags in this production run were encoded per SKU before the engagement began, so
there is no per tag identifier and no chip UID available to the page, and Augmented NDEF and
TruST25 are deliberately dormant. Deduplication is therefore a browser side token, and it is
the same browser side token on the QR path as on the NFC path. That is measurably weaker
than a per tag counter. The Architecture document, "Scan tracking", and the Acceptance
criteria document, section 6.2, "Scan deduplication", both require the dashboard to say so
rather than imply a precision the encoding does not provide.

The page says, in its own words, above the first number:

> Taps (NFC) and scans (QR) are counted the same way: one per browser per blend per 30
> minutes. Neither is a count of jars. Shared links and typed URLs are counted separately as
> direct.

It also renders, verbatim, the `measurementNote` the API returns on every response, so the
label on the page and the label in the contract cannot drift apart without the divergence
being visible.

**One word was changed here first, and the deliverable has since been corrected to match.**
The QR attribution deliverable, section 6, originally proposed that sentence with "per jar"
where this package renders "per blend". The deduplication key is the blend slug and a browser
token; a jar is not in the key and cannot be. In a sentence whose entire job is to deny per
jar precision, "per jar" is the one word that would do the most damage, so this package
rendered "per blend" and flagged the divergence rather than reproducing it quietly. **That
deliverable was corrected on Saturday 22 August 2026 and now reads "per blend" too, so the
document and the implementation agree and there is nothing left for Dan to arbitrate.**

---

## Running it, with no AWS account

```bash
cd build/api && npm install      # once. This package installs nothing of its own.
cd ../dashboard
npm run local:up
```

That starts, in order: an in process DynamoDB, a recording proxy in front of it, the API
from `build/api`, content seeding, 90 days of seeded rollups, and a static server for this
page with `/v1` proxied to the API at the same origin. It prints the address. A Viewer token
is minted and served at `/dev/token` for that session only.

```bash
npm run local:up -- --qr-not-distinct   # seed the world where the printed QR has no route of its own
npm run local:up -- --days 30 --today 2026-08-22
```

Options worth knowing:

| Flag | Effect |
|---|---|
| `--qr-not-distinct` | QR counters stay at zero and those scans land in `direct`, which is what happens if the printed QR arrives without a channel. The page then explains itself instead of showing a bare zero. |
| `--days N` | Length of the seeded history. Default 90. |
| `--today YYYY-MM-DD` | Anchor date for the seeded history. Default the real UTC date. |
| `DASHBOARD_PORT` | Fix the port instead of taking a free one. |

**Things to try once it is up**, because they are the states that matter:

1. Select **Kyoto Garden**. It is a draft blend and no tag in the SO4731 run carries its
   code, so it has no rollup rows at all. That is the honest empty state, on a real
   selection, without waiting for a real empty window.
2. Move the window back before the seeded launch date. That is the sparse state.
3. Switch the granularity to **Hour** with the last 48 hours preset.
4. Run with `--qr-not-distinct` and look at the split panel.

---

## What is on the page, and where each number comes from

| Panel | Source | Notes |
|---|---|---|
| Counted scans, NFC to QR, engagement rates, mean time to readable | `scans`, `ch_*`, `recipeOpens`, `reorderClicks`, `ttr_count`, `ttr_sum_ms` | The mean is exact because count and sum are both on the rollup. There is deliberately no window percentile: per bucket percentiles cannot be averaged into one without inventing a number, so the worst single bucket is reported under its own name. |
| Scan volume over time | `ROLLUP#BLEND#{slug}#DAY` or `#HOUR`, or `ROLLUP#ALL#DAY` or `#HOUR` | One stacked column per bucket, split by channel. One range query. |
| NFC and QR split | The same counters | Three channels, always. `direct` is never folded into NFC. |
| Platform breakdown | `pf_ios`, `pf_android`, `pf_other` | Platform family, not handset model. The rollup carries no model and this page does not read raw events to get one. |
| Where scans happened | `ROLLUP#BLEND#{slug}#GEO#DAY` | Country, region and city, derived server side from CDN viewer headers. No IP is stored and the browser is never asked for location permission. |
| Content engagement and reorder clicks | `recipeOpens`, `reorderClicks` | Rates share the scan denominator. A reorder click is a click, not an order. |

Two endpoints are called and no others:

```
GET /v1/admin/analytics/scans   adminGetScanTimeSeries   minimum role Viewer
GET /v1/admin/blends            adminListBlends          minimum role Viewer
```

Both are in the frozen contract. A test asserts that the paths this package builds exist in
`deliverables/m1/01-api-contract.openapi.yaml`, that only contract declared query parameters
are sent, and that the range limits this page enforces are the ones the contract states.

---

## Empty and sparse states

Before launch there is almost no data. A dashboard that looks broken when it is merely empty
generates false alarms, and a dashboard that renders `NaN%` gets reported as a defect.

- **Empty**, meaning no counted scans in the window: the charts are not drawn as blank
  frames. The page says what was asked for, says that empty is the expected result before
  launch, and lists what to check, ending with the only one that matters: if jars are in
  trade and this stays empty, the thing to check is the beacon, not this page.
- **Sparse**, meaning fewer than 25 counted scans or fewer than three buckets with data:
  everything is drawn, with a banner saying shares are volatile at this volume. The
  thresholds are one constant in `public/lib/derive.js` so they are arguable rather than
  buried.
- **No timing samples**: percentiles read "not measured" rather than zero.
- **No places**: the geography panel says the geography rollup is empty and that this says
  nothing about the scan counts elsewhere on the page.
- **Every zero denominator produces null and renders as "not measured".** A test runs every
  pair from a list including zero, negative, `NaN`, `Infinity`, `null` and `undefined`
  through the formatter and asserts that neither `NaN` nor `Infinity` can reach the page.

---

## The test that matters

```bash
npm test              # everything: 111 tests, 97 unit and 14 live
npm run test:unit     # pure functions, no stack, about a second
npm run test:live     # the full stack assertion, about 10 seconds
```

`test/live/query-shapes.test.mjs` starts the real API from `build/api` against a real
DynamoDB compatible database, **with a recording proxy in between**, then performs a
complete dashboard load exactly as the browser does and inspects every database operation
the load caused.

It asserts:

- **Zero `Scan` operations**, on any table, on any selection. Six selections are exercised:
  all blends, a named blend, a 90 day window, both hourly views, and a blend with no data.
- Every read of `ScanEvents` is a **`Query`** with key condition
  `pk = :p AND sk BETWEEN :from AND :to`, **no `FilterExpression`** (a filter on a read path
  is a scan wearing a hat) and **no `IndexName`**.
- Every partition read begins with `ROLLUP#` and **never** with `EVT#`. The raw event
  namespace is not touched by any dashboard path.
- **Seven days and ninety days issue the same number of round trips.** That is the property
  the rollup design exists to give, asserted rather than claimed.
- The all blends view is bounded by the blend count, not by traffic.
- The response carries `source: rollup` and `measurementMethod: browser_token`, every time.
- A real load renders a page with real numbers, no `NaN` and no `undefined`.
- A blend with no data renders the empty state end to end.
- The endpoint refuses a caller with no credential, and a Viewer credential is enough.

The point of testing it this way: asserting on the source proves that nobody wrote the word
`Scan` today. Asserting on the wire proves that a full load, through code this package does
not own, issued only bounded partition queries, and it would still fail if a scan were
introduced three layers down in a repository this package does not control.

The rest of the suite covers the honesty requirements on rendered output (the measurement
label appears above the first number, nothing claims a per jar count, the QR degradation is
explained, an unexpected `measurementMethod` is flagged rather than relabelled, API values
are escaped), the chart geometry, the CSV export, the contract URLs, the seeded data, and
the house style: **no en dash and no em dash anywhere in the package, including code
comments and UI copy**, checked by walking every file.

---

## Q19: who is this for

**Recommendation: build for marketing self serve, and this is built that way.**

The knowledge base records Q19 as open, with the recorded recommendation being self serve on
the grounds that it is the same effort and more useful. That holds, and it is now
implemented rather than recommended:

- Every control is on the page. Blend picker, date range with presets, granularity toggle,
  and CSV export of exactly what is on screen.
- **The Viewer role is enough for all of it.** No Editor or Admin capability is needed to
  read a number, which is what makes the role meaningful rather than decorative.
- The selection is in the address bar, so a view can be sent to somebody else and it opens
  the same.
- Exported rows carry `measurement_method`, `source` and the measurement sentence **on every
  row**, not in a header comment, because a header comment is the first thing lost when
  three rows are copied into a slide.
- Language is plain. Percentiles, cache status and the rollup mechanism are explained where
  they appear rather than assumed.

The cost of the decision, stated so it is a decision rather than a default: a self serve
page has to be defensive about being read without an engineer present, which is most of the
copy in `public/lib/copy.js` and most of the empty and sparse state handling. That work is
what makes the page safe to hand to marketing, and it would have been skipped for a
Dan only tool.

**What still needs a decision from the client:** whether the Viewer role gets real users in
the identity provider, and who they are. That is an M3 admin auth item, and it is the only
part of self serve this package cannot deliver on its own.

---

## Gaps, reported rather than worked around

None of these were resolved by inventing an endpoint or a field.

**1. Geography for the all blends view needs a fan out.** The contract returns `topCities`
only on a daily series for a named blend, and the Data model document, section 5.2, defines
the geography rollup per blend. For the all blends view this page therefore issues one daily
series per blend and sums the place rows: five bounded partition queries, not a scan, bounded
by the number of blends rather than by traffic. **Recommended additive change: a
`ROLLUP#ALL#GEO#DAY` partition**, written by the same stream consumer, which would make it
one query. Additive, no contract change to the response schema, and it is the kind of thing
that is cheap now and awkward once there are twenty SKUs.

**2. Geography is not available at hour granularity.** The geography rollup is per day. The
page issues a day granularity companion query for the same window rather than leaving the
panel blank, and the panel says the places are for the whole window.

**3. Device breakdown is platform breakdown.** The rollup carries `pf_ios`, `pf_android` and
`pf_other`. `deviceFamily` exists on the raw event and this page will not read raw events to
get at it. If a handset level breakdown is wanted, the honest way to get it is **new rollup
counters written by the stream consumer**, not a query against raw events. The panel says
what it is showing in the meantime.

**4. Placed scans are fewer than counted scans.** A scan whose CDN headers carried no country
produces no place row, so the geography shares are of placed scans. The page shows the gap
rather than normalising it away.

**5. Channel counters could disagree with the scan counter.** They are pre-aggregated
independently. If they ever disagree the page says so rather than normalising the
percentages to add up. This has never fired against seeded data and it exists for the day a
beacon arrives without a channel.

**Every channel share on the page is of the channel total**, nfc plus qr plus direct, in the
volume legend and in the split table alike. The legend used to divide by the scan counter
while the table divided by the channel total, so a disagreement between the two counters
produced two different percentage sets for the same three numbers with one warning attached
to only one of them, and an over count rendered a silent `400.0%` in the legend. The legend
labels a stacked column chart whose columns are stacks of the channel counts, so the channel
total is what it is answering about, and it is the denominator the platform panel has always
used. The scan counter is still shown in its own right, in the headline tile and in the
table view. When the two disagree, the reconciliation warning now appears in both panels.

**A share outside 0 to 1 renders as "out of range" with the value beside it, never as a
percentage.** `formatShare` enforces that and `formatPercent` does not, which is the
difference between the two: the engagement rates are genuinely allowed above 100%, because
one counted session can open more than one recipe, and the channel and platform and
geography shares are not.

**6. There is no authenticated identity here.** Local development mints a symmetric token,
which the API refuses outright when the stage is production. In any real environment the
dashboard sits behind the same identity provider as the admin CMS and the token prompt is
the interim stand in.

---

## Security and privacy

- **No IP address anywhere.** Geography arrives as country, region and city, derived server
  side from CDN viewer headers. A test asserts the exported place rows carry no coordinates
  and no address field.
- **No location permission prompt**, here or on the consumer page. The privacy posture and
  the performance decision point the same way.
- **Every value that reaches the page is escaped**, including city names, which originate
  outside our systems. A test drives hostile values through the full render.
- **The credential lives in session storage for one tab** and is never put in the address
  bar. A 401 clears it.
- **Nothing third party is loaded by the browser.** No CDN, no font host, no analytics on the
  analytics page. A test asserts that the only absolute URLs in browser code are localhost.

---

## How it is put together

```
public/                the deployed artifact, served as written, no build step
  index.html           the one page
  styles.css           roles as custom properties, light and dark each validated
  app.js               browser wiring only: credential, controls, events
  lib/copy.js          every word the page says about what its numbers mean
  lib/api.js           the only file that knows a URL
  lib/derive.js        totals, shares, density, geography merge. Pure
  lib/charts.js        SVG marks. Pure, returns strings
  lib/render.js        the page. Pure, returns strings
  lib/format.js        formatting, and the rule that a zero denominator is null
  lib/csv.js           export, with the measurement label on every row
  lib/state.js         presets, granularity rules, the address bar round trip
tools/                 development only, never deployed
  local-stack.mjs      one command: database, proxy, API, seed, server
  seed-rollups.mjs     90 days of pre-aggregated rollups, deterministic
  server.mjs           static files, /v1 proxy, the local token route
  lib/recorder.mjs     the recording proxy the no scan assertion depends on
  lib/deps.mjs         borrows dynalite and the AWS SDK from build/api
  lib/devtoken.mjs     an HS256 token from node:crypto, local only
test/
  unit/                pure functions, no stack
  live/                the full stack query shape assertions
```

**Render functions return strings and take data.** That is what lets the suite assert the
honesty requirements on real rendered output rather than on intentions, in Node, with no
browser and no DOM library.

---

## Deploying

The deployed artifact is the contents of `public/`: five files, all first party, no build
step. Behind the CDN, with the API reached at the same origin by path, so there is no CORS
configuration anywhere. `tools/` is development only and ships nowhere.

The dashboard is an internal admin page and is deliberately outside the consumer performance
budget: it is not on the tap path, it is not pre-rendered, and it builds its charts in the
browser. Nothing about it touches the 2.0 second requirement, and it must never be linked
from a blend page.

---

## Related documents

Cross references are by document title and section number, never by filename.

- The frozen API contract, version 1.0.0, operations `adminGetScanTimeSeries` and
  `adminListBlends`
- The Data model document, sections 4 and 5
- The Architecture document, "Data layer", "Scan tracking", "Security and privacy"
- The Acceptance criteria document, sections 6.1 and 6.2
- The Scope document, "In scope" items 5 and 6, and "IP and handoff"
- The QR attribution deliverable, sections 3, 6 and 12
