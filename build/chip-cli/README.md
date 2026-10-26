# chip-cli: the Trevean Spice tag programming tool

**For:** the Trevean staff member who encodes tags, and the engineer who maintains the tool.
**Prepared by:** Serene Labs Inc (Jacob Ralph) for Trevean Spice.
**Deliverable:** M4, chip programming tooling, due Friday 18 September 2026.
**Status:** built and tested against a software model of the chip. **It has not been run against a physical tag or a physical reader.** Protection on the PC/SC transport is implemented and **gated on a probe that must pass on a real tag first**; section 6.4 says why. Section 6 says exactly what that does and does not leave proven, and it is the section to read before anything is encoded for sale.

---

## The easy way: Start Tag Tool

**For writing many tags in a row, double click `Start Tag Tool.cmd` (Windows) or `start-tag-tool.command` (Mac) in the tag tool folder.** It installs and builds on the first run, then opens a page in the browser that shows the reader and the tag live, takes a product code from a list of the writable codes, and writes and verifies each tag as it is put on the reader, with desktop notifications when the reader is ready, a tag is seen, a tag is written, and on any error. A box turns on writing the same code to every new tag automatically. Step by step, in plain words: the first section of `SETUP-WINDOWS-MAC.md`.

What it is underneath, for the engineer:

- `src/app/`: a Node `http` server on **127.0.0.1 only** (the address is a constant, not an option), first free port from 10350 to 10359, live state over server sent events with polling as the fallback. `node bin/tag-tool.mjs --help` for its options; `--simulator` rehearses with no reader and adds buttons to put a tag down, lift it, and unplug the reader.
- **Each tag goes through the same `UnitSession` select, write and verify path as `chip-cli write` and `batch`, unchanged**, two attempts per tag as the batch does, and is journalled in the batch journal format (section 9) to `runs/tag-tool/`, one file per product code per session.
- **It never protects a tag.** It has no password or protection control, never calls the protect step, and wraps the transport (`src/app/write-only.ts`) so that every member on the protection path is refused before it reaches the reader: presenting, changing or applying a password, the protection read, the opcode probe, and the two proofs that follow protection. A test lists every `TagTransport` member and which side of that line it is on, and the build fails until a new member is placed. Protection stays in `chip-cli` (section 5).
- It uses the reader only through the `TagTransport` interface, so it gets whatever `src/transport/pcsc.ts` does, including the named `TAG_ABSENT` cases and the connect to a mute tag (section 6.8). A reader that is unplugged shows "Reader not found"; a tag the reader sees but cannot read shows "The reader cannot read the tag" with the case.
- **It has been driven in a real browser** (Chromium, against `--simulator`, Monday 26 October 2026): reader ready, a tag seen with its UID, `ps` written and read back, the next tag, automatic writing on and off, `kg` refused, the reader unplugged and plugged back, and desktop notifications. **It has not been run on Windows, on a Mac, in Edge, with a physical reader or on a physical tag.**

---

## 1. What this is, and what it is not

**It is a command line tool that encodes STMicroelectronics ST25TV02KC tags with one NDEF URI record, reads every tag back to prove what it holds, and applies area based 64 bit password write protection, in that order, for batches of up to several hundred units.**

**It is not NTAG tooling and none of the NTAG habits apply to it.**

| Topic | NTAG, which is what most NFC material describes | ST25TV02KC, which is what this project uses |
|---|---|---|
| Family | Type 2, ISO 14443 | **Type 5, ISO 15693** |
| Memory | Varies by part. NTAG216 user memory is 888 bytes | **320 bytes, in 80 blocks of 4** (DS13304 Rev 7: END_MEM is 4Fh) |
| Write protection | One time programmable lock bits | **Area based 64 bit password** |
| Is protection reversible | No. Set once, never cleared | **Yes, with the password** |
| Tooling | Most tools and phone apps | Does not apply here and will usually be wrong |

**Where the 80 comes from.** STMicroelectronics datasheet DS13304 Rev 7 (February 2025): page 1, "Up to 2560 bits (320 bytes) of EEPROM", "Accessible by blocks of four bytes"; section 4.1, figure 5 note 3, "80 blocks of 32 bits for ... ST25TV02KC"; section 4.2, "Value of END_MEM is ... 4Fh for ... ST25TV02KC". In the factory single area layout, END_A1 equals END_MEM and AREA1 "is composed of (END_MEM+1) blocks", so blocks 0 to 79. Until Sunday 25 October 2026 this tool said 256 bytes in 64 blocks, and its reader probe would have refused every genuine tag.

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
5. **A reader.** The client holds an **ACR1552U with GoToTags**, confirmed Wednesday 16 September 2026. It is NFC Forum certified across ISO 14443, **ISO 15693** and ISO 18092, so it is the correct standard for these tags. **It is at the client's end, not ours**, because the M4 criterion is that Trevean staff encode a tag unaided. See section 6. **The PC/SC transport now exists** (`src/transport/pcsc.ts`, written Thursday 17 September 2026) and covers encoding, read back and verification. **It has never talked to a chip**, so section 6.3 is still the gate. **Password and area protection ARE implemented as of Wednesday 7 October 2026**, and the two irreversible commands are gated on the tag itself proving the command path first. **Since Sunday 25 October 2026 every ST command comes from the ST25TV02KC datasheet, DS13304 Rev 7, which showed the earlier secondary sourced protection command was wrong** (section 6.6). None of it has run on a chip. **Read sections 6.4 and 6.6 before using `--protect` on a reader.**

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

