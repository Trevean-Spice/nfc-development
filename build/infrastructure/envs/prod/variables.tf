# ===========================================================================
# PRODUCTION variables
#
# Every FILL IN below is something we do not have on Monday 17 August 2026.
# Nothing here has been applied and nothing here states anything about the
# existing scaffold or the existing AWS account as a finding.
# ===========================================================================

variable "aws_region" {
  description = "Region for regional resources. us-east-1."
  type        = string
  default     = "us-east-1"
}

variable "expected_account_id" {
  description = <<-EOT
    Trevean's AWS account id.

    FILL IN WHEN ACCESS LANDS. This is a guard, not configuration: with it set,
    Terraform refuses to apply if the caller's credentials belong to any other
    account. The failure it prevents is a production apply landing in a
    contractor's account, or worse, a staging apply landing in Trevean's.

    Leaving it null disables the guard, which is acceptable only before there
    is an account to guard.
  EOT
  type        = string
  default     = null
}

variable "name_prefix" {
  description = "Prefix for every resource name. Ends up in globally unique S3 bucket names."
  type        = string
  default     = "trevean-prod"
}

# ---------------------------------------------------------------------------
# DNS and the cutover
# ---------------------------------------------------------------------------

variable "manage_dns" {
  description = <<-EOT
    Create the Route 53 hosted zone, the ALIAS records and the certificate.

    true from run 1 on Tuesday 18 August. This does NOT change any nameserver:
    creating a zone that nothing is delegated to is inert, and creating it
    early is what makes the Thursday record-by-record diff possible.
  EOT
  type        = bool
  default     = false
}

variable "apex_domain" {
  description = <<-EOT
    treveanspice.com. The hostname 1,000 tags carry, encoded on 24 July 2026
    and shipped. It is a fact, not a configuration choice.
  EOT
  type        = string
  default     = "treveanspice.com"
}

variable "copied_zone_records" {
  description = <<-EOT
    EVERY RECORD FROM THE CURRENT AUTHORITATIVE ZONE, COPIED VERBATIM.

    FILL IN WHEN SQUARESPACE DNS ACCESS LANDS, from the export procedure in
    scripts/export-zone.md. Do not hand type it.

    This is the most consequential value in this file. A nameserver set that
    answers for the apex but has lost the MX records does not break a website,
    it silently stops the company's email, and nobody finds out from a
    dashboard. MX, SPF, DKIM, DMARC and every verification TXT record for
    services nobody remembered were connected: all of it, values unchanged.

    Do NOT include the apex or www A/AAAA records. Those are created as
    CloudFront ALIAS records.

    TO CONFIRM IN AUDIT: what treveanspice.com currently resolves to, if
    anything, and the full contents of the current zone.
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

    LEAVE FALSE UNTIL THE CERTIFICATE STATUS OUTPUT READS ISSUED. CloudFront
    rejects an alias whose certificate is not issued, and a rejected apply on
    the day of the flip is failure mode 5 in the redirect-serving decision,
    section 6.
  EOT
  type        = bool
  default     = false
}

variable "wait_for_certificate_validation" {
  description = <<-EOT
    Block the apply until ACM reports ISSUED.

    false on run 1, so the apply returns quickly and the validation records can
    be read out and pasted into Squarespace. true on run 2, so the certificate
    is a hard gate rather than a check somebody remembers to make.
  EOT
  type        = bool
  default     = false
}

