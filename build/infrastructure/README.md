# Infrastructure

**Terraform for the Trevean Spice tap-to-story MVP.**
**Written Monday 17 August 2026. Updated Thursday 27 August 2026.**
**dev is applied. staging and prod are not.**

The point of this directory is that the hour AWS access lands, we deploy rather
than start designing.

---

## Read this first

**Status as of Thursday 27 August 2026. The development environment is applied
and serving.** 169 resources in account `<TREVEAN_DEV_ACCOUNT_ID>`, distribution
`<TREVEAN_DISTRIBUTION_DOMAIN>`, all five tag codes verified end to end. The
record of it is the document titled "The deployed development environment".
Staging and production have still never been applied.

**THE ACCOUNT CORRECTION, and it is the reason this section reads differently
to the one it replaces.** From Monday 24 August to Thursday 27 August 2026 this
file said that `<TREVEAN_DEV_ACCOUNT_ID>` is Trevean's Organization **management** account.
**It is not, and the two accounts were the wrong way round:**

| Account | Name | What it is |
|---|---|---|
| `<TREVEAN_MANAGEMENT_ACCOUNT_ID>` | `Trevean Spice` | The Organization management account, `<TREVEAN_MANAGEMENT_ROOT_EMAIL>`, org `<TREVEAN_ORG_ID>` |
| `<TREVEAN_DEV_ACCOUNT_ID>` | `Trevean-NFC-Development` | **The development account**, `<TREVEAN_DEV_ROOT_EMAIL>`, and the correct target for `envs/dev` |

Verified on Thursday 27 August with `aws organizations list-accounts` and
`describe-organization`. **Everything that followed from the error is withdrawn
with it:** the state bucket `trevean-tfstate-<TREVEAN_DEV_ACCOUNT_ID>` is in the correct
account and there is nothing to move and nothing to clean up, the Development
account exists and always did, and deploying into `<TREVEAN_DEV_ACCOUNT_ID>` is the right
thing rather than the thing to avoid. **The error is kept visible rather than
erased, because the reason is worth preserving: the account was checked for
emptiness and never for name, and an inventory is not an identity check.** See
"Decision log", D32.

**What was true about the permission, and what is now true.** The login held
`PowerUserAccess`, which cannot create IAM roles, and a `terraform plan` on
Wednesday 19 August wanted 140 resources of which 24 were IAM. That constraint
was lifted on Thursday 27 August and the environment applied at 169 resources.

**`envs/dev/dev.tfplan` should still be deleted rather than trusted**, and the
reason has narrowed to one: it predates the CloudWatch Logs key policy fix in
`modules/secrets/main.tf`, without which the apply dies on the first of eight
log groups. **The "it plans into the wrong account" half of that warning was
wrong and is withdrawn.** It is also long superseded by the applied state. See
`BOOTSTRAP.md`, "What is actually true today", and note that dev and staging
both carry a required `expected_account_id` guard with no default. **The guard
stays required. What the correction changes is which id the examples name as
correct, not whether the guard exists.**

Everything here is driven by decisions already frozen in the M1 package. Where
a value came from a delivered document, the comment next to it says which
document and which section. If you are about to change something and the
comment cites a document, read that section before you change it: several of
these values are the difference between meeting a contractual acceptance
criterion and not.

**The `/t/*` CloudFront Function source is not in this directory.** It is built
under `build/edge/`, compiled from the version-controlled redirect table
described in the document titled "Data model", section 7. This Terraform reads
the built artifact and wires it to the viewer-request event on the `/t/*`
behaviour. Do not edit a redirect target here. There is nothing here to edit.

---

## What this stands up

