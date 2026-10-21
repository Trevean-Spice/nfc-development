# Operations runbook

**Deliverable:** M5, "docs, runbooks"
**Written:** Friday 11 September 2026
**Audience:** whoever operates this after handover, including somebody who has never met it

This is the document that makes handover real. It says what exists, how to change
it, and what to do when it breaks. **Every failure mode in section 6 has actually
happened on this project.** None of them is hypothetical, which is why the
symptoms are quoted rather than paraphrased.

---

## 1. What exists, and where

Everything is in AWS account **888348806392**, `us-east-1`, name prefix
`trevean-dev-tsn888348`.

| Piece | What it is | Where |
|---|---|---|
| Apex distribution | CloudFront, `d1uyspgs0bmg3a.cloudfront.net` | `E26QZ5319JL742` |
| Tag and QR routes | CloudFront Function, viewer request, no origin | `/t/*` and `/q/*` |
| Blend pages | Pre rendered HTML in S3 | `trevean-dev-tsn888348-site` |
| Content API | Lambda + function URL + OAC | `content-api` |
| Scan beacon | Lambda + function URL + OAC | `scan-ingest` |
| Admin API | Lambda behind its own HTTP API | `admin-api` |
| Admin CMS | Lambda behind its own HTTP API, fronted at `/admin` | `admin-ui` |
| Publish pipeline | Fargate, always on, its own distribution | `publisher` |
| Identity | Cognito user pool | `us-east-1_WIyAUOvrg` |
| Content | DynamoDB, five tables | `…-SpiceBlends` and siblings |

**The tap path touches none of the compute.** A tap is answered by a CloudFront
Function and a static object. The API, the database and the publisher can all be
down and a customer tapping a jar still gets their page. That is the whole point
of the rendering strategy and it should survive any future change.

---

## 2. Everything is Terraform, except two things that are deliberately not

`build/infrastructure/envs/dev` is the environment. `terraform apply` there is
the normal way to change anything.

**The two exceptions, and why:**

**Lambda code.** Every function carries `ignore_changes` on `filename` and
`source_code_hash`. Terraform owns a function's identity, permissions and wiring;
the application pipeline owns its code. So an apply never reverts a deployed
build, and a deploy never widens a permission.

**The publisher image.** Same split, in the same direction.

**Consequence worth knowing:** naming a package in `tfvars` does **not** deploy
it. `readiness.application_code_deployed` reads the live `code_sha256` rather
than the variable, precisely so it cannot report "deployed" for a placeholder.

---

## 3. Deploying each piece

### The API (content, scan, admin)

```
cd build/api
node scripts/package-lambda.mjs          # prints the sha256
aws lambda update-function-code --function-name trevean-dev-tsn888348-content-api \
  --zip-file fileb://.lambda-build/api.zip
```

Repeat for `scan-ingest` and `admin-api`. **Confirm the returned `CodeSha256`
matches the sha256 the packager printed.** That is the only proof the deploy
landed.

### The tag encoding tool

```
cd build/chip-cli
npm install @pokusew/pcsclite     # optional native module, only for a real reader
npm run build
node bin/chip-cli.mjs doctor --transport reader
```

`--transport simulator` needs no hardware and writes nothing physical. **The PC/SC
transport has never been run against a physical tag**: the first person to try it
is performing the bring up in the chip tooling README, section 6.3, not routine
work. **`--protect` does not work on a real reader yet and refuses rather than
guessing**; README section 6.4 says why.

### The admin CMS

```
cd build/admin
node scripts/package-lambda.mjs
aws lambda update-function-code --function-name trevean-dev-tsn888348-admin-ui \
  --zip-file fileb://.lambda-build/admin.zip
```

The bundle carries the frozen OpenAPI document and the content package, because
the admin derives the minimum role for every operation from the contract at
startup. **If it will not start, that is the first thing to check.**

### The pages

```
cd build/web
npm run build
aws s3 sync out/ s3://trevean-dev-tsn888348-site/ --delete
aws cloudfront create-invalidation --distribution-id E26QZ5319JL742 --paths "/*"
```

