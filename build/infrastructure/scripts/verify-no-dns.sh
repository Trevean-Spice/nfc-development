#!/usr/bin/env bash
#
# verify-no-dns.sh
#
# The "verify with no DNS involved" step from the cutover plan in the document
# titled "M1 Deliverable 3: Redirect-Serving Decision and Apex Domain Routing",
# section 7, Thursday 20 August, morning:
#
#   Full verification with no DNS involved: curl --resolve and a hosts file
#   entry on a physical test phone. All five codes verified on both routes,
#   four of them
#   against physical tags. Check the rendered blend name, the exact Location
#   string, the 307 status, and the cache headers.
#
# WHY THIS EXISTS AT ALL. Before the nameservers move, treveanspice.com does
# not point at the distribution, so there is no way to test the thing that will
# serve 1,000 encoded jars except by telling the client where to look. This
# script does that with curl --resolve, which sets the Host header and the
# destination address independently, so the distribution is exercised exactly
# as it will be after the flip.
#
# WHAT IT CANNOT DO. It cannot verify a physical tag. Four of the five codes
# are encoded on real chips and the only check that closes the loop between
# what is in silicon and what is in a config file is a human tapping a jar and
# reading the blend name on the screen. This script prints the hosts file line
# for that phone and then gets out of the way.
#
# Usage:
#   ./verify-no-dns.sh <hostname> <distribution-domain-name>
#
#   hostname                  the Host header to send, for example
#                             treveanspice.com. On staging, pass the
#                             distribution domain name for both arguments.
#   distribution-domain-name  for example d111111abcdef8.cloudfront.net
#
# Exit code 0 only if every check passes.

set -uo pipefail

HOSTNAME_UNDER_TEST="${1:-}"
DISTRIBUTION_DOMAIN="${2:-}"

if [ -z "$HOSTNAME_UNDER_TEST" ] || [ -z "$DISTRIBUTION_DOMAIN" ]; then
  echo "usage: $0 <hostname> <distribution-domain-name>" >&2
  exit 2
fi

# Checked here rather than left to fail later, because a missing dig produces
# the same empty result as a distribution that has not finished deploying, and
# the message further down would then blame the wrong thing on the morning of
# the flip.
for TOOL in dig curl; do
  if ! command -v "$TOOL" >/dev/null 2>&1; then
    echo "$TOOL is not installed. This script cannot run without it." >&2
    exit 2
  fi
done

# ---------------------------------------------------------------------------
# The tag code map, from Scope, section "Tag code map", and reproduced in the
# document titled "Data model", section 7.2.
#
# Four codes are encoded, 250 units each, 1,000 tags total, received 24 July
# 2026. kg is the reserved fifth: allocated and served, but NO TAG IN THIS
# PRODUCTION RUN CARRIES IT.
#
# This list is a verification fixture. It is NOT the source of truth. The
# source of truth is the version-controlled redirect table that build/edge/
# compiles into the CloudFront Function. If this list and that table ever
# disagree, the table is right and this file is stale.
# ---------------------------------------------------------------------------

CODES="ps cs sr nm kg"
PHYSICAL_TAGS="ps cs sr nm"

# Two routes. /t/ is the tap and is what the 1,000 shipped tags carry. /q/ is
# the on-pack QR. Same destination page, differing only in the via value, per
# the document titled "M1 Deliverable 14: QR attribution", section 2.
ROUTES="t q"

slug_for() {
  case "$1" in
    ps) echo "persian-sunrise" ;;
    cs) echo "caribbean-sunset" ;;
    sr) echo "silk-road" ;;
    nm) echo "north-african-night-market" ;;
    kg) echo "kyoto-garden" ;;
    *)  echo "" ;;
  esac
}

# $1 route prefix (t or q), $2 code
expected_location() {
  SLUG="$(slug_for "$2")"
  if [ -z "$SLUG" ]; then echo ""; return; fi
  case "$1" in
    t) echo "/blend.html?blend=${SLUG}&via=nfc" ;;
    q) echo "/blend.html?blend=${SLUG}&via=qr" ;;
    *) echo "" ;;
  esac
}

FAILURES=0

fail() {
  echo "  FAIL: $1"
  FAILURES=$((FAILURES + 1))
}

pass() {
  echo "  ok:   $1"
}

echo "==========================================================================="
echo "Verification with no DNS involved"
echo "  Host header:  $HOSTNAME_UNDER_TEST"
echo "  Distribution: $DISTRIBUTION_DOMAIN"
echo "  Started:      $(date -u '+%Y-%m-%d %H:%M:%SZ')"
echo "==========================================================================="
echo

