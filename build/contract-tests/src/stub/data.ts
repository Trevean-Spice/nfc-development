// Seed data for the stub implementation of the frozen contract.
//
// The stub exists so the suite is demonstrably correct today, before the real API is
// written. It is not the real API and must never be deployed anywhere. Content values are
// illustrative placeholders; the slugs, tag codes, redirect targets and unit counts are
// the real ones, because those are what the suite is checking.

export const TOKENS: Record<string, 'Admin' | 'Editor' | 'Viewer'> = {
  'stub-admin-token': 'Admin',
  'stub-editor-token': 'Editor',
  'stub-viewer-token': 'Viewer',
};

/** Recognised but always rejected, so the 401 path can be exercised with a real looking token. */
export const EXPIRED_TOKEN = 'stub-expired-token';

export const ALLOWED_ORIGINS = [
  'https://treveanspice.com',
  'https://www.treveanspice.com',
  'https://staging.treveanspice.com',
  'http://localhost:3000',
];

export interface StubState {
  blends: Map<string, any>;
  recipes: Map<string, any>;
  growers: Map<string, any>;
  media: Map<string, any>;
  catalog: Map<string, any>;
  tags: any[];
  /** Deduplication keys of (blendSlug, dedupToken, windowId), matching the data model. */
  scanKeys: Set<string>;
  scanCount: number;
}

const HERO_PS = {
  mediaId: 'med_01J9Z8XK4M2Q7T5V3N8R1B6C0D',
  cdnUrl: 'https://cdn.treveanspice.com/media/med_01J9Z8XK4M2Q7T5V3N8R1B6C0D/hero-1280.avif',
  alt: 'A copper bowl of saffron threads and dried rose petals',
  width: 1280,
  height: 853,
  blurDataUrl: 'data:image/webp;base64,UklGRhAAAABXRUJQVlA4IAQAAACwAQCdASoIAAUA',
  formats: ['avif', 'webp', 'jpeg'],
};

const HERO_CS = {
  mediaId: 'med_01J9Z8XM7P4R2T6W4Q9S3C7E1F',
  cdnUrl: 'https://cdn.treveanspice.com/media/med_01J9Z8XM7P4R2T6W4Q9S3C7E1F/hero-1280.avif',
  alt: 'Scotch bonnet peppers and thyme on a wooden board',
  width: 1280,
  height: 853,
  formats: ['avif', 'webp', 'jpeg'],
};

function blend(input: Record<string, any>): Record<string, any> {
  return {
    tagline: null,
    originCountry: null,
    originRegion: null,
    originCity: null,
    farm: null,
    storyBlocks: [],
    heroImage: null,
    gallery: [],
    freshness: {},
    growerId: null,
    shopify: {},
    recipeCount: 0,
    publishedAt: null,
    updatedBy: 'editor@treveanspice.com',
    ...input,
  };
}

