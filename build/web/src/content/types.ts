/*
 * The render shape the blend page draws from.
 *
 * Built at build and revalidate time, never at request time. The storage shape
 * it is adapted from lives in the content package and mirrors the frozen API
 * contract, "Endpoint reference in brief": camelCase field names, slugs matching
 * ^[a-z0-9]+(-[a-z0-9]+)*$, dates as YYYY-MM-DD, money as an integer in minor
 * units with an ISO 4217 currency code.
 *
 * Null is a value here, not an absence to be tidied away. A null grower
 * location renders a pending slot at the size the real value will occupy. A
 * collapsed slot makes the page smaller than the delivered page, which would
 * mean re-testing the above the fold requirement on the day the copy lands.
 *
 * Two fields exist only until the real content arrives:
 *
 *   placeholder  true while any field on this blend is filler.
 *   sentinel     the marker the content package puts inside filler strings, so
 *                the page can outline exactly those strings without the adapter
 *                having to carry a per-field flag.
 *
 * They are not decoration. scripts/verify-output.mjs refuses a release build
 * while any blend still carries placeholder true.
 */

export interface Money {
  /** Integer in minor units. 2400 is $24.00. Never a float. */
  amount: number;
  /** ISO 4217. */
  currency: string;
}

export interface ImageSource {
  /** MIME type, for the <picture> source element. */
  type: string;
  /** Full srcset string, widths in the w descriptor. */
  srcset: string;
}

export interface ResponsiveImage {
  /** Fallback src for the <img> element itself. Empty when no master exists. */
  src: string;
  alt: string;
  /** Intrinsic width and height. Both required: an unsized image is layout shift. */
  width: number;
  height: number;
  sizes: string;
  /** AVIF first, then WebP. The <img> src is the last resort. */
  sources: ImageSource[];
}

export interface FarmLocation {
  label: string | null;
  /** Decimal degrees. Null while the real coordinates have not been supplied. */
  latitude: number | null;
  longitude: number | null;
  /**
   * A static raster, never an interactive map. A mapping SDK is 200 KB to
   * 800 KB of JavaScript, which exceeds the whole deferred JavaScript budget
   * and in some cases the whole page budget. Budget document, section 4.2.
   */
  staticMap: ResponsiveImage;
  /** Where "view on a map" goes. Null while coordinates are unknown. */
  mapLinkUrl: string | null;
}

export interface Grower {
  growerId: string;
  name: string;
  /** Farm or cooperative. Null until supplied. */
  role: string | null;
  location: string | null;
  bio: string;
  yearsFarming: number | null;
  photo: ResponsiveImage;
  farm: FarmLocation;
}

export type FreshnessState = 'done' | 'current' | 'upcoming';

export interface FreshnessStep {
  label: string;
  /** YYYY-MM-DD, or null while the lot data has not been supplied. */
  date: string | null;
  /** Shown when date is null. */
  displayDate: string;
  state: FreshnessState;
  detail: string;
}

export interface Freshness {
  lotCode: string | null;
  /** Why freshness is stated per blend rather than per jar. */
  note: string | null;
  steps: FreshnessStep[];
}

export interface Recipe {
  recipeId: string;
  title: string;
  summary: string;
  /** Prep plus cook. Null while neither is supplied. */
  timeMinutes: number | null;
  difficulty: string | null;
  servings: number | null;
  image: ResponsiveImage;
  /** Where the full method lives. Null renders the card without a link. */
  url: string | null;
}

export interface Commerce {
  /**
   * A Shopify cart permalink. Pre-fills a cart and drops the customer into
   * checkout: zero API calls, zero client credentials, nothing to fail, and it
   * bakes into the pre-rendered page. Architecture document, "Shopify Plus".
   */
  cartPermalink: string | null;
  /** Baked at build time from the catalog mirror. Null renders no price. */
  price: Money | null;
  available: boolean | null;
  inventoryStatus: string | null;
  sku: string | null;
}

export interface Blend {
  slug: string;
  name: string;
  status: 'published' | 'draft' | 'archived';
  placeholder: boolean;
  placeholderNote: string | null;
  /** Marker inside filler strings, for example "[PLACEHOLDER]". */
  sentinel: string | null;
  tagline: string;
  /** Region of origin, in the client's own words where they gave them. */
  /** Null when no origin may be rendered. Absent, not empty: see D29. */
  originRegion: string | null;
  keyNotes: string[];
  hero: ResponsiveImage;
  originStory: {
    heading: string;
    /** The opening that section 6.3 requires to be visible without scrolling. */
    lede: string;
    paragraphs: string[];
  };
  grower: Grower;
  freshness: Freshness;
  recipes: Recipe[];
  commerce: Commerce;
}

export interface ContentBundle {
  /** Where this content came from, printed by the build so it is never a guess. */
  sourceLabel: string;
  blends: Blend[];
}
