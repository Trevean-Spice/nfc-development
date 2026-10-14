/*
 * Does the reorder button have a destination, and if not, what does the page do about it.
 *
 * This module exists because the honest answer today is "no, on all five blends". Content
 * fixtures in build/content carry null Shopify product ids and null variant ids, because
 * there is no Shopify Plus store access, and a cart permalink is derived from a variant
 * id. Until a variant id exists there is no permalink, so the reorder button has no
 * destination.
 *
 * There are three ways to handle that and two of them are wrong.
 *
 *   Wrong: render the button anyway, pointing at the shop home page or at /cart. It looks
 *   finished, it demos well, and it sends a customer who tapped a jar to a page that does
 *   not have their blend in a cart. The failure is invisible to us and visible to them.
 *
 *   Wrong: hide the button. The page then quietly changes shape depending on data nobody
 *   is looking at, and the day a variant id lands the layout moves. It also hides the fact
 *   that a contracted dependency is outstanding.
 *
 *   Right: render it disabled and labelled, in the position and at the size it will
 *   occupy when it works. That is the placeholder render contract the consumer blend page
 *   already implements, and this function is the decision that drives it.
 *
 * So this returns a discriminated union rather than a string or null. A caller cannot use
 * the result without handling the unavailable case, which is the property that stops a
 * dead button reaching a jar.
 */

import { buildReorderPermalink, type AttributionMode, CartPermalinkError } from './permalink.js';
import { normaliseVariantId } from './ids.js';
import type { CatalogEntry, ReorderTarget } from './types.js';

export interface ReorderTargetOptions {
  storefrontBase: string | null | undefined;
  quantity?: number;
  channel?: string;
  attributionMode?: AttributionMode;
  allowedHosts?: string[];
  /**
   * Whether an entry the mirror reports as unavailable should disable the button.
   *
   * DEFAULT FALSE, deliberately, and the reason is in build/content's own fixture notes:
   * available is stored as false meaning "we cannot say it is available", not "it is out
   * of stock". Treating that as out of stock would disable every button on every blend for
   * a reason that is not true. Switch it on once the mirror is fed by a real store, where
   * false means what it says.
   */
  disableWhenUnavailable?: boolean;
}

export function resolveReorderTarget(
  entry: Pick<CatalogEntry, 'shopifyVariantId' | 'available'>,
  options: ReorderTargetOptions,
): ReorderTarget {
  const variantId = normaliseVariantId(entry.shopifyVariantId);

  if (entry.shopifyVariantId === null || entry.shopifyVariantId === undefined || entry.shopifyVariantId === '') {
    return {
      state: 'unavailable',
      reason: 'no_variant_id',
      render: 'disabled-labelled',
      detail:
        'No Shopify variant id in the catalog mirror. Awaiting Shopify Plus store access, which is an outstanding client dependency.',
    };
  }

  if (!variantId) {
    return {
      state: 'unavailable',
      reason: 'invalid_variant_id',
      render: 'disabled-labelled',
      detail: `The catalog mirror holds a variant id that is not a Shopify variant identifier: ${String(entry.shopifyVariantId)}`,
    };
  }

  if (!options.storefrontBase) {
    return {
      state: 'unavailable',
      reason: 'no_storefront_domain',
      render: 'disabled-labelled',
      detail: 'No storefront domain is configured, so there is nowhere to send the customer.',
    };
  }

  if (options.disableWhenUnavailable === true && entry.available === false) {
    return {
      state: 'unavailable',
      reason: 'not_purchasable',
      render: 'disabled-labelled',
      detail: 'The catalog mirror reports this variant as not available to order.',
    };
  }

  const quantity = options.quantity ?? 1;
  let url: string | null;
  try {
    url = buildReorderPermalink({
      storefrontBase: options.storefrontBase,
      variantId,
      quantity,
      ...(options.channel ? { channel: options.channel } : {}),
      ...(options.attributionMode ? { attributionMode: options.attributionMode } : {}),
      ...(options.allowedHosts ? { allowedHosts: options.allowedHosts } : {}),
    });
  } catch (error) {
    if (error instanceof CartPermalinkError) {
      return {
        state: 'unavailable',
        reason: 'no_storefront_domain',
        render: 'disabled-labelled',
        detail: `Storefront configuration rejected: ${error.code}. ${error.message}`,
      };
    }
    throw error;
  }

  if (!url) {
    return {
      state: 'unavailable',
      reason: 'invalid_variant_id',
      render: 'disabled-labelled',
      detail: 'The variant id did not survive normalisation.',
    };
  }

  return { state: 'ready', url, variantId, quantity };
}

/**
 * Copy for the disabled state, so the page and the CMS say the same thing about the same
 * situation rather than each inventing a phrase.
 */
export function reorderUnavailableLabel(target: ReorderTarget): string | null {
  if (target.state === 'ready') return null;
  switch (target.reason) {
    case 'no_variant_id':
      return 'Reorder is not connected yet';
    case 'invalid_variant_id':
      return 'Reorder is not connected yet';
    case 'no_storefront_domain':
      return 'Reorder is not connected yet';
    case 'not_purchasable':
      return 'Not available to order';
  }
}
