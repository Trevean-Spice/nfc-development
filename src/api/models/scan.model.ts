import { DynamoDB } from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';

const dynamodb = new DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

export interface ScanEventData {
  id: string;
  tagUid: string;
  blendId: string;
  deviceType: 'SMARTPHONE' | 'TABLET' | 'READER' | 'DISPENSER';
  timestamp: string;
  location?: string;
  userAgent?: string;
}

const TABLE_NAME = process.env.DYNAMODB_SCAN_TABLE || 'nfc-scan-events';
const GSI_NAME = 'tagUid-timestamp-index';

export class ScanModel {
  static async create(data: Omit<ScanEventData, 'id'>): Promise<ScanEventData> {
    try {
      const scanEvent: ScanEventData = {
        ...data,
        id: uuidv4(),
      };

      await dynamodb
        .put({
          TableName: TABLE_NAME,
          Item: scanEvent,
        })
        .promise();

      return scanEvent;
    } catch (error) {
      console.error('Error creating scan event:', error);
      throw error;
    }
  }

  static async findByTagUid(
    tagUid: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<{ items: ScanEventData[]; total: number }> {
    try {
      const result = await dynamodb
        .query({
          TableName: TABLE_NAME,
          IndexName: GSI_NAME,
          KeyConditionExpression: 'tagUid = :tagUid',
          ExpressionAttributeValues: {
            ':tagUid': tagUid,
          },
          ScanIndexForward: false,
          Limit: limit,
        })
        .promise();

      const items = (result.Items as ScanEventData[]) || [];
      const total = result.Count || 0;

      return { items, total };
    } catch (error) {
      console.error('Error finding scan events by tag UID:', error);
      throw error;
    }
  }

  static async getCountByTagUid(tagUid: string): Promise<number> {
    try {
      const result = await dynamodb
        .query({
          TableName: TABLE_NAME,
          IndexName: GSI_NAME,
          KeyConditionExpression: 'tagUid = :tagUid',
          ExpressionAttributeValues: {
            ':tagUid': tagUid,
          },
          Select: 'COUNT',
        })
        .promise();

      return result.Count || 0;
    } catch (error) {
      console.error('Error getting scan count by tag UID:', error);
      throw error;
    }
  }

  static async findById(id: string): Promise<ScanEventData | null> {
    try {
      const result = await dynamodb
        .query({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'id = :id',
          ExpressionAttributeValues: {
            ':id': id,
          },
        })
        .promise();

      return (result.Items?.[0] as ScanEventData) || null;
    } catch (error) {
      console.error('Error finding scan event by ID:', error);
      throw error;
    }
  }
}
