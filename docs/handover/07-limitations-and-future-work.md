# Limitations and future work

**M5 handoff deliverable. Written Saturday 22 August 2026. Sections 5.1 and 6.1 revised Tuesday 25 August 2026.**

A handoff that only lists what works is a sales document. This one lists what is deliberately switched off, what is left half open on purpose, what is genuinely owed, and what is simply not known. It is written so that a developer arriving in a year can tell the difference between a decision and a defect, because the two look identical from the outside and treating a decision as a defect is how a working system gets broken.

---

## 1. The three categories, kept separate

| Category | What it means | Sections |
|---|---|---|
| **Deliberately dormant** | Present, working, switched off on purpose, with a reason and a moment at which it can be switched on | 2, 3 |
| **Seams** | Left half open so a known future thing plugs in cheaply. Nearly free now, expensive to retrofit | 4 |
| **Debts and unknowns** | Genuinely owed, or genuinely not known. No euphemisms | 5, 6, 7 |

---

## 2. Augmented NDEF and TruST25: present, working, switched off

**Both features exist on the ST25TV02KC in every jar in the field. Neither is broken and neither is missing. Both are off by decision.**

**Augmented NDEF** lets the tag insert dynamic fields into the URL at read time: up to six attributes including the 64 bit chip UID, a tap counter, a Unique Tap Code that changes on every tap, the anti counterfeit signature, and tamper status. It is the manufacturer's equivalent of the mirroring feature on other chip families and is slightly more capable.

**TruST25** is a cryptographic digital signature for anti counterfeit. It lets a verifier prove a tag is genuine rather than a cloned URL.

### 2.1 Why they are off

**Because the thousand tags were encoded per SKU before this engagement began**, on 24 July 2026. Every unit of a blend carries an identical URL and there is no per tag identifier in the payload. That was not a design choice made during this project, and it is not one to relitigate.

The consequences were accepted with eyes open and written into the contract rather than discovered later:

- Individual jars are not distinguishable.
- **No chip UID is available to the page.** It is not in the NDEF payload, and no browser API exposes it.
- Scan deduplication falls back to a browser generated token in `localStorage`, exactly the mechanism the QR path uses. Measurably weaker than a per tag counter.
- Every analytics response carries the measurement method rather than implying precision the encoding does not have. That is a schema requirement, not a convention somebody remembers.
- Freshness is stated per blend rather than per lot or per jar. Per SKU encoding makes per lot impossible anyway.

### 2.2 The sentence that decides money, and it has a deadline shaped like a purchase order

> **Enabling Augmented NDEF or TruST25 is a decision made at encoding time, when the next tag order is placed. It cannot be done afterwards.**

A tag written today without Augmented NDEF cannot be given it later without being re encoded. The shipped run is re encodable, confirmed on 19 August 2026, so this is recoverable in principle, but re encoding a thousand jars by hand is a real physical operation with a real cost and it is Trevean's line rather than a keystroke.

**So the practical rule is: the moment to decide is when the purchase order for the next tag order goes out, not when somebody asks for the feature.** If per jar attribution or a defensible anti counterfeit claim ever matters commercially, that is the window, and it closes silently.

**This is recorded here so the option is not lost by default.** Losing it by default is exactly what happens when nobody writes it down: the next order gets placed by whoever places orders, on the same specification as the last one, and the decision is made by omission.

### 2.3 What would have to change if either were switched on

Worth knowing before the conversation happens, because the cost is not zero and it is not enormous either.

| Feature | What changes |
|---|---|
| **Augmented NDEF** | The URL the tag returns gains dynamic parameters. **The redirect table and the edge function would need to accept and strip them**, and the current function deliberately reads no query string at all, so that is a real change to the most carefully guarded forty lines in the project. The cache key rules would need re examining, since a per tap value in the URL is the definition of an unbounded cache key. The scan event schema gains a per tag identifier and a counter, which is an additive contract change. Deduplication moves from a browser token to a real counter, which is the actual prize. The dashboard's measurement labelling changes, and the honest comparison between NFC and QR is lost, because they would no longer be measured the same way. |
| **TruST25** | Verification requires a check the page cannot do by itself, so it implies a verification endpoint and a key. Nothing about it fits on the tap path, so it belongs after paint or on a separate flow entirely. |
| **Per tag codes generally** | A table of per tag codes will not fit inside the 10 KB code limit of the edge function. **The answer at that point is a key value store at the edge, which is still a viewer request lookup with no origin call.** Recorded so the option is not lost. Nothing about the current design needs to change to keep it available. |

