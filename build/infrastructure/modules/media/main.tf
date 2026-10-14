# ===========================================================================
# Media pipeline
#
# From the Architecture document, section "Page weight and the performance
# budget", and the frozen API contract, section 10.1:
#
#   upload to S3 via presigned URL so a large file never passes through an
#   application function, then asynchronous derivative generation into
#   responsive modern formats, served from CloudFront
#
# Three calls, and the reason it is three: POST /v1/admin/media/uploads returns
# a presigned S3 PUT URL and a mediaId, the browser uploads DIRECTLY to S3,
# then POST /v1/admin/media/{mediaId}/complete marks it uploaded and enqueues
# derivative generation.
#
# A large photograph never passes through an application function. Premium
# brand photography plus a function-mediated upload is a timeout and a memory
# limit waiting to happen, and it puts image bytes on a code path that has to
# stay fast for other reasons.
#
# Two buckets, because originals and derivatives have different lifecycles,
# different access, and different consequences if lost. An original is the only
# copy of a photograph. A derivative can always be regenerated.
# ===========================================================================

# ---------------------------------------------------------------------------
# Originals: the presigned PUT target. Never public, never an origin.
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "originals" {
  bucket = "${var.name_prefix}-media-originals"
  tags   = var.tags
}

resource "aws_s3_bucket_public_access_block" "originals" {
  bucket                  = aws_s3_bucket.originals.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "originals" {
  bucket = aws_s3_bucket.originals.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "originals" {
  bucket = aws_s3_bucket.originals.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "originals" {
  bucket = aws_s3_bucket.originals.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "originals" {
  bucket = aws_s3_bucket.originals.id

  rule {
    id     = "originals-to-infrequent-access"
    status = "Enabled"

    filter {}

    transition {
      days          = var.originals_retention_days
      storage_class = "STANDARD_IA"
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }

    noncurrent_version_expiration {
      noncurrent_days = 365
    }
  }
}

# The browser PUTs here directly with a presigned URL, so this CORS rule is the
# thing that decides which page is allowed to do it.
resource "aws_s3_bucket_cors_configuration" "originals" {
  count  = length(var.admin_origins) > 0 ? 1 : 0
  bucket = aws_s3_bucket.originals.id

  cors_rule {
    allowed_methods = ["PUT"]
    allowed_origins = var.admin_origins
    allowed_headers = ["content-type", "content-length", "x-amz-checksum-sha256"]
    expose_headers  = ["etag"]
    max_age_seconds = 3000
  }
}

data "aws_iam_policy_document" "originals" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    resources = [
      aws_s3_bucket.originals.arn,
      "${aws_s3_bucket.originals.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "originals" {
  bucket = aws_s3_bucket.originals.id
  policy = data.aws_iam_policy_document.originals.json
}

# ---------------------------------------------------------------------------
# Derivatives: the pipeline's output. Origin for the media distribution.
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "derivatives" {
  bucket = "${var.name_prefix}-media-derivatives"
  tags   = var.tags
}

resource "aws_s3_bucket_public_access_block" "derivatives" {
  bucket                  = aws_s3_bucket.derivatives.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "derivatives" {
  bucket = aws_s3_bucket.derivatives.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "derivatives" {
  bucket = aws_s3_bucket.derivatives.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_cloudfront_origin_access_control" "derivatives" {
  count                             = var.create_media_distribution ? 1 : 0
  name                              = "${var.name_prefix}-media-oac"
  description                       = "Origin access control for the media derivatives bucket."
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_cache_policy" "media" {
  count       = var.create_media_distribution ? 1 : 0
  name        = "${var.name_prefix}-media"
  comment     = "Derivatives are content addressed. Immutable, no query strings in the key."
  default_ttl = 31536000
  min_ttl     = 1
  max_ttl     = 31536000

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true

    query_strings_config {
      query_string_behavior = "none"
    }

    headers_config {
      header_behavior = "none"
    }

    cookies_config {
      cookie_behavior = "none"
    }
  }
}

resource "aws_cloudfront_distribution" "media" {
  count = var.create_media_distribution ? 1 : 0

  enabled         = true
  is_ipv6_enabled = true
  http_version    = "http2and3"
  comment         = "${var.name_prefix} media derivatives. Admin CMS and non-tap-path surfaces only."
  tags            = var.tags

  origin {
    origin_id                = "media-derivatives"
    domain_name              = aws_s3_bucket.derivatives.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.derivatives[0].id
  }

  default_cache_behavior {
    target_origin_id       = "media-derivatives"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = aws_cloudfront_cache_policy.media[0].id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

data "aws_iam_policy_document" "derivatives" {
  dynamic "statement" {
    for_each = var.create_media_distribution ? [1] : []

    content {
      sid     = "AllowCloudFrontServicePrincipalReadOnly"
      effect  = "Allow"
      actions = ["s3:GetObject"]

      principals {
        type        = "Service"
        identifiers = ["cloudfront.amazonaws.com"]
      }

      resources = ["${aws_s3_bucket.derivatives.arn}/*"]

      condition {
        test     = "StringEquals"
        variable = "AWS:SourceArn"
        values   = [aws_cloudfront_distribution.media[0].arn]
      }
    }
  }

  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    resources = [
      aws_s3_bucket.derivatives.arn,
      "${aws_s3_bucket.derivatives.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "derivatives" {
  bucket = aws_s3_bucket.derivatives.id
  policy = data.aws_iam_policy_document.derivatives.json
}

# ---------------------------------------------------------------------------
# The derivative generation queue
#
# Enqueued by POST /v1/admin/media/{mediaId}/complete, not by an S3 event
# notification. The API contract makes completion an explicit call, which means
# a half-finished multipart upload never starts a derivative run, and the CMS
# has a status to show ("processing") rather than a broken image.
# ---------------------------------------------------------------------------

resource "aws_sqs_queue" "derivatives_dlq" {
  name                       = "${var.name_prefix}-media-derivatives-dlq"
  message_retention_seconds  = 1209600
  kms_master_key_id          = var.kms_key_arn
  visibility_timeout_seconds = var.derivative_visibility_timeout_seconds
  tags                       = var.tags
}

resource "aws_sqs_queue" "derivatives" {
  name                       = "${var.name_prefix}-media-derivatives"
  visibility_timeout_seconds = var.derivative_visibility_timeout_seconds
  message_retention_seconds  = 345600
  kms_master_key_id          = var.kms_key_arn
  tags                       = var.tags

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.derivatives_dlq.arn
    maxReceiveCount     = 3
  })
}
