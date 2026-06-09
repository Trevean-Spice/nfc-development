import { createClient, RedisClientType } from 'redis';
import config from './default';

/**
 * Redis configuration with retry strategy and connection pooling
 */

export interface RedisConfig {
  url: string;
  retryStrategy: (retries: number) => number | Error;
  maxRetriesPerRequest: number;
  enableReadyCheck: boolean;
  enableOfflineQueue: boolean;
}

/**
 * Retry strategy: exponential backoff with max 10 retries
 */
const retryStrategy = (retries: number): number | Error => {
  const maxRetries = 10;
  const baseDelay = 100; // milliseconds

  if (retries > maxRetries) {
    return new Error('Max retries exceeded');
  }

  return Math.min(retries * baseDelay, 3000); // Max 3 second delay
};

/**
 * Redis configuration object
 */
export const redisConfig: RedisConfig = {
  url: config.redis.url,
  retryStrategy,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  enableOfflineQueue: true,
};

/**
 * Initialize Redis client
 */
async function createRedisClient(): Promise<RedisClientType> {
  const client = createClient({
    url: redisConfig.url,
  }) as RedisClientType;

  client.on('error', (error) => {
    console.error('Redis error:', error);
  });

  client.on('connect', () => {
    console.log('Connected to Redis');
  });

  client.on('ready', () => {
    console.log('Redis client ready');
  });

  client.on('reconnecting', () => {
    console.log('Reconnecting to Redis...');
  });

  try {
    await client.connect();
    return client;
  } catch (error) {
    console.error('Failed to connect to Redis:', error);
    throw error;
  }
}

/**
 * Redis cache wrapper with TTL support
 */
export class RedisCache {
  private client: RedisClientType;

  constructor(client: RedisClientType) {
    this.client = client;
  }

  /**
   * Get value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error(`Failed to get cache key ${key}:`, error);
      return null;
    }
  }

  /**
   * Set value in cache with TTL
   */
  async set<T>(key: string, value: T, ttlSeconds: number = 3600): Promise<void> {
    try {
      await this.client.setEx(key, ttlSeconds, JSON.stringify(value));
    } catch (error) {
      console.error(`Failed to set cache key ${key}:`, error);
    }
  }

  /**
   * Delete cache key
   */
  async delete(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (error) {
      console.error(`Failed to delete cache key ${key}:`, error);
    }
  }

  /**
   * Clear all cache keys matching pattern
   */
  async clearPattern(pattern: string): Promise<number> {
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length === 0) return 0;

      return await this.client.del(keys);
    } catch (error) {
      console.error(`Failed to clear cache pattern ${pattern}:`, error);
      return 0;
    }
  }

  /**
   * Increment numeric counter
   */
  async increment(key: string, amount: number = 1): Promise<number> {
    try {
      return await this.client.incrBy(key, amount);
    } catch (error) {
      console.error(`Failed to increment counter ${key}:`, error);
      return 0;
    }
  }
}

// Lazy initialization
let redisClientInstance: RedisClientType | null = null;

/**
 * Get or create Redis client instance
 */
export async function getRedisClient(): Promise<RedisClientType> {
  if (!redisClientInstance) {
    redisClientInstance = await createRedisClient();
  }
  return redisClientInstance;
}

/**
 * Get or create Redis cache wrapper
 */
export async function getRedisCache(): Promise<RedisCache> {
  const client = await getRedisClient();
  return new RedisCache(client);
}

/**
 * Close Redis connection
 */
export async function closeRedisClient(): Promise<void> {
  if (redisClientInstance) {
    await redisClientInstance.quit();
    redisClientInstance = null;
  }
}
