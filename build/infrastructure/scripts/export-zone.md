# Exporting the current zone, verbatim

**Do this before anything else in the cutover. Tuesday 18 August 2026.**

This produces two things: the value for `copied_zone_records` in
`envs/prod/terraform.tfvars`, and the rollback record. They are the same
export. Keep it.

**Do not hand type any of it.** A one-character error in an SPF record is an
email deliverability incident that takes a week to notice and a week to fix.

---

## Why this is the most consequential half hour of the week

Failure mode 1 in the document titled "M1 Deliverable 3: Redirect-Serving
Decision and Apex Domain Routing", section 6: a DNS gap strands inventory.
Every encoded jar is dead and the time to recovery is governed by TTLs we do
not control, typically 48 hours at the parent nameserver.

The version of that failure people prepare for is the website going down, which
is loud and gets fixed. The version that actually happens is quieter: the zone
is copied, the apex works perfectly, the jars all resolve, everyone declares
success, and three days later somebody notices the company has not received an
email since Thursday. Nothing alarms on it. There is no dashboard for it.

That is what this export prevents, and it is why the instruction is verbatim
rather than "the records we need".

---

## Step 1: capture what the current nameservers actually answer

Do this **before** touching anything, and do it from the live nameservers
rather than from the provider's UI. What the UI shows and what the nameservers
answer are not guaranteed to be the same thing, and only one of them matters.

```sh
DOMAIN=treveanspice.com

# Find the authoritative nameservers first.
dig +short NS "$DOMAIN"

# Then ask one of them directly, so no resolver cache is involved.
NS=<one of the nameservers above>

for TYPE in SOA NS A AAAA MX TXT CAA SRV NAPTR; do
  echo "=== $TYPE ==="
  dig +noall +answer "@${NS}" "$DOMAIN" "$TYPE"
done
```

Save the whole output to a file. Date it. That file is the rollback record.

---

## Step 2: get the provider's own export

The nameserver query above finds everything at the apex, but it cannot
enumerate subdomains: DNS has no "list everything" operation that a normal
client can use. Subdomains have to come from the provider.

**At Squarespace:** the DNS settings page for the domain lists every custom
record. Export or screenshot the complete list, including anything greyed out
as a preset. Presets are still answers.

Then verify each subdomain from the export against the live nameservers, the
same way as the apex:

```sh
for NAME in www mail _dmarc <every subdomain from the export>; do
  for TYPE in A AAAA CNAME TXT MX; do
    dig +noall +answer "@${NS}" "${NAME}.${DOMAIN}" "$TYPE"
  done
done
```

**Records people forget, in rough order of how expensive forgetting them is:**

| Record | What breaks if it is lost |
|---|---|
| `MX` | Inbound email stops. Silently. This is the big one. |
| `TXT` with `v=spf1` | Outbound email starts landing in spam within days |
| `_dmarc` TXT | DMARC policy stops being enforced or reported |
| `*._domainkey` CNAME or TXT | DKIM signing breaks, same effect as SPF |
| Verification TXT records | Google Workspace, Microsoft 365, Shopify, Vercel, Facebook, a certificate authority, a shipping provider. Any of these can silently de-verify. |
| `CAA` | Certificate issuance can fail later, at renewal, months from now |
| `SRV` | Autodiscover for mail clients, video conferencing |
| Anything at a subdomain nobody recognises | It is there for a reason somebody had |

**If a record's purpose is unknown, copy it anyway.** The cost of copying a
dead record is nothing. The cost of dropping a live one is measured in days.

---

## Step 3: turn it into `copied_zone_records`

The shape:

```hcl
copied_zone_records = [
  { name = "treveanspice.com",              type = "MX",    ttl = 3600, records = ["10 mx1.example.net", "20 mx2.example.net"] },
  { name = "treveanspice.com",              type = "TXT",   ttl = 3600, records = ["v=spf1 include:_spf.example.net ~all"] },
  { name = "_dmarc.treveanspice.com",       type = "TXT",   ttl = 3600, records = ["v=DMARC1; p=none; rua=mailto:dmarc@treveanspice.com"] },
  { name = "s1._domainkey.treveanspice.com", type = "CNAME", ttl = 3600, records = ["s1.domainkey.example.net"] },
]
```

Three rules:

1. **Values go in unchanged.** Same quoting, same spacing, same priority
   numbers on MX. A TXT record's content is opaque and must not be tidied.
2. **Do NOT include the apex or www `A`/`AAAA` records.** Those become
   CloudFront ALIAS records, created by the `dns` module. Including them here
   is a conflict, and Terraform will refuse rather than silently pick one,
   which is the correct behaviour.
3. **Do NOT include `NS` or `SOA` at the apex.** Route 53 creates its own, and
   they are supposed to be different. That difference is the delegation.

---

## Step 4: lower the TTLs

At Squarespace, on any record whose value is going to change, set the TTL to
300 seconds. **At least 48 hours before the flip**, which means Tuesday for a
Thursday flip.

TTL is how long a resolver keeps an answer. Lowering it first means that if
something is wrong after the flip, the world stops believing the old answer in
five minutes rather than in a day. It costs a slightly higher query volume for
two days and it buys back the entire margin for error.

This does not apply to the parent nameserver TTL, which we do not control and
which is typically 48 hours. That is why the pre-flip verification carries more
weight than the rollback does, and why the honest statement is that a DNS-level
rollback is not fast.

---

## Step 5: check the copy against the original

After `terraform apply` on production run 1:

```sh
terraform output copied_zone_record_count
```

**Compare that number against the export.** If the export has 23 records and
Terraform copied 19, four things are about to break and no automated check
downstream will tell you which. Find them before Thursday.

Then, on Thursday morning:

```sh
./scripts/zone-diff.sh treveanspice.com ns1.squarespacedns.com ns-123.awsdns-45.com
```

That queries both nameserver sets and compares the answers record by record.
It is the second check. This export is the first, and it is the one that
catches records the script was never told to look for.

---

## Step 6: leave the old zone alone

**The Squarespace zone is left intact and unedited for at least 14 days after
the flip.** During the delegation overlap both nameserver sets return correct
answers, so a resolver holding either one is safe.

That is what makes the rollback a nameserver revert rather than a zone rebuild.
Editing the Squarespace zone "to tidy up" during those 14 days removes the only
cheap rollback in the plan.
