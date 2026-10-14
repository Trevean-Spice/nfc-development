# The publish pipeline

The connection between a member of Trevean's marketing team pressing publish and the page a
customer reaches by tapping a jar.

**M3 deliverable, due Friday 11 September 2026.** It is the one the milestone's acceptance
criterion turns on: *content editable end to end without a developer, changes live within
5 minutes.*

---

## 1. The answer first

**Before this existed, publish updated a record and stopped.** The API wrote a published
snapshot, queued a revalidation, logged it, and dispatched nothing. The pages in the site
bucket had been put there by hand with `aws s3 sync`, and `terraform output readiness`
reported `blend_html_can_be_published = false`, which was accurate.

**Measured on this machine, with no AWS: publish to live is 199.3 seconds against a 300
second requirement.** That is an editor changing a blend's origin story in the API, pressing
publish, and the edited words being readable at the edge through a cache that was warm
before the edit. 198.4 s of it is the render. 0.9 s is everything else: select, guard, diff,
put, invalidate, read back. The margin is 100.7 seconds and section 7 is honest about how
thin that is and what widens it.

**Where it runs was settled on Friday 4 September 2026 and it is a small always on container
on Fargate, one task.** Section 8 carries the argument and the four rejections. Two things
about it belong at the top rather than at the bottom. **It is the first thing in this project
that costs money continuously in Trevean's account, about $100 a month, so it is off by
default and turning it on is a conversation.** And **the 199 second number above was measured
on this laptop's eight cores and has never been measured on a Fargate vCPU**, which is the
one number M3's acceptance criterion actually turns on. Section 7a says what is known about
that and section 8.5 says how to close it in an hour once credentials exist.

**Where the render READS the API was settled the same day, and it was the last open
correctness question on this path.** It reads the apex distribution, like any other `/v1`
client, with a per render cache buster on every read and a refusal if any response can be
shown to have come from a cache. `/v1` content reads are cacheable at the edge by the frozen
contract, so without that a render could be handed the version from before the edit it was
dispatched for, publish it, read it back against itself, and report success. **A stronger
read back could not have closed that**, because it compares the served page against what the
renderer produced. Section 8.4a carries the argument and the four rejections, including
reading DynamoDB directly, and `test/content-read.test.mjs` proves it with no AWS.

**The tap path is untouched.** The customer still reads a pre-rendered static document from
the edge cache. Publishing replaces the document in the background; it does not turn any
route into one that renders on demand. No step in this package adds origin compute or a
database read to a tap. The container is not an origin for anything a customer reaches: it
sits behind its own distribution, not the apex one, and the apex distribution's configuration
is not touched by any of this.

---

## 2. What happens when somebody presses publish

```
  editor presses publish in the admin
       |
  [1]  POST /v1/admin/blends/{slug}/publish        build/api
       |     moves the blend to published, writes an immutable snapshot,
       |     queues exactly the affected paths, answers 202 AND DOES NOT WAIT
       |
  [2]  signed dispatch to POST /revalidate         HMAC SHA-256 over the raw body
       |
  === the publisher's clock starts here ===
       |
  [3]  RENDER            build/web: fetch the API into a snapshot, PROVE NO READ CAME
       |                 FROM A CACHE, then next build
  [4]  SELECT            queued content paths -> object keys. An unrecognised path
       |                 selects nothing rather than everything
  [5]  GUARD             placeholder content is refused on production. No override
  [6]  DIFF              against the published manifest, by sha256
  [7]  PUT               the changed objects only, with the cache headers already in use
  [8]  INVALIDATE        exactly the changed paths. Never the distribution
  [9]  READ BACK         fetch the public URL, compare the digest
       |
  === live ===
       |
  [10] the admin publish screen says so, or says exactly why not
```

**Steps 7 and 8 succeeding do not mean the change is live.** They mean the origin has the
object and CloudFront accepted an invalidation. Step 9 is the only one that proves anything
to an editor, and it is why the confirmation on the publish screen is now a fact rather than
a hope.

---

## 3. Running the whole thing with no AWS account

Four terminals. Nothing here needs a credential, a network or an installed dependency tree
except the web build's own.

```bash
# 1. the API, with the publish dispatch pointed at the publisher
cd build/api
SECRET_TREVEAN_API_DEV_JWT_SECRET=local-development-signing-key-not-for-any-real-environment \
SECRET_TREVEAN_API_REVALIDATION_SECRET=dev-revalidation-secret \
REVALIDATION_WEBHOOK_URL=http://127.0.0.1:3003/revalidate \
npm run local:up

# 2. the stand in edge, which is the site bucket seen from the internet
cd build/publisher
STAND_IN_EDGE_PORT=3004 PUBLISHER_LOCAL_SITE_DIR=./.local-site npm run stand-in

# 3. the publisher
cd build/publisher
STAGE=local PUBLISH_TARGET=local PUBLISHER_RENDER_MODE=build \
TREVEAN_CONTENT_API=http://127.0.0.1:3001 \
REVALIDATION_SECRET=dev-revalidation-secret \
PUBLISHER_PUBLIC_BASE_URL=http://127.0.0.1:3004 \
PUBLISHER_LOCAL_SITE_DIR=./.local-site npm start

# 4. seed the stand in bucket once, then measure the criterion
cd build/publisher
PUBLISHER_RENDER_MODE=prebuilt PUBLISHER_PUBLIC_BASE_URL=http://127.0.0.1:3004 \
PUBLISHER_LOCAL_SITE_DIR=./.local-site node bin/publish.mjs --all

API_DEV_JWT_SECRET=local-development-signing-key-not-for-any-real-environment \
node scripts/measure-publish-to-live.mjs
```

