# Decision log

Every decision that would be expensive to revisit, with the reasoning attached. Newest first.

---

**This copy carries the engineering entries that the handover documents cite. Every other entry is withheld, and keeps its number so references still line up.**

## D67 · [entry withheld: internal]

---

## D66 · [entry withheld: internal]

---

## D65 · [entry withheld: internal]

---

## D64 · [entry withheld: internal]

---

## D63 · [entry withheld: internal]

---

## D62 · [entry withheld: internal]

---

## D61 · 26 Sep · Everything green at 13 of 13, the XS landed where predicted, and the distance drop may be a metal ruler we told them to use

**Saturday 26 September 2026, the day before the demo.** Dan finished physical testing at 7:28 AM and merged pull request 2.

**FIRST CLEAN SWEEP OF THE ENGAGEMENT.** `verify-live.mjs` against `https://treveanspice.com`: **13 of 13 checks pass, 150 of 150 casing and trailing slash variants.** `demo-readiness.mjs`: **10 passing, 0 warnings, 0 failing.** The branded 404 closed the last outstanding item.

**HIS PHYSICAL RESULTS:** real jars, production lids, **100 percent reads across all models**, **QR verified against every blend**, **iPhone XS at 12 to 15 mm**. Android and the old lid comparison move to next week.

**THE XS PREDICTION HELD.** D60 reasoned that a 29 percent drop applied to the 18 mm floor would land near 13 mm. **Measured: 12 to 15 mm.** Against an 8 mm lid that is 4 to 7 mm of slack and a margin of roughly 1.5x to 1.9x, down from roughly 2.25x in August. **It passes, at 100 percent, so the margin is a next lid order question rather than a demo question.**

**THE REAL FINDING IS THE INSTRUMENT, AND IT IS OURS.** Dan: **"hard to read accurately with the metal ruler we have."** Metal in a 13.56 MHz inductive field absorbs energy through eddy currents and detunes the antenna, so **a metal rule beside the phone and tag systematically understates the distance it is measuring.**

**M1 DELIVERABLE 4, STEP 6, SAYS "AGAINST A RULE OR CALIPER" AND NEVER SAYS NON METALLIC.** A steel caliper is worse than a steel rule. **We wrote the instruction that produced the confound.** The fix: a plastic rule or stacked cards of known thickness for the Android runs.

**TWO CONSEQUENCES BEYOND THE APOLOGY.** It may **dissolve his old versus new lid investigation** before he spends next week on it. And **it invalidates the August to September comparison itself**, because nobody recorded which instrument the 6 August run used, so the 28 to 20 and 18 to 12 figures may be measuring the ruler rather than the lids.

[paragraph withheld: internal]

[paragraph withheld: internal]

---

## D60 · [entry withheld: internal]

---

## D59 · [entry withheld: internal]

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

**`www` CAME BACK ON ITS OWN over the weekend.** Resolving on `8.8.8.8`, `1.1.1.1` and at `ns1.bluehost.com`, and **the apex now serves directly rather than bouncing through it**, so the fragile hop that failed twice on Friday is no longer in the path at all.

**THE TWO REMAINING FAILURES ARE OURS AND WERE FIXED THE SAME MORNING.** `/t/zz` and `/q/zz` do not serve the branded not found page SOW section 6.3 requires. `404.html` is one self contained file, 1,481 bytes, **no script, no stylesheet, no font, no external request**, because somebody reaching it is already having a bad moment on mobile data. **Pull request 2**, deliberately separate from the redirects because it changes the 404 for every unmatched URL rather than only `/t/` and `/q/`.

**WHAT THE CLOSURE OF R1 DOES NOT CHANGE, AND THIS IS THE PART THAT MATTERS ON 22 SEPTEMBER.** **The M2 tap test has still never been run.** Varun was named on 28 August and **no days have ever been booked.** The demo is Sunday 27 September, five days out, and the dress rehearsal is **tomorrow**.

[paragraph withheld: internal]

**One difference recorded rather than treated as a defect:** the destination renders client side, so a server side check cannot tell a correct blend from a transposed one. **Only the handset tap test can prove the right blend appears**, which is a second reason that booking is the critical path rather than a formality.