Normally you do not do this by hand. Pressing publish in the admin does it
properly, and only for the objects that changed.

### The tag routes

Edit `build/edge/redirect-table.json`, then `cd build/edge && npm run build && npm test`,
then `terraform apply`. **The table is the source of truth and the function is
compiled from it.** Never hand edit the deployed function.

### The publisher

```
cd build/publisher
./scripts/push-image.sh 888348806392 us-east-1 trevean-dev-tsn888348-publisher <tag>
```

Then set `publisher_image_uri` in `tfvars` to the digest it prints and apply. The
repository has immutable tags, so pushing the same tag twice fails rather than
silently changing what a restart would pick up.

---

## 4. People and access

**Accounts live in Cognito, not in the application.** The admin reads the role
from the group on the token.

Add somebody:

```
aws cognito-idp admin-create-user --user-pool-id us-east-1_WIyAUOvrg \
  --username person@example.com \
  --user-attributes Name=email,Value=person@example.com Name=email_verified,Value=true \
  --message-action SUPPRESS
aws cognito-idp admin-set-user-password --user-pool-id us-east-1_WIyAUOvrg \
  --username person@example.com --password '<password>' --permanent
aws cognito-idp admin-add-user-to-group --user-pool-id us-east-1_WIyAUOvrg \
  --username person@example.com --group-name Editor
```

**The `--permanent` step is not optional.** Without it the account sits in
`FORCE_CHANGE_PASSWORD`, Cognito answers `NEW_PASSWORD_REQUIRED`, the admin
refuses it, and it looks exactly like a broken login.

**The groups are named `Admin`, `Editor` and `Viewer` and the names are matched
literally**, in the admin's `auth/identity.ts` and in the API's `auth/jwt.ts`.
Renaming a group silently removes everybody in it from their role.

**A user in no recognised group is refused, not admitted as a Viewer.** That is
deliberate: a Viewer can still read unpublished content.

---

## 5. Costs, and the only one that recurs

The publisher's Fargate task is **about $100 a month**, continuously, and it is
the only always on compute. Everything else is per request and rounds to a few
dollars.

`create_publisher = false` turns it off. Publishing then stops working and
nothing else does. **Dan approved this cost in writing on Monday 7 September
2026** and it is the first operating cost this engagement added.

`publisher_task_cpu` is 2048. Raising it to 4096 costs about $72 a month more.
**Measure before spending it**: the last time the render was slow the cause was
re encoding images, not the processor count, and more vCPUs would have bought
nothing.

---

## 6. When it breaks

Every one of these has happened. The symptom is quoted as it actually appeared.

### "Forbidden. For troubleshooting Function URL authorization issues"

An origin access control against a Lambda function URL needs **two** grants:
`lambda:InvokeFunctionUrl` **and** `lambda:InvokeFunction`. With only the first,
every signed request returns 403 and it reads exactly like a signing fault. Cost
half a day to find. See "Decision log", D37.

### "The request signature we calculated does not match"

CloudFront's origin access control signs the request but **not the body**. Any
POST with a body needs `x-amz-content-sha256` computed by the caller. The scan
beacon does this. **An HTML form cannot**, which is why the admin sits behind an
HTTP API rather than a function URL.

### A 500 on a route that worked yesterday

Check whether the caller is hitting `content_api` rather than `admin_api`. The
`/v1/*` behaviour on the apex distribution allows **GET, HEAD and OPTIONS only**,
deliberately, so the admin write surface is not exposed there. The admin reaches
its API directly.

### The publish takes twelve minutes

It used to. `generate-media.mjs` deleted the 122 image derivatives the container
image already carried and re encoded them all as AVIF. It now skips when they are
present. `TREVEAN_MEDIA_FORCE=1` rebuilds them when a master actually changes.

### "N of M content reads could not be shown to have come from the origin"

The publish refused because it could not prove it read fresh content. This is
working as designed: it will not publish a page rendered from a cached response.
Check that `_uncached` is reaching the API and that the `api_content` cache policy
still puts query strings in the key.

### A DNS record at Bluehost exists in the form but not in DNS

