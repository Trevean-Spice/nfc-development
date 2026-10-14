import { canonicalVariantGid } from './shopifyCatalogMirror.js';
import { slugForSku, type SkuAttributionOptions } from './skuAttribution.js';

/**
 * orders/create: which blends an order bought, and how many units, per UTC day.
 *
 * WHAT THIS READS, and it is an allowlist on purpose: created_at, and line_items[].variant_id,
 * .sku and .quantity. An orders/create payload carries the customer's name, email, phone,
 * addresses and IP; none of it is read, logged or stored. The Data model document says no
 * customer PII in any table.
 *
 * HOW A LINE IS MATCHED, most certain first:
 *
 *   1. variant_id equal to a CATALOG# row's shopifyVariantId. The 7 October rows carry the
 *      variant ids verified against the live store (D64, D65), and that is exactly what a
 *      reorder permalink puts in the cart, so this is the match that counts reorders.
 *   2. sku equal to a row's sku, exactly. The mirror's SKU came from the store.
 *   3. slugForSku: whole token rules on the SKU (the slug, or a tag code), never substrings.
 *
 * The day is the order's own created_at, not the delivery time: Shopify retries a failed
 * delivery for hours, and a retry must not move an order into a later day.
 */

export interface OrderLineTotals {
  slug: string;
  units: number;
}

export interface OrderAttribution {
  day: string | null;
  bySlug: OrderLineTotals[];
  unmatchedLines: number;
  unusableLines: number;
}

export function dayOf(createdAt: unknown): string | null {
  if (typeof createdAt !== 'string') return null;
  const ms = Date.parse(createdAt);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

export function attributeOrderLines(
  payload: unknown,
  rows: Map<string, Record<string, unknown>>,
  skuOptions: SkuAttributionOptions,
): OrderAttribution {
  const body = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const day = dayOf(body['created_at']);
  const lines = Array.isArray(body['line_items']) ? (body['line_items'] as unknown[]) : [];

  const byVariant = new Map<string, string>();
  const bySku = new Map<string, string>();
  for (const [slug, row] of rows) {
    const variant = canonicalVariantGid(row['shopifyVariantId']);
    if (variant) byVariant.set(variant, slug);
    if (typeof row['sku'] === 'string' && row['sku'] !== '') bySku.set(row['sku'] as string, slug);
  }

  const totals = new Map<string, number>();
  let unmatchedLines = 0;
  let unusableLines = 0;

  for (const raw of lines) {
    const line = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const quantity = line['quantity'];
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) {
      unusableLines += 1;
      continue;
    }
    const variant = canonicalVariantGid(line['variant_id']);
    const sku = typeof line['sku'] === 'string' && line['sku'] !== '' ? (line['sku'] as string) : null;
    const slug =
      (variant ? byVariant.get(variant) : undefined) ??
      (sku ? bySku.get(sku) : undefined) ??
      (sku ? slugForSku(sku, skuOptions) : undefined);
    if (!slug) {
      unmatchedLines += 1;
      continue;
    }
    totals.set(slug, (totals.get(slug) ?? 0) + quantity);
  }

  const bySlug = [...totals.entries()]
    .map(([slug, units]) => ({ slug, units }))
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return { day, bySlug, unmatchedLines, unusableLines };
}
