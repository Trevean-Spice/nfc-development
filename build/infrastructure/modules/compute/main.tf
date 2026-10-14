# ===========================================================================
# Compute: one role per function, and nothing shared
#
# The Architecture document, section "Security and privacy", requires
# least-privilege IAM per function. That is implemented here literally: eight
# functions, eight roles, eight policies, no shared execution role, and no
# wildcard on a table, a bucket or a secret.
#
# Two consequences worth stating, because they are the point rather than a side
# effect:
#
#   The scan beacon function, the only thing a customer's phone can invoke,
#   can PutItem into ScanEvents under the EVT# key prefix and can do nothing
#   else. It cannot read a scan event, it cannot touch a rollup, it cannot read
#   a blend, and it holds no secret. It is the most exposed function in the
#   system and it is the smallest permission set in this file.
#
#   The rollup consumer can write ROLLUP# and CKPT# items and read the stream.
#   It cannot write an EVT# item, which means a bug in the consumer cannot
#   manufacture scan events, and it cannot re-trigger itself through the data
#   path even if the stream filter were ever removed.
#
# Terraform owns each function's identity, permissions and wiring. The
# application's pipeline owns its code: every function carries ignore_changes
# on filename and source_code_hash, so an apply never reverts a deployed build
# and a deploy never widens a permission.
# ===========================================================================

data "aws_partition" "current" {}
data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  spice_blends_indexes = "${var.table_arns.spice_blends}/index/*"
  recipes_indexes      = "${var.table_arns.recipes}/index/*"
  growers_indexes      = "${var.table_arns.growers}/index/*"

  # STAGE is not a label, it is the switch every development affordance in the
  # application is gated on, and it is read as an exact string.
  #
  # The API accepts local, staging or production and nothing else, and it
  # refuses to start on an unrecognised value. Unset, it falls back to 'local',
  # which is the most permissive value there is: on local the API accepts a
  # symmetric development bearer token and reads secrets from environment
  # variables. Deploying a function with an HTTP invoke path and no STAGE would
  # therefore put the development token path on the public internet, which is
  # why this is computed here rather than left to a tfvars file to remember.
  #
  # 'dev' is deliberately NOT passed through: it is not one of the three values
  # the application recognises, and mapping it to 'staging' is the honest
  # translation. A deployed environment is never 'local'.
  api_stage = var.environment == "prod" ? "production" : "staging"

  common_env = {
    TREVEAN_ENV          = var.environment
    STAGE                = local.api_stage
    TABLE_SPICE_BLENDS   = var.table_names.spice_blends
    TABLE_SCAN_EVENTS    = var.table_names.scan_events
    TABLE_RECIPES        = var.table_names.recipes
    TABLE_GROWERS        = var.table_names.growers
    TABLE_NFC_TAGS       = var.table_names.nfc_tags
    POWERTOOLS_LOG_LEVEL = var.environment == "prod" ? "INFO" : "DEBUG"

    # The Shopify storefront cart permalinks are built against. Empty renders the
    # reorder button disabled and honest rather than pointing it somewhere
    # plausible, which is how it has shipped since 17 September 2026.
    #
    # VERIFIED WORKING on Wednesday 7 October 2026 against the live store: all
    # four tagged blends add the correct variant at the correct price and reach a
    # real checkout. The myshopify host is used rather than the storefront domain
    # because it is permanent, where the primary domain is still moving. See
    # "Decision log", D64.
    SHOPIFY_STORE_DOMAIN = var.shopify_store_domain
  }

  # How a token is verified, on every function that verifies one.
  #
  # The API already prefers JWKS over the symmetric development key whenever a
  # URI is configured, and rolesFrom already reads the cognito:groups claim as
  # well as roles. So pointing it at the pool is configuration and no code, and
  # it closes the symmetric development path by giving the branch above it
  # something to find.
  #
  # AUTH_AUDIENCE is the app client id rather than a name of our choosing,
  # because that is what Cognito puts in an id token's aud claim and what
  # verifyAccessToken checks it against.
  cognito_env = var.enable_http_invoke_path ? {
    AUTH_JWKS_URI = "https://cognito-idp.${data.aws_region.current.name}.amazonaws.com/${aws_cognito_user_pool.admin[0].id}/.well-known/jwks.json"
    AUTH_ISSUER   = "https://cognito-idp.${data.aws_region.current.name}.amazonaws.com/${aws_cognito_user_pool.admin[0].id}"
    AUTH_AUDIENCE = aws_cognito_user_pool_client.admin[0].id
  } : {}

  # What the admin itself needs, on top of the above.
  admin_ui_env = var.enable_http_invoke_path ? {
    COGNITO_USER_POOL_ID = aws_cognito_user_pool.admin[0].id
    COGNITO_CLIENT_ID    = aws_cognito_user_pool_client.admin[0].id
    COGNITO_REGION       = data.aws_region.current.name
    API_BASE_URL         = aws_apigatewayv2_api.admin_api[0].api_endpoint
    SESSION_SECRET_NAME  = "trevean/${var.environment}/admin-jwt-signing-key"
  } : {}

  functions = {
    content_api = {
      description = "Public content reads. Access patterns 1 to 4 and 8. Build and revalidate time only, never on a tap."
      memory      = 512
      timeout     = 10

      environment = {}
    }

    scan_ingest = {
      description = "POST /v1/scan-events. The beacon. One conditional PutItem, zero reads. The only pattern a customer's phone triggers."
      memory      = 256
      timeout     = 5
      environment = {}
    }

    # The admin CMS itself: a Fastify application rendering forms, not an API.
    #
    # A Lambda rather than a container because it is used by a handful of people
    # a few times a day. The publisher earns its always on Fargate task because a
    # render needs minutes of CPU and a writable filesystem; this needs neither,
    # and a second always on task would be a second hundred dollars a month on
    # the bill Trevean keeps after handover.
    #
    # 1024 MB and 29 seconds: cold start reads the frozen OpenAPI document off
    # disk to derive the minimum role for every operation, which is the slowest
    # thing it does and the thing that must not be skipped, because it is what
    # stops the admin and the API disagreeing about who may do what.
    admin_ui = {
      description = "The admin CMS. Server rendered forms, Cognito sign in, session cookie and CSRF. Reads and writes through the admin API rather than touching DynamoDB."
      memory      = 1024
      timeout     = 29

      environment = {
        # Bundled by scripts/package-lambda.mjs into the archive root. Lambda
        # unpacks to /var/task, and without these the admin resolves them
        # relative to its own location and dies at startup with ENOENT.
        // Served at /admin on the apex distribution. The edge strips the prefix
        // before this function sees it, so it must be told what to put back on
        // every link and redirect it emits. See buildApp in src/server.ts.
        ADMIN_BASE_PATH = "/admin"

        CONTRACT_PATH = "/var/task/api/openapi/openapi.yaml"
        CONTENT_DIR   = "/var/task/content"

        # ADMIN_DEV_IDENTITY is deliberately absent and must stay absent. The
        # seeded identity provider carries passwords written in the repository
        # and src/lambda.ts refuses to start if it is set.
      }
    }

    admin_api = {
      description = "The admin CMS API. Role-based, bearer token. Reads and writes editorial content, presigns media uploads, enqueues derivatives, and dispatches the signed revalidation that publishes a page."
      memory      = 1024
      timeout     = 29

      # POST /v1/admin/blends/{slug}/publish is served here, so this is the
      # function that dispatches to the publish pipeline. It signs the body with
      # the revalidation secret and does not wait for the answer: the previous
      # version keeps serving until the new one is ready, which is the whole
      # point of the rendering strategy.
      #
      # With REVALIDATION_WEBHOOK_URL unset the API logs the queued job and
      # dispatches nothing. That is the state the deployed environment has been
      # in since Thursday 27 August 2026 and it is exactly what
      # blend_html_can_be_published = false has been reporting: publish updates
      # a record and stops.
      #
      # The Shopify webhooks (/internal/webhooks/shopify/*) are served here too,
      # because the admin HTTP API's $default route is the API's only public
      # door that takes a POST. Without SHOPIFY_WEBHOOK_SECRET_NAME the API looks
      # for trevean/api/shopify-webhook-secret, which no environment creates, and
      # answers every signed delivery 503 (14 October 2026).
      environment = merge(
        {
          MEDIA_ORIGINALS_BUCKET      = replace(var.media.originals_bucket_arn, "arn:${data.aws_partition.current.partition}:s3:::", "")
          MEDIA_DERIVATIVES_QUEUE     = var.media.derivatives_queue_url
          REVALIDATION_SECRET_NAME    = "trevean/${var.environment}/revalidation-secret"
          SHOPIFY_WEBHOOK_SECRET_NAME = "trevean/${var.environment}/shopify-webhook-secret"
        },
        var.revalidation_webhook_url == null ? {} : { REVALIDATION_WEBHOOK_URL = var.revalidation_webhook_url },
      )
    }

    rollup_consumer = {
      description = "DynamoDB stream consumer. Pre-aggregates a batch in memory, then writes ROLLUP# counters with atomic ADD."
      memory      = 512
      timeout     = 60
      environment = {}
    }

    media_derivatives = {
      description = "Asynchronous derivative generation. Reads an original, writes responsive modern formats. No image is ever optimised on the request path."
      memory      = 3008
      timeout     = 600
      environment = {
        MEDIA_ORIGINALS_BUCKET   = replace(var.media.originals_bucket_arn, "arn:${data.aws_partition.current.partition}:s3:::", "")
        MEDIA_DERIVATIVES_BUCKET = replace(var.media.derivatives_bucket_arn, "arn:${data.aws_partition.current.partition}:s3:::", "")
        SITE_BUCKET              = var.site_bucket_arn == null ? "" : replace(var.site_bucket_arn, "arn:${data.aws_partition.current.partition}:s3:::", "")
      }
    }

    catalog_sync = {
      description = "Shopify Admin API catalog mirror, on a schedule and on product-update webhooks. Keeps Shopify latency outside the 2.0 second budget."
      memory      = 512
      timeout     = 300

      # Read by build/shopify/src/lambda/catalogSyncHandler.ts, added Wednesday
      # 14 October 2026 when the function got real code. The admin domain is
      # SHOPIFY_STORE_DOMAIN from common_env, the permanent myshopify host (D64).
      #
      # The token secret is named by ARN, which Secrets Manager accepts as a
      # SecretId and which is exactly the resource the policy below grants.
      # Empty when the secrets module has no such secret, and the handler then
      # falls back to trevean/{env}/shopify-admin-api-token.
      #
      # Anything but "false" is a dry run: the function reads, plans and logs
      # and writes nothing. The handler defaults to a dry run when this is unset
      # too, so code deployed ahead of this setting cannot write.
      environment = {
        SHOPIFY_ADMIN_TOKEN_SECRET_NAME = lookup(var.secret_arns, "shopify-admin-api-token", "")
        CATALOG_SYNC_DRY_RUN            = var.catalog_sync_dry_run ? "true" : "false"
      }
    }

    shopify_webhook = {
      description = "Inbound Shopify webhooks, signature verified. Product updates and order attribution."
      memory      = 256
      timeout     = 30
      environment = {}
    }

    web_renderer = {
      description = "The publish pipeline's identity: read the content tables, write the site bucket, invalidate exactly the changed paths, read the revalidation secret. Assumed by the Fargate task in modules/publisher, which is where the render actually runs."
      memory      = 1769
      timeout     = 30

      # CLOUDFRONT_DISTRIBUTION_ID is deliberately NOT here. It is set on the
      # separate aws_lambda_function.web_renderer resource below. See the long
      # comment there: this map must not reference var.distribution_id.
      #
      # Everything else the publish pipeline needs is here: which bucket the
      # rendered documents go into, which secret verifies the signed dispatch,
      # and which public base URL the published document is read back through.
      # The read back is the only step that proves anything to an editor, so
      # the pipeline that cannot do it reports "published, not confirmed"
      # rather than reporting success.
      environment = merge(var.render_cache.environment_variables, {
        PUBLISH_TARGET           = "s3"
        SITE_BUCKET              = var.site_bucket_arn == null ? "" : replace(var.site_bucket_arn, "arn:${data.aws_partition.current.partition}:s3:::", "")
        REVALIDATION_SECRET_NAME = "trevean/${var.environment}/revalidation-secret"

        # PUBLISHER_PUBLIC_BASE_URL is deliberately NOT here either. It defaults
        # to the distribution's own hostname, which makes it a second CDN
        # dependent value, and any CDN dependent value in this map is the cycle
        # described beside local.renderer_key. It is set on
        # aws_lambda_function.web_renderer alongside CLOUDFRONT_DISTRIBUTION_ID.
      })
    }
  }

  # ---------------------------------------------------------------------------
  # Why web_renderer is not in the same resource as the other seven
  #
  # Added Thursday 27 August 2026, with the HTTP invoke path. It is a graph
  # constraint, not a preference, and it is written down because the obvious
  # tidy-up is to fold it back and the result is an unresolvable Terraform
  # cycle with a 400 character error message.
  #
  # The chain:
  #
  #   the renderer needs CLOUDFRONT_DISTRIBUTION_ID, so the function resource
  #     reads var.distribution_id
  #   var.distribution_id is an output of the cdn module
  #     so the function resource is downstream of the distribution
  #   the distribution now needs the content and scan function URL hostnames as
  #     origins, and a function URL's hostname is a property of the function
  #     so the distribution is downstream of the function resource
  #
  # With all eight in one for_each that is a cycle, because Terraform builds
  # the graph per RESOURCE and not per instance: aws_lambda_function.function
  # is a single node, so a dependency belonging only to web_renderer is a
  # dependency of all eight, including the two whose URLs the distribution
  # needs. Splitting the one function that reads a CDN value out of the pool
  # cuts the edge exactly where it exists and nowhere else.
  #
  # Everything else stays shared. The role, the policy, the log group and the
  # readiness accounting are all still driven from local.functions, which still
  # has eight entries, so "eight functions, eight roles, nothing shared" is
  # unchanged as a statement about permissions. This is a split in one Terraform
  # resource, not a split in the design.
  #
  # If the renderer ever stops needing the distribution id, for example because
  # invalidation moves behind a queue, fold this back and delete the moved
  # block.
  # ---------------------------------------------------------------------------
  renderer_key = "web_renderer"

  pooled_functions = { for key, fn in local.functions : key => fn if key != local.renderer_key }
}

