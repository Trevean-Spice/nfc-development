# Status headers for the five misleading documents

**Document date:** Saturday 22 August 2026
**Status: NEEDS DAN'S AGREEMENT.** These are changes to Trevean's repository.
**PR:** 12, split into 12a (`NFC-SPECS.md` alone) and 12b (the other four).
**Cost:** roughly one hour of our time for all five, once approved. Fifteen minutes for 12a.

The brief calls these four documents. There are five: `README.md`, `docs/ARCHITECTURE.md`,
`docs/GUIDE.md`, `docs/DIRECTORY-GUIDE.md` and `docs/NFC-SPECS.md`. All five are covered
below, because `README.md` is the first thing anybody opens.

Paste each block at the very top of its file, above the existing title. Nothing else in
any of the five files is edited. **Marking a document superseded is cheaper, more honest
and more useful than editing it into correctness**, because a corrected document loses the
record of what the previous team intended, and intent is the one thing these files are
genuinely good evidence of.

---

## Why 12a goes on its own, and first

`docs/NFC-SPECS.md` is 358 lines of confident, internally consistent specification for the
wrong chip. It is the single most dangerous artifact in the repository, and the danger is
not that it is wrong. It is that it reads like authority.

Lines 230 to 247, the write procedure:

```
2. Write NDEF Data
   - WRITE command for each block
   - 16 bytes per block
   - Verify write with READ

3. Write Lock Bytes
   - Lock critical memory areas
   - Prevent accidental modification

4. Verify Programming
   - Read full tag data
   - Compare with expected
```

Three defects in ten lines. "Write Lock Bytes" is the NTAG Type 2 model; the ST25TV02KC
uses area based 64 bit password protection, which is a state and is reversible if you hold
the password, not a fuse. Blocks are not 16 bytes, that is a Type 2 figure. And **step 3
locks while step 4 verifies**, so the irreversible operation happens before final
verification.

The practical hazard: **a generic ISO 15693 block lock is permanent, cannot be undone by
any password, and a tag locked that way is scrap.** Anyone implementing this procedure
against a Type 5 tag is one command away from that outcome, applied at batch scale, to
inventory that has already been paid for.

**This is the only item in the whole consolidation whose worst outcome is irreversible.**
It is one short header, it can be approved in one reply, and it should not be queued behind
four documents that merely waste somebody's time.

---

## 12a. `docs/NFC-SPECS.md`

