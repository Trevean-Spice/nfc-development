/**
 * products/update: what a verified delivery may change on a CATALOG# row, and nothing more.
 *
 * WHAT THIS REPLACES, AND WHY IT HAD TO GO (Wednesday 14 October 2026).
 *
 * The route did a full PutItem of the row and read availability from `variant.available`.
 * Shopify's REST product payload, which is what a products/update webhook delivers, does
 * not carry that field: it carries inventory_management, inventory_policy and
 * inventory_quantity. isPurchasable treats an absent value as unavailable, so every product
 * update would have marked the blend out of stock and disabled the reorder button, and the
 * PutItem would have dropped every attribute it did not name (variantPosition, the
 * 7 October provenance, anything written by hand).
 *
 * THE RULES ARE THE CATALOG SYNC'S, deliberately. build/shopify/src/sync/catalogWriter.ts
 * is the writer the scheduled catalog_sync function uses, and the two must not disagree
 * about a row, or the page flips between two answers every time one of them runs. This
 * package cannot import that one (separate package, separate Lambda archive), so the rules
 * are restated here and test/unit/shopifyCatalogMirror.test.ts reads the sync's source and
 * fails if the owned attribute list or the slug list drifts. The rules:
 *
 *   update an existing CATALOG#{contract slug} / v0 row only, never create one, never
 *   PutItem, never REMOVE, and SET only MIRROR_OWNED_ATTRIBUTES (never cartPermalinkUrl:
 *   null in the row so the API derives it from SHOPIFY_STORE_DOMAIN);
 *
 *   conditional on the row still existing, still being a CATALOG entity and, when it
 *   carries a product id, still mirroring the same product;
 *
 *   keep the variant the row already points at for as long as the product carries it, and
 *   skip rather than repoint when it is gone (repointing the reorder button is a person's
 *   decision);
 *
 *   availability from the three inventory signals, and false for any product whose status
 *   is not active (draft, archived);
 *
 *   a price that cannot be converted to minor units exactly is left out (last known price
 *   kept); a null compare at price is written (it clears an ended sale).
 *
 * IDEMPOTENT WITHOUT A DEDUPLICATION RECORD. Every write is SET of values derived from the
 * payload, so a duplicate delivery writes the same values again; only syncedAt and
 * syncSource advance, which they must, because syncedAt drives the staleness rule.
 */

export const CATALOG_PREFIX = 'CATALOG#';
export const CATALOG_ENTITY = 'CATALOG';

/** Identical to MIRROR_OWNED_ATTRIBUTES in build/shopify/src/sync/catalogWriter.ts. A test reads both. */
export const MIRROR_OWNED_ATTRIBUTES = [
  'sku',
  'shopifyProductId',
  'shopifyVariantId',
  'priceAmount',
  'priceCurrency',
  'compareAtAmount',
  'available',
  'inventoryStatus',
  'variantPosition',
  'syncedAt',
  'syncSource',
] as const;

export type MirrorOwnedAttribute = (typeof MIRROR_OWNED_ATTRIBUTES)[number];

type Scalar = string | number | boolean | null;

/* ----------------------------------------------------------------- identifiers */

const NUMERIC_ID = /^[1-9][0-9]{0,19}$/;

/** The numeric id from a GID or a bare number, or null. `gid://shopify/Product/1?x=y` is product 1. */
function numericId(value: unknown, resource: 'Product' | 'ProductVariant'): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (NUMERIC_ID.test(trimmed)) return trimmed;
  const prefix = `gid://shopify/${resource}/`;
  if (!trimmed.startsWith(prefix)) return null;
  const id = trimmed.slice(prefix.length).split('?')[0] ?? '';
  return NUMERIC_ID.test(id) ? id : null;
}

export function canonicalProductGid(value: unknown): string | null {
  const id = numericId(value, 'Product');
  return id ? `gid://shopify/Product/${id}` : null;
}

export function canonicalVariantGid(value: unknown): string | null {
  const id = numericId(value, 'ProductVariant');
  return id ? `gid://shopify/ProductVariant/${id}` : null;
}

