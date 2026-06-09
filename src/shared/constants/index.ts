/**
 * Constants for NFC Smart Packaging System
 * MVP blend data, NFC specifications, API defaults, freshness thresholds
 */

import type { SpiceBlend } from '../types/index';

/**
 * MVP Spice Blends
 */
export const MVP_BLENDS: Omit<SpiceBlend, 'createdAt' | 'updatedAt' | 'growerProfile'>[] = [
  {
    id: 'persian-sunrise',
    name: 'Persian Sunrise',
    origin: 'Isfahan, Iran',
    gpsCoordinates: {
      latitude: 32.6546,
      longitude: 51.6680,
    },
    keyIngredients: ['saffron', 'cardamom', 'rose petals', 'lime'],
    harvestDate: new Date('2025-09-15'),
    storyMarkdown: '# Persian Sunrise\nA golden blend from the ancient silk roads...',
    freshnessWindowDays: 365,
  },
  {
    id: 'north-african-night-market',
    name: 'North African Night Market',
    origin: 'Fez, Morocco',
    gpsCoordinates: {
      latitude: 34.0334,
      longitude: -5.0027,
    },
    keyIngredients: ['Aleppo pepper', 'cumin', 'preserved lemon'],
    harvestDate: new Date('2025-10-01'),
    storyMarkdown: '# North African Night Market\nAromas from the bustling medinas of Fez...',
    freshnessWindowDays: 180,
  },
  {
    id: 'caribbean-sunset',
    name: 'Caribbean Sunset',
    origin: 'Trinidad & Tobago',
    gpsCoordinates: {
      latitude: 10.6918,
      longitude: -61.2225,
    },
    keyIngredients: ['Scotch bonnet', 'allspice', 'thyme'],
    harvestDate: new Date('2025-08-20'),
    storyMarkdown: '# Caribbean Sunset\nWarm spices from the islands...',
    freshnessWindowDays: 200,
  },
  {
    id: 'the-silk-road',
    name: 'The Silk Road',
    origin: 'Central Asia (multi-origin)',
    gpsCoordinates: {
      latitude: 41.3775,
      longitude: 64.5853,
    },
    keyIngredients: ['cumin', 'coriander', 'fenugreek', 'turmeric'],
    harvestDate: new Date('2025-09-10'),
    storyMarkdown: '# The Silk Road\nSpices that traveled ancient trade routes...',
    freshnessWindowDays: 365,
  },
  {
    id: 'kyoto-garden',
    name: 'Kyoto Garden',
    origin: 'Kyoto, Japan',
    gpsCoordinates: {
      latitude: 35.0116,
      longitude: 135.7681,
    },
    keyIngredients: ['sesame', 'nori', 'yuzu', 'green tea'],
    harvestDate: new Date('2025-07-05'),
    storyMarkdown: '# Kyoto Garden\nDelicate flavors from Japanese gardens...',
    freshnessWindowDays: 120,
  },
];

/**
 * NFC Tag Specifications
 */
export const NFC = {
  NTAG216_MEMORY_BYTES: 888,
  NDEF_HEADER_BYTES: 48,
  MAX_URL_LENGTH: 840,
  NFC_CHIP_TYPE: 'NTAG216',
} as const;

/**
 * API Configuration
 */
export const API = {
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  CACHE_TTL_SECONDS: 300,
} as const;

/**
 * Freshness Thresholds (days from harvest)
 */
export const FRESHNESS = {
  FRESH_DAYS: 90,
  GOOD_DAYS: 180,
  AGING_DAYS: 365,
} as const;