| | |
|---|---|
| **The apex distribution** | CloudFront owns `treveanspice.com`. Three cache behaviour classes and two origins: `/t/*` answered by a CloudFront Function at viewer request with no origin, `/blend.html` and the application assets from AWS, everything else proxied to the existing Vercel marketing site as the default origin. |
| **The cache key** | Path plus the `blend` query parameter. `via` and every `utm_*` parameter are neither in the key nor forwarded. Fragmenting the cache per code is a stated failure, not a tuning preference. |
| **DNS and TLS** | Route 53 hosted zone created as an exact copy of the existing zone before any delegation, plus apex and www ALIAS records. ACM certificate in us-east-1, DNS validated, issued and attached before any nameserver change. |
| **The five tables** | `SpiceBlends`, `ScanEvents`, `Recipes`, `Growers`, `NFCTags`, with the key schema and indexes from the data model. Plus the ScanEvents stream and the rollup consumer's event source mapping, filtered to INSERT only with a `pk` prefix of `EVT#`. |
| **Media** | Presigned-upload originals bucket so a large photograph never passes through an application function, a derivatives bucket, the derivative queue, and a media distribution. |
| **The render cache** | Shared object storage plus a shared index, because the local-filesystem default is the most common serious mistake in this stack and it is invisible until it is an incident. |
| **IAM** | Eight functions, eight roles, eight policies. No shared execution role, no wildcard on a table, a bucket or a secret. |
| **Secrets** | Managed store, containers only, values set out of band. Including the ST25TV02KC area password with a named holder and a documented rotation path. |
| **Alarms** | Error rate, function failures, DynamoDB throttling, and cache hit ratio. The last one is not optional. |
| **Three environments** | dev, staging on infrastructure we control, production on Trevean's account. |

---

## Layout

```
build/infrastructure/
  README.md                      this file
  ADR-001-terraform.md           why Terraform, and what we do instead if
                                 the audit finds AWS CDK
  MANIFEST.md                    providers and modules with licences, for the
                                 background IP obligation
  BOOTSTRAP.md                   remote state, per account
  scripts/
    verify-no-dns.sh             the "verify with no DNS involved" step
    zone-diff.sh                 record-by-record zone comparison
    export-zone.md               how to export the current zone verbatim
  modules/
    stack/                       composes an entire environment
    cdn/  certificate/  dns/  data/  render_cache/  media/  compute/  secrets/
    observability/
    publisher/                   WHERE THE RENDER RUNS. Added Fri 4 Sep 2026.
                                 A small always on Fargate service, its VPC, its
                                 load balancer, its own small distribution and
                                 its image repository. Off by default: it is the
                                 first thing here that costs money continuously.
  envs/
    dev/  staging/  prod/        thin root modules, one tfvars each
```

Each environment is a thin wrapper over one shared `stack` module, on purpose:
the difference between staging and production should be a tfvars file a
reviewer can read in one sitting, not three directories that have drifted apart
since August.

---

## Day one: the exact command sequence

### Before anything

```sh
terraform version    # needs 1.10 or later. Native S3 state locking.
aws sts get-caller-identity    # confirm WHICH ACCOUNT you are in, first
```

### 1. Bootstrap remote state, once per account

Six commands, in `BOOTSTRAP.md`. A configuration cannot create the bucket that
holds its own state, so this part is manual and it is twenty minutes.

### 2. Stand up staging, which needs neither Trevean's account nor their domain

This is the one to run first, and it can be run today.

```sh
cd build/infrastructure/envs/staging

cp backend.hcl.example backend.hcl
# edit backend.hcl: set the state bucket name

cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars: set expected_account_id to the account you intend to
# deploy into, and name_prefix to something globally unique. Those are the two
# values staging needs to deploy. expected_account_id has no default, so a
# plan without it fails rather than deploying wherever the ambient credentials
# point, which on this project is Trevean's development account <TREVEAN_DEV_ACCOUNT_ID>.
# Staging belongs in an account we control, so that is the wrong place for it.

terraform init -backend-config=backend.hcl
terraform fmt -check -recursive ../..
terraform validate
terraform plan -out=staging.tfplan

# READ THE PLAN. Then:
terraform apply staging.tfplan

terraform output readiness
```

`readiness` prints what is and is not real in the environment. On the first run
`edge_redirect_is_real` will be false unless `build/edge/` has already produced
an artifact, and staging refuses to deploy a placeholder, so the apply will
fail at the precondition with an explanation. That is deliberate: staging is
where the 2.0 second budget is measured before the domain exists, and measuring
against a placeholder measures nothing.

### 3. Production, run 1: Tuesday 18 August

Creates the certificate and the hosted zone. **Changes no nameserver.**

```sh
cd build/infrastructure/envs/prod

cp backend.hcl.example backend.hcl        # bucket in TREVEAN's account
cp terraform.tfvars.example terraform.tfvars

# Fill in, in this order:
#   expected_account_id   the guard that stops an apply landing in the wrong account
#   name_prefix
#   copied_zone_records   from scripts/export-zone.md. Do not hand type it.
#   manage_dns = true

terraform init -backend-config=backend.hcl
terraform plan -out=prod-run1.tfplan
terraform apply prod-run1.tfplan

terraform output certificate_validation_records
terraform output copied_zone_record_count
```

