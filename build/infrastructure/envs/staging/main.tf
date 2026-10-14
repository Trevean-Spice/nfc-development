# ===========================================================================
# STAGING
#
# Read this paragraph before changing anything in this file.
#
# There is a standing rule on this engagement, stated in the document titled
# "Data model", section 7.5, and carried through the redirect-serving
# decision's cutover plan:
#
#   Everything on the contractor side builds and measures on a staging host so
#   the schedule never waits on the client's DNS.
#
# That rule is what this environment is for, and it is why staging matters more
# than it looks. On Monday 17 August the domain does not resolve, the client's
# AWS account is a virgin install, and the repository is not in our hands.
# Staging is deployable today anyway, into an account we control, because it
# needs none of those three things:
#
#   manage_dns          = false   no hosted zone, no nameservers, no Squarespace
#   attach_apex_aliases = false   runs on its own *.cloudfront.net hostname
#   vercel_origin       = null    default behaviour falls back to the AWS origin
#
# The consequence to be honest about: staging is NOT identical to production.
# It has one origin rather than two, no certificate, and no apex. Everything on
# the tap path is identical: the same /t/* CloudFront Function, the same cache
# policy with the same cache key, the same behaviours in the same order, the
# same table shapes, the same render cache. What differs is the parts that
# cannot exist without a domain.
#
# The one thing that must NOT be relaxed here is the edge function. Staging is
# where the 2.0 second budget is measured before the domain exists, and
# measuring against a placeholder measures nothing. allow_placeholder_edge_
# function is false and the cdn module refuses to deploy the placeholder to a
# non-dev environment regardless.
# ===========================================================================

module "stack" {
  source = "../../modules/stack"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  environment = "staging"
  name_prefix = var.name_prefix

  # No domain, no zone, no certificate. Deliberately.
  manage_dns          = false
  attach_apex_aliases = false

  # The real redirect function, built from build/edge/. Not negotiable here.
  edge_function_source_path       = var.edge_function_source_path
  allow_placeholder_edge_function = false

  # No marketing origin on staging. The default behaviour falls back to the
  # AWS origin, which is the only intentional divergence from the production
  # two-origin shape.
  vercel_origin_domain_name = var.vercel_origin_domain_name

  # Tables are prefixed so staging, dev and anything else can share one
  # account without colliding.
  name_tables_with_prefix    = true
  create_slug_index          = var.create_slug_index
  recipes_key_shape          = var.recipes_key_shape
  enable_deletion_protection = false

  admin_origins             = var.admin_origins
  create_media_distribution = true

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
  publisher_task_memory          = var.publisher_task_memory

  function_packages                  = var.function_packages
  enable_rollup_event_source_mapping = var.enable_rollup_event_source_mapping
  enable_media_event_source_mapping  = var.enable_media_event_source_mapping
  log_retention_days                 = 30

  tag_password_holder         = var.tag_password_holder
  extra_secrets               = var.extra_secrets
  secret_recovery_window_days = 7

  alarm_email_addresses = var.alarm_email_addresses

  # The cache hit ratio alarm runs on staging too, at a lower threshold,
  # because staging is where a change that breaks the rendering strategy
  # should be caught. A low-traffic environment reports missing data rather
  # than a bad ratio, which is why treat_low_traffic_as_healthy is true.
  cache_hit_rate_threshold     = 80
  treat_low_traffic_as_healthy = true

  extra_tags = {
    Purpose = "Contractor-side build and measurement host. Independent of client DNS and client AWS."
  }
}
