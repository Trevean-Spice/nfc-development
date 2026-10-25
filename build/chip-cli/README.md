# chip-cli: the Trevean Spice tag programming tool

**For:** the Trevean staff member who encodes tags, and the engineer who maintains the tool.
**Prepared by:** Serene Labs Inc (Jacob Ralph) for Trevean Spice.
**Deliverable:** M4, chip programming tooling, due Friday 18 September 2026.
**Status:** built and tested against a software model of the chip. **It has not been run against a physical tag or a physical reader.** Protection on the PC/SC transport is implemented and **gated on a probe that must pass on a real tag first**; section 6.4 says why. Section 6 says exactly what that does and does not leave proven, and it is the section to read before anything is encoded for sale.

---

## 1. What this is, and what it is not

**It is a command line tool that encodes STMicroelectronics ST25TV02KC tags with one NDEF URI record, reads every tag back to prove what it holds, and applies area based 64 bit password write protection, in that order, for batches of up to several hundred units.**

**It is not NTAG tooling and none of the NTAG habits apply to it.**

| Topic | NTAG, which is what most NFC material describes | ST25TV02KC, which is what this project uses |
|---|---|---|
| Family | Type 2, ISO 14443 | **Type 5, ISO 15693** |
| Memory | Varies by part. NTAG216 user memory is 888 bytes | **256 bytes, in 64 blocks of 4** |
| Write protection | One time programmable lock bits | **Area based 64 bit password** |
| Is protection reversible | No. Set once, never cleared | **Yes, with the password** |
| Tooling | Most tools and phone apps | Does not apply here and will usually be wrong |

The previous team's work in the client repository targets NTAG216. Nothing in it contributes to this. That is recorded in the Scope document, "In scope", item 4, and in the Decision log, entry D19.

**What the tool does that a phone and a free app cannot:**

- The URL comes out of the redirect table in version control, so a code cannot be mistyped.
- Every unit is read back and decoded automatically, rather than a person checking a string several hundred times.
- Protection is applied consistently, from the secret store, and only after verification.
- A batch produces a file recording which tags carry which code, so it is a record rather than a memory.
- It refuses to write `/t/kg`, and anything else the table does not carry.

**The manual method in the M1 document "Tag writing instructions, ST25TV02KC" is still correct for a handful of sample tags.** This tool is for volume. That document caps hand encoding at about twenty tags, and it is right to.

---

## 2. Before you start

You need, in this order:

1. **Node.js 20 or newer.** Check with `node --version`.
2. **This folder, built once.** Open a terminal in `build/chip-cli` and run:
   ```
   npm install
   npm run build
   ```
   You only do this once, or after the tool is updated.
3. **The redirect table**, which is already in the repository at `build/edge/redirect-table.json`. You do not edit it and you do not copy it. The tool reads it.
4. **Tags. Bare ST25TV02KC 40 mm units only.** **Do NOT expect to re encode units from order SO4731.** The client confirmed on Friday 11 September 2026 that the shipped run **is write protected**, reversing his August answer, and **nobody at Trevean holds the ST25TV area password**. Without it those tags refuse every write. See "Decision log", D45.
5. **A reader.** The client holds an **ACR1552U with GoToTags**, confirmed Wednesday 16 September 2026. It is NFC Forum certified across ISO 14443, **ISO 15693** and ISO 18092, so it is the correct standard for these tags. **It is at the client's end, not ours**, because the M4 criterion is that Trevean staff encode a tag unaided. See section 6. **The PC/SC transport now exists** (`src/transport/pcsc.ts`, written Thursday 17 September 2026) and covers encoding, read back and verification. **It has never talked to a chip**, so section 6.3 is still the gate. **Password and area protection ARE implemented as of Wednesday 7 October 2026**, and the two irreversible commands are gated on the tag itself proving the opcodes first, because the opcodes come from secondary sources rather than the datasheet. **Read section 6.4 before using `--protect` on a reader.**

