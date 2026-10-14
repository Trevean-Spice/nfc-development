# ===========================================================================
# DNS and certificate
#
# Sequencing is the whole content of this module, and it comes straight from
# the cutover plan in the document titled "M1 Deliverable 3: Redirect-Serving
# Decision and Apex Domain Routing", section 7:
#
#   Tue 18 Aug  export the current zone verbatim, request the certificate in
#               us-east-1, add validation CNAMEs at Squarespace, lower TTLs
#   Wed 19 Aug  create the hosted zone as an EXACT COPY plus the apex and www
#               ALIAS records. NO NAMESERVER CHANGE TODAY.
#   Thu 20 Aug  verify with no DNS involved, then flip the nameserver set
#   Fri 21 Aug  R1 closes
#
# Two things this module deliberately does not do:
#
#   1. It does not change the nameserver set. That is a manual action at
#      Squarespace, taken by a human who has just read a verification report,
#      not a side effect of an apply. It is the single action in this project
#      that can strand 1,000 encoded jars.
#   2. It does not touch the Squarespace zone. That zone is left intact and
#      unedited for at least 14 days after the flip, which is what makes the
#      rollback a nameserver revert rather than a zone rebuild.
# ===========================================================================

locals {
  www_domain = coalesce(var.www_domain, "www.${var.apex_domain}")

  # The email safety gate. See the precondition on the zone below.
  copied_mx_count  = length([for r in var.copied_records : r if upper(r.type) == "MX"])
  copied_txt_count = length([for r in var.copied_records : r if upper(r.type) == "TXT"])

  # for_each key must be unique and stable. A zone can hold several records of
  # different types at the same name.
  copied_records = {
    for record in var.copied_records :
    "${lower(record.name)}|${upper(record.type)}" => record
  }
}

resource "aws_route53_zone" "apex" {
  name          = var.apex_domain
  comment       = "${var.name_prefix}. Created as an exact copy of the existing zone before any delegation."
  force_destroy = false
  tags          = var.tags

  lifecycle {
    prevent_destroy = true

    # ---------------------------------------------------------------------
    # THE EMAIL SAFETY GATE.
    #
    # This variable used to default to an empty list with nothing checking
    # it. An apply then succeeded, created a zone holding four ALIAS records
    # and nothing else, and the website worked perfectly. The moment the
    # nameservers were delegated to it, MX, SPF, DKIM, DMARC and every
    # service verification TXT record stopped existing, and nothing in any
    # dashboard would have said so.
    #
    # That failure is more likely now, not less, because the current zone is
    # returning SERVFAIL and the export cannot be produced from DNS. "Just
    # create the zone for now and add the records later" is exactly the
    # tempting move this refuses.
    #
    # Overriding is deliberately possible, because a domain that genuinely
    # has no email is a real case. It just cannot happen by accident.
    # ---------------------------------------------------------------------
    precondition {
      condition     = local.copied_mx_count > 0 || var.acknowledge_zone_has_no_email
      error_message = <<-EOT
        Refusing to create a hosted zone for ${var.apex_domain} with no MX records.

        copied_records contains ${length(var.copied_records)} records, of which
        ${local.copied_mx_count} are MX and ${local.copied_txt_count} are TXT.

        Delegating to a zone with no MX records stops company email, and it does
        it silently: the website keeps working and no alarm fires. Those records
        cannot be read back out of DNS once the zone is broken, so they have to
        come from the console of whoever hosted the zone before.

        Fix this by filling in copied_records from the export procedure in
        scripts/export-zone.md.

        If this domain genuinely carries no email and no verification records,
        set acknowledge_zone_has_no_email = true and record why.
      EOT
    }
  }
}

# ---------------------------------------------------------------------------
# The exact copy
# ---------------------------------------------------------------------------

resource "aws_route53_record" "copied" {
  for_each = local.copied_records

  zone_id = aws_route53_zone.apex.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = each.value.ttl
  records = each.value.records

  # A copy that silently overwrites something is not a copy.
  allow_overwrite = false

  # A later apply with a shorter list would otherwise delete email records out
  # of a zone that is by then authoritative. Removing a record here is a
  # deliberate act that requires editing this file.
  lifecycle {
    prevent_destroy = true
  }
}

# ---------------------------------------------------------------------------
# Apex and www ALIAS records
#
# ALIAS rather than CNAME at the apex because a CNAME at a zone apex is invalid
# and because CloudFront publishes no stable address to put in an A record.
# Both A and AAAA: the distribution is IPv6 enabled and a phone on a carrier
# network is a realistic IPv6-only client.
#
# evaluate_target_health is off. CloudFront is a global service with no health
# check to evaluate, and turning it on gains nothing while adding a failure
# path on the record that 1,000 jars resolve through.
# ---------------------------------------------------------------------------

resource "aws_route53_record" "apex_a" {
  count = var.create_apex_alias_records ? 1 : 0

  zone_id = aws_route53_zone.apex.zone_id
  name    = var.apex_domain
  type    = "A"

  alias {
    name                   = var.cloudfront_domain_name
    zone_id                = var.cloudfront_hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "apex_aaaa" {
  count = var.create_apex_alias_records ? 1 : 0

  zone_id = aws_route53_zone.apex.zone_id
  name    = var.apex_domain
  type    = "AAAA"

  alias {
    name                   = var.cloudfront_domain_name
    zone_id                = var.cloudfront_hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "www_a" {
  count = var.create_apex_alias_records ? 1 : 0

  zone_id = aws_route53_zone.apex.zone_id
  name    = local.www_domain
  type    = "A"

  alias {
    name                   = var.cloudfront_domain_name
    zone_id                = var.cloudfront_hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "www_aaaa" {
  count = var.create_apex_alias_records ? 1 : 0

  zone_id = aws_route53_zone.apex.zone_id
  name    = local.www_domain
  type    = "AAAA"

  alias {
    name                   = var.cloudfront_domain_name
    zone_id                = var.cloudfront_hosted_zone_id
    evaluate_target_health = false
  }
}

# ---------------------------------------------------------------------------
# Certificate validation, the Route 53 side only
#
# The certificate is created by the certificate module, which depends on
# nothing, so that it can be requested on Tuesday and validated at Squarespace
# before this zone exists. What follows is used AFTER the delegation, so that
# renewals validate automatically from then on.
# ---------------------------------------------------------------------------

resource "aws_route53_record" "certificate_validation" {
  for_each = var.manage_validation_records_in_route53 ? {
    for option in var.domain_validation_options : option.domain_name => option
  } : {}

  zone_id         = aws_route53_zone.apex.zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = var.record_ttl_before_flip
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "apex" {
  count    = var.certificate_arn != null && var.wait_for_certificate_validation ? 1 : 0
  provider = aws.us_east_1

  certificate_arn = var.certificate_arn

  validation_record_fqdns = var.manage_validation_records_in_route53 ? [
    for record in aws_route53_record.certificate_validation : record.fqdn
  ] : null

  timeouts {
    create = "60m"
  }
}
