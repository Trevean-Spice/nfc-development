# The deployed development environment

**Deployed Thursday 27 August 2026.** First real deployment of this engagement.

**Account:** `888348806392`, `Trevean-NFC-Development`, in Trevean's organisation `o-q36zht9ztn`.
**Distribution:** `d1uyspgs0bmg3a.cloudfront.net`, id `E26QZ5319JL742`.
**State:** `s3://trevean-tfstate-888348806392/trevean-spice-nfc/dev/terraform.tfstate`, versioned and encrypted.
**Resources:** 169 in state.

---

## 1. The account correction that preceded this

**We had the two accounts the wrong way round for a week**, and it is worth recording because it cost the week.

| Account | What it actually is |
|---|---|
| `[account id withheld]` | `Trevean Spice`. The organisation management account, `aws-root@treveanspice.com` |
| `888348806392` | `Trevean-NFC-Development`. The development account, `aws-dev@treveanspice.com` |

The record had these reversed from Monday 24 August to Thursday 27 August. The client described his estate as having only a management account with an empty Development OU, credentials arrived for `888348806392`, and the two were assumed to match. They did not.

**What it cost:** a week of not deploying into an account that was correct all along, advice to the client to create an account that already existed, and a commitment in a draft message to move work off "your main account" when it was already in the right place.

**What would have caught it:** one `aws organizations describe-organization` call, or an `iam list-account-aliases` lookup. The account was checked for emptiness and never for identity. **A resource inventory is not an identity check.**

---

## 2. What is deployed and working

**The tap path resolves end to end on real AWS.** Verified against the live distribution on Thursday 27 August 2026:

| Code | Result |
|---|---|
| `/t/ps` | 307, then 200, Persian Sunrise |
| `/t/cs` | 307, then 200, Caribbean Sunset |
| `/t/sr` | 307, then 200, The Silk Road |
| `/t/nm` | 307, then 200, North African Night Market |
| `/t/kg` | 307, then 200, branded "Jar not recognised". Correct: reserved, no tags, no page |
| `/q/ps` `/q/cs` `/q/sr` `/q/nm` | Same pages as the tap, carrying `via=qr` |

Also deployed: five DynamoDB tables plus the rollup store, the render cache bucket and index, the media originals and derivatives buckets, eight Lambda roles and policies, 37 CloudWatch alarms, the KMS key with its logs policy, and five Secrets Manager containers holding no values.

## 3. What is deployed and NOT working, stated plainly

**Still accurate as at the end of Thursday 27 August 2026.** Section 7 records
work done later the same day that changes the Terraform and does not change
this environment, because it was never applied.

The `readiness` output is deliberately blunt and currently reads:

```
edge_redirect_is_real              = true
application_code_deployed          = false
functions_have_an_http_invoke_path = false
blend_html_can_be_published        = false
rollup_pipeline_live               = false
derivative_pipeline_live           = false
alarms_have_a_recipient            = false
serves_apex_domain                 = false
```

**So: the pages serve, and nothing else does.** No function has an HTTP front door, so the API, the admin and the scan beacon endpoint are not reachable. The alarms exist and have nowhere to send. Nothing points at `treveanspice.com`, which still answers from Bluehost.

**The pages were published by hand**, with `aws s3 sync`, immutable caching on assets and sixty seconds on documents. `blend_html_can_be_published` stays false because there is no automated publish path, and a hand sync is not one.

## 4. Three defects the first apply found, none of which `plan` could catch

Each is fixed with a comment recording that it was observed on the first real apply, so it is not tidied back.

**Commas in tag values.** AWS tag values accept only letters, digits, spaces and `+ - = . _ : / @`. Five Secrets Manager secrets carried rotation procedures as prose tags, and two DynamoDB tables carried `AccessPatterns = "1,2,8"`. The error names the tagging service rather than punctuation. Prose now lives in the secret description, which takes 2048 characters, and tags carry short slugs. The client supplied holder name is sanitised, because a nomination like "Dan Blizinski, Trevean Spice" would fail identically.

**A cache policy with caching disabled.** With all three TTLs at zero, CloudFront rejects any header, cookie or query string behaviour other than `none`, and reports them one at a time. Nothing is lost: what reaches Vercel is set by the origin request policy, which is unchanged.

**A rewrite onto a page that does not exist.** See below.

