#!/usr/bin/env bash
#
# zone-diff.sh
#
# "Diff Route 53 answers against Squarespace answers, record by record."
# Cutover plan, Thursday 20 August, morning.
#
# WHAT THIS PROTECTS. Failure mode 1 in the redirect-serving decision, section
# 6: a DNS gap strands inventory. The mitigation that matters most is that the
# Route 53 zone is created as an exact copy of the existing zone BEFORE
# anything is delegated, and diffed answer for answer until the two are
# identical.
#
# The failure this catches is not a broken website. It is a copied zone that is
# missing the MX records, which does not break anything visible and silently
# stops the company's email on the day the nameservers move. Nobody finds out
# from a dashboard.
#
# Usage:
#   ./zone-diff.sh <domain> <current-nameserver> <route53-nameserver>
#
# Example:
#   ./zone-diff.sh treveanspice.com ns1.squarespacedns.com ns-123.awsdns-45.com
#
# Exit code 0 only if every record type returns identical answers from both.

set -uo pipefail

DOMAIN="${1:-}"
CURRENT_NS="${2:-}"
ROUTE53_NS="${3:-}"

if [ -z "$DOMAIN" ] || [ -z "$CURRENT_NS" ] || [ -z "$ROUTE53_NS" ]; then
  echo "usage: $0 <domain> <current-nameserver> <route53-nameserver>" >&2
  exit 2
fi

# Every check below is a dig invocation. Without dig, dig writes "command not
# found" to stderr, every query returns empty, every comparison matches, and
# this script exits 0. Fail on the missing binary instead.
if ! command -v dig >/dev/null 2>&1; then
  echo "dig is not installed. Every check in this script is a dig query, and" >&2
  echo "without it this script would report a clean diff on a zone it never" >&2
  echo "read. Install bind-utils, dnsutils or BIND's tools and run it again." >&2
  exit 2
fi

# Record types checked at the apex. NS and SOA are excluded deliberately: they
# are expected to differ, since that is the entire point of the delegation.
#
# A, AAAA and CNAME at the apex are also expected to differ if the current zone
# points somewhere other than the distribution. That is flagged rather than
# failed, and it needs a human to look at it.
APEX_TYPES="MX TXT CAA"
EXPECTED_TO_DIFFER="A AAAA"

# Subdomains worth checking explicitly, because they are the ones a copy loses.
# Extend this list from the zone export before running.
SUBDOMAINS="www mail _dmarc"
SUBDOMAIN_TYPES="A AAAA CNAME TXT MX"

DIFFERENCES=0
FLAGGED=0

query() {
  local server="$1" name="$2" type="$3"
  dig +short "@${server}" "$name" "$type" 2>/dev/null | LC_ALL=C sort
}

# ---------------------------------------------------------------------------
# Reachability precheck, and it is the difference between this script being a
# gate and this script being decoration.
#
# compare() treats "no answer from either side" as a match, which is correct
# for a record type that genuinely does not exist in either zone. It is NOT
# correct when a nameserver is unreachable, SERVFAILing, or was mistyped on the
# command line: dig +short prints nothing in every one of those cases too, so
# every comparison silently matches, DIFFERENCES stays at zero, and the script
# exits 0 telling a human it is safe to flip the nameservers.
#
# That is the exact failure this whole file exists to prevent, so the rcode is
# checked explicitly before any comparison runs. treveanspice.com was
# returning SERVFAIL on Monday 24 August 2026, which is not a hypothetical.
# ---------------------------------------------------------------------------

rcode_for() {
  local server="$1" name="$2"
  dig +noall +comment "@${server}" "$name" SOA 2>/dev/null |
    sed -n 's/.*status: \([A-Z]*\).*/\1/p' | head -n 1
}

check_reachable() {
  local server="$1" label="$2"
  local rcode
  rcode="$(rcode_for "$server" "$DOMAIN")"

  if [ -z "$rcode" ]; then
    echo "  UNREACHABLE  $label ($server) did not answer at all." >&2
    return 1
  fi

  if [ "$rcode" != "NOERROR" ]; then
    echo "  BAD RCODE    $label ($server) answered $rcode for $DOMAIN SOA." >&2
    return 1
  fi

  printf '  ok        %-34s %s\n' "$label" "$server"
  return 0
}

