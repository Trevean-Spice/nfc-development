# Trevean Spice: NFC tap-to-story

Each Trevean Spice jar carries an NFC tag and a QR code. A tap or a scan opens that blend's page: its story, grower, recipes and a reorder link to the Shopify store. Every tap and scan is counted for the analytics dashboard, and Trevean's team edits the blend content in an admin CMS.

This repository holds the code that does this, built by Serene Labs for Trevean Spice in 2026, and Trevean's earlier prototype.

## What is in this repository

**The build, under build/.** Each package has its own README with the detail.

| Package | What it is |
|---|---|
| [build/edge](build/edge/README.md) | The `/t/{code}` and `/q/{code}` redirect, as a CloudFront Function. Holds `redirect-table.json`, the one file that says which code opens which blend. |
| [build/vercel-redirect](build/vercel-redirect/README.md) | The same redirect for Trevean's Vercel website, generated from the same table. |
| [build/web](build/web/README.md) | The consumer blend pages, built as static HTML. |
| [build/api](build/api/README.md) | The REST API: blend content, scan events and the admin routes. Runs on AWS Lambda with DynamoDB. |
| [build/admin](build/admin/README.md) | The admin CMS: blend, recipe and grower editors, roles, preview and publish. |
| [build/publisher](build/publisher/README.md) | The publish pipeline: rebuilds exactly the pages a change affects and puts them live. |
| [build/dashboard](build/dashboard/README.md) | The scan analytics dashboard. |
| [build/shopify](build/shopify/README.md) | The Shopify integration: reorder cart links, catalog sync and the order webhook. |
| [build/content](build/content/README.md) | Content fixtures, the placeholder convention and the database seeder. |
| [build/contract-tests](build/contract-tests/README.md) | Tests that check the API against its contract. |
| [build/chip-cli](build/chip-cli/README.md) | The Tag Tool and the tag programming command line, for the ST25TV02KC tags. |
| [build/infrastructure](build/infrastructure/README.md) | Terraform for everything on AWS. |
| [build/consolidation](build/consolidation/README.md) | Twelve planned pull requests against the old prototype. Never opened, and superseded by this import. Kept for the record. |

**Beside the build:**

- `deliverables/m1/01-api-contract.openapi.yaml`: the frozen API contract (OpenAPI 3.1, version 1.0.0). The api, shopify, contract-tests and admin packages read it.
- `tools/`: repository checks. `check-public-safe.mjs` is the one CI runs (see "Public repository" below).
- `.github/workflows/`: CI. See [docs/GUIDE.md](docs/GUIDE.md), section 7.
- `Start Tag Tool.cmd` (Windows) and `start-tag-tool.command` (Mac): double-click launchers for the Tag Tool.

**Trevean's prototype.** `src/`, `tests/`, `scripts/`, `config/`, the root `package.json`, `jest.config.ts`, `tsconfig.json` and `docs/DIRECTORY-GUIDE.md` are the prototype uploaded in June 2026 (GraphQL, Redis, a React Native app, NTAG chips). They are kept exactly as they were. None of it is part of what was built or deployed, and CI does not run it.

## Documents

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the pieces fit together, from a tap to a counted scan, and from an edit in the CMS to a live page.
- [docs/GUIDE.md](docs/GUIDE.md): how to install, test and run each package, change the redirect table, use the Tag Tool, and work with the Terraform.
- [docs/NFC-SPECS.md](docs/NFC-SPECS.md): the ST25TV02KC chip, the NDEF message and what the Tag Tool writes. The chip has 320 bytes in 80 blocks of 4, and 312 of them are usable for the message.
- [HISTORY.md](HISTORY.md): why this repository's build history starts on 13 October 2026.

## Quick start

You need Node.js 20 (20.11 or newer). Every package installs and tests on its own:

```sh
cd build/api
npm ci
npm test
```

No AWS account, credentials or network access is needed for any test suite. The exact commands per package are in [docs/GUIDE.md](docs/GUIDE.md), section 2.

To encode tags, double-click `Start Tag Tool.cmd` (Windows) or `start-tag-tool.command` (Mac). See [docs/GUIDE.md](docs/GUIDE.md), section 6.

## Public repository

This repository is public. Values that identify Trevean's AWS accounts and resources appear as placeholders such as `<TREVEAN_DEV_ACCOUNT_ID>`. The real values, the one-shot deploy records and the real Terraform variable files are in Trevean's private record, not here. Before committing, run:

```sh
node tools/check-public-safe.mjs
```

It reports the file, line and kind of anything that looks like an AWS identifier, never the value. CI runs it on every pull request.

## Licence

The prototype is under the MIT licence in [LICENSE](LICENSE). Each package under build/ states its licence in its `package.json`. Packages that ship third-party code list those licences with `npm run licences` (`npm run licenses` in build/web).