## 5. The `/blend.html` rewrite, and the defect it introduced then caught

The redirect sends a tap to `/blend.html?blend={slug}`. The origin is a bucket, and **a bucket does not vary its answer by query string**, so without a rewrite every code lands on the same document: the "jar not recognised" page. A fast, correct looking 200 that is wrong for every blend, which is exactly what the adjacent jar test exists to catch.

A CloudFront Function now rewrites `/blend.html?blend={slug}` onto the pre-rendered document, compiled from the same canonical redirect table as the `/t/` and `/q/` function. It matches against an allowlist rather than interpolating the slug into a path, so a crafted slug cannot reach an arbitrary object.

**The first version was wrong**, and the live test found it. It allowlisted every slug in the table, including Kyoto Garden, which is reserved and has no built page. `/t/kg` returned a raw 403 from the origin, which is an unbranded error on a customer's phone and is what SOW section 6.3 forbids.

**The fix is the intersection of the table and the pages that exist**, and it fails loudly in the dangerous direction: if a code with `status: encoded` has no built page, the build now refuses, because that is physical jars in the field resolving to nothing. A reserved code with no page is harmless and falls through to the branded document.

**A distribution wide custom error response was considered and rejected.** It would also intercept the marketing site's own 404s coming back from the Vercel origin and replace them with an application page, which is a visible brand failure introduced to solve a problem the functions already solve on the paths that have the requirement.

## 6. What this does and does not change

**It does not move the M2 gate.** The gate is the tap through run on Trevean materials by Trevean staff, and it waits on a named tester, the scope decision and physical materials. None of those is affected.

**It does not change the Vercel plan.** Serving the tag routes from Vercel remains the fastest route to working jars on the real domain, because it needs no certificate and no nameserver change. This environment is where the 2.0 second budget gets measured and where the API and admin will deploy.

**It does close the largest engineering unknown.** Until today the infrastructure had never been applied, so every claim about it was a claim about code rather than about a running system. It now runs, and the three defects above are the evidence that applying it was worth doing before the date depended on it.

---

## 7. The HTTP invoke path: written, validated, not applied

**Added later on Thursday 27 August 2026. Read the heading literally.** The
work below exists in `build/infrastructure` and in `build/api`. It has not been
planned or applied against AWS, so **nothing in sections 2 and 3 has changed**
and `readiness` in the deployed environment still reads
`functions_have_an_http_invoke_path = false` and
`application_code_deployed = false`. Those two flags are correct. The gap they
describe is closed in code and open in the account.

**Why it stopped where it did.** The credentials for account `888348806392`
expired between `terraform validate` and `terraform plan`. `aws sts
get-caller-identity` returned `ExpiredToken`, and no apply, no code deploy, no
seed and no live test were attempted after that point. What is written below as
built is built and checked locally; nothing below is reported as observed in
AWS, because none of it was.

### 7.1 The invoke path, and why a function URL

**A Lambda function URL on `content_api` and on `scan_ingest`, not an API
Gateway.** The full argument is in `modules/compute/main.tf` next to the
resources. In short:

- **The tap path rules do not decide it.** The 307 is a CloudFront Function at
  the edge and the page is a pre-rendered object, so neither touches this front
  door. The only thing behind it on a tap is the beacon, and the beacon fires
  after paint. Latency here is quality of service, not an acceptance criterion.
- **`navigator.sendBeacon` is satisfied by neither option and by the routing.**
  sendBeacon cannot set a header and cannot carry a credential, and a
  cross-origin `application/json` POST would earn a CORS preflight, which is a
  second round trip on the tap path. Putting `/v1` on the **same distribution
  as the blend page** makes the request same origin, so there is no CORS to
  configure at all. That is a behaviour decision, not a gateway feature.
- **Cost is not the deciding factor and is recorded so it is not reopened as
  though it were.** An HTTP API is $1.00 per million requests on top of Lambda.
  At 1,000 encoded jars that is cents a year.
- **Surface decides it.** An HTTP API is an api, a stage, an integration, a
  route, a permission and an access log group, plus a second routing table to
  keep in step with Fastify's. Its throttling is not load bearing, because the
  frozen API contract, section 9, puts rate limiting at the CDN and WAF. Its
  JWT authorizer is not load bearing, because admin tokens are verified in
  process. Its custom domain support is not needed, because CloudFront already
  owns the domain. Every feature that would pay for the surface is already
  provided somewhere else, so the smaller thing wins.