/* ----------------------------------------------------------------------- money */

const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);
const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/** "18.00" in USD is 1800. Null when a digit would be lost, never a rounded number. */
export function decimalToMinorUnits(amount: unknown, currency: string): number | null {
  if (typeof amount !== 'string') return null;
  const match = DECIMAL.exec(amount.trim());
  if (!match) return null;
  const code = currency.toUpperCase();
  const exponent = ZERO_DECIMAL.has(code) ? 0 : THREE_DECIMAL.has(code) ? 3 : 2;
  const whole = match[1] ?? '';
  const fraction = match[2] ?? '';
  if (fraction.length > exponent && /[^0]/.test(fraction.slice(exponent))) return null;
  const combined = `${whole}${(fraction + '0'.repeat(exponent)).slice(0, exponent)}`;
  const value = Number.parseInt(combined.replace(/^0+(?=\d)/, ''), 10);
  return Number.isSafeInteger(value) ? value : null;
}

/* ------------------------------------------------------------- the REST payload */

export interface RestVariant {
  gid: string | null;
  sku: string | null;
  price: string | null;
  compareAtPrice: string | null;
  position: number | null;
  /** From the three inventory signals; null when the payload does not carry enough to decide. */
  available: boolean | null;
}

export interface RestProduct {
  gid: string | null;
  handle: string | null;
  status: string | null;
  tags: string[];
  variants: RestVariant[];
}

/**
 * Whether a variant can be bought, from Shopify's three separate signals. The same rule as
 * deriveAvailability in build/shopify/src/mirror/product.ts:
 *
 *   inventory_management null or absent  ->  not tracked, always purchasable
 *   inventory_policy continue            ->  overselling allowed, purchasable
 *   otherwise                            ->  purchasable when quantity is above zero
 */