And the admin, which is where a person actually does this:

```bash
cd build/admin
PUBLISHER_BASE_URL=http://127.0.0.1:3003 npm run dev
```

### Tests

```bash
npm test          # 43 assertions, node --test, no AWS, no network, no node_modules needed
```

### The container, which is what actually runs in a deployed environment

**The build context is `build/`, not `build/publisher/`.** The image carries three packages:
this one, `web`, because the render runs its build as a child process, and `content`, because
the placeholder guard reads its markers rather than retyping them. The layout inside the
image mirrors the repository, so every default in `src/config.mjs` is already correct and
nothing had to be re-pathed.

```bash
cd build
docker build -f publisher/Dockerfile -t trevean-publisher:local .

# It boots with no AWS, no credential and no configuration, on stage local.
docker run --rm -p 3003:3003 trevean-publisher:local
curl -s localhost:3003/health
```

Pushing it to an environment needs the repository name from that environment's Terraform:

```bash
cd build/infrastructure/envs/dev && terraform output publisher
cd build/publisher && ./scripts/push-image.sh <account> <region> <repository> [tag]
```

Then set `publisher_image_uri` in that environment's tfvars and apply. Terraform owns the
task definition, so the plan says which image is about to run.

---

## 4. The seam, and why the stand in is stricter than production

Everything AWS specific is behind two interfaces in `src/store/types.mjs`, and nothing else
in this package imports an AWS SDK. `src/store/aws.mjs` is the real thing;
`src/store/local.mjs` is the stand in. `src/stores.mjs` picks one from `PUBLISH_TARGET` and
never from whether an SDK happens to import, because a fallback that quietly used the stand
in when AWS was unreachable would report a successful publish to an editor while writing to a
directory nobody serves.

**A local server that is more permissive than production does not save time, it converts a
loud failure into a silent one.** This project has already paid for that lesson once: the
blend page posted the measurement harness's own record to a stand in that accepted any JSON,
passed on every local run, and would have been rejected by the real API on every customer
tap, which in production is a scan count of zero with nothing saying so. See the Decision
log, D28.

So the constraints are declared once and asserted by both implementations:

| Rule | Where it comes from |
|---|---|
| No leading slash, no `..`, no empty segment, no control character, at most 1024 bytes | S3 refuses these |
| A credential is required | S3 and CloudFront refuse an unsigned request, and so does the stand in, so a missing IAM policy fails on a laptop rather than in the account |
| At most 3,000 invalidation paths, each beginning with `/`, wildcard only at the end | CloudFront refuses these |
| **Every object must carry a Content-Type and a Cache-Control** | Stricter than S3. See below |
| **`/*` is refused** | Stricter than CloudFront. See section 6 |
| An invalidation is not instant | CloudFront takes tens of seconds. A stand in that completed in zero would let a publish that never waits for propagation pass every local run |

**The Cache-Control rule is the strictest one and it is not fussiness.** S3 will store an
object with no headers and CloudFront will then serve a blend page with whatever the
distribution's default is. The one hand sync this project has already run set
`max-age=31536000` on every object including HTML, and a blend page served with a one year
browser max-age is uneditable on every handset that has ever loaded it, for a year, with no
server side fix. That single line defeats the five minute requirement outright. It is a
refusal here rather than a convention.

---

## 5. The placeholder guard

**There are two guards on this path and they are not the same guard. Both hold.**

| | Where | Override |
|---|---|---|
| The editorial guard | `build/admin`, `src/publish/guard.ts` | **Yes, deliberately.** A typed phrase, a written reason of at least 20 characters, an explicit acknowledgement, an audit entry with a name on it, and it applies to one publish and nothing else |
| The deployment guard | here, `src/guard.mjs` | **None. At all.** |

**Nothing in this package weakens, bypasses or softens the editorial guard.** It never reads
an override, never records one and never lets one through. It is a second gate with different
rules, which is the only kind of second gate worth having.

**Why this one has no override**, stated so nobody later assumes symmetry and adds a flag.
The editorial override is a decision about a record in a database, taken by a named person
who can undo it. Publishing to production is a decision about the page that 1,000 encoded
jars in customers' kitchens resolve to, and a fabricated grower profile, with a name, a farm,
a portrait and a coordinate on a map, is indistinguishable from a genuine one to everyone who
sees it.

There is a test asserting the shape of `enforce()` itself: it takes `stage`, `objects` and
`contentDir` and nothing else, and it reads no environment variable. The way a guard like
this gets weakened is by somebody adding the parameter, so the parameter list is the
assertion.

