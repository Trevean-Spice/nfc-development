# Content intake specification

**For: Trevean Spice**
**From: Serene Labs Inc**
**Date: Monday 17 August 2026**
**Applies to: Persian Sunrise and Caribbean Sunset first, then the other three blends**

---

## 1. The answer first

**Here is exactly what we need, per blend, per field, with the format and the length. Send it in the shape described in section 8 and it goes straight in. Send it in any other shape and it comes back to you at least once.**

Content drafts for the two launch blends were due Friday 14 August 2026, then again on Friday 21 August 2026 as a named M2 gate condition, and neither date was met. **The gate date is now conditional rather than fixed: it moves day for day from Friday 21 August 2026, earliest Monday 31 August 2026 if this and the other four outstanding dependencies land Monday 24 August 2026.** See "M2 plan: the gate moves day for day from Friday 21 August 2026". The pages are built and measurable now against placeholders that are the exact size and weight of the real thing, so the build is not blocked. What is blocked is the gate demonstrating the product rather than the components.

There is also a checker. Run `node tools/validate-intake.mjs yourfile.json` and it lists every problem at once, in plain terms, in about a second. Nobody has to wait for us to find them.

---

## 2. The shortest possible version

Per blend, we need:

1. One tagline.
2. One origin story: a heading and three paragraphs.
3. One country code, and a region and city if you want them shown.
4. Two numbers: the farm latitude and longitude.
5. Three dates: harvested, blended, best before.
6. One grower: name, farm name, country, region, profile copy, years farming, and a portrait with the subject's written consent.
7. Five to ten recipes, each with a title, a summary, ingredients as separate values, and steps.
8. Photographs: one hero, one grower portrait, and one per recipe.

Everything else on the page we build.

---

## 3. The blend

| Field | Format | Length | Required to publish | Notes |
|---|---|---|---|---|
| Blend name | Plain text | Up to 120 characters | Yes | Already supplied. Confirm the exact capitalisation you want printed. |
| Tagline | Plain text, one line | 40 to 120 characters, hard maximum 200 | Yes | Sits under the blend name, above the fold on a phone. Anything past about 120 characters wraps to three lines on a 375 px screen and pushes the origin story below the fold, which breaks an acceptance criterion. |
| Origin country | Two letter ISO 3166-1 code, uppercase | Exactly 2 | Yes | For example IR, TT, MA, JP. One code only. See section 7 for The Silk Road. |
| Origin region | Plain text | Up to 120 characters | No | Province, state or named region, spelled as you want it printed. |
| Origin city | Plain text | Up to 120 characters | No | Leave it out rather than guess. We will not fill it in for you. |
| Farm latitude | Decimal degrees, a number, not a string | 4 decimal places | Yes | For example 32.6539. Not degrees and minutes. Negative for south. |
| Farm longitude | Decimal degrees, a number | 4 decimal places | Yes | For example 51.6660. Negative for west. |
| Farm map label | Plain text | Up to 200 characters | No | What the pin says. A district or a valley, not a street address. |
| Origin story | A list of blocks | 1 heading plus 2 to 5 paragraphs | Yes | See below. |
| Harvest date | YYYY-MM-DD | Exact | Yes | A provenance claim. We will never fill one in. |
| Blend date | YYYY-MM-DD | Exact | Yes | |
| Best before | YYYY-MM-DD | Exact | Yes | A food safety claim. |
| Lot label | Plain text | Up to 40 characters | No | Printed lot reference. Stated per blend, not per jar: tag encoding is per SKU, so per lot attribution is not possible and we do not offer it rather than fake it. |

### The origin story, in more detail

Send it as blocks, not as one field of prose with line breaks in it:

```json
"storyBlocks": [
  { "type": "heading",   "text": "..." },
  { "type": "paragraph", "text": "..." },
  { "type": "paragraph", "text": "..." },
  { "type": "paragraph", "text": "..." }
]
```

- **Heading:** 20 to 60 characters.
- **Paragraphs:** 320 to 480 characters each, two to five of them.
- **Block types are `heading`, `paragraph` and `quote`. There is no HTML block type and that is deliberate.** Raw HTML from a content system is how a blocking script or a third party font ends up on the tap path without anyone deciding to put it there, which would cost the page its speed number.
- **The first paragraph has to read as a complete opening on its own.** The acceptance criteria require the origin story visible without scrolling, so on a 375 px phone the first paragraph is what a customer reads while still holding the jar. A first paragraph that is a scene-setting fragment reads as a truncation.

