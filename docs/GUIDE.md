# Guide

How to install, test and run the packages in this repository, change the redirect table, use the Tag Tool and work with the Terraform. For how the pieces fit together, read [ARCHITECTURE.md](ARCHITECTURE.md) first. Each package's README has the full detail.

## 1. What you need

- **Node.js 20**, version 20.11 or newer, with npm. CI uses Node 20. Some test scripts depend on it: `node --test` with a folder argument finds no files on Node 21 and later.
- **Terraform 1.15.9** (1.10 or newer works) for `build/infrastructure` only.
- For the Tag Tool: a PC/SC NFC reader (the ACS ACR1552U is the one it was written for) and its driver.

No test suite needs an AWS account, credentials, Docker or network access. Installs need the npm registry.

## 2. Testing each package

Each package installs and tests on its own. From the repository root:

```sh
cd build/<package>
npm ci
```

Then run the same commands CI runs:

| Package | Typecheck | Tests |
|---|---|---|
| admin | `npm run typecheck` | `npm test` |
| api | `npm run typecheck` | `npm test` (uses an in-process DynamoDB, nothing to install) |
| chip-cli | `npm run typecheck` | `npm test` (builds first) |
| content | | `npm test` |
| contract-tests | `npm run typecheck` | `npm run test:stub` (`npm test` targets a running API) |
| dashboard | | `npm run test:unit` (`test:live` reads a running stack) |
| edge | | `npm run ci` (validates the table, checks `dist/` matches it, runs the suite) |
| publisher | | `npm test` |
| shopify | `npm run typecheck` | `npm test` |
| vercel-redirect | | `npm run ci`. Skip `npm ci`: it has no dependencies and, on purpose, no lockfile. |
| web | | `npm run build && npm run verify` |

`build/consolidation` and `build/infrastructure` have no npm tests. For the Terraform checks, see section 5.

## 3. Running the system locally

Everything below runs on your own machine, with no AWS:

1. **API with a local database:** in `build/api`, `npm run local:up`. It starts an in-process DynamoDB with the five tables, seeds them and serves the API on port 3001. Try `curl localhost:3001/v1/blends`.
2. **Admin CMS:** in `build/admin`, `npm run dev`, then open `http://127.0.0.1:3002`. The development accounts are listed on the sign-in screen. They are refused in production.
3. **Publisher:** `build/publisher/README.md`, section 3, "Running the whole thing with no AWS account", starts the publisher on port 3003 and a stand-in for CloudFront on port 3004, so a publish in the CMS goes all the way to a page you can open.
4. **Blend pages:** in `build/web`, `npm run build`, then `npm run serve` (port 3000). `npm run verify` checks every built page.
5. **Dashboard:** in `build/dashboard`, `npm run local:up` starts its own local database and API, seeds 90 days of scan counts and serves the dashboard at the address it prints. It borrows its dependencies from `build/api`, so run `npm ci` there first.

## 4. Changing where a code points

`build/edge/redirect-table.json` is the only place the code to blend mapping exists. The CloudFront Function, the Vercel redirects, the Tag Tool's code list and the database seed are all generated from it.

1. Edit `targetPath` and `qrTargetPath` for the code.
2. Set `"allowRepoint": true` and increase `version`. Without both, the build refuses a change to an existing code.
3. Run `npm run build` in **both** `build/edge` and `build/vercel-redirect`, and commit the regenerated `dist/` folders. Never edit `dist/` by hand: `npm run build:check` fails if it does not match the table.
4. Deploy both: the CloudFront Function through the Terraform, and the regenerated `dist/vercel.json` redirects to Trevean's Vercel website.

Keep the Vercel redirects in place. They answer the uppercase paths that CloudFront passes through, and they are the fallback for every jar already in a kitchen.

## 5. Infrastructure

The Terraform is in `build/infrastructure`. Read its README and `BOOTSTRAP.md` before changing anything.

**Checks anyone can run** (no state, no credentials):

```sh
cd build/infrastructure
terraform fmt -check -recursive
export TF_VAR_expected_account_id=000000000000   # a dummy: nothing here touches a real account
for env in dev staging prod; do
  terraform -chdir=envs/$env init -backend=false -input=false -lockfile=readonly
  terraform -chdir=envs/$env validate
done
```