Check everything at once:

```
node bin/chip-cli.mjs doctor
```

It prints one line per check and finishes with `Ready.` or with the number of checks that failed.

---

## 3. Five minutes: your first tag

Run these four commands in order. None of them touches a tag except the last, and the last one uses the simulator unless you ask for a reader.

**1. See what codes exist.**

```
node bin/chip-cli.mjs codes
```

Four codes are encodable: `ps`, `cs`, `sr`, `nm`. `kg` (Kyoto Garden) is reserved and the tool refuses to write it. A tag carrying `kg` would produce a not found page at a customer's kitchen counter.

**2. See exactly what would go on the chip.**

```
node bin/chip-cli.mjs encode --code ps
```

This shows the URL, the bytes, and how much of the 256 byte chip is used. For every blend it is 29 bytes of the 248 byte usable area. Capacity is not a concern on this part and never will be. If a tool ever tells you the tag is too small, that tool has misidentified the tag.

**3. Rehearse without touching anything.**

```
node bin/chip-cli.mjs write --code ps --dry-run
```

**4. Write one tag.**

```
node bin/chip-cli.mjs write --code ps
```

You will see four lines: the tag selected, the blocks written, the read back verified, and `OK`. **The verified line is the one that matters.** A write that reports success only means the tag accepted some bytes. The verified line means the tool read the tag back and the bytes decode to the intended URL.

To use a real reader instead of the simulator, add `--transport reader`. That is the PC/SC transport and it needs the optional PC/SC binding, `pcsc-mini`, which `npm ci` (or `npm install`) in this folder installs as a prebuilt binary, with no compiler needed. **Setting up a Windows or Mac machine from nothing, reader driver included, is in `SETUP-WINDOWS-MAC.md`.** **It has never been run against a physical tag**, so the first person to try it is doing section 6.3 rather than routine work, and should read that section first.

---

## 4. Running a batch

One blend per run. Do not mix blends in a tray: deciding the code before you pick up the tag is the single cheapest defence against a wrong code, and it only works if the whole tray is one blend.

```
node bin/chip-cli.mjs batch --code ps --count 125 --journal runs/2026-09-18-ps.jsonl
```

What happens:

- Each unit is written, read back, verified, and recorded, in that order.
- Each unit is written to the journal file and flushed to disk **before** you are asked for the next tag.
- Progress prints one line per unit.
- At the end you get a summary that accounts for **every** sequence number from 1 to the count. Nothing is skipped quietly.

**If it stops, for any reason.** Press Ctrl+C, close the laptop, trip over the cable: it makes no difference. Run **exactly the same command again** and it continues from where it stopped. Nothing already finished is redone and nothing is missed.

**To see where a run got to:**

```
node bin/chip-cli.mjs status --journal runs/2026-09-18-ps.jsonl
```

`status` prints the command that resumes the run, and it prints all of it: the code, the count, the journal, the table, the transport, and `--protect` on a protected run. It used to print only the first three, which meant that on a protected run the command the tool told you to run exited 2 with `JOURNAL_MISMATCH`, and after the transport check landed it failed on hardware runs too. The one thing it cannot print is the password, because the password is not in the journal: the header carries a fingerprint and nothing else. So a protected run prints a placeholder in the password position, names the fingerprint, and says what to substitute. Everything else is copied verbatim.

`status` also checks every line in the journal against its own digest. If any line fails, it prints the line number and refuses to print a resume command at all, and exits 2. **Do not resume a journal in that state.** A forged or corrupted line is well formed JSON with a plausible sequence number and outcome, which is exactly why it needs checking: two lines copied from unit 1 with the sequence number changed used to make a three unit run resume to "complete" with zero tags touched.

**A unit that fails** is retried once, then recorded as failed and the run moves on. Set that tag aside and label it. The summary lists every failed unit number, and the journal holds the reason for each. A failed unit is put back in the queue on the next run, so resuming asks you for a replacement tag for it.