**Tamper detect** is a third dormant capability. Whether the 40 mm inlay actually wires the tamper loop is unconfirmed, so it is out of scope rather than switched off, and confirming it is a question for the tag supplier.

---

## 3. Other things built and deliberately switched off

| Item | State | How to switch it on |
|---|---|---|
| **The hero preload hint on the 307** | Implemented, off. Worth up to 150 ms, and it is the only way to make an otherwise purely costly redirect hop do useful work. | Set the hero path on a row in the redirect table and rebuild. **No code change**, and a test covers both states. Two things to settle first: the final hero filenames, and whether they are content hashed. Because the 307 is `no-store`, the hint is regenerated on every tap and can never go stale. |
| **The reserved fifth tag code** | `kg` for Kyoto Garden is in the table and resolves. **No physical tag in this run carries it.** | Publish the blend, or repoint the code at a branded holding page, or drop it. Currently it resolves to the branded unresolved page because the blend is a draft. Whatever the answer, it is a one line change to a target path and no code change. |
| **The QR route** | `/q/{code}` is built, tested, and serves the same destination as the tap with `via=qr`. | It is on. **What is not done is the artwork.** See section 5.2. |
| **Event source mappings for the rollup and media consumers** | Default to off in the infrastructure and stay off until real application code is deployed. | Flip the variable after the application pipeline has run. **A placeholder attached to a live stream fails every batch, fills the dead letter queue, and produces an alarm storm on day one.** |

---

## 4. The native app seams

**A React Native app is out of scope and deferred to a later phase. Do not build it.** What was done instead is to leave the seams open, because a seam left deliberately is nearly free and the same seam retrofitted is not.

Where they are, and what each one costs to use:

| Seam | What is already true | What an app would need |
|---|---|---|
| **The API is versioned and content type agnostic** | `/v1/...` in the path, JSON only, `camelCase`, RFC 3339 timestamps in UTC, money as integer minor units plus a currency code, cursor pagination. Nothing about the wire format assumes a browser. | Nothing. It consumes the same endpoints the build process does. |
| **Content reads are unauthenticated** | Every byte they return is already public in the rendered page, so no credential exists to embed in a shipped app, which is the usual first mistake. | Nothing. |
| **The scan channel is an enum, and adding a value is additive** | `nfc`, `qr`, `direct` today. Adding an enum value is explicitly allowed inside v1, provided clients treat unknown values as the documented fallback rather than throwing. | Add `app` as a channel value and the analytics split works with no schema break. **This is the single cheapest seam in the project and it exists because the enum rule was written before anybody needed it.** |
| **Deduplication is client generated** | A random token from the client, not a server identity. | An app supplies its own token by the same rule. Nothing server side changes. |
| **An app can read the chip UID where a browser cannot** | The browser has no access to it. **A native app does.** | This is the one place where an app is genuinely more capable than the page, and it is the natural home for per tag attribution **if and only if** the tags are ever encoded to carry it. It does not rescue per jar attribution on the current run: the UID is readable but the shipped tags carry no per tag payload, so an app would be reading a chip identifier that nothing in the data model is keyed on. **Adding it is a data model change, not a client change.** |
| **Reorder is a static cart permalink** | Zero API calls, zero client credentials, nothing to fail. | Works identically from an app. No Shopify client credential ever ships. |
| **Admin auth is a standard bearer JWT from a managed identity provider** | Validated on signature, issuer, audience and expiry, with a roles claim. | An operations app authenticates the same way. |
| **Analytics is read from rollups, not raw events** | Cost is a function of days requested and nothing else. | An app dashboard costs the same as a web dashboard. |

**The one seam that is genuinely not open, stated plainly:** there is no push notification path, no device registration, and no customer identity anywhere in this system, because there are no customer accounts at all. An app that wants to recognise a returning customer is introducing a customer identity surface to a product that deliberately has none, and that is a product decision with privacy consequences rather than an integration.

---

## 5. Known debts, in order of what they cost

### 5.1 Nothing is deployed, and nothing has met reality

**The largest single gap, and it is partly a client dependency and partly ours.** The infrastructure is written, formatted, validated and was planned against the real account: 140 resources, 24 of them IAM. **Nothing has been applied**, because the available permission cannot create IAM roles and a partial apply would leave a half built environment and a partial state file in a client account.

> **CORRECTED Thursday 27 August 2026. The paragraph below was wrong and is kept struck so the error stays visible.** `888348806392` is `Trevean-NFC-Development`, the development account; the Organization management account is `[account id withheld]`, `Trevean Spice`, org `o-q36zht9ztn`. **The debt in 5.1 is smaller than it says: the development environment was applied into `888348806392` on Thursday 27 August 2026, 169 resources, distribution `d1uyspgs0bmg3a.cloudfront.net`, all five tag codes verified end to end.** The packages listed below are still proven against models rather than against reality, and that half of the debt is unchanged. See the document titled "The deployed development environment", and "Decision log", D32.

