# M5 handoff package

> ## UPDATE, WEDNESDAY 21 OCTOBER 2026. THIS NOTE OUTRANKS THE 30 SEPTEMBER BLOCK BELOW IT.
>
> | | |
> |---|---|
> | **The jars still work** | They redirect correctly through the client's **Vercel** site. Measured on 21 October 2026: **10 of 10 checks pass** |
> | **The domain switch is now a DNS move** | Agreed on 20 October 2026: DNS for `treveanspice.com` moves to **Route 53 in Trevean's AWS account**. The nameserver change at Bluehost is planned for **Friday 23 October 2026**, after every existing record has been copied and checked. **Bluehost stays the registrar** unless Trevean chooses to move it |
> | **The Vercel redirects stay** | They remain in place until that move is done |
> | **New blank tags** | Arrived on 21 October 2026 for the staff encoding test |
>
> # CURRENT STATE, WEDNESDAY 30 SEPTEMBER 2026. THIS BLOCK OUTRANKS EVERYTHING BELOW IT.
>
> **This package is written as a dated narrative, mostly "as at Tuesday 25 August 2026". That structure is deliberate and is being kept.** What follows is what is true today, and **where any statement below disagrees with this block, this block wins.**
>
> | | |
> |---|---|
> | **The jars work** | Verified against `https://treveanspice.com`: **13 of 13 checks, 150 of 150 casing and trailing slash variants.** All four encoded codes and both QR routes reach the right blend page, and an unrecognised code gets a branded page. **R1 closed after 34 days.** Reproduce with `node tools/demo-readiness.mjs` |
> | **How they were fixed** | The redirect configuration was published to the client's **Vercel** project on 18 September 2026. **The DNS cutover to CloudFront has NOT happened.** The domain still points where it did |
> | **The apex certificate** | **ISSUED** 18 September 2026, both names, valid to 3 April 2027, Terraform owned. **Deliberately idle:** `InUseBy` is empty. The cutover has an ordering hazard set out in "Operations runbook", section 9 |
> | **Deployed** | AWS account `888348806392`, `us-east-1`. Content API, scan beacon, admin API, admin CMS, publisher on Fargate, five DynamoDB tables. **Anything below saying "nothing is deployed to AWS" is a statement about August** |
> | **The tags ARE write protected** | Reversed on 11 September 2026. **Nobody at Trevean holds the ST25TV area password**, so the 1,000 shipped tags cannot be re encoded by anyone. **Anything below saying they carry no write protection is superseded.** See "Decision log", D45 |
> | **The M2 gate** | **Partly run and unratified.** Client ran physical taps 24 to 30 September on real jars and production lids: all four iPhones pass, Samsung S23 passes 10 of 10, QR verified on every blend, adjacent jar repeated on production materials. **Three Android handsets remain** |
> | **The demo** | Held Sunday 27 September 2026 and went well. Further investor meetings booked |
> | **M4 and M5** | **Neither is complete.** See "M4 status" and "M5 status" |
>
> **The one fact in this package most likely to mislead** is the repeated "the apex returns HTTP 403 and `/t/ps` returns HTTP 500". **That was true in August and is not true now.**


**Deliverable:** M5, due Wednesday 30 September 2026
**Written:** Saturday 22 August 2026, ahead of its date
**Revised:** Tuesday 25 August 2026, after an internal review found four statements about what exists that were wrong. **Revised again Thursday 27 August 2026**, after a text conversion of the Persian Sunrise printed label, captured by the client on Wednesday 26 August 2026 and read here on Thursday 27 August 2026, produced two content facts, one known defect a future developer must not reintroduce, and no decoded QR. **Revised again later the same day**, after the client's blend production specification version 1.2 corrected the composition our record carried and established that the blend contains no Iranian ingredients, which makes the label's provenance a second thing a future developer must not reproduce on the page. What changed is listed below rather than folded in silently.
**Prepared by:** Serene Labs Inc (Jacob Ralph) for Trevean Spice
**Status:** written early because it has no external dependency. Every statement about what exists is a statement about Tuesday 25 August 2026, **except the package test counts, which were re-run on Thursday 27 August 2026 and are current as at that date.** Two of them moved that day. See the package table below.

