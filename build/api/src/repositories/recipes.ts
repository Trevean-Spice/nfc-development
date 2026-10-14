import { DeleteCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { config } from '../config/env.js';
import { db, isConditionalCheckFailed } from '../db/client.js';
import { recipeSk } from '../db/keys.js';
import { versionConflict } from '../http/errors.js';
import { nowIso } from '../util/time.js';

/**
 * Access pattern 3: recipes for a blend, in carousel order, one Query.
 *
 * The sort key is zero padded sortOrder then recipeId. Zero padding so string ordering
 * matches numeric ordering, and the recipe id as tiebreaker so carousel order is stable
 * across builds. An unstable order produces a diff on every rebuild and hides real changes.
 */

export interface RecipeItem {
  blendSlug: string;
  sk: string;
  recipeId: string;
  title: string;
  summary?: string | null;
  servings?: number | null;
  prepMinutes?: number | null;
  cookMinutes?: number | null;
  difficulty?: string | null;
  ingredients?: Array<Record<string, unknown>>;
  steps?: string[];
  imageId?: string | null;
  sortOrder: number;
  status: 'draft' | 'published' | 'archived';
  version: number;
  createdAt: string;
  updatedAt: string;
}

const TABLE = () => config.tables.recipes;
const BY_ID = () => config.indexes.recipeById;

export async function listRecipesForBlend(
  blendSlug: string,
  limit: number,
  startKey?: Record<string, unknown>,
): Promise<{ items: RecipeItem[]; lastKey?: Record<string, unknown> }> {
  const out = await db().send(
    new QueryCommand({
      TableName: TABLE(),
      KeyConditionExpression: 'blendSlug = :b',
      ExpressionAttributeValues: { ':b': blendSlug },
      ScanIndexForward: true,
      Limit: limit,
      ExclusiveStartKey: startKey as never,
    }),
  );
  return { items: (out.Items ?? []) as RecipeItem[], lastKey: out.LastEvaluatedKey as Record<string, unknown> | undefined };
}

export async function getRecipe(recipeId: string): Promise<RecipeItem | undefined> {
  const out = await db().send(
    new QueryCommand({
      TableName: TABLE(),
      IndexName: BY_ID(),
      KeyConditionExpression: 'recipeId = :r',
      ExpressionAttributeValues: { ':r': recipeId },
      Limit: 1,
    }),
  );
  return (out.Items ?? [])[0] as RecipeItem | undefined;
}

export async function createRecipe(item: Omit<RecipeItem, 'sk' | 'createdAt' | 'updatedAt' | 'version'>): Promise<RecipeItem> {
  const now = nowIso();
  const full: RecipeItem = { ...item, sk: recipeSk(item.sortOrder, item.recipeId), version: 1, createdAt: now, updatedAt: now };
  await db().send(new PutCommand({ TableName: TABLE(), Item: full, ConditionExpression: 'attribute_not_exists(sk)' }));
  return full;
}

export async function updateRecipe(
  current: RecipeItem,
  expectedVersion: number,
  changes: Record<string, unknown>,
): Promise<RecipeItem> {
  if (current.version !== expectedVersion) {
    throw versionConflict(`This recipe was changed at ${current.updatedAt}. Reload before saving.`);
  }
  const nextSortOrder = typeof changes['sortOrder'] === 'number' ? (changes['sortOrder'] as number) : current.sortOrder;
  const movesPartitionSortKey = nextSortOrder !== current.sortOrder;

  if (!movesPartitionSortKey) {
    const names: Record<string, string> = { '#v': 'version', '#u': 'updatedAt' };
    const values: Record<string, unknown> = { ':expected': expectedVersion, ':one': 1, ':now': nowIso() };
    const sets = ['#u = :now'];
    let i = 0;
    for (const [key, value] of Object.entries(changes)) {
      i += 1;
      names[`#f${i}`] = key;
      values[`:f${i}`] = value;
      sets.push(`#f${i} = :f${i}`);
    }
    try {
      const out = await db().send(
        new UpdateCommand({
          TableName: TABLE(),
          Key: { blendSlug: current.blendSlug, sk: current.sk },
          UpdateExpression: `SET ${sets.join(', ')} ADD #v :one`,
          ConditionExpression: '#v = :expected',
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ReturnValues: 'ALL_NEW',
        }),
      );
      return out.Attributes as RecipeItem;
    } catch (err) {
      if (isConditionalCheckFailed(err)) throw versionConflict('This recipe was changed by someone else. Reload before saving.');
      throw err;
    }
  }

  // Changing sortOrder changes the sort key, so the item moves. The delete carries the
  // version condition, which is what enforces optimistic concurrency, and the put follows.
  const next: RecipeItem = {
    ...current,
    ...changes,
    sortOrder: nextSortOrder,
    sk: recipeSk(nextSortOrder, current.recipeId),
    version: current.version + 1,
    updatedAt: nowIso(),
  } as RecipeItem;
  try {
    await db().send(
      new DeleteCommand({
        TableName: TABLE(),
        Key: { blendSlug: current.blendSlug, sk: current.sk },
        ConditionExpression: '#v = :expected',
        ExpressionAttributeNames: { '#v': 'version' },
        ExpressionAttributeValues: { ':expected': expectedVersion },
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailed(err)) throw versionConflict('This recipe was changed by someone else. Reload before saving.');
    throw err;
  }
  await db().send(new PutCommand({ TableName: TABLE(), Item: next }));
  return next;
}

/**
 * Soft delete. Content that has been on a printed jar's page is worth keeping, so archive
 * moves the record to status archived rather than destroying it.
 */
export async function archiveRecipe(current: RecipeItem): Promise<void> {
  await db().send(
    new UpdateCommand({
      TableName: TABLE(),
      Key: { blendSlug: current.blendSlug, sk: current.sk },
      UpdateExpression: 'SET #s = :archived, updatedAt = :now ADD #v :one',
      ExpressionAttributeNames: { '#s': 'status', '#v': 'version' },
      ExpressionAttributeValues: { ':archived': 'archived', ':now': nowIso(), ':one': 1 },
    }),
  );
}

export async function countPublishedRecipes(blendSlug: string): Promise<number> {
  const out = await db().send(
    new QueryCommand({
      TableName: TABLE(),
      KeyConditionExpression: 'blendSlug = :b',
      FilterExpression: '#s = :published',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':b': blendSlug, ':published': 'published' },
      Select: 'COUNT',
    }),
  );
  return out.Count ?? 0;
}
