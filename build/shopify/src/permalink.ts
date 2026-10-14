/*
 * Cart permalink construction. Job one of the three in the Architecture document,
 * "Shopify Plus".
 *
 * One-tap reorder is a cart permalink: a URL that pre-fills a cart and drops the customer
 * into checkout. Zero API calls, zero client credentials, zero latency, nothing to fail at
 * request time, and it bakes into the pre-rendered page. Deliberately boring, and the
 * boring is the point. It is the primary conversion action on a page whose whole design
 * exists to avoid a live call, so it must not depend on one.
 *
 * This module is pure string building. It has no network, no credentials, no clock and no
 * configuration beyond what is passed in, which is exactly why it is fully buildable and
 * fully testable today with no Shopify Plus store access.
 *
 * THE SECURITY PROPERTY, stated because it is the reason for the validation below.
 *
 * The output of this function is an href on a page a customer taps two seconds after
 * touching a jar. Every component that reaches it is validated as a whole value, never
 * merely interpolated:
 *
 *   - the storefront base must be https, must have no path, query, fragment, credentials
 *     or non-default port, and must be on the configured allowlist when one is given;
 *   - a variant id is digits only, checked against a regex, never extracted by slicing;
 *   - a quantity is an integer in a bounded range;
 *   - every query value goes through URLSearchParams, so a value carrying & or # cannot
 *     graft a parameter of its own onto the URL.
 *
 * Without the first of those, one wrong environment variable points the reorder button at
 * someone else's checkout, on every jar, and the page still looks perfect.
 */

import { normaliseVariantId } from './ids.js';

export interface CartLine {
  /** Variant id in either form: numeric, or gid://shopify/ProductVariant/{id}. */
  variantId: string;
  quantity: number;
  /**
   * Selling plan for a subscription line. NOT SUPPORTED ON A PERMALINK by Shopify: a
   * permalink cannot attach a selling plan, so this is rejected rather than dropped. The
   * Storefront API cart mutation is the tool for that, per the Architecture document.
   */
  sellingPlanId?: string;
}

export type AttributionMode =
  /**
   * Exactly the shape in the frozen API contract's CatalogEntry example:
   * .../cart/41802938471233:1?channel=nfc
   *
   * Shopify does not recognise `channel`, so it is inert: it reaches nothing, persists to
   * nothing, and appears on no order. It is preserved because it is what the frozen
   * contract says, and this package builds against the frozen contract.
   */
  | 'contract'
  /**
   * attributes[channel]=nfc, which Shopify does recognise: cart attributes persist through
   * checkout onto the order as note attributes, where the orders/create webhook can read
   * them. This is the only mechanism that makes channel visible to reorder attribution.
   * Off by default, because switching it on changes a value in the frozen contract and
   * that is Dan's call, not ours. See the README, "Two gaps".
   */
  | 'cart-attributes';

export interface CartPermalinkOptions {
  /** Public storefront origin, for example https://shop.treveanspice.com */
  storefrontBase: string;
  lines: CartLine[];
  /** Single discount code. Shopify honours one code on a permalink. */
  discountCode?: string | null;
  /** Cart attributes, persisted onto the order as note attributes. */
  attributes?: Record<string, string>;
  note?: string | null;
  /** Marketing referrer parameter Shopify records on the order. */
  ref?: string | null;
  /** Extra query parameters passed through verbatim, for example { channel: 'nfc' }. */
  extraParams?: Record<string, string>;
  attributionMode?: AttributionMode;
  /** Optional allowlist of permitted storefront hostnames. Strongly recommended in production. */
  allowedHosts?: string[];
}

export class CartPermalinkError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'CartPermalinkError';
    this.code = code;
  }
}

const MAX_QUANTITY = 999;
const MAX_LINES = 50;

/**
 * Validate and normalise a storefront origin.
 *
 * Returns the origin with no trailing slash. Throws on anything that is not a bare https
 * origin, because every one of the rejected shapes is a way for the final URL to be
 * something other than a Shopify cart on the Trevean store.
 */
export function normaliseStorefrontBase(base: string, allowedHosts?: string[]): string {
  if (typeof base !== 'string' || base.trim() === '') {
    throw new CartPermalinkError('storefront_base_missing', 'A storefront base URL is required.');
  }
  let url: URL;
  try {
    url = new URL(base.trim());
  } catch {
    throw new CartPermalinkError('storefront_base_invalid', `Not a URL: ${base}`);
  }
  if (url.protocol !== 'https:') {
    throw new CartPermalinkError('storefront_base_not_https', 'The storefront base must be https.');
  }
  if (url.username !== '' || url.password !== '') {
    throw new CartPermalinkError('storefront_base_has_credentials', 'The storefront base must not carry credentials.');
  }
  if (url.port !== '') {
    throw new CartPermalinkError('storefront_base_has_port', 'The storefront base must not specify a port.');
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new CartPermalinkError(
      'storefront_base_not_origin',
      'The storefront base must be a bare origin with no path, query or fragment.',
    );
  }
  if (allowedHosts && allowedHosts.length > 0) {
    const permitted = allowedHosts.map((h) => h.toLowerCase());
    if (!permitted.includes(url.hostname.toLowerCase())) {
      throw new CartPermalinkError(
        'storefront_host_not_allowed',
        `Storefront host ${url.hostname} is not on the allowlist.`,
      );
    }
  }
  return url.origin;
}

