# The placeholder convention

**Status: in force from 17 August 2026. Convention version 1.**

---

## 1. The answer first

**Real content for the two launch blends has not arrived. It was due Friday 14 August 2026 and there is no record of it in this repository as of Monday 17 August 2026. Content writing, photography and translation are outside our scope, so nothing in these fixtures is written for Trevean. What exists instead is a data set where every single value that is not real is impossible to mistake for real, in the data, in the API response and on the rendered page.**

The failure this convention exists to prevent is specific and it is not hypothetical:

> A fabricated grower profile, with a name, a farm, a portrait and a coordinate on a map, is indistinguishable from a genuine one to everyone who sees it. It gets copied into a review deck. It survives a publish. It reaches a page that 1,000 encoded tags in customers' kitchens already point at. And it is a statement about a real supply chain that nobody at Trevean ever made.

So the rule is not "mark placeholders clearly". The rule is:

**Where a value would be a claim about a person, a place, a date, a price or a food, no value is invented at all. The field is held null and the page says so. Everywhere else the placeholder carries a marker that cannot be removed by accident.**

---

## 2. The three layers

Every placeholder is visible at three levels, because each level has a different reader and each one is a different way for the problem to escape.

### Layer 1: in the data, a sentinel inside the value

Every placeholder string starts with the exact token `[PLACEHOLDER]` and contains the phrase `NOT REAL CONTENT`.

```
"tagline": "[PLACEHOLDER] TAGLINE PENDING, NOT REAL CONTENT. Trevean facts: saffron, cardamom, rose petals, lime; Isfahan, Iran."
```

The token travels with the value. It survives a copy and paste into a deck, an export to CSV, a screenshot, a database dump and a page render. There is no configuration that turns it off, because it is not configuration, it is the value.

`grep -r "\[PLACEHOLDER\]"` over the repository is the whole detection mechanism, and it is what the seeding tool and CI both use.

### Layer 2: in the item, a machine-readable flag

Every fixture record carries a `_placeholder` object, and every seeded DynamoDB item carries two attributes derived from it:

| Attribute | Type | Purpose |
|---|---|---|
| `placeholderContent` | boolean | One attribute, top level, so a filter expression, a publish guard or a CI check is a single condition rather than a scan of every string. |
| `contentReadiness` | map | Per field state, the reason, the date content was due, and the convention version. |

The per field state is one of six values:

| State | Meaning |
|---|---|
| `client_real` | Supplied by Trevean, used verbatim, complete. |
| `contractor_real` | Authored by us, factually correct, complete. Structural links and statements about how the system works, never editorial about the supply chain. |
| `placeholder_text` | A string carrying the sentinel. |
| `placeholder_null` | Deliberately null. **A fabricated value here would be a false claim.** |
| `placeholder_media` | Points at a generated placeholder asset. |
| `not_applicable` | Does not apply to this record. |

Two properties of this design matter.

**Every field in the specification must carry a state.** A field with no state is reported as `UNFLAGGED, convention breach` by the readiness report, and the report exits with a non-zero status. Silence is not treated as "this must be fine".

**The tooling fails towards "this is not real".** An unrecognised state, a missing flag or a stray sentinel anywhere in a payload all count as placeholder. Being wrong in that direction costs an unnecessary refusal. Being wrong in the other direction ships a fake grower.

### Layer 3: on the page, a banner and a marked slot

`render-contract/placeholder.css` carries the styling and the rules the page must follow. The three that are not negotiable:

1. **A page built from any record with `placeholderContent` true renders a banner.** Sticky, undismissable, not behind a flag, and inside the inlined critical CSS so it paints with the first text rather than after it. A banner that paints late is a banner a screenshot can miss.
2. **A null placeholder renders its slot with a pending marker rather than collapsing it.** A collapsed slot makes the layout smaller than the real page, which makes the measurement a lie: the above the fold requirement in the Acceptance criteria document, section 6.3, would have to be re-tested the day real content arrived.
3. **A control that cannot work yet is disabled and labelled, never hidden and never pointed somewhere plausible.** The reorder button with no Shopify cart permalink is the live example.

---

## 3. Why the API response carries the sentinel and not the flag

The M1 API contract is frozen. Several of its response schemas are `additionalProperties: false`, `Recipe` among them, so adding a `_placeholder` field to a response body would put the API in breach of its own contract on the first contract test.

That constraint turns out to point the right way:

- **Across the wire, the marker is the sentinel inside the value.** It is contract legal, it needs no schema change, and it is visible in exactly the place a human or a page will read it.
- **On the item, the flag is an attribute.** The data layer is ours to shape; the wire format is frozen.
- **A response header is available if the API build wants one**, for example `X-Content-Placeholder: true`, since headers are not constrained by the schema. That is a recommendation to whoever owns the API build, not a decision made here.

