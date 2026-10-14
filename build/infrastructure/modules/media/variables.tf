variable "name_prefix" {
  description = "Prefix for resource names."
  type        = string
}

variable "tags" {
  description = "Tags applied to every taggable resource."
  type        = map(string)
  default     = {}
}

variable "admin_origins" {
  description = <<-EOT
    Browser origins allowed to PUT to the originals bucket with a presigned
    URL. The admin CMS only. The browser uploads directly to S3, so this CORS
    rule is the thing that decides which page is allowed to do it.
  EOT
  type        = list(string)
  default     = []
}

variable "max_upload_bytes" {
  description = <<-EOT
    Advisory ceiling on a single original upload, recorded here so the presign
    function has one number to enforce. Presigned PUT URLs are constrained by
    the content-length-range condition set at signing time, which is the
    function's job, not this module's.
  EOT
  type        = number
  default     = 52428800
}

variable "originals_retention_days" {
  description = "Days before an original transitions to infrequent access. Originals are never deleted automatically: they are the only copy of a photograph."
  type        = number
  default     = 90
}

variable "create_media_distribution" {
  description = <<-EOT
    Create a CloudFront distribution over the derivatives bucket.

    This distribution serves the admin CMS and any surface that is NOT on the
    tap path. The tap-path hero is served from the apex distribution's
    /images/* behaviour, because the document titled "Per-page byte and speed
    budget", section 3, decision A, requires the 307 target and everything it
    pulls to be same origin: a second hostname costs a fresh DNS lookup plus a
    fresh TCP and TLS handshake, an estimated 300 to 600 ms on cellular.
  EOT
  type        = bool
  default     = true
}

variable "site_bucket_arn" {
  description = <<-EOT
    ARN of the AWS origin bucket on the apex distribution. The derivative
    pipeline publishes tap-path derivatives into its images/ prefix so the hero
    stays same origin. null disables that grant.
  EOT
  type        = string
  default     = null
}

variable "kms_key_arn" {
  description = "Customer managed KMS key for the queues. null uses the AWS managed key."
  type        = string
  default     = null
}

variable "derivative_visibility_timeout_seconds" {
  description = "Must exceed the derivative function timeout. Image derivative generation on a 50 MB original is not a two second job."
  type        = number
  default     = 900
}
