import { DynamoDB } from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';

const dynamodb = new DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

export interface SpiceBlendData {
  id: string;
  name: string;
  description: string;
  ingredients: string[];
  origin: string;
  harvestDate: string;
  freshnessStatus: 'FRESH' | 'AGING' | 'EXPIRED' | 'UNKNOWN';
  scanCount: number;
  growerId: string;
  createdAt: string;
  updatedAt: string;
}

const TABLE_NAME = process.env.DYNAMODB_BLEND_TABLE || 'spice-blends';

export class BlendModel {
  static async findById(id: string): Promise<SpiceBlendData | null> {
    try {
      const result = await dynamodb
        .get({
          TableName: TABLE_NAME,
          Key: { id },
        })
        .promise();

      return result.Item as SpiceBlendData | undefined || null;
    } catch (error) {
      console.error('Error finding blend by ID:', error);
      throw error;
    }
  }

  static async findAll(
    page: number = 1,
    limit: number = 20
  ): Promise<{ items: SpiceBlendData[]; total: number }> {
    try {
      const offset = (page - 1) * limit;

      const result = await dynamodb
        .scan({
          TableName: TABLE_NAME,
          Limit: limit + 1,
          ExclusiveStartKey: offset > 0 ? { id: '' } : undefined,
        })
        .promise();

      const items = (result.Items as SpiceBlendData[]).slice(0, limit);
      const total = result.Count || 0;

      return { items, total };
    } catch (error) {
      console.error('Error finding all blends:', error);
      throw error;
    }
  }

  static async create(data: Omit<SpiceBlendData, 'id' | 'createdAt' | 'updatedAt'>): Promise<SpiceBlendData> {
    try {
      const now = new Date().toISOString();
      const blend: SpiceBlendData = {
        ...data,
        id: uuidv4(),
        scanCount: 0,
        createdAt: now,
        updatedAt: now,
      };

      await dynamodb
        .put({
          TableName: TABLE_NAME,
          Item: blend,
        })
        .promise();

      return blend;
    } catch (error) {
      console.error('Error creating blend:', error);
      throw error;
    }
  }

  static async update(id: string, data: Partial<SpiceBlendData>): Promise<SpiceBlendData> {
    try {
      const now = new Date().toISOString();
      const updateData = { ...data, updatedAt: now };

      const result = await dynamodb
        .update({
          TableName: TABLE_NAME,
          Key: { id },
          UpdateExpression: Object.keys(updateData)
            .map((key) => `${key} = :${key}`)
            .join(', '),
          ExpressionAttributeValues: Object.entries(updateData).reduce(
            (acc, [key, value]) => ({ ...acc, [`:${key}`]: value }),
            {}
          ),
          ReturnValues: 'ALL_NEW',
        })
        .promise();

      return result.Attributes as SpiceBlendData;
    } catch (error) {
      console.error('Error updating blend:', error);
      throw error;
    }
  }

  static async delete(id: string): Promise<void> {
    try {
      await dynamodb
        .delete({
          TableName: TABLE_NAME,
          Key: { id },
        })
        .promise();
    } catch (error) {
      console.error('Error deleting blend:', error);
      throw error;
    }
  }

  static async incrementScanCount(id: string): Promise<void> {
    try {
      await dynamodb
        .update({
          TableName: TABLE_NAME,
          Key: { id },
          UpdateExpression: 'SET scanCount = if_not_exists(scanCount, :zero) + :inc, updatedAt = :now',
          ExpressionAttributeValues: {
            ':inc': 1,
            ':zero': 0,
            ':now': new Date().toISOString(),
          },
        })
        .promise();
    } catch (error) {
      console.error('Error incrementing scan count:', error);
      throw error;
    }
  }
}
