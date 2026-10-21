# Runbooks

**M5 handoff deliverable. Written Saturday 22 August 2026. Sections 1, 2, 5.4, 7.2 and 9 revised Tuesday 25 August 2026, and sections 1, 3, 5.4, 7.2 and 9 revised again later the same day when the domain came back.**

> **CORRECTED Thursday 27 August 2026. Every statement below about which AWS account is which was wrong from Monday 24 August to Thursday 27 August 2026. The wrong statements are struck rather than deleted, because a reader who follows the old ones is stopped from deploying into the only correct place.** `888348806392` is **`Trevean-NFC-Development`, the development account**, `aws-dev@treveanspice.com`. The Organization management account is **`[account id withheld]`, `Trevean Spice`**, `aws-root@treveanspice.com`, org `o-q36zht9ztn`. Verified with `aws organizations list-accounts` and `aws organizations describe-organization`. **So there was no second blocker, no account needed creating, the state bucket was always in its correct home, and `888348806392` is the target for `envs/dev` rather than the account to avoid.** **The development environment was applied into it on Thursday 27 August 2026: 169 resources, distribution `d1uyspgs0bmg3a.cloudfront.net`, all five tag codes verified end to end.** See the document titled "The deployed development environment", section 1, and "Decision log", D32.
>
> **What does not change: the `expected_account_id` guard stays, stays required, and still has no default.** It was never the guard that was wrong, only the id the examples told you to fear. `envs/dev` is guarded to `888348806392`, staging belongs in a Serene Labs account, and production belongs in Trevean's production account, which is neither of the two ids above.

> **The domain state changed twice inside four days and this document has been wrong about it in both directions. Read section 9.1 before running anything that names a hostname.** As at the second revision on Tuesday 25 August 2026: **`treveanspice.com` resolves, email on it is fully restored, and the apex returns HTTP 403 while `/t/ps` returns HTTP 500.** Any statement below that the domain returns SERVFAIL is superseded.

The operational heart of the handoff. Each runbook says at its head who can run it, what it needs, and **whether it can be executed today or is a procedure waiting on something that does not exist yet.** That last line is not a disclaimer, it is the most useful sentence in each section: a runbook that describes a system that has not been built is worse than no runbook, because somebody will follow it and lose an afternoon proving it does not apply.

**What changed on Tuesday 25 August 2026, and why it matters more than a version note.** An internal review of Monday 24 August found that section 2 sends you to the wrong environment directory, promises an account guard that one of the three environments did not have, and ~~never says that the only AWS account available is the management account of an Organization~~. **That third finding is withdrawn, Thursday 27 August 2026: it rested on the two accounts being recorded the wrong way round. The first two findings stand. See the correction box above and "Decision log", D32.** It also found that section 9 is written against a domain that resolves, and at that point `treveanspice.com` did not resolve at all. **Both were corrected below and neither correction was cosmetic: as written, section 2 would have produced a plan nobody had read, and section 9's rollback would have restored an outage.**

**Then the domain came back, later the same day, and section 9 was corrected a second time.** `treveanspice.com` resolves at Bluehost with email fully restored, and the apex answers HTTP 403 while `/t/ps` answers HTTP 500. **Section 9 is a cutover procedure again rather than a bring up.** The rollback record, the certificate validation route, the zone diff's left hand side and the prior state to revert to all exist once more, **and one of them, the zone export, is a task nobody has done and should do today.** Section 9.1 has the line by line position.

---

## 1. What can be executed today, and what cannot

**As at Tuesday 25 August 2026 nothing is deployed to AWS.** The account holds one Terraform state bucket. No distribution, no certificate, no table, no function exists.

**Read the two preconditions below before reading the table**, because between them they decide the answer in six of the eight rows.

**Precondition A, the account. WITHDRAWN Thursday 27 August 2026. It was never a precondition.** ~~The AWS account this project holds credentials for, 888348806392, is the management account of an Organization, and no member account exists beneath it. Until a member account exists, every environment in this stack would deploy into the same account as production. A supervised session to create a Development account has been agreed with the client and is not yet scheduled.~~ **`888348806392` is `Trevean-NFC-Development`, the development account, and it was throughout. Nothing needed creating and there was never anywhere else for dev to go.** The development environment was applied into it on Thursday 27 August 2026: 169 resources, distribution `d1uyspgs0bmg3a.cloudfront.net`, all five tag codes verified end to end. Section 2.2, the document titled "The deployed development environment", section 1, and "Decision log", D32.

**Precondition B, the domain. Changed later on Tuesday 25 August 2026, and it is the one piece of good news in this section.** **`treveanspice.com` resolves.** Nameservers `ns1.bluehost.com` and `ns2.bluehost.com`, apex A record `50.6.2.51`. **Email is fully restored on the zone**, MX to `smtp.google.com` plus SPF, a Google DKIM selector and DMARC, all four verified. **A command in this document that names that hostname now returns a real answer, and the answer is an error: HTTP 403 on the apex and HTTP 500 on `/t/ps`, because the domain points at Bluehost rather than at the deployment.** Section 9.1.

**Read that carefully rather than as a fix.** A resolution error told you nothing about the system under test. **A 403 or a 500 tells you something and it is not what you are testing either**, so the same caution applies with a different reason: **the hostname now answers, and it is not answering from anything this package describes.** Aim verification at the host that is actually serving, not at the apex, until the apex points at it.

| # | Runbook | Executable today |
|---|---|---|
| 2 | Deploying | **Yes for `envs/dev`, corrected Thursday 27 August 2026.** ~~No, and for two reasons rather than one: IAM role creation permission, and there is no account to deploy a non production environment into.~~ **The second reason never existed**, and the first was resolved: the development environment was applied into `888348806392` on Thursday 27 August 2026 at 169 resources. **The saved 140 resource plan is superseded by that apply: delete it rather than trust it.** Section 2.1, and the document titled "The deployed development environment". |
| 3 | Rolling back | Partly, **and one level came back later on Tuesday 25 August 2026.** The redirect level rollback is real and testable now. The application and infrastructure levels wait on a first deploy. **The DNS level exists again in principle, because the domain resolves and there is a prior state to revert to. It does not exist in practice until somebody exports the zone**, because a rollback record you have not taken is not a rollback record. Section 9.4 and section 9.1. |
| 4 | Rotating the tag password and other secrets | **Partly.** The secret containers are written in Terraform and not applied. ~~**The tag area password does not exist yet:** order SO4731 shipped unprotected, confirmed by the client on 19 August 2026, and applying a password is an M4 decision.~~ **Corrected 14 October 2026: order SO4731 shipped write protected and Trevean does not hold the password (confirmed by the client 11 September 2026; section 4, "Decision log" D45).** Section 4 covers the password for future orders. |
| 5 | Editing the redirect table safely | **Yes for the edit, no for the verification.** The table, its validator, its compiler and its 132 tests all run today with no cloud account and no DNS. **Section 5.4, which verifies a deployed table over the network, still cannot run, and the reason narrowed:** the hostname resolves now, so the blocker is no longer DNS. **It is that nothing is deployed for it to verify.** |
| 6 | Cache hit ratio alarm | **No.** The alarm is written in Terraform and not applied. Section 6 is what to do when it fires, and it is worth reading before it does. |
| 7 | A customer reports a wrong blend page | **Steps 1 to 3 of the diagnosis are executable today** against the physical tag, the redirect table and the local build. **Steps 4 and 5 still are not, and the reason changed later on Tuesday 25 August 2026.** They go over the network to the apex, which now resolves and returns HTTP 403 on the apex and HTTP 500 on `/t/ps`. **A step that returns an error from the wrong host is not a diagnosis**, so treat those two steps as unavailable until the apex points at whatever is serving. Section 7.2 marks each step. |
| 8 | Encoding a new tag batch | **Partly, and the split moved.** Hand encoding a handful of sample tags is executable today and is documented. **The M4 command line tool now exists and its 134 tests pass, but it has never been run against a physical tag or a physical reader and its reader transport is an unimplemented stub.** Do not encode inventory with it until that is closed. Section 8.3. |
| 9 | DNS cutover and its rollback | **No, and the reason changed twice in one day.** It was waiting on a transfer, then the transfer completed and the zone stopped answering, **and later on Tuesday 25 August 2026 the zone came back with email fully restored.** So it is a cutover again rather than a bring up: there is a rollback record to take, a left hand side to diff against and a prior state to revert to. **What blocks it now is that there is nowhere to cut over to**, because there is still no distribution and no certificate, and one task nobody has done, which is exporting the zone. Section 9.1 states the precondition line by line. |

