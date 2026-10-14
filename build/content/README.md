# Content fixtures, seeding and placeholder imagery

**M2 deliverable. Prepared by Serene Labs Inc for Trevean Spice. 17 August 2026.**

---

## What this is

The content layer for the tap-to-story build: fixture data for all five blends, the tooling that loads it into DynamoDB, the report that says exactly what content is still outstanding, and placeholder imagery that is the exact size and weight of the real photography.

**Real content for the two launch blends has not arrived.** It was due Friday 14 August 2026 and there is no record of it in this repository as of Monday 17 August 2026. Content writing, photography and translation are outside our scope per the Scope document, "Out of scope, deferred not dropped", so nothing here is written on Trevean's behalf. What is here instead is a data set where nothing false can pass for true. Read `PLACEHOLDER-CONVENTION.md` before changing anything in `fixtures/`.

---

## Run it

Node 20.11 or later. **No dependencies, no install step, no network, no AWS access required.**

```bash
node tools/content-readiness.mjs          # what content is still outstanding, field by field
node tools/selftest.mjs                   # proves the seeder is idempotent and the guards hold
node tools/generate-placeholder-images.mjs --check   # proves the imagery has not drifted
node tools/seed-dynamodb.mjs --env local --endpoint-url http://localhost:8000 --create-tables
node tools/validate-intake.mjs intake/TEMPLATE-blend.json
```

Same commands as npm scripts: `npm run readiness`, `npm test`, `npm run images:check`, `npm run seed:local`, `npm run validate`.

---

## Layout

```
spec/content-field-spec.json   every content field, its owner, format, length and whether it
                               blocks publish. The single source of truth. Three tools read it.
fixtures/blends/               five blends
fixtures/growers/              five grower shells
fixtures/recipes/              seven recipes for Persian Sunrise, six for Caribbean Sunset,
                               zero for the three seeded blends
fixtures/catalog/              five Shopify catalog mirror records
media/manifest.json            every placeholder asset with its real byte count and sha256
media/placeholder/             28 generated images, each exactly at its budget
render-contract/placeholder.css  how a placeholder must look on the page
intake/TEMPLATE-blend.json     what Trevean fills in
reports/                       the readiness report as run, and the seeding dry run
tools/                         five scripts, described below
```

| Tool | What it does |
|---|---|
| `content-readiness.mjs` | Reports which fields are still placeholder, per blend and per field, with the owner and whether it blocks publish. Text, markdown or JSON. `--fail-on-placeholder` is the CI form. |
| `seed-dynamodb.mjs` | Loads the fixtures into DynamoDB. Idempotent. Refuses placeholder content in production. |
| `generate-placeholder-images.mjs` | Generates the imagery at exact dimensions and exact byte weights. `--check` fails on drift. |
| `validate-intake.mjs` | Checks a content submission from Trevean before we accept it, so a delivery costs one round trip instead of three. |
| `selftest.mjs` | Runs the seeder twice against an in-memory stand-in for DynamoDB and asserts every guard. |

---

## The four decisions worth knowing

**1. Nothing that would be a claim about the world is invented.** No grower name, no farm coordinate, no harvest date, no price, no origin story. Those fields are held null or carry a sentinel. Everything real in these fixtures came from Trevean or is a structural fact of the system, and section 5 of the placeholder convention lists exactly which is which.

**2. The placeholder marker is in the value, not beside it.** Every placeholder string starts with `[PLACEHOLDER]` and contains `NOT REAL CONTENT`. It survives a copy and paste, an export, a screenshot and a page render, because it is the value rather than metadata about the value. The machine-readable flag lives on the DynamoDB item as `placeholderContent` and `contentReadiness`, and not in the API response body, because several response schemas in the frozen M1 contract are `additionalProperties: false` and adding a field would put the API in breach of its own contract.

**3. The placeholder imagery is at the budget, to the byte.** The hero is 1280 by 955 and exactly 92,160 bytes, which is the cap in the M1 performance budget. Every other slot likewise. A budget validated against a 5 KB grey rectangle proves nothing, and the moment real photography lands the page weight is unchanged because the weight was never the placeholder's. Entropy is added to each image until it encodes to the target size, then the file is padded to the exact byte with a comment chunk explaining what it is.

**4. The seeder refuses production and says why.** Not a warning. The refusal names the number of placeholder items, points at the readiness report, and explains that 1,000 encoded tags in the field mean production content reaches a customer holding a jar. The override exists, requires a written reason, and is recorded.

---

## Known limitations, stated rather than discovered

