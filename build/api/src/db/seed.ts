import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { config } from '../config/env.js';
import { db } from './client.js';
import { blendPk, ENTITY, LIVE_SK, recipeSk } from './keys.js';
import { putCatalogEntry } from '../repositories/catalog.js';
import { putTagRecord } from '../repositories/tags.js';
import { redirectTable } from '../services/redirectTable.js';
import { nowIso } from '../util/time.js';

/**
 * Seed data.
 *
 * NOTE ON THE RECIPE IDS. They are one character off the worked examples in the frozen
 * OpenAPI document, deliberately. Those examples end in L, and the recipeId pattern the
 * same document declares is ^rcp_[0-9A-HJKMNP-TV-Z]{26}$, which is Crockford base32 with
 * I, L, O and U removed. The examples therefore fail their own pattern. The pattern is
 * correct and the examples are not, so the pattern is implemented and the discrepancy is
 * reported rather than the validation being loosened to match a typo.
 *
 * Two launch blends with real content, three seeded so the page shape can be built and
 * measured before content lands. The grower names, recipe copy and prices here are
 * illustrative placeholders pending content delivery from Trevean, and are labelled as
 * such rather than presented as final.
 *
 * The NFCTags rows are seeded FROM the version controlled redirect table, never typed in
 * separately. One source, three derived artifacts: the CDN edge redirect configuration,
 * this mirror, and the chip programming tooling's input. A code encoded onto a physical tag
 * and a code served by the edge can never come from two different lists.
 */

const GROWER_ID_PS = 'grw_01J9Z900A1B2C3D4E5F6G7H8J9';
const GROWER_ID_CS = 'grw_01J9Z900A1B2C3D4E5F6G7H8JA';

interface SeedOptions {
  sourceCommit?: string;
  now?: string;
}