**The run stops on its own** after ten failures. That is usually the reader or the tray, not the tags.

**Useful additions:**

| Option | What it does |
|---|---|
| `--dry-run` | Plans the whole batch and touches nothing |
| `--prompt` | Waits for you to press Enter between tags. On by default with a real reader on an interactive terminal |
| `--attempts 3` | Attempts per tag before it is recorded failed. Default 2 |
| `--max-failures 5` | Stop the run sooner |
| `--verify-after-power-cycle` | Lifts the tag out of the field before reading it back. Slower and stronger. See section 6 |

**Exit codes**, if this is being run from a script: `0` complete, `2` an operational failure, `3` the batch did not complete, `130` interrupted.

---

## 5. Write protection and the password

**Do not apply write protection until Trevean has decided to.** It is off unless you pass `--protect`.

### 5.1 What the protection actually is

The chip's memory is divided into areas. An area can be write protected, and that protection is tied to a **64 bit password**: eight bytes, written as sixteen hexadecimal characters.

- Present the correct password and the area accepts writes for that session.
- Take the tag out of the field and it is protected again.
- Holding the password, you can remove the protection and you can change the password.

**This is not an NTAG lock bit.** A lock bit is a fuse: set once, never cleared, by anybody including the manufacturer. This is a state you can change.

**Which moves the whole risk from permanence to custody.** There is no reset, no master key and no recovery service. **Lose the password and the tag is frozen exactly as if it had been fused shut.**

### 5.2 The order, which the tool will not let you break

**Write, read back, verify, then protect.** Never protect before verifying.

The tool enforces this rather than documenting it. Protection cannot be applied except by handing in a verification receipt that only the read back step can produce, and the tool re derives the expected bytes from that receipt before it protects anything. A wrong lock is not recoverable the way a wrong write is, so this is a constraint in the code and not a convention in a document.

**The client's own NFC-SPECS document has this sequence the wrong way round.** That is why it is built in here.

### 5.3 Using it

```
export TREVEAN_TAG_PASSWORD=<sixteen hex characters from the secret store>
node bin/chip-cli.mjs batch --code ps --count 125 --journal runs/ps.jsonl \
  --protect --password-env TREVEAN_TAG_PASSWORD
```

**There is deliberately no `--password` flag.** Command line arguments are visible to every other process on the machine and end up in shell history. The password comes from an environment variable or from a file, and nothing else.

The tool refuses a password of sixteen zeros, because that is the factory default and protecting an area with it protects nothing. It also refuses a single repeated character.

To generate one:

```
node -e "console.log(require('crypto').randomBytes(8).toString('hex'))"
```

### 5.4 After protection, the tool proves it took

Applying protection and being told "accepted" is not proof. For every protected unit the tool then:

1. drops the tag out of the field, so no password is presented any more,
2. reads the protection state back and requires it to say write protected,
3. reads the NDEF back and requires it to still decode to the right URL, because a protected tag no phone can read is a scrap tag that passed every other check,
4. attempts a write, and **requires it to be refused**. The bytes it attempts are the bytes already there, so if protection somehow did not take, the tag is unchanged and the unit fails rather than being recorded as protected.

### 5.5 Custody

- The password lives in the managed secret store. Never in this repository, never in a spreadsheet, never in a message.
- It has a named holder and a documented rotation path.
- It is handed to Trevean at M5, because a tag password Trevean does not hold is a tag estate Trevean does not own.
- The batch journal records only a **fingerprint**, the first eight hex characters of the SHA-256 of the password. Enough to prove which key a run used. Not enough to recover it. A test asserts the password itself never reaches the file.

---

## 6. What is proven without hardware, and what is not

**Read this before anything encoded by this tool goes on a jar for sale.**

This tool was built on a machine with no NFC reader and no tags. Everything above the hardware boundary is exercised by 143 automated tests against a software model of the ST25TV02KC. That is a real and useful thing, and it is not the same as a tag.