**The URL is not public.** `authorization_type` is `AWS_IAM` and the only
principal permitted to invoke it is `cloudfront.amazonaws.com`, scoped to this
distribution's ARN. CloudFront reaches it through an origin access control of
type `lambda` and signs each origin request with SigV4, the same arrangement
already used for the S3 origin. A function URL left on `NONE` would be a second
front door on `*.lambda-url.amazonaws.com` that bypasses the CDN and every rate
limit the contract places at the edge, on the one endpoint that is
unauthenticated by necessity.

**Two functions, two URLs, and that is the IAM design rather than an
oversight.** `scan_ingest` can `PutItem` an `EVT#` item into `ScanEvents` and
can do nothing else; `content_api` can read three content tables and can write
nothing. Serving the beacon from the content function would mean granting the
content function a write on `ScanEvents`, collapsing the two smallest
permission sets in the system into one. Both functions run the same package.

### 7.2 The two new CloudFront behaviours

| Order | Pattern | Origin | Methods | Cached |
|---|---|---|---|---|
| before | `/v1/scan-events` | `scan_ingest` function URL | all seven, because POST exists only in CloudFront's widest method set | **No.** Managed-CachingDisabled |
| after | `/v1/*` | `content_api` function URL | GET, HEAD, OPTIONS | Yes. Own policy, query strings **in** the key |

**The order is load bearing.** CloudFront takes the first ordered behaviour
that matches. Below `/v1/*` the beacon would land on the read-only function,
which is an IAM denial on every tap and a scan count of zero with nothing
saying so.

**The cache key is the opposite of `/blend.html`, deliberately.** On the page a
query parameter is attribution and putting it in the key fragments the cache.
On `/v1` a query parameter selects the resource: `?include=grower,recipes`
returns a different document, and `?status`, `?limit` and `?cursor` each return
a different page of a different list. Dropping them would serve one caller
another caller's answer.

**Restricting `/v1/*` to read methods is a narrowing, not an omission.** It
means a POST to `/v1/admin/blends` through this distribution is refused by
CloudFront and never reaches a function. **The admin API still has no front
door**, and that stays a separate decision: origin access control signing
replaces the `Authorization` header on the origin request, which is
incompatible with the bearer token admin auth uses, and that is a thing to
design rather than to discover.

### 7.3 Three consequential changes made along the way

**`STAGE` is now set on every function, and it was a real hole.** The
application reads `STAGE` as an exact string and every development affordance
is gated on it: unset it falls back to `local`, which is the value that accepts
a symmetric development bearer token. Eight functions were deployed on 27
August with no `STAGE`. It did not matter while nothing could reach them. It
would have mattered the moment one had a URL. Deployed environments now get
`staging`, or `production` on prod. `dev` is not one of the three values the
application recognises, so it is translated rather than passed through.

**`web_renderer` is now its own Terraform resource, with a `moved` block.** It
is the only function whose environment reads the CloudFront distribution id.
With all eight in one `for_each`, that single reference made every function
downstream of the distribution, while the distribution was now downstream of
two of them for their URLs. Terraform builds its graph per resource rather than
per instance, so that is a cycle, and it is not resolvable by reordering. The
split cuts the edge exactly where it exists. Roles, policies, log groups and
readiness accounting still come from one eight-entry map, so "eight functions,
eight roles, nothing shared" is unchanged as a statement about permissions.

**`functions_still_on_placeholder` is now measured, not asserted.** It used to
be derived from the keys of `var.function_packages`, which made it a fact about
a variable rather than about the environment, and every function carries
`ignore_changes` on `filename` and `source_code_hash`, so naming a package in
tfvars never deployed it and a package deployed by hand never appeared in
tfvars. It could report "code deployed" for eight placeholders. It now reads
each function's live `code_sha256` and compares it to the placeholder
archive's. `readiness.functions_have_an_http_invoke_path` is likewise computed
now, from both halves: function URLs **and** the CloudFront behaviours in front
of them, because either alone is a door with no corridor.

### 7.4 The deployment package

`build/api/scripts/package-lambda.mjs` builds it. **No new dependency.**
`@fastify/aws-lambda` was already declared in `MANIFEST.md` as MIT and already
used by `src/lambda.ts`; the script itself is Node standard library only, which
is deliberate, because the one script whose job is to ship the dependency list
should not add to it.