---

## 2. Deploying

**Who:** a developer with AWS access to the target account.
**Executable today:** **yes for `envs/dev`, corrected Thursday 27 August 2026.** ~~No. Blocked on IAM role creation permission and on the absence of any account other than the Organization management account.~~ The second blocker never existed, and the first was resolved before the apply of Thursday 27 August 2026.

### 2.1 The two blockers, stated first

> **CORRECTED Thursday 27 August 2026. There was one blocker, not two.** Blocker two below is withdrawn in full: `888348806392` is the development account, `Trevean-NFC-Development`, not the management account. It is kept in place, struck, because the record said the opposite for four days and the correction is the useful part. **Blocker one, the IAM permission, was real, and it was resolved: the development environment was applied into `888348806392` on Thursday 27 August 2026, 169 resources including eight Lambda roles and eight policies.** See "Decision log", D32, and the document titled "The deployed development environment".

**Blocker one: the principal cannot create IAM roles.** It holds `PowerUserAccess`. A `terraform plan` run against account 888348806392 on Wednesday 19 August 2026 wanted **140 resources, of which 24 are IAM resources across eight functions, eight of them roles**. Remote state exists at `trevean-tfstate-888348806392`, versioned, encrypted, public access blocked, and it is the only object in the account.

The fix is one of two things: grant the principal administrator access long enough to create a properly separated environment, or have an administrator create a bootstrap role with a permissions boundary once, after which every apply runs unattended. The least privilege shape, eight functions with eight roles and eight policies, no shared execution role and no wildcard on a table, a bucket or a secret, is a commitment rather than a preference, and it is what needs the permission.

~~**Blocker two, and it is the one this runbook previously did not mention at all: account 888348806392 is the management account of an AWS Organization, and no member account exists beneath it.** Until a member account exists there is nowhere for a non production environment to go.~~ **WITHDRAWN Thursday 27 August 2026. `888348806392` is the development account and was the correct place for a non production environment the whole time.** Section 2.2.

**Nothing had been applied as at Tuesday 25 August 2026, deliberately.** An apply under the permission held then would create roughly 116 resources and then fail on the first IAM role, leaving a half built environment and a partial state file in a client account. ~~It would also have built that half of an environment in the management account, which is the failure blocker two describes.~~ **That second sentence is withdrawn: the account was the development account.** The half built environment argument stands on its own and it is the reason the apply waited for the permission rather than for an account.

**The saved plan is superseded. Delete `build/infrastructure/envs/dev/dev.tfplan` rather than trusting it.** It was produced on Wednesday 19 August 2026, before the account guard existed, and it has since been overtaken by the real apply of 169 resources on Thursday 27 August 2026. ~~It was also made before anyone had noticed what kind of account it was planning into.~~ **Corrected Thursday 27 August 2026: it was planning into the correct account. The plan was stale, it was never aimed at the wrong place.** A Terraform plan file is a snapshot of a decision, and this one predates the environment that now exists. **Re plan from scratch. A plan nobody has read is worse than no plan, and a plan somebody has read that was made under a superseded premise is worse still.**

### 2.2 The account. Read this before anything else in this section

> **CORRECTED Thursday 27 August 2026. This section asserted the opposite of the truth for four days and the assertion is struck rather than removed.** The two accounts were recorded the wrong way round from Monday 24 August to Thursday 27 August 2026.

**The accounts, verified by name with `aws organizations list-accounts` and `aws organizations describe-organization`:**

| Account | Name | Email | What it is |
|---|---|---|---|
| `[account id withheld]` | `Trevean Spice` | `aws-root@treveanspice.com` | **The Organization management account.** Org `o-q36zht9ztn` |
| `888348806392` | `Trevean-NFC-Development` | `aws-dev@treveanspice.com` | **The development account, and the correct target for `envs/dev`** |

~~The AWS account this project holds credentials for, 888348806392, is the management account of an Organization. There is no member account beneath it. This is the single most important fact about deploying here.~~ **Wrong in both halves. The credentials this project holds are for the development account, and a management account sits above it.**

What follows, in the order it will bite:

1. ~~**There is nothing above it.** A service control policy is applied by an Organization to its member accounts, and the management account is not one of them. Whatever guardrails the Organization enforces do not protect this account.~~ **Withdrawn. `888348806392` is a member account, so whatever service control policies the Organization applies do reach it.** Read them before assuming an apply will be permitted, rather than assuming nothing constrains you.
2. ~~**Every environment would share one blast radius.** Dev, staging and production in one account means a dev apply and a production apply are separated by a name prefix and nothing else.~~ **Withdrawn. Dev has an account of its own.** The general point survives in one form only: **never point two environments at one account**, which is what the `expected_account_id` guard exists to prevent.
3. **An account per environment, which is the shape this stack is written for and the shape the estate already has.** `envs/dev` in `888348806392`. **Staging in a Serene Labs account, which is neither Trevean account.** Production in Trevean's production account. The management account, `[account id withheld]`, holds the Organization.
4. ~~**The current ask on the client is what makes that possible**, and it is one action: assign administrator access to the engineer's user in Identity Center, once. The Development account is then created, configured, and the state bucket moved out of the management account by the engineer rather than by the client. **The bucket currently sitting in the management account is in the wrong home and is a named cleanup item, not a permanent arrangement.**~~ **Withdrawn in full. No account needed creating and nothing needed moving.** `trevean-tfstate-888348806392` sits in the development account, which is its correct home, and the development environment was applied through it on Thursday 27 August 2026. The permission the supervised session was for was real; the account creation it was scoped around was not.

**Before anything, every time. The third command is the one that would have caught the account error, so run it and read the answer rather than the exit code:**

```sh
terraform version              # 1.10 or later. Native S3 state locking.
aws sts get-caller-identity    # returns an id and no name. It cannot tell you which account this is.
aws organizations describe-organization   # names the management account. If you are not in it,
                                          # you are in a member account, which is correct
                                          # for dev. If you are IN it, stop: that is the
                                          # management account and nothing in this stack belongs there.
aws iam list-account-aliases              # the cheap identity check. dev answers Trevean-NFC-Development.
```

**Identify the account by name before creating anything in it.** The account was checked for emptiness on Wednesday 19 August 2026 and never for identity, and an inventory is not an identity check. That is the standing rule from "Decision log", D32.

**The account guard, stated exactly rather than universally.** The stack uses an `expected_account_id` variable, declared with **no default so it fails closed**: Terraform refuses to plan or apply without a value rather than running with the guard silently disarmed. Where it is wired as of Tuesday 25 August 2026:

| Environment | Variable declared | Wired into the provider as `allowed_account_ids` | Fails closed |
|---|---|---|---|
| `envs/dev` | Yes | **Yes**, on both providers | **Yes.** No default |
| `envs/staging` | Yes | **Yes**, on both providers | **Yes.** No default |
| `envs/prod` | Yes | **Yes**, on both providers | **No.** Permits `null`, which disarms the guard |

**The one to watch is production, which is the opposite of what you would expect.** Dev and staging refuse to plan without an account id. Production accepts `null` and runs with the guard disarmed, because its variable carries a default and the provider line is written to tolerate it. That is the weakest guard on the most dangerous environment.

**Set the value in every environment, never remove it, and never give it a default.** A default of `null` disarms the guard for anybody who did not read the description, which is what production currently does.

`terraform validate` passes with `expected_account_id` unset, because validate does not require root variable values. `plan` and `apply` do not.

### 2.3 Order of operations

Each environment is a thin wrapper over one shared stack module, so the difference between staging and production is a variables file a reviewer can read in one sitting rather than three directories that have drifted apart.

**Which directory is ready, stated plainly, because getting this wrong costs a plan nobody has read.**

| Directory | `terraform.tfvars` | Saved plan | State of readiness |
|---|---|---|---|
| `envs/dev` | **Present**, `name_prefix = "trevean-dev-tsn888348"` | `dev.tfplan`, **superseded by the Thursday 27 August 2026 apply, delete it**, section 2.1 | **This is the environment that was planned and then applied**, into `888348806392`. It is the one with a real variables file. |
| `envs/staging` | Example only | None | Needs a `terraform.tfvars` written from the example, and its account guard is not wired. |
| `envs/prod` | Example only | None | Needs the client's account id and the client's domain. Three passes, below. |

