# ===========================================================================
# The whole environment, in one module.
#
# Each of envs/dev, envs/staging and envs/prod is a thin root module that calls
# this one with different values. That is on purpose: the difference between
# staging and production should be a tfvars file that a reviewer can read in
# one sitting, not three directories that have drifted apart since August.
# ===========================================================================

variable "environment" {
  description = "dev, staging or prod."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "name_prefix" {
  description = "Prefix for every resource name, for example trevean-staging. Must be globally unique enough for S3 bucket names."
  type        = string
}

variable "extra_tags" {
  description = "Tags merged on top of the defaults."
  type        = map(string)
  default     = {}
}

# ---------------------------------------------------------------------------
# Domain and DNS. Everything here is off on dev and staging.
# ---------------------------------------------------------------------------

variable "create_certificate" {
  description = <<-EOT
    Request the ACM certificate, independently of whether Route 53 is managed here.

    THIS EXISTS BECAUSE COUPLING THE TWO COST THIS PROJECT THE DNS CUTOVER.

    The certificate used to be created only when `manage_dns` was true. The zone
    is authoritative at Bluehost rather than Route 53 (Decision log, D16), so
    `manage_dns` is correctly false on dev, and the certificate was therefore
    never created by Terraform at all. Somebody requested one by hand instead.

    That hand made certificate then expired unvalidated on 14 September 2026, and
    because Terraform had never heard of it, `terraform plan` reported "No
    changes" against a dead certificate and would have gone on doing so forever.
    See "Decision log", D49.

    The certificate module's own header says it "depends on nothing. Not the
    hosted zone, not the distribution." That was always true. This variable makes
    the configuration agree with it.

    Defaults to `manage_dns` so no existing environment changes behaviour.
  EOT

  type    = bool
  default = null
}

variable "manage_dns" {
  description = <<-EOT
    Create the Route 53 hosted zone, the ALIAS records and the ACM certificate.

    FALSE ON DEV AND STAGING, and that is the point of this variable rather
    than a convenience.

    There is a standing rule on this engagement that everything on our side
    builds and measures on a staging host so the schedule never waits on the
    client's DNS. Staging therefore runs entirely on the distribution's own
    *.cloudfront.net hostname, in an account we control, with no hosted zone,
    no certificate and no dependency on treveanspice.com existing. The 28
    August gate has to run against the domain the tags actually carry, but
    everything before it does not.
  EOT
  type        = bool
  default     = false
}

variable "apex_domain" {
  description = <<-EOT
    treveanspice.com.

    The comment here used to read "Only read when manage_dns is true", and that
    was the assumption that broke. The CERTIFICATE also reads it, and the
    certificate is now created independently of Route 53 management, so on dev
    this is read while `manage_dns` is false. See "Decision log", D49 and
    `create_certificate`.
  EOT

  type    = string
  default = null

  validation {
    # A null here used to surface as "Invalid template interpolation value" from
    # deep inside the certificate module, which names neither the variable nor the
    # environment that failed to set it. Fail here instead, where the message can
    # say what to do.
    condition     = var.apex_domain == null || can(regex("^[a-z0-9.-]+\\.[a-z]{2,}$", var.apex_domain))
    error_message = "apex_domain must be a bare hostname such as treveanspice.com, with no scheme and no trailing dot."
  }
}

variable "copied_zone_records" {
  description = <<-EOT
    Every record from the current authoritative zone, copied verbatim, BEFORE
    anything is delegated. See the dns module's variable of the same name for
    why this is the single most consequential value in this file.

    FILL IN WHEN ACCESS LANDS, from the export produced by
    scripts/export-zone.md.
  EOT
  type = list(object({
    name    = string
    type    = string
    ttl     = optional(number, 300)
    records = list(string)
  }))
  default = []
}

variable "attach_apex_aliases" {
  description = <<-EOT
    Attach treveanspice.com and www as alternate domain names on the
    distribution.

    Leave false until the ACM certificate reads ISSUED. CloudFront rejects an
    alias whose certificate is not issued, and a rejected apply on the day of
    the flip is the failure the cutover plan exists to avoid.
  EOT
  type        = bool
  default     = false
}

variable "manage_validation_records_in_route53" {
  description = "false for the initial issuance: validation records go into the Squarespace zone while it is still authoritative. Flip to true after delegation so renewals validate automatically."
  type        = bool
  default     = false
}

variable "wait_for_certificate_validation" {
  description = "Block the apply until ACM reports ISSUED. Leave false while validation records are added by hand at Squarespace."
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------
# CDN
# ---------------------------------------------------------------------------

variable "edge_function_source_path" {
  description = <<-EOT
    Path to the built /t/* CloudFront Function artifact.

    THAT SOURCE IS NOT OWNED HERE. It is built and tested under build/edge/ and
    compiled from the version-controlled redirect table. This stack reads the
    built artifact and wires it to the viewer-request event.
  EOT
  type        = string
  default     = "../../../edge/dist/redirect.js"
}

variable "allow_placeholder_edge_function" {
  description = "Dev only. Must be false on staging and prod."
  type        = bool
  default     = false
}

variable "vercel_origin_domain_name" {
  description = "Hostname of the existing Vercel marketing site, the default origin. null on dev and staging."
  type        = string
  default     = null
}

variable "forward_host_header_to_vercel" {
  description = "true requires treveanspice.com attached as a domain on the Vercel project."
  type        = bool
  default     = true
}

variable "price_class" {
  description = "CloudFront price class."
  type        = string
  default     = "PriceClass_100"
}

# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------

variable "name_tables_with_prefix" {
  description = "Prefix table names so three environments can share an account. On prod this depends on what the audit finds already deployed."
  type        = bool
  default     = true
}

variable "create_slug_index" {
  description = "Create GSI2 slug-index on SpiceBlends. Required only if the table is keyed on a synthetic blendId. TO CONFIRM IN AUDIT (Q15)."
  type        = bool
  default     = false
}

variable "recipes_key_shape" {
  description = "blend_slug_first or recipe_id_first. TO CONFIRM IN AUDIT (Q15), check 4."
  type        = string
  default     = "blend_slug_first"
}

variable "enable_deletion_protection" {
  description = "Deletion protection on tables. true on prod."
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------
# Media and admin
# ---------------------------------------------------------------------------

variable "admin_origins" {
  description = "Browser origins allowed to PUT to the originals bucket with a presigned URL. The admin CMS only."
  type        = list(string)
  default     = []
}

variable "create_media_distribution" {
  description = "Create the media distribution for the admin CMS. Not on the tap path."
  type        = bool
  default     = true
}

# ---------------------------------------------------------------------------
# Compute
# ---------------------------------------------------------------------------

variable "function_packages" {
  description = "Map of function key to built .zip path. Anything absent gets the inert placeholder. FILL IN WHEN ACCESS LANDS, or let the application pipeline deploy over the top."
  type        = map(string)
  default     = {}
}

variable "enable_http_invoke_path" {
  description = "Give the /v1 surface an HTTP front door: Lambda function URLs on the content and scan functions, and the CloudFront behaviours that reach them. See modules/compute/main.tf for why a function URL and not API Gateway."
  type        = bool
  default     = true
}

variable "enable_rollup_event_source_mapping" {
  description = "Attach the rollup consumer to the ScanEvents stream. Leave false until the consumer's real code is deployed."
  type        = bool
  default     = false
}

variable "enable_media_event_source_mapping" {
  description = "Attach the derivative function to the media queue. Leave false until its real code is deployed."
  type        = bool
  default     = false
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for every function."
  type        = number
  default     = 30
}

# ---------------------------------------------------------------------------
# Secrets
# ---------------------------------------------------------------------------

variable "tag_password_holder" {
  description = "Named holder of the ST25TV02KC area password. One person. FILL IN WHEN ACCESS LANDS."
  type        = string
  default     = "TO CONFIRM: named holder not yet nominated"
}

variable "extra_secrets" {
  description = "Additional secrets found in the audit, chiefly credentials tied to the previous contractor (risk R18). Map of short name to description."
  type        = map(string)
  default     = {}
}

variable "secret_recovery_window_days" {
  description = "0 on dev so environments can be rebuilt in a day. 30 on prod."
  type        = number
  default     = 30
}

# ---------------------------------------------------------------------------
# Observability
# ---------------------------------------------------------------------------

variable "alarm_email_addresses" {
  description = "Addresses subscribed to the alarm topic. FILL IN WHEN ACCESS LANDS. An alarm nobody receives is a dashboard."
  type        = list(string)
  default     = []
}

variable "cache_hit_rate_threshold" {
  description = "Percentage below which the cache hit ratio alarms. Not optional: it is the earliest warning that something broke the rendering strategy."
  type        = number
  default     = 90
}

variable "treat_low_traffic_as_healthy" {
  description = "notBreaching on the rate alarms. true on dev and staging."
  type        = bool
  default     = true
}

variable "acknowledge_zone_has_no_email" {
  description = "Set true only if the domain genuinely carries no email. See the DNS module precondition."
  type        = bool
  default     = false
}

variable "blend_rewrite_source_path" {
  description = "Path to the built /blend.html rewrite CloudFront Function. Null disables the rewrite."
  type        = string
  default     = null
}

# ---------------------------------------------------------------------------
# The publish path. Added Friday 4 September 2026.
# ---------------------------------------------------------------------------

variable "revalidation_webhook_url" {
  description = <<-EOT
    Where the admin API dispatches its signed revalidation.

    AN OVERRIDE, NOT THE NORMAL PATH. Leave it null and the stack uses the
    publish pipeline it creates. Set it to point the API at a pipeline this
    stack does not own, which is what a local end to end run against a deployed
    API needs.

    Null with create_publisher false means publish updates a record and stops,
    which is what readiness has been reporting since the first apply.
  EOT
  type        = string
  default     = null
}

variable "publisher_public_base_url" {
  description = "Base URL the publish pipeline reads a published document back through. Defaults to the distribution's own hostname, which is the host a tap reads."
  type        = string
  default     = null
}

variable "create_publisher" {
  description = <<-EOT
    Create the publish pipeline: a small always on container on Fargate, its
    load balancer, its own small distribution, and the image repository it runs
    from. The argument for that shape and against the four alternatives is at
    the top of modules/publisher/main.tf.

    DEFAULT FALSE, AND THE REASON IS THE BILL. This is the first thing in this
    package that costs real money continuously in somebody else's account:
    about $100 a month in us-east-1 at the default task size, against about a
    dollar a month if the render had fitted in a Lambda. It does not fit, and
    the difference buys a pipeline that runs exactly as it was written, tested
    and measured. That is a decision with a price on it and it belongs in front
    of the client rather than arriving as a line on an invoice because
    somebody ran an apply.

    Everything needed to turn it on is here. It is one line in a tfvars file
    and one image push.
  EOT
  type        = bool
  default     = false
}

variable "publisher_image_uri" {
  description = <<-EOT
    The container image the publish pipeline runs, once one has been pushed to
    the repository this stack creates.

    Null keeps the service at zero tasks and keeps revalidation_webhook_url
    null, so the API goes on queueing and logging rather than dispatching into
    an endpoint with no healthy target behind it. Readiness reports which of
    the two states it is in.
  EOT
  type        = string
  default     = null
}

variable "publisher_content_api_base_url" {
  description = <<-EOT
    The API the render reads, as TREVEAN_CONTENT_API.

    AN OVERRIDE, NOT THE NORMAL PATH, since Friday 4 September 2026. Leave it
    null and the stack uses the apex distribution it creates, which is the API's
    only front door. Set it to point the render at an API this stack does not
    own, which is what a local end to end run against a deployed environment
    needs.

    It used to have no default because reading through the distribution could
    hand the render the version from before the edit it was dispatched to
    publish: /v1 content reads are cacheable at the edge per the frozen
    contract, section 7. That is now closed at the read rather than avoided.
    Every read carries a per render cache buster, the api_content cache policy
    puts query strings in the cache key, and the publish is refused if any read
    cannot be shown to have come from the origin. See
    local.publisher_content_api_base_url in main.tf, and
    build/publisher/src/content-read.mjs for the argument and the rejected
    alternatives.

    WHATEVER IS SET HERE IS SUBJECT TO THE SAME PROOF. An override that points
    at something which caches on the path alone does not quietly publish stale
    content; it fails, naming the reads that could not be shown to be fresh.
  EOT
  type        = string
  default     = null
}

variable "publisher_task_cpu" {
  description = "Fargate CPU units for the render. 2048 is two vCPUs. MEASURED on Monday 7 September 2026 and the render did not finish inside 420 seconds at this size, against a 300 second criterion. See 'Decision log', D42. Read modules/publisher/variables.tf before changing this."
  type        = number
  default     = 2048
}

variable "publisher_render_timeout_ms" {
  description = "How long the pipeline waits for the web build before killing it. Exposed on Monday 7 September 2026 because the module default of 420,000 killed the first real Fargate render before it could report how long it would actually have taken, which left the number unknown rather than merely bad. Raise it to learn the true figure; it is a diagnostic ceiling and not a target, and the contractual requirement is 300,000 for the whole publish."
  type        = number
  default     = 420000
}

variable "publisher_task_memory" {
  description = "Fargate memory in MiB. 4096 is the smallest legal pairing with 2048 CPU units, and the render was observed holding 222 MiB."
  type        = number
  default     = 4096
}

variable "admin_api_base_url" {
  description = "Where the admin reaches the API. Injected rather than taken from the CDN module, which would close a dependency cycle. See modules/compute/variables.tf."
  type        = string
  default     = ""
}

variable "shopify_store_domain" {
  description = "Shopify storefront for cart permalinks. Empty renders the reorder button disabled and honest. See the compute module's variable of the same name, and \"Decision log\", D64."
  type        = string
  default     = ""
}
