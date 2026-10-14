# Manifest: providers, modules and licences

**Prepared for the background IP obligation, SOW section 7, and risk R13.**
**Monday 17 August 2026.**

Section 7 requires background IP to be listed explicitly and licensed
perpetually to Trevean. Risk R13 tracks the same obligation from the other
direction: the previous contractor may have left proprietary libraries in the
repository, and anything of theirs is Dan's exposure rather than ours.

This manifest covers **this directory only**. It does not cover the
application repository, which we have not seen. A manifest for that is part of
the scaffold audit.

---

## 1. The short version

**Nothing in this directory is proprietary to Serene Labs, and nothing here is
proprietary to any third party except the Terraform binary itself, which is
BUSL-1.1.** Every module is written for this engagement and is a work-for-hire
deliverable Trevean owns outright. There are three external dependencies, all
of them tools rather than code that ships.

One item needs a decision rather than a note: **item 1 below.**

---

## 2. Tooling

| # | Component | Version | Licence | Ships in the deliverable | Notes |
|---|---|---|---|---|---|
| **1** | **Terraform CLI** (HashiCorp) | 1.15.2 used here, `>= 1.10.0` required | **BUSL-1.1** | No. A build and deploy tool. | **See section 3. This is the only licence item on this engagement that needs a decision rather than a note.** |
| 2 | Terraform AWS provider (`hashicorp/aws`) | `~> 5.70`, resolved to 5.100.0 | MPL-2.0 | No. Downloaded at `terraform init`. | Permissive. No obligation beyond retaining the notice, which the download does automatically. |
| 3 | Terraform archive provider (`hashicorp/archive`) | `~> 2.4`, resolved to 2.8.0 | MPL-2.0 | No. Downloaded at `terraform init`. | Used for one thing: zipping the placeholder Lambda package. |

**No third-party Terraform Registry modules are used.** That was a deliberate
choice made partly for this manifest: community modules are convenient and each
one adds an upstream, a licence and a maintenance dependency that would have to
appear on this list and be tracked forever. This manifest has three rows
instead of forty.

`.terraform.lock.hcl` in each environment directory pins exact provider
versions and their checksums. It is committed. That is what makes "the same
versions, six months from now, on somebody else's laptop" a fact rather than a
hope.

---

## 3. The Terraform licence, stated plainly

**Terraform moved from MPL-2.0 to BUSL-1.1 at version 1.6, in August 2023.**
Version 1.5.x and earlier remain MPL-2.0.

**What BUSL-1.1 permits, which is everything this engagement does:** internal
use, modification, production deployment, and use by any third party Trevean
engages to modify these deliverables.

**What it prohibits:** offering Terraform itself, or a derivative of it, as a
commercial service competing with HashiCorp. Nothing on this engagement comes
near that, and nothing a spice company would plausibly do with its own
infrastructure comes near it either.

**Why it is raised anyway:** it is a licence change on a tool being handed over
under an IP clause. Raising it now costs a paragraph. Having Trevean's counsel
find it in December costs a conversation nobody has prepared for.

**If Trevean's counsel objects to BUSL on principle, the answer is OpenTofu.**
OpenTofu is an MPL-2.0 fork of Terraform under Linux Foundation governance, and
it is drop-in compatible with this configuration: the migration is changing the
binary name in the commands in `README.md`. That option is available because
this configuration uses no Terraform Cloud features, no BUSL-only
functionality, and no proprietary providers. It has been kept available on
purpose.

**Recommendation:** stay on Terraform. Note the licence, and record OpenTofu as
the available alternative. **This is Dan's call, not ours,** and it costs
nothing to make it now and quite a lot to make it later.

---

## 4. Modules in this directory

Every one of these is original work produced under this engagement. All are
work for hire, all vest in Trevean, and none carry a third-party licence.