**Dev first, because dev is the environment that has a variables file somebody wrote and a plan somebody read.** The 22 August version of this runbook opened this sequence with `cd envs/staging`, which is wrong: a stranger following it would copy the example variables file, invent a `name_prefix`, and produce a plan nobody has ever read while believing it was the 140 resource plan described two paragraphs earlier.

```sh
cd build/infrastructure/envs/dev
cp backend.hcl.example backend.hcl            # set the state bucket name
# terraform.tfvars already exists here. Read it. Do not overwrite it from the example.
terraform init -backend-config=backend.hcl
terraform fmt -check -recursive ../..
terraform validate
terraform plan -out=dev.tfplan -var="expected_account_id=888348806392"   # the development account
# READ THE PLAN, then:
terraform apply dev.tfplan
terraform output readiness
```

**`expected_account_id` has no default and must be the development account, which is `888348806392`. Corrected Thursday 27 August 2026.** ~~If the only account id you have is 888348806392, stop: that is the management account and the guard exists to prevent exactly this apply.~~ **That instruction was exactly backwards and would have stopped a reader deploying into the only correct place.** The guard itself is unchanged and stays required with no default: what was wrong was the id it named as the one to fear, which is `[account id withheld]`, the management account. Section 2.2 and "Decision log", D32.

**Staging next, once its account guard is wired.** Same sequence, `cp terraform.tfvars.example terraform.tfvars` first, and set `name_prefix` to something globally unique because it ends up in bucket names.

**Staging needs neither the client's domain nor the production account, and it does need an account of its own.** The 22 August version said staging "needs neither the client's account nor the client's domain", which is only half true and the missing half is the important one: if it does not need the production account it still needs somebody's account, and **a developer Trevean hires in a year does not have a Serene Labs account to fall back on.** ~~Staging goes in a Trevean member account, and until one exists, staging cannot be deployed at all.~~ **Corrected Thursday 27 August 2026: staging belongs in a Serene Labs account, which is neither `888348806392` nor `[account id withheld]`.** "Decision log", D32. The point about the developer hired in a year is unchanged and is the argument for handing staging over rather than for putting it in a Trevean account.

`readiness` prints what is and is not real in the environment. **Staging refuses to deploy a placeholder edge function**, so if the edge package has not produced an artifact the apply fails at a precondition with an explanation. That is deliberate: measuring the tap path against a placeholder measures nothing.

**Production runs in three passes, and none of them touches a nameserver.**

| Pass | What it creates | Then, by hand |
|---|---|---|
| 1 | The ACM certificate request and the hosted zone as an exact copy of the existing zone. **No nameserver change.** | Paste the certificate validation records into the **currently authoritative** DNS provider's zone. Compare `copied_zone_record_count` against the exported zone: if the export has 23 records and Terraform copied 19, four things are about to break and no downstream check will tell you which. Lower TTLs on any record due to change to 300, at least 48 hours before the flip. |
| 2 | Blocks until the certificate reports `ISSUED`. | Confirm `terraform output certificate_status` reads `ISSUED`. |
| 3 | Attaches the apex and www aliases to the distribution. | Nothing. **Still no nameserver change.** |

**The certificate must be in us-east-1.** CloudFront reads certificates from that region only. A certificate in any other region cannot be attached and the flip cannot proceed. It is requested and validated while the existing provider's zone is still authoritative, which is what makes the whole distribution testable before a single nameserver changes.

After the flip, and only after resolution is confirmed, one more apply moves certificate validation records into the new zone so renewals validate automatically and the certificate does not silently fail to renew months later.

**Pass 1's precondition is the same one as section 9.1, and it is now met in part rather than not at all.** Both halves of pass 1's manual column assume a currently authoritative zone: somewhere to paste a validation record, and an export to compare `copied_zone_record_count` against. **Corrected later on Tuesday 25 August 2026: `treveanspice.com` resolves at Bluehost, so there is a zone answering.** DNS validation of the certificate through the incumbent provider is available again, which is the mechanism this whole three pass sequence rests on.

**One half is still missing and it is a task rather than a blocker: nobody has exported the zone**, so `copied_zone_record_count` has nothing to be compared with. **Take that export before pass 1 runs, not during it.** See section 9.1 for the line by line position. ~~**Pass 1 remains unrunnable for a different reason, which is precondition A: there is still no account to request the certificate in.**~~ **Corrected Thursday 27 August 2026: precondition A is withdrawn, because the account always existed. What pass 1 waits on is Trevean's production account and the client's domain, not the existence of an account to work in.**

### 2.4 Application deploys, which are not Terraform

**Terraform does not own application code.** Every function carries `ignore_changes` on its package, so an apply never reverts a deployed build. The corollary is that a fresh apply into an empty account leaves eight functions answering 501 until the application pipeline runs, and `terraform output functions_still_on_placeholder` lists them.

Deploy order for the application, and it matters:

1. **The edge redirect.** `npm run ci` in the edge package first, which validates the table, recompiles it, and fails if the committed artifact has drifted. **A pipeline that uploads the compiled function without the drift check can ship a hand edited function, which is the second copy of the table the whole package exists to prevent.**
2. **The consumer pages.** `npm run build`, then `npm run verify`. Before a production deploy also run the release form, which turns any remaining placeholder content into a build failure. Serve the built files with the headers documented in the document titled "Architecture and the reasoning behind it", section 4: HTML `public, max-age=60, s-maxage=31536000, stale-while-revalidate=86400` invalidated on publish, everything else `public, max-age=31536000, immutable`.
3. **The API and the rollup consumer.** The API behind a function URL or API Gateway, fronted by CloudFront. The consumer on the `ScanEvents` stream with the filter, batch size 500, a 5 second window, and **bisect on error disabled** with failures going to a dead letter queue. **Set `GEO_TRUSTED_HEADER_NAME` and `GEO_TRUSTED_HEADER_VALUE` on the API in the same step, and add the matching origin custom header to the distribution.** Skip it and the API still works, the beacon still records, and geography is silently empty forever. Item 7 of section 2.6 is the whole of it.
4. **Generate the edge rewrite configuration from the page build's route manifest.** Do not type the rewrites twice. The manifest carries the 307 destinations, the rewrite table, the cache key rules, and a flag per tag code saying whether a pre rendered page exists for it.

### 2.5 Two things deliberately not automated, and they stay that way

**The nameserver change.** A human types the nameservers in, having just read a verification report. It is the single action in this project that can strand a thousand encoded jars, and it must never be a side effect of an apply. Section 9.

**Attaching functions to their event sources.** The rollup and media event source mappings default to off and stay off until real application code is deployed. A placeholder attached to a live stream fails every batch, fills the dead letter queue, and produces an alarm storm on day one.

### 2.6 Seven things that will bite

1. **`CacheHitRate` needs the CloudFront monitoring subscription.** It is an additional metric. Without the subscription it is never published and the alarm sits in insufficient data forever, **which looks exactly like health**.
2. **Alarms need a confirmed subscriber.** Each email address gets a confirmation link a human has to click. `terraform output alarm_recipients_status` says whether anyone will actually receive anything. Confirm them before the flip, not during an incident.
3. **The edge function must be associated with the `/t/*` and `/q/*` behaviours and nothing else.** It answers a request it does not recognise with a 404, which is correct for those two behaviours and catastrophic anywhere else: attached to the default behaviour it returns 404 for the entire marketing site. It cannot defend against this itself, because a viewer request function is not told which behaviour invoked it.
4. **The `/blend.html` cache key must exclude `via` and every `utm_*` parameter and must not forward them.** See section 6.
5. **The stream filter is not optional.** INSERT only **and** `pk` beginning with `EVT#`. Without it, rollup writes retrigger the consumer that produced them and it bills for itself. Both halves matter: the first rollup write of a new day is an INSERT.
6. **Production applies currently run from a workstation against a plan that has been read.** That is acceptable for a cutover week and is not acceptable permanently. Moving production applies into a pipeline, with the plan posted for review and the apply gated on approval, is a named handover item.
7. **Geography is dropped until a trusted header pair is configured on the API, and the failure is silent. Added Thursday 27 August 2026.** The API derives country, region and city from CDN viewer headers, and those headers are only true for a request that genuinely arrived through CloudFront. A request that reaches the origin directly carries whatever headers its sender chose, and the scan beacon takes no credential by design, so the untrusted caller is the entire internet. The API therefore reads viewer geo headers only on a request carrying a header pair that CloudFront adds to the origin request and a viewer cannot set. **Two environment variables name it, `GEO_TRUSTED_HEADER_NAME` and `GEO_TRUSTED_HEADER_VALUE`, and both must be present: with either missing the API treats the pair as unconfigured.** Unconfigured, geography is read on stage `local` and dropped everywhere else. **That is the right direction to fail and it is invisible**: no error, no alarm, and a dashboard whose geography is permanently empty, which looks the same as a product nobody has tapped. Configuring it is two halves and neither works alone: a `custom_header` on the AWS origin in the CDN Terraform, which is not there today, and the same name and value passed to the API function as environment. **Treat the value as a secret.** Anyone holding it can forge a country by calling the origin directly, and the two poisonings this gate closes were measured rather than imagined: `#` is the rollup geography key separator, so a region containing it wrote an arbitrary place into the rollup the dashboard displays, and an attacker controlled city made the number of rollup rows per blend per day bounded only by the caller's request budget.