compare() {
  local name="$1" type="$2" expect_differ="${3:-no}"

  local a b
  a="$(query "$CURRENT_NS" "$name" "$type")"
  b="$(query "$ROUTE53_NS" "$name" "$type")"

  if [ -z "$a" ] && [ -z "$b" ]; then
    return 0
  fi

  if [ "$a" = "$b" ]; then
    printf '  ok        %-34s %-6s (%d answer(s))\n' "$name" "$type" "$(printf '%s' "$a" | grep -c . || true)"
    return 0
  fi

  if [ "$expect_differ" = "yes" ]; then
    printf '  FLAGGED   %-34s %-6s expected to differ, read it anyway\n' "$name" "$type"
    printf '              current:  %s\n' "$(printf '%s' "$a" | tr '\n' ' ')"
    printf '              route53:  %s\n' "$(printf '%s' "$b" | tr '\n' ' ')"
    FLAGGED=$((FLAGGED + 1))
    return 0
  fi

  printf '  DIFFERS   %-34s %-6s\n' "$name" "$type"
  printf '              current:  %s\n' "$(printf '%s' "$a" | tr '\n' ' ')"
  printf '              route53:  %s\n' "$(printf '%s' "$b" | tr '\n' ' ')"
  DIFFERENCES=$((DIFFERENCES + 1))
}

echo "==========================================================================="
echo "Zone diff, record by record"
echo "  Domain:           $DOMAIN"
echo "  Current answers:  $CURRENT_NS"
echo "  Route 53 answers: $ROUTE53_NS"
echo "  Started:          $(date -u '+%Y-%m-%d %H:%M:%SZ')"
echo "==========================================================================="
echo
echo "Nameserver reachability, checked before any comparison is trusted:"

REACHABLE=0
check_reachable "$CURRENT_NS" "current nameserver" || REACHABLE=1
check_reachable "$ROUTE53_NS" "route 53 nameserver" || REACHABLE=1

if [ "$REACHABLE" -ne 0 ]; then
  echo
  echo "==========================================================================="
  echo "AT LEAST ONE NAMESERVER DID NOT ANSWER NOERROR FOR $DOMAIN."
  echo
  echo "No comparison was run, because a silent nameserver and an empty zone are"
  echo "indistinguishable to this script, and the wrong one of those reads as a"
  echo "clean diff. Fix resolution first, then run this again."
  echo
  echo "DO NOT FLIP THE NAMESERVERS."
  echo "==========================================================================="
  exit 1
fi

echo
echo "Apex records that MUST match:"

for TYPE in $APEX_TYPES; do
  compare "$DOMAIN" "$TYPE"
done

echo
echo "Apex records expected to differ, because that is the point of the move:"

for TYPE in $EXPECTED_TO_DIFFER; do
  compare "$DOMAIN" "$TYPE" "yes"
done

echo
echo "Subdomains:"

for SUB in $SUBDOMAINS; do
  for TYPE in $SUBDOMAIN_TYPES; do
    if [ "$SUB" = "www" ] && { [ "$TYPE" = "A" ] || [ "$TYPE" = "AAAA" ] || [ "$TYPE" = "CNAME" ]; }; then
      compare "${SUB}.${DOMAIN}" "$TYPE" "yes"
    else
      compare "${SUB}.${DOMAIN}" "$TYPE"
    fi
  done
done

echo
echo "==========================================================================="
echo "WHAT THIS SCRIPT CANNOT TELL YOU"
echo "==========================================================================="
echo
echo "It only checks names it was told to check. A record for a service nobody"
echo "remembered was connected, at a name not in this script's list, will pass"
echo "silently and stop working after the flip."
echo
echo "So this script is the SECOND check, not the first. The first is the full"
echo "zone export from the current provider, compared against"
echo "copied_zone_record_count in the Terraform output. If the export has 23"
echo "records and Terraform copied 19, four things are about to break and this"
echo "script will not tell you which."
echo

echo "==========================================================================="
if [ "$DIFFERENCES" -eq 0 ]; then
  echo "NO UNEXPECTED DIFFERENCES. $FLAGGED expected difference(s) flagged above;"
  echo "read each one before proceeding."
  echo "==========================================================================="
  exit 0
else
  echo "$DIFFERENCES UNEXPECTED DIFFERENCE(S). DO NOT FLIP THE NAMESERVERS."
  echo "==========================================================================="
  exit 1
fi
