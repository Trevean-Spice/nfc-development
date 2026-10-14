variable "name_prefix" {
  description = "Prefix for resource names."
  type        = string
}

variable "tags" {
  description = "Tags applied to every taggable resource."
  type        = map(string)
  default     = {}
}

variable "kms_key_arn" {
  description = "Customer managed KMS key. null uses the AWS owned key."
  type        = string
  default     = null
}

variable "cache_entry_expiry_days" {
  description = <<-EOT
    Days before a cache object is expired from the bucket. A regenerated page
    supersedes its predecessor, and orphaned entries from deleted routes
    otherwise accumulate forever.
  EOT
  type        = number
  default     = 30
}

variable "enable_deletion_protection" {
  description = "Deletion protection on the shared index table. true on prod."
  type        = bool
  default     = false
}

variable "revalidation_tag_ttl_days" {
  description = "TTL on tag revalidation markers in the shared index."
  type        = number
  default     = 7
}
