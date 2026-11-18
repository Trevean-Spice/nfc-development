# Decision log

Every decision that would be expensive to revisit, with the reasoning attached. Newest first.

---

**This copy is the full log, D1 to D67. Two kinds of passage are removed, and each is marked where it was. "[removed: Serene Labs internal]" marks Serene Labs' own business, such as staffing, hours, internal tools and accounts, and our internal notes on how messages to Trevean were framed and handled. "[removed: fees and payments]" marks fees and payments owed or paid to Serene Labs. Facts, decisions, dates, reasons and our own mistakes are all kept. One Shopify PIN is marked "[removed: credential]", and one Shopify checkout session link in a redirect trace is marked "[removed: checkout token]". AWS account and certificate IDs, sign-in emails and the legal and export notes are kept in Trevean's private record.**

## D67 · 7 Oct · Criterion 4 is not short of data. Its data source is disconnected, and fixing the jars is what disconnected it

**Asked whether anything more could be done on the analytics criterion, and the answer turned out not to be about the dashboard at all.**

**THE MEASUREMENT:** `ScanEvents` holds **8 real scan events, and none since 15 September 2026.**

**The jars started working on 18 September. The client tapped real jars from 24 to 30 September.** All four iPhones, the Galaxy S23 at 10 of 10, QR on every blend, an adjacent jar run. **Every one of those taps recorded nothing.**

**WHY, AND IT IS A CONSEQUENCE OF THE FIX RATHER THAN A FAULT IN IT.**

| Page | Served from | Bytes | Beacon |
|---|---|---|---|
| What a tap reaches today | **Vercel**, the client's own `blend.html` | 80,869 | **None.** No `sendBeacon`, no scan endpoint, nothing |
| What we built | **CloudFront**, pre rendered | 18,408 | `enhance.js`, `data-scan-endpoint="/v1/scan-events"` |

**The redirects were published to Vercel on 18 September because that was the fastest route to working jars**, and it worked: R1 closed after 34 days. **But it routes every customer to a page that is not ours and does not report anything.**

**THE PIPELINE ITSELF IS FINE AND THAT IS EVIDENCED, NOT ASSUMED.** The 8 events dated 5 to 15 September were produced by that beacon on that page, through the real path, into the real table. **`/v1/scan-events` carries its own CloudFront behaviour allowing POST**, unlike `/v1/*` which is GET, HEAD and OPTIONS only. Nothing is broken. **Nothing is connected either.**

**SO THE CRITERION CANNOT BE MET BY WAITING.** "Dashboard shows live scans" has no mechanism to produce a live scan while the serving path bypasses the page that reports them. **More volume changes nothing. More dashboard work changes nothing.**

**TWO WAYS OUT, AND THE FIRST IS THE ONE THE ARCHITECTURE ALREADY ANTICIPATES.**

1. **The cutover.** Point the apex at CloudFront, which serves our page with the beacon and forwards everything else to Vercel. **The certificate has been ISSUED and idle since 18 September**, and the ordering hazard is written up at "Operations runbook", section 9. **This is Option One, confirmed with the client on 8 September (D44), and it was always the destination.**
2. **A beacon on the Vercel page.** Small, and it is the client's repository and his page. A stopgap that makes the numbers real without moving the domain.

**Recorded rather than acted on**, because both touch the client's live storefront path two weeks after a successful demo, and that is his call rather than ours.

---

## D66 · 7 Oct · Write protection is implemented, and the tag has to prove the opcodes before the irreversible half will run

**Wednesday 7 October 2026.** The last piece of M4 that was ours rather than the client's.

**THE DATASHEET STILL WILL NOT DOWNLOAD, AFTER FIVE ROUTES.** `st.com` timed out twice and then refused connections outright, the Mouser mirror served a 13,893 byte HTML bot block, and two ST community threads discuss the ISO subset without giving command codes. **AN5658 is equally unreachable.**

**SO THE OPCODES COME FROM SECONDARY SOURCES, AND THAT IS STATED RATHER THAN HIDDEN.** `chip/st-custom.ts` carries each one with its provenance and a confidence label, **and none is marked `measured`.** A test enforces that, so upgrading one requires somebody to assert it is true.

**THE DESIGN THAT MAKES UNVERIFIED BYTES SAFE TO SHIP IS THE WHOLE POINT OF THIS ENTRY.**

| Command | Reversible | Allowed |
|---|---|---|
| **Present Password `0xB3`** | **Yes.** Wrong opcode and wrong password both merely fail | **Always** |
| **Read protection state** | **Yes.** Read only | **Always** |
| Write Password `0xB1` | **NO** | **Only after the probe passes** |
| Set Memory Protection `0xBA` | **NO** | **Only after the probe passes** |

**Present Password cannot damage a tag**, so it can be probed, and a probe that behaves correctly is evidence for the entire path: opcode, manufacturer byte, flag byte, transparent session framing and the reader's transceive wrapper. **Nothing else in that chain produces a discriminating answer.**

**`verifyOpcodes()` presents a deliberately wrong password and then the factory default and requires the chip to answer them DIFFERENTLY.** Different answers unlock the irreversible pair for that session. **The same answer proves nothing, whatever it is, and the pair stays locked.** A transport that cannot tell a right password from a wrong one must not be trusted to set one.

**WHY A PROBE RATHER THAN A FLAG SOMEBODY CAN SET.** A wrong byte in the irreversible pair **does not fail safe**: it can leave a tag protected with a value nobody recorded. **That is precisely the state the 1,000 SO4731 jars are in**, locked by a supplier with a password Trevean does not hold (D45). **The project has paid that price once and the tooling will not repeat it on a constant from a forum post.**

**WHAT IS STILL NOT TRUE: none of this has touched a chip.** The gate means an unproven path **refuses** rather than guesses, which is a better failure than README section 6.2 describes, but it is not the same as working. **Section 6.3 step 3, a real tag and a real phone, is still the step that matters.**

**THE MOST USEFUL THING IT CAN DO TODAY NEEDS NO PROBE.** `readAreaProtection` is read only and answers the question open since September: **what protection the supplier actually applied to SO4731.** That is why the client's GoToTags instructions ask him to read one production tag.

**171 chip tooling tests pass**, ten of them new and all on the honesty of the table rather than the correctness of the bytes, **because a test cannot tell you an opcode is right and should not pretend to.**

---

## D65 · 7 Oct · The reorder button is live, and the seeder that would have done it was refused

**Wednesday 7 October 2026. Deployed and proven end to end:**

```
API      https://.../v1/catalog/caribbean-sunset
         -> cartPermalinkUrl https://dmt009-91.myshopify.com/cart/44647352336487:1
follow   -> 200 shop.treveanliving.com/checkouts/cn/[removed: checkout token]/...
cart     1 item, Caribbean Sunset 46 g / Black, $18.00
```

**All four tagged blends return a real permalink, available, at $18.00.** Tap path unaffected: `demo-readiness` still **10 passing, 0 failing**.

**WHAT WAS DEPLOYED.** `terraform apply` set `SHOPIFY_STORE_DOMAIN` on eight functions, **0 added, 8 changed, 0 destroyed**. Then the API build went to `content-api`, `scan-ingest` and `admin-api`, **sha256 `3U/ogq...` confirmed against the packager's output on all three.** That closes D58's eleven day divergence: the running code now contains `cartPermalink`, `skuAttribution` and the two webhook fixes.

**AND THE OBVIOUS TOOL WAS THE WRONG TOOL.** The variant ids were in the fixtures and not in the deployed table, and `seed-dynamodb.mjs` exists precisely to fix that. **A dry run first, and it would have written 37 items including 14 SpiceBlends records, 32 of them placeholder.**

**That would have put the placeholder banner back on live pages the client is showing investors, and overwritten anything he has edited in the admin since 11 September.** The seeder is correct and idempotent and was built for an empty environment; **this environment stopped being empty the day the client started using it.**

**So five `update-item` calls instead**, touching only the `CATALOG#` rows and only the eight attributes that needed to change. **The `BLEND#` records were not touched.** `cartPermalinkUrl` was deliberately left null in the row so it derives from the environment variable, which is what makes a future domain change one variable rather than a re seed.

**THE CATALOG MIRROR IS NOW HAND WRITTEN, AND THAT IS A DEBT RATHER THAN A FIX.** Price, availability and ids were measured against the live store today and are correct today. **They will not follow a price change**, because `catalog_sync` is still the 848 byte placeholder. Rows carry `syncSource: manual-verified-2026-10-07` so the provenance is visible rather than assumed. **Wiring the sync is what makes this self maintaining.**

**M4 criterion 3 is met and demonstrable.** Criterion 1 still needs write protection, which is ours.

---

## D64 · 7 Oct · The reorder button works, verified against a real checkout. And the store is still Trevean Living

**Wednesday 7 October 2026.** The client cleared every client side blocker on M4's Shopify criterion in one message: store unpaused, five blends active, staff invite sent, store named as **`dmt009-91.myshopify.com`**.

**VERIFIED BEFORE WIRING ANYTHING, AND THE VERIFICATION CAUGHT MY OWN BAD TEST FIRST.**

| Check | Result |
|---|---|
| All five variant ids against the live store | **All five MATCH**, all `available: true`, all $18.00 |
| Cart permalink, four tagged blends | **All four add the correct variant at the correct price and reach a real Shopify checkout** |

**THE FIRST RUN LOOKED BROKEN AND WAS NOT.** Following the permalink without a cookie jar ended on the storefront homepage after four to seven hops, which reads exactly like a dead checkout. **Shopify needs a session cookie to carry a cart**, and with one the same link lands on `/checkouts/cn/...` with `item_count: 1`. **A tool artefact, reported nowhere, because it was checked before it was written down.**

**THE REAL FINDING: THE STORE IS STILL TREVEAN LIVING.** The primary domain is **`shop.treveanliving.com`**, not `shop.treveanspice.com`. On 17 September the client said "I will retire treveanliving and publish the Trevean Spice theme in its place". **That has not happened**, so a customer pressing reorder reaches a Trevean Living checkout.

**SO THE BRAND COPY GOES BACK TO NEUTRAL.** `BlendPage.tsx` said "Goes straight to the Trevean Spice checkout", which **would now be a false statement to a customer**. Returned to "secure checkout", which is true either way, with the restore condition written beside it: **when the storefront actually carries the brand, and not before.** This is the second time that line has moved on this exact fact.

**THE MYSHOPIFY HOST IS USED DELIBERATELY RATHER THAN THE STOREFRONT DOMAIN.** It is permanent and cannot be re pointed; the primary domain is mid move. **Shopify 301s it to whatever the primary domain is and carries the cart**, so one extra hop on a reorder click buys immunity from a domain that is still changing. **The tap path never touches it.**

**Wired end to end:** `SHOPIFY_STORE_DOMAIN` through compute, stack and the dev environment, set in `terraform.tfvars`. **Empty remains the safe default** and renders the button disabled, which is how it shipped from 17 September.

**NOT YET DEPLOYED.** AWS credentials are expired, and the running API is still the 11 September build. **The button is correct in configuration and absent in production until an apply happens.** D58.

---

## D63 · 30 Sep · Tried to source the ST protection opcodes, failed, and found our own README had been softening the gap

**Wednesday 30 September 2026.** The client was told this morning that the write protection work is ours and is moving "regardless of what you do this week". **This is that work, and it did not get where it needed to.**

**THREE ROUTES, NONE AUTHORITATIVE.**

| Route | Outcome |
|---|---|
| `st.com/resource/en/datasheet/st25tv02kc.pdf` | **Timed out**, twice, including a background download |
| Mouser mirror | **HTML bot block**, 13,893 bytes, not a PDF |
| ST community thread on ISO 15693 writes | **No command codes.** Discusses the OPTION flag, nothing on passwords |

**ONE LEAD, DELIBERATELY NOT IMPLEMENTED.** A community reference gives **Set Memory Protection as `02 BA`**, manufacturer code `02` plus command `BA`, present on ST25TV02KC and absent on ST25DV04KC. **A forum post is not a datasheet.** It is recorded in the README as a lead to confirm and **written nowhere near the transport**, because a single unverified byte applied to a real tag is irreversible. **That is not theoretical: it is what happened to SO4731.**

**THE REAL FIND WAS IN OUR OWN DOCUMENT, AND IT WAS UNDERSTATING THE GAP.** README section 6.4 said **"Nothing about the milestone is blocked by this."** **M4 criterion 1 reads "sample tags encode, WRITE PROTECT and tap correctly."** Write protection is named in the criterion, so criterion 1 cannot pass without it. **The M4 status document had this right and the README did not**, which means the engineer reaching for the technical detail got the softer version while the status document got the true one. **Corrected in place, with the correction visible rather than silent.**

**This is the D45 pattern a third time**: two documents describing the same fact, disagreeing, and the disagreement surviving because nothing tests prose.

**THE NEXT STEP IS ACQUISITION RATHER THAN ENGINEERING**, and it is recorded as such: get the datasheet from an ST account or a distributor that serves the file, then implement against section 6.3's ordering.

**AND A CHEAPER ALTERNATIVE WAS IDENTIFIED THAT USES HARDWARE ALREADY IN PLACE.** The client runs **GoToTags Desktop**, which supports the ST25 family. **If it can apply and read back ST25TV area protection, the scheme can be established empirically from a sacrificial tag** rather than from a document nobody can download. **That is a better first move than chasing a PDF**, and the reader and the tags are both already at his end.

---

## D62 · 30 Sep · The demo landed, [removed: fees and payments], and the answer was no

**Wednesday 30 September 2026, 9:28 AM.** Dan: the demo "went extremely well", it was well received, **further investor meetings are booked**, and **"Let me know if we completed Milestone 4. [removed: fees and payments]"**

**THE ANSWER WAS NO.** [removed: Serene Labs internal] A delighted client [removed: fees and payments] for a milestone whose four acceptance criteria are **none of them demonstrable**. Accepting would have been easy, unnoticed for weeks, and the precise failure this engagement was hired to avoid.

| M4 criterion | State | Whose |
|---|---|---|
| Sample tags encode, write protect and tap | **Not met.** Write protection unimplemented against a real reader | **Ours** |
| Trevean staff encodes one unaided | **Not met.** Never attempted | His |
| Reorder reaches Shopify checkout | **Not met.** Store paused, blends draft since 17 Sep | His |
| Dashboard shows live scans per 6.2 | Built, deployed, exercised. **Almost no real data** | Resolves with real taps |

**THE GAP THAT IS OURS WAS NAMED FIRST AND NOT SOFTENED.** The chip tooling cannot apply write protection, and the reason is stated to him plainly: **a wrong opcode locks a tag permanently with a password nobody holds**, which is exactly what happened to order SO4731. **It is not filed under "waiting on the client".**

[removed: fees and payments]

**M5's DATE WAS TODAY AND WAS DECLARED UNPROMPTED.** It does not close: the matrix is incomplete, the handover documents are unaccepted and the walkthrough is unheld. **D40 is the precedent and it is ours**, M2 having sat finished and unsubmitted for six working days. **Two milestone dates passing in silence would be that error committed twice.**

**THE PLASTIC RULER PRODUCED REAL EVIDENCE FOR D61'S HYPOTHESIS.**

| Handset | Instrument | August | Now | Drop |
|---|---|---|---|---|
| iPhone 15 Pro | **metal** rule | 28 mm | 20 mm | **29 percent** |
| Samsung S23 | **plastic** rule | 22 mm | 18 to 20 mm | **9 to 18 percent** |

**Different handsets, so suggestive rather than conclusive**, and the decisive test was named for him: **re measure one iPhone with the plastic rule** and compare directly against August. Ten minutes, and it either closes the question or shows the lids genuinely changed.

**THE ADJACENT JAR RESULT WAS CREDITED RATHER THAN WAVED THROUGH AS A REPEAT.** R2 closed it at 160 of 160 on 6 August, **on interim materials**. Varun has now repeated it on production lids with real labels, **which is the harder case**, so it strengthens the result rather than restating it.

**Nothing was asked of him before Tuesday 6 October.** [removed: Serene Labs internal]

---

## D61 · 26 Sep · Everything green at 13 of 13, the XS landed where predicted, and the distance drop may be a metal ruler we told them to use

**Saturday 26 September 2026, the day before the demo.** Dan finished physical testing at 7:28 AM and merged pull request 2.

**FIRST CLEAN SWEEP OF THE ENGAGEMENT.** `verify-live.mjs` against `https://treveanspice.com`: **13 of 13 checks pass, 150 of 150 casing and trailing slash variants.** `demo-readiness.mjs`: **10 passing, 0 warnings, 0 failing.** The branded 404 closed the last outstanding item.

**HIS PHYSICAL RESULTS:** real jars, production lids, **100 percent reads across all models**, **QR verified against every blend**, **iPhone XS at 12 to 15 mm**. Android and the old lid comparison move to next week.

**THE XS PREDICTION HELD.** D60 reasoned that a 29 percent drop applied to the 18 mm floor would land near 13 mm. **Measured: 12 to 15 mm.** Against an 8 mm lid that is 4 to 7 mm of slack and a margin of roughly 1.5x to 1.9x, down from roughly 2.25x in August. **It passes, at 100 percent, so the margin is a next lid order question rather than a demo question.**

**THE REAL FINDING IS THE INSTRUMENT, AND IT IS OURS.** Dan: **"hard to read accurately with the metal ruler we have."** Metal in a 13.56 MHz inductive field absorbs energy through eddy currents and detunes the antenna, so **a metal rule beside the phone and tag systematically understates the distance it is measuring.**

**M1 DELIVERABLE 4, STEP 6, SAYS "AGAINST A RULE OR CALIPER" AND NEVER SAYS NON METALLIC.** A steel caliper is worse than a steel rule. **We wrote the instruction that produced the confound.** Owned to him in one sentence, with the fix: a plastic rule or stacked cards of known thickness for the Android runs.

**TWO CONSEQUENCES BEYOND THE APOLOGY.** It may **dissolve his old versus new lid investigation** before he spends next week on it. And **it invalidates the August to September comparison itself**, because nobody recorded which instrument the 6 August run used, so the 28 to 20 and 18 to 12 figures may be measuring the ruler rather than the lids.

**AN M2 QUESTION WAS ASKED RATHER THAN A CLAIM MADE.** What he ran resembles the acceptance gate closely: real jars, production lids, the matrix, read success, QR parity. **If it was recorded to the protocol it may close M2's outstanding item outright.** But **D7 requires a named tester, recorded footage and specific tap counts**, and "we have been testing" establishes none of those, so it is put to him as a question with the offer to run the recorded version alongside the Android work.

[removed: fees and payments] **M4 is named incomplete with its three client blockers, and the chip tooling write protection gap is attributed to us rather than folded into "waiting on the client".**

---

## D60 · 25 Sep · The tags read through real lids. And the read distance fell 29 percent, on the one axis the lid design rests on

**Friday 25 September 2026, 5:13 PM. Dan has been running physical taps since Thursday**, on real jars with real labels and tags fitted under real lids. **It works.** iPhones pass, banner tap to readable page unchanged from the 6 August bench run. **Sunday is confirmed.** Android is untested and may slip to next week.

**THIS IS THE FIRST PHYSICAL CONFIRMATION IN THE ENGAGEMENT.** Every check before it was over HTTP. **The only unquantified risk on the demo day is now quantified**, and he did it unprompted rather than after a fourth ask.

**HE IS RIGHT THAT THE DISTANCE DROP IS NOT A FAILURE, AND THE RECORD AGREES WITH HIM.** Acceptance criteria section 6.1: read distance is **"Recorded, not targeted. No distance figure is itself a pass condition."** Nothing about Sunday or about M2 acceptance turns on it.

**BUT THE SAME ROW SAYS "THE 18 MM WORST CASE GOVERNS THE LID BUDGET", AND THAT IS THE NUMBER AT RISK.**

| | 6 August bench | Reported 25 September |
|---|---|---|
| iPhone 15 Pro | 28 mm | **20 mm**, a 29 percent drop |
| **iPhone XS**, the floor | **18 mm** | **Unknown. Possibly untested** |

**Applied to the XS, a 29 percent drop lands near 13 mm against an 8 mm lid.** Slack falls from about 10 mm to about 5 mm; effective margin from roughly 2x to roughly 1.6x. **Still passing, and the cushion that made 8 mm lids a safe choice has halved.** He wrote "the iPhones all work" without naming which, so **whether the governing handset has been measured at all is the open question**, and it is ten minutes.

**A SECOND CANDIDATE CAUSE, WHICH HE HAS NOT CONSIDERED AND WHICH IS FREE TO RULE OUT.** His words: tags **"on the lids under the cork liner"**. The stack he himself confirmed on 12 August is `phone > 8 mm bamboo > tag > 1.5 mm cork > spice`, with **the cork BELOW the tag and explicitly not in the read path.** If these jars are assembled with the cork **above** the tag, the read path becomes 9.5 mm **and a dielectric sits directly on the antenna**, detuning it on top of the added geometry. **That would explain a loss disproportionate to 1.5 mm of material.**

**THE TWO HYPOTHESES WERE ORDERED BY COST RATHER THAN BY AUTHORSHIP.** Look at one lid: free, five seconds. Then his old versus new lid comparison, which is real work and is a good instinct. **His theory is sequenced behind a cheaper one, not displaced by it.**

[removed: Serene Labs internal]

**Also supplied: the pull request link in full.** He looked and could not find it; the likely reason is that he looked in `nfc-development` rather than `Trevean-Spice/website`.

---

## D59 · 25 Sep · Two days to the demo, seven days of silence, and the tap test is not going to happen

**Friday 25 September 2026.** Dan last replied on **Friday 18 September at 12:53 PM**. Three messages since, no answer. **The rehearsal referenced on Tuesday did not happen. Today is the code freeze date. The demo is Sunday.**

**WHAT IS ACTUALLY READY, MEASURED THIS MORNING RATHER THAN CARRIED OVER FROM TUESDAY:** `demo-readiness.mjs` against the live domain, **9 passing, 1 warning, 0 failing**. The warning is ours and is PR 2, **open three days, unmerged**.

**THE M2 TAP TEST IS NOT GOING TO HAPPEN BEFORE SUNDAY.** Varun was named on 28 August and no days were ever booked. [removed: Serene Labs internal]

[removed: Serene Labs internal] **What will survive contact with an investor and what will not.** Safe: the tap, all four blends, and the admin publishing live in seventeen seconds. **Not safe: the reorder button** (store paused, blends draft, the checkout would refuse), **the scan numbers** (almost no real data, an empty chart invites the wrong question), and **a deliberately wrong code** (unbranded 404, PR 2).