~~**Two things about the account were not known when this section was written on 22 August 2026, and both make the gap larger rather than smaller.** The account is the **management account of an Organization with no member account beneath it**, so there is currently nowhere for a non production environment to live and nothing above the account to enforce a guardrail.~~ **Withdrawn: there was always somewhere for a non production environment to live, and it is the account we already held credentials for.** **The saved 140 resource plan should still be deleted rather than trusted**, because the 169 resource apply supersedes it. See the document titled "Runbooks", section 2.2.

**A second gap sits underneath the first and it was not stated at all on 22 August: eleven packages are built and every one of them is proven against a model rather than against reality.** They are not the same debt and they do not clear together.

| Package | What its passing suite proves | What has never happened |
|---|---|---|
| `build/chip-cli`, 134 tests | The encoding, read back, batch record and refusal logic are correct against a software model of the chip | **It has never written a physical tag or spoken to a physical reader.** The reader transport is an unimplemented stub. **This is the widest gap in the set**, because the deliverable is inventory that cannot be recalled. |
| `build/shopify`, 220 tests | Cart permalink construction and HMAC signature verification are genuinely proven, because they are pure functions over bytes, and the RFC 4231 known answer vectors pass | **It has never spoken to a Shopify store.** There is no store access. Every claim about Trevean's catalog, prices, SKUs, product handles or webhook deliveries is unverified, and the simulated responses are hand built to the documented shapes rather than recorded. |
| `build/admin`, 169 tests | The screens, the roles, the blocking cases and the contract derived permissions work locally against the API package | **No member of Trevean's marketing team has ever opened it**, which is the actual M3 acceptance bar. |
| `build/dashboard`, 105 tests | The derivations, the marks and the absence of a table scan on the read path are correct against seeded rollups | **It has never been shown a real scan.** |
| `build/api`, 144 tests | The contract is implemented and the suite runs against an in process database | **Never run against real DynamoDB.** No latency, no cold start, no concurrency figures. |
| `build/web`, 204 checks | The page builds, ships nothing third party, and scores 100 on the placeholder build | **Never built with real content or real photography, and never served from anywhere.** |
| `build/edge`, 132 tests | The compiled function is correct in a sandbox that approximates the edge runtime | **Never deployed to any edge.** |

**The honest summary is one sentence: the tests prove the code does what it was written to do, and they prove nothing about whether it was written against the world.** That is a normal position for a project at this stage and it is stated here because a reader who sees eleven green suites will otherwise conclude something stronger.

Everything that follows from the deployment gap is also owed: no measured cache hit ratio baseline, no measured API latency against real DynamoDB, no cold start numbers, no concurrency test of the render cache, and no production 307 timing. **Several figures in this package are therefore modelled or measured locally, and each one says so where it appears.**

### 5.1.1 The domain resolves and points at the wrong host, and one debt inside that is untaken

**Corrected later on Tuesday 25 August 2026. An earlier version of this section said `treveanspice.com` returns SERVFAIL. It does not.**

**`treveanspice.com` resolves.** Nameservers `ns1.bluehost.com` and `ns2.bluehost.com`, apex A record `50.6.2.51`. **Email on the domain is fully restored**, verified across all four records: MX to `smtp.google.com`, SPF, a Google DKIM selector, and DMARC. The paragraph this replaced said company email was probably not flowing, and for a period it very likely was not. **It is flowing now and it was checked rather than assumed.**

**SUPERSEDED 30 September 2026: the jars work, 13 of 13 checks against the live domain. See the current state block in the package index.** As at August, the apex returned HTTP 403 and `/t/ps` returned HTTP 500, because the domain pointed at Bluehost rather than at the deployment. **A thousand encoded jars reach an error rather than nothing. That is a different failure, not a fixed one.**

**What is no longer a debt.** There is an authoritative zone to export as a rollback record, somewhere to place a certificate validation record, a left hand side for `zone-diff.sh`, and a prior resolving state to revert to. **All four were absent a few hours earlier, and the DNS level rollback exists again in principle.**

**What is still owed, and it is one task rather than a dependency on anybody.** **Nobody has exported the zone verbatim to a file.** A rollback restores what the previous state answered, which is only useful if somebody knows what it answered, so **the DNS level rollback does not exist in practice until that file is on disk and its record count is known.** The records could not be read out of DNS while DNS was down, **that window has already closed once this month**, and it costs minutes to take the export on a day when nothing is on fire. See the document titled "Runbooks", section 9.1.

