# Root `package.json`, the exact changes

Destination: `package.json` at the root of `nfc-development`. Shown as hunks rather than a
whole file, because the manifest carries an author line and a licence that are not ours to
touch in a consolidation pull request.

Every hunk names the pull request it belongs to, so a reviewer can check that no pull
request is carrying a change that belongs in another one.

---

## Hunk 1, PR 3. Declare the two undeclared AWS SDK packages

```diff
   "dependencies": {
+    "@aws-sdk/client-dynamodb": "^3.658.0",
+    "@aws-sdk/lib-dynamodb": "^3.658.0",
     "aws-sdk": "^2.1500.0",
     "cors": "^2.8.5",
```

`config/database.ts:1` imports `@aws-sdk/client-dynamodb` and `scripts/seed.ts:1` imports
`@aws-sdk/lib-dynamodb`. Neither is declared anywhere, so neither is installed, so
`config/` cannot compile and `npm run db:seed` fails at module resolution. Verified by
reading the import lines rather than by trusting the audit.

**The third undeclared import is not declared. Its file is deleted.** `config/redis.ts:1`
imports `redis`, a different client library from the `ioredis` that everything under
`src/api` uses and that the manifest already declares. Nothing imports `config/redis.ts`:
grepped for `config/redis`, `./redis` and `RedisCache` across the repository, and the only
matches are inside the file itself. Declaring a package so that dead code can compile is
the wrong direction. Deleting the file removes the import, the second competing Redis
client, and 165 lines nothing calls, and it costs nothing because nothing references it.

`src/api/middleware/cache.ts` is dead in the same way and on the same evidence, but it
imports `ioredis`, which is declared, so it is not part of this pull request. It goes with
the Redis removal, which is separate work.

---

## Hunk 2, PR 3. `engines`, matching the version everything else requires

```diff
   "engines": {
-    "node": ">=18.0.0",
+    "node": ">=20.11.0",
     "npm": ">=9.0.0"
   },
```

A floor of 18 disagrees with `.nvmrc`, with the contract test suite (`>=20.11.0`) and with
the performance budget scripts (`>=20`). A developer on Node 18 gets a different answer
from CI, which is the class of difference that costs a morning.

---

## Hunk 3, PR 3. A `start` script, which does not currently exist

```diff
     "build:web": "cd src/web && next build",
     "build": "npm run build:api && npm run build:web",
+    "start": "npm --workspace @trevean/web run start",
+    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p src/api/tsconfig.json && tsc --noEmit -p src/web/tsconfig.json",
```

There is no `start` script in the root manifest as inherited. The performance budget CI
package assumes `npm run start` exists and its adoption guide says to confirm it; the
confirmation is that it does not, so it is added here. `src/web/package.json` already
declares `"start": "next start"`, so this delegates rather than duplicating.

`typecheck` is added because three projects now need checking separately and nobody should
have to remember the third one.

---

## Hunk 4, PR 6. Point the integration test script at the directory that exists

```diff
     "test:unit": "jest --testPathPattern=tests/unit",
-    "test:integration": "jest --testPathPattern=tests/integration",
+    "test:integration": "jest --testPathPattern=tests/integration/",
     "test:e2e": "jest --testPathPattern=tests/e2e",
```

**Correction to the scaffold audit, section 8.4.** The audit states that
`test:integration` "matches nothing" because the directory is `tests/integrations`,
plural. That is not right, and the difference matters because it changes what the fix is.
`--testPathPattern` takes a regular expression and matches it against the full test path
without anchoring, so on a POSIX runner the pattern `tests/integration` matches
`tests/integrations/api.test.ts` as a substring. The script was not broken in the way
recorded.

What is true is that the pattern is fragile: it uses a forward slash, and on Windows the
test paths use backslashes, so the same command matches on CI and matches nothing on a
developer's machine. The trailing slash above makes the intent explicit once the
replacement suite lands in `tests/integration/`, singular, which is the name the
documentation already uses.

---

## Hunk 5, PR 10. Devdependency for the budget CI

```diff
   "devDependencies": {
+    "@lhci/cli": "^0.14.0",
     "@types/cors": "^2.8.15",
```

Its licence row is in `MANIFEST.md`. A dependency added without one is a defect.

---

## Hunk 6, PR 11, CLIENT AGREEMENT REQUIRED. Remove the mobile workspace

```diff
   "workspaces": [
     "src/api",
-    "src/web",
-    "src/mobile"
+    "src/web"
   ],
```

See `04-react-native-workspace.md`. The files stay in version control. This hunk, and the
deletion of `.npmrc`, are the whole change.

---

## What is deliberately NOT changed

| Left alone | Why |
|---|---|
| `"name": "nfc-prototype"` | The repository is `nfc-development` and `README.md:76` gives a clone URL for a third name, `nfc-prototype`. Renaming a package is harmless; guessing which of three names is intended is not. It is question 2 on the list for Dan, and it is one line once he answers |
| `"author": "Trevean Spice <TREVEAN_OWNER_EMAIL>"` | A personal address in a repository that will be handed over. Not a secret, not ours to change, noted at handover |
| `"license": "MIT"` | `LICENSE` asserts Trevean's copyright and grants MIT to the world while `README.md` and `CONTRIBUTING.md` credit Microgroove with the platform development. MIT is an outbound grant, not an inbound assignment. That is a conversation for Dan, not a manifest edit |
| `aws-sdk` v2 | End of support, and npm prints the deprecation on every install. Removing it is a rewrite of `src/api/models`, not a manifest change, and those files are being rewritten anyway |
| `commander` | Declared, imported nowhere. It is what a CLI that was planned and never written leaves behind. It goes when the chip tooling question is settled rather than as a tidy-up now |