export async function seed(options: SeedOptions = {}): Promise<void> {
  const now = options.now ?? nowIso();
  const table = redirectTable();

  for (const entry of table.entries) {
    await putTagRecord({
      code: entry.code,
      blendSlug: entry.blendSlug,
      requestPath: entry.requestPath,
      targetPath: entry.targetPath,
      redirectStatus: table.redirectStatus,
      unitsEncoded: entry.unitsEncoded,
      status: entry.status,
      encodedOn: entry.encodedOn,
      supplierOrderRef: entry.supplierOrderRef,
      chipPartNumber: entry.chipPartNumber,
      // Carried through from the redirect table rather than defaulted here. False on the
      // four encoded rows: SO4731 shipped with no write protection, answered Wednesday
      // 19 August 2026 (decision log D18, closing Q4). Null on the reserved row, where no
      // tag exists to have a state, and null still means unknown rather than unprotected.
      writeProtected: entry.writeProtected,
      ndefUri: entry.ndefUri,
      lastVerifiedAgainstPhysicalTag: null,
      sourceCommit: options.sourceCommit ?? null,
      deployedAt: now,
    });
  }

  await db().send(
    new PutCommand({
      TableName: config.tables.growers,
      Item: {
        growerId: GROWER_ID_PS,
        entityType: ENTITY.grower,
        name: 'Placeholder pending content delivery',
        farmName: 'Placeholder pending content delivery',
        // Null for the same reason as the blend's origin above, and it matters more here:
        // a grower record with a country attached is the shape of a provenance claim even
        // when the name is a placeholder. See "Decision log", D29 and D39.
        country: null,
        region: null,
        bio: 'Grower profile copy is supplied by Trevean. This record is seeded so the page shape can be built and measured before content lands.',
        yearsFarming: null,
        portraitId: null,
        farm: { latitude: null, longitude: null },
        blendSlugs: ['persian-sunrise'],
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
    }),
  );

  await db().send(
    new PutCommand({
      TableName: config.tables.growers,
      Item: {
        growerId: GROWER_ID_CS,
        entityType: ENTITY.grower,
        name: 'Placeholder pending content delivery',
        farmName: 'Placeholder pending content delivery',
        country: 'TT',
        region: 'Trinidad',
        bio: 'Grower profile copy is supplied by Trevean. This record is seeded so the page shape can be built and measured before content lands.',
        yearsFarming: null,
        portraitId: null,
        farm: { latitude: null, longitude: null },
        blendSlugs: ['caribbean-sunset'],
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
    }),
  );

  const blends = [
    {
      slug: 'persian-sunrise',
      name: 'Persian Sunrise',
      status: 'published',
      // Composition by weight from the blend production specification v1.2, and no origin.
      //
      // This read 'Saffron, cardamom, rose petals and lime from Isfahan' with originCountry
      // 'IR' until Tuesday 8 September 2026, which is wrong twice over and was corrected
      // everywhere else on Saturday 5 September under "Decision log", D39. This seed was
      // missed, so the admin still showed a client the exact provenance D29 forbids.
      //
      // The specification is explicit that the saffron is Spanish, the cinnamon Ceylonese
      // and the lime Omani, so the blend contains no Iranian ingredient while the printed
      // label still names a grower at Kashan area coordinates. And the old list led with
      // saffron at one part in a thousand while omitting the cinnamon that is half the
      // blend. Origin is null rather than replaced: there is no single true origin to state.
      tagline: 'Ceylon cinnamon, green cardamom, Omani dried lime, rose petals and saffron',
      launchTier: 'real',
      originCountry: null,
      originRegion: null,
      originCity: null,
      // Farm location is a factual claim about a real supply chain. Held null until Trevean supplies it.
      farm: { latitude: null, longitude: null, label: '[PLACEHOLDER] NOT REAL CONTENT, farm location pending content delivery' },
      storyBlocks: [
        { type: 'heading', text: '[PLACEHOLDER] NOT REAL CONTENT, origin story heading pending content delivery' },
        {
          type: 'paragraph',
          text: '[PLACEHOLDER] NOT REAL CONTENT, origin story paragraph pending content delivery. Content writing is outside the contractor scope.',
        },
      ],
      growerId: GROWER_ID_PS,
      freshness: {
        // Dates and lot are factual claims about real product. Held null until Trevean supplies them.
        harvestedOn: null,
        blendedOn: null,
        bestBefore: null,
        lotLabel: null,
        note: 'Freshness is stated per blend rather than per jar, because tag encoding is per SKU.',
      },
      shopify: {
        // Held null until Shopify Plus store access lands. A plausible looking id would
        // give the reorder button a destination that does not exist.
        productId: null,
        variantId: null,
        sku: null,
        cartPermalinkUrl: null,
      },
      recipeCount: 1,
    },
    {
      slug: 'caribbean-sunset',
      name: 'Caribbean Sunset',
      status: 'published',
      tagline: 'Scotch bonnet, allspice and thyme from Trinidad and Tobago',
      launchTier: 'real',
      originCountry: 'TT',
      originRegion: 'Trinidad',
      originCity: 'Port of Spain',
      // Farm location is a factual claim about a real supply chain. Held null until Trevean supplies it.
      farm: { latitude: null, longitude: null, label: '[PLACEHOLDER] NOT REAL CONTENT, farm location pending content delivery' },
      storyBlocks: [{ type: 'heading', text: '[PLACEHOLDER] NOT REAL CONTENT, origin story heading pending content delivery' }],
      growerId: GROWER_ID_CS,
      freshness: { harvestedOn: null, blendedOn: null, bestBefore: null, lotLabel: null, note: null },
      shopify: {
        productId: null,
        variantId: null,
        sku: null,
        cartPermalinkUrl: null,
      },
      recipeCount: 1,
    },
    {
      slug: 'north-african-night-market',
      name: 'North African Night Market',
      status: 'published',
      tagline: 'Aleppo pepper, cumin and preserved lemon from Fez',
      launchTier: 'seeded',
      originCountry: 'MA',
      originRegion: 'Fes-Meknes',
      recipeCount: 0,
    },
    {
      slug: 'silk-road',
      name: 'The Silk Road',
      status: 'published',
      tagline: 'Cumin, coriander, fenugreek and turmeric from Central Asia',
      launchTier: 'seeded',
      originCountry: 'UZ',
      originRegion: 'Central Asia',
      recipeCount: 0,
    },
    {
      // Kyoto Garden is the reserved fifth code. No tag in this production run carries it.
      slug: 'kyoto-garden',
      name: 'Kyoto Garden',
      status: 'draft',
      tagline: 'Sesame, nori, yuzu and green tea from Kyoto',
      launchTier: 'seeded',
      originCountry: 'JP',
      originRegion: 'Kyoto',
      recipeCount: 0,
    },
  ];

  let offset = 0;
  for (const blend of blends) {
    offset += 1;
    const tagCode = table.entries.find((e) => e.blendSlug === blend.slug)?.code ?? null;
    // Distinct updatedAt values so the status index returns a stable, reproducible order.
    const stamp = nowIso(Date.parse(now) + offset * 1000);
    await db().send(
      new PutCommand({
        TableName: config.tables.spiceBlends,
        Item: {
          pk: blendPk(blend.slug),
          sk: LIVE_SK,
          entityType: ENTITY.blend,
          tagCode,
          heroImageId: null,
          galleryImageIds: [],
          version: 1,
          publishedAt: blend.status === 'published' ? stamp : null,
          createdAt: stamp,
          updatedAt: stamp,
          updatedBy: 'seed@treveanspice.com',
          ...blend,
        },
      }),
    );

    await putCatalogEntry({
      slug: blend.slug,
      sku: (blend.shopify?.sku as string | null) ?? null,
      shopifyProductId: (blend.shopify?.productId as string | null) ?? null,
      shopifyVariantId: (blend.shopify?.variantId as string | null) ?? null,
      // Price and availability are facts about real product held in a Shopify store
      // we do not have access to. Seeding a plausible number would put an invented
      // price in front of a customer, so they are held null and unknown.
      priceAmount: null,
      priceCurrency: 'USD',
      compareAtAmount: null,
      available: false,
      inventoryStatus: 'unknown',
      cartPermalinkUrl: (blend.shopify?.cartPermalinkUrl as string | null) ?? null,
      syncedAt: now,
      syncSource: 'seed',
    });
  }

  const recipes = [
    {
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
      sortOrder: 1,
    },
    {
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
      sortOrder: 1,
    },
  ];

  for (const recipe of recipes) {
    await db().send(
      new PutCommand({
        TableName: config.tables.recipes,
        Item: {
          ...recipe,
          sk: recipeSk(recipe.sortOrder, recipe.recipeId),
          imageId: null,
          status: 'published',
          version: 1,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
  }
}
