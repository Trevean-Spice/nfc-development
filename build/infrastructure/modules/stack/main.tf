# ===========================================================================
# The whole environment
#
# Order of dependency, which is also the order to read it in:
#
#   secrets      -> the key and the credential containers
#   certificate  -> ACM in us-east-1. DEPENDS ON NOTHING, on purpose.
#   data         -> the five tables and the ScanEvents stream
#   render_cache -> the externalised render cache, bucket plus shared index
#   cdn          -> the apex distribution, cache policies, the /t/* function
#   media        -> the upload and derivative pipeline
#   compute      -> one role per function, the functions, the stream mapping
#   dns          -> the hosted zone and the ALIAS records
#   observe      -> the alarms
#
# Two orderings here are the cutover plan rather than preference.
#
# The certificate depends on nothing, so it can be requested on Tuesday 18
# August and validated at Squarespace while that zone is still authoritative,
# before the distribution or the hosted zone exist.
#
# dns comes last, and it is the only part of this stack that can strand 1,000
# encoded jars. Everything else is standable and testable without it. That is
# what lets staging exist without Trevean's domain and what lets Wednesday's
# build happen without touching a nameserver.
# ===========================================================================

locals {
  tags = merge({
    Project     = "trevean-spice-nfc"
    Environment = var.environment
    ManagedBy   = "terraform"
    Owner       = "serene-labs"
  }, var.extra_tags)

  # The apex distribution serves the marketing site as its default origin only
  # in production. On dev and staging there is no marketing origin, so the
  # default behaviour falls back to the AWS origin and the environment is
  # entirely self-contained.
  admin_origins = concat(
    var.admin_origins,
    var.manage_dns && var.apex_domain != null ? ["https://${var.apex_domain}"] : [],
  )

  # ---------------------------------------------------------------------------
  # The publish path, resolved in one place.
  #
  # An explicit variable wins, so an environment can point the API at a
  # pipeline this stack does not own. Otherwise it is whatever the publish
  # pipeline module says, which is null until an image has been pushed to it.
  #
  # ONE SPECIFIC OUTPUT, NOT A SPLAT, AND IT IS A GRAPH CONSTRAINT RATHER THAN
  # A STYLE PREFERENCE. `one(module.publisher[*].revalidate_url)` reads the
  # module as a whole, which makes this expression depend on the module's close
  # node and therefore on EVERY resource in it, including the ECS task
  # definition, which reads the apex distribution's id. The apex distribution is
  # downstream of the pooled Lambda functions for its /v1 origins, and those
  # functions are downstream of this expression. That is a cycle, and Terraform
  # prints it as a 30 node list that takes a while to read.
  #
  # try() with an explicit index depends on the one output, and that output
  # depends only on the publish pipeline's own distribution and load balancer,
  # neither of which knows anything about the apex. try() rather than a
  # conditional because HCL does not reliably short circuit an index that is out
  # of range, and with create_publisher false there is no instance zero.
  #
  # This is the same class of problem as the one documented beside
  # local.renderer_key in the compute module, one level up.
  # ---------------------------------------------------------------------------
  revalidation_webhook_url = (
    var.revalidation_webhook_url != null
    ? var.revalidation_webhook_url
    : try(module.publisher[0].revalidate_url, null)
  )

  # Where the pipeline reads a published document back from. The apex domain
  # once the distribution answers for it, and the distribution's own hostname
  # before that, because both are hosts a tap actually reads and a
  # confirmation taken from anywhere else confirms something a customer does
  # not experience.
  publisher_public_base_url = (
    var.publisher_public_base_url != null
    ? var.publisher_public_base_url
    : (
      var.attach_apex_aliases && var.apex_domain != null
      ? "https://${var.apex_domain}"
      : "https://${module.cdn.distribution_domain_name}"
    )
  )

  # ---------------------------------------------------------------------------
  # WHERE THE RENDER READS THE API. Settled Friday 4 September 2026, and it was
  # the last open correctness question on this path.
  #
  # The apex distribution, which is the API's only front door, with the staleness
  # closed at the read rather than avoided by not reading. /v1 content reads are
  # cacheable at the edge by the frozen contract, section 7, so a render that
  # read through the distribution could be handed the version from BEFORE the
  # edit it was dispatched to publish, render it, publish it, read it back, and
  # match, because stale was compared against stale. Every read now carries a
  # per render cache buster, the api_content cache policy in modules/cdn puts
  # query strings in the cache key, and build/publisher refuses the publish if
  # any read cannot be shown to have come from the origin. The argument, and the
  # four rejected alternatives, are in build/publisher/src/content-read.mjs.
  #
  # THE DISTRIBUTION'S OWN HOSTNAME AND NOT THE APEX DOMAIN, which is the one
  # place this deliberately differs from publisher_public_base_url above. That
  # one is a read back and has to happen through the host a customer reads, or
  # it confirms something a customer does not experience. This one is a build
  # time read whose only requirement is that it reaches the /v1 behaviour, and
  # the distribution's own name does that in every environment without waiting
  # for a nameserver change.
  #
  # NO NEW EDGE IN THE GRAPH. The publish pipeline already depends on this
  # module for the site bucket and the distribution id, so reading one more cdn
  # output adds nothing. It is specifically NOT derived from the content
  # function, which is in the same pooled resource node as admin_api, which is
  # downstream of this pipeline's revalidate_url. That is the cycle documented
  # beside local.revalidation_webhook_url above.
  #
  # Null when this distribution serves no /v1 surface, because then there is no
  # API to read and the fixtures are the only honest answer.
  # ---------------------------------------------------------------------------
  publisher_content_api_base_url = (
    var.publisher_content_api_base_url != null
    ? var.publisher_content_api_base_url
    : (
      module.cdn.serves_v1_surface
      ? "https://${module.cdn.distribution_domain_name}"
      : null
    )
  )
}

