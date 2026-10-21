# Knowledge transfer session plan

**M5 handoff deliverable. Written Saturday 22 August 2026. Sections 5 and 6 revised Tuesday 25 August 2026.**
**The session itself:** included in M5, which completes Wednesday 30 September 2026, three days after the demo. **It lands after the demo by design, not by slip.** M5 was dated to 30 September at the outset for exactly this reason: handover is scheduled after the event rather than competing with it for the same week.

---

## 1. What this session is for, and what it is not

**The purpose is that Trevean can operate, change and hand on this platform without Serene Labs.** That is the contractual position: every deliverable is work for hire delivered as source, with the right to use, modify, and engage any third party to modify.

**A session where a contractor talks for three hours and everyone nods does not achieve that.** The test of this session is section 6: a list of things the attendees can do **unaided** afterwards. It is written first and the agenda is built backwards from it.

Three consequences for how the session runs:

- **The attendee drives.** For every demonstration, Serene Labs shows it once and then the attendee does it while we watch and say nothing. That is the same discipline the admin CMS acceptance uses, and it is the only reliable way to find out whether a document actually works.
- **Nothing is demonstrated that cannot be demonstrated live.** Where something does not exist yet, the session says so and walks the runbook and the reasoning instead. Section 5 lists those explicitly.
- **Every question that gets asked and is not answered by a document is a defect in the documents**, and it is captured and the document is fixed. That list is a deliverable of the session, not a courtesy.

---

## 2. Who should be in the room, and for which parts

The session is in four blocks and not everybody needs all four. **Splitting it this way is what stops the marketing attendee sitting through Terraform and the developer sitting through a content workflow.**

| Block | Who | Length |
|---|---|---|
| **A. Orientation and the physical layer** | Everybody. Product owner, marketing, whoever will run tag encoding, and any developer | 45 minutes |
| **B. Content and day to day operation** | Product owner, marketing, whoever publishes content | 60 minutes |
| **C. Operations and incidents** | Whoever will be on the other end of an alarm. A developer, and whoever holds the tag password | 60 minutes |
| **D. Engineering** | A developer, and any third party Trevean expects to engage | 75 minutes |

**Total four hours including breaks.** It can be run as one day or split across two, and the blocks are deliberately independent so a person who misses one is not lost in the next.

**One name must be settled before the session, not during it: who holds the tag area password.** It is one person, it is recorded, and the rotation path is documented. A tag password Trevean does not hold is a tag estate Trevean does not own.

---

## 3. The agenda

### Block A. Orientation and the physical layer, 45 minutes

Everything here is a fact that has already been assumed wrong on this project at real cost, which is why it comes first and why everybody attends.

| Minutes | Item |
|---|---|
| 0 to 10 | **The six facts, from the document titled "Orientation for a new developer".** The chip is ST25TV02KC, Type 5 on ISO 15693, not NTAG21x. The tags are already encoded and the URL is a fact. The lid is 8 mm. Screen off is zero reads. On iPhone a tap never opens a page directly. Attribution is per SKU. |
| 10 to 25 | **Live, with real jars and real phones.** See section 4.1. |
| 25 to 35 | **Why the acceptance criteria are shaped the way they are.** Two obligations the contractor carries, one behaviour excluded, two preconditions. Why the banner is measured on every run and never scored. |
| 35 to 45 | **The numbers.** 8 mm of bamboo against an 18 mm worst case handset, roughly 2x margin. 2.0 seconds from the request for `/t/{code}`. 98% read success. 1,000 tags across four codes. Where each one is written down so nobody has to remember it. |

### Block B. Content and day to day operation, 60 minutes

| Minutes | Item |
|---|---|
| 0 to 10 | **Where content lives and what publishing actually does.** Publish writes an immutable snapshot and regenerates exactly the affected pages in the background while the previous version keeps serving. Nobody waits. Content is live within five minutes by contract and in seconds in practice. |
| 10 to 35 | **The attendee publishes a blend end to end, unaided, while we watch and say nothing.** See section 4.2 and the caveat in section 5. |
| 35 to 45 | **The three things publishing will not do for you.** Editing a grower does not change a page already built, because the grower record is snapshotted into it, so the tool tells you which blends need republishing. A hero image that is still processing blocks publish and says so. Two editors saving the same blend get a conflict rather than one silently overwriting the other. |
| 45 to 55 | **Media.** Why upload is three steps and why the photograph never passes through a function. The hero image byte cap and what happens when a photograph exceeds it. |
| 55 to 60 | **What the analytics numbers mean and what they do not.** Every count is labelled with its measurement method. NFC and QR are deduplicated by exactly the same browser side mechanism, so they are directly comparable to each other and **neither is a per jar count**. |