**One thing got harder rather than easier, and it is the item to carry forward.** The zone carries live company email. A few hours earlier there was nothing in it to break. **The infrastructure package has gained a precondition refusing to create a hosted zone with no MX records unless an acknowledgement flag is set explicitly**, which puts that in a gate that fails the apply rather than in a sentence somebody skims.

**And the older debt is narrower than it was: there is still nowhere to point the apex that this package describes**, because there is no production distribution and no certificate for `treveanspice.com`. ~~and no AWS account other than the Organization management account.~~ **Corrected Thursday 27 August 2026: the account was never the reason. `888348806392` is the development account, and a development distribution, `d1uyspgs0bmg3a.cloudfront.net`, exists in it.** "Decision log", D32.

### 5.2 The printed QR codes do not point where the tags do

**Live, contractual, and not a build problem.** The on pack labels are already printed and their QR codes point at a different destination from the tap. Printed stock cannot be re pointed the way a redirect table can.

The parity requirement says the QR opens the identical page as the tap, and the QR matters more than a parity clause suggests: **it is the sole recovery route for a sleeping handset, a locked Android, and every device outside the supported matrix**, which is a materially larger share of shoppers than a tap first framing implies.

Three routes, and one has to be chosen: make those URLs resolve to the same destination, reprint, or renegotiate the clause. The last is not recommended for the reason above. **The decision cannot be made until it is known where those URLs actually live**, which is section 6.1, and the photograph of a printed label that would settle it has been asked for and has not arrived.

**Updated Thursday 27 August 2026, and the update is a warning about a wrong turn.** A file was supplied, captured by the client on Wednesday 26 August 2026 and read here on Thursday 27 August 2026, and **it is a text conversion of the label artwork, not the artwork.** A text conversion reads printed characters, and **a QR symbol is an image**, so the encoded string is not in it and never could have been. **The question is still open and the file does not close it.**

**The specific trap, because it will be walked into otherwise.** The label prints the words **TREVEANSPICE.COM** beside the code. **That is the human readable domain printed for a customer to type. It is not evidence of what the code encodes**, and the client has separately said the code points at Squarespace. **Anyone treating the printed word as the decoded string will conclude the QR carries an apex path on no evidence**, and one of the branches that conclusion covers is a shared path across all five blends, which is a certain reprint. **Decode the symbol or do not claim to know.**

**What actually closes it:** the artwork file with the QR present as vector or raster artwork, or a photograph of the printed code at a resolution that decodes.

**What is done on the build side:** the edge serves `/q/{code}`, the artwork sheet listing the exact URL to encode for each code is generated from the redirect table, and the correct process is that artwork is produced **from that file rather than from a retyped URL**. What is not done is the artwork itself, which is Trevean's and is on the critical path.

### 5.3 The 2.0 second margin is thin, and it is modelled rather than measured

The 6 August 2026 measurements did not include the production redirect. Adding it puts the iPhone XS worst case at **1.8 to 1.9 s against a 2.0 s requirement**, on a test page with no photography over an office network. The production pre readable payload costs a further 0.31 s at the design point.

Three round trip optimisations therefore moved from recommended to mandatory. **Two of the three are ours and are shipped:** the preload header on the 307 (built, currently off pending hero filenames) and the same origin relative target (written as a constraint and enforced by the validator). **The third, the DNS record advertising HTTP/3, and the real measurement of the redirect hop, both sit behind the domain move.** Until the domain moves, both the shortfall and the recovery are numbers on paper.

**A cut to the hero image budget is held in reserve as a fourth lever and is deliberately not proposed**, because the first three cost engineering time and the fourth costs brand quality, and that is the right order to spend in.

### 5.4 Through lid validation on production materials is open

The 6 August run read through bamboo only, on salvaged lids with the cork scraped away. **The production stack has not been tested**, and production lids had no confirmed arrival date as at Saturday 22 August 2026. It is Trevean's item, not the contractor's, and the agreed shape is to accept on the interim stack with the production re run as a separate dated joint item, on the condition that **the interim lids are at least as thick as production so a pass is conservative.** That wording change was raised and has not been answered.

**One question would shrink this to a formality and has not been answered: how thick was the bamboo on the salvaged lids?** If they were also 8 mm, through lid read at production thickness is already proven.

### 5.5 CORS on the scan beacon

