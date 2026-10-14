# ===========================================================================
# The externalised render cache
#
# This module exists because of one sentence in the Architecture document,
# section "Hypotheses to confirm in the audit", item 2:
#
#   The render cache not externalised. On serverless functions, Next.js
#   defaults its regeneration cache to the local filesystem, so every
#   concurrent instance keeps its own copy and a cold instance starts empty.
#   It needs shared object storage with a shared index. This is the most
#   common serious mistake in this stack and it is invisible until it is an
#   incident.
#
# Two resources, and both are needed. Object storage alone is not enough.
#
#   The BUCKET holds the rendered payloads.
#   The INDEX TABLE holds the metadata every instance has to agree on:
#   which entry is current, when it was generated, which tags it belongs to,
#   and which instance holds the in-flight regeneration lock. Without a shared
#   index, two instances can both decide an entry is stale and both regenerate
#   it, and neither can tell that a publish already invalidated it.
#
# Why "invisible until it is an incident": with warm instances and low
# concurrency the local-filesystem default behaves exactly like a working
# cache. It fails on the first cold instance, on the first scale-out, and on
# the first publish that has to reach every instance at once. Those three
# conditions arrive together on a launch day or a demo day.
#
# A note so this does not look like a schema violation. The document titled
# "Data model", section 2, holds the line at five application tables. The
# index table below is not a sixth application table: it holds no content, no
# scan data and no editorial state, it is infrastructure for the rendering
# layer, and nothing in the eight access patterns reads it. It is named
# distinctly for exactly that reason.
# ===========================================================================

resource "aws_s3_bucket" "render_cache" {
  bucket = "${var.name_prefix}-render-cache"
  tags = merge(var.tags, {
    Purpose = "Shared render cache. Not a content store."
  })
}

resource "aws_s3_bucket_public_access_block" "render_cache" {
  bucket                  = aws_s3_bucket.render_cache.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "render_cache" {
  bucket = aws_s3_bucket.render_cache.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "render_cache" {
  bucket = aws_s3_bucket.render_cache.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = var.kms_key_arn != null ? "aws:kms" : "AES256"
      kms_master_key_id = var.kms_key_arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "render_cache" {
  bucket = aws_s3_bucket.render_cache.id

  rule {
    id     = "expire-stale-cache-entries"
    status = "Enabled"

    filter {}

    expiration {
      days = var.cache_entry_expiry_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

data "aws_iam_policy_document" "render_cache" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    resources = [
      aws_s3_bucket.render_cache.arn,
      "${aws_s3_bucket.render_cache.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "render_cache" {
  bucket = aws_s3_bucket.render_cache.id
  policy = data.aws_iam_policy_document.render_cache.json
}

# ---------------------------------------------------------------------------
# The shared index
#
#   pk  the cache key, or TAG#{tag} for a revalidation marker
#   sk  ENTRY, or the cache key a tag points at
#
# The tag namespace is what makes "publishing invalidates and re-renders
# exactly the affected pages" true rather than aspirational: a publish writes
# one marker per affected tag and every instance sees it on its next read.
#
# TTL on expiresAt so revalidation markers do not accumulate.
# ---------------------------------------------------------------------------

resource "aws_dynamodb_table" "render_cache_index" {
  name         = "${var.name_prefix}-render-cache-index"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  deletion_protection_enabled = var.enable_deletion_protection

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = false
  }

  server_side_encryption {
    enabled     = var.kms_key_arn != null
    kms_key_arn = var.kms_key_arn
  }

  tags = merge(var.tags, {
    Purpose = "Shared render cache index. Not one of the five application tables."
  })
}
