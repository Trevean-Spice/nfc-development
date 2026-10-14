output "certificate_validation_records" {
  description = "PASTE THESE INTO THE SQUARESPACE ZONE on Tuesday 18 August, while it is still authoritative. Route 53 cannot validate a zone it is not yet answering for."
  value       = module.stack.certificate_validation_records
}

output "certificate_status" {
  description = "Must read ISSUED before attach_apex_aliases is set to true, and before the flip. Hard gate."
  value       = module.stack.certificate_status
}

output "certificate_arn" {
  description = "ACM certificate ARN in us-east-1."
  value       = module.stack.certificate_arn
}

output "route53_name_servers" {
  description = <<-EOT
    THE FOUR NAMESERVERS. This is the only value that gets typed into
    Squarespace, and typing it is the single action in this project that can
    strand 1,000 encoded jars.

    Not until Thursday morning's verification has passed with no DNS involved
    and the zone diff is clean.
  EOT
  value       = module.stack.route53_name_servers
}

output "copied_zone_record_count" {
  description = "Records copied from the existing zone. Compare against the export before the flip. A copy with fewer records than the original is the failure this number exists to catch."
  value       = module.stack.copied_zone_record_count
}

output "distribution_domain_name" {
  description = "The distribution's own hostname, for the verification that involves no DNS."
  value       = module.stack.distribution_domain_name
}

output "distribution_id" {
  description = "For invalidations and for every alarm dimension."
  value       = module.stack.distribution_id
}

output "verify_command" {
  description = "The Thursday morning verification, run before anything is flipped."
  value       = module.stack.verify_command
}

output "readiness" {
  description = "What is and is not real in production. Read it after every apply."
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
  description = "Eight functions, eight roles, nothing shared."
  value       = module.stack.function_names
}

output "functions_still_on_placeholder" {
  description = "Must be empty before the domain resolves. A resolving domain pointing at nothing is worse than a domain that does not resolve, because it looks like it works."
  value       = module.stack.functions_still_on_placeholder
}

output "secret_names" {
  description = "Secret containers. Values are set out of band and are never in state."
  value       = module.stack.secret_names
}

output "tag_password_holder" {
  description = "Named holder of the ST25TV02KC area password."
  value       = module.stack.tag_password_holder
}

output "alarm_names" {
  description = "Every alarm, for the 72 hour soak review on Monday 24 August."
  value       = module.stack.alarm_names
}

output "alarm_recipients_status" {
  description = "Whether anyone will actually receive an alarm. Confirm the email subscriptions before the flip, not after."
  value       = module.stack.alarm_recipients_status
}

output "media_buckets" {
  description = "Originals and derivatives."
  value       = module.stack.media_buckets
}

output "site_bucket_name" {
  description = "The AWS origin bucket. Tap-path derivatives are published here under images/ so the hero stays same origin."
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