---

## 4. What is never invented, and why each one

| Field | Held as | Why not a plausible value |
|---|---|---|
| `farm.latitude`, `farm.longitude`, on both blend and grower | `null` | **The single most dangerous placeholder in this data set.** A coordinate renders as a pin on a map. A pin reads as a fact. There is no visual difference between a real farm and one somebody typed. |
| `grower.name`, `grower.farmName` | Sentinel text | A name is a claim about a person who has not consented to appear on a product. |
| `grower.yearsFarming` | `null` | A number about a person we have not been told about. |
| `grower.country`, `grower.region` | `null` | Where the blend is from is a fact about the spice. Where the grower is is a fact about a person. The second does not follow from the first. |
| `freshness.harvestedOn`, `blendedOn`, `bestBefore` | `null` | Provenance and food safety claims. A best before date is the one field on this page a customer might act on. |
| `catalog.price` | `null` | A wrong price shown to a customer is worse than no price. The page is designed to degrade to no price rather than to a guess. |
| `shopify.sku`, `productId`, `variantId`, `cartPermalinkUrl` | `null` | An invented cart permalink points at a checkout that does not exist. |
| `originCountry` for The Silk Road | `null` | The client stated "Central Asia", which is not a country, and the contract field is a single ISO 3166-1 code. Picking one would be us deciding where a product comes from. See section 6. |
| Recipe `servings`, `prepMinutes`, `cookMinutes`, `difficulty` | `null` | A plausible looking recipe is a recipe somebody will cook. |

---

## 5. What is real in these fixtures

Everything in this list came from Trevean or is a structural fact of the system. It is marked `client_real` or `contractor_real` and it is used as given.

- The five blend names, the five slugs, the five tag codes, and the 250 unit encoding per code.
- The spice composition of each blend, recorded in `_clientFacts` on every blend fixture and also quoted inside the placeholder tagline so it is in front of whoever writes the real one.
- The origin as the client stated it: Isfahan, Iran. Trinidad and Tobago. Fez, Morocco. Central Asia. Kyoto, Japan. Each is recorded verbatim in `_clientFacts` and mapped into the contract fields **only as far as the client's own words go**. Nothing is narrowed, widened or looked up in an atlas.
- The launch tier: Persian Sunrise and Caribbean Sunset are `real`, the other three are `seeded`, per the Scope document, "The five blends".
- The freshness note, which is a statement about how the system works rather than about the spice: freshness is per blend and not per jar, because tag encoding is per SKU.
- Every structural link: `growerId`, `blendSlugs`, `sortOrder`, `recipeId`, and the redirect table mirror.

---

## 6. Three things this exercise surfaced that need a decision

**1. The Silk Road has no country.** The client's stated origin is "Central Asia". `originCountry` in the frozen API contract is one ISO 3166-1 alpha-2 code. Three options: name the country the spices actually come from, accept a null country and show the region alone, or change the contract to allow several origins. The third is a contract change and is not free. Held null until answered.

**2. The frozen data model has no home for media library records, and the answer is now settled.** Five tables are carried forward and none of them is a media table, yet the API has a media library with presigned uploads and derivative status. The seeding tool writes media records into `SpiceBlends` under a `MEDIA#{mediaId}` partition key namespace with sort key `v0`, which is consistent with how the catalog mirror lives there under `CATALOG#{slug}`. **This was written up as a proposal needing reconciling with whoever owns the API build. The API build implemented the same shape, so it is a decision rather than a proposal**, and it is listed there against a secondary index on `entityType` and `createdAt`. `--no-media` turns it off. **What is still outstanding is narrower than the original question and is listed in this package's README under known limitations:** neither this tool's `--create-tables` nor the infrastructure as code creates that index, and media status is written here as `status` where the API reads `mediaStatus`.

**3. Where the spice composition lives.** It is real, client-supplied, and there is no field for it in the frozen contract. It currently sits in `_clientFacts` on the fixture and inside the placeholder tagline. If the page is meant to display the composition as structured data, that is a contract addition and it should be raised now rather than during M3.

---

## 7. How the convention ends

When real content lands for a field, three things change together and none of them is optional:

1. The value replaces the placeholder, sentinel and all.
2. The field state in `_placeholder.fields` changes to `client_real`.
3. `node tools/content-readiness.mjs` is re-run, and the count for that blend drops.

When every field for a blend is real, `placeholderContent` becomes false, the banner stops rendering, and the seeding tool stops refusing production for that data set. **There is no separate switch to remember, and no flag to flip in an environment file, because a convention with a manual off switch is a convention that gets switched off on the wrong day.**

`node tools/content-readiness.mjs --fail-on-placeholder` is the CI form. It exits 1 while anything is outstanding, and it is the check that should gate a production deploy.
