import {
  calculateFreshnessStatus,
  formatGpsCoordinates,
  generateTagUrl,
  validateNfcPayloadSize,
  slugify,
  daysSince,
} from '../../src/utils/index';

describe('Utility Functions', () => {
  describe('calculateFreshnessStatus', () => {
    const today = new Date('2024-02-25T00:00:00Z');

    it('should return Fresh status when less than 30 days have passed', () => {
      const roastDate = new Date('2024-02-10T00:00:00Z');
      const status = calculateFreshnessStatus(roastDate, today);

      expect(status).toBe('Fresh');
    });

    it('should return Good status when 30-90 days have passed', () => {
      const roastDate = new Date('2023-12-20T00:00:00Z');
      const status = calculateFreshnessStatus(roastDate, today);

      expect(status).toBe('Good');
    });

    it('should return Fair status when 90-180 days have passed', () => {
      const roastDate = new Date('2023-09-15T00:00:00Z');
      const status = calculateFreshnessStatus(roastDate, today);

      expect(status).toBe('Fair');
    });

    it('should return Expired status when more than 180 days have passed', () => {
      const roastDate = new Date('2023-08-01T00:00:00Z');
      const status = calculateFreshnessStatus(roastDate, today);

      expect(status).toBe('Expired');
    });

    it('should return Fresh on exact roast date', () => {
      const roastDate = new Date('2024-02-25T00:00:00Z');
      const status = calculateFreshnessStatus(roastDate, today);

      expect(status).toBe('Fresh');
    });
  });

  describe('formatGpsCoordinates', () => {
    it('should format coordinates to 4 decimal places', () => {
      const formatted = formatGpsCoordinates(37.77493, -122.41942);

      expect(formatted).toBe('37.7749, -122.4194');
    });

    it('should handle negative coordinates', () => {
      const formatted = formatGpsCoordinates(-33.8688, -151.2093);

      expect(formatted).toBe('-33.8688, -151.2093');
    });

    it('should handle zero coordinates', () => {
      const formatted = formatGpsCoordinates(0, 0);

      expect(formatted).toBe('0.0000, 0.0000');
    });

    it('should pad decimals with zeros', () => {
      const formatted = formatGpsCoordinates(37.7, -122.4);

      expect(formatted).toBe('37.7000, -122.4000');
    });
  });

  describe('generateTagUrl', () => {
    it('should generate valid URL with base domain and blend ID', () => {
      const url = generateTagUrl('blend-001');

      expect(url).toBe('https://trevean.spice/scan/blend-001');
    });

    it('should include UTM parameters if provided', () => {
      const url = generateTagUrl('blend-002', { source: 'nfc-tag', campaign: 'launch' });

      expect(url).toContain('blend-002');
      expect(url).toContain('source=nfc-tag');
      expect(url).toContain('campaign=launch');
    });

    it('should handle special characters in blend ID', () => {
      const url = generateTagUrl('blend-special-001');

      expect(url).toContain('blend-special-001');
      expect(url).toMatch(/^https:\/\//);
    });
  });

  describe('validateNfcPayloadSize', () => {
    it('should return true for payload under 840 characters', () => {
      const payload = 'https://trevean.spice/scan/blend-001?source=nfc';
      const isValid = validateNfcPayloadSize(payload);

      expect(isValid).toBe(true);
    });

    it('should return true for payload exactly at 840 characters', () => {
      const payload = 'x'.repeat(840);
      const isValid = validateNfcPayloadSize(payload);

      expect(isValid).toBe(true);
    });

    it('should return false for payload over 840 characters', () => {
      const payload = 'x'.repeat(841);
      const isValid = validateNfcPayloadSize(payload);

      expect(isValid).toBe(false);
    });

    it('should return true for empty payload', () => {
      const isValid = validateNfcPayloadSize('');

      expect(isValid).toBe(true);
    });

    it('should handle URL with query parameters', () => {
      const payload =
        'https://trevean.spice/scan/blend-001?source=nfc&campaign=launch&utm_medium=nfc_tag&utm_source=trevean_spice';
      const isValid = validateNfcPayloadSize(payload);

      expect(isValid).toBe(true);
    });
  });

  describe('slugify', () => {
    it('should convert text to lowercase slug format', () => {
      const slug = slugify('Ethiopian Yirgacheffe');

      expect(slug).toBe('ethiopian-yirgacheffe');
    });

    it('should handle multiple spaces', () => {
      const slug = slugify('Indian  Cardamom   Blend');

      expect(slug).toBe('indian-cardamom-blend');
    });

    it('should remove special characters', () => {
      const slug = slugify('Blend & Spice (Premium)');

      expect(slug).toBe('blend-spice-premium');
    });

    it('should handle hyphens correctly', () => {
      const slug = slugify('Premium-Grade Blend');

      expect(slug).toBe('premium-grade-blend');
    });

    it('should handle numbers', () => {
      const slug = slugify('Blend 2024 Edition');

      expect(slug).toBe('blend-2024-edition');
    });

    it('should trim leading and trailing hyphens', () => {
      const slug = slugify('-Ethiopian-');

      expect(slug).toBe('ethiopian');
    });
  });

  describe('daysSince', () => {
    const today = new Date('2024-02-25T12:00:00Z');

    it('should return 0 for today', () => {
      const days = daysSince(today, today);

      expect(days).toBe(0);
    });

    it('should return correct number of days for past date', () => {
      const pastDate = new Date('2024-02-15T12:00:00Z');
      const days = daysSince(pastDate, today);

      expect(days).toBe(10);
    });

    it('should handle 30 day span', () => {
      const pastDate = new Date('2024-01-26T12:00:00Z');
      const days = daysSince(pastDate, today);

      expect(days).toBe(30);
    });

    it('should handle negative values for future dates', () => {
      const futureDate = new Date('2024-03-10T12:00:00Z');
      const days = daysSince(futureDate, today);

      expect(days).toBeLessThan(0);
    });

    it('should round down partial days', () => {
      const partialDay = new Date('2024-02-25T06:00:00Z');
      const days = daysSince(partialDay, today);

      expect(days).toBeLessThanOrEqual(1);
    });
  });

  describe('edge cases', () => {
    it('should handle timezone-aware date calculations', () => {
      const date1 = new Date('2024-02-25T00:00:00+00:00');
      const date2 = new Date('2024-02-15T23:59:59+00:00');
      const days = daysSince(date2, date1);

      expect(days).toBeGreaterThan(0);
    });
  });
});