Detailed in the document titled "API reference", section 8, item 2. Repeated here because of the failure mode: **an implementation that satisfies the frozen document exactly produces zero scan events in production, with nothing in any log to say so.** It is not a slow beacon or a lossy beacon, it is no beacon, and the first symptom is an empty dashboard several weeks after launch. The frozen document declares no `OPTIONS` operation, no CORS headers and no allowed origin list, and its declared server is a different hostname from the page.

### 5.6 Content is placeholder

Real content for the two launch blends has not been delivered. Every page in the current build carries a placeholder banner **by design**: every placeholder string contains a marker in the value itself rather than beside it, so it survives a copy, an export, a screenshot and a page render, and **nothing that would be a claim about the world is invented anywhere.** No grower name, no farm coordinate, no harvest date, no price, no origin story: those are held null with a visible pending slot rather than filled in.

**The placeholder imagery is at the real byte weight, to the byte**, so the performance claim survives the swap and the page weight does not change when real photography lands. A budget validated against a small grey rectangle proves nothing.

**One residual to measure on the day real photography arrives:** the placeholders are PNG and production serves modern formats, so the one thing a PNG placeholder does not reproduce is decode cost, about 50 ms of the hero line in the model. That gets measured for real the first time a genuine photograph is processed.

**Two real content facts were read on Thursday 27 August 2026, from a text conversion of the Persian Sunrise printed label the client captured on Wednesday 26 August 2026. Neither is in the fixtures and both are recorded here so nobody has to rediscover them.**

| Fact | What it is, and what it is not |
|---|---|
| **Harvest: April 2026** | Printed on the product, so it is a fact about the world rather than a plausible value. **Read the history before using it.** The API seed previously carried a harvest date of **12 May 2026 that was fabricated**, and it was removed on Saturday 22 August 2026 for inventing a fact about a real supply chain. **That removal was correct and it stays correct.** April 2026 replaces nothing: it is the first real harvest date this project has had, and it goes in only after the artwork is confirmed final |
| **Composition: cinnamon, cardamom, lime, rose petals, saffron** | **SUPERSEDED LATER THE SAME DAY, and settled rather than pending. See section 5.10.** The label list disagreed with the Scope record, which lists four items and omits cinnamon. **The client's own blend production specification then gave the weights and it outranks both.** The composition is no longer waiting on the artwork question |

**The harvest date is still pending, and it is not laziness.** The label file supplied is a conversion of artwork and **may be a proof rather than the final printed artwork.** Until the client confirms which, writing the harvest date into the fixtures would reintroduce exactly the failure the 22 August removal corrected: **a plausible looking claim about a real supply chain, on a page, sourced from something that was never confirmed.** The placeholder discipline in this section exists for that reason and it holds here. **Confirm, then seed. Not the other way round.**

**The composition is not pending, and the difference is the source.** A production specification is a manufacturing document. **A label may be a proof.** Different sources, different confidence, different gates. Section 5.10.

**One further fact from the same label, recorded because it is not ours to act on.** The label prints an origin, a set of coordinates resolving to the Kashan area, and a named grower. **Persian Sunrise's origin content is subject to a United States export controls question that the client raised with its counsel**, which now touches printed inventory and a named individual rather than only a web page. **No view is offered on that question anywhere in this package and none should be added.** Its build consequence is the one already stated, and it is sharper than it was: **the grower record is not written, nothing is copied from the live marketing site or off the label into the fixtures, and section 5.10 explains why the page cannot simply be made to match the jar.**

### 5.7 Debts inside the build, small but real

- **The API package's licence manifest lists counts and direct dependencies but not every transitive package by name**, while the pages package's manifest does. Regenerate it before the package goes to counsel.
- **The media key namespace is implemented in the API and still described as a proposal in the content package.** The two agree in behaviour and disagree in writing. Reconcile in one place.
- **Some earlier project documents state that the registrar stays put**, which was true on 12 August 2026 and was superseded on 19 August. The reasoning in them about what a transfer costs still governs the cutover discipline.
- **The tag records were corrected to write protected on 11 September 2026 and no document was corrected with them**, which left this document set contradicting its own data for seven days. Prose has no failing test, so a data fix lands silently and leaves every sentence about that data stale. **Documents were reconciled on 17 September. The class of error is the thing to watch, not this instance.** See "Decision log", D45.
- **Production applies currently run from a workstation.** Acceptable for a cutover week, not acceptable permanently. Moving them into a pipeline with the plan posted for review and the apply gated on approval is a named handover item.
- **No dedicated history aware secret scanner was run against the inherited repository.** The manual sweep found nothing across all objects on all references, so the finding is defensible rather than evidenced. Ten minutes on a machine that has the tool.

