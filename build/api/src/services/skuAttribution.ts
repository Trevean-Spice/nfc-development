/**
 * Working out which blend an order line belongs to, and refusing to guess.
 *
 * WHAT THIS REPLACES, AND WHY IT HAD TO GO.
 *
 * The orders webhook attributed a line to a blend like this:
 *
 *     knownSlugs().find((s) => sku?.toLowerCase().includes(s.split('-')[0]))
 *
 * That takes the FIRST SEGMENT of each slug and asks whether the SKU contains it
 * anywhere. The five real first segments are `persian`, `caribbean`, `silk`,
 * `north` and `kyoto`, and matching them as substrings fails in both directions.
 * Measured against the authoritative slug list:
 *
 *     TS-PS-100G           -> no match                      (a real one, missed)
 *     TS-NAM-100G          -> no match                      (a real one, missed)
 *     NORTHERN-SPICE-50G   -> north-african-night-market    (NORTHern)
 *     NORTH-STAR-BUNDLE    -> north-african-night-market    (an unrelated product)
 *     SILKY-SMOOTH-01      -> silk-road                     (SILKy)
 *
 * **Both directions are wrong at once**, which is the worst available combination:
 * real orders go unattributed while unrelated products are attributed to a blend.
 * Reorder attribution is an M4 deliverable, so this is a defect against the
 * contract and not a tidy up.
 *
 * (An earlier version of this comment blamed a slug called `the-silk-road` whose
 * first segment would be `the`. **There is no such slug**: the contract's `Slug`
 * enum and the redirect table both say `silk-road`. That claim came from a slug
 * list typed out instead of read, and the examples it produced were invented. The
 * defect above is narrower than that and is measured. See "Decision log", D48.)
 *
 * THE RULE HERE: MATCH ON WHOLE TOKENS, OR RETURN NOTHING.
 *
 * A SKU is split on anything that is not a letter or a digit, and a candidate has
 * to equal a whole token or a whole run of them. **No substring matching, at all.**
 * An unmatched SKU returns undefined and the caller logs it, because a visible gap
 * in attribution is recoverable and a confident wrong number is not.
 *
 * **We do not know Trevean's SKU scheme.** Nobody has ever sent one. So this
 * matches what can be known from our own data (the slug itself, and the tag code
 * for that slug, which is in the version controlled redirect table) and otherwise
 * declines. When the real scheme arrives, add it to `extraCodes` rather than
 * loosening the matching.
 */

/** Lowercased alphanumeric tokens. `TS-PS_100g` becomes ['ts','ps','100g']. */
export function tokenise(sku: string): string[] {
  return sku
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export interface SkuAttributionOptions {
  /** Every blend slug, from the frozen contract's Slug enum. */
  slugs: readonly string[];
  /** Tag code to slug, from the redirect table. For example ps -> persian-sunrise. */
  codeToSlug?: Readonly<Record<string, string>>;
  /**
   * Additional exact tokens mapped to slugs, for the client's real SKU scheme once
   * somebody tells us what it is. Checked last so it can extend but never override.
   */
  extraCodes?: Readonly<Record<string, string>>;
}

/**
 * Returns the slug this SKU belongs to, or undefined.
 *
 * Order of preference, most specific first, so a SKU that satisfies two rules
 * resolves the same way every time rather than depending on object key order.
 */
export function slugForSku(sku: unknown, options: SkuAttributionOptions): string | undefined {
  if (typeof sku !== 'string' || !sku.trim()) return undefined;

  const tokens = tokenise(sku);
  if (tokens.length === 0) return undefined;

  const joined = tokens.join('-');

  // 1. The whole slug appears as consecutive tokens. TREVEAN-PERSIAN-SUNRISE-100G.
  //    Longest first, so `north-african-night-market` is not shadowed by a shorter
  //    slug that happens to be a prefix of it.
  const bySlug = [...options.slugs].sort((a, b) => b.length - a.length);
  for (const slug of bySlug) {
    if (joined === slug || joined.includes(`${slug}-`) || joined.endsWith(`-${slug}`) || joined.startsWith(`${slug}-`)) {
      return slug;
    }
  }

  // 2. A tag code as a WHOLE token. TS-PS-100G resolves through ps. This is the rule
  //    that would actually have caught the two real SKUs the old code missed.
  const codeToSlug = options.codeToSlug ?? {};
  for (const token of tokens) {
    const slug = codeToSlug[token];
    if (slug) return slug;
  }

  // 3. Whatever the client's scheme turns out to be.
  const extra = options.extraCodes ?? {};
  for (const token of tokens) {
    const slug = extra[token];
    if (slug) return slug;
  }

  return undefined;
}

/**
 * Whether a Shopify product should be mirrored as something a customer can buy.
 *
 * **THIS IS LIVE TODAY, NOT HYPOTHETICAL.** The client said on Thursday 17 September
 * 2026: "The blends are drafts at the moment." A draft product cannot be purchased.
 * The previous handler ignored `status` entirely and defaulted `available` to true
 * when the field was absent, so a draft product would have been mirrored as in
 * stock, the page would have rendered an enabled reorder button, and the customer
 * would have reached a checkout that refuses.
 *
 * **A disabled button is a correct answer. A working button to a refusing checkout
 * is not.**
 */
export function isPurchasable(status: unknown, available: unknown): boolean {
  // Shopify sends active, draft or archived. Anything we do not recognise is treated
  // as not purchasable, because the failure of being too cautious is a disabled
  // button and the failure of being too generous is a dead checkout.
  //
  // Note the shape of this check. An earlier version read `typeof status === 'string'
  // && status !== 'active'`, which let a status that was PRESENT but not a string, a
  // number or an object, fall through to the availability check and come back
  // purchasable. Absent is the only value allowed to fall through, because absent
  // genuinely means an older payload that never carried the field.
  if (status !== undefined && status !== null) {
    if (typeof status !== 'string' || status.toLowerCase() !== 'active') return false;
  }

  // Absent means unknown, and unknown is not a reason to claim something is in stock.
  if (available === undefined || available === null) return false;

  return Boolean(available);
}
