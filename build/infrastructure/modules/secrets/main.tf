# ===========================================================================
# Secrets
#
# From the Architecture document, section "Security and privacy":
#
#   Secrets in a managed store, never in the repo, including the tag password
#   with a documented holder and rotation path.
#
# THIS MODULE CREATES THE CONTAINERS, NOT THE VALUES. Every secret is created
# with a placeholder that is obviously not a credential, and with
# ignore_changes on secret_string so that a value set out of band by the named
# holder is never reverted by an apply.
#
# That is deliberate and it is the whole design. A Terraform run that knows a
# secret writes that secret into state, and state is a file that gets copied,
# backed up, and occasionally emailed. The value goes in through the console or
# the CLI, once, by a person.
#
# ---------------------------------------------------------------------------
# THE TAG PASSWORD, IN FULL, BECAUSE ITS ROTATION PATH IS NOT A NORMAL ONE
# ---------------------------------------------------------------------------
#
# Secret: trevean/{env}/nfc-tag-area-password
#
# THE CHIP IS ST25TV02KC: NFC FORUM TYPE 5 / ISO 15693. It is not NTAG21x /
# Type 2. It uses area-based 64-bit password protection, not lock bits.
# Anything written about this secret that assumes lock bits was written about a
# different chip. This has already been mis-assumed once on this project.
#
# HOLDER: one named person, set through var.tag_password_holder and recorded in
# the Holder tag on the secret. Not a team, not a mailbox. A password nobody is
# individually accountable for is a password nobody notices the loss of until
# it is needed.
#
# ROTATION PATH:
#
#   1. This password is not rotated by a job. It is presented to a chip at
#      write time. Changing it means re-presenting the current password to each
#      tag and setting a new one, physically, tag by tag.
#
#   2. CORRECTED SATURDAY 22 AUGUST 2026. This previously said that whether the
#      1,000 tags shipped on 24 July 2026 under supplier order SO4731 can be
#      re-written at all was unknown, and that the redirect table recorded
#      writeProtected as null on every row. Both were superseded on Wednesday
#      19 August 2026: Q4 closed under decision D18, SO4731 shipped with NO
#      write protection, and the redirect table records writeProtected as false
#      on the four encoded rows and null only on the reserved kg row where no
#      tag exists to have a state.
#
#   3. The realistic rotation path is still: rotate AT THE NEXT TAG ORDER, when
#      a new password is set at encoding time. Re-encoding a thousand jars by
#      hand is a real operation with a real cost and it is Trevean's line, not
#      a keystroke, so a second option existing is not a reason to lean on it.
#      The redirect table stays the primary recovery mechanism and D10 is
#      untouched.
#
#   4. Changing the password on the shipped run is now possible rather than
#      unknown. It is a physical re-encoding pass over inventory, re-verified
#      against the tag code map, and it is scheduled work with a cost, not an
#      operations task. To confirm rather than assume: "no write protections"
#      is Dan's answer, not Tagstand's written one, so verify by read-back
#      against bare ST25TV02KC stock and against one shipped jar before
#      anything depends on rewritability.
#
# No PII is on the chip and no customer data is protected by this password.
# What it protects is the ability to re-point a tag, which is the same
# capability that strands inventory if it is misused.
# ===========================================================================

