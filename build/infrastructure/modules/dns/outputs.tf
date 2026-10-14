output "zone_id" {
  description = "Route 53 hosted zone id."
  value       = aws_route53_zone.apex.zone_id
}

output "name_servers" {
  description = <<-EOT
    The four Route 53 nameservers.

    THIS IS THE ONLY VALUE THAT GETS TYPED INTO THE REGISTRAR OF RECORD, and
    typing it is the single action in this project that can strand 1,000
    encoded jars. It is a nameserver delegation, not a registrar transfer:
    registration, contacts, renewal and billing are untouched by it.

    CORRECTED SATURDAY 22 AUGUST 2026. This previously said decision D14
    stands. D16, taken Wednesday 19 August 2026, supersedes D14: the transfer
    of treveanspice.com to Bluehost is in flight and is the agreed position,
    and the nameservers point at Route 53 on completion. The registrar of
    record is therefore Squarespace until Bluehost confirms and Bluehost after
    it, and the delegation is made at whichever holds the domain on the day.

    Do not use it until the verification with no DNS involved has passed and
    the Route 53 answers have been diffed record by record against the answers
    of the currently authoritative nameservers.
  EOT
  value       = aws_route53_zone.apex.name_servers
}

output "copied_record_count" {
  description = "How many records were copied from the existing zone. Compare it against the export before the flip: a copy with fewer records than the original is the failure this number exists to catch."
  value       = length(aws_route53_record.copied)
}

output "apex_domain" {
  description = "The apex domain."
  value       = var.apex_domain
}

output "www_domain" {
  description = "The www hostname."
  value       = local.www_domain
}

output "validation_waited" {
  description = "true when this apply gated on ACM reporting ISSUED."
  value       = var.certificate_arn != null && var.wait_for_certificate_validation
}