### 5.8 One exposure, and it is the reverse of what this section used to say

**The shipped tags ARE write protected and Trevean holds no password for them.** Confirmed 11 September 2026. This section previously said the opposite and warned about the opposite exposure; that reading is superseded. See "Decision log", D45 and D18.

**The good half:** a jar on a shelf cannot be rewritten by a passer by with a phone. The exposure this section used to describe does not exist.

**The bad half, and it is the one to act on.** **A locked NDEF area cannot be rewritten without the ST25TV area password, and nobody at Trevean is nominated as holding it.** If those 1,000 jars ever need to point somewhere else, that password is the only route and there is currently no route at all. The supplier may have kept it, sent it, or generated it and discarded it. **Which of those is true gets harder to establish every month and becomes impossible once the supplier relationship ends.** Asked of the client on 11 and 16 September 2026 and unanswered.

**What follows from it.** The redirect table is not the primary recovery mechanism ahead of an expensive fallback; **it is the only recovery mechanism there is.** Treat it accordingly. And for future runs, the decision the M4 tooling exists to execute is now sharper: ship protected with a password Trevean generates and holds in the managed secret store, so this situation is not inherited twice.

### 5.9 The printed instruction copy is a known defect, and it must not be reproduced on the page

**Recorded Thursday 27 August 2026. This is the one item in this section that a well meaning future change will reintroduce, because reintroducing it looks like doing the right thing.**

**The requirement.** The Acceptance criteria document, section 6.3: on pack and on page instruction copy is **platform specific**, and **copy describing one platform's behaviour as universal is a defect, not a wording preference.** The agreed copy, reproduced here in full so it does not have to be chased:

> **iPhone:** Wake your phone, hold the top of the phone near the NFC symbol, and tap the notification when it appears.
>
> **Android:** Unlock your phone and hold the NFC antenna area near the NFC symbol. The page should open automatically.

**The state of the world.** **The printed labels read TAP YOUR PHONE TO THE LID.** That is on stock already printed, it fails the criterion, and whether it is accepted or reprinted is a client decision that was open as at Thursday 27 August 2026. **It is wrong three ways and all three are measured, not argued:** on iPhone a tap raises a banner the customer must then tap rather than opening the page, on any phone with the screen off nothing happens at all, and on a locked Android nothing happens either.

**What you must not do, stated as an instruction because that is what it is.**

- **Do not write "tap your phone" as universal microcopy anywhere on the page**, in a hint, an empty state, an error state, a CMS default value, a placeholder string, an email, or native app onboarding.
- **Do not "match the packaging".** That instinct is exactly how this gets reintroduced. **The packaging carries a known defect and the page is not required to inherit it**, and matching it would put a contractual defect into the one surface still under version control.
- **Do not collapse the two platform variants into one line to save space.** The two behaviours genuinely differ and the criterion is about that difference. If space is the problem, detect the platform or show both.
- **Do not present instruction copy as the fix for a failed tap.** **Screen off is zero reads on every phone and locked Android is zero**, and no wording changes that. **The QR is the recovery route for that customer**, which is why section 5.2 matters more than a parity clause suggests.

**Why this is in a handoff document rather than only in a project message.** A future developer will at some point be handed a jar, read the lid, and make the page say the same thing. **That is the failure. It is cheap to prevent by reading this paragraph and expensive to find, because it fails a criterion rather than a test.**

### 5.10 The Persian Sunrise composition, and the provenance the page must not assert

**Recorded Thursday 27 August 2026 from the client's blend production specification, version 1.2, dated 22 June 2026. This section and section 5.9 are the two items here that a well meaning future change will undo, because undoing them looks like doing the right thing.**

#### 5.10.1 The composition, corrected

**This is the authoritative source for blend composition. It outranks the Scope document and it outranks the printed label**, because it is the client's own manufacturing document with weights, tolerances and mesh specifications rather than a marketing artefact.

| Ingredient | Weight | Percentage |
|---|---|---|
| Ceylon cinnamon (*Cinnamomum verum*) | 250 g | **50%** |
| Green cardamom seeds, decorticated | 125 g | **25%** |
| Ground Omani dried lime (limoo Omani) | 100 g | **20%** |
| Dried rose petals, culinary grade | 24.5 g | **4.9%** |
| Saffron threads, Spanish preferred, Afghan acceptable | 0.5 g | **0.1%** |