### Block C. Operations and incidents, 60 minutes

Built directly on the document titled "Runbooks", and the runbooks are open on screen throughout. **The point is not to teach the runbooks, it is to prove they can be followed by somebody who did not write them.**

| Minutes | Item |
|---|---|
| 0 to 10 | **The four rollback levels and their real costs.** Content: seconds. Redirect: under a minute. Application: minutes. **DNS: up to 48 hours, and that number is not made comfortable.** |
| 10 to 25 | **A customer reports a wrong blend page.** Run as a live exercise. See section 4.3. |
| 25 to 40 | **The cache hit ratio alarm.** Why it exists, why it is the earliest warning this architecture has, the five causes in the order to check them, and the one instruction that matters: **do not raise the threshold.** Also, before diagnosing anything, check that the metric is real, because the alarm sitting in insufficient data looks exactly like health. |
| 40 to 50 | **Secrets and the tag password.** What a 64 bit area password is and why it is custody rather than permanence. **There is no reset and no master key: lose it and the tag is frozen exactly as if it had been fused shut.** Rotation is forward only, and existing stock keeps the old value until it is deliberately re encoded. Naming the holder. |
| 50 to 60 | **What wakes somebody up and what does not.** Alarm inventory, and confirming that every alarm has a subscriber who clicked the confirmation link. |

### Block D. Engineering, 75 minutes

| Minutes | Item |
|---|---|
| 0 to 15 | **The tap path, drawn.** The ten steps, where the 2.0 second clock starts and stops, and the three rules. Why this is latency bound and not bandwidth bound: 10 ms of extra round trip time costs about 60 ms across the path, 10 KB of extra bytes costs about 20 ms. |
| 15 to 30 | **The six decisions that look strange**, from the document titled "Architecture and the reasoning behind it". Each one gets its reasoning, because **the decisions that look strange are exactly the ones a new developer will undo.** |
| 30 to 45 | **The redirect table, live.** See section 4.4. This is the highest value fifteen minutes in the whole session. |
| 45 to 60 | **The API and its one rule.** One operation on the tap path. Why the contract is frozen, how change control works, and why contract tests rather than review are the enforcement mechanism. The open items in the document titled "API reference", section 8, especially CORS on the beacon, which is the one that fails only in the field with nothing in any log to say so. |
| 60 to 75 | **Deploying, and what is deliberately not automated.** The nameserver change is typed by a human who has just read a verification report, and it stays that way. Event source mappings stay off until real code is deployed. Terraform does not own application code. |

---

## 4. What is demonstrated live

Four demonstrations. Each one is shown once, then done by the attendee.

### 4.1 A real jar, two real phones, in front of everyone

**Materials:** one Persian Sunrise jar and one Caribbean Sunset jar with 8 mm lids and tags fitted, one iPhone, one Android, and a phone case.

Six things get shown in one sitting, and each of them settles an argument that would otherwise recur:

1. **iPhone with the display awake.** The banner appears, the attendee taps it, the page loads. **The banner is pointed at explicitly and named as the excluded step.**
2. **Android unlocked.** No banner, the browser opens directly. Same page.
3. **Screen off, on both.** Nothing happens. **Not a slow read, nothing.** This is worth thirty seconds of silence, because it is the single most common source of "the thing is broken" reports.
4. **Android locked.** Nothing happens.
5. **Both jars side by side, tapping one.** The correct blend opens. Measured 160 out of 160 across eight handsets.
6. **The same tap with a case on.** The margin is roughly 2x, so a thick case is a real variable rather than a curiosity.

### 4.2 Publishing a blend end to end

**The attendee does it.** Edit copy, upload an image, save, preview, publish, then reload the live page and see the change. Then a second change with a deliberate mistake: publish a blend with a missing grower, see the 422 listing every blocking reason at once rather than one at a time, fix it, publish again.

**Caveat: this demonstration depends on the admin CMS existing.** See section 5.

### 4.3 A wrong blend page, staged

