# ===========================================================================
# CDN: the apex distribution
#
# Implements the recommendation frozen in the document titled "M1 Deliverable
# 3: Redirect-Serving Decision and Apex Domain Routing", section 1 and
# section 4:
#
#   CloudFront owns the apex. Three cache behaviours and two origins.
#   /t/*        answered by a CloudFront Function at viewer request, no origin
#   /q/*        the same function, the on-pack QR route. See "M1 Deliverable
#               14: QR attribution", section 2. Same behaviour class as /t/*,
#               same function, same cache policy: one class, two patterns.
#   /blend.html AWS origin
#   assets      AWS origin
#   *           Vercel custom origin, the marketing site, as the default
#
# One note on counting, so nobody thinks this diverges. The frozen decision
# names three behaviour classes beyond the default. CloudFront accepts exactly
# one path pattern per ordered behaviour, so the asset class expands to three
# ordered entries (/_next/*, /assets/*, /images/*) that share one origin, one
# cache policy and one origin request policy. It is one behaviour class
# expressed three times, not a fourth class.
#
# Added Thursday 15 October 2026: with a Vercel origin the same class gains the
# rest of the published render tree (/blends/*, /media/*, /js/*, /vendor/*,
# /icons/* and four single files). See site_root_path_patterns below.
# ===========================================================================

locals {
  # The redirect function artifact is owned by build/edge/. See the variable
  # description. try() keeps `terraform validate` usable before that artifact
  # has been built; the precondition below is what actually enforces its
  # presence on staging and prod.
  edge_function_placeholder = <<-EOT
    function handler(event) {
      // Inert placeholder. Not the redirect function. The real function is
      // built under build/edge/ and compiled from the version-controlled
      // redirect table. Deploying this to staging or prod is blocked by a
      // Terraform precondition.
      return { statusCode: 503, statusDescription: 'Edge redirect function not deployed' };
    }
  EOT

  edge_function_present = fileexists(var.edge_function_source_path)
  edge_function_code    = local.edge_function_present ? file(var.edge_function_source_path) : local.edge_function_placeholder

  aws_origin_id    = "aws-application"
  vercel_origin_id = "vercel-marketing"

  # When no Vercel origin is supplied (dev and staging), the default behaviour
  # falls back to the AWS origin so the environment is self-contained.
  has_vercel_origin  = var.vercel_origin_domain_name != null
  default_origin_id  = local.has_vercel_origin ? local.vercel_origin_id : local.aws_origin_id
  site_bucket_in_use = var.create_site_bucket

  aws_origin_domain = local.site_bucket_in_use ? aws_s3_bucket.site[0].bucket_regional_domain_name : var.aws_origin_domain_name
  aws_origin_is_s3  = local.site_bucket_in_use ? true : var.aws_origin_type == "s3"

  asset_path_patterns = ["/_next/*", "/assets/*", "/images/*"]

  # The rest of what the publisher puts in the site bucket, all of it at the
  # bucket root. Without a Vercel origin the default behaviour is the bucket and
  # these reach it through the default. With one, the default is the marketing
  # site, and every one of these would be proxied to Vercel and 404 there:
  #
  #   /js/enhance.js, /vendor/*  the field beacon, so every tap goes unrecorded,
  #                              which is the failure the cutover exists to fix
  #   /media/*                   the hero image on every blend page
  #   /sw.js, /offline.html      the service worker and its branded offline page
  #   /manifest.webmanifest,
  #   /icons/*                   the web app manifest and its icons
  #   /blends/*, /404.html       the publisher's read back, which fetches each
  #                              published HTML object at /{key} (offline.html
  #                              too)
  #
  # Only with a Vercel origin, so every environment without one plans unchanged.
  # Same origin and policies as the asset class, which is what the default gave
  # these paths before. None of them exists on the marketing site except
  # /404.html, which is also ours (Trevean-Spice/website PR 2), and Vercel's own
  # not-found handling does not go through that path.
  site_root_path_patterns = local.has_vercel_origin ? [
    "/blends/*",
    "/media/*",
    "/js/*",
    "/vendor/*",
    "/icons/*",
    "/sw.js",
    "/offline.html",
    "/manifest.webmanifest",
    "/404.html",
  ] : []

  # The /v1 surface. Two Lambda function URL origins, one behaviour each.
  has_api_origin        = length(var.api_origin_domain_names) > 0
  api_content_origin_id = "api-content"
  api_scan_origin_id    = "api-scan"
  admin_ui_origin_id    = "admin-ui"

  # Both redirect routes, one behaviour class. /t/* is the tap and is what the
  # 1,000 shipped tags carry. /q/* is the on-pack QR. Same function, same cache
  # policy, same no-origin guarantee.
  redirect_path_patterns = ["/t/*", "/q/*"]
}

