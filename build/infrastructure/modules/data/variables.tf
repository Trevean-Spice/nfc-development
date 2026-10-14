variable "name_prefix" {
  description = "Prefix for resource names."
  type        = string
}

variable "tags" {
  description = "Tags applied to every taggable resource."
  type        = map(string)
  default     = {}
}

variable "table_names" {
  description = <<-EOT
    The five table names. Five tables, no sixth: the Architecture document,
    section "Data layer", commits to carrying the existing schema forward, and
    the rollups therefore live inside ScanEvents under a separate key
    namespace rather than in a new table.

    TO CONFIRM IN AUDIT (open question Q15): the real table names in the
    existing account, which may or may not be environment suffixed. Override
    here rather than renaming anything in the application.
  EOT
  type = object({
    spice_blends = optional(string, "SpiceBlends")
    scan_events  = optional(string, "ScanEvents")
    recipes      = optional(string, "Recipes")
    growers      = optional(string, "Growers")
    nfc_tags     = optional(string, "NFCTags")
  })
  default = {}
}

variable "name_tables_with_prefix" {
  description = <<-EOT
    Prefix the table names with the environment prefix, for example
    trevean-staging-SpiceBlends.

    true on dev and staging, so three environments can coexist in one account.
    On prod this depends on what the audit finds already deployed: adopting an
    existing unprefixed table is cheaper than renaming it, and renaming a
    DynamoDB table is not a rename, it is a migration.
  EOT
  type        = bool
  default     = true
}

variable "create_slug_index" {
  description = <<-EOT
    Create GSI2 (slug-index) on SpiceBlends.

    Required ONLY if the audit finds the table is keyed on a synthetic blendId
    rather than the slug. See the document titled "Data model", section 3.1.
    Without it, resolving a slug to an id is a Scan on the build path.

    TO CONFIRM IN AUDIT (Q15), check 2 in that document's section 8.
  EOT
  type        = bool
  default     = false
}

variable "recipes_key_shape" {
  description = <<-EOT
    blend_slug_first: base table is blendSlug plus a padded sort key, with a
                      recipeId-index GSI. This is the proposal.
    recipe_id_first:  base table is recipeId alone, with a
                      blendSlug-sortOrder-index GSI, and access pattern 3 is
                      served from the index instead of the base table.

    This is check 4 in the document titled "Data model", section 8, and that
    document calls it the highest-value single check in the list. Exactly one
    index is required either way and access pattern 3 is one Query either way.
    The one shape that is not acceptable is a table with neither, which forces
    a Scan with a filter on every page build.

    TO CONFIRM IN AUDIT (Q15).
  EOT
  type        = string
  default     = "blend_slug_first"

  validation {
    condition     = contains(["blend_slug_first", "recipe_id_first"], var.recipes_key_shape)
    error_message = "recipes_key_shape must be blend_slug_first or recipe_id_first."
  }
}

variable "billing_mode" {
  description = <<-EOT
    PAY_PER_REQUEST for the engagement. Traffic is spiky and unknown, a viral
    jar is a scenario the client has named, and provisioned capacity set from a
    guess throttles at exactly the wrong moment. Throttling on the scan write
    is a silently lost measurement. Revisit after 90 days of real data.
  EOT
  type        = string
  default     = "PAY_PER_REQUEST"
}

variable "enable_point_in_time_recovery" {
  description = "Cheap, and it is the difference between an incident and a disaster."
  type        = bool
  default     = true
}

variable "enable_deletion_protection" {
  description = "Deletion protection on the tables. true on prod."
  type        = bool
  default     = false
}

variable "kms_key_arn" {
  description = "Customer managed KMS key for table encryption. null uses the AWS owned key."
  type        = string
  default     = null
}

# The rollup consumer's event source mapping is defined in the compute module,
# not here. See the note in main.tf under "The stream, and where its consumer
# is wired".
