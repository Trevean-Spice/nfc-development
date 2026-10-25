# Setting up chip-cli on Windows or a Mac, with an ACR1552U reader

**For:** whoever sits at the keyboard on the first real reader run. No programming knowledge needed.
**Written:** Sunday 25 October 2026, for the screen share on Monday 26 October 2026.
**Goal:** from a computer with nothing installed to `doctor --transport reader` printing `Ready.`, in about ten minutes.

---

## 0. Read this first: what has NOT been checked

**No ACR1552U, no ST25TV02KC tag, no Windows computer and no Mac were available when this was written.** So, plainly:

- **Not verified on Windows or macOS at all.** Every command below was run on Linux only, against a real PC/SC service (pcscd 2.0.3) with a virtual reader, on Node 20, 22, 24 and 26. The Windows and Mac steps are written from the vendors' documentation.
- **Not verified with the ACR1552U.** Its name as Windows or macOS reports it, whether the built in driver is enough, and how it answers each command are all unproven.
- **Not verified on silicon.** The tool still has never written a physical tag. README section 6.3 is the bring up this call is doing.
- **The Windows command for the throwaway password in section 4 is untested.** A fallback is given beside it.
- **The protection commands now come from the ST25TV02KC datasheet** (DS13304 Rev 7, obtained Sunday 25 October 2026), and none of them has run on a chip.
- **Known problem before you start:** the datasheet says the ST25TV02KC has 80 blocks, and this version of the tool expects 64 and refuses a tag that has more. Unless a fixed version has been sent since, section 4.2 will stop with `TAG_NOT_ST25TV02KC` "Block 64 answered a read". That is the tool, not the tag (README section 6.6, item G).

If a step does not behave as written, that is a finding, not a failure on your part. Write down what it printed.

---

## 1. Before the call (two minutes)

1. **The tool folder.** Unzip the `trevean-tag-tool` folder you were sent, into Downloads. Inside it there must be `build\chip-cli` and `build\edge\redirect-table.json`. The tool reads the table from there, so keep the two folders side by side exactly as they are.
2. **Internet access.** `npm ci` downloads about 25 MB the first time.
3. **Close GoToTags**, including its icon in the Windows system tray or the Mac menu bar. Only one program can drive the reader at a time.
4. **Tags.** Blank ST25TV02KC tags only, plus **one extra blank tag marked SACRIFICIAL** for the protection test. **Never a tag from order SO4731**: those are locked with a password nobody at Trevean holds.

---

## 2. Windows 10 or 11

**Use Command Prompt, not PowerShell.** On a default Windows install PowerShell refuses to run `npm` ("running scripts is disabled on this system"). Command Prompt does not.

1. **Plug the reader in** and wait about thirty seconds. Windows loads its own built in smart card reader driver.
   - Check: press the Windows key, type `Device Manager`, open it. Under **Smart card readers** you should see the ACS reader, possibly twice (one entry is the contactless reader, the other its SAM slot; that is normal).
   - If it is missing, or sits under "Other devices" with a yellow warning sign, install the ACS driver: go to `acs.com.hk`, search for **ACR1552U**, open **Drivers & Utilities**, download the **PC/SC Driver Installer** for Windows, run `Setup.exe`, then unplug and replug the reader.
2. **Install Node.js.** Go to `nodejs.org`, download the **LTS** Windows Installer (`.msi`, version 24), run it and accept the defaults. **On the page "Tools for Native Modules", leave the box unticked.** Nothing here needs it, and it takes a long time.
3. **Open Command Prompt:** press the Windows key, type `cmd`, press Enter.
4. **Go to the tool and build it** (adjust the path if you unzipped somewhere else):
   ```
   cd %USERPROFILE%\Downloads\trevean-tag-tool\build\chip-cli
   node --version
   npm ci
   npm run build
   ```
   `node --version` should print `v24` followed by anything (any version from `v20.11` works). `npm ci` should end with `added` and a number of packages, and no `ERR!`. No compiler, Python or Visual Studio is needed: the reader binding (`pcsc-mini`) arrives prebuilt.
