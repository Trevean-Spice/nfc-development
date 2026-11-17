/**
 * Utility functions for NFC Smart Packaging System
 * Freshness calculations, formatting, validation, and helpers
 */

import { FreshnessStatus } from '../types/index';
import { FRESHNESS, NFC } from '../constants/index';

/**
 * Calculate freshness status based on harvest date and window
 * @param harvestDate - The date the spice was harvested
 * @param windowDays - The freshness window in days
 * @returns FreshnessStatus enum value
 */
export function calculateFreshnessStatus(
  harvestDate: Date,
  windowDays: number
): FreshnessStatus {
  const days = daysSince(harvestDate);

  // Calculate proportional thresholds based on the freshness window
  const freshThreshold = windowDays * 0.25;
  const goodThreshold = windowDays * 0.5;
  const agingThreshold = windowDays * 1.0;

  if (days <= freshThreshold) {
    return FreshnessStatus.FRESH;
  }

  if (days <= goodThreshold) {
    return FreshnessStatus.GOOD;
  }

  if (days <= agingThreshold) {
    return FreshnessStatus.AGING;
  }

  return FreshnessStatus.EXPIRED;
}

/**
 * Format GPS coordinates into a readable string
 * @param lat - Latitude
 * @param lng - Longitude
 * @returns Formatted coordinate string
 */
export function formatGpsCoordinates(lat: number, lng: number): string {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lngDir = lng >= 0 ? 'E' : 'W';
  const latAbs = Math.abs(lat).toFixed(4);
  const lngAbs = Math.abs(lng).toFixed(4);
  return `${latAbs}° ${latDir}, ${lngAbs}° ${lngDir}`;
}

/**
 * Generate NFC tag URL for a spice blend
 * @param blendId - The blend identifier
 * @returns Generated URL string
 */
export function generateTagUrl(blendId: string): string {
  return `https://trevean.spice/blend/${slugify(blendId)}`;
}

/**
 * Validate that NFC payload fits within NTAG 216 memory constraints
 * @param url - The URL to encode into NFC tag
 * @returns Boolean indicating if URL fits within memory limits
 */
export function validateNfcPayloadSize(url: string): boolean {
  // NDEF message structure: header bytes + URL encoded as UTF-8
  const encodedLength = new TextEncoder().encode(url).length;
  const totalLength = NFC.NDEF_HEADER_BYTES + encodedLength;
  return totalLength <= NFC.NTAG216_MEMORY_BYTES;
}

/**
 * Convert text to URL-friendly slug
 * @param text - Text to slugify
 * @returns Slugified text
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace whitespace with hyphens
    .replace(/-+/g, '-'); // Collapse multiple hyphens
}

/**
 * Calculate days elapsed since a given date
 * @param date - The date to calculate from
 * @returns Number of days elapsed
 */
export function daysSince(date: Date): number {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}