This shows the URL, the bytes, and how much of the 320 byte chip is used. For every blend it is 29 bytes of the 312 byte usable area. Capacity is not a concern on this part and never will be. If a tool ever tells you the tag is too small, that tool has misidentified the tag.

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

**A unit that fails** is retried once, then recorded as failed and the run moves on. **Except under `--protect`: a unit that fails after its opcode probe passed is never retried**, because from that point the tag may already be locked and the retry would start on whatever is on the reader. Set that tag aside and label it. **And a unit that may be locked stops the run**: if a unit fails with "Protection did not complete, and its irreversible part had begun", or with "WritePassword was accepted but the new password does not open the tag", the run ends at that unit, even under `--no-prompt`, rather than starting the next unit on the tag that is still on the reader. The summary names the unit. The summary lists every failed unit number, and the journal holds the reason for each. A failed unit is put back in the queue on the next run, so resuming asks you for a replacement tag for it.

**The run stops on its own** after ten failures. That is usually the reader or the tray, not the tags.

**Useful additions:**

| Option | What it does |
|---|---|
| `--dry-run` | Plans the whole batch and touches nothing |
| `--prompt` | Waits for you to press Enter between tags. On by default with a real reader on an interactive terminal |
| `--attempts 3` | Attempts per tag before it is recorded failed. Default 2. Never applies after a unit's opcode probe has passed |
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

**What the tool actually sets, from the datasheet, DS13304 Rev 7 (details in section 6.6 below).** It changes PWD_A1, the 64 bit password of area 1, and sets the area 1 protection register, RW_PROTECTION_A1, to "write allowed if AREA1 security session is open" (Table 11). That register is written under a second password, the **configuration password PWD_CFG, which the tool leaves at its factory value of zero.** So anyone who knows the ST command set can present the factory configuration password and switch the protection off again, without knowing PWD_A1, and the same factory password also unlocks the chip's Kill command, which is enabled on factory delivery (DS13304 6.4.20 and 5.5.2). The protection stops a casual rewrite with a phone app. It does not stop a determined person. Changing PWD_CFG, or permanently locking the configuration, is a separate irreversible decision, section 11 item 7.

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

Applying protection and being told "accepted" is not proof.

**Before protection, the new password must open the tag.** WritePassword answers "success" whatever value the tag stored, and the datasheet warns that a wrongly coded value is stored without complaint and then never opens the tag (DS13304 6.4.18). So straight after WritePassword, in the same reader session, the tool fetches a new random number and presents the **new** password, and requires a plain success. If it fails, the run stops with `PROTECT_FAILED`, "WritePassword was accepted but the new password does not open the tag. Area protection was NOT applied; the tag is still writable; its password 1 is unknown." The protection register is never written on that tag, and the transport refuses to write it unless the value WritePassword sent has been shown to open the tag since.

For every protected unit the tool then:

1. reads the protection register back and requires it to say write protected. This happens **before** the tag leaves the field, because on a reader that read is only allowed while the opcode probe still stands on that tag (section 6.4). On this chip the read returns the **stored** value, which "is immediately readable with a ReadConfiguration request", while the tag only **enforces** it "on next RF boot sequence" (DS13304 6.4.17 and Table 10). So a read that says anything else after the command was accepted is reported as "may already be protected", label it LOCKED?,
2. drops the tag out of the field, so no password is presented any more, and selects it again, which repeats the geometry read (block 79 must read and block 80 must not),
3. checks that the tag in the field is still the one the unit selected, by its UID, then **turns the RF field off for 10 ms and on again** inside the proof's own reader session (ACR1552U manual 5.3.5.3.3 to 5.3.5.3.5), so the tag boots with the new protection in force and no earlier password still applies, then
4. attempts a write, addressed to that UID, and **requires the tag itself to refuse it because the block is protected**: error 12h, "Write access to requested block is protected and security session is closed" (DS13304 Table 107). A write that merely fails is not enough. The bytes it attempts are the bytes already there,
5. reads the NDEF back and requires it to still decode to the right URL, because a protected tag no phone can read is a scrap tag that passed every other check. This comes after step 3's field cycle, so it reads the tag with the new protection in force,
6. in a new reader session, presents the password this run wrote and repeats the same write, which the tag **must now accept**. That is the proof that the recorded password opens the tag. It prints `unlock proven: yes`.