**The host field is a PREFIX.** Bluehost shows `.treveanspice.com` beside it and appends
it automatically, so anything typed in becomes a new label. Typing `www` there does not
target the www hostname, **it invents a different name**, and the form looks correct
afterwards. This cost a certificate validation on 17 September 2026: the record was
entered as `_c7232199....www` and the name ACM needed did not exist. See "Decision
log", D51.

**Always verify from a public resolver rather than the registrar's own screen:**

```
nslookup -type=CNAME <the full name> 8.8.8.8
```

### The admin renders with no styling

`public/` is missing from the Lambda bundle. It is copied by
`build/admin/scripts/package-lambda.mjs`; the API's packager has no static assets,
so this line is easy to lose if the two are ever re synchronised.

### Everything in the admin says UNAUTHENTICATED

The admin presents the Cognito id token to the API. Check `AUTH_JWKS_URI`,
`AUTH_ISSUER` and `AUTH_AUDIENCE` on the API functions. **`AUTH_AUDIENCE` is the
app client id**, because that is what Cognito puts in `aud`.

### Terraform says "Cycle:"

Something in `compute` is reading an output of `cdn`. It cannot: `compute`
produces the function URLs that `cdn` fronts. Inject the value as a variable
instead, as `admin_api_base_url` does.

### A deploy reports success and nothing changed

Compare the live `CodeSha256` against the sha256 the packager printed. They are
the only two numbers that matter and Terraform is not involved in either.

---

## 7. The things that are true and surprising

Collected because each one has already cost somebody time.

**The tag is ST25TV02KC, NFC Forum Type 5 / ISO 15693.** Not NTAG21x. Almost
every NFC tutorial online is about NTAG and does not apply.

**1,000 tags are encoded and shipped**, 250 each across `ps`, `cs`, `sr` and
`nm`. **Kyoto Garden is not encoded.** The URLs are fixed and the 307 is
unavoidable.

**The tags are write protected.** A locked NDEF area cannot be rewritten without
the ST25TV area password. **Who holds that password is, at the time of writing,
unknown**, and it is the only route to ever repointing those tags.

**Attribution is per SKU.** There is no per tag identifier and the chip UID never
reaches the page, on any handset. Anyone asking to "look up the tag UID" has
misunderstood the design.

**Screen off is zero reads on every phone**, and Android also fails when locked.
That is operating system behaviour, it is written into the acceptance criteria as
a precondition, and it is not fixable.

**On iPhone a tap never opens a page directly.** iOS raises a banner the customer
taps. No configuration removes it.

**The lid is 8 mm**, corrected from 4 mm on 12 August. Anything quoting 4 mm is
stale.

---

## 8. What this runbook does not cover yet

Written down so the gaps are visible rather than discovered.

**Shopify.** `catalog_sync` and `shopify_webhook` exist as functions with roles
and wiring and run the inert placeholder. No code, because the store access has
never arrived. M4.

**~~The analytics rollups.~~ DONE, Friday 11 September 2026.** `rollup_consumer`
is deployed and its stream event source mapping is on. **This entry was stale for
seven days and is corrected here rather than quietly deleted**, because a runbook
that describes working infrastructure as absent sends the next operator to fix
something that is not broken.

**Seeding the analytics screen for a demo.** `build/api/tools/seed-rollups.mjs`
writes synthetic rollups so the date range, granularity, per blend filter and
platform split have something to show. **Every row it writes carries
`synthetic: true`, and `--purge` removes exactly those and nothing else.**

> **AS OF FRIDAY 18 SEPTEMBER 2026 THERE ARE 3,750 SYNTHETIC ROWS IN
> `trevean-dev-tsn888348-ScanEvents`**, covering 30 days to 18 September.
> **They must be purged before anybody is shown that dashboard as real**,
> including on a screen share:
> ```
> node tools/seed-rollups.mjs --table trevean-dev-tsn888348-ScanEvents --purge
> ```

**Media derivatives.** Same shape: a function, a queue, a placeholder.

**Scan geography.** Deliberately switched off. The API drops it unless
`GEO_TRUSTED_HEADER_NAME` and `GEO_TRUSTED_HEADER_VALUE` prove the request came
through the CDN, and that pair has never been set. See "Open questions", Q31.

