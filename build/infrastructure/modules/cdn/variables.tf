variable "name_prefix" {
  description = "Prefix for every resource name in this module, for example trevean-prod."
  type        = string
}

variable "environment" {
  description = "dev, staging or prod."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "tags" {
  description = "Tags applied to every taggable resource."
  type        = map(string)
  default     = {}
}

# ---------------------------------------------------------------------------
# Aliases and certificate
# ---------------------------------------------------------------------------

variable "aliases" {
  description = <<-EOT
    Alternate domain names on the distribution, for example
    ["treveanspice.com", "www.treveanspice.com"].

    Leave empty on dev and staging. Staging runs on the distribution's own
    *.cloudfront.net name so that nothing on our side waits for Trevean's
    domain or Trevean's AWS account.

    Do not set this until the ACM certificate is ISSUED. CloudFront rejects an
    alias whose certificate is not issued, and a rejected apply on the day of
    the flip is the failure the cutover plan is written to avoid. See the
    document titled "M1 Deliverable 3: Redirect-Serving Decision and Apex
    Domain Routing", section 6, failure mode 5.
  EOT
  type        = list(string)
  default     = []
}

variable "acm_certificate_arn" {
  description = <<-EOT
    ARN of an ISSUED ACM certificate in us-east-1. Required when aliases is
    non-empty, ignored otherwise. CloudFront reads certificates from us-east-1
    only. A certificate in any other region cannot be attached.
  EOT
  type        = string
  default     = null
}

# ---------------------------------------------------------------------------
# Origins. Two, and only two, on the apex distribution.
# ---------------------------------------------------------------------------

variable "create_site_bucket" {
  description = <<-EOT
    Create the S3 bucket that backs the AWS origin, fronted by origin access
    control. Set false only if the audit finds an existing application origin
    that should be used instead, in which case set aws_origin_domain_name and
    aws_origin_type.

    TO CONFIRM IN AUDIT (open question Q13, Q14): what the existing scaffold
    deploys to, and whether it is an S3 site, a Lambda function URL, or an
    application load balancer.
  EOT
  type        = bool
  default     = true
}

variable "aws_origin_domain_name" {
  description = <<-EOT
    Domain name of the AWS origin when create_site_bucket is false. This is the
    origin that answers /blend.html, /_next/*, /assets/* and /images/*.
  EOT
  type        = string
  default     = null
}

variable "aws_origin_type" {
  description = "s3 or custom. Only read when create_site_bucket is false."
  type        = string
  default     = "custom"

  validation {
    condition     = contains(["s3", "custom"], var.aws_origin_type)
    error_message = "aws_origin_type must be s3 or custom."
  }
}

variable "vercel_origin_domain_name" {
  description = <<-EOT
    Hostname of the existing Vercel marketing site, reached as the DEFAULT
    origin. Everything that is not /t/*, /blend.html or an application asset is
    proxied here.

    Known gotcha, carried from the redirect-serving decision, section 4: Vercel
    routes by Host header. Either treveanspice.com is attached as a domain on
    the Vercel project so CloudFront can forward the original Host, or
    CloudFront sends the project's own hostname and the marketing site's
    absolute URLs are checked for breakage. The first is correct.

    TO CONFIRM IN AUDIT: the current Vercel project's domain configuration, and
    who deploys it.

    Set to null on dev and staging when no marketing origin is available. The
    default behaviour then falls back to the AWS origin, which is the only
    intentional divergence from the frozen two-origin shape and it exists on
    non-production environments only.
  EOT
  type        = string
  default     = null
}

variable "forward_host_header_to_vercel" {
  description = <<-EOT
    true forwards the viewer Host header to the Vercel origin, which requires
    treveanspice.com to be attached as a domain on the Vercel project.
    false sends the Vercel project hostname instead.
  EOT
  type        = bool
  default     = true
}

# ---------------------------------------------------------------------------
# The /t/* CloudFront Function
# ---------------------------------------------------------------------------

variable "edge_function_source_path" {
  description = <<-EOT
    Path to the built CloudFront Function source that answers /t/*.

    THIS MODULE DOES NOT OWN THAT SOURCE. It is built and tested under
    build/edge/ and is compiled from the version-controlled redirect table
    described in the document titled "Data model", section 7. This module reads
    the built artifact and wires it to the viewer-request event on the /t/*
    behaviour. Nothing here should ever be edited to change a redirect target.

    A relative path is resolved against the working directory Terraform runs
    in, which is the environment directory under envs/, not this module. Run
    terraform from the environment directory, which is what README.md does.
  EOT
  type        = string
}

variable "allow_placeholder_edge_function" {
  description = <<-EOT
    When true, a missing edge function artifact is replaced by an inert
    placeholder that returns 503 on /t/* so the rest of the distribution can be
    stood up. Intended for dev only.

    MUST be false on staging and prod. On staging it must be false because
    staging is where the 2.0 second budget is measured before Trevean's domain
    exists, and measuring against a placeholder measures nothing.
  EOT
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------
# Cache behaviour tuning
# ---------------------------------------------------------------------------

variable "blend_html_browser_max_age" {
  description = "Browser max-age in seconds for /blend.html. Short by design."
  type        = number
  default     = 60
}

variable "blend_html_edge_max_ttl" {
  description = "Edge max TTL in seconds for /blend.html. Long by design, with invalidation on publish."
  type        = number
  default     = 31536000
}

variable "price_class" {
  description = "CloudFront price class. PriceClass_100 is North America and Europe."
  type        = string
  default     = "PriceClass_100"
}

variable "enable_access_logs" {
  description = "Create a log bucket and enable CloudFront standard access logging."
  type        = bool
  default     = true
}

variable "log_retention_days" {
  description = "Days before CloudFront access logs expire from the log bucket."
  type        = number
  default     = 90
}

variable "enable_realtime_metrics" {
  description = <<-EOT
    Enable CloudFront additional metrics. This is what publishes CacheHitRate
    to CloudWatch. Without it the cache hit ratio alarm required by the
    Architecture document, section "Measurement", cannot be created at all.

    Costs a few US dollars per distribution per month. It is not optional.
  EOT
  type        = bool
  default     = true
}

variable "api_origin_domain_names" {
  description = <<-EOT
    Hosts of the Lambda function URLs that serve the /v1 surface, keyed by
    function. Two keys are read: content_api and scan_ingest. Anything else is
    ignored.

    Empty, the default, means no /v1 behaviour is added to the distribution at
    all, which is the state this package shipped in and which left
    POST /v1/scan-events with nowhere to arrive.

    Both keys are required together. Serving the beacon from the content API
    would mean granting the content API a write on ScanEvents, which collapses
    the two smallest permission sets in the system into one. See the comment on
    the invoke path in modules/compute/main.tf.
  EOT
  type        = map(string)
  default     = {}

  validation {
    condition     = length(var.api_origin_domain_names) == 0 || alltrue([for key in ["content_api", "scan_ingest"] : contains(keys(var.api_origin_domain_names), key)])
    error_message = "api_origin_domain_names must contain both content_api and scan_ingest, or be empty. A /v1/* behaviour with no /v1/scan-events behaviour in front of it would send the beacon to the read only function, where it is an IAM denial on every tap and a scan count of zero."
  }
}

variable "api_content_browser_max_age" {
  description = <<-EOT
    Default TTL for cached /v1 content reads, in seconds, used when the origin
    sends no Cache-Control. The API sends `public, max-age=60,
    stale-while-revalidate=300` per the frozen API contract, section 7, and
    CloudFront honours that inside the min and max bounds, so this value is a
    floor for a misbehaving response rather than the operative number.
  EOT
  type        = number
  default     = 60
}

variable "api_content_edge_max_ttl" {
  description = "Ceiling on how long the edge may hold a /v1 content read. Deliberately short: content endpoints are on the editorial path, and publish to live has a 5 minute contractual requirement."
  type        = number
  default     = 300
}

variable "blend_rewrite_source_path" {
  description = <<-EOT
    Path to the built /blend.html rewrite CloudFront Function, produced by
    build/edge/scripts/build-blend-rewrite.mjs from the canonical redirect
    table. Null disables the rewrite, in which case every blend lands on the
    "jar not recognised" page, which is wrong but branded rather than broken.
  EOT
  type        = string
  default     = null
}

variable "admin_ui_origin_domain_name" {
  description = "Hostname of the admin's HTTP API. An API Gateway rather than a function URL, because a function URL cannot serve an HTML form: see modules/compute/main.tf."
  type        = string
  default     = null
}
