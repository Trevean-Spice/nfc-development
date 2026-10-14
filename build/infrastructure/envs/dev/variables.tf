variable "aws_region" {
  description = "Region for regional resources."
  type        = string
  default     = "us-east-1"
}

variable "expected_account_id" {
  description = <<-EOT
    The AWS account id dev is allowed to deploy into.

    DELIBERATELY NO DEFAULT, so the guard fails closed. Terraform refuses to
    plan or apply without a value. With no guard here, terraform apply in this
    directory builds the entire dev stack wherever the ambient credentials
    happen to point, and nothing objects.

    The value is <TREVEAN_DEV_ACCOUNT_ID>, Trevean-NFC-Development. That is where the
    development environment was applied on Thursday 27 August 2026 and where
    its state bucket lives.

    CORRECTED THURSDAY 27 AUGUST 2026. This description previously said
    <TREVEAN_DEV_ACCOUNT_ID> is Trevean's Organization MANAGEMENT account and told you not
    to set it here. That was backwards. The management account is <TREVEAN_MANAGEMENT_ACCOUNT_ID>,
    Trevean Spice. Do not set THAT to make a command work.

    A default of null would leave the guard disarmed for anyone who did not
    read this description, which is the failure being prevented.

    terraform validate still passes with this unset: validate does not require
    root variable values. plan and apply do.
  EOT
  type        = string
}

variable "name_prefix" {
  description = "Prefix for every resource name. Ends up in globally unique S3 bucket names. FILL IN a distinguishing suffix."
  type        = string
  default     = "trevean-dev"
}

variable "edge_function_source_path" {
  description = "Path to the built /t/* CloudFront Function artifact. The source is owned by build/edge/."
  type        = string
  default     = "../../../edge/dist/redirect.js"
}

variable "allow_placeholder_edge_function" {
  description = <<-EOT
    Deploy an inert 503 placeholder on /t/* if the real artifact is missing.

    ONLY DEV MAY DO THIS. It exists so the rest of the environment can be stood
    up before build/edge/ has produced anything. The cdn module refuses it on
    staging and prod regardless of what any tfvars file says.
  EOT
  type        = bool
  default     = true
}

variable "create_slug_index" {
  description = "TO CONFIRM IN AUDIT (Q15)."
  type        = bool
  default     = false
}

variable "recipes_key_shape" {
  description = "TO CONFIRM IN AUDIT (Q15), check 4."
  type        = string
  default     = "blend_slug_first"
}

variable "admin_origins" {
  description = "Origins allowed to PUT to the originals bucket with a presigned URL. Include http://localhost:3000 on dev if the admin runs locally."
  type        = list(string)
  default     = []
}

variable "function_packages" {
  description = "Map of function key to built .zip path. Absent keys get the inert placeholder."
  type        = map(string)
  default     = {}
}

variable "enable_rollup_event_source_mapping" {
  description = "Attach the rollup consumer to the stream. Leave false until real code is deployed."
  type        = bool
  default     = false
}

variable "enable_media_event_source_mapping" {
  description = "Attach the derivative function to the media queue. Leave false until real code is deployed."
  type        = bool
  default     = false
}

variable "tag_password_holder" {
  description = "Named holder of the ST25TV02KC area password. FILL IN WHEN ACCESS LANDS."
  type        = string
  default     = "TO CONFIRM: named holder not yet nominated"
}

variable "alarm_email_addresses" {
  description = "Addresses subscribed to the alarm topic."
  type        = list(string)
  default     = []
}

variable "blend_rewrite_source_path" {
  description = <<-EOT
    Path to the built /blend.html rewrite CloudFront Function, from
    build/edge/scripts/build-blend-rewrite.mjs.

    Without it, every code in the redirect table lands on the same document,
    because the origin is a bucket and a bucket does not vary by query string.
  EOT
  type        = string
  default     = "../../../edge/dist/blend-rewrite.js"
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
    About $100 a month in us-east-1 at the default task size, in Trevean's
    account, continuously. Everything needed to turn it on is written: one line
    here and one image push.

    Dev is where M3's acceptance criterion gets demonstrated, so dev is the
    environment where turning it on is expected first.
  EOT
  type        = bool
  default     = false
}

variable "publisher_image_uri" {
  description = <<-EOT
    The image the publish pipeline runs, once one has been pushed to the
    repository this stack creates. Get the repository URL from
    `terraform output publisher` and push with
    build/publisher/scripts/push-image.sh.

    Null keeps the service at zero tasks and keeps the API queueing and
    logging rather than dispatching into an endpoint with nothing behind it.
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

variable "publisher_render_timeout_ms" {
  description = "How long the pipeline waits for the web build before killing it. A diagnostic ceiling, not a target: the contractual requirement is 300,000 ms for the whole publish. Raised above the 420,000 default only to learn what the render actually costs, because the first Fargate run was killed at the ceiling and so reported no figure at all. See 'Decision log', D42."
  type        = number
  default     = 420000
}

variable "publisher_task_memory" {
  description = "Fargate memory in MiB. 4096 is the smallest legal pairing with 2048 CPU units, and the render was observed holding 222 MiB."
  type        = number
  default     = 4096
}

variable "admin_api_base_url" {
  description = "Where the deployed admin reaches the API. The apex distribution's own domain. Injected here because taking it from the CDN module closes a dependency cycle: compute produces the function URLs the CDN fronts."
  type        = string
  default     = ""
}

variable "create_certificate" {
  description = <<-EOT
    Request the apex ACM certificate from Terraform rather than by hand.

    Separate from manage_dns on purpose. See "Decision log", D49: the previous
    coupling meant dev never created one, a certificate was requested manually
    instead, it expired unvalidated, and terraform plan reported "No changes"
    against it because Terraform had never heard of it.
  EOT

  type    = bool
  default = false
}

variable "apex_domain" {
  description = <<-EOT
    The domain the certificate is requested for. Read even though manage_dns is
    false on dev, because the certificate no longer depends on Route 53. The www
    hostname is added as a subject alternative name automatically.
  EOT

  type    = string
  default = "treveanspice.com"
}

variable "shopify_store_domain" {
  description = "Shopify storefront for cart permalinks. See \"Decision log\", D64."
  type        = string
  default     = ""
}