# ---------------------------------------------------------------------------
# Placeholder package
# ---------------------------------------------------------------------------

data "archive_file" "placeholder" {
  type        = "zip"
  source_file = "${path.module}/placeholder/index.mjs"
  output_path = "${path.module}/.build/placeholder.zip"
}

# ---------------------------------------------------------------------------
# Trust policy, shared. This is the only thing that is shared.
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

# ---------------------------------------------------------------------------
# The renderer's role trusts one more service, and only the renderer's does.
#
# Added Friday 4 September 2026 with the decision about where the render runs.
# The publish pipeline is a container on Fargate rather than a Lambda, because
# a full Next export needs sustained CPU, a writable filesystem and an
# installed dependency tree, and because the service answers 202 and renders
# after the response, which a platform that freezes on return cannot do. The
# argument in full is at the top of modules/publisher/main.tf.
#
# THE PERMISSIONS DID NOT CHANGE AND THAT IS THE POINT. Read the content
# tables, write the site bucket, invalidate the distribution, read the
# revalidation secret. Those were settled before the host was, they are correct
# wherever the renderer runs, and creating a second role for the container
# would have meant two answers to "what is the renderer allowed to do" with the
# wrong one being the one nobody reads.
#
# This document is used for web_renderer and for nothing else. The other seven
# roles are Lambda only and stay Lambda only: widening the shared document
# would have given ecs-tasks.amazonaws.com a path to assume the scan beacon's
# role, which is the smallest permission set in the system and the one most
# worth keeping that way.
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "renderer_assume_role" {
  statement {
    sid     = "LambdaKeptForTheAvoidanceOfADestroyAndRecreate"
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }

  statement {
    sid     = "TheContainerThatActuallyRendersThePages"
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_iam_role" "function" {
  for_each = local.functions

  name                 = "${var.name_prefix}-${replace(each.key, "_", "-")}"
  description          = each.value.description
  assume_role_policy   = each.key == local.renderer_key ? data.aws_iam_policy_document.renderer_assume_role.json : data.aws_iam_policy_document.lambda_assume_role.json
  max_session_duration = 3600
  tags                 = var.tags
}

# Logging, granted per function and scoped to that function's own log group.
# The AWS managed AWSLambdaBasicExecutionRole grants logs:* on *, which is a
# wildcard on the one thing that records what every other function did.
data "aws_iam_policy_document" "logging" {
  for_each = local.functions

  statement {
    sid       = "OwnLogGroupOnly"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.function[each.key].arn}:*"]
  }
}

