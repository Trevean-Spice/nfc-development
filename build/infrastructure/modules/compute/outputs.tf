output "function_names" {
  description = "Map of function key to deployed function name. The alarms module keys off this."
  value       = { for key, fn in local.all_functions : key => fn.function_name }
}

output "function_arns" {
  description = "Map of function key to function ARN."
  value       = { for key, fn in local.all_functions : key => fn.arn }
}

output "role_arns" {
  description = "Map of function key to execution role ARN. Eight functions, eight roles, nothing shared."
  value       = { for key, role in aws_iam_role.function : key => role.arn }
}

output "log_group_names" {
  description = "Map of function key to log group name."
  value       = { for key, group in aws_cloudwatch_log_group.function : key => group.name }
}

output "rollup_dlq_arn" {
  description = "Dead letter queue for the stream consumer. Not optional: bisect on error is disabled by design."
  value       = aws_sqs_queue.rollup_dlq.arn
}

output "rollup_dlq_name" {
  description = "Dead letter queue name, for the CloudWatch alarm dimension."
  value       = aws_sqs_queue.rollup_dlq.name
}

output "using_placeholder_packages" {
  description = <<-EOT
    Function keys still running the inert placeholder package, measured from
    the live code_sha256 of each deployed function rather than from the keys of
    var.function_packages.

    The distinction matters and it was wrong before. Every function here
    carries ignore_changes on filename and source_code_hash, so naming a
    package in tfvars does not deploy it and a package deployed by the
    application pipeline never appears in tfvars. Read from the variable, this
    output could say "code deployed" for eight placeholders. Read from the
    hash, it cannot.
  EOT
  value = sort([
    for key, fn in data.aws_lambda_function.deployed
    : key if fn.code_sha256 == data.archive_file.placeholder.output_base64sha256
  ])
}

output "function_url_origins" {
  description = <<-EOT
    Map of function key to the HOST of its Lambda function URL, ready to be used
    as a CloudFront origin domain_name. Empty when enable_http_invoke_path is
    false.

    The host, not the URL: aws_lambda_function_url exposes function_url as
    https://<id>.lambda-url.<region>.on.aws/ and CloudFront wants the bare
    hostname with no scheme and no trailing slash. Doing that here rather than
    in the cdn module keeps the shape of the value the same as every other
    origin domain that module is handed.
  EOT
  value = {
    for key, url in aws_lambda_function_url.api
    : key => replace(replace(url.function_url, "https://", ""), "/", "")
  }
}

output "http_invoke_path_is_real" {
  description = "Whether the /v1 surface has an HTTP front door in this environment. Feeds the readiness output, which used to hardcode this false."
  value       = length(aws_lambda_function_url.api) > 0
}

output "publish_path_is_real" {
  description = <<-EOT
    Whether a page can actually be published in this environment, measured from
    the three things a publish needs rather than asserted.

    All three, because any one alone is a publish that stops somewhere nobody
    is watching: a principal that can write the origin, permission to invalidate
    exactly the paths that changed, and a dispatch target for the signed
    revalidation the publish emits. Without the third, publish updates a record
    and stops, which is what it did from 27 August 2026.
  EOT
  value = {
    can_write_the_origin   = var.site_bucket_arn != null
    can_invalidate_the_cdn = var.distribution_arn != null
    publish_dispatches     = var.revalidation_webhook_url != null
    reads_the_page_back    = var.publisher_public_base_url != null || var.distribution_domain_name != null
    renderer_role_arn      = aws_iam_role.function["web_renderer"].arn
  }
}

output "renderer_role_arn" {
  description = <<-EOT
    The role the render runs as, wherever it runs.

    It is created here rather than next to the container because the
    permissions were settled before the host was and are correct either way:
    read the content tables, write the site bucket, invalidate exactly the
    changed paths, read the revalidation secret. Its trust policy names
    ecs-tasks.amazonaws.com as well as lambda.amazonaws.com, and it is the only
    one of the eight that does.
  EOT
  value       = aws_iam_role.function["web_renderer"].arn
}

output "cognito" {
  description = <<-EOT
    The managed identity provider the deployed admin authenticates against, and the three
    values the API needs to verify the tokens it issues.

    jwks_uri, issuer and audience go straight onto the content and admin functions as
    AUTH_JWKS_URI, AUTH_ISSUER and AUTH_AUDIENCE. The audience is the app client id rather
    than a name of our choosing, because that is what Cognito puts in the id token's aud
    claim and what verifyAccessToken checks.
  EOT
  value = var.enable_http_invoke_path ? {
    user_pool_id = aws_cognito_user_pool.admin[0].id
    client_id    = aws_cognito_user_pool_client.admin[0].id
    issuer       = "https://cognito-idp.${data.aws_region.current.name}.amazonaws.com/${aws_cognito_user_pool.admin[0].id}"
    jwks_uri     = "https://cognito-idp.${data.aws_region.current.name}.amazonaws.com/${aws_cognito_user_pool.admin[0].id}/.well-known/jwks.json"
    groups       = ["Admin", "Editor", "Viewer"]
  } : null
}

output "admin_ui_endpoint_domain" {
  description = "Hostname of the admin's HTTP API, for the CDN to use as an origin. Null when the HTTP invoke path is off."
  value       = var.enable_http_invoke_path ? replace(aws_apigatewayv2_api.admin_ui[0].api_endpoint, "https://", "") : null
}
