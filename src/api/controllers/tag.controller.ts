import { Request, Response } from 'express';
import Redis from 'ioredis';
import { ScanModel } from '../models/scan.model';
import { BlendModel } from '../models/blend.model';
import { AuthenticatedRequest } from '../middleware/auth';

export class TagController {
  static async getTag(req: Request, res: Response): Promise<void> {
    try {
      const { uid } = req.params;
      const redis = req.app.locals.redis as Redis.Redis;
      const cacheKey = `tag:${uid}`;

      // Check cache first
      const cached = await redis.get(cacheKey);
      if (cached) {
        res.status(200).json(JSON.parse(cached));
        return;
      }

      // Get scan count for the tag
      const scanCount = await ScanModel.getCountByTagUid(uid);

      // Fetch the first scan event to get blend ID
      const { items } = await ScanModel.findByTagUid(uid, 1);

      if (items.length === 0) {
        res.status(404).json({
          error: 'Not Found',
          message: 'Tag not found',
        });
        return;
      }

      const blendId = items[0].blendId;
      const lastScan = items[0];

      const tag = {
        uid,
        blendId,
        programmedAt: new Date().toISOString(),
        scanCount,
        lastScannedAt: lastScan.timestamp,
      };

      // Cache the result
      await redis.setex(cacheKey, 1800, JSON.stringify(tag));

      res.status(200).json(tag);
    } catch (error) {
      console.error('Error fetching tag:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to fetch tag',
      });
    }
  }

  static async programTag(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthenticatedRequest;

      if (!authReq.isAuthenticated) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Valid API key required',
        });
        return;
      }

      const { uid, blendId } = req.body;

      if (!uid || !blendId) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Missing required fields: uid, blendId',
        });
        return;
      }

      // Verify blend exists
      const blend = await BlendModel.findById(blendId);
      if (!blend) {
        res.status(404).json({
          error: 'Not Found',
          message: 'Blend not found',
        });
        return;
      }

      const tag = {
        uid,
        blendId,
        programmedAt: new Date().toISOString(),
        scanCount: 0,
        lastScannedAt: null,
      };

      // In a real implementation, this would also program the physical NFC tag
      // via a hardware service or write to a tag metadata store

      res.status(201).json(tag);
    } catch (error) {
      console.error('Error programming tag:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to program tag',
      });
    }
  }
}
