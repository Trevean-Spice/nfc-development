import { ulid } from './ulid.js';

/**
 * Prefixed identifiers, exactly as the OpenAPI document patterns require:
 *   rcp_ recipes, grw_ growers, med_ media, rvl_ revalidation jobs.
 *
 * There is deliberately no per-tag identifier and no chip UID anywhere in this file.
 * The 1,000 shipped tags are encoded per SKU, so a per-jar identifier does not exist and
 * inventing one would be a fiction the dashboard then reports as fact.
 */

export const ID_PREFIXES = {
  recipe: 'rcp_',
  grower: 'grw_',
  media: 'med_',
  revalidation: 'rvl_',
  scanEvent: 'evt_',
} as const;

export function newRecipeId(): string {
  return ID_PREFIXES.recipe + ulid();
}

export function newGrowerId(): string {
  return ID_PREFIXES.grower + ulid();
}

export function newMediaId(): string {
  return ID_PREFIXES.media + ulid();
}

export function newRevalidationId(): string {
  return ID_PREFIXES.revalidation + ulid();
}

export function newScanEventId(): string {
  return ID_PREFIXES.scanEvent + ulid();
}

const RECIPE_ID = /^rcp_[0-9A-HJKMNP-TV-Z]{26}$/;
const GROWER_ID = /^grw_[0-9A-HJKMNP-TV-Z]{26}$/;
const MEDIA_ID = /^med_[0-9A-HJKMNP-TV-Z]{26}$/;

export const isRecipeId = (v: string): boolean => RECIPE_ID.test(v);
export const isGrowerId = (v: string): boolean => GROWER_ID.test(v);
export const isMediaId = (v: string): boolean => MEDIA_ID.test(v);