---

## 3. Rolling back

**Who:** a developer.
**Executable today:** the redirect level, yes. The others wait on a first deploy.

There are four levels and they have very different costs. **Identify which level you are at before touching anything**, because the cheap fix for one is useless at another.

| Level | Symptom | Action | Time to recover |
|---|---|---|---|
| **Content** | The page shows the wrong story, an old story, or a story that should not be public | Revert the content in the admin and republish, or call the manual revalidate operation for the affected paths | Seconds to minutes |
| **Redirect** | Resolution is fine, but a code opens the wrong blend or a 404 | Revert the redirect table commit, run the package CI, redeploy the function | **Under a minute of propagation.** This covers almost everything that can go wrong. |
| **Application** | The page or the API is broken but DNS and the CDN are fine | Redeploy the previous build artifact, then invalidate the CDN paths affected | Minutes |
| **DNS** | The domain does not resolve, or resolves to nothing useful | Revert the nameserver set at the registrar. Section 9.4 | **Up to 48 hours.** Say the honest number rather than the comfortable one. |

**Why the DNS level is bounded by something you do not control:** the parent nameserver TTL is typically 48 hours, and while it is stale every encoded jar is dead. That asymmetry is why the pre flip verification in section 9.3 carries far more weight than the rollback does.

~~**The DNS level does not exist on Tuesday 25 August 2026, and treating it as available is the most expensive mistake available in this document.**~~ **Superseded later the same day. `treveanspice.com` resolves again**, so a revert restores a working zone rather than an outage and the DNS level exists in principle.

**It does not exist in practice yet, and the difference is one file.** A rollback restores what the previous state answered, and knowing what it answered means having a verbatim export of the zone on disk. **Nobody has taken that export.** Until somebody does, plan every DNS change as though it is one way, **and take the export now rather than when it is needed**, because the window in which the records can be read out of DNS has already closed once this month. Section 9.1.

**One rollback that is not a rollback.** If a customer's browser has cached a redirect, you cannot recall it. That is why the 307 is served `no-store` and why the status is 307 rather than 301: a 301 is cached by browsers and intermediaries, in some cases indefinitely, and there is no server side fix for it on a device that already holds one. If a 301 ever reaches production for `/t/*`, treat it as an incident with a permanent blast radius on every device that tapped during the window, not as a header typo.

---

## 4. Rotating the tag password and other secrets

**Who:** a developer, with the named holder of the secret present.
**Executable today:** partly. The secret containers are written and unapplied. **The tag area password does not exist yet.**

### 4.1 Read this before touching a tag password

**The ST25TV02KC uses a 64 bit area password, which is 8 bytes written as 16 hexadecimal characters. It is not lock bits.**

- Present the correct password and the area unlocks **for that session** and accepts writes. Power the tag down and it is protected again.
- Holding the password, you can change the protection state **and change the password itself**. It is a state you can change, not a fuse you blow.
- **There is no reset, no master key and no recovery service. Lose the password and the tag is frozen exactly as if it had been permanently fused shut.**

**That moves the entire risk from permanence to custody.** It is why the password lives in the managed secret store with a named holder and a documented rotation path, never in the repository, never in a spreadsheet, never in a message.

**And it is why a tag password Trevean does not hold is a tag estate Trevean does not own.** Handing it over is part of this milestone.

### 4.2 The current state of the tag password

**Order SO4731, the 1,000 tags in the field, shipped WRITE PROTECTED, and Trevean does not hold the password.** Confirmed by the client on 11 September 2026 with the stock in front of him, "yes the tags are locked per the supplier", and matching his own written instruction to the supplier. That means:

- **The shipped tags cannot be re encoded by anybody who does not hold the ST25TV area password.** That is the good half: a jar on a shelf cannot be rewritten by a passer by with a phone.
- **It is also the bad half. If those 1,000 tags ever need to point somewhere else, that password is the only route**, and `tag_password_holder` is nominated to nobody. The supplier may have kept it, sent it, or generated it and discarded it. **Establishing which gets harder with every month and is impossible once the supplier relationship ends.**
- **The redirect table remains the primary recovery mechanism and is now the only practical one.** Re encoding a thousand jars was always expensive; without the password it is not available at all. See D10.
- Whether future runs ship protected, and with a password Trevean generates and holds, is a live decision. See the document titled "Limitations and future work", section 6.

**This corrects an earlier position in this document set.** Until 11 September 2026 the record said the run shipped unprotected, on an answer the client gave from memory in August about a run that had already left. **Anything still saying "no write protection" or "there is no tag password" is stale.** See "Decision log", D45 and D18.

**One verification is still outstanding and it is the only thing that makes this evidence rather than testimony: read back one SO4731 tag on a physical reader** and confirm the protection state the tag itself reports. The client holds an ACR1552U and the jars, and was asked on 16 September 2026. **Do not let this document's confidence outrun that check.**

### 4.3 Rotating the tag password, when one exists

1. **Confirm who the named holder is** and have them present. A rotation performed by somebody who is not the holder is how the record of who holds it becomes wrong.
2. **Generate the new 64 bit value** and write it into the managed secret store as a **new version**. Do not overwrite the old version; the old value is what unlocks tags already in the field.
3. **The store now holds two values that are both live**, and this is the part people get wrong: tags already encoded under the old password still need the old password. Rotation is not retroactive. Record which batches were written under which version, in the batch record produced by the encoding tool.
4. **Rotate forward only.** New batches encode under the new version. Existing stock keeps the old version until it is deliberately re encoded, which is a physical operation on physical jars.
5. **Update the named holder record and the batch record in the same change.**
6. **Never test a rotation on production inventory.** Use bare stock.

### 4.4 Rotating the other secrets

| Secret | Rotation | Blast radius if done wrong |
|---|---|---|
| Shopify Admin API credential | Issue new, deploy, verify a catalog sync completes, revoke old | The catalog mirror goes stale. Price labels degrade; **pages and the reorder button keep working**, because the cart permalink is a static URL. |
| Shopify webhook signing secret | Update at Shopify and in the store in the same window; verification is over the raw body with a constant time comparison | Inbound webhooks are rejected. Catalog and order attribution stop; the tap path is unaffected. |
| Identity provider signing keys for admin JWTs | Managed by the provider; the API validates by signature, issuer, audience and expiry | Admin users are signed out. **No consumer impact whatsoever**, because the tap path has no authentication in it. |
| Terraform state bucket access | Rotate the principal, not the bucket | An apply fails loudly. This is the safe failure. |

**The general rule for every secret here: nothing in this list is on the tap path.** Every rotation above degrades an editorial or operational capability and none of them can stop a customer reading a blend page, because the page is a pre rendered file on a CDN. That property is worth knowing before you schedule a rotation nervously.

**The environment variable path for secrets exists for local development and is refused in code when the stage is production.** Do not weaken that to make a deployment easier.

---

## 5. Editing the redirect table safely

**Who:** a developer, with a reviewer.
**Executable today:** yes, all of it except the final deploy.