The three reads of the tag image (at verify, immediately before protection, and in step 5) go through one method and read the same blocks in one Read Binary. An image too long for one Read Binary, more than 63 blocks, is refused at verify, before anything irreversible, and never only after protection.

**If anything goes wrong after the first irreversible frame has been sent, the tool says so.** The message reads "Protection did not complete, and its irreversible part had begun. Password 1 may already have been changed by this run (new password fingerprint ...) ... Label the tag LOCKED? and stop", followed by the original message. It never says "nothing happened" from that point on, and a batch never retries that unit by itself and stops there. "Sent" means handed to the reader: a refusal before WritePassword goes out, which says "This command was not sent" or "WritePassword was not sent", is shown as it is, without the LOCKED? wording.

### 5.5 Custody

- The password lives in the managed secret store. Never in this repository, never in a spreadsheet, never in a message.
- It has a named holder and a documented rotation path.
- It is handed to Trevean at M5, because a tag password Trevean does not hold is a tag estate Trevean does not own.
- The batch journal records only a **fingerprint**, the first eight hex characters of the SHA-256 of the password. Enough to prove which key a run used. Not enough to recover it. A test asserts the password itself never reaches the file.

---

## 6. What is proven without hardware, and what is not

**Read this before anything encoded by this tool goes on a jar for sale.**

This tool was built on a machine with no NFC reader and no tags. Everything above the hardware boundary is exercised by 457 automated tests (Monday 26 October 2026) against a software model of the ST25TV02KC and a fake reader that answers the way the ACS manual says the ACR1552U does, with a tag that answers the way the ST25TV02KC datasheet says it does. That is a real and useful thing, and it is not the same as a tag.

### 6.1 Proven, by tests you can rerun

Run `npm test` and read the count. These are properties of the code and they hold:

- The NDEF URI record is built correctly, byte for byte, against the NFC Forum URI Record Type Definition. The `https://` prefix abbreviation is applied as identifier code `0x04`, saving eight of the 320 bytes.
- Every code in the redirect table produces exactly the URL the Scope document states, asserted against strings transcribed from that document rather than read from the file under test.
- Encoding and decoding round trip, including for awkward URIs, and the decoder refuses a second record, a truncated record, a reserved prefix code and a record that is not a URI record.
- The 312 byte usable area, blocks 1 to 78, is enforced. An NDEF TLV that exactly fills it is accepted and one byte more is refused with both numbers in the message. On this part a URI reaches the 255 byte short record limit first, at about 260 characters, and is refused there. Block 79 is never written.
- A write touches only the blocks the message needs: for every code in the table, block 1 (terminator), blocks 2 to 8, block 1 again (header), and block 0 only when the tag has no valid capability container.
- Protection cannot be applied before verification. Six separate tests assert both that the tool refuses and that no protection command reached the tag.
- A batch of 500 units completes with 500 journal records and no gaps, resumes correctly after an interruption, retries units that failed, and refuses to resume a journal belonging to a different code, a different count or a different redirect table.
- Every failure path produces a named code and a remedy: no tag, wrong part, refused write, partial write, corrupted read back, refused password, already protected tag, refused protection.
- A dry run makes **zero** transport calls of any kind.

### 6.2 Not proven, and only a tag can prove it

**Everything below the hardware boundary. There is no reader implementation, so none of the following has been observed:**

1. **That any of this works on silicon at all.** `src/transport/pcsc.ts` is written against published PC/SC documentation and **has never talked to a chip**. `src/transport/reader-stub.ts` remains reachable as `--transport stub`, refusing predictably, so a bring up failure can be attributed to hardware rather than to us.
2. **The ST specific command set.** Present Password, Write Password and the area configuration commands are ST custom commands. Their opcodes are deliberately not written into the stub, because copying opcodes from a datasheet into code that has never run would create exactly the kind of unverified fact this project keeps out of its documents.
3. **The capability container byte 3.** This is the one byte in the whole image the tool cannot check for itself: a wrong feature flag is invisible to a read back and visible only to a phone. **This is why the tool preserves a capability container the tag already carries rather than overwriting it**, which for SO4731 stock means keeping the one that measured 79/80 on iPhone and 40/40 on Android on 6 August. A container is kept when it is `E1 40` followed by a size byte of up to `28` (320 bytes, the whole part); `27` (312 bytes, everything after block 0) is kept too. Only tags with no valid container get one from this tool, `E1 40 27 01`, written last, and those are the ones to check on a phone first. **DS13304 does not state what block 0 holds on a factory tag**, so `E1 40 27 01` is this tool's figure from the NFC Forum Type 5 layout, not a datasheet value.
4. **Programming time.** The tool assumes a block write does not return until the byte is committed to EEPROM. If a reader returns on acknowledgement instead, the read back catches it, but catching it once per tag at pack out is expensive.
5. **Whether protection behaves as modelled.** The simulator implements the password model as the datasheet describes it. The datasheet is not the part.
6. **Anything to do with RF.** Range, alignment, collisions, writing through the 8 mm bamboo lid, and how forgiving a write is compared with a read. None of it is modelled and none of it can be.
7. **Timing at volume.** The five minute figure in the Scope document is about a member of staff operating the tool unaided, not about throughput. Real seconds per tag can only be measured with a reader.

