# ===========================================================================
# STAGING variables
#
# Anything marked FILL IN WHEN ACCESS LANDS needs a value we do not have on
# Monday 17 August 2026. Everything else has a working default, which is the
# point: staging is deployable into an account we control with almost nothing
# filled in.
# ===========================================================================

variable "aws_region" {
  description = "Region for regional resources. us-east-1, for the reasons in providers.tf."
  type        = string
  default     = "us-east-1"
}

variable "expected_account_id" {
  description = <<-EOT
    The AWS account id staging is allowed to deploy into.

    DELIBERATELY NO DEFAULT, so the guard fails closed. Terraform refuses to
    plan or apply without a value, which is the point: the credentials most
    likely to be in the shell are Trevean's, and the id everyone has to hand,
    <TREVEAN_DEV_ACCOUNT_ID>, is Trevean-NFC-Development, which is envs/dev's account and
    not staging's. With no guard here, terraform apply in this directory builds
    the entire staging stack in it and nothing objects.

    CORRECTED THURSDAY 27 AUGUST 2026. This description previously called
    <TREVEAN_DEV_ACCOUNT_ID> the Organization MANAGEMENT account. It is not. The management
    account is <TREVEAN_MANAGEMENT_ACCOUNT_ID>, Trevean Spice. Staging belongs in neither: it runs
    in an account we control.

    A default of null would leave the guard disarmed for anyone who did not
    read this description, which is the failure being prevented.

    terraform validate still passes with this unset: validate does not require
    root variable values. plan and apply do.
  EOT
  type        = string
}

variable "name_prefix" {
  description = <<-EOT
    Prefix for every resource name. It ends up in S3 bucket names, which are
    globally unique across all AWS accounts, so it needs a component that is
    not just "trevean-staging".

    FILL IN WHEN ACCESS LANDS: append a short account-specific suffix.
  EOT
  type        = string
  default     = "trevean-staging"
}

variable "edge_function_source_path" {
  description = <<-EOT
    Path to the built /t/* CloudFront Function artifact, relative to this
    directory.

    THE SOURCE IS NOT OWNED BY THIS TERRAFORM. It is built and tested under
    build/edge/ and compiled from the version-controlled redirect table
    described in the document titled "Data model", section 7. Build it there
    first. Staging refuses to deploy a placeholder.
  EOT
  type        = string
  default     = "../../../edge/dist/redirect.js"
}

variable "vercel_origin_domain_name" {
  description = <<-EOT
    Optional marketing origin for staging.

    null is the normal setting and the default. Set it only if there is a
    staging marketing site to proxy, and never point staging at the live
    Vercel production project.
  EOT
  type        = string
  default     = null
}

variable "create_slug_index" {
  description = "TO CONFIRM IN AUDIT (Q15): true only if SpiceBlends is keyed on a synthetic blendId rather than the slug."
  type        = bool
  default     = false
}

variable "recipes_key_shape" {
  description = "TO CONFIRM IN AUDIT (Q15), check 4: blend_slug_first or recipe_id_first."
  type        = string
  default     = "blend_slug_first"
}

variable "admin_origins" {
  description = <<-EOT
    Browser origins allowed to PUT to the originals bucket with a presigned
    URL. The admin CMS only.

    FILL IN WHEN THE ADMIN HAS A HOSTNAME. Until then media upload from a
    browser will fail CORS, which is the correct failure: an empty list is
    tighter than a guess.
  EOT
  type        = list(string)
  default     = []
}

variable "function_packages" {
  description = <<-EOT
    Map of function key to a built .zip path. Anything absent gets the inert
    placeholder that answers 501 and logs loudly.

    Valid keys: content_api, scan_ingest, admin_api, rollup_consumer,
    media_derivatives, catalog_sync, shopify_webhook, web_renderer.

    FILL IN WHEN REPO ACCESS LANDS, or leave empty and let the application's
    own pipeline deploy code over the top. Every function ignores changes to
    its package, so an apply never reverts a deployed build.
  EOT
  type        = map(string)
  default     = {}
}

variable "enable_rollup_event_source_mapping" {
  description = "Attach the rollup consumer to the ScanEvents stream. Leave false until the consumer's real code is deployed: a placeholder on a live stream fails every batch and fills the dead letter queue on day one."
  type        = bool
  default     = false
}

variable "enable_media_event_source_mapping" {
  description = "Attach the derivative function to the media queue. Same reasoning."
  type        = bool
  default     = false
}

variable "tag_password_holder" {
  description = <<-EOT
    Named holder of the ST25TV02KC area password. One named person, in the form
    "Name, role, organisation".

    FILL IN WHEN ACCESS LANDS. This is Dan's nomination, not ours. See the
    header comment in modules/secrets/main.tf for the rotation path, which is
    not a normal rotation and depends on open question Q4.
  EOT
  type        = string
  default     = "TO CONFIRM: named holder not yet nominated"
}

variable "extra_secrets" {
  description = <<-EOT
    Additional secrets found during the audit, chiefly credentials tied to the
    previous contractor that have to be identified and replaced (risk R18).

    FILL IN DURING THE AUDIT. Map of short name to description. Values are
    never set here.
  EOT
  type        = map(string)
  default     = {}
}

variable "alarm_email_addresses" {
  description = <<-EOT
    Addresses subscribed to the alarm topic.

    FILL IN WHEN ACCESS LANDS. An alarm nobody receives is a dashboard. Each
    address gets a confirmation email a human has to click, so confirm them
    before they are needed rather than during an incident.
  EOT
  type        = list(string)
  default     = []
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
  description = "Base URL the publish pipeline reads a published document back through. Null falls back to the distribution's own hostname, which is the host a tap reads."
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
    About $100 a month in us-east-1 at the default task size, continuously.
    Staging is in an account we control, so here the bill is ours, which is a
    reason to be deliberate about it rather than a reason not to be.
  EOT
  type        = bool
  default     = false
}

variable "publisher_image_uri" {
  description = "The image the publish pipeline runs, once one has been pushed to the repository this stack creates. Null keeps the service at zero tasks and keeps the API queueing rather than dispatching into an endpoint with nothing behind it."
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
