# History of this repository

This repository has two histories, joined by one merge commit.

1. **Trevean's prototype.** The files uploaded in June 2026 (src/, tests/, scripts/, config/ and the documents beside them) and the chip specification updates of 12 November 2026. This history is unchanged, with its original authors and dates.
2. **The build.** Every package under build/, the tools/ folder, the CI workflows in .github/workflows and the frozen API contract in deliverables/m1. The Tag Tool (build/chip-cli) brings its own commits from this repository's fleet/tag-tool branch, where it lived in tag-tool/build/chip-cli.

## Why the build's history starts on 13 October 2026

The development history before 13 October 2026 held a credential, so it is not published here. Serene Labs keeps that earlier history privately, and it is cleaned before it is shared with anyone.

## What was cleaned in the history that is here

This repository is public, so before the build's history was added:

- AWS identifiers (account, Organization, account mailboxes, resource name suffix and CloudFront names) were replaced in every file and commit message with placeholders such as `<TREVEAN_DEV_ACCOUNT_ID>`. The real values are in Trevean's private record.
- A personal email address was replaced with `<TREVEAN_OWNER_EMAIL>`.
- The one-shot deploy records in build/infrastructure/deploy-items and the real Terraform variable and backend files were left out. Only the README note in that folder is public.
- Commits that touched only those private files were dropped. Every other commit keeps its author and dates.

`node tools/check-public-safe.mjs` checks the current files for these kinds of value, and CI runs it on every pull request. It reports the file, line and kind, never the value.