Run as an exercise rather than a talk. **We break something on a staging environment before the session and the attendee diagnoses it from the runbook.**

The staged fault is a repointed row in the redirect table on staging, because it produces exactly the symptom that matters: a fast, successful, 200 returning page showing the wrong blend, which passes every smoke test that looks at status codes.

The attendee works the four facts, then the five checks, and reaches the cause. Then we discuss the case that is not fixable this way: **if the physical tag carries the wrong code, do not repoint the table to compensate**, because that fixes the mis encoded jars and breaks every correctly encoded jar carrying the same code.

### 4.4 Repointing a code, all the way through

**The most valuable fifteen minutes in the session**, because it is the operation the entire redirect design exists to make possible and the one most likely to be done wrong under pressure.

The attendee, on a branch:

1. Edits a row's target and slug.
2. Runs the package CI **without** setting the repoint flag, and watches the build fail. **The failure is the lesson.** A repoint nobody meant to make is indistinguishable from a repoint somebody did.
3. Sets the flag, increments the version, runs CI again, sees it pass.
4. Reads the pull request description we have written and sees that it names the physical jars affected, by blend and unit count.
5. Deploys to staging, runs the live verification script, and sees it check the exact status, the exact `Location`, that the `Location` is relative, `no-store`, the table digest, and **that the destination page names the right blend**.
6. **Taps the jar.** The script does not replace this and never will.

Then the one thing no validator catches is demonstrated: **transposing two rows wholesale passes every check** because each row stays internally consistent. We transpose two codes and run the tests, and 11 of them fail, because the expectations were transcribed by hand rather than read out of the file under test.

---

## 5. What cannot be demonstrated, and what happens instead

Written now, in August, because being honest about it in advance is cheaper than improvising on the day. **Each item below is either resolved by 30 September or the session runs the substitute.**

**Four rows below were revised Tuesday 25 August 2026**, because the 22 August version assumed four packages did not exist when they did, and assumed a domain state that no longer holds. **The substitutes are narrower than they were, and in two cases the reason for the substitute changed even though the substitute did not.**

| Item | Why | Substitute if it is still true on the day |
|---|---|---|
| **Publishing a blend end to end (4.2)** | **The admin CMS is built and its 169 tests pass. It has never been deployed and no real editor has ever used it.** The obstacle is a deployed environment, not a missing tool. | If a staging environment exists, this runs as written, against the admin itself. **If no environment exists, run the admin locally against the API package on a laptop and say clearly that it is a laptop.** The API operations exercised directly are the third fallback, not the first. |
| **Encoding a batch with the tooling** | **The tool is built and its 134 tests pass, and it has never been run against a physical tag or a physical reader.** Its reader transport is an unimplemented stub. The obstacle is hardware, not software. | Demonstrate the manual method on bare stock, with the twenty tag limit stated, and walk the batch runbook. **Additionally, run the tool against its software model on screen** so the batch record, the read back verification and the refusal to write `/t/kg` are seen working. **Say in terms that no tag has ever been written by it.** Do not demonstrate hand encoding on production inventory. |
| **The analytics dashboard charts** | **The dashboard is built and its 105 tests pass, against seeded rollups on a local database.** It has never been shown a real scan. Moved to M5 by the first rung of the de scope ladder, taken 19 August 2026 | Show the dashboard against seeded data and **say that the data is seeded**. The distinction that matters is no longer "the data exists and the charts do not", it is **"the charts exist and no real scan has ever reached them"**. State it plainly rather than blurring it. |
| **The Shopify reorder path** | **Built, 220 tests passing, and it has never spoken to a Shopify store.** There is no store access. | Demonstrate cart permalink construction and webhook signature verification, both of which are genuinely proven because they are pure functions over bytes. **Do not demonstrate anything that implies a claim about Trevean's catalog, prices, SKUs or webhook deliveries**, because none of that has been observed. |
| **A production deployment from nothing** | Cannot be replayed on a live account | Demonstrate on a development or staging environment in a member account, and walk the production sequence. **Do not put the 19 August plan on screen: it is void.** See the document titled "Runbooks", section 2.1. |
| **A DNS cutover** | Happens once and will already have happened | Walk the runbook, show the verification scripts running with no DNS involved, and show the exported zone that is the rollback record. **Emphasise the 14 day rule: the old zone is left untouched, and that is what makes the rollback a nameserver revert rather than a zone rebuild.** **If no zone export exists on the day, say so and demonstrate nothing**, because a rollback record is the thing being demonstrated and an invented one teaches the wrong lesson. See the document titled "Runbooks", section 9.1. |
| **Real content** | Depends on delivery | If pages still carry the placeholder banner, say so, show what the release check does, and show that the placeholder imagery is at the real byte weight so the performance claim survives the swap. |

