variable "name_prefix" {
  description = "Prefix for resource names."
  type        = string
}

variable "tags" {
  description = "Tags applied to every taggable resource."
  type        = map(string)
  default     = {}
}

variable "apex_domain" {
  description = "The apex domain the tags carry. treveanspice.com."
  type        = string
}

variable "www_domain" {
  description = "The www hostname. Defaults to www plus the apex."
  type        = string
  default     = null
}

# ---------------------------------------------------------------------------
# The exact copy of the existing zone
# ---------------------------------------------------------------------------

variable "copied_records" {
  description = <<-EOT
    Every record from the CURRENT authoritative zone, copied verbatim, values
    unchanged, BEFORE anything is delegated.

    This is failure mode 1 in the document titled "M1 Deliverable 3:
    Redirect-Serving Decision and Apex Domain Routing", section 6, and it is
    the only item in the risk register that can kill inventory. A nameserver
    set that answers for the apex but has lost the MX records does not break a
    website, it silently stops the company's email, and nobody finds out from a
    dashboard.

    Fill this from the export produced by scripts/export-zone.md. Do not hand
    type it. Every value goes in exactly as the current nameservers answer it,
    including MX, SPF, DKIM, DMARC, and any verification TXT records for
    services nobody remembered were connected.

    The apex A/AAAA and www A/AAAA are NOT listed here. They are created as
    CloudFront ALIAS records by this module. Everything else is a copy.

    TO CONFIRM IN AUDIT: what treveanspice.com currently resolves to, if
    anything, and the full contents of the current zone.
  EOT
  type = list(object({
    name    = string
    type    = string
    ttl     = optional(number, 300)
    records = list(string)
  }))
  default = []
}

variable "create_apex_alias_records" {
  description = <<-EOT
    Create the apex and www ALIAS records pointing at the distribution.

    Creating them is safe before delegation: while the Squarespace nameservers
    are still authoritative, nothing on the internet is reading this zone.
    Creating them early is what makes Thursday's record-by-record diff possible.
  EOT
  type        = bool
  default     = true
}

variable "cloudfront_domain_name" {
  description = "Distribution domain name for the ALIAS targets."
  type        = string
  default     = null
}

variable "cloudfront_hosted_zone_id" {
  description = "CloudFront's fixed hosted zone id for the ALIAS targets."
  type        = string
  default     = null
}

# ---------------------------------------------------------------------------
# Certificate validation
#
# The certificate itself is created by the certificate module, which depends on
# nothing so that it can be applied and validated at Squarespace before this
# zone exists. What lives here is only the Route 53 side, used after the
# delegation.
# ---------------------------------------------------------------------------

variable "certificate_arn" {
  description = "ARN of the certificate created by the certificate module. null skips everything below."
  type        = string
  default     = null
}

variable "domain_validation_options" {
  description = "Validation options from the certificate module."
  type = set(object({
    domain_name           = string
    resource_record_name  = string
    resource_record_type  = string
    resource_record_value = string
  }))
  default = []
}

variable "manage_validation_records_in_route53" {
  description = <<-EOT
    false is the correct setting for the initial issuance, and it is the
    default for a reason.

    The certificate is requested and validated while the Squarespace zone is
    still authoritative, by adding the validation CNAME there. Route 53 cannot
    validate a certificate for a zone it is not yet answering for, so setting
    this true before delegation creates records nobody reads.

    Flip it to true AFTER the delegation, so renewals validate automatically
    from then on. A certificate that silently fails to renew in December is a
    problem this line prevents.
  EOT
  type        = bool
  default     = false
}

variable "wait_for_certificate_validation" {
  description = <<-EOT
    Block the apply until ACM reports the certificate ISSUED.

    Leave false while validation records live at Squarespace and are added by
    hand: an apply that blocks for 45 minutes on Wednesday afternoon is an
    apply somebody cancels. Read the validation records from the certificate
    module's outputs, add them at Squarespace, then re-run with this true to
    gate on issuance before the aliases are attached.
  EOT
  type        = bool
  default     = false
}

variable "record_ttl_before_flip" {
  description = <<-EOT
    TTL in seconds on records we intend to change. Lowered to 300 at least 48
    hours before the flip, per the redirect-serving decision, section 6,
    mitigation 2. Being able to change your mind quickly is worth more than
    cache efficiency in the week the nameservers move.
  EOT
  type        = number
  default     = 300
}

variable "acknowledge_zone_has_no_email" {
  description = <<-EOT
    Set true ONLY if this domain genuinely carries no email and no service
    verification records.

    This exists so that creating a hosted zone with no MX records is a
    deliberate act rather than an accident. See the precondition on the hosted
    zone. Delegating to a zone that lost its MX records stops company email
    silently, while the website carries on working.
  EOT
  type        = bool
  default     = false
}
