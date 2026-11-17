# Architecture

How the Trevean Spice tap-to-story system fits together. Each package's README has the detail behind each section here. Values that identify AWS accounts and resources are placeholders; the real ones are in Trevean's private record.

## 1. The whole system on one page

```text
 Jar: NFC tag  https://treveanspice.com/t/<code>
      QR code  https://treveanspice.com/q/<code>
        |
        v
 Route 53 (the domain's DNS since 4 November 2026)
        |
        v
 CloudFront, the apex distribution (build/infrastructure, module cdn)
   /t/* and /q/*   -> CloudFront Function (build/edge): 307 to /blend.html?blend=<slug>&via=nfc|qr
   /v1/scan-events -> scan ingest Lambda (build/api) -> DynamoDB ScanEvents
   /v1/*           -> content API Lambda (build/api)
   /admin*         -> admin CMS and admin API (build/admin, build/api), Cognito sign-in
   everything else -> Trevean's website on Vercel (the default origin)

 ScanEvents stream -> rollup consumer Lambda -> ROLLUP# counters -> dashboard (build/dashboard)

 Admin CMS "publish" -> API -> publisher (build/publisher, Fargate)
                     -> builds the blend pages (build/web) -> S3, then invalidates exactly those paths

 Shopify: cart links in the blend pages; catalog sync and order webhook (build/shopify, build/api)
```

## 2. A tap, step by step

1. **The tag.** Each tag holds one NDEF URI record: `https://treveanspice.com/t/<code>`, where the code is two letters, one per blend (`ps`, `cs`, `sr`, `nm`; `kg` is reserved). The QR code on the label carries `https://treveanspice.com/q/<code>`. The 1,000 tags of the first production order were encoded this way by the supplier and are write protected, so these URLs must keep working for the life of those jars. The chip and the bytes are in [NFC-SPECS.md](NFC-SPECS.md).
2. **The redirect.** CloudFront sends `/t/*` and `/q/*` to a CloudFront Function compiled from `build/edge/redirect-table.json`. It answers `307` with `Location: /blend.html?blend=<slug>&via=nfc` (or `via=qr`) and `Cache-Control: no-store`. An unknown code gets a branded 404. The paths are case sensitive, so an uppercase path such as `/T/PS/` does not match and falls through to Vercel.
3. **The Vercel fallback.** Trevean's Vercel website carries the same redirects, generated from the same table by `build/vercel-redirect`. It served every tag on its own before the nameserver change, and it still answers the uppercase paths. Both copies come from one file, so changing a code means editing that file and rebuilding both (see [GUIDE.md](GUIDE.md), section 4).
4. **The blend page.** Since 12 November 2026, `/blend.html` is served by Trevean's website on Vercel, from the Trevean-Spice/website repository. `build/web` builds the AWS version of the same pages, one static HTML file per blend, which the publisher puts in S3.
5. **The scan count.** After the page has painted, a small beacon posts one scan event to `/v1/scan-events` on the same domain. It cannot delay or break the page. The scan ingest function writes it to the `ScanEvents` table with one conditional write. Repeat scans of the same blend from the same browser in one 30-minute window count once. There is no per-jar identifier: the tags were encoded per blend, so counts are per blend, and the browser's own token is what removes repeats. A stream consumer adds each new event to hourly and daily `ROLLUP#` counters, and the dashboard reads only those counters.

## 3. Editing and publishing content

1. An editor signs in to the admin CMS (`build/admin`) with Cognito. Roles are Admin, Editor and Viewer.
2. Blends, recipes and growers are edited and previewed there and saved through the API (`build/api`) to DynamoDB.
3. **Publish** calls `POST /v1/admin/blends/{slug}/publish`. The API sends a signed request to the publisher (`build/publisher`), a single Fargate task.
4. The publisher builds the blend pages with `build/web`, compares each file with what is live by SHA-256, uploads only the files that changed, invalidates exactly those paths in CloudFront, and reads each page back. The CMS shows whether it worked.

`build/content` holds the fixtures, the placeholder convention (content that is not final is marked, and a release build refuses it) and the database seeder.

## 4. Reorder and Shopify

`build/shopify` builds cart permalinks for each blend, so a reorder link opens the Shopify cart with the right product. It also has a catalog sync and an order webhook (the webhook routes are in `build/api`, under `/internal/webhooks/shopify/`). The catalog sync and order webhook are deployed but inert until they are switched on.

## 5. The API and its contract

`build/api` implements the frozen API contract in `deliverables/m1/01-api-contract.openapi.yaml` (OpenAPI 3.1, version 1.0.0). It validates every request against that document. `build/api` and `build/shopify` carry byte-identical copies of it, and their tests fail if a copy drifts. `build/contract-tests` runs the contract's operations against an in-memory stub in CI, and against staging or production only when started by hand with tokens.

## 6. Data

DynamoDB tables, defined in `build/infrastructure/modules/data`:

| Table | Holds |
|---|---|
| SpiceBlends | Blend content, plus media and Shopify catalog records |
| ScanEvents | One item per scan event, and the hourly and daily rollup counters |
| Recipes | Recipes, by blend |
| Growers | Growers |
| NFCTags | One item per blend code, seeded from the redirect table |

