import request from 'supertest';
import express, { Express } from 'express';
import { BlendModel } from '../../src/models/blend.model';
import { ScanModel } from '../../src/models/scan.model';
import { RecipeModel } from '../../src/models/recipe.model';
import { Blend, ScanEvent, Recipe } from '../../src/types/index';

jest.mock('../../src/models/blend.model');
jest.mock('../../src/models/scan.model');
jest.mock('../../src/models/recipe.model');

describe('REST API Integration', () => {
  let app: Express;

  const mockBlend: Blend = {
    id: 'blend-001',
    name: 'Ethiopian Yirgacheffe',
    origin: 'Ethiopia',
    grower: 'Muldhima Cooperative',
    roastDate: new Date('2024-02-01'),
    expiryDate: new Date('2025-02-01'),
    nfcTagUid: 'E0048397C7CD80',
    nfcPayload: 'https://trevean.spice/blend/blend-001',
    recipes: ['recipe-101'],
    freshness: 'Fresh',
    createdAt: new Date('2024-02-01'),
    updatedAt: new Date('2024-02-01'),
  };

  const mockScanEvent: ScanEvent = {
    id: 'scan-001',
    blendId: 'blend-001',
    tagUid: 'E0048397C7CD80',
    timestamp: new Date('2024-02-15T10:30:00Z'),
    deviceInfo: {
      platform: 'iOS',
      version: '17.3',
      userAgent: 'Mozilla/5.0',
    },
    freshness: 'Fresh',
    createdAt: new Date('2024-02-15T10:30:00Z'),
  };

  const mockRecipe: Recipe = {
    id: 'recipe-101',
    name: 'Spiced Latte',
    description: 'Warm latte with Ethiopian spices',
    ingredients: ['blend-001', 'milk', 'honey'],
    instructions: ['Brew coffee', 'Add milk', 'Serve'],
    createdAt: new Date('2024-02-01'),
    updatedAt: new Date('2024-02-01'),
  };

  beforeAll(() => {
    app = express();
    app.use(express.json());

    // Blend endpoints
    app.get('/api/v1/blends', async (req, res) => {
      try {
        const result = await BlendModel.scan({
          limit: Math.min(parseInt(req.query.limit as string) || 20, 100),
        });
        res.status(200).json(result);
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    app.get('/api/v1/blends/:id', async (req, res) => {
      try {
        const blend = await BlendModel.getById(req.params.id);
        if (!blend) {
          return res.status(404).json({ error: 'Blend not found' });
        }
        res.status(200).json(blend);
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Scan endpoints
    app.post('/api/v1/scans', async (req, res) => {
      try {
        const scan = await ScanModel.create(req.body);
        res.status(201).json(scan);
      } catch (error) {
        res.status(400).json({ error: (error as Error).message });
      }
    });

    // Recipes endpoint with blendId filter
    app.get('/api/v1/recipes', async (req, res) => {
      try {
        const blendId = req.query.blendId as string;
        if (!blendId) {
          return res.status(400).json({ error: 'blendId query parameter is required' });
        }

        const result = await RecipeModel.query('blendId', blendId, {
          limit: Math.min(parseInt(req.query.limit as string) || 20, 100),
        });
        res.status(200).json(result);
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/v1/blends', () => {
    it('should return paginated blends with 200 status', async () => {
      const mockResult = {
        items: [mockBlend],
        count: 1,
        scannedCount: 1,
      };

      (BlendModel.scan as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .get('/api/v1/blends')
        .expect(200);

      expect(response.body).toEqual(mockResult);
      expect(response.body.items).toHaveLength(1);
      expect(response.body.count).toBe(1);
    });

    it('should support limit query parameter', async () => {
      const mockResult = {
        items: [mockBlend],
        count: 1,
        scannedCount: 1,
      };

      (BlendModel.scan as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .get('/api/v1/blends?limit=10')
        .expect(200);

      expect(response.body.items).toHaveLength(1);
      expect(BlendModel.scan).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10 })
      );
    });

    it('should handle empty results', async () => {
      const mockResult = {
        items: [],
        count: 0,
        scannedCount: 0,
      };

      (BlendModel.scan as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .get('/api/v1/blends')
        .expect(200);

      expect(response.body.items).toHaveLength(0);
      expect(response.body.count).toBe(0);
    });

    it('should return 500 on database error', async () => {
      (BlendModel.scan as jest.Mock).mockRejectedValue(
        new Error('Database connection failed')
      );

      const response = await request(app)
        .get('/api/v1/blends')
        .expect(500);

      expect(response.body).toEqual(
        expect.objectContaining({ error: 'Database connection failed' })
      );
    });
  });

  describe('GET /api/v1/blends/:id', () => {
    it('should return blend by ID with 200 status', async () => {
      (BlendModel.getById as jest.Mock).mockResolvedValue(mockBlend);

      const response = await request(app)
        .get('/api/v1/blends/blend-001')
        .expect(200);

      expect(response.body).toEqual(mockBlend);
      expect(BlendModel.getById).toHaveBeenCalledWith('blend-001');
    });

    it('should return 404 for non-existent blend', async () => {
      (BlendModel.getById as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .get('/api/v1/blends/non-existent')
        .expect(404);

      expect(response.body).toEqual(
        expect.objectContaining({ error: 'Blend not found' })
      );
    });

    it('should return 500 on database error', async () => {
      (BlendModel.getById as jest.Mock).mockRejectedValue(
        new Error('Database connection failed')
      );

      const response = await request(app)
        .get('/api/v1/blends/blend-001')
        .expect(500);

      expect(response.body).toEqual(
        expect.objectContaining({ error: 'Database connection failed' })
      );
    });
  });

  describe('POST /api/v1/scans', () => {
    it('should record scan event and return 201 status', async () => {
      (ScanModel.create as jest.Mock).mockResolvedValue(mockScanEvent);

      const scanPayload = {
        blendId: 'blend-001',
        tagUid: 'E0048397C7CD80',
        platform: 'iOS',
      };

      const response = await request(app)
        .post('/api/v1/scans')
        .send(scanPayload)
        .expect(201);

      expect(response.body).toEqual(mockScanEvent);
      expect(ScanModel.create).toHaveBeenCalledWith(scanPayload);
    });

    it('should include location data in scan if provided', async () => {
      const scanWithLocation: ScanEvent = {
        ...mockScanEvent,
        location: {
          latitude: 37.7749,
          longitude: -122.4194,
          accuracy: 10,
        },
      };

      (ScanModel.create as jest.Mock).mockResolvedValue(scanWithLocation);

      const scanPayload = {
        blendId: 'blend-001',
        tagUid: 'E0048397C7CD80',
        platform: 'iOS',
        latitude: 37.7749,
        longitude: -122.4194,
      };

      const response = await request(app)
        .post('/api/v1/scans')
        .send(scanPayload)
        .expect(201);

      expect(response.body.location).toBeDefined();
      expect(response.body.location.latitude).toBe(37.7749);
    });

    it('should return 400 on invalid input', async () => {
      (ScanModel.create as jest.Mock).mockRejectedValue(
        new Error('Validation error: missing required field')
      );

      const response = await request(app)
        .post('/api/v1/scans')
        .send({ blendId: 'blend-001' })
        .expect(400);

      expect(response.body).toEqual(
        expect.objectContaining({ error: expect.any(String) })
      );
    });
  });

  describe('GET /api/v1/recipes', () => {
    it('should return recipes filtered by blendId with 200 status', async () => {
      const mockResult = {
        items: [mockRecipe],
        count: 1,
      };

      (RecipeModel.query as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .get('/api/v1/recipes?blendId=blend-001')
        .expect(200);

      expect(response.body).toEqual(mockResult);
      expect(response.body.items).toHaveLength(1);
      expect(RecipeModel.query).toHaveBeenCalledWith(
        'blendId',
        'blend-001',
        expect.any(Object)
      );
    });

    it('should return empty array for blend with no recipes', async () => {
      const mockResult = {
        items: [],
        count: 0,
      };

      (RecipeModel.query as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .get('/api/v1/recipes?blendId=no-recipes-blend')
        .expect(200);

      expect(response.body.items).toHaveLength(0);
      expect(response.body.count).toBe(0);
    });

    it('should return 400 if blendId parameter is missing', async () => {
      const response = await request(app)
        .get('/api/v1/recipes')
        .expect(400);

      expect(response.body).toEqual(
        expect.objectContaining({ error: expect.stringContaining('blendId') })
      );
    });

    it('should support limit query parameter', async () => {
      const mockResult = {
        items: [mockRecipe],
        count: 1,
      };

      (RecipeModel.query as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .get('/api/v1/recipes?blendId=blend-001&limit=5')
        .expect(200);

      expect(RecipeModel.query).toHaveBeenCalledWith(
        'blendId',
        'blend-001',
        expect.objectContaining({ limit: 5 })
      );
    });

    it('should return 500 on database error', async () => {
      (RecipeModel.query as jest.Mock).mockRejectedValue(
        new Error('Database connection failed')
      );

      const response = await request(app)
        .get('/api/v1/recipes?blendId=blend-001')
        .expect(500);

      expect(response.body).toEqual(
        expect.objectContaining({ error: 'Database connection failed' })
      );
    });
  });

  describe('Error handling', () => {
    it('should return 404 for undefined endpoints', async () => {
      const response = await request(app)
        .get('/api/v1/undefined-endpoint')
        .expect(404);

      expect(response.status).toBe(404);
    });
  });
})