### 6.3 What has to happen on real silicon, in order, on sacrificial tags

Not on SO4731 stock, and not on anything destined for a jar.

1. ~~Implement the transport.~~ **DONE for the encode and verify half**, as `src/transport/pcsc.ts`. The optional binding, `pcsc-mini`, is installed by `npm ci`; see `SETUP-WINDOWS-MAC.md`. The protection half is implemented and gated on the probe, and unverified on silicon; see sections 6.4 and 6.5.
2. `chip-cli doctor --transport reader` on a blank tag. Doctor opens the reader and, if a tag is on it, says whether it is present, mute or absent, with the raw reader state, and reads its UID. It reads nothing else, so confirm the geometry from the `Tag selected ... 80 blocks of 4 bytes` line that step 3 prints. That line appears only after the probe has read block 79 and seen block 80 refused (DS13304 Rev 7, END_MEM 4Fh).
3. `chip-cli write --code ps --transport reader` on a blank tag, then tap it with a real phone and confirm the correct blend page opens. That is the check that actually matters, and it is the one people skip.
4. Repeat with a tag taken from SO4731, to confirm re encoding works on stock as the client has said it does.
5. Only then, on a sacrificial tag and with a password nobody minds losing, `--protect`. The opcode probe runs inside it, on that tag, before anything irreversible (section 6.4). It must end `refusal proven: yes` and `unlock proven: yes` (section 5.4). Confirm the tag still reads on a phone afterwards.
6. Only then, protection on anything real.

Until step 3 has been done and written down, **no claim about hardware behaviour should be made to the client**, including by us.

---

### 6.4 Protection is implemented, and it is gated on the tag proving the command path first

**Written Wednesday 7 October 2026, replacing the section that said this was
deliberately unimplemented. Rewritten Sunday 25 October 2026, when the ST25TV02KC
datasheet was finally obtained** and showed that the protection command the tool had
been carrying was wrong. The gate is what kept that from mattering, so the design that
makes the commands safe to ship is still the content of this section.

#### Where the commands come from

From 7 October to 25 October 2026 the values in `src/chip/st-custom.ts` came from
**secondary sources**, because the datasheet would not download from five routes. On
Sunday 25 October 2026 it was obtained: **STMicroelectronics DS13304 Rev 7, 12 February
2025, "ST25TV02KC ST25TV512C"**, the byte for byte Wayback Machine copy of the st.com PDF.
Every command, parameter and error code the tool relies on is now quoted from it with its
section and table number, and labelled `datasheet`. **None is marked `measured`**, and a
test enforces that: a datasheet is not the part.

#### The split that makes this shippable

| Command | Code (DS13304) | Reversible | Allowed |
|---|---|---|---|
| **GetRandomNumber** | `B4h` (6.4.24) | **Yes.** Refreshes the random number register only (Table 24) | **Always** |
| **PresentPassword** | `B3h` (6.4.19) | **Yes.** Accepted, or refused and every security session closes. Nothing is written | **Always** |
| **ReadConfiguration** | `A0h` (6.4.16) | **Yes.** A read. The registers used are "R : always possible" (Tables 6, 10, 12) | Inside the probe always. As the protection read: **only after the probe passes, on that tag, in that connection** (kept gated pending review, see section 6.6) |
| WritePassword | `B1h` (6.4.18) | **NO** | **Only after the probe passes, on that tag, in that connection** |
| WriteConfiguration of RW_PROTECTION_A1 | `A1h` (6.4.17) | **NO** without PWD_A1 | **Only after the probe passes, on that tag, in that connection** |
| ToggleDiscreetSilent, Kill, LockBlock | `BAh`, `A6h`, `22h`/`32h` | **NO** | **Never.** On a forbidden list a test checks |

**Every frame is addressed** to the UID of the selected tag (request flags `22h`, the UID
after the IC Mfg code, least significant byte first), so another tag in the field stays
silent ("Otherwise the device remains silent", 6.2.7). **Every password travels cover
coded**: XORed with the 16 bit number from a GetRandomNumber in the same reader session
(5.1.3, "Password encryption").

#### The probe

`verifyOpcodes()` runs in one reader session, every frame addressed to the selected tag:

1. GetRandomNumber, then PresentPassword 1 with a **deliberately wrong** password. Required:
   **error 0Fh**, "Invalid Password_data value" (Table 155), and nothing else.
2. GetRandomNumber again (5.1.3 requires it after a failed presentation), then
   PresentPassword 1 with the **factory default**. Required: an **explicit success**, flags
   `00` and nothing after them.