S3 holds the built site, media originals and derivatives, and the render cache. Secrets (such as the publisher's revalidation secret) are in AWS Secrets Manager, never in this repository.

## 7. Infrastructure

Everything on AWS is Terraform, in `build/infrastructure`:

- **Modules:** `cdn` (the apex distribution and its functions), `compute` (the Lambda functions, Cognito and the admin API Gateway), `data` (the tables), `media`, `render_cache`, `publisher` (Fargate, its load balancer and image registry), `secrets`, `observability`, `certificate`, `dns` (the Route 53 zone) and `stack`, which composes them.
- **Environments:** `envs/dev`, `envs/staging` and `envs/prod`. `dev` is the environment that has been applied, in Trevean's development account, and it serves the domain. `staging` and `prod` are defined but have never been planned or applied.
- **State:** an S3 bucket with native locking. The real variable and backend files for each environment are in Trevean's private record, so a plan or apply needs them (see `build/infrastructure/BOOTSTRAP.md`).
- **Lambda runtime:** Node.js 22 on arm64, set in the `compute` module. CI and local tests run on Node 20.

## 8. Programming tags

`build/chip-cli` encodes, verifies and (on the command line only) write-protects ST25TV02KC tags through a PC/SC reader such as the ACS ACR1552U. Its Tag Tool is a page on 127.0.0.1 for whoever encodes tags at the bench: it writes and reads back, and never protects. It reads the code list from the same `build/edge/redirect-table.json`, so a tag can only carry a code the redirect knows. See [GUIDE.md](GUIDE.md), section 6, and [NFC-SPECS.md](NFC-SPECS.md).

From Dan's 12 November edit, in his wording, all true of the Tag Tool:

- **Chip type:** ST25TV02KC; NFC Forum Type 5 / ISO/IEC 15693, 13.56 MHz.
- **Storage:** NFC Forum Type 5 NDEF URI record within the ST25TV02KC's 2.5-Kbit (320-byte) EEPROM; account for Capability Container (CC), TLV overhead, and reserved/configuration memory. Data is written in 4-byte ISO 15693 blocks.
- **Before writing**, the tool confirms ST25TV02KC chip type and NFC-V / ISO 15693 compatibility: it asks the tag for its size and refuses one that does not report 80 blocks of 4 bytes.
- **Capacity:** it checks ST25TV02KC available NDEF capacity (320-byte EEPROM, 4-byte ISO 15693 blocks, CC/TLV overhead). The encoded NDEF URI record and Type 5 TLV must fit within the tag's writable NDEF area (not a fixed URL character limit), and the payload must fit in the ST25TV02KC's 320-byte EEPROM after Type 5 CC, TLV, and other reserved-memory overhead. That area is 312 bytes, blocks 1 to 78.
- **Size:** minimize NDEF URI size using the NFC Forum URI prefix code (for example, 0x04 for https://) and short canonical URLs; validate the full Type 5 CC/TLV footprint against ST25TV02KC memory. Each tag uses 29 of the 312 bytes.

## 9. CI

`.github/workflows/ci.yml` runs on every pull request: each package's install, typecheck and tests on Node 20, `terraform fmt` and `validate` with no backend and no credentials, and the public-safety scan. `edge-and-chip-cli.yml` adds the redirect table's repoint guard when those packages change. `contract-tests.yml` runs the stub suite, and its live jobs run only by hand. `record-integrity.yml` belongs to Serene Labs' own records and is skipped in this repository. Details in [GUIDE.md](GUIDE.md), section 7.

## 10. The prototype

`src/`, `tests/`, `scripts/` and `config/` are Trevean's prototype from June 2026: a GraphQL API with Redis, a Next.js dashboard, a React Native app and an NTAG chip programmer. The build above replaced it rather than extending it, and none of it is deployed. This file described that prototype until it was rewritten for the import. Dan's ST25TV02KC update of 12 November 2026 is kept in section 8 and in section 11 below. The full earlier text is in this file's history (commit c1d7b38).

## 11. Notes from Dan's 12 November edit

Dan's edit of 12 November 2026 changed the chip from NTAG216/NTAG213 to the ST25TV02KC and added a blank line after every heading. The blank lines are kept throughout this file, and the chip lines that match the build are in section 8. These are the lines that differ from what was built:

- **"Input: Blend ID, chip type (ST25TV02KC; NFC Forum Type 5 / ISO/IEC 15693, 13.56 MHz)."** The chip type is as built (section 8). The input is a two-letter blend code from `build/edge/redirect-table.json`, not a blend ID, and the tag carries `https://treveanspice.com/t/<code>`, not a `/blend/{blendId}` URL.
- **"Validate against the actual formatted tag capacity."** The build checks that the tag reports 80 blocks of 4 bytes, then checks the message against a fixed 312-byte area. It does not read the capacity from the tag's capability container.
- **"Decodes NFC Forum URI identifier code (prefix byte) from the Type 5 NDEF URI record"** (the app's step in the scan flow). There is no Trevean app in the build: the phone's own NFC reader decodes the record and opens the URL. The Tag Tool decodes the same prefix byte when it reads a tag back.