Then, by hand:

- **Paste the validation records into the registrar hosted zone**, while it is still
  authoritative. Route 53 cannot validate a zone it is not yet answering for. Per D16 that
  registrar is Squarespace until the Bluehost transfer confirms and Bluehost after it.
- **Compare `copied_zone_record_count` against the export.** If the export has
  23 records and Terraform copied 19, four things are about to break and no
  downstream check will tell you which.
- **Lower TTLs at the registrar to 300** on any record due to change. At least 48
  hours before the flip.

### 4. Production, run 2: Wednesday 19 August

```sh
# terraform.tfvars: wait_for_certificate_validation = true
terraform plan -out=prod-run2.tfplan
terraform apply prod-run2.tfplan          # blocks until ACM reports ISSUED

terraform output certificate_status       # must read ISSUED
```

### 5. Production, run 3: Wednesday 19 August, after ISSUED

```sh
# terraform.tfvars: attach_apex_aliases = true
terraform plan -out=prod-run3.tfplan
terraform apply prod-run3.tfplan

terraform output distribution_domain_name
terraform output verify_command
```

**Still no nameserver change.**

### 6. Thursday 20 August, morning: verify with no DNS involved

Not a Terraform run.

```sh
cd build/infrastructure
./scripts/verify-no-dns.sh treveanspice.com <distribution-domain-name>
./scripts/zone-diff.sh treveanspice.com <current-nameserver> <route53-nameserver>
```

The verification script checks all five `/t/` codes for the exact 307 status,
the exact `Location` string, `no-store` on the redirect, the branded 404 on an
unknown code, cache-key hygiene against a never-before-seen `utm_campaign`, and
TLS 1.3. Then it prints the hosts file line for a physical test phone and stops,
because **the part it cannot do is the part that matters**: four of the five
codes are on real chips, and the only check that closes the loop between
silicon and a config file is a person tapping a jar and reading the blend name
on the screen. A page that loads is not the test. The right page is the test.

Five codes, four physical tags. `/t/kg` is reserved and no tag in this
production run carries it. Do not spend the morning looking for a Kyoto Garden
jar.

### 7. Thursday 20 August, afternoon: the flip

**Not a Terraform run, and deliberately not one.**

```sh
terraform output route53_name_servers
```

A human types those four nameservers into the registrar of record, having just read a
verification report. It is the single action in this project that can strand
1,000 encoded jars, and it should never be a side effect of an apply.

Then watch resolution from several public resolvers, and **leave the registrar hosted
zone untouched from here for at least 14 days.** That is what makes the
rollback a nameserver revert rather than a zone rebuild.

### 8. After the flip, once resolution is confirmed

```sh
# terraform.tfvars: manage_validation_records_in_route53 = true
terraform apply
```

So renewals validate automatically and the certificate does not silently fail
to renew in December.

---

## Two things that are deliberately not automated

**The nameserver change.** Step 7. See above.

**Attaching functions to their event sources.**
`enable_rollup_event_source_mapping` and `enable_media_event_source_mapping`
default to false and stay false until real application code is deployed. A
placeholder attached to a live stream fails every batch, fills the dead letter
queue, and produces an alarm storm on day one.

---

## The two gaps that stop this serving traffic

**Added Tuesday 25 August 2026, from the adversarial review of this package
(findings F13 and F14). Both are named work that does not exist yet, in this
directory or anywhere else, and neither is a bug in what is here.** They are
recorded here rather than only in the review because everything else in this
README reads as though deploying real function packages is the last step, and
it is not.

`terraform output readiness` now prints both of them, as
`functions_have_an_http_invoke_path` and `blend_html_can_be_published`, both
permanently false until the work below is done.

**1. No function has an HTTP invoke path. CLOSED IN CODE ON THURSDAY 27 AUGUST
2026, AND NOT YET APPLIED.** The rest of this item is kept because it describes
what was wrong and what the fix has to satisfy.

