# `scripts/deploy.sh`, the exact change

Destination: `scripts/deploy.sh` in `nfc-development`. PR 2 of the consolidation plan.

**This is not a repair. It is a stop.** The script is not fixed here and should not be
fixed here: `scripts/build.sh` produces neither `dist/api` nor `dist/web`, and this script
consumes both under `set -e`, so the two have never run together and there is no working
pipeline to restore. The deploy path is rebuilt against our own infrastructure as code.
What this pull request does is make sure nobody runs the inherited one in the meantime.

---

## Why it is a hazard rather than a defect

Read line by line, `deploy.sh` names no AWS account, no `--profile`, no `role_arn` and no
`sts assume-role`. It runs against whatever ambient credentials the operator happens to
hold. Two outcomes, and the first is the reason this pull request is second in the order
rather than tenth:

- **With Microgroove-era credentials it silently targets Microgroove's account.** Line 77
  runs `aws lambda update-function-code` against `trevean-nfc-api-{env}` and line 96 runs
  `aws s3 sync dist/web s3://trevean-nfc-web-{env} --delete`. No account assertion, no
  target confirmation, no dry run. `--delete` on someone else's bucket.
- **With Trevean credentials it fails at line 77**, because `update-function-code` cannot
  create a function that does not exist, and `set -e` aborts there.

Two further facts read off the same file. Line 96 to 99 applies
`--cache-control "max-age=31536000,public"` to every object synced, HTML included: a blend
page served with a one year browser max-age is uneditable on every handset that has ever
loaded it, for a year, with no server side fix. And line 89 to 93 lets `DISTRIBUTION_ID`
fall back to an empty string on any error, after which the invalidation at line 102 to 107
is skipped, so **a deploy can report success while serving a year old page with no
invalidation**.

---

## The change

Insert immediately after `set -e` on line 5. Nothing else in the file is touched.

```diff
 set -e
 
+# ---------------------------------------------------------------------------
+# DISABLED, 22 August 2026. Do not remove this block to "just try it".
+#
+# This script cannot succeed and can do harm.
+#
+#   1. It consumes dist/api and dist/web. scripts/build.sh produces neither. The two
+#      have never run together, so nothing in this repository has ever been deployed
+#      by this path.
+#   2. It names no AWS account, no profile and no role. It runs against whatever
+#      ambient credentials the operator holds. With credentials from the previous
+#      engagement it updates that account's Lambda and runs `aws s3 sync --delete`
+#      against that account's bucket, with no target confirmation and no dry run.
+#   3. Line 96 applies max-age=31536000 to every object including HTML, and the
+#      CloudFront invalidation below it is skipped silently when the stack lookup
+#      fails, so a deploy can report success while serving a year old page.
+#   4. It reads a CloudFormation stack, trevean-nfc-web-$ENVIRONMENT, whose template
+#      is not in this repository. That stack was real and its definition did not come
+#      with the code.
+#
+# The deploy path is being rebuilt against version controlled infrastructure. Until
+# that lands, this script is a hazard sitting in a repository people clone.
+#
+# If you are the person rebuilding it, set DEPLOY_SH_I_HAVE_READ_THE_AUDIT=1 and
+# expect it to fail at `cd dist/api`.
+if [ "${DEPLOY_SH_I_HAVE_READ_THE_AUDIT:-0}" != "1" ]; then
+    echo "scripts/deploy.sh is disabled. It cannot succeed and it can target the wrong" >&2
+    echo "AWS account. Read the header of this file before doing anything else." >&2
+    exit 1
+fi
+# ---------------------------------------------------------------------------
+
 ENVIRONMENT=${1:-staging}
```

---

## Why an environment variable rather than deleting the file

Deleting it loses the evidence. The script is the only artifact in the repository that
names what the vanished environment contained: a Lambda function, an S3 bucket, a
CloudFront distribution and a CloudFormation stack called `trevean-nfc-web-{env}` with a
`DistributionId` output. That stack existed and its template is not here, which is a
specific, named artifact to ask for. Keeping the file keeps the list.

The variable name is long and unfriendly on purpose. It is not a convenience flag, it is a
statement that the person setting it has read why it is off.

## Same treatment, one line, for `scripts/build.sh`

`build.sh` is inert rather than dangerous: it compiles `src/nfc/`, a directory that has
never existed, and `config/*.ts`, which imports two packages that are not installed, so it
fails on its own. It gets a header comment recording that it produces neither directory
`deploy.sh` consumes, and no guard. Nobody can hurt anything with it.