**THE ONE GENUINE WARNING, AND IT IS THE ONLY NEW ENGINEERING CONTENT IN THE MESSAGE.** Every check in this project is over HTTP. **Nobody has ever tapped a physical jar through a physical 8 mm lid on this system.** The 6 August bench data says it reads, but that predates the entire build. **The first physical tap in the project's history must not happen in front of an investor.** One jar, one phone, five minutes, on Saturday. That is a fraction of the gate and it removes the only unquantified risk on the day.

[removed: Serene Labs internal] M4 is a week overdue [removed: fees and payments], M5 is due Wednesday 30 September, and PR 2 has sat three days. [removed: Serene Labs internal]

**The ask is one line, is Sunday still on.** [removed: Serene Labs internal]

---

## D58 · 22 Sep · The stack is healthy for the rehearsal, and the deployed API is eleven days behind the repository

**Checked Tuesday 22 September 2026, the day before the dress rehearsal. Nothing had verified the deployed stack since 11 September.**

| Piece | State |
|---|---|
| Publisher, Fargate | `ACTIVE`, 1 of 1 running |
| Admin sign in | **200** |
| Content API, `/v1/blends/persian-sunrise` | **200** |
| Tag route, `/t/ps` | **307** |
| Tag routes on the real domain | **9 passing, 1 warning, 0 failing** |

**Everything the rehearsal touches is up.**

**AND THE DEPLOYED API IS FROM 11 SEPTEMBER, WHICH IS ELEVEN DAYS AND FOUR CHANGES BEHIND.** `content-api`, `scan-ingest` and `admin-api` all carry the build of `2026-09-11T21:00:11Z`. **Not in it:** `cartPermalink`, `skuAttribution`, and the two webhook defects fixed on 17 September, being the draft product mirrored as purchasable and the substring order attribution.

**NOTHING OBSERVABLE DIFFERS, AND THAT IS WHY IT IS EASY TO MISS.** Every one of those paths is dormant: the permalink derivation returns null until `SHOPIFY_STORE_DOMAIN` is set, and the webhook fixes only execute when a Shopify webhook fires, which requires store access nobody has. **The running system and the repository agree on every behaviour anyone can currently observe, and disagree on the code.**

**DECISION: NOT DEPLOYED TODAY, AND THE REASON IS THE DATE RATHER THAN THE RISK.** The change is genuinely low risk. **Deploying it the afternoon before a dress rehearsal, when nothing requires it and nothing observable improves, is an unforced risk taken for no benefit.** It goes out when the Shopify work is unblocked and there is something to test it against, or after the demo, whichever comes first.

**THIS IS THE D45 SHAPE POINTED THE OTHER WAY.** There, the code was corrected and the prose was not. Here, the repository is ahead and the deployment is behind. **Both are a divergence between what is written and what is true, and neither has a failing test**, because the tests run against the repository. **`readiness.application_code_deployed` reads the live `code_sha256` precisely so this is checkable**, and it is recorded here so it is checked rather than assumed at handover.

**Three functions remain the 848 byte inert placeholder**, as designed and as the runbook states: `catalog-sync`, `media-derivatives` and `shopify-webhook`.

---

## D57 · 22 Sep · The synthetic rows are gone, and clearing them exposed a permanent gap between scan events and scan counters

**Purged Tuesday 22 September 2026, before the dress rehearsal.** `3750 synthetic row(s)` deleted, **0 remaining**, confirmed by a table scan on `attribute_exists(synthetic)`. **11 real items survived and were not touched**, which is what the `synthetic: true` tagging existed to make possible.

**WHAT THE DASHBOARD ACTUALLY SHOWS NOW: ONE SCAN.** The Silk Road, 15 September. That is the honest state and **it is what should be shown at the rehearsal**, because almost nobody has scanned anything. **Meaningful analytics need the tap test**, which generates real volume through the real path.

**AND THE 11 SURVIVORS DO NOT AGREE WITH EACH OTHER.** There are **8 real scan events** and rollup counters for **1** of them:

| Event | Rolled up |
|---|---|
| 6 events on 5 and 10 September | **No** |
| `caribbean-sunset`, 15 Sep 20:41:02Z | **No** |
| `silk-road`, 15 Sep 20:46:14Z | **Yes** |

**THIS IS NOT A DEFECT, AND IT WAS CHECKED RATHER THAN ASSUMED TO BE ONE.** The stream event source mapping was enabled at **2026-09-15T20:46:00Z** with `StartingPosition: LATEST`. The `silk-road` event arrived **14 seconds after** and was delivered. The `caribbean-sunset` event arrived **5 minutes before** and never was. **`LATEST` does not replay history**, so everything written before the mapping existed is permanently invisible to the consumer.

**THE CONSEQUENCE IS REAL AND IS THE REASON THIS ENTRY EXISTS.** The analytics screen reads **rollups**, not events. **Any scan that happens while the mapping is disabled, for a deploy, an incident or a cost saving, is lost from the dashboard permanently**, while the raw event sits in the table looking fine. **Nothing reconciles the two**, and nothing reports the divergence. A dashboard that is quietly missing a day is worse than one that is obviously empty.

**Not fixed today, and deliberately not fixed for eight events.** Building a backfill to turn 8 events into 8 counters the evening before a rehearsal is effort spent on a number nobody will look at. **The gap is recorded so that it is a known limitation rather than a future surprise**, and it belongs with M5 handover alongside the other things the runbook says the next operator should know.

---

## D56 · 22 Sep · R1 IS CLOSED. The jars work on the live domain, and the only failures left are ours

**Tuesday 22 September 2026. Today's date anchored on an HTTP `Date` header before anything was written, per D50.**

**MEASURED AGAINST `https://treveanspice.com`, not a staging host:**

```
11 of 13 checks pass
150 of 150 casing and trailing slash variants resolve correctly
```

All four encoded codes and both QR routes reach the correct blend page. **R1, open since 19 August 2026 and the longest running risk in this engagement, is closed.** A thousand jars in customers' kitchens work.

**`www` CAME BACK ON ITS OWN over the weekend.** Resolving on `8.8.8.8`, `1.1.1.1` and at `ns1.bluehost.com`, and **the apex now serves directly rather than bouncing through it**, so the fragile hop that failed twice on Friday is no longer in the path at all. [removed: Serene Labs internal]

**THE TWO REMAINING FAILURES ARE OURS AND WERE FIXED THE SAME MORNING.** `/t/zz` and `/q/zz` do not serve the branded not found page SOW section 6.3 requires. `404.html` is one self contained file, 1,481 bytes, **no script, no stylesheet, no font, no external request**, because somebody reaching it is already having a bad moment on mobile data. **Pull request 2**, deliberately separate from the redirects because it changes the 404 for every unmatched URL rather than only `/t/` and `/q/`.

**WHAT THE CLOSURE OF R1 DOES NOT CHANGE, AND THIS IS THE PART THAT MATTERS ON 22 SEPTEMBER.** **The M2 tap test has still never been run.** Varun was named on 28 August and **no days have ever been booked.** The demo is Sunday 27 September, five days out, and the dress rehearsal is **tomorrow**.

[removed: Serene Labs internal] Shopify's unpause and activate are outstanding but are not what puts Sunday at risk.

**One difference recorded rather than treated as a defect:** the destination renders client side, so a server side check cannot tell a correct blend from a transposed one. **Only the handset tap test can prove the right blend appears**, which is a second reason that booking is the critical path rather than a formality.

---

## D55 · 18 Sep · The redirects are merged and verified. The jars still do not work, one hop short, because `www` vanished a second time

**Dan merged `Trevean-Spice/website#1` at 12:53 PM. Production deployed `READY`.**

**THE PROOF RAN AND IT PASSED.** `verify-live.mjs` against the production deployment: **150 of 150 casing and trailing slash variants resolve to the correct destination**, across all ten codes and both routes. **The baseline taken three hours earlier was every one of them 404.** The oldest live fault in this engagement, open since 27 August, is closed on the serving side.

**AND THE JARS STILL DO NOT WORK.** `www.treveanspice.com` **has no DNS record**, confirmed against `ns1.bluehost.com` directly rather than a cache, and NXDOMAIN on all three public resolvers. The apex 308s every visitor to `www`, so a tap now dies **one hop short of a fix that exists and is correct**.

**THIS IS THE SECOND DISAPPEARANCE TODAY.** It was resolving at 11:52 and is gone by 13:10. **No explanation is offered**, in the record or to the client, because there is not an honest one available. [removed: Serene Labs internal]

**THE FIX CAME FROM VERCEL'S API RATHER THAN FROM MEMORY.** `www.treveanspice.com` reports `misconfigured: true`, `configuredBy: null`, recommending `cname.vercel-dns.com.`. The apex reports `misconfigured: false`, which is exactly why the site loads and `www` does not.

**A SECOND ROUTE WAS OFFERED, AND OFFERING IT IS THE POINT.** The apex to `www` hop is a **Vercel project setting, not a DNS fact**. Dropping it makes the apex serve directly and **removes the fragile link entirely**. It is ours to do rather than his. **It was not done unilaterally because it changes which address his customers see**, which is a brand decision and not an engineering one.

**WHAT THE VERIFICATION ALSO FOUND, AND IT IS OURS.** The run reports `FAILED` overall, and the only failing assertions are `/t/zz` and `/q/zz`: **unknown codes do not serve the branded not found page that SOW section 6.3 requires.** `dist/404.html` exists and was deliberately excluded from the pull request, because adding it changes the 404 for every unknown URL on the client's site rather than only `/t/` and `/q/`, and the pull request stated that nothing existing would change behaviour. **Separate change, separate review.** [removed: Serene Labs internal]

**Three notes that are differences rather than defects**, all recorded in the package README: Vercel serves its own `Cache-Control` on a declarative redirect so the header rule did not take effect; Vercel appends inbound `utm_source` and `fbclid` to the destination, though the blend and `via` values are literals so attribution is unaffected; and **the destination page renders client side, so a server side content check cannot distinguish a correct blend from a transposed one.** That last one matters: **the tap test on a handset is the only thing that can prove the right blend appears**, per M1 Deliverable 4.

---

## D54 · 18 Sep · The certificate issued, and the flag that completes the cutover quietly does a second thing