module "secrets" {
  source = "../secrets"

  name_prefix                 = var.name_prefix
  environment                 = var.environment
  tags                        = local.tags
  tag_password_holder         = var.tag_password_holder
  extra_secrets               = var.extra_secrets
  secret_recovery_window_days = var.secret_recovery_window_days
}

module "certificate" {
  source = "../certificate"
  # Deliberately NOT var.manage_dns. The certificate depends on nothing, which is
  # what its own module header says, and gating it on Route 53 management meant it
  # was never created in the one environment that needed it. See D49.
  count = coalesce(var.create_certificate, var.manage_dns) ? 1 : 0

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  apex_domain = var.apex_domain
  tags        = local.tags
}

module "data" {
  source = "../data"

  name_prefix                = var.name_prefix
  tags                       = local.tags
  name_tables_with_prefix    = var.name_tables_with_prefix
  create_slug_index          = var.create_slug_index
  recipes_key_shape          = var.recipes_key_shape
  enable_deletion_protection = var.enable_deletion_protection
  kms_key_arn                = module.secrets.kms_key_arn
}

module "render_cache" {
  source = "../render_cache"

  name_prefix                = var.name_prefix
  tags                       = local.tags
  kms_key_arn                = module.secrets.kms_key_arn
  enable_deletion_protection = var.enable_deletion_protection
}

module "cdn" {
  blend_rewrite_source_path = var.blend_rewrite_source_path

  source = "../cdn"

  name_prefix = var.name_prefix
  environment = var.environment
  tags        = local.tags

  aliases             = var.attach_apex_aliases ? compact([var.apex_domain, var.apex_domain == null ? null : "www.${var.apex_domain}"]) : []
  acm_certificate_arn = var.attach_apex_aliases ? one(module.certificate[*].certificate_arn) : null

  vercel_origin_domain_name     = var.vercel_origin_domain_name
  forward_host_header_to_vercel = var.forward_host_header_to_vercel

