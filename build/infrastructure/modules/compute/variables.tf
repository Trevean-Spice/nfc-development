variable "name_prefix" {
  description = "Prefix for resource names."
  type        = string
}

variable "environment" {
  description = "dev, staging or prod."
  type        = string
}

variable "tags" {
  description = "Tags applied to every taggable resource."
  type        = map(string)
  default     = {}
}

variable "table_arns" {
  description = "Map of the five table ARNs, from the data module."
  type = object({
    spice_blends = string
    scan_events  = string
    recipes      = string
    growers      = string
    nfc_tags     = string
  })
}

variable "table_names" {
  description = "Map of the five table names, passed to the functions as environment."
  type = object({
    spice_blends = string
    scan_events  = string
    recipes      = string
    growers      = string
    nfc_tags     = string
  })
}

variable "scan_events_stream_arn" {
  description = "DynamoDB stream ARN on ScanEvents."
  type        = string
}

variable "render_cache" {
  description = "Render cache bucket ARN, index table ARN, and the environment the renderer needs."
  type = object({
    bucket_arn            = string
    index_table_arn       = string
    environment_variables = map(string)
  })
}

variable "media" {
  description = "Media bucket and queue ARNs."
  type = object({
    originals_bucket_arn   = string
    derivatives_bucket_arn = string
    derivatives_queue_arn  = string
    derivatives_queue_url  = string
  })
}

variable "site_bucket_arn" {
  description = "AWS origin bucket ARN. The derivative pipeline publishes tap-path derivatives into its images/ prefix so the hero stays same origin."
  type        = string
  default     = null
}

variable "distribution_arn" {
  description = "Apex CloudFront distribution ARN, for invalidation permission."
  type        = string
  default     = null
}

variable "distribution_id" {
  description = "Apex CloudFront distribution id, passed to the revalidation path as environment."
  type        = string
  default     = null
}

variable "secret_arns" {
  description = "Map of short name to secret ARN, from the secrets module. Functions are granted secrets by ARN, never by wildcard."
  type        = map(string)
  default     = {}
}

variable "kms_key_arn" {
  description = "Customer managed key ARN. Granted to the functions that read encrypted secrets or write encrypted queues."
  type        = string
  default     = null
}

variable "function_packages" {
  description = <<-EOT
    Map of function key to the path of a built deployment package (.zip).

    Any key not present here gets the inert placeholder package. That is
    intentional: this Terraform is written to stand the environment up on the
    day AWS access lands, before the application repository is in our hands.

    FILL IN WHEN ACCESS LANDS, or leave empty and let the application's own
    pipeline deploy code over the top. Every function carries ignore_changes on
    filename and source_code_hash so that a later terraform apply never reverts
    a deployed build.
  EOT
  type        = map(string)
  default     = {}
}

variable "enable_http_invoke_path" {
  description = <<-EOT
    Create the Lambda function URLs that give the /v1 surface an HTTP front
    door, and the CloudFront permission to invoke them.

    Default true. It is a variable rather than an unconditional resource for
    one reason: distribution_arn has to be present for the permission to be
    scoped to a single distribution, and an environment standing up compute
    without a CDN has no such ARN. In that case set this false rather than
    granting the CloudFront service principal an unscoped invoke.

    The reasoning behind choosing a function URL over API Gateway is in
    main.tf, next to the resources, because that is where somebody about to
    change it will be reading.
  EOT
  type        = bool
  default     = true
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for every function."
  type        = number
  default     = 30
}

variable "rollup_batch_size" {
  description = "Up to 500 records per batch, per the Data model document, section 5.4."
  type        = number
  default     = 500
}

variable "rollup_batching_window_seconds" {
  description = "Or a 5 second window, whichever comes first."
  type        = number
  default     = 5
}

variable "enable_rollup_event_source_mapping" {
  description = <<-EOT
    Attach the rollup consumer to the ScanEvents stream.

    Leave false until the consumer's real code is deployed. A placeholder
    attached to a live stream is a function that fails every batch, fills a
    dead letter queue, and produces an alarm storm on day one.
  EOT
  type        = bool
  default     = false
}

