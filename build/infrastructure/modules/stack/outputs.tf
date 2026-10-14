# ===========================================================================
# Outputs, grouped by the question they answer.
# ===========================================================================

# ---------------------------------------------------------------------------
# "Verify with no DNS involved"
#
# This group exists for one step in the cutover plan: Thursday 20 August,
# morning. Full verification with curl --resolve and a hosts file entry on a
# physical test phone, before a single nameserver changes.
# ---------------------------------------------------------------------------

output "distribution_domain_name" {
  description = "The distribution's own hostname. Feed it to scripts/verify-no-dns.sh."
  value       = module.cdn.distribution_domain_name
}

output "distribution_id" {
  description = "Apex distribution id."
  value       = module.cdn.distribution_id
}

output "verify_command" {
  description = <<-EOT
    The exact command for the Thursday morning verification. It resolves the
    distribution to an edge IP itself and checks all five /t/ codes for the
    307 status and the exact Location string, with no DNS involved.
  EOT
  value = var.manage_dns && var.apex_domain != null ? (
    "./scripts/verify-no-dns.sh ${var.apex_domain} ${module.cdn.distribution_domain_name}"
    ) : (
    "./scripts/verify-no-dns.sh ${module.cdn.distribution_domain_name} ${module.cdn.distribution_domain_name}"
  )
}

output "edge_function_is_placeholder" {
  description = "true when the inert placeholder was deployed instead of the real /t/* redirect function. Must be false on staging and prod."
  value       = module.cdn.edge_function_is_placeholder
}

# ---------------------------------------------------------------------------
# DNS, only when manage_dns is true
# ---------------------------------------------------------------------------

output "route53_name_servers" {
  description = "The four nameservers to type into Squarespace, and nothing else. Not until Thursday's verification has passed."
  value       = one(module.dns[*].name_servers)
}

output "certificate_arn" {
  description = "ACM certificate ARN in us-east-1."
  value       = one(module.certificate[*].certificate_arn)
}

output "certificate_status" {
  description = "Must read ISSUED before attach_apex_aliases is set to true."
  value       = one(module.certificate[*].certificate_status)
}

output "certificate_validation_records" {
  description = "Paste these into the Squarespace zone on Tuesday 18 August."
  value       = try(module.certificate[0].validation_records, [])
}

output "copied_zone_record_count" {
  description = "Records copied from the existing zone. Compare against the export before the flip."
  value       = one(module.dns[*].copied_record_count)
}

# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------

output "table_names" {
  description = "The five table names as deployed."
  value       = module.data.table_names
}

output "scan_events_stream_arn" {
  description = "DynamoDB stream on ScanEvents, NEW_IMAGE."
  value       = module.data.scan_events_stream_arn
}

output "rollup_mapping_enabled" {
  description = "Whether the rollup consumer is attached to the stream. The INSERT-only, EVT# prefix filter is in modules/compute/main.tf and is not optional."
  value       = var.enable_rollup_event_source_mapping
}

# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

output "site_bucket_name" {
  description = "The AWS origin bucket. Tap-path image derivatives are published here under images/ so the hero stays same origin."
  value       = module.cdn.site_bucket_name
}

output "media_buckets" {
  description = "Originals (presigned PUT target) and derivatives (pipeline output)."
  value = {
    originals   = module.media.originals_bucket_name
    derivatives = module.media.derivatives_bucket_name
  }
}

output "render_cache" {
  description = "The externalised render cache. Bucket and shared index, plus the environment the renderer needs. Provisioning it is necessary and not sufficient: the application must register a cache handler that uses it, which is open question Q16."
  value       = module.render_cache.environment_variables
}

# ---------------------------------------------------------------------------
# Compute and secrets
# ---------------------------------------------------------------------------

output "function_names" {
  description = "Eight functions, eight roles, nothing shared."
  value       = module.compute.function_names
}

output "functions_still_on_placeholder" {
  description = "Functions still running the inert placeholder package. Should be empty before the M2 gate on Friday 28 August."
  value       = module.compute.using_placeholder_packages
}