export function freshState(): StubState {
  const blends = new Map<string, any>();

  blends.set(
    'persian-sunrise',
    blend({
      slug: 'persian-sunrise',
      name: 'Persian Sunrise',
      status: 'published',
      tagline: 'Saffron, cardamom, rose petals and lime from Isfahan',
      launchTier: 'real',
      tagCode: 'ps',
      originCountry: 'IR',
      originRegion: 'Isfahan',
      originCity: 'Isfahan',
      farm: { latitude: 32.6539, longitude: 51.666, label: 'Smallholding outside Isfahan, Iran' },
      storyBlocks: [
        { type: 'heading', text: 'Picked before the heat' },
        {
          type: 'paragraph',
          text: 'Saffron is harvested in the cool hours after dawn, when the stigmas are still soft enough to separate by hand without breaking.',
        },
      ],
      heroImage: HERO_PS,
      freshness: {
        harvestedOn: '2026-05-12',
        blendedOn: '2026-06-30',
        bestBefore: '2027-06-30',
        lotLabel: 'PS-2606',
        note: 'Freshness is stated per blend rather than per jar, because tag encoding is per SKU.',
      },
      growerId: 'grw_01J9Z900A1B2C3D4E5F6G7H8J9',
      shopify: {
        productId: 'gid://shopify/Product/7391043289601',
        variantId: 'gid://shopify/ProductVariant/41802938471233',
        sku: 'TRV-PS-60G',
        cartPermalinkUrl: 'https://shop.treveanspice.com/cart/41802938471233:1?channel=nfc',
      },
      recipeCount: 1,
      version: 12,
      publishedAt: '2026-08-14T16:02:11Z',
      updatedAt: '2026-08-14T16:02:11Z',
    }),
  );

  blends.set(
    'caribbean-sunset',
    blend({
      slug: 'caribbean-sunset',
      name: 'Caribbean Sunset',
      status: 'published',
      tagline: 'Scotch bonnet, allspice and thyme from Trinidad and Tobago',
      launchTier: 'real',
      tagCode: 'cs',
      originCountry: 'TT',
      originRegion: 'Trinidad',
      heroImage: HERO_CS,
      growerId: 'grw_01J9Z900A1B2C3D4E5F6G7H8J9',
      shopify: {
        productId: 'gid://shopify/Product/7391043355137',
        variantId: 'gid://shopify/ProductVariant/41802938536769',
        sku: 'TRV-CS-60G',
        cartPermalinkUrl: 'https://shop.treveanspice.com/cart/41802938536769:1?channel=nfc',
      },
      recipeCount: 1,
      version: 9,
      publishedAt: '2026-08-14T16:04:40Z',
      updatedAt: '2026-08-14T16:04:40Z',
    }),
  );

  blends.set(
    'north-african-night-market',
    blend({
      slug: 'north-african-night-market',
      name: 'North African Night Market',
      status: 'published',
      tagline: 'Aleppo pepper, cumin and preserved lemon from Fez',
      launchTier: 'seeded',
      tagCode: 'nm',
      originCountry: 'MA',
      originRegion: 'Fes-Meknes',
      version: 2,
      publishedAt: '2026-08-15T11:20:03Z',
      updatedAt: '2026-08-15T11:20:03Z',
    }),
  );

  blends.set(
    'silk-road',
    blend({
      slug: 'silk-road',
      name: 'The Silk Road',
      status: 'published',
      tagline: 'Cumin, coriander, fenugreek and turmeric from Central Asia',
      launchTier: 'seeded',
      tagCode: 'sr',
      originCountry: 'UZ',
      originRegion: 'Central Asia',
      version: 2,
      publishedAt: '2026-08-15T11:21:44Z',
      updatedAt: '2026-08-15T11:21:44Z',
    }),
  );

  blends.set(
    'kyoto-garden',
    blend({
      slug: 'kyoto-garden',
      name: 'Kyoto Garden',
      status: 'draft',
      tagline: 'Sesame, nori, yuzu and green tea from Kyoto',
      launchTier: 'seeded',
      tagCode: 'kg',
      originCountry: 'JP',
      originRegion: 'Kyoto',
      version: 1,
      publishedAt: null,
      updatedAt: '2026-08-15T11:23:12Z',
    }),
  );

  const recipes = new Map<string, any>();
  recipes.set('rcp_01J9Z91B2C3D4E5F6G7H8J9K0M', {
    recipeId: 'rcp_01J9Z91B2C3D4E5F6G7H8J9K0M',
    blendSlug: 'persian-sunrise',
    title: 'Saffron rice with crisp tahdig',
    summary: 'A weeknight version that still gives you the golden crust.',
    servings: 4,
    prepMinutes: 15,
    cookMinutes: 45,
    difficulty: 'medium',
    ingredients: [
      { quantity: 2, unit: 'cup', item: 'basmati rice', note: 'rinsed until the water runs clear' },
      { quantity: 2, unit: 'tsp', item: 'Persian Sunrise blend', note: null },
    ],
    steps: [
      'Rinse the rice until the water runs clear, then soak for 30 minutes.',
      'Parboil, drain, and layer back into a buttered pan over a low heat.',
      'Cover with a cloth wrapped lid and cook undisturbed until the base is golden.',
    ],
    image: null,
    sortOrder: 1,
    status: 'published',
    version: 4,
    updatedAt: '2026-08-14T15:58:02Z',
  });
  recipes.set('rcp_01J9Z92C3D4E5F6G7H8J9K0M1N', {
    recipeId: 'rcp_01J9Z92C3D4E5F6G7H8J9K0M1N',
    blendSlug: 'caribbean-sunset',
    title: 'Grilled corn with scotch bonnet butter',
    summary: 'Fifteen minutes, one bowl, and a jar you will finish faster than you planned.',
    servings: 4,
    prepMinutes: 10,
    cookMinutes: 12,
    difficulty: 'easy',
    ingredients: [
      { quantity: 4, unit: 'ear', item: 'sweetcorn', note: 'husks removed' },
      { quantity: 60, unit: 'g', item: 'salted butter', note: 'softened' },
    ],
    steps: [
      'Mash the blend into the softened butter and set aside.',
      'Grill the corn over a high heat, turning, until charred in patches.',
    ],
    image: null,
    sortOrder: 1,
    status: 'published',
    version: 2,
    updatedAt: '2026-08-14T16:03:55Z',
  });

  const growers = new Map<string, any>();
  growers.set('grw_01J9Z900A1B2C3D4E5F6G7H8J9', {
    growerId: 'grw_01J9Z900A1B2C3D4E5F6G7H8J9',
    name: 'Placeholder pending content delivery',
    farmName: 'Placeholder pending content delivery',
    country: 'IR',
    region: 'Isfahan',
    bio: 'Grower profile copy is supplied by Trevean. This record is seeded so the page shape can be built and measured before content lands.',
    yearsFarming: null,
    portrait: null,
    farm: { latitude: 32.6539, longitude: 51.666 },
    blendSlugs: ['persian-sunrise', 'caribbean-sunset'],
    version: 3,
    updatedAt: '2026-08-13T09:15:00Z',
  });

  const media = new Map<string, any>();
  media.set('med_01J9Z8XK4M2Q7T5V3N8R1B6C0D', {
    mediaId: 'med_01J9Z8XK4M2Q7T5V3N8R1B6C0D',
    filename: 'persian-sunrise-hero.jpg',
    contentType: 'image/jpeg',
    bytes: 4831244,
    kind: 'hero',
    status: 'ready',
    alt: 'A copper bowl of saffron threads and dried rose petals',
    width: 4000,
    height: 2667,
    cdnUrl: HERO_PS.cdnUrl,
    derivatives: [{ format: 'avif', width: 1280, cdnUrl: HERO_PS.cdnUrl }],
    uploadedBy: 'editor@treveanspice.com',
    createdAt: '2026-08-13T10:00:00Z',
  });
  media.set('med_01J9Z8XM7P4R2T6W4Q9S3C7E1F', {
    mediaId: 'med_01J9Z8XM7P4R2T6W4Q9S3C7E1F',
    filename: 'caribbean-sunset-hero.jpg',
    contentType: 'image/jpeg',
    bytes: 3910022,
    kind: 'hero',
    status: 'ready',
    alt: 'Scotch bonnet peppers and thyme on a wooden board',
    width: 4000,
    height: 2667,
    cdnUrl: HERO_CS.cdnUrl,
    derivatives: [],
    uploadedBy: 'editor@treveanspice.com',
    createdAt: '2026-08-13T10:04:00Z',
  });

  const catalog = new Map<string, any>();
  const catalogSeed: Array<[string, string, string, string, number, string]> = [
    ['persian-sunrise', 'TRV-PS-60G', '7391043289601', '41802938471233', 2400, 'in_stock'],
    ['caribbean-sunset', 'TRV-CS-60G', '7391043355137', '41802938536769', 2200, 'in_stock'],
    ['north-african-night-market', 'TRV-NM-60G', '7391043420673', '41802938602305', 2200, 'unknown'],
    ['silk-road', 'TRV-SR-60G', '7391043486209', '41802938667841', 2200, 'unknown'],
    ['kyoto-garden', 'TRV-KG-60G', '7391043551745', '41802938733377', 2400, 'out_of_stock'],
  ];
  for (const [slug, sku, productId, variantId, amount, inventoryStatus] of catalogSeed) {
    catalog.set(slug, {
      slug,
      sku,
      shopifyProductId: `gid://shopify/Product/${productId}`,
      shopifyVariantId: `gid://shopify/ProductVariant/${variantId}`,
      price: { amount, currency: 'USD' },
      compareAtPrice: null,
      available: inventoryStatus === 'in_stock',
      inventoryStatus,
      cartPermalinkUrl: `https://shop.treveanspice.com/cart/${variantId}:1?channel=nfc`,
      syncedAt: '2026-08-17T08:55:00Z',
      stale: false,
    });
  }

  const tagSeed: Array<[string, string, number, 'encoded' | 'reserved']> = [
    ['ps', 'persian-sunrise', 250, 'encoded'],
    ['cs', 'caribbean-sunset', 250, 'encoded'],
    ['sr', 'silk-road', 250, 'encoded'],
    ['nm', 'north-african-night-market', 250, 'encoded'],
    ['kg', 'kyoto-garden', 0, 'reserved'],
  ];
  const tags = tagSeed.map(([code, blendSlug, unitsEncoded, status]) => ({
    code,
    blendSlug,
    requestPath: `/t/${code}`,
    targetPath: `/blend.html?blend=${blendSlug}&via=nfc`,
    redirectStatus: 307,
    unitsEncoded,
    status,
    encodedOn: status === 'encoded' ? '2026-07-24' : null,
    supplierOrderRef: status === 'encoded' ? 'SO4731' : null,
    chipPartNumber: status === 'encoded' ? 'ST25TV02KC' : null,
    // False on the encoded run and null on the reserved code. Decision log D18, Wednesday
    // 19 August 2026, closing Q4: SO4731 shipped with no write protection.
    writeProtected: status === 'encoded' ? false : null,
    ndefUri: status === 'encoded' ? `https://treveanspice.com/t/${code}` : null,
    lastVerifiedAgainstPhysicalTag: null,
  }));

  return {
    blends,
    recipes,
    growers,
    media,
    catalog,
    tags,
    scanKeys: new Set<string>(),
    scanCount: 0,
  };
}