**What was wrong before, said plainly so nobody restores it.** The project record carried **saffron, cardamom, rose petals and lime**: four items, **no cinnamon, which is half the blend by weight**, and led by saffron, which is one part in a thousand. **That list is still in the content fixtures as at Thursday 27 August 2026** and it is wrong. The fixture is `build/content/fixtures/blends/persian-sunrise.json`, and the same four item list is repeated in the placeholder tagline, in the placeholder convention document and in the generated seed dry run report.

**Do not restore the four item list from any older document.** Several project documents predate this correction and still carry it. **If you find a four ingredient Persian Sunrise anywhere, it is stale, and the production specification is what it is measured against.**

#### 5.10.2 The provenance finding, and why the page cannot match the label

**The blend contains no Iranian ingredients, and has not since June 2026.** The specification records every Iranian origin item substituted out, citing the OFAC prohibition on Iranian origin imports at 31 CFR Part 560:

| Was | Is now |
|---|---|
| Iranian cinnamon | **Ceylon cinnamon** |
| Persian lime | **Omani dried lime** |
| Iranian saffron | **Spanish preferred, Afghan acceptable. Never Iranian** |

**The printed label names a grower at coordinates in the Kashan area of Iran, on a jar whose saffron is Spanish, whose cinnamon is Ceylonese and whose lime is Omani.** The client keeps the printed stock for this run and has said it will be addressed with a specific mention on the website.

**No view is offered here on the label, on the sanctions position, or on what the website should say. None of the three is an engineering question, none is this package's to answer, and nothing here is legal advice.**

**What is binding on a developer, stated as an instruction because that is what it is.**

- **Do not write a named grower, a farm coordinate or an origin story for Persian Sunrise into the fixtures, the CMS defaults, the seed data or any page**, from the printed label, from the live marketing site, or from any older project document. **All three carry the pre-substitution provenance.**
- **Do not "make the page match the jar" on origin.** That instinct is correct for composition and wrong here. **The composition on the label is true of the jar. The provenance on the label is not.** Section 5.9 names the same instinct failing on instruction copy, and this is the second place it fails.
- **Do not treat this as a copywriting task waiting on a writer.** **What the Persian Sunrise page says about origin is a client decision that had not been made as at Thursday 27 August 2026**, and it is the client's and its counsel's to make.

**Why this is in a handoff document rather than only in a project message.** This product exists to answer one question for a customer holding a jar: where did this come from. The tap opens a page headed by origin and grower. **A future developer will find the grower fields empty, find a named farmer and a set of coordinates on the label and on the live site, and fill them in, believing they are completing an obvious gap.** **That would put a false provenance claim on the exact surface whose purpose is provenance, which is a different and worse thing than an out of date label, because the page is the product.** **It is cheap to prevent by reading this section and expensive to find.**

**What is safe, and it is worth naming so the section does not read as a blanket freeze.** The composition in section 5.10.1 is safe and should be written in. **Caribbean Sunset carries no sourcing exposure at all** per the same specification, and its origin content is a normal content item. **Only Persian Sunrise's origin is blocked, and only on origin.**

**One thing the same specification gives that is useful and unblocked.** Section 6.2 sets finished product storage at 18 to 20 degrees, 45 to 55 percent relative humidity, protected from light, **with a maximum storage time of six months.** **That is a real basis for a best before date rather than an invented one**, and section 7.2 sets the required label fields: product name, batch number, production date, best before date, storage instructions and allergen information. **Worth checking the blend page against**, since a customer may reasonably expect the page to carry what the jar carries.

---

## 6. What is not known

Distinguished from what is owed, because nobody can pay these off by working harder.

### 6.1 Where the marketing site lives. **Answered on Monday 24 August 2026, and the answer opened a different question**

**The marketing site is live on Vercel**, with real content including named growers and farm coordinates. That settles the ambiguity this section previously recorded, in which the record said one platform on 12 August and the client described two other things as being on a different platform on 19 August.

**Three things follow, and none of them is a technicality.**

1. **It does not settle where the printed QR codes point.** That is a question about ink on labels that were printed before any of this, and it is still open. The photograph of a printed label that would answer it has been asked for and has not arrived. Section 5.2.
2. **It opens a real architectural option that this package previously did not contemplate.** With a live Vercel site, no AWS member account, and a thousand jars in the field, serving the apex and the five tag routes from Vercel first is the obvious interim answer. **The six properties an interim host must preserve are in the document titled "Architecture and the reasoning behind it", section 9.1**, and they are what make the eventual move to CloudFront a deploy rather than a rebuild.
3. **The site's content and the content fixtures disagree in two visible places.** The site places the Persian Sunrise grower near Kashan where the packaging conversation recorded Isfahan, about 150 km apart. The site lists six blends, against four codes on physical tags, a fifth reserved, and five blends in the plan. **A sixth blend is not a content question, it is a schedule event**, because the slug enum is closed to five and opening it is a breaking change to the frozen contract. See section 6.2. **Nothing should be copied out of the live site into the fixtures until both are answered by the client.**