**What it detects** is the content package's own convention, read from `build/content` rather
than retyped: the sentinel `[PLACEHOLDER]` and the secondary marker `NOT REAL CONTENT`. If
the package cannot be read the markers fall back to their documented literals and the guard
says so, because failing towards "this is not real" costs a refusal and failing the other way
ships a fabricated claim about a real supply chain.

On a non production stage a publish carrying placeholder content is allowed, recorded, and
reported to the editor with the sentence that it would be refused outright on production.
That is what lets the seeded blends be put live for a demo without anybody working around the
tool.

---

## 6. Invalidating exactly the paths that changed

Two things make this exact rather than approximate.

**The diff.** A published manifest at `_publish/manifest.json` in the site bucket records the
sha256 of every object the pipeline has put there. Objects whose bytes are unchanged are not
re-uploaded and, more importantly, are not invalidated. Invalidating an unchanged object
throws away a warm cache entry and is billed for the privilege.

**The cache path, which is the subtle one.** The blend rewrite runs at **viewer request**,
before the cache lookup, so the cache key carries the **rewritten** URI. Invalidating
`/blend.html` would not clear the entry a tap actually reads, which is stored under
`/blends/{slug}.html`. The invalidation set is therefore computed from object keys and never
from the paths the API queued. `test/paths.test.mjs` asserts it.

A blend publish on a two blend site invalidates one path. `/*` is refused outright.

---

## 7. What the numbers actually are, and the one that is uncomfortable

Observed on this machine on Friday 4 September 2026, running the real path end to end with
`scripts/measure-publish-to-live.mjs`:

| | |
|---|---|
| **Publish to live** | **199,293 ms** |
| Render: content snapshot plus `next build` plus postbuild | 198,385 ms |
| Select, guard, diff, put, invalidate | 150 ms |
| Read the page back through the edge | 13 ms |
| Objects published | 1 |
| Paths invalidated | 1 |
| Requirement | 300,000 ms |
| **Margin** | **100,707 ms** |

**The Architecture document, "Rendering", says regeneration takes a couple of hundred
milliseconds. On this pipeline it takes a couple of hundred seconds, and the document is
describing a framework feature this build deliberately does not use.** `build/web` runs
`next build` in export mode and then rebuilds every document from the rendered markup to
strip the framework runtime, because the budget allows zero JavaScript before readable. That
is the right trade for the tap path and it is why a regeneration is a full export.

**So the criterion is met with about a third of the budget spare.** The three things that
were listed here as widening it have since been measured, and two of the three answers came
out differently from what this section assumed. The measurements are in section 7a and they
are what decided section 8.

1. **Coalesce.** Several publishes inside one render window share one render. **BUILT on
   Friday 4 September 2026, and it is no longer an improvement: it is required.** See
   `src/queue.mjs` and section 7b.
2. **Keep the render warm.** ~~A long lived pipeline process with a populated `.next` cache
   rather than a cold start per publish.~~ **WITHDRAWN. Measured, and a populated `.next`
   cache is worth less than nothing on this build.** See section 7a. The long lived process
   is still the right host and there are still reasons for it, but a warm framework cache is
   not one of them and it should not be quoted as one.
3. **Render one page rather than all of them.** The largest saving and the worst idea. It
   means a second definition of what a blend page is, and the two would drift in exactly the
   places nobody is looking. Unchanged.

**Publishing only what changed is already done and is not on that list**, because it is about
the origin and the CDN rather about the render. One blend publish uploads one object and
invalidates one path regardless of how many pages were rendered.

---

## 7a. The two things that were assumed and are now measured

**Measured on this machine on Friday 4 September 2026, eight cores, running `npm run build`
in `build/web` directly so that nothing else is in the number.**

| | Elapsed |
|---|---|
| `.next` present, the state section 7 was measured in | **202,822 ms** |
| `.next` deleted first, nothing else changed | **165,353 ms** |

**The cold build is 37 seconds FASTER than the warm one, and section 7 said the opposite.**
It said 199 seconds "was measured on a warm machine with a populated Next cache" and that a
cold one "will be worse". On this build it is not. A full export re-emits every document
anyway, and validating and rewriting a cache that saves nothing costs more than skipping it.

**What that changes.** Every host on the shortlist starts with an empty framework cache, and
that was the argument that looked like it would decide between them. It decides nothing. The
sentence is corrected rather than quietly dropped, because "keep the render warm" is exactly
the kind of plausible mitigation that gets carried into a design review and spent money on.

**What it does not change.** It is one machine and one shape of change. It says nothing about
a cold CHECKOUT, which also pays for `npm ci`, and that remains a real cost and is the
reason section 8 rejects a CI runner.

### The number that does decide it, and it is the one nobody had taken

**The render is CPU bound and 199 seconds is an eight core number.** Nothing in section 7
said which machine, so nothing in it transfers to a host until the host's CPU count is known.
That is now the sizing input for section 8 rather than an afterthought, and it is measured
inside the container image rather than argued about.

## 7b. Coalescing, which is required rather than optional

**Two renders must never run at once, and before Friday 4 September 2026 nothing stopped
them.** `POST /revalidate` answered 202 and started a publish immediately, every time, with
no lock.

