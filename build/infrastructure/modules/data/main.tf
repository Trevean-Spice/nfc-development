# ===========================================================================
# Data layer: the five DynamoDB tables
#
# Key schema and secondary indexes are taken verbatim from the document titled
# "Data model", section 3. Nothing here is invented and nothing is redesigned.
# Where that document marks something TO CONFIRM IN AUDIT, the adaptation it
# names is exposed as a variable rather than guessed at.
#
# Five tables, no sixth. The rollups the dashboard reads live inside
# ScanEvents under a ROLLUP# partition key namespace (section 5.1).
# ===========================================================================

locals {
  prefix = var.name_tables_with_prefix ? "${var.name_prefix}-" : ""

  tables = {
    spice_blends = "${local.prefix}${var.table_names.spice_blends}"
    scan_events  = "${local.prefix}${var.table_names.scan_events}"
    recipes      = "${local.prefix}${var.table_names.recipes}"
    growers      = "${local.prefix}${var.table_names.growers}"
    nfc_tags     = "${local.prefix}${var.table_names.nfc_tags}"
  }

  recipes_blend_slug_first = var.recipes_key_shape == "blend_slug_first"
}

# ---------------------------------------------------------------------------
# 1. SpiceBlends
#
# Holds the editorial blend record and, under a separate key namespace, the
# Shopify catalog mirror. The namespaced partition key is what lets the catalog
# mirror live here without a sixth table and without changing the shape of any
# existing item.
#
#   pk  BLEND#persian-sunrise    the editorial record
#       CATALOG#persian-sunrise  the Shopify catalog mirror
#   sk  v0                       the live editorial record
#       PUB#12                   an immutable published snapshot
# ---------------------------------------------------------------------------

resource "aws_dynamodb_table" "spice_blends" {
  name         = local.tables.spice_blends
  billing_mode = var.billing_mode
  hash_key     = "pk"
  range_key    = "sk"

  deletion_protection_enabled = var.enable_deletion_protection

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  attribute {
    name = "updatedAt"
    type = "S"
  }

  dynamic "attribute" {
    for_each = var.create_slug_index ? [1] : []

    content {
      name = "slug"
      type = "S"
    }
  }

  # GSI1, status-updatedAt-index. Access pattern 2: list blends by status.
  #
  # INCLUDE rather than ALL is deliberate. storyBlocks is the largest attribute
  # on the item and projecting it into an index doubles the write cost of every
  # blend save for no read benefit. The list view and the sitemap never need
  # the story.
  global_secondary_index {
    name            = "status-updatedAt-index"
    hash_key        = "status"
    range_key       = "updatedAt"
    projection_type = "INCLUDE"

    non_key_attributes = [
      "slug",
      "name",
      "tagline",
      "launchTier",
      "tagCode",
      "heroImageId",
      "recipeCount",
      "publishedAt",
      "version",
    ]
  }

  # GSI2, slug-index. Created only if the base table is keyed on a synthetic
  # blendId. Access pattern 1 must never require a Scan to turn a slug into an
  # id: the slug is what the redirect table resolves to and what every build
  # lookup starts from.
  dynamic "global_secondary_index" {
    for_each = var.create_slug_index ? [1] : []

    content {
      name            = "slug-index"
      hash_key        = "slug"
      projection_type = "ALL"
    }
  }

  point_in_time_recovery {
    enabled = var.enable_point_in_time_recovery
  }

  server_side_encryption {
    enabled     = var.kms_key_arn != null
    kms_key_arn = var.kms_key_arn
  }

  tags = merge(var.tags, {
    # Hyphen separated, not comma separated. An AWS tag value accepts only
    # letters, digits, spaces and + - = . _ : / @ so "1,2,8" fails the create
    # with "The Tag Value provided is invalid". Observed on the first real
    # apply, Thursday 27 August 2026.
    AccessPatterns = "1-2-8"
  })
}