---

## D55 · [entry withheld: internal]

---

## D54 · 18 Sep · The certificate issued, and the flag that completes the cutover quietly does a second thing

**`ISSUED` at 11:49 AM on Friday 18 September 2026.** `4a15eeeb-b752-4228-9481-3b5a6503e517`, both `treveanspice.com` and `www.treveanspice.com` at `SUCCESS`, valid to 3 April 2027. **Verified two ways**, `describe-certificate` and `terraform output`, before anything was said to the client. **`InUseBy` is empty: issued and idle.**

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

**STEP 3 IS STILL BLOCKED ON A QUESTION FROM 8 SEPTEMBER.** CloudFront has no fixed IP, so the apex needs `ALIAS` or `ANAME`, **and whether Bluehost offers either is unanswered.** If not, the cutover becomes a nameserver migration with the client's Google Workspace MX in scope.

[paragraph withheld: internal]

---

## D53 · [entry withheld: internal]

---

## D52 · [entry withheld: internal]

---

## D51 · 18 Sep · R1 finally moves. Both validation records are live, and the cause was one field on a Bluehost form

**Verified against `8.8.8.8` rather than a local resolver.** Both `_c7232199....treveanspice.com` and `_f44b8d77....www.treveanspice.com` resolve to their `acm-validations.aws` targets.

**THE CAUSE, IN THE CLIENT'S OWN WORDS: "i inadvertently set the record to www instead of HOST."** Record One carried `.www` in the host field, so the name that existed was `_c7232199....www.treveanspice.com` and the name ACM looks for did not. **That is exactly the NXDOMAIN measured that morning**, and it is why he sincerely believed it was configured: from inside the form it looked right.

**THE BLUEHOST GOTCHA, WRITTEN DOWN BECAUSE IT WILL RECUR.** The host field is a **prefix**, with `.treveanspice.com` appended automatically. **Putting `www` there does not target the www hostname, it invents a different name**, and the form gives no indication.

[paragraph withheld: internal]

**Also checked: no stray left behind**, so he edited the record rather than adding a second one.

**WHAT THIS DOES NOT DO.** **The certificate is not the cutover.** `attach_apex_aliases` is still `false` and the jars resolve exactly as before. **R1 has moved for the first time since 19 August. It is not closed.**

---

## D50 · [entry withheld: internal]

---

## D49 · 17 Sep · The apex certificate is dead, the DNS record never existed, and NO terraform plan will ever tell anybody

**Three facts established by direct query against account `888348806392` on Thursday 17 September 2026, in this order, each one worse than the last.**

**1. The certificate has FAILED with `VALIDATION_TIMED_OUT`.** `arn:aws:acm:us-east-1:888348806392:certificate/b496d0b3-8dd9-4ffd-8636-dfca88415faf`, for `treveanspice.com`. It was reissued on 11 September with a fresh 72 hour clock and that clock ran out on 14 September.

**2. The validation record was never added.** `_c7232199b8fbe71a232eee44995e05ac.treveanspice.com` returns **NXDOMAIN** on a live lookup. **So the question asked of Dan twice is answered, and the answer is no.** It is not late, it is absent.

**3. AND THIS IS THE ONE THAT MATTERS: `terraform plan` reports "No changes."** Twice, including with `-replace` against the module address. **`terraform state list` returns nothing matching a certificate**, and the root module in `envs/dev` contains no `module "certificate"` block at all.

**THE CERTIFICATE IS UNMANAGED INFRASTRUCTURE.** `modules/certificate/main.tf` exists, is written, and **is never instantiated.** The live certificate was created outside Terraform, so Terraform cannot see it, cannot detect that it died, and will never repair it. **A dead certificate will now survive every future apply, silently, and the plan will keep saying the infrastructure matches the configuration.**

**Why this is worth a decision log entry rather than a ticket.** D19 criticised the inherited scaffold for exactly this: a deploy script reading a stack output for a stack whose template did not come with the code. **We have now done a smaller version of the same thing on the one resource the entire DNS cutover waits on.** R1 has been the longest running risk in this engagement, and the reason it has not moved is sitting outside the tool that is supposed to manage it.

