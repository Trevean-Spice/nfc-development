output "revalidate_url" {
  description = <<-EOT
    What revalidation_webhook_url should be set to. NULL WHEN NO IMAGE HAS BEEN
    PUSHED, and that is the point: an API pointed at an endpoint with no
    healthy target turns every publish into a 503 the editor has to interpret,
    which is worse than the honest null it replaces.
  EOT
  value       = local.has_image ? "https://${aws_cloudfront_distribution.publisher.domain_name}/revalidate" : null
}

output "base_url" {
  description = "PUBLISHER_BASE_URL for build/admin, so the publish screen can read this pipeline's job record and report whether the edge actually served the new document. Null for the same reason as revalidate_url."
  value       = local.has_image ? "https://${aws_cloudfront_distribution.publisher.domain_name}" : null
}

output "image_repository_url" {
  description = "Where build/publisher/scripts/push-image.sh pushes. The repository exists whether or not anything has been pushed to it, which is what lets the push be the last step rather than a chicken and egg."
  value       = aws_ecr_repository.publisher.repository_url
}

output "distribution_domain_name" {
  description = "The small distribution in front of the load balancer. Not the apex distribution and not on the tap path."
  value       = aws_cloudfront_distribution.publisher.domain_name
}

output "log_group_name" {
  description = "Where a render's stdout goes, including the reason a refused publish was refused."
  value       = aws_cloudwatch_log_group.publisher.name
}

output "service_name" {
  description = "The ECS service. One task, never two: two publishers race on the published manifest."
  value       = aws_ecs_service.publisher.name
}

output "cluster_name" {
  description = "The ECS cluster, for the exec and logs commands in build/publisher's README."
  value       = aws_ecs_cluster.publisher.name
}

output "host_is_real" {
  description = <<-EOT
    Whether the renderer actually has somewhere to run in this environment,
    measured from the two things it needs rather than asserted: a service with
    a task asked for, and an image for that task to run.

    Feeds the readiness output. It is deliberately not the same question as
    blend_html_can_be_published, which also needs the origin, the invalidation
    and the dispatch target.
  EOT
  value = {
    host                = "ecs-fargate"
    image_pushed        = local.has_image
    tasks_requested     = local.desired_count
    task_cpu_units      = var.task_cpu
    task_memory_mib     = var.task_memory
    render_mode         = "build"
    renders_against_api = var.content_api_base_url != null
    content_api         = var.content_api_base_url

    # HOW the render reads, not just whether, because "reads the API" was true
    # of the shape that could publish the version from before the edit and
    # report success. Reading a boolean and finding out later that it meant
    # "reads it, possibly from a cache" is the thing this string prevents.
    content_read = (
      var.content_api_base_url == null
      ? "fixtures. TREVEAN_CONTENT_API is unset, so the render publishes build/content and the deployment guard refuses it on production"
      : "uncached. Every /v1 read carries a per render cache buster, and a read that any cache claims fails the publish before anything moves. See build/publisher/src/content-read.mjs"
    )
  }
}
