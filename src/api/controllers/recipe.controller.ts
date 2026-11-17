import { Request, Response } from 'express';
import Redis from 'ioredis';
import { RecipeModel } from '../models/recipe.model';

export class RecipeController {
  static async getRecipes(req: Request, res: Response): Promise<void> {
    try {
      const blendId = req.query.blendId as string;
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.max(1, parseInt(req.query.limit as string) || 10);
      const redis = req.app.locals.redis as Redis.Redis;

      if (!blendId) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Missing required query parameter: blendId',
        });
        return;
      }

      const cacheKey = `recipes:${blendId}:page:${page}:limit:${limit}`;

      // Check cache first
      const cached = await redis.get(cacheKey);
      if (cached) {
        res.status(200).json(JSON.parse(cached));
        return;
      }

      // Fetch from database
      const { items, total } = await RecipeModel.findByBlendId(blendId, page, limit);

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
      console.error('Error fetching recipes:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to fetch recipes',
      });
    }
  }
}