*The gap as it stood:* there was no API Gateway, no Lambda function URL and no
`aws_lambda_permission` anywhere in this package. The distribution's six
ordered behaviours plus the default covered the CloudFront Function on `/t/*`
and `/q/*`, the S3 origin on `/blend.html` and the three asset patterns, and
Vercel on everything else. None of them targeted a function. So
`POST /v1/scan-events`, the single request a customer's phone triggers on the
tap path, had nowhere to arrive.

*What was built:* a **Lambda function URL** on `content_api` and on
`scan_ingest`, `AWS_IAM` authorisation, invoked only by
`cloudfront.amazonaws.com` scoped to this distribution's ARN, reached through a
CloudFront origin access control of type `lambda`. Two new ordered behaviours,
`/v1/scan-events` before `/v1/*`, on the existing distribution, so the API is
on the same origin as the blend page and the beacon's POST is same origin with
no CORS preflight. The argument for a function URL rather than API Gateway is
in `modules/compute/main.tf`, next to the resources, and the ordering
requirement is in `modules/cdn/main.tf` next to the behaviours.

*Three things that changed elsewhere as a consequence, all of them commented in
place:*

- **`STAGE` is now set on every function.** It was not, and unset it defaults
  to `local` in the application, which is the value that enables the symmetric
  development bearer token. A function URL plus an unset `STAGE` would have put
  that path on the internet.
- **`web_renderer` is now its own `aws_lambda_function` resource**, with a
  `moved` block. It is the only function whose environment reads the
  distribution id, and with all eight in one `for_each` that single reference
  made every function downstream of the distribution while the distribution was
  downstream of two of them. Terraform builds its graph per resource, not per
  instance, so that is an unresolvable cycle.
- **`functions_still_on_placeholder` is now read from each function's live
  `code_sha256`**, not from the keys of `var.function_packages`. Every function
  here carries `ignore_changes` on `filename` and `source_code_hash`, so naming
  a package in a tfvars file never deployed it and a package deployed by the
  application pipeline never appeared in tfvars. The old output could report
  "code deployed" for eight placeholders.

*What has NOT happened:* no `terraform apply`. The configuration passes
`terraform fmt -recursive` and `terraform validate` and has not been planned or
applied against AWS, because the development account credentials expired before
the plan ran. `readiness` in the deployed environment therefore still reads
`functions_have_an_http_invoke_path = false`, and that is the truth: the
environment is unchanged. See the document titled "The deployed development
environment", section 7.

**2. Nothing can publish `/blend.html` into the origin bucket. CLOSED IN CODE
ON FRIDAY 4 SEPTEMBER 2026, AND NOT YET APPLIED.** The permission half closed
earlier the same day; the half that took a decision was where the render runs,
and that is now `modules/publisher`. The rest of this item is kept because it
describes what was wrong and what the fix had to satisfy.

*What was built:* a **small always on container on Fargate**, one task, running
the pipeline in `build/publisher` exactly as it was written, tested and
measured. Its own VPC, an Application Load Balancer whose only ingress is the
CloudFront origin-facing prefix list, and its own small distribution in front of
that. It assumes the `web_renderer` role rather than a new one, because the
permissions were settled before the host was. `revalidation_webhook_url` is
derived from it, so it is no longer null by necessity: null now means either
`create_publisher` is false or no image has been pushed, and `readiness`
reports which.

*Why not a Lambda, in one line each, with the full argument at the top of
`modules/publisher/main.tf` and in `build/publisher`'s README, section 8:*
Lambda freezes the execution environment when the handler returns, and the
pipeline answers 202 and renders afterwards because the API's dispatch aborts
at 2000 ms; its job status is served from memory and a Lambda instance has no
address; and `aws_lambda_function.web_renderer` was 30 seconds against a render
measured in minutes. **Raising the timeout would not have fixed it and would
have hidden it.**

*What it costs:* about $100 a month in us-east-1, continuously, in the
client's account: $72 the task, $17 the load balancer, $11 three public IPv4
addresses. **`create_publisher` therefore defaults to false in all three
environments.** Nothing here appears on an invoice because somebody ran an
apply.

*The gap as it stood:* the `cdn`
module creates the site bucket that the `/blend.html`, `/_next/*`, `/assets/*`
and `/images/*` behaviours point at. The only `s3:PutObject` grant against that
bucket in this package was `media_derivatives` on `images/*`. `web_renderer` had
no permission on it at all, and no CI identity was defined here.

