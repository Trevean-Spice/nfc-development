# Third-party manifest, content fixtures and seeding

**For the background IP obligation in the Scope document, "IP and handoff":** any pre-existing library or framework we reuse must be listed explicitly and licensed to Trevean Spice to run and maintain the product indefinitely. This list is kept from day one rather than reconstructed at handoff.

**Status: 17 August 2026.**

---

## 1. Runtime and build dependencies

**None.**

| | |
|---|---|
| npm dependencies | **Zero.** `package.json` declares an empty `dependencies` and an empty `devDependencies`. |
| Vendored code | **None.** No copied snippet, no bundled library, no minified file. |
| Network access at build or run time | **None.** Every tool runs offline. |
| Node modules used | `node:fs`, `node:path`, `node:url`, `node:crypto`, `node:zlib`, `node:http`, `node:readline`, `node:child_process`, and the global `fetch`. All part of Node.js itself. |

This is a deliberate choice rather than an accident of a small deliverable. The seeding tool has to run on a laptop with no AWS access, no npm install and no network, on the day somebody needs it. It signs its own SigV4 requests and speaks the DynamoDB wire protocol directly, which is about 120 lines, and in exchange this deliverable adds nothing at all to the list Trevean has to maintain.

**Node.js itself** is MIT licensed and is not redistributed by us. The minimum is 20.11.

---

## 2. Serene Labs background IP used in this deliverable

**None.** Every file in this directory was written for this engagement and is work-for-hire owned by Trevean Spice on full payment. No Serene Labs library, template, generator or proprietary tool is used, embedded or required to run it.

---

## 3. The generated imagery

**This is the part of the deliverable most likely to carry a licence problem, and it does not.**

| | |
|---|---|
| Files | 28 PNG files in `media/placeholder/`, listed with a sha256 for each in `media/manifest.json`. |
| Origin | Generated procedurally by `tools/generate-placeholder-images.mjs` in this repository, from rectangles, diagonal stripes, a 5 by 7 bitmap alphabet defined inline in `tools/lib/png.mjs`, and seeded pseudo-random noise. |
| Third-party content | **None.** No stock photograph, no clip art, no icon set, no downloaded texture, no scraped image, no AI generated image, and no third-party font. |
| The lettering | The 5 by 7 alphabet in `tools/lib/png.mjs` was drawn character by character for this deliverable as an array of strings. It is not a licensed typeface, it is not derived from one, and it is not embedded font data. Bitmap letterforms of this kind are not a work anyone holds rights in, and in any case these were drawn here. |
| PNG encoding | Written against the PNG specification (W3C, ISO/IEC 15948) using `node:zlib`. The specification is a public standard and carries no licence obligation on an implementation. No PNG library is used. |
| Rights handed over | Full. These files are work-for-hire owned by Trevean Spice on full payment, and they can be used, modified, replaced or deleted freely. The generator is delivered with them, so they can be regenerated or re-styled without us. |

Every file also carries the same statement inside it, in PNG `tEXt` metadata chunks: what it is, who generated it, that it is not a photograph, and the licence. That survives the file being copied out of this repository, which a manifest does not.

**These are placeholders and they are meant to be deleted.** They exist so the page can be built and measured at the real weight before real photography lands. Nothing in the product should still be pointing at them at launch, and the content readiness report is what makes that visible.

---

## 4. Standards and specifications referenced

| Standard | Used for | Obligation |
|---|---|---|
| PNG, W3C and ISO/IEC 15948 | Writing the placeholder images | None. Implementing a public specification creates no licence obligation. |
| AWS Signature Version 4 | Signing DynamoDB requests | None. A published protocol specification. |
| DynamoDB API version 2012-08-10 | The wire protocol the seeder speaks | None. Amazon's published API. |
| RFC 3339 | Timestamps | None. |
| ISO 3166-1 alpha-2 | Country codes | The code list is used, not redistributed. No obligation. |
| ISO 4217 | Currency codes | Same. |
| Crockford base32 | The alphabet the ULID-shaped identifiers use | Public domain specification. |

---

## 5. What the seeded data contains

Recorded here because a handover manifest that only lists code misses the thing most likely to matter later.

- **No customer data, no personal data and no PII of any kind.** There are no customer accounts in this product.
- **No real person is named anywhere in these fixtures.** Every grower record is an explicitly marked placeholder shell.
- **No coordinates, dates, prices or provenance claims are invented.** Those fields are held null. See the placeholder convention, section 4.
- **No secrets.** No credential, key, token or password appears in any file here. The seeding tool reads AWS credentials from the environment and stores none.

---

## 6. Standing obligation

Every dependency added anywhere in the application repository belongs on the licence list, not only the ones in this directory. If a future change to this deliverable adds an npm package, three things happen at once: the package goes in section 1 with its licence and copyright holder, any non-permissive licence gets its own explanation the way `axe-core` has one in the performance budget CI manifest, and the "zero dependencies" claim in the README comes out.