---

## Who this is for

**A developer Trevean hires who has never spoken to anyone on this project.**

That is not a rhetorical framing, it is the contractual one. Under the Scope document, "IP and handoff", every deliverable is work for hire owned by Trevean Spice on full payment, delivered as source with the right to use, modify, **and engage any third party to modify**. That last clause decides how this package is written. It assumes no access to Serene Labs, no access to the Upwork thread, no meeting, and no memory of any conversation. Where something can only be understood by knowing why it was decided, the reasoning is here rather than in a person.

Trevean's own staff are the second audience. The runbooks are written so a person who is not a developer can follow them, and each one says at the top whether it needs a developer or does not.

---

## The seven documents

| # | Document title | What it answers |
|---|---|---|
| 1 | **Orientation for a new developer** | The six facts that get assumed wrong and cost days. Read this before anything else, including before opening any code. |
| 2 | **Architecture and the reasoning behind it** | How the system works, and why it is shaped this way. The decisions that look strange are the ones a new developer will undo, so each one carries its reasoning. |
| 3 | **API reference** | Every operation, verified against the frozen OpenAPI document, plus the tap path discipline a specification cannot express. |
| 4 | **Runbooks** | Deploy, roll back, rotate secrets, edit the redirect table, answer the cache hit ratio alarm, answer a wrong blend page report, encode a tag batch, cut DNS over and roll it back. |
| 5 | **Third party libraries and licences** | Every pre existing library in every package, consolidated, satisfying the background IP obligation in one place. |
| 6 | **Knowledge transfer session plan** | The agenda, what is demonstrated live, and what the attendee can do unaided afterwards. |
| 7 | **Limitations and future work** | What is deliberately dormant and why, the native app seams, and the known debts. Written honestly rather than reassuringly. |

Cross references throughout this package are by document title and section number, never by filename, so they survive files being renamed or moved into `nfc-development`.

---

## What changed between Saturday 22 August and Tuesday 25 August 2026

Four statements in the 22 August version were wrong and one document rested on a domain state that no longer holds. They are listed rather than quietly corrected, because a reader who has seen the earlier version needs to know which one to trust.

| What it said | What is true |
|---|---|
| The admin CMS, the chip programming tool, the Shopify integration and the analytics dashboard are "not built at all yet" | **All four exist**, with source, tests and lockfiles. See the table below for what each one is and is not proven against. |
| Six packages exist under `build/` | **Eleven do.** |
| The third party libraries document consolidates every package manifest | **It listed six of eleven.** It now consolidates all eleven and is generated rather than hand kept. |
| The registrar transfer is in flight and the domain does not yet resolve to anything this project controls | **The transfer completed, the zone stopped answering, and later on Tuesday 25 August 2026 it came back.** `treveanspice.com` resolves at `ns1.bluehost.com` and `ns2.bluehost.com` with an apex A record of `50.6.2.51`, **and email on it is fully restored: MX to `smtp.google.com`, SPF, a Google DKIM selector and DMARC, all four verified.** **The apex returns HTTP 403 and `/t/ps` returns HTTP 500**, because the domain points at Bluehost rather than at the deployment. So the jars reach an error rather than nothing. See the document titled "Runbooks", section 9.1, which is corrected accordingly. |

**Three facts arrived in the same window and are load bearing elsewhere in this package.** **Corrected Thursday 27 August 2026: the M2 date is held. Our delivery is Friday 28 August 2026, the day for day slip is withdrawn and absorbed on our side, and the acceptance run is booked the day a named tester and the physical materials exist. Monday 31 August 2026 and Thursday 3 September 2026 are superseded** (D27). The 1,000 shipped tags carry **no write protection**, confirmed by the client, so they can be re encoded if it ever comes to that. The client's marketing site is **live on Vercel with real content including named growers**, which makes serving the tag redirect from Vercel first a live option. See the document titled "Architecture and the reasoning behind it", section 9.1.

---

## What changed on Thursday 27 August 2026

**A text conversion of the Persian Sunrise printed label, captured by the client on Wednesday 26 August 2026, reached us and was read on Thursday 27 August 2026. Nothing about the packages changes. Three things a future developer needs change, and one thing that was hoped for did not happen.**