The render is `npm run build` in one working directory. Two of those write `.next`, `out`,
`public/media` and `.content-snapshot` underneath each other, and the publish steps read the
published manifest, diff against it, put, and write it back, so two publishes interleaved
leave a manifest describing neither and the NEXT publish's diff is then wrong and invalidates
the wrong paths.

That was reachable but unlikely while this was one process on a laptop driven by hand. It
stopped being unlikely the moment it became a service with a marketing team in front of it,
and **M3's acceptance scenario is a person editing several blends in a session**, which is
precisely the case that produces two dispatches inside one render window.

**The rule, and it is deliberately the conservative one.** A job that arrives while a publish
is running waits for the next one and is never served by the render already in flight. The
API writes the published snapshot before it dispatches, so a render already in progress
*might* pick up an edit dispatched a moment ago depending on where its content fetch fell.
Serving a job from a render that may have started before the edit was readable would mean
reporting a change live that is not on the page. Waiting costs one render. Guessing costs the
confirmation's credibility, which is the only thing this pipeline sells.

Everything that waits is then **coalesced**: the whole batch is one render and one publish
over the union of their paths, and every job in it gets the same outcome with its own clock,
so a job accepted later correctly reports a shorter accepted-to-live. Four blends edited in a
session cost one render rather than four.

**The other half of the same rule is in the Terraform**, because a lock inside one process
cannot serialise two: the service runs exactly one task and its deployment maximum is 100
percent, so it never briefly runs two during a replacement.

---

## 8. Where this runs. Settled on Friday 4 September 2026

**It is a small always on container, on Fargate, one task.** `build/infrastructure/modules/publisher`
builds it, `Dockerfile` in this directory packages it, `scripts/push-image.sh` ships it.
**Nothing here has been applied to AWS: the development account's credentials are expired
and no plan has been read.**

**The role and its permissions did not change, which was the point of settling them first.**
Read the content tables, write the site bucket, invalidate exactly the changed paths, read
the revalidation secret. That role now trusts `ecs-tasks.amazonaws.com` as well as
`lambda.amazonaws.com`, and it is the only one of the eight that does. Nothing was widened.

**`aws_lambda_function.web_renderer` is gone**, and it should be. It was 30 seconds and
1769 MB against a render measured in minutes, it will never receive a package, and leaving it
would have meant a resource whose name describes work it does not do and a
`readiness.application_code_deployed` that could never become true. The role stays and the
container assumes it. **Raising the timeout would not have fixed it and would have hidden
it**, and that is worth keeping on the page: the timeout was never the constraint.

### 8.1 What actually decided it, which was not the timeout and was not the cache

Two facts about the code that was already written, and they rule out more than any
performance number does.

**`POST /revalidate` answers 202 and does the work after the response.** It has to.
`build/api`'s dispatch, in `src/services/revalidation.ts`, carries a **2000 ms
`AbortController`**. Anything that instead holds the connection open for the length of a
render makes the API log `revalidation dispatch failed` on every *successful* publish, which
is a lie in the log on the happy path and trains whoever reads it to ignore the line.

**`GET /revalidations/{id}` is served from an in-memory job store**, and it is the admin
publish screen's stronger confirmation: the one that reports the edge served the new document
matched on sha256, next to the five minute requirement. See section 9.

**Both of those are properties of a long lived process.** A host that freezes when the
handler returns cannot do the first, and a host with no stable address cannot do the second.

### 8.2 The four that were rejected, and why

**A Lambda container image.** On paper it fits: 199 seconds is inside the 15 minute ceiling,
`/tmp` is writable to 10 GB, and the dependency tree bakes into the image. **Rejected because
Lambda freezes the execution environment when the handler returns**, so "202 now, render
after" cannot work, and the alternative of holding the request open is the 2000 ms abort
above. Making it work means inverting this service into a front door, an asynchronous worker
and a durable job store to replace the in-memory one: a rewrite of `server.mjs`, `jobs.mjs`
and `index.mjs`, in the week M3 is due, on a package with a measured number against the
contractual criterion. **It would also have been about a dollar a month against roughly a
hundred**, and that is a real difference which is stated here so nobody thinks it was
overlooked. It was weighed and it did not win against rewriting the one component whose whole
job is to be trustworthy about whether a change is live.

**A Fargate task run on demand.** Rejected, and it is the largest of the five in surface.
`RunTask` has no HTTP endpoint, so `revalidation_webhook_url` would still have nothing to
point at and a front door has to be built regardless; the job store still has no address; and
a task launch costs an image pull and an ENI attachment, tens of seconds, before any
rendering begins, out of a margin measured in seconds. It adds everything the always on
service adds, and then adds a launch per publish.

**A CI job triggered by the dispatch.** Rejected on three counts and any one of them is
enough. The dispatch is an HMAC signed body with its own header and no CI provider accepts
that shape, so a shim is needed anyway. It moves the render, and with it the credential that
writes the origin and invalidates the CDN, **out of the client's account and into a third
party**, which is a larger security surface than anything else on this list. And a hosted
runner is a cold checkout plus `npm ci` before a single page renders: section 7a shows the
framework cache is worth nothing, but the dependency install is not, and it is the one cold
cost that is genuinely large.