3. GetRandomNumber, then PresentPassword 0, the **configuration password**, with its
   factory value. Required: an explicit success, because the protection register can only
   be written in that session.
4. ReadConfiguration of RW_PROTECTION_A1, END_A1 and LCK_CONFIG. Required: `00h` (not yet
   protected), `4Fh` (single area mode, so PWD_A1 is the 64 bit password the tool holds),
   and the area 1 configuration not permanently locked.

Then the UID is read from the field again and must be the selected tag. **Anything else
at any step means NOT proven**: a timeout, a CRC error, a transport error, a missing or
extra data object, extra bytes, odd flags, any other error code. Every reader level check
of section 6.5 still applies.

**The proof belongs to one physical tag and one connection.** It is recorded against the
tag's UID and wiped when any tag is selected, when the tag is released, when the transport
is opened or closed, and on any transport error. Before each irreversible command the
transport also reads the UID from the field again and refuses, sending nothing, if it is
not the proven tag.

**It runs by itself inside `--protect`**, in `UnitSession.protect`, after the pre
protection read back and immediately before the first irreversible command. There is no
separate probe command. If it does not pass, the run stops with `PROTECT_FAILED`,
"Refusing to protect this tag: the opcode probe did not pass", and nothing is locked. A
hardware transport with no probe at all is refused protection outright.

**It passes only on a tag whose password 1 is still the factory default**, whose
configuration password is still the factory default, and whose area 1 is unprotected and
unlocked. It presents password 1 and password 0 and no other, so it says nothing about
any other password the tag may carry. So this tool cannot protect, on a reader, a tag that
already carries a password 1. That is deliberate. **Use a sacrificial tag for bring up.**

**Every run presents one wrong password.** The chip has a "limiter mechanism on failed
password attempts" whose settings are described only in ST application note AN5577, which
ST gives out through its sales offices (DS13304 5.1.2). Whether it is on by default, and
after how many failures it acts, is not known. Do not run the probe repeatedly on a tag
you want to keep.

#### Why the gate exists rather than a flag somebody can set

**A wrong byte in the irreversible pair does not fail safe.** It can leave a tag
protected with a value nobody recorded, which is **exactly the state the 1,000 jars of
order SO4731 are already in**: locked, by a supplier, with a password Trevean does not
hold. See "Decision log", D45 and D66. **On Sunday 25 October 2026 the gate earned its
keep:** the protection command the tool carried until then, `BAh`, is ToggleDiscreetSilent
on this chip, and the old probe, which never fetched a random number, could not have
passed on a real tag, so that command was never sent.

#### What is still not proven

**None of this has touched a chip.** The gate means an unproven path refuses rather
than guesses, which is a different and better failure than the one section 6.2
describes, but it is **not** the same as working. Section 6.3 is still the bring up
sequence, and step 3, a real tag and a real phone, is still the step that matters.

**On the SO4731 question.** The datasheet does document a safe read of the protection
register, ReadConfiguration of RW_PROTECTION_A1, "R : always possible". The tool still only
sends it behind the gate, which cannot pass on a tag that carries a password, so the tool
still cannot answer what the supplier applied. Allowing that read without the probe is a
change to "Decision log", D66, and is left for review (section 6.6).

### 6.5 What changed on Sunday 25 October 2026, against the ACR1552U manual