variable "enable_media_event_source_mapping" {
  description = "Attach the derivative function to the media queue. Same reasoning as the rollup mapping."
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------
# The publish path
#
# Added Friday 4 September 2026, closing the gap
# blend_html_can_be_published = false has been reporting since the first apply
# on Thursday 27 August 2026: nothing in this package could write an object
# into the site bucket, so pressing publish updated a record and stopped.
# ---------------------------------------------------------------------------

variable "revalidation_webhook_url" {
  description = <<-EOT
    Where POST /v1/admin/blends/{slug}/publish dispatches its signed
    revalidation. The publish pipeline in build/publisher serves it at
    /revalidate.

    Null means the API logs the queued job and dispatches nothing, which is a
    working API with no publish path behind it. That is the state the deployed
    development environment has been in since Thursday 27 August 2026 and it is
    reported honestly by readiness rather than hidden.

    IT IS STILL A VARIABLE, AND WHAT CHANGED ON FRIDAY 4 SEPTEMBER 2026 IS WHAT
    FILLS IT IN. The host decision is taken: the renderer is a container on
    Fargate, in modules/publisher, and the stack now passes that module's
    revalidate_url here by default. Null is no longer "nobody has decided"; it
    is either "the publish pipeline was not created in this environment" or
    "no image has been pushed to it yet", and both of those are reported
    separately by the readiness output.

    It stays a variable rather than becoming a direct module reference so that
    an environment can point the API at a pipeline it does not own, which is
    what a local end to end run against a deployed API needs.
  EOT
  type        = string
  default     = null
}

variable "create_renderer_lambda" {
  description = <<-EOT
    Whether to create aws_lambda_function.web_renderer.

    DEFAULT TRUE ONLY SO THAT THIS MODULE'S BEHAVIOUR IS UNCHANGED FOR ANYBODY
    WHO HAS NOT SET IT. The stack sets it to false whenever the publish
    pipeline is created, because that pipeline is where the render actually
    runs and a second thing called web-renderer that renders nothing is a
    resource whose name is a lie.

    The role is not gated by this and does not move. The container assumes it.
    See the long note beside the resource.
  EOT
  type        = bool
  default     = true
}

variable "publisher_public_base_url" {
  description = <<-EOT
    The base URL the pipeline reads a published document back through, to
    confirm the change is live. Normally the distribution's own hostname in a
    development environment and the apex in production.

    Null means the pipeline publishes and invalidates and then reports
    "published, not confirmed" rather than claiming the page is live. That is
    the correct direction to fail: an editor told the change is live when it is
    not will find out from a customer.
  EOT
  type        = string
  default     = null
}

variable "distribution_domain_name" {
  description = <<-EOT
    The distribution's own hostname, used as the default base URL the publish
    pipeline reads a published document back through.

    It is referenced ONLY by aws_lambda_function.web_renderer, never by
    local.functions. Any CDN derived value in that map is the Terraform cycle
    described beside local.renderer_key in main.tf: the map is a single resource
    node, so a dependency belonging to one function becomes a dependency of all
    eight, including the two whose function URLs the distribution needs.
  EOT
  type        = string
  default     = null
}

variable "admin_api_base_url" {
  description = <<-EOT
    Where the admin reaches the API, as a full https URL.

    Supplied from outside rather than read from the CDN module, and that is not a style
    choice. compute produces the function URLs the CDN puts behind its origin access control,
    so taking the distribution's domain name back out of the CDN closes a dependency cycle
    that Terraform refuses to plan. It is the apex distribution's domain in practice.
  EOT
  type        = string
  default     = ""
}

variable "shopify_store_domain" {
  description = <<-EOT
    The Shopify storefront that cart permalinks are built against.

    Empty is a valid and safe value: the reorder button renders disabled and
    labelled rather than pointing a customer at a checkout that refuses. That is
    the placeholder render contract, and it is how this shipped from 17 September
    to 7 October 2026 while the client's store was paused and his blends were
    drafts.

    Set to the permanent myshopify host rather than the storefront domain. The
    primary domain was shop.treveanliving.com on 7 October 2026 and the client
    intends to move it; the myshopify host cannot be re pointed and Shopify
    redirects it to whatever the primary domain is, carrying the cart. See
    "Decision log", D64.
  EOT

  type    = string
  default = ""
}
