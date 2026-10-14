/*
 * The shapes this package produces and consumes.
 *
 * CatalogEntry mirrors the frozen M1 API contract, version 1.0.0, schema
 * components.schemas.CatalogEntry, byte for byte in field names and types. That is not a
 * coincidence to be maintained by hand: test/contract.test.ts compiles the schema out of
 * the vendored copy of the frozen document and validates real mapper output against it,
 * so a drift here fails the suite rather than surfacing in the other engineer's.
 *
 * Nothing in this file invents a field the contract does not carry. Where Shopify offers
 * something the contract has no home for, it is reported in the README under "Gaps against
 * the frozen contract" rather than added quietly.
 */

/** ISO 4217 alphabetic code. Uppercase, three letters. */
export type CurrencyCode = string;

/**
 * Money in minor units, matching the contract's Money schema. Integer cents, never a
 * float. A float price is a rounding bug waiting for a customer to find it, and this is a
 * number that ends up on a page next to a buy button.
 */
export interface Money {
  amount: number;
  currency: CurrencyCode;
}

export type InventoryStatus = 'in_stock' | 'low_stock' | 'out_of_stock' | 'unknown';

/**
 * The catalog mirror entry as the API serves it. Access pattern 8 in the Architecture
 * document, "Data layer": read after paint, never on the tap critical path, and degradable.
 */
export interface CatalogEntry {
  slug: string;
  sku: string | null;
  shopifyProductId: string | null;
  shopifyVariantId: string | null;
  price: Money | null;
  compareAtPrice: Money | null;
  available: boolean;
  inventoryStatus: InventoryStatus;
  cartPermalinkUrl: string | null;
  syncedAt: string;
  stale: boolean;
}

/**
 * What the sync and the webhook handler write into DynamoDB. It is the contract shape plus
 * the two attributes the Data model document, section 3.1, puts on the CATALOG# item and
 * the API does not expose: syncSource, and the raw variant selection that produced it.
 */
export interface CatalogMirrorRecord extends CatalogEntry {
  syncSource: 'schedule' | 'webhook' | 'seed';
  /** Shopify variant position within the product, recorded so a selection rule change is auditable. */
  variantPosition: number | null;
}

/**
 * Whether the reorder button has a destination.
 *
 * This type exists because the honest answer today is "no". Content fixtures in
 * build/content carry null Shopify product ids and variant ids, because there is no store
 * access, and a cart permalink is derived from a variant id. A button with no destination
 * is rendered disabled and labelled, never hidden and never pointed somewhere plausible.
 * See the consumer blend page's placeholder render contract.
 */
export type ReorderTarget =
  | {
      state: 'ready';
      url: string;
      variantId: string;
      quantity: number;
    }
  | {
      state: 'unavailable';
      reason: ReorderUnavailableReason;
      /** How the page must render it. There is exactly one correct answer and it is not "hide". */
      render: 'disabled-labelled';
      detail: string;
    };

export type ReorderUnavailableReason =
  /** No Shopify variant id in the catalog mirror. This is the state of every blend today. */
  | 'no_variant_id'
  /** The variant id is present but is not a Shopify variant identifier we can put in a URL. */
  | 'invalid_variant_id'
  /** No storefront domain configured, so there is nowhere to send the customer. */
  | 'no_storefront_domain'
  /** Configured to disable on unavailability, and the mirror says unavailable. Off by default. */
  | 'not_purchasable';

/** One line of per-SKU reorder attribution derived from an orders/create webhook. */
export interface ReorderAttribution {
  blendSlug: string;
  sku: string;
  quantity: number;
  /**
   * Where the order came from, when the cart carried a channel attribute. Attribution is
   * per SKU, so this is the only channel signal available and it is only present when the
   * permalink was built in cart-attributes mode. See the README, "Two gaps".
   */
  channel: 'nfc' | 'qr' | 'direct' | 'unknown';
  /** UTC calendar day, for the daily rollup partition. Never a timestamp with a customer in it. */
  occurredOn: string;
}

export interface OrderAttributionResult {
  attributions: ReorderAttribution[];
  /** SKUs on the order that map to no blend. Recorded rather than dropped, so a store and blend list mismatch is visible. */
  unmatchedSkus: string[];
  warnings: string[];
}