---

## 6. What the attendee can do unaided afterwards

This is the acceptance test for the session. **If an attendee cannot do the item, the session did not work and the relevant document is wrong.**

### Everybody, after block A

1. **Explain why a tap on a sleeping phone is not a fault**, and why iPhone shows a banner and Android does not.
2. **Say what the chip is and why almost every NFC article on the internet does not apply to it.**
3. **State the four numbers**, 8 mm, 18 mm, 2.0 seconds, 98%, and say where each is written down.
4. **Explain to a colleague why a jar cannot be individually tracked**, and what would have to change for it to be, and when that decision has to be made.

### The content owner, after block B

5. **Publish a blend end to end without a developer**, including uploading an image and previewing before publish.
6. **Recognise the three blocking cases** and fix each: a publish blocked on a missing grower, a hero image still processing, and a version conflict with another editor.
7. **Say what needs republishing after a grower edit and why**, without being told.
8. **Read the analytics correctly**, including saying out loud that the counts are per SKU and browser deduplicated and that neither channel is a per jar count.

### The operator, after block C

9. **Take a "wrong blend page" report, gather the four facts, and reach the right cause** using only the runbook.
10. **Roll back at the right level**, and state the real cost of each level including the 48 hour one.
11. **Answer the cache hit ratio alarm**, starting by checking whether the metric is real, and **without raising the threshold**.
12. **State who holds the tag password, where it lives, and what happens if it is lost.**
13. **Say which secret rotations can affect a customer reading a page.** The correct answer is none of them, and knowing why is the point.

### The developer, after block D

14. **Repoint a tag code end to end**, through the repoint guard, the review, the deploy and the physical verification, without help.
15. **Name the six decisions that look strange and give the reason for each**, well enough to explain to somebody proposing to undo one.
16. **Say what may never be added to the blend page**, and know that CI will stop them rather than a reviewer.
17. **Deploy the stack to a non production environment from a clean checkout**, and describe the production sequence and why the nameserver change is not part of it. ~~This item has a hard prerequisite: an AWS member account to deploy into. As of Tuesday 25 August 2026 the only account available is the Organization management account, and deploying this stack into it is the failure the account guard exists to prevent. If no member account exists on the day, this item cannot be met.~~ **Corrected Thursday 27 August 2026: the prerequisite is met and always was.** `888348806392` is `Trevean-NFC-Development`, the development account, and the environment was applied into it on Thursday 27 August 2026 at 169 resources. **The developer deploys `envs/dev` against `expected_account_id=888348806392`.** The guard stays required with no default; the id it should refuse is `[account id withheld]`, the management account. See the document titled "Runbooks", section 2.2, the document titled "The deployed development environment", and "Decision log", D32.
18. **Find where a number comes from.** Given any figure in any document, locate the single place it is defined. This is the skill that keeps the documents true after we are gone.

---

## 7. What the session produces

Three artifacts, delivered within two working days of the session:

1. **The unanswered question list.** Every question asked that the documents did not answer, with the document that should have answered it. **Each one is a documentation defect and is fixed rather than noted.**
2. **The named holders record.** Who holds the tag password, who receives which alarm, who has admin in the identity provider, who can approve a redirect table change. One page.
3. **A short recording of block A's live demonstration.** Not of the whole session. Block A is the part whose facts get forgotten and re litigated, and a two minute clip of a sleeping phone reading nothing is worth more than a paragraph in a document.

---

## 8. Two things this session deliberately does not do

**It does not train anyone to build a feature.** It makes them able to operate, diagnose, change safely and hand on. Building against this platform is what the document titled "API reference" and the frozen OpenAPI document are for, and they are written so a third party can build from them cold.

**It does not close the open decisions.** Several real decisions are outstanding and they are listed in the document titled "Limitations and future work", section 6.2. Naming them in the session is useful. Settling them in a handover session, at the end of an engagement, under time pressure, with the people who will live with the answer only half present, is not.
