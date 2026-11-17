# Trevean Spice admin CMS

Blend, recipe and grower editors. Role based access for Admin, Editor and Viewer. Preview before publish. Publish that regenerates exactly the affected pages and tells you whether it worked. The NFC screens no generic content system models.

**M3 deliverable, due Friday 11 September 2026.** Built ahead of the date because it has no external dependency: it needs neither the AWS account, nor DNS, nor the content Trevean still owes, nor a physical tag.

Built against the frozen M1 API contract, version 1.0.0. Runs locally with no AWS account against the API in `build/api`.

---

## 1. The answer first

**The acceptance bar is not a screenshot. It is a member of Trevean's marketing team publishing a blend end to end while we watch and say nothing.** Everything below follows from that sentence:

- **No client framework, no bundler, no build step for the browser.** Every screen is server rendered HTML, every write is a form post, and the only JavaScript is the 90 lines that upload a photograph from the browser straight to S3, which a form post cannot do. There is nothing to fail between a person and a text field.
- **A control the signed in role cannot use is absent, not disabled.** A greyed out button still reads as a promise, and a person who clicks a button that returns a permissions error has already stopped trusting the tool.
- **Every refusal explains itself in the words of the thing that refused.** A version conflict says somebody else saved first and that nothing has been lost. A blocked publish lists every blocking field at once, because an editor fixing five problems in five round trips will stop using the tool.

**Why this is custom rather than a headless CMS product**, restated because it is the first question anyone asks: the content model already exists in DynamoDB across five defined tables. A CMS product wants to own the content model, which means either two sources of truth, whose failure mode here is literally the page showing the wrong story, or abandoning the schema everything else depends on. A custom admin also gets the screens the operation actually needs, which no generic product models: tag batches, encoding runs and the redirect table. And publishing regenerates the page directly, with no webhook plumbing between two vendors. See the Architecture document, "Admin CMS", and "Decision log", D3.

---

## 2. Running it

The API has to be up. It needs no AWS account either.

```bash
cd build/api
npm install
npm run local:up          # in process DynamoDB, five tables, seeded, API on :3001
```

Then, in another terminal:

```bash
cd build/admin
npm install
npm run dev               # admin on :3002
```

