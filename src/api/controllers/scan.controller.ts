import { Request, Response } from 'express';
import Redis from 'ioredis';
import { ScanModel } from '../models/scan.model';
import { BlendModel } from '../models/blend.model';

export class ScanController {
  static async recordScan(req: Request, res: Response): Promise<void> {
    try {
      const { tagUid, blendId, deviceType, location } = req.body;
      const redis = req.app.locals.redis as Redis.Redis;

      if (!tagUid || !blendId || !deviceType) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Missing required fields: tagUid, blendId, deviceType',
        });
        return;
      }

      const scanEvent = await ScanModel.create({
        tagUid,
        blendId,
        deviceType,
        location,
        timestamp: new Date().toISOString(),
        userAgent: req.headers['user-agent'],
      });

      // Increment scan count on the blend
      await BlendModel.incrementScanCount(blendId);

      // Invalidate relevant caches
      await redis.eval("return redis.call('del', redis.call('keys', 'scan-events:" + tagUid + ":*'))", 0);
      await redis.del(`tag:${tagUid}`);
      await redis.del(`blend:${blendId}`);

      res.status(201).json(scanEvent);
    } catch (error) {
      console.error('Error recording scan:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to record scan event',
      });
    }
  }

  static async getScanEvents(req: Request, res: Response): Promise<void> {
    try {
      const tagUid = req.query.tagUid as string;
      const limit = Math.max(1, parseInt(req.query.limit as string) || 20);
      const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
      const redis = req.app.locals.redis as Redis.Redis;

      if (!tagUid) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Missing required query parameter: tagUid',
        });
        return;
      }

      const cacheKey = `scan-events:${tagUid}:limit:${limit}:offset:${offset}`;

      // Check cache first
      const cached = await redis.get(cacheKey);
      if (cached) {
        res.status(200).json(JSON.parse(cached));
        return;
      }

      // Fetch from database
      const { items, total } = await ScanModel.findByTagUid(tagUid, limit, offset);

      const result = {
        items,
        pagination: {
          page: Math.floor(offset / limit) + 1,
          limit,
          total,
          hasNextPage: offset + limit < total,
        },
      };

      // Cache the result
      await redis.setex(cacheKey, 1800, JSON.stringify(result));

      res.status(200).json(result);
    } catch (error) {
      console.error('Error fetching scan events:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to fetch scan events',
      });
    }
  }
}
