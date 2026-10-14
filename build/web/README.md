# Consumer blend pages

The page a customer sees when they tap a jar of Trevean Spice or scan the QR code on the pack. M2 deliverable, due at the M2 gate.

One static HTML file per blend. No framework runtime, no hydration, no JavaScript before the page is readable, no origin compute and no database read on the tap path.

---

## What this is, in one paragraph

The 1,000 encoded tags carry `treveanspice.com/t/{code}`. The edge answers with a 307 to `/blend.html?blend={slug}&via=nfc`, and rewrites that request onto a pre-rendered `/blends/{slug}.html`. The customer's address bar still reads `/blend.html?blend={slug}&via=nfc`. `via` exists so the dashboard can split NFC from QR, it is excluded from the CDN cache key, and it changes nothing a customer sees.

**The QR code on the pack encodes `https://treveanspice.com/q/{code}`.** It resolves through the same code and the same redirect table as the tag, so a blend is repointed in one place and never in two, and it 307s to the same destination page carrying `via=qr`, which comes back as byte for byte the same document. Pointing the QR straight at `/blend.html` would work today and would silently stop matching the tag the first time the table was edited, on artwork that cannot be recalled from a printed carton. The authoritative list of the five URLs is `build/edge/dist/qr-artwork.csv`, generated from the redirect table. See the document titled "M1 Deliverable 14: QR attribution".

The route is the path on both sides. `/t/{code}?via=qr` still answers `via=nfc`: the edge function reads no query string at all, which is what keeps an attacker-supplied value out of the `Location` header and an attribution value out of the cache key.

Three facts that get assumed wrong and are worth carrying into any change here:

- **The tag is an STMicroelectronics ST25TV02KC, NFC Forum Type 5 / ISO 15693.** It is not NTAG21x / Type 2. Nothing in this package touches the chip, but the platform behaviour the on-page copy describes follows from it.
- **The bamboo lid is 8 mm.** Any figure quoting 4 mm is stale.
- **Attribution is per SKU.** There is no per-tag identifier and no chip UID available to the page, so the beacon dedupes with a browser-side token and nothing here may invent a per-jar id. `npm run verify` fails the build if it finds one.

The reasoning behind the shape of all of this is in the M1 deliverables "Per-page byte and speed budget", "Redirect-Serving Decision and Apex Domain Routing", and "API Contract", and in the Architecture document, "The tap path".

---

## Requirements

Node 20.9 or newer. A Chrome or Chromium install is needed only for `npm run measure` and `npm run screenshot`, and it is located automatically.

```bash
npm ci
```

---

## Everyday commands

| Command | What it does |
|---|---|
| `npm run content:fetch` | Reads the API into a content snapshot, in the content package's own shape. **This is the step that makes an editor's change reach a page.** Needs `TREVEAN_CONTENT_API` set. |
| `npm run build` | Generates media derivatives, renders every published blend, then rewrites the export into the document the byte budget describes. Fails on a breach. |
| `npm run verify` | 211 assertions against the built files and against a live server serving them, including that the scan beacon body is the one the frozen contract accepts. This is the one to run before handing anything over. |
| `npm run measure` | Lighthouse, three phases, both viewport endpoints. Writes `measurement-report.json`. |
| `npm run screenshot` | The section 6.3 evidence: fold measurements, tap counts, branded failure pages. Writes `verification/`. |
| `npm run serve` | The edge stand-in on port 3000, so you can open the page in a real browser. |
| `npm run licenses` | Regenerates `MANIFEST.md` and `licenses.json` from `node_modules`. |
| `npm run sync:beacon` | Re-copies the field beacon from the M1 measurement harness and re-records its SHA-256. |
| `npm run dev` | Next dev server. Useful for markup work, **not** representative of what ships: the postbuild step is what removes the framework runtime. |

`npm run build` runs `scripts/generate-media.mjs` first through `prebuild`, so a clean checkout builds in one command.

---

## How the build works, and why it is not a plain `next build`

Next renders the markup well and then ships about 97 KB of hydration JavaScript and a copy of every prop as inline JSON. The budget allows **zero** JavaScript before readable, not "minimal", so `scripts/postbuild.mjs` rebuilds each document from the rendered markup:

