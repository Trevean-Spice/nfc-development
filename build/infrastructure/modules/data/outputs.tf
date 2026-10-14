output "table_names" {
  description = "The five table names, as deployed."
  value = {
    spice_blends = aws_dynamodb_table.spice_blends.name
    scan_events  = aws_dynamodb_table.scan_events.name
    recipes      = aws_dynamodb_table.recipes.name
    growers      = aws_dynamodb_table.growers.name
    nfc_tags     = aws_dynamodb_table.nfc_tags.name
  }
}

output "table_arns" {
  description = "The five table ARNs, for least-privilege IAM."
  value = {
    spice_blends = aws_dynamodb_table.spice_blends.arn
    scan_events  = aws_dynamodb_table.scan_events.arn
    recipes      = aws_dynamodb_table.recipes.arn
    growers      = aws_dynamodb_table.growers.arn
    nfc_tags     = aws_dynamodb_table.nfc_tags.arn
  }
}

output "index_arns" {
  description = "Index ARNs. A policy that grants Query on a table does not grant Query on its indexes."
  value = {
    spice_blends = "${aws_dynamodb_table.spice_blends.arn}/index/*"
    recipes      = "${aws_dynamodb_table.recipes.arn}/index/*"
    growers      = "${aws_dynamodb_table.growers.arn}/index/*"
  }
}

output "scan_events_stream_arn" {
  description = "DynamoDB stream ARN on ScanEvents, NEW_IMAGE."
  value       = aws_dynamodb_table.scan_events.stream_arn
}

output "recipes_key_shape" {
  description = "Which of the two acceptable Recipes shapes was deployed. Both serve access pattern 3 in one Query."
  value       = var.recipes_key_shape
}