resource "aws_iam_role_policy" "logging" {
  for_each = local.functions

  name   = "logging"
  role   = aws_iam_role.function[each.key].id
  policy = data.aws_iam_policy_document.logging[each.key].json
}

resource "aws_cloudwatch_log_group" "function" {
  for_each = local.functions

  name              = "/aws/lambda/${var.name_prefix}-${replace(each.key, "_", "-")}"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.kms_key_arn
  tags              = var.tags
}

# ---------------------------------------------------------------------------
# content_api: read only, and only the tables it reads
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "content_api" {
  statement {
    sid    = "ReadContentTables"
    effect = "Allow"

    actions = [
      "dynamodb:GetItem",
      "dynamodb:BatchGetItem",
      "dynamodb:Query",
    ]

    resources = [
      var.table_arns.spice_blends,
      local.spice_blends_indexes,
      var.table_arns.recipes,
      local.recipes_indexes,
      var.table_arns.growers,
      local.growers_indexes,
    ]
  }

  # No dynamodb:Scan anywhere in this file, on any role. A Scan in this
  # codebase is a defect regardless of current table size, and the cheapest
  # place to make that true is the permission rather than the code review.

  # The content tables are encrypted with the environment key, so the DynamoDB
  # grant above is not sufficient on its own: without this the table permits the
  # read and KMS refuses the decrypt, which surfaces as a 500 rather than a 403
  # and is invisible to terraform plan. Decrypt only, because this role reads.
  dynamic "statement" {
    for_each = var.kms_key_arn != null ? [1] : []

    content {
      sid       = "UseEnvironmentKey"
      effect    = "Allow"
      actions   = ["kms:Decrypt"]
      resources = [var.kms_key_arn]
    }
  }
}

resource "aws_iam_role_policy" "content_api" {
  name   = "content-api"
  role   = aws_iam_role.function["content_api"].id
  policy = data.aws_iam_policy_document.content_api.json
}

# ---------------------------------------------------------------------------
# scan_ingest: one write, one key prefix, nothing else
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "scan_ingest" {
  statement {
    sid       = "WriteRawScanEventsOnly"
    effect    = "Allow"
    actions   = ["dynamodb:PutItem"]
    resources = [var.table_arns.scan_events]

    # The condition is what makes "raw events only" true in the permission
    # rather than in the code. A bug in this function cannot write a rollup and
    # cannot manufacture a counter.
    condition {
      test     = "ForAllValues:StringLike"
      variable = "dynamodb:LeadingKeys"
      values   = ["EVT#*"]
    }
  }

  # ScanEvents is encrypted with the environment key. A write needs
  # GenerateDataKey as well as Decrypt, and without both the beacon returns a
  # 500 with a KMS AccessDeniedException behind it while the table permission
  # above looks correct. Caught by the first real beacon, not by plan.
  dynamic "statement" {
    for_each = var.kms_key_arn != null ? [1] : []

    content {
      sid       = "UseEnvironmentKey"
      effect    = "Allow"
      actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
      resources = [var.kms_key_arn]
    }
  }
}

resource "aws_iam_role_policy" "scan_ingest" {
  name   = "scan-ingest"
  role   = aws_iam_role.function["scan_ingest"].id
  policy = data.aws_iam_policy_document.scan_ingest.json
}

# ---------------------------------------------------------------------------
# admin_api
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# The managed identity provider.
#
# The frozen API contract, section 5.3, says roles come from a managed identity
# provider. Until Tuesday 8 September 2026 there was none, and the admin fell
# back to a seeded user store whose three passwords are written in
# build/admin/src/auth/users.ts. That store is now refused unless
# ADMIN_DEV_IDENTITY is set, which no deployment sets, so this pool is what the
# deployed admin authenticates against.
#
# GROUP NAMES ARE MATCHED LITERALLY by roleFromGroups in the admin's
# auth/identity.ts and by rolesFrom in the API's auth/jwt.ts, which reads the
# cognito:groups claim. Renaming a group here silently removes everybody in it
# from their role, so the names are Admin, Editor and Viewer exactly.
#
# NO CLIENT SECRET. The admin calls AdminInitiateAuth with the function's IAM
# credentials, so a secret would be a second credential to store and rotate for
# no additional security.
# ---------------------------------------------------------------------------

resource "aws_cognito_user_pool" "admin" {
  count = var.enable_http_invoke_path ? 1 : 0

  name = "${var.name_prefix}-admin"

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 3
  }

  # The admin can publish to 1,000 encoded jars, so account recovery is by email
  # rather than by anything a support call could be talked into.
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  username_attributes = ["email"]
  tags                = var.tags
}