**Overtaken on Thursday 27 August 2026, on the origin half only, and it is worth reading before treating Kashan versus Isfahan as the open question.** **The production specification records that the blend contains no Iranian ingredients and has not since June 2026.** So the live question is not which of two Iranian origins the page should carry. **It is what the page can say at all about origin, given that the ingredients are sourced from Spain, Sri Lanka and Oman.** **That is a client decision and no view is offered on it here.** Section 5.10.2. **The six blend listing is untouched by this and is still open.**

### 6.2 Decisions never confirmed by the client

Each of these is a real product decision that was proposed with a recommendation and never answered. They are listed so a new developer does not mistake a default for a decision.

| Item | Proposed | Consequence of leaving it |
|---|---|---|
| Scan deduplication window | 30 minutes | Counts mean slightly different things than anyone assumed. |
| Raw scan event retention | 400 days, rollups kept indefinitely | Below a year, a disputed number cannot be recomputed, because raw events are the reconciliation source for the rollups. |
| Whether the after paint catalog refresh runs at all | Keep it, it is cheap and degrades cleanly | One extra request after paint, or a price only as fresh as the last publish. |
| Analytics audience: one person or marketing self serve | Build for self serve, same effort | Decides whether the Viewer role has real users. |
| Whether an editor ever sees publish progress | Either add the operation or delete the promise | The contract currently promises a status URL that nothing serves. |
| Whether a sixth blend is ever expected | Know it in August | The slug enum is closed to five. Opening it is a breaking change and a schedule event. |
| Whether the farm map ships as a static image with a link out | Yes, static | A map library is 200 KB to 800 KB of JavaScript, larger than the entire page budget. |
| The viewport floor against one matrix handset | Either move the floor to 360 px or test that handset off its default display setting | The page has no horizontal overflow at 360 px either way, so this is a reporting question rather than a build one. |

### 6.3 Things that only the future can answer

- **Whether an operating system update changes background read or banner behaviour after acceptance.** Measured on the OS versions current at the time. Re run the matrix on then current versions; any change is a finding rather than a contractor defect.
- **Whether the render cache behaves under real concurrency.** The configuration is right and the definitive test has to be run against the real host, because configuration alone has fooled competent people.
- **Whether the 2.0 seconds holds on a real cellular connection with real photography.** Every figure to date is a floor, not a proof.

---

## 7. Parked, not dropped

Recorded so that "we decided not to" is distinguishable from "nobody thought of it".

| Item | Why it is parked |
|---|---|
| **Native app** | Deferred to a later phase. Seams left open. Section 4. |
| **Environmental and freshness sensors, an LED locate feature, energy harvesting** | Exceeded the chip's capabilities. A separate hardware programme exists for the sensing module and it is not this project. |
| **Blockchain traceability, augmented reality, voice, restaurant scale inventory** | Future roadmap. |
| **Custom hardware or PCB** | A separate programme. |
| **Cryptographic anti counterfeit** | Available on the chip and dormant. Section 2. **A next tag order decision.** |
| **Subscription billing, customer accounts, customer login** | Reorder runs through the store's own checkout. Adding accounts introduces a customer credential surface to a product that deliberately has none. |
| **Content writing, photography, translation** | Never in scope. |
| **On site work and physical assembly** | Remote engagement. The tooling, instrumentation and protocols are delivered so Trevean staff execute the physical steps, and the data is read and signed off. Applying inlays at production volume is Trevean's packaging operation. |
| **Packaging or lid design changes** | If the data says the lid must change, that is Trevean's decision and cost. The measurements and costed options are brought; the decision is not the contractor's. |

---

## 8. The three questions worth asking before the next phase starts

Not deliverables. They are the questions whose answers are cheap now and expensive in a year, and they are written here because the person who reads this document in a year is exactly the person who should ask them.

1. **Is there a phase after this one, and does it include a native app, retail rollout, more SKUs, or multiple stores?** Seams left deliberately are nearly free; retrofitted they are not, and section 4 is only worth what it is worth if somebody knows the answer before the next tag order.
2. **Does Trevean intend to sell this platform to other brands?** Multi store credential handling is cheap up front and expensive to retrofit, and every decision in this build assumed a single brand.
3. **When is the next tag order, and who places it?** Because that is the only moment at which Augmented NDEF and TruST25 can be turned on, and it is the one deadline in this document that nobody will send a reminder about.
