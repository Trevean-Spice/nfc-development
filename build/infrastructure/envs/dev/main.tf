# ===========================================================================
# DEV
#
# The environment that is allowed to be incomplete.
#
# Dev is the only place allow_placeholder_edge_function may be true, so that
# the distribution, the tables, the buckets and the alarms can be stood up and
# reviewed before build/edge/ has produced an artifact. That is useful on
# Monday and Tuesday and it is dangerous anywhere else, which is why the cdn
# module refuses the placeholder on staging and prod regardless of what a
# tfvars file says.
#
# Everything else here is smaller and cheaper rather than different: shorter
# log retention, no deletion protection, a zero-day secret recovery window so
# the environment can be torn down and rebuilt the same afternoon.
# ===========================================================================

module "stack" {
  source = "../../modules/stack"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  environment = "dev"
  name_prefix = var.name_prefix

  manage_dns = false

  # TRUE while manage_dns is FALSE, and the pair is the whole point. The zone is
  # authoritative at Bluehost, so Route 53 is not managed here; the certificate
  # still has to exist, in us-east-1, before any alias can be attached. Gating the
  # two together is what produced a hand made certificate that died unwatched.
  # See "Decision log", D49.
  shopify_store_domain = var.shopify_store_domain

  catalog_sync_dry_run             = var.catalog_sync_dry_run
  catalog_sync_schedule_expression = var.catalog_sync_schedule_expression

  create_certificate  = var.create_certificate
  apex_domain         = var.apex_domain
  # A variable rather than a literal so the apex cutover is a tfvars change, in
  # the order "Operations runbook", section 9.2 sets. Default false.
  attach_apex_aliases = var.attach_apex_aliases

  edge_function_source_path       = var.edge_function_source_path
  blend_rewrite_source_path       = var.blend_rewrite_source_path
  allow_placeholder_edge_function = var.allow_placeholder_edge_function

  # Variables rather than literals so the Vercel origin is a tfvars line, step 1b
  # of "Operations runbook", section 9.2. Default null, which keeps the default
  # behaviour on our S3 bucket. MUST be set before DNS moves. See the variables.
  vercel_origin_domain_name     = var.vercel_origin_domain_name
  forward_host_header_to_vercel = var.forward_host_header_to_vercel

  name_tables_with_prefix    = true
  create_slug_index          = var.create_slug_index
  recipes_key_shape          = var.recipes_key_shape
  enable_deletion_protection = false

  admin_origins             = var.admin_origins
  create_media_distribution = false

  # The publish path. HOST DECIDED ON FRIDAY 4 SEPTEMBER 2026: a small always
  # on container on Fargate, in modules/publisher, with the argument for it and
  # against the four alternatives at the top of that module.
  #
  # Both variables below are overrides and both are normally null. Left null,
  # the stack derives the dispatch target from the pipeline it creates and the
  # read back host from the apex distribution. Null with create_publisher false
  # is the state readiness has been reporting since the first apply on Thursday
  # 27 August 2026: publish updates a record and stops.
  revalidation_webhook_url  = var.revalidation_webhook_url
  publisher_public_base_url = var.publisher_public_base_url

  # It costs about $100 a month in this account, continuously, so it is opted
  # into. See create_publisher in variables.tf.
  create_publisher               = var.create_publisher
  publisher_content_api_base_url = var.publisher_content_api_base_url
  publisher_image_uri            = var.publisher_image_uri
  publisher_task_cpu             = var.publisher_task_cpu
  admin_api_base_url             = var.admin_api_base_url
  publisher_render_timeout_ms    = var.publisher_render_timeout_ms
  publisher_task_memory          = var.publisher_task_memory

  function_packages                  = var.function_packages
  enable_rollup_event_source_mapping = var.enable_rollup_event_source_mapping
  enable_media_event_source_mapping  = var.enable_media_event_source_mapping
  log_retention_days                 = 7

  tag_password_holder         = var.tag_password_holder
  secret_recovery_window_days = 0

  alarm_email_addresses        = var.alarm_email_addresses
  cache_hit_rate_threshold     = 50
  treat_low_traffic_as_healthy = true

  extra_tags = {
    Purpose = "Development. The only environment permitted to run a placeholder edge function."
  }
}
