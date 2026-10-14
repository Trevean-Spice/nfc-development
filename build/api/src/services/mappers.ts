import { config } from '../config/env.js';
import type { CatalogItem } from '../repositories/catalog.js';
import type { BlendItem } from '../repositories/blends.js';
import type { GrowerItem } from '../repositories/growers.js';
import type { MediaItem } from '../repositories/media.js';
import type { RecipeItem } from '../repositories/recipes.js';
import type { TagRecordItem } from '../repositories/tags.js';
import { now as clockNow } from '../util/clock.js';
import { buildCartPermalink } from './cartPermalink.js';

/**
 * Stored item to wire shape.
 *
 * Several response schemas in the frozen document set additionalProperties false, so a
 * stray internal field on a response is a contract test failure rather than a harmless
 * extra. Every mapper here builds the response object explicitly for that reason, rather
 * than spreading a stored item and hoping.
 */

export interface MediaRef {
  mediaId: string;
  cdnUrl: string;
  alt: string;
  width: number;
  height: number;
  blurDataUrl?: string | null;
  formats?: string[];
}

/**
 * MediaRef requires dimensions, so nothing shifts during layout. That is a Lighthouse
 * requirement and a real user experience one. A media item that is not ready, or has no
 * alt text or no dimensions, is returned as null rather than as a half populated
 * reference the page cannot lay out.
 */
export function toMediaRef(item: MediaItem | undefined): MediaRef | null {
  if (!item) return null;
  if (item.mediaStatus !== 'ready') return null;
  if (!item.cdnUrl || !item.alt || !item.width || !item.height) return null;
  const formats = item.derivatives?.map((d) => d.format);
  const ref: MediaRef = {
    mediaId: item.mediaId,
    cdnUrl: item.cdnUrl,
    alt: item.alt,
    width: item.width,
    height: item.height,
  };
  if (formats && formats.length > 0) ref.formats = [...new Set(formats)];
  return ref;
}

export function toMedia(item: MediaItem): Record<string, unknown> {
  return {
    mediaId: item.mediaId,
    filename: item.filename,
    contentType: item.contentType,
    bytes: item.bytes ?? null,
    kind: item.kind,
    status: item.mediaStatus,
    alt: item.alt ?? null,
    width: item.width ?? null,
    height: item.height ?? null,
    cdnUrl: item.cdnUrl ?? null,
    derivatives: item.derivatives ?? [],
    uploadedBy: item.uploadedBy ?? null,
    createdAt: item.createdAt,
  };
}

export function toBlendSummary(item: BlendItem, media: Map<string, MediaItem>): Record<string, unknown> {
  return {
    slug: item.slug,
    name: item.name,
    status: item.status,
    tagline: item.tagline ?? null,
    originCountry: item.originCountry ?? null,
    originRegion: item.originRegion ?? null,
    launchTier: item.launchTier ?? 'seeded',
    tagCode: item.tagCode ?? null,
    heroImage: toMediaRef(item.heroImageId ? media.get(item.heroImageId) : undefined),
    recipeCount: item.recipeCount ?? 0,
    version: item.version,
    publishedAt: item.publishedAt ?? null,
    updatedAt: item.updatedAt,
  };
}

export function toBlend(
  item: BlendItem,
  media: Map<string, MediaItem>,
  embed?: { grower?: Record<string, unknown> | null; recipes?: Array<Record<string, unknown>> },
): Record<string, unknown> {
  const blend: Record<string, unknown> = {
    ...toBlendSummary(item, media),
    originCity: item.originCity ?? null,
    farm: item.farm ?? null,
    storyBlocks: item.storyBlocks ?? [],
    gallery: (item.galleryImageIds ?? []).map((id) => toMediaRef(media.get(id))).filter((r): r is MediaRef => r !== null),
    freshness: item.freshness ?? {},
    growerId: item.growerId ?? null,
    shopify: item.shopify ?? {},
    updatedBy: item.updatedBy ?? null,
  };
  if (embed && 'grower' in embed) blend['grower'] = embed.grower ?? null;
  if (embed && embed.recipes) blend['recipes'] = embed.recipes;
  return blend;
}