1. Take the markup inside `#__next` and the head elements this project marked `data-keep`.
2. Inline the whole stylesheet: `src/styles/critical.css` plus `src/styles/placeholder.css`.
3. Add a 172 byte inline loader that fetches `/js/enhance.js` after the window `load` event and does nothing else.
4. Delete `out/_next`, then assert: no `<script src>`, no `/_next` reference, no `__NEXT_DATA__`, inline CSS at or under 9,216 bytes, document at or under 14,336 bytes Brotli.
5. Write `out/route-manifest.json`, which is what the edge rewrite configuration is generated from rather than typed twice, and `out/build-report.json`.

`next.config.mjs` sets `output: 'export'`. That is deliberate: it turns a route that has quietly opted out of static generation into a build error instead of a page that renders on demand in a customer's kitchen.

### Where the content comes from

`src/content/load.ts` reads, in order:

1. `TREVEAN_CONTENT_API`, the real API at build and revalidate time. **Wired, in two steps.** `npm run content:fetch` reads `GET /v1/blends` and `GET /v1/blends/{slug}?include=grower,recipes` and writes `.content-snapshot/` in the content package's own shape; the build then renders from the snapshot through the same adapter the content package uses. Two steps rather than one because `getStaticProps` calls `loadContent` synchronously and there is no synchronous fetch, and because a render that is a pure function of a file on disk is reproducible: the snapshot is the exact input to the build, so "why did the page change" is answerable without re-querying a database that has moved on. **If the variable is set and no snapshot exists the build throws with the command to run**, rather than falling through to the fixtures, which would publish fixture copy under the belief that the API had been read.
2. `build/content`, the content package. This is the source of truth today.
3. `src/content/fallback`, so a checkout without the content package still builds.

**One consequence of wiring the API that has to be said rather than discovered.** No response in the frozen contract carries a content readiness or placeholder flag, and that is deliberate: several response schemas set `additionalProperties: false`. So the snapshot carries the placeholder state over from `build/content`, per slug, exactly as the admin does. **When real content lands in the database, `build/content` has to be updated to mark those fields real, or the page will keep rendering the hazard banner over content that is no longer placeholder.** A blend with no readiness record in the content package is treated as placeholder, because failing towards "this is not real" costs a banner and failing the other way ships a fabricated claim about a real supply chain.

It runs inside `getStaticProps` only. Wiring the blend page to fetch the API on load produces a page that works perfectly in development and fails on the first tap of the morning, which is the failure mode the whole architecture exists to remove.

### Placeholder content

Real content has not arrived. Every value that is not real carries the sentinel `[PLACEHOLDER]` and the phrase `NOT REAL CONTENT`, and anything that would be a claim about a person, a place, a date, a price or a food is held null rather than invented. No grower name, no farm coordinate and no best before date is fabricated anywhere in this package.

On the page that shows up as a sticky hazard banner, a dashed outline on every placeholder string, a hatched pending slot for every deliberately null value, and a disabled reorder button where there is no Shopify cart permalink. Those rules live in `src/styles/placeholder.css`, a verbatim copy of the content package's `render-contract/placeholder.css`; the build fails if the two ever differ. **Delete the vendored file and its two lines in `scripts/postbuild.mjs` on the day the last placeholder goes away.** Nothing else has to be unpicked.

`TREVEAN_RELEASE=1 npm run verify` turns any remaining placeholder content into a build failure. Run it before a production deploy.

---

## Measuring

`npm run measure` runs three phases, because two different questions need two different instruments.

| Phase | URL | Throttling | What it is for |
|---|---|---|---|
| `score` | `/blend.html?blend=...` | Lighthouse default mobile | The Lighthouse performance score the Acceptance criteria document, section 6.2, names. Comparable with any other Lighthouse run anywhere. |
| `tap` | `/t/{code}` | Design point, simulated | Timings with the 307 inside the measurement. A regression tripwire, not the contractual 2.0 s. |
| `tap-wire` | `/t/{code}` | Design point, applied to the wire | The byte and request counts. **Quote these.** This phase sets the exit code. |

**Why three, and why only one of them gates the bytes.** "Before readable" is the partition of network requests at Largest Contentful Paint. Under Lighthouse's `simulate` throttling, LCP is modelled on a throttled clock while per-request end times are observed on an unthrottled one, so against a fast origin every lazy-loaded image the browser deliberately deferred is counted as before readable. Measured on 17 August 2026, the same build reported 22 requests and 155 KB before readable under `simulate` and 3 requests and 35 KB under `devtools`. Only the second pair is the number the budget is about. The simulate phases print their byte tables as advisory, marked `over` rather than `FAIL`.

