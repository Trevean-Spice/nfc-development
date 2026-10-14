# Deploying the admin: what is done and what is left

**Written Tuesday 8 September 2026.** The application side is finished and verified. The
infrastructure side is not started. This file exists so the next session picks up from facts
rather than from re-derivation.

---

## What is done, and verified rather than assumed

**The Lambda entry point.** `src/lambda.ts`, mirroring `build/api/src/lambda.ts`: the app and
proxy are built once per execution environment, binary MIME types are declared so
`@fastify/static` responses are not corrupted, and it refuses to start if `ADMIN_DEV_IDENTITY`
is somehow set.

**The identity provider.** `src/auth/identity.ts` authenticates against a Cognito user pool
with `ADMIN_USER_PASSWORD_AUTH` and reads the role from Cognito groups. The seeded store is
used only on a laptop. **Roles are never defaulted**: a user in no recognised group is refused
rather than admitted as a Viewer, and a Cognito challenge such as `NEW_PASSWORD_REQUIRED` is
treated as a refusal rather than a session, because treating a challenge as success is an
authentication bypass.

**Three security defects found and fixed**, all of which only appear when the thing is
deployed:

1. The seeded identity provider was gated on `stage === 'production'`, and every deployed
   environment here runs `STAGE=staging`. It is now gated on an explicit `ADMIN_DEV_IDENTITY`
   that no deployment sets. Five regression tests hold it shut.
2. The session cookie was `secure: stage === 'production'`, so the cookie carrying the right
   to publish would have been sent without the Secure attribute over HTTPS. Now `!== 'local'`.
3. The sign in page rendered the seeded account passwords in a table. Now gated behind
   `devIdentity`.

**Two path defects fixed**, both of which would have broken the Lambda:

1. `loadConfig(env)` advertised an injectable environment and ignored it: the helpers read
   `process.env` directly. Fixed, and it was found by a test that had no effect.
2. `packageRoot` counted directories, so the compiled tree resolved one level too deep and
   `node dist/src/index.js` died with ENOENT. It now finds `package.json`. **Verified: the
   compiled build starts and serves with no path environment variables at all.**

**207 tests pass**, up from 202.

---

## What is left, in order

### 1. Packaging

Mirror `build/api/scripts/package-lambda.mjs`. It must produce a deterministic zip and print
the sha256, because that is the value AWS reports as `CodeSha256` and it is how a deployment is
confirmed rather than assumed.

**Include `build/api/openapi/openapi.yaml` and `build/content` in the bundle, or set
`CONTRACT_PATH` and `CONTENT_DIR` explicitly on the function.** The admin reads the frozen
contract at startup to derive the minimum role for every operation, and it will not start
without it. That is deliberate and must not be worked around: it is what stops the admin and
the API disagreeing about who may do what.

### 2. Cognito, in `modules/compute` or a new `modules/identity`

- A user pool. Password policy, and MFA optional rather than off.
- A client with `ADMIN_USER_PASSWORD_AUTH` enabled. **No client secret**: the admin calls
  `AdminInitiateAuth` with IAM credentials, not a secret.
- Three groups named exactly `Admin`, `Editor`, `Viewer`. The names are matched literally in
  `roleFromGroups`.
- The admin's execution role needs `cognito-idp:AdminInitiateAuth` and
  `cognito-idp:AdminListGroupsForUser` on that pool, and nothing else.

### 3. The admin function

- Add `admin_ui` to `local.functions` in `modules/compute/main.tf`, and to
  `local.http_invoke_functions` so it gets a function URL. **`admin_api` is deliberately not
  in that list and must stay out of it.**
- Environment: `STAGE`, `API_BASE_URL`, `SESSION_SECRET` from Secrets Manager,
  `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_REGION`.
- **`ADMIN_DEV_IDENTITY` must not be set.** `lambda.ts` refuses to start if it is.

### 4. Its own distribution

Follow `modules/publisher`, which already does exactly this shape: a CloudFront distribution
in front of an origin access control, signing to the function URL.

**Two things that cost an afternoon each when they were missed elsewhere:**

- An origin access control against a function URL needs **`lambda:InvokeFunction` as well as
  `lambda:InvokeFunctionUrl`**. The missing half presents as a signing fault and sends you
  looking at the OAC. See "Decision log", D37.
- Caching must be disabled for the admin, and `Authorization` and `Cookie` must reach the
  origin. A cached admin page is somebody else's draft.

### 5. The first user

`aws cognito-idp admin-create-user`, then `admin-set-user-password --permanent`, then
`admin-add-user-to-group`. **The permanent password step is not optional**: without it the
user lands in `FORCE_CHANGE_PASSWORD`, Cognito answers with `NEW_PASSWORD_REQUIRED`, and
`identity.ts` refuses it. That is correct behaviour and it will look like a broken login.

---

## CLOSED: the admin now has a token to present to the API

**Done on Tuesday 8 September 2026, and it turned out to be smaller than feared.**

`mintApiToken` throws when `allowDevSigning` is false, which is every deployed environment, so
a deployed admin would have signed somebody in and then failed every screen with a 401. That
was observed by running it rather than predicted.

**The fix is carried entirely in the admin, because the API already does its half.**
`rolesFrom` in `build/api/src/auth/jwt.ts` already reads `cognito:groups` as well as `roles`,
and `verifyAccessToken` already prefers JWKS when a URI is configured. **So the API needs
configuration and no code at all.**

On the admin: `AdminInitiateAuth` returns the pool signed id token, `identity.ts` carries it
out, `newSession` stores it, and `apiFor` presents it instead of minting. The seeded store
carries no token, so a laptop still mints locally and nothing about local development changed.

**The API's three settings, which is the whole of its half:**

```
AUTH_JWKS_URI = https://cognito-idp.us-east-1.amazonaws.com/<poolId>/.well-known/jwks.json
AUTH_ISSUER   = https://cognito-idp.us-east-1.amazonaws.com/<poolId>
AUTH_AUDIENCE = <app client id>
```

**`AUTH_AUDIENCE` is the app client id and not a name of our choosing**, because that is what
Cognito puts in `aud` on an id token, and `verifyAccessToken` checks it.

**One thing to watch at the first deployment.** A Cognito id token is roughly a kilobyte, and
it now rides in the session cookie alongside the existing fields. The 4 KB cookie limit is not
close, but if a pool is ever configured with many custom claims this is where that shows up,
as a silently dropped cookie and a sign in that appears to do nothing.

---

## And a question already raised, not yet answered

Whether the Hosted UI would have been the better choice after all. The API approach kept the
existing form, session, CSRF and role machinery, with 105 role tests behind it. But the Hosted
UI gives password reset, MFA and the invite flow for free, and the argument that it would have
cost more token plumbing turned out to be wrong, because the IdToken has to be forwarded
either way. **The cheap moment to change course is before the Terraform is written.**
