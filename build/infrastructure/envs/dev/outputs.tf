output "distribution_domain_name" {
  description = "The dev hostname."
  value       = module.stack.distribution_domain_name
}

output "readiness" {
  description = "What is and is not real in this environment. On dev, edge_redirect_is_real will read false until build/edge/ has produced an artifact."
  value       = module.stack.readiness
}

output "table_names" {
  description = "The five table names as deployed."
  value       = module.stack.table_names
}

output "render_cache" {
  description = "Environment the renderer needs to point at shared storage."
  value       = module.stack.render_cache
}

output "function_names" {
  description = "Eight functions, eight roles."
  value       = module.stack.function_names
}

output "alarm_names" {
  description = "Every alarm created."
  value       = module.stack.alarm_names
}

output "publish_path" {
  description = "Which of the three parts of a publish is missing when blend_html_can_be_published is false: a principal that can write the origin, permission to invalidate exactly the changed paths, and a dispatch target."
  value       = module.stack.publish_path
}

output "publisher" {
  description = "Where the render runs, the repository to push its image to, and the cluster, service and log group to look at afterwards. Null when create_publisher is false."
  value       = module.stack.publisher
}

# The two values the client pastes into Bluehost. Output rather than dug out of the
# console, because they have now been sent to him twice and transcribed by hand each
# time. See "Decision log", D49.
output "certificate_validation_records" {
  description = "CNAME name and value to add at the registrar. Empty until create_certificate is true."
  value       = module.stack.certificate_validation_records
}

output "certificate_status" {
  description = "Must read ISSUED before any alias is attached. PENDING_VALIDATION means the registrar record is not in yet."
  value       = module.stack.certificate_status
}