**None of this certifies the 2.0 seconds.** Lighthouse throttling is a simulation on a datacentre CPU, not an iPhone XS in a kitchen on a loaded cell. The 2.0 s is measured on real handsets by the measurement harness at the M2 gate, run by Trevean staff on Trevean materials. A green build and a passed gate are two different claims.

---

## The tap path discipline

Five rules that this package holds and that a change here can silently break. `npm run verify` checks all five.

1. **No page fetches the API on load.** Content is baked at build time. The only after-paint network calls are the scan beacon and an optional catalog price refresh, and the page is complete and correct without either.
2. **No JavaScript before readable.** The only script in the document is the 172 byte loader, which registers one `load` listener. Everything else, including the service worker registration, runs after paint.
3. **The beacon fires after paint and cannot block.** It hands one JSON document to `navigator.sendBeacon`, so the browser owns delivery and it survives immediate navigation away. **That document is `ScanEventInput` from the frozen API contract, produced by the beacon itself, and nothing on this page translates it.** The page posted the harness's own record here once, the stand-in accepted it and the real API answered 400 with 44 validation failures, which in production is a scan count of zero with nothing saying so. See the Decision log, D28, and the measurement harness README, "What goes on the wire, and why it is not the record".
4. **The service worker never touches the first navigation.** It is registered after `load`, so it is not even installed on the tap that matters. Once installed it is network first for navigations, with the cache only as a fallback, so a customer can never be shown a stale story after a publish.
5. **One priority image, everything else lazy.** Exactly one `fetchpriority="high"` per page, on the hero, never `loading="lazy"`, always with explicit `width` and `height`.

---

## Responsive range

The Acceptance criteria document, section 6.2, requires 375 to 428 px. `npm run screenshot` checks 360, 375 and 428 px for horizontal overflow and writes a full-page capture of each.

**360 px is measured but is not in the range.** The Samsung Galaxy S23 is on the section 6.4 device matrix and, at its default display-size setting, reports a CSS viewport narrower than the 375 px floor. That is item 5 in the M1 deliverable "Per-page byte and speed budget", section 8: either the floor moves to 360 px or the S23 is tested at a non-default display setting, and it is Trevean's call. The page has no horizontal overflow at 360 px either way, so we will have the data whichever way it goes.

---

## Adopting this into `nfc-development`

We do not have access to that repository, so this section is written to be followed rather than to describe what was done.

1. **Copy this directory in** as the consumer web package, keeping `build/content` alongside it or ahead of it in the same repository. `src/content/load.ts` resolves the content package at `../content` relative to this package; if it lands somewhere else, that one path is the only thing to change.

2. **Copy the M1 performance budget CI package in too**, from the M1 deliverable "Per-page byte and speed budget", CI adoption guide, step 1. `budget.json` already carries this package's real route shape in `urls.tapPath` and `urls.directPages`, so the "TO CONFIRM IN AUDIT" note against those two lists is closed. Set `BUDGET_HTML_DIRS=out` in the workflow.

3. **Add `treveanspice.com` to `allowedHosts.beforeReadable`** in `budget.json` when measuring against the real domain. It should never need a second hostname. A second host there is the 450 ms regression the budget document warns about in section 3, constraint A, not a configuration detail.

4. **Make `Budget at 375 px` and `Budget at 428 px` required status checks** on the default branch. This is the step that turns a document into a gate and it is the one most often skipped.

5. **Generate the edge configuration from `out/route-manifest.json`.** Do not type the rewrites twice. The manifest carries the 307 destinations, the rewrite table, the cache key rules, and a `resolves` flag per tag code saying whether a pre-rendered page exists for it.

6. **Serve the built files from the CDN with the same headers `scripts/serve.mjs` sets.** HTML: `public, max-age=60, s-maxage=31536000, stale-while-revalidate=86400`, invalidated on publish. Everything else: `public, max-age=31536000, immutable`. The 307 itself: `no-store`, never `301`, and carrying the `Link: rel=preload` hint for the hero. **`build/publisher` does exactly this and has a test asserting that its two header values are byte for byte the ones in `scripts/serve.mjs`**, so the stand in edge and the published objects cannot drift apart.