Open `http://127.0.0.1:3002`. Sign in with one of the three development accounts, which are listed on the sign in screen:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@example.com` | `admin-local-only` |
| Editor | `editor@example.com` | `editor-local-only` |
| Viewer | `viewer@example.com` | `viewer-local-only` |

**Those accounts are the local development identity provider and they are refused outright when the stage is production**, in `src/auth/users.ts`, in code rather than by configuration. On the Trevean AWS account the sign in screen is replaced by a redirect to the managed identity provider and the roles come from the token's `roles` claim, per the frozen API contract, section 5.3.

### Tests

```bash
npm test                  # unit and integration, hermetic, nothing else needs to be running
npm run test:live         # the same shape of assertions against the real API on :3001
npm run typecheck
```

`npm test` starts its own stand in API on an ephemeral port, so it runs on a machine with nothing else started. `npm run test:live` skips with a printed notice when the API is not up, rather than failing, because a suite that goes red when a second process is not running teaches people to ignore red.

---

## 3. The screens

| Screen | Path | Minimum role | What it is for |
|---|---|---|---|
| Blends | `/` | Viewer | Every blend including drafts, with status, tag code, version and whether it still carries placeholder content. |
| Blend editor | `/blends/{slug}` | Viewer to read, Editor to save | Name, tagline, origin, coordinates, origin story blocks, grower, hero image, freshness, Shopify links. Each field carries its own content readiness state. |
| Preview | `/blends/{slug}/preview` | Viewer | The draft as a customer will read it, at 390 px, with the placeholder render contract applied. |
| Publish | `/blends/{slug}/publish` | Editor | The placeholder guard, the publish, the queued paths, and whether the origin is serving the new version. |
| Recipes | `/recipes/{recipeId}`, `/recipes/new` | Viewer to read, Editor to write | Ingredients as four separate values, steps one per line, carousel position. |
| Growers | `/growers` | Viewer to read, Editor to write | The most dangerous record in the product, and the screen says so. |
| Media | `/media` | Viewer to read, Editor to upload | The three call presigned upload, alternative text, derivative status. |
| Scans | `/analytics` | Viewer | The rollup time series, with how the numbers are counted stated on every load. |
| NFC and tags | `/nfc` | **Admin** | Tag batches, encoding runs and the deployed redirect table. Read only for every role. |
| Content readiness | `/content-readiness` | Viewer | What the placeholder convention is, and which fields are still outstanding. |
| Roles | `/users` | **Admin** | The local development identity provider. |
| Audit | `/audit` | Viewer | Publishes, blocked publishes, placeholder overrides, revalidations and role changes. |
| Authorisation | `/authorisation` | Viewer | Every admin operation and its minimum role, read live from the frozen contract. |

---

## 4. Role based access, which is the part that must not be wrong

**An admin write endpoint reachable by an unauthenticated or under privileged caller is the worst thing this application could ship with.** So the same question is answered three times, by three pieces of code that do not share a decision:

1. **The route guard**, `src/auth/guard.ts`. Server side, before any markup exists, on every request.
2. **The API client**, `src/api/client.ts`. Refuses to put a request on the wire whose contract minimum role the caller does not hold. This exists so that a route registered without a guard, or guarded with the wrong role, fails here rather than reaching the API and depending on the API being right.
3. **The API itself**, which validates the bearer token on signature, issuer, audience and expiry and checks the role again. A browser is not a security boundary and neither is this application.

**Every minimum role comes from `x-minimum-role` in the frozen OpenAPI document**, read at startup, in `src/contract.ts`. Nothing in this application retypes the authorisation table. A contract frozen for seven weeks with an authorisation table hand written beside it drifts silently, and the drift is not visible until somebody who should not be able to publish, publishes. The `/authorisation` screen renders that table straight from the document so the claim can be checked in one glance.

Four more rules that are enforced rather than intended:

- **The role is read from the user store on every request, never from the session cookie.** The cookie's copy is a cache. A role revoked one minute ago is revoked now, not at the end of an eight hour session. There is a test for it.
- **The token the admin presents to the API carries exactly the session's role and never more.** A privilege escalation in an admin tool is nearly always an escalation in the thing that issues the credential, not in the thing that checks it. There is a test that decodes the minted token for all three roles.
- **Insufficient role is 403 and never 404.** Per the contract, section 5.3: hiding the existence of a screen from an authenticated colleague buys nothing and makes support harder.
- **Every write is a POST carrying the session's own token.** A form submitted without it, or with another session's, is refused.

### What each role can do

| Role | Can |
|---|---|
| **Viewer** | Read everything, including drafts, previews and analytics. Write nothing. Every editing control is absent rather than disabled. |
| **Editor** | Everything a Viewer can, plus create and edit blends, recipes and growers, upload media, and publish. Cannot manage roles. Cannot see or edit the tag records. |
| **Admin** | Everything an Editor can, plus role management and read access to the tag records. The redirect table is still read only, for Admin as much as for anyone. |

---

## 5. Preview before publish

`/blends/{slug}/preview` renders the draft the editor is looking at, in the section order, copy and pending slot behaviour of the consumer page, inside a 390 px frame, which is inside the 375 to 428 px responsive range in the acceptance criteria.

It reads `GET /v1/admin/blends/{slug}?include=grower,recipes`, which is the only route in the contract that returns draft recipes. No endpoint is invented for it.

**What preview is not, stated here rather than discovered later: it is not the byte identical production page.** The production page is statically generated by the consumer build in `build/web`, with its own critical CSS, its AVIF and WebP derivatives and its measured byte budget. Preview shows a draft that has not been generated yet, so it cannot be that artifact by definition. Layout is faithful and content is exact. Page weight is not measured here and the screen says so.

---

## 6. Publish, and how you know it worked

Publishing calls `POST /v1/admin/blends/{slug}/publish`, which moves the blend to published, writes an immutable published snapshot, and enqueues regeneration of exactly the affected pages. It returns 202 and does not wait: the previous version keeps serving until the new one is ready, so no customer waits for a render and no editor waits for a deploy.

The screen then shows, in this order:

1. **Exactly the paths queued**, from the API's own response. For Persian Sunrise that is `/blend.html?blend=persian-sunrise`, `/blends/persian-sunrise` and `/sitemap.xml`, and nothing else.
2. **Whether it worked.** The admin re-reads the public content route and compares the version being served with the version just published. Confirmed, not confirmed yet, or could not confirm, with the elapsed time and the contractual five minute requirement stated next to it.
3. **Any failure, in full.** The stable error code, the message, the request id and every field level detail. A 422 lists every blocking field at once. A 409 says somebody else saved first and that nothing has been lost. A refused publish says plainly that the previous version is still serving.

**The contract legal check above is weaker than it should be, and the reason is a gap in the frozen contract.** See section 9, item 4: the contract's section 10.2 says the publish response is "202 with a status URL", the `PublishResult` schema has no such field, and no operation anywhere in the document reads the state of a revalidation. Confirming against the public route is the strongest check available inside the frozen surface. It confirms the origin is serving the new version. It does not confirm the CDN has regenerated the HTML, and the screen does not claim that it does.

**As of Friday 4 September 2026 there is a second confirmation, and it is the strong one.** When `PUBLISHER_BASE_URL` is configured, the screen also reads the publish pipeline in `build/publisher` and reports whether the edge actually served the newly published document, matched on its sha256 rather than on a version number, because a page can carry a new version and stale markup and a digest cannot. It states the elapsed time next to the five minute requirement, lists exactly the objects published and the paths invalidated, and offers a Check again link, because a full regeneration is measured in minutes on a cold machine and an admin screen that blocks for that long is one a person abandons.

**It never rounds a failure up into a success.** "Published, but not confirmed live" is its own outcome with its own wording. Unset, the screen reports exactly what it reported before and claims nothing more.

**The two checks stay side by side because they fail differently.** The version check catches a publish the API did not commit. The pipeline check catches a publish the edge is not serving.

**Nothing about this invents a contract operation.** The publisher is a separate service the frozen document does not describe at all, in the same way the Shopify webhook consumers are not, per the contract's section 5.4, and `src/api/client.ts` still throws if asked for an operation the document does not define. See section 9, item 4, for the additive fix and whose decision it is.

`POST /revalidate` is the manual escape hatch, for the case where the cache and the data disagree, which will happen at least once during this engagement.

---

## 7. The placeholder discipline

Real client content has not arrived. It was due Friday 14 August 2026, then again as a named M2 gate condition on Friday 21 August 2026, and neither date was met.

**The failure this exists to prevent is specific and it is not hypothetical:**

> A fabricated grower profile, with a name, a farm, a portrait and a coordinate on a map, is indistinguishable from a genuine one to everyone who sees it. It gets copied into a review deck. It survives a publish. It reaches a page that 1,000 encoded tags in customers' kitchens already point at. And it is a statement about a real supply chain that nobody at Trevean ever made.

### How the admin decides what is real

Five detectors run over every record and their results are combined with OR. Any one firing marks the field as not real.

| Detector | Catches |
|---|---|
| `sentinel` | The value carries `[PLACEHOLDER]` or `NOT REAL CONTENT`. |
| `marker` | The value says it is a placeholder in some other wording. |
| `fake_id` | A media, grower or recipe id in the reserved `FAKE` range. |
| `readiness` | The content package in `build/content` records the field as `placeholder_*`. |
| `missing_required` | The field is required to publish and is empty. |

Plus one more that fires when the content package cannot be read at all: `unverified`, which blocks publish exactly as a known placeholder does.

**`build/content` is read and never written.** It owns the placeholder convention, the content field specification and the per field readiness state for all five blends. Restating any of it here would create a second source of truth for which fields Trevean has actually supplied.

**The second detector matters more than it looks.** The API's own seed data reads as finished copy and carries no marker: a tagline, an origin story, a grower biography, a harvest date, a best before date, a lot label and a farm coordinate, none of which came from Trevean. The admin flags all of them, because the content package says those fields are outstanding. See section 10, item 1.

### Where it shows

- **On every field in the editor**, next to the input, with a colour that appears nowhere else in the interface.
- **In the preview**, as the placeholder render contract requires: an undismissable banner, every unreal value outlined, every empty slot rendered at the size the real value will occupy rather than collapsed, and the reorder button disabled and labelled rather than hidden or pointed somewhere plausible. **Dates, coordinates and lot labels are outlined as loudly as prose**, because they read as facts and carry no marker of their own, and a best before date is the one value on that page a customer might act on.
- **On the publish screen**, as the list of blocking fields at the moment of the decision.

### The override

Publishing placeholder content is possible, because refusing outright would mean the seeded blends could never be put live for a demo and somebody would work around the tool instead. It requires four things together:

1. The phrase `PUBLISH PLACEHOLDER CONTENT`, typed exactly. Not a checkbox on its own: a checkbox is one absent minded click.
2. A written reason of at least 20 characters.
3. An explicit acknowledgement of the fields listed on that screen, at that moment.
4. And it applies to that publish and nothing else.

**There is no environment variable that turns the guard off, no stored preference and no "do not ask again".** A convention with a manual off switch is a convention that gets switched off on the wrong day. Every override is written to the audit log with the person's name, the reason and the list of fields that were not real.

---

## 8. The NFC screens

Tag batches, encoding runs and the deployed redirect table. These are the screens the operation needs and no generic content system models, which is part of why this admin is custom.

**All three are read only, and that is not a limitation of this build.** The redirect table is a version controlled artifact deployed with the application and reviewed like code. A thousand encoded and possibly write protected tags resolve through it. The frozen contract has no write operation for it at any role, including Admin, and these screens have no edit control for the same reason. Corrupting this table does not break a deployment; it strands physical inventory in customers' kitchens, and nobody finds out from a dashboard.

**Attribution is per SKU.** There is no per tag identifier and no chip UID available to anything downstream, because the 1,000 tags were encoded per SKU before this engagement began. So there is no per tag list anywhere in this application, no serial column and no per jar anything. The unit is the code, and the number beside it is how many jars carry that code. A screen that implied otherwise would be inviting somebody to ask for a report the hardware cannot produce.

Two details the screens are careful about:

- **`writeProtected` renders Write protected, Not write protected, or Unknown, and never guesses.** Null means unknown and is rendered as Unknown rather than as No, because false would be a claim nobody had made. **The shipped SO4731 run carries that claim and it REVERSED on Friday 11 September 2026:** Dan's August answer of "no write protections" was given from memory about a run that had already shipped, and with the stock in front of him he confirmed the tags are locked. **The four encoded codes now arrive as `true` and render as Write protected.** The reserved code has no tag and stays Unknown. See "Decision log", D45. **The screen was right to render `null` as Unknown throughout:** the one row this project got wrong was the one where a claim was made, not the one where it was withheld. A batch claims a single state only when every row in it agrees; mixed rows collapse back to Unknown.
- **The chip is recorded as ST25TV02KC, NFC Forum Type 5 and ISO 15693**, on screen, next to the batch. Not NTAG21x and not Type 2: a different air interface, a different memory model, and area based password protection rather than lock bits. It is written there so nobody has to go and find it out again.

---

## 9. Gaps found in the frozen contract

Reported rather than worked around. Nothing in this application invents an endpoint, and `src/api/client.ts` throws if asked for an operation the document does not define. Each item below says what the admin does instead, and whether it needs a change.

**1. There is no admin read operation for growers.** The contract has `POST /v1/admin/growers` and `PATCH /v1/admin/growers/{growerId}` and nothing to read them with under `/v1/admin`. The admin uses the public `GET /v1/growers` and `GET /v1/growers/{growerId}`. Contract legal, and it costs nothing here because growers carry no publication status and every field on them is already public in the rendered page. **No change needed.** Worth recording so it is not read as an oversight later.

**2. There is no admin read operation for a single recipe.** Same shape: `POST`, `PATCH` and `DELETE` exist, `GET` does not. The admin uses the public `GET /v1/recipes/{recipeId}` for the editor, and `GET /v1/admin/blends/{slug}?include=recipes` where the draft set is what is wanted, since that is the only route that returns draft recipes. **No change needed.**

**3. There is no user or role management endpoint, at any path.** Section 5.3 gives Admin "user and role management" and the document defines nothing for it. That is consistent, because on the Trevean account roles come from the `roles` claim on a token issued by the managed identity provider, so role management belongs to that provider rather than to this API. The `/users` screen is therefore the local development identity provider, and on the Trevean account it becomes a link into that console. **Needs a decision from Dan, not a contract change:** which identity provider, and who administers it.

**4. Publish cannot be confirmed through the API, and section 10.2 says it can. STILL OPEN on Friday 4 September 2026, and now worked around outside the contract rather than inside it.** The prose says the publish response is "202 with a status URL". The `PublishResult` schema has `slug`, `status`, `version`, `publishedAt`, `revalidationId` and `paths`, and no status URL. No operation in the document reads the state of a `revalidationId`. So there is no contract legal way to ask whether a revalidation finished, which matters because "content live within 5 minutes" is a contractual criterion in SOW section 6.2. The admin confirms by re-reading the public content route and comparing versions, which proves the origin is serving the new version and does not prove the CDN regenerated. **This is the one gap worth closing.** The additive fix is a `GET /v1/admin/revalidations/{revalidationId}`, which is allowed inside v1 under the contract's own section 3, at minimum role Viewer, with `status` widened to `[queued, running, complete, failed]`. The contract errata already proposes exactly that, as E9 gap 4, and it is Dan's decision. **Until it is taken, the admin reads the publish pipeline directly on its own base URL rather than adding an operation to the frozen surface.** The frozen document is unmodified, the byte identical vendored copies are untouched, and this application still refuses to call an operation the contract does not define. When the erratum is approved, the admin points at the API instead and nothing else changes.

**5. `GET /v1/admin/tags` requires Admin, so an Editor cannot open the redirect table screen.** The M3 brief asks for a read only view "so an editor can see which code maps to which blend"; the contract puts that operation behind Admin. Implemented to the contract: the screen is Admin only. **Mostly mitigated without a change**, because `tagCode` is a field on `BlendSummary` and on `Blend`, both readable at Viewer level, so the blend list and the blend editor already show an Editor which code is on their jar. If Dan wants Editors to see the full table, lowering `x-minimum-role` on that one operation to Editor is an additive change and the operation is read only in any case.

**6. There is no preview endpoint and no preview token.** Section 5.1 says "Preview before publish (an M3 scope item) uses a short lived signed preview token, not the public route", and no such token, parameter or operation exists in the document. The admin previews through `adminGetBlend`, behind the signed in role, which satisfies the requirement for anyone with an account. **It does not satisfy a shareable link.** If Dan wants to send a preview URL to somebody without an admin account, that is the signed preview token the contract's prose already anticipates, and it is a contract addition. **Decision for Dan.**

**7. No response carries a content readiness or placeholder flag.** That is correct and deliberate: several response schemas are `additionalProperties: false`, so adding one would put the API in breach of its own contract on the first contract test. The placeholder convention's own answer is that the marker travels inside the value. The consequence for this application is that its placeholder detection depends on `build/content` being present beside it. If it is not, every Trevean owned publish blocking field becomes `unverified` and publish is blocked until it is. **No change needed**, but the content package has to travel with the application into the client repository. The convention document also suggests an `X-Content-Placeholder` response header as an option, which headers make contract legal. That remains a recommendation to whoever owns the API build.

---

## 10. What the client has to decide

**1. The API's seed data invents facts and presents them as real, and it should be corrected before anyone screenshots it.** `build/api/src/db/seed.ts` writes a tagline, an origin story, a grower name and biography, a harvest date, a blend date, a best before date, a lot label and a farm coordinate for Persian Sunrise and Caribbean Sunset. None of it came from Trevean. Two of those values, the best before date and the coordinate, are exactly the two the content package refuses to invent, for the stated reason that a date is a food safety claim and a coordinate renders as a pin that reads as a fact. The strings carry no `[PLACEHOLDER]` marker, so `grep` does not find them and a reader cannot tell. **The admin flags all of it**, because the content package records those fields as outstanding, and the preview outlines every one. That is a mitigation and not a fix. **This is ours to correct, not Dan's**, and it is raised here because it is the live example of the exact failure the convention exists to prevent.

**2. Whether the Viewer role has real users.** Open question Q19, and it decides whether the analytics dashboard is Dan only or marketing self serve. Built for self serve, at the same effort, so this decision costs nothing to defer but it should be answered before the acceptance run so the right person is sitting at the keyboard.

**3. Who holds Admin, and on which identity provider.** Role management lives in the identity provider, not in this API. The AWS credentials were verified on 19 August and IAM role creation is still outstanding, so this cannot be settled on our side.

**4. Whether a shareable preview link is needed.** See section 9, item 6. If a preview has to be openable by somebody without an admin account, it is a contract addition and it costs schedule.

**5. Content, which is now the only thing standing between this tool and its acceptance criterion.** The tool works end to end today. What it will do at the acceptance run, unless real content lands first, is require a marketing team member to type `PUBLISH PLACEHOLDER CONTENT` in front of us in order to publish a blend. That is the guard behaving exactly as designed and it is not a defect. It is also not the demonstration anybody wants, and the way to avoid it is content for Persian Sunrise and Caribbean Sunset.

**6. Media upload cannot be exercised end to end until there is an S3 bucket.** The three call flow is built and the first and third calls work locally. The middle call is a PUT from the browser to a presigned S3 URL, and there is no S3 on a laptop. The screen reports that failure plainly rather than leaving a record stuck at `pending`. It is the one part of this deliverable that needs the AWS account before it can be signed off.

---

## 11. How it is put together

```
src/
  config.ts              configuration, resolved once on first use
  contract.ts            the frozen OpenAPI document, and every minimum role in the system
  auth/
    roles.ts             Viewer, Editor, Admin
    users.ts             the local development identity provider, refused in production
    session.ts           signed cookie sessions
    tokens.ts            mints the API bearer token, exactly one role, never more
    guard.ts             THE AUTHORISATION FILE
  api/
    client.ts            the one door to the API, with the second role check
    errors.ts            the contract error envelope, and plain language for each code
    types.ts             response shapes transcribed from the contract
  content/
    readiness.ts         reads build/content, read only
    placeholder.ts       the five detectors
  publish/
    guard.ts             the placeholder publish guard and its override
    verify.ts            did it actually work
    audit.ts             append only record of the decisions that are hard to undo
  preview/render.ts      the consumer page as it will be, with the render contract applied
  routes/                one file per screen group
  views/                 html escaping, the shell, and the shared components