Observed on this machine:

```
compiling TypeScript
staging application files
archiving 6746 files

wrote  build/api/.lambda-build/api.zip
bytes  6636521 (6.3 MiB)
sha256 UDqr+WHFuli8cDj5t7NwE198lPVYbEyy4BTg9cgcPR8=
```

The archive was unpacked and checked: `python -c "zipfile.ZipFile(...).testzip()"`
returned `None`, and `index.mjs`, `package.json`, `dist/src/lambda.js`,
`dist/openapi/openapi.yaml` and `dist/config/redirect-table.json` are all
present. The handler was then invoked in process with a function URL payload
format 2.0 event for `GET /health`, with `STAGE=staging`:

```
exports: [ 'handler', 'streamHandler' ]
{"statusCode":200,"body":"{\"status\":\"ok\",\"stage\":\"staging\"}", ...}
```

That proves the adapter, the ESM layout, the OpenAPI load and the stage gate.
It proves nothing about AWS.

The full API suite passes on the same tree: **12 files, 144 tests**, with the
in-process content retrieval latency guard reporting p50 6.6 ms, p95 8.9 ms.

**Terraform owns identity, not code**, so the package is deployed with
`aws lambda update-function-code` rather than by an apply. That is not a
workaround; it is why the `ignore_changes` is there.

### 7.5 What remains, in order, when credentials come back

Every step below is untried. The first one is the one that can still surprise.

1. `terraform plan` in `envs/dev`. **The plan has never been read.** It should
   show the `moved` of `web_renderer` as a move and not a replacement, an
   in-place environment update on eight functions for `STAGE`, two function
   URLs, two lambda permissions, one origin access control, three policies and
   the distribution update. Anything else, stop and read it.
2. `terraform apply`, then `terraform output readiness`.
3. `aws lambda update-function-code` for `trevean-dev-tsn888348-content-api` and
   `trevean-dev-tsn888348-scan-ingest` with `.lambda-build/api.zip`, then
   confirm the reported `CodeSha256` equals the sha256 printed above. The
   archive is built deterministically for exactly that comparison.
4. Seed. `node tools/seed-dynamodb.mjs --env staging --region us-east-1
   --table-prefix trevean-dev-tsn888348- --yes` from `build/content`. The dry
   run of that exact command was executed and reports **65 items, 60 of them
   placeholder**: 42 into `SpiceBlends`, 13 into `Recipes`, 5 into `Growers`,
   5 into `NFCTags`. **The production guard is not touched and must not be.**
   `--env production` with placeholder data refuses, and the override needs a
   reason; dev is not production, `--env staging` is the correct value here,
   and the seeder prints its own banner saying every page will render the
   placeholder marker and nothing may be promoted.
5. POST a `ScanEventInput` body to
   `https://d1uyspgs0bmg3a.cloudfront.net/v1/scan-events` and then read the row
   back out of `trevean-dev-tsn888348-ScanEvents`. **A 202 is not the proof.**
   The row is. The key is constructible from the body, so the read needs no
   scan: `pk` is `EVT#{blendSlug}#{YYYY-MM-DD}#{first character of dedupToken}`
   and `sk` is `{dedupToken}#{windowId}`. The date is the effective date, which
   is `occurredAt` unless the posted clock is more than a day from the server's,
   in which case it is server time.
6. The deployed pages need no change. They already carry
   `data-scan-endpoint="/v1/scan-events"`, a same-origin relative path, so
   routing `/v1/*` on this distribution is what points them at a real endpoint.
   Verified by reading the deployed object out of the site bucket.

**One thing to watch on step 5, because it is the likeliest failure and it is
not in our control.** CloudFront origin access control signing over a request
**body** is the part of this design that has never been exercised here. If the
beacon POST returns 403 from the origin, that is the signature and not the
application. The fallback is not to open the function URL to the internet: it
is to carry a CloudFront origin custom header the function requires, which is
the same mechanism the geography trust gate already needs.

**Geography is still off**, and the API origin added here is now the right
place for `GEO_TRUSTED_HEADER_NAME` and `GEO_TRUSTED_HEADER_VALUE`. Neither is
set, so the API drops geography rather than trusting it, which is the correct
direction to fail. Say "geography is not enabled yet" rather than letting an
empty map read as a finding.

---