resource "aws_cognito_user_pool_client" "admin" {
  count = var.enable_http_invoke_path ? 1 : 0

  name         = "${var.name_prefix}-admin"
  user_pool_id = aws_cognito_user_pool.admin[0].id

  # ADMIN_USER_PASSWORD_AUTH, because the admin presents the form and calls
  # Cognito server side. The browser never talks to Cognito directly, so the
  # SRP flows buy nothing here and would need client side JavaScript this
  # application deliberately does not have.
  explicit_auth_flows = ["ALLOW_ADMIN_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]

  generate_secret = false

  # An hour, because the id token rides in the admin's session cookie and the
  # session itself is eight hours. A token outliving its usefulness in a cookie
  # is the thing to avoid.
  id_token_validity     = 60
  access_token_validity = 60
  token_validity_units {
    id_token     = "minutes"
    access_token = "minutes"
  }
}

resource "aws_cognito_user_group" "admin_roles" {
  for_each = var.enable_http_invoke_path ? toset(["Admin", "Editor", "Viewer"]) : toset([])

  name         = each.key
  user_pool_id = aws_cognito_user_pool.admin[0].id
  description  = "Maps to the ${each.key} role in the admin and in the API's cognito:groups claim."
}

data "aws_iam_policy_document" "admin_api" {
  statement {
    sid    = "ReadWriteEditorialContent"
    effect = "Allow"

    actions = [
      "dynamodb:GetItem",
      "dynamodb:BatchGetItem",
      "dynamodb:Query",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
    ]

    resources = [
      var.table_arns.spice_blends,
      local.spice_blends_indexes,
      var.table_arns.recipes,
      local.recipes_indexes,
      var.table_arns.growers,
      local.growers_indexes,
    ]
  }

  # NFCTags is a mirror of the version-controlled redirect table, so the admin
  # reads it and never writes it. Making that a permission rather than a
  # convention is what stops the redirect table becoming hand-edited state in a
  # console, which the Data model document, section 7.1, forbids and which is
  # the failure that strands inventory.
  statement {
    sid       = "ReadTagMirrorNeverWriteIt"
    effect    = "Allow"
    actions   = ["dynamodb:GetItem", "dynamodb:Query"]
    resources = [var.table_arns.nfc_tags]
  }

  # The dashboard reads pre-aggregated rollups and never raw events.
  statement {
    sid       = "ReadRollupsOnly"
    effect    = "Allow"
    actions   = ["dynamodb:Query", "dynamodb:GetItem"]
    resources = [var.table_arns.scan_events]

    condition {
      test     = "ForAllValues:StringLike"
      variable = "dynamodb:LeadingKeys"
      values   = ["ROLLUP#*"]
    }
  }

  # orders/create attribution (build/api routes/webhooks.ts). ADD on the daily
  # order counters only: the per blend and all blends DAY rows. Not the hourly
  # or GEO rows, not EVT# raw events, not the stream consumer's checkpoints.
  # The five contract slugs are listed rather than matched with
  # ROLLUP#BLEND#*#DAY, because * also spans # and would admit the
  # ROLLUP#BLEND#{slug}#GEO#DAY rows.
  statement {
    sid       = "CountWebhookOrdersOnDailyRollups"
    effect    = "Allow"
    actions   = ["dynamodb:UpdateItem"]
    resources = [var.table_arns.scan_events]

    condition {
      test     = "ForAllValues:StringEquals"
      variable = "dynamodb:LeadingKeys"
      values = [
        "ROLLUP#ALL#DAY",
        "ROLLUP#BLEND#persian-sunrise#DAY",
        "ROLLUP#BLEND#caribbean-sunset#DAY",
        "ROLLUP#BLEND#north-african-night-market#DAY",
        "ROLLUP#BLEND#silk-road#DAY",
        "ROLLUP#BLEND#kyoto-garden#DAY",
      ]
    }
  }

  # The per delivery claim that makes those ADDs count once: a conditional put
  # keyed on X-Shopify-Webhook-Id, deleted again only when its ADD failed so
  # Shopify's retry can count it. Its own CKPT# prefix, so this cannot touch
  # the rollup consumer's batch checkpoints.
  statement {
    sid       = "ClaimWebhookOrderDeliveries"
    effect    = "Allow"
    actions   = ["dynamodb:PutItem", "dynamodb:DeleteItem"]
    resources = [var.table_arns.scan_events]

    condition {
      test     = "ForAllValues:StringLike"
      variable = "dynamodb:LeadingKeys"
      values   = ["CKPT#shopify-orders-create#*"]
    }
  }

  statement {
    sid       = "PresignMediaUploads"
    effect    = "Allow"
    actions   = ["s3:PutObject", "s3:GetObject", "s3:AbortMultipartUpload"]
    resources = ["${var.media.originals_bucket_arn}/*"]
  }

  statement {
    sid       = "EnqueueDerivativeGeneration"
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [var.media.derivatives_queue_arn]
  }

  dynamic "statement" {
    for_each = contains(keys(var.secret_arns), "admin-jwt-signing-key") ? [1] : []

    content {
      sid       = "ReadAdminSigningKey"
      effect    = "Allow"
      actions   = ["secretsmanager:GetSecretValue"]
      resources = [var.secret_arns["admin-jwt-signing-key"]]
    }
  }

  # Signs the revalidation dispatch. The publish pipeline refuses an unsigned
  # job, so without this a publish updates a record and stops, which is the
  # failure this whole change exists to close.
  dynamic "statement" {
    for_each = contains(keys(var.secret_arns), "revalidation-secret") ? [1] : []

    content {
      sid       = "SignTheRevalidationDispatch"
      effect    = "Allow"
      actions   = ["secretsmanager:GetSecretValue"]
      resources = [var.secret_arns["revalidation-secret"]]
    }
  }

  # Verifies every inbound Shopify webhook. Without it the API cannot read the
  # secret and refuses every signed delivery (503, so Shopify retries).
  dynamic "statement" {
    for_each = contains(keys(var.secret_arns), "shopify-webhook-secret") ? [1] : []

    content {
      sid       = "VerifyShopifyWebhooks"
      effect    = "Allow"
      actions   = ["secretsmanager:GetSecretValue"]
      resources = [var.secret_arns["shopify-webhook-secret"]]
    }
  }

  dynamic "statement" {
    for_each = var.distribution_arn != null ? [1] : []

    content {
      sid       = "InvalidateOnPublish"
      effect    = "Allow"
      actions   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"]
      resources = [var.distribution_arn]
    }
  }

  dynamic "statement" {
    for_each = var.kms_key_arn != null ? [1] : []

    content {
      sid       = "UseEnvironmentKey"
      effect    = "Allow"
      actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
      resources = [var.kms_key_arn]
    }
  }
}

resource "aws_iam_role_policy" "admin_api" {
  name   = "admin-api"
  role   = aws_iam_role.function["admin_api"].id
  policy = data.aws_iam_policy_document.admin_api.json
}

# ---------------------------------------------------------------------------
# rollup_consumer
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "rollup_consumer" {
  statement {
    sid    = "ReadTheStream"
    effect = "Allow"

    actions = [
      "dynamodb:DescribeStream",
      "dynamodb:GetRecords",
      "dynamodb:GetShardIterator",
      "dynamodb:ListStreams",
    ]

    resources = [var.scan_events_stream_arn]
  }

  # ROLLUP# for the counters, CKPT# for the batch checkpoint that makes a
  # re-delivered batch skippable. ADD is not idempotent and stream delivery is
  # at-least-once, so the checkpoint is not optional.
  #
  # EVT# is absent from this list on purpose. A bug here cannot manufacture
  # scan events, and the consumer cannot re-trigger itself through the data
  # path even if the stream filter were ever removed.
  statement {
    sid       = "WriteRollupsAndCheckpoints"
    effect    = "Allow"
    actions   = ["dynamodb:UpdateItem", "dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:Query"]
    resources = [var.table_arns.scan_events]

    condition {
      test     = "ForAllValues:StringLike"
      variable = "dynamodb:LeadingKeys"
      values   = ["ROLLUP#*", "CKPT#*"]
    }
  }

  statement {
    sid       = "DeadLetter"
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.rollup_dlq.arn]
  }

  dynamic "statement" {
    for_each = var.kms_key_arn != null ? [1] : []

    content {
      sid       = "UseEnvironmentKey"
      effect    = "Allow"
      actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
      resources = [var.kms_key_arn]
    }
  }
}

resource "aws_iam_role_policy" "rollup_consumer" {
  name   = "rollup-consumer"
  role   = aws_iam_role.function["rollup_consumer"].id
  policy = data.aws_iam_policy_document.rollup_consumer.json
}

