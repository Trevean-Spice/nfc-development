import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import config from './default';

/**
 * DynamoDB configuration and client initialization
 */

export interface TableDefinition {
  name: string;
  keySchema: Array<{
    AttributeName: string;
    KeyType: 'HASH' | 'RANGE';
  }>;
  attributeDefinitions: Array<{
    AttributeName: string;
    AttributeType: 'S' | 'N' | 'B';
  }>;
  billingMode: 'PAY_PER_REQUEST' | 'PROVISIONED';
  provisionedThroughput?: {
    ReadCapacityUnits: number;
    WriteCapacityUnits: number;
  };
}

/**
 * Table definitions for Trevean NFC project
 */
export const tables: { [key: string]: TableDefinition } = {
  spiceBlends: {
    name: `${config.dynamodb.tablePrefix}spice-blends`,
    keySchema: [{ AttributeName: 'blendId', KeyType: 'HASH' }],
    attributeDefinitions: [{ AttributeName: 'blendId', AttributeType: 'S' }],
    billingMode: 'PAY_PER_REQUEST',
  },

  scanEvents: {
    name: `${config.dynamodb.tablePrefix}scan-events`,
    keySchema: [
      { AttributeName: 'chipUid', KeyType: 'HASH' },
      { AttributeName: 'timestamp', KeyType: 'RANGE' },
    ],
    attributeDefinitions: [
      { AttributeName: 'chipUid', AttributeType: 'S' },
      { AttributeName: 'timestamp', AttributeType: 'S' },
    ],
    billingMode: 'PAY_PER_REQUEST',
  },

  recipes: {
    name: `${config.dynamodb.tablePrefix}recipes`,
    keySchema: [
      { AttributeName: 'blendId', KeyType: 'HASH' },
      { AttributeName: 'recipeId', KeyType: 'RANGE' },
    ],
    attributeDefinitions: [
      { AttributeName: 'blendId', AttributeType: 'S' },
      { AttributeName: 'recipeId', AttributeType: 'S' },
    ],
    billingMode: 'PAY_PER_REQUEST',
  },

  nfcTags: {
    name: `${config.dynamodb.tablePrefix}nfc-tags`,
    keySchema: [{ AttributeName: 'chipUid', KeyType: 'HASH' }],
    attributeDefinitions: [{ AttributeName: 'chipUid', AttributeType: 'S' }],
    billingMode: 'PAY_PER_REQUEST',
  },

  growers: {
    name: `${config.dynamodb.tablePrefix}growers`,
    keySchema: [{ AttributeName: 'growerId', KeyType: 'HASH' }],
    attributeDefinitions: [{ AttributeName: 'growerId', AttributeType: 'S' }],
    billingMode: 'PAY_PER_REQUEST',
  },
};

/**
 * Initialize DynamoDB client
 */
function createDynamoDBClient(): DynamoDBClient {
  const clientConfig: any = {
    region: config.aws.region,
    credentials: {
      accessKeyId: config.aws.accessKeyId,
      secretAccessKey: config.aws.secretAccessKey,
    },
  };

  // Use local endpoint in development
  if (config.dynamodb.endpoint) {
    clientConfig.endpoint = config.dynamodb.endpoint;
  }

  return new DynamoDBClient(clientConfig);
}

/**
 * Initialize all required DynamoDB tables
 */
export async function initializeTables(client: DynamoDBClient): Promise<void> {
  const { CreateTableCommand, ListTablesCommand } = await import(
    '@aws-sdk/client-dynamodb'
  );

  try {
    const existingTables = await client.send(new ListTablesCommand({}));
    const existingTableNames = new Set(existingTables.TableNames || []);

    for (const [key, tableDefinition] of Object.entries(tables)) {
      if (existingTableNames.has(tableDefinition.name)) {
        console.log(`Table ${tableDefinition.name} already exists`);
        continue;
      }

      console.log(`Creating table: ${tableDefinition.name}`);

      const createCommand = new CreateTableCommand({
        TableName: tableDefinition.name,
        KeySchema: tableDefinition.keySchema,
        AttributeDefinitions: tableDefinition.attributeDefinitions,
        BillingMode: tableDefinition.billingMode,
        ...(tableDefinition.provisionedThroughput && {
          ProvisionedThroughput: tableDefinition.provisionedThroughput,
        }),
      });

      await client.send(createCommand);
      console.log(`Table ${tableDefinition.name} created successfully`);
    }
  } catch (error) {
    console.error('Failed to initialize tables:', error);
    throw error;
  }
}

export const dynamoDBClient = createDynamoDBClient();
