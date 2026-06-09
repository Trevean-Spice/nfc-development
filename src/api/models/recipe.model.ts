import { DynamoDB } from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';

const dynamodb = new DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

export interface RecipeData {
  id: string;
  blendId: string;
  title: string;
  description: string;
  ingredients: string[];
  instructions: string[];
  servings: number;
  prepTimeMinutes: number;
  createdAt: string;
}

const TABLE_NAME = process.env.DYNAMODB_RECIPE_TABLE || 'recipes';
const GSI_NAME = 'blendId-createdAt-index';

export class RecipeModel {
  static async findByBlendId(
    blendId: string,
    page: number = 1,
    limit: number = 10
  ): Promise<{ items: RecipeData[]; total: number }> {
    try {
      const result = await dynamodb
        .query({
          TableName: TABLE_NAME,
          IndexName: GSI_NAME,
          KeyConditionExpression: 'blendId = :blendId',
          ExpressionAttributeValues: {
            ':blendId': blendId,
          },
          ScanIndexForward: false,
          Limit: limit,
        })
        .promise();

      const items = (result.Items as RecipeData[]) || [];
      const total = result.Count || 0;

      return { items, total };
    } catch (error) {
      console.error('Error finding recipes by blend ID:', error);
      throw error;
    }
  }

  static async findById(id: string): Promise<RecipeData | null> {
    try {
      const result = await dynamodb
        .get({
          TableName: TABLE_NAME,
          Key: { id },
        })
        .promise();

      return (result.Item as RecipeData) || null;
    } catch (error) {
      console.error('Error finding recipe by ID:', error);
      throw error;
    }
  }

  static async create(data: Omit<RecipeData, 'id' | 'createdAt'>): Promise<RecipeData> {
    try {
      const recipe: RecipeData = {
        ...data,
        id: uuidv4(),
        createdAt: new Date().toISOString(),
      };

      await dynamodb
        .put({
          TableName: TABLE_NAME,
          Item: recipe,
        })
        .promise();

      return recipe;
    } catch (error) {
      console.error('Error creating recipe:', error);
      throw error;
    }
  }

  static async update(id: string, data: Partial<RecipeData>): Promise<RecipeData> {
    try {
      const result = await dynamodb
        .update({
          TableName: TABLE_NAME,
          Key: { id },
          UpdateExpression: Object.keys(data)
            .map((key) => `${key} = :${key}`)
            .join(', '),
          ExpressionAttributeValues: Object.entries(data).reduce(
            (acc, [key, value]) => ({ ...acc, [`:${key}`]: value }),
            {}
          ),
          ReturnValues: 'ALL_NEW',
        })
        .promise();

      return result.Attributes as RecipeData;
    } catch (error) {
      console.error('Error updating recipe:', error);
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
      console.error('Error deleting recipe:', error);
      throw error;
    }
  }
}