export function toRecipe(item: RecipeItem, media: Map<string, MediaItem>): Record<string, unknown> {
  return {
    recipeId: item.recipeId,
    blendSlug: item.blendSlug,
    title: item.title,
    summary: item.summary ?? null,
    servings: item.servings ?? null,
    prepMinutes: item.prepMinutes ?? null,
    cookMinutes: item.cookMinutes ?? null,
    difficulty: item.difficulty ?? null,
    ingredients: item.ingredients ?? [],
    steps: item.steps ?? [],
    image: toMediaRef(item.imageId ? media.get(item.imageId) : undefined),
    sortOrder: item.sortOrder,
    status: item.status,
    version: item.version,
    updatedAt: item.updatedAt,
  };
}

export function toGrower(item: GrowerItem, media: Map<string, MediaItem>): Record<string, unknown> {
  return {
    growerId: item.growerId,
    name: item.name,
    farmName: item.farmName ?? null,
    country: item.country ?? null,
    region: item.region ?? null,
    bio: item.bio ?? null,
    yearsFarming: item.yearsFarming ?? null,
    portrait: toMediaRef(item.portraitId ? media.get(item.portraitId) : undefined),
    farm: item.farm ?? null,
    blendSlugs: item.blendSlugs ?? [],
    version: item.version,
    updatedAt: item.updatedAt,
  };
}

export function toCatalogEntry(item: CatalogItem, now: number = clockNow()): Record<string, unknown> {
  const syncedMs = Date.parse(item.syncedAt);
  const stale = !Number.isFinite(syncedMs) || now - syncedMs > config.catalog.staleAfterSeconds * 1000;
  return {
    slug: item.slug,
    sku: item.sku ?? null,
    shopifyProductId: item.shopifyProductId ?? null,
    shopifyVariantId: item.shopifyVariantId ?? null,
    price:
      item.priceAmount === null || item.priceAmount === undefined
        ? null
        : { amount: item.priceAmount, currency: item.priceCurrency ?? 'USD' },
    compareAtPrice:
      item.compareAtAmount === null || item.compareAtAmount === undefined
        ? null
        : { amount: item.compareAtAmount, currency: item.priceCurrency ?? 'USD' },
    available: Boolean(item.available),
    // unknown is a legitimate answer when the mirror is stale. It is not an error, and the
    // page still renders with the last known price and a working reorder permalink.
    inventoryStatus: stale ? 'unknown' : item.inventoryStatus,
    // A stored permalink always wins: if the catalog sync ever mirrors one from
    // Shopify, that is authoritative and this must not second guess it. Deriving is
    // the fallback, and it is what makes the reorder button work from a variant id
    // alone while store access is still outstanding. Null when neither is available,
    // which renders a disabled button rather than a broken one.
    cartPermalinkUrl:
      item.cartPermalinkUrl ??
      buildCartPermalink({
        storeDomain: config.shopify.storeDomain,
        variantId: item.shopifyVariantId,
      }),
    syncedAt: item.syncedAt,
    stale,
  };
}

export function toTagRecord(item: TagRecordItem): Record<string, unknown> {
  return {
    code: item.code,
    blendSlug: item.blendSlug,
    requestPath: item.requestPath,
    targetPath: item.targetPath,
    redirectStatus: item.redirectStatus,
    unitsEncoded: item.unitsEncoded,
    status: item.status,
    encodedOn: item.encodedOn ?? null,
    supplierOrderRef: item.supplierOrderRef ?? null,
    chipPartNumber: item.chipPartNumber ?? null,
    // Null means unknown, not false. False would be a claim nobody has made: the Tagstand
    // answer on the SO4731 run is still outstanding.
    writeProtected: item.writeProtected ?? null,
    ndefUri: item.ndefUri ?? null,
    lastVerifiedAgainstPhysicalTag: item.lastVerifiedAgainstPhysicalTag ?? null,
  };
}
