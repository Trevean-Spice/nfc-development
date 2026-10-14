// Discovers the identifiers the single resource operations need, from the target itself.
//
// Hard coding a recipe id would make the suite runnable against exactly one seeded
// database. Discovery is what makes the same suite runnable against the stub, staging and
// production without editing anything. Configured fallbacks are used only when discovery
// cannot see a record.

import { callOperation } from './client.js';
import { config } from './config.js';

export interface DiscoveredIds {
  recipeId: string | null;
  growerId: string | null;
  mediaId: string | null;
  publishedSlugs: string[];
  notes: string[];
}

let cached: Promise<DiscoveredIds> | null = null;

async function discover(): Promise<DiscoveredIds> {
  const notes: string[] = [];
  const result: DiscoveredIds = {
    recipeId: null,
    growerId: null,
    mediaId: null,
    publishedSlugs: [],
    notes,
  };

  try {
    const blends = await callOperation('listBlends', { anonymous: true, expectStatus: 200 });
    result.publishedSlugs = (blends.body?.data ?? []).map((blend: any) => blend.slug);
  } catch (error) {
    notes.push(`listBlends discovery failed: ${(error as Error).message}`);
  }

  for (const slug of ['persian-sunrise', 'caribbean-sunset', ...result.publishedSlugs]) {
    if (result.recipeId) break;
    try {
      const recipes = await callOperation('listRecipesForBlend', {
        pathParams: { slug },
        anonymous: true,
      });
      const first = recipes.body?.data?.[0];
      if (first?.recipeId) result.recipeId = first.recipeId;
    } catch (error) {
      notes.push(`listRecipesForBlend discovery on ${slug} failed: ${(error as Error).message}`);
    }
  }

  try {
    const growers = await callOperation('listGrowers', { anonymous: true, expectStatus: 200 });
    const first = growers.body?.data?.[0];
    if (first?.growerId) result.growerId = first.growerId;
  } catch (error) {
    notes.push(`listGrowers discovery failed: ${(error as Error).message}`);
  }

  if (config.tokens.viewer || config.tokens.editor || config.tokens.admin) {
    try {
      const media = await callOperation('adminListMedia', {
        role: config.tokens.viewer ? 'viewer' : config.tokens.editor ? 'editor' : 'admin',
      });
      const first = media.body?.data?.[0];
      if (first?.mediaId) result.mediaId = first.mediaId;
    } catch (error) {
      notes.push(`adminListMedia discovery failed: ${(error as Error).message}`);
    }
  }

  if (!result.recipeId) {
    result.recipeId = config.fallbackIds.recipeId;
    notes.push('recipeId fell back to CONTRACT_TEST_RECIPE_ID');
  }
  if (!result.growerId) {
    result.growerId = config.fallbackIds.growerId;
    notes.push('growerId fell back to CONTRACT_TEST_GROWER_ID');
  }
  if (!result.mediaId) {
    result.mediaId = config.fallbackIds.mediaId;
    notes.push('mediaId fell back to CONTRACT_TEST_MEDIA_ID');
  }

  return result;
}

export function discoveredIds(): Promise<DiscoveredIds> {
  if (!cached) cached = discover();
  return cached;
}
