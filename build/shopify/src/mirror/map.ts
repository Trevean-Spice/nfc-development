/*
 * Normalised product to catalog mirror record. The one place the mapping rules live.
 *
 * The output of this function is what the API serves as CatalogEntry, which is read after
 * paint and never on the tap critical path. A wrong value here is a wrong price label; a
 * throw here is a failed sync. Neither may become a broken page, so this function does not
 * throw on unexpected data: it degrades a field to null and records a warning.
 */

import { toMoney } from '../money.js';
import { buildReorderPermalink, type AttributionMode } from '../permalink.js';
import type { CatalogMirrorRecord, InventoryStatus } from '../types.js';
import { canonicaliseProduct, selectVariant, type NormalisedProduct, type VariantSelectionOptions } from './product.js';

export interface MapOptions extends VariantSelectionOptions {
  slug: string;
  syncedAt: string;
  syncSource: 'schedule' | 'webhook' | 'seed';
  /** Public storefront origin. Omit to store a null permalink, which disables the button. */
  storefrontBase?: string | null;
  allowedHosts?: string[];
  attributionMode?: AttributionMode;
  channel?: string;
  /** At or below this quantity, in_stock becomes low_stock. Null disables the distinction. */
  lowStockThreshold?: number | null;
  /** Currency to assume when the source did not carry one. */
  defaultCurrency?: string;
}

export interface MapResult {
  record: CatalogMirrorRecord;
  warnings: string[];
}

function inventoryStatusFrom(available: boolean | null, quantity: number | null, lowStockThreshold: number | null): InventoryStatus {
  if (available === null) return 'unknown';
  if (!available) return 'out_of_stock';
  if (lowStockThreshold !== null && typeof quantity === 'number' && quantity > 0 && quantity <= lowStockThreshold) {
    return 'low_stock';
  }
  return 'in_stock';
}

export function mapProductToMirror(input: NormalisedProduct, options: MapOptions): MapResult {
  const warnings: string[] = [];
  const product = canonicaliseProduct(input);
  const variant = selectVariant(product, options);

  if (!variant) warnings.push(`Product for ${options.slug} carries no variants, so there is nothing to reorder.`);
  if (options.preferredSku && variant && variant.sku !== options.preferredSku) {
    warnings.push(
      `Preferred SKU ${options.preferredSku} was not found on the product for ${options.slug}. Fell back to the first variant by position.`,
    );
  }
  if (product.variants.length > 1) {
    warnings.push(
      `Product for ${options.slug} has ${product.variants.length} variants. The mirror stores one. Confirm the variant selection rule with the client.`,
    );
  }

  const currency = variant?.currency ?? options.defaultCurrency ?? null;
  const price = toMoney(variant?.price ?? null, currency);
  const compareAtPrice = toMoney(variant?.compareAtPrice ?? null, currency);

  if (variant?.price && !price) {
    warnings.push(
      `Price ${JSON.stringify(variant.price)} for ${options.slug} could not be converted to minor units exactly. Storing no price rather than a rounded one.`,
    );
  }

  const available = variant?.available ?? null;
  const lowStockThreshold = options.lowStockThreshold === undefined ? null : options.lowStockThreshold;

  let cartPermalinkUrl: string | null = null;
  if (options.storefrontBase && variant?.gid) {
    try {
      cartPermalinkUrl = buildReorderPermalink({
        storefrontBase: options.storefrontBase,
        variantId: variant.gid,
        quantity: 1,
        ...(options.channel ? { channel: options.channel } : {}),
        ...(options.attributionMode ? { attributionMode: options.attributionMode } : {}),
        ...(options.allowedHosts ? { allowedHosts: options.allowedHosts } : {}),
      });
    } catch (error) {
      // A rejected storefront configuration must not fail the sync for every blend. It
      // produces a null permalink, which the page renders as a disabled, labelled button.
      cartPermalinkUrl = null;
      warnings.push(`Cart permalink not built for ${options.slug}: ${(error as Error).message}`);
    }
  }

  const record: CatalogMirrorRecord = {
    slug: options.slug,
    sku: variant?.sku ?? null,
    shopifyProductId: product.gid,
    shopifyVariantId: variant?.gid ?? null,
    price,
    compareAtPrice,
    // available is a boolean on the contract, so an unknown has to land somewhere. It
    // lands on false, and inventoryStatus carries the distinction: false plus 'unknown'
    // reads as "we cannot say", false plus 'out_of_stock' reads as "we can, and it is not".
    available: available === true,
    inventoryStatus: inventoryStatusFrom(available, variant?.inventoryQuantity ?? null, lowStockThreshold),
    cartPermalinkUrl,
    syncedAt: options.syncedAt,
    stale: false,
    syncSource: options.syncSource,
    variantPosition: variant?.position ?? null,
  };

  return { record, warnings };
}
