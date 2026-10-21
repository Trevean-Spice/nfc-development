# M5 status

**Milestone:** M5, full matrix re run, AWS deploy, docs, runbooks.
**Dated:** Wednesday 30 September 2026.
**Written:** Wednesday 30 September 2026, the milestone date.
**Position: NOT COMPLETE, and closer than M4. Two of four are met, one is most of the way, one needs an hour of the client's diary.**

Written on the date rather than after it.

---

## 1. The four acceptance criteria

From "Milestones and dates": **§6.1 re confirmed across the full matrix and all
shipping blends · deployed on Trevean AWS · docs accepted**, plus the knowledge
transfer session in the package.

| # | Criterion | State | Waiting on |
|---|---|---|---|
| 1 | §6.1 re confirmed, full matrix, all shipping blends | **PARTLY MET. 5 of 8 handsets** | Varun, 3 Android handsets |
| 2 | Deployed on Trevean AWS | **MET** | Nothing |
| 3 | Docs | **WRITTEN, NOT ACCEPTED.** ~54,000 words | The client reading them |
| 4 | Knowledge transfer session | **NOT HELD.** Plan written | An hour of the client's diary |

---

## 2. Criterion 1: the matrix, and it is genuinely moving

**The client ran physical taps between 24 and 30 September 2026** on real jars,
with printed labels, tags fitted under production lids. **This is the first
physical testing in the engagement and it was done unprompted.**

| Handset | State |
|---|---|
| iPhone XS, 13, 15 Pro, 16 Pro | **Pass.** 100 percent reads |
| Samsung Galaxy S23 | **Pass.** 10 of 10 |
| Google Pixel 6, Pixel 8 Pro, Samsung S24 Ultra | **Outstanding** |

**Also done and worth more than it sounds:** the QR route verified against every
blend, and **the adjacent jar test repeated on production materials**, where the
6 August run used interim lids. That is the harder version of the test.

**Read distances came in lower than August** and the likely cause is the
instrument rather than the lids: a metal rule near a 13.56 MHz antenna absorbs
energy and detunes it. **The tap test protocol said "rule or caliper" and never
said non metallic, which is our error**, corrected on 26 September. The Samsung
S23 on a plastic rule dropped 9 to 18 percent against its August figure where an
iPhone on a metal rule dropped 29 percent. **The decisive test is one iPhone
re measured with the plastic rule**, and it is with the client.

**Whether any of this constitutes the formal gate is an open question.** D7
requires a named tester, recorded footage and specific tap counts. Varun is
named and involved; **what is not established is whether it was recorded to the
protocol.** Asked of the client on 26 September, unanswered. **If it was, this
criterion and M2's outstanding item close together.**

---

## 3. Criterion 2: deployed on Trevean AWS. Met.

AWS account **`888348806392`**, `us-east-1`, name prefix
`trevean-dev-tsn888348`. Content API, scan beacon, admin API, admin CMS,
publisher on Fargate, five DynamoDB tables, CloudFront, Cognito. **Verified
healthy on 22 September**: publisher `ACTIVE` 1 of 1, admin sign in 200, content
API 200, tag route 307.

**One caveat stated rather than buried.** The account is
`Trevean-NFC-Development`. **It is Trevean's AWS account, which is what the
criterion says**, but it is the development environment rather than a separate
production one. **If the client expects a distinct production environment, that
is a conversation rather than an assumption**, and it has never been raised by
either side.

**And one divergence:** the deployed API is the build of **11 September** and
predates `cartPermalink`, `skuAttribution` and two webhook fixes. **Nothing
observable differs** while those paths are dormant, but it should go out. See
"Decision log", D58.

---

## 4. Criterion 3: the documents exist and have not been read

**Roughly 54,000 words across eight documents**, plus this one and the operations
runbook.

| Document | Words |
|---|---|
| Runbooks | 13,530 |
| Third party libraries and licences | 10,320 |
| Architecture and the reasoning behind it | 8,202 |
| Limitations and future work | 7,813 |
| API reference | 5,166 |
| Package index | 4,085 |
| Knowledge transfer session plan | 3,671 |
| Operations runbook | 2,568 |
| Orientation for a new developer | 1,464 |

**"Accepted" means the client has read them and said so.** That has not happened
and cannot be done from this side.

**A current state block was added to the package index and the orientation
document on 30 September 2026**, because the package is written as a dated
narrative and several statements read as current when they describe August.
**The worst of them told a future operator that the apex returns HTTP 403 and a
thousand jars reach an error page.** That is the same class of error as D45 and
it is now corrected at the two entry points, with the dated narrative left
intact below.

---

## 5. Criterion 4: the session

**The plan is written**, 3,671 words, with an agenda, what is demonstrated live,
and what the attendee can do unaided afterwards. **It needs an hour of the
client's diary and has never been booked.**

---

## 6. What is needed, and from whom

**From Trevean:**

1. **Three Android handsets tapped**: Pixel 6, Pixel 8 Pro, Galaxy S24 Ultra. In
   progress with Varun.
2. **Whether the testing was recorded to the protocol.** Decides whether M2's
   gate and this criterion close together.
3. **One iPhone re measured with the plastic rule.** Ten minutes, and it settles
   whether the lids changed at all.
4. **An hour for the knowledge transfer session.**
5. **Read the handover package**, or say who will.

**From us:**

1. **Deploy the API build** carrying the M4 Shopify work. D58.
2. **Nothing else.** The documents are written and the deployment is up.

---

## 7. The honest position

**M5 is not blocked on anything we have not done.** Criterion 2 is met, criterion
3 is delivered pending a read, and criterion 4 needs a diary entry. **Criterion 1
is moving under its own steam and is 5 of 8.**

**That makes M5 the closest thing to a clean milestone in this engagement**, and
it is worth saying plainly that it is closer than M4, which is dated earlier and
has three of its four criteria blocked on the client.