### 6.1 Proven, by tests you can rerun

Run `npm test` and read the count. These are properties of the code and they hold:

- The NDEF URI record is built correctly, byte for byte, against the NFC Forum URI Record Type Definition. The `https://` prefix abbreviation is applied as identifier code `0x04`, saving eight of the 256 bytes.
- Every code in the redirect table produces exactly the URL the Scope document states, asserted against strings transcribed from that document rather than read from the file under test.
- Encoding and decoding round trip, including for awkward URIs, and the decoder refuses a second record, a truncated record, a reserved prefix code and a record that is not a URI record.
- The 248 byte usable area is enforced. A URI that exactly fills it is accepted and one byte more is refused with both numbers in the message.
- Protection cannot be applied before verification. Six separate tests assert both that the tool refuses and that no protection command reached the tag.
- A batch of 500 units completes with 500 journal records and no gaps, resumes correctly after an interruption, retries units that failed, and refuses to resume a journal belonging to a different code, a different count or a different redirect table.
- Every failure path produces a named code and a remedy: no tag, wrong part, refused write, partial write, corrupted read back, refused password, already protected tag, refused protection.
- A dry run makes **zero** transport calls of any kind.

### 6.2 Not proven, and only a tag can prove it

**Everything below the hardware boundary. There is no reader implementation, so none of the following has been observed:**

1. **That any of this works on silicon at all.** `src/transport/pcsc.ts` is written against published PC/SC documentation and **has never talked to a chip**. `src/transport/reader-stub.ts` remains reachable as `--transport stub`, refusing predictably, so a bring up failure can be attributed to hardware rather than to us.
2. **The ST specific command set.** Present Password, Write Password and the area configuration commands are ST custom commands. Their opcodes are deliberately not written into the stub, because copying opcodes from a datasheet into code that has never run would create exactly the kind of unverified fact this project keeps out of its documents.
3. **The capability container byte 3.** This is the one byte in the whole image the tool cannot check for itself: a wrong feature flag is invisible to a read back and visible only to a phone. **This is why the tool preserves a capability container the tag already carries rather than overwriting it**, which for SO4731 stock means keeping the one that measured 79/80 on iPhone and 40/40 on Android on 6 August. Only tags with no valid container get one from this tool, and those are the ones to check on a phone first.
4. **Programming time.** The tool assumes a block write does not return until the byte is committed to EEPROM. If a reader returns on acknowledgement instead, the read back catches it, but catching it once per tag at pack out is expensive.
5. **Whether protection behaves as modelled.** The simulator implements the password model as the datasheet describes it. The datasheet is not the part.
6. **Anything to do with RF.** Range, alignment, collisions, writing through the 8 mm bamboo lid, and how forgiving a write is compared with a read. None of it is modelled and none of it can be.
7. **Timing at volume.** The five minute figure in the Scope document is about a member of staff operating the tool unaided, not about throughput. Real seconds per tag can only be measured with a reader.

### 6.3 What has to happen on real silicon, in order, on sacrificial tags

Not on SO4731 stock, and not on anything destined for a jar.

1. ~~Implement the transport.~~ **DONE for the encode and verify half**, as `src/transport/pcsc.ts`. The optional binding, `pcsc-mini`, is installed by `npm ci`; see `SETUP-WINDOWS-MAC.md`. The protection half is deliberately unimplemented; see section 6.4.
2. `chip-cli doctor --transport reader` on a bare tag. Confirm the geometry it reports is 64 blocks of 4 bytes.
3. `chip-cli write --code ps --transport reader` on a bare tag, then tap it with a real phone and confirm the correct blend page opens. That is the check that actually matters, and it is the one people skip.
4. Repeat with a tag taken from SO4731, to confirm re encoding works on stock as the client has said it does.
5. Only then, on a sacrificial tag and with a password nobody minds losing, `--protect`. Confirm the tag still reads on a phone afterwards.
6. Only then, protection on anything real.

