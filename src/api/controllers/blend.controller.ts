import { Request, Response } from 'express';
import Redis from 'ioredis';
import { BlendModel } from '../models/blend.model';
import { RecipeModel } from '../models/recipe.model';
import { AuthenticatedRequest } from '../middleware/auth';

export class BlendController {
  static async getBlend(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const redis = req.app.locals.redis as Redis.Redis;
      const cacheKey = `blend:${id}`;

      // Check cache first
      const cached = await redis.get(cacheKey);
      if (cached) {
        res.status(200).json(JSON.parse(cached));
        return;
      }

      // Fetch from database
      const blend = await BlendModel.findById(id);

      if (!blend) {
        res.status(404).json({
          error: 'Not Found',
          message: 'Blend not found',
        });
        return;
      }

      // Cache the result
      await redis.setex(cacheKey, 3600, JSON.stringify(blend));

      res.status(200).json(blend);
    } catch (error) {
      console.error('Error fetching blend:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to fetch blend',
      });
    }
  }

  static async getAllBlends(req: Request, res: Response): Promise<void> {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.max(1, parseInt(req.query.limit as string) || 20);
      const redis = req.app.locals.redis as Redis.Redis;
      const cacheKey = `blends:page:${page}:limit:${limit}`;

      // Check cache first
      const cached = await redis.get(cacheKey);
      if (cached) {
        res.status(200).json(JSON.parse(cached));
        return;
      }

      // Fetch from database
      const { items, total } = await BlendModel.findAll(page, limit);

      const result = {
        items,
        pagination: {
          page,
          limit,
          total,
          hasNextPage: page * limit < total,
        },
      };

      // Cache the result
      await redis.setex(cacheKey, 3600, JSON.stringify(result));

      res.status(200).json(result);
    } catch (error) {
      console.error('Error fetching blends:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to fetch blends',
      });
    }
  }

  static async updateBlend(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthenticatedRequest;

      if (!authReq.isAuthenticated) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Valid API key required',
        });
        return;
      }

      const { id } = req.params;
      const redis = req.app.locals.redis as Redis.Redis;

      const updated = await BlendModel.update(id, req.body);

      // Invalidate cache
      await redis.del(`blend:${id}`);
      await redis.eval("return redis.call('del', redis.call('keys', 'blends:*'))", 0);

      res.status(200).json(updated);
    } catch (error) {
      console.error('Error updating blend:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to update blend',
      });
    }
  }
}