**Enqueue to a builder.** Rejected as an answer and kept as a note. A queue says how the
render is reached, not where it runs; the builder at the other end is still one of the
options above. It also adds unbounded wait to a 300 second clock at a volume where the queue
is empty every time. **Its real value is coalescing, and coalescing is now built, inside the
service that already holds the jobs.** See section 7b.

**App Runner**, which looks like the obvious small always on container and is not: it
allocates CPU only while a request is being processed, so work after a 202 is throttled to
nothing, and its request timeout is well below a render. Both of the two things this workload
needs are the two things it does not do.

**Lightsail containers**, cheaper and simpler than all of them, rejected on one fact: no task
role. The renderer's credentials would have to be static access keys in an environment
variable, for an identity that can write the origin 1,000 encoded jars resolve to.

### 8.3 What it costs, and what it costs to reach

**Roughly $105 a month in us-east-1** at the default task size: the always on task is most of
it, the load balancer is about $17, and the image repository and the small distribution are
rounding. It is the first thing in this project that costs money continuously in Trevean's
account, so **`create_publisher` defaults to false in all three environments** and turning it
on is one line in a tfvars file. That is a decision with a price attached and it belongs in
front of Dan.

**The front door is a small distribution of its own, not a behaviour on the apex one**, and
there are two reasons. The apex distribution is the tap path: 1,000 encoded jars resolve
through it and its behaviour ORDER is already load bearing in two places. And the apex
distribution is downstream of the pooled Lambda functions for its `/v1` origins, and
`admin_api` is in that same pool, so deriving `REVALIDATION_WEBHOOK_URL` from it is the exact
Terraform cycle documented beside `local.renderer_key` in the compute module. The pipeline's
own distribution depends on its own load balancer and on nothing else.

**The load balancer's ingress is the CloudFront origin-facing prefix list, not the internet**,
and that narrows the reachable set to CloudFront rather than to *this* distribution: a custom
origin has no equivalent of the origin access control the S3 and function URL origins use.
**What actually stops a request is the HMAC signature**, verified in constant time before the
body is parsed. The prefix list is depth. Said plainly so nobody later reads it as the
boundary.

**One named residual: CloudFront reaches the load balancer over HTTP.** Viewer to CloudFront
is HTTPS. An ACM certificate cannot be issued for an `*.elb.amazonaws.com` name and dev and
staging have no domain to issue one for. What crosses that hop is a revalidation id, a list
of content paths, and a signature: no credential, no customer data, no content. Closing it
costs one hostname, a certificate and an HTTPS listener, and it is worth doing in production.

### 8.4 So `revalidation_webhook_url` is no longer null by necessity

It is still a variable, and what changed is what fills it in. Left null, the stack now
derives it from the pipeline it creates. **Null now means one of two things and readiness says
which**: `create_publisher` is false, or no image has been pushed yet. Neither is an open
design question.

**It stays null until an image exists, deliberately.** An API pointed at an endpoint with no
healthy target behind it turns every publish into a 503 an editor has to interpret, which is
worse than the honest null it replaces.

### 8.4a Where the render reads the API. Settled Friday 4 September 2026 and CLOSED

**Deciding where the render runs forced a second question that had never been asked: where
does the render READ the API from.** Locally it is `http://127.0.0.1:3001`, straight at the
process. In a deployed environment the API's only front door is a Lambda function URL that
only CloudFront may invoke, so the obvious answer is the apex distribution.

**The obvious answer had a hazard and it failed open.** `/v1` content reads are cacheable at
the edge: the frozen API contract, section 7, puts `public, max-age=60,
stale-while-revalidate=300` on them and the `cdn` module's `api_content` policy honours it.
So a render that reads the API through the distribution can be handed a response cached
**before the edit it was dispatched to publish**. The page renders the previous version, step
9 compares the served page to what was rendered rather than to what the editor wrote, and the
publish reports success. **That is the exact failure shape this package's section 4 is about,
and it is the one direction that must never be taken quietly.** Coalescing made it more
likely rather than less: a render takes about 200 seconds, so the second publish in an
editing session reads a cache entry past `max-age` and inside `stale-while-revalidate`, which
is precisely when a cache serves stale content while it refreshes.

**A STRONGER READ BACK WOULD NOT HAVE CLOSED IT, and that is the fact that decided the
shape of the fix.** Step 9 compares the published document against what the renderer
produced. A renderer fed stale content compares stale against stale and passes. So the fix is
at the read.

**THE ANSWER: the render reads through the apex distribution like any other `/v1` client,
every read carries a per render cache buster, and every response is proved to have come from
the origin before the build runs.**

| | |
|---|---|
| **Bust** | Every read carries `_uncached={token}`, one token per render. The `cdn` module's `api_content` cache policy sets `query_string_behavior = "all"` on both the cache key and the origin request, because on `/v1` a query parameter selects the resource. A query string CloudFront has never seen cannot be a hit, and an entry that never existed cannot be served `stale-while-revalidate`. |
| **Prove** | The read records, per request, the URL and what the response said about caches. `src/content-read.mjs` then asserts that every read carried this render's token and that nothing was claimed by a cache, **before the build and before the guard, the diff, the put or the invalidation**. A read that cannot be shown fresh fails the publish and names the URLs. |