Until step 3 has been done and written down, **no claim about hardware behaviour should be made to the client**, including by us.

---

### 6.4 Protection is implemented, and it is gated on the tag proving the opcodes first

**Written Wednesday 7 October 2026, replacing the section that said this was
deliberately unimplemented.** It is implemented now. **What has not changed is that
the opcodes still do not come from a datasheet**, so the design that makes them safe
to ship is the content of this section.

#### What was tried first

The ST25TV02KC datasheet and application note AN5658 were sought from **five routes**
and none produced the document: `st.com` timed out twice and then refused connections
outright, the Mouser mirror served an HTML bot block, and two ST community threads
discuss the ISO subset without giving command codes.

So the values in `src/chip/st-custom.ts` come from **secondary sources that agree with
each other and with the documented ST25DV family convention.** Every one carries its
provenance and a confidence label, and **none is marked `measured`.** A test enforces
that, so the day somebody upgrades one, they have to think about whether it is true.

#### The split that makes this shippable

| Command | Code | Reversible | Allowed |
|---|---|---|---|
| **Present Password** | `0xB3` | **Yes.** Wrong opcode or wrong password both just fail | **Always** |
| **Read protection state** | `0xBA` read form | **Yes.** Read only | **Always** |
| Write Password | `0xB1` | **NO** | **Only after the probe passes** |
| Set Memory Protection | `0xBA` | **NO** | **Only after the probe passes** |

**Present Password cannot damage a tag.** It is either accepted for the session or
refused, and nothing is written either way. That makes it probe-able, and a probe that
behaves correctly is evidence the whole path is right: the opcode, the manufacturer
byte, the flag byte, the transparent session framing and the reader's transceive
wrapper. **Nothing else in the chain produces a discriminating answer.**

#### The probe

`verifyOpcodes()` presents a **deliberately wrong** password, then the **factory
default**, and requires the chip to answer those two **differently**.

- **Different answers:** the path is confirmed on real silicon, and the irreversible
  pair unlocks **for that session only**.
- **Same answer:** nothing is proven, whatever the answer was, and the irreversible
  pair stays locked. Either the tag already carries a password, or one of the bytes is
  wrong.

**Run it on a sacrificial bare tag.** It is safe by construction, but the point of a
bring up is finding out on a tag you do not mind losing.

#### Why the gate exists rather than a flag somebody can set

**A wrong byte in the irreversible pair does not fail safe.** It can leave a tag
protected with a value nobody recorded, which is **exactly the state the 1,000 jars of
order SO4731 are already in**: locked, by a supplier, with a password Trevean does not
hold. See "Decision log", D45. The project has already paid that price once and the
tooling is not going to repeat it on an unverified constant.

#### What is still not proven

**None of this has touched a chip.** The gate means an unproven path refuses rather
than guesses, which is a different and better failure than the one section 6.2
describes, but it is **not** the same as working. Section 6.3 is still the bring up
sequence, and step 3, a real tag and a real phone, is still the step that matters.

**The most useful thing this transport can do today needs no probe at all:**
`readAreaProtection` is read only and answers the question open since September, which
is what protection the supplier actually applied to SO4731.

---

## 7. If something goes wrong

Every failure prints a code and a line beginning `What to do:`. The codes:

| Code | What happened | What to do |
|---|---|---|
| `TAG_ABSENT` | No tag arrived at the reader | Place the tag centred on the reader and retry the unit |
| `TAG_NOT_ST25TV02KC` | The tag reports a memory size that is not 256 bytes | This is not the part. Check which tags you have. Nothing was written |
| `TAG_CHANGED` | A different tag came back into the field partway through a unit | Nothing was locked by that step. Set both tags aside, label them, and rerun the unit with one tag on the reader |
| `WRITE_FAILED` | The tag refused the write, or the write stopped partway | Rewrite the tag. It cannot be carrying a wrong URL: see section 7.1 |
| `READBACK_FAILED` | The tag stopped responding during the read back | Hold the tag still and retry the unit |
| `READBACK_MISMATCH` | The tag holds something other than what was written | Do not ship the tag. Rewrite and verify. If it fails twice, set it aside and label it |
| `AREA_PROTECTED` | The tag is already write protected | Supply the password it was protected with, or set the tag aside |
| `PASSWORD_REJECTED` | The tag holds a different password | Check the secret store. **Do not guess.** There is no reset and no recovery service |
| `PASSWORD_MISSING` | Protection was asked for with no password source | Set the environment variable, or pass `--password-file` |
| `PASSWORD_INVALID` | The password is not sixteen hex characters, or is the factory default | Correct it in the secret store |
| `PROTECT_FAILED` | Protection was refused, or did not take | Set the tag aside, label it, report it. **Do not record it as protected** |
| `PROTECT_BEFORE_VERIFY` | The tool was asked to protect before verifying | This is a bug in the tool, not your mistake. Report it. Nothing was locked |
| `CODE_NOT_ENCODABLE` | The code is reserved in the redirect table, for example `kg` | Do not write it. The table has to change and be redeployed first |
| `CODE_UNKNOWN` | The code is not in the table | Run `chip-cli codes` |
| `TABLE_INVALID` | The redirect table contradicts itself | **Stop. Write nothing.** Report it |
| `JOURNAL_MISMATCH` | This journal belongs to a different run | Resume the run it belongs to, or start a new file |
| `JOURNAL_CORRUPT` | A record does not match its own digest, or a line is unreadable | **Do not resume this file.** The list of units already done cannot be trusted. Count the tags physically written, then start a new run into a new journal file for the units that are left |
| `TRANSPORT_UNAVAILABLE` | No reader reachable, usually the optional PC/SC binding is not installed | Run `npm ci` in `build/chip-cli`, which installs the prebuilt `pcsc-mini` binding. See `SETUP-WINDOWS-MAC.md`. Or use `--transport simulator` |

### 7.1 Why a failed write cannot leave a tag pointing at the wrong page

On ISO 15693 the memory is written one four byte block at a time, so a write can stop halfway. That is a documented failure mode of this air interface, and a partly written tag reporting a plausible URL is the worst thing that could come out of a packing room.

The tool writes in an order that makes this safe:

1. First it writes a terminator into the first block of the tag area. The tag now reads as formatted and empty.
2. Then it writes the body of the message.
3. Then it writes the block holding the record header, last, so the record becomes readable in a single block write.
4. The capability container, if it needs writing at all, goes last of all.

An interruption at any point leaves either the old content untouched or a tag that opens nothing. There is no window in which a reader sees a valid header in front of an incomplete message. This costs one extra block write per tag and a test asserts the ordering.

---

## 8. Command reference

```
chip-cli codes                          list the codes in the redirect table
chip-cli encode --code ps               show exactly what would be written. No tag needed
chip-cli decode --hex <bytes>           turn NDEF bytes back into a URL
chip-cli write --code ps                write, read back, verify one tag
chip-cli verify --expect ps             read one tag and check it carries the right URL
chip-cli batch --code ps --count 125 --journal runs/ps.jsonl
chip-cli status --journal runs/ps.jsonl progress of a batch
chip-cli doctor                         preflight checks
```

Common options: `--table <path>`, `--transport simulator|reader`, `--dry-run`, `--json`.
Protection: `--protect`, `--password-env VAR`, `--password-file path`, `--current-password-env VAR`.
Simulator, for practice and for testing without hardware: `--sim-tray N`, `--sim-preload-uri <uri>`, `--sim-preload-blank`, `--sim-fault <position>=<kind>`.