**THE FIX IS TWO PARTS AND ONLY ONE IS URGENT.** Urgent: request a replacement certificate and send Dan the new validation record, because nothing about the domain can proceed without it. Not urgent but not optional: **wire `module.certificate` into `envs/dev`, import the live certificate, and delete the manual one**, so the next time it dies a plan says so.

**APPLIED Thursday 17 September 2026, on an explicit instruction, and the plan was exactly what it claimed: 1 to add, 0 to change, 0 to destroy.**

**The new certificate is `4a15eeeb-b752-4228-9481-3b5a6503e517`, `PENDING_VALIDATION`, and Terraform owns it.** The manual certificate `b496d0b3` was deleted afterwards, so the account holds one apex certificate and a plan can now see it die.

**The apex validation record is byte identical to the one sent on 11 September**, because ACM reuses the validation record per domain per account. **The certificate died, the record did not**, and the value he already has is still exactly right.

**A SECOND RECORD IS NEW AND IS THE ONE THAT WOULD HAVE BITTEN.** The certificate carries `www.treveanspice.com` as a subject alternative name and **ACM issues nothing until both names validate.** Had only the apex record gone in, the certificate would have sat pending indefinitely.

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

## D47 · [entry withheld: internal]

---

## D46 · [entry withheld: internal]

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

## D44 · [entry withheld: internal]

---

## D43 · [entry withheld: internal]

---

## D42 · [entry withheld: internal]

---

## D41 · [entry withheld: internal]

---

## D40 · [entry withheld: internal]

---

## D39 · [entry withheld: internal]

---

## D38 · [entry withheld: internal]

---

## D37 · 5 Sep · An origin access control against a Lambda function URL needs two permissions, not one. The missing one reads exactly like a signing fault

**What triggered it.** The API package was deployed to the three functions and every request through the distribution returned **403 with the generic function URL authorization message**, while the same function invoked directly returned 200 and a request signed by hand straight to the function URL returned 200 and a valid body. **So the code worked, the function URL worked, and only the CloudFront hop failed.**

**Decision: `build/infrastructure/modules/compute` now grants `lambda:InvokeFunction` alongside `lambda:InvokeFunctionUrl`, both scoped to the distribution ARN.** Applied, and `GET /v1/blends` through the distribution returns 200.

**Why it took as long as it did, which is the part worth keeping.** Every visible setting was already correct: origin type `lambda`, signing `always`, protocol sigv4, `https-only`, no `Host` forwarded, no edge functions, no qualifier, and a resource policy whose principal, action, `SourceArn` and `FunctionUrlAuthType` all matched the documentation. **A permission short one action presents as a signature problem**, so the search went to the origin access control, the headers and the cache policy first. **Two hypotheses were tested and disproved before the right one**: propagation, disproved by eight retries over four minutes, and Accept-Encoding normalisation breaking the signature, disproved by disabling compression and getting the same 403. **That change was reverted rather than left in, because it fixed nothing and its comment would have claimed a cause that was not real.** The answer was in the CloudFront documentation, which gives the grant as two separate `add-permission` calls.

**A second real defect was found on the way and fixed.** `content_api` and `scan_ingest` held their DynamoDB grants but no KMS grant, while `admin_api` and `rollup_consumer` had one. The tables are encrypted with the environment key, so **the table permitted the write and KMS refused the decrypt**, which surfaces as a 500 rather than a 403 and is invisible to `terraform plan`. Found by the first real beacon, not by review. `logging` is correctly the only role still without a KMS statement, because log group encryption is done by the Logs service under the key policy.

**Both belong to the same family as the tag value commas and the oversized policy comment: defects only a live apply and a live request can find.**

---

## D36 · [entry withheld: internal]

---

## D35 · [entry withheld: internal]

---

## D34 · [entry withheld: internal]

---

## D33 · [entry withheld: internal]

---

## D32 · 27 Aug · The two AWS accounts were the wrong way round for a week. `888348806392` is the Development account, not the management account, and it is the correct deployment target