The consequence is the one this package's own cutover notes warn about: a
resolving domain pointing at nothing is worse than a domain that does not
resolve, because it looks like it works. After delegation the apex would answer
`/t/ps` with a correct 307 to `/blend.html?blend=persian-sunrise&via=nfc`, and
CloudFront would return a 403 from an empty bucket. Every check in
`verify-no-dns.sh` passes on the way to that, because it asserts the redirect
and the cache key, not the page.

The publish step is also where the `Cache-Control` header on `/blend.html` has
to be set, per the redirect-serving decision, section 5, "Cache-control". It is
object metadata and no CloudFront setting substitutes for it.

~~**Neither gap is fixed by inventing an architecture here.** Both need a
decision about ownership first, and that decision is not this package's to
make.~~ **Both are now closed in code and neither is applied.** The decision
that gap 2 was waiting on has been taken, priced and written down rather than
left open, and the price is the part that still needs Dan: it is an operating
cost he carries after handover, so it is agreed before it appears rather than
after.

---

## Where production applies run from, and the honest answer for this week

This week they run from a workstation, against a plan that has been read. There
is no CI pipeline yet because there is no repository access yet.

That is acceptable for a cutover week and it is not acceptable as a permanent
arrangement. Moving production applies into a pipeline, with the plan posted for
review and the apply gated on approval, is a handover item and it is named in
`ADR-001-terraform.md`, section 7, as something this ADR does not decide.

---

## Things that will bite

**1. The chip is ST25TV02KC: NFC Forum Type 5 / ISO 15693.** Not NTAG21x /
Type 2. Different air interface, different memory model, area-based 64-bit
password protection rather than lock bits. This has already been mis-assumed
once on this project. It matters here in one place, the tag password secret,
and the rotation path in `modules/secrets/main.tf` depends on it.

**2. The redirect status is 307, exactly.** Not 301, not 302. A 301 is cached by
browsers and intermediaries, in some cases indefinitely, which would make the
destination permanently un-editable on every device that had ever tapped a jar.
That destroys the entire reason the redirect exists. `verify-no-dns.sh` asserts
it.

**3. The 307 target is a same-origin relative path.** Not an absolute URL, not a
different hostname. A hostname change costs a fresh DNS lookup plus a fresh TCP
and TLS handshake, an estimated 300 to 600 ms on cellular, against a 2.0 second
budget. This is why tap-path image derivatives are published into the AWS origin
bucket under `images/` rather than served from the media distribution.

**4. The stream filter is not optional.** Rollup writes land in the same
DynamoDB stream that triggers them. Without the INSERT-only, `EVT#`-prefix
filter it is an infinite loop that will happily bill for itself. It is in
`modules/compute/main.tf` and it is commented at length because it is the single
thing most likely to be dropped when someone re-implements this from a summary.

**5. `CacheHitRate` needs the monitoring subscription.** It is a CloudFront
additional metric. Without `aws_cloudfront_monitoring_subscription` it is never
published and the alarm sits in `INSUFFICIENT_DATA` forever, which looks exactly
like health.

**6. Alarms need a confirmed subscriber.** Each email address gets a
confirmation link a human has to click. `terraform output
alarm_recipients_status` says whether anyone will actually receive anything.
Confirm them before the flip, not during an incident.

**7. Terraform does not own application code.** Every function carries
`ignore_changes` on its package, so an apply never reverts a deployed build. The
corollary is that a fresh apply into an empty account leaves eight functions
answering 501 until the application pipeline runs.
`terraform output functions_still_on_placeholder` lists them.

**8. Geography is off until a trusted header pair is configured, and it is
silent about it. Added Thursday 27 August 2026.** The API derives country,
region and city from CDN viewer headers. Those headers are only true for a
request that genuinely arrived through CloudFront: a request that reaches the
origin directly carries whatever headers its sender chose, and the scan beacon
is unauthenticated by necessity, so "whoever asks" is the entire internet. The
API therefore reads viewer geo headers **only** on a request carrying a header
pair that CloudFront adds to the origin request and a viewer cannot forge. The
pair is named by two environment variables on the API,
`GEO_TRUSTED_HEADER_NAME` and `GEO_TRUSTED_HEADER_VALUE`, and **both** have to
be set: with either one missing the API treats the pair as unconfigured.

