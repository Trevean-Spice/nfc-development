output "kms_key_arn" {
  description = "Customer managed key ARN, or null."
  value       = var.create_kms_key ? aws_kms_key.main[0].arn : null
}

output "kms_key_id" {
  description = "Customer managed key id, or null."
  value       = var.create_kms_key ? aws_kms_key.main[0].key_id : null
}

output "secret_arns" {
  description = "Map of short name to secret ARN, for least-privilege IAM. A function is granted exactly the secrets it needs, by ARN, never by wildcard."
  value       = { for name, secret in aws_secretsmanager_secret.managed : name => secret.arn }
}

output "secret_names" {
  description = "Map of short name to full secret name."
  value       = { for name, secret in aws_secretsmanager_secret.managed : name => secret.name }
}

output "tag_password_holder" {
  description = "The named holder of the ST25TV02KC area password, as recorded on the secret."
  value       = var.tag_password_holder
}

output "shopify_store_domain_parameter" {
  description = "Parameter Store name for the Shopify store domain."
  value       = aws_ssm_parameter.shopify_store_domain.name
}
