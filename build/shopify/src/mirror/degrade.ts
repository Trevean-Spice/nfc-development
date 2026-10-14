/*
 * Degradation. The rule that turns "Shopify had an incident" into "the price label is a
 * little old" instead of "the page is broken".
 *
 * The Architecture document, "Shopify Plus", states the requirement precisely: the catalog
 * is mirrored so that Shopify latency is never inside the 2.0 second budget and a Shopify
 * incident degrades a price label rather than breaking a page. The mirror is the mechanism
 * and this file is the policy.
 *
 * The property worth defending, and the one easiest to lose in a refactor:
 *
 *   A STALE ENTRY KEEPS ITS CART PERMALINK.
 *
 * The permalink is a static URL derived from a variant id. It needs no API call, so a
 * Shopify sync outage has no bearing on whether it works, and blanking it because the
 * price is old would disable the primary conversion action for a reason that does not
 * apply to it. There is a test asserting exactly this, and it is there because the
 * tempting one-line "if stale, clear everything" is wrong in a way nobody would notice
 * until reorders stopped.
 */

import type { CatalogEntry, CatalogMirrorRecord } from '../types.js';

export interface DegradeOptions {
  /**
   * How old a successful sync may be before the entry is marked stale.
   *
   * Default is three hours, which is a deliberate multiple of the proposed hourly
   * schedule: one missed run is noise, three consecutive misses is a fault worth telling
   * the reader about. The number is configuration because the sync cadence is still a
   * decision for the client. See the README, "What the client must decide".
   */
  stalenessMs?: number;
  /** Now, injected so the rule is testable without waiting three hours. */
  now: Date;
}

export const DEFAULT_STALENESS_MS = 3 * 60 * 60 * 1000;

/**
 * Turn a stored mirror record into the entry the API serves.
 *
 * Two changes on staleness, and no others:
 *   1. stale becomes true;
 *   2. inventoryStatus becomes 'unknown', because availability is the field that goes bad
 *      fastest and claiming in_stock from a three hour old read is a claim we cannot
 *      support. This matches the frozen API contract's own staleMirror example, which
 *      carries available true alongside inventoryStatus unknown and stale true.
 *
 * Price is left as it was. A slightly old price is useful and honest when labelled stale;
 * removing it leaves a blank where a number was, which reads as broken rather than as old.
 */
export function toApiCatalogEntry(record: CatalogMirrorRecord, options: DegradeOptions): CatalogEntry {
  const stalenessMs = options.stalenessMs ?? DEFAULT_STALENESS_MS;
  const syncedAtMs = Date.parse(record.syncedAt);
  const stale = Number.isNaN(syncedAtMs) ? true : options.now.getTime() - syncedAtMs > stalenessMs;

  return {
    slug: record.slug,
    sku: record.sku,
    shopifyProductId: record.shopifyProductId,
    shopifyVariantId: record.shopifyVariantId,
    price: record.price,
    compareAtPrice: record.compareAtPrice,
    available: record.available,
    inventoryStatus: stale ? 'unknown' : record.inventoryStatus,
    // Unconditional. See the note at the top of this file.
    cartPermalinkUrl: record.cartPermalinkUrl,
    syncedAt: record.syncedAt,
    stale,
  };
}

/**
 * The entry to serve when there is no mirror record at all, for a slug that is genuinely
 * one of ours.
 *
 * Returned rather than a 404 on the catalog read, because a missing mirror row is our
 * problem and not the customer's: the page has already painted, and the honest answer is
 * "no price, nothing to reorder", which is exactly the state every blend is in today.
 */
export function emptyCatalogEntry(slug: string, syncedAt: string): CatalogEntry {
  return {
    slug,
    sku: null,
    shopifyProductId: null,
    shopifyVariantId: null,
    price: null,
    compareAtPrice: null,
    available: false,
    inventoryStatus: 'unknown',
    cartPermalinkUrl: null,
    syncedAt,
    stale: true,
  };
}
