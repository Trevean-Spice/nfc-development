import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { config } from '../config/env.js';

/**
 * One DynamoDB document client for the process.
 *
 * DYNAMODB_ENDPOINT is what makes local development possible with no AWS account: point
 * it at DynamoDB Local, or at the in process server the test suite starts, and every
 * repository in this codebase works unchanged. Nothing else in the code knows or cares.
 */

let doc: DynamoDBDocumentClient | undefined;
let base: DynamoDBClient | undefined;

function credentialsForLocal() {
  return config.dynamoEndpoint
    ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'local', secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'local' }
    : undefined;
}

export function dynamoClient(): DynamoDBClient {
  if (!base) {
    base = new DynamoDBClient({
      region: config.region,
      ...(config.dynamoEndpoint ? { endpoint: config.dynamoEndpoint } : {}),
      ...(credentialsForLocal() ? { credentials: credentialsForLocal() as never } : {}),
      maxAttempts: 3,
    });
  }
  return base;
}

export function db(): DynamoDBDocumentClient {
  if (!doc) {
    doc = DynamoDBDocumentClient.from(dynamoClient(), {
      marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: false },
      unmarshallOptions: { wrapNumbers: false },
    });
  }
  return doc;
}

/** Test seam: drop the cached clients so a suite can repoint the endpoint. */
export function resetDbClients(): void {
  doc?.destroy();
  doc = undefined;
  base = undefined;
}

export const TABLES = config.tables;
export const INDEXES = config.indexes;

export function isConditionalCheckFailed(err: unknown): boolean {
  const name = (err as { name?: string }).name;
  return name === 'ConditionalCheckFailedException';
}