output "secret_names" {
  description = "Secret containers. Values are set out of band by the named holder and are never in state, never in the repo."
  value       = module.secrets.secret_names
}

output "tag_password_holder" {
  description = "Named holder of the ST25TV02KC area password."
  value       = module.secrets.tag_password_holder
}

# ---------------------------------------------------------------------------
# Alarms
# ---------------------------------------------------------------------------

output "alarm_topic_arn" {
  description = "SNS topic every alarm publishes to."
  value       = module.observability.alarm_topic_arn
}

output "alarm_names" {
  description = "Every alarm, so the 72 hour soak review on Monday 24 August has a list to walk."
  value       = module.observability.alarm_names
}

output "alarm_recipients_status" {
  description = "Whether anyone will actually receive an alarm."
  value       = module.observability.unconfirmed_subscriptions_warning
}

# ---------------------------------------------------------------------------
# Readiness
# ---------------------------------------------------------------------------

output "readiness" {
  description = <<-EOT
    A short honest summary of what is and is not real in this environment.
    Printed after every apply so nobody has to infer it from a resource count.
  EOT
  value = {
    environment               = var.environment
    serves_apex_domain        = var.attach_apex_aliases
    edge_redirect_is_real     = !module.cdn.edge_function_is_placeholder
    application_code_deployed = length(module.compute.using_placeholder_packages) == 0
    rollup_pipeline_live      = var.enable_rollup_event_source_mapping
    derivative_pipeline_live  = var.enable_media_event_source_mapping
    render_cache_externalised = "provisioned, application handler TO CONFIRM IN AUDIT (Q16)"
    alarms_have_a_recipient   = length(var.alarm_email_addresses) > 0

    # Was hardcoded false from Tuesday 25 August 2026 until Thursday 27 August
    # 2026, and it was true when it was written: nothing in this package
    # created an API Gateway, a function URL or a lambda permission, so
    # POST /v1/scan-events had nowhere to arrive.
    #
    # It is now measured rather than asserted, and BOTH halves have to be
    # there. Function URLs with no CloudFront behaviour in front of them is a
    # door with no corridor; behaviours with no function URLs is a corridor
    # with no door. Either one alone would read true on a naive check and the
    # beacon would still have nowhere to post.
    functions_have_an_http_invoke_path = module.compute.http_invoke_path_is_real && module.cdn.serves_v1_surface

    # WAS HARDCODED false FROM THE FIRST APPLY ON THURSDAY 27 AUGUST 2026 UNTIL
    # FRIDAY 4 SEPTEMBER 2026, AND IT WAS TRUE WHEN IT WAS WRITTEN. Nothing in
    # this package could write an object into the site bucket and no identity
    # with s3:PutObject on it was defined anywhere, so the pages in the bucket
    # were put there by hand with `aws s3 sync` and pressing publish updated a
    # record and stopped.
    #
    # It is now measured, from the three things a publish needs, and ALL THREE
    # have to be there. Any one alone is a publish that stops somewhere nobody
    # is watching:
    #
    #   write the origin        without it there is nothing to serve
    #   invalidate the CDN      without it the edge keeps serving the old bytes
    #                           and the failure is invisible to everyone except
    #                           a customer
    #   a dispatch target       without it the API queues a revalidation, logs
    #                           it, and dispatches nothing, which is precisely
    #                           the state this flag has been reporting
    #
    # Reading the page back is deliberately NOT in the conjunction. A publish
    # without it is a real publish that cannot be confirmed, and the pipeline
    # says "published, not confirmed" rather than claiming success. It is
    # reported separately, below, so the difference stays visible.
    blend_html_can_be_published = (
      module.compute.publish_path_is_real.can_write_the_origin &&
      module.compute.publish_path_is_real.can_invalidate_the_cdn &&
      module.compute.publish_path_is_real.publish_dispatches
    )

    publish_can_be_confirmed_live = module.compute.publish_path_is_real.reads_the_page_back

    # WHERE THE RENDER RUNS, which was the last open question on this path and
    # is the reason publish_dispatches above could not be true. Added Friday 4
    # September 2026.
    #
    # Three states and they are different problems, so they read differently
    # rather than collapsing into one boolean:
    #
    #   "not created"     create_publisher is false. The publish pipeline does
    #                     not exist in this environment and the API queues,
    #                     logs and dispatches nothing, exactly as before.
    #   "no image"        the pipeline exists, the service is at zero tasks,
    #                     and nothing has been pushed to its repository. One
    #                     command away.
    #   "ecs-fargate ..." a task is asked for and an image exists for it.
    #
    # It says what is ASKED FOR, not what is healthy. Terraform owns the
    # service and the image pipeline owns the image, the same split every
    # function here already has, so whether a task is actually passing its
    # health check is a question for the console and not for a plan.
    # try() AND NOT A CONDITIONAL GUARD, throughout. With create_publisher false
    # there is no instance zero, and HCL does not reliably decline to evaluate
    # the arm of a conditional it did not select. try() with an explicit index
    # also depends on ONE output rather than on the whole module, which is the
    # difference between this reading a value and this being a 30 node cycle.
    # See the note beside local.revalidation_webhook_url in main.tf.
    renderer_runs_on = (
      !var.create_publisher ? "not created. revalidation_webhook_url is null and publish dispatches nothing" :
      !try(module.publisher[0].host_is_real.image_pushed, false) ? "no image. The pipeline exists at zero tasks, nothing has been pushed to ${try(module.publisher[0].image_repository_url, "its repository")}" :
      "ecs-fargate, ${try(module.publisher[0].host_is_real.tasks_requested, 0)} always on task, ${try(module.publisher[0].host_is_real.task_cpu_units, 0)} CPU units"
    )

    # Whether the render will read the API rather than the fixtures in
    # build/content.
    #
    # TRUE ONCE THE PIPELINE EXISTS, since Friday 4 September 2026. It was
    # false by necessity until then, because the only front door to the API is
    # the apex distribution and /v1 content reads are cacheable at the edge per
    # the frozen contract, section 7, so a render could be handed the version
    # from before the edit it was dispatched to publish, publish it, and report
    # success. Fixtures were the safe wrong answer: the deployment guard refuses
    # them outright on production, so the pipeline was useless and LOUDLY
    # useless rather than plausible and quietly stale.
    #
    # That is now closed at the READ rather than at the verification, which is
    # the only place it could be closed: the read back compares the served page
    # against what the renderer produced, so a renderer fed stale content
    # compares stale against stale and passes. Every /v1 read the render makes
    # carries a per render cache buster, the api_content cache policy puts query
    # strings in the cache key, and the publish is refused before the guard, the
    # diff, the put or the invalidation if any read cannot be shown to have come
    # from the origin. See build/publisher/src/content-read.mjs.
    render_reads_the_api = try(module.publisher[0].host_is_real.renders_against_api, false)

    # HOW it reads, because the boolean above was true of the shape that could
    # publish stale content and report success, and a boolean cannot tell those
    # two apart. This one is a sentence and it names the mechanism.
    render_read_is_uncached = try(
      module.publisher[0].host_is_real.content_read,
      "not created. No publish pipeline exists in this environment, so nothing reads the API"
    )
  }
}

output "publish_path" {
  description = <<-EOT
    The publish path in detail, so that when blend_html_can_be_published is
    false it is obvious which of the three parts is missing rather than
    requiring somebody to read the module.
  EOT
  value       = module.compute.publish_path_is_real
}

output "publisher" {
  description = <<-EOT
    The publish pipeline's host, and the two commands that follow an apply.

    Empty when create_publisher is false, which is the default: this is the
    first thing in the package that costs money continuously in the client's
    account, so it is opted into rather than out of. See create_publisher in
    the stack's variables.
  EOT
  value = var.create_publisher ? {
    host                 = try(module.publisher[0].host_is_real, null)
    image_repository_url = try(module.publisher[0].image_repository_url, null)
    revalidate_url       = try(module.publisher[0].revalidate_url, null)
    admin_base_url       = try(module.publisher[0].base_url, null)
    cluster              = try(module.publisher[0].cluster_name, null)
    service              = try(module.publisher[0].service_name, null)
    log_group            = try(module.publisher[0].log_group_name, null)
  } : null
}