**Unconfigured, geography is read on stage `local` and is dropped everywhere
else.** That is the correct direction to fail, because outside local an
unverified geography is an attacker's geography and no geography is better than
a poisoned one, and two concrete poisonings were measured before the gate
existed: `#` is the separator in the rollup geography sort key, so a region
containing it wrote an arbitrary place name into the rollup the dashboard
displays, and with the city attacker controlled the number of rollup rows per
blend per day was bounded only by the caller's request budget.

**But it fails closed silently.** Nothing errors, no alarm fires, and the only
symptom is a dashboard whose geography is permanently empty, which looks
identical to a product nobody has tapped yet.

**Two halves, and neither works alone.** The Terraform in this directory does
**not** set the header today: the `cdn` module attaches a response headers
policy carrying `x-trevean-env` to the viewer, which is a different thing and
does not satisfy this. What is needed is a `custom_header` on the AWS origin in
`modules/cdn/main.tf`, and the same name and value passed to the API function
as environment. Treat the value as a secret: anyone holding it can forge
geography by calling the origin directly.

Until both halves are done, say "geography is not enabled yet" rather than
letting an empty map read as a finding.

---

## What is still needed from Trevean

Ordered by what blocks soonest. Every one of these already appears in a
delivered document; this is the infrastructure-side restatement.

| # | Needed | For | By |
|---|---|---|---|
| 1 | **AWS account usable**, or the standing offer to configure it accepted | Everything in `envs/prod` | Tue 18 Aug |
| 2 | **DNS access at the registrar of record**, or a named person available Wednesday and Thursday | The zone export, the validation records, the flip | Tue 18 Aug |
| 3 | **Approval of the nameserver delegation to Route 53.** **Corrected Saturday 22 August 2026:** this row said registration stays at Squarespace. **D16, taken Wednesday 19 August 2026, supersedes D14.** The transfer of `treveanspice.com` to Bluehost is in flight and is the agreed position, and the nameservers point at Route 53 on completion. The delegation itself is still not a registrar transfer. Per D22 the domain had not moved as at Saturday 22 August 2026, and Bluehost's confirmation is outside both parties' control | The flip | **Was Tue 18 Aug. Now dependent on Bluehost's confirmation, with no committed date** |
| 4 | **A named holder for the tag password**, one person | `tag_password_holder` | Before M2 |
| 5 | **Alarm recipients** | `alarm_email_addresses` | Before the flip |
| 6 | **Vercel project access**, and who owns the marketing deploys | The default origin, and the Host-header arrangement | Wed 19 Aug |
| 7 | ~~**Repository access**~~ **Closed, and it was never outstanding on Trevean.** Access landed on Monday 10 August 2026 and was confirmed in writing the same evening (D15); the audit ran on Wednesday 19 August 2026 (D19) and closed Q13 through Q17 and the repository half of Q18. This row contradicted the status note at the top of this file | Closed | **Closed** |

---

## Validation status

`terraform fmt -check -recursive` and `terraform validate` were both run again
on this machine on **Friday 4 September 2026** with Terraform 1.15.2, AWS
provider 5.100.0 and archive provider 2.8.0, after the publish pipeline module
was added. Formatting is clean and all three environments validate, with
`create_publisher` false and with it true.

**One thing validate caught that is worth recording, because it is the same
class of error as the one documented beside `local.renderer_key` and it is
about to be made again by somebody.** The first wiring of the publish pipeline
read `one(module.publisher[*].revalidate_url)`. A splat reads the module as a
whole, which makes the expression depend on the module's close node and
therefore on every resource in it, including the ECS task definition, which
reads the apex distribution's id, which is downstream of the pooled Lambda
functions, one of which is the function consuming the expression. Terraform
printed it as a 30 node cycle. **The fix is an explicit index to one output**,
and it is commented in `modules/stack/main.tf` where the expression is.

**That is a syntax and type check, not a deployment**, and the two are now in
different places for different environments.

- **dev has been applied**, on Thursday 27 August 2026, into `<TREVEAN_DEV_ACCOUNT_ID>`. It
  is the only environment where anything here is a statement about a running
  system rather than about code. The three defects the first apply found are
  recorded in "The deployed development environment", section 4, and none of
  them was catchable by `plan`.
- **staging and production have never been planned or applied.** The first plan
  in either will surface things validation cannot: name collisions on globally
  unique S3 buckets, service quotas, and whatever exists already. Expect the
  first production plan to need adjusting, and read it rather than applying it.