**The second half is the one that matters at handover.** The first half is correct today and
depends on a Terraform policy staying as it is. The second half notices the day it stops
being true, and it fails towards a refusal rather than towards a page that quietly shows last
week's words.

**Nothing about this touches AWS.** No SDK import, no new IAM permission, no new resource, no
change to the seam in `src/store`. The whole thing is exercised on a laptop with expired
credentials by `test/content-read.test.mjs`, which stands up a cache that serves stale content
inside `stale-while-revalidate` and runs the real read against it. And the tap path is
untouched: this changes what the renderer asks for, not any behaviour, header or cache key on
the apex distribution.

**The four that were rejected**, in full in `src/content-read.mjs` next to the code:

- **Read the API origin directly.** Needs `lambda:InvokeFunctionUrl` on the renderer's role
  and a second function URL permission, which widens the one role this project deliberately
  did not widen, and needs SigV4 inside the read, which lives in `build/web` and would drag
  an AWS SDK and a credential into a package that has neither. It also puts the heaviest
  `/v1` caller outside the rate limiting the frozen contract, section 9, places at the edge.
  And it cannot be run on a laptop at all, so the one path that decides whether an editor's
  words reach a page would be the one path never exercised before production.
- **A second distribution for the renderer with caching disabled.** Correct, and it costs a
  real Terraform cycle: this pipeline's `revalidate_url` feeds `admin_api`, and `admin_api`
  and `content_api` are the same pooled resource node, which a renderer distribution would
  have to depend on for the function URL and the permission. Breaking that means splitting
  `content_api` out of the pool with another `moved` block, in the week M3 is due, on eight
  functions whose plan has never been read. Set that aside and it is still a second public
  front door onto `/v1` with caching deliberately off, which is an origin hit per request on
  the content function, created for one caller that makes about a dozen requests a day.
- **A cache busting header rather than a parameter.** The `api_content` policy sets
  `header_behavior = "none"`, so no request header is in the key or forwarded, and whether
  CloudFront honours a viewer `Cache-Control: no-cache` is a question about CloudFront rather
  than about a line in this repository. `confirmLive` sends that header on the read back and
  it is a hint there. On the read that decides what a customer sees, a hint is not enough.
- **Read DynamoDB directly.** The fastest, and the one worth thinking hardest about, because
  the renderer's role can already read the content tables. Rejected because the API's read is
  not a table scan: published-only filtering, `?include=grower,recipes`, draft recipe
  exclusion, media hydration, the mappers, and the rule that `heroImage` is null unless the
  media item is ready, which `fetch-content.mjs` depends on. Reimplementing that here is a
  **second definition of what a blend page is made of**, which this package already refuses
  once in `render.mjs`. The drift would be invisible in the worst direction: the contract
  tests exercise the API, the admin previews through the API, and only the page a customer
  reads would come from somewhere else, with the read back matching. It also stops the
  publish pipeline being a client of the contract, which turns "the contract is the
  interface" into "the contract is the interface except for the one component that decides
  what customers see."

**So `publisher_content_api_base_url` is now an override rather than a required decision.**
Left null, `modules/stack` supplies the apex distribution's own hostname, and
`readiness.render_reads_the_api` reads true with `render_read_is_uncached` saying how.

### 8.5 What a cold start costs against the 101 second margin, and what is genuinely unknown

**Per publish, in the steady state, a cold start costs nothing.** The task is always on. The
process is warm, `node_modules` is installed and `.next` is populated. A publish pays for the
render and for nothing else. That is the property the always on container was chosen for, and
it is worth being precise that it is NOT the framework cache: section 7a measured the cache
and it is worth less than nothing.

**After a task replacement it costs availability rather than margin, which is the better
place for it to land.** A deployment, a failed health check or Fargate platform maintenance
replaces the task, and the new one pays an image pull, an ENI attachment and a Node start:
**expect 40 to 90 seconds, of which the pull of a roughly 700 MB compressed image from ECR in
the same region is most of it.** During that window the load balancer has no healthy target,
so a publish that arrives is **refused with a 503 rather than being slow**. It does not come
out of the 101 seconds. The editor sees a failure they can retry, which is the outcome this
package prefers everywhere else too.

**The thing that does come out of the margin is not a cold start at all, and it is
unmeasured.** 199 seconds was measured on eight cores of an Intel Core Ultra 5 226V. Nothing
in this repository has ever run a render on a Fargate vCPU.

What was measured, inside the image, on this machine:

| `npm run build` | Elapsed |
|---|---|
| In the container, no CPU limit, 8 available | **745,900 ms** |
| In the container, `--cpus=4` | **728,408 ms** |
| In the container, `--cpus=2` | **740,995 ms** |
| Outside the container, 8 cores, `.next` deleted first | **165,353 ms** |

