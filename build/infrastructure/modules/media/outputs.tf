output "originals_bucket_name" {
  description = "Presigned PUT target. A large photograph never passes through an application function."
  value       = aws_s3_bucket.originals.bucket
}

output "originals_bucket_arn" {
  description = "ARN of the originals bucket."
  value       = aws_s3_bucket.originals.arn
}

output "derivatives_bucket_name" {
  description = "Pipeline output bucket, origin for the media distribution."
  value       = aws_s3_bucket.derivatives.bucket
}

output "derivatives_bucket_arn" {
  description = "ARN of the derivatives bucket."
  value       = aws_s3_bucket.derivatives.arn
}

output "media_distribution_domain_name" {
  description = "Media distribution hostname. Not on the tap path."
  value       = var.create_media_distribution ? aws_cloudfront_distribution.media[0].domain_name : null
}

output "media_distribution_id" {
  description = "Media distribution id, for alarms and invalidations."
  value       = var.create_media_distribution ? aws_cloudfront_distribution.media[0].id : null
}

output "derivatives_queue_url" {
  description = "Queue the admin completion call writes to."
  value       = aws_sqs_queue.derivatives.url
}

output "derivatives_queue_arn" {
  description = "Queue ARN, for the derivative function's event source mapping."
  value       = aws_sqs_queue.derivatives.arn
}

output "derivatives_dlq_arn" {
  description = "Dead letter queue ARN, alarmed on depth."
  value       = aws_sqs_queue.derivatives_dlq.arn
}

output "derivatives_dlq_name" {
  description = "Dead letter queue name, for the CloudWatch alarm dimension."
  value       = aws_sqs_queue.derivatives_dlq.name
}

output "max_upload_bytes" {
  description = "Advisory single-upload ceiling, enforced by the presign function's content-length-range condition."
  value       = var.max_upload_bytes
}
