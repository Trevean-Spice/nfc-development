import Redis from 'ioredis';

const DEFAULT_TTL = 3600; // 1 hour in seconds

export interface CacheOptions {
  ttl?: number;
}

export class CacheService {
  constructor(private redis: Redis.Redis) {}

  async getCached<T>(key: string): Promise<T | null> {
    try {
      const data = await this.redis.get(key);
      if (!data) return null;

      return JSON.parse(data) as T;
    } catch (error) {
      console.error(`Error retrieving cache for key ${key}:`, error);
      return null;
    }
  }

  async setCache<T>(key: string, data: T, ttl: number = DEFAULT_TTL): Promise<void> {
    try {
      const serialized = JSON.stringify(data);
      await this.redis.setex(key, ttl, serialized);
    } catch (error) {
      console.error(`Error setting cache for key ${key}:`, error);
    }
  }

  async invalidateCache(pattern: string): Promise<void> {
    try {
      const keys = await this.redis.keys(pattern);

      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      console.error(`Error invalidating cache with pattern ${pattern}:`, error);
    }
  }

  async deleteCacheKey(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      console.error(`Error deleting cache key ${key}:`, error);
    }
  }

  generateKey(...parts: (string | number)[]): string {
    return parts.join(':');
  }
}

export const createCacheMiddleware = (redis: Redis.Redis) => {
  return new CacheService(redis);
};