**The placeholder images are PNG, and production serves AVIF with a WebP fallback.** They are generated with the Node standard library and no native image codec, which is what makes them reproducible on any machine with no install step. The budget measures bytes on the wire and pixel dimensions, and both are exact. The one thing a PNG placeholder does not reproduce is AVIF decode cost, which is 50 ms of the 385 ms hero line in the performance budget model, and which gets measured for real the moment the first genuine photograph is processed.

**The `MEDIA#` key namespace is settled, not a proposal.** It was written up here as a proposal needing reconciliation with whoever owns the API build. **The API build has since implemented it, so the two agree and this text was the only thing still calling it open.** The frozen data model carries five tables forward and none of them is a media table, yet the API has a media library, so media records live in `SpiceBlends` under `MEDIA#{mediaId}` with sort key `v0`, consistent with how the catalog mirror lives there under `CATALOG#{slug}`. The API lists them from a secondary index on `entityType` and `createdAt`, named `entity-createdAt-index`, and this tool writes `entityType: "MEDIA"` and a `createdAt` on every media row so that index is populated. `--no-media` turns it off.

**Three things about that namespace do not yet agree, and they are named rather than left to be discovered.** They are gaps in provisioning and in one attribute name, not a disagreement about the key shape.

1. **This tool's `--create-tables` does not create `entity-createdAt-index`.** It declares only `status-updatedAt-index` on `SpiceBlends`. A store created here will serve every seeded row but will fail the API's media list query, because the index it queries does not exist.
2. **The infrastructure as code does not create it either.** `build/infrastructure` declares `status-updatedAt-index` and a conditional `slug-index` on `SpiceBlends` and no entity index, while the same configuration already scopes IAM to the `MEDIA#` prefix. The namespace is provisioned and the index that lists it is not.
3. **Media status is written here as `status` and read by the API as `mediaStatus`.** The API uses a separate attribute deliberately, so media rows never appear in the blend list index. Seeded media rows therefore land in `status-updatedAt-index` under `status: "ready"`, and an API write to `mediaStatus` would create a second field rather than update the seeded one.

**`NFCTags` is seeded from the redirect table and never authored here.** The tool reads `build/edge/redirect-table.json` by default and skips the table entirely if it is absent, rather than inventing rows. A wrong row here points 250 jars at the wrong page. **The path in this line previously read `deliverables/m1/build/edge/redirect-table.json`, which is where the edge package used to live.** The package is at `build/edge/`. The tool itself already resolves the sibling path first and keeps the old location only as a fallback, so this was a documentation error rather than a live miss, but it was the documentation of the one file that resolves 1,000 shipped tags.

**The three seeded blends carry placeholder heroes as well as the two launch blends, and this is the settled position rather than an open one.** The frozen API contract's `listBlends` example shows `heroImage: null` for the two published seeded blends. **The fixtures keep their placeholder heroes and the contract is not touched, and both are correct at once**, because `heroImage` is declared nullable in the schema, so null and a hero object are equally valid responses and an OpenAPI example is illustrative rather than normative. The reason the fixtures go the other way is not convenience. North African Night Market and The Silk Road each carry 250 encoded tags, so their pages are reachable from a real jar today: they have to render, and they have to be measured against the performance budget, where the hero is the largest single byte item on the page. A fixture set with no hero would produce a page that is neither what a customer reaches nor what the budget is written against. Kyoto Garden is held in draft because no tag in this production run carries `kg`, and it does not appear in that example at all, so there is no disagreement about it to reconcile.

---

## Boundaries

This directory owns content fixtures, the placeholder convention, seeding, readiness reporting and placeholder imagery. It does not write to `build/api/`, `build/web/`, `build/edge/`, `build/contract-tests/` or `build/infrastructure/`.

Three things here are inputs to other people's work and are worth flagging to them explicitly:

1. `render-contract/placeholder.css` and its three rules are a requirement on the web build, not a suggestion.
2. `media/manifest.json` is what the web build should read for dimensions, alt text and paths.
3. The `X-Content-Placeholder` response header is a request to the API build, not a decision made here. **The `MEDIA#` namespace is no longer in that category:** the API build implemented it, the key shape agrees, and what is left is the index and attribute reconciliation listed under known limitations above.

---

## Related documents

- The placeholder convention, in this directory.
- The content intake specification, in this directory. Client-facing.
- M1 deliverable, API contract, version 1.0.0. Frozen. Governs every wire shape here.
- M1 deliverable, data model, sections 3 and 7. Governs every key schema here.
- M1 deliverable, per-page byte and speed budget, section 4. Governs every image dimension and byte cap here.
- Scope document, "The five blends", "Tag code map" and "Out of scope, deferred not dropped".
- Acceptance criteria document, sections 6.2 and 6.3.
