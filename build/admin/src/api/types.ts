/**
 * Response shapes, transcribed from the frozen OpenAPI document's component schemas.
 *
 * These are read models only. Nothing here adds a field the contract does not define, and
 * nothing here is sent as a request body without going through the write shapes below.
 * Where a field is optional in the contract it is optional here, so a missing value is a
 * decision the UI has to make rather than a crash.
 */

export type ContentStatus = 'draft' | 'published' | 'archived';
export type LaunchTier = 'real' | 'seeded';
export type MediaKind = 'hero' | 'gallery' | 'grower_portrait' | 'recipe';

export interface MediaRef {
  mediaId: string;
  cdnUrl: string;
  alt: string;
  width: number;
  height: number;
  blurDataUrl?: string | null;
  formats?: string[];
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
  label?: string | null;
}

export interface StoryBlock {
  type: 'heading' | 'paragraph' | 'quote';
  text: string;
}

export interface Freshness {
  harvestedOn?: string | null;
  blendedOn?: string | null;
  bestBefore?: string | null;
  lotLabel?: string | null;
  note?: string | null;
}

export interface ShopifyLink {
  productId?: string | null;
  variantId?: string | null;
  sku?: string | null;
  cartPermalinkUrl?: string | null;
}

export interface BlendSummary {
  slug: string;
  name: string;
  status: ContentStatus;
  tagline?: string | null;
  originCountry?: string | null;
  originRegion?: string | null;
  launchTier: LaunchTier;
  tagCode?: string | null;
  heroImage?: MediaRef | null;
  recipeCount?: number;
  version: number;
  publishedAt?: string | null;
  updatedAt: string;
}

export interface Blend extends BlendSummary {
  originCity?: string | null;
  farm?: GeoPoint | null;
  storyBlocks?: StoryBlock[];
  gallery?: MediaRef[];
  freshness?: Freshness;
  growerId?: string | null;
  shopify?: ShopifyLink;
  updatedBy?: string | null;
  grower?: Grower | null;
  recipes?: Recipe[];
}

export interface Ingredient {
  quantity?: number | null;
  unit?: string | null;
  item: string;
  note?: string | null;
}

export interface Recipe {
  recipeId: string;
  blendSlug: string;
  title: string;
  summary?: string | null;
  servings?: number | null;
  prepMinutes?: number | null;
  cookMinutes?: number | null;
  difficulty?: 'easy' | 'medium' | 'hard' | null;
  ingredients?: Ingredient[];
  steps?: string[];
  image?: MediaRef | null;
  sortOrder: number;
  status: ContentStatus;
  version: number;
  updatedAt: string;
}

export interface Grower {
  growerId: string;
  name: string;
  farmName?: string | null;
  country?: string | null;
  region?: string | null;
  bio?: string | null;
  yearsFarming?: number | null;
  portrait?: MediaRef | null;
  farm?: GeoPoint | null;
  blendSlugs?: string[];
  version: number;
  updatedAt: string;
  /** Present only on the update response. */
  republishRequiredFor?: string[];
}

export interface Media {
  mediaId: string;
  filename: string;
  contentType: string;
  bytes?: number | null;
  kind: MediaKind;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  alt?: string | null;
  width?: number | null;
  height?: number | null;
  cdnUrl?: string | null;
  derivatives?: Array<{ format: string; width: number; cdnUrl: string }>;
  uploadedBy?: string | null;
  createdAt: string;
}

export interface MediaUploadTicket {
  mediaId: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  maxBytes: number;
  expiresAt: string;
}

export interface PublishResult {
  slug: string;
  status: ContentStatus;
  version: number;
  publishedAt: string;
  revalidationId: string;
  paths: string[];
}

export interface RevalidateResult {
  revalidationId: string;
  paths: string[];
  status: 'queued';
}

export interface TagRecord {
  code: string;
  blendSlug: string;
  requestPath: string;
  targetPath: string;
  redirectStatus: number;
  unitsEncoded?: number;
  status: 'encoded' | 'reserved';
  encodedOn?: string | null;
  supplierOrderRef?: string | null;
  chipPartNumber?: string | null;
  writeProtected?: boolean | null;
  ndefUri?: string | null;
  lastVerifiedAgainstPhysicalTag?: string | null;
}

export interface TagRecordList {
  deployedAt?: string;
  sourceCommit?: string | null;
  data: TagRecord[];
}

export interface ScanRollupPoint {
  bucket: string;
  scans: number;
  byChannel?: { nfc?: number; qr?: number; direct?: number };
  byPlatform?: { ios?: number; android?: number; other?: number };
  reorderClicks?: number;
  recipeOpens?: number;
  cache?: { hit?: number; miss?: number; stale?: number };
  timeToReadable?: { count?: number; sumMs?: number; p50Ms?: number | null; p95Ms?: number | null };
  topCities?: Array<{ country: string; region?: string | null; city?: string | null; scans: number }>;
}

export interface ScanTimeSeries {
  blend?: string | null;
  granularity: 'hour' | 'day';
  from: string;
  to: string;
  measurementMethod: 'browser_token';
  measurementNote?: string;
  source: 'rollup';
  points: ScanRollupPoint[];
}

export interface ListEnvelope<T> {
  data: T[];
  nextCursor: string | null;
}
