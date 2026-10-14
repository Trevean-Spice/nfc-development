# ===========================================================================
# PRODUCTION, on Trevean's AWS account
#
# This is the environment that answers the 1,000 encoded jars. Read the cutover
# plan in the document titled "M1 Deliverable 3: Redirect-Serving Decision and
# Apex Domain Routing", section 7, before running anything here.
#
# THE APPLY ORDER IS THE CUTOVER PLAN, and it is driven by three variables that
# are false on the first run and turned on in sequence:
#
#   Run 1, Tuesday 18 August
#     manage_dns = true, attach_apex_aliases = false
#     Creates the certificate in us-east-1 and the hosted zone as an exact copy
#     of the existing zone. Reads out the validation records, which are then
#     pasted into the SQUARESPACE zone while it is still authoritative.
#     NO NAMESERVER CHANGE.
#
#   Run 2, Wednesday 19 August
#     wait_for_certificate_validation = true
#     Gates on ACM reporting ISSUED. The distribution, the behaviours, both
#     origins, the CloudFront Function with the compiled table and the cache
#     policies are all built by now. Apex and www ALIAS records exist in a zone
#     nothing is reading yet, which is what makes Thursday's diff possible.
#     STILL NO NAMESERVER CHANGE.
#
#   Run 3, Wednesday 19 August, after the certificate reads ISSUED
#     attach_apex_aliases = true
#     Attaches treveanspice.com and www to the distribution.
#
#   Thursday 20 August, morning
#     NOT A TERRAFORM RUN. scripts/verify-no-dns.sh, plus a hosts file entry on
#     a physical test phone. All five /t/ codes, four of them against physical
#     tags. Check the rendered blend name, the exact Location string, the 307
#     status and the cache headers. Then scripts/zone-diff.sh, record by
#     record, Route 53 against Squarespace.
#
#   Thursday 20 August, afternoon
#     NOT A TERRAFORM RUN EITHER. A human types four nameservers into
#     Squarespace, having just read a verification report. It is the single
#     action in this project that can strand inventory, and it is deliberately
#     not a side effect of an apply.
#
#   After the flip, once resolution is confirmed
#     manage_validation_records_in_route53 = true
#     So renewals validate automatically from then on and the certificate does
#     not silently fail to renew in December.
#
# The Squarespace zone is left INTACT AND UNEDITED for at least 14 days after
# the flip. That is what makes the rollback a nameserver revert rather than a
# zone rebuild. Nothing in this Terraform touches it, and nothing should.
# ===========================================================================

module "stack" {
  source = "../../modules/stack"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  environment = "prod"
  name_prefix = var.name_prefix

  # ---- DNS and the cutover ------------------------------------------------
  manage_dns                    = var.manage_dns
  apex_domain                   = var.apex_domain
  copied_zone_records           = var.copied_zone_records
  acknowledge_zone_has_no_email = var.acknowledge_zone_has_no_email

  attach_apex_aliases                  = var.attach_apex_aliases
  wait_for_certificate_validation      = var.wait_for_certificate_validation
  manage_validation_records_in_route53 = var.manage_validation_records_in_route53

  # ---- CDN ----------------------------------------------------------------
  edge_function_source_path       = var.edge_function_source_path
  allow_placeholder_edge_function = false

  vercel_origin_domain_name     = var.vercel_origin_domain_name
  forward_host_header_to_vercel = var.forward_host_header_to_vercel
  price_class                   = var.price_class

  # ---- Data ---------------------------------------------------------------
  #
  # Whether production tables carry the environment prefix depends on what the
  # audit finds already deployed. Adopting an existing unprefixed table is
  # cheaper than renaming it, and a DynamoDB rename is not a rename, it is a
  # migration.
  name_tables_with_prefix    = var.name_tables_with_prefix
  create_slug_index          = var.create_slug_index
  recipes_key_shape          = var.recipes_key_shape
  enable_deletion_protection = true

  # ---- Media --------------------------------------------------------------
  admin_origins             = var.admin_origins
  create_media_distribution = true

  # ---- Compute ------------------------------------------------------------
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
  log_retention_days                 = 90

  # ---- Secrets ------------------------------------------------------------
  tag_password_holder         = var.tag_password_holder
  extra_secrets               = var.extra_secrets
  secret_recovery_window_days = 30

  # ---- Alarms -------------------------------------------------------------
  alarm_email_addresses    = var.alarm_email_addresses
  cache_hit_rate_threshold = var.cache_hit_rate_threshold

  # A rate alarm cannot detect the absence of traffic and should not pretend
  # to. Absence is caught by the 72 hour soak review on Monday 24 August and by
  # the field beacon, which counts real taps. Left as notBreaching so that a
  # quiet hour does not page anybody at 3am for a healthy system.
  treat_low_traffic_as_healthy = true

  extra_tags = {
    Purpose = "Production. Answers the 1,000 tags encoded on 24 July 2026."
  }
}