Fault kinds you can inject at a tray position: `tag-absent`, `write-fail`, `write-partial`, `readback-fail`, `readback-corrupt`, `protect-fail`, `wrong-password`, `geometry-mismatch`. These exist so the failure paths can be rehearsed, including by a member of staff practising before a real run.

Run `chip-cli --help` for the full list.

---

## 9. Files this tool writes

**One: the batch journal.** Nothing else on disk changes. The redirect table is read and never written.

The journal is one line of JSON per event. The first line describes the run, then one line per unit attempt, then one line closing the run. Every line carries a digest of itself. It is append only: a retried unit's earlier failure stays visible rather than being overwritten.

Keep these files. They are the record of which tags carry which code, and they are what a recall or a customer complaint would be answered from. Suggested naming: `runs/YYYY-MM-DD-<code>.jsonl`.

**The password is never in this file.** Only its fingerprint. A test asserts it.

---

## 10. For the engineer wiring up a real reader

The hardware boundary is `src/transport/transport.ts`, a twelve method interface. Everything above it is pure logic with no I/O. There are three implementations: `simulator.ts`, a model of the memory and what the tests run against; `pcsc.ts`, the real one, covering the encode and verify half and never yet run on silicon; and `reader-stub.ts`, which refuses everything and is kept for attributing bring up failures.

**Adding hardware means filling in one file.** Nothing else changes, and the whole test suite continues to apply, because the tests exercise the layers above the boundary.

The stub carries the notes: which commands are needed, which are ISO standard and which are ST custom, and the three contract points the rest of the tool relies on. Read it before starting.

The interface is deliberately chip shaped rather than NDEF shaped: it speaks blocks, passwords and area protection, which is what a reader offers. Pushing NDEF below the boundary would put encoding logic where it could not be tested without hardware.

---

## 11. What Trevean has to decide

| # | Item | Why it needs a decision |
|---|---|---|
| 1 | **Whether to write protect at all, and when.** | Protection is off unless asked for. It is reversible with the password and unrecoverable without it. Protecting stock stops anybody with a phone rewriting a jar on a shelf, which is a real exposure now that we know SO4731 shipped unprotected. It also means every future re encode needs the password |
| 2 | **Who holds the password, and how it rotates.** | Named holder, managed secret store, handover at M5. A tag estate whose password Trevean does not hold is not Trevean's estate |
| 3 | **How the 500 unit pilot splits across blends.** | The tool runs one blend per journal. Four lots of 125 is the obvious reading of the four encodable codes, and it is an assumption until confirmed |
| 4 | **Whether to re encode any of the 1,000 shipped tags.** | The tooling now serves this production run and not only the next order, because the tags carry no protection. The M1 QR attribution addendum, section 7, records re encoding as an option and does not recommend it. That position has not changed |
| ~~5~~ | ~~**Which reader to buy.**~~ | **CLOSED Wednesday 16 September 2026. The client already owns an ACR1552U with GoToTags**, which is NFC Forum certified across ISO 14443, ISO 15693 and ISO 18092. Nothing to buy at either end |
| 6 | **Sacrificial tags for hardware bring up.** | Section 6.3 needs tags nobody minds losing, including at least one that gets protected with a password that is then deliberately discarded |

**One item for the record rather than for decision, and it is now done.** The redirect table recorded `writeProtected: null` on all five rows, which read as "unrecorded", after the client answered on Wednesday 19 August 2026 that SO4731 shipped with no write protection. **The table was corrected on Saturday 22 August 2026** and now carries `false` on the four encoded rows and `null` on the reserved row, where no tag exists to have a state, so the file and the fact agree. The table is outside this package and is not edited by this tool. **What is still open is the read-back:** that is the client's answer rather than the supplier's written one, and this tool's verify path is how it gets confirmed against our own bare stock and against one shipped jar.

---

**If anything here conflicts with the ST25TV02KC datasheet or with application note AN5658, the datasheet is right and this document has a bug in it.** Tell us either way.