| | |
|---|---|
| **A real harvest date exists: April 2026** | Printed on the product. **It is not in the fixtures yet and there is a reason.** See the document titled "Limitations and future work", section 5.6, including the history: a **fabricated** 12 May 2026 was removed from the API seed on Saturday 22 August 2026, that removal was correct, and April 2026 goes in only once the client confirms the file is final artwork rather than a proof |
| **The composition our record carried was wrong, and it is now corrected** | **Updated later on Thursday 27 August 2026 from the client's own blend production specification, version 1.2, which is the authoritative source and outranks both the Scope document and the label.** **Persian Sunrise is Ceylon cinnamon 50 percent, green cardamom 25, ground Omani dried lime 20, dried rose petals 4.9, saffron 0.1.** The project record carried four ingredients and **omitted cinnamon, which is half the blend by weight.** **The four item list is still in the fixtures and it is stale. Do not restore it from any older document.** **This one does not wait on the artwork confirmation, unlike the harvest date**, because a production specification is a manufacturing document where a label may be a proof. "Limitations and future work", section 5.10.1 |
| **The blend contains no Iranian ingredients, and the label says otherwise** | **Recorded later on Thursday 27 August 2026 from the same specification.** Every Iranian origin item was substituted out in June 2026 under the OFAC prohibition on Iranian origin imports: Ceylon cinnamon, Omani dried lime, saffron Spanish or Afghan. **The printed label names a grower at coordinates in the Kashan area of Iran, on a jar sourced from Spain, Sri Lanka and Oman.** **No view is offered anywhere in this package on the label, the sanctions position or what the website should say, and none should be added.** **What binds a developer is narrow: the blend page cannot repeat the label's provenance, because it is not true of the jar, on the one page whose entire purpose is provenance.** **Do not fill in the empty grower fields from the label, from the live site, or from any older project document.** What the page says about origin is a client decision. "Limitations and future work", section 5.10.2 |
| **The printed instruction copy is a known defect** | The labels read **TAP YOUR PHONE TO THE LID**, which is universal copy where the requirement is platform specific. **Do not make the page match the jar.** This is the item most likely to be reintroduced by a well meaning change and it now has its own section: "Limitations and future work", section 5.9, with the agreed copy reproduced in full |
| **The QR is still not decoded, and this file could never have decoded it** | A text conversion reads printed characters and **a QR symbol is an image**. The words TREVEANSPICE.COM printed beside the code are the human readable domain, **not** evidence of what the code encodes. **The question is open and the trap is named** in "Limitations and future work", section 5.2 |

**One thing that changed on Thursday 27 August 2026 and is worth saying because it is what a reader will ask.** **Our M2 delivery is held at Friday 28 August 2026 and the day for day slip from Friday 21 August is withdrawn, absorbed on our side.** **The acceptance run is a separate thing and carries no date**: under decision D7 it is Trevean staff on Trevean materials, and it needs a named tester, an answered Q6 and physical jars with interim lids at 8 mm or thicker, none of which exists. **Monday 31 August 2026 and Thursday 3 September 2026 are superseded.** **Do not quote a date for the acceptance run from any document in this package or any other, and do not write our delivery date as the gate.** See "Decision log", D27.

---

## What is true on the day this was revised, stated first

A handoff document that describes an intended state as an existing one is worse than no document, because it sends the reader looking for something that is not there. **The inverse is just as bad: the 22 August version sent readers away from four packages that were there.** So, plainly, and package by package.

### Eleven packages exist under `build/`. This is what each one is.

Test and check counts re-verified **Thursday 27 August 2026** by running each suite on this machine. **Two moved that day and both are marked in the table: `build/api` from 125 to 144, and `build/contract-tests` from 201 of 202 to 202 of 202 when the `pageVersion` bound was applied to the frozen contract.** The other nine are unchanged from the Tuesday 25 August run. **Re-run before quoting any of it.**

