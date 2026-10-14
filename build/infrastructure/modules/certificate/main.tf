# ===========================================================================
# The TLS certificate
#
# Its own module, and that is not filing tidiness. It is the sequencing in the
# cutover plan expressed as a dependency graph.
#
# From the document titled "M1 Deliverable 3: Redirect-Serving Decision and
# Apex Domain Routing", section 4:
#
#   The TLS certificate must be issued by ACM in us-east-1. CloudFront reads
#   certificates from that region only. A certificate in any other region
#   cannot be attached and the flip cannot proceed.
#
#   The certificate is requested and validated WHILE THE SQUARESPACE ZONE IS
#   STILL AUTHORITATIVE, by adding the validation CNAME there. That way the
#   certificate is issued, the alternate domain names are attached, and the
#   whole distribution is testable before a single nameserver changes.
#
# So this module depends on nothing. Not the hosted zone, not the distribution.
# It is applied on Tuesday 18 August, its validation records are read out of
# the outputs and pasted into Squarespace, and the rest of the week proceeds
# behind it.
#
# Failure mode 5 in section 6 is what this ordering exists to prevent: a
# certificate that is missing, wrong-region or unvalidated at flip time means
# the distribution cannot serve the apex and the flip fails visibly.
# ===========================================================================

variable "apex_domain" {
  description = "treveanspice.com."
  type        = string
}

variable "www_domain" {
  description = "The www hostname. Defaults to www plus the apex."
  type        = string
  default     = null
}

variable "tags" {
  description = "Tags applied to the certificate."
  type        = map(string)
  default     = {}
}

locals {
  www_domain = coalesce(var.www_domain, "www.${var.apex_domain}")
}

resource "aws_acm_certificate" "apex" {
  provider = aws.us_east_1

  domain_name               = var.apex_domain
  subject_alternative_names = [local.www_domain]
  validation_method         = "DNS"
  tags                      = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

output "certificate_arn" {
  description = "ACM certificate ARN in us-east-1. Attach to the distribution only once the status reads ISSUED."
  value       = aws_acm_certificate.apex.arn
}

output "certificate_status" {
  description = "Must read ISSUED before the aliases are attached and before the flip. This is a hard gate, not a check."
  value       = aws_acm_certificate.apex.status
}

output "validation_records" {
  description = <<-EOT
    The DNS validation records to ADD AT SQUARESPACE while that zone is still
    authoritative. Name, type and value, ready to paste.

    Route 53 cannot validate a certificate for a zone it is not yet answering
    for, which is why these are read out here and entered by hand rather than
    created by Terraform on the first pass.
  EOT
  value = [
    for option in aws_acm_certificate.apex.domain_validation_options : {
      name  = option.resource_record_name
      type  = option.resource_record_type
      value = option.resource_record_value
    }
  ]
}

output "domain_validation_options" {
  description = "Raw validation options, consumed by the dns module when validation moves into Route 53 after the delegation."
  value       = aws_acm_certificate.apex.domain_validation_options
}

output "www_domain" {
  description = "The www hostname covered by the certificate."
  value       = local.www_domain
}