**Every item below was checked against the ACS reference manual REF-ACR1552U-Series
version 1.09, and every one of them is still unverified on silicon.** Nothing in this
section has touched a reader or a tag. The tests prove the tool sends the manual's bytes
and reads answers the manual's way, against a fake reader written from the same manual.
(The ST commands were still secondary sourced when this table was written. Section 6.6
replaces them with the datasheet's.)

| # | What was wrong | What it is now | Manual section |
|---|---|---|---|
| D1 | Switch Protocol sent `8F 02 00 03`, which selects **ISO 14443A** layer 3 | `FF C2 00 02 04 8F 02 02 03 00`: RF `02h` ISO 15693, layer 3, Le `00` | 5.3.5.5, 5.3.5.5.1 |
| D2 | Transparent Exchange had no timer, so the reader would wait "about 302 µs", and no Le | Every exchange carries Timer `5F 46 04` of 50 ms (LSB first), then `95 [len] [frame]`, then Le `00` | 5.3.5.4, 5.3.5.4.3, 5.3.5.4.4 |
| D3 | Only the outer status word was read. A refusal or a timeout arrives as `90 00` with the failure inside the C0 object | Every answer is parsed as BER-TLV. C0 must read `00 90 00`, 92 and 96 must report no error, exactly one 97 must carry the tag's answer, and the ISO 15693 flags byte inside it decides success (`00`) or error (`01` plus one code). Session start and Switch Protocol are checked the same way | 5.3.5.2, 5.3.5.3, 5.3.5.4, 5.3.5.6 |
| D4 | The probe unlocked the pair on any two different answers | Both answers must be explicitly correct, as in 6.4 above | 5.3.5.2, 5.3.5.4 |
| D5 | One pass unlocked the pair for every later tag in the session | The proof is per UID and per connection, as in 6.4 above | (tool rule, not manual) |
| D6 | `readAreaProtection` sent the 0xBA read form with no gate | Gated like the irreversible pair. **Since replaced by ReadConfiguration A0h, section 6.6** | (datasheet obtained later) |
| D7 | The proof write used Update Binary and needed `AREA_PROTECTED`, but the transport threw `WRITE_FAILED`, so a real protection would be recorded `PROTECT_FAILED` | The proof write is ISO 15693 Write Single Block (21h) in a transparent session, and only tag error 0x12 counts as refused (since confirmed by DS13304 Table 107). Update Binary was not usable: the manual gives it a single error row, "6X XXh Fail", so a protection refusal and an RF failure look the same | 5.3.3.5 (the 5.3.4.2.2 citation was wrong, section 6.6) |
| D8 | `verifyOpcodes` was not reachable from any command, yet the `PROTECT_FAILED` remedy said to "run the opcode probe" | It runs inside `--protect` before any irreversible command, with a clear refusal; the remedy now says so | n/a |

**What a bring up has to watch for, because only silicon can settle it:** whether the
ACR1552U in the client's hands accepts these exact APDUs, the RF cycle included; whether
its `97` object carries the tag's answer without CRC bytes (the strict parser treats extra
bytes as no answer); whether the random number survives from one reader session to the
next (it does not need to: every password command fetches its own in the same session);
whether turning the field off inside a session upsets the PC/SC connection; and whether
the part behaves as DS13304 says. **The operator steps for that session, with the points
at which to stop, are in `SETUP-WINDOWS-MAC.md` section 4.3.**

### 6.6 What changed on Sunday 25 October 2026, against the ST25TV02KC datasheet and an independent review

**The datasheet, DS13304 Rev 7, contradicted the tool in the irreversible path, and that
was fixed first.** Every item is unverified on silicon and tested only against a fake tag
written from the same datasheet.

| # | What was wrong | What it is now | DS13304 |
|---|---|---|---|
| DS1 | The "Set Memory Protection" command was `02 BA 02 01 11`. **`BAh` is ToggleDiscreetSilent**, which in Addressed mode with the right password puts the tag in a state a phone cannot read | Never sent: on a forbidden list with Kill and LockBlock, checked by a test | 6.4.23, Table 163; 6.2.9 |
| DS2 | Area protection was a password number and bits in one byte | RW_PROTECTION_A1 (FID 00h, PID 00h) written to `01h` with WriteConfiguration `A1h`, inside the CONFIG session opened by PresentPassword 0 with the factory PWD_CFG. PWD_A1 always governs area 1 | Tables 4, 10, 11, 26, 147 |
| DS3 | Passwords were sent in clear, with no GetRandomNumber | Every PresentPassword and WritePassword is cover coded with the random number from a GetRandomNumber `B4h` in the same reader session. Table 30's worked example is a test | 5.1.3, Tables 28 to 30, 166 |
| DS4 | The protection read was the undocumented `BAh` one parameter "read form" | ReadConfiguration `A0h` of RW_PROTECTION_A1. Still gated | 6.4.16, Tables 10, 144 |
| DS5 | The probe accepted any wrong password error except 01 to 03 | Only `0Fh`, plus the configuration password and three registers must be as the factory leaves them (section 6.4) | Table 155, Tables 7, 11, 13, 17 |
| DS6 | WritePassword relied on a password presented in an earlier reader session | Present and write in one session, with the same random number, so the security session cannot close in between | 6.4.18, 5.1.3 note |
| DS7 | When protection takes effect was unknown | On the next RF boot; the stored value reads back at once. The proof cycles the field first (review F3) | Table 10, 5.1.4, 6.4.17 |
| DS8 | Error 12h for a protected block was ISO 15693 as commonly cited | Confirmed | Table 107 |

**The independent review of 0d470c4, findings F1 to F10:**

| # | Finding | What it is now |
|---|---|---|
| F1 | Every frame was non addressed, so a second tag in the field took the irreversible commands too | Every frame addressed (`22h`, UID LSB first), the probe included, so a pass proves the addressed framing. A test puts a second tag in the field and shows it is never touched |
| F2 | After WritePassword, a reader error or a gate refusal said nothing had happened | Any failure from the first irreversible command on is `PROTECT_FAILED`, "may already have been changed ... Label the tag LOCKED?", with the original message appended. The gate says "This command was not sent" |
| F3 | The proof assumed releasing the card drops the RF field | An explicit RF off, 10 ms, RF on inside the proof's session (manual 5.3.5.3.3 to 5.3.5.3.5). An accepted proof write is reported as "the tag may be protected" |
| F4 | A protection read of "none" was reported as not protected | "May already be protected, label LOCKED?". The datasheet settles the order: stored at once, enforced at the next boot |
| F5 | The SETUP 4.3 table had holes | Every outcome after `Verified`, a catch all row, and an instruction to clear the area round the reader |
| F6 | "Passes only on a bare tag" | "password 1 is still the factory default" |
| F7 | The batch retried a unit whose remedy said not to | A unit that failed after its probe passed is never retried by itself |
| F8 | Two checks had no test that could fail | Tests for a tag swap before the probe's UID re-read, and for a different tag after release on the reader path. The proof write now checks the UID itself |
| F9 | An answer with no `96` object was accepted | `92` and `96` are both required |
| F10 | The `21h` support citation pointed at the `FF FB` pass through table | Corrected. "Decision log", D66 is not edited here; new wording is proposed for review |