| Package | What it is | State | Proven against |
|---|---|---|---|
| `build/edge` | The `/t/` and `/q/` redirect, its table, compiler and validator | **132 tests passing** | Itself, in a sandbox that approximates the edge runtime. **Never deployed to any edge.** |
| `build/api` | The REST API against the frozen contract | **144 tests passing**, 12 test files. **Moved on Thursday 27 August 2026: it was 125 across 9 files** | An in process database on a developer machine. **Never deployed. Never run against real DynamoDB.** |
| `build/web` | The consumer blend pages | **204 checks passing**, Lighthouse performance 100 | The placeholder build on a developer machine. **Never deployed. Never built with real content or real photography.** |
| `build/contract-tests` | Enforces the frozen OpenAPI document | **202 tests, 202 passing, 0 failing**, 36 suites. **Moved on Thursday 27 August 2026: it was 201 of 202** | Its own in memory stub, and it can be pointed at the API package locally. **The one deliberate failure it carried from 17 August is closed.** It went green because the defect it was holding visible, `pageVersion` unbounded above, was fixed in the frozen document, not because any test was skipped or relaxed. See the contract errata, section 15. |
| `build/content` | Five blends, growers, recipes, catalog records, placeholder imagery, seeding | **13 checks passing** | Itself. **Content is placeholder throughout.** |
| `build/infrastructure` | Terraform for the whole stack | Written, formatted, validated, planned | **Never applied.** See "Not deployed" below. |
| `build/admin` | The admin CMS: blend, recipe and grower editors, roles, preview, media library | **169 tests passing** | The API package locally. **Never deployed. No real editor has ever used it.** The M3 acceptance bar is a member of Trevean's marketing team publishing a blend end to end unaided, and that has not happened. |
| `build/chip-cli` | The tag programming tool and batch workflow | **134 tests passing**, 115 files | **A software model of the chip.** It has never been run against a physical tag or a physical reader, and the reader transport is an unimplemented stub. This is the single largest gap between a passing suite and a working deliverable in this package. |
| `build/shopify` | Cart permalinks, webhook verification, catalog sync, reorder resolution | **220 tests passing** | Hand built fixtures. **It has never spoken to a Shopify store.** There is no store access. Cryptography and string building are genuinely proven; every claim about Trevean's catalog, prices, SKUs or webhook deliveries is not. |
| `build/dashboard` | The scan analytics dashboard, one screen | **105 tests passing** | Seeded rollups against a local database. **Never deployed. Never shown a real scan.** |
| `build/consolidation` | Twelve pull requests that adopt the above into the client repository | Written, reviewed, **not merged** | Nothing. An internal review of Monday 24 August 2026 found the pull request ordering produces four red CI jobs on arrival. **Read that review before following the order.** |

**The measurement harness self test passes.** It is an M1 deliverable and is vendored into the consumer pages package.

**The pattern across that table is worth naming once rather than reading eleven times: everything is proven against a model and nothing is proven against reality.** No package has been deployed. No package has met a physical tag, a live Shopify store, a real editor, a real scan, or real content. That is a statement about where the project is on Tuesday 25 August 2026 and not a criticism of the packages, several of which are proven more thoroughly against their models than most shipped code is against anything. **It does decide what a reader should trust: the tests tell you the code does what it was written to do, and they tell you nothing about whether it was written against the world.**

### Not deployed

> **CORRECTED Thursday 27 August 2026. The second paragraph below was wrong and is struck rather than deleted.** `888348806392` is `Trevean-NFC-Development`, the development account, `aws-dev@treveanspice.com`. The Organization management account is `[account id withheld]`, `Trevean Spice`, org `o-q36zht9ztn`. The two were recorded the wrong way round from Monday 24 August to Thursday 27 August 2026. **The development environment was then applied into `888348806392` on Thursday 27 August 2026: 169 resources, distribution `d1uyspgs0bmg3a.cloudfront.net`, all five tag codes verified end to end.** See the document titled "The deployed development environment", and "Decision log", D32.

**As at Tuesday 25 August 2026 nothing had been applied to AWS.** Account 888348806392 held one object, the Terraform state bucket `trevean-tfstate-888348806392`. No certificate, no distribution, no hosted zone, no table, no function. **All of those exist in it now**, per the correction above.

~~**The account is the management account of an Organization, and there is no member account beneath it.** That is the most important single fact about deploying here.~~ **Withdrawn. It is the development account and it is the correct deployment target**, which is set out in the document titled "Runbooks", section 2.2. The 140 resource plan saved on Wednesday 19 August 2026 was planned against that account, which was the right account, and it is superseded by the apply rather than void for the reason previously given. Delete it rather than trust it.