---

## 4. The grower

This is the section with an obligation attached to it, so it is worth reading in full.

| Field | Format | Length | Required to publish | Notes |
|---|---|---|---|---|
| Grower name | Plain text | Up to 160 characters | Yes | A real person or a real cooperative. |
| Farm or cooperative name | Plain text | Up to 160 characters | No | As it should be printed. |
| Country | Two letter ISO 3166-1 code | Exactly 2 | Yes | |
| Region | Plain text | Up to 120 characters | No | |
| Profile copy | Plain text | 600 to 900 characters, hard maximum 4000 | Yes | Below the fold. Under 600 characters reads as a caption rather than a profile. |
| Years farming | Whole number | 0 to 120 | No | |
| Farm latitude and longitude | Decimal degrees, numbers | 4 decimal places | Yes | The map pin. |
| Portrait photograph | See section 6 | | Yes | |

**Two things we need in writing alongside the portrait, and we will not publish without them:**

1. **The subject's consent** to appear, by name, on a consumer product page.
2. **The photographer credit and licence terms**, which we add to the background IP list the Scope document, "IP and handoff", requires us to keep from day one.

We have not invented a grower name, a farm, a coordinate or a profile anywhere in the seeded data, and we will not. A fabricated grower profile is indistinguishable from a real one on the page, it survives a publish, and it would put a claim about your supply chain in front of a customer that nobody at Trevean made.

---

## 5. The recipes

**Five to ten per blend for the two launch blends.** Fewer than five and the carousel looks broken. More than ten and the page exceeds its image budget.

| Field | Format | Length | Required to publish |
|---|---|---|---|
| Title | Plain text | 20 to 60 characters, hard maximum 160 | Yes |
| Summary | Plain text | 60 to 160 characters, hard maximum 400 | Yes |
| Servings | Whole number | 1 or more | No |
| Prep minutes | Whole number | | No |
| Cook minutes | Whole number | | No |
| Difficulty | One of `easy`, `medium`, `hard` | | No |
| Ingredients | A list, each with four separate values | 3 to 40 entries | Yes |
| Method steps | A list of strings | 2 to 30 entries, up to 800 characters each | Yes |
| Photograph | See section 6 | | No, but recommended |
| Carousel position | Whole number | | We default to the order you send them in |

**Ingredients as four separate values, not one string. This is the request most likely to be skipped and the most expensive to fix later.**

```json
{ "quantity": 2, "unit": "tsp", "item": "Persian Sunrise blend", "note": null }
```

Not `"2 tsp Persian Sunrise blend"`. Three reasons: the page formats quantities differently at different screen widths, a future translation cannot parse an English string, and a scaled serving size needs the number on its own.

**Do not number the steps in the text.** The page numbers them. "1. Rinse the rice" becomes "1. 1. Rinse the rice".

---

## 6. Photography, and the numbers behind it

**This section is arithmetic, not preference.** The acceptance criteria require a Lighthouse performance score of at least 90 and a page readable within 2.0 seconds on cellular. The M1 performance budget resolves that against premium photography by fixing a byte cap per image slot and choosing photographs that fit it. The full derivation is in the M1 deliverable "Per-page byte and speed budget", section 4.3.

### What to send

| Slot | Send at least | We serve | We cap at | Where it appears |
|---|---|---|---|---|
| **Hero** | 2560 px wide, 1.34:1 | 1280 by 955 | **90 KB** | The one image above the fold. It is the image the 2.0 second measurement is taken on. |
| **Grower portrait** | 1280 px wide, square | 640 by 640 | 80 KB | Below the fold, lazy loaded. |
| **Recipe** | 1200 px wide, 4:3 | 600 by 450 | 38 KB | Carousel cards, lazy loaded. |
| **Gallery** | 1600 px wide | Variable | Counts against the total | Optional. |