**Two, four and eight CPUs are the same number to within 2.5 percent.** Whatever the render
is waiting on inside that container, it is not the number of cores. `docker stats` showed one
core saturated and 222 MiB resident throughout.

**Two explanations fit and they point different ways, so both are recorded rather than the
convenient one.** Either the render is effectively single core, in which case buying vCPUs
buys nothing and the task should be small; or the container run is dominated by Docker
Desktop for Windows's virtualised filesystem, which a Next export punishes with tens of
thousands of small file operations, in which case the 4.5x gap against the native run is a
Windows artifact and none of these numbers says anything about Fargate. **The experiment that
separates them is running it on Fargate**, and it cannot be run from here.

**AMENDED Monday 7 September 2026, and it narrows the second explanation without killing it.**
**There is no bind mount in this image.** The Dockerfile `COPY`s `web/`, `content/` and
`publisher/` in at lines 61 to 89 and the render runs against `/srv/build/web` on the
container's own overlay filesystem. **So the specific mechanism named above, a Windows host
directory mounted into the container and punished for small file operations, is not the one in
play here**, because the files never cross that boundary. What survives is the weaker and still
plausible version: Docker Desktop on Windows runs this in a virtual machine, and that VM's disk
and CPU virtualisation carry real overhead. **That overhead does not exist on Fargate**, which
is ordinary Linux on the metal, so the 215 to 400 second budget below is not revised.

**There is also a cheaper discriminator than Fargate, and it has not been run.** Add
`--cpus=1` to the table. If one core lands near the 728 to 746 second plateau that two, four
and eight all share, the render is single core bound and buying vCPUs buys nothing. If one core
is markedly slower, then the multi core runs were using those cores and the plateau is I/O,
which is the Windows artifact reading. **It costs one twelve minute run on any machine with a
Docker daemon, and it answers the vCPU sizing question before the Fargate measurement rather
than after it.** It was not run here because no Docker daemon was available on the day.

**The task is sized from the half of that which is safe to act on.** `publisher_task_cpu`
defaults to 2048, two vCPUs, because nothing measured suggests four would be faster and four
costs $72 a month more. It is the number to change first if the real render is slow, and to
change back if it makes no difference.

**What that means for the number to expect.** A Fargate vCPU is a hardware thread on a server
class part and is usually slower per thread than a modern laptop performance core, so on the
single core reading the honest budget is **215 to 400 seconds against a 300 second
requirement**. **The upper half of that range does not meet the criterion.** That is the
outstanding risk on M3 and it is stated here rather than discovered on the acceptance run.

**How to measure it, in about an hour, on the day credentials work:**

1. `terraform apply` with `create_publisher = true`, then `./scripts/push-image.sh`, then set
   `publisher_image_uri` and apply again.
2. `terraform output publisher` and confirm `host.image_pushed` and one task running.
3. **Take the render time first, on its own, before anything depends on it.** Publish once
   through the admin and read `rendered.buildMs` off `GET /revalidations/{id}`. That is the
   whole question in one number and it needs nothing else to be working.
4. Then the criterion: `node scripts/measure-publish-to-live.mjs` against the deployed API,
   which reports `acceptedToLiveMs` next to the 300,000 ms requirement.
5. Replace the task deliberately, with `aws ecs update-service --force-new-deployment`, and
   time from the stop to a healthy target. That is the availability number in the second
   paragraph above, measured rather than estimated.

**If step 3 comes back above about 250,000 ms, raise `publisher_task_cpu` to 4096 and repeat
step 3 before changing anything else.** If it does not move, the render is single core, the
lever is the render itself rather than the host, and that is a different conversation which
belongs in front of Dan the same day rather than the week after.

The realistic candidates, none of them chosen here: a small always on container behind the
distribution, a CI job triggered by the dispatch, or a Lambda that enqueues to something that
can build. That is a decision with a cost attached and it belongs in front of Dan rather than
inside a module.

---

## 9. Closing the loop back to the editor

The admin publish screen shows two confirmations and they are different claims.

**The first is unchanged and is contract legal.** It re-reads the public content route and
compares versions. That proves the origin is serving the new version. It does not prove the
CDN regenerated the HTML, and the screen has always said so.

**The second is new and is the stronger one.** It reads this pipeline's job record and reports
whether the edge served the newly published document, matched on sha256 rather than on a
version number, because a page can carry a new version and stale markup and a digest cannot.
It reports the elapsed time next to the five minute requirement.

**It never rounds a failure up into a success.** "Published, but not confirmed live" is its
own outcome with its own wording, because an editor told the change is live when it is not
will find out from a customer.

### Why the status is read from here and not from the API

**This is the frozen contract's E9 gap 4 and it is still open.** Section 10.2 of the frozen
API contract says the publish response is "202 with a status URL". The `PublishResult` schema
has no such field and no operation in the document reads the state of a `revalidationId`, so
there is no contract legal way to ask the API whether a revalidation finished. The contract
errata already proposes the fix and it is additive: `GET /v1/admin/revalidations/{revalidationId}`,
minimum role Viewer, with `status` widened to `[queued, running, complete, failed]`.