function validateQuantity(quantity: unknown): number {
  if (typeof quantity !== 'number' || !Number.isInteger(quantity)) {
    throw new CartPermalinkError('quantity_not_integer', 'Quantity must be an integer.');
  }
  if (quantity < 1 || quantity > MAX_QUANTITY) {
    throw new CartPermalinkError('quantity_out_of_range', `Quantity must be between 1 and ${MAX_QUANTITY}.`);
  }
  return quantity;
}

/**
 * Build the cart permalink.
 *
 * Shape: {origin}/cart/{variantId}:{quantity}[,{variantId}:{quantity}...][?params]
 *
 * Query parameters are emitted in sorted key order. That is not cosmetic. This URL is
 * baked into a pre-rendered page, so an unstable parameter order produces a diff on every
 * rebuild and hides the real changes, the same reason the recipe carousel has a stable
 * sort key in the Data model document, section 3.2.
 */
export function buildCartPermalink(options: CartPermalinkOptions): string {
  const origin = normaliseStorefrontBase(options.storefrontBase, options.allowedHosts);

  if (!Array.isArray(options.lines) || options.lines.length === 0) {
    throw new CartPermalinkError('no_lines', 'A cart permalink needs at least one line.');
  }
  if (options.lines.length > MAX_LINES) {
    throw new CartPermalinkError('too_many_lines', `A cart permalink carries at most ${MAX_LINES} lines.`);
  }

  const segments: string[] = [];
  for (const line of options.lines) {
    if (line.sellingPlanId !== undefined && line.sellingPlanId !== null) {
      throw new CartPermalinkError(
        'selling_plan_not_supported_on_permalink',
        'A cart permalink cannot carry a selling plan. Use the Storefront API cart mutation for subscription lines.',
      );
    }
    const variantId = normaliseVariantId(line.variantId);
    if (!variantId) {
      throw new CartPermalinkError('variant_id_invalid', `Not a Shopify variant id: ${String(line.variantId)}`);
    }
    segments.push(`${variantId}:${validateQuantity(line.quantity)}`);
  }

  const params = new URLSearchParams();
  const mode: AttributionMode = options.attributionMode ?? 'contract';

  for (const [key, value] of Object.entries(options.extraParams ?? {})) {
    if (typeof value !== 'string') continue;
    params.set(key, value);
  }
  if (options.discountCode) params.set('discount', options.discountCode);
  if (options.note) params.set('note', options.note);
  if (options.ref) params.set('ref', options.ref);

  const attributes = options.attributes ?? {};
  if (mode === 'cart-attributes') {
    for (const [key, value] of Object.entries(attributes)) {
      if (typeof value !== 'string') continue;
      params.set(`attributes[${key}]`, value);
    }
  } else if (Object.keys(attributes).length > 0) {
    throw new CartPermalinkError(
      'attributes_require_cart_attributes_mode',
      'Cart attributes only reach the order in cart-attributes mode. Set attributionMode explicitly.',
    );
  }

  const sorted = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = new URLSearchParams(sorted).toString();

  return `${origin}/cart/${segments.join(',')}${query ? `?${query}` : ''}`;
}

/**
 * The single-line case, which is the entire one-tap reorder path. Returns null rather than
 * throwing when there is no variant id, because that is today's expected state for every
 * blend and it must produce a disabled button rather than a failed page build.
 */
export function buildReorderPermalink(args: {
  storefrontBase: string;
  variantId: string | null | undefined;
  quantity?: number;
  channel?: string;
  attributionMode?: AttributionMode;
  allowedHosts?: string[];
}): string | null {
  const variantId = normaliseVariantId(args.variantId);
  if (!variantId) return null;

  const channel = args.channel ?? 'nfc';
  const mode: AttributionMode = args.attributionMode ?? 'contract';

  return buildCartPermalink({
    storefrontBase: args.storefrontBase,
    lines: [{ variantId, quantity: args.quantity ?? 1 }],
    attributionMode: mode,
    ...(mode === 'cart-attributes' ? { attributes: { channel } } : { extraParams: { channel } }),
    ...(args.allowedHosts ? { allowedHosts: args.allowedHosts } : {}),
  });
}