**This is the most consequential file in the project.** A thousand encoded jars resolve through it, and the failure it can cause has no symptom on the deploying side.

### 5.1 The rule

**The table is the only place a code to blend mapping exists.** The edge function, the tag records seed, the chip encoding input and the QR artwork sheet are all compiled from it into a build output directory. **That directory is output. Editing anything in it by hand fails CI**, and a test asserts that no other file in the package carries a target path.

**Never edit the table in a hosting console.** There is no console form for it, deliberately. It is also read only through the admin API for every role including Admin.

### 5.2 Changing where a code points

This is the supported operation. It is the reason the redirect exists and the reason a thousand tags never need re encoding.

1. Edit `targetPath` and `blendSlug` on the row.
2. **Set `"allowRepoint": true` and increment `version`.**
3. `npm run ci` in the edge package: validate, rebuild, run the tests, check for drift.
4. Commit **both the table and the compiled output**. In the pull request description, say **which physical jars are affected**, by blend and unit count.
5. Get a review. This is a code review of a change that moves 250 jars.
6. Deploy. Propagation is under a minute.
7. Run the live verification script against production, and **tap a real jar**.

**Without step 2 the build fails**, because a repoint nobody meant to make is indistinguishable from a repoint somebody did. Removing a code fails the same way, because 250 jars would start returning 404.

### 5.3 What the validator checks, and the one thing it cannot

Six checks are listed in the document titled "Architecture and the reasoning behind it", section 3. Three more run in the package.

**What no validator can catch: a transposed pair.** Swap `ps` and `cs` wholesale and every row is still internally consistent, so all six checks pass. Two things catch it and both must survive any refactor:

- **The test expectations are transcribed by hand** from the tag code map rather than read out of the file under test. A test that reads its expectations from the file it is testing cannot catch a transposition. Transposing the two codes fails 11 tests.
- **The repoint check diffs against the previously committed table**, read out of git.

### 5.4 Verifying a deployed table

**Precondition, and it is not met on Tuesday 25 August 2026.** This command goes over the network to the apex. Before running it:

```sh
dig +short NS treveanspice.com    # must return nameservers
dig +short A treveanspice.com     # must return an address
```

**If either returns nothing, stop.** **Corrected later on Tuesday 25 August 2026: `treveanspice.com` resolves, so this check now passes and the command below will run.** It will return **HTTP 403 on the apex and HTTP 500 on `/t/ps`**, because the domain points at Bluehost rather than at anything this package deploys. **That is a worse failure to reason about than a resolution error, because it looks like a verification result.** It says nothing whatsoever about the redirect table. Section 9.1. Everything else in section 5, the edit, the validator, the compiler and the 132 tests, runs today with no network and no cloud account.

```
npm run verify -- --base https://treveanspice.com
```

It prints one row per code plus a row for an unknown code, and exits non zero if anything fails. It checks the status is exactly 307, the `Location` matches the table byte for byte, the `Location` is relative, `Cache-Control` is `no-store`, the table digest header matches what the working tree compiles to, the destination returns 200, **and the destination page actually names the right blend.**

That last check is the one a status code smoke test cannot make, and it is the difference between a green run and a customer tapping Persian Sunrise and reading about Caribbean Sunset.

**It does not replace tapping a jar.** Four physical tags exist in this production run: `ps`, `cs`, `sr`, `nm`. `kg` is reserved and no jar carries it, so do not spend a morning looking for a Kyoto Garden jar. Tap all four, on matrix handsets, with the display awake on iPhone and unlocked on Android, and read the blend name off the screen.

---

## 6. When the cache hit ratio alarm fires

**Who:** a developer.
**Executable today:** no. The alarm is written and not applied.

**Why this alarm exists and why it is not optional: a falling cache hit ratio is the earliest warning that something broke the rendering strategy.** Everything else in this architecture stays green while it happens. The page still returns 200, the API is still healthy, no error rate moves, and the only visible symptom is that taps get slower, which nobody notices until a customer says so.

**First, before diagnosing: check that the metric is real.** `CacheHitRate` is a CloudFront additional metric and requires the monitoring subscription. If the alarm has been in insufficient data rather than OK, it has been telling you nothing. That state looks exactly like health.

### 6.1 The five causes, in the order to check them

**1. An attribution parameter entered the cache key.** The most likely cause by a wide margin. If `via` or any `utm_*` parameter is in the key for `/blend.html`, then `?blend=persian-sunrise&via=nfc` and `?blend=persian-sunrise&via=qr` are two entries and the ratio roughly halves overnight. `utm_*` is worse, because campaign links generate unbounded values and every distinct value is a separate entry paying origin latency on first request.

*Check:* the cache policy for the `/blend.html` behaviour. The key is **path plus the `blend` parameter only**. `via` and `utm_*` are neither in the key nor forwarded to the origin.
*Fix:* correct the cache policy, then invalidate. The client side beacon reads `via` from `window.location` after paint, so nothing is lost by excluding it.

**2. The render cache is not externalised, or lost its shared index.** On serverless functions the regeneration cache defaults to the local filesystem, so every concurrent instance keeps its own copy and a cold instance starts empty. The symptom is a ratio that degrades under concurrency and recovers when traffic falls, which is the opposite of intuitive.

*Check:* that the cache handler is configured and pointing at shared object storage with a shared index.
*Fix:* the infrastructure package has a `render_cache` module for exactly this. **This is the most common serious mistake in this stack and it is invisible until it is an incident.**

**3. A route stopped being pre rendered.** An explicit dynamic setting, an uncached fetch, or a data read in a shared layout will silently opt a route out of static generation. Every request then becomes an origin render.

*Check:* the build output should contain one static HTML file per published blend. The build is configured as a static export precisely so this becomes a **build error** rather than a silent behaviour change, so if this is the cause, something bypassed the export.
*Fix:* restore static generation. Do not "fix" it by making the route dynamic.

**4. Cache headers on HTML are wrong.** Long in the browser and short at the CDN is exactly backwards. The correct shape is `public, max-age=60, s-maxage=31536000, stale-while-revalidate=86400`.

**5. Genuine cold traffic.** New content, an invalidation storm, or a distribution that has just been deployed. This one resolves itself and is the only cause on this list that is not a defect. Confirm it by checking whether the ratio recovers within an hour without intervention.

### 6.2 What not to do

**Do not raise the alarm threshold.** The alarm is the only early warning this architecture has for a whole class of silent regressions, and a threshold raised during an incident is never lowered afterwards.

---

## 7. When a customer reports a wrong blend page

**Who:** anyone can run steps 1 and 2. A developer for the rest.
**Executable today:** the diagnosis is. The production checks wait on a deploy.

**Treat this as the highest severity report in the product.** A wrong blend page is a correct destination failure, it fails the acceptance criterion regardless of speed, and no performance measurement will ever detect it. It also means every jar carrying that code, up to 250 units, is affected.

### 7.1 Get four facts before touching anything

1. **The blend printed on the jar**, read off the physical label.
2. **The blend named on the page** they reached, read off the screen.
3. **How they reached it: tap or QR.** This is the single most diagnostic fact, and section 7.2 explains why.
4. **The URL in the address bar**, exactly, including the part after the question mark.

### 7.2 Diagnosis, in the order that isolates fastest

**If they scanned the QR and not the tag, check the QR first and stop.** The on pack QR codes on the currently printed labels point at pages that are **not** the tap destination. That is a known open item, not a new fault. Confirm what the label's QR actually decodes to before investigating anything in the system. See the document titled "Limitations and future work", section 5.

**If they tapped, walk it in this order.** The right hand column says whether the step can be run on Tuesday 25 August 2026, because four of the five go over the network to the apex. **Corrected later that day: the apex resolves now and answers HTTP 403, with `/t/ps` answering HTTP 500. The steps still cannot be run, and the reason moved from "no answer" to "an answer from the wrong host", which is the more dangerous of the two because it produces output.**

