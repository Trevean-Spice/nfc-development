import {
  CreateTableCommand,
  DescribeTableCommand,
  UpdateTimeToLiveCommand,
  type CreateTableCommandInput,
} from '@aws-sdk/client-dynamodb';
import { config } from '../config/env.js';
import { dynamoClient } from './client.js';

/**
 * The five tables, exactly as the Data model document specifies them, expressed as code so
 * a local stack and the AWS account are provably the same shape.
 *
 * FIVE TABLES. NO SIXTH TABLE. The catalog mirror, media records, idempotency records,
 * revalidation jobs and the rollups all live inside these five under their own key
 * namespaces.
 *
 * The production definitions belong in the infrastructure as code deliverable, which owns
 * on-demand capacity, point in time recovery, TTL and the stream. This module exists so
 * the API can be run and tested with no AWS account at all, and so the shapes the
 * repositories assume are written down in one checkable place.
 */

export function tableDefinitions(): CreateTableCommandInput[] {
  const t = config.tables;
  const i = config.indexes;
  return [
    {
      TableName: t.spiceBlends,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'pk', AttributeType: 'S' },
        { AttributeName: 'sk', AttributeType: 'S' },
        { AttributeName: 'status', AttributeType: 'S' },
        { AttributeName: 'updatedAt', AttributeType: 'S' },
        { AttributeName: 'slug', AttributeType: 'S' },
        { AttributeName: 'entityType', AttributeType: 'S' },
        { AttributeName: 'createdAt', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          // Pattern 2. INCLUDE rather than ALL is deliberate: storyBlocks is the largest
          // attribute on the item and projecting it doubles the write cost of every blend
          // save for no read benefit.
          IndexName: i.blendsByStatus,
          KeySchema: [
            { AttributeName: 'status', KeyType: 'HASH' },
            { AttributeName: 'updatedAt', KeyType: 'RANGE' },
          ],
          Projection: {
            ProjectionType: 'INCLUDE',
            NonKeyAttributes: [
              'slug',
              'name',
              'tagline',
              'launchTier',
              'tagCode',
              'heroImageId',
              'recipeCount',
              'publishedAt',
              'version',
              'originCountry',
              'originRegion',
            ],
          },
        },
        {
          // Only needed if the real table turns out to be keyed on a synthetic blendId
          // rather than the slug. Kept here because pattern 1 must never require a Scan to
          // turn a slug into an id.
          IndexName: i.blendsBySlug,
          KeySchema: [{ AttributeName: 'slug', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          // Serves the admin media library list. This index is an addition the Data model
          // document does not specify, because that document does not cover media records.
          IndexName: i.blendsByEntity,
          KeySchema: [
            { AttributeName: 'entityType', KeyType: 'HASH' },
            { AttributeName: 'createdAt', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    },
    {
      TableName: t.recipes,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'blendSlug', AttributeType: 'S' },
        { AttributeName: 'sk', AttributeType: 'S' },
        { AttributeName: 'recipeId', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'blendSlug', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: i.recipeById,
          KeySchema: [{ AttributeName: 'recipeId', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    },
    {
      TableName: t.growers,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'growerId', AttributeType: 'S' },
        { AttributeName: 'entityType', AttributeType: 'S' },
        { AttributeName: 'name', AttributeType: 'S' },
      ],
      KeySchema: [{ AttributeName: 'growerId', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [
        {
          // A constant partition key is a single partition index, which is normally a
          // smell. With a handful of growers, admin only reads and no consumer traffic it
          // is the correct call. The threshold at which it stops being correct is roughly
          // 1,000 growers or any consumer facing read.
          IndexName: i.growersByEntityName,
          KeySchema: [
            { AttributeName: 'entityType', KeyType: 'HASH' },
            { AttributeName: 'name', KeyType: 'RANGE' },
          ],
          Projection: {
            ProjectionType: 'INCLUDE',
            NonKeyAttributes: ['name', 'farmName', 'country', 'region', 'portraitId', 'version', 'updatedAt', 'blendSlugs'],
          },
        },
      ],
    },
    {
      TableName: t.nfcTags,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [{ AttributeName: 'code', AttributeType: 'S' }],
      KeySchema: [{ AttributeName: 'code', KeyType: 'HASH' }],
      // No secondary index. Five rows, one access pattern, partition key lookups only.
    },
    {
      TableName: t.scanEvents,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'pk', AttributeType: 'S' },
        { AttributeName: 'sk', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      // NEW_IMAGE, because the rollup consumer needs the event's attributes and nothing
      // about the previous state. The event source mapping filter is in stream/filter.ts
      // and is not optional: rollup writes land in this same stream.
      StreamSpecification: { StreamEnabled: true, StreamViewType: 'NEW_IMAGE' },
      // No secondary index on raw events. That is the point of the rollups.
    },
  ];
}

async function exists(tableName: string): Promise<boolean> {
  try {
    await dynamoClient().send(new DescribeTableCommand({ TableName: tableName }));
    return true;
  } catch {
    return false;
  }
}

export async function ensureTables(withTtl = true): Promise<string[]> {
  const created: string[] = [];
  for (const definition of tableDefinitions()) {
    const name = definition.TableName as string;
    if (await exists(name)) continue;
    try {
      await dynamoClient().send(new CreateTableCommand(definition));
    } catch (err) {
      // Local DynamoDB substitutes do not all implement stream configuration. Fall back to
      // the same table without it, so local development still works. The stream is real on
      // AWS and is created by the infrastructure deliverable.
      if (!config.dynamoEndpoint || !definition.StreamSpecification) throw err;
      const { StreamSpecification: _dropped, ...withoutStream } = definition;
      await dynamoClient().send(new CreateTableCommand(withoutStream as CreateTableCommandInput));
    }
    created.push(name);
    if (withTtl && (name === config.tables.scanEvents || name === config.tables.spiceBlends)) {
      try {
        await dynamoClient().send(
          new UpdateTimeToLiveCommand({
            TableName: name,
            TimeToLiveSpecification: { Enabled: true, AttributeName: 'expiresAt' },
          }),
        );
      } catch {
        // DynamoDB Local and the in process test server do not all implement TTL. The
        // attribute is written either way, so enabling it on the real account is an
        // infrastructure step rather than a code change.
      }
    }
  }
  return created;
}
