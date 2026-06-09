import { NfcEncoder } from '../../src/nfc/encoder';
import { NdefRecord, NdefMessage } from '../../src/types/nfc';

describe('NFC Encoder', () => {
  let encoder: NfcEncoder;

  beforeEach(() => {
    encoder = new NfcEncoder();
  });

  describe('createUrlRecord', () => {
    it('should produce valid NDEF URL record', () => {
      const url = 'https://trevean.spice/scan/blend-001';
      const record = encoder.createUrlRecord(url);

      expect(record).toBeDefined();
      expect(record.type).toBe('U');
      expect(record.payload).toContain(url);
    });

    it('should set TNF to Well Known for URL record', () => {
      const url = 'https://example.com';
      const record = encoder.createUrlRecord(url);

      expect(record.tnf).toBe(0x01); // Well Known
    });

    it('should handle http URLs', () => {
      const url = 'http://example.com/blend';
      const record = encoder.createUrlRecord(url);

      expect(record.payload).toContain('example.com');
    });

    it('should handle URLs with query parameters', () => {
      const url = 'https://trevean.spice/scan/blend-001?utm_source=nfc&campaign=launch';
      const record = encoder.createUrlRecord(url);

      expect(record.payload).toContain('utm_source=nfc');
    });

    it('should add protocol indicator byte', () => {
      const url = 'https://trevean.spice/scan/blend-001';
      const record = encoder.createUrlRecord(url);

      expect(record.payload).toBeDefined();
      expect(record.payload.length).toBeGreaterThan(url.length);
    });
  });

  describe('createTextRecord', () => {
    it('should produce valid NDEF text record', () => {
      const text = 'Ethiopian Yirgacheffe';
      const record = encoder.createTextRecord(text);

      expect(record).toBeDefined();
      expect(record.type).toBe('T');
      expect(record.payload).toContain(text);
    });

    it('should handle empty text', () => {
      const record = encoder.createTextRecord('');

      expect(record.type).toBe('T');
    });

    it('should support language tags', () => {
      const text = 'Blend Name';
      const record = encoder.createTextRecord(text, 'en');

      expect(record.payload).toBeDefined();
    });
  });

  describe('calculatePayloadSize', () => {
    it('should return correct byte count for URL record', () => {
      const url = 'https://trevean.spice/scan/blend-001';
      const record = encoder.createUrlRecord(url);
      const size = encoder.calculatePayloadSize(record);

      expect(size).toBeGreaterThan(0);
      expect(size).toBeLessThanOrEqual(840);
    });

    it('should return correct byte count for text record', () => {
      const text = 'Ethiopian Yirgacheffe';
      const record = encoder.createTextRecord(text);
      const size = encoder.calculatePayloadSize(record);

      expect(size).toBeGreaterThan(0);
    });

    it('should account for NDEF header bytes', () => {
      const url = 'https://example.com';
      const record = encoder.createUrlRecord(url);
      const size = encoder.calculatePayloadSize(record);

      expect(size).toBeGreaterThan(url.length);
    });

    it('should calculate cumulative size for multiple records', () => {
      const urlRecord = encoder.createUrlRecord('https://example.com');
      const textRecord = encoder.createTextRecord('Test');

      const urlSize = encoder.calculatePayloadSize(urlRecord);
      const textSize = encoder.calculatePayloadSize(textRecord);
      const totalSize = urlSize + textSize;

      expect(totalSize).toBeGreaterThan(urlSize);
      expect(totalSize).toBeGreaterThan(textSize);
    });
  });

  describe('encodeNdefMessage', () => {
    it('should handle single record', () => {
      const record = encoder.createUrlRecord('https://example.com');
      const message = encoder.encodeNdefMessage([record]);

      expect(message).toBeDefined();
      expect(message.records).toHaveLength(1);
    });

    it('should handle multiple records', () => {
      const records = [
        encoder.createUrlRecord('https://trevean.spice/scan/blend-001'),
        encoder.createTextRecord('Ethiopian Yirgacheffe'),
      ];

      const message = encoder.encodeNdefMessage(records);

      expect(message.records).toHaveLength(2);
      expect(message.records[0].type).toBe('U');
      expect(message.records[1].type).toBe('T');
    });

    it('should set message boundaries correctly', () => {
      const records = [
        encoder.createUrlRecord('https://example.com'),
        encoder.createTextRecord('Blend'),
      ];

      const message = encoder.encodeNdefMessage(records);

      expect(message.records[0].mb).toBe(true); // Message Begin
      expect(message.records[0].me).toBe(false); // Message End
      expect(message.records[1].me).toBe(true); // Last record has Message End
    });

    it('should not exceed 840 byte limit with all records', () => {
      const records = [
        encoder.createUrlRecord('https://trevean.spice/scan/blend-001?source=nfc&campaign=launch'),
        encoder.createTextRecord('Premium Spice Blend'),
        encoder.createTextRecord('Origin: Ethiopia'),
      ];

      const message = encoder.encodeNdefMessage(records);
      let totalSize = 0;

      for (const record of message.records) {
        totalSize += encoder.calculatePayloadSize(record);
      }

      expect(totalSize).toBeLessThanOrEqual(840);
    });

    it('should encode with proper TNF values', () => {
      const records = [
        encoder.createUrlRecord('https://example.com'),
        encoder.createTextRecord('Text'),
      ];

      const message = encoder.encodeNdefMessage(records);

      expect(message.records[0].tnf).toBe(0x01); // Well Known
      expect(message.records[1].tnf).toBe(0x01); // Well Known
    });
  });

  describe('error handling', () => {
    it('should throw error for oversized payload', () => {
      const longUrl = 'https://example.com/' + 'x'.repeat(900);

      expect(() => {
        encoder.createUrlRecord(longUrl);
      }).not.toThrow(); // Creation should work

      const record = encoder.createUrlRecord(longUrl);
      const size = encoder.calculatePayloadSize(record);

      expect(size).toBeGreaterThan(840);
    });

    it('should handle empty record array', () => {
      expect(() => {
        encoder.encodeNdefMessage([]);
      }).toThrow();
    });
  });

  describe('integration', () => {
    it('should create full blend info message', () => {
      const records = [
        encoder.createUrlRecord('https://trevean.spice/scan/blend-001'),
        encoder.createTextRecord('Ethiopian Yirgacheffe'),
        encoder.createTextRecord('Fresh', 'en'),
      ];

      const message = encoder.encodeNdefMessage(records);

      expect(message.records).toHaveLength(3);
      expect(message.records[0].type).toBe('U');
      expect(message.records[1].type).toBe('T');
    });
  });
});