  edge_function_source_path       = var.edge_function_source_path
  allow_placeholder_edge_function = var.allow_placeholder_edge_function

  # The /v1 surface, from the function URLs in the compute module. See the
  # ordering note above this module block.
  api_origin_domain_names     = module.compute.function_url_origins
  admin_ui_origin_domain_name = module.compute.admin_ui_endpoint_domain

  price_class = var.price_class
}

module "media" {
  source = "../media"

  name_prefix               = var.name_prefix
  tags                      = local.tags
  admin_origins             = local.admin_origins
  create_media_distribution = var.create_media_distribution
  site_bucket_arn           = module.cdn.site_bucket_arn
  kms_key_arn               = module.secrets.kms_key_arn
}

module "compute" {
  source = "../compute"

  name_prefix          = var.name_prefix
  admin_api_base_url   = var.admin_api_base_url
  environment          = var.environment
  tags                 = local.tags
  shopify_store_domain = var.shopify_store_domain

  catalog_sync_dry_run             = var.catalog_sync_dry_run
  catalog_sync_schedule_expression = var.catalog_sync_schedule_expression

  table_arns             = module.data.table_arns
  table_names            = module.data.table_names
  scan_events_stream_arn = module.data.scan_events_stream_arn

  render_cache = {
    bucket_arn            = module.render_cache.bucket_arn
    index_table_arn       = module.render_cache.index_table_arn
    environment_variables = module.render_cache.environment_variables
  }

  media = {
    originals_bucket_arn   = module.media.originals_bucket_arn
    derivatives_bucket_arn = module.media.derivatives_bucket_arn
    derivatives_queue_arn  = module.media.derivatives_queue_arn
    derivatives_queue_url  = module.media.derivatives_queue_url
  }

  site_bucket_arn  = module.cdn.site_bucket_arn
  distribution_arn = module.cdn.distribution_arn
  distribution_id  = module.cdn.distribution_id

  secret_arns = module.secrets.secret_arns
  kms_key_arn = module.secrets.kms_key_arn

  # Whatever the publish pipeline module says, unless something else is named.
  # See the locals block at the top of this file.
  #
  # NO CYCLE, AND IT IS WORTH SHOWING THE CHAIN because the obvious alternative
  # has one. This value comes from the publish pipeline's own small
  # distribution, which depends on its load balancer and on nothing else. The
  # APEX distribution would have been a cycle: it is downstream of the pooled
  # Lambda functions for its /v1 origins, and admin_api is in that same pool
  # and therefore the same Terraform resource node. That is the constraint
  # documented beside local.renderer_key in the compute module, and it is one
  # of the two reasons the pipeline has a distribution of its own.
  revalidation_webhook_url = local.revalidation_webhook_url

  # Read the published document back through the distribution's own hostname
  # unless something else is named. That is the same host a tap reads, which is
  # the point: a confirmation taken from anywhere else confirms something a
  # customer does not experience.
  #
  # The two are passed separately rather than coalesced here, because the
  # coalesce has to happen inside the one function resource that is allowed to
  # depend on the CDN. Doing it here puts a CDN value into every function's
  # environment map and reintroduces the cycle.
  publisher_public_base_url = var.publisher_public_base_url
  distribution_domain_name  = module.cdn.distribution_domain_name

  # The render does not run in a Lambda and cannot: see modules/publisher.
  # Where the pipeline exists, the placeholder function that used to stand in
  # for it goes, and the role it used stays and is assumed by the container.
  create_renderer_lambda = !var.create_publisher

  function_packages                  = var.function_packages
  log_retention_days                 = var.log_retention_days
  enable_http_invoke_path            = var.enable_http_invoke_path
  enable_rollup_event_source_mapping = var.enable_rollup_event_source_mapping
  enable_media_event_source_mapping  = var.enable_media_event_source_mapping
}

