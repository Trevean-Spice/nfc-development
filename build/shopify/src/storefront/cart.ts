/*
 * Storefront API cart building. Job two of the three in the Architecture document,
 * "Shopify Plus": anything richer than one tap reorder.
 *
 * The line that matters, and the reason this file is not the reorder path:
 *
 *   One tap reorder is a cart permalink. It is the primary conversion action on a page
 *   whose whole design exists to avoid a live call, so it must not depend on one.
 *
 * Everything in this file DOES depend on a live call. That is fine, because nothing in
 * this file is on the tap path. Multi item carts, discount codes and subscription selling
 * plans are all things a customer opts into after the page is readable, and each of them
 * is something a permalink genuinely cannot do:
 *
 *   - a permalink carries one discount code, applied at checkout, with no way to read back
 *     whether it was valid;
 *   - a permalink cannot attach a selling plan at all, so subscription selling is
 *     Storefront API or nothing;
 *   - a permalink gives no cart id, so nothing can be modified after it is built.
 *
 * The builders below are pure. They construct the request; the transport sends it. That
 * split is what makes them testable today with no store access, and it is the same split
 * as the Admin side.
 */

import { normaliseVariantId, parseGid, toGid } from '../ids.js';

export const CART_CREATE_MUTATION = `
mutation CartCreate($input: CartInput!) {
  cartCreate(input: $input) {
    cart {
      id
      checkoutUrl
      totalQuantity
      cost { subtotalAmount { amount currencyCode } totalAmount { amount currencyCode } }
      discountCodes { code applicable }
    }
    userErrors { field message }
  }
}
`.trim();

export interface StorefrontCartLine {
  /** Variant id in either form. */
  variantId: string;
  quantity: number;
  /** Selling plan id, numeric or GID. This is the thing a permalink cannot do. */
  sellingPlanId?: string | null;
  attributes?: Record<string, string>;
}

export interface CartCreateOptions {
  lines: StorefrontCartLine[];
  discountCodes?: string[];
  /** Cart level attributes. These persist through checkout onto the order. */
  attributes?: Record<string, string>;
  note?: string | null;
  buyerIdentity?: {
    countryCode?: string;
    /** Deliberately no email, phone, or customer access token. See the note below. */
  };
}

export class StorefrontCartError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'StorefrontCartError';
    this.code = code;
  }
}

function attributesToInput(attributes: Record<string, string> | undefined): Array<{ key: string; value: string }> | undefined {
  if (!attributes) return undefined;
  const entries = Object.entries(attributes).filter(([, v]) => typeof v === 'string');
  if (entries.length === 0) return undefined;
  // Sorted, so a cart built twice from the same inputs produces the same request. The same
  // reason the permalink sorts its query parameters.
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.map(([key, value]) => ({ key, value }));
}

function normaliseSellingPlan(value: string): string {
  if (parseGid(value, 'SellingPlan')) return value;
  if (/^[1-9][0-9]{0,19}$/.test(value)) return toGid('SellingPlan', value);
  throw new StorefrontCartError('selling_plan_invalid', `Not a Shopify selling plan id: ${value}`);
}

/**
 * Build the cartCreate request.
 *
 * NO CUSTOMER IDENTITY IS ACCEPTED. buyerIdentity takes a country code and nothing else:
 * no email, no phone, no customer access token. Subscription billing, customer accounts
 * and customer login are all explicitly out of scope, and reorder runs through Shopify's
 * own checkout, which means Shopify holds the customer relationship and this system holds
 * none of it. Widening this object is how that stops being true.
 */
export function buildCartCreate(options: CartCreateOptions): { query: string; variables: Record<string, unknown> } {
  if (!Array.isArray(options.lines) || options.lines.length === 0) {
    throw new StorefrontCartError('no_lines', 'A cart needs at least one line.');
  }

  const lines = options.lines.map((line) => {
    const variantId = normaliseVariantId(line.variantId);
    if (!variantId) {
      throw new StorefrontCartError('variant_id_invalid', `Not a Shopify variant id: ${String(line.variantId)}`);
    }
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new StorefrontCartError('quantity_invalid', 'Quantity must be a positive integer.');
    }
    const input: Record<string, unknown> = {
      merchandiseId: toGid('ProductVariant', variantId),
      quantity: line.quantity,
    };
    if (line.sellingPlanId) input['sellingPlanId'] = normaliseSellingPlan(line.sellingPlanId);
    const lineAttributes = attributesToInput(line.attributes);
    if (lineAttributes) input['attributes'] = lineAttributes;
    return input;
  });

  const input: Record<string, unknown> = { lines };

  if (options.discountCodes && options.discountCodes.length > 0) {
    const codes = options.discountCodes.filter((c) => typeof c === 'string' && c.trim() !== '');
    if (codes.length > 0) input['discountCodes'] = codes;
  }
  const attributes = attributesToInput(options.attributes);
  if (attributes) input['attributes'] = attributes;
  if (options.note) input['note'] = options.note;
  if (options.buyerIdentity?.countryCode) {
    input['buyerIdentity'] = { countryCode: options.buyerIdentity.countryCode.toUpperCase() };
  }

  return { query: CART_CREATE_MUTATION, variables: { input } };
}