- **Format: JPEG, PNG or WebP.** Maximum 25 MB per file. Send the largest and least processed version you have. We produce AVIF and WebP derivatives at every size the page needs; nobody at Trevean ever has to think about image formats.
- **Colour space sRGB.** A file in Adobe RGB or ProPhoto shifts noticeably on a phone.
- **No text baked into the image.** It cannot be translated, it cannot be read by a screen reader, and it is illegible at 375 px.
- **Alternative text for every image**, 40 to 140 characters, describing the photograph for someone who cannot see it. Required before an image can appear on a published page.

### The art direction that follows from the 90 KB hero cap

The cap is fixed and the photograph is chosen to fit it, not the other way round. Practically:

- **Works well at 90 KB:** a single subject, shallow depth of field, large simple shapes, a clean or dark background. These also read best on a 375 px screen, so the constraint and the design agree.
- **Works badly at 90 KB:** flat lit, full frame, high detail texture, for example an edge to edge bed of loose spice in even light. It is the worst case for compression and the worst case for a small screen at the same time.

**If a specific blend genuinely needs more, the budget has an escape valve:** one named blend may raise its hero to 130 KB, recorded in the decision log, with no more than one blend holding the exception at a time. Anything past 130 KB is a change to a contractual gate and is your call, not a designer's, and we will bring you the cost in milliseconds before you make it.

### What we are measuring against right now

Every placeholder image in this build is **exactly** the dimensions and **exactly** the byte weight its slot allows: the hero is 1280 by 955 and 92,160 bytes to the byte. That is deliberate. A performance budget validated against a small grey rectangle proves nothing and falls over the day real photography lands. When your photographs arrive, the page weight does not change, because the weight was never the placeholder's.

---

## 7. Three questions only you can answer

**1. The Silk Road has no country.** Its stated origin is "Central Asia", which is a region, and the field is a single ISO 3166-1 country code. Either name the country, or accept the region shown with no country, or we change the data model to carry several origins, which is a contract change and is not free. It is held empty until you answer.

**2. Isfahan, the province or the city.** Recorded as a region because that is your wording. If you mean the city, say so and we will set both.

**3. Trinidad and Tobago is the country.** Which island, district or estate should be printed as the region, if any.

Every one of these is currently held empty rather than filled in with our best guess.

---

## 8. How to send it

**One folder per blend.** Inside it:

```
persian-sunrise/
  persian-sunrise.json          <- copy of intake/TEMPLATE-blend.json, filled in
  images/
    hero.jpg
    grower-portrait.jpg
    recipe-01.jpg ... recipe-07.jpg
```

The template is `intake/TEMPLATE-blend.json`. Leave a value `null` if you do not have it yet. Do not delete the key: a `null` tells us the item is outstanding, a missing key tells us nothing.

**Check it before you send it:**

```
node tools/validate-intake.mjs persian-sunrise/persian-sunrise.json
```

It reports every problem at once rather than one per round trip: missing required fields, text over or under length, dates in the wrong format, coordinates as strings instead of numbers, ingredients written as one string, HTML in a story block, a hero photograph too small to make the 1280 px variant, and an image whose aspect ratio will be cropped.

**A spreadsheet or a document is acceptable if that is faster for you.** Send it and we will do the conversion once, on the condition that the ingredient columns are separate and the dates are unambiguous. What costs a week is a format that looks structured and is not.

---

## 9. What happens if this is late

Stated plainly, because it is better said now than in the gate week.

- **The build does not stop.** Everything is built and measured against placeholders that are the right size and weight, and the seeded records have the same shape as the real ones.
- **The gate changes character.** Without real content the gate would demonstrate that the components work rather than that the product does. The tap, the redirect, the page speed and the device matrix are all real measurements either way, and none of them is affected by whose words are on the page.
- **The standing rule applies, and it has now fired.** If a client dependency slips, the gate moves by the same number of days, in writing, on the day it is known. This content was one of five dependencies that missed Friday 21 August 2026, and the gate moved on Saturday 22 August 2026 accordingly. That rule protects both of us and it is not applied retroactively.
- **The one thing that cannot be recovered late is photography.** Real photographs are the largest single variable in the speed number. The placeholders remove the surprise, but they cannot tell us whether your actual hero shot holds up at 90 KB. That answer needs the actual files.

To see exactly what is outstanding at any moment, run `node tools/content-readiness.mjs`. The current output is in `reports/`.