**G. Fixed on Monday 26 October 2026 (section 6.7):** the tool modelled 64 blocks and
refused any tag that answered a read of block 64, so it would have refused every genuine
ST25TV02KC, which has **80 blocks** of 4 bytes, 320 bytes (Figure 5 note 3, Table 13
END_MEM `4Fh`, features list "Up to 2560 bits (320 bytes) of EEPROM"). It now models 80,
reads block 79 and requires block 80 to be refused.

**Still open for review:** whether ReadConfiguration of the protection register, which the
datasheet documents as always readable, may run without the probe (it would answer the
SO4731 question), which is a change to "Decision log", D66.

### 6.7 What changed on Monday 26 October 2026: the 80 block geometry, and review findings N1 to N5

The 80 block geometry change was merged in, and the second independent review's findings
were fixed. Every item is tested against the fake reader and tag only.

| # | Finding | What it is now |
|---|---|---|
| Geometry | The tool modelled 64 blocks; the probe's END_A1 check already assumed 80 | 80 blocks of 4 bytes, from DS13304. The END_MEM value the probe requires of END_A1 is derived from the part model, so the two cannot disagree, and a test holds both to `4Fh`. A full `--protect` is tested on an 80 block tag, block 80 is still refused after protection, and a TruST25 part with END_MEM `3Dh` is refused both by the geometry read and by the probe |
| Span | A 255 byte limit on one Read Binary arrived with the geometry | The three reads of the image share one method and one rule (section 5.4). The longest URI the encoder accepts, 262 characters, is refused at verify |
| N1 | WritePassword's "success" was taken as proof the new password opens the tag | The new password is presented straight after WritePassword, in the same session, and must succeed before the protection register is written. After the refusal proof, the recorded password must open the tag and the write must then be accepted: `unlock proven: yes` |
| N2 | The readability check after protection ran before the field cycle | It runs after the refusal proof, which cycles the field, so it reads the tag with the protection in force |
| N3 | Two refusals that sent nothing were labelled LOCKED? | The transport counts WritePassword and WriteConfiguration frames as it transmits them. LOCKED? starts with the first one actually sent. A transport that cannot count is treated as though one was sent |
| N4 | A batch carried on after a LOCKED? unit | The run stops at that unit (section 4) |
| N5 | Some checks had one test, or none that could fail | Tests aimed at each: password ids 0, 2 and 3 refused by their own check, a `0Fh` proof answer, no retry after a passed probe, a stored protection of `02h` on the wire, reserved bits in the protection read, and an unreadable field UID before either proof write |

**What this still does not show.** That the tool and the tag agree on how WritePassword is
coded is now checked on the tag itself, by the presentation straight after it and by the
unlock proof. Whether another tool, ST's own app for example, reads the sixteen hex
characters the same way round is not: until that has been tried on a sacrificial tag, a
password recorded by this tool is only known to work with this tool.

### 6.8 What changed on Monday 26 October 2026: TAG_ABSENT named, the Tag Tool, one build

Three lines of work were merged into this build: the protection path of section 6.7, the
`TAG_ABSENT` work that followed the first call with the reader, and the Tag Tool.

- **Every `TAG_ABSENT` names its case** (`NO_TAG`, `TAG_MUTE`, `CONNECT_FAILED`,
  `UID_REFUSED`, `READER_GONE`), the reader, and the raw reader state, and quotes the PC/SC
  error by name (for example `SharingViolation` when another program holds the reader).
  Section 7 has the table.
- **A tag the reader detects but that did not answer activation (PRESENT with MUTE) is
  connected to once**, after a one second grace. Before, the tool waited out the timeout and
  called it "no tag". A tag reached this way is selected like any other: the same UID and
  geometry checks, and **no proof**. The opcode probe still has to run on it, in that
  connection, before anything irreversible, and any later selection, release or doctor look
  at the tag wipes the proof. Tests hold each of these.
- **Doctor reports the tag** on the reader: present, mute or absent, its UID, and the raw
  state. No tag is still `Ready.`
- **The Tag Tool** (the easy way, at the top of this README).