```markdown
> ## SUPERSEDED. DO NOT USE THIS DOCUMENT FOR CHIP PROGRAMMING.
>
> **Recorded 22 August 2026 by Serene Labs Inc, following the M1 scaffold audit.**
>
> **This document specifies NTAG216 and NTAG213: NFC Forum Type 2, ISO 14443-3A. The tag
> used by this project is an STMicroelectronics ST25TV02KC: NFC Forum Type 5, ISO 15693.**
> It is a different air interface, a different memory model and a different write
> protection model. One thousand ST25TV02KC tags were encoded on 24 July 2026 and shipped.
>
> ### The safety item, first
>
> The write procedure at lines 230 to 247 writes lock bytes at step 3 and verifies at step
> 4, so the irreversible operation happens before final verification. Lock bytes are the
> Type 2 model and do not apply to this chip. **On an ISO 15693 tag, a generic block lock
> is permanent, cannot be undone by any password, and leaves the tag as scrap.** Applied at
> batch scale that is destroyed inventory with no recovery.
>
> The ST25TV02KC uses area based protection with a 64 bit password, which is a reversible
> state if you hold the password. Verification always precedes any protection step. The
> current procedure is in the M1 deliverable "Tag writing instructions", section 9.
>
> ### What else is wrong for this hardware
>
> | Section | This document says | The ST25TV02KC |
> |---|---|---|
> | Memory, lines 5 to 32 | 888 bytes total, 729 bytes user | **2 Kbit, 256 bytes of EEPROM.** The figure here is roughly 3.5 times the real one. A tool reporting capacity far below 256 bytes is normal and is not a faulty tag |
> | Read procedure, lines 209 to 218 | ISO 14443-3A: SENS_REQ, SENS_RES, SELECT_REQ | **ISO 15693, vicinity rather than proximity.** A Type 5 tag does not answer those commands at all. A reader implementing this gets no response and would reasonably conclude the tag is dead. The relevant primitives are inventory, get system information, and read or write single block |
> | Write protection, lines 230 to 247 | Lock bytes, 16 byte blocks | Area based 64 bit password. Blocks are 4 bytes |
> | URL scheme, line 122 and elsewhere | `https://trevean.com/blend/{blendId}?chipUid={chipUid}` | `https://treveanspice.com/t/{code}`, fixed, already encoded on 1,000 shipped tags |
> | Chip UID, lines 316 to 332 | "Chip UID embedded in NDEF", "Server validates chip authenticity" | **Attribution is per SKU.** There is no per-tag identifier and no chip UID available to the page. Augmented NDEF and TruST25 exist on this chip and are deliberately dormant |
>
> ### What in this document is still correct and is being carried forward
>
> Roughly the first 90 lines are generic NFC Forum material and are accurate:
> the NDEF message and record structure at lines 34 to 74; the URI prefix byte table at
> lines 84 to 93, including `0x04` for `https://`; and the RTD_URI record definition,
> TNF `0x01`, type `0x55`. These are carried into the replacement specification rather than
> rewritten.
>
> **Replacement:** M1 deliverable "Tag writing instructions". Ask Serene Labs for the
> current copy before touching any tag.
```

---

## 12b, first document. `docs/ARCHITECTURE.md`

```markdown
> ## PARTLY SUPERSEDED. Read this before relying on anything below.
>
> **Recorded 22 August 2026 by Serene Labs Inc, following the M1 scaffold audit.**
>
> This document describes the system the previous team intended. It is useful as evidence
> of intent and it is not a description of what is in this repository.
>
> | Claim | Reality in this repository, verified August 2026 |
> |---|---|
> | "Infrastructure as Code", lines 273 to 283: "Deployment uses CloudFormation/Terraform", closing with "All infrastructure is version controlled and reproducible" | **There is no infrastructure as code and there never has been.** Zero Terraform, CDK, SAM, Serverless, CloudFormation, Pulumi, Docker or Compose files. This repository contains no YAML file at all outside the CI added in August 2026. The closing sentence is false, and it is the single most consequential error in these documents because it can be relied on in planning |
> | GraphQL, lines 19, 39, 51 and 55: "Apollo Server on Lambda", "GraphQL client wrapper" | **The backend is Express REST.** There is no GraphQL anywhere and Apollo is not a declared dependency. `docs/DIRECTORY-GUIDE.md` line 85 states this correctly, so the two documents contradict each other and the one that is right is not the one titled Architecture |
> | Line 265: "Configuration backed up to AWS Secrets Manager" | No code anywhere references Secrets Manager, SSM Parameter Store or any managed secret store |
> | Lines 104 and 117: NTAG216, NTAG213, 888 bytes | **The tag is an ST25TV02KC, Type 5 / ISO 15693, 256 bytes.** See the header on `docs/NFC-SPECS.md` |
>
> **What is accurate:** the five DynamoDB table names. Everything below the names is
> absent, inconsistent, or designed for a per-tag identity model this project retired.
>
> The current architecture is held by Serene Labs Inc as an M1 deliverable.
```

---

## 12b, second document. `docs/DIRECTORY-GUIDE.md`

```markdown
> ## SUPERSEDED. Roughly a third of this document describes files that do not exist.
>
> **Recorded 22 August 2026 by Serene Labs Inc, following the M1 scaffold audit.**
>
> This is the largest file in the repository, it is dated "February 2026", and it is
> addressed to "New developers joining the repository". **It is the file most likely to be
> read first and it is most detailed exactly where the repository is emptiest.** If you are
> new here, this header is the most useful thing on the page.
>
> | Documented | Reality |
> |---|---|
> | `src/nfc/` with `encoder.ts`, `programmer.ts`, `types.ts`, `validator.ts`, lines 205 to 227 | **The directory does not exist.** Four files described in detail, zero present |
> | `.github/workflows/ci.yml` and `deploy.yml`, lines 332 to 348, down to "Uses a DynamoDB Local service container" | Neither existed. CI was added in August 2026 and looks nothing like this |
> | `.github/ISSUE_TEMPLATE/bug_report.md`, `feature_request.md` | Neither exists |
> | `config/.env.example` line 241, `src/web/.env.example` line 138 | `config/.env.example` was added in August 2026. There was no `.env` file of any kind before that |
> | `.gitignore` at the repository root, line 33 | Added August 2026. Before that there was a file named `config/,gitignore`, with a leading comma |
> | `tests/integration/`, line 266 | The directory was `tests/integrations`, plural. Its contents were deleted in August 2026, see the note below |
> | `formatNfcUrl()`, `encodeNdefUrl()`, `generateTagId()`, lines 76 to 79 | No such functions. The file exports `generateTagUrl(blendId)`: one argument, different name, different URL |
> | `validateNfcPayloadSize(url)` "checks the encoded payload fits in 888 bytes", line 78 | The function exists. **888 is an NTAG216 figure. This tag has 256 bytes** |
> | The blend table, lines 359 to 365: North African Night Market from Marrakech, Caribbean Sunset from Kingston | The file it claims to describe says **Fez** and **Trinidad and Tobago**, with different freshness windows. It contradicts the file it documents, in the same repository, on both origin and every number. Fez and Trinidad and Tobago are correct |
>
> **The one place this document is honest** is line 283, the note that the `*.resolver.test.ts`
> files actually test REST controllers "for historical reasons". That is the only warning in
> 391 lines and it is correct.
>
> **On the tests:** all eight suites were deleted in August 2026. They were 2,102 lines that
> had never executed, imported module paths this repository has never had, and asserted an
> 840 byte NTAG216 memory limit against a 256 byte chip. They are recoverable from git
> history at the tag `pre-consolidation-tests`.
```

---

## 12b, third document. `docs/GUIDE.md`

```markdown
> ## SUPERSEDED. The API reference and the NFC section describe things that were never built.
>
> **Recorded 22 August 2026 by Serene Labs Inc, following the M1 scaffold audit.**
>
> - **The entire API Reference, lines 68 to 155, is GraphQL**, including a `saveFavorite`
>   mutation that has no counterpart of any kind in this repository. The backend is Express
>   REST. The current API is defined by the frozen OpenAPI 3.1 document held by Serene Labs
>   and checked into this repository as part of the contract test adoption.
> - **The NFC Chip Programming section, lines 237 to 262, gives three command lines against
>   `src/nfc/programmer.ts`, which does not exist**, for the wrong chip, on the wrong domain,
>   with the wrong identifier format. Line 261 states "NDEF Format: Standard NFC Forum
>   Type 2". **The tag is Type 5, ISO 15693.** See the header on `docs/NFC-SPECS.md`, which
>   carries a safety warning about the lock procedure.
> - **Line 263 sets "Max URL Length: 300 characters" while `docs/NFC-SPECS.md` says 840**, so
>   the two documents do not agree with each other even about the wrong chip. Neither figure
>   is the constraint. The tag has 256 bytes of EEPROM in total.
> - The deployment guide describes `scripts/deploy.sh`, which **cannot succeed**: it consumes
>   `dist/api` and `dist/web`, and `scripts/build.sh` produces neither. That script was
>   disabled in August 2026 and its header explains why.
```

---

## 12b, fourth document. `README.md`

```markdown
> ## Parts of this README are out of date. Corrections, 22 August 2026.
>
> **Recorded by Serene Labs Inc following the M1 scaffold audit.** Kept short: this is the
> first file anybody opens and a long header defeats the purpose.
>
> - **Line 31, "NTAG 216 (888 bytes)": wrong chip.** The tag is an STMicroelectronics
>   ST25TV02KC, NFC Forum Type 5, ISO 15693, **256 bytes**. See the header on
>   `docs/NFC-SPECS.md` before doing anything with a physical tag.
> - **Line 32, "GraphQL API": the backend is Express REST.** There is no GraphQL anywhere.
> - **Lines 44 to 56, the repository structure**, lists `src/nfc/` and `tests/integration/`.
>   `src/nfc/` does not exist. The test suites were deleted in August 2026 and are
>   recoverable from git history at the tag `pre-consolidation-tests`.
> - **Line 56** describes `.github/` as containing "GitHub Actions workflows and issue
>   templates". Until August 2026 it contained three 2 byte placeholder files and nothing
>   else. There are now real workflows and still no issue templates.
> - **Line 76** gives the clone URL as `nfc-prototype`. This repository is `nfc-development`.
> - **Line 83**, `cp config/.env.example config/.env`: that file was added in August 2026.
>   It had never been committed, so this instruction could not be followed by anyone.
>
> **What this README gets right and `docs/DIRECTORY-GUIDE.md` gets wrong:** the blend table
> at lines 123 to 129, with Fez and Trinidad and Tobago. It is the only one of the five
> documents that has those correct.
>
> **On authorship, lines 13 and 152:** this file and `CONTRIBUTING.md` credit Microgroove
> with the platform development and technical architecture, while `LICENSE` asserts
> Trevean Spice's copyright. No Microgroove owned code, private registry, submodule or
> vendored dependency was found anywhere in the working tree or in any commit on any ref, so
> nothing here requires a licence from anyone. The wording is a matter for Trevean.
```

---

## What to send Dan

Two asks, in one short message, in this order. The first stands alone so it can be answered
alone.

> Two things in the repository need your yes, and the first one is a safety item.
>
> docs/NFC-SPECS.md is a 358 line specification for the wrong chip. It describes NTAG216 on
> ISO 14443. The tags in the jars are ST25TV02KC on ISO 15693, which is a different memory
> model and a different write protection model. The part that matters: its programming
> procedure writes lock bytes and then verifies afterwards. On these tags a block lock is
> permanent, no password undoes it, and a tag locked that way is scrap. Anyone following
> that document against real stock could destroy inventory at batch scale, and the document
> reads as authoritative, which is what makes it dangerous.
>
> We would like to add a short header to that file saying it is superseded, naming what is
> wrong and pointing at the current instructions. It changes nothing else in the file. It is
> your repository so it is your call, and it is fifteen minutes once you say yes.
>
> The second, whenever suits: the same treatment for README.md, ARCHITECTURE.md, GUIDE.md
> and DIRECTORY-GUIDE.md. Between them they describe a GraphQL API that was never built, two
> CI workflows that never existed, four source files that are not there, and infrastructure
> as code that does not exist. None of that is dangerous. It costs the next engineer their
> first two days and it costs them silently, which is why it is worth an hour now.