| # | Check | How | If it fails | Today |
|---|---|---|---|---|
| 1 | Does the tag carry the right code | Read the tag with an NFC reader app and read the URL. **Do not write anything.** | The tag is mis encoded. Section 7.3, case A. | **Yes.** Needs a phone and a jar, nothing else. |
| 2 | Does the table in version control map that code to the right blend | Read `build/edge/redirect-table.json`, or run the package validator | The table is wrong. Section 7.3, case B. | **Yes**, against version control. |
| 2b | Does the **deployed** table map that code to the right blend | `GET /v1/admin/tags`, or the verification script | The table is wrong. Section 7.3, case B. | **No.** Nothing is deployed. |
| 3 | Does the deployed table match the table in version control | Compare the table digest header on any `/t/` response with what the working tree compiles to | A hand edited function is deployed. Section 7.3, case C. | **No.** Requires a deployed function to read a header from. |
| 4 | Does the redirect actually return the right `Location` | `curl -i https://treveanspice.com/t/{code}` | As case B or C. | **No.** The hostname resolves, and it returns **HTTP 500** from Bluehost rather than a 307 from anything this package deploys. **A 500 here is not evidence about the table.** Section 9.1. |
| 5 | Does the destination page name the right blend | Follow it and read the page | Section 7.3, case D. | **No**, for the same reason. Locally, `npm run build` in the pages package and read the built page. |

**Do not read a failure at step 4 as a system fault today.** A resolution error at that step is the state of the domain, not the state of the redirect. Confirm with `dig +short NS treveanspice.com` before drawing any conclusion from it.

### 7.3 The four causes and what each one costs

**A. The physical tag carries the wrong code.** The most expensive case, because it is inventory rather than configuration. Find out how many units were encoded in that run with that code. ~~Since the shipped tags are unprotected, re encoding is possible, but it is a physical operation on physical jars and it is Trevean's line rather than a keystroke.~~ **Corrected 14 October 2026: the shipped tags are write protected and nobody at Trevean holds the password (section 4, "Decision log" D45), so re encoding is not available. A mis encoded jar needs its tag replaced, which is a physical operation on physical jars and Trevean's line rather than a keystroke.** **Do not repoint the redirect table to compensate**, because that fixes the mis encoded jars and breaks every correctly encoded jar carrying the same code.

**B. The redirect table is wrong.** Cheapest case. A one character mismatch between a row's code, its URI and its target path produces a fast, successful, 200 returning page showing the wrong blend, and it passes any smoke test that checks status codes. Fix in version control, follow section 5.2, redeploy, verify with a real jar. Under a minute of propagation.

**C. The deployed function does not match the committed table.** Somebody edited the compiled artifact or deployed without the drift check. Rebuild from the table and redeploy. Then fix the pipeline, because it will happen again.

**D. The redirect is correct and the page is wrong.** Either the cache key excluded the `blend` parameter, so one blend's page is being served for another, or a page was built from the wrong content. The cache key case is the more dangerous of the two: it is silent, it affects everyone, and it only became reachable when the identifier moved from a path segment into a query parameter. Check the cache policy, fix it, invalidate.

### 7.4 After any wrong destination incident

- Record it against the affected code with date, tester and handset, in the tag record's last verified field.
- **Tap all four physical codes**, not only the one reported. The cause that produced one wrong row produces others.
- If the cause was a table edit, check whether the repoint guard was bypassed and why.

---

## 8. Encoding a new tag batch

**Who:** the M4 tooling is designed for Trevean staff, unaided, in under five minutes per batch.
**Executable today:** hand encoding a handful of sample tags, yes.

**The tool now exists, and existing is not the same as working.** `build/chip-cli` is built, its 134 tests pass, and **it has never been run against a physical tag or a physical reader.** Its reader transport, `src/transport/reader-stub.ts`, is unimplemented: everything it does is proven against a software model of the chip. The 22 August version of this document said the tool was "not built", which was wrong, and correcting that to "built" without the sentence above would be worse than the original error. **Do not encode inventory with it until a reader is chosen, the transport is implemented, and a batch has been read back off real silicon.** Section 8.3 is the specification it was built to and it is still the right specification.

### 8.1 What goes on the tag

**One NDEF record. A URI record. Nothing else.**

```
https://treveanspice.com/t/{code}
```

Lowercase. `https`, not `http`. **No `www.`** No trailing slash, no query string, no fragment, no tracking parameters.

| Code | URL | Blend |
|---|---|---|
| `ps` | `https://treveanspice.com/t/ps` | Persian Sunrise |
| `cs` | `https://treveanspice.com/t/cs` | Caribbean Sunset |
| `sr` | `https://treveanspice.com/t/sr` | The Silk Road |
| `nm` | `https://treveanspice.com/t/nm` | North African Night Market |
| `kg` | **Do not write** | Kyoto Garden. Reserved, not in this production run. |

On the chip this is a URI record with identifier code `0x04`, the standard abbreviation for `https://`, followed by `treveanspice.com/t/ps`. A 22 byte payload, roughly 30 bytes with record and container overhead, out of 256 bytes. **Capacity is not a concern and never will be. If a tool says the tag is too small, the tool has misidentified the tag.**

**If a tool offers the prefix as a dropdown, choose `https://`.** Some apps default to `http://www.`, which silently produces a different and wrong URL and still reports "write successful".

### 8.2 The manual method, and its hard limit

Documented in full in the M1 deliverable titled "Tag writing instructions, ST25TV02KC". It exists so sample jars can be built before the gate.

**If you find yourself writing more than about twenty tags by hand, stop.** Hand encoding at volume is how a wrong code reaches a shelf.

Three rules that apply to every manual write:

1. **Never press "make read only", "lock tag", "protect" or "set permanent" in a generic NFC app.** Those controls target NTAG lock bits. On a Type 5 tag they either fail confusingly or issue a generic ISO 15693 block lock, which is **permanent, cannot be undone by any password**, and is not the protection model this project uses. A tag locked that way is scrap. Anything to do with protection is done with the manufacturer's own app or the M4 tool, by somebody who was told to do it.
2. **Leave Augmented NDEF, TruST25 and tamper detect alone.** They are off by decision, not by oversight, and a tester does not relitigate that by ticking a box. See the document titled "Limitations and future work", section 2.
3. **Verify by read back on every tag**, and read the URL character by character. `treveanspice.com/t/ps` and `treveanspice.com/t/sp` look identical at a glance and differ by 250 jars.

### 8.3 What the M4 tooling does that a phone cannot

**All five of these are built and tested in `build/chip-cli`, and all five are proven against a software model of the chip rather than against a tag.** The list below is both the specification and, as of Tuesday 25 August 2026, a description of what the code does:

- **Encodes from the redirect table in version control** rather than from what somebody typed, so a code cannot be mistyped.
- **Verifies the read back automatically on every unit**, rather than relying on a person checking a string 500 times.
- **Applies the area password consistently from the secret store**, with a named holder.
- **Produces a batch record**, so which tags carry which code is a file rather than a memory. That record is also what section 4.3 needs, so a future password rotation knows which batch was written under which version.
- **Refuses to write `/t/kg`** and anything else not in the table.

**Repeatable for a 500 unit pilot batch, operable unaided by Trevean staff in under five minutes.** It is written against the ST25TV02KC memory model specifically. **It is not NTAG lock bit tooling, and nothing in the inherited scaffold contributes to it: that scaffold's entire NFC layer targets NTAG216 on ISO 14443.**

**What is not built, and it is the part that touches silicon.** `src/transport/reader-stub.ts` is unimplemented. **No reader has been chosen, so nothing in the list above has ever run against a physical tag**, and the "operable unaided in under five minutes" figure is a design target rather than an observed one. Choosing the reader is the next step, and it is also the moment this package acquires its first runtime dependency in its life, which belongs in its manifest on the day it lands. See the document titled "Third party libraries and licences", section 3.1.

### 8.4 Batch checklist

1. Confirm the table in version control is the deployed table.
2. Confirm which code and how many units, and write it down before starting.
3. Encode.
4. Read back and verify every unit.
5. Tap a sample from the batch on one iPhone with the display awake and one Android unlocked, and **read the blend name off the screen**. A page that loads is not the test. The right page is the test.
6. File the batch record, including which password version was applied, if any.

---

## 9. DNS cutover, and its rollback

**Who:** a developer, plus whoever holds registrar access, both available in the same window.
**Executable today: no, and the reason has now changed twice.** The 22 August version said it was waiting on a transfer. The transfer completed and the zone stopped answering. **Later on Tuesday 25 August 2026 the zone came back and email with it, so this is a cutover again rather than a bring up.** What blocks it now is that there is nowhere to cut over to, and one task nobody has done: exporting the zone as the rollback record. Section 9.1.