**That change is Dan's and it has not been taken, so nothing here invents it.** The frozen
contract is not modified, the vendored copies in `build/api` and `build/shopify` are
untouched, and `build/admin`'s API client still throws if asked for an operation the document
does not define. The status lives on this service instead, which the contract does not
describe at all, in the same way the Shopify webhook consumers do not, per the contract's
section 5.4.

**When the erratum is approved this moves behind the API and the admin changes one base
URL.** Until then, `PUBLISHER_BASE_URL` unset means the admin reports exactly what it
reported before and claims nothing more.

---

## 10. Configuration

| Variable | Default | Notes |
|---|---|---|
| `STAGE` | `local` | `production` refuses placeholder content outright. An unrecognised value refuses to start. |
| `PUBLISH_TARGET` | `local` on local, `s3` otherwise | `local` with `STAGE=production` is refused: it would write a production publish to a directory and report it as live. |
| `PUBLISHER_PORT` | `3003` | |
| `PUBLISHER_RENDER_MODE` | `prebuilt` | `build` re-runs the web build. `prebuilt` publishes what is already in the render directory. The container sets `build`. |
| `PUBLISHER_RENDER_DIR` | `build/web/out` | |
| `PUBLISHER_RENDER_TIMEOUT_MS` | `240000` | How long the web build child process gets before it is killed. The container sets 420,000, above the 300,000 ms requirement on purpose: a render that has already lost the criterion should still finish and say so rather than disappear. |
| `PUBLISHER_WEB_DIR`, `PUBLISHER_LOCAL_SITE_DIR` | derived from `src/` | Both default relative to this file's own location, which is why the container mirrors the repository layout at `/srv/build` and sets neither. |
| `PUBLISHER_CONTENT_DIR` | `build/content` | Read only. Absent means the guard falls back to the documented markers and says so. |
| `TREVEAN_CONTENT_API` | unset | The API the render reads. The Terraform supplies the apex distribution. Every read carries a per render cache buster and a read a cache claims fails the publish, section 8.4a. Unset renders the content package fixtures. |
| `SITE_BUCKET` | unset | Required when the target is `s3`. |
| `CLOUDFRONT_DISTRIBUTION_ID` | unset | Required when the target is `s3`. |
| `PUBLISHER_LOCAL_SITE_DIR` | `build/publisher/.local-site` | The stand in bucket. |
| `PUBLISHER_PUBLIC_BASE_URL` | unset | Where a published document is read back from. Unset means nothing is ever confirmed live, and the pipeline says so rather than claiming success. |
| `REVALIDATION_SECRET` | development value on local | The dispatch signature. Absent on a deployed stage means every job is refused, never accepted. |
| `REVALIDATION_SECRET_NAME` | `trevean/api/revalidation-secret` | Read from the managed store on a deployed stage. |
| `PUBLISHER_VERIFY_ATTEMPTS`, `PUBLISHER_VERIFY_INTERVAL_MS` | `20`, `1000` | How long the read back waits before reporting "not confirmed". |

---

## 11. How it is put together

```
src/
  config.mjs             configuration, resolved once
  signature.mjs          HMAC verification over the raw body, constant time
  paths.mjs              content paths to objects, objects to cache paths
  guard.mjs              THE DEPLOYMENT PLACEHOLDER GUARD. No override
  content-read.mjs       HOW THE RENDER READS THE API, and the proof it read the truth
  tree.mjs               the rendered tree, and the two cache headers
  render.mjs             the web build, as a child process, never a second template
  publish.mjs            the eight steps, in order
  queue.mjs              ONE RENDER AT A TIME, and several publishes sharing one
  jobs.mjs               the job record and the clock the criterion is measured on
  server.mjs             POST /revalidate, GET /revalidations/{id}, GET /health
  stores.mjs             which side of the seam this process is on
  stand-in-edge.mjs      CloudFront, minus everything not load bearing for a publish
  store/
    types.mjs            THE SEAM, and every rule both sides assert
    aws.mjs              S3 and CloudFront. The only file that knows AWS exists
    local.mjs            the stand in origin and CDN
bin/publish.mjs          one shot publish, from a terminal or CI
scripts/measure-publish-to-live.mjs   the acceptance criterion, measured
scripts/push-image.sh    build the image and push it to the environment's repository
Dockerfile               the three packages, the dependency trees, and one warm render
test/                    43 assertions, node --test
```

---

## 12. Related documents

Cross-references are by document title and section number, never by filename.

- The Architecture document, "Rendering", "The tap path", "Admin CMS"
- The Acceptance criteria document, section 6.2
- The frozen API contract, sections 2, 5 and 10.2
- The contract errata, E9, gap 4
- The Milestones and dates document, "Milestone acceptance criteria, per SOW Rev C section 5", M3
- The deployed development environment, sections 3, 5 and 8
- `MANIFEST.md` in this directory, for the background IP obligation, and in particular "The
  container image": the host decision brought copyleft into the operating system layer and
  that file no longer claims there is none anywhere
- `build/infrastructure/modules/publisher/main.tf`, "Where the renderer runs", which carries
  the same argument as section 8 next to the resources it decides
