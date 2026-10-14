output "distribution_id" {
  description = "CloudFront distribution id. Needed by the revalidation function for invalidations and by every alarm."
  value       = aws_cloudfront_distribution.apex.id
}

output "distribution_arn" {
  description = "CloudFront distribution ARN."
  value       = aws_cloudfront_distribution.apex.arn
}

output "distribution_domain_name" {
  description = <<-EOT
    The distribution's own hostname, for example d111111abcdef8.cloudfront.net.

    This is the value the "verify with no DNS involved" step needs. See the
    document titled "M1 Deliverable 3: Redirect-Serving Decision and Apex
    Domain Routing", section 7, Thursday 20 August, morning. Feed it to
    scripts/verify-no-dns.sh, which resolves it to an edge IP and drives
    curl --resolve and a hosts file line for the physical test phone.

    On staging this is also the hostname everything on our side builds and
    measures against, so the schedule never waits on Trevean's DNS.
  EOT
  value       = aws_cloudfront_distribution.apex.domain_name
}

output "distribution_hosted_zone_id" {
  description = "CloudFront's fixed hosted zone id, for the apex and www ALIAS records."
  value       = aws_cloudfront_distribution.apex.hosted_zone_id
}

output "site_bucket_name" {
  description = "Name of the AWS origin bucket, or null when an existing origin is used."
  value       = var.create_site_bucket ? aws_s3_bucket.site[0].bucket : null
}

output "site_bucket_arn" {
  description = "ARN of the AWS origin bucket, or null when an existing origin is used."
  value       = var.create_site_bucket ? aws_s3_bucket.site[0].arn : null
}

output "edge_function_arn" {
  description = "ARN of the /t/* CloudFront Function. The source is owned by build/edge/."
  value       = aws_cloudfront_function.t_redirect.arn
}

output "edge_function_is_placeholder" {
  description = "true when the real redirect artifact was not found and the inert placeholder was deployed. Must be false on staging and prod."
  value       = !local.edge_function_present
}

output "log_bucket_name" {
  description = "CloudFront access log bucket, or null when logging is disabled."
  value       = var.enable_access_logs ? aws_s3_bucket.logs[0].bucket : null
}

output "serves_v1_surface" {
  description = "Whether this distribution has the /v1/scan-events and /v1/* behaviours. False means the beacon has nowhere to post even if the functions have URLs."
  value       = local.has_api_origin
}

output "blend_html_cache_policy_id" {
  description = "Cache policy for /blend.html. Key is path plus blend only."
  value       = aws_cloudfront_cache_policy.blend_html.id
}
