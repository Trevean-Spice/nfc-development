# Bootstrap: remote state

> **Placeholders.** Values in angle brackets, such as `<TREVEAN_DEV_ACCOUNT_ID>`, `<TREVEAN_MANAGEMENT_ACCOUNT_ID>`, `<TREVEAN_ORG_ID>`, `<TREVEAN_MANAGEMENT_ROOT_EMAIL>`, `<TREVEAN_DEV_ROOT_EMAIL>`, `<TREVEAN_PREFIX_SUFFIX>` and `<TREVEAN_DISTRIBUTION_DOMAIN>`, stand in for Trevean's real AWS identifiers. The real values are in Trevean's private record, not in this public repository.

**Read this before the first `terraform init`.** It is roughly twenty minutes
of work per account and it is not optional.

---

## The answer first

**Remote state in S3, one bucket per AWS account, with versioning, encryption,
public access blocked, and native S3 locking. No DynamoDB lock table.**

Three state files, as intended:

| Environment | Account | State key |
|---|---|---|
| dev | `<TREVEAN_DEV_ACCOUNT_ID>`, `Trevean-NFC-Development` | `trevean-spice-nfc/dev/terraform.tfstate` |
| staging | a Serene Labs account | `trevean-spice-nfc/staging/terraform.tfstate` |
| **prod** | **Trevean's production account** | `trevean-spice-nfc/prod/terraform.tfstate` |

**Production state lives in Trevean's account, not ours.** That is not filing
preference and it is worth one paragraph. The deliverables are work for hire
and the IP clause gives Trevean the right to engage any third party to modify
them. A third party who has the code, has the AWS account, and does not have
the state file cannot safely change anything: they can only guess at what is
deployed, or import it resource by resource. The state file is part of what is
being handed over, so it lives where the thing it describes lives.

---

## What is actually true today, Thursday 27 August 2026

**The table above is the intent, and the dev row now describes a real deployed
environment.** The two rows below it still do not: staging and production have
never been initialised or applied.

**1. `envs/dev` state is in the correct account, and the claim that it was not
is withdrawn.** The backend configuration is:

```
bucket: "trevean-tfstate-<TREVEAN_DEV_ACCOUNT_ID>"
key:    "trevean-spice-nfc/dev/terraform.tfstate"
region: "us-east-1"
```

**CORRECTED THURSDAY 27 AUGUST 2026, and kept visible rather than deleted.**
From Monday 24 August to Thursday 27 August this section said `<TREVEAN_DEV_ACCOUNT_ID>` is
Trevean's Organization **management** account, that the bucket was in the wrong
place, and that dev state had to move once a Development account existed. **All
three were wrong, and they were wrong the same way: the two accounts were
reversed.**

| Account | Name | What it is |
|---|---|---|
| `<TREVEAN_MANAGEMENT_ACCOUNT_ID>` | `Trevean Spice` | The Organization management account, `<TREVEAN_MANAGEMENT_ROOT_EMAIL>`, org `<TREVEAN_ORG_ID>` |
| `<TREVEAN_DEV_ACCOUNT_ID>` | `Trevean-NFC-Development` | **The development account**, `<TREVEAN_DEV_ROOT_EMAIL>` |

Verified with `aws organizations list-accounts` and `describe-organization`.
**So there is nothing to move, nothing to delete, and no account to create.**
The bucket is correctly configured (versioned, encrypted, public access
blocked), it is in the development account, and the development environment was
applied through it on Thursday 27 August 2026 at 169 resources.

**Why the error is recorded here rather than tidied away.** The account was
verified empty before anything was created in it, per risk R3, and emptiness
was then read as identity. It was never checked for name. **A resource
inventory is not an identity check**, and one `aws organizations
describe-organization` or `aws iam list-account-aliases` call would have caught
it on day one instead of costing a week. See "Decision log", D32.

**2. The dev workspace was initialised without locking and without the encrypt
flag.** The same recorded backend configuration read `use_lockfile: null` and
`encrypt: null`. Both `backend.hcl.example` files set them; the `backend.hcl`
actually used did not. So the section below titled "Why there is no DynamoDB
lock table" describes a design that was not in force where it counts, and the
silent loss of locking it warns about in the abstract had already happened.

Because `backend.hcl` is deliberately not committed, **nothing in this
repository can demonstrate that any environment was ever initialised with
locking on.** Check the recorded backend block in
`envs/<env>/.terraform/terraform.tfstate` after every `init` until there is a
pipeline that does it for you. `use_lockfile` and `encrypt` must both read
`true`.

**3. The saved dev plan is void. Delete it, do not trust it.**
`envs/dev/dev.tfplan`, 91 KB, dated Wednesday 19 August 2026, is the 140
resource plan quoted in the README. **Corrected Thursday 27 August 2026: it did
not plan resources into the wrong account.** It was taken against
`<TREVEAN_DEV_ACCOUNT_ID>`, which is the development account and the right target, and that
half of this warning is withdrawn. It is void for two reasons that survive: it
predates the CloudWatch Logs key policy fix in `modules/secrets/main.tf`, so
applying it would have failed on the first of eight log groups, and it is
superseded outright by the applied 169 resource environment.

A saved plan file is exactly the kind of artifact that gets applied by somebody
in a hurry. It is gitignored, so deleting it costs nothing and leaves nothing
to recover.

---

## Why the bootstrap is manual

A Terraform configuration cannot create the bucket that holds its own state.
The first apply would have nowhere to write the record of having created it.