**What triggered it.** The development environment was about to be applied, and the account it was about to be applied into was checked by name for the first time. `aws organizations list-accounts` and `aws organizations describe-organization` on Thursday 27 August 2026 returned the opposite of what the record had said since Monday 24 August 2026.

| Account | Name | Email | What it is |
|---|---|---|---|
| `[account id withheld]` | `Trevean Spice` | `aws-root@treveanspice.com` | **The Organization management account.** Org `o-q36zht9ztn` |
| `888348806392` | `Trevean-NFC-Development` | `aws-dev@treveanspice.com` | **The development account** |

**Decision: `888348806392` is the development account and the correct target for `envs/dev`. Everything the record derived from the reverse is withdrawn.**

**How the error was made, and it is worth being exact rather than generous about it.** Dan described his estate on Monday 24 August 2026 as a management account with an empty Development OU beneath it. Credentials for `888348806392` were already in hand, had been since Wednesday 19 August, and were the only credentials on the project. **The description and the credentials were assumed to match.** They did not, and nothing was run that could have told the difference, because the check that was run was the wrong check: per D20 the account was queried for hosted zones, distributions, tables, buckets, certificates and functions, found empty, and that emptiness was then silently read as identity. **An empty account and a management account look identical to `aws sts get-caller-identity`, which returns an id and no name.**

**What it cost, listed rather than summarised, because the list is the argument for the check.**

- **A week of not deploying into an account that was correct the whole time.** The environment applied on Thursday 27 August 2026 could have applied on Wednesday 19 August, subject only to the IAM permission that was genuinely outstanding.
- **Advice to the client to create an account that already existed.** D24's supervised screen share was scoped on Tuesday 25 August 2026 around creating a Development account together. The account had existed since before we held credentials for it.
- **A commitment in writing to a cleanup that was never needed.** The 25 August message told Dan the state bucket sat on his main account and would be moved off it and the remainder deleted. **`trevean-tfstate-888348806392` was in the right account, holding the right state, the whole time.** Moving it would have been work done to satisfy a mistaken premise, on a client's estate, with a message explaining why.
- **A guard whose documentation pointed the wrong way.** `envs/dev/terraform.tfvars.example` told the reader that `888348806392` must never be used. Followed literally, that instruction stops someone deploying into the only correct place.

**What would have caught it, and it is one command.** `aws organizations describe-organization`, or `aws iam list-account-aliases`, at the moment the credentials were first exercised. Either one names the account. **A resource inventory is not an identity check**, and the two were conflated because emptiness was the thing being looked for and the account happened to be empty.

**Why this is in the decision log rather than only corrected in place.** The correction itself is a fact and needs no reasoning. **The failure mode does.** This is the third time on this engagement that a confident description has stood in for a verified one, after the NTAG21x chip family assumption and the 4 mm lid, and all three had the same shape: a plausible statement was adopted without the cheap check that would have tested it. **The standing rule this entry sets is that an account is identified by name before anything is created in it, and the identity check goes in the record next to the inventory check.**

**What does not change, stated because a correction is an easy place to over-reach.** The `expected_account_id` guard stays, stays required, and keeps having no default. **It was never the guard that was wrong, only the id the examples told you to fear.** Staging still belongs in a Serene Labs account and production still belongs in Trevean's production account, and neither of those is `888348806392`. D25 still stands on its own reasoning: the five tag routes are served from Vercel because the thousand encoded jars are the part that cannot be changed later, not because AWS was unavailable.

**Where the correction lands.** "The deployed development environment", section 1, is the record of the account fact and the deployment that followed it. R3 and D24 are corrected in place.

---

## D31 · [entry withheld: internal]

---

## D30 · [entry withheld: internal]

---

## D29 · [entry withheld: internal]

---

## D28 · [entry withheld: internal]

---

## D27 · [entry withheld: internal]

---

## D26 · [entry withheld: internal]

---

## D25 · 25 Aug · The five tag routes are served from Vercel now, and AWS leaves the critical path for anything a customer touches

