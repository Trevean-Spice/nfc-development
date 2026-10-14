# How to switch the spice jar tags on

**Written for somebody who is not technical.** You do not need to understand any of the code in this folder to follow it.

**What this achieves:** tapping a spice jar with a phone opens that jar's story page. Right now it opens an error. There are 1,000 jars already printed and shipped, so this is the change that makes them work.

**Roughly 20 minutes of your time, then up to a few hours of waiting for the internet to catch up.**

---

## Before you start, read this once

**The most important thing on this page is step 4.** You are going to change where `treveanspice.com` points. The settings that control your **email** live in the same place as the settings that control your **website**, and they are easy to delete by accident when changing one of them.

Your email was broken recently and has just been fixed. **Breaking it again would be a bigger problem than the tags not working.** The tags can wait another week. Your email cannot.

So: change only the records step 4 tells you to change. Leave everything else exactly as it is.

---

## What is wrong today, in plain terms

Your domain name, `treveanspice.com`, currently points at **Bluehost**, which is where your old website used to live. There is nothing there any more.

Your **new** website is built and working, at `trevean-spice-website.vercel.app`, hosted by **Vercel**.

So today:

| If you visit | You get | Should be |
|---|---|---|
| `treveanspice.com` | An error page (403) | Your website |
| `treveanspice.com/t/ps` (what a jar tap opens) | An error page (500) | The Persian Sunrise story |
| `trevean-spice-website.vercel.app` | Your website, working fine | (unchanged) |

**The jars are not faulty and the tags are not faulty.** They are pointing at an address that currently has nothing behind it.

Two things fix it: adding a small settings file to your Vercel project (steps 1 to 3), and pointing the domain at Vercel instead of Bluehost (step 4).

---

## Step 1: add the redirect settings file

This is the file that tells Vercel "when someone taps a Persian Sunrise jar, show them the Persian Sunrise page".

1. Open the folder your website's code lives in.
2. Copy the file **`dist/vercel.json`** from this folder into the **top level** of your website's folder, next to your `index.html`. Top level matters: not inside a subfolder.

**If your website already has a file called `vercel.json`**, do not overwrite it. Send it to us instead and we will merge the two. Overwriting it could switch off settings your site relies on. If you would rather do it yourself, open your existing `vercel.json` and paste the contents of **`dist/redirects.json`** in as a `redirects` section. If that sentence does not mean anything to you, send us the file.

---

## Step 2: add the "not found" page

If somebody types a jar code that does not exist, they should see a Trevean Spice page telling them so, not a blank grey screen from Vercel that says "The page could not be found".

Copy **`dist/404.html`** into the same top level folder, next to `index.html`.

That is the whole step. Vercel picks the file up automatically because of its name.

---

## Step 3: publish it

However you normally update your website. If your site is connected to GitHub, that means committing these two new files and pushing, and Vercel will publish within a minute or two.

**Then check it worked, before touching any DNS.** Visit:

```
https://trevean-spice-website.vercel.app/t/ps
```

You should land on the **Persian Sunrise** page. If you do, the hard part is done and the settings are correct. If you get "page could not be found", the `vercel.json` file is in the wrong folder, or the deployment has not finished. Fix that before going any further, because step 4 is much harder to undo.

---

## Step 4: point the domain at Vercel

**This is the step that needs care. Read the whole step before doing any of it.**

Your domain is managed at **Bluehost**. Its nameservers are `ns1.bluehost.com` and `ns2.bluehost.com`. In your Bluehost DNS settings you will see a list of records. They do two completely different jobs:

| These records run your **website** | These records run your **email** |
|---|---|
| `A` record for the apex (`@` or `treveanspice.com`), currently `50.6.2.51` | `MX` records, currently pointing at `smtp.google.com` |
| `CNAME` or `A` record for `www` | `TXT` record starting `v=spf1` (this is **SPF**) |
| | `TXT` record on a name like `google._domainkey` (this is **DKIM**) |
| | `TXT` record on `_dmarc` (this is **DMARC**) |

**You are changing the left hand column only. Do not touch, edit, or delete anything in the right hand column.**

Those four email record types, **MX, SPF, DKIM and DMARC**, are what make your email arrive and stop it going to spam. They were only just restored. Changing the website records does not require changing them, and any instruction that tells you to "clear all records" or "replace the nameservers" would take them with it.

**Because of that, do not use Bluehost's "change nameservers" option, and do not accept any Vercel prompt offering to move the whole domain.** Both replace everything at once, including the email records. Change the two individual records instead.

### What to change

1. In **Vercel**, open your project, go to **Settings**, then **Domains**, and add `treveanspice.com`. Add `www.treveanspice.com` as well.
2. Vercel will show you the exact values it wants. **Use the values Vercel gives you on the day**, not values from any older document, because they do change. They will look roughly like:
   - for the apex `@`: an **A** record pointing at an IP address
   - for `www`: a **CNAME** record pointing at a Vercel hostname
3. In **Bluehost DNS**, edit the existing apex `A` record, changing its value from `50.6.2.51` to the address Vercel gave you. Edit the `www` record the same way.
4. **Change nothing else. Save.**

### Then wait

DNS changes take anywhere from a few minutes to a few hours to spread across the internet. Nothing is wrong if it has not worked after ten minutes.

---

## Step 5: check the email still works

**Do this before you check the tags.** Send yourself an email from an outside account (a personal Gmail, say) to your Trevean address, and send one out from it.

If both arrive, the email is fine and you can stop worrying about it.

If either fails, tell us straight away rather than trying to fix it yourself. It is recoverable, and it is much easier to recover if nothing else has been changed in the meantime.

---

## Step 6: check the tags

Visit `https://treveanspice.com/t/ps`. You should land on the Persian Sunrise page.

Then **tap a real jar with a real phone**, one of each of the four blends that have tags: Persian Sunrise, Caribbean Sunset, The Silk Road, and North African Night Market. Check each one opens **its own** blend and not another one. This is the check no automated test can make for you, because getting it wrong looks completely normal: the page loads fast, nothing errors, it is simply the wrong story.

Two things that are normal and not faults:

- **On an iPhone, a tap never opens the page by itself.** iOS shows a banner at the top of the screen and you tap that to open it. There is no setting that removes it, on any phone, for any tag.
- **A tap does nothing at all if the screen is off.** On Android it also does nothing if the phone is locked. Wake the phone first. This is how the phones work and it is not something the jars or the website can change.

Kyoto Garden has no tags in this batch, so there is nothing to tap for it. Its code works if typed, ready for when you do print those tags.

---

## For us, or for whoever is technical

One command checks all five codes on both routes and prints a pass or fail table:

```
cd build/vercel-redirect
npm run verify -- --base https://treveanspice.com
```

Run it against the Vercel URL after step 3, and against the real domain after step 4:

```
npm run verify -- --base https://trevean-spice-website.vercel.app
```

Exit code 0 means everything passed. A **NOTE** is not a failure: it is a known and documented difference between Vercel and the original CloudFront design, and there are two expected ones, explained in README.md, section 5. Add `--no-follow` to skip fetching the destination pages, and `--quick` to skip the 150 extra requests that check capitalisation and trailing slashes.

---

## If something goes wrong

**Undoing step 4** is the same edit in reverse: change the apex `A` record back to `50.6.2.51`. It takes the same few hours to spread.

**The jars are not at risk.** Nothing in this process writes to a tag or changes anything physical. The tags carry a web address and nothing else, and the whole point of the design is that where that address leads is a setting we can change at any time, without ever touching the 1,000 jars.

If you are unsure at any point, stop and ask before saving. Particularly at step 4.
