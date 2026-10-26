# Setting up chip-cli on Windows or a Mac, with an ACR1552U reader

**For:** whoever sits at the keyboard on the first real reader run. No programming knowledge needed.
**Written:** Sunday 25 October 2026, for the screen share on Monday 26 October 2026. **Updated** Monday 26 October 2026 for the build to download on Tuesday 27 October 2026, which brings the Tag Tool, the clearer `TAG_ABSENT` messages and the protection test together. **Updated again** the same evening, after the first Tag Tool run on Windows, for a tag that is not ready when it is first read, and then for GoToTags reading every tag and typing its ID into the page (seen on the screen recording of that run).
**Goal:** from a computer with nothing installed to tags being written, in about ten minutes.

**Three ways in, in this order:**

1. **The easy way: Start Tag Tool** (just below). Double click, type a product code, swap tags. Never locks a tag.
2. **The command line** (sections 1 to 4.2). The same writing, one command at a time, and `doctor`, which says what the reader sees. Use it when the easy way stops with something you need to understand.
3. **The lock session** (section 4.3). The protection test, on one SACRIFICIAL tag only. It is the only thing in this document that can lock a tag for good.

---

## The easy way: Start Tag Tool

For writing tags one after another. You click, you type a product code, you swap tags. No commands.

**Once, before the first time:**

- Download the new ZIP (section 2, step 1, the GitHub steps). Install Node.js (section 2, step 2 on Windows, or section 3 on a Mac), and plug the reader in.
- **Exit GoToTags.** It starts with Windows and keeps running in the background, with its icon near the clock (the system tray: click the small up arrow beside the clock if you cannot see it). **Right click its icon and choose Exit.** If you cannot find the icon, open Task Manager (Ctrl+Shift+Esc), find GoToTags under Processes, right click it and choose End task. On a Mac, quit it from its icon in the menu bar. While it runs, it reads every tag the moment it is put down, before the Tag Tool can, and types the tag's ID into whatever box has the cursor.
- **Stop it starting with Windows,** if it does (it did on the first run): in Task Manager, open **Startup apps** (on Windows 10, the Startup tab), right click GoToTags and choose **Disable**. GoToTags itself still works when you open it from the Start menu.

1. **Open the `tag-tool` folder** inside `nfc-development-fleet-tag-tool` (if Windows shows the same name twice, go one level deeper), and **double click `Start Tag Tool`**. On a Mac it is `start-tag-tool.command`, and the very first time you right click it, choose Open, then Open again.
2. **A black window opens.** The first time, it sets itself up: that needs the internet and takes a minute or two. Then your web browser opens on the Tag Tool page by itself. **Keep the black window open while you work.** Closing it stops the Tag Tool.
3. **Click "Turn on desktop notifications"** at the top of the page and choose Allow. Then a message pops up in the corner of the screen when the reader is ready, when a tag is seen, when a tag is written, and when something goes wrong. If you skip this, the same messages show on the page.
4. **Wait for "Reader ready"**, then put one tag flat on the reader. The page says **Tag seen** and shows the tag's UID.
5. **Type the product code** (`ps`, `cs`, `sr` or `nm`), or pick it from the list, which shows each blend's name. Press **Write**. The page says **Writing**, then **Written and verified**, with the web address it read back off the tag. `kg` cannot be written yet, and the page says so.
6. **Take the tag off and put the next one on.** The page says **Tag seen** again. Press Write again.
7. **To go faster,** tick **Write this code to every new tag automatically**. From then on, each new tag is written the moment it is put down, so all you do is swap tags and watch for the green **Written and verified**. A tag that has just been written is never written again while it sits on the reader. Untick the box to stop.
8. **If something goes wrong,** the page turns red and shows the error code, what happened, and what to do, in that order. A tag that fails twice: take it off, set it aside, and label it.

Good to know:

- **It never locks a tag** and never asks for a password. Protection is a separate step, in section 4.3.
- **Every tag is recorded**, written or failed, in the `build\chip-cli\runs\tag-tool` folder: one file per product code each time the Tag Tool is started.
- **The count at the foot of the page is tags, not writes:** "N tags written and verified" counts each tag once, however many times it was written, and leaves out a tag whose latest write failed until it is written again. The table under it has a row for every write, failed ones included.
- **Double clicking it a second time** just brings the page back up. It does not start a second copy, even when both double clicks land together.
- **If the black window says Node.js is missing,** install it as in section 2, step 2, then double click again. If it stops for any other reason, it stays open and says why: take a photo of it and send it to Serene Labs.
- **If a red box at the top says "Another program is reading the tags and typing their ID (usually GoToTags)"**, do what it says: right click the GoToTags icon near the clock and choose Exit (or end it in Task Manager), then lift the tag and put it back. The page says it when it sees a tag's ID being typed into it, which no person types, and when the reader loses the tag twice running or reports it in use by another program. It throws the typed ID away, so nothing ends up in the product code box, and it keeps the code you chose.
- **The product code box takes only the codes** (`ps`, `cs`, `sr`, `nm`). It is not selected for you when the page opens: click it, or pick from the list, when you want to type.
- **If the page says "Tag not ready, retrying",** the reader sees the tag but lost it before it could be read. Nothing is wrong with the reader, and the Tag Tool keeps trying by itself, waiting a little longer each time (up to four seconds), with the reader left open. Keep the tag flat and still in the centre of the reader. If it has not changed to **Tag seen** within about ten seconds: exit GoToTags (right click its icon near the clock, Exit), lift the tag and put it back. Still not: close the black window, unplug the reader, plug it back in, and double click Start Tag Tool again. If it still says it, send the black window's lines that begin `Tag not ready`: each one names the command the tag was lost at.
- **If the black window prints `Reader trouble, reconnecting: The reader rejected a command: NoSmartCard (SCARD_E_NO_SMARTCARD)` over and over,** several times a second, that is an old copy, the one from the afternoon of Monday 26 October 2026. Close it and download the current one. That copy treated a tag that was not ready as a reader fault, closed and reopened the reader, and powered the tag down each time, so the tag never had a chance to come up. Rebooting does not help with it.
- **If the page stays on "Waiting for a tag" with a tag on the reader,** or says **"The reader cannot read the tag"**: exit GoToTags (right click its icon near the clock, Exit), lay the tag flat and centred, printed face towards the reader, and listen for the reader's beep. If that does not help, close the Tag Tool's black window and run `doctor` as in section 4.1 with the tag lying on the reader. Its `tag on the reader` line says present, mute or absent, and that line is what to send.

**Not checked yet, plainly:** the Tag Tool has been run on Linux only, against the simulated reader, and driven there in a real browser (Chromium) through every state above. It has not been run on Windows, on a Mac, in Edge, with the ACR1552U, or on a real tag. On the call on Monday 26 October 2026 the reader was found but the tag was not seen. This build names the reason in every such message, and connects to a tag the reader detects but that did not answer. The first Tag Tool run on Windows, later that day, found the reader and then lost the tag after every connect (`SCARD_E_NO_SMARTCARD`). This build retries that, with the reader left open, and no longer powers the tag down on every poll. Whether that is enough for that tag on that reader is not yet known: the next run will show it, and if it is not, the `Tag not ready` line says which command it was. The screen recording of that run then showed GoToTags running beside it, typing each tag's ID into the page, which most likely explains the lost tag: exit it first, as above. The red "another program" box has been checked in a simulated browser on Linux only, not in Edge or on Windows.

---

## 0. Read this first: what has NOT been checked

**No ACR1552U, no ST25TV02KC tag, no Windows computer and no Mac were available when this was written.** So, plainly:

- **Not verified on Windows or macOS at all.** Every command below was run on Linux only, against a real PC/SC service (pcscd 2.0.3) with a virtual reader, on Node 20, 22, 24 and 26. The Windows and Mac steps are written from the vendors' documentation.
- **Not verified with the ACR1552U.** Its name as Windows or macOS reports it, whether the built in driver is enough, and how it answers each command are all unproven.
- **Not verified on silicon.** The tool still has never written a physical tag. README section 6.3 is the bring up this call is doing.
- **The Windows command for the throwaway password in section 4 is untested.** A fallback is given beside it.
- **The protection commands now come from the ST25TV02KC datasheet** (DS13304 Rev 7, obtained Sunday 25 October 2026), and none of them has run on a chip.
- **The tag geometry is fixed in this version** (Monday 26 October 2026): the tool expects the 80 blocks the datasheet gives. Earlier versions expected 64 and stopped at section 4.2 with "Block 64 answered a read". If you see that message, you have an old copy: stop and ask for the current one.
- **`TAG_ABSENT` now says which case it is** (this version): every such message begins `Case NO_TAG.`, `Case TAG_MUTE.`, `Case CONNECT_FAILED.`, `Case UID_REFUSED.`, `Case READER_GONE.` or `Case TAG_NOT_READY.`, and ends with the reader's name and state. A message without `Case` means an old copy. None of this has met the ACR1552U yet.

If a step does not behave as written, that is a finding, not a failure on your part. Write down what it printed.

---

## 1. Before the call (two minutes)