> **CORRECTED on Thursday 27 August 2026 by D32, on one of its three triggering facts. The decision stands and is not reopened.** The second fact below, that no AWS Development account exists, was wrong: `888348806392` is `Trevean-NFC-Development` and it existed throughout. **The decision does not depend on it.** Serving the tag routes from Vercel was and is the fastest route to working jars on the real domain, because it needs no certificate and no nameserver change, and the encoded jars remain the part that cannot be changed later. **What the correction removes is an argument that made the decision look more forced than it was**, not the decision.

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

## D24 · [entry withheld: internal]

---

## D23 · [entry withheld: internal]

---

## D22 · [entry withheld: internal]

---

## D21 · [entry withheld: internal]

---

## D20 · [entry withheld: internal]

---

## D19 · [entry withheld: internal]

---

## D18 · 19 Aug · The 1,000 shipped tags are not write protected

> **REVERSED on Friday 11 September 2026. THE TAGS ARE WRITE PROTECTED. See D45.** Dan answered from memory here about a run that had already shipped; on 11 September, with the box in front of him, he said "yes the tags are locked per the supplier", and his own SO4731 instruction to the supplier asked for the NDEF area to be locked. **Everything below is preserved as the reasoning that was held at the time and none of its conclusions are current.** In particular: the 1,000 shipped tags are **not** freely re encodable, and the ST25TV area password is the only route to ever repointing them.

**Dan, 19 August: "There are no write protections on the tags."** This closes Q4, open since Friday 7 August.

**What it changes:** a hard constraint becomes a recoverable one. Until today, the working assumption had to be that a thousand encoded jars carried a URL that could never be altered, so every recovery path ran through the redirect table and nothing else. The tags can be re-encoded.

**What it does not change:** re-encoding a thousand jars by hand is a real operation with a real cost and it is Trevean's line, not a keystroke. **The redirect table stays the primary recovery mechanism** and D10 is untouched. What has changed is that there is now a second, expensive option behind it, where before there was none.

**What it does to M4:** the chip programming tooling now serves **this** production run rather than only the next tag order. Encoding, verification and read-back apply to inventory that exists. Note the tooling still applies area-based 64-bit password protection on chips that currently have none, which is a decision about whether future runs ship protected, and it is now a decision rather than an inherited state.

**One thing to confirm rather than assume:** "no write protections" is Dan's answer, not Tagstand's written one. Verify by read-back against our own bare ST25TV02KC stock and, once inventory is in hand, against one shipped jar, before anything depends on rewritability.

---

## D17 · [entry withheld: internal]

---

## D16 · [entry withheld: internal]

---

## D15 · [entry withheld: internal]

---

## D14 · [entry withheld: internal]

---

## D13 · [entry withheld: internal]

---

## D12 · [entry withheld: internal]

---

## D11 · [entry withheld: internal]

---

## D10 · 6 Aug · Redirect is unavoidable; the decision is where it is served

**What changed:** the architecture originally specified no redirect, pointing tags straight at the page. That option closed on 24 July 2026 when 1,000 tags were encoded with `treveanspice.com/t/{code}`.

**Decision:** keep the redirect, serve it at the CDN edge. Origin-served costs a full round trip plus a table lookup; edge-served costs one hop and never touches a server.

**Also decided:** the redirect table lives in version control, deployed with the application, never as hand-edited state in a hosting console. A host migration that leaves the table behind does not break a deployment, it strands inventory.

---

## D9 · [entry withheld: internal]

---

## D8 · [entry withheld: internal]

---

## D7 · 6 Aug · Trevean runs the acceptance test, not Serene Labs

**Decision:** Trevean staff perform the physical taps, on Trevean materials, at Trevean's facility, using a measurement harness Serene Labs builds and hands over. Serene Labs writes the protocol, reads the data, and signs off.

**Three reasons in order:** the thing that has to hit 98% is Trevean's production line, not one developer's hands, so a figure produced by one person on one afternoon does not answer the real question · it removes the contractor from grading their own homework on an acceptance criterion · it saves a week of shipping in an eight-week schedule.

[paragraph withheld: internal]

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

## D4 · [entry withheld: internal]

---

## D3 · [entry withheld: internal]

---

## D2 · [entry withheld: internal]

---

## D1 · [entry withheld: internal]

---