5. **Check:**
   ```
   node bin\chip-cli.mjs doctor --transport reader
   ```
   **Expected:** three lines beginning `ok`, the third reading `physical reader responded: ACS ACR1552 ...`, then `Ready.`

---

## 3. Mac (Apple silicon or Intel)

1. **Plug the reader in.** It is USB A; a Mac with only USB C ports needs an adapter.
   - Check: open Terminal (press Command and Space, type `Terminal`, press Enter) and run `system_profiler SPSmartCardsDataType`. The reader should be listed under Readers.
   - **Driver.** macOS has a built in driver for standard readers like this one (CCID). The ACR1552U was added to the open source version of that driver in August 2023, and **whether the copy inside the client's macOS already knows it is unverified.** If the reader is not listed, or doctor below says no reader appeared: go to `acs.com.hk`, search for **ACR1552U**, open **Drivers & Utilities**, download the **macOS PC/SC Driver Installer**, install it, unplug and replug the reader, and try again. It may ask you to restart.
2. **Install Node.js.** Go to `nodejs.org`, download the **LTS** macOS Installer (`.pkg`, version 24; one installer covers both kinds of Mac), run it and accept the defaults.
3. **Go to the tool and build it**, in Terminal:
   ```
   cd ~/Downloads/trevean-tag-tool/build/chip-cli
   node --version
   npm ci
   npm run build
   ```
   Same expectations as Windows step 4. No Xcode or command line tools are needed.
4. **Check:**
   ```
   node bin/chip-cli.mjs doctor --transport reader
   ```
   **Expected:** three `ok` lines, the third naming the reader (the name typically includes `PICC`), then `Ready.`

---

## 4. The three commands for the call

Run them in this order, from the same `build/chip-cli` folder. Windows uses `bin\chip-cli.mjs`, Mac uses `bin/chip-cli.mjs`; otherwise they are identical.

### 4.1 Doctor

```
node bin/chip-cli.mjs doctor --transport reader
```

`Ready.` with the reader named. No tag needed.

### 4.2 Write one tag, then tap it with a phone

Place **one blank tag**, flat and centred on the reader, then:

```
node bin/chip-cli.mjs write --code ps --transport reader
```

**Expected, three lines then OK** (9 or 10 blocks, and `written` or `preserved`, depending on whether the tag arrived with a capability container):

```
Tag selected     uid e002..., 64 blocks of 4 bytes
Written          10 blocks, capability container written
Verified         https://treveanspice.com/t/ps

OK  ps  Persian Sunrise  https://treveanspice.com/t/ps
```

If it prints `TAG_NOT_ST25TV02KC` and "Block 64 answered a read, so this tag is larger than ST25TV02KC", **stop here and skip 4.3.** That is the known geometry problem in section 0, not a wrong tag. Write down the message.

**Then tap the tag with a real phone** (screen on, unlocked) and confirm the Persian Sunrise page opens. On an iPhone, tap the banner that appears. **This tap is the check that matters**, README section 6.3 step 3. Write down the UID and what the phone did.

### 4.3 Protection test, on the SACRIFICIAL tag only

**Clear everything NFC from within arm's length of the reader first:** the tag from 4.2, every other tag, contactless bank cards, door badges, and the phone. Put them in another room or at least two metres away. Then put the **SACRIFICIAL** tag on the reader, alone. (The tool now addresses every command to the one tag it selected, so another tag should stay silent. That is unverified on silicon, and a tag locked by mistake cannot be unlocked.)

The password is a throwaway, generated on the spot and never written down: there is deliberately no `--password` flag.

**Mac:**