1. **The tool folder.** On GitHub, open the `Trevean-Spice/nfc-development` repository, switch to the branch `fleet/tag-tool`, choose **Code**, then **Download ZIP**, and unzip it into Downloads (on Windows: right click, Extract All). It unzips as `nfc-development-fleet-tag-tool`. Inside it, the `tag-tool` folder holds `Start Tag Tool`, `build\chip-cli` and `build\edge\redirect-table.json`. The tool reads the table from there, so keep the two folders side by side exactly as they are.
2. **Internet access.** `npm ci` downloads about 25 MB the first time.
3. **Exit GoToTags**: right click its icon near the clock (the Windows system tray) and choose Exit, or end it in Task Manager; on a Mac, quit it from the menu bar. Only one program can drive the reader at a time. If it starts with Windows, disable it in Task Manager, Startup apps.
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
   **Expected:** four lines beginning `ok`, the third reading `physical reader responded: ACS ACR1552 ...`, the fourth `tag on the reader` (with no tag down it says `absent`), then `Ready.`

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
   **Expected:** four `ok` lines, the third naming the reader (the name typically includes `PICC`), the fourth `tag on the reader`, then `Ready.`

---

## 4. The command line, then the lock session

Run them in this order, from the same `build/chip-cli` folder: 4.1 and 4.2 are the command line, 4.3 is the lock session. Windows uses `bin\chip-cli.mjs`, Mac uses `bin/chip-cli.mjs`; otherwise they are identical. **Close the Tag Tool's black window first**: both programs can open the reader at the same time and nothing in the reader or the computer stops them. Only `--protect` on a real reader checks: while a Tag Tool is running it refuses with "Close the Tag Tool first" and protects nothing. The other commands do not check.

### 4.1 Doctor

```
node bin/chip-cli.mjs doctor --transport reader
```

`Ready.` with the reader named. No tag needed. With a tag lying on the reader, the `tag on the reader` line says `present` with its UID, or `mute` (the reader detects a tag that does not answer), or `absent`, with the reader's raw state. If the tag goes down after you start doctor, add `--tag-timeout-ms 15000` to give yourself fifteen seconds.

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

### 4.3 The lock session: protection test, on the SACRIFICIAL tag only

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
| `TAG_NOT_ST25TV02KC`, "Block 79 could not be read" or "Block 80 answered a read" | The tag is not the 80 block part the tool expects, or the reader reads blocks differently | **STOP.** The tag is unharmed. Report it with the UID |
| `PROTECT_FAILED`, "The reader did not complete ...", "GetRandomNumber before ... got no usable answer" or "PresentPassword got no usable answer" | The ACS session or the ST command path failed | **STOP.** The tag is unharmed |
| `PASSWORD_REJECTED` | The tag refused the factory password 1 | **STOP.** Do not try any other password |
| Any other code before `Verified` (`TAG_ABSENT`, `WRITE_FAILED`, `READBACK_...`, `TRANSPORT_UNAVAILABLE`) | Section 4.2's path failed | **STOP.** The tag is unharmed |

**After `Verified`, before any irreversible command.** Only these mean nothing was locked:

| What it prints | What it means | What to do |
|---|---|---|
| `PROTECT_FAILED`, "Refusing to protect this tag: the opcode probe did not pass" | The gate working. The message lists what the tag answered at each step | **STOP.** Nothing was locked. This line is the most useful thing the session can produce |
| `PROTECT_FAILED`, "The tag could not be read immediately before protection" or "no longer holds the bytes that were verified" | The check before the probe | **STOP.** Nothing was locked |
| `PROTECT_FAILED`, "The opcode probe could not run" | The probe itself failed to start | **STOP.** Nothing was locked |
| `PASSWORD_REJECTED`, or "PresentPassword got no usable answer", printed after `Verified` | Presenting password 1 after the probe failed. WritePassword was not reached | **STOP.** Nothing was locked |
| `PROTECT_FAILED`, "The current password was not accepted immediately before WritePassword ... WritePassword was not sent" | The factory password 1 was refused inside WritePassword's own session, so WritePassword never went out | **STOP.** Nothing was locked |
| `PROTECT_FAILED`, "Refusing to change a password: ... This command was not sent", with no "irreversible part had begun" before it | The gate stopped WritePassword before it went out, for example because the tag's UID could not be read again | **STOP.** Nothing was locked |

**After WritePassword, before protection.** This one is not LOCKED?, and it matters more than any other row:

| What it prints | What it means | What to do |
|---|---|---|
| `PROTECT_FAILED`, "WritePassword was accepted but the new password does not open the tag. Area protection was NOT applied; the tag is still writable; its password 1 is unknown." | The tag took WritePassword, but presenting the new password straight afterwards failed. So the tool and the tag disagree about how the password is coded, and protection was never sent. The tag still reads and still accepts writes, but nobody holds its password 1 | **STOP. Label the tag "PASSWORD UNKNOWN, NOT PROTECTED".** Do not run 4.3 on any other tag: this would repeat on every one. Report it the same day, with the whole message |

