# M4 status

> ## UPDATED TUESDAY 22 SEPTEMBER 2026. READ THIS BOX FIRST, THE BODY BELOW IS FROM 17 SEPTEMBER.
>
> **What changed, and one of them is the biggest thing in the engagement:**
>
> **R1 IS CLOSED. THE JARS WORK.** Verified against `https://treveanspice.com`: **11 of 13 checks pass, 150 of 150 casing and trailing slash variants correct.** All four encoded codes and both QR routes reach the right blend page. `node tools/demo-readiness.mjs` reports **9 passing, 1 warning, 0 failing**. **This was open since 19 August and it is the oldest live fault in the project.** See "Decision log", D56.
>
> **The apex certificate ISSUED** on 18 September, 11:49 AM, both names, valid to 3 April 2027. **Idle by design:** `InUseBy` is empty and the cutover is deliberately not taken. Runbook section 9 sets out why the flag that completes it does a second, hazardous thing. D54.
>
> **The one warning is ours and is fixed but unmerged.** `/t/zz` and `/q/zz` return an unbranded 404 against SOW section 6.3. `404.html` is waiting in **pull request 2** on the client's website repository. **Do not demonstrate a mistyped code until it merges.**
>
> **NOTHING ELSE ON THIS PAGE HAS CHANGED.** Criteria 1 and 2 still need hardware at the client's end. Criterion 3 still needs the store unpaused and the blends active. **Criterion 4 is still exercised against synthetic data.**
>
> **AND THE CRITICAL PATH IS NOT ON THIS PAGE AT ALL.** **The M2 tap test has never been run.** Varun was named on 28 August with no days booked. The dress rehearsal is **Wednesday 23 September, tomorrow**, and the demo is **Sunday 27 September**. **No amount of M4 progress substitutes for it**, and the readiness script says so in its own output: a server side check cannot tell a correct blend from a transposed one, and it cannot tell you a tag reads through an 8 mm lid.


**Milestone:** M4, chip tooling, Shopify, analytics dashboard.
**Dated:** Friday 18 September 2026.
**Written:** Thursday 17 September 2026, the day before the milestone date. **Still current on the milestone date itself, Friday 18 September 2026**, and nothing in section 1 has changed.
**Position: WILL NOT BE COMPLETE ON THE DATE. Two of four criteria are close and two cannot be met from this side at all.**

This document exists because **M4 falls due today** and no package was written
for it. It is a status rather than a delivery. **Every "met" below names the evidence
and the command that reproduces it; every "not met" names who it waits on.**

---

## 1. The four acceptance criteria, as written

From "Milestones and dates", the M4 row:

> sample tags encode, write-protect and tap correctly · Trevean staff encodes one
> unaided · reorder reaches Shopify checkout · dashboard shows live scans labelled
> per §6.2

| # | Criterion | State | Waiting on |
|---|---|---|---|
| 1 | Sample tags encode, write protect and tap correctly | **NOT MET** | Hardware, at Trevean's end |
| 2 | Trevean staff encodes one unaided | **NOT MET** | A named person and 15 minutes |
| 3 | Reorder reaches Shopify checkout | **NOT MET.** Our half is built and proven | Trevean: unpause, activate, domain |
| 4 | Dashboard shows live scans labelled per §6.2 | **SUBSTANTIALLY MET**, with one honest caveat | Real scan volume |

**Nothing here is presented as finished that is not.**

---

## 2. Criterion 1 and 2: the chip tooling

### What is built and tested

**Everything above the hardware boundary, and it is a real body of work.**
`build/chip-cli`, **162 passing tests** (`npm run ci`).

- Encodes ST25TV02KC with one NDEF URI record, byte for byte against the NFC
  Forum URI RTD, with the `https://` prefix abbreviated to save 8 of 256 bytes.
- The URL comes from `build/edge/redirect-table.json` in version control, so a
  code cannot be mistyped, and `/t/kg` is refused because Kyoto Garden is not
  encoded.
- Reads every unit back and decodes it. **Protection cannot be applied before
  verification** and six tests assert both the refusal and that no protection
  command reached the tag.
- A 500 unit batch completes with 500 journal records and no gaps, resumes after
  an interruption, and refuses to resume a journal belonging to a different code,
  count or table.
- Every failure path has a named code and a remedy.

### What was added on Thursday 17 September

**`src/transport/pcsc.ts`, the real reader.** Written once the reader stopped
being hypothetical: the client holds an **ACR1552U with GoToTags**, which is NFC
Forum certified across ISO 14443, **ISO 15693** and ISO 18092.

It is split deliberately, along the line README section 6.2 draws:

- **Implemented**, from documented standard PC/SC storage card commands: tag
  detection, UID, block reads, block writes. **That is the whole encode and verify
  path, and therefore the whole of criterion 2.**
- **Refused, with a named code**: passwords and area protection. Those need ST
  custom commands inside a reader specific transparent session and **those opcodes
  are not verified, so they are not written.** A guessed protection opcode applied
  to a real tag is not reversible without the password it just installed. That is
  not hypothetical: it is what happened to order SO4731.

### Why criteria 1 and 2 are not met

**Nothing in this tool has ever talked to a chip.** Section 6.3 of the chip
tooling README is the bring up sequence and it has not been run, because **the
reader and the tags are at the client's end**, which is where the criterion puts
them: a member of Trevean staff encodes one unaided.

**Criterion 1 also contains "write protect", which the reader transport does not
yet do.** Section 6.4 says why in full. The encode and tap halves are reachable
today; the protect half needs the datasheet work and sacrificial tags.

**What this needs from Trevean:** a named person, about fifteen minutes, a handful
of bare ST25TV02KC tags, and the reader they already own. **Not SO4731 stock**,
which is write protected with a password nobody at Trevean holds.