# ---------------------------------------------------------------------------
# media_derivatives
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "media_derivatives" {
  statement {
    sid       = "ReadOriginals"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${var.media.originals_bucket_arn}/*"]
  }

  statement {
    sid       = "WriteDerivatives"
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["${var.media.derivatives_bucket_arn}/*"]
  }

  # Tap-path derivatives are published into the AWS origin bucket under
  # images/, so the hero stays same origin as /blend.html. See the note in the
  # cdn module. Scoped to that prefix and nothing else.
  dynamic "statement" {
    for_each = var.site_bucket_arn != null ? [1] : []

    content {
      sid       = "PublishTapPathDerivativesSameOrigin"
      effect    = "Allow"
      actions   = ["s3:PutObject"]
      resources = ["${var.site_bucket_arn}/images/*"]
    }
  }

  statement {
    sid       = "ConsumeDerivativeQueue"
    effect    = "Allow"
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    resources = [var.media.derivatives_queue_arn]
  }

  # Where the media record lives is NOT specified in the frozen data model,
  # which defines the five tables and their key namespaces and says nothing
  # about media state. MEDIA# inside SpiceBlends is the shape that follows the
  # same namespacing convention as CATALOG#, and it is scoped here so that even
  # if the audit puts it somewhere else, this function never had permission to
  # touch a blend or a catalog item.
  #
  # TO CONFIRM IN AUDIT (Q15): whether a media record already exists and where.
  statement {
    sid       = "RecordMediaState"
    effect    = "Allow"
    actions   = ["dynamodb:UpdateItem", "dynamodb:GetItem"]
    resources = [var.table_arns.spice_blends]

    condition {
      test     = "ForAllValues:StringLike"
      variable = "dynamodb:LeadingKeys"
      values   = ["MEDIA#*"]
    }
  }

  dynamic "statement" {
    for_each = var.kms_key_arn != null ? [1] : []

    content {
      sid       = "UseEnvironmentKey"
      effect    = "Allow"
      actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
      resources = [var.kms_key_arn]
    }
  }
}

resource "aws_iam_role_policy" "media_derivatives" {
  name   = "media-derivatives"
  role   = aws_iam_role.function["media_derivatives"].id
  policy = data.aws_iam_policy_document.media_derivatives.json
}

# ---------------------------------------------------------------------------
# catalog_sync
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "catalog_sync" {
  # The catalog mirror is a separate item under CATALOG#, deliberately, so a
  # sync can never overwrite an editor's work and a sync failure can never mark
  # a blend dirty. The condition below is that separation expressed as a
  # permission rather than a convention.
  statement {
    sid       = "WriteCatalogMirrorOnly"
    effect    = "Allow"
    actions   = ["dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:GetItem"]
    resources = [var.table_arns.spice_blends]

    condition {
      test     = "ForAllValues:StringLike"
      variable = "dynamodb:LeadingKeys"
      values   = ["CATALOG#*"]
    }
  }

  dynamic "statement" {
    for_each = length(setintersection(toset(keys(var.secret_arns)), toset(["shopify-admin-api-token"]))) > 0 ? [1] : []

    content {
      sid       = "ReadShopifyAdminToken"
      effect    = "Allow"
      actions   = ["secretsmanager:GetSecretValue"]
      resources = [var.secret_arns["shopify-admin-api-token"]]
    }
  }

  statement {
    sid       = "ReadStoreConfiguration"
    effect    = "Allow"
    actions   = ["ssm:GetParameter"]
    resources = ["arn:${data.aws_partition.current.partition}:ssm:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:parameter/trevean/${var.environment}/*"]
  }

  dynamic "statement" {
    for_each = var.kms_key_arn != null ? [1] : []

    content {
      sid       = "UseEnvironmentKey"
      effect    = "Allow"
      actions   = ["kms:Decrypt"]
      resources = [var.kms_key_arn]
    }
  }
}

resource "aws_iam_role_policy" "catalog_sync" {
  name   = "catalog-sync"
  role   = aws_iam_role.function["catalog_sync"].id
  policy = data.aws_iam_policy_document.catalog_sync.json
}

# The schedule. Absent until catalog_sync_schedule_expression is set, which is
# deliberately a separate step from deploying the code: the first run against
# the live store is a dry run invoked by hand and read by a person, and only
# then does anything run on its own. See build/shopify/CATALOG-SYNC-DEPLOY.md.
#
# Unqualified function ARN, so the schedule runs whatever code was last
# deployed. A failed run throws, and Lambda's asynchronous retry runs it again;
# a run is idempotent, so a retry costs Admin API points and nothing else.
resource "aws_cloudwatch_event_rule" "catalog_sync" {
  count = var.catalog_sync_schedule_expression == null ? 0 : 1

  name                = "${var.name_prefix}-catalog-sync"
  description         = "Runs the Shopify catalog mirror sync."
  schedule_expression = var.catalog_sync_schedule_expression
  tags                = var.tags
}

resource "aws_cloudwatch_event_target" "catalog_sync" {
  count = var.catalog_sync_schedule_expression == null ? 0 : 1

  rule      = aws_cloudwatch_event_rule.catalog_sync[0].name
  target_id = "catalog-sync"
  arn       = aws_lambda_function.function["catalog_sync"].arn
  input     = jsonencode({ source = "schedule" })
}

resource "aws_lambda_permission" "catalog_sync_schedule" {
  count = var.catalog_sync_schedule_expression == null ? 0 : 1

  statement_id  = "AllowTheCatalogSyncScheduleToInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.function["catalog_sync"].function_name
  principal     = "events.amazonaws.com"

  # Scoped to this one rule, not to the service.
  source_arn = aws_cloudwatch_event_rule.catalog_sync[0].arn
}

# ---------------------------------------------------------------------------
# shopify_webhook
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "shopify_webhook" {
  statement {
    sid       = "WriteCatalogMirrorOnly"
    effect    = "Allow"
    actions   = ["dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:GetItem"]
    resources = [var.table_arns.spice_blends]

    condition {
      test     = "ForAllValues:StringLike"
      variable = "dynamodb:LeadingKeys"
      values   = ["CATALOG#*", "ORDER#*"]
    }
  }

  dynamic "statement" {
    for_each = contains(keys(var.secret_arns), "shopify-webhook-secret") ? [1] : []

    content {
      sid       = "ReadWebhookSigningSecret"
      effect    = "Allow"
      actions   = ["secretsmanager:GetSecretValue"]
      resources = [var.secret_arns["shopify-webhook-secret"]]
    }
  }

  dynamic "statement" {
    for_each = var.kms_key_arn != null ? [1] : []

    content {
      sid       = "UseEnvironmentKey"
      effect    = "Allow"
      actions   = ["kms:Decrypt"]
      resources = [var.kms_key_arn]
    }
  }
}

resource "aws_iam_role_policy" "shopify_webhook" {
  name   = "shopify-webhook"
  role   = aws_iam_role.function["shopify_webhook"].id
  policy = data.aws_iam_policy_document.shopify_webhook.json
}

# ---------------------------------------------------------------------------
# web_renderer
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "web_renderer" {
  statement {
    sid    = "ReadContentForBuildAndRevalidate"
    effect = "Allow"

    actions = [
      "dynamodb:GetItem",
      "dynamodb:BatchGetItem",
      "dynamodb:Query",
    ]

    resources = [
      var.table_arns.spice_blends,
      local.spice_blends_indexes,
      var.table_arns.recipes,
      local.recipes_indexes,
      var.table_arns.growers,
      local.growers_indexes,
    ]
  }

  # The externalised render cache. Shared object storage plus a shared index,
  # which is what stops every concurrent instance keeping its own copy and a
  # cold instance starting empty.
  statement {
    sid       = "SharedRenderCacheStorage"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
    resources = [var.render_cache.bucket_arn, "${var.render_cache.bucket_arn}/*"]
  }

  statement {
    sid       = "SharedRenderCacheIndex"
    effect    = "Allow"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query"]
    resources = [var.render_cache.index_table_arn]
  }

  # ---------------------------------------------------------------------------
  # THE PERMISSION THAT WAS MISSING, AND IT IS WHY blend_html_can_be_published
  # READ false.
  #
  # Nothing in this package could write an object into the site bucket. The
  # pages currently in it were put there by hand with `aws s3 sync` under a
  # human's credentials, which is not a publish path: it cannot apply the
  # placeholder guard, it cannot tell a document from an asset when it sets
  # Cache-Control, and it cannot invalidate the CDN at all.
  #
  # GetObject and ListBucket are here as well as PutObject, and neither is
  # padding. The pipeline reads the published manifest back to work out which
  # objects actually changed, and publishing only what changed is what keeps the
  # invalidation to exactly the affected paths instead of the whole
  # distribution.
  #
  # DeleteObject is deliberately NOT granted. Nothing in a publish deletes a
  # customer facing document, and a pipeline that can delete one can empty the
  # origin that 1,000 encoded jars resolve to. Removing a stale object is a
  # deliberate operator action under a different principal.
  # ---------------------------------------------------------------------------
  dynamic "statement" {
    for_each = var.site_bucket_arn != null ? [1] : []

    content {
      sid       = "PublishRenderedDocumentsToTheOrigin"
      effect    = "Allow"
      actions   = ["s3:PutObject", "s3:GetObject", "s3:ListBucket"]
      resources = [var.site_bucket_arn, "${var.site_bucket_arn}/*"]
    }
  }

  # The dispatch from the API is HMAC signed and this is the half that verifies
  # it. Without the secret the pipeline refuses every job rather than accepting
  # an unsigned one, so this grant is what stands between a working publish and
  # a publish that fails closed.
  dynamic "statement" {
    for_each = contains(keys(var.secret_arns), "revalidation-secret") ? [1] : []

    content {
      sid       = "VerifyTheSignedRevalidationDispatch"
      effect    = "Allow"
      actions   = ["secretsmanager:GetSecretValue"]
      resources = [var.secret_arns["revalidation-secret"]]
    }
  }

  dynamic "statement" {
    for_each = var.distribution_arn != null ? [1] : []

    content {
      sid       = "InvalidateOnRevalidate"
      effect    = "Allow"
      actions   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"]
      resources = [var.distribution_arn]
    }
  }

  dynamic "statement" {
    for_each = var.kms_key_arn != null ? [1] : []

    content {
      sid       = "UseEnvironmentKey"
      effect    = "Allow"
      actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
      resources = [var.kms_key_arn]
    }
  }
}

resource "aws_iam_role_policy" "web_renderer" {
  name   = "web-renderer"
  role   = aws_iam_role.function["web_renderer"].id
  policy = data.aws_iam_policy_document.web_renderer.json
}

# ---------------------------------------------------------------------------
# The functions
# ---------------------------------------------------------------------------

resource "aws_lambda_function" "function" {
  for_each = local.pooled_functions

  function_name = "${var.name_prefix}-${replace(each.key, "_", "-")}"
  description   = each.value.description
  role          = aws_iam_role.function[each.key].arn

  # One bundle, two entry points. index.mjs in the archive root exports both, and
  # the rollup consumer is the one that is not an HTTP application: it is handed
  # DynamoDB stream records, not a request.
  #
  # This said index.handler for every function until Friday 11 September 2026,
  # which would have pointed the stream at the Fastify app. Nothing caught it
  # because the function has carried the inert placeholder since it was created,
  # and a placeholder answers the same way whatever the handler is named. It would
  # have surfaced as the first batch of scan events failing on a function that had
  # just been given real code.
  handler       = each.key == "rollup_consumer" ? "index.streamHandler" : "index.handler"
  runtime       = "nodejs22.x"
  architectures = ["arm64"]
  memory_size   = each.value.memory
  timeout       = each.value.timeout
  publish       = true

  filename = lookup(var.function_packages, each.key, data.archive_file.placeholder.output_path)

  source_code_hash = contains(keys(var.function_packages), each.key) ? filebase64sha256(var.function_packages[each.key]) : data.archive_file.placeholder.output_base64sha256

  environment {
    variables = merge(
      local.common_env,
      local.cognito_env,
      each.key == "admin_ui" ? local.admin_ui_env : {},
      each.value.environment,
      { TREVEAN_FUNCTION_ROLE = each.key },
    )
  }

  # PassThrough, not Active, and the choice is deliberate.
  #
  # Active samples traces and sends segments to X-Ray, which needs
  # xray:PutTraceSegments and xray:PutTelemetryRecords on the execution role.
  # No role in this module has them, and none of the eight functions has real
  # code in it yet. Active with no permission is the worst of the three
  # available states: the segments are dropped silently, the console shows an
  # empty service map that looks like a healthy idle system, and the sampled
  # request charge is incurred for a capability that does not exist.
  #
  # Turning it off is one line. Granting it is eight policy statements for a
  # capability nobody has asked for and nothing currently produces, so the
  # smaller change wins. PassThrough keeps an inbound trace header propagating
  # if something upstream ever starts one.
  #
  # If tracing is wanted later, it is two changes and not one: this mode AND
  # the two xray actions on every role that needs it.
  tracing_config {
    mode = "PassThrough"
  }

  tags = var.tags

  depends_on = [
    aws_iam_role_policy.logging,
    aws_cloudwatch_log_group.function,
  ]

  # Terraform owns identity, permissions and wiring. The application pipeline
  # owns code. Without this, every terraform apply would roll production back
  # to whatever package was on the machine that ran it.
  lifecycle {
    ignore_changes = [filename, source_code_hash, layers]
  }
}

# ---------------------------------------------------------------------------
# The renderer, identical to the seven above except for one environment
# variable. See "Why web_renderer is not in the same resource as the other
# seven" in the locals block at the top of this file before folding it back.
#
# The moved block is what makes this a refactor rather than a replacement.
# Without it Terraform destroys the deployed function and creates a new one,
# which drops whatever package the application pipeline last deployed to it.
#
# ---------------------------------------------------------------------------
# AND WHY IT NOW HAS A COUNT, added Friday 4 September 2026.
#
# THIS FUNCTION IS NOT WHERE THE RENDER RUNS AND IT NEVER WAS ABLE TO BE. It is
# 30 seconds and 1769 MB; the render is a full Next export measured at 165 to
# 340 seconds depending on how many CPUs it gets, and it needs a writable
# filesystem and an installed dependency tree. The host decision is taken and
# it is a container: see modules/publisher/main.tf, "WHERE THE RENDERER RUNS".
#
# So with create_renderer_lambda false this function is destroyed, and it
# should be. Keeping an inert placeholder called web-renderer that will never
# receive a package would mean two things that are both wrong: a resource whose
# name describes work it does not do, and
# readiness.application_code_deployed permanently false because one of the
# eight functions can never have code. THE ROLE STAYS. The container assumes
# it, which is why the trust policy above gained ecs-tasks.amazonaws.com and
# why the eight roles are still eight.
#
# The second moved block is the count being added. Without it Terraform sees
# aws_lambda_function.web_renderer and aws_lambda_function.web_renderer[0] as
# unrelated and plans a destroy and a create, which on an environment where
# the two exist at once would briefly leave the name unavailable.
#
# EXPECT THE dev PLAN TO SHOW A DESTROY HERE, plus the two CloudWatch alarms
# and the log group that key off it. That is the intended change and not a
# surprise. Anything else, stop and read it.
# ---------------------------------------------------------------------------

moved {
  from = aws_lambda_function.function["web_renderer"]
  to   = aws_lambda_function.web_renderer
}

moved {
  from = aws_lambda_function.web_renderer
  to   = aws_lambda_function.web_renderer[0]
}

resource "aws_lambda_function" "web_renderer" {
  count = var.create_renderer_lambda ? 1 : 0

  function_name = "${var.name_prefix}-${replace(local.renderer_key, "_", "-")}"
  description   = local.functions[local.renderer_key].description
  role          = aws_iam_role.function[local.renderer_key].arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  architectures = ["arm64"]
  memory_size   = local.functions[local.renderer_key].memory
  timeout       = local.functions[local.renderer_key].timeout
  publish       = true

  filename = lookup(var.function_packages, local.renderer_key, data.archive_file.placeholder.output_path)

  source_code_hash = contains(keys(var.function_packages), local.renderer_key) ? filebase64sha256(var.function_packages[local.renderer_key]) : data.archive_file.placeholder.output_base64sha256

  environment {
    variables = merge(
      local.common_env,
      local.functions[local.renderer_key].environment,
      # THE ONE LINE THAT FORCED THE SPLIT, and now there are two of them.
      { CLOUDFRONT_DISTRIBUTION_ID = coalesce(var.distribution_id, "") },

      # Where a published document is read back from to confirm the change is
      # live. The distribution's own hostname by default, because that is the
      # host a tap reads, and a confirmation taken from anywhere else confirms
      # something a customer does not experience. Empty means the pipeline
      # publishes, invalidates, and then reports "published, not confirmed"
      # rather than claiming success.
      {
        PUBLISHER_PUBLIC_BASE_URL = coalesce(
          var.publisher_public_base_url,
          var.distribution_domain_name == null ? "" : "https://${var.distribution_domain_name}",
        )
      },

      { TREVEAN_FUNCTION_ROLE = local.renderer_key },
    )
  }

  tracing_config {
    mode = "PassThrough"
  }

  tags = var.tags

  depends_on = [
    aws_iam_role_policy.logging,
    aws_cloudwatch_log_group.function,
  ]

  lifecycle {
    ignore_changes = [filename, source_code_hash, layers]
  }
}

# Every function, back in one map, for the accounting below and for the
# outputs. Kept out of the locals block at the top of the file on purpose:
# local.functions is an input to the resources and this is derived FROM them,
# and putting the two next to each other is how somebody reintroduces the
# cycle.
locals {
  all_functions = merge(
    aws_lambda_function.function,
    { for fn in aws_lambda_function.web_renderer : local.renderer_key => fn },
  )
}

# ===========================================================================
# The HTTP invoke path
#
# Added Thursday 27 August 2026. It closes gap 1 in this package's README,
# "The two gaps that stop this serving traffic", which had been true since the
# package was written: no function had an HTTP front door of any kind, so
# POST /v1/scan-events, the one request a customer's phone triggers, had
# nowhere to arrive.
#
# THE CHOICE: A LAMBDA FUNCTION URL, NOT API GATEWAY. The reasoning, weighed
# against the things that actually constrain this system rather than against
# general practice.
#
#   1. The tap path rules decide nothing here, and that is the first thing to
#      notice. The Architecture document, "The tap path", rule 1, keeps origin
#      compute and database reads off steps 5 and 6, and rule 3 says nothing
#      that measures the tap may delay the tap. Neither the 307 nor the page
#      touches this front door: the redirect is a CloudFront Function at the
#      edge and the page is a pre-rendered object. The only thing behind this
#      door on a tap is the beacon, and it fires after paint. So latency and
#      cold starts here are a quality-of-service question, not an acceptance
#      criterion, and the front door does not need to be chosen for speed.
#
#   2. The beacon has to be callable by navigator.sendBeacon with no credential
#      and no custom header. sendBeacon cannot set headers, cannot carry an
#      Authorization header, and must not trigger a CORS preflight, because a
#      preflight on the tap path is a second round trip for a measurement.
#      BOTH options satisfy this identically, and neither is what solves it:
#      what solves it is that /v1/* is served from the SAME distribution and
#      therefore the SAME origin as the blend page, so the request is same
#      origin and there is no CORS at all. That is a CloudFront behaviour
#      decision, and it is made in modules/cdn/main.tf. It is worth stating
#      because "the beacon needs API Gateway for CORS" is the reflex, and here
#      it is the wrong reflex: adding CORS configuration would be adding
#      configuration for a cross origin problem this design does not have.
#
#   3. Cost. An HTTP API is $1.00 per million requests on top of the Lambda
#      charge. A function URL adds nothing to the Lambda charge. At this
#      product's volume, 1,000 encoded jars, that difference is cents a year
#      and it is not the deciding factor. It is recorded so nobody reopens the
#      decision believing it was made on price.
#
#   4. Surface, which is what actually decides it. An HTTP API is an api, a
#      stage, an integration, a route, a permission and, done properly, an
#      access log group and a log format: seven resources and a second routing
#      table that has to be kept in step with Fastify's. Its throttling is not
#      load bearing either, because the API contract, section 9, puts rate
#      limiting at the CDN and WAF so that a flood never reaches a function,
#      and its JWT authorizer is not load bearing because admin tokens are
#      verified in process by src/auth/jwt.ts on signature, issuer, audience
#      and expiry. Its custom domain support is not needed because CloudFront
#      already owns the domain. Every feature that would justify the extra
#      surface is already provided somewhere else in this design, so the
#      smaller thing wins: a function URL plus a permission, and the routing
#      stays in the two places it already lives, CloudFront and Fastify.
#
# THE URL IS NOT PUBLIC. authorization_type is AWS_IAM, and the only principal
# permitted to invoke it is cloudfront.amazonaws.com restricted to this
# distribution's ARN. CloudFront signs each origin request with SigV4 through
# an origin access control, exactly as it does for the S3 origin. A function
# URL left on AuthType NONE would be a second, unprotected front door on
# *.lambda-url.amazonaws.com that bypasses the CDN, and with it every rate
# limit the contract places at the edge, on the one endpoint that is
# unauthenticated by necessity. It would also make the geography trust gate
# in services/geo.ts unwinnable, because that gate exists precisely to
# distinguish "arrived through the CDN" from "arrived at the origin".
#
# TWO URLS, NOT ONE, AND THAT IS THE IAM DESIGN RATHER THAN AN OVERSIGHT. The
# whole point of the eight roles above is that scan_ingest can PutItem an EVT#
# item into ScanEvents and can do nothing else, while content_api can read
# three content tables and can write nothing at all. Serving the beacon from
# content_api would mean granting content_api a write on ScanEvents, which
# collapses the two smallest permission sets in the system into one. Both
# functions run the same application package; which routes each can actually
# complete is decided by its role, and which routes each is asked to serve is
# decided by the CloudFront behaviours. Deploying one package to two functions
# costs a duplicated upload. Merging the roles would cost the property.
# ===========================================================================

locals {
  http_invoke_functions = var.enable_http_invoke_path ? ["content_api", "scan_ingest", "admin_ui"] : []
}

resource "aws_lambda_function_url" "api" {
  for_each = toset(local.http_invoke_functions)

  function_name = aws_lambda_function.function[each.key].function_name
  # AWS_IAM for the /v1 functions, NONE for the admin, and the difference is not
  # a relaxation.
  #
  # An origin access control signs the origin request with SigV4 but DOES NOT
  # SIGN THE BODY. Lambda refuses unsigned payloads, so any POST carrying a body
  # needs x-amz-content-sha256 computed by the caller. The scan beacon can do
  # that because the caller is our own JavaScript. The admin cannot: its caller
  # is a browser submitting an HTML form, and a form cannot add a header.
  #
  # So for the admin the access control is not a boundary that can hold. What
  # holds instead is the application: every route requires a Cognito backed
  # session cookie, every write requires a CSRF token, and an anonymous request
  # can reach nothing but the sign in form. The /v1 functions keep AWS_IAM,
  # because there the access control IS the boundary and the only body posted is
  # the beacon's, which carries the hash.
  authorization_type = each.key == "admin_ui" ? "NONE" : "AWS_IAM"

  # BUFFERED, not RESPONSE_STREAM. Every response this API produces is a small
  # JSON document or an empty 202, and response streaming is incompatible with
  # CloudFront caching the content reads, which is the point of putting them
  # behind the CDN at all.
  invoke_mode = "BUFFERED"
}

resource "aws_lambda_permission" "cloudfront_invoke_function_url" {
  for_each = toset(local.http_invoke_functions)

  statement_id  = "AllowCloudFrontDistributionInvokeFunctionUrl"
  action        = "lambda:InvokeFunctionUrl"
  function_name = aws_lambda_function.function[each.key].function_name
  principal     = "cloudfront.amazonaws.com"

  # Scoped to this distribution, not to the service. Without source_arn any
  # CloudFront distribution in any AWS account could invoke this function.
  source_arn = var.distribution_arn

  function_url_auth_type = "AWS_IAM"

  lifecycle {
    precondition {
      condition     = var.distribution_arn != null
      error_message = "enable_http_invoke_path is true but no distribution_arn was supplied. The permission would then have to be granted to the CloudFront service principal unscoped, which lets any distribution in any account invoke this function. Refused."
    }
  }
}

# The second half of the same grant, and it is not optional. An origin access
# control against a function URL needs lambda:InvokeFunction as well as
# lambda:InvokeFunctionUrl, which the CloudFront documentation gives as two
# separate add-permission calls. With only the InvokeFunctionUrl half in place
# every signed request from the distribution comes back 403 with the generic
# function URL authorization message, which reads exactly like a signing fault
# and sends you looking at the OAC, the headers and the cache policy instead of
# at the policy that is actually short one action. Cost half an afternoon.
resource "aws_lambda_permission" "cloudfront_invoke_function" {
  for_each = toset(local.http_invoke_functions)

  statement_id  = "AllowCloudFrontDistributionInvokeFunction"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.function[each.key].function_name
  principal     = "cloudfront.amazonaws.com"
  source_arn    = var.distribution_arn
}

# ---------------------------------------------------------------------------
# What is actually running, as opposed to what a tfvars file claims
#
# `using_placeholder_packages` used to be derived from the keys of
# var.function_packages, which made it a fact about a variable rather than a
# fact about the environment. That was wrong in both directions: every function
# in this module carries ignore_changes on filename and source_code_hash, so
# naming a package in tfvars does NOT deploy it, and a package deployed by the
# application pipeline does NOT appear in tfvars. The output could therefore
# read "code deployed" for eight placeholders, or "placeholder" for eight real
# builds, and be wrong both times.
#
# This data source reads each function's live code_sha256 and compares it to
# the placeholder archive's hash. It cannot be wrong: two functions running the
# same bytes have the same hash, and the placeholder's hash is computed from
# the file next to this one.
# ---------------------------------------------------------------------------

data "aws_lambda_function" "deployed" {
  for_each = local.all_functions

  function_name = each.value.function_name
}

# ---------------------------------------------------------------------------
# Dead letter queue for the rollup consumer
# ---------------------------------------------------------------------------

resource "aws_sqs_queue" "rollup_dlq" {
  name                      = "${var.name_prefix}-rollup-consumer-dlq"
  message_retention_seconds = 1209600
  kms_master_key_id         = var.kms_key_arn
  tags                      = var.tags
}

# ---------------------------------------------------------------------------
# The rollup consumer's event source mapping
#
# READ THE FILTER BEFORE CHANGING ANYTHING HERE.
#
# Rollup writes land in the same DynamoDB stream that triggers them. Without a
# filter this is an infinite loop that will happily bill for itself. The
# document titled "Data model", section 5.1, sets this out in bold and names it
# as the single thing most likely to be dropped when someone re-implements this
# from a summary. So it is spelled out once more:
#
#   eventName = INSERT      an update or a delete can never increment a counter
#   pk begins with EVT#     a ROLLUP# write can never re-trigger the consumer
#
# TTL deletions arrive as REMOVE and are filtered out by the same rule.
#
# bisect_batch_on_function_error is false, per the Data model document, section
# 5.4, guard 3: a batch is never split into a shape the batch checkpoint does
# not recognise. Failures go to the dead letter queue instead, which is why the
# queue above is not optional.
#
# The remaining guard, idempotency, is the consumer's job and not the
# mapping's: ADD is not idempotent and stream delivery is at-least-once, so the
# consumer writes a batch checkpoint item conditionally before the increments.
#
# The residual, stated plainly: a narrow failure window can still over-count by
# at most one batch. That is acceptable because the number is an engagement
# metric, not a financial one, and because raw events are retained so any
# disputed period can be recomputed exactly by a backfill job.
# ---------------------------------------------------------------------------

resource "aws_lambda_event_source_mapping" "rollup_consumer" {
  count = var.enable_rollup_event_source_mapping ? 1 : 0

  event_source_arn  = var.scan_events_stream_arn
  function_name     = aws_lambda_function.function["rollup_consumer"].arn
  starting_position = "LATEST"
  enabled           = true

  batch_size                         = var.rollup_batch_size
  maximum_batching_window_in_seconds = var.rollup_batching_window_seconds
  parallelization_factor             = 1

  bisect_batch_on_function_error = false
  maximum_retry_attempts         = 3
  maximum_record_age_in_seconds  = 3600

  function_response_types = ["ReportBatchItemFailures"]

  filter_criteria {
    filter {
      pattern = jsonencode({
        eventName = ["INSERT"]
        dynamodb = {
          Keys = {
            pk = {
              S = [{ prefix = "EVT#" }]
            }
          }
        }
      })
    }
  }

  destination_config {
    on_failure {
      destination_arn = aws_sqs_queue.rollup_dlq.arn
    }
  }
}

resource "aws_lambda_event_source_mapping" "media_derivatives" {
  count = var.enable_media_event_source_mapping ? 1 : 0

  event_source_arn = var.media.derivatives_queue_arn
  function_name    = aws_lambda_function.function["media_derivatives"].arn
  enabled          = true
  batch_size       = 1
}

# ---------------------------------------------------------------------------
# admin_ui: it reaches Cognito to sign somebody in and reaches nothing else.
#
# No DynamoDB, no S3, no secrets beyond its own session key. Every content read
# and write goes through the admin API over HTTP carrying the caller's own
# token, so a bug here cannot reach the tables directly even if it wanted to.
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "admin_ui" {
  count = var.enable_http_invoke_path ? 1 : 0

  statement {
    sid    = "SignInAgainstTheUserPool"
    effect = "Allow"

    actions = [
      "cognito-idp:AdminInitiateAuth",
      "cognito-idp:AdminListGroupsForUser",
    ]

    resources = [aws_cognito_user_pool.admin[0].arn]
  }
}

resource "aws_iam_role_policy" "admin_ui" {
  count = var.enable_http_invoke_path ? 1 : 0

  name   = "admin-ui"
  role   = aws_iam_role.function["admin_ui"].id
  policy = data.aws_iam_policy_document.admin_ui[0].json
}

# The admin's function URL is authorization_type NONE, so the SigV4 grants above
# no longer match it: their condition requires AWS_IAM. A function URL with no
# authorization still needs a resource policy that permits the call, and that
# policy is necessarily public, because the caller is an unauthenticated browser
# fetching a sign in page.
#
# WHAT STOPS THIS BEING AN OPEN DOOR is the application rather than the
# perimeter: every route requires a Cognito backed session cookie, every write
# requires a CSRF token, and the sign in form is the only thing an anonymous
# request can reach. See the function URL resource above for why the origin
# access control could not be kept here.
resource "aws_lambda_permission" "admin_ui_public_url" {
  count = var.enable_http_invoke_path ? 1 : 0

  statement_id           = "AllowPublicInvokeOfTheAdminFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.function["admin_ui"].function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

# ---------------------------------------------------------------------------
# The admin's front door: an HTTP API rather than a function URL.
#
# WHY, and it is structural rather than a preference. A Lambda function URL has
# exactly two shapes and neither serves an HTML form:
#
#   AWS_IAM behind an origin access control. CloudFront signs the request but
#   DOES NOT SIGN THE BODY, and Lambda refuses unsigned payloads, so every form
#   POST fails signature validation. GET worked; sign in could never work.
#
#   NONE, public. Which returned AccessDeniedException regardless of an auth
#   type of NONE, a resource policy granting Principal "*" on the right ARN with
#   the right condition, an Active function, and no SCP or RCP in the
#   organization. Verified all five on Friday 11 September 2026.
#
# An HTTP API has neither problem: it proxies the body untouched, needs no
# request signing, and CloudFront fronts it as an ordinary custom origin.
# ---------------------------------------------------------------------------

resource "aws_apigatewayv2_api" "admin_ui" {
  count = var.enable_http_invoke_path ? 1 : 0

  name          = "${var.name_prefix}-admin-ui"
  protocol_type = "HTTP"
  description   = "Front door for the admin CMS. Proxies everything to the admin_ui function."
  tags          = var.tags
}

resource "aws_apigatewayv2_integration" "admin_ui" {
  count = var.enable_http_invoke_path ? 1 : 0

  api_id                 = aws_apigatewayv2_api.admin_ui[0].id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.function["admin_ui"].invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 29000
}

resource "aws_apigatewayv2_route" "admin_ui" {
  count = var.enable_http_invoke_path ? 1 : 0

  api_id    = aws_apigatewayv2_api.admin_ui[0].id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.admin_ui[0].id}"
}

resource "aws_apigatewayv2_stage" "admin_ui" {
  count = var.enable_http_invoke_path ? 1 : 0

  api_id      = aws_apigatewayv2_api.admin_ui[0].id
  name        = "$default"
  auto_deploy = true
  tags        = var.tags
}

resource "aws_lambda_permission" "admin_ui_apigw" {
  count = var.enable_http_invoke_path ? 1 : 0

  statement_id  = "AllowTheAdminHttpApiToInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.function["admin_ui"].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.admin_ui[0].execution_arn}/*/*"
}

# ---------------------------------------------------------------------------
# The admin API's front door, and why it is not the apex distribution.
#
# The /v1/* behaviour on the apex distribution targets content_api and allows
# GET, HEAD and OPTIONS only, deliberately: it keeps the admin write surface off
# the public distribution. So admin calls were reaching the read only function
# and failing, which is the behaviour working rather than a bug.
#
# Routing /v1/admin/* through CloudFront instead would reintroduce the body
# signing problem that killed the function URL: an origin access control signs
# the request but not the body, and every admin write posts one.
#
# So the admin talks to its own HTTP API directly. It is server to server
# between two Lambdas in the same account, never touched by a browser, and the
# API still authenticates every call with the caller's Cognito token. The
# public distribution keeps its read only /v1 surface exactly as it was.
# ---------------------------------------------------------------------------

resource "aws_apigatewayv2_api" "admin_api" {
  count = var.enable_http_invoke_path ? 1 : 0

  name          = "${var.name_prefix}-admin-api"
  protocol_type = "HTTP"
  description   = "Front door for the admin API. Reached by the admin CMS only, never by a browser."
  tags          = var.tags
}

resource "aws_apigatewayv2_integration" "admin_api" {
  count = var.enable_http_invoke_path ? 1 : 0

  api_id                 = aws_apigatewayv2_api.admin_api[0].id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.function["admin_api"].invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 29000
}

resource "aws_apigatewayv2_route" "admin_api" {
  count = var.enable_http_invoke_path ? 1 : 0

  api_id    = aws_apigatewayv2_api.admin_api[0].id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.admin_api[0].id}"
}

resource "aws_apigatewayv2_stage" "admin_api" {
  count = var.enable_http_invoke_path ? 1 : 0

  api_id      = aws_apigatewayv2_api.admin_api[0].id
  name        = "$default"
  auto_deploy = true
  tags        = var.tags
}

resource "aws_lambda_permission" "admin_api_apigw" {
  count = var.enable_http_invoke_path ? 1 : 0

  statement_id  = "AllowTheAdminApiHttpApiToInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.function["admin_api"].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.admin_api[0].execution_arn}/*/*"
}