Every solution to that is worse than accepting it: a separate bootstrap
configuration with local state creates a second state file that has to be kept
somewhere, and a `terraform init -migrate-state` dance adds a step that only
runs once and is therefore never practised. Six commands, run once per account,
is the cheaper answer.

---

## Bootstrap, per account

Run once per account that holds state. As of Thursday 27 August 2026 that is
three, and **one of the three is already done**: the dev bucket
`trevean-tfstate-<TREVEAN_DEV_ACCOUNT_ID>` exists in `<TREVEAN_DEV_ACCOUNT_ID>`,
`Trevean-NFC-Development`. What remains is a Serene Labs account for staging
and Trevean's production account. **None of the three is `<TREVEAN_MANAGEMENT_ACCOUNT_ID>`, the
Organization management account**, and state never belongs there.

```sh
# Pick a suffix. Bucket names are globally unique across every AWS account,
# so "trevean-tfstate" is almost certainly taken.
BUCKET=trevean-tfstate-CHANGEME
REGION=us-east-1

aws s3api create-bucket \
  --bucket "$BUCKET" \
  --region "$REGION"

# Versioning first. This is what makes a corrupted or truncated state file
# recoverable, and state corruption is the failure this whole section exists
# to survive. Turning it on afterwards does not protect the versions you
# already lost.
aws s3api put-bucket-versioning \
  --bucket "$BUCKET" \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket "$BUCKET" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'

aws s3api put-public-access-block \
  --bucket "$BUCKET" \
  --public-access-block-configuration \
  'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'

# State files contain resource identifiers and, if anyone ever puts a secret in
# a Terraform variable, secrets. Refuse plaintext transport outright.
aws s3api put-bucket-policy \
  --bucket "$BUCKET" \
  --policy "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Sid\": \"DenyInsecureTransport\",
      \"Effect\": \"Deny\",
      \"Principal\": \"*\",
      \"Action\": \"s3:*\",
      \"Resource\": [\"arn:aws:s3:::$BUCKET\", \"arn:aws:s3:::$BUCKET/*\"],
      \"Condition\": {\"Bool\": {\"aws:SecureTransport\": \"false\"}}
    }]
  }"
```

That is the whole bootstrap.

---

## Why there is no DynamoDB lock table

Terraform 1.10 introduced native S3 state locking with `use_lockfile = true`.
It holds a lock object in the same bucket as the state.

Older guidance, and most of what is currently on the internet, tells you to
create a DynamoDB table with a `LockID` key and set `dynamodb_table` in the
backend. That advice is now obsolete, and it carried a real cost on a handover:
one more resource, in one more service, that has to be created before the first
init and that nobody remembers at handover. **Its absence does not fail loudly.
It silently disables locking**, and the symptom arrives months later as two
concurrent applies corrupting a state file.

We are on Terraform 1.15. Native locking is the design and there is no lock
table.

**It was not in force on the dev workspace.** See "What is actually true today"
above, point 2: the recorded backend configuration reads `use_lockfile: null`.
The paragraph above describes the failure that had already been arranged.
Verify `use_lockfile` after every `init` rather than assuming the
`backend.hcl.example` was the file used.

---

## Initialising

Each environment directory holds a `backend.hcl.example`. Copy it, fill in the
bucket, and initialise:

```sh
cd envs/staging
cp backend.hcl.example backend.hcl
# edit backend.hcl: set the bucket name
terraform init -backend-config=backend.hcl
```

`backend.hcl` is not committed. It names an account and a bucket, which is not
secret but is not repository content either, and keeping it out means the same
configuration serves our accounts and Trevean's without editing a tracked file.

---

## Access, and who holds what

**TO CONFIRM IN AUDIT and with Dan.** The intended shape:

| Who | dev and staging state | production state |
|---|---|---|
| Serene Labs engineers | read and write | read and write during the engagement |
| Trevean, after handover | no need | read and write, exclusively |
| The application's CI pipeline | read and write | plan only, if it exists at all |

Two things follow that should be agreed rather than assumed:

1. **Read access to production state is effectively read access to the shape of
   the production system.** It should be a small, named list, not "whoever has
   an AWS account".
2. **At handover, Serene Labs access to the production state bucket is
   revoked.** That is a deliberate step on a checklist, not something that
   happens because the engagement ended. It belongs in the M5 handover items.

---

## If state is lost or corrupted

In order, cheapest first.

1. **Restore the previous version from the bucket.** This is what versioning is
   for and it takes about a minute. `aws s3api list-object-versions` then copy
   the previous version over the current one.
2. **Re-import.** Every resource in this configuration has a stable name, so
   `import` blocks can rebuild state from the running system. Slow, tedious,
   and it works.
3. **Never `terraform destroy` to get back to a clean state.** On production
   that destroys the hosted zone that 1,000 encoded jars resolve through. The
   zone carries `prevent_destroy` and the tables carry deletion protection for
   exactly this reason, and neither should be relaxed to make a command work.

---

## What is NOT in state, deliberately

**Secret values.** The `secrets` module creates containers with placeholders
and carries `ignore_changes` on the value, so real credentials are set out of
band by the named holder and never pass through Terraform. A Terraform run that
knows a secret writes it into state, and state is a file that gets copied,
backed up, and occasionally emailed.

**Application code.** Every function carries `ignore_changes` on its package.
Terraform owns each function's identity, permissions and wiring; the
application pipeline owns its code.

**The redirect table.** It is compiled into the CloudFront Function by
`build/edge/`, from a file in version control. It is never state, never
hand-edited in a console, and never a Terraform variable. The document titled
"Data model", section 7.1, is explicit: a host migration that leaves the table
behind does not break a deployment, it strands inventory.