# ---------------------------------------------------------------------------
# The AWS origin bucket
#
# Note on where hero images live, because it is a performance constraint and
# not a filing preference. The document titled "Per-page byte and speed
# budget", section 3, decision A, requires the 307 target and everything it
# pulls to be same origin: a second hostname costs a fresh DNS lookup plus a
# fresh TCP and TLS handshake, an estimated 300 to 600 ms on cellular. The
# derivative pipeline therefore publishes tap-path image derivatives into this
# bucket under images/, served by the /images/* behaviour on this same
# distribution. The separate media distribution (see the media module) exists
# for the admin CMS and for surfaces that are not on the tap path.
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "site" {
  count  = var.create_site_bucket ? 1 : 0
  bucket = "${var.name_prefix}-site"
  tags   = var.tags
}

resource "aws_s3_bucket_public_access_block" "site" {
  count                   = var.create_site_bucket ? 1 : 0
  bucket                  = aws_s3_bucket.site[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "site" {
  count  = var.create_site_bucket ? 1 : 0
  bucket = aws_s3_bucket.site[0].id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "site" {
  count  = var.create_site_bucket ? 1 : 0
  bucket = aws_s3_bucket.site[0].id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  count  = var.create_site_bucket ? 1 : 0
  bucket = aws_s3_bucket.site[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_cloudfront_origin_access_control" "site" {
  count                             = local.aws_origin_is_s3 ? 1 : 0
  name                              = "${var.name_prefix}-site-oac"
  description                       = "Origin access control for the AWS application origin."
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_iam_policy_document" "site_bucket" {
  count = var.create_site_bucket ? 1 : 0

  statement {
    sid     = "AllowCloudFrontServicePrincipalReadOnly"
    effect  = "Allow"
    actions = ["s3:GetObject"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    resources = ["${aws_s3_bucket.site[0].arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.apex.arn]
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
      aws_s3_bucket.site[0].arn,
      "${aws_s3_bucket.site[0].arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  count  = var.create_site_bucket ? 1 : 0
  bucket = aws_s3_bucket.site[0].id
  policy = data.aws_iam_policy_document.site_bucket[0].json
}

# ---------------------------------------------------------------------------
# Access logs
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "logs" {
  count         = var.enable_access_logs ? 1 : 0
  bucket        = "${var.name_prefix}-cdn-logs"
  force_destroy = false
  tags          = var.tags
}

resource "aws_s3_bucket_public_access_block" "logs" {
  count                   = var.enable_access_logs ? 1 : 0
  bucket                  = aws_s3_bucket.logs[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# CloudFront standard logging writes with an ACL grant, so object ownership
# cannot be BucketOwnerEnforced on this bucket specifically.
resource "aws_s3_bucket_ownership_controls" "logs" {
  count  = var.enable_access_logs ? 1 : 0
  bucket = aws_s3_bucket.logs[0].id

  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "logs" {
  count  = var.enable_access_logs ? 1 : 0
  bucket = aws_s3_bucket.logs[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  count      = var.enable_access_logs ? 1 : 0
  bucket     = aws_s3_bucket.logs[0].id
  depends_on = [aws_s3_bucket_ownership_controls.logs]

  rule {
    id     = "expire-cdn-logs"
    status = "Enabled"

    filter {}

    expiration {
      days = var.log_retention_days
    }
  }
}

# ---------------------------------------------------------------------------
# The /t/* redirect function
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# /blend.html rewrite
#
# The redirect sends a tap to /blend.html?blend={slug}. The origin is a bucket,
# and a bucket does not vary its answer by query string, so without this every
# code in the table lands on the same document: the "jar not recognised" page.
# That is a fast, correct looking 200 that is wrong for every blend, which is
# precisely the failure the adjacent jar test exists to catch.
#
# Compiled from the same redirect table as the /t/ and /q/ function, by
# build/edge/scripts/build-blend-rewrite.mjs. It matches the slug against an
# allowlist rather than interpolating it into a path, so a crafted slug cannot
# reach an arbitrary object.
# ---------------------------------------------------------------------------

resource "aws_cloudfront_function" "blend_rewrite" {
  count = var.blend_rewrite_source_path == null ? 0 : 1

  name    = "${var.name_prefix}-blend-rewrite"
  runtime = "cloudfront-js-2.0"
  comment = "Rewrites /blend.html?blend={slug} onto the pre-rendered document for that blend."
  publish = true
  code    = file(var.blend_rewrite_source_path)
}

resource "aws_cloudfront_function" "t_redirect" {
  name    = "${var.name_prefix}-t-redirect"
  runtime = "cloudfront-js-2.0"
  comment = "Answers /t/{code} with a 307 at viewer request. Source owned by build/edge/."
  publish = true
  code    = local.edge_function_code

  lifecycle {
    precondition {
      condition     = local.edge_function_present || var.allow_placeholder_edge_function
      error_message = <<-EOT
        The edge redirect function artifact was not found and this environment
        does not allow the placeholder.

        Expected at: ${var.edge_function_source_path}

        Build it from build/edge/ before applying. That artifact is compiled
        from the version-controlled redirect table described in the document
        titled "Data model", section 7. It is never hand edited and never
        edited here.
      EOT
    }
  }
}

# ---------------------------------------------------------------------------
# Cache policies
#
# The cache key requirement, and the reason it is a named failure rather than
# a tuning preference: the document titled "M1 Deliverable 3: Redirect-Serving
# Decision and Apex Domain Routing", section 5, "The cache key", and the
# Architecture document, section "Hypotheses to confirm in the audit", item 3.
#
#   In the key:      the path, and the `blend` query parameter. Nothing else.
#   Not in the key,
#   and not
#   forwarded:       `via`, and every utm_* parameter.
#
# utm_* is in practice the larger fragmentation source, because campaign links
# generate unbounded parameter values and every distinct value would be a
# separate cache entry paying origin latency on first request. The page is
# pre-rendered and needs neither. The client-side scan beacon reads `via` from
# window.location after paint, so the browser still has it and nothing is lost.
#
# The whitelist form below is what makes this true by construction: an
# allow-list of exactly one parameter cannot be widened by a new campaign
# parameter appearing in the wild.
# ---------------------------------------------------------------------------

resource "aws_cloudfront_cache_policy" "blend_html" {
  name        = "${var.name_prefix}-blend-html"
  comment     = "Cache key is path plus the blend query parameter only. via and utm_* are excluded by design."
  default_ttl = var.blend_html_browser_max_age
  min_ttl     = 0
  max_ttl     = var.blend_html_edge_max_ttl

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true

    query_strings_config {
      query_string_behavior = "whitelist"

      query_strings {
        items = ["blend"]
      }
    }

    headers_config {
      header_behavior = "none"
    }

    cookies_config {
      cookie_behavior = "none"
    }
  }
}

resource "aws_cloudfront_cache_policy" "assets" {
  name        = "${var.name_prefix}-assets"
  comment     = "Immutable, content-hashed application assets and image derivatives."
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

# ---------------------------------------------------------------------------
# Origin request policies
# ---------------------------------------------------------------------------

resource "aws_cloudfront_origin_request_policy" "blend_html" {
  name    = "${var.name_prefix}-blend-html-origin"
  comment = "Forwards the blend parameter only. via and utm_* never reach the origin."

  query_strings_config {
    query_string_behavior = "whitelist"

    query_strings {
      items = ["blend"]
    }
  }

  headers_config {
    header_behavior = "none"
  }

  cookies_config {
    cookie_behavior = "none"
  }
}

resource "aws_cloudfront_origin_request_policy" "assets" {
  name    = "${var.name_prefix}-assets-origin"
  comment = "Nothing forwarded. Assets are addressed entirely by path."

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

resource "aws_cloudfront_origin_request_policy" "vercel_default" {
  name    = "${var.name_prefix}-vercel-default-origin"
  comment = "Everything forwarded to the marketing origin. Not on the tap path."

  query_strings_config {
    query_string_behavior = "all"
  }

  # allViewer forwards the original Host, which requires treveanspice.com to be
  # attached as a domain on the Vercel project. allExcept Host makes CloudFront
  # send the Vercel project's own hostname instead, which works without that
  # attachment but leaves the marketing site's absolute URLs to be checked.
  headers_config {
    header_behavior = var.forward_host_header_to_vercel ? "allViewer" : "allExcept"

    dynamic "headers" {
      for_each = var.forward_host_header_to_vercel ? [] : [1]

      content {
        items = ["Host"]
      }
    }
  }

  cookies_config {
    cookie_behavior = "all"
  }
}

resource "aws_cloudfront_cache_policy" "vercel_default" {
  name        = "${var.name_prefix}-vercel-default"
  comment     = "Marketing site is cached by the marketing platform, not by us. Pass through."
  default_ttl = 0
  min_ttl     = 0
  max_ttl     = 0

  # With all three TTLs at zero this policy has caching DISABLED, and CloudFront
  # then rejects any header, cookie or query string behaviour other than "none".
  # Observed on the first real apply, Thursday 27 August 2026, one error at a
  # time: HeaderBehavior, then CookieBehavior.
  #
  # Nothing is lost by setting all three to none. A cache key only means
  # something when something is cached, and here nothing is: the marketing
  # platform owns that caching, which is the entire point of this policy.
  # What actually reaches Vercel is decided by the ORIGIN REQUEST policy
  # above, which forwards the host header, every cookie and every query
  # string, and is unchanged.
  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = false
    enable_accept_encoding_gzip   = false

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

# ===========================================================================
# The /v1 surface
#
# Added Thursday 27 August 2026, with the function URLs in modules/compute.
#
# WHY IT IS ON THIS DISTRIBUTION AND NOT ON AN api. SUBDOMAIN. Two reasons,
# and the first one is the beacon.
#
#   The scan beacon is navigator.sendBeacon, which cannot set a header and
#   cannot carry a credential. Posting application/json to a DIFFERENT origin
#   is not a simple request, so it would earn a CORS preflight: an OPTIONS
#   round trip before the POST, on the tap path, for a measurement that exists
#   because nothing that measures the tap may delay the tap. Serving /v1 from
#   the same distribution as /blend.html makes the request same origin, and a
#   same origin request has no preflight and needs no CORS configuration at
#   all. The problem is removed rather than configured around.
#
#   Second, and it is the same argument the 307 target is bound by: the
#   document titled "Per-page byte and speed budget", section 3, decision A,
#   requires the tap path to stay on one hostname, because a second host costs
#   a fresh DNS lookup plus a fresh TCP and TLS handshake, an estimated 300 to
#   600 ms on cellular. The beacon fires after paint so it is not inside the
#   2.0 second budget, but the optional catalog refresh on the same page is
#   reached the same way and there is no reason to buy a second connection for
#   either.
#
# TWO BEHAVIOURS, NOT ONE, AND THE ORDER IS LOAD BEARING. CloudFront evaluates
# ordered behaviours top down and takes the first match, so /v1/scan-events is
# declared BEFORE /v1/*. If they were the other way round every beacon would
# land on the content function, which by design has no write permission on
# ScanEvents, and the result would be a denial on every tap and a scan count of
# zero with nothing saying so.
# ===========================================================================

resource "aws_cloudfront_origin_access_control" "api" {
  count = local.has_api_origin ? 1 : 0

  name                              = "${var.name_prefix}-api-oac"
  description                       = "Signs origin requests to the Lambda function URLs that serve /v1. The URLs are AWS_IAM, so an unsigned request to them is refused."
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ---------------------------------------------------------------------------
# Cache and origin request policies for /v1
#
# The content reads are cacheable and the beacon must not be cached. That is
# not a tuning preference, it is the frozen API contract, section 7: public
# content reads carry `public, max-age=60, stale-while-revalidate=300` and
# POST /v1/scan-events carries `no-store`. The application sets those headers;
# these policies are what lets CloudFront honour them rather than override
# them.
# ---------------------------------------------------------------------------

resource "aws_cloudfront_cache_policy" "api_content" {
  count = local.has_api_origin ? 1 : 0

  name        = "${var.name_prefix}-api-content"
  comment     = "Cacheable /v1 content reads. Query strings are IN the key here, unlike /blend.html, because they select the resource."
  default_ttl = var.api_content_browser_max_age
  min_ttl     = 0
  max_ttl     = var.api_content_edge_max_ttl

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true

    # The opposite of the /blend.html policy, and deliberately so. There, a
    # query parameter is attribution and putting it in the key fragments the
    # cache. Here a query parameter selects the resource: ?include=grower,
    # recipes returns a different document from the bare path, and ?status,
    # ?limit and ?cursor each return a different page of a different list.
    # Dropping them from the key would serve one caller another caller's
    # answer, which is a correctness failure rather than a cost one.
    query_strings_config {
      query_string_behavior = "all"
    }

    # No headers in the key. Every /v1 content read is unauthenticated and
    # returns the same bytes to every caller, so nothing varies by header. In
    # particular Authorization is absent, which is what keeps an admin
    # credential from ever becoming part of a cache key.
    headers_config {
      header_behavior = "none"
    }

    cookies_config {
      cookie_behavior = "none"
    }
  }
}

resource "aws_cloudfront_origin_request_policy" "api_content" {
  count = local.has_api_origin ? 1 : 0

  name = "${var.name_prefix}-api-content-origin"

  # Query strings only. Host is deliberately NOT forwarded: the origin access
  # control signs for the function URL host, and a forwarded viewer Host would
  # break that signature.
  #
  # The reasoning lives here rather than in the comment field because
  # CloudFront caps Comment at 128 characters and rejects the create with
  # "The parameter Comment is too big", which names the field and not the
  # limit. Observed on the first apply of the API invoke path, Friday
  # 4 September 2026.
  comment = "Query strings only. Host is not forwarded, see the code comment."

  query_strings_config {
    query_string_behavior = "all"
  }

  headers_config {
    header_behavior = "none"
  }

  cookies_config {
    cookie_behavior = "none"
  }
}

resource "aws_cloudfront_origin_request_policy" "api_scan" {
  count = local.has_api_origin ? 1 : 0

  name = "${var.name_prefix}-api-scan-origin"
  # What the scan beacon's POST is allowed to carry to the origin. An allowlist, because this is the one unauthenticated write in the system.
  #
  # Short comment field: CloudFront caps it at 128 characters.
  comment = "What the scan beacon POST may carry to the origin. See the code comment."

  query_strings_config {
    query_string_behavior = "none"
  }

  headers_config {
    header_behavior = "whitelist"

    headers {
      items = [
        # CloudFront derived geography, country, region and city only. The
        # browser is never asked for a location and no address header is
        # forwarded: there is no x-forwarded-for and no
        # cloudfront-viewer-address in this list, and there is not going to be.
        # See the Architecture document, "Scan tracking".
        #
        # These are only believed by the API on a request that also proves it
        # came through the CDN. That gate is GEO_TRUSTED_HEADER_NAME and
        # GEO_TRUSTED_HEADER_VALUE on the function, it is NOT set in this
        # environment yet, and until it is the API drops geography rather than
        # trusting it. Forwarding the headers first is the harmless half.
        "cloudfront-viewer-country",
        "cloudfront-viewer-country-region",
        "cloudfront-viewer-city",

        # Recorded on the row as originAllowed, never used as a gate. A browser
        # beacon cannot hold a secret, so Origin is a signal and not a
        # credential, and rejecting on it would throw away every legitimate
        # scan from a browser that does not send one.
        "origin",

        # sendBeacon picks the content type from the Blob it is handed and the
        # page hands it application/json. The API parses all three shapes a
        # browser might send, so this is for the log rather than for the parse.
        "content-type",
      ]
    }
  }

  cookies_config {
    cookie_behavior = "none"
  }
}

# ---------------------------------------------------------------------------
# Response headers
# ---------------------------------------------------------------------------

resource "aws_cloudfront_response_headers_policy" "app" {
  name    = "${var.name_prefix}-app-response-headers"
  comment = "Security headers for application responses. No cache-control override: the application owns that."

  security_headers_config {
    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "SAMEORIGIN"
      override     = true
    }

    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }

    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      preload                    = false
      override                   = true
    }
  }

  # Named so a cache hit or miss is visible to the field beacon, which records
  # cacheStatus on every tap (Data model document, section 3.5).
  custom_headers_config {
    items {
      header   = "x-trevean-env"
      value    = var.environment
      override = true
    }
  }
}

# ---------------------------------------------------------------------------
# The distribution
# ---------------------------------------------------------------------------

resource "aws_cloudfront_distribution" "apex" {
  enabled         = true
  is_ipv6_enabled = true
  http_version    = "http2and3"
  price_class     = var.price_class
  comment         = "${var.name_prefix} apex. /t/* at the edge, /blend.html and assets from AWS, everything else from the marketing origin."
  aliases         = var.aliases
  tags            = var.tags

  # Origin 1: AWS. Serves /blend.html and the application assets.
  origin {
    origin_id                = local.aws_origin_id
    domain_name              = local.aws_origin_domain
    origin_access_control_id = local.aws_origin_is_s3 ? aws_cloudfront_origin_access_control.site[0].id : null

    dynamic "custom_origin_config" {
      for_each = local.aws_origin_is_s3 ? [] : [1]

      content {
        http_port                = 80
        https_port               = 443
        origin_protocol_policy   = "https-only"
        origin_ssl_protocols     = ["TLSv1.2"]
        origin_keepalive_timeout = 60
        origin_read_timeout      = 30
      }
    }
  }

  # Origins 2 and 3: the two Lambda function URLs that serve /v1.
  #
  # origin_access_control_id plus custom_origin_config is the correct pair for
  # a function URL: it is an HTTPS custom origin as far as CloudFront's
  # transport is concerned, and the access control is what makes the request
  # SigV4 signed so an AWS_IAM function URL will answer it.
  dynamic "origin" {
    for_each = local.has_api_origin ? {
      (local.api_content_origin_id) = var.api_origin_domain_names["content_api"]
      (local.api_scan_origin_id)    = var.api_origin_domain_names["scan_ingest"]
      (local.admin_ui_origin_id)    = var.admin_ui_origin_domain_name
    } : {}

    content {
      origin_id   = origin.key
      domain_name = origin.value

      // No access control on the admin origin: see the function URL resource in
      // modules/compute for why an OAC cannot front an HTML form.
      origin_access_control_id = origin.key == local.admin_ui_origin_id ? null : aws_cloudfront_origin_access_control.api[0].id

      custom_origin_config {
        http_port              = 80
        https_port             = 443
        origin_protocol_policy = "https-only"
        origin_ssl_protocols   = ["TLSv1.2"]

        # A cold Node function behind a 5 second beacon timeout and a 10 second
        # content timeout. Left at the CloudFront default of 30 seconds the
        # edge would hold a connection open long after the function had already
        # given up.
        origin_keepalive_timeout = 60
        origin_read_timeout      = 30
      }
    }
  }

  # Origin 2: the existing Vercel marketing site.
  dynamic "origin" {
    for_each = local.has_vercel_origin ? [1] : []

    content {
      origin_id   = local.vercel_origin_id
      domain_name = var.vercel_origin_domain_name

      custom_origin_config {
        http_port                = 80
        https_port               = 443
        origin_protocol_policy   = "https-only"
        origin_ssl_protocols     = ["TLSv1.2"]
        origin_keepalive_timeout = 60
        origin_read_timeout      = 30
      }
    }
  }

  # -------------------------------------------------------------------------
  # Behaviour 1: /t/* and /q/*
  #
  # A CloudFront Function at viewer request runs BEFORE the cache lookup and
  # before any origin call, and its generated response is not cached by
  # CloudFront, so the function executes on every request. That is the intended
  # behaviour and it is why sub-millisecond execution matters.
  #
  # target_origin_id is required by CloudFront on every behaviour. It is never
  # reached on either of these: the function returns a response in every code
  # path. The QR route is a separate path pattern rather than a query parameter
  # on /t/* precisely so the function never has to read a query string, which
  # keeps attribution out of the cache key and untrusted input out of Location.
  # -------------------------------------------------------------------------
  dynamic "ordered_cache_behavior" {
    for_each = local.redirect_path_patterns

    content {
      path_pattern           = ordered_cache_behavior.value
      target_origin_id       = local.aws_origin_id
      viewer_protocol_policy = "redirect-to-https"
      allowed_methods        = ["GET", "HEAD"]
      cached_methods         = ["GET", "HEAD"]
      compress               = false

      # Managed-CachingDisabled. The response is generated at the edge and the
      # 307 is served Cache-Control: no-store by the function itself. A cached
      # redirect is an uneditable redirect.
      cache_policy_id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"

      function_association {
        event_type   = "viewer-request"
        function_arn = aws_cloudfront_function.t_redirect.arn
      }
    }
  }

  # Behaviour 2: /blend.html, only when there is no Vercel origin.
  #
  # With one, /blend.html falls through to the default and Dan's Vercel page
  # serves it, all query strings (blend, via) forwarded by vercel_default.
  # Live regression 11-04: this behaviour sent taps to our S3 page, which never
  # got Dan's copy. D67 scan counting resumes via a beacon on his page.
  dynamic "ordered_cache_behavior" {
    for_each = local.has_vercel_origin ? [] : [1]

    content {
      path_pattern               = "/blend.html"
      target_origin_id           = local.aws_origin_id
      viewer_protocol_policy     = "redirect-to-https"
      allowed_methods            = ["GET", "HEAD"]
      cached_methods             = ["GET", "HEAD"]
      compress                   = true
      cache_policy_id            = aws_cloudfront_cache_policy.blend_html.id
      origin_request_policy_id   = aws_cloudfront_origin_request_policy.blend_html.id
      response_headers_policy_id = aws_cloudfront_response_headers_policy.app.id

      dynamic "function_association" {
        for_each = aws_cloudfront_function.blend_rewrite

        content {
          event_type   = "viewer-request"
          function_arn = function_association.value.arn
        }
      }
    }
  }

  # Behaviour 3: application assets. One class, three path patterns.
  dynamic "ordered_cache_behavior" {
    for_each = local.asset_path_patterns

    content {
      path_pattern               = ordered_cache_behavior.value
      target_origin_id           = local.aws_origin_id
      viewer_protocol_policy     = "redirect-to-https"
      allowed_methods            = ["GET", "HEAD"]
      cached_methods             = ["GET", "HEAD"]
      compress                   = true
      cache_policy_id            = aws_cloudfront_cache_policy.assets.id
      origin_request_policy_id   = aws_cloudfront_origin_request_policy.assets.id
      response_headers_policy_id = aws_cloudfront_response_headers_policy.app.id
    }
  }

  # -------------------------------------------------------------------------
  # Behaviour 4: POST /v1/scan-events. The beacon.
  #
  # DECLARED BEFORE /v1/* AND IT HAS TO STAY THERE. CloudFront takes the first
  # ordered behaviour whose pattern matches. Below /v1/* this block would never
  # be reached, every beacon would go to the read only content function, and
  # the symptom would be a silent zero rather than an error anybody sees.
  #
  # NOT CACHED, EVER. Managed-CachingDisabled, the same policy the /t/* and
  # /q/* redirects use. CloudFront does not cache POST responses in any case,
  # so this is belt and braces, but the belt is worth having: a cached 202
  # would mean a tap that was never recorded.
  # -------------------------------------------------------------------------
  dynamic "ordered_cache_behavior" {
    for_each = local.has_api_origin ? [1] : []

    content {
      path_pattern           = "/v1/scan-events"
      target_origin_id       = local.api_scan_origin_id
      viewer_protocol_policy = "https-only"

      # CloudFront offers exactly three method sets and POST only exists in the
      # widest one, so PUT, PATCH and DELETE arrive here as a consequence of
      # allowing POST rather than as a decision. They are not a hole: the
      # function behind this behaviour serves one route, POST /v1/scan-events,
      # and Fastify answers everything else with the contract's 404 envelope.
      # Its IAM role can PutItem an EVT# item into ScanEvents and can do
      # nothing else at all, so there is no operation for a DELETE to reach.
      allowed_methods = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
      cached_methods  = ["GET", "HEAD"]

      # The response is an empty 202. There is nothing to compress and
      # compression on a zero byte body is a small waste of edge CPU on the one
      # request every tap makes.
      compress = false

      # Managed-CachingDisabled.
      cache_policy_id            = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
      origin_request_policy_id   = aws_cloudfront_origin_request_policy.api_scan[0].id
      response_headers_policy_id = aws_cloudfront_response_headers_policy.app.id
    }
  }

  # -------------------------------------------------------------------------
  # Behaviour 5: the rest of /v1. Cacheable content reads.
  #
  # READ ONLY METHODS, DELIBERATELY. The frozen API contract puts every write
  # except the beacon behind a bearer token on /v1/admin/*, and the admin API
  # is a different function with a different role. Restricting this behaviour
  # to GET, HEAD and OPTIONS means the admin write surface is not exposed by
  # this change even by accident: a POST to /v1/admin/blends through this
  # distribution is a 403 from CloudFront and never reaches a function.
  #
  # An admin GET does reach the content function, and it fails closed there:
  # that function holds no JWKS URI, is deployed with STAGE=staging so the
  # development symmetric token path is refused in src/auth/jwt.ts, and its
  # role cannot write. The admin API still needs its own front door, and
  # deciding what that looks like is a separate piece of work rather than
  # something to arrive at by leaving a method list wide.
  # -------------------------------------------------------------------------
  dynamic "ordered_cache_behavior" {
    for_each = local.has_api_origin ? [1] : []

    content {
      path_pattern           = "/v1/*"
      target_origin_id       = local.api_content_origin_id
      viewer_protocol_policy = "https-only"
      allowed_methods        = ["GET", "HEAD", "OPTIONS"]
      cached_methods         = ["GET", "HEAD"]
      compress               = true

      cache_policy_id            = aws_cloudfront_cache_policy.api_content[0].id
      origin_request_policy_id   = aws_cloudfront_origin_request_policy.api_content[0].id
      response_headers_policy_id = aws_cloudfront_response_headers_policy.app.id
    }
  }

  # The admin CMS. Caching disabled: every page is per session and a cached
  # admin page is somebody else's draft.
  dynamic "ordered_cache_behavior" {
    for_each = local.has_api_origin ? [1] : []

    content {
      path_pattern           = "/admin*"
      target_origin_id       = local.admin_ui_origin_id
      viewer_protocol_policy = "https-only"
      allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
      cached_methods         = ["GET", "HEAD"]
      compress               = false

      cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
      origin_request_policy_id = aws_cloudfront_origin_request_policy.admin_ui[0].id

      function_association {
        event_type   = "viewer-request"
        function_arn = aws_cloudfront_function.admin_prefix[0].arn
      }
    }
  }

  # Behaviour 6: the rest of the render tree, only when the default is Vercel.
  # Last in the list so the plan that adds them appends and moves nothing. No
  # pattern here overlaps any pattern above, so the position does not change
  # which behaviour a request matches.
  dynamic "ordered_cache_behavior" {
    for_each = local.site_root_path_patterns

    content {
      path_pattern               = ordered_cache_behavior.value
      target_origin_id           = local.aws_origin_id
      viewer_protocol_policy     = "redirect-to-https"
      allowed_methods            = ["GET", "HEAD"]
      cached_methods             = ["GET", "HEAD"]
      compress                   = true
      cache_policy_id            = aws_cloudfront_cache_policy.assets.id
      origin_request_policy_id   = aws_cloudfront_origin_request_policy.assets.id
      response_headers_policy_id = aws_cloudfront_response_headers_policy.app.id
    }
  }

  # Default: the marketing site.
  default_cache_behavior {
    target_origin_id         = local.default_origin_id
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = local.has_vercel_origin ? aws_cloudfront_cache_policy.vercel_default.id : aws_cloudfront_cache_policy.assets.id
    origin_request_policy_id = local.has_vercel_origin ? aws_cloudfront_origin_request_policy.vercel_default.id : aws_cloudfront_origin_request_policy.assets.id
  }

  # No distribution-wide custom_error_response block, deliberately.
  #
  # SOW section 6.3 requires a graceful branded response and never a blank
  # screen, and the redirect-serving decision, section 5, "Normalisation and
  # the unknown code", places that requirement on /t/*: an unknown code is
  # rewritten to the branded not-found page and returned with a 404 status. The
  # edge function does that, on the one behaviour where it is required.
  #
  # A custom_error_response here would be distribution wide, which means it
  # would also intercept the marketing site's own 404s coming back from the
  # Vercel origin and replace them with an application page. That is a visible
  # brand failure introduced to solve a problem the edge function already
  # solves on the only path that has the requirement.

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = length(var.aliases) == 0
    acm_certificate_arn            = length(var.aliases) == 0 ? null : var.acm_certificate_arn
    ssl_support_method             = length(var.aliases) == 0 ? null : "sni-only"
    minimum_protocol_version       = length(var.aliases) == 0 ? "TLSv1" : "TLSv1.2_2021"
  }

  dynamic "logging_config" {
    for_each = var.enable_access_logs ? [1] : []

    content {
      bucket          = aws_s3_bucket.logs[0].bucket_domain_name
      prefix          = "cloudfront/apex/"
      include_cookies = false
    }
  }

  lifecycle {
    precondition {
      condition     = length(var.aliases) == 0 || var.acm_certificate_arn != null
      error_message = "aliases were requested but acm_certificate_arn is null. CloudFront reads certificates from us-east-1 only, and the certificate must be ISSUED before the aliases are attached."
    }

    precondition {
      condition     = var.create_site_bucket || var.aws_origin_domain_name != null
      error_message = "create_site_bucket is false, so aws_origin_domain_name must be set to the existing application origin."
    }

    precondition {
      condition     = var.environment == "dev" || !var.allow_placeholder_edge_function
      error_message = "allow_placeholder_edge_function must be false on staging and prod. Staging is where the 2.0 second budget is measured before the domain exists, and measuring against a placeholder measures nothing."
    }
  }

  depends_on = [aws_s3_bucket_ownership_controls.logs]
}

resource "aws_cloudfront_monitoring_subscription" "apex" {
  count           = var.enable_realtime_metrics ? 1 : 0
  distribution_id = aws_cloudfront_distribution.apex.id

  monitoring_subscription {
    realtime_metrics_subscription_config {
      realtime_metrics_subscription_status = "Enabled"
    }
  }
}

# ---------------------------------------------------------------------------
# The admin CMS, on this distribution rather than one of its own.
#
# A second distribution would be a second thing to configure, certificate and
# reason about for an application used by a handful of people. It sits behind
# the same origin access control as the /v1 functions.
#
# COOKIES ARE FORWARDED AND THE AUTHORIZATION HEADER IS NOT. The admin carries
# its session in a signed cookie, so cookies must reach the origin or nobody
# stays signed in. The viewer's Authorization header is deliberately left
# behind: the origin access control puts its own SigV4 Authorization on the
# request, and forwarding the viewer's would collide with it.
#
# HOST IS NOT FORWARDED, for the same reason as the /v1 behaviours: the access
# control signs for the function URL's host and a forwarded viewer Host breaks
# the signature.
# ---------------------------------------------------------------------------

resource "aws_cloudfront_origin_request_policy" "admin_ui" {
  count = local.has_api_origin ? 1 : 0

  name    = "${var.name_prefix}-admin-ui-origin"
  comment = "Cookies and query strings for the admin. No Host, no Authorization."

  query_strings_config {
    query_string_behavior = "all"
  }

  cookies_config {
    cookie_behavior = "all"
  }

  headers_config {
    header_behavior = "whitelist"

    headers {
      items = [
        "content-type",
        "accept",
        "origin",
        "referer",
      ]
    }
  }
}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

# The admin is mounted at /admin on this distribution but the application knows
# nothing about that prefix: it serves /sign-in, not /admin/sign-in. Rather than
# teach a Fastify app where it happens to be mounted, which would make it depend
# on a CloudFront path pattern, the prefix is removed at the edge.
#
# /admin and /admin/ both become /, so the mount point behaves like a root.
resource "aws_cloudfront_function" "admin_prefix" {
  count = local.has_api_origin ? 1 : 0

  name    = "${var.name_prefix}-admin-prefix"
  runtime = "cloudfront-js-2.0"
  comment = "Strips the /admin mount prefix before the origin sees it."
  publish = true

  code = <<-EOT
    function handler(event) {
      var request = event.request;
      var uri = request.uri;
      if (uri === '/admin' || uri === '/admin/') {
        request.uri = '/';
        return request;
      }
      if (uri.indexOf('/admin/') === 0) {
        request.uri = uri.substring('/admin'.length);
      }
      return request;
    }
  EOT
}
