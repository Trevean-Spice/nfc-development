# Third party manifest

**Package:** `@trevean/analytics-dashboard`, the scan analytics dashboard.
**Purpose:** the explicit list the Scope document, "IP and handoff", requires. Every
pre-existing library reused here, with its licence, kept from day one rather than
reconstructed at handoff.

## The short version

**This package has zero dependencies and zero development dependencies.** Nothing third
party is bundled, vendored, downloaded at build time, or loaded by the browser. There is
no build step, so there is nothing to audit between the source and what runs.

```
"dependencies": {}
"devDependencies": {}
```

A test asserts both are empty, so this file cannot quietly go out of date.

## What that means for the background IP obligation

The obligation in the Scope document is to list every pre-existing library reused, and to
licence it to Trevean to run and maintain the product indefinitely. **The cheapest way to
discharge an obligation about third party licences is not to acquire any.** For a page of
this size that was affordable, so it was taken.

Concretely, and each of these is a decision rather than an omission:

| Thing a dashboard usually depends on | What is used here instead |
|---|---|
| A charting library | Hand written SVG in `public/lib/charts.js`. About 200 lines. Stacked columns, a split bar, a row bar and a legend, which is every mark this page needs. |
| A front end framework | Plain ES modules and `innerHTML` against pure render functions. The page is an internal tool with one screen and no routing. |
| A date library | `Date` with UTC methods, in `public/lib/format.js`. Every rollup key is a UTC date string, so the arithmetic is date string arithmetic. |
| A CSV writer | Fourteen lines in `public/lib/csv.js`, including the quoting rule, with a test for the comma and quote cases. |
| A test framework | `node:test` and `node:assert`, built into Node 20. |
| A bundler and a transpiler | None. `public/` is served as written and runs as written. |
| A JWT library, for the local development token | `node:crypto`, in `tools/lib/devtoken.mjs`. Twenty lines for one HS256 signature, used only against a local stack. |
| An HTTP framework, for the local file server | `node:http`. It serves five files and proxies one path prefix. |

## What is borrowed rather than installed

Running the whole stack on a laptop needs a DynamoDB compatible server and a DynamoDB
client. **Both already exist in `build/api`, and this package borrows that installation
rather than adding a second copy to the tree.** `tools/lib/deps.mjs` resolves them from
`build/api/node_modules` and explains itself if they are not installed.

The packages borrowed at development time only, never in the browser and never in a
deployed artifact:

| Package | Used for | Licence | Where it is declared |
|---|---|---|---|
| `dynalite` | In process DynamoDB for `npm run local:up` and the live test | MIT | `build/api` devDependencies |
| `@aws-sdk/client-dynamodb` | Writing seeded rollup rows into that local database | Apache-2.0 | `build/api` dependencies |
| `@aws-sdk/lib-dynamodb` | The document client for the same | Apache-2.0 | `build/api` dependencies |
| `tsx` | Running the API's TypeScript entry point as a child process | MIT | `build/api` devDependencies |

They are listed here for completeness, and they are already listed with their full
transitive trees in `build/api/MANIFEST.md`, which is the authoritative record for that
package. **Nothing in this table is required to run the deployed dashboard.** The deployed
artifact is the contents of `public/`: five files, all first party.

## What is first party

Everything in `public/` and everything in `tools/`, written for this engagement, work for
hire owned by Trevean Spice on full payment per the Scope document, "IP and handoff".

| File | What it is |
|---|---|
| `public/index.html` | The one page |
| `public/styles.css` | The one stylesheet, including both colour modes |
| `public/app.js` | Browser wiring only: credential, controls, events |
| `public/lib/copy.js` | Every word the page says about what its numbers mean |
| `public/lib/api.js` | The only file that knows a URL |
| `public/lib/derive.js` | Totals and shares, as pure functions |
| `public/lib/charts.js` | SVG marks |
| `public/lib/render.js` | The page, as pure functions returning strings |
| `public/lib/format.js`, `csv.js`, `state.js` | Formatting, export, controls |
| `tools/` | Local stack, seeded rollups, recording proxy, static server |
| `test/` | The suite |

## Colour

The categorical steps in `public/styles.css` are validated for colour vision deficiency
separation and for contrast against both the light and the dark surface. Three series
slots are used, which is the set that clears every gate on all pairs in both modes. The
values are hex in a stylesheet rather than a dependency on a palette package.

## Fonts

The system font stack. No font is downloaded, self hosted or subset, because this is an
internal admin page rather than a consumer page and it has no brand typography
requirement. Nothing is fetched from a font host, here or anywhere else in the project.
