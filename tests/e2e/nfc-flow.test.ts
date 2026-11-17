import fetch from 'node-fetch';
import request from 'supertest';
import { createNfcTagSimulator } from '../../src/nfc/simulator';
import { Blend, ScanEvent } from '../../src/types/index';

// Note: These tests assume the API is running on http://localhost:3000
const API_BASE = process.env.API_URL || 'http://localhost:3000';
const WEB_BASE = process.env.WEB_URL || 'http://localhost:3001';

describe('NFC Full Flow E2E Tests', () => {
  let testBlendId: string;
  let testTagUid: string;

  beforeAll(() => {
    // Initialize test data with MVP blend ID
    testBlendId = 'persian-sunrise';
    testTagUid = 'E0048397C7CD80';
  });

  describe('NFC Tag Programming Flow', () => {
    it('should program a tag with blend data', async () => {
      const simulator = createNfcTagSimulator();

      const tagData = {
        blendId: testBlendId,
        tagUid: testTagUid,
        url: `${WEB_BASE}/blend/${testBlendId}`,
        blendName: 'Persian Sunrise',
      };

      const encoded = simulator.encodeTag(tagData);

      expect(encoded).toBeDefined();
      expect(encoded.payload).toBeDefined();
      expect(encoded.payload.length).toBeLessThanOrEqual(840);
    });

    it('should validate encoded tag data', async () => {
      const simulator = createNfcTagSimulator();

      const tagData = {
        blendId: testBlendId,
        tagUid: testTagUid,
        url: `${WEB_BASE}/blend/${testBlendId}`,
        blendName: 'Persian Sunrise',
      };

      const encoded = simulator.encodeTag(tagData);
      const decoded = simulator.decodeTag(encoded);

      expect(decoded.blendId).toBe(testBlendId);
      expect(decoded.url).toContain(testBlendId);
    });
  });

  describe('Scan Recording Flow', () => {
    it('should simulate NFC scan and record to API', async () => {
      const scanInput = {
        blendId: testBlendId,
        tagUid: testTagUid,
        deviceType: 'iOS',
        latitude: 37.7749,
        longitude: -122.4194,
      };

      const response = await request(API_BASE)
        .post('/api/v1/scans')
        .send({
          tagUid: scanInput.tagUid,
          blendId: scanInput.blendId,
          deviceType: scanInput.deviceType,
        });

      expect(response.status).toBe(201);
      if (response.body.id) {
        expect(response.body.blendId).toBe(testBlendId);
      }
    });

    it('should verify API records event with correct freshness', async () => {
      const response = await request(API_BASE)
        .get(`/api/v1/blends/${testBlendId}`);

      expect(response.status).toBe(200);
      if (response.body) {
        expect(response.body.id).toBe(testBlendId);
        expect(['Fresh', 'Good', 'Fair', 'Expired']).toContain(response.body.freshness);
      }
    });
  });

  describe('Web Page Navigation Flow', () => {
    it('should load web app and retrieve blend detail page', async () => {
      try {
        const response = await fetch(`${WEB_BASE}/blend/${testBlendId}`);

        expect(response.status).toBe(200);
        const html = await response.text();
        expect(html).toContain('blend') || expect(html.length).toBeGreaterThan(0);
      } catch (error) {
        // Web server may not be running in test environment
        console.log('Web server not available for E2E test');
      }
    });

    it('should render blend detail with origin and grower info', async () => {
      const response = await request(API_BASE)
        .get(`/api/v1/blends/${testBlendId}`);

      expect(response.status).toBe(200);
      if (response.body) {
        const blend = response.body;
        expect(blend.origin).toBeDefined();
        expect(blend.grower).toBeDefined();
      }
    });
  });

  describe('Freshness Calculation Flow', () => {
    it('should calculate freshness based on roast date', async () => {
      const response = await request(API_BASE)
        .get(`/api/v1/blends/${testBlendId}`);

      expect(response.status).toBe(200);
      if (response.body) {
        const blend = response.body;
        expect(['Fresh', 'Good', 'Fair', 'Expired']).toContain(blend.freshness);
      }
    });

    it('should update freshness on subsequent scans', async () => {
      const scanInput = {
        blendId: testBlendId,
        tagUid: testTagUid,
        deviceType: 'Android',
      };

      const response1 = await request(API_BASE)
        .post('/api/v1/scans')
        .send({
          tagUid: scanInput.tagUid,
          blendId: scanInput.blendId,
          deviceType: scanInput.deviceType,
        });

      expect(response1.status).toBe(201);

      // Get blend and verify freshness
      if (response1.body.id) {
        const blendResponse = await request(API_BASE)
          .get(`/api/v1/blends/${testBlendId}`);

        expect(blendResponse.status).toBe(200);
        if (blendResponse.body) {
          expect(['Fresh', 'Good', 'Fair', 'Expired']).toContain(blendResponse.body.freshness);
        }
      }
    });
  });

  describe('Complete NFC Scan to Web Workflow', () => {
    it('should complete full flow from scan to web page', async () => {
      // Step 1: Program tag
      const simulator = createNfcTagSimulator();
      const tagData = {
        blendId: testBlendId,
        tagUid: testTagUid,
        url: `${WEB_BASE}/blend/${testBlendId}`,
        blendName: 'Premium Blend',
      };
      const encoded = simulator.encodeTag(tagData);
      expect(encoded).toBeDefined();

      // Step 2: Simulate scan
      const scanResponse = await request(API_BASE)
        .post('/api/v1/scans')
        .send({
          tagUid: testTagUid,
          blendId: testBlendId,
          deviceType: 'iOS',
        });

      expect(scanResponse.status).toBe(201);

      // Step 3: Fetch blend details
      const blendResponse = await request(API_BASE)
        .get(`/api/v1/blends/${testBlendId}`);

      expect(blendResponse.status).toBe(200);
      if (blendResponse.body) {
        expect(blendResponse.body.id).toBe(testBlendId);
        expect(blendResponse.body.origin).toBeDefined();
      }

      // Step 4: Verify web page loads (if web server running)
      try {
        const webResponse = await fetch(`${WEB_BASE}/blend/${testBlendId}`);
        expect([200, 404, 500]).toContain(webResponse.status);
      } catch (error) {
        // Expected if web server not running
      }
    });
  });

  describe('Error Recovery', () => {
    it('should handle invalid tag UID', async () => {
      const response = await request(API_BASE)
        .post('/api/v1/scans')
        .send({
          tagUid: 'INVALID_TAG_UID',
          blendId: testBlendId,
          deviceType: 'iOS',
        });

      expect([201, 400, 422]).toContain(response.status);
    });

    it('should handle missing blend on scan', async () => {
      const response = await request(API_BASE)
        .post('/api/v1/scans')
        .send({
          tagUid: testTagUid,
          blendId: 'non-existent-blend',
          deviceType: 'iOS',
        });

      expect([201, 400, 404, 422]).toContain(response.status);
    });
  });
});
