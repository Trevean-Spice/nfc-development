output "bucket_name" {
  description = "Shared object storage for rendered payloads."
  value       = aws_s3_bucket.render_cache.bucket
}

output "bucket_arn" {
  description = "ARN of the render cache bucket."
  value       = aws_s3_bucket.render_cache.arn
}

output "index_table_name" {
  description = "Shared index. Infrastructure for the rendering layer, not a sixth application table."
  value       = aws_dynamodb_table.render_cache_index.name
}

output "index_table_arn" {
  description = "ARN of the shared index table."
  value       = aws_dynamodb_table.render_cache_index.arn
}

output "environment_variables" {
  description = <<-EOT
    The environment the renderer needs so that its cache handler points at
    shared storage rather than the local filesystem.

    Setting these is necessary and not sufficient. The application must also
    register a cache handler that uses them. Infrastructure can provision
    shared storage; it cannot stop a framework defaulting to /tmp. Confirming
    that the handler is registered is open question Q16, and it is the check
    that closes the hypothesis rather than this module.
  EOT
  value = {
    RENDER_CACHE_BUCKET    = aws_s3_bucket.render_cache.bucket
    RENDER_CACHE_INDEX     = aws_dynamodb_table.render_cache_index.name
    RENDER_CACHE_EXTERNAL  = "true"
    RENDER_CACHE_TAG_TTL_S = tostring(var.revalidation_tag_ttl_days * 86400)
  }
}