### The domain resolves, and it answers the wrong thing

**Corrected later on Tuesday 25 August 2026. The earlier statement in this package, that `treveanspice.com` returns SERVFAIL, is superseded.**

**`treveanspice.com` resolves.** Nameservers `ns1.bluehost.com` and `ns2.bluehost.com`, apex A record `50.6.2.51`. **Email on the domain is fully restored**, verified across all four records: MX to `smtp.google.com`, SPF, a Google DKIM selector, and DMARC. The paragraph this replaced said email was very likely not working, and for a period it very likely was not. **It is working now and it was checked rather than assumed.**

> **SUPERSEDED WEDNESDAY 30 SEPTEMBER 2026. THE JARS WORK.** This paragraph said the apex returned 403, `/t/ps` returned 500, and a thousand encoded jars reached an error. **All three were true when written and none is true now.** Verified against `https://treveanspice.com`: **13 of 13 checks pass and 150 of 150 casing and trailing slash variants resolve correctly**, all four encoded codes and both QR routes reaching the right blend page, with a branded page for unrecognised codes. **R1 is closed after 34 days.** Reproduce it in five seconds with `node tools/demo-readiness.mjs`. See "Decision log", D56 and D61.
>
> **The fix was not the DNS cutover.** The redirects were published to the client's Vercel project on Friday 18 September 2026, so **the domain still points at Bluehost and Vercel, exactly as the paragraph below describes.** The apex certificate exists and is deliberately idle; the cutover to CloudFront is a separate decision with its own ordering hazard, set out in "Operations runbook", section 9.

**The paragraph as it stood, preserved because the reasoning around it still applies:** the apex returned HTTP 403 and `/t/ps` returned HTTP 500, because the domain pointed at Bluehost rather than at the deployment that serves the site and the tag routes. A thousand encoded jars reached an error rather than nothing. That was a different failure, not a fixed one.

**What it changes for this package.** Procedures that assumed an authoritative zone to export, to compare against, or to revert to **are available again**, which they were not a few hours earlier. **One task now blocks the rest and nobody has done it: export the zone verbatim as the rollback record.** The records could not be read out of DNS while DNS was down, that window has already closed once this month, and it costs minutes to take the export on a day when nothing is on fire. See the document titled "Runbooks", section 9.1.

**One thing got harder rather than easier.** The zone carries live company email, so every DNS step in this package now has a business consequence it did not have when the zone was empty of anything working. The infrastructure package refuses to create a hosted zone with no MX records unless an acknowledgement flag is set explicitly.

### The M2 tap through gate has not run

> **UPDATED WEDNESDAY 30 SEPTEMBER 2026, AND IT IS SUBSTANTIALLY UNDERWAY.** Between 24 and 30 September the client ran physical taps on **real jars, with printed labels, tags fitted under production lids**. **All four iPhones pass. The Samsung S23 passes at 10 of 10.** QR codes were verified against every blend, and the adjacent jar test was repeated on production materials, where the August run used interim lids. **Three Android handsets remain**: Pixel 6, Pixel 8 Pro and Galaxy S24 Ultra.
>
> **Whether this constitutes the formal gate is an open question with the client**, because D7 requires a named tester, recorded footage and specific tap counts, and "we have been testing" establishes none of those. **The sentence below is no longer true as written**, and the honest statement is that the gate is partly run and unratified rather than not run.

Section 6.1 of the Acceptance criteria document is met on the 6 August 2026 bench data, on salvaged lids, on an office network, on a test page with no photography, and without the production redirect in the measured path. **It was not met on the production stack when this was written, because the production stack did not exist yet.**