variable "manage_validation_records_in_route53" {
  description = <<-EOT
    Move certificate validation into Route 53.

    false before the flip: Route 53 cannot validate a zone it is not yet
    answering for, and the initial validation happens at Squarespace.

    true AFTER the flip, so renewals validate automatically and the certificate
    does not silently fail to renew in December.
  EOT
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------
# CDN
# ---------------------------------------------------------------------------

variable "edge_function_source_path" {
  description = <<-EOT
    Path to the built /t/* CloudFront Function artifact.

    THE SOURCE IS NOT OWNED BY THIS TERRAFORM. It is built under build/edge/
    and compiled from the version-controlled redirect table. Production refuses
    to deploy a placeholder.
  EOT
  type        = string
  default     = "../../../edge/dist/redirect.js"
}

variable "vercel_origin_domain_name" {
  description = <<-EOT
    Hostname of the existing Vercel marketing site, reached as the DEFAULT
    origin.

    FILL IN WHEN VERCEL ACCESS LANDS.

    TO CONFIRM IN AUDIT: the current Vercel project's domain configuration, and
    who deploys it. Putting CloudFront in front changes nothing about how they
    publish, but they should hear it before it happens rather than after.
  EOT
  type        = string
  default     = null
}

variable "forward_host_header_to_vercel" {
  description = <<-EOT
    true forwards the viewer Host header, which requires treveanspice.com to be
    attached as a domain on the Vercel project. That is the correct
    arrangement; verify domain ownership by TXT record in the zone.

    A marketing site returning the wrong project after the flip is not on the
    tap path but it is visible to everyone, and it belongs on the Thursday
    checklist rather than being discovered on Friday.
  EOT
  type        = bool
  default     = true
}

variable "price_class" {
  description = "CloudFront price class. PriceClass_100 is North America and Europe."
  type        = string
  default     = "PriceClass_100"
}

# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------

variable "name_tables_with_prefix" {
  description = <<-EOT
    Prefix production table names with the environment prefix.

    TO CONFIRM IN AUDIT (Q13, Q15): if usable tables already exist in the
    account, adopting them unprefixed and importing them into state is cheaper
    than renaming. A DynamoDB rename is not a rename, it is a migration.
  EOT
  type        = bool
  default     = true
}

variable "create_slug_index" {
  description = "TO CONFIRM IN AUDIT (Q15), check 2: true only if SpiceBlends is keyed on a synthetic blendId rather than the slug."
  type        = bool
  default     = false
}

variable "recipes_key_shape" {
  description = "TO CONFIRM IN AUDIT (Q15), check 4, the highest-value single check in the data model's audit list."
  type        = string
  default     = "blend_slug_first"
}

# ---------------------------------------------------------------------------
# Media, compute, secrets, alarms
# ---------------------------------------------------------------------------

variable "admin_origins" {
  description = "Browser origins allowed to PUT to the originals bucket with a presigned URL. FILL IN when the admin has a hostname."
  type        = list(string)
  default     = []
}

variable "function_packages" {
  description = "Map of function key to built .zip path. Absent keys get the inert placeholder, which answers 501. FILL IN WHEN REPO ACCESS LANDS, or let the application pipeline deploy over the top."
  type        = map(string)
  default     = {}
}

variable "enable_rollup_event_source_mapping" {
  description = "Attach the rollup consumer to the ScanEvents stream. Only after the consumer's real code is deployed."
  type        = bool
  default     = false
}

variable "enable_media_event_source_mapping" {
  description = "Attach the derivative function to the media queue. Only after its real code is deployed."
  type        = bool
  default     = false
}

variable "tag_password_holder" {
  description = "Named holder of the ST25TV02KC area password. One person, in the form Name, role, organisation. FILL IN WHEN ACCESS LANDS. Dan's nomination."
  type        = string
  default     = "TO CONFIRM: named holder not yet nominated"
}

variable "extra_secrets" {
  description = "Additional secrets found in the audit, chiefly credentials tied to the previous contractor (risk R18). Map of short name to description. Values never set here."
  type        = map(string)
  default     = {}
}

variable "alarm_email_addresses" {
  description = <<-EOT
    Addresses subscribed to the alarm topic.

    FILL IN WHEN ACCESS LANDS, and confirm every subscription BEFORE the flip.
    An alarm nobody receives is a dashboard, and the flip is the worst possible
    time to discover that.
  EOT
  type        = list(string)
  default     = []
}

variable "cache_hit_rate_threshold" {
  description = <<-EOT
    Percentage below which the cache hit ratio alarms.

    90 on a pre-rendered site where nearly every request should be a hit. Tune
    it once there are three days of real numbers, and record the change rather
    than adjusting it quietly to stop a page.
  EOT
  type        = number
  default     = 90
}

variable "acknowledge_zone_has_no_email" {
  description = <<-EOT
    Set true ONLY if treveanspice.com genuinely carries no email and no service
    verification records. It almost certainly does carry both.

    This exists so that creating a hosted zone with no MX records cannot happen
    by accident. Leave it false and fill in copied_zone_records instead.
  EOT
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------
# The publish path. Added Friday 4 September 2026.
# ---------------------------------------------------------------------------

variable "revalidation_webhook_url" {
  description = "Where the admin API dispatches its signed revalidation, which is the publish pipeline's /revalidate endpoint. Null means publish updates a record and stops."
  type        = string
  default     = null
}

variable "publisher_public_base_url" {
  description = "Base URL the publish pipeline reads a published document back through. Null falls back to the apex once the distribution answers for it, and to the distribution's own hostname before that. Both are hosts a tap reads."
  type        = string
  default     = null
}

variable "create_publisher" {
  description = <<-EOT
    Create the publish pipeline: a small always on container on Fargate, its
    load balancer, its own small distribution and its image repository. The
    argument for that shape and against a Lambda container image, an on demand
    task, a CI job and a queue is at the top of modules/publisher/main.tf.

    FALSE BY DEFAULT AND THE REASON IS THE BILL, not doubt about the design.
    About $100 a month in us-east-1 at the default task size, in Trevean's
    account, continuously and from the day it is applied. That is an operating
    cost the client carries after handover and it is the first one in this
    package, so it is agreed before it appears rather than after.

    M5 accepts on the product being deployed on Trevean's AWS with content
    editable end to end, so production needs this on. The date it goes on is a
    conversation, not a default.
  EOT
  type        = bool
  default     = false
}

variable "publisher_image_uri" {
  description = <<-EOT
    The image the publish pipeline runs, once one has been pushed to the
    repository this stack creates.

    PIN A DIGEST IN PRODUCTION, not a tag. The repository is created with
    immutable tags so a tag cannot be moved under a running task, but a digest
    says what is running without having to trust that.
  EOT
  type        = string
  default     = null
}

variable "publisher_content_api_base_url" {
  description = "The API the render reads, as TREVEAN_CONTENT_API. AN OVERRIDE, NOT THE NORMAL PATH: null uses the apex distribution this stack creates. /v1 content reads are cacheable at the edge, so a render could otherwise be served a response cached before the edit it was dispatched to publish. That is closed at the read rather than avoided, by a per render cache buster and a refusal if any read cannot be shown to have come from the origin. See modules/stack/main.tf, local.publisher_content_api_base_url, and build/publisher/src/content-read.mjs."
  type        = string
  default     = null
}

variable "publisher_task_cpu" {
  description = "Fargate CPU units for the render. 2048 is two vCPUs. THE RENDER TIME ON A FARGATE vCPU HAS NEVER BEEN MEASURED and it is what the five minute criterion turns on. See modules/publisher/variables.tf and build/publisher's README, section 8.5."
  type        = number
  default     = 2048
}

variable "publisher_task_memory" {
  description = "Fargate memory in MiB. 4096 is the smallest legal pairing with 2048 CPU units, and the render was observed holding 222 MiB."
  type        = number
  default     = 4096
}
