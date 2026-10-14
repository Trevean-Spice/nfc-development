# The slug: `the-silk-road` becomes `silk-road`

**Document date:** Saturday 22 August 2026
**Decision:** the application moves. The redirect table does not.
**Who decides:** already decided. The tags are encoded and shipped, so this is arithmetic
rather than a choice. Recorded here because the audit left it as "one has to move" and
somebody has to write down which.
**PR:** 8, together with the CI guard that keeps it. They do not travel separately.

---

## 1. Which way it goes, and why there is no argument

The canonical redirect table, `build/edge/redirect-table.json` version 2, entry `sr`:

```json
{ "code": "sr",
  "blendSlug": "silk-road",
  "requestPath": "/t/sr",
  "targetPath": "/blend.html?blend=silk-road&via=nfc",
  "unitsEncoded": 250,
  "status": "encoded",
  "encodedOn": "2026-07-24",
  "chipPartNumber": "ST25TV02KC",
  "ndefUri": "https://treveanspice.com/t/sr" }
```

**250 tags carrying `https://treveanspice.com/t/sr` were encoded on 24 July 2026 and
shipped.** The NDEF URI on a shipped jar cannot be edited from here. The redirect table is
the single artifact from which the CloudFront function, the tag seed, the chip encoding
input and the QR artwork sheet are all compiled, and changing `silk-road` to
`the-silk-road` there would mean changing all four to match a spelling that exists only in
this scaffold.

So the application renames. Four of five slugs already match; this is the fifth, and it is
one hyphenated word.

**Why it is worth a document at all.** The failure mode is silent. Nothing crashes, no test
goes red, no log line appears. A customer taps a jar, the redirect resolves correctly to
`/blend.html?blend=silk-road&via=nfc`, and the application has no page by that name.
Under the acceptance criteria, section 6.1, "correct destination", a 404 fails regardless
of speed. It was found independently by three auditors and it is exactly the failure that
audit item B7 was written to catch.

---

## 2. Every location

Five occurrences across three files, found by grepping the tracked tree on 22 August 2026
and re-verified after the change by `scripts/ci/assert-slugs.mjs`, which reported the same
five and then reported none.

| # | File | Line | As inherited |
|---|---|---|---|
| 1 | `src/shared/constants/index.ts` | 52 | `id: 'the-silk-road',` |
| 2 | `src/web/pages/blend/[id].tsx` | 194 | `'the-silk-road',` in the `getStaticPaths` slug list |
| 3 | `src/web/pages/blend/[id].tsx` | 340 | `'the-silk-road': {` the fixture key |
| 4 | `src/web/pages/blend/[id].tsx` | 341 | `id: 'the-silk-road',` inside that fixture |
| 5 | `src/web/pages/index.tsx` | 146 | `id: 'the-silk-road',` |

**Nothing else in the repository refers to it.** `scripts/seed.ts` is not on this list
because it seeds a different product entirely, five blends called Golden Sunrise, Midnight
Dream, Forest Fire, Citrus Harmony and Emerald Garden with ids `blend-001` through
`blend-005`. It has no silk-road spelling of any kind, right or wrong, and it is not fixed
in this pull request. See section 5.

The mechanical change, verified on a scratch copy:

```bash
sed -i "s/the-silk-road/silk-road/g" \
  src/shared/constants/index.ts \
  'src/web/pages/blend/[id].tsx' \
  src/web/pages/index.tsx
```

`the-silk-road` occurs nowhere else, so a blanket substitution across those three files is
safe. Confirm with `git diff --stat`: three files, five lines.

**The display name does not change.** `name: 'The Silk Road'` is the customer facing name
and it is correct. Only the identifier moves. Any substitution that also rewrites the name
string has gone too far, which is why the change is scoped to three named files rather than
run across the tree.

---

## 3. What lands in the same pull request, and why it must

`config/redirect-table.json`, a copy of the canonical table, and
`scripts/ci/assert-slugs.mjs`, which reads it.

**The rename without the guard is one careless merge from being undone**, silently, with
nothing to say so. That is how the wrong spelling reached three separate datasets in the
first place. The guard does three things:

1. forbids the spelling `the-silk-road` anywhere in tracked source, printing the reason and
   every hit with its line;
2. asserts that every `blendSlug` in the redirect table is present in
   `src/shared/constants/index.ts`, including the reserved fifth, `kyoto-garden`, so a code
   that resolves to a blend the application does not know about cannot pass review;
3. asserts `redirectStatus` is 307, because a 301 or 308 on a thousand shipped tags quietly
   removes the ability to repoint a blend by editing the table, which is the entire reason
   the redirect exists.

It needs no dependency install, so it still reports when the dependency tree is broken.

**The copy of the table is temporary and says so in its own comment.** The single source of
truth is the edge package. When that package is transplanted into `nfc-development`, delete
the copy and point the guard's `REDIRECT_TABLE` constant at the real file. The check itself
does not change. Until then, a copy that CI enforces is better than a reference to a file in
another repository that nothing can check.

---

## 4. Verified, not assumed

Run against a scratch copy of `nfc-development` at HEAD `2220c43`, with the canonical table
placed at `config/redirect-table.json`.

Before:

```
SLUG GUARD FAILED. 1 problem(s).
1. The forbidden slug "the-silk-road" appears 5 time(s).
    src/shared/constants/index.ts:52: id: 'the-silk-road',
    src/web/pages/blend/[id].tsx:194: 'the-silk-road',
    src/web/pages/blend/[id].tsx:340: 'the-silk-road': {
    src/web/pages/blend/[id].tsx:341: id: 'the-silk-road',
    src/web/pages/index.tsx:146: id: 'the-silk-road',
```

After the substitution:

```
Slug guard passed: 5 canonical slugs, no forbidden spellings.
```

---

## 5. What this pull request deliberately does not fix

**The route shape.** The tags reach `/blend.html?blend={slug}&via=nfc`; this repository
serves `/blend/{id}`, a path segment. That is a separate defect, it is larger, and it is
closed either by a `rewrites()` entry in `src/web/next.config.js` or at the CDN, decided
together with the redirect-serving decision because they are the same URL contract seen
from two ends. Correcting the slug does not close it and must not be described as though it
does.

**The three disagreeing blend datasets.** `src/shared/constants/index.ts`,
`src/web/pages/blend/[id].tsx` and `src/web/pages/index.tsx` each carry their own copy of
the five blends, and they disagree on harvest dates, freshness windows and coordinates:
Persian Sunrise is 2025-09-15 with a 365 day window in the constants file and 2025-12-15
with 200 days in the page. `scripts/seed.ts` carries a fourth dataset that is a different
product. **This pull request makes all five slug spellings agree and changes nothing else**,
because consolidating four datasets into one is a content decision that needs the real blend
data, and mixing it into a fifteen minute rename would make both harder to review.

The slug guard is written so that it keeps working when that consolidation happens: it
asserts against the redirect table, not against a particular file's structure.