```
export TREVEAN_TAG_PASSWORD="$(node -e "process.stdout.write(require('crypto').randomBytes(8).toString('hex'))")"
node bin/chip-cli.mjs write --code ps --transport reader --protect --password-env TREVEAN_TAG_PASSWORD
unset TREVEAN_TAG_PASSWORD
```

**Windows, Command Prompt** (untested; the quotes and backticks matter):

```
for /f "usebackq" %p in (`node -e "process.stdout.write(require('crypto').randomBytes(8).toString('hex'))"`) do @set TREVEAN_TAG_PASSWORD=%p
node bin\chip-cli.mjs write --code ps --transport reader --protect --password-env TREVEAN_TAG_PASSWORD
set TREVEAN_TAG_PASSWORD=
```

If the `for` line errors, use this instead. It shows the throwaway value on screen, which is acceptable for a password that is discarded a minute later:

```
node -e "console.log(require('crypto').randomBytes(8).toString('hex'))"
set TREVEAN_TAG_PASSWORD=<paste the sixteen characters it printed>
```

**Before you run it, accept this:** the opcode probe runs inside `--protect`, so on a tag whose passwords are still the factory default this run **can really protect the tag**, with a password that is discarded a minute later. That tag is then locked for good. That is what the SACRIFICIAL label is for. **Never run it on any other tag, and never on SO4731 stock.** Run it **once**: every run presents one deliberately wrong password, and the chip has a failed attempt limiter whose settings ST does not publish.

**What to expect.** Everything in the protection path is unverified on silicon (README sections 6.4 to 6.6), so the likeliest result is a safe refusal. Read the last lines printed and find them here. **Every "STOP" means: do not run anything else on this tag, do not retry with a change, unplug and replug the reader, and write down the full message word for word.**

**Before `Verified`.** Nothing irreversible can have been sent. The tag is unharmed.

| What it prints | What it means | What to do |
|---|---|---|
| `TAG_NOT_ST25TV02KC`, "Block 64 answered a read" | The known geometry problem (section 0) | **STOP.** Not the tag's fault |
| `PROTECT_FAILED`, "The reader did not complete ...", "GetRandomNumber before ... got no usable answer" or "PresentPassword got no usable answer" | The ACS session or the ST command path failed | **STOP.** The tag is unharmed |
| `PASSWORD_REJECTED` | The tag refused the factory password 1 | **STOP.** Do not try any other password |
| Any other code before `Verified` (`TAG_ABSENT`, `WRITE_FAILED`, `READBACK_...`, `TRANSPORT_UNAVAILABLE`) | Section 4.2's path failed | **STOP.** The tag is unharmed |

**After `Verified`, before any irreversible command.** Only these four mean nothing was locked:

| What it prints | What it means | What to do |
|---|---|---|
| `PROTECT_FAILED`, "Refusing to protect this tag: the opcode probe did not pass" | The gate working. The message lists what the tag answered at each step | **STOP.** Nothing was locked. This line is the most useful thing the session can produce |
| `PROTECT_FAILED`, "The tag could not be read immediately before protection" or "no longer holds the bytes that were verified" | The check before the probe | **STOP.** Nothing was locked |
| `PROTECT_FAILED`, "The opcode probe could not run" | The probe itself failed to start | **STOP.** Nothing was locked |
| `PASSWORD_REJECTED`, or "PresentPassword got no usable answer", printed after `Verified` | Presenting password 1 after the probe failed. WritePassword was not reached | **STOP.** Nothing was locked |

**After an irreversible command.** Every one of these starts "Protection did not complete, and its irreversible part had begun. Password 1 may already have been changed by this run ... Label the tag LOCKED? and stop", then "Original message:" and what went wrong. **All of them: STOP. Label the tag "LOCKED? password discarded" and never reuse it.** What the original message tells the bring up:

| Original message (after "Original message:") | What it means | Also do |
|---|---|---|
| "Writing password 1 was not confirmed", or `TRANSPORT_UNAVAILABLE` | WritePassword got no clean answer. It may have taken effect | Nothing more |
| "Refusing to apply area protection: ... This command was not sent" | The password may have changed, then the gate stopped the protection command (the reader lost the session or the tag) | Nothing more |
| "Setting protection on area 1 was not confirmed", or "The factory configuration password was not accepted" | The protection command got no clean answer, or could not be sent | Nothing more |
| "The tag did not report protection for area 1", or "reports protection state ..." | The protection read failed or disagreed. The tag may already be protected | Nothing more |
| `TAG_CHANGED`, `TAG_ABSENT`, "could not be read after protection", "After protection the tag decodes to" | Something went wrong between protecting and proving. If `TAG_CHANGED`: a second tag answered, so the area was not clear | Label every tag that was in reach LOCKED? too |
| "The proof write was not sent" | The tag in the field was not the unit's tag | Label every tag that was in reach LOCKED? too |
| "The proof write to block 1 got neither ..." | The tag refused the proof write with a code other than 12h, or gave no clean answer | **Write down the code in the message** |
| "The proof write to block 1 was accepted" | The tag accepted the write after protection. **It may still be protected** and its password was changed: if the field did not really drop, the earlier password still applied. Or protection did not take | **Report it the same day** |

| What it prints | What to do |
|---|---|
| `Protected`, `refusal proven: yes`, `opcode probe passed on this tag`, then `OK` | The whole path worked on this tag. Tap it with a phone: the Persian Sunrise page must open (**STOP** if it does not: the tag is scrap). Then run `node bin/chip-cli.mjs verify --expect ps --transport reader`, which must pass. Label the tag "PROTECTED, password discarded" |
| **Anything not listed above, printed after `Verified`** | **STOP. Label the tag "LOCKED? password discarded".** Copy the message word for word |

**Afterwards, whatever happened:**

- `unset TREVEAN_TAG_PASSWORD` (Mac) or `set TREVEAN_TAG_PASSWORD=` (Windows), if not done already. The value is never written down anywhere.
- **Unplug the reader and plug it back in.** The ACS manual warns that a transparent session can leave the reader unable to see tags until it is reconnected (section 5.3.5.3).
- Keep the sacrificial tag labelled and set aside, and send what was printed. Nobody edits the tool during the session.

---

## 5. If something goes wrong

| What you see | What to do |
|---|---|
| `'node' is not recognized` (Windows) or `command not found: node` (Mac) | Close the window and open a new one after installing Node.js. If it persists, reinstall Node.js |
| `running scripts is disabled on this system` | You are in PowerShell. Open Command Prompt instead (section 2, step 3) |
| `npm ci` stops with `ERR!` and mentions the network | The computer cannot reach the npm registry. Try another network, or ask whoever manages the computer |
| doctor: `The PC/SC service could not be reached: [ NoService ]` | Plug the reader in, wait thirty seconds, run doctor again. On Windows the Smart Card service only starts once a reader is attached. If it persists on Windows, the Smart Card service may be disabled by company policy |
| doctor: `No PC/SC reader appeared within 10 seconds` | Unplug and replug. Then install the ACS driver (section 2 step 1, section 3 step 1) |
| doctor names a reader ending `SAM` | Pass the contactless one by name: add `--reader-name PICC` to every command |
| write: `TAG_ABSENT` | Tag flat and centred, one tag only, then run it again. Close GoToTags |
| write: `TAG_NOT_ST25TV02KC` "Block 64 answered a read" | The known geometry problem in section 0. Nothing was written. Stop and report it |
| write: `TAG_NOT_ST25TV02KC`, anything else | Not the right kind of tag. Nothing was written |
| write: `WRITE_FAILED` on a tag that should be blank | Report it with the full message. Try one more blank tag |
| anything else | Every failure prints a code and a line beginning `What to do:`. README section 7 lists them all |

**Everything here is reversible except section 4.3, which can lock the sacrificial tag for good.** Nothing else in this document can lock a tag.