7. **Replace the placeholder media** by putting real masters into the content package at `build/content/media`, not by committing derivatives here. `public/media/` and `public/icons/` are generated and are gitignored for that reason.

`scripts/serve.mjs` is a measuring rig, not a deployment target. It exists so the tap path can be measured before the CloudFront distribution exists, and it reproduces exactly four behaviours: the 307 with a relative `Location` and `no-store`, the query-parameter rewrite, `via` and `utm_*` ignored, and `Server-Timing: edge;desc="HIT"` so the beacon can report cache hit or miss.

**Its `/v1/scan-events` stub validates, and that is not decoration.** It used to accept any JSON it could parse and log it, which is why the page could post the measurement harness's own record here, pass on every local run, and have been rejected by the real API on every customer tap. The stub now carries a transcription of the frozen `ScanEventInput` schema and answers 400 with the contract's error envelope to anything the real API would refuse. **A local server more permissive than production does not save time, it converts a loud failure into a silent one.** `TREVEAN_SCAN_EVENT_LOG` appends the accepted bodies; it replaces `TREVEAN_BEACON_LOG` and it is not a file `analyse --beacons` can read, because the wire format is the contract's and the analysis reads `trevean-field-beacon/1` records.

---

## Known open items

| Item | Owner |
|---|---|
| **The on-pack QR artwork has to be produced from `build/edge/dist/qr-artwork.csv`.** The edge now serves `/q/{code}` and the stand-in matches it, so the software side of the NFC versus QR split is closed. What is not closed is the artwork, which is Trevean's to produce and is on the critical path. Scope, in scope, item 5 also needs one wording change, because "the same URL as the tap" contradicts item 6's split. | Trevean, and Dan on the wording |
| Real content for the two launch blends. Every page in this build carries the placeholder banner. | Trevean |
| Pulp+Wire brand assets. The palette, the type scale and the two WOFF2 faces are all placeholder; the 45 KB font allowance is unspent. | Trevean |
| The 640 px usable fold height at 375 px is an estimate from the budget document, section 4.3, marked TO CONFIRM by measurement on the section 6.4 matrix handsets. The release layout clears it by 16 px. | Joint |
| `/t/kg` is in the redirect table and Kyoto Garden is a draft blend, so it resolves to the branded unresolved page. No tag was encoded with it. Publish the blend or drop the code. | Trevean |
| The 375 px floor against the Galaxy S23, above. | Trevean |
| Whether the farm map ships as a static image with a link out, which is what is built here. A map SDK is 200 KB to 800 KB of JavaScript, larger than the whole page budget. | Trevean |

---

## Layout of this package

```
src/pages/blends/[slug].tsx   the pre-rendered blend page, getStaticProps only
src/pages/blend.tsx           /blend.html with no blend the edge could resolve
src/pages/404.tsx             unknown path
src/pages/offline.tsx         what the service worker serves with no network
src/components/BlendPage.tsx  the whole consumer page
src/components/Picture.tsx    one image element, written by hand, not next/image
src/components/PlatformHelp.tsx  the platform-specific instruction copy
src/content/load.ts           content loading, build time only
src/styles/critical.css       the whole stylesheet, inlined
src/styles/placeholder.css    the placeholder render contract, inlined with it
public/js/enhance.js          everything that runs after the page is readable
public/sw.js                  service worker, branded offline page only
public/vendor/harness-beacon  the field beacon, vendored verbatim from M1
scripts/                      build, verify, measure, screenshot, serve
verification/                 the section 6.3 evidence, regenerated by npm run screenshot
```

### On the instruction copy

`src/components/PlatformHelp.tsx` quotes the Hardware and physical layer document, "Customer instruction copy", verbatim, and `npm run verify` asserts both sentences character for character. **Copy that describes one platform's behaviour as universal is a defect, not a wording preference.** On iPhone a tap never opens a page directly: iOS raises a notification banner the customer taps, and no API, setting, entitlement or tag configuration removes it. On Android the page opens directly with no banner. A phone with its screen off reads nothing on either platform, and Android additionally needs to be unlocked, which is why the QR code is the sole recovery route and is not optional.