# ---------------------------------------------------------------------------
# The publish pipeline
#
# Where the render runs, which was the last open question on the path between
# an editor pressing publish and a customer reading the change. The argument
# for a small always on container and against a Lambda container image, an on
# demand Fargate task, a CI job and a queue is at the top of
# modules/publisher/main.tf, next to the resources, because that is where
# somebody about to change it will be reading.
#
# It comes after compute in this file because it assumes compute's renderer
# role, and after cdn because it publishes into cdn's bucket and invalidates
# cdn's distribution. It is upstream of neither: its own distribution depends
# on its own load balancer and nothing else, which is what keeps the graph
# acyclic and the apex distribution untouched.
# ---------------------------------------------------------------------------

module "publisher" {
  source = "../publisher"
  count  = var.create_publisher ? 1 : 0

  name_prefix = var.name_prefix
  environment = var.environment
  tags        = local.tags

  image_uri         = var.publisher_image_uri
  task_role_arn     = module.compute.renderer_role_arn
  task_cpu          = var.publisher_task_cpu
  task_memory       = var.publisher_task_memory
  render_timeout_ms = var.publisher_render_timeout_ms

  # The same translation the functions get, and for the same reason: the
  # application reads STAGE as an exact string, 'dev' is not one of the three
  # values it recognises, and unset falls back to 'local', which is the value
  # the placeholder deployment guard treats as non production.
  api_stage = var.environment == "prod" ? "production" : "staging"

  site_bucket     = module.cdn.site_bucket_name
  distribution_id = module.cdn.distribution_id
  public_base_url = local.publisher_public_base_url

  # The API the render reads, so that the edit an editor just saved is what gets
  # rendered rather than the fixtures in build/content. The distribution, with
  # the staleness closed at the read. See local.publisher_content_api_base_url
  # above for why that is safe and for what happens the day it stops being.
  content_api_base_url = local.publisher_content_api_base_url

  revalidation_secret_name = "trevean/${var.environment}/revalidation-secret"

  log_retention_days = var.log_retention_days
  kms_key_arn        = module.secrets.kms_key_arn
}

# ---------------------------------------------------------------------------
# DNS. Off on dev and staging.
# ---------------------------------------------------------------------------

module "dns" {
  source = "../dns"
  count  = var.manage_dns ? 1 : 0

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  name_prefix = var.name_prefix
  tags        = local.tags
  apex_domain = var.apex_domain

  copied_records                = var.copied_zone_records
  acknowledge_zone_has_no_email = var.acknowledge_zone_has_no_email

  create_apex_alias_records = true
  cloudfront_domain_name    = module.cdn.distribution_domain_name
  cloudfront_hosted_zone_id = module.cdn.distribution_hosted_zone_id

  certificate_arn                      = one(module.certificate[*].certificate_arn)
  domain_validation_options            = try(module.certificate[0].domain_validation_options, [])
  manage_validation_records_in_route53 = var.manage_validation_records_in_route53
  wait_for_certificate_validation      = var.wait_for_certificate_validation
}

# ---------------------------------------------------------------------------
# Alarms
# ---------------------------------------------------------------------------

module "observability" {
  source = "../observability"

  name_prefix = var.name_prefix
  environment = var.environment
  tags        = local.tags

  distribution_id          = module.cdn.distribution_id
  media_distribution_id    = module.media.media_distribution_id
  realtime_metrics_enabled = true

  # Known at plan time. The id beside it is not. See the note on the media
  # alarm in the observability module.
  media_distribution_enabled = var.create_media_distribution

  function_names = module.compute.function_names
  table_names    = module.data.table_names

  dlq_names = {
    rollup_consumer   = module.compute.rollup_dlq_name
    media_derivatives = module.media.derivatives_dlq_name
  }

  alarm_email_addresses        = var.alarm_email_addresses
  cache_hit_rate_threshold     = var.cache_hit_rate_threshold
  treat_low_traffic_as_healthy = var.treat_low_traffic_as_healthy
}
