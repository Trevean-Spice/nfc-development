/*
 * orders/create: reorder attribution, per SKU.
 *
 * WHAT THIS FUNCTION IS ALLOWED TO READ, and it is a short list on purpose:
 *
 *   created_at            for the rollup day
 *   line_items[].sku      to identify the blend
 *   line_items[].quantity to count
 *   note_attributes[]     for the channel, when the cart carried one
 *
 * That is all. An orders/create payload is the largest concentration of customer personal
 * data anywhere near this system: email, phone, billing address, shipping address, full
 * name, IP address, browser fingerprint, and the whole customer object. The Architecture
 * document, "Security and privacy", says no PII, no IP storage, and no customer accounts,
 * and the Data model document says no customer PII and no IP address in any table.
 *
 * The way that commitment gets broken is not a decision, it is a convenience: someone
 * passes the whole payload through to a logger or a rollup writer and personal data lands
 * in DynamoDB or in CloudWatch, where it is now a retention and a deletion problem. So the
 * extraction is an allowlist rather than a redaction, and the test asserts that a payload
 * stuffed with personal data produces output containing none of it.
 *
 * Attribution is per SKU because tag encoding is per SKU. There is no per-tag identifier
 * and no chip UID available to the page, so an order can be attributed to a blend and to a
 * day and no further. That is a property of 1,000 tags encoded on 24 July 2026, not a
 * limitation of this code, and no amount of work here improves it.
 */

import type { OrderAttributionResult, ReorderAttribution } from '../types.js';

export interface OrderAttributionOptions {
  /**
   * SKU to blend slug. Explicit, never inferred.
   *
   * Empty until Shopify Plus store access lands, because the real SKUs are a property of
   * the store and are not knowable from here. Every order therefore lands in unmatchedSkus
   * today, which is the honest state and is visible rather than silent. Build it from the
   * catalog mirror with skuMapFromCatalog once the mirror is populated.
   */
  skuToSlug: Record<string, string>;
  /** Case sensitivity of SKU matching. Shopify SKUs are case sensitive; default false. */
  caseInsensitive?: boolean;
}

const CHANNELS = new Set(['nfc', 'qr', 'direct']);

interface LineItem {
  sku?: unknown;
  quantity?: unknown;
}

interface NoteAttribute {
  name?: unknown;
  value?: unknown;
}

/** UTC calendar day from an ISO timestamp. The rollup partition key, nothing more. */
function dayOf(createdAt: unknown): string | null {
  if (typeof createdAt !== 'string') return null;
  const ms = Date.parse(createdAt);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The channel, if the cart carried one.
 *
 * Only present when the permalink was built in cart-attributes mode, because Shopify does
 * not persist an arbitrary query parameter onto an order. In the frozen contract's default
 * shape, channel=nfc on the permalink is inert and this returns 'unknown'. See the README,
 * "Two gaps".
 */
export function channelFromNoteAttributes(payload: unknown): ReorderAttribution['channel'] {
  const attributes = (payload as { note_attributes?: unknown })?.note_attributes;
  if (!Array.isArray(attributes)) return 'unknown';
  for (const raw of attributes as NoteAttribute[]) {
    if (raw?.name !== 'channel') continue;
    const value = typeof raw.value === 'string' ? raw.value.toLowerCase() : '';
    if (CHANNELS.has(value)) return value as ReorderAttribution['channel'];
  }
  return 'unknown';
}

export function attributeOrder(payload: unknown, options: OrderAttributionOptions): OrderAttributionResult {
  const warnings: string[] = [];
  const attributions: ReorderAttribution[] = [];
  const unmatchedSkus: string[] = [];

  const occurredOn = dayOf((payload as { created_at?: unknown })?.created_at);
  if (!occurredOn) {
    return {
      attributions: [],
      unmatchedSkus: [],
      warnings: ['Order carried no usable created_at, so it cannot be attributed to a day. Not counted.'],
    };
  }

  const rawLines = (payload as { line_items?: unknown })?.line_items;
  if (!Array.isArray(rawLines)) {
    return { attributions: [], unmatchedSkus: [], warnings: ['Order carried no line_items array.'] };
  }

  const channel = channelFromNoteAttributes(payload);

  const lookup = options.caseInsensitive
    ? new Map(Object.entries(options.skuToSlug).map(([k, v]) => [k.toLowerCase(), v]))
    : new Map(Object.entries(options.skuToSlug));

  // Several lines can carry the same SKU on one order. They are summed, so the rollup
  // counts units rather than line rows.
  const totals = new Map<string, { slug: string; sku: string; quantity: number }>();

  for (const raw of rawLines as LineItem[]) {
    const sku = typeof raw?.sku === 'string' && raw.sku !== '' ? raw.sku : null;
    if (!sku) {
      warnings.push('A line item carried no SKU and cannot be attributed. Not counted.');
      continue;
    }
    const quantity = typeof raw.quantity === 'number' && Number.isInteger(raw.quantity) && raw.quantity > 0 ? raw.quantity : null;
    if (quantity === null) {
      warnings.push(`Line item ${sku} carried no usable quantity. Not counted.`);
      continue;
    }
    const slug = lookup.get(options.caseInsensitive ? sku.toLowerCase() : sku);
    if (!slug) {
      if (!unmatchedSkus.includes(sku)) unmatchedSkus.push(sku);
      continue;
    }
    const existing = totals.get(sku);
    if (existing) existing.quantity += quantity;
    else totals.set(sku, { slug, sku, quantity });
  }

  for (const entry of totals.values()) {
    attributions.push({ blendSlug: entry.slug, sku: entry.sku, quantity: entry.quantity, channel, occurredOn });
  }

  attributions.sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0));
  return { attributions, unmatchedSkus, warnings };
}

/** Build the SKU map from mirror records, so the mapping comes from the store rather than a guess. */
export function skuMapFromCatalog(entries: Array<{ slug: string; sku: string | null }>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of entries) {
    if (entry.sku) map[entry.sku] = entry.slug;
  }
  return map;
}
