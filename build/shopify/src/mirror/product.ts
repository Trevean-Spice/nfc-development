/*
 * The normalised product, which is the seam between "what Shopify sent" and "what the
 * mirror stores".
 *
 * Shopify sends two different shapes for the same product. The Admin GraphQL API returns
 * camelCase nodes with MoneyV2 objects and GID identifiers; a products/update webhook
 * delivers the REST representation, snake_case, with decimal strings and numeric ids. If
 * each one mapped straight to the mirror record there would be two copies of every rule
 * about price, availability and variant selection, and they would agree until the day they
 * did not.
 *
 * So both adapters produce this shape, and exactly one mapper turns this shape into a
 * mirror record. Every rule that has a business consequence lives once, below.
 */

import { canonicalProductGid, canonicalVariantGid } from '../ids.js';

export interface NormalisedVariant {
  /** Canonical GID, gid://shopify/ProductVariant/{id}. */
  gid: string | null;
  sku: string | null;
  /** Decimal string exactly as Shopify sent it. Converted to minor units by the mapper. */
  price: string | null;
  compareAtPrice: string | null;
  currency: string | null;
  position: number | null;
  /**
   * Availability, already reduced from Shopify's three signals by the rule below, or null
   * when the source did not carry enough to decide.
   */
  available: boolean | null;
  inventoryQuantity: number | null;
}

export interface NormalisedProduct {
  gid: string | null;
  handle: string | null;
  title: string | null;
  status: string | null;
  tags: string[];
  variants: NormalisedVariant[];
}

/**
 * Whether a variant can be bought, from Shopify's three separate signals.
 *
 * This looks like an implementation detail and is not. Getting it wrong in the permissive
 * direction shows "in stock" on a page for a jar nobody can buy. Getting it wrong in the
 * strict direction disables the reorder button, which is the primary conversion action, on
 * a product that is perfectly available.
 *
 *   inventory_management null  ->  Shopify is not tracking inventory for this variant, so
 *                                  it is always purchasable. This is the common case for a
 *                                  small catalog and the one most often mis-modelled.
 *   inventory_policy 'continue' -> overselling is allowed, so purchasable regardless of
 *                                  quantity.
 *   otherwise                   -> purchasable when quantity is above zero.
 */
export function deriveAvailability(input: {
  inventoryManagement?: string | null;
  inventoryPolicy?: string | null;
  inventoryQuantity?: number | null;
  /** Storefront style boolean, when the source provides one directly. */
  availableForSale?: boolean | null;
}): boolean | null {
  if (typeof input.availableForSale === 'boolean') return input.availableForSale;
  if (input.inventoryManagement === null || input.inventoryManagement === undefined || input.inventoryManagement === '') {
    return true;
  }
  if (input.inventoryPolicy === 'continue' || input.inventoryPolicy === 'CONTINUE') return true;
  if (typeof input.inventoryQuantity === 'number') return input.inventoryQuantity > 0;
  return null;
}

export interface SlugResolutionOptions {
  knownSlugs: readonly string[];
  /**
   * Explicit product to blend mapping, keyed by Shopify product handle or GID. This is the
   * mechanism that will actually be used in production, because a Shopify handle is a
   * marketing URL and there is no reason for it to equal our blend slug. It is empty until
   * the store is visible, which is why the handle and tag fallbacks exist.
   */
  productToSlug?: Record<string, string>;
}

export type SlugResolution =
  | { slug: string; via: 'explicit_map' | 'handle' | 'tag' }
  | { slug: null; via: 'unresolved' };

/**
 * Which blend a Shopify product belongs to.
 *
 * Deliberately three ordered strategies rather than one guess, and deliberately no fuzzy
 * matching. Substring matching a SKU against a slug prefix will map TRV-SR-60G to
 * silk-road and also, one day, map something else to it, and the symptom is a price from
 * the wrong blend on a shipped jar's page.
 */
export function resolveSlug(product: NormalisedProduct, options: SlugResolutionOptions): SlugResolution {
  const map = options.productToSlug ?? {};
  const known = new Set(options.knownSlugs);

  for (const key of [product.gid, product.handle]) {
    if (key && Object.prototype.hasOwnProperty.call(map, key)) {
      const mapped = map[key];
      if (mapped && known.has(mapped)) return { slug: mapped, via: 'explicit_map' };
    }
  }
  if (product.handle && known.has(product.handle)) return { slug: product.handle, via: 'handle' };
  const tag = product.tags.find((t) => known.has(t));
  if (tag) return { slug: tag, via: 'tag' };
  return { slug: null, via: 'unresolved' };
}

export interface VariantSelectionOptions {
  /** Preferred SKU per blend slug, when Trevean sells more than one size. */
  preferredSku?: string | null;
}

/**
 * Which variant a blend page reorders.
 *
 * One jar, one variant, is the assumption the frozen contract encodes: CatalogEntry
 * carries a single sku and a single shopifyVariantId. If the store turns out to sell
 * several sizes of a blend, that assumption is a contract question rather than a code
 * question, and this function's job is to make the choice explicit and recorded rather
 * than accidental. The position is written onto the mirror record so a later change of
 * rule is auditable against what was actually served.
 */
export function selectVariant(
  product: NormalisedProduct,
  options: VariantSelectionOptions = {},
): NormalisedVariant | null {
  if (product.variants.length === 0) return null;
  if (options.preferredSku) {
    const bySku = product.variants.find((v) => v.sku === options.preferredSku);
    if (bySku) return bySku;
  }
  const ordered = [...product.variants].sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER));
  return ordered[0] ?? null;
}

/** Normalise identifiers on the way in, so nothing downstream has to care which form arrived. */
export function canonicaliseProduct(product: NormalisedProduct): NormalisedProduct {
  return {
    ...product,
    gid: canonicalProductGid(product.gid),
    variants: product.variants.map((v) => ({ ...v, gid: canonicalVariantGid(v.gid) })),
  };
}