locals {
  path = "trevean/${var.environment}"

  managed_secrets = merge({
    "shopify-admin-api-token" = {
      description    = "Shopify Admin API access token. Catalog mirror sync, on a schedule and on product-update webhooks."
      rotation       = "Rotate in the Shopify admin, then update this secret. Rotating first and updating second causes a sync outage, not a page outage: prices go stale, pages keep serving."
      rotation_class = "rotate-upstream-then-update"
    }
    "shopify-storefront-token" = {
      description    = "Shopify Storefront API token. Needed only for anything richer than a cart permalink. The one-tap reorder path uses no credential at all."
      rotation       = "Rotate in the Shopify admin, then update this secret."
      rotation_class = "rotate-upstream-then-update"
    }
    "shopify-webhook-secret" = {
      description    = "Shopify webhook signing secret. Signature verification on every inbound webhook."
      rotation       = "Accept both values for one deployment window, then drop the old one, or inbound webhooks fail closed during the change."
      rotation_class = "overlap-two-values"
    }
    "revalidation-secret" = {
      description    = "HMAC key the API signs its revalidation dispatch with and the publish pipeline verifies. Publish renders pages and invalidates cached ones, and an unauthenticated invalidation endpoint is a denial of service primitive pointed at the one thing that protects the 2.0 second tap budget. The pipeline refuses an unsigned job rather than accepting one when this is absent."
      rotation       = "Accept both values for one deployment window, then drop the old one, or every publish fails closed during the change. Failing closed is correct here: the previous page keeps serving."
      rotation_class = "overlap-two-values"
    }
    "admin-jwt-signing-key" = {
      description    = "Signing key for admin bearer tokens. There are no customer accounts, so the blast radius is the admin CMS only."
      rotation       = "Publish the new key alongside the old one for one token lifetime, then retire the old one."
      rotation_class = "overlap-two-values"
    }
    "nfc-tag-area-password" = {
      description    = "ST25TV02KC 64-bit AREA password (Type 5 / ISO 15693, not NTAG lock bits). Named holder in the Holder tag. Rotation is manual and happens at encoding time on the next tag order: see the header comment in modules/secrets/main.tf. Q4 closed on 19 August 2026 under D18."
      rotation       = "Manual, at encoding time, on the next tag order. Not rotatable by a job. Q4 closed on 19 August 2026 under D18: SO4731 shipped with no write protection, so the shipped run can be re-encoded, at a physical cost."
      rotation_class = "manual-at-encoding-time"
    }
    }, {
    for name, description in var.extra_secrets : name => {
      description    = description
      rotation       = "TO CONFIRM IN AUDIT."
      rotation_class = "to-confirm-in-audit"
    }
  })

  # Tag values accept only letters, digits, spaces and + - = . _ : / @
  # The holder is client supplied, so it is sanitised rather than trusted:
  # a nomination like "Dan Blizinski, Trevean Spice" carries a comma and
  # would fail the apply with a message that names tagging rather than
  # punctuation. Stripping is the safe direction: a tag is a label, and the
  # authoritative holder is recorded in the M1 package, not here.
  holder_tag = {
    for name, _ in local.managed_secrets :
    name => substr(replace(
      name == "nfc-tag-area-password" ? var.tag_password_holder : "Serene Labs Inc until handover",
      "/[^a-zA-Z0-9 _.:=+@-]/", ""
    ), 0, 256)
  }
}

# ---------------------------------------------------------------------------
# Key
#
# THE KEY POLICY IS NOT OPTIONAL AND IT IS NOT AN IAM PROBLEM.
#
# Eight Lambda log groups in modules/compute set kms_key_id to this key.
# CloudWatch Logs encrypts through the service principal logs.<region>.
# amazonaws.com, which is not a principal in this account, so no IAM role
# policy anywhere can grant it. Without the second statement below, the default
# key policy applies, CreateLogGroup returns
#
#   InvalidParameterException: The specified KMS key does not exist or is not
#   allowed to be used with LogGroup
#
# and the apply dies on the first of the eight log groups. terraform validate
# and terraform plan both pass on the way there, which is why the 19 August
# plan of 140 resources reported nothing.
#
# The encryption context condition is what stops this being a grant of the key
# to CloudWatch Logs generally. Logs sets aws:logs:arn in the encryption
# context on every call, so pinning it to this account and this region means a
# log group in somebody else's account cannot be decrypted with this key even
# if its ARN were known.
#
# The account root statement stays. Removing it is how a KMS key becomes
# permanently unmanageable: there is no root override on a key policy, so a key
# whose policy names nobody who can change the policy is a key nobody can ever
# change again.
# ---------------------------------------------------------------------------

