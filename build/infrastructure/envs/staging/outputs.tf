output "distribution_domain_name" {
  description = "The staging hostname. This is what everything on our side builds and measures against until the domain resolves."
  value       = module.stack.distribution_domain_name
}

output "verify_command" {
  description = "Runs the /t/ code verification against staging with no DNS involved."
  value       = module.stack.verify_command
}

output "readiness" {
  description = "What is and is not real in this environment."
  value       = module.stack.readiness
}

output "table_names" {
  description = "The five table names as deployed."
  value       = module.stack.table_names
}

output "render_cache" {
  description = "Environment the renderer needs so its cache handler points at shared storage rather than the local filesystem."
  value       = module.stack.render_cache
}

output "function_names" {
  description = "Eight functions, eight roles."
  value       = module.stack.function_names
}

output "functions_still_on_placeholder" {
  description = "Should be empty before the M2 gate on Friday 28 August."
  value       = module.stack.functions_still_on_placeholder
}

output "alarm_names" {
  description = "Every alarm created."
  value       = module.stack.alarm_names
}

output "alarm_recipients_status" {
  description = "Whether anyone will actually receive an alarm."
  value       = module.stack.alarm_recipients_status
}

output "media_buckets" {
  description = "Originals and derivatives."
  value       = module.stack.media_buckets
}

output "site_bucket_name" {
  description = "The AWS origin bucket."
  value       = module.stack.site_bucket_name
}

output "publish_path" {
  description = "Which of the three parts of a publish is missing when blend_html_can_be_published is false: a principal that can write the origin, permission to invalidate exactly the changed paths, and a dispatch target."
  value       = module.stack.publish_path
}

output "publisher" {
  description = "Where the render runs, the repository to push its image to, and the cluster, service and log group to look at afterwards. Null when create_publisher is false."
  value       = module.stack.publisher
}