**After an irreversible command.** Every one of these starts "Protection did not complete, and its irreversible part had begun. Password 1 may already have been changed by this run ... Label the tag LOCKED? and stop", then "Original message:" and what went wrong. **All of them: STOP. Label the tag "LOCKED? password discarded" and never reuse it.** What the original message tells the bring up:

| Original message (after "Original message:") | What it means | Also do |
|---|---|---|
| "Writing password 1 was not confirmed", or `TRANSPORT_UNAVAILABLE` | WritePassword got no clean answer. It may have taken effect | Nothing more |
| "Refusing to apply area protection: ... This command was not sent" | The password may have changed, then the gate stopped the protection command (the reader lost the session or the tag) | Nothing more |
| "Setting protection on area 1 was not confirmed", or "The factory configuration password was not accepted" | The protection command got no clean answer, or could not be sent | Nothing more |
| "The tag did not report protection for area 1", or "reports protection state ..." | The protection read failed or disagreed. The tag may already be protected | Nothing more |
| `TAG_CHANGED`, `TAG_ABSENT`, "After protection the tag decodes to" | Something went wrong between protecting and proving. If `TAG_CHANGED`: a second tag answered, so the area was not clear | Label every tag that was in reach LOCKED? too |
| "The proof write was not sent", or "The unlock proof write was not sent" | The tag in the field was not the unit's tag | Label every tag that was in reach LOCKED? too |
| "The proof write to block 1 got neither ..." | The tag refused the proof write with a code other than 12h, or gave no clean answer | **Write down the code in the message** |
| "The proof write to block 1 was accepted" | The tag accepted the write after protection. **It may still be protected** and its password was changed: if the field did not really drop, the earlier password still applied. Or protection did not take | **Report it the same day** |
| "could not be read after protection" | The NDEF read after the field cycle failed: the tag may be protected and unreadable to a phone | **Report it the same day** |
| "After protection, the password this run wrote did not open the tag", or "the unlock proof write to block 1 got ..." | The tag refuses writes, and the password this run recorded did not open it, or the write with it presented was not accepted. This is the failure the unlock proof exists to catch | **Report it the same day** |

| What it prints | What to do |
|---|---|
| `Protected`, `refusal proven: yes`, `unlock proven: yes`, `opcode probe passed on this tag`, then `OK` | The whole path worked once, on this tag: protection took, the tag refused a write with no password, and the password this run wrote opened it and the same write was accepted. A `Protected` line without `unlock proven: yes` is not this version: treat it as "not listed" below. Tap it with a phone: the Persian Sunrise page must open (**STOP** if it does not: the tag is scrap). Then run `node bin/chip-cli.mjs verify --expect ps --transport reader`, which must pass. Label the tag "PROTECTED, password discarded" |
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
| write: `TAG_ABSENT` | Tag flat and centred, one tag only, then run it again. Close GoToTags. The message names the case and the reader state; with the tag on the reader, `doctor --transport reader` says whether the tag is present, mute or absent and reads its UID |
| `TAG_ABSENT` with `Case TAG_NOT_READY`, or the Tag Tool page says "Tag not ready, retrying" | The reader connected to the tag and then found no tag (`SCARD_E_NO_SMARTCARD` or similar), three times in a row. Not a reader fault. Keep the tag flat and still in the centre; the Tag Tool retries by itself, and a `write` can simply be run again. If it never clears: close GoToTags, unplug and replug the reader, and send the whole message, which names the command the tag was lost at (`the UID read (FF CA 00 00 00)` or one of the geometry check's reads) |
| The tag's ID gets typed into the box, like `35 49 5E 6D 05 08 02 E0` over and over, Caps Lock turns itself on and off, or the Tag Tool page says "Another program is reading the tags" | GoToTags (or another NFC program) is running and reading every tag. Right click its icon near the clock and choose Exit, or end it in Task Manager (Ctrl+Shift+Esc, Processes, right click, End task). Stop it starting with Windows: Task Manager, Startup apps, right click GoToTags, Disable. Then lift the tag and put it back. Turn Caps Lock off if it was left on |
| Tag Tool black window: `Reader trouble, reconnecting: The reader rejected a command: NoSmartCard (SCARD_E_NO_SMARTCARD)` several times a second, without stopping | An old copy (afternoon of Monday 26 October 2026). Close it and download the current one. Rebooting does not help |
| write: `TAG_NOT_ST25TV02KC` | Not the right kind of tag. Nothing was written. If the message says `Block 79 could not be read` or `Block 80 answered a read` on a tag sold as ST25TV02KC, stop and report it with the UID and the full message: do not try other tags to make it pass |
| write: `WRITE_FAILED` on a tag that should be blank | Report it with the full message. Try one more blank tag |
| anything else | Every failure prints a code and a line beginning `What to do:`. README section 7 lists them all |

**Everything here is reversible except section 4.3, which can lock the sacrificial tag for good.** Nothing else in this document can lock a tag.