**The protection path is byte for byte the one section 6.7 describes.** In
`src/transport/pcsc.ts` every declaration of the gate, the probe, the sessions, the frames,
WritePassword, area protection and both proofs is unchanged; the files in `src/chip/` and
`src/workflow/` are unchanged. Only the shared connect in `waitForTag` changed, plus the
wording of one transport error.

---

## 7. If something goes wrong

Every failure prints a code and a line beginning `What to do:`. The codes:

| Code | What happened | What to do |
|---|---|---|
| `TAG_ABSENT` | No tag could be selected. The message starts with the case: `NO_TAG` (the reader never reported one), `TAG_MUTE` (the reader detects a tag that does not answer activation), `CONNECT_FAILED` (with the PC/SC error, for example `SharingViolation` when another application holds the reader), `UID_REFUSED` or `READER_GONE`, then the reader name and its raw state | Place the tag centred on the reader and retry the unit. Follow the remedy printed for the case, and send the whole message when reporting it |
| `TAG_NOT_ST25TV02KC` | The tag is not ISO 15693, is not made by ST, or is not 320 bytes in 80 blocks: block 79 would not read (`fewer than 80 blocks`) or block 80 did (`larger than ST25TV02KC`) | This is not the part. Check which tags you have. Nothing was written |
| `TAG_CHANGED` | A different tag came back into the field partway through a unit | Nothing was locked by that step. Set both tags aside, label them, and rerun the unit with one tag on the reader |
| `WRITE_FAILED` | The tag refused the write, or the write stopped partway | Rewrite the tag. It cannot be carrying a wrong URL: see section 7.1 |
| `READBACK_FAILED` | The tag stopped responding during the read back | Hold the tag still and retry the unit |
| `READBACK_MISMATCH` | The tag holds something other than what was written | Do not ship the tag. Rewrite and verify. If it fails twice, set it aside and label it |
| `AREA_PROTECTED` | The tag is already write protected | Supply the password it was protected with, or set the tag aside |
| `PASSWORD_REJECTED` | The tag holds a different password | Check the secret store. **Do not guess.** There is no reset and no recovery service |
| `PASSWORD_MISSING` | Protection was asked for with no password source | Set the environment variable, or pass `--password-file` |
| `PASSWORD_INVALID` | The password is not sixteen hex characters, or is the factory default | Correct it in the secret store |
| `PROTECT_FAILED` | Protection was refused, or did not take | Set the tag aside, label it, report it. **Do not record it as protected.** If the message says "LOCKED?", the irreversible part had begun: label the tag "LOCKED?" with the fingerprint it prints and never retry on it |
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

node bin/tag-tool.mjs                   the Tag Tool page (what Start Tag Tool runs)
node bin/tag-tool.mjs --simulator       the same, with no reader and no tags
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

The Tag Tool writes the same journal, in the same format, to `runs/tag-tool/tag-tool-<start time>-<code>.jsonl`: one file per product code each time it is started, with `targetCount` 0 in the header because it writes until it is closed.

**The password is never in this file.** Only its fingerprint. A test asserts it.

---

## 10. For the engineer wiring up a real reader

The hardware boundary is `src/transport/transport.ts`, a thirteen method interface plus the optional opcode probe `verifyOpcodes`, which a hardware transport must have before `--protect` will run on it. Everything above it is pure logic with no I/O. There are three implementations: `simulator.ts`, a model of the memory and what the tests run against; `pcsc.ts`, the real one, covering the encode and verify half and never yet run on silicon; and `reader-stub.ts`, which refuses everything and is kept for attributing bring up failures.

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
| 7 | **Whether to change the configuration password, or lock the configuration.** | The tool leaves PWD_CFG at its factory value, so anyone who knows the ST command set can switch protection off, and the same factory password unlocks the chip's Kill command (DS13304 6.4.20). Changing PWD_CFG adds a second password to hold. Locking the area 1 configuration (LCK_CONFIG) is permanent and makes the protection impossible to remove even with every password. Neither is implemented |
| ~~8~~ | ~~**The tag geometry.**~~ | **CLOSED Monday 26 October 2026.** The tool now models the datasheet's 80 blocks (section 6.7) |

**One item for the record rather than for decision, and it is now done.** The redirect table recorded `writeProtected: null` on all five rows, which read as "unrecorded", after the client answered on Wednesday 19 August 2026 that SO4731 shipped with no write protection. **The table was corrected on Saturday 22 August 2026** and now carries `false` on the four encoded rows and `null` on the reserved row, where no tag exists to have a state, so the file and the fact agree. The table is outside this package and is not edited by this tool. **What is still open is the read-back:** that is the client's answer rather than the supplier's written one, and this tool's verify path is how it gets confirmed against our own bare stock and against one shipped jar.

---

**If anything here conflicts with the ST25TV02KC datasheet (DS13304) or with application notes AN5658 and AN5577, the datasheet is right and this document has a bug in it.** Tell us either way.