**The domain, and the certificate is worse than "waiting on the client".**
Everything above is on the CloudFront hostname.

**The apex certificate `b496d0b3-8dd9-4ffd-8636-dfca88415faf` is FAILED with
`VALIDATION_TIMED_OUT`**, and the validation CNAME returns NXDOMAIN, so it was
never added. **That certificate was created outside Terraform**, which is why
`terraform plan` reported "No changes" against it and would have gone on doing so
indefinitely.

**Fixed in configuration on Thursday 17 September 2026 and NOT YET APPLIED.**
`create_certificate` now exists on the stack module, separate from `manage_dns`,
because the certificate depends on neither Route 53 nor the distribution. The plan
is **1 to add, 0 to change, 0 to destroy**. Run it, read
`certificate_validation_records` from the outputs, send those to the client, and
then delete the manual certificate. See "Decision log", D49.

---

## 9. The apex cutover, and the one flag that does two things

**The certificate is `ISSUED` as of 11:49 AM on Friday 18 September 2026**,
`4a15eeeb-b752-4228-9481-3b5a6503e517`, covering `treveanspice.com` and
`www.treveanspice.com`, valid to 3 April 2027. **`InUseBy` is empty and
`attach_apex_aliases` is `false`, so it is issued and idle.**

### 9.1 Why you cannot simply flip the flag

`attach_apex_aliases = true` looks like it does one thing. **It does two**, and the
second one is not in its name. From `modules/stack/main.tf`:

```hcl
aliases             = var.attach_apex_aliases ? [apex, www.apex] : []
acm_certificate_arn = var.attach_apex_aliases ? certificate_arn : null

publisher_public_base_url = (
  var.publisher_public_base_url != null
    ? var.publisher_public_base_url
    : (var.attach_apex_aliases && var.apex_domain != null
        ? "https://${var.apex_domain}"
        : "https://${module.cdn.distribution_domain_name}")
)
```

**Attaching the aliases is harmless on its own.** CloudFront will answer for those
names, but nothing reaches it until DNS moves, so traffic is unaffected.

**The second effect is the hazard.** The same flag moves the publisher's public base
URL to `https://treveanspice.com`. **The apex currently resolves to Vercel**
(`216.150.1.1`), so the publisher would render, publish, and then verify its work
**against somebody else's website**. Depending on what Vercel returns, the publish
either fails for a reason that has nothing to do with the publish, or **passes
against content we did not write**, which is worse.

### 9.2 The safe order

**Four steps, and the first exists only to defuse 9.1.**

1. **Pin the publisher explicitly**, so the flag cannot move it:
   ```hcl
   publisher_public_base_url = "https://d1uyspgs0bmg3a.cloudfront.net"
   ```
   Apply. **Nothing changes**, because that is the value it already computes.

2. **`attach_apex_aliases = true`.** Apply. CloudFront now answers for the apex and
   `www`, the certificate attaches, and **no traffic moves** because DNS still points
   at Vercel. **Verify the distribution serves the tap path on its own hostname
   before going further.**

3. **Move DNS.** This is the client's step and the only one a customer notices.
   CloudFront has no fixed IP, so the apex needs `ALIAS` or `ANAME`, **which Bluehost
   may not offer. That question has been open since 8 September and is still
   unanswered.** If it is not offered, this becomes a nameserver migration with the
   client's Google Workspace MX records in scope, which is a different conversation
   and not a Friday job.

4. **Unpin step 1.** Remove `publisher_public_base_url` and let it compute
   `https://treveanspice.com`, which is now true. Apply.

### 9.3 What this does to the Vercel redirects

**Nothing, and they are not wasted.** Under the Option One design CloudFront answers
`/t/*` and `/q/*` itself and forwards everything else to Vercel. **Until DNS moves,
the Vercel redirects are the only thing making the jars work at all**, which is why
they were published first. After the cutover they become the fallback rather than
the mechanism.

**Do not treat step 3 as urgent because the certificate is ready.** A certificate
that sits unused costs nothing and expires in April.