data "aws_partition" "current" {}
data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "key" {
  count = var.create_kms_key ? 1 : 0

  # resources = ["*"] in a key policy means this key and nothing else. It is
  # not the wildcard the IAM policies in modules/compute deliberately avoid:
  # a key policy is attached to one key and has no other resource to name.
  statement {
    sid       = "AccountRootAdministersTheKey"
    effect    = "Allow"
    actions   = ["kms:*"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = ["arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }

  statement {
    sid    = "CloudWatchLogsEncryptsLogGroupsInThisAccountAndRegion"
    effect = "Allow"

    actions = [
      "kms:Encrypt*",
      "kms:Decrypt*",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
      "kms:Describe*",
    ]

    resources = ["*"]

    principals {
      type        = "Service"
      identifiers = ["logs.${data.aws_region.current.name}.amazonaws.com"]
    }

    condition {
      test     = "ArnLike"
      variable = "kms:EncryptionContext:aws:logs:arn"
      values   = ["arn:${data.aws_partition.current.partition}:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:*"]
    }
  }
}

resource "aws_kms_key" "main" {
  count                   = var.create_kms_key ? 1 : 0
  description             = "${var.name_prefix} customer managed key: secrets, tables, buckets, queues."
  deletion_window_in_days = var.kms_deletion_window_days
  enable_key_rotation     = true
  policy                  = data.aws_iam_policy_document.key[0].json
  tags                    = var.tags
}

resource "aws_kms_alias" "main" {
  count         = var.create_kms_key ? 1 : 0
  name          = "alias/${var.name_prefix}"
  target_key_id = aws_kms_key.main[0].key_id
}

# ---------------------------------------------------------------------------
# Secrets
# ---------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "managed" {
  for_each = local.managed_secrets

  name = "${local.path}/${each.key}"

  # The rotation procedure lives in the DESCRIPTION, not in a tag. An AWS tag
  # value accepts only letters, digits, spaces and + - = . _ : / @ , so a
  # comma in a sentence fails the create with "Request rejected by the
  # downstream tagging service", which is an unhelpful message for a
  # punctuation problem. Descriptions take 2048 characters and any prose.
  # Observed on the first real apply, Thursday 27 August 2026: five secrets
  # failed on exactly this while the other 135 resources succeeded.
  description = substr("${each.value.description} ROTATION: ${each.value.rotation}", 0, 2048)

  kms_key_id              = var.create_kms_key ? aws_kms_key.main[0].arn : null
  recovery_window_in_days = var.secret_recovery_window_days

  # Tags carry short machine readable slugs only. Anything a human needs to
  # read in a sentence goes in the description above.
  tags = merge(var.tags, {
    RotationClass = each.value.rotation_class
    Holder        = local.holder_tag[each.key]
  })
}

resource "aws_secretsmanager_secret_version" "placeholder" {
  for_each = local.managed_secrets

  secret_id     = aws_secretsmanager_secret.managed[each.key].id
  secret_string = jsonencode({ value = "FILL IN WHEN ACCESS LANDS", set_by = "terraform-placeholder" })

  lifecycle {
    ignore_changes = [secret_string, version_stages]
  }
}

# ---------------------------------------------------------------------------
# Non-secret configuration
#
# Parameter Store for things that are configuration rather than credentials.
# Keeping them apart matters: an operator reading a Shopify store domain should
# not need a permission that also reads the Shopify token.
# ---------------------------------------------------------------------------

resource "aws_ssm_parameter" "shopify_store_domain" {
  name        = "/${local.path}/shopify-store-domain"
  description = "Shopify Plus store domain. Configuration, not a credential."
  type        = "String"
  value       = "FILL IN WHEN ACCESS LANDS"
  tags        = var.tags

  lifecycle {
    ignore_changes = [value]
  }
}
