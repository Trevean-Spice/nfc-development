# Orientation for a new developer

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



**One page. Read it before you open any code, and before you read any NFC article on the internet.**

Everything below has already been assumed wrong at least once on this project, by competent people, at real cost. They are in the order in which getting them wrong is expensive.

---

## 1. The chip is an ST25TV02KC. NFC Forum Type 5 / ISO 15693. It is not NTAG21x.

STMicroelectronics, 40 mm inlay, 2 Kbit of memory (256 bytes), 64 bit UID, Tagstand order SO4731, 1,000 units received 24 July 2026.

**Almost every NFC tutorial, blog post, library and phone app you will find is written about NXP NTAG21x, which is Type 2 on ISO 14443. That guidance does not apply here.** Different air interface, different memory model, and protection by a **64 bit area password** rather than one time programmable lock bits. The reference material that does apply is the ST25TV02KC datasheet and STMicroelectronics application note AN5658.

Two practical consequences you will hit within a day:

- A tool that reports this tag as "too small" or "unsupported" has misidentified it. Capacity is not a constraint: the URL payload is about 30 bytes of 256.
- **Never press "make read only", "lock tag" or "set permanent" in a generic NFC app on one of these tags.** Those controls target NTAG lock bits. On a Type 5 tag they either fail confusingly or issue a generic ISO 15693 block lock, which is permanent, cannot be undone by any password, and is not the protection model this project uses. A tag locked that way is scrap.

ISO 15693 is a vicinity standard rather than a proximity one, which is also why bench readers achieve far longer range on this chip than phone experience suggests.

## 2. The tags are already encoded and shipped. The URL is a fact, not a design choice.

One thousand tags carry `https://treveanspice.com/t/{code}` and were encoded per SKU before this engagement began. Four codes at 250 units each: `ps` Persian Sunrise, `cs` Caribbean Sunset, `sr` The Silk Road, `nm` North African Night Market. A fifth code `kg` for Kyoto Garden is reserved, served, and **carried by no physical tag in this run**.

`/t/{code}` answers with a **307** to `/blend.html?blend={slug}&via=nfc`. **Do not propose pointing tags directly at pages.** That option closed on 24 July 2026. The redirect is what lets a destination change by editing a table instead of re encoding a thousand jars, which is the property the whole design is built on. The reasoning is in the document titled "Architecture and the reasoning behind it", section 3.

The tags shipped **write protected**, confirmed by the client on 11 September 2026 with the stock in front of him and matching his own written instruction to the supplier. **Nobody at Trevean holds the ST25TV area password**, so re encoding those 1,000 jars is not currently available at any price. **The redirect table is therefore not merely the primary recovery route, it is the only one.** An earlier answer given from memory in August said the opposite and is superseded. See "Decision log", D45.

## 3. The bamboo lid is 8 mm.

Corrected on 12 August 2026 from a reported 4 mm. **Anything you read quoting 4 mm is stale.** The stack, as the phone sees it: 8 mm bamboo lid, then the tag at 8 mm depth, then a 1.5 mm cork sealing gasket.

**The cork liner sits below the tag and does not count against the read path.** Only the 8 mm of bamboo is between phone and tag.

The worst case handset on the supported matrix, iPhone XS, reads at **18 mm** bare. Eight of eighteen leaves roughly 2x margin: a pass, comfortable rather than generous. The consequence of halving the margin is that **phone cases are now a real variable** rather than noise, and they belong in the test matrix.

## 4. Screen off is zero reads. On every phone, on both platforms.

Not degraded, zero. Fifty iPhone attempts with the screen off produced nothing. Eighty Android attempts locked produced nothing. iPhone needs the display awake, locked or unlocked. Android needs the handset unlocked.

This is operating system behaviour and no encoding, hosting or application change touches it. It is written into the acceptance criteria as a **precondition**, in the same way the device matrix is, which means a tap on a sleeping phone is outside the measured population rather than a failed read. It is also why the QR code is the sole recovery route and is not optional.

## 5. On iPhone a tap never opens a page directly.

iOS raises a notification banner showing the domain, and the user taps it. **No API, setting, entitlement or tag configuration removes it.** Apple designed it so that walking past a hostile tag cannot navigate your phone. Android has no banner and opens the URL directly in the default browser.

That interval is **measured and reported on every run and never scored**: 0.6 to 1.2 s on iOS, 0.7 to 0.9 s on Android. It is data, not a pass condition, and it is not a defect on either platform. On page and on pack instruction copy is therefore **platform specific by requirement**. Copy that describes one platform's behaviour as universal is a defect, not a wording preference.

**One warning that belongs on this page rather than three documents away.** **The printed labels say TAP YOUR PHONE TO THE LID**, which is universal copy and fails the requirement in the sentence above. It is a known defect on already printed stock and it was a live client decision as at Thursday 27 August 2026. **Do not make the page match the jar.** That instinct is reasonable and it would put a contractual defect into the one surface still under version control. The agreed platform specific copy and the full list of places this gets reintroduced are in the document titled "Limitations and future work", section 5.9.

## 6. Attribution is per SKU. There is no per tag identifier and no chip UID on the page.

Every jar of a blend carries an identical URL, because that is how the thousand tags were encoded before the engagement started. So:

- Individual jars are not distinguishable, and no chip UID is available to the web page: it is not in the NDEF payload.
- Scan deduplication uses a **browser generated token in `localStorage`**, exactly the same mechanism the QR path uses. Measurably weaker than a per tag counter, and every analytics response says so in a `measurementMethod` field rather than implying precision the encoding does not have.
- Freshness is stated per blend, not per jar.

**Augmented NDEF and TruST25 both exist on this chip and are both deliberately switched off.** They are not missing and they are not broken. See the document titled "Limitations and future work", section 2, including the part that matters most: enabling either is a decision made **at encoding time when the next tag order is placed**, not afterwards.

---

## The one rule that is not a fact but is worth as much as one

**Nothing on the tap path may fetch content, run third party script, or wake an origin.** The blend page is rendered ahead of time and served from the edge cache; the only network call a customer's browser makes on your behalf after the page is readable is a fire and forget scan beacon. A page that fetches its content on load works perfectly in development, passes review, and then fails in a customer's kitchen on the first tap of the morning, which is the exact case a lab test never catches.

The full statement of that rule, with the numbers behind it, is the document titled "API reference", section 3.

---

## Two things about today that this page does not cover, and you should know before you start typing

**As at Tuesday 25 August 2026: nothing is deployed to AWS, and `treveanspice.com` resolves at Bluehost and answers HTTP 403 on the apex and HTTP 500 on `/t/ps`, so a jar tap reaches an error rather than nothing. Email on the domain is fully restored.** An earlier version of this line said the domain does not resolve at all, and that is superseded. The six facts above are about the physical layer and they do not change. The state of the system does, and the two sentences above decide which commands in this package will work today. **The document titled "M5 handoff package" has the package by package version, and the document titled "Runbooks", section 1, tells you which procedures can be executed today and which cannot.** Read one of those two before running any command that names a hostname or an AWS account.