| Module | What it stands up |
|---|---|
| `modules/stack` | Composes the whole environment. The three environment directories are thin wrappers over this. |
| `modules/cdn` | The apex distribution: three cache behaviour classes, two origins, the cache policy whose key is path plus `blend` only, the AWS origin bucket, access logs, and the wiring for the `/t/*` function. |
| `modules/certificate` | The ACM certificate in us-east-1. Depends on nothing, so it can be validated at the current DNS provider before the hosted zone exists. |
| `modules/dns` | The Route 53 hosted zone created as an exact copy of the existing zone, the apex and www ALIAS records, and the post-delegation certificate validation. |
| `modules/data` | The five DynamoDB tables, their indexes, and the ScanEvents stream. |
| `modules/render_cache` | The externalised render cache: shared object storage plus a shared index. |
| `modules/media` | Presigned-upload originals bucket, derivatives bucket, derivative queue and dead letter queue, and the media distribution. |
| `modules/compute` | Eight execution roles, eight least-privilege policies, the log groups, the functions, and the two event source mappings including the INSERT-only `EVT#`-prefix stream filter. Seven of the eight roles are Lambda; the renderer's is assumed by the container in `modules/publisher` instead. |
| `modules/publisher` | **Added Friday 4 September 2026.** Where the render runs: a small always on Fargate service, its VPC, its load balancer, its own small distribution, and the image repository. It creates no software of its own. **The container image it runs carries third-party licences that this Terraform does not, and they are listed in `build/publisher/MANIFEST.md` under "The container image", including copyleft in the operating system layer.** |
| `modules/secrets` | The KMS key and the secret containers, including the tag password with its named holder and rotation path. |
| `modules/observability` | The alarms: cache hit ratio, error rates, function failures and throttles, DynamoDB throttling, stream iterator age, dead letter queue depth. |

---

## 5. Code in this directory that is not Terraform

| File | What it is | Licence |
|---|---|---|
| `modules/compute/placeholder/index.mjs` | An inert Lambda placeholder that answers 501 and logs. Not application code. Replaced by the application's own pipeline. | Original, work for hire |
| `scripts/verify-no-dns.sh` | The pre-flip verification. Shell, `curl` and `dig` only. | Original, work for hire |
| `scripts/zone-diff.sh` | Record-by-record zone comparison. Shell and `dig` only. | Original, work for hire |
| `modules/publisher` container image | Not in this directory. Built from `build/publisher/Dockerfile` and pushed by `build/publisher/scripts/push-image.sh`. **Not original work throughout: it is a Debian based Node image with third-party contents.** | See `build/publisher/MANIFEST.md`, "The container image" |

Both scripts use only POSIX shell plus `curl` and `dig`, which are present on
any Linux or macOS machine and available on Windows through Git Bash. No
runtime, no package manager, nothing to install, nothing to license.

---

## 6. What is deliberately NOT here

Recorded so their absence reads as a decision rather than an omission.

| Not used | Why |
|---|---|
| Third-party Terraform Registry modules | Each one is an upstream, a licence and a maintenance dependency on this list forever. |
| Terragrunt | Solves multi-environment DRY, which three thin root modules over one shared module already solves, and adds a second tool a future maintainer has to know. |
| Terraform Cloud or HCP Terraform | A subscription Trevean would inherit. State in S3 in Trevean's own account has no vendor relationship at all. |
| Any linting or policy-as-code tool (`tflint`, `checkov`, `tfsec`) | Worth adding in CI. Not added here because CI does not exist yet and a tool nobody runs is background IP with no benefit. Recommended as a handover item. |
| A Lambda layer with shared code | Application concern, and layers are a versioning trap at handover. |

---

## 7. The other direction: risk R13

**This manifest lists what we brought. It says nothing about what is already in
the `nfc-development` repository**, which we have not seen.

Risk R13 requires a running list of anything the previous contractor may have
left that is proprietary to them, since section 7 requires explicit listing and
perpetual licensing to Trevean, and anything of theirs is Dan's exposure. That
list is produced by the scaffold audit, is empty today because the audit has
not run, and belongs alongside this file when it is not.

**Nothing in this document states anything about the existing scaffold or the
existing AWS account as a finding.**