**This is the single action in this project that can strand a thousand encoded jars.** Everything in this section is shaped around that one sentence.

### 9.1 The precondition. **Read this before any other step in section 9, and check it against the state rather than against the calendar**

> **Corrected later on Tuesday 25 August 2026. The earlier version of this section said the domain returns SERVFAIL. That is no longer true, and the correction is a genuine improvement rather than a rewording.** This section is kept in its corrected form below with the superseded position marked, because a reader who saw the earlier version needs to know which sentence to trust. **The precondition is now met in part, which is a state neither the 22 August nor the earlier 25 August version of this document described.**

**Section 9 is a cutover procedure. A cutover moves a working zone from one provider to another. It is not the procedure for bringing a zone up from nothing.** For most of Tuesday 25 August 2026 the job in front of you was the second of those. **It is now the first one again, which is the job section 9 was written for.**

Run all four of these first. **Do not skip the last two. The first two are about the tags and the last two are about whether the business can receive email, and the second question outranks the first.**

```sh
dig +short NS  treveanspice.com
dig +short A   treveanspice.com
dig +short MX  treveanspice.com
dig +short TXT treveanspice.com
```

**The first two must return answers. If either returns nothing, section 9 does not apply and nothing in it should be followed.**

**What they return, verified Tuesday 25 August 2026:**

| Query | Answer |
|---|---|
| `NS` | `ns1.bluehost.com`, `ns2.bluehost.com` |
| `A` (apex) | `50.6.2.51` |
| `MX` | `smtp.google.com` |
| `TXT` | SPF present, DMARC present, and a Google DKIM selector present |

**`treveanspice.com` resolves. Email is fully restored, all four records checked.** The registrar transfer to Bluehost has completed and the zone is being answered.

**And it was answering the wrong thing. SUPERSEDED 30 September 2026: it answers correctly now, 13 of 13 checks. See the current state block in the package index.** As at August the apex returned **HTTP 403** and `/t/ps` returned **HTTP 500**, because the domain points at Bluehost rather than at the deployment that serves the site and the tag routes. **A thousand encoded jars now reach an error rather than nothing.** That is a different failure, not a fixed one.

#### What is now possible that was not

| What section 9 assumes | Position now |
|---|---|
| An authoritative zone to **export as the rollback record**, step "minus 2 days or more" in section 9.2 | **Available.** There is a zone answering at Bluehost and a console somebody can log into. **Export it verbatim before touching anything.** It did not exist a few hours ago and there is no guarantee it will exist next week, so take the export today rather than when it is needed |
| An authoritative zone to **paste the certificate validation records into**, section 9.2 and section 2.3 pass 1 | **Available.** DNS validation of an ACM certificate through the incumbent provider works again, which is the mechanism the three pass production sequence in section 2.3 rests on |
| A current nameserver to **diff the new zone against**, `zone-diff.sh` in section 9.3 | **Available. The script has a left hand side again.** It compares what the current nameserver returns against what a new one would, and both sides now exist |
| A prior resolving state to **revert to**, section 9.4 | **Available. The DNS level rollback exists again.** Reverting the nameserver set restores a resolving zone rather than an outage |
| **Email surviving the change** | **This is the one that got harder, not easier.** A few hours ago there was nothing in the zone to break. **There is now: MX, SPF, DKIM and DMARC are all live and carrying the company's mail.** Section 9.3's warning about copying them verbatim stops being a discipline and becomes the highest consequence item in the section |

#### What still is not possible, and it is more than it looks

1. **There is still no production distribution and no certificate.** ~~because there is still no AWS account other than the Organization management account. **Precondition A has not moved.**~~ **Corrected Thursday 27 August 2026: the account was never the reason. `888348806392` is the development account and a development distribution, `d1uyspgs0bmg3a.cloudfront.net`, now exists in it.** What section 9 points the zone at is a production distribution behind a certificate for `treveanspice.com`, and that does not exist. `verify-no-dns.sh` still has nothing to be aimed at.
2. **`zone-diff.sh` has a left hand side and still has no right hand side.** It compares a current nameserver against a new one. The new one is a hosted zone ~~that has not been created in an account that does not exist~~ **that has not been created**. **It is now half runnable, which is a worse trap than being wholly unrunnable**, because a half comparison looks like a result.
3. **The rollback record does not exist until somebody makes it.** DNS answering is not the same as the export being in hand. **Nothing in section 9 should be started before that file exists on disk**, and the record count in it has to be known, because `copied_zone_record_count` compares against it.
4. **What the zone should point at is not settled by this section.** There are now two candidate targets rather than one, and pointing the zone at a target that then has to change is a second flip. Section 9.1.1, and the document titled "Architecture and the reasoning behind it", section 9.1.
5. **The apex answering 403 is not a neutral holding state.** Section 9.5 says a resolving domain pointing at nothing is worse than a domain that does not resolve, because it looks like it works. **That sentence now describes the live position rather than a risk to be avoided**, and it is the argument for acting on this quickly rather than carefully waiting for the AWS environment.

#### What has to be true before section 9 is usable

1. **`dig +short NS treveanspice.com` and `dig +short A treveanspice.com` both return answers.** **MET.**
2. **A verbatim export of that zone exists as a file**, taken from the Bluehost console, before anything is changed. That file is the rollback record. **NOT MET, and it is now purely a task rather than an impossibility.** Until it exists, section 9.4's DNS level does not exist regardless of what the runbook says.
3. **The record count in that export is known**, because `zone-diff.sh` and `copied_zone_record_count` both compare against it. **NOT MET, and it follows from item 2.**
4. **There is somewhere for the zone to point.** **NOT MET for CloudFront**, which is what section 9 describes, because the distribution that exists is the development one and this section is about the production apex.

**The trap in the earlier version of this section is gone and it is worth remembering rather than deleting: the records could not be read back out of DNS, because DNS was the thing that was broken.** They can be read now. **That window is exactly why the export is taken today rather than when it is needed.** A zone rebuilt from memory fails quietly for weeks rather than obviously on day one, and the difference between having that export and not having it is a few minutes of somebody's time on a day when nothing is on fire.

**One thing that was said to whoever owns the domain and no longer needs saying: company email is working.** It was very likely not working for a period, and the four records above were checked rather than assumed. **What does need saying is that those records are now inside the blast radius of every step in this section.** The infrastructure package refuses to create a hosted zone carrying no MX records unless an acknowledgement flag is set explicitly, which puts that lesson in a precondition that fails the apply rather than in a sentence somebody skims.

**What this section still does not do, deliberately: it does not invent a procedure for a target that does not exist.** The discipline it was written with is unchanged and it applies whichever target is eventually chosen: no nameserver or record change as a side effect of an apply, a human making the change having just read a verification report, full verification with no DNS involved before anything is pointed anywhere, and the old zone left untouched for at least 14 days afterwards.

### 9.1.1 The position on the registrar, which is still current

The registrar moved from Squarespace to Bluehost. The client made the request and **the transfer has completed.** The delegation is the step that matters technically, not the registrar of record.

**Some earlier project documents state that the registrar stays at Squarespace.** That was the position on 12 August 2026 and it was superseded on 19 August 2026. If you are reading a document that says the registrar stays put, it predates the change. The reasoning in it about what a transfer costs, an ICANN window, a sixty day lock, and the risk of a nameserver gap, is still correct and still governs the discipline below.

**One thing improves under the move:** the mandatory DNS HTTPS (SVCB) record advertising HTTP/3, worth about 150 ms on the tap path, was blocked on whether the old provider supported that record type. Route 53 does, and so does the alternative interim host described in the document titled "Architecture and the reasoning behind it", section 9.1.

**One thing to decide before the zone is pointed anywhere: what serves the apex. Decided by the client on Tuesday 25 August 2026, and it is not CloudFront in the near term.** The 22 August version of this package had exactly one answer, CloudFront, ~~in an AWS account that does not exist~~ **in an AWS environment that had not been deployed. Corrected Thursday 27 August 2026: the account existed throughout, "Decision log", D32.** **The client approved serving the five tag routes from the existing Vercel project now, so the encoded jars work without waiting for the production chain.** The CloudFront design is deferred rather than deleted.

**What that means for this section, in three lines.**

