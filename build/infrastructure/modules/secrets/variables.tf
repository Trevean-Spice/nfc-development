variable "name_prefix" {
  description = "Prefix for resource names."
  type        = string
}

variable "environment" {
  description = "dev, staging or prod."
  type        = string
}

variable "tags" {
  description = "Tags applied to every taggable resource."
  type        = map(string)
  default     = {}
}

variable "create_kms_key" {
  description = "Create a customer managed KMS key for this environment."
  type        = bool
  default     = true
}

variable "kms_deletion_window_days" {
  description = "Waiting period before a scheduled key deletion completes."
  type        = number
  default     = 30
}

variable "secret_recovery_window_days" {
  description = <<-EOT
    Recovery window on a deleted secret. 0 on dev so environments can be torn
    down and rebuilt in a day. 30 on prod, because a secret deleted by mistake
    with no recovery window is an outage with no undo.
  EOT
  type        = number
  default     = 30
}

variable "tag_password_holder" {
  description = <<-EOT
    THE NAMED HOLDER OF THE ST25TV02KC AREA PASSWORD.

    A named person, in the form "Name, role, organisation". Not a team, not a
    mailbox, not "Serene Labs". The Architecture document, section "Security
    and privacy", requires the tag password to have a documented holder and a
    rotation path, and the reason a documented holder must be one person is
    that a password nobody is individually accountable for is a password
    nobody notices the loss of until it is needed.

    FILL IN WHEN ACCESS LANDS. Dan's decision, not ours.
  EOT
  type        = string
  default     = "TO CONFIRM: named holder not yet nominated"
}

variable "extra_secrets" {
  description = <<-EOT
    Additional secrets discovered during the audit, chiefly credentials tied to
    the previous contractor that have to be identified and replaced (risk R18).

    Map of short name to description. Values are never set here.
  EOT
  type        = map(string)
  default     = {}
}