# ---------------------------------------------------------------------------
# 2. Recipes
#
# blend_slug_first (the proposal):
#   pk  blendSlug          persian-sunrise
#   sk  0001#rcp_01J9Z...  zero-padded sortOrder, then the recipe id
#
# Zero padded so string ordering matches numeric ordering. Recipe id as the
# tiebreaker so carousel order is stable across builds, because an unstable
# order produces a diff on every rebuild and hides real changes.
#
# Access pattern 3 is then a single Query returning 5 to 10 items, with no
# sort in application code and no second round trip.
# ---------------------------------------------------------------------------

resource "aws_dynamodb_table" "recipes" {
  name         = local.tables.recipes
  billing_mode = var.billing_mode
  hash_key     = local.recipes_blend_slug_first ? "blendSlug" : "recipeId"
  range_key    = local.recipes_blend_slug_first ? "sk" : null

  deletion_protection_enabled = var.enable_deletion_protection

  attribute {
    name = "blendSlug"
    type = "S"
  }

  attribute {
    name = "recipeId"
    type = "S"
  }

  dynamic "attribute" {
    for_each = local.recipes_blend_slug_first ? [1] : []

    content {
      name = "sk"
      type = "S"
    }
  }

  dynamic "attribute" {
    for_each = local.recipes_blend_slug_first ? [] : [1]

    content {
      name = "sortOrder"
      type = "S"
    }
  }

  # Exactly one index is required either way, and either way access pattern 3
  # is one Query.
  dynamic "global_secondary_index" {
    for_each = local.recipes_blend_slug_first ? [1] : []

    content {
      name            = "recipeId-index"
      hash_key        = "recipeId"
      projection_type = "ALL"
    }
  }

  dynamic "global_secondary_index" {
    for_each = local.recipes_blend_slug_first ? [] : [1]

    content {
      name            = "blendSlug-sortOrder-index"
      hash_key        = "blendSlug"
      range_key       = "sortOrder"
      projection_type = "ALL"
    }
  }

  point_in_time_recovery {
    enabled = var.enable_point_in_time_recovery
  }

  server_side_encryption {
    enabled     = var.kms_key_arn != null
    kms_key_arn = var.kms_key_arn
  }

  tags = merge(var.tags, {
    AccessPatterns = "3"
  })
}

# ---------------------------------------------------------------------------
# 3. Growers
#
#   pk  growerId  grw_01J9Z900A1B2C3D4E5F6G7H8J9
#
# Access pattern 4 is a single GetItem, because the blend item already carries
# growerId. No index is needed to answer it.
#
# GSI1, entity-name-index, serves the admin grower list alphabetically. A
# constant partition key is a single-partition index, which is normally a
# smell. With a handful of growers, admin-only reads, and no consumer traffic
# on it at all, it is the correct call. The threshold at which it stops being
# correct is roughly 1,000 growers or any consumer-facing read, and it is
# written down so whoever crosses it knows why it was fine before and is not
# any more.
# ---------------------------------------------------------------------------

resource "aws_dynamodb_table" "growers" {
  name         = local.tables.growers
  billing_mode = var.billing_mode
  hash_key     = "growerId"

  deletion_protection_enabled = var.enable_deletion_protection

  attribute {
    name = "growerId"
    type = "S"
  }

  attribute {
    name = "entityType"
    type = "S"
  }

  attribute {
    name = "name"
    type = "S"
  }

  global_secondary_index {
    name            = "entity-name-index"
    hash_key        = "entityType"
    range_key       = "name"
    projection_type = "INCLUDE"

    non_key_attributes = [
      "name",
      "farmName",
      "country",
      "region",
      "portraitId",
    ]
  }

  point_in_time_recovery {
    enabled = var.enable_point_in_time_recovery
  }

  server_side_encryption {
    enabled     = var.kms_key_arn != null
    kms_key_arn = var.kms_key_arn
  }

  tags = merge(var.tags, {
    AccessPatterns = "4"
  })
}