1. **The near term change is a record change inside a zone that is already authoritative, not a nameserver delegation.** That is a smaller action with a shorter rollback: a record revert is minutes, a nameserver revert is bounded by a parent record lifetime of typically 48 hours. **Sections 9.2 and 9.4 describe the delegation, and the delegation is the M5 job rather than this week's job.**
2. **The eventual move to CloudFront is still coming and it is a second change to a domain that will by then be serving a thousand jars.** That is harder than the first one, which is why the interim implementation is built to make that move a deploy rather than a rebuild: it compiles from the same canonical redirect table and never copies it. **Three properties do not survive the interim host and are documented with it: query strings are appended to the redirect destination rather than dropped, the table identity header is gone, and unknown code logging is gone.** The third is the one to watch, because it is the only signal that would reveal a missing table row.
3. **Read the document titled "Architecture and the reasoning behind it", section 9.1, before pointing anything anywhere**, for the six properties an interim host has to preserve. Pointing the zone at a target that then has to change is a second flip, and a second flip is a second chance to strand a thousand jars.

### 9.2 The shape of the cutover

**Section 9.1's precondition applies to every row of this table. It is now met in part rather than not at all, and the rows below are not equally blocked.** The zone export in the first row **can and should be done today**. Everything after it waits on a target existing.

Dates are deliberately omitted. The sequence is binding, the dates are whatever the day is.

| Step | Work |
|---|---|
| **Minus 2 days or more** | Export the current zone verbatim as the rollback record. Request the ACM certificate in us-east-1 for the apex and www, and add the validation records to the **currently authoritative** zone. **Lower TTLs on any record due to change to 300, at least 48 hours before the flip.** |
| **Minus 1 day** | Build the distribution from infrastructure as code: behaviours, both origins, the edge function with the compiled table, cache policies. Attach the alternate domain names once the certificate issues. Create the new hosted zone as an exact copy plus the apex and www alias records. **No nameserver change.** |
| **Flip day, morning** | Full verification **with no DNS involved**. Section 9.3. |
| **Flip day, afternoon** | Flip the nameserver set. Watch resolution from several public resolvers. **Leave the old zone untouched from here for at least 14 days.** |
| **Flip day plus 1** | Re verify every code after publish, four of them against physical tags, on a cellular connection, on one iPhone and one Android. Record the times through the measurement harness so they are comparable with the baseline and the gate. |
| **Plus 3 days** | Soak review: cache hit ratio, error rate, no 301s, no 404s on `/t/*`, no resolution anomalies. |

**Do not flip into a weekend.** Schedule the flip so the following day is a verification and buffer day rather than the deadline itself.

### 9.3 Verification before the flip, with no DNS involved

This is where the risk is actually managed. It is all doable before a single nameserver changes.

**The two scripts are not equally available today, and the difference is worth knowing before you run either.**

```sh
./scripts/verify-no-dns.sh treveanspice.com <distribution-domain-name>
./scripts/zone-diff.sh    treveanspice.com <current-nameserver> <new-nameserver>
```

The first checks every `/t/` code for the exact 307 status, the exact `Location` string, `no-store` on the redirect, the branded 404 on an unknown code, cache key hygiene against a never before seen `utm_campaign`, and TLS 1.3. It then prints the hosts file line for a physical test phone **and stops**, because the part it cannot do is the part that matters. **It is named for what it does: it involves no DNS, so it works today against any host that answers, as soon as one exists.**

The second diffs the two zones record by record. **Compare the record counts explicitly.** If the export has 23 records and the new zone has 19, four things are about to break and no downstream check will tell you which. MX, SPF, DKIM, DMARC and every other existing record are copied verbatim with values unchanged, and email breaking on flip day is a very common and very avoidable way to make a technical cutover into a business incident.

**`zone-diff.sh` still cannot run, and what changed later on Tuesday 25 August 2026 made it more dangerous rather than less.** It takes a current nameserver and a new nameserver and compares what each returns. **The left hand side exists again**, because `treveanspice.com` resolves at `ns1.bluehost.com` and `ns2.bluehost.com`. **The right hand side does not**, because the new hosted zone ~~lives in an AWS account that has not been created~~ **has not been created. Corrected Thursday 27 August 2026: the blocker was never a missing account.**

**A script that is half runnable is a worse trap than one that is wholly unrunnable.** Run it now and it queries a real nameserver on one side and a name that does not exist on the other, and whatever it prints is not the comparison the script is for. The whole purpose of the script, checking 23 against 19, still needs both numbers. Section 9.1.

**What is worth doing today instead, and it takes minutes.** Log into the Bluehost console and **export the zone verbatim to a file.** That file is the rollback record, its record count is what `copied_zone_record_count` compares against, and **it is the one thing in this section that is available now and was not available a few hours ago.** The records could not be read out of DNS while DNS was down. That window has already closed once this month.

Then, and this is not optional:

**Tap the four physical tags on a real phone through the hosts file entry, and read the blend name off the screen.** Four codes are on real chips. The only check that closes the loop between silicon and a config file is a person tapping a jar and reading the name. **A page that loads is not the test. The right page is the test.**

Also verify the marketing site through its origin behaviour before the flip, not after. If the origin routes by `Host` header, either the apex is attached as a domain on that project so the original host can be forwarded, or the marketing site's absolute URLs need checking for breakage. It is not on the tap path, it is visible to everyone, and it belongs on the pre flip checklist.

### 9.4 Rollback

**Two levels, and they are completely different.**

**Redirect level, minutes.** Resolution is fine but a code redirects wrongly. Redeploy the function from the committed table. Propagation is under a minute. This covers almost everything that can go wrong.

**DNS level, up to 48 hours.** Resolution itself fails. Revert the nameserver set at the registrar. **Because the old zone was never edited beyond the certificate validation record and the lowered TTLs, this restores the prior state exactly.** The recovery window is bounded by the parent nameserver TTL, typically 48 hours, which is not fast and should not be described as fast.

**This is why the old zone is left intact and unedited for at least 14 days after the flip.** During the delegation overlap both nameserver sets return correct answers, so a resolver holding either one is safe. That overlap is what makes the rollback a nameserver revert rather than a zone rebuild.

~~**The DNS level does not exist today, and saying so is the whole point of this paragraph.**~~ **Corrected later on Tuesday 25 August 2026, and the correction is real rather than a softening.** Both sentences above rest on a prior state that resolved correctly, and **`treveanspice.com` resolves again**, so reverting restores a working zone rather than an outage and the delegation overlap works as described.

**The DNS level therefore exists in principle and does not exist in practice, and the gap between those two is one file.** A revert restores what the previous state answered, which is only useful if somebody knows what it answered. **The verbatim zone export has not been taken.** Until it has, plan the work as though there is no DNS rollback, because operationally there is not one, **and the fix is a few minutes in a console rather than a dependency on anybody.** The mitigation in the meantime is the pre flip verification in section 9.3, which was already carrying more weight than the rollback.

**One thing that is genuinely worse than it was.** The zone now carries live company email: MX to `smtp.google.com`, SPF, a Google DKIM selector and DMARC. **A few hours ago there was nothing in it to break.** Section 9.3's instruction to copy those records verbatim with values unchanged stops being a discipline and becomes the highest consequence line in this section, and the infrastructure package's refusal to create a hosted zone with no MX records unless an acknowledgement flag is set explicitly is that instruction enforced rather than written down.

### 9.5 One thing that must be true on the day the domain resolves

**From the moment the apex answers, any tap by anyone, Trevean staff, a co packer, a retail partner, a customer who already owns a jar, reaches the destination.**

`/blend.html` must therefore return a real branded page from the day of the flip, even if the content is interim. **A resolving domain pointing at nothing is not better than a domain that does not resolve. It is worse, because it looks like it works.**

**As of Tuesday 25 August 2026 that sentence describes the live position rather than a risk to be avoided.** The domain resolves, the apex returns HTTP 403 and `/t/ps` returns HTTP 500, and anyone tapping a jar gets an error from a host that is not part of this system. **That is an argument for acting quickly rather than for waiting carefully**, and it is the reason the interim serving arrangement was approved: the jars stop waiting on the production chain. **Corrected Thursday 27 August 2026: this read "an account that does not exist", and the account existed throughout. The argument for acting quickly is unchanged, "Decision log", D32.** **The instruction in this section is unchanged. It now applies to a change that is days away rather than to one blocked indefinitely.**