# ---------------------------------------------------------------------------
# Resolve the distribution to an edge address, without involving the apex.
# ---------------------------------------------------------------------------

EDGE_IP="$(dig +short "$DISTRIBUTION_DOMAIN" A | grep -E '^[0-9]+\.' | head -n 1)"

if [ -z "$EDGE_IP" ]; then
  echo "Could not resolve $DISTRIBUTION_DOMAIN to an IPv4 address." >&2
  echo "Check the distribution exists and has finished deploying." >&2
  exit 1
fi

echo "Edge address in use: $EDGE_IP"
echo

CURL="curl --silent --show-error --max-time 15 --resolve ${HOSTNAME_UNDER_TEST}:443:${EDGE_IP}"

# ---------------------------------------------------------------------------
# 1. The five codes, on both routes
# ---------------------------------------------------------------------------

echo "---------------------------------------------------------------------------"
echo "1. The /t/ and /q/ redirects. Status must be exactly 307, Location must be"
echo "   an exact match, and the 307 must not be cacheable. The QR route must"
echo "   reach the same page as the tap and carry via=qr, or the NFC versus QR"
echo "   split required by Scope, in scope, item 6 cannot be produced at all."
echo "---------------------------------------------------------------------------"

for ROUTE in $ROUTES; do
for CODE in $CODES; do
  echo
  echo "/${ROUTE}/$CODE"

  HEADERS="$($CURL --dump-header - --output /dev/null "https://${HOSTNAME_UNDER_TEST}/${ROUTE}/${CODE}" 2>&1)"

  STATUS="$(printf '%s' "$HEADERS" | head -n 1 | awk '{print $2}')"
  LOCATION="$(printf '%s' "$HEADERS" | grep -i '^location:' | head -n 1 | sed 's/^[Ll]ocation:[[:space:]]*//' | tr -d '\r')"
  CACHE_CONTROL="$(printf '%s' "$HEADERS" | grep -i '^cache-control:' | head -n 1 | sed 's/^[Cc]ache-[Cc]ontrol:[[:space:]]*//' | tr -d '\r')"

  # 307, exactly. Not 301, not 302.
  #
  # A 301 is cached by browsers and by intermediaries, in some cases
  # indefinitely, which would make the destination permanently un-editable on
  # every device that had ever tapped a jar. That destroys the entire reason
  # the redirect exists: destinations change by editing the table, tags are
  # never re-encoded.
  if [ "$STATUS" = "307" ]; then
    pass "status 307"
  else
    fail "status was '$STATUS', must be exactly 307. A 301 anywhere in this chain is uneditable across the installed base."
  fi

  # The Location value is a relative path, not an absolute URL. That keeps the
  # browser on the connection it already has, avoids any apex versus www or
  # http versus https mismatch, and costs nothing. An absolute URL to a
  # different hostname costs a fresh DNS lookup plus a fresh TCP and TLS
  # handshake: an estimated 300 to 600 ms on cellular, against a 2.0 second
  # budget.
  EXPECTED="$(expected_location "$ROUTE" "$CODE")"
  if [ "$LOCATION" = "$EXPECTED" ]; then
    pass "Location exactly '$LOCATION'"
  else
    fail "Location was '$LOCATION', expected '$EXPECTED'"
  fi

  case "$LOCATION" in
    http://*|https://*)
      fail "Location is an absolute URL. It must be a same-origin relative path."
      ;;
  esac

  if printf '%s' "$CACHE_CONTROL" | grep -qi 'no-store'; then
    pass "Cache-Control: $CACHE_CONTROL"
  else
    fail "Cache-Control was '$CACHE_CONTROL', expected no-store. A cached redirect is an uneditable redirect."
  fi
done
done

# ---------------------------------------------------------------------------
# 2. An unknown code
# ---------------------------------------------------------------------------

echo
echo "---------------------------------------------------------------------------"
echo "2. An unknown code. Must be a branded 404, never a redirect to the home page"
echo "   and never a generic landing page: under SOW section 6.1, a generic"
echo "   landing page fails in the same way a wrong blend does."
echo "---------------------------------------------------------------------------"
echo

for ROUTE in $ROUTES; do
  UNKNOWN_STATUS="$($CURL --output /dev/null --write-out '%{http_code}' "https://${HOSTNAME_UNDER_TEST}/${ROUTE}/zz")"

  if [ "$UNKNOWN_STATUS" = "404" ]; then
    pass "/${ROUTE}/zz returns 404"
  else
    fail "/${ROUTE}/zz returned '$UNKNOWN_STATUS', expected 404"
  fi
done

