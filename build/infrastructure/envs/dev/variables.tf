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

    Placeholders such as <TREVEAN_DEV_ACCOUNT_ID> stand in for the real ids,
    which are in Trevean's private record, not in this public repository.
    CI runs terraform validate with a dummy value; plan and apply need the
    real one, from the private terraform.tfvars.

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

variable "catalog_sync_dry_run" {
  description = "true makes catalog_sync log intended writes and write nothing. Set false only after a live dry run has been read. See build/shopify/CATALOG-SYNC-DEPLOY.md."
  type        = bool
  default     = true
}

variable "catalog_sync_schedule_expression" {
  description = "EventBridge schedule for catalog_sync, for example \"rate(1 hour)\". Null creates no schedule."
  type        = string
  default     = null
}

variable "attach_apex_aliases" {
  description = <<-EOT
    Attach treveanspice.com and www to the apex distribution with the ISSUED
    certificate. NOT ONE ACTION: with publisher_public_base_url null it also
    moves the publisher's read back host to the apex. Pin
    publisher_public_base_url first. See "Operations runbook", section 9.2, and
    "Decision log", D54.
  EOT
  type        = bool
  default     = false
}

variable "vercel_origin_domain_name" {
  description = <<-EOT
    The marketing site, reached as the DEFAULT origin of the apex distribution.
    null, the default, leaves the default behaviour on our S3 bucket, which is
    the plan as applied.

    The value is trevean-spice-website.vercel.app, the production alias of
    Dan's Vercel project. Measured Thursday 15 October 2026: / answers 200 on
    that host with no redirect to the custom domain.

    MUST BE SET BEFORE DNS MOVES. With null, after Dan's DNS change every path
    that is not ours is answered from the bucket and the marketing site
    disappears. Never the apex or www: after the cutover those resolve to this
    distribution, and CloudFront would request itself. See "Operations
    runbook", section 9.2, step 1b.
  EOT
  type        = string
  default     = null

  validation {
    condition     = var.vercel_origin_domain_name == null || can(regex("^[a-z0-9-]+\\.vercel\\.app$", var.vercel_origin_domain_name))
    error_message = "vercel_origin_domain_name must be null or a *.vercel.app hostname, normally trevean-spice-website.vercel.app. Never treveanspice.com or www: after the cutover they resolve to this distribution and it would request itself."
  }
}

variable "forward_host_header_to_vercel" {
  description = <<-EOT
    true, the default, forwards the viewer Host (treveanspice.com or www) to
    the Vercel origin. Vercel routes by Host, so both names must stay attached
    to the Vercel project after DNS moves, and CloudFront checks the
    certificate Vercel presents against that name, so Vercel must keep a valid
    certificate for a domain whose DNS no longer points at it.

    false sends trevean-spice-website.vercel.app instead, which needs neither.
    It is the fallback if Vercel stops serving or certifying the apex, an in
    place update of the vercel_default origin request policy. Check
    x-robots-tag on the vercel.app host before using it.
  EOT
  type        = bool
  default     = true
}

# ---------------------------------------------------------------------------
# The Route 53 zone. Added Tuesday 20 October 2026 for deploy item 05.
# ---------------------------------------------------------------------------

variable "manage_dns" {
  description = <<-EOT
    Create the Route 53 hosted zone for apex_domain: copied_zone_records, plus
    the apex and www ALIAS records to this distribution. Default false.

    Turned on by deploy item 05 once copied_zone_records holds the verified
    copy of the Bluehost zone. Creating the zone changes no nameserver and
    moves no traffic. Dan's nameserver change at Bluehost does that, by hand,
    after item 05's comparison passes. See "Operations runbook", section 9.2.

    Never turn it off again once the nameservers point at Route 53: the zone
    and every copied record carry prevent_destroy, so the plan errors rather
    than deleting email records out of a live zone.
  EOT
  type        = bool
  default     = false
}

variable "copied_zone_records" {
  description = <<-EOT
    Every record of the Bluehost zone, copied verbatim, except the apex NS and
    SOA (Route 53 writes its own) and the apex and www A, AAAA and CNAME (the
    ALIAS records replace them).

    Generated, never hand typed: deploy-items/scripts/zone-check.mjs inventory
    writes it, and deploy item 05 installs it as zone-copy.auto.tfvars from
    zone-copy.auto.tfvars.example in this directory.
  EOT
  type = list(object({
    name    = string
    type    = string
    ttl     = optional(number, 300)
    records = list(string)
  }))
  default = []

  # Caught here, at plan, rather than as a Route 53 conflict half way through an
  # apply that has already created the zone and some of its records.
  validation {
    condition = alltrue([
      for r in var.copied_zone_records : !(
        (lower(r.name) == var.apex_domain && contains(["A", "AAAA", "NS", "SOA"], upper(r.type))) ||
        (lower(r.name) == "www.${var.apex_domain}" && contains(["A", "AAAA", "CNAME"], upper(r.type)))
      )
    ])
    error_message = "copied_zone_records must not hold the apex A, AAAA, NS or SOA, or www A, AAAA or CNAME: the ALIAS records and Route 53 itself own those. Regenerate it with zone-check.mjs inventory."
  }

  validation {
    condition = alltrue([
      for r in var.copied_zone_records :
      lower(r.name) == var.apex_domain || endswith(lower(r.name), ".${var.apex_domain}")
    ])
    error_message = "Every name in copied_zone_records must be the apex or end in .apex_domain, written in full."
  }

  validation {
    condition     = length(distinct([for r in var.copied_zone_records : "${lower(r.name)}|${upper(r.type)}"])) == length(var.copied_zone_records)
    error_message = "copied_zone_records holds the same name and type twice. One entry per RRset, with every value in its records list."
  }
}
