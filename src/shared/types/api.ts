/**
 * API-related TypeScript types
 * Request context, pagination, and query utilities
 */

import type { SpiceBlend, NFCTag, ScanEvent, Recipe, Grower } from './index';

export interface APIContext {
  dataSources: DataSources;
  redis: RedisClient;
  currentUser: CurrentUser | null;
}

export interface DataSources {
  blendAPI: unknown; // API connector type
  nfcAPI: unknown;
  recipeAPI: unknown;
}

export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttl?: number): Promise<void>;
  del(key: string): Promise<void>;
}

export interface CurrentUser {
  id: string;
  email: string;
  role: 'admin' | 'user' | 'grower';
}

export interface PaginationInput {
  offset: number;
  limit: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export enum SortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}