**`ISSUED` at 11:49 AM on Friday 18 September 2026.** The site certificate (ID in Trevean's private record), both `treveanspice.com` and `www.treveanspice.com` at `SUCCESS`, valid to 3 April 2027. **Verified two ways**, `describe-certificate` and `terraform output`, before anything was said to the client. **`InUseBy` is empty: issued and idle.**

**R1 has been open since 19 August. This is the first piece of it that is finished.**

**AND THE OBVIOUS NEXT STEP IS A TRAP, WHICH IS THE REAL CONTENT OF THIS ENTRY.** `attach_apex_aliases = true` reads as one action. **It is two**, and the second is not in its name:

```
aliases             = attach_apex_aliases ? [apex, www] : []
acm_certificate_arn = attach_apex_aliases ? certificate_arn : null

publisher_public_base_url = attach_apex_aliases && apex_domain != null
                              ? "https://${apex_domain}"
                              : "https://${cdn_domain}"
```

**Attaching the aliases is harmless.** CloudFront answers for those names and no traffic reaches it, because DNS still points at Vercel.

**The second effect is not harmless.** The same flag moves the publisher's public base URL to `https://treveanspice.com`, **which currently resolves to Vercel**. The publisher would then render, publish and verify **against a website we did not build**. It either fails for an unrelated reason, or **passes against somebody else's content**, and the second is worse because it looks like success.

**This would have been found at the worst moment**, by a publish failing days after an apply that appeared to change nothing.

**THE SAFE ORDER IS FOUR STEPS AND THE FIRST EXISTS ONLY TO DEFUSE THE SECOND.** Pin `publisher_public_base_url` explicitly, then set the flag, then move DNS, then unpin. Written into the operations runbook, section 9, with the reasoning rather than just the sequence.

**STEP 3 IS STILL BLOCKED ON A QUESTION FROM 8 SEPTEMBER.** CloudFront has no fixed IP, so the apex needs `ALIAS` or `ANAME`, **and whether Bluehost offers either is unanswered.** If not, the cutover becomes a nameserver migration with the client's Google Workspace MX in scope. [removed: Serene Labs internal]

**WHAT THE CLIENT WAS TOLD, AND WHAT WAS KEPT APART.** He was promised "I will tell you when it is issued", so he was told. **The certificate and the jar fix landed the same morning and are unrelated**. [removed: Serene Labs internal] One sentence separates them explicitly.

---

## D53 · 18 Sep · The jar redirects are proposed to the client's website repository as a pull request, not pushed

**The 404 underneath the `www` outage is the oldest live fault in this engagement**: the redirect configuration was built on 27 August and never published. The 4 September entry already said why: "step 3 is not currently blocked on Dan at all: it is blocked on step 1, and step 1 is blocked on us."

**WHAT THE ACCESS TURNED OUT TO BE.** The Vercel token the client sent resolves to **[removed: Serene Labs internal], our own account**, not his. What made the work possible was that Jacob was already a member of **`dan-blizinski-s-projects`**, and that `gh` already held **push access to `Trevean-Spice/website`**. **The token unlocked nothing that was not already open.** The ask went out three times and the answer had been yes the whole time.

**THE PROJECT SHAPE, MEASURED.** `trevean-spice-website`, git linked to `Trevean-Spice/website`, branch `main`. Domains: `treveanspice.com` **carrying a Vercel level redirect to `www`**, `www.treveanspice.com` serving, and the `.vercel.app` name. **So the apex to www hop is a Vercel setting and was never a Bluehost fault.**

**WHAT WAS VERIFIED BEFORE PROPOSING ANYTHING, and the first check nearly stopped it.** The redirects target `/blend.html?blend=...`. **That page exists and selects the blend client side**, confirmed in a real browser on all four encoded blends. **Had `blend.html` been absent, publishing the redirects would only have moved the 404.**

**A PULL REQUEST RATHER THAN A PUSH, DELIBERATELY.** We hold `push=true` and the standing instruction is not to modify that repository. **A pull request completes the work, changes nothing live, and is one click from done.** `Trevean-Spice/website#1`: one file, every existing key preserved byte for byte, 160 redirects added. **`main` untouched.**

**AN ERROR MADE AND CAUGHT IN THE SAME MINUTE.** The first commit to the branch carried an **empty** `vercel.json`: Python wrote the merged file to `C:\tmp` while Git Bash read `/tmp`, and `base64` of a missing file produced an empty string the API accepted without complaint. **Caught by checking the committed size rather than trusting the returned commit SHA.** A successful API response is not evidence that the right bytes arrived.

**WHAT IS NOT PROVEN.** Vercel built the branch `READY` with no errors, so the configuration is well formed. **But the preview sits behind Vercel SSO and could not be fetched anonymously**, so the redirects have not been observed working live. The remaining evidence is the package's 109 tests against a model of Vercel's router, which is real and is not the same thing.

---

## D52 · 18 Sep · The live domain was a dead end, found by checking rather than by anybody reporting it

**Measured while verifying the tap path before writing a cutover checklist. Nobody raised it.**

`https://treveanspice.com/t/ps` returned **308** to `www.treveanspice.com/t/ps`, and **`www` was NXDOMAIN on `8.8.8.8`, `1.1.1.1` and `9.9.9.9`.** The browser could not connect at all. The apex itself resolved fine, so the zone was up: **a canonical redirect pointing at a hostname that no longer existed.** Every jar, and the marketing site with it.

**WORSE THAN THE 403 THIS RECORD CARRIED SINCE 19 AUGUST.** A 403 is a response: brandable, loggable, explainable. **A non resolving hostname produces a browser level failure with no page at all**, and from outside looks like the domain was never bought.

**WHY IT WAS NOT CAUGHT SOONER, AND IT IS OURS.** R1 was monitored as "apex 403, `/t/ps` 500" since 25 August. **Those readings never followed the redirect.** A check that stops at the first response cannot see a chain that dies at the second hop. **Same shape as D45 and D50: the instrument kept working and stopped measuring the thing that mattered.**

**RESOLVED WITHIN THE HOUR, AND THE DRAFT WARNING HIM ABOUT IT WAS NEVER SENT.** `www` resolves again and the marketing site returns 200. **The message telling him the domain was unreachable stopped being true while it was still a draft and was rewritten rather than sent.** A stale alarm is its own kind of wrong answer.

**AND CLEARING IT EXPOSED THE OLDER FAULT UNDERNEATH.** With `www` resolving, all four encoded codes returned **404 from Vercel**. **The outage was a symptom.** The jars have been broken since August for an older reason, and that reason is ours. See D53.

---

## D51 · 18 Sep · R1 finally moves. Both validation records are live, and the cause was one field on a Bluehost form

**Verified against `8.8.8.8` rather than a local resolver.** Both `_c7232199....treveanspice.com` and `_f44b8d77....www.treveanspice.com` resolve to their `acm-validations.aws` targets.

**THE CAUSE, IN THE CLIENT'S OWN WORDS: "i inadvertently set the record to www instead of HOST."** Record One carried `.www` in the host field, so the name that existed was `_c7232199....www.treveanspice.com` and the name ACM looks for did not. **That is exactly the NXDOMAIN measured that morning**, and it is why he sincerely believed it was configured: from inside the form it looked right.

**THE BLUEHOST GOTCHA, WRITTEN DOWN BECAUSE IT WILL RECUR.** The host field is a **prefix**, with `.treveanspice.com` appended automatically. **Putting `www` there does not target the www hostname, it invents a different name**, and the form gives no indication.

**WHAT WAS DONE RIGHT, AND IT IS THE REUSABLE PART.** He reported both records as configured. **That was checked rather than accepted**, and the two halves disagreed. [removed: Serene Labs internal] **He found it himself in one round trip.** [removed: Serene Labs internal]

**Also checked: no stray left behind**, so he edited the record rather than adding a second one.

**WHAT THIS DOES NOT DO.** **The certificate is not the cutover.** `attach_apex_aliases` is still `false` and the jars resolve exactly as before. **R1 has moved for the first time since 19 August. It is not closed.**

---

## D50 · 17 Sep · Every date written on 17 September was a day late, and the repository's own rule caught nothing

**Every entry, risk row, correspondence file and code comment written that day was first dated Friday 18 September.** Dan's Wednesday message was dated Thursday. **The whole day was recorded one day into the future.**

**IT WAS FOUND BY AN UNRELATED EMAIL THREAD** showing "Tue, Sep 15 (2 days ago)", not by anything here. **[removed: Serene Labs internal] has required a calendar check since August. The rule did not fail; nobody ran it.** A rule that depends on remembering to apply it fails on the day you are busy.

**WHAT MADE IT SELF CONSISTENT.** Dan's messages carry clock times and no dates, so 12:22 PM followed by 11:55 AM correctly implied two different days. **That inference was right and was then anchored to the wrong absolute date.** Every relative relationship correct, every absolute one wrong. **Internally consistent and externally false is the hardest shape to notice.**

**WHAT IT NEARLY COST, all in unsent drafts:** a message saying the certificate "expired on Sunday" when it expired **Monday 14 September**; two messages wishing Dan a good weekend on a Thursday; an M4 status headed "the milestone date" a day early.

**A SECOND ERROR CAME OUT OF FIXING THE FIRST, AND IT IS THE MORE INSTRUCTIVE ONE.** The correction was applied as a blanket replace of "18 September". **That silently rewrote the M4 DUE DATE, which really is Friday 18 September, across eleven historical M1 and M2 deliverables that were correct before it ran.** Caught by reading the diff rather than trusting the script. Those trees were reverted whole. **A bulk fix to a date is a bulk fix to two different meanings of the same string.**

**[removed: Serene Labs internal] now parses every "Weekday D Month YYYY" and checks it against the calendar**, which is the check [removed: Serene Labs internal] always described, now executable rather than remembered. **Its limitation is stated in its own header: it cannot catch a date that is internally perfect and simply the wrong day.**

---

## D49 · 17 Sep · The apex certificate is dead, the DNS record never existed, and NO terraform plan will ever tell anybody

**Three facts established by direct query against the development account (ID in Trevean's private record) on Thursday 17 September 2026, in this order, each one worse than the last.**

**1. The certificate has FAILED with `VALIDATION_TIMED_OUT`.** The site certificate (ID in Trevean's private record), for `treveanspice.com`. It was reissued on 11 September with a fresh 72 hour clock and that clock ran out on 14 September.

**2. The validation record was never added.** `_c7232199b8fbe71a232eee44995e05ac.treveanspice.com` returns **NXDOMAIN** on a live lookup. **So the question asked of Dan twice is answered, and the answer is no.** It is not late, it is absent.

**3. AND THIS IS THE ONE THAT MATTERS: `terraform plan` reports "No changes."** Twice, including with `-replace` against the module address. **`terraform state list` returns nothing matching a certificate**, and the root module in `envs/dev` contains no `module "certificate"` block at all.

**THE CERTIFICATE IS UNMANAGED INFRASTRUCTURE.** `modules/certificate/main.tf` exists, is written, and **is never instantiated.** The live certificate was created outside Terraform, so Terraform cannot see it, cannot detect that it died, and will never repair it. **A dead certificate will now survive every future apply, silently, and the plan will keep saying the infrastructure matches the configuration.**

**Why this is worth a decision log entry rather than a ticket.** D19 criticised the inherited scaffold for exactly this: a deploy script reading a stack output for a stack whose template did not come with the code. **We have now done a smaller version of the same thing on the one resource the entire DNS cutover waits on.** R1 has been the longest running risk in this engagement, and the reason it has not moved is sitting outside the tool that is supposed to manage it.

**THE FIX IS TWO PARTS AND ONLY ONE IS URGENT.** Urgent: request a replacement certificate and send Dan the new validation record, because nothing about the domain can proceed without it. Not urgent but not optional: **wire `module.certificate` into `envs/dev`, import the live certificate, and delete the manual one**, so the next time it dies a plan says so.

**APPLIED Thursday 17 September 2026, on an explicit instruction, and the plan was exactly what it claimed: 1 to add, 0 to change, 0 to destroy.**

**The new certificate is the site certificate (ID in Trevean's private record), `PENDING_VALIDATION`, and Terraform owns it.** The manual certificate (ID in Trevean's private record) was deleted afterwards, so the account holds one apex certificate and a plan can now see it die.

**AND THE OUTPUT CARRIED A CORRECTION TO AN UNSENT DRAFT.** **The apex validation record is byte identical to the one sent on 11 September**, because ACM reuses the validation record per domain per account. A follow up drafted an hour earlier told Dan the record was dead and to close the tab. **That was wrong: the certificate died, the record did not**, and the value he already has is still exactly right. Corrected before sending.

**A SECOND RECORD IS NEW AND IS THE ONE THAT WOULD HAVE BITTEN.** The certificate carries `www.treveanspice.com` as a subject alternative name and **ACM issues nothing until both names validate.** Had only the apex record gone in, the certificate would have sat pending indefinitely and looked like our fault for a third time. Both records are now in a message containing nothing else, because two attempts inside longer messages have both failed to arrive.

**Nothing is currently attached to it**, verified: both distributions report `ACMCertificateArn: null` and no aliases, so replacing it breaks nothing and can be done at any time.

---

## D48 · 17 Sep · The Shopify dependency is not four numbers away. The store is not where he says, the IDs are the wrong kind, and every product is a draft

**Three findings in one evening, each of which alone would have stopped the reorder button, and none of which was visible from the outside.**

**1. `treveanliving.com` IS NOT A SHOPIFY STORE.** Dan: "trveanliving, which lives on Shopify". **It is WordPress 7.1.1 serving a placeholder theme titled "Home 11 - Welcome."** No Shopify runtime, no `window.Shopify`, no storefront JSON, no products. Checked directly rather than assumed. **So the store being converted to `shop.treveanspice.com` is somewhere else and this record still does not know where.** D47's premise does not hold as stated, and the domain move should not start until it does.

**2. THE IDS HE SENT ARE PRODUCT IDS, NOT VARIANT IDS.** Five of them, including Kyoto Garden. **A cart permalink is `/cart/{variantId}:{qty}`**; a product id in that position produces a dead link. Two different numbers, and the admin is the only place to convert one to the other.

**3. EVERY BLEND IS A DRAFT.** Dan: "The blends are drafts at the moment." **A draft product cannot be purchased at all**, so even with correct variant ids the reorder button would reach a checkout that refuses. **Nobody has dated making them active**, and that date is now the real M4 Shopify dependency rather than the four numbers. See R24.

**WHAT THIS DID TO OUR OWN CODE, WHICH IS THE USEFUL PART.** Finding 3 sent us to look at the products webhook, and it would have mirrored a draft product as purchasable: `status` was ignored entirely and `available` defaulted to **true** when absent. **The page would have rendered a working reorder button into a refusing checkout, and it would have looked like our bug.** Fixed at `isPurchasable`, which now treats draft, archived, unrecognised and absent availability as not purchasable. **A disabled button is a correct answer; a working button to a dead checkout is not.**

**AND A SEPARATE DEFECT FOUND ALONGSIDE IT.** Order attribution read `sku.includes(slug.split('-')[0])`, matching each slug's first segment as a substring **anywhere** in the SKU.

> **CORRECTED, and the correction is mine.** The first version of this entry said the culprit was `the-silk-road`, whose first segment would be `the`, and listed four SKUs supposedly dragged onto it. **There is no such slug.** The contract's `Slug` enum and the redirect table both say **`silk-road`**. That claim came from a slug list I typed out instead of reading, and the four examples it produced were invented. **Anything quoting `the-silk-road` or the `soo-THE` example is wrong.** The real defect is below and was measured against the authoritative list.

**The five real first segments are `persian`, `caribbean`, `silk`, `north` and `kyoto`**, and matching them as substrings fails in both directions:

| SKU | Old result | Why |
|---|---|---|
| `TS-PS-100G` | **no match** | A code style SKU contains none of the five words |
| `TS-NAM-100G` | **no match** | Same |
| `NORTHERN-SPICE-50G` | `north-african-night-market` | **NORTH**ern |
| `NORTH-STAR-BUNDLE` | `north-african-night-market` | An unrelated product |
| `SILKY-SMOOTH-01` | `silk-road` | **SILK**y |

**Both directions wrong at once: real orders unattributed, unrelated products attributed to a blend.** Reorder attribution is an M4 deliverable, so this was a defect against the contract. **Narrower than first written, and still real.** Replaced with whole token matching in `services/skuAttribution.ts`, and an unmatched SKU is now logged rather than dropped, because a visible gap is recoverable and a confident wrong number is not.

**Trevean's SKU scheme is still unknown and is not guessed at.** Matching is by full slug or by tag code as a whole token, with an `extraCodes` hook for the real scheme when somebody sends one. `TS-NAM-100G` deliberately still returns nothing, because the tag code is `nm` and nobody has said what `NAM` means.

---

## D47 · 17 Sep · Q33 and Q34 both answered, both the safe way. The apex is not moving and Trevean Living is being retired

**Dan, Thursday 17 September 2026, 4:24 PM:** "Correct. I am not changing where treveanspice.com lives, only converting trveanliving, which lives on Shopify, to shop.treveanspice.com" and "The navigation will be: a customer taps a Trevean Spice jar, reads a Trevean Spice story, and then the reorder button takes them to a Trevean Spice checkout. I will retire treveanliving and publish the Trevean Spice theme in its place."

**CLOSES Q34, and it is reading (a).** The apex is untouched. **The 1,000 shipped jars were never at risk and the hold cost him nothing**, which is the outcome a hold is supposed to have. Asking took one paragraph; the alternative was finding out from a dead tag.

**CLOSES Q33, and better than the question anticipated.** The question was how to word a button that hands a Trevean Spice customer to a Trevean Living checkout. **That journey is not happening at all**: the second brand is being retired rather than lived with. So `BlendPage.tsx` names Trevean Spice again, and the neutral wording of earlier today is withdrawn as no longer necessary.

**THE CONSTRAINT MOVED RATHER THAN DISAPPEARED, AND THAT IS THE PART TO REMEMBER.** The page now asserts "goes straight to the Trevean Spice checkout" as plain text to a customer. **What keeps that true is `SHOPIFY_STORE_DOMAIN`, not the string.** Set it to `treveanliving.com` as a stopgap and two things break at once: the sentence becomes false, and every baked permalink dies on a retirement date nobody is tracking. **Empty is the correct value until the cutover lands**, because the reorder button renders disabled and honest rather than working and wrong. Written into `api/src/config/env.ts`, where it can bite, rather than only here.

**`shop.treveanspice.com` is a subdomain of the zone we are already waiting on.** It needs a CNAME at Bluehost, in the same screen as the outstanding ACM validation record. **It does not conflict with anything**: the apex and `/t/*` are unaffected by a `shop` record. [removed: Serene Labs internal]

**A third credential offer.** [removed: Serene Labs internal] He says he will email admin credentials. A staff invite has been asked for twice. **"Admin credentials" may well mean a staff account with admin permissions, which is exactly right**, so the reply asks which. [removed: Serene Labs internal] Email is also out of band, which is better than the Upwork thread the PIN went through.

---

## D46 · 17 Sep · The Shopify store is on `treveanliving.com`, a second brand this record has never heard of, and Dan is "changing over the theme and URL"

**Dan, Wednesday 16 September 2026, 12:22 PM:** "i will get you the shopify login credentials". **Dan, Thursday 17 September 2026, 11:55 AM:** "shopify pin [removed: credential] to treveanliving.com. i will change over the theme and URL".

**`treveanliving.com` appears nowhere else in this repository.** Searched before replying, across every markdown, JSON and TypeScript file. It is a new fact, not a forgotten one.

**THE URL SENTENCE IS THE DANGEROUS HALF AND IT HAS TWO READINGS.**

| Reading | What it means | Consequence |
|---|---|---|
| **(a) The store moves to `treveanliving.com`, or to a subdomain like `shop.treveanspice.com`** | A Shopify domain change that never touches the apex we need | **Nothing.** Costs us nothing and he does not need to wait |
| **(b) `treveanspice.com` itself is pointed at the Shopify store** | The apex resolves to Shopify | **All 1,000 shipped jars reach an error page on the day it takes effect.** Shopify has never heard of `/t/ps` |

**Reading (a) is much more likely and reading (b) is unrecoverable in a morning**, so it was **asked, with a hold attached, rather than assumed.** This is D39's principle applied again and for the same reason: discovering a mechanism mismatch after a DNS change is the worst available moment. **It is not a hypothetical habit. He repointed this same apex at Vercel on Monday 7 September** without the mechanism being understood, which is D43.

**What is explicitly NOT alarmed about: the theme.** The reorder button lives on our blend pages, not inside his Shopify theme. He can change the theme freely. [removed: Serene Labs internal]

**The PIN. A four digit Shopify PIN is the point of sale staff code**, which signs a person into the POS app on a till. **It is not admin access and it unblocks nothing**, so it was answered rather than pocketed. **It is the second time a credential has been offered where a staff invite was asked for**, so the invite was restated as needing no secret to change hands in either direction. The PIN [removed: credential] has travelled through a message thread and he has been asked to change it.

**What this does to the reorder work, and it is the one piece of good news.** **A variant ID survives a theme change and survives a domain change.** So the ask of 17 September is unaffected by everything he is about to do and he can act on it this morning. The store domain is the volatile half and is wanted "whenever it stops moving".

**Open and not resolved here:** whether the spice line is moving under Trevean Living. It changes what the reorder button says, not whether it works, and a customer who taps a Trevean Spice jar and lands in a Trevean Living checkout should not read it as a wrong turn. Tracked at Q33.

---

## D45 · 11 Sep · The SO4731 tags ARE write protected, reversing D18. The code was corrected the same day and the documentation was not, for seven days

**Dan, 19 August, answering Q4: "There are no write protections on the tags."** **Dan, 11 September, with the box physically in front of him: "yes the tags are locked per the supplier."** **His own SO4731 instruction to the supplier also asked for the NDEF area to be locked.**

**Two of the three say locked, and both of those are specific:** a written manufacturing instruction, and a check against physical stock. Against them sits one answer given from memory about a run that had already shipped. **D18 is reversed.**

**What it costs is not the boolean.** A locked NDEF area cannot be rewritten without the ST25TV area password. **If those 1,000 tags ever need to point somewhere else, that password is the only route, and `tag_password_holder` is nominated to nobody.** Asked of Dan on 11 September and again on 17 September; unanswered at the time of writing.

**THE PART WORTH RECORDING IS THE DIVERGENCE, NOT THE CORRECTION.** Commit `0aad9a6` corrected **both redirect tables, the derived `NFCTags` seed, the chip encoding CSV and four test assertions** on 11 September. **It corrected no document at all.** For seven days this repository's code said locked and its prose said unlocked, including in two M5 handover deliverables. The worst instance: **"The current state of the tag password: there is no tag password"**, followed by a warning that anybody with a phone could rewrite a jar on a shelf. **That is a handover document telling an operator the opposite of the truth about their own security posture.**

**Why it happened is worth more than the fix.** The correction was made where the tests would fail if it were wrong, and nowhere else. **Prose has no failing test**, so a data correction lands cleanly and silently leaves every sentence about that data stale. **The same shape as D15 and D33**: the record and the reality separating without anybody deciding that they should.

**Fixed on 17 September** across D18, Q4, R2, "Hardware and the physical layer", the chip tooling README and four M5 handover documents.

**Still to do, and it is the only thing that would make this evidence rather than testimony.** **Read back one SO4731 tag on a physical reader.** Four documents have said to verify this before anything depends on it, and it was impossible while no reader existed on our side. **Dan has an ACR1552U and the jars**, and was asked on 17 September to put a shipped tag on it and report what GoToTags says. Either answer is welcome: if they are not locked after all, 1,000 jars become repointable.

---

## D44 · 8 Sep · [removed: fees and payments], Option One is confirmed, and Dan was about to spend an afternoon rebuilding pages that the AWS route makes unnecessary

**The 10:40 call on Tuesday 8 September 2026.** Dan was walked through the admin, drove none of it himself because it runs on a laptop, and asked good questions.

[removed: fees and payments]

**CLOSED: the serving route. Option One, AWS, confirmed verbally and in writing.** D25 is now formally reversed with the client's agreement rather than by us, which is what it needed. See D43 for the measurement that decided it.

**CLOSED: Q29.** His supplier spec matches `build/edge/redirect-table.json` exactly, order SO4731, ST25TV02KC, 250 each across four codes. Kyoto Garden is not encoded.

**THE MOST USEFUL THING TO COME OUT OF THE CALL WAS TELLING HIM TO STOP.** Dan: "there's one blockage and that's the encoded tags, I did not bring over those pages from Squarespace to Vercel, so when you click on them they return a 404. I need to redo those pages asap." **He does not need to do that at all.** Under Option One the tag routes are answered by CloudFront before Vercel is reached, so any blend page he rebuilt there would be discarded the moment the apex record changes. **He called it his blocker and was about to spend the afternoon on it.** [removed: Serene Labs internal]

**Two feature requests, both real, neither urgent.** The slug is not editable when creating a blend, which Jacob spotted live on screen. And Dan asked how hard it would be to add his own fields later: "let's say there's another category that we want to add". The honest answer given was that the admin would need building to support it. **Both belong in the end of week report he asked for, not in M3, and neither is a defect.**

**An M4 item surfaced from his own spec.** He instructed the supplier to write protect the NDEF area; our record says `writeProtected: false` (superseded Friday 11 September 2026: the record says `true`, see D45). M4 requires sample tags to "encode, write-protect and tap correctly". Asked while the box is physically in front of him.

**Q24 may be about to close.** He has a photograph of a printed Caribbean Sunset label on his phone and will upload it.

**What is still not certain, and the message says so rather than assuming.** Whether Bluehost offers an ALIAS or ANAME type at all. Dan said "just send me the records" after the mechanism was explained, so the apex record is sent as an instruction with a one line fallback, **because CloudFront has no fixed IP and neither an A record nor a CNAME can serve the apex.** If that type is missing, Option One becomes a nameserver migration with his Google Workspace MX in scope, which is a different conversation.

---

## D43 · 8 Sep · Dan pointed the domain at Vercel, which is the opposite of what the AWS route needs. Both routes are now live options and the choice is his

**What triggered it.** Dan replied at 7:42 AM on Tuesday 8 September 2026 in five points. **Three were straightforward and two change the position materially.**

**Settled: the walkthrough is 10:30 AM Central Time, and the Identity Center session length is now twelve hours.** The credential friction that has cost this project whole afternoons since 27 August is closed.

**Settled, and it is the best news in his message: "Nothing is in the wild at the moment."** **No customer can currently tap a jar and reach anything**, so the Kyoto Garden gap stops being an emergency and becomes ordinary work. Q29's urgency is withdrawn; the question itself stays open until the split arrives.

**CORRECTED: Dan believes the tag UID is what we need. It is not, and we could not use it.** He wrote: "What I am assuming you need is the tag uid to put into a table for the redirect to work properly." **Attribution is per SKU, the chip UID never reaches the page on any handset, and the redirect resolves on the short code already encoded in the URL.** Left alone he would have spent a day retrieving a list with no purpose. **What is actually needed is the per blend split of the 1,000 tags**, because his "five blends" and our "250 each across four codes" cannot both be right.

**THE ONE THAT MATTERS: Dan repointed the apex at Vercel on Monday 7 September, and his own summary of our proposal hid from him that this is incompatible with it.** He wrote: "My understanding is that your proposed AWS setup is only for the tag/QR routes, while the main marketing site remains on Vercel. Please confirm that this is correct." **It is correct about the outcome and wrong about the mechanism.** The marketing site does stay on Vercel and keeps being deployed there. But `treveanspice.com/t/ps` can only be answered by whatever the apex resolves to, so **the apex must point at CloudFront, which serves the tag routes itself and forwards everything else to Vercel.** Confirming his wording without correcting the mechanism would have had him add records that cannot work, and discovering that after a DNS change is the worst available moment.

[removed: Serene Labs internal] He needed the domain live for a meeting, that is a real reason, and it is reversible in minutes.

**Decision: both routes are put to him with their measured costs, and the choice is his rather than steered.** **The AWS route** meets the two acceptance criteria, Lighthouse 90 or better and readable within 2.0 seconds, at 100 and 1.5 s against his page's 82 and 3.6 s, and costs him one repoint. **The Vercel route (D25) is live again** now that the domain resolves, costs him nothing further, and **misses both criteria**, so it would need them waived or remeasured in writing. **D25 is therefore not reopened by us and not closed either: it is handed back.**

**No DNS values were sent and the reason was given to him.** No certificate has been requested for `treveanspice.com`, so the validation record does not exist, and **a plausible looking placeholder is worse than waiting**. The request is a few minutes once credentials are back.

**One thing surfaced that is ours and is not in the message. The admin has no deployed home**: there is no admin bucket or distribution anywhere in `build/infrastructure`. Dan will drive it over a screen share on Tuesday, which satisfies the criterion because he does the editing and we touch nothing, **but "deploy the admin" remains genuinely outstanding M3 work and must not be quietly counted as done because the walkthrough passed.**

---

## D42 · 7 Sep · The render was measured on a Fargate vCPU at last, and it does not meet the five minute criterion. Dan has to be told before the walkthrough, not at it

**The measurement D36 called the outstanding risk on M3 has been taken, and it came back on the wrong side of the line.** The publish render **exceeded the 420,000 ms timeout** on the deployed 2 vCPU task and was killed: `RenderFailed: the web build did not finish within 420000 ms`. **The contractual requirement is 300,000 ms.** So the render alone, before publishing or invalidating anything, is over seven minutes against a five minute budget for the whole job.

**This settles a question the record has been carrying since Friday 4 September and settles it the unwelcome way.** The 199.3 second figure was eight laptop cores. The container figure of 745,900 ms was recorded with two explanations offered, one of which was that it might be a Docker Desktop for Windows artifact saying nothing about Fargate. **It was not an artifact.** Fargate is in the same territory, and the honest budget of 215 to 400 seconds published in "The publish pipeline", section 8.5, was optimistic and is withdrawn.

**MEASURED IN FULL later on Monday 7 September 2026, after raising the ceiling to 1,500,000 ms purely to learn the figure. The publish completed end to end and confirmed itself live.**

| | |
|---|---|
| Content fetch | **8,171 ms** |
| Web build | **754,249 ms** |
| Render total | **762,423 ms** |
| Publish to S3, 43 objects | **1,984 ms** |
| **Accepted to live** | **764,488 ms** |
| Requirement | **300,000 ms** |
| `withinRequirement` | **false** |

**Two things in that table matter more than the headline.** The pipeline itself is not the problem: reading content is eight seconds, publishing 43 objects is two seconds, and **the live confirmation passed on a sha256 match rather than a version number**, so publish, invalidate and read back all work exactly as designed. **99 percent of the time is one number, the web build.**

**And the container figure was not a Windows artifact after all.** 745,900 ms measured under Docker Desktop against **754,249 ms on Fargate**, a difference of about one percent. "The publish pipeline", section 8.5 offered two explanations and declined to pick the convenient one; the unwelcome one was right, and the 215 to 400 second budget derived from the other is withdrawn.

**Q32's fix is confirmed in production by the same run:** "17 content reads, every one carrying `_uncached=...` and every one answered by the origin rather than by a cache."

### The cause, isolated from the task log rather than guessed, and fixed

**The web build splits almost perfectly in two, and only one half is real work:**

| | |
|---|---|
| `prebuild`, `generate-media.mjs` | **731,905 ms** |
| `next build` and postbuild | **about 22,000 ms** |

**Ninety seven percent of a 12.7 minute publish was re-encoding 122 image derivatives that had not changed.** `generate-media.mjs` opened with `rmSync(outDir)`, so **the first act of every render was to delete the very files the container image had just been built with**, and then re-encode them all as AVIF at `effort: 6`, which is among the most expensive encodes in common use, on two vCPUs.

**Fixed by a guard that skips when the index and every file it references are present**, with `TREVEAN_MEDIA_FORCE=1` to rebuild when a master actually changes, which is a content event with a human attached rather than something to detect. **Conservative by construction: a missing or partial set falls through to the full rebuild, so the failure mode is the old slow behaviour and never a page with no images.**

**Measured locally: `npm run media` goes from roughly 732 seconds to 7, and a full `npm run build` completes in 1 minute 10 seconds with all 122 derivatives present and 211 verification checks passing.**

### MEASURED ON FARGATE, and the criterion is met

**Monday 7 September 2026, on the deployed 2 vCPU task, same path, same guard, nothing else changed:**

| | Before | After |
|---|---|---|
| Content fetch | 8,171 ms | **4,450 ms** |
| Web build | 754,249 ms | **11,986 ms** |
| Publish | 1,984 ms | **996 ms** |
| **Accepted to live** | **764,488 ms** | **17,435 ms** |
| `withinRequirement` | **false** | **TRUE** |

**Seventeen and a half seconds against a three hundred second requirement, a margin of about seventeen times, and the live confirmation passed on a sha256 match.** 21 objects published. **M3's publish to live acceptance criterion is met and measured rather than asserted, and `publisher_task_cpu` stayed at 2048: no extra vCPUs were bought.**

**What the whole episode is really about.** The number was never a hardware problem, and both of the explanations the record had been carrying, single core boundedness and a Windows filesystem artifact, were wrong. It was one line, `rmSync(outDir)`, deleting work the image had already done. **It was invisible until the render's child output reached CloudWatch**, which was a fix made the same afternoon for being merely annoying. **`publisher_render_timeout_ms` should now come back down from its diagnostic 1,500,000; it is a ceiling, not a target, and leaving it high hides the next regression of this kind.**

**Where the time goes, now that it can be seen.** The render child's output reaches CloudWatch for the first time, and it shows the content fetch completing in **five seconds** and the web build starting at `prebuild`, `scripts/generate-media.mjs`, **after which nothing is logged for the remaining seven minutes.** So the cost is in the web build rather than in reading content, and the first thing to check is whether media derivative generation is being redone on every render when the image already carries it from its own build.

**Checked, and it is the strongest available suspect.** `scripts/generate-media.mjs` writes **122 files** across the five blends and encodes each one as both AVIF and WebP, with **`avif({ quality, effort: 6 })`**. AVIF at effort 6 is among the most CPU expensive encodes in common use, and there is no guard that skips a derivative whose output already exists: the only `existsSync` on that path checks for the master input, not the product. **The image already carries all 122 files from its own `RUN npm run build`, so every render appears to be paying for them a second time on two vCPUs.** That is a cheap fix with a large prize and it is the first thing to try, ahead of buying more vCPUs.

**Two fixes landed on the way and both are confirmed working.** The freshness guard no longer fails a render on its own repeated reads: the content fetch passed cleanly where it previously failed 8 of 17 reads. And the render child's stdout and stderr are echoed to the task log, which is the only reason the paragraph above can be written at all rather than guessed.

**What this does to M3, and it is not yet a date change.** The admin, the editors, the roles and the publish pipeline are all built and working. **The criterion at risk is the five minute one, and it is a performance problem with obvious first moves left untried**, starting with the media derivatives and then `publisher_task_cpu`, which is at 2048 because nothing measured had suggested four vCPUs would help and that reasoning was based on the container numbers now known to be representative rather than artifactual.

**What must not happen is Dan hearing this at the walkthrough.** He approved $100 a month on Monday 7 September partly on a range that has just been withdrawn, and the honest thing is to tell him the measurement came back over, that the cause is identified and that the work continues, on the day it is known rather than the week after.

---

## D41 · 7 Sep · Dan approved the $100 a month renderer, the acceptance hour and the session length. And he asked for something that was not offered: the website "off Vercel"

**What triggered it.** Dan replied at 8:46 PM and 8:51 PM on Monday 7 September 2026 to the M2 submission, in six numbered points. **Three of the four things M3 was waiting on came back yes in one message.**

**CLOSED: the running cost.** Dan, in writing: **"Yes, I approve turning on the small server for $100 a month".** D36 asked for exactly this before anything was applied, and it stayed false in all three environments until it arrived. **`create_publisher` is now true in `envs/dev/terraform.tfvars` with his words quoted in the comment.** Not applied at the time of writing, because credentials had expired again.

**CLOSED: the acceptance hour.** He offered himself for the publish walkthrough. **That is better than a marketing delegate, not worse**: the criterion is that a person who is not a developer edits content and gets it live, and the founder satisfies it more convincingly than anyone. The session doubles as M3's acceptance test and he has been told so.

**CLOSED: the credential friction.** He is setting the Identity Center session duration to ten or twelve hours.

**OPEN, AND IT IS A SCOPE QUESTION RATHER THAN A TASK: "I need to get the website published and off Vercel for the demo. This is a critical item."** **What was recommended to him does not take his site off Vercel.** It puts CloudFront in front, serves the tag routes and blend pages from AWS, and leaves Vercel as the origin for the marketing pages, which is why the ask was two DNS records and no third party access.

**His sentence has two readings and they are different jobs.** One: treveanspice.com works on his own domain instead of returning 403, which is what was proposed, is two DNS records, and is days of mostly waiting for a certificate. Two: the marketing site stops being hosted by Vercel at all, which is a migration, **is in none of the five milestones**, and would land in the three weeks before an immovable demo. **The first reading is much more likely**, because he has been chasing the apex since Tuesday 25 August and it has returned 403 throughout, so "published" probably means "working on my domain". **It is asked rather than assumed, because discovering the difference after a DNS change is the worst available moment.**

**The mechanics were sent unprompted, because his actual concern was "so nothing breaks during the transfer".** Six steps, nothing public changing until the last one, the time to live lowered beforehand as the rollback lever, and rollback measured in minutes. **His email records are addressed without being raised by him**, since they share the zone and are the thing that would genuinely hurt.

**Q29 moves from a contradiction to a live problem.** Dan: "I do have all five blends encoded. Let me find those records." **If Kyoto Garden is on real jars then those jars reach "jar not recognised" today**, and that is the one genuinely broken thing in the system. The fix is small: the fixture is `status: draft`, publishing it builds the page, and `build-blend-rewrite.mjs` already refuses to deploy an encoded code with no page. **What was asked for is the split rather than the headline**, because our record is 250 each across four codes totalling 1,000, and five encoded blends cannot also be 250 each. **The number drives the tap test sample size**, so it is not bookkeeping.

---

## D40 · 7 Sep · M2 was finished on Monday 31 August and never submitted. The engineering was one working day late, the submission was six, and the second one is entirely ours

**What triggered it.** D33 recorded that this repository could not say whether the M2 delivery went out on Friday 28 August 2026, and was right to record the gap rather than guess. **Jacob closed it on Monday 7 September 2026: the build was completed Monday 31 August, the report was never written, and the milestone was never submitted, because work carried straight on into M3.**

**Decision: M2 is submitted on Monday 7 September 2026 on the build, with the tap through gate remaining separate under D7.** The covering message says the engineering finished on the 31st and that the submission is six working days late for reasons that are ours.

**The correction that matters, because a draft of that message went the other way.** An earlier version explained the delay as AWS access timing: the IAM permission that gated deployment until Thursday 27 August, and one hour credentials since. **That was both wrong and weaker.** [removed: Serene Labs internal] **It is also the D15 failure repeating**: attributing to the client a delay that was ours. The access story is removed, and the hourly credential problem now appears only as a forward looking M3 ask.

**The boundary held in the message, and it is a real one.** On Saturday 5 September the deployed API functions were still running the inert placeholder and answered 403 through the distribution, and scan tracking had never been proven end to end (D37, D38). **So "complete on the 31st" cannot mean the deployed API was live on the 31st, and the message does not say it was.** It uses complete in the sense this project has used throughout and that the client has already accepted: **built and verified, with cloud deployment tracked separately, exactly as M1's criterion 1 was met by a working development environment that was explicitly not a cloud deployment.** The Saturday work is presented as proving the whole chain on deployed infrastructure, which is what it was.

**What this does not do.** It does not reopen D27, which was about the M2 window and was taken on the M2 residual. It does not touch the gate: Varun is named, no days are booked, and the materials do not exist on our side.

---

## D39 · 5 Sep · The blend page was rendering "Isfahan, Iran" on a blend with no Iranian ingredient, nine days after D29 forbade exactly that. The content loader preferred the client's raw words over the provenance markers

**What triggered it.** The dev tables were seeded so the content API would return real rows instead of an empty array. `GET /v1/blends/persian-sunrise` came back with `originCountry: "IR"`, and the deployed page's masthead read **`Isfahan, Iran · Saffron, Cardamom, Rose petals, Lime`**.

**Both halves of that line were wrong, and against a client supplied document.** The blend production specification v1.2 of Thursday 27 August 2026 says in the client's own words that the Scope list **"omitted cinnamon, which is half the blend by weight, and it led with saffron, which is one part in a thousand. Corrected."** The page was still leading with the one part in a thousand and omitting the half. And **D29 records that the blend page must not repeat the printed label's provenance**, because the specification is explicit that the saffron is Spanish, the cinnamon Ceylonese and the lime Omani, so the blend contains no Iranian ingredient at all while the printed label still names a grower at Kashan area coordinates.

**Decision: composition is ordered by weight from the specification, and no origin is rendered for Persian Sunrise until there is one that is true.** Ceylon cinnamon 50, green cardamom 25, Omani dried lime 20, rose petals 4.9, saffron 0.1. `originCountry` and `originRegion` are null in both content sets, the fields are marked `placeholder_null` rather than `client_real`, and the masthead renders the notes alone with no stray separator where a place used to be.

**The root cause, which is the part worth keeping, because nulling the fields would not have fixed it.** `build/web/src/content/load.ts` built the rendered region as `facts.originAsStatedByClient ?? [originCity, originRegion, originCountry]`. **The client's raw words won ahead of everything else.** `originAsStatedByClient` is a record, kept so a copywriter can see what Dan said in one place, and it carries no provenance marker because it is not meant to be rendered. Reading it first walks straight past the `client_real` and `placeholder_null` markers that the whole content readiness gate is built on. **So the field that exists to be quoted was the field being published, and the fields that carry the safety markers were the fallback.** It is removed from the render path. The structured fields are the only render source.

**Why it survived nine days and 211 passing checks.** Nothing was broken. Every test passed, the readiness gate was clean, and the field was marked `client_real`, which is true: Dan did say "Isfahan, Iran". **The marker recorded who said it and never asked whether it may be published**, and no check compares rendered provenance against the sourcing document. **A correction recorded in the decision log does not propagate itself into three separate content copies**: `build/content/fixtures`, `build/web/src/content/fallback`, and the seeded tables. All three held it.

**Scope.** Persian Sunrise only. The specification's section 3 gives the other four blends recommended alternates rather than composition corrections, and Caribbean Sunset, the blend Dan chose for the acceptance run, carries no sourcing exposure at all.

**State: fixed, rebuilt and deployed on Saturday 5 September 2026.** Corrected in both content sets, the loader, the type and the component. 211 checks pass, the tables were re-seeded, the site was synced and the distribution invalidated. **Verified on the deployed page: the masthead now reads "Ceylon cinnamon, Green cardamom, Omani dried lime, Rose petals, Saffron" and the words Iran, Isfahan and Kashan appear nowhere in it.**

---

## D38 · 5 Sep · The field beacon cannot deliver through an origin access control, because sendBeacon cannot set the header Lambda requires. Open, and it is a decision rather than a task

**What triggered it.** The API was brought up behind CloudFront on Saturday 5 September 2026 (D37). A beacon posted by hand with the right header returned 202 and the row was read back out of the deployed `ScanEvents` table. **The same post without that header returns 403, and the page cannot send it.**

**The constraint, from the CloudFront documentation for Lambda function URL origins.** A `POST` or `PUT` through an origin access control must carry `x-amz-content-sha256`, the SHA256 of the request body, computed by the caller. **Lambda does not accept unsigned payloads.** CloudFront signs the request but does not hash the body for you.

**Why that breaks the beacon specifically.** `navigator.sendBeacon` sends a Blob and a content type and **cannot set headers at all**. That is not a limitation of our code, it is the API. `build/web/public/vendor/harness-beacon/beacon/transport.js` tries `sendBeacon` first by design, and its fetch fallback sets only `Content-Type`. **So on the deployed environment today, every real tap's beacon is refused with a 403 and the measurement is silently lost.** Verified against the deployed page, which references `/v1/scan-events` same origin.

**Why this is not being fixed unilaterally.** The beacon is vendored verbatim from the M1 harness and `build/web/scripts/sync-beacon.mjs` refuses to run if the files are edited in place. **That is deliberate: it is the instrument that measured the bench runs and will measure the September matrix, so that the number accepted in August is measured the same way as the number reviewed in December.** M1 is delivered, approved and [removed: fees and payments]. Changing its transport is change control, not a patch.

**The three routes, none of them free.** Change the harness transport to fetch with a SubtleCrypto hash and drop `sendBeacon`, which touches a [removed: fees and payments] deliverable and gives up the survives-the-tab-closing guarantee. Or take the beacon endpoint off the origin access control, which means a function URL the internet can reach, against the app's existing rate limiting and beacon hardening. Or front the beacon with something other than a signed function URL.

**Decision, taken by Jacob on Saturday 5 September 2026: amend the harness transport.** The origin access control stays, the security posture is unchanged, and there remains exactly one instrument. `deliverables/m1/harness/src/beacon/transport.ts` now computes the SHA256 of the body with SubtleCrypto and posts it with `fetch`, `keepalive: true`, and the `x-amz-content-sha256` header. The vendored copy in `build/web` was re-synced through `sync-beacon.mjs` rather than edited, which is the only direction that script allows.

**Why this was the right one of the three.** It is a delivery change and not a measurement change. What is measured, how it is projected onto the frozen contract and the dedupe window are all untouched, **so a number measured after the amendment is comparable with one measured before it**, which is the whole reason the instrument is vendored verbatim in the first place. The other two routes each bought a smaller diff with a worse property: an open function URL, or two delivery paths that can silently diverge between the gate and production.

**What was given up, and it is written into the file.** `sendBeacon` hands the payload to the browser, which completes delivery after the page is gone. `fetch` with `keepalive` is the specified replacement and survives unload, but the guarantee is weaker on older engines. The unsigned `sendBeacon` and plain `fetch` branches are kept below the signed one, because the bench runs and the local recorder post to a plain endpoint where an unsigned body is accepted, and because `crypto.subtle` is absent in an insecure context.

**Proven, not assumed.** The harness selftest **replayed 229 records and reproduced the published bench figures**, which is the check that the measurement did not move. The rebuilt page was served and driven in a real browser: the beacon fired `POST /v1/scan-events`, carried `x-amz-content-sha256`, and **the hash it sent matches the SHA256 of the body it sent**. A hand made POST of that shape through CloudFront returns 202 and the row reads back out of the deployed `ScanEvents` table.

**Deployed and proven on the deployed environment, later on Saturday 5 September 2026.** A real browser was pointed at `d1uyspgs0bmg3a.cloudfront.net/t/ps`, followed the 307, rendered the page, and its beacon returned **202 through CloudFront**. The row is in the deployed `ScanEvents` table: `persian-sunrise`, channel `nfc`, 214 ms to first byte and **892 ms to readable against the 2.0 second requirement**. **That is the whole chain, from a tag code to a row, with nothing simulated.**

---

## D37 · 5 Sep · An origin access control against a Lambda function URL needs two permissions, not one. The missing one reads exactly like a signing fault

**What triggered it.** The API package was deployed to the three functions and every request through the distribution returned **403 with the generic function URL authorization message**, while the same function invoked directly returned 200 and a request signed by hand straight to the function URL returned 200 and a valid body. **So the code worked, the function URL worked, and only the CloudFront hop failed.**

**Decision: `build/infrastructure/modules/compute` now grants `lambda:InvokeFunction` alongside `lambda:InvokeFunctionUrl`, both scoped to the distribution ARN.** Applied, and `GET /v1/blends` through the distribution returns 200.

**Why it took as long as it did, which is the part worth keeping.** Every visible setting was already correct: origin type `lambda`, signing `always`, protocol sigv4, `https-only`, no `Host` forwarded, no edge functions, no qualifier, and a resource policy whose principal, action, `SourceArn` and `FunctionUrlAuthType` all matched the documentation. **A permission short one action presents as a signature problem**, so the search went to the origin access control, the headers and the cache policy first. **Two hypotheses were tested and disproved before the right one**: propagation, disproved by eight retries over four minutes, and Accept-Encoding normalisation breaking the signature, disproved by disabling compression and getting the same 403. **That change was reverted rather than left in, because it fixed nothing and its comment would have claimed a cause that was not real.** The answer was in the CloudFront documentation, which gives the grant as two separate `add-permission` calls.

**A second real defect was found on the way and fixed.** `content_api` and `scan_ingest` held their DynamoDB grants but no KMS grant, while `admin_api` and `rollup_consumer` had one. The tables are encrypted with the environment key, so **the table permitted the write and KMS refused the decrypt**, which surfaces as a 500 rather than a 403 and is invisible to `terraform plan`. Found by the first real beacon, not by review. `logging` is correctly the only role still without a KMS statement, because log group encryption is done by the Logs service under the key policy.

**Both belong to the same family as the tag value commas and the oversized policy comment: defects only a live apply and a live request can find.**

---

## D36 · 4 Sep · The render runs in a small always on container on Fargate, not in a Lambda. It costs about $100 a month in Trevean's account and it is off until Dan says otherwise

**What triggered it.** The publish pipeline was built, tested and measured on Friday 4 September 2026 at 199.3 seconds end to end against the 300 second contractual requirement, and then had nowhere to run. `aws_lambda_function.web_renderer` was 30 seconds and 1769 MB; the render is a full Next export. So `revalidation_webhook_url` stayed null, publish queued and dispatched nothing, and `blend_html_can_be_published` read false. **It was the only thing stopping M3's acceptance criterion working in the deployed environment.**

**Decision: a small always on container on Fargate, one task, behind a load balancer that only CloudFront can reach, fronted by its own small distribution. `build/infrastructure/modules/publisher`.**

**Why, and it is not the timeout.** Raising the timeout would have hidden the problem rather than fixed it. Two properties of the code that was already written decided it. `POST /revalidate` answers 202 and renders afterwards, because the API's dispatch carries a 2000 ms abort, and Lambda freezes the execution environment when the handler returns. And the job status the admin publish screen reads is served from memory, which needs a process with an address. Every serverless option requires rewriting the one component whose whole job is to be trustworthy about whether a change is live, in the week M3 is due.

**Rejected, each with a reason rather than silently:** a Lambda container image (freezes on return; the 2000 ms abort; a rewrite), an on demand Fargate task (no HTTP endpoint, so a front door is needed anyway, plus a launch per publish), a CI job (moves the credential that writes the origin out of the client's account), enqueue to a builder (says how the render is reached, not where it runs), App Runner (no CPU outside a request), Lightsail containers (no task role, so static access keys for an identity that can write the origin 1,000 jars resolve to).

**Two measurements corrected an assumption that was in the record.** A cold `.next` cache is 37 seconds FASTER than a populated one on this build, so "keep the render warm" is withdrawn as a mitigation. And coalescing several publishes into one render moved from optional to required: two renders in one working directory corrupt each other, and M3's acceptance scenario is a person editing several blends in a session. It is built.

**The part that is Dan's.** About $100 a month, continuously, in Trevean's account, against about a dollar a month if this had fitted in a Lambda. **`create_publisher` therefore defaults to false in all three environments** and turning it on is one line. It is the first operating cost this engagement adds to the account Trevean keeps after handover, so it is agreed before it appears rather than after.

**What is still unknown and is the outstanding risk on M3.** The 199 second render was measured on eight laptop cores and has never run on a Fargate vCPU. The honest budget is 215 to 400 seconds against a 300 second requirement, and the upper half of that does not meet the criterion. It is an hour of measurement on the day credentials work, and it is the first thing to take, before anything depends on it. See "The publish pipeline", section 8.5.

**And one question the host decision forced that had never been asked: where the render READS the API from.** Locally it is the process on the next port. Deployed, the API's only front door is behind CloudFront, and `/v1` content reads are cacheable there per the frozen contract, section 7. A render served a cached response publishes the version before the edit and reports success, which is the one direction that must never be taken quietly, and coalescing makes it more likely rather than less. **So it is left unset, which renders the fixtures, which the deployment guard refuses on production.** Useless and loudly useless rather than plausible and quietly stale. Closing it is either accepting the staleness or giving the renderer an uncached path, and it is a decision rather than a task. See "The publish pipeline", section 8.4a.

**Nothing was applied.** The development account's credentials are expired, no plan has been read, and the deployed environment is unchanged.

---

## D35 · 4 Sep · M3's [removed: Serene Labs internal] demand figure was derived from the window it was being compared against. It is withdrawn, the built admin CMS was never counted against M3, and Friday 11 September 2026 is achievable on two named conditions

**What triggered it.** A message to Dan was drafted on Friday 4 September 2026 telling him M3 could not land on Friday 11 September. **It was one message away from going out.** The reasoning was checked before sending and it did not survive the check. **Two independent errors were found, either of which is enough on its own to overturn the conclusion.**

**Decision: the [removed: Serene Labs internal] demand figure is withdrawn as unfounded, along with every shortfall computed from it, including D33's [removed: Serene Labs internal]. M3 stays Friday 11 September 2026 and is achievable, conditional on the two items in section 4. It is not certain, and no document may write it as certain.**

**What this does and does not do to D33, said first because a correction written a day after a schedule entry is the easiest place to quietly unwind one.** **D33's observations stand in full**: the eight day hole in this record, the six working days against the reset anchor, the day for day notices that did not go out, the 403 at the apex and the 500 at `/t/ps`. **One thing is withdrawn from it, the M3 arithmetic in its table**, because the entire right hand column of that table is the [removed: Serene Labs internal] figure. **D27 is not reopened either.** Holding Friday 28 August 2026 and absorbing the compression was a decision about the M2 window, taken on the M2 residual, and nothing here touches it.

### 1. The figure was computed from the window rather than from the work

**Where it comes from.** "M2 plan: our delivery holds at Friday 28 August 2026", section 1.3. M3's own scope after de-scope rungs 1 and 2 was set at **[removed: Serene Labs internal], being the window less the deferred consolidation**. The consolidation was then added back on top to give **[removed: Serene Labs internal] demanded**.

**So the demand was the window, minus a number, plus the same number.** It is arithmetic about the window and it was compared against the window. **At no point did anyone estimate what M3 requires.**

**Why it did not simply return the window, which is the detail that let it pass unnoticed.** The deferral was subtracted at one end of its range and added back at the other: [removed: Serene Labs internal]. **The spread between the two ends is the deferral estimate being played against itself. It is not uncertainty about M3's work**, because no estimate of M3's work is present anywhere in the derivation. A figure that had been left flat at the window would have been obviously circular. Splitting it into a range disguised that.

**What inherits the defect, listed so none of it is quoted again.** Every M3 shortfall in this repository is the demand figure minus an available count: [removed: Serene Labs internal]. **None of them measures anything.** [removed: Serene Labs internal]

### 2. The admin CMS was built on Saturday 22 August 2026 and no M3 estimate ever counted it

**This is the second error and it is independent of the first.** Even a sound demand figure would have been wrong, because it was priced as though M3's deliverables were unbuilt.

**Verified in `build/admin` on Friday 4 September 2026 by running the suite: 200 tests passing across 11 files, of which 105 are role enforcement**, being 95 in the integration suite that asserts every route unauthenticated, at each insufficient role and at the role that should hold it, and 10 in the role model and session unit suite. **Built ahead of schedule on Saturday 22 August 2026.**

**Every M3 deliverable is present.** The blend, recipe and grower editors. Admin, Editor and Viewer, enforced in three independent places. A preview screen rendering the draft as a customer reads it at 390 px. A media library with presigned upload, alternative text and derivative status. An audit screen, an NFC and tags screen, and the placeholder publish guard. **And `build/content` seeds five blends where M3 requires three.**

**That the work was done early is in this record. That it discharges M3's scope is not, anywhere.** The two facts were never put next to each other, which is how a milestone whose deliverables were already sitting in the repository came to be reported as [removed: Serene Labs internal] short.

### 3. What M3 actually has left, stated as work rather than as a number

**Deliberately not converted into an hours figure**, because replacing one unfounded number with another one is the failure this entry exists to record.

1. **Deploy the API and the admin.** The HTTP invoke path is written and validated in `build/infrastructure` and has never been applied, because the credentials expired mid run on Thursday 27 August 2026. **Hours rather than days, once credentials are in hand.**
2. **The publish to live link.** Pressing publish must regenerate the page and put it in front of a customer within five minutes, which is M3's acceptance criterion. The deployed environment reports `blend_html_can_be_published = false` and the pages were published by hand with `aws s3 sync`. **This is the genuine remaining engineering, and it is days rather than weeks.**
3. **The acceptance run.** A member of Trevean's marketing team publishes a blend end to end while we watch and say nothing. **Roughly an hour of a non developer, not the two days the tap test needs.**

### 4. The conclusion, and the two conditions it is stated under

**Friday 11 September 2026 is achievable. It is not certain and it is not claimed to be.** The two conditions are named because the date turns on them and on nothing else:

- **AWS credentials that do not expire hourly.**
- **An hour of a marketing person's time next week.**

**The standing rule is unchanged and applies to both: if either slips, the date slips day for day, in writing, on the day it is known.** That rule is what makes stating the date as achievable safe rather than optimistic.

**De-scope rung 3 returns to held in reserve and rung 4 goes back out of view**, because the trigger that moved them was the shortfall and the shortfall was not real. **Confirmed on the gate day with the real position counted, exactly as before.**

### 5. The lesson, which is the reason this is a decision log entry and not a correction note

**An estimate derived from the window it is being compared against cannot tell you whether the work fits the window.** It can only return the window. **Any comparison built on it is a tautology wearing the clothes of an arithmetic check**, and this one survived five separate revisions and reached the last draft before a client message because it looked like the kind of number this record is careful with.

**Two habits follow.** **A demand figure and the window it is tested against must be estimated from different inputs, or the test is not a test.** And **an estimate must be re-checked against what has actually been built before it is quoted**, because the most expensive error here was not the circular figure. It was pricing work that was already done. **Between them they would have moved a milestone that did not need moving and cost the client a date we could meet.**

---

## D34 · 28 Aug, recorded 4 Sep · The tester is named and the gate is bookable rather than booked. Dan's second gate proposal is clearer and still not agreed. His tag encoding statement contradicts the record and is recorded as a question

**Numbered above D33 because it is the newest entry made, and dated to the events it records rather than to the day it was written.** **The events are Thursday 27 and Friday 28 August 2026. The recording date is Friday 4 September 2026.** The two are kept apart, as they were for the client-supplied files of 26 and 27 August.

**What triggered it.** D33 recorded an eight day hole in this repository and listed seven things nobody had checked. **The thread was then read.** It closes most of that hole. **The merged reply of Thursday 27 August 2026 went out at 2:10 PM. Dan replied at 4:10 PM the same day, we replied at 6:20 PM, and he replied again at 9:52 AM on Friday 28 August 2026.** That last message carries everything below. **It has sat unrecorded here for five working days: Monday 31 August, Tuesday 1, Wednesday 2, Thursday 3 and Friday 4 September 2026.** That is ours, it is stated once, and it is not explained away.

### 1. The gate tester is named, and the distinction that matters is what has not happened

**Dan named the tester on Friday 28 August 2026: Varun Tej Pennam.**

**Decision: the tester dependency is recorded as partially landed. The person is named. No days are booked. The acceptance run is bookable, not booked, and no document may imply a date exists.**

**Why the distinction is the whole of this section.** The dependency as written, and as it has been written since Friday 7 August 2026, is **a named tester with one to two full days booked**. **Naming a person satisfies the first half of that sentence and not the second.** A run needs a date in somebody's calendar, on Trevean's premises, against Trevean's materials, under D7. **What changed is that the run can now be scheduled. What did not change is that it has been.** Anyone who writes "the gate is booked", or quotes a run date, has read this entry as more than it says, and that is the same overclaim D27 was written to prevent one level up.

**What it is the first of, said precisely because two counts are in play and they give different answers.** **It is the first of the three items Dan was left holding after his Thursday 27 August message to close**: the label photograph, the named gate tester, the second blend. **It is the second of the five dependencies that missed Friday 21 August 2026 to land**, after Q6 on Thursday 27 August. **Both readings are true and neither is the same as the run being scheduled.**

**What is still outstanding on the same dependency, and it is not a small remainder.** The physical materials: jars, interim lids at 8 mm or thicker with tags fitted, one case per handset, all eight handsets. **Dan's message does not mention them, so they are unknown rather than confirmed outstanding**, which is a weaker claim and the true one. **A named tester with nothing to tap is not a run.** R10, R2.

**What this does not do to the day count, said so nobody quietly recomputes it.** D33's six working days against the Thursday 27 August 2026 anchor was stated with its condition attached: six if all four remaining dependencies stayed outstanding throughout. **One of the four is now known to have partially landed on Friday 28 August 2026 and the rest are still unchecked.** **The count is not revised here**, because revising it needs the materials, the content and the domain checked against the thread as well, and because the item in question has not fully landed. **What has changed is that the number is now checkable on one of its inputs rather than wholly unverified.**

### 2. Dan's second gate proposal, which answers our objection to his first

**Dan, Friday 28 August 2026: "continue developing both blends, since we have the labels printed for these two, and use Persian Sunrise as the adjacent jar test, but demo only Caribbean Sunrise on demo day."**

**He wrote Sunrise where he means Sunset in the final clause. The sense is unambiguous from the rest of the sentence and it is read as Caribbean Sunset.** Recorded rather than silently corrected, because this is a quotation.

**Status: PROPOSED. Not agreed, not adopted, and nothing has moved onto it.** D31 stands exactly as written and this entry does not supersede it.

**What it answers, and it is our own objection coming back answered.** D31 and the tap count arithmetic both record that **adjacent-jar isolation is defined on two jars of different blends, so a one blend gate still needs a second physically distinct encoded blend on the bench.** **Dan's shape supplies it: Persian Sunrise is that second jar.** It is not a workaround, it is the objection taken seriously.

**Why it is a clearer proposal than the 27 August one, stated because that is a finding and not a courtesy.** Two reasons.

- **It keeps both blends in the build.** The 27 August proposal was Caribbean Sunset alone or Caribbean Sunset plus a blend on stand by, which left the set at **one blend plus an unknown**, and nothing can be measured or booked against that. **This set is closed and both its members are named.**
- **It separates what is scored from what is demonstrated.** The gate and the 27 September demo are different events with different purposes, and the 27 August wording ran them together. **This one does not.** Persian Sunrise carries a gate role, Caribbean Sunset carries the demo, and the reason given for keeping both, that these are the two blends with printed labels, is a fact about inventory rather than a preference.

**And it is still a change to a contractual acceptance criterion, so it is still agreed in writing or not at all.** **SOW Rev C section 5 requires section 6.1 met on Persian Sunrise AND Caribbean Sunset.** Being clearer is not being agreed, and being well founded is not being agreed. **This is the same class of change as the section 5 wording change we ourselves proposed at R9 and Q5, and it goes the same way.** Letting a preference expressed in a message become the criterion is the failure mode this contract exists to prevent, and it would be us grading our own homework on the criterion gating [removed: fees and payments], which is what D7 exists to stop.

**One thing the new shape leaves unstated, and it decides the tester's day count.** **Whether read success is scored on both blends or only on Caribbean Sunset.** "Use Persian Sunrise as the adjacent jar test" gives Persian Sunrise a role in one term of the run and says nothing about the other two. **560 taps at two blends against 400 at one is exactly this question**, and Varun Tej Pennam's booking is made against the wrong day count until it is answered. **It goes back with the request for written agreement rather than being assumed either way.** Q28.

### 3. Only two blends have printed labels

**Dan: "we focused the label print on the two premier blends we were confident with."** **Persian Sunrise and Caribbean Sunset have printed labels. The other three have none.**

**New information rather than a correction.** This repository has held one label artwork file since Wednesday 26 August 2026 and has never established how many blends were printed. **It is the stated reason behind the gate shape in section 2**, and it is recorded on its own because it bears on R19 and R22 as well: **the QR destination question and the instruction copy defect are two blends' worth of printed stock, not five.**

### 4. Persian Sunrise's origin: two candidate shapes, no answer, and no date

**Dan: "we are working on refining Persian Sunrise farmer origins or simply narrowing it to a blend rather than a farm. We currently don't have an Omani farmer. This spice is fairly common to source, but it changes our provenance message. We are wrestling with this as we speak."**

**What changed: the shape of the answer, not the answer.** There are now **two candidate outcomes rather than an open field**: a named farmer, or **provenance stated at blend level with no farm named**. **What has not changed: there is no answer and there is no date for one.**

**No view is offered on it, here or anywhere.** Not on the origin, not on the sourcing, not on the provenance message. Legal and export notes for this blend are kept in a private record held by Trevean. The build finding is unchanged and is stated narrowly: **the blend page cannot assert an origin the product does not have, and it cannot be written until someone decides what it does assert.** Until then the origin, grower and coordinate fields for Persian Sunrise stay unpublished rather than filled with a guess. R21, Q26.

**Also from the same message: "The other four blends we have do not have the provenance exposure either."** **Consistent with the production specification, which marks only Persian Sunrise as carrying a required substitution.** It does not contradict this record's separate statement that Caribbean Sunset is the only one of the five with no **sourcing** exposure at all: the specification names origin constraints on three of the others, and **an origin constraint is not a required substitution.** Two different claims about two different things, and both stand.

### 5. The tag encoding contradiction, opened as a question and deliberately not resolved

**Dan, Friday 28 August 2026: "I have the tags encoded for all five blends."**

**This record says otherwise, in two places that agree with each other.** The Scope document's tag code map has **`/t/kg` as "Reserved, not encoded"**. The redirect table has **kyoto-garden at `status: reserved`, `unitsEncoded: 0`**, with a total of **1,000 units across the four encoded codes**, `/t/ps`, `/t/cs`, `/t/sr` and `/t/nm` at 250 each.

**Decision: the record is not changed to match Dan. The contradiction is opened as Q29, with both readings stated and neither adopted.**

**The two readings, and what changes under each.**

| Reading | What it means | What changes |
|---|---|---|
| **(a) He holds encoded tags, or is counting the reserved code loosely** | Kyoto Garden tags exist in a drawer, or the sentence means all five codes are defined rather than all five carry stock | **Nothing.** The 1,000 unit total stands, `/t/kg` stays reserved, and the rewrite function's exclusion of kyoto-garden is correct as deployed |
| **(b) Kyoto Garden tags are on physical jars** | Jars carrying `/t/kg` are in the world | **Two things, and the first is live today.** Those jars resolve to the branded "jar not recognised" page, because **the deployed rewrite function deliberately excludes kyoto-garden on the grounds that it has no built page.** That exclusion is correct under (a) and wrong under (b). And **the total tag count is no longer 1,000**, a figure that appears throughout this repository including in the standing facts every document is checked against |

**Why this is not pedantry, which is the reason it gets an entry rather than a footnote.** **A jar that reaches "jar not recognised" is indistinguishable, to the customer holding it, from the failure R1 has been open on for ten days.** The difference is that R1 is known and this would not be. **And a wrong unit count is the kind of number Dan checks**, on a project that has already revised the lid thickness, the chip family and the milestone structure.

**Why it is not resolved by picking a side.** The standing rule is that where the record contradicts itself, both sides are recorded and it is marked unknown. **He may mean he holds encoded tags rather than that jars carry them, or he may be counting the reserved code loosely, and neither is an unreasonable thing to have meant.** **Changing four documents and a machine-readable table on one clause of one sentence, against a record that has been internally consistent since July, is the wrong direction of travel for a question that one plain sentence to him settles.**

**What settles it, and it is one question.** **Whether any physical jar carries a `/t/kg` tag, and if so how many units.** That is what the redirect table's `unitsEncoded` field means and it is what every count in this repository is built on. Q29.

---

## D33 · 4 Sep · The record stops on Thursday 27 August. Six working days have run against the reset anchor, and M3's window has been spent waiting for a gate that has not been run

> **PARTIALLY WITHDRAWN by D35, later the same day. Read D35 before quoting anything from this entry.** **Everything this entry observes stands: the gap in the record, the six working days, the missing notices, the live HTTP readings, the window having been spent.** **What falls is its conclusion about M3**, which rests on a [removed: Serene Labs internal] demand figure derived from the M3 window itself and priced as though the admin CMS were unbuilt. **Friday 11 September 2026 is achievable.** The withdrawn passages below are struck rather than deleted.

**What triggered it.** This repository was last updated on **Thursday 27 August 2026** and still describes **Friday 28 August 2026** as an upcoming delivery date. That date passed eight days ago. **Nothing between Friday 28 August and today is recorded anywhere in it.** The update is therefore two separate jobs: state what can be verified today, and mark the rest as a gap in our own record rather than as an absence of events.

**Decision: the position on Friday 4 September 2026 is as recorded below, and every date in this repository is read against it. The eight day interval is marked as a gap in the record, not as a quiet week.**

**What this entry does not do, said first because a schedule entry written after a silence is the easiest place to smuggle in a re-argument.** **It does not reopen D27.** Holding Friday 28 August 2026 and absorbing the compression on our side was a decision taken deliberately, with the M3 arithmetic in front of it, and it stands. **What this entry records is what happened to the schedule after that decision, under the rule that decision left running.** It does not re-date M3, M4, M5 or the demo, because re-dating on a repository that cannot say whether the acceptance run happened would be inventing an input. **And it does not assert that nothing happened between Friday 28 August and today.** It asserts that we do not know, which is a different and weaker claim, and the weaker one is the true one.

### Verified today by direct query, and recorded as observed rather than reported

- **`treveanspice.com` returns HTTP 403 at the apex and HTTP 500 at `/t/ps`.** **Identical to the readings of Tuesday 25 August 2026**, ten calendar days and eight working days earlier. **The thousand encoded jars still reach an error page.** R1 has not moved.
- **`trevean-spice-website.vercel.app/t/ps` returns HTTP 404.** Identical to the reading of Thursday 27 August 2026. **The redirect configuration has still not been published to the Vercel project.** That step is ours, it needs no client input, and it has been outstanding for eight days.
- **The development environment is still serving.** `d1uyspgs0bmg3a.cloudfront.net/t/ps` answers 307 to `/blend.html?blend=persian-sunrise&via=nfc`, which answers 200, and `/t/cs` does the same for Caribbean Sunset. **The 169 resources applied on Thursday 27 August 2026 are up and correct eight days later**, and the same-origin relative target D17 optimisation 3 requires is holding in the wild rather than only in CI.
- **The AWS credentials from Thursday 27 August 2026 have expired**, as one hour tokens do. The HTTP invoke path is still written, still validated and still never planned against AWS.

### What is not known, and it is recorded as unknown rather than guessed

**Everything between Friday 28 August and today.** The repository cannot supply any of the following, and **no document may quote a position on them to the client until they are checked against the actual message thread and calendar:**

- **Whether the M2 delivery went out on Friday 28 August 2026.** The package was compiled on Thursday 27 August and is complete in `deliverables/m2/`. Whether it was sent is not recorded.
- **Whether Dan replied to the merged message of Thursday 27 August 2026**, and if so to which of its parts.
- **Whether the AWS screen share happened.** It was booked for Friday 28 August 2026 at 10:30 AM Central Time. A booked call is not a held call, and the record stops the day before it.
- **Whether a gate tester was named**, and whether any days were booked.
- **Whether any physical materials were assembled**: jars, interim lids at 8 mm or thicker with tags fitted, cases, handsets.
- **Whether the label photograph arrived.** Dan said on Thursday 27 August that he would take it that night. Q24 turns on it.
- **Whether the Persian Sunrise origin answer came back**, in the form of what the website's specific mention says (Q26), or whether the R22 route (b) or (c) was chosen, or whether the Q28 blend set change was agreed or withdrawn.

**Not knowing is not the same as nothing having happened, and the two must not be collapsed.** Any one of those could have landed. **The correct handling is to check before quoting, not to assume in either direction**, and a document that reads "still outstanding" about an item nobody has looked at since 27 August is making the same class of claim D15 was written to stop.

### The working day count

**Six working days have elapsed since the D27 anchor of Thursday 27 August 2026: Friday 28 August, Monday 31 August, Tuesday 1, Wednesday 2, Thursday 3 and Friday 4 September 2026.** Checked against a calendar. **Monday 7 September 2026 is Labor Day and falls after this count, not inside it**, so it takes nothing off the six.

**What the reset rule does with those six, stated with its condition attached rather than as a flat number.** D27 left the rule running forward from Thursday 27 August 2026 against the acceptance run: each working day an outstanding client item stays outstanding is a working day on that date. **So six working days is the figure if all four remaining dependencies stayed outstanding throughout, and the repository cannot confirm that they did.** If something landed inside the gap, the count is smaller and the correct count is the one the thread supports. **The number to quote to the client is the one checked against the thread, and until that check is done the six is our own working figure and not a notice.**

**And the half of the rule that is ours was not performed.** The standing rule says the slip goes in writing on the day it is known. **On this record no day for day notice went out on any of those six days.** That is the same failure as Saturday 22 August 2026, when the notice went one day late and the day was recorded as ours, except that it is now potentially six days rather than one. **Stated once, owned, and not explained away.** It is also the reason the count above cannot simply be asserted at the client: a rule administered by nobody for six working days is not a rule that produces a number anyone should be handed without checking it first.

### What an unrun gate does to M3, which is the point of this entry

**M3 is Friday 11 September 2026. It is one week away. The M2 acceptance run has not happened, and on this record it has not been booked.**

**The mechanism, restated because everything follows from it.** The M3 window **starts the working day after the gate and ends on Friday 11 September 2026 regardless.** That is why a moving gate has always shortened M3 rather than moved it. **The consequence nobody had to face while the gate had a date is this: a gate that has not happened does not shorten M3's window, it removes it.** The window is not waiting to start. **It has been running down since Monday 31 August 2026, and the days it has spent are gone whether or not anything was done in them.**

**The arithmetic.** [removed: Serene Labs internal]

> **WITHDRAWN on Friday 4 September 2026 by D35, later the same day. The table below is kept because the error must stay visible, and none of its right hand column may be quoted.** **The [removed: Serene Labs internal] demand figure it is measured against was derived from the window itself**, being the window less the deferred consolidation with the consolidation added back, **so it was never an estimate of M3's work and comparing it to a window cannot tell anyone whether M3 fits.** **And it was priced as though M3's deliverables were unbuilt, when the admin CMS has been built and tested since Saturday 22 August 2026.** **The working day count, the spent window and the mechanism in the paragraph above are all sound and survive. Only the shortfalls fall.** See D35.

| | M3 window | Working days |
|---|---|---|
| **As D27 restored it, gate Fri 28 Aug** | Mon 31 Aug to Fri 11 Sep | 9 |
| **Spent between Mon 31 Aug and Fri 4 Sep** | Mon 31 Aug, Tue 1, Wed 2, Thu 3, Fri 4 Sep | **5** |
| **Left today, best case, a gate run today** | Tue 8 to Fri 11 Sep, Labor Day inside the remainder | **4** |
| Gate Wed 9 Sep | Thu 10, Fri 11 Sep | 2 |
| Gate Thu 10 Sep | Fri 11 Sep | 1 |
| **Gate Fri 11 Sep or later** | **None** | **0** |

[removed: Serene Labs internal]

**Read the [removed: Serene Labs internal] figure carefully, because that number appears in this repository already, marked superseded.** D22's floating table produced [removed: Serene Labs internal] at a Friday 4 September gate, and D27 struck it out along with [removed: Serene Labs internal]. **This is not that figure returning and it is not D27 being unwound.** Those numbers were the consequence of a slip that was withdrawn. **This one is the consequence of the window elapsing while the gate went unrun**, which is a different cause arriving at a similar number, and it is live rather than superseded. **The distinction matters for exactly the reason D22 and D19 were kept apart: reaching a familiar number by an unfamiliar route is how a settled decision gets re-opened by accident.**

**What follows from it, plainly.**

> **The four bullets below are WITHDRAWN by D35 and kept visible.** All four are consequences of the [removed: Serene Labs internal] figure and fall with it. **What replaces them: M3's deliverables are built and tested, what is left is deployment, the publish to live link and an hour of a marketing person, and Friday 11 September 2026 is achievable on the two conditions D35 section 4 names.** **De-scope rung 3 returns to held in reserve and rung 4 goes back out of view.** The one line that survives unchanged is the last: **there is no third absorption.**

- ~~**The best case now available to M3 is worse than the worst case that triggered D27.** On Thursday 27 August the shortfall that made holding the date worth doing was [removed: Serene Labs internal]. **Today, on the most favourable assumption available, a gate run today, it is [removed: Serene Labs internal].** Holding the M2 date bought M3 its window back and then the window was spent waiting.~~
- ~~**De-scope rung 3's trigger is firing again and harder than it did on Saturday 22 August 2026.** It returned to held in reserve on Thursday 27 August because the restored window closed on rungs 1 and 2. **That window does not exist any more.** Rung 3 is not quantified anywhere in this record, so what it saves is not known, **and it is not obvious that rungs 1, 2 and 3 together close the gap [removed: Serene Labs internal].** Confirmed on the gate day with the real window counted, as it always was.~~
- ~~**So the honest position is that M3 moves, or M3's scope is cut well past rung 3, and neither is a decision this repository can take.** Both need the client, and both need the one fact nobody here has: whether the acceptance run has been booked. **What is not available is a third option where Friday 11 September holds at full scope**, and no message should be written as though it were.~~
- **There is no third absorption.** D27 said so in the entry that granted the second. **It is being held to here rather than quietly reconsidered**, which is the whole reason it was written down in advance. **This bullet is not withdrawn and stands.**

### Sunday 27 September 2026

**Not at risk. And the distance between "not at risk" and "comfortable" has narrowed, and the record should say so rather than repeat a reassurance that was written against a different margin.**

**The margin is 23 days, three weeks and two days.** It was four weeks and two days behind Friday 28 August 2026, which is the figure every current document quotes. **One week of it has been spent** and the sentence "four weeks and two days" is now stale everywhere it appears.

**What is behind the demo, and it is the part that is worth more than the day count.** **Twelve working days remain to the dress rehearsal on Wednesday 23 September 2026**, counting Monday 7 September out as Labor Day, and fourteen to the code freeze on Friday 25 September 2026. **In front of the rehearsal sit M3, M4, the acceptance run that has not been booked, and the apex still not pointing at a deployment.** The rehearsal is what turns the demo from a plan into a rehearsed thing, and it is unmoved.

~~**So: the demo date is not the thing to watch and M3 is.** The first date that breaks is Friday 11 September, and it breaks on arithmetic that is already unavoidable rather than on anything that might yet go wrong.~~ **CORRECTED by D35: no date breaks on arithmetic, because the arithmetic was circular. Friday 11 September 2026 is achievable on the two conditions D35 section 4 names.** **M3 is still the date to watch**, not because it fails but because it is the next one due and it turns on two client dependent conditions. **Writing this up as a crisis would be wrong. Writing it up as "27 September is not at risk" and stopping there would also be wrong**, because it answers the question nobody needs answered while leaving the one that is due next week untouched.

### What is owed as a result, and it is small and immediate

**Check the thread and the calendar before anything goes to the client.** Every item in the unknown list above changes what the message says. **A day for day notice built on six working days that nobody verified would be a number presented with more confidence than it has**, and this is a client who checks every figure. **Establish what actually happened first, then apply the rule to the real facts, then send it.** The rule is not softened by the delay in administering it, and neither is the requirement that what we send is true.

---

## D32 · 27 Aug · The two AWS accounts were the wrong way round for a week. The account this project holds credentials for is the Development account, not the management account, and it is the correct deployment target

**What triggered it.** The development environment was about to be applied, and the account it was about to be applied into was checked by name for the first time. `aws organizations list-accounts` and `aws organizations describe-organization` on Thursday 27 August 2026 returned the opposite of what the record had said since Monday 24 August 2026.

| Account | Name | Email | What it is |
|---|---|---|---|
| `[account id withheld]` | `Trevean Spice` | root sign-in email in Trevean's private record | **The Organization management account.** Org ID in Trevean's private record |
| ID in Trevean's private record | `Trevean-NFC-Development` | root sign-in email in Trevean's private record | **The development account** |

**Decision: the account this project holds credentials for (ID in Trevean's private record) is the development account and the correct target for `envs/dev`. Everything the record derived from the reverse is withdrawn.**

**How the error was made, and it is worth being exact rather than generous about it.** Dan described his estate on Monday 24 August 2026 as a management account with an empty Development OU beneath it. Credentials for the development account (ID in Trevean's private record) were already in hand, had been since Wednesday 19 August, and were the only credentials on the project. **The description and the credentials were assumed to match.** They did not, and nothing was run that could have told the difference, because the check that was run was the wrong check: per D20 the account was queried for hosted zones, distributions, tables, buckets, certificates and functions, found empty, and that emptiness was then silently read as identity. **An empty account and a management account look identical to `aws sts get-caller-identity`, which returns an id and no name.**

**What it cost, listed rather than summarised, because the list is the argument for the check.**

- **A week of not deploying into an account that was correct the whole time.** The environment applied on Thursday 27 August 2026 could have applied on Wednesday 19 August, subject only to the IAM permission that was genuinely outstanding.
- **Advice to the client to create an account that already existed.** D24's supervised screen share was scoped on Tuesday 25 August 2026 around creating a Development account together. The account had existed since before we held credentials for it.
- **A commitment in writing to a cleanup that was never needed.** The 25 August message told Dan the state bucket sat on his main account and would be moved off it and the remainder deleted. **`trevean-tfstate-<TREVEAN_ACCOUNT_ID>` was in the right account, holding the right state, the whole time.** Moving it would have been work done to satisfy a mistaken premise, on a client's estate, with a message explaining why.
- **A guard whose documentation pointed the wrong way.** `envs/dev/terraform.tfvars.example` told the reader that the development account's ID must never be used. Followed literally, that instruction stops someone deploying into the only correct place.

**What would have caught it, and it is one command.** `aws organizations describe-organization`, or `aws iam list-account-aliases`, at the moment the credentials were first exercised. Either one names the account. **A resource inventory is not an identity check**, and the two were conflated because emptiness was the thing being looked for and the account happened to be empty.

**Why this is in the decision log rather than only corrected in place.** The correction itself is a fact and needs no reasoning. **The failure mode does.** This is the third time on this engagement that a confident description has stood in for a verified one, after the NTAG21x chip family assumption and the 4 mm lid, and all three had the same shape: a plausible statement was adopted without the cheap check that would have tested it. **The standing rule this entry sets is that an account is identified by name before anything is created in it, and the identity check goes in the record next to the inventory check.**

**What does not change, stated because a correction is an easy place to over-reach.** The `expected_account_id` guard stays, stays required, and keeps having no default. **It was never the guard that was wrong, only the id the examples told you to fear.** Staging still belongs in a Serene Labs account and production still belongs in Trevean's production account, and neither of those is the development account. D25 still stands on its own reasoning: the five tag routes are served from Vercel because the thousand encoded jars are the part that cannot be changed later, not because AWS was unavailable.

**Where the correction lands.** "The deployed development environment", section 1, is the record of the account fact and the deployment that followed it. R3 and D24 are corrected in place. The client was told on Thursday 27 August 2026, in the merged reply, and it led that message rather than sitting inside it.

---

## D31 · 27 Aug · PROPOSED, NOT DECIDED: the gate blend set drops to Caribbean Sunset alone, or to Caribbean Sunset plus an unnamed second blend

**This entry records a proposal. It is in the decision log because it will be a decision, and it is marked as not one so that nobody later reads its presence here as adoption.**

**What triggered it.** Two facts landing in the same message on Thursday 27 August 2026. The blend production specification records **Caribbean Sunset as the only one of the five blends carrying no sourcing exposure at all**. And the same document establishes that **Persian Sunrise's printed provenance is no longer true of its contents** (D29), so the one page whose purpose is provenance cannot be written until Trevean decides what it says instead (R21, Q26).

**Dan, 27 August: "We should switch to solely Caribbean Sunset as the safer origin. Our target is investor demo, not retail sales immediately... Let's focus on Caribbean Sunset and possibly another blend. (stand by on the second blend)".**

**Status: PROPOSED. Not agreed, not adopted, and nothing has moved onto a one blend basis.**

**Why it is not simply accepted, which is the whole reason this entry exists.** **SOW Rev C section 5 requires section 6.1 met on Persian Sunrise AND Caribbean Sunset.** Dropping to one blend, or to one plus a blend nobody has named, **is a change to a contractual acceptance criterion.** It is the same class of thing as the section 5 wording change we ourselves proposed at R9 and Q5, and it goes the same way: **agreed in writing, or not at all.** Substituting a blend on the day, or letting a preference expressed in a message quietly become the criterion, is precisely the failure mode this project's contract exists to prevent. **It would also be us grading our own homework on the criterion gating [removed: fees and payments]**, which is what D7 was written to stop.

**The proposal is well founded, and that is a separate finding from whether it is agreed.** Recorded plainly, because raising the contractual point should not read as resistance to the substance:

- **Caribbean Sunset genuinely is the clean blend.** The specification's sourcing section clears every one of its origins: Jamaican or Guatemalan allspice, Grenadian or Indonesian nutmeg, Mediterranean thyme, Seville bitter orange, Caribbean scotch bonnet, with habanero approved as an in-family substitute. None of the other four is clear.
- **The stated purpose supports it.** An investor demo rather than immediate retail sale is a different risk posture, and it is Dan's posture to set.
- **The alternative is worse.** The other route is a Persian Sunrise gate run against a page with its origin, grower and coordinate fields unpublished, which measures the tap path on a visibly thinner page.

**Two consequences that have to be settled with it rather than after it.**

- **The second blend is named or explicitly dropped.** Dan said stand by, so the proposed set is currently **one blend plus an unknown**, which is not a set anything can be measured against and not a set a tester's week can be booked against. Q28.
- **The tap count moves and the tester's booking moves with it.** On the confirmed full eight handset matrix, **560 taps at two blends against 400 at one.** **Adjacent-jar isolation is the term that does not halve**, because section 6.1 defines it on two jars of different blends, so **a one blend gate still needs a second physically distinct encoded blend on the bench.** Anyone reading "solely Caribbean Sunset" as meaning one jar has misread it. The arithmetic is at "Milestones and dates", section "Two things about the M2 gate that are bigger than they look".

**What happens next, and it is small.** The proposal goes back to Dan as a stated replacement for section 5 that he either agrees in writing or withdraws, with the second blend named or dropped in the same answer. **Until then every document says Persian Sunrise and Caribbean Sunset**, because that is what the contract says.

---

## D30 · 27 Aug · The gate is the full eight handset matrix, two full days. Q6 and Q9 close together

**What triggered it.** Q6 was asked on Friday 7 August 2026 and carried a hard date of Friday 21 August 2026 so a tester could be named and their week booked. **It missed, and it was one of the five dependencies that floated the M2 gate day for day** (D22). Q9, which phones would actually be in the demo room, was asked on Wednesday 19 August and had been pending while Dan pulled the list from the retest. **The two answers always belonged together**, because a matrix that omits the demo phone is worthless and a demo phone list that is not the matrix is a surprise in gate week.

**Dan, 27 August: the full eight handset matrix, two full days of testing.**

**Decision: the M2 gate runs across the full eight handset matrix. The four handset subset offered on Friday 7 August is declined and is not held as a fallback. The iPhone 8 is not tested.**

| Handset | OS |
|---|---|
| iPhone XS | iOS 18.6 |
| iPhone 13 | iOS 18.6 |
| iPhone 15 Pro | iOS 18.6 |
| iPhone 16 Pro | iOS 18.6 |
| Google Pixel 6 | Android 15 |
| Google Pixel 8 Pro | Android 15 |
| Samsung Galaxy S23 | Android 15, One UI 7 |
| Samsung Galaxy S24 Ultra | Android 15, One UI 7 |

**Three things this settles, and one it does not.**

- **It closes Q6.** The scope question in front of the acceptance run is answered, and **this is the first of the five dependencies to land since they all missed on Friday 21 August**, four working days late.
- **It closes Q9 on the same answer.** The confirmed list is also the answer to which phones exist to be in the demo room. **The eight are the same eight that produced the 6 August bench data**, so no measured figure anywhere in the record is re-based by it.
- **The iPhone 8 not being tested is consistent rather than an omission.** It produced 0/30 in every state on 6 August and reads only with an NFC app opened manually, so it has been the unsupported control since the bench run. **Confirming it stays out removes the one way this list could have quietly grown to nine.**
- **What it does not do is name a tester or produce a jar**, so **the acceptance run is still undated** and D27's separation stands untouched. A scope answer books nothing.

**Note the direction the tolerance moved, because only half of it is obvious.** The subset was the **tighter** threshold, not the looser one: two failures pass under the subset where four pass under the full matrix, as recorded at R10. **So the answer enlarges the run and relaxes the per-run tolerance at the same time.** It is the more expensive answer in tester hours and the more forgiving one in arithmetic, and Dan chose it knowing the first half.

**The tap count is now derivable, and it is written out as arithmetic rather than carried over as a number**, because two different figures for this run have appeared in the record and because the count also moves with the blend set proposed the same day (D31). **560 taps as section 5 stands today at two blends, 400 if the one blend set is agreed, against 280 under the declined subset.** The inputs and the working are at "Milestones and dates", section "Two things about the M2 gate that are bigger than they look".

---

## D29 · 27 Aug · The blend production specification is the authoritative source for composition. Our record was wrong about Persian Sunrise, and the printed label no longer describes what is in the jar

**What triggered it.** Dan supplied the **blend production specification v1.2 on Thursday 27 August 2026**, dated Monday 22 June 2026, superseding v1.1 of the same date and v1.0 of 10 February 2025. It is his own manufacturing document: weights, percentages, tolerances, mesh specifications and mixing procedures for all five blends, not a marketing artefact. It arrived to answer Q27, which had opened that morning on a printed label that disagreed with this knowledge base.

**Decision: the production specification is the authoritative source for blend composition, ahead of both the Scope document and the printed label.**

**Q27 is answered and our record was the wrong half.** The label was right, and it was right by more than one ingredient.

| Ingredient | Weight | Percentage |
|---|---|---|
| Ceylon cinnamon (*Cinnamomum verum*) | 250 g | 50% |
| Green cardamom seeds, decorticated | 125 g | 25% |
| Ground Omani dried lime (limoo Omani) | 100 g | 20% |
| Dried rose petals, culinary grade | 24.5 g | 4.9% |
| Saffron threads, Spanish preferred, Afghan acceptable | 0.5 g | 0.1% |

**The Scope document recorded "saffron, cardamom, rose petals, lime". It omitted cinnamon, which is half the blend by weight, and it led with saffron, which is one part in a thousand.** Owned in one sentence and corrected: a page built on that list would have opened with the ingredient the customer gets least of and never named the one they mostly taste. **The proof hypothesis in Q27 is retired**, since the composition is corroborated by the client's own manufacturing document and Dan speaks of the labels as printed stock that stays for this run.

**The harvest date is released with it. April 2026 is confirmed and usable**, which matters because a **fabricated** harvest date of 12 May 2026 was removed from the API seed on Saturday 22 August 2026 for inventing a fact about a real supply chain. **This one is real, and it comes from the client's own document rather than from us.**

### The finding that matters more than the composition

**The blend contains no Iranian ingredients and has not since June 2026. The printed label describes the product as it was before that.**

Legal and export notes for this blend are kept in a private record held by Trevean.

**So the printed label names a grower and a set of coordinates in the Kashan area of Iran, on a jar whose saffron is Spanish, whose cinnamon is Ceylonese and whose lime is Omani.**

**Why this is a build finding and not only a packaging one.** This product exists to answer one question for a customer holding a jar: where did this come from. The tap opens a page headed by origin and grower. **The blend page must not repeat the label's provenance, because it is not true of what is in the jar, and this is the one page whose entire purpose is provenance.** A named farmer and a set of coordinates, next to a freshness timeline and a grower profile, on a page reached by tapping that jar, is a provenance claim made on the exact surface built to carry provenance. **That is a different and worse thing than an out of date label, because the page is the product.**

**What Dan has decided: the labels stay for this run, and it will be addressed "with a specific mention on the website".** **What that mention says is needed before the page can carry anything about Persian Sunrise's origin**, and it is his to write. **Until it exists, the origin, grower and coordinate fields for Persian Sunrise stay unpublished rather than being filled with a best guess.**

**No view is offered here on the label or on what the website should say.** Legal and export notes for this blend are kept in a private record held by Trevean. The finding is narrow: **the page cannot assert an origin the product does not have, and the page cannot be written until someone decides what it does assert.** R21 and Q26.

### What else the specification settles

**The other four blends, corrected where the specification speaks and left where it does not.** What has been read for those four is the specification's sourcing section, which names ingredients and origin constraints where there is geopolitical exposure. **It is not a complete ingredient list, so silence there is not a contradiction of our record.** Where it speaks, it governs, and it contradicted us three times: **Caribbean Sunset** carries nutmeg and Seville bitter orange, which we did not list, and its ingredient origins span several countries rather than the single "Trinidad and Tobago" we recorded · **The Silk Road** has Sichuan peppercorn as its defining ingredient with Nepali timur as an approved in-family alternate, and we named neither · **Kyoto Garden** carries shiitake, which we omitted, and we carried yuzu, which the specification does not name. Corrections are at "Scope", section "The five blends".

**Caribbean Sunset is the only one of the five carrying no sourcing exposure at all**, which is the fact behind the blend set change proposed the same day (D31).

**Two build facts that replace guesses.** Finished product storage has a **maximum of six months** at 18 to 20 degrees and 45 to 55 percent relative humidity, protected from light. **That is six months from the production date, which is a different field from the April 2026 harvest and is not yet known to us**, so a best before date is now derivable rather than invented. And **section 7.2 specifies labelling requirements**, product name, batch number, production date, best before date, storage instructions and allergen information, which the blend page is checked against rather than only the pack.

---

## D28 · 27 Aug · The field beacon emits the frozen contract's ScanEventInput itself, and the local stand-in validates against it

**What triggered it.** An adversarial review of the M2 build on the afternoon of Thursday 27 August 2026 found that the built blend page carries `data-scan-endpoint="/v1/scan-events"` and hands that endpoint to the vendored measurement harness field beacon, which posts its own `trevean-field-beacon/1` record. That body was replayed against the real API before anything was changed. **Observed: 400 `VALIDATION_FAILED` with 44 validation details.** The four required fields were all missing (`blendSlug`, `channel`, `dedupToken`, `occurredAt`), 38 fields were unknown to a schema that sets `additionalProperties: false`, and one of the unknown fields was `userAgent`, which the frozen API contract, section 8.3, names among the things the beacon must not send. **In production every customer tap would have been rejected, the scan count would have been zero, and nothing in any dashboard would have said so.**

**Why it survived until an adversarial review.** The local edge stand-in accepted any JSON it could parse, logged a friendly line and answered 202. It passed locally on every run. A local server more permissive than production does not save anybody time, it converts a loud failure into a silent one.

**Decision: the field beacon emits `ScanEventInput`, produced by a projection of its own measurement that lives inside the harness, and the stand-in server refuses anything the real API would refuse.**

**The constraint that decided it.** The Architecture document, "Measurement", commits to one instrument: the same code records the bench runs, the gate, the September matrix and every customer tap, so the number accepted in August is measured the same way as the number reviewed in December. The field beacon is therefore the production beacon, not a test tool that strayed onto a page. Three shapes were available and the choice was between them, not between fixing and not fixing.

- **Rejected: the page maps the harness output before sending.** It keeps the harness untouched, and that is its only merit. The mapping is a statement about what the measurement means, so putting it on the page creates a second definition of the measurement outside the instrument, outside the harness self test, and one that every repository adopting the beacon has to write again. The failure mode of writing it wrong is the defect being fixed here: silent zero data.
- **Rejected: the contract accepts the harness shape.** It is a breaking change to a document frozen on Wednesday 19 August 2026 [removed: Serene Labs internal], it would need change control under section 11 and Dan's approval because it costs schedule, and it would put `userAgent` on the wire, which section 8.3 forbids and which `additionalProperties: false` exists to prevent.
- **Taken: the instrument speaks the contract.** One instrument, one measurement, one place where the wire format is defined, and it travels with the beacon into any repository the beacon is copied into.

**What was deliberately not changed, because this is the part that could have gone wrong.** The `trevean-field-beacon/1` record is untouched. It is what the gate analysis reads, what the self test replays and what carries the fields the acceptance report prints, `readableSource`, `largestContentfulPaintMs`, `repeatWithinWindow` and `geolocationRequested`, none of which exist in the contract and none of which should. The record and the request body are two documents describing one measurement, and the second is derived from the first rather than measured separately. **The harness self test passes unchanged: 229 records replayed, the published bench figures reproduced.**

**Two smaller things fell out of it and both were real.** The dedup token was a hyphenated UUID, which is the right 128 bits in a notation the contract's `^[0-9a-f]{32}$` rejects, so it now generates in the accepted form and a token already in a customer's browser is normalised deterministically rather than becoming a 400 on every tap from that browser. And the mapping is where the full user agent string is read for platform classification and then dropped, so it is the privacy boundary rather than a rename.

**The check that would have caught it now exists.** The stand-in validates against a transcription of the frozen schema, `npm run verify` posts both a contract body and the old harness body and asserts 202 and 400, and it separately asserts that a body carrying `userAgent` is refused. **Observed after the fix, against the real API rather than the stand-in: 202 on the NFC path and 202 on the QR path, both stored, both carrying the same browser side dedup token, and a repeated tap deduplicated to one row while still answering 202.**

---

## D27 · 27 Aug · The M2 date is held at Friday 28 August 2026. The day for day slip is withdrawn and absorbed on our side, and the acceptance run is booked separately

**What triggered it.** The day for day rule had been running since Friday 21 August 2026, when five client dependencies missed their date (D22). Three landing rows had been spent, Monday 31 August 2026 had gone from floor to history, and the earliest reachable value had drifted to Thursday 3 September 2026. **Every day of that drift came out of the M3 window rather than out of M3's date**, because the M3 window starts the working day after the gate and ends on Friday 11 September 2026 whatever the gate does. By Thursday 27 August the M3 arithmetic had gone from slack to a shortfall [removed: Serene Labs internal], on a milestone nobody had proposed re-dating. **A rule that protects one date by quietly consuming the next one is doing something other than what it was written to do.**

**Decision: the M2 date is held at Friday 28 August 2026. The day for day slip that had been running from Friday 21 August 2026 is withdrawn. The compression is absorbed on our side in extra hours rather than passed to the client as a moved date.**

**The separation this decision rests on, and it is the whole of it. Read both halves or neither.**

- **Our delivery holds at Friday 28 August 2026.** The build work is ours. The residual after the audit [removed: Serene Labs internal] sits in a window we control, and extra hours can and will absorb it. **That is a commitment we can keep by working, which is the only kind worth making.**
- **The acceptance run is a separate thing and extra hours cannot produce it.** Under D7, Trevean staff perform the physical taps, on Trevean materials, at Trevean's facility. It needs a named tester with one to two full days booked, the gate scope answered under Q6, full eight handset matrix or the four handset subset, and physical materials including jars and interim lids at 8 mm or thicker with tags fitted. **None of those exists on Thursday 27 August 2026, and no amount of effort on our side creates any of them.**
- **So the honest record is: our delivery holds at Friday 28 August 2026, and the acceptance run is booked the day the tester and the materials exist.** **It must never be written as "the gate holds on 28 August"**, because that sentence claims something about another company's staff and another company's jars that we are in no position to promise. Anyone who writes it has collapsed two things this entry exists to keep apart.

**The day for day rule is reset, not abandoned.** From Thursday 27 August 2026, any further delay on the outstanding client items moves the date day for day, and it goes in writing on the day it is known, exactly as it did before. **What changes is the anchor: the rule now runs forward from Thursday 27 August 2026 rather than from Friday 21 August 2026.** The four working days between those two anchors are absorbed, once, on our side. Nothing about the rule itself is softened, and a document quoting Friday 21 August 2026 as the live anchor is out of date rather than stricter.

**The absorbed time is real and it is ours, which is what makes this defensible rather than generous.** It is not slack that turned out to exist and it is not a re-estimate. It is extra hours worked against a window that was already counted, and the arithmetic that named the cost is at "M2 plan: our delivery holds at Friday 28 August 2026", section 1.1, unchanged.

**This is the second absorption, and there is no third one available.** The first was M1 moving from Friday 14 to Tuesday 18 August 2026 when access landed two days late: the compression was taken on our side and the gate was held rather than moved. This is the second. **After this there is nothing left to absorb with**, and the next client slip moves the date rather than being taken quietly. [removed: Serene Labs internal] Note that the audit compression of Wednesday 19 August 2026 was paid out of scope, through de-scope rungs 1 and 2, rather than out of a date (D19), so it is a different kind of payment and is not counted as one of the two.

**What it does to M3, and it is the reason the decision is worth taking rather than merely kind.** Holding the date at Friday 28 August 2026 restores the M3 window the slip had been eating. M3 runs Monday 31 August to Friday 11 September 2026, **nine working days rather than ten because Monday 7 September 2026 is Labor Day, [removed: Serene Labs internal].** ~~[removed: Serene Labs internal], which is exactly where it stood before Friday 21 August.~~ **The demand figure and the slack and overrun drawn from it are WITHDRAWN by D35 of Friday 4 September 2026, being arithmetic derived from this same window rather than an estimate of M3's work. The window restoration itself stands and is the part of this decision that mattered.** **The shortfall at a Monday 31 August gate, and the shortfall at Thursday 3 September, [removed: Serene Labs internal], are both superseded and must not be quoted.** M3 is not re-dated and stays **Friday 11 September 2026.**

**One consequence on the de-scope ladder, stated so it is not assumed either way.** Rung 3, the three non-launch blends staying as seeded shells, moved from held in reserve to expected on Saturday 22 August 2026 **because the shortened M3 window no longer closed on rungs 1 and 2 alone.** That trigger is no longer firing, so **rung 3 returns to held in reserve** and is confirmed on the gate day with the real window counted. Rungs 1 and 2 are unchanged: rung 1 is taken and rung 2 is still expected, because the pessimistic end still overruns [removed: Serene Labs internal] and that is what they were taken to pay for.

**Sunday 27 September 2026 is unaffected**, with four weeks and two days behind Friday 28 August 2026. That is the margin the date was set with in the first place, and holding the date is what keeps it.

**What this decision does not do, because the temptation with a recovered date is to read recovery into everything near it.** It does not land any of the five dependencies, all five of which are outstanding. It does not schedule the acceptance run, which cannot be scheduled by us. It does not close R1, R6, R10 or R19. It does not reverse rungs 1 or 2. And **it is not the audit re-baseline being unwound**, because that re-baseline was overruled on Wednesday 19 August 2026 and stays overruled (D19): this entry holds a date that decision already held, by a different route and for a different reason.

---

## D26 · 27 Aug · The DNS zone is captured, verified and sufficient. SOA and nameserver records are host managed and are not a gap

**What triggered it.** Dan captured a DNS record inventory as a CSV on **Wednesday 26 August 2026**, the date stated inside the file, and **it reached us on Thursday 27 August 2026**, with a note explaining how it was captured, **because Bluehost's own zone export tool failed twice and he had to capture it by hand.** He flagged one thing himself: **the inventory contains no SOA record and no authoritative nameserver records, because he could not find them.** He asked whether that mattered.

**What was verified, and it was verified rather than accepted.** The inventory was checked against live DNS by direct query on **Thursday 27 August 2026, the day it reached us and one day after Dan captured it.** **It matches exactly.** Apex A `50.6.2.51` · `www` CNAME to the apex · MX to `smtp.google.com` at priority 1 · SPF `v=spf1 include:_spf.google.com ~all` · a Google DKIM selector at `google._domainkey` · DMARC `v=DMARC1; p=none`. **A hand-captured inventory is a weaker evidence class than a machine export and it was treated as one until it was checked. Having been checked, it is accurate.**

**Decision: this inventory is the zone of record for `treveanspice.com`, and it is sufficient as it stands. The absent SOA and NS records are not a gap and no further export is asked of Dan.**

**Why, stated so nobody re-opens it.** **SOA and NS are managed by the DNS host rather than authored by the zone owner.** They are visible publicly, `ns1.bluehost.com` and `ns2.bluehost.com`, and **they are not records anybody restores by hand**: a zone created at a host is issued its own, and hand-transcribing a serial number and a refresh interval from one provider into another would be copying a value that the new provider immediately overwrites. **What actually had to survive the rebuild was everything owner-authored, and all of it did.** That was the real fear on Monday 24 August, when the zone was gone: records reconstructed from memory, failing quietly for weeks. **It did not happen, and this entry is what closes that concern rather than leaving it as an unstated relief.**

**Two things noted as tidy-up rather than as risk, because the distinction is the point.**

- **A leftover `default._domainkey` DKIM record from Bluehost's own mail system**, unrelated to the Google selector that is actually in use. It is harmless. It is worth removing when someone is in the console anyway, and it is not worth a change window of its own.
- **The DMARC record carries no reporting address.** `p=none` with no `rua` is monitoring mode with nobody receiving the reports, so it monitors nothing. **A small improvement available to Trevean, not urgent, and not ours to change unasked.** It is Dan's zone and his mail.

**Probed and absent, recorded so an absence is not later mistaken for a deletion.** No `_vercel`, `_shopify`, `_domainconnect` or `_acme-challenge` TXT records, and no CAA records. **None of that is a loss.** **The absent `_vercel` record is a step still to take rather than something destroyed**, and it is part of pointing the apex at the deployment (R1, and D25). **Absent CAA means any certificate authority may issue, which is what we want** while the certificate for this domain is still to be issued by a provider that is itself still being pointed at.

**What this does not do.** It does not close R1. The zone being correct and the zone serving the tag routes are different things: **the apex still answers from Bluehost hosting rather than from the Vercel deployment**, so a thousand encoded jars still reach an error page. **And it does not answer whether Bluehost's DNS supports the HTTPS (SVCB) record type**, which is worth 150 ms on the tap path and is tracked at R20. Nothing in the supplied inventory speaks to that either way, and it is not inferred from an absence.

---

## D25 · 25 Aug · The five tag routes are served from Vercel now, and AWS leaves the critical path for anything a customer touches

> **CORRECTED on Thursday 27 August 2026 by D32, on one of its three triggering facts. The decision stands and is not reopened.** The second fact below, that no AWS Development account exists, was wrong: the account this project holds credentials for (ID in Trevean's private record) is `Trevean-NFC-Development` and it existed throughout. **The decision does not depend on it.** Serving the tag routes from Vercel was and is the fastest route to working jars on the real domain, because it needs no certificate and no nameserver change, and the encoded jars remain the part that cannot be changed later. **What the correction removes is an argument that made the decision look more forced than it was**, not the decision.

**What triggered it.** Three facts sitting next to each other on Tuesday 25 August 2026. The marketing site is live and working on Vercel, **verified by direct query rather than taken on report**, healthy at `https://trevean-spice-website.vercel.app/`. ~~The AWS Development account does not exist yet and its creation is now scheduled rather than done (D24).~~ **That second fact was wrong: see the note above and D32.** And **the thousand encoded jars already in the field are the only part of this engagement that cannot be changed later.** Holding inventory behind an account that has not been created is the wrong trade in that ordering.

**The recommendation went to Dan on Tuesday 25 August and he approved it the same day, in his own words: "so the existing jars can work without waiting for the AWS environment."**

**Decision: the apex and the five `/t/{code}` routes are served from Vercel now. The blend story pages follow to the same origin.**

**This is not a reversal of D10 and it must not be read as one.** D10 decided that the redirect is unavoidable and that it is served **at the CDN edge rather than from an origin**, because origin-served costs a full round trip plus a table lookup while edge-served costs one hop and never touches a server. **Vercel answers redirects from its own edge, so the property D10 bought is preserved intact. What changes is which edge, not whether there is one.** D10's second half is untouched: the redirect table stays in version control, deployed with the application, and is published to Vercel rather than hand-edited in a hosting console.

**What it supersedes, and only for now.** The M1 redirect-serving deliverable decided that CloudFront owns the apex and `/t/` is served by a CloudFront Function at the edge. **That is superseded for now rather than abandoned.** Moving back is a DNS change plus a function, not a rebuild, precisely because the table is version-controlled rather than console state. Recorded so nobody reads a later CloudFront document as current, and so nobody treats the move back as a re-architecture when it arrives.

**What it does to the M2 critical path, which is the point of the decision.** The tap path becomes DNS, the Vercel edge, and a statically generated page. **No API call, no database read, no function of ours** (D2). So **the AWS environment leaves the critical path for everything a customer touches**, and the R3 IAM permission stops gating the M2 gate. It keeps gating M5, which accepts on "deployed on Trevean AWS", and the API, admin CMS and analytics from M3 onward. **The AWS work stops being late and becomes work with no deadline pressing on it**, which is a better condition to build infrastructure in than the one it was in last week.

**What it does not do, stated plainly because it is easy to overclaim.** It does not close the DNS dependency and it does not make a single jar work today. **Verified by direct query on Tuesday 25 August: the apex returns HTTP 403 and `/t/ps` returns HTTP 500**, because the domain resolves to Bluehost at `50.6.2.51` rather than to the Vercel deployment. **The encoded jars now reach an error page rather than nothing at all. That is a different failure and not a fixed one**, and the apex still has to be pointed at Vercel. R1.

**One thing to re-check rather than assume.** D17 made a DNS HTTPS (SVCB) record advertising `alpn="h3"` mandatory, worth 150 ms on the tap path, and D16 unblocked it on the reasoning that Route 53 supports the record type. **The zone is authoritative at Bluehost, not Route 53.** Whether Bluehost's DNS supports the HTTPS record type is unknown and is not assumed in either direction here. Tracked at R20.

**One thing this makes more important rather than less.** D17 optimisation 3, the same-origin relative 307 target, holds under this decision because the redirect and the page it points at are on one origin. **A cross-origin target repeats DNS and the handshake at plus 450 ms and the budget fails**, so the constraint is worth more now that the origin is a live variable than it was when it was written as a hedge against a future hosting change.

---

## D24 · 25 Aug · AWS access arrives as a supervised fifteen minute screen share. Not root, and not another asynchronous grant

> **CORRECTED on Thursday 27 August 2026 by D32, on the account facts and on nothing else.** This entry was written believing that the account this project holds credentials for (ID in Trevean's private record) is the Organization management account and that a Development account did not exist. **Both are wrong.** That account is `Trevean-NFC-Development`, the development account; the management account is `[account id withheld]`. **So there was no account to create, the state bucket was never in the wrong place, and the tidy-up committed below was never owed.** The two paragraphs affected are marked in place rather than deleted. **The decision itself stands unchanged:** access arrives supervised, root is declined, and the permission is the thing the session is for.

**What triggered it.** The AWS ask had been reduced as far as it goes: **one assignment in Identity Center, about thirty seconds of Dan's time**, requesting AdministratorAccess so that the role-creation constraint never has to be explained to a client who says AWS confuses him. It was offered three ways on Tuesday 25 August: the one-click assignment, a two-step version if he would rather we never touched the main account even briefly, and fifteen minutes on a screen share. **Dan had separately raised root access, and it was declined before he chose.**

**Dan, 25 August: he has chosen the fifteen minute screen share, to create the Development account and grant temporary access together, and he has asked for available times.**

**Decision: AWS access arrives in a supervised screen share with Dan present. Root is declined and stays declined.**

**Why root was declined, recorded rather than left implicit.** For root to be usable at all, Dan would have had to create root access keys and share his MFA device. **Those are the two protections he had deliberately switched on.** It is the one option on the list that is more work for him rather than less. [removed: Serene Labs internal] **Declining an offered escalation is the same discipline as D7**: not taking control of something the client should keep, on a project where the contractor already grades less of its own homework than is normal.

**Why the screen share is the right shape rather than the slow one.** The permission has been outstanding since Wednesday 19 August and every attempt to move it asynchronously has cost working days rather than minutes. **A screen share collapses two round trips, account creation and permission grant, into one session**, and it is Dan's own suggestion in his own preferred format. **The dependency stops being permission bound and becomes scheduling bound.** That is a materially better class of blocker: a calendar slot is inside both parties' control, and Bluehost's turnaround was not (D16).

**What we owe, and it is small and immediate: available times, sent the same day.** A client who has just chosen the fastest of three routes should not then wait on us for the slot.

**Two things to confirm on the call rather than assume, because both have a build consequence.** First, **whether the Development account is a new account separate from the account this project holds credentials for.** ~~Our reading is that it is: that account is the management account, it is where the login Dan sent us lands, and it is where the groundwork was done. If it is new, the saved Terraform plan of 140 resources and the state bucket `trevean-tfstate-<TREVEAN_ACCOUNT_ID>` were both made against the management account and both move.~~ **ANSWERED AND ANSWERED THE OTHER WAY, Thursday 27 August 2026, D32. That account IS the Development account, `Trevean-NFC-Development`. It is not new, it did not need creating, and neither the plan nor the state bucket moves.** The instinct to confirm rather than assume was right. **It was written down as a thing to confirm on a call, four days after one command would have answered it.** Second, that the temporary access is genuinely temporary and we say when to take it back off, which was offered in writing and should be held to. **That half is unaffected and still holds.**

**One tidy-up owed either way, and it is ours.** ~~The state bucket sits in the management account, which is the wrong home under the structure Dan has built. Once the Development account exists it moves, what is left in the management account is deleted, and Dan gets the list so nothing sits there unexplained.~~ **WITHDRAWN, Thursday 27 August 2026, D32. Nothing is owed, because nothing is misplaced.** `trevean-tfstate-<TREVEAN_ACCOUNT_ID>` sits in the development account, which is its correct home, and the development environment was applied through it on Thursday 27 August. **The commitment was made in writing to Dan on 25 August on a false premise, so the correction was owed to him instead, and it went the same week.**

**What this does not change: it does not put AWS back on the M2 critical path.** Per D25, the customer-facing path is served from Vercel. This decision is about M5, the API, the admin and the analytics, not about whether a jar resolves.

---

## D23 · 25 Aug · The product range is five blends. The sixth listing on the marketing site is not a product

**What triggered it.** The client's live marketing site was read on Tuesday 25 August as a content source, since it already carries named growers and farm coordinates and that is genuinely useful. **It lists six blends.** Against that: four codes encoded on physical tags, a fifth reserved for Kyoto Garden and never encoded, and five blends in the plan and in the scope document. **Asked plainly rather than reconciled by guessing.**

**Dan, 25 August: five blends, confirmed. The sixth listing is not a product.**

**Decision: the product range is five, the slug set is closed at five, and the sixth listing is marketing copy rather than a SKU.**

**Why it was worth a question rather than an assumption.** The slug enum is closed to five in the frozen interface delivered at M1. **Opening it is a breaking change to the API contract and a schedule event, not a content edit**, and it is far cheaper to know in August than in September. A sixth product would additionally have had no tag at all in this run, so it would have needed either a tag order with its own lead time or an explicit out-of-scope statement, and neither is a thing to discover in gate week.

**What it does not settle.** Whether a sixth blend is ever expected in a later phase. That is Q20 shaped, it is deliberately deferred, and **the seam is cheap to leave now and expensive to retrofit**, which is the same reasoning as D6 and D3.

**What does not follow from it.** Nothing gets copied out of the live marketing site into the content fixtures on the strength of this answer. **The other content question that the same site read raised is not answered and got worse the same day:** the Persian Sunrise origin, Kashan or Isfahan, which is now more than a records lookup. Legal and export notes for this blend are kept in a private record held by Trevean. See "Open questions", Q26, and "Risks and dependencies", R21.

---

## D22 · 22 Aug · Five client dependencies missed Friday 21 August, so the M2 gate moves day for day. The demo does not move

> **SUPERSEDED on Thursday 27 August 2026 by D27, on the date and on the anchor only.** The day for day slip recorded below is **withdrawn**: the M2 date is held at **Friday 28 August 2026** and the compression is absorbed on our side. **The landing table below, Monday 31 August 2026 as the floor, and every value derived from it are historical and must not be quoted as live.** The rule itself survives and now runs forward from **Thursday 27 August 2026**. **Everything else in this entry stands**, including that all five dependencies missed, that the demo does not move, and that the notice went a day late. It is preserved in full so nobody re-derives the old dates from the reasoning and assumes they were adopted.

**What triggered it.** Five dependencies carried a hard date of **Friday 21 August 2026** and all five missed. They are listed with their consequence rather than as a list of names, because the consequence is what the date arithmetic rests on:

1. **IAM role creation on the AWS principal.** Nothing has been applied to the development account (ID in Trevean's private record). The Terraform plan is saved and ready, 140 resources of which 24 are IAM, remote state exists, and no certificate, distribution or staging host was created.
2. **Bluehost's nameserver target for `treveanspice.com`.** The domain has not moved, the Thursday 20 August flip did not happen, R1 has not closed, and the 307 hop still cannot be measured on our own stack.
3. **Real content for Persian Sunrise and Caribbean Sunset.** The build would freeze on Monday 24 August on the placeholder set.
4. **The gate scope decision, Q6**, full eight handset matrix or the four handset subset.
5. **A named tester with two full days booked in the week of Monday 24 August, and the physical materials**: jars, 8 mm lids with tags fitted, one case per handset, all eight handsets.

**Also outstanding and unanswered: the photograph of a printed label.** It decides what happens to the on pack QR codes at DNS cutover, and QR parity is a scored criterion at the gate (R19, Q24).

**The state of the conversation, stated plainly rather than characterised.** Dan last replied on **Wednesday 19 August 2026 at 10:12 AM** with eight answers. A follow up went on **Thursday 20 August 2026 at 12:47 PM** and is unanswered, through Thursday 20, Friday 21 and Saturday 22 August. He told us on Thursday 13 August that he expects delays and is fine "as long as we get it right at the end", and several of these five route through third parties he does not control. **This is a schedule fact being recorded, not a grievance.**

**Decision: the M2 gate moves day for day from Friday 21 August 2026.** It was Friday 28 August 2026. **The new date is conditional on when the dependencies land and is not a fixed date.**

| Dependencies land | M2 gate becomes |
|---|---|
| Monday 24 August 2026 | **Monday 31 August 2026**, the best case |
| Tuesday 25 August 2026 | Tuesday 1 September 2026 |
| Wednesday 26 August 2026 | Wednesday 2 September 2026 |
| Thursday 27 August 2026 | Thursday 3 September 2026 |
| Friday 28 August 2026 | Friday 4 September 2026 |

Each further working day of silence moves the gate one further working day. Nothing in the rule accelerates and nothing in it compounds.

**Sunday 27 September 2026 is not at risk, and this is not to be overstated into a crisis.** The gate was deliberately set four weeks and two days ahead of the demo so there was room for exactly this. The best case leaves three weeks and six days of margin. A full week of slip, gate on Friday 4 September, still leaves three weeks and two days. **Nothing about the demo is at risk today**, and any document or message that says otherwise is wrong.

**This is not the audit re-baseline, and it must not be read as one.** A re-baseline moving M2 to Friday 4 September and M3 to Friday 18 September was drafted on the strength of the audit findings on Wednesday 19 August and **overruled the same day** (D19). That decision stands: the audit did not move the gate and does not move it now. **What moves the gate here is the standing day for day rule operating exactly as written and as communicated to Dan three times.** If the dependencies had landed on Friday 21 August the gate would still be Friday 28 August. The two must not be conflated, because arriving at a similar date by a different route is how a settled question gets re-opened.

**M3, M4 and M5 are not re-dated by this entry. M3 is not unaffected by it either, and the arithmetic is written out rather than left as a thing to watch.** The M3 window starts the working day after the gate and ends on Friday 11 September 2026, **so the gate moving shortens the window rather than moving it.** It was nine working days rather than ten because Monday 7 September 2026 is Labor Day.

| Gate lands | M3 window | Working days |
|---|---|---|
| Fri 28 Aug 2026, as planned | Mon 31 Aug to Fri 11 Sep | 9 |
| **Mon 31 Aug 2026, the best case** | Tue 1 Sep to Fri 11 Sep | **8** |
| Wed 2 Sep 2026 | Thu 3 Sep to Fri 11 Sep | 6 |
| Fri 4 Sep 2026 | Tue 8 Sep to Fri 11 Sep | 4, Labor Day now inside the remainder |

[removed: Serene Labs internal]

> **WITHDRAWN by D35 of Friday 4 September 2026. This is the earliest appearance of the circular figure in this log and it is kept visible.** **The M3 scope figure was obtained by subtracting the deferral from the window, so adding the deferral back returns the window.** [removed: Serene Labs internal] **The demand was never estimated from M3's work, and "the demand does not shrink when the window does" is false in the way that matters: the demand was built out of the window in the first place.**

~~[removed: Serene Labs internal] **The demand does not shrink when the window does.**~~

~~**So Friday 11 September does not close on the arithmetic at any landing date now in play, the best case included, where it is short [removed: Serene Labs internal].**~~ The response is one of two things: de-scope rung 3, the three non-launch blends staying as seeded shells, **which moves from held in reserve to expected on this entry**, or M3 moving day for day with the gate under the same standing rule. **Which one is decided on the gate day with the real window counted, not here, because choosing against a landing date nobody has is inventing an input.** What is decided here is that the earlier [removed: Serene Labs internal] figure is superseded and that any document calling M3 unaffected is wrong.

**Nothing in the above reaches Sunday 27 September 2026 today.** It is recorded now, three milestones ahead of the demo, so that if it does arrive the conversation is arithmetic rather than a negotiation under pressure. That is the same reason the re-baseline triggers were written down in advance.

**M1 is unaffected. It is delivered, all three acceptance criteria are met, and it was submitted [removed: fees and payments] on Wednesday 19 August 2026** (D21). Nothing in this entry touches it. [removed: fees and payments]

**Why the notice went on a Saturday rather than waiting for Monday.** The standing rule is that a slip goes in writing the day it is known, and **the day it was known was Friday 21 August 2026**, when the last of the five conditions passed its date with nothing arriving. Waiting for Monday 24 August would have meant sitting on a known schedule fact across a weekend and then delivering it on the same morning it could still have been fixed, which turns a notice into an ambush. **A slip notice is not a working day's work, so the weekend is not a reason to hold it.** Sending it on the Saturday also means the client has it before Monday morning, which is the working day the best case depends on.

**And it was still a day late, by our own rule, and that day is ours.** Friday 21 August was the day it was known. The notice went on Saturday 22 August 2026, recorded at `correspondence/2026-08-22-gate-slip-notice.md`. **One day late, in the entry that records a client slip.** Stated once and not explained away.

---

## D21 · 19 Aug · Criterion 1 closed, M1 submitted, and the AWS permission is tracked separately from milestone acceptance

**What changed:** the code runs locally in a working development environment. **SOW Rev C section 5 acceptance criterion 1, "repo running locally and on a dev environment", is met.** With criterion 2 closed by the audit and criterion 3 closed by the 27 September list, **all three M1 acceptance criteria are met** and the M1 milestone was submitted [removed: fees and payments] today, Wednesday 19 August 2026.

**Be precise about what that environment is.** It is a working development environment that the code runs in. **Nothing is deployed to AWS.** No certificate, no distribution, no staging host, no function. The criterion says "locally and on a dev environment" and does not say "on Trevean's cloud account", and reading it as a cloud deployment would have been reading a requirement into the contract that is not in it. Anyone tempted to describe this as a cloud deployment should stop: it is not one, and the AWS work is tracked below and at R3.

[removed: fees and payments]

**The AWS IAM permission is a separate matter and it is separated deliberately.** It does not gate M1 acceptance and it never gated criteria 2 or 3. What it gates is the ACM certificate, the CloudFront distribution, the staging host and every DNS step scheduled this week. State of it today:

- Credentials for the development account (ID in Trevean's private record) are held and exercised, PowerUserAccess through SSO, and the account was verified empty before anything was created in it.
- **A terraform plan was run today against the real account. It reports 140 resources to create, of which 24 are IAM resources that PowerUserAccess cannot create.** That is the same constraint D20 named, now measured against the account rather than reasoned about.
- **A Terraform state bucket exists: `trevean-tfstate-<TREVEAN_ACCOUNT_ID>`, versioned, encrypted, public access blocked.** It is the only thing in that account and it is deliberately created before any apply, so what happened to Microgroove's state does not happen to ours.
- The plan is saved and ready to apply the moment the permission lands. **Nothing has been applied.**

**Why the separation is worth writing down.** Holding a milestone open on a client dependency that does not actually gate its acceptance criteria is the same class of error as D15, pointed the other way: D15 described an unblocked item of ours as blocked on the client, and this would describe a met criterion as unmet because a different, genuinely outstanding client item is still outstanding. Both misattribute, both are checkable, and both go to a client who checks. **The permission is chased on its own terms, at R3, with its own consequence, which is the DNS and infrastructure work scheduled this week.**

---

## D20 · 19 Aug · Trevean AWS access is live, the account is empty, and PowerUserAccess is not enough

> **Amended later the same day by D21 on one point only.** The closing line below says this permission gates SOW Rev C section 5 acceptance criterion 1. **It no longer does.** Criterion 1 closed on a working development environment that the code runs in, and the permission now gates the ACM certificate, the CloudFront distribution, the staging host and the DNS work scheduled this week. Everything else in this entry stands, and the account and permission facts below are the ones D21 builds on.

**What Dan said:** "I am a user of AWS, but like I said, it was confusing. Set up what you need." The standing offer to do the configuration ourselves is accepted, in his own words. It stops being an offer and becomes our work.

**What we hold:** credentials for the development account (ID in Trevean's private record), PowerUserAccess through SSO. Access was exercised and proved rather than assumed, which is the standard D15 set.

**What the account contains: nothing.** No hosted zones, no CloudFront distributions, no DynamoDB tables, no buckets, no certificates, no functions. **This turns R3's "virgin install" from Dan's self-assessment into a verified fact**, and it settles something useful: there is no Microgroove-era state in this account to inherit, discover late, or collide with. Everything is created by us, from the infrastructure as code, on a clean account. The Microgroove-era account, where the CloudFormation stack the old deploy script queries by name still presumably lives, is a different account and is not reachable.

**The constraint discovered, and it is the one open item:** PowerUserAccess **excludes IAM role creation**. The infrastructure as code stands up eight functions with eight roles and eight policies, no shared execution role and no wildcard on a table, a bucket or a secret. That least-privilege shape is a commitment, not a preference, and it cannot be applied under PowerUserAccess.

**Operationally:** the ask to Dan shrinks from "configure AWS" to one narrow permission. Either IAM role creation is delegated to the same principal, or an administrator creates a bootstrap role with a permissions boundary once and every apply after that runs unattended. **This is the last input needed before the infrastructure can be applied.** It gates the staging host, the CloudFront distribution and the ACM certificate, and through them the DNS work scheduled this week. Tracked at R3. Per D21 it does not gate M1 acceptance.

---

## D19 · 19 Aug · The scaffold is a prototype that never ran, and the gate still does not move

**The audit ran on Wednesday 19 August**, the date it was promised to the client, read-only on mirror clones, and closes Q11 through Q17 and the repository half of Q18. Repository unmodified, HEAD unchanged.

**The verdict, in one sentence:** the scaffold is a published snapshot rather than a system that ran. The deploy path cannot ever have executed, because the build script produces neither of the two directories the deploy script consumes. The API cannot succeed against the tables it queries, because the models name three tables and two secondary indexes that nothing in the repository creates. The test suite has never run: 2,102 lines across eight suites import module paths that do not exist. And the entire NFC layer, in configuration, in shared constants and in a confident 359 line specification document, targets NTAG216 on ISO 14443 rather than the ST25TV02KC on ISO 15693 that is in the jars.

**Said as clearly as the failures, because it is true:** the blend route is statically generated ahead of time and a real build pre-rendered all five slugs, so **decision D2 is already satisfied in shape and nothing about it gets rewritten**. The `Growers` table carries forward cleanly and `Recipes` nearly does. There is no Microgroove-owned code, no private registry and no live credential on any ref, so nothing needs a licence from anyone and nothing needs an emergency rotation.

**The sharpest single fact for planning:** the route a thousand shipped jars point at, `/blend.html?blend={slug}&via=nfc`, does not exist in the repository in any form, and one of the five slugs does not match either. The scaffold says `the-silk-road`, the redirect table says `silk-road`. That is a silent wrong-blend page, and it is one hyphenated word.

**What it does to the estimate:** the M2 estimate was built on "carry forward and complete the existing schema". **There is no schema to carry forward, only a table name list that happens to match.** Two of five tables are partitioned on `chipUid`, the per-tag model D6 retired, and in DynamoDB a partition key change is a new table and a migration rather than an update.

**What it does to the dates: nothing. The M2 gate stays Friday 28 August 2026 and M3 stays Friday 11 September 2026.** A re-baseline moving M2 to Friday 4 September and M3 to Friday 18 September was drafted on the strength of this audit and then overruled. It is recorded here so that nobody re-derives it from the findings and assumes it was adopted: **the findings are accepted, the date change was not.** The compression is absorbed on our side, as the 14 to 18 August M1 slip already was. Any document asserting a 4 September gate is superseded by this entry.

**Five of the seven pre-written re-baseline triggers are marked tripped in the audit's own table:** no infrastructure as code, deployment state in an account we cannot reach, no hosting target that can support on-demand regeneration with a shared cache, chip tooling targeting the wrong family, and `ScanEvents` keyed for the retired per-tag model. Two are not tripped: no Microgroove-owned code, and the 307 hop, which was not measurable at the time the audit was written and has since been answered by Dan (D17). **The audit's summary sentence says four of seven, which is a miscount against its own table and is flagged for correction in the deliverable.**

**Why the triggers were written down in advance:** so this conversation is arithmetic rather than negotiation under pressure. That still holds even though the arithmetic did not move the date this time.

---

## D18 · 19 Aug · The 1,000 shipped tags are not write protected

> **REVERSED on Friday 11 September 2026. THE TAGS ARE WRITE PROTECTED. See D45.** Dan answered from memory here about a run that had already shipped; on 11 September, with the box in front of him, he said "yes the tags are locked per the supplier", and his own SO4731 instruction to the supplier asked for the NDEF area to be locked. **Everything below is preserved as the reasoning that was held at the time and none of its conclusions are current.** In particular: the 1,000 shipped tags are **not** freely re encodable, and the ST25TV area password is the only route to ever repointing them.

**Dan, 19 August: "There are no write protections on the tags."** This closes Q4, open since Friday 7 August and chased twice.

**What it changes:** a hard constraint becomes a recoverable one. Until today, the working assumption had to be that a thousand encoded jars carried a URL that could never be altered, so every recovery path ran through the redirect table and nothing else. The tags can be re-encoded.

**What it does not change:** re-encoding a thousand jars by hand is a real operation with a real cost and it is Trevean's line, not a keystroke. **The redirect table stays the primary recovery mechanism** and D10 is untouched. What has changed is that there is now a second, expensive option behind it, where before there was none.

**What it does to M4:** the chip programming tooling now serves **this** production run rather than only the next tag order. Encoding, verification and read-back apply to inventory that exists. Note the tooling still applies area-based 64-bit password protection on chips that currently have none, which is a decision about whether future runs ship protected, and it is now a decision rather than an inherited state.

**One thing to confirm rather than assume:** "no write protections" is Dan's answer, not Tagstand's written one. Verify by read-back against our own bare ST25TV02KC stock and, once inventory is in hand, against one shipped jar, before anything depends on rewritability.

---

## D17 · 19 Aug · The 6 August timings did not include the production redirect

**Dan, 19 August: "The tap went to the spice blend page on Squarespace."** That answers Q2, asked 7 August and re-asked in plain terms 12 August. **The 307 was not in the measured path.** The tags in that test resolved to a page directly.

**What it costs:** roughly 0.2 to 0.3 s on cellular for the redirect hop. The worst-case handset, iPhone XS, moves from a measured 1.6 s to a corrected **1.8 to 1.9 s against a 2.0 s requirement**. Still a pass, and now thin rather than comfortable.

**Independent corroboration:** the performance model derives the 307 hop at 165 ms at the design point, arrived at separately from the 0.2 to 0.3 s estimate in the hardware record. The two agree, which is why the estimate is being treated as sound rather than as a guess.

**What it makes mandatory.** The corrected baseline is still measured on a test page carrying no photography. Adding the production pre-readable payload costs roughly 0.31 s at the design point, which takes the iPhone XS past 2.0 s. **Three round-trip optimisations therefore move from recommended to mandatory before the gate:**

1. **A DNS HTTPS (SVCB) record advertising `alpn="h3"`**, so HTTP/3 is used on the first navigation. Saves 150 ms. **This was blocked on whether Squarespace DNS supports the record type. D16 unblocks it**, because Route 53 does.
2. **A preload `Link` header for the hero on the 307 response.** Saves up to 150 ms, costs nothing, and it is the only way to make an otherwise purely costly redirect hop do useful work.
3. **The 307 target must be same-origin and relative.** A redirect to a different hostname repeats DNS and the handshake: plus 450 ms, and the budget fails at the design point. This becomes a written constraint rather than an intention, because it is the one that silently breaks on a future hosting change.

Together those recover roughly 300 ms of modelled time against a roughly 210 ms shortfall. **A cut to the hero image budget is held in reserve as a fourth lever and is not proposed**, because the first three cost engineering time and the fourth costs brand quality, and that is the right order to spend in.

**Also recorded, and deliberately not resolved:** Dan's answer places the 6 August destination on Squarespace, while this knowledge base has said since 12 August, on Dan's own report, that Vercel holds the marketing site. Both cannot be the whole truth. **Open as Q23 rather than settled by picking one**, because the apex-domain routing shape depends on the real answer and guessing it wrong is expensive.

---

## D16 · 19 Aug · Registrar moves to Bluehost after all. This supersedes D14

**What D14 decided, on 12 August:** do not transfer the domain. Keep the registrar at Squarespace and point DNS from there at the host. The reasoning was that DNS records point anywhere from any registrar, so the transfer bought nothing technically, while costing a five to seven day ICANN window, a sixty day lock and a real chance of a nameserver gap whose failure mode is a thousand encoded jars that do not resolve.

**What changed:** Dan has already started the move. **19 August: "I made the DNS request change from Squarespace to Bluehost, waiting on that confirmation from Bluehost."** The transfer is in flight, not under discussion.

**Decision: Bluehost is the agreed position. D14 is superseded and is not re-argued.** The ICANN window and the lock are known and were weighed on 12 August; the client has chosen differently with that reasoning in front of him, and it is his domain.

**What it means operationally:**

- **Nameservers point at Route 53 once the transfer completes.** The delegation is the step that matters to us, not the registrar of record.
- **DNS timing now depends on Bluehost's confirmation**, which is outside both parties' control and has no committed date. The Friday 21 August DNS deadline in R1 is therefore dependent on a third party for the first time.
- **The redirect table and all five codes get re-verified against physical tags before and after the delegation flips**, exactly as they would have under D14. Nothing about that discipline relaxes because the registrar changed.
- **One thing improves.** D17 makes a DNS HTTPS (SVCB) record advertising HTTP/3 mandatory, worth 150 ms on the tap path, and it was blocked on whether Squarespace DNS supports that record type. Route 53 supports it. **The move removes that block.**

**The 7 August call recap is no longer misleading on this point.** It listed "transition DNS to Bluehost" as an action on Dan, D14 overturned it five days later, and D16 restores it. Anyone reading the recap alone now reaches the right conclusion by accident; anyone reading D14 alone reaches the wrong one, which is why this entry exists rather than an edit to D14.

---

## D15 · 19 Aug · Repo access landed on Monday 10 August, and this record said otherwise

**What the record said:** that Dan *believed* repo access had been granted on Wednesday 12 August, that whether it actually worked had never been tested, and that testing it was an open blocking item. The client-dependency list carried repo access alongside the AWS invite and Vercel as landing on 12 August.

**What was true:** access to `nfc-development` was received on **Monday 10 August 2026** and confirmed in writing to Dan the same evening. Dan, 5:31 PM: "Let me know if you have repo access. I am going to check this again to make sure." Jacob, 7:41 PM: "I did receive repo access, thank you." Neither line was carried out of the Upwork thread and into this knowledge base.

**What it cost:** nine days. The scaffold audit has been possible since Monday 10 August 2026 and was not performed until Wednesday 19 August 2026, so open questions Q13 through Q17 were answerable nine days before M1 delivery and stayed open the whole time. The delay is the smaller half. The larger half is that any client-facing document describing repo access as outstanding, blocked, or awaiting Dan would have been false, and it would have gone to a client who checks every claim and who hired us specifically for not doing that. **The M1 acceptance shortfall cannot be attributed to client delay on the repo half. That half is ours.**

**Why it happened:** the knowledge base was written from our own working notes rather than from the message thread, and the only place the answer existed was a two-line exchange late on a Monday evening. The AWS thread ran alongside it, was genuinely blocked, and absorbed the attention that should have gone to reading back what we had already confirmed ourselves. A real blocker next to a resolved one made the resolved one look like the same shape.

**What stops it recurring:** a dependency is recorded as landed on the date it was confirmed in the thread, with the message quoted, or it is recorded as unknown. **"Believed granted" is not a state a dependency is allowed to sit in**, because it reads as a client obligation when it is in fact an untested item on us, and the difference decides who a slip belongs to. Before any client-facing document asserts that a dependency is outstanding, the thread is searched for our own confirmation of it first.

**What this correction does not extend to.** The thread truncates after Monday 10 August. Nothing else from the week of Tuesday 11 August gains standing from this reconciliation, and the 12 August record remains the later one wherever the two overlap.

---

## D14 · 12 Aug · Registrar stays at Squarespace

> **SUPERSEDED on 19 August by D16.** The registrar is moving to Bluehost and the transfer is in flight. Read D16 before acting on anything below. The reasoning here is preserved because it is still the reasoning about what a transfer costs, and it still governs the verification discipline around the cutover.

**Decision:** do not transfer the domain to Bluehost. Point DNS from Squarespace at the host instead.

**Why:** DNS records can point anywhere from any registrar, so a transfer bought nothing technically. It would have cost a five to seven day ICANN window, a sixty day lock preventing further moves, and a real chance of a nameserver gap. **The failure mode of that gap is a thousand encoded jars that do not resolve.** It was the only item in the risk register that could kill inventory, and it was optional.

**Dan agreed 12 August.** Revisit in October if he still wants it.

**This supersedes a call action item, and the recap will mislead anyone who reads it alone.** The recap of the kickoff call on Friday 7 August lists "transition DNS to Bluehost" as an action on Dan. That was overtaken by this decision five days later. The registrar stays at Squarespace and DNS points at the host. If the call recap is ever circulated, that line goes with a correction attached.

---

## D13 · 12 Aug · Lid is 8 mm, not 4 mm

**What changed:** Dan reported 4 mm in July. The actual assembly is 8 mm bamboo, tag at 8 mm depth, then a 1.5 mm cork sealing gasket below the tag.

**Consequence:** the read path doubled. Worst-case handset (iPhone XS, 18 mm bare) now reads through 8 mm rather than 4, so the margin is roughly 2x rather than 4x. Still a pass, comfortable rather than generous.

**Confirmed alongside it:** the cork liner sits below the tag and does not count against the read path. SOW §6.1 currently says the margin is "assembled lid plus liner thickness," which overstates it.

**Action taken:** the earlier "four to seven times the margin" statement was corrected to Dan unprompted. Phone cases moved from noise to a real variable and are now required in the M2 matrix.

---

## D12 · 7 Aug · The M2 gate stays at M2, not M5

**Issue:** SOW Rev B moved §6.1 acceptance to M5, undoing the commitment that won the contract. Almost certainly an artifact of rewriting §6 without re-syncing §5.

**Resolution:** flagged, and Dan corrected it in Rev C with the reasoning written into the document: "The tap-through poses a risk that cannot be addressed if identified too late."

---

## D11 · 7 Aug · The 2.0 s clock starts at the first navigation

**Decision:** with two navigations in the path (`/t/{code}` then `/blend.html` after the 307), the clock starts on the **first** request. The redirect hop is inside the budget, not outside it.

**Why:** the first request is what the customer actually experiences. Taking the stricter reading is only affordable because the redirect will be served at the CDN edge rather than from an origin.

**Adopted into SOW Rev C §6.2 verbatim.**

---

## D10 · 6 Aug · Redirect is unavoidable; the decision is where it is served

**What changed:** the architecture originally specified no redirect, pointing tags straight at the page. That option closed on 24 July 2026 when 1,000 tags were encoded with `treveanspice.com/t/{code}`.

**Decision:** keep the redirect, serve it at the CDN edge. Origin-served costs a full round trip plus a table lookup; edge-served costs one hop and never touches a server.

**Also decided:** the redirect table lives in version control, deployed with the application, never as hand-edited state in a hosting console. A host migration that leaves the table behind does not break a deployment, it strands inventory.

---

## D9 · 6 Aug · §6.1 rewritten as two obligations and one exclusion

**Decision:** contractor carries (a) ≥98% tag read success and (b) page readable within 2.0 s of navigation start. The OS confirmation step in between is measured and reported on every run but **never scored**.

**Plus two preconditions:** the device matrix, and device state.

**Why:** the original wording gated [removed: fees and payments] on "≥98% successful reads on first tap," which has no stable meaning on iOS because the OS interposes a banner that no encoding, hosting or application change removes.

**This is the decision that won the contract.** Dan: "Out of eight people, you were the only one who read §6.1 and asked if it was actually possible before agreeing."

---

## D8 · 6 Aug · Device state is part of the matrix, not a caveat

**Decision:** supported states are a precondition of the percentage. iPhone needs the display awake; Android needs unlocking.

**Why:** outside those states the read rate is zero on every handset on both platforms. Not degraded, zero. Without this written down, somebody taps a sleeping phone at the demo and calls it a failure.

**It also solved a mystery:** Dan's team remembered "the thing worked" but nobody remembered a banner. The phone was almost certainly asleep during those informal tests.

---

## D7 · 6 Aug · Trevean runs the acceptance test, not Serene Labs

**Decision:** Trevean staff perform the physical taps, on Trevean materials, at Trevean's facility, using a measurement harness Serene Labs builds and hands over. Serene Labs writes the protocol, reads the data, and signs off.

**Three reasons in order:** the thing that has to hit 98% is Trevean's production line, not one developer's hands, so a figure produced by one person on one afternoon does not answer the real question · it removes the contractor from grading their own homework on the criterion gating [removed: fees and payments] · it saves a week of shipping in an eight-week schedule.

**Dan's response:** "I've hired many engineers, and it's rare for someone to hand over the measuring tool."

---

## D6 · 6 Aug · Augmented NDEF and TruST25 dormant for launch

**Decision:** accept per-SKU encoding with no per-tag identifier. ANDEF and TruST25 stay off.

**Why:** the 1,000 tags were already encoded per-SKU before the engagement began. Not a design choice to relitigate.

**Consequences accepted:** attribution is per-SKU, individual jars are not distinguishable, no chip UID is logged, and scan deduplication falls back to a browser-side token, the same as the QR path.

**Preserved for later:** enabling them is a decision made **at encoding time**, when the next tag order is placed, not afterwards. Recorded so the option is not lost by default.

---

## D5 · 5 Aug · The chip is ST25TV02KC, not NTAG21x

**Date corrected 19 August.** This entry previously read 1 August. The chip part number was still listed as the one open packaging item in the reply to the award on Monday 3 August, and Dan supplied the test results carrying the identification on Wednesday 5 August. The correction was owned the same day.

**Correction owned:** Serene Labs had assumed an NXP NTAG21x and told Dan "any NTAG21x works identically here" on 31 July. Wrong. The tag is STMicroelectronics ST25TV02KC, NFC Forum Type 5 / ISO 15693, a different family and a different air interface.

**Also conceded:** this partly vindicated Dan's original 15 cm read-distance claim. ISO 15693 is a vicinity standard designed for longer range than the proximity standard assumed. With a bench reader, 15 cm is entirely reasonable for this chip. The reasoning about phones was right; the assumption about the chip class was not.

**Consequence:** the scan-attribution design depended on a chip feature that turned out to have an ST equivalent (Augmented NDEF), so nothing had to be rebuilt. Confirmed against the ST datasheet and application note AN5658.

---

## D4 · 31 Jul · No metal anywhere in the lid or liner

Confirmed by Dan, with the co-packer instructed in writing that the seal must be non-metallized. This retired the single largest threat to the build: foil, metallized labels, metal inserts or magnetic closures stop NFC completely rather than degrading it, and spice jars commonly have a foil seal.

Tracking continues as R4 until the written co-packer confirmation lands.

---

## D3 · 30 Jul · Custom admin, not a headless CMS product

**Decision:** build the admin inside the same application.

**Why:** the content model already exists in DynamoDB with five defined tables, and a CMS product wants to own the content model. Adopting one means either two sources of truth, whose failure mode is literally "the page shows the wrong story," or abandoning the schema everything else depends on. A custom admin also gets the NFC-native screens no generic product models, and publishing regenerates the page directly with no webhook plumbing between two vendors.

Recommended against explicitly rather than skipped quietly, since the job post listed headless CMS as a nice-to-have.

---

## D2 · 30 Jul · Render ahead of time, not on demand

**Decision:** pre-render each blend page, regenerate on CMS publish, serve from the edge cache. No origin compute and no database read on the tap path.

**Why:** render-on-demand costs 150 ms warm and up to 2500 ms cold, and the cold case lands on the first tap of the morning in a customer's kitchen. It also means a viral jar turns every tap into a function invocation and a database read.

**The line that mattered to Dan:** on demo day, the only things that need to be alive are DNS and the CDN. Not the API, not the database, not a function, not the CMS.

---

## D1 · 29 Jul · [removed: fees and payments]

**Date corrected 19 August.** This entry previously read 30 July. Dan caught the discrepancy in his reply of Wednesday 29 July and it was owned the same day; the three-document package that carried the full reasoning followed on Thursday 30 July.

The submitted Upwork terms said [removed: fees and payments]; the cover letter body said [removed: fees and payments], from a stale draft, and Upwork's six-hour editing window had already closed. Owned directly rather than explained away. [removed: fees and payments]

[removed: fees and payments]

---