**A plan or apply** needs the environment's real `terraform.tfvars`, `backend.hcl` and, for dev, `zone-copy.auto.tfvars`. They are in Trevean's private record, not in this repository, and git ignores them. Every apply checks that it is running in the expected AWS account before it changes anything. Changes to DNS, CloudFront or the tables go live for the jars in customers' hands, so review the plan line by line.

## 6. The Tag Tool

The Tag Tool writes a blend code to ST25TV02KC tags and checks each one. It is in `build/chip-cli`.

**Starting it.** Double-click `Start Tag Tool.cmd` (Windows) or `start-tag-tool.command` (Mac; the first time, right-click it and choose Open). The launcher checks for Node.js 20.11 or newer, installs the tool's packages the first time (this needs internet), builds it and opens the page. Close any other NFC program, such as GoToTags, first: only one program can use the reader.

**What it does.**

- Shows the reader and the tag on it, and the codes you can write: `ps`, `cs`, `sr` and `nm`. It refuses `kg` and any code not in the redirect table.
- Writes the chosen code, reads every block back and checks it before it says the tag is done.
- Can write the same code to each new tag automatically, with a desktop notification for each.
- Keeps a record of every tag in `runs/tag-tool/`.
- Runs on 127.0.0.1 only, on the first free port from 10350 to 10359.
- `node bin/tag-tool.mjs --simulator` (in `build/chip-cli`) opens the same page with no reader and no tags, for practice.

**What it never does.** It never protects or locks a tag. Protection is only on the command line, below.

**The command line.** In `build/chip-cli`, after `npm ci` and `npm run build`:

```text
node bin/chip-cli.mjs codes                 list the codes in the redirect table
node bin/chip-cli.mjs encode --code ps      show exactly what would be written (no tag needed)
node bin/chip-cli.mjs write --code ps       write, read back and verify one tag
node bin/chip-cli.mjs verify --expect ps    check one tag carries the right URL
node bin/chip-cli.mjs batch --code ps --count 125 --journal runs/ps.jsonl
node bin/chip-cli.mjs status --journal runs/ps.jsonl
node bin/chip-cli.mjs doctor                preflight checks
```

**Protection.** `--protect` on `write` or `batch` sets the tag's 64-bit area password after the tag has been written and verified. The password is read from an environment variable (`--password-env NAME`) or a file (`--password-file PATH`), never typed on the command line, and the tool refuses the factory default and any single repeated character. Keep the password in Trevean's own password store: without it a protected tag cannot be rewritten. Before it sends any password or protection command, the tool runs a probe on that tag that confirms the chip answers exactly as the datasheet says. If the probe fails, it stops and nothing is locked. That probe must not be weakened: a wrong command byte can lock a tag for good.

The full detail, including the safety checks and every error message, is in `build/chip-cli/README.md`. The chip itself is in [NFC-SPECS.md](NFC-SPECS.md).

## 7. CI

The workflows are in `.github/workflows`:

| Workflow | Runs on | What it does |
|---|---|---|
| `ci.yml` | every pull request, or by hand | Each package's install, typecheck and tests on Node 20 (the table in section 2); `terraform fmt` and `validate` for all three environments, with no backend and no credentials; the public-safety scan and its tests. |
| `edge-and-chip-cli.yml` | pull requests that change `build/edge` or `build/chip-cli`, or by hand | Both packages' full checks, plus the repoint guard: it compares the redirect table with the branch it merges into and fails if an existing code changed without `allowRepoint`. |
| `contract-tests.yml` | every pull request, or by hand | The contract suite against the in-memory stub. The staging and production jobs run only by hand, once the repository has the tokens they name; production is read only. |
| `record-integrity.yml` | | Checks Serene Labs' own project records. It runs only in Serene Labs' repository and is skipped here. |

No workflow needs a secret to pass on a pull request.

## 8. Before you commit

- Run the package's tests (section 2).
- Run `node tools/check-public-safe.mjs`. This repository is public. Use placeholders such as `<TREVEAN_DEV_ACCOUNT_ID>` for anything that identifies an AWS account or resource; the real values belong in Trevean's private record.
- Never commit a password, key, token, `.env` file or real Terraform variable file.

## 9. The prototype

`src/`, `tests/`, `scripts/` and `config/` are Trevean's prototype from June 2026. Nothing above uses them, and CI does not run them. This guide described how to set up and run that prototype until it was rewritten for the import. That text is in this file's history (commit c1d7b38).