public/
  admin.css              one stylesheet, no framework, no web font
  preview.css            the placeholder render contract
  admin.js               the browser to S3 upload, and nothing else
test/
  unit/                  contract, roles, sessions, placeholder detection, guard, NFC grouping, house style
  integration/           role enforcement, publish, editing, preview, placeholder rendering
  live/                  the same shape against the real API, skipped when it is not running
```

### Test results, run on Friday 4 September 2026

| Suite | Files | Tests | Result |
|---|---|---|---|
| `npm test` (unit and integration) | 11 | 202 | all passing |
| `npm run test:live` (against `build/api` on :3001) | 1 | 11 | all passing |
| `npm run typecheck` | | | clean |
| `npm audit` | | | 0 vulnerabilities, runtime and development |

Of the 202, 97 are role enforcement: every route asserted unauthenticated, asserted for each insufficient role, and asserted for the role that should hold it, plus the token scope, the revocation case, CSRF and cookie tampering.

---

## 12. Configuration

Every value has a working default for local development. Nothing here is a secret outside a laptop.

| Variable | Default | Notes |
|---|---|---|
| `STAGE` | `local` | `production` refuses the development identity provider and development token signing. |
| `PORT` | `3002` | |
| `API_BASE_URL` | `http://localhost:3001` | The tap-to-story API. |
| `CONTRACT_PATH` | `../api/openapi/openapi.yaml` | The frozen contract. Read at startup. |
| `CONTENT_DIR` | `../content` | The content package. Read only. Absent means everything Trevean owns is unverified. |
| `SESSION_SECRET` | development value | Signs the session cookie. |
| `API_DEV_JWT_SECRET` | development value | Matches the API's development key. Unused when a real identity provider is configured. |
| `AUTH_ISSUER`, `AUTH_AUDIENCE` | local values | Must match the API. |
| `USERS_FILE`, `AUDIT_FILE` | `./data/...` | Local development only. |
| `PUBLISH_VERIFY_ATTEMPTS`, `PUBLISH_VERIFY_INTERVAL_MS` | `6`, `700` | How long the publish screen waits before saying "not confirmed yet". |
| `PUBLISHER_BASE_URL` | unset | The publish pipeline in `build/publisher`. Unset means the screen claims nothing about the edge. |
| `PUBLISH_PUBLISHER_ATTEMPTS`, `PUBLISH_PUBLISHER_INTERVAL_MS` | `8`, `1000` | How long the screen waits on the pipeline before saying "still regenerating". |

---

## 13. Related documents

Cross-references are by document title and section number, never by filename.

- The frozen API contract, sections 2, 4, 5, 8 and 10
- The Data model document, sections 3 and 7
- The Architecture document, "Admin CMS", "Rendering", "Security and privacy"
- The Acceptance criteria document, section 6.2
- The Scope document, "In scope" row 3, and "IP and handoff"
- The placeholder convention and the content field specification, in the content package
- `MANIFEST.md` in this directory, for the background IP obligation