## 8. Where the render reads the API: written, validated, not applied

**Added Friday 4 September 2026. Read the heading literally, the same way
section 7's is meant.** The development account's credentials are still expired,
`aws sts get-caller-identity` still returns `ExpiredToken`, and **no plan has
been read and no apply has been run**. Nothing in sections 2 and 3 has changed.
What follows exists in `build/publisher` and `build/infrastructure` and is
proved on this machine only.

### 8.1 The problem, which was left open deliberately

The publish pipeline's renderer has to read blend content from the API to
render a page. **Content reads on `/v1` are cacheable at the edge by the frozen
contract, section 7:** `public, max-age=60, stale-while-revalidate=300`, and the
`api_content` cache policy in this environment honours it. The API's only front
door is the apex distribution, so the obvious answer was to read through it, and
the obvious answer failed open:

1. An editor changes a blend and presses publish.
2. The renderer fetches the blend through the edge cache and is handed the
   version from before the edit.
3. It renders that, publishes it, reads it back, and the digests match.
4. **The pipeline reports success. The page shows the old content.**

Coalescing made it more likely rather than less. A render is about 200 seconds,
so the second publish in an editing session reads a cache entry past `max-age`
and inside `stale-while-revalidate`, which is exactly when a cache serves stale
content while it refreshes.

**A stronger read back could not close it.** The read back compares the
published document against what the renderer produced, so a renderer fed stale
content compares stale against stale and passes. **The fix had to be at the
read.**

Until this, `TREVEAN_CONTENT_API` was left unset, which makes the render publish
the content package's fixtures. Those carry the placeholder markers and the
deployment guard refuses them outright on production, so the pipeline was
useless and loudly useless. That was the right holding position and it was not
an answer.

### 8.2 What was built

**The renderer reads the apex distribution, like any other `/v1` client, with a
per render cache buster, and every response is proved to have come from the
origin before the build runs.**

- Every read carries `_uncached={token}`, one token per render. The
  `api_content` cache policy sets `query_string_behavior = "all"` on both the
  cache key and the origin request, because on `/v1` a query parameter selects
  the resource. A query string CloudFront has never seen cannot be a hit and
  cannot be inside `stale-while-revalidate`.
- The read records, per request, the URL and what the response said about
  caches. `build/publisher` then refuses the publish, **before the build and
  before the guard, the diff, the put or the invalidation**, if any read did not
  carry this render's token or if anything was claimed by a cache.

**The frozen contract is not modified and the renderer stays a client of it.**
The extra query parameter is ignored by the API, which registers no querystring
schema and reads only `include`, `status`, `limit` and `cursor`. The vendored
copies in `build/api` and `build/shopify` are untouched.

**The tap path is untouched.** No behaviour, header or cache key on the apex
distribution changes. This changes only what the renderer asks for.

**Nothing about it touches AWS**, which is why it could be finished here: no SDK
import, no new IAM permission, no new resource, no change to the seam in
`build/publisher/src/store`.

### 8.3 What the readiness output will say

`terraform output readiness` gains a line and one of the existing lines changes
meaning once the publish pipeline is created:

```
render_reads_the_api      = true
render_read_is_uncached   = "uncached. Every /v1 read carries a per render cache
                             buster, and a read that any cache claims fails the
                             publish before anything moves."
```

**With `create_publisher = false`, which is still the default in all three
environments, both read the same as before**: the pipeline does not exist, the
API queues and dispatches nothing, and `render_reads_the_api` is false.

**The boolean gained a sentence beside it on purpose.** `render_reads_the_api`
was true of the shape that could publish stale content and report success, and a
boolean cannot tell those two apart.

### 8.4 What is still open on this

**The safety of reading through the distribution depends on a policy in this
environment staying as it is.** If `api_content` ever stops putting query
strings in the cache key, or if something other than the apex distribution ends
up in front of the API, publishes **fail with a message naming the stale reads**
rather than succeeding on stale bytes. That direction is the design, and it is
the half worth checking on the first real publish.

**It has never run against this account.** The proof is a stand in cache on this
machine that serves stale content inside `stale-while-revalidate` with the
headers CloudFront sends. Confirming it against the real distribution is one
line on the day credentials work: publish twice inside six minutes and read
`rendered.contentRead` off `GET /revalidations/{id}`, which reports how many
reads were made and that every one was answered by the origin.
