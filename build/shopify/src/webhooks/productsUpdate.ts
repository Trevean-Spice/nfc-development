/*
 * products/update: keep the catalog mirror fresh between scheduled syncs.
 *
 * The payload is Shopify's REST product representation, snake_case, with decimal price
 * strings and numeric ids. This module does nothing but turn that into the normalised
 * product shape; every rule about price, availability, variant selection and permalink
 * construction lives in the mirror mapper, so the webhook path and the scheduled sync path
 * cannot drift apart.
 *
 * The handler is a pure function of the parsed payload. It performs no write. The caller
 * verifies the signature over the raw body first, parses second, calls this third, and
 * persists fourth, and that order is the point.
 */

import { mapProductToMirror, type MapOptions, type MapResult } from '../mirror/map.js';
import { deriveAvailability, resolveSlug, type NormalisedProduct, type NormalisedVariant, type SlugResolutionOptions } from '../mirror/product.js';

interface RestVariant {
  admin_graphql_api_id?: unknown;
  id?: unknown;
  sku?: unknown;
  price?: unknown;
  compare_at_price?: unknown;
  position?: unknown;
  inventory_management?: unknown;
  inventory_policy?: unknown;
  inventory_quantity?: unknown;
}

interface RestProduct {
  admin_graphql_api_id?: unknown;
  id?: unknown;
  handle?: unknown;
  title?: unknown;
  status?: unknown;
  tags?: unknown;
  variants?: unknown;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The REST payload does not carry a currency on the variant. It is the shop's currency,
 * which is a property of the store rather than of the product, so it comes from
 * configuration. Getting this from the payload is not possible and pretending otherwise
 * would produce a silently wrong currency code on the mirror.
 */
export function normaliseRestProduct(payload: unknown): NormalisedProduct {
  const product = (payload ?? {}) as RestProduct;
  const rawVariants = Array.isArray(product.variants) ? (product.variants as RestVariant[]) : [];

  const variants: NormalisedVariant[] = rawVariants.map((v) => ({
    gid: str(v.admin_graphql_api_id) ?? (num(v.id) !== null ? String(v.id) : null),
    sku: str(v.sku),
    price: str(v.price),
    compareAtPrice: str(v.compare_at_price),
    currency: null,
    position: num(v.position),
    available: deriveAvailability({
      inventoryManagement: typeof v.inventory_management === 'string' ? v.inventory_management : null,
      inventoryPolicy: typeof v.inventory_policy === 'string' ? v.inventory_policy : null,
      inventoryQuantity: num(v.inventory_quantity),
    }),
    inventoryQuantity: num(v.inventory_quantity),
  }));

  const tags = typeof product.tags === 'string'
    ? product.tags.split(',').map((t) => t.trim()).filter((t) => t !== '')
    : Array.isArray(product.tags)
      ? (product.tags as unknown[]).filter((t): t is string => typeof t === 'string')
      : [];

  return {
    gid: str(product.admin_graphql_api_id) ?? (num(product.id) !== null ? String(product.id) : null),
    handle: str(product.handle),
    title: str(product.title),
    status: str(product.status),
    tags,
    variants,
  };
}

export type ProductsUpdateResult =
  | { matched: true; slug: string; via: string; result: MapResult }
  | { matched: false; reason: 'unresolved_slug'; handle: string | null; tags: string[] };

export function handleProductsUpdate(
  payload: unknown,
  options: SlugResolutionOptions & Omit<MapOptions, 'slug' | 'syncSource'> & { syncSource?: MapOptions['syncSource'] },
): ProductsUpdateResult {
  const product = normaliseRestProduct(payload);
  const resolution = resolveSlug(product, options);

  if (resolution.slug === null) {
    // Not one of ours, or a product to blend mapping that has not been configured. The
    // caller acknowledges it so Shopify stops retrying, and records it so a mismatch
    // between the store and the blend list is visible rather than silent.
    return { matched: false, reason: 'unresolved_slug', handle: product.handle, tags: product.tags };
  }

  const result = mapProductToMirror(product, {
    ...options,
    slug: resolution.slug,
    syncSource: options.syncSource ?? 'webhook',
  });

  return { matched: true, slug: resolution.slug, via: resolution.via, result };
}