---

## 3. Criterion 3: the Shopify reorder

### What is built and proven

**The reorder link derives correctly from a variant ID and a store domain.**
`build/api/src/services/cartPermalink.ts`, and the client's five variant IDs
arrived at 6:11 PM on Thursday 17 September and are in the fixtures.

Proven both directions:

```
with no SHOPIFY_STORE_DOMAIN (today):
  every blend -> null -> button renders disabled and honest

with SHOPIFY_STORE_DOMAIN=shop.treveanspice.com:
  persian-sunrise -> https://shop.treveanspice.com/cart/44647379337319:1
  ... and four more
```

**One environment variable turns it on. No code change, no re seed.**

**Two defects were found and fixed in the webhook handler on Thursday 17 September**, both of which
would have produced a confident wrong answer rather than an obvious failure:

1. **Draft products were mirrored as purchasable.** `status` was ignored and
   `available` defaulted to true when absent. Every blend is currently a draft, so
   this was about to render a working button into a checkout that refuses.
2. **Order attribution matched slug first segments as substrings.**
   `NORTHERN-SPICE-50G` and `NORTH-STAR-BUNDLE` attributed to North African Night
   Market, `SILKY-SMOOTH-01` to Silk Road, while code style SKUs matched nothing.
   Replaced with whole token matching. See "Decision log", D48.

`build/api`, **257 passing tests**.

### Why criterion 3 is not met, and it is not the four numbers

**Three things stand between here and a working checkout, and all three are the
client's:**

1. **The store is paused.** A paused Shopify store has no checkout at all.
2. **Every blend product is a draft.** A draft cannot be bought.
3. **The store domain is unknown.** `treveanliving.com` serves WordPress, not
   Shopify.

**Only the third of those is a two minute job.** See R24 and R25.

**Still not built, and honestly out of reach without store access:** the catalog
metadata sync and the order webhook against a real store. The handler code exists
and is tested against synthetic payloads; it has never seen a Shopify request.

---

## 4. Criterion 4: the analytics dashboard

**This is the criterion closest to met, and the caveat is stated rather than
buried.**

### What is proven

**The pipeline, end to end and on real infrastructure.** A beacon posted through
the live distribution reached the stream consumer, the counters were written, and
the Scans screen read one back. `rollup_consumer` is deployed and its stream event
source mapping is on.

**The dashboard itself, across all four dimensions that were untested a week ago.**
`build/api/test/unit/analyticsSeries.test.ts`, 22 tests, and verified against the
deployed table with 30 days of data:

| Checked | Result |
|---|---|
| Daily range, all blends | 30 points |
| Daily range, per blend | 30 points each, and the totals differ per blend |
| Hourly range | 24 points |
| **Hourly end bound** | **Correct bound 24 points, unextended bound 1 point** |
| Platform split | ios + android + other equals scans, every row |
| Channel split | nfc + qr + direct equals scans, every row |

**The hourly bound line is a real defect, guarded by test and demonstrated against
the deployed table.** Sort keys are `YYYY-MM-DDTHH`, so an end bound that is not
extended to `T23` silently drops 23 hours of the final day, which on a demo day is
most of what anybody is looking at.

### The caveat, and it is the reason this says "substantially"

**The criterion says LIVE scans.** The 30 days behind that screen today are
**synthetic**, written by `build/api/tools/seed-rollups.mjs` so the date range,
granularity, per blend filter and platform split had something to exercise.

**Every synthetic row carries `synthetic: true` and `--purge` removes exactly
those.** There are **3,750 of them in `trevean-dev-tsn888348-ScanEvents` right
now.**

> **THEY MUST BE PURGED BEFORE ANY DEMO OR SCREEN SHARE.** Invented numbers are
> indistinguishable from sales.
> ```
> cd build/api
> node tools/seed-rollups.mjs --table trevean-dev-tsn888348-ScanEvents --purge
> ```

**What "live scans" actually needs is the tap test**, which produces real events
through the real path. That is the M2 gate, still unbooked.

---

## 5. What is needed, and from whom

**From Trevean, in the order of how long each takes somebody else:**

1. **Unpause the Shopify store**, and **make the five blend products active.** Two
   separate switches. Without both, criterion 3 cannot be tested by anyone.
2. **The store's address**, the `myshopify.com` one is fine.
3. **A named person and fifteen minutes** for the encoding test, plus a dozen bare
   ST25TV02KC tags. The reader is already theirs.
4. **Store access**, as a staff invite, for the catalog sync and order webhook.
5. **Whether the supplier kept the ST25TV area password.** Asked 11 and 17
   September, unanswered, and it decays with time.

**From us. UPDATED Wednesday 30 September 2026:**

1. ~~**Apply the certificate.**~~ **DONE 18 September.** `4a15eeeb`, `ISSUED`, both
   names, Terraform owned, valid to 3 April 2027. D54.
2. ~~**Purge the synthetic rollups.**~~ **DONE 22 September.** 3,750 rows deleted, 0
   remaining, 11 real items untouched. D57.
3. **Finish the protection half of the PC/SC transport**, against the datasheet and
   sacrificial tags. See chip tooling README, section 6.4. **STILL OUTSTANDING, and
   it is the only part of M4 blocked on us rather than on the client.**
4. **Deploy the API build carrying the M4 Shopify work.** The running functions are
   the build of 11 September and predate `cartPermalink`, `skuAttribution` and the
   two webhook fixes. **Nothing observable differs** while the paths are dormant, but
   the reorder button cannot work until this goes out. D58.

---

## 6. The recommendation

[section withheld: internal]

**Sunday 27 September is not at risk.** The tap path, a jar to a story, is live and
has been for a week, and it touches none of the three M4 parts.
