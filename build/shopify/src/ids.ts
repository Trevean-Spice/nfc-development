/*
 * Shopify identifiers, and the conversion between the two forms that matter.
 *
 * The frozen API contract stores the GraphQL global id, for example
 * gid://shopify/ProductVariant/41802938471233, and the cart permalink in the very same
 * record uses the bare numeric form, 41802938471233. Both appear in the contract's own
 * CatalogEntry example. Converting between them is therefore not a detail, it is the join
 * between the two halves of this package, and it is the single most likely place for a
 * quiet mistake to put a customer in front of the wrong product or a broken cart.
 *
 * So the numeric form is validated rather than extracted. A variant id that reaches URL
 * construction with a slash, a question mark or a semicolon in it does not produce a
 * broken link, it produces a link to somewhere else, and the somewhere else is chosen by
 * whoever controlled the input.
 */

export type ShopifyResource = 'Product' | 'ProductVariant' | 'SellingPlan' | 'Cart' | 'Order';

/**
 * A Shopify numeric id. Digits only, no leading zero, at most 20 digits so it cannot be
 * used to smuggle an unbounded string into a URL path segment.
 */
const NUMERIC_ID = /^[1-9][0-9]{0,19}$/;

const GID_PREFIX = 'gid://shopify/';

export function isNumericId(value: unknown): value is string {
  return typeof value === 'string' && NUMERIC_ID.test(value);
}

/** gid://shopify/ProductVariant/41802938471233 -> 41802938471233 */
export function parseGid(gid: string, expected?: ShopifyResource): { resource: string; id: string } | null {
  if (typeof gid !== 'string' || !gid.startsWith(GID_PREFIX)) return null;
  const rest = gid.slice(GID_PREFIX.length);
  // A gid may carry a query string, for example ?namespace=. Anything after ? is not part
  // of the identity and is dropped rather than concatenated into an id.
  const withoutQuery = rest.split('?')[0] ?? '';
  const parts = withoutQuery.split('/');
  if (parts.length !== 2) return null;
  const [resource, id] = parts as [string, string];
  if (!resource || !NUMERIC_ID.test(id)) return null;
  if (expected && resource !== expected) return null;
  return { resource, id };
}

/** 41802938471233 -> gid://shopify/ProductVariant/41802938471233 */
export function toGid(resource: ShopifyResource, id: string): string {
  if (!isNumericId(id)) {
    throw new TypeError(`Not a Shopify numeric id: ${JSON.stringify(id)}`);
  }
  return `${GID_PREFIX}${resource}/${id}`;
}

/**
 * Accept either form of a variant id and return the numeric form, or null.
 *
 * Null rather than a throw, because the caller on the page build path has a legitimate
 * null case today: the store is not accessible and every fixture carries a null variant
 * id. That case must produce a disabled reorder button, not a crashed build.
 */
export function normaliseVariantId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (isNumericId(trimmed)) return trimmed;
  const parsed = parseGid(trimmed, 'ProductVariant');
  return parsed ? parsed.id : null;
}

/** Same, for products. Used only for recording, never for URL construction. */
export function normaliseProductId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (isNumericId(trimmed)) return trimmed;
  const parsed = parseGid(trimmed, 'Product');
  return parsed ? parsed.id : null;
}

/** The canonical GID form for storage, given either input form. Null when unresolvable. */
export function canonicalVariantGid(value: unknown): string | null {
  const numeric = normaliseVariantId(value);
  return numeric ? toGid('ProductVariant', numeric) : null;
}

export function canonicalProductGid(value: unknown): string | null {
  const numeric = normaliseProductId(value);
  return numeric ? toGid('Product', numeric) : null;
}
