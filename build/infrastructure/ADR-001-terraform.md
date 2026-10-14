# ADR 001: Terraform is the infrastructure as code tool

**Status:** proposed, Monday 17 August 2026
**Decides for:** everything under `build/infrastructure/`
**Depends on:** open question Q13 (Does the scaffold carry infrastructure as code, or was the environment hand-built in the previous contractor's console?), risk R12 (scaffold portability), risk R13 (background IP)
**Supersedes:** nothing
**Contains an explicit fork.** See section 5. If the audit finds the scaffold already carries AWS CDK, this decision is re-taken rather than defended.

---

## 1. The decision

**Terraform, with first-party modules only and no third-party registry modules.** Three environments, each a thin root module over one shared `stack` module. Remote state in S3 with native locking, staging and dev state in our account, production state in Trevean's.

---

## 2. The reason, which is a contract term and not a preference

The deliverables on this engagement are **work for hire**, and the IP clause gives Trevean the right to engage **any third party** to modify them. That is the whole argument. It means the question to ask about an infrastructure tool is not "which do we write fastest" but:

> Six months from now, when a developer neither of us has met opens this directory and has to change a cache behaviour, how long before they can do it safely?

Three properties follow from that question, in order.

**It has to be readable by someone who did not write it.** Terraform's HCL is declarative and flat: a resource block says what exists, and the arguments are the AWS API's own field names. A reader who knows AWS can read Terraform without knowing Terraform. That is not true of a general-purpose language generating templates, where understanding what gets deployed means understanding the program that computes it.

**It has to be hireable.** Terraform is the most widely known infrastructure as code tool. Trevean can put a job post out and get candidates who have used exactly this. The cost of a less common tool is not paid by us, it is paid by Trevean, later, in a smaller pool of people who can pick this up.

**It has to survive us leaving.** The engagement ends. What Trevean is left holding is a directory, a state file and a README. Terraform's state file is a documented JSON format and `terraform show` renders it as readable HCL, so even a total loss of tooling knowledge leaves a recoverable description of what is deployed. There is no proprietary format and no service to keep a subscription with.

A fourth reason that is specific to this project rather than general:

**The scaffold's IaC situation is unknown, and Terraform imports better than it generates.** Open question Q13 asks whether the scaffold carries infrastructure as code at all, or whether the previous contractor's environment was hand-built in a console. If it was hand-built, the work is to bring existing resources under management, and `terraform import` plus `import` blocks is the most mature path in the ecosystem for exactly that. We do not know the answer yet, so the tool that copes best with the worst answer is the right default.

---

## 3. What was considered and not chosen

**AWS CDK.** Genuinely good, and the fork in section 5 exists because it may already be here. Its cost against this project's specific constraints: the artifact a reviewer reads is a program, not a description, so reviewing an infrastructure change means reading TypeScript and reasoning about what it synthesises. It narrows the hiring pool from "knows infrastructure as code" to "knows CDK and TypeScript". And its constructs carry opinionated defaults that are helpful when they match your intent and invisible when they do not, which is the wrong property for a cache policy whose exact cache key is a named failure mode in a delivered document.

**CloudFormation by hand.** Rejected. YAML with no functions, and conditionals that are painful enough that people stop writing them and copy files instead. Three environments become three drifting files.

**Pulumi.** Same program-not-description objection as CDK, plus a smaller hiring pool.

**Serverless Framework or SAM.** Both are function-deployment tools that also do some infrastructure. This stack is mostly not functions: it is a distribution, a cache policy, a hosted zone, five tables and a certificate. Wrong shape.

**Console clicking.** Named only to be refused explicitly, because it is what may already have happened here. A hand-built environment cannot be recreated in Trevean's account, which is precisely what blocks M1 acceptance under check 12 in the data model's audit list.

---

## 4. Licensing, which matters here more than it usually does

Section 7 of the SOW requires background IP to be listed explicitly and licensed perpetually to Trevean. Two things follow and both are in `MANIFEST.md`.

**Terraform itself moved from MPL-2.0 to BUSL-1.1 at version 1.6.** BUSL permits internal use, modification and production deployment, and prohibits offering Terraform itself as a competing commercial service. Nothing this engagement does comes near that prohibition, and nothing Trevean would plausibly do with a spice company's infrastructure comes near it either. But it is a licence change on a tool being handed over under an IP clause, so it is stated rather than glossed.

**If Trevean's counsel objects to BUSL at all, the answer is OpenTofu.** It is an MPL-2.0 fork of Terraform, drop-in compatible with this configuration, and the migration is changing the binary name. That option exists because this configuration uses no Terraform Cloud features, no BUSL-only functionality, and no proprietary providers.

**No third-party registry modules are used.** Every module under `modules/` is written for this engagement and is therefore a deliverable Trevean owns outright, not background IP with its own licence and its own upstream. That costs some volume of code compared with pulling in community modules, and it buys a `MANIFEST.md` with four entries on it instead of forty, every one of which Trevean owns or is MPL-2.0.

---

## 5. The fork: what we do instead if the audit finds AWS CDK

Q13 resolves on 18 August. This section is written before the answer so that the answer does not get argued about after it lands.

### If the audit finds a working AWS CDK application that deploys the existing scaffold

**We adopt CDK and this Terraform becomes the specification rather than the implementation.** Concretely:

1. **We do not rewrite working infrastructure to change tools.** A tool migration on a live stack, in the week of a DNS deadline, for an aesthetic preference, would be indefensible. The DNS deadline and the M2 gate do not move for it.
2. **Everything in this directory is ported, decision for decision.** The value of this work was never the HCL. It was deciding that the cache key contains `blend` and nothing else, that the stream filter is INSERT-only with an `EVT#` prefix, that the scan beacon function can write one key prefix and hold no secret, that the certificate module depends on nothing so it can be validated at Squarespace, and that staging carries no domain. Every one of those ports to CDK unchanged, and the module comments here are written to be read as specification for exactly that reason.
3. **The three-environment shape ports as CDK stages.** Staging still has to be deployable without Trevean's account or domain, which is a property of the configuration values, not the tool.
4. **`MANIFEST.md` is rewritten** against CDK's dependency tree, which is materially larger: CDK pulls a full npm dependency graph, and the background IP listing under SOW section 7 gets correspondingly longer. That is a real cost of the fork and it is Dan's exposure, so it gets reported rather than absorbed.
5. **This ADR is superseded by an ADR 002 recording the reversal**, with the audit finding quoted in it. A decision reversed for a reason found in an audit is the system working, not a mistake.

### If the audit finds partial or broken CDK, or CDK that does not match what is actually deployed

**We keep Terraform and say so plainly, with the reason.** Partial infrastructure as code that does not describe the running system is worse than none, because it is trusted. In that case the deployed resources are imported into Terraform, the CDK application is recorded as dead and left in the repository untouched for reference, and the finding goes to Dan in writing the day it is known.

### If the audit finds no infrastructure as code at all

**This Terraform is applied as written**, and risk R12 is realised: having the code is not the same as having the system, and M1 is materially bigger than scoped. The re-baseline right is reserved and the honest report goes to Dan either way.

---

## 6. Consequences accepted

- **More lines than CDK for the same result.** Accepted, in exchange for a reviewer being able to read a diff without running a compiler.
- **No compile-time type checking across module boundaries.** Partly mitigated by typed variables with `optional()` and object types, and by `precondition` blocks that fail at plan time with an explanation rather than at apply time with an AWS error. There are eight of those in this configuration and each one encodes a failure named in a delivered document.
- **State is a file that can be lost or corrupted.** Mitigated by versioning on the state bucket and by native locking. `BOOTSTRAP.md` covers it.
- **Terraform cannot deploy application code well.** Deliberately not attempted: Terraform owns each function's identity, permissions and wiring, and the application pipeline owns its code. Every function carries `ignore_changes` on its package for that reason.

---

## 7. What this ADR does not decide

- **Where the application's CI pipeline runs**, and whether it invokes Terraform. That belongs with the repository, which we do not have.
- **Whether production applies run from a workstation or from CI.** Section 8 of `README.md` states the position for this week (a workstation, with a reviewed plan, because CI does not exist yet) and flags it as a handover item.
- **Anything about the existing scaffold or the existing AWS account.** We have not seen either. Every statement in this directory about them is marked TO CONFIRM IN AUDIT.