export function deriveAvailability(variant: Record<string, unknown>): boolean | null {
  const management = variant['inventory_management'];
  if (management === null || management === undefined || management === '') return true;
  const policy = variant['inventory_policy'];
  if (policy === 'continue' || policy === 'CONTINUE') return true;
  const quantity = variant['inventory_quantity'];
  if (typeof quantity === 'number' && Number.isFinite(quantity)) return quantity > 0;
  return null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function normaliseRestProduct(payload: unknown): RestProduct {
  const body = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const rawVariants = Array.isArray(body['variants']) ? (body['variants'] as unknown[]) : [];
  const variants: RestVariant[] = rawVariants
    .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
    .map((v) => ({
      gid: canonicalVariantGid(v['admin_graphql_api_id']) ?? canonicalVariantGid(v['id']),
      sku: str(v['sku']),
      price: str(v['price']),
      compareAtPrice: str(v['compare_at_price']),
      position: num(v['position']),
      available: deriveAvailability(v),
    }));
  const rawTags = body['tags'];
  const tags =
    typeof rawTags === 'string'
      ? rawTags.split(',').map((t) => t.trim()).filter(Boolean)
      : Array.isArray(rawTags)
        ? rawTags.filter((t): t is string => typeof t === 'string')
        : [];
  return {
    gid: canonicalProductGid(body['admin_graphql_api_id']) ?? canonicalProductGid(body['id']),
    handle: str(body['handle']),
    status: str(body['status']),
    tags,
    variants,
  };
}

/* -------------------------------------------------------- which row, which variant */

export type SlugResolution = { slug: string; via: 'row_product_id' | 'handle' | 'tag' } | { slug: null };

/**
 * Which blend a product belongs to. The rows' own product ids first (the explicit map the
 * 7 October rows already carry, the same map the sync builds with productMapFromRows), then
 * the handle, then a tag. No fuzzy matching.
 */
export function resolveSlug(product: RestProduct, rows: Map<string, Record<string, unknown>>, slugs: readonly string[]): SlugResolution {
  if (product.gid) {
    for (const [slug, row] of rows) {
      if (canonicalProductGid(row['shopifyProductId']) === product.gid) return { slug, via: 'row_product_id' };
    }
  }
  if (product.handle && slugs.includes(product.handle)) return { slug: product.handle, via: 'handle' };
  const tag = product.tags.find((t) => slugs.includes(t));
  if (tag) return { slug: tag, via: 'tag' };
  return { slug: null };
}

/** The row's own variant while the product still has it; otherwise the first by position. */
export function selectVariant(product: RestProduct, preferredVariantId: unknown): RestVariant | null {
  if (product.variants.length === 0) return null;
  const wanted = canonicalVariantGid(preferredVariantId);
  if (wanted) {
    const pinned = product.variants.find((v) => v.gid === wanted);
    if (pinned) return pinned;
  }
  const ordered = [...product.variants].sort(
    (a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER),
  );
  return ordered[0] ?? null;
}

/* --------------------------------------------------------------------- the plan */

export type SkipReason = 'row_missing' | 'not_a_catalog_row' | 'product_id_mismatch' | 'variant_id_mismatch' | 'no_variant';

export interface UpdatePlan {
  action: 'update';
  slug: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  warnings: string[];
  /** DocumentClient UpdateCommand input, minus TableName and Key. */
  update: {
    UpdateExpression: string;
    ConditionExpression: string;
    ExpressionAttributeNames: Record<string, string>;
    ExpressionAttributeValues: Record<string, Scalar>;
  };
}

export type ProductPlan = UpdatePlan | { action: 'skip'; slug: string; reason: SkipReason; detail: string };

export interface PlanOptions {
  syncedAt: string;
  syncSource: string;
  currency: string;
}

/**
 * What a products/update delivery would do to one row, given the row as it is now. Pure.
 * Same decisions, in the same order, as planCatalogWrite in the catalog sync.
 */
export function planProductUpdate(
  product: RestProduct,
  slug: string,
  current: Record<string, unknown> | undefined,
  options: PlanOptions,
): ProductPlan {
  if (!current) {
    return { action: 'skip', slug, reason: 'row_missing', detail: `No CATALOG# row exists for ${slug}. Webhooks update rows and never create them.` };
  }
  if (current['entityType'] !== CATALOG_ENTITY) {
    return { action: 'skip', slug, reason: 'not_a_catalog_row', detail: `The item at CATALOG#${slug} is not a CATALOG entity. Not touched.` };
  }

  const variant = selectVariant(product, current['shopifyVariantId']);
  if (!variant || !variant.gid) {
    return { action: 'skip', slug, reason: 'no_variant', detail: `The Shopify product for ${slug} carried no usable variant. Row left as it was.` };
  }

  const storedProductId = str(current['shopifyProductId']);
  if (storedProductId && canonicalProductGid(storedProductId) !== product.gid) {
    return {
      action: 'skip',
      slug,
      reason: 'product_id_mismatch',
      detail: `The row for ${slug} mirrors ${storedProductId} and the delivery is for ${product.gid ?? 'a product with no id'}. Not repointed.`,
    };
  }

  const storedVariantId = str(current['shopifyVariantId']);
  if (storedVariantId && canonicalVariantGid(storedVariantId) !== variant.gid) {
    return {
      action: 'skip',
      slug,
      reason: 'variant_id_mismatch',
      detail: `The row for ${slug} points at ${storedVariantId}, which the product no longer carries. Not repointed.`,
    };
  }

  const warnings: string[] = [];
  if (product.variants.length > 1) {
    warnings.push(`Product for ${slug} has ${product.variants.length} variants; the mirror keeps ${variant.gid}.`);
  }

  // Not ACTIVE (draft, archived) cannot be bought, whatever the variant says about stock.
  // Absent status falls through, because absent means an older payload, not a draft.
  const notActive = product.status !== null && product.status.toLowerCase() !== 'active';
  const available = notActive ? false : variant.available;

  const values: Partial<Record<MirrorOwnedAttribute, Scalar>> = {
    sku: variant.sku,
    shopifyProductId: product.gid,
    shopifyVariantId: variant.gid,
    compareAtAmount: variant.compareAtPrice === null ? null : decimalToMinorUnits(variant.compareAtPrice, options.currency),
    available: available === true,
    inventoryStatus: available === null ? 'unknown' : available ? 'in_stock' : 'out_of_stock',
    variantPosition: variant.position,
  };
  const priceAmount = decimalToMinorUnits(variant.price, options.currency);
  if (priceAmount !== null) {
    values.priceAmount = priceAmount;
    values.priceCurrency = options.currency;
  } else if (variant.price !== null) {
    warnings.push(`Price ${JSON.stringify(variant.price)} for ${slug} is not exact in minor units. Last known price kept.`);
  }

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [name, to] of Object.entries(values)) {
    const from = current[name] ?? null;
    if (from !== to) changes[name] = { from, to };
  }

  values.syncedAt = options.syncedAt;
  values.syncSource = options.syncSource;

  const names: Record<string, string> = { '#pk': 'pk', '#entityType': 'entityType' };
  const exprValues: Record<string, Scalar> = { ':catalogPrefix': CATALOG_PREFIX, ':catalogEntity': CATALOG_ENTITY };
  const sets: string[] = [];
  for (const name of MIRROR_OWNED_ATTRIBUTES) {
    if (!(name in values)) continue;
    names[`#${name}`] = name;
    exprValues[`:${name}`] = values[name] as Scalar;
    sets.push(`#${name} = :${name}`);
  }
  const conditions = ['attribute_exists(#pk)', 'begins_with(#pk, :catalogPrefix)', '#entityType = :catalogEntity'];
  if (storedProductId) {
    names['#shopifyProductId'] = 'shopifyProductId';
    exprValues[':expectedProductId'] = storedProductId;
    conditions.push('#shopifyProductId = :expectedProductId');
  }

  return {
    action: 'update',
    slug,
    changes,
    warnings,
    update: {
      UpdateExpression: `SET ${sets.join(', ')}`,
      ConditionExpression: conditions.join(' AND '),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: exprValues,
    },
  };
}