# ---------------------------------------------------------------------------
# 4. NFCTags
#
#   pk  code  ps
#
# THIS TABLE IS A MIRROR, NOT A SOURCE OF TRUTH. It is seeded at deploy time
# from the version-controlled redirect table, and it exists so an operator or
# the admin CMS can read what is actually live without cloning the repository.
#
# The /t/{code} redirect itself is served at the CDN edge and DOES NOT READ
# THIS TABLE, because a database read inside the redirect would put a round
# trip inside the 2.0 second budget for no benefit.
#
# No secondary index. Five rows, one access pattern, partition key lookups
# only.
# ---------------------------------------------------------------------------

resource "aws_dynamodb_table" "nfc_tags" {
  name         = local.tables.nfc_tags
  billing_mode = var.billing_mode
  hash_key     = "code"

  deletion_protection_enabled = var.enable_deletion_protection

  attribute {
    name = "code"
    type = "S"
  }

  point_in_time_recovery {
    enabled = var.enable_point_in_time_recovery
  }

  server_side_encryption {
    enabled     = var.kms_key_arn != null
    kms_key_arn = var.kms_key_arn
  }

  tags = merge(var.tags, {
    AccessPatterns = "mirror-of-redirect-table"
  })
}

# ---------------------------------------------------------------------------
# 5. ScanEvents
#
# Two kinds of item under two key namespaces.
#
# Raw events (access pattern 5, the only pattern on the tap path):
#   pk  EVT#{blendSlug}#{YYYY-MM-DD}#{shard}
#   sk  {dedupToken}#{windowId}
#
# shard is the first hex character of dedupToken, giving 16 partitions per
# blend per day, derived deterministically from the token so it spreads writes
# without breaking deduplication. Without it, five blends produce five
# write-hot partitions per day, which is a known DynamoDB failure shape and one
# that only shows up under the traffic you most want to survive.
#
# Rollups (access patterns 6 and 7):
#   pk  ROLLUP#BLEND#{slug}#DAY, ROLLUP#BLEND#{slug}#HOUR,
#       ROLLUP#ALL#DAY, ROLLUP#BLEND#{slug}#GEO#DAY
#
# No secondary index on raw events. That is the point of the rollups.
#
# TTL on expiresAt. Retention proposed at 400 days for raw events so any month
# can be compared with the same month a year earlier, rollups indefinite. Raw
# events are also the reconciliation source for the rollups, so retention below
# a year removes the ability to recompute a disputed number. FOR DAN TO
# CONFIRM before M2.
# ---------------------------------------------------------------------------

resource "aws_dynamodb_table" "scan_events" {
  name         = local.tables.scan_events
  billing_mode = var.billing_mode
  hash_key     = "pk"
  range_key    = "sk"

  deletion_protection_enabled = var.enable_deletion_protection

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  stream_enabled   = true
  stream_view_type = "NEW_IMAGE"

  point_in_time_recovery {
    enabled = var.enable_point_in_time_recovery
  }

  server_side_encryption {
    enabled     = var.kms_key_arn != null
    kms_key_arn = var.kms_key_arn
  }

  tags = merge(var.tags, {
    AccessPatterns = "5-6-7"
  })
}

# ---------------------------------------------------------------------------
# The stream, and where its consumer is wired
#
# stream_enabled and stream_view_type = NEW_IMAGE are set on the ScanEvents
# table above. The EVENT SOURCE MAPPING that attaches the rollup consumer to
# that stream lives in the compute module, alongside the function it invokes,
# and it carries the INSERT-only, pk begins with EVT# filter that the document
# titled "Data model", section 5.1, sets out in bold.
#
# It is over there rather than here for a plain mechanical reason: this module
# has to supply table ARNs to the compute module for least-privilege IAM, and a
# mapping here would need the function ARN back from compute, which is a
# dependency cycle between two modules. One direction only, data to compute.
#
# READ modules/compute/main.tf, "The rollup consumer's event source mapping",
# BEFORE CHANGING THE FILTER. Rollup writes land in this same stream. Without
# the filter it is an infinite loop that will happily bill for itself.
# ---------------------------------------------------------------------------