# The tap path must not be steerable by a request parameter. If ?via=qr changed
# the Location, an attacker-supplied value would be reaching a response header
# and an attribution value would be a candidate for the cache key.
TAP_WITH_PARAM="$($CURL --dump-header - --output /dev/null "https://${HOSTNAME_UNDER_TEST}/t/ps?via=qr" 2>&1 | grep -i '^location:' | head -n 1 | sed 's/^[Ll]ocation:[[:space:]]*//' | tr -d '\r')"
if [ "$TAP_WITH_PARAM" = "$(expected_location t ps)" ]; then
  pass "/t/ps?via=qr still answers via=nfc: the route is the path, not a parameter"
else
  fail "/t/ps?via=qr answered '$TAP_WITH_PARAM'. The function must never read the query string."
fi

# ---------------------------------------------------------------------------
# 3. Cache key hygiene
# ---------------------------------------------------------------------------

echo
echo "---------------------------------------------------------------------------"
echo "3. Cache key. Attribution parameters must NOT fragment the cache. Two"
echo "   requests that differ only in via and utm_* must hit the same cache"
echo "   entry, or every campaign link pays origin latency on first request."
echo "---------------------------------------------------------------------------"
echo

# Warm the entry first, then two variants that differ only in attribution.
$CURL --output /dev/null "https://${HOSTNAME_UNDER_TEST}/blend.html?blend=persian-sunrise" >/dev/null 2>&1
sleep 1

HIT_A="$($CURL --dump-header - --output /dev/null "https://${HOSTNAME_UNDER_TEST}/blend.html?blend=persian-sunrise&via=nfc" 2>&1 | grep -i '^x-cache:' | tr -d '\r')"
HIT_B="$($CURL --dump-header - --output /dev/null "https://${HOSTNAME_UNDER_TEST}/blend.html?blend=persian-sunrise&via=qr&utm_source=verification&utm_campaign=$(date +%s)" 2>&1 | grep -i '^x-cache:' | tr -d '\r')"

echo "  with via=nfc:                 $HIT_A"
echo "  with via=qr and unique utm_*: $HIT_B"

if printf '%s' "$HIT_B" | grep -qi 'Hit from cloudfront'; then
  pass "a never-before-seen utm_campaign value still hits the cache"
else
  fail "a unique utm_campaign value produced '$HIT_B'. If this is a miss, attribution parameters are in the cache key and the cache is fragmenting per link. Check the cache policy for /blend.html: the key is path plus blend only."
fi

# ---------------------------------------------------------------------------
# 4. Protocol
# ---------------------------------------------------------------------------

echo
echo "---------------------------------------------------------------------------"
echo "4. Protocol and TLS"
echo "---------------------------------------------------------------------------"
echo

TLS_VERSION="$($CURL --output /dev/null --write-out '%{ssl_version}' "https://${HOSTNAME_UNDER_TEST}/t/ps")"
echo "  negotiated: $TLS_VERSION"

if [ "$TLS_VERSION" = "TLSv1.3" ]; then
  pass "TLS 1.3"
else
  fail "negotiated $TLS_VERSION, expected TLS 1.3"
fi

# ---------------------------------------------------------------------------
# The physical tag step, which no script can do
# ---------------------------------------------------------------------------

echo
echo "==========================================================================="
echo "THE PART THIS SCRIPT CANNOT DO"
echo "==========================================================================="
echo
echo "Four of the five codes are encoded on physical chips. The only check that"
echo "closes the loop between what is in silicon and what is in a config file is"
echo "a person tapping a real jar and READING THE BLEND NAME ON THE SCREEN."
echo "A page that loads is not the test. The right page is the test."
echo
echo "Physical tags to verify: $PHYSICAL_TAGS"
echo "  /t/kg is reserved. NO TAG IN THIS PRODUCTION RUN CARRIES IT."
echo "  Five codes, four physical tags. Do not spend the morning looking for a"
echo "  Kyoto Garden jar."
echo
echo "Add this line to the test phone's hosts file, or to the machine tethering"
echo "it, so the phone reaches the distribution before any nameserver moves:"
echo
echo "    ${EDGE_IP}  ${HOSTNAME_UNDER_TEST}"
echo
echo "Record for each tag: date, tester, handset, and the blend name that"
echo "appeared. That goes into lastVerifiedAgainstPhysicalTag."
echo

echo "==========================================================================="
if [ "$FAILURES" -eq 0 ]; then
  echo "ALL AUTOMATED CHECKS PASSED. The physical tag checks above are outstanding."
  echo "==========================================================================="
  exit 0
else
  echo "$FAILURES AUTOMATED CHECK(S) FAILED. Do not flip the nameservers."
  echo "==========================================================================="
  exit 1
fi