/* ------------------------------------------------------------------- one delivery */

export interface ProductUpdateDeps {
  slugs: readonly string[];
  readRows(slugs: readonly string[]): Promise<Map<string, Record<string, unknown>>>;
  update(slug: string, update: UpdatePlan['update']): Promise<void>;
  isConditionFailure(error: unknown): boolean;
  syncedAt: string;
  currency: string;
}

export type ProductUpdateOutcome =
  | { outcome: 'unmatched'; handle: string | null }
  | { outcome: 'skipped'; slug: string; reason: SkipReason; detail: string }
  | { outcome: 'updated'; slug: string; via: string; changes: Record<string, { from: unknown; to: unknown }>; warnings: string[] }
  | { outcome: 'condition_failed'; slug: string };

export async function applyProductUpdate(payload: unknown, deps: ProductUpdateDeps): Promise<ProductUpdateOutcome> {
  const product = normaliseRestProduct(payload);
  const rows = await deps.readRows(deps.slugs);
  const resolution = resolveSlug(product, rows, deps.slugs);
  if (resolution.slug === null) return { outcome: 'unmatched', handle: product.handle };

  const plan = planProductUpdate(product, resolution.slug, rows.get(resolution.slug), {
    syncedAt: deps.syncedAt,
    syncSource: `shopify-webhook-${deps.syncedAt}`,
    currency: deps.currency,
  });
  if (plan.action === 'skip') return { outcome: 'skipped', slug: plan.slug, reason: plan.reason, detail: plan.detail };

  try {
    await deps.update(plan.slug, plan.update);
  } catch (error) {
    if (deps.isConditionFailure(error)) return { outcome: 'condition_failed', slug: plan.slug };
    throw error;
  }
  return { outcome: 'updated', slug: plan.slug, via: resolution.via, changes: plan.changes, warnings: plan.warnings };
}
