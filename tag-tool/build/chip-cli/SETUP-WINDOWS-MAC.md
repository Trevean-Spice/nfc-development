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

If a step does not behave as written, that is a finding, not a failure on your part. Write down what it printed.

---

## 1. Before the call (two minutes)

1. **The tool folder.** On GitHub, open the `Trevean-Spice/nfc-development` repository, switch to the branch `fleet/tag-tool`, choose **Code**, then **Download ZIP**, and unzip it into Downloads. It unzips as `nfc-development-fleet-tag-tool`. Inside it, the `tag-tool` folder holds `build\chip-cli` and `build\edge\redirect-table.json`. The tool reads the table from there, so keep the two folders side by side exactly as they are.
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
   cd %USERPROFILE%\Downloads\nfc-development-fleet-tag-tool\tag-tool\build\chip-cli
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
   cd ~/Downloads/nfc-development-fleet-tag-tool/tag-tool/build/chip-cli
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
Tag selected     uid e002..., 80 blocks of 4 bytes
Written          10 blocks, capability container written
Verified         https://treveanspice.com/t/ps

OK  ps  Persian Sunrise  https://treveanspice.com/t/ps
```

**80 blocks of 4 bytes is the ST25TV02KC user memory** in STMicroelectronics datasheet DS13304 Rev 7, section 4.2 ("Value of END_MEM is ... 4Fh for ... ST25TV02KC"). The tool proves it on each tag by reading block 79 and requiring block 80 to be refused. Only the blocks the URL needs are written: blocks 1 to 8, block 1 twice, and block 0 (the capability container) only when the tag has none, which is the difference between 9 and 10.

**Then tap the tag with a real phone** (screen on, unlocked) and confirm the Persian Sunrise page opens. On an iPhone, tap the banner that appears. **This tap is the check that matters**, README section 6.3 step 3. Write down the UID and what the phone did.

### 4.3 Protection test, on the SACRIFICIAL tag only

Take the tag from 4.2 off the reader. Put the **SACRIFICIAL** tag on. The password is a throwaway, generated on the spot and never written down: there is deliberately no `--password` flag.

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

**What to expect, and why it is not a fault.** The tool **will not apply protection on this reader yet.** The two commands that cannot be undone (Write Password and Set Memory Protection) only run after a probe on the tag has proven the command path, and nothing in the tool runs that probe from the command line today (README section 6.4, "Decision log", D66). So one of these happens:

- `Tag selected`, `Written`, `Verified`, then `FAILED  PROTECT_FAILED` and `Refusing to change a password: the ST custom command path has not been proven on this tag.` That is the gate working.
- Or an earlier failure (`PASSWORD_REJECTED`, `TRANSPORT_UNAVAILABLE` or `WRITE_FAILED`), because the step before the gate, presenting the factory password inside an ACS transparent session, is itself unproven on this reader.

**In every case no password and no protection reaches the tag.** Afterwards:

- **Unplug the reader and plug it back in.** The ACS manual warns that a transparent session can leave the reader unable to see tags until it is reconnected.
- Keep the sacrificial tag labelled and set aside, and write down exactly what was printed.
- **If it ever prints `Protected` and `refusal proven`, stop and report it.** By design that cannot happen on this reader today.

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
| write: `TAG_NOT_ST25TV02KC` | Not the right kind of tag. Nothing was written. If the message says `Block 79 could not be read` or `Block 80 answered a read` on a tag sold as ST25TV02KC, stop and report it with the UID and the full message: do not try other tags to make it pass |
| write: `WRITE_FAILED` on a tag that should be blank | Report it with the full message. Try one more blank tag |
| anything else | Every failure prints a code and a line beginning `What to do:`. README section 7 lists them all |

**Everything here is reversible except section 4.3, and section 4.3 is blocked from doing the irreversible part.** Nothing in this document can lock a tag.