**The acceptance run has no date.** Five client dependencies missed Friday 21 August 2026: a named tester with two days booked, Q6 answered, the physical materials, the launch blend content and the domain pointed at the deployment. **Q6 closed later on Thursday 27 August 2026, at the full eight handset matrix across two full days, with the operating system versions confirmed on all eight handsets and the iPhone 8 excluded. That sizes the run at 560 taps and books nothing. The other four are outstanding.** **A change to the blends the run is measured on is proposed and not agreed**, which would make it 440 taps, or 360 on the narrower reading of the adjacent jar test. **Our own M2 delivery is held at Friday 28 August 2026 and the day for day slip on it is withdrawn, absorbed on our side** (D27). **That does not date this run**, because under decision D7 the taps are Trevean's staff on Trevean's materials and no amount of engineering effort produces a tester or a jar. **Monday 31 August 2026 and Thursday 3 September 2026 are superseded.** **Do not quote a date for this run from any document in this package or any other, and do not read Friday 28 August as one.** The Milestones and dates document is the authority.

### Content is placeholder

Real content for Persian Sunrise and Caribbean Sunset has not been delivered to us. Every page in the current build carries a placeholder banner by design.

**One thing improved on Monday 24 August 2026:** the client's marketing site is live on Vercel and carries real content including named growers and farm coordinates. That is genuinely useful and it is not yet reconciled: the site places the Persian Sunrise grower near Kashan where the packaging conversation recorded Isfahan, about 150 km apart, and the site lists six blends where the plan has five. **Neither is resolved, and nothing should be copied out of the live site into the fixtures until both are.**

**Sharpened on Thursday 27 August 2026.** **The printed label agrees with the site rather than with the packaging conversation**: it prints coordinates resolving to the Kashan area and names the grower in print. **That does not make it safe to copy.** Persian Sunrise's origin content is subject to a United States export controls question the client raised with its counsel, and it now touches printed inventory and a named individual rather than only a web page. **No view is offered on that question anywhere in this package and none should be added.** The instruction stands unchanged: **nothing is copied out of the live site, or off the label, into the fixtures until the client answers.** See "Limitations and future work", sections 5.6 and 6.1.

**Sharpened again later the same day, and this is the version to read.** **The blend production specification records that Persian Sunrise contains no Iranian ingredients and has not since June 2026.** So the question is no longer which of two Iranian origins is right. **It is what the page can say about origin at all, on a jar whose ingredients come from Spain, Sri Lanka and Oman while the label names an Iranian grower at Iranian coordinates.** **The page cannot assert an origin the product does not have, and that page cannot be written until the client decides what it does assert.** **The composition, by contrast, is settled and should be corrected in the fixtures.** See "Limitations and future work", section 5.10.

Each runbook in the document titled "Runbooks" says at its head whether it can be executed today or whether it is a procedure waiting on something. None of them pretends.

---

## The five numbers this package turns on

Check any figure you read anywhere against these. Stale numbers are the main risk in a project that has already revised the lid thickness, the chip family and the milestone structure.

| Figure | Value | Where it comes from |
|---|---|---|
| Bamboo in the read path | **8 mm** | Corrected 12 August 2026 from a reported 4 mm. The 1.5 mm cork liner sits below the tag and does not count. |
| Worst case handset read distance | **18 mm**, iPhone XS, bare | Measured 6 August 2026, five confirming attempts. Roughly 2x margin over the 8 mm path. |
| Page readable | **within 2.0 seconds** of navigation start | Navigation start is the request for `/t/{code}`, not the request for `/blend.html` after the 307. The redirect hop is inside the budget. |
| Tag read success | **at least 98%** | On the supported device matrix, in the supported device states, ten taps per device per condition. |
| Tags in the field | **1,000**, four codes at 250 each | Encoded per SKU on 24 July 2026 and shipped before this engagement began. **Four codes are on physical tags, `ps`, `cs`, `sr` and `nm`. The fifth, `kg`, is reserved and is on no jar**, so do not go looking for a Kyoto Garden tag. Confirmed on 11 September 2026: **the shipped tags are write protected and Trevean does not hold the area password**, so re encoding them is not currently possible at all. See "Decision log", D45. |

---

## Reading order

1. **Orientation for a new developer.** Fifteen minutes. It is one page for a reason.
2. **Architecture and the reasoning behind it**, sections 1 to 4. This is the part that stops a well meant change from breaking a contractual criterion.
3. Then whichever of **API reference**, **Runbooks** or **Limitations and future work** matches what you have been asked to do.

The document titled "Knowledge transfer session plan" is for the session itself and does not need reading in advance by anyone except the person running it.
