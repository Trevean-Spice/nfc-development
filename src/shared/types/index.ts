/**
 * Core TypeScript interfaces for NFC Smart Packaging System
 * Trevean Spice - MVP Blend Tracking
 */

export interface SpiceBlend {
  id: string;
  name: string;
  origin: string;
  gpsCoordinates: {
    latitude: number;
    longitude: number;
  };
  keyIngredients: string[];
  harvestDate: Date;
  growerProfile: Grower;
  storyMarkdown: string;
  freshnessWindowDays: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface NFCTag {
  uid: string;
  blendId: string;
  chipType: string;
  memoryBytes: number;
  programmedAt: Date;
  scanCount: number;
  lastScannedAt: Date | null;
}

export interface ScanEvent {
  id: string;
  tagUid: string;
  timestamp: Date;
  latitude: number | null;
  longitude: number | null;
  deviceType: DeviceType;
  osVersion: string;
}

export interface Recipe {
  id: string;
  blendId: string;
  title: string;
  description: string;
  ingredients: string[];
  instructions: string[];
  prepTimeMinutes: number;
  servings: number;
  imageUrl: string;
}

export interface Grower {
  id: string;
  name: string;
  region: string;
  bio: string;
  photoUrl: string;
  farmCoordinates: {
    latitude: number;
    longitude: number;
  };
}

export enum FreshnessStatus {
  FRESH = 'FRESH',
  GOOD = 'GOOD',
  AGING = 'AGING',
  EXPIRED = 'EXPIRED',
}

export enum DeviceType {
  IOS = 'IOS',
  ANDROID = 'ANDROID',
  WEB_NFC = 'WEB_NFC',
  QR_FALLBACK = 'QR_FALLBACK',
}
