import { BlendModel } from '../../src/models/blend.model';
import { ScanModel } from '../../src/models/scan.model';
import { RecipeModel } from '../../src/models/recipe.model';
import { Blend, ScanEvent, Recipe } from '../../src/types/index';

describe('DynamoDB Integration Tests', () => {
  // These tests assume DynamoDB Local is running on localhost:8000
  // Start with: java -Djava.library.path=./DynamoDBLocal_lib -jar DynamoDBLocal.jar -sharedDb

  beforeAll(async () => {
    // Connect to DynamoDB Local
    process.env.AWS_REGION = 'us-east-1';
    process.env.DYNAMODB_ENDPOINT = 'http://localhost:8000';
  });

  describe('BlendModel CRUD Operations', () => {
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

    it('should create a new blend', async () => {
      const result = await BlendModel.create(mockBlend);

      expect(result).toBeDefined();
      expect(result.id).toBe('blend-001');
      expect(result.name).toBe('Ethiopian Yirgacheffe');
    });

    it('should retrieve blend by ID', async () => {
      const result = await BlendModel.getById('blend-001');

      expect(result).toBeDefined();
      expect(result?.id).toBe('blend-001');
      expect(result?.origin).toBe('Ethiopia');
    });

    it('should update blend fields', async () => {
      const updateData = { freshness: 'Good', updatedAt: new Date() };
      const result = await BlendModel.update('blend-001', updateData);

      expect(result).toBeDefined();
      expect(result?.freshness).toBe('Good');
      expect(result?.id).toBe('blend-001');
    });

    it('should delete blend', async () => {
      const result = await BlendModel.delete('blend-001');

      expect(result).toBe(true);

      const retrieved = await BlendModel.getById('blend-001');
      expect(retrieved).toBeNull();
    });

    it('should scan all blends with pagination', async () => {
      const blend1: Blend = {
        ...mockBlend,
        id: 'blend-scan-001',
        name: 'Blend 1',
      };

      const blend2: Blend = {
        ...mockBlend,
        id: 'blend-scan-002',
        name: 'Blend 2',
      };

      await BlendModel.create(blend1);
      await BlendModel.create(blend2);

      const result = await BlendModel.scan({ limit: 10 });

      expect(result.items.length).toBeGreaterThanOrEqual(2);
      expect(result.count).toBeGreaterThanOrEqual(2);
    });
  });

  describe('ScanModel CRUD Operations', () => {
    const mockScan: ScanEvent = {
      id: 'scan-001',
      blendId: 'blend-001',
      tagUid: 'E0048397C7CD80',
      timestamp: new Date('2024-02-15T10:30:00Z'),
      deviceInfo: {
        platform: 'iOS',
        version: '17.3',
        userAgent: 'Mozilla/5.0',
      },
      location: {
        latitude: 37.7749,
        longitude: -122.4194,
        accuracy: 10,
      },
      freshness: 'Fresh',
      createdAt: new Date('2024-02-15T10:30:00Z'),
    };

    it('should create a new scan event', async () => {
      const result = await ScanModel.create(mockScan);

      expect(result).toBeDefined();
      expect(result.id).toBe('scan-001');
      expect(result.blendId).toBe('blend-001');
    });

    it('should retrieve scan by ID', async () => {
      const result = await ScanModel.getById('scan-001');

      expect(result).toBeDefined();
      expect(result?.blendId).toBe('blend-001');
    });

    it('should query scans by blendId', async () => {
      const scan2: ScanEvent = {
        ...mockScan,
        id: 'scan-002',
        timestamp: new Date('2024-02-20T14:15:00Z'),
      };

      await ScanModel.create(scan2);

      const result = await ScanModel.query('blendId', 'blend-001');

      expect(result.items.length).toBeGreaterThanOrEqual(2);
      expect(result.items.every(item => item.blendId === 'blend-001')).toBe(true);
    });

    it('should filter scans by date range', async () => {
      const startDate = new Date('2024-02-01');
      const endDate = new Date('2024-02-28');

      const result = await ScanModel.query('blendId', 'blend-001', {
        filterExpression: 'timestamp BETWEEN :start AND :end',
        expressionAttributeValues: {
          ':start': startDate.toISOString(),
          ':end': endDate.toISOString(),
        },
      });

      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    });

    it('should support pagination through scan results', async () => {
      const result1 = await ScanModel.query('blendId', 'blend-001', { limit: 1 });

      expect(result1.items.length).toBeLessThanOrEqual(1);

      if (result1.lastEvaluatedKey) {
        const result2 = await ScanModel.query('blendId', 'blend-001', {
          limit: 1,
          exclusiveStartKey: result1.lastEvaluatedKey,
        });

        expect(result2.items).toBeDefined();
      }
    });

    it('should delete scan event', async () => {
      const result = await ScanModel.delete('scan-001');

      expect(result).toBe(true);

      const retrieved = await ScanModel.getById('scan-001');
      expect(retrieved).toBeNull();
    });
  });

  describe('RecipeModel CRUD Operations', () => {
    const mockRecipe: Recipe = {
      id: 'recipe-001',
      name: 'Spiced Latte',
      description: 'Warm latte with spices',
      ingredients: ['blend-001', 'milk', 'honey'],
      instructions: ['Brew', 'Add milk', 'Serve'],
      createdAt: new Date('2024-02-01'),
      updatedAt: new Date('2024-02-01'),
    };

    it('should create a new recipe', async () => {
      const result = await RecipeModel.create(mockRecipe);

      expect(result).toBeDefined();
      expect(result.id).toBe('recipe-001');
      expect(result.name).toBe('Spiced Latte');
    });

    it('should retrieve recipe by ID', async () => {
      const result = await RecipeModel.getById('recipe-001');

      expect(result).toBeDefined();
      expect(result?.ingredients).toContain('blend-001');
    });

    it('should update recipe', async () => {
      const updateData = { name: 'Premium Spiced Latte' };
      const result = await RecipeModel.update('recipe-001', updateData);

      expect(result?.name).toBe('Premium Spiced Latte');
      expect(result?.id).toBe('recipe-001');
    });

    it('should delete recipe', async () => {
      const result = await RecipeModel.delete('recipe-001');

      expect(result).toBe(true);

      const retrieved = await RecipeModel.getById('recipe-001');
      expect(retrieved).toBeNull();
    });
  });

  describe('Transaction Tests', () => {
    it('should handle concurrent operations', async () => {
      const blend1: Blend = {
        id: 'blend-tx-001',
        name: 'Transaction Blend 1',
        origin: 'Ethiopia',
        grower: 'Farm 1',
        roastDate: new Date(),
        expiryDate: new Date('2025-12-31'),
        nfcTagUid: 'TAG001',
        nfcPayload: 'https://example.com/blend-tx-001',
        recipes: [],
        freshness: 'Fresh',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const blend2: Blend = {
        ...blend1,
        id: 'blend-tx-002',
        name: 'Transaction Blend 2',
      };

      const [result1, result2] = await Promise.all([
        BlendModel.create(blend1),
        BlendModel.create(blend2),
      ]);

      expect(result1.id).toBe('blend-tx-001');
      expect(result2.id).toBe('blend-tx-002');
    });
  });

  describe('Error handling', () => {
    it('should handle duplicate key errors', async () => {
      const blend: Blend = {
        id: 'duplicate-blend',
        name: 'Test Blend',
        origin: 'Test Origin',
        grower: 'Test Grower',
        roastDate: new Date(),
        expiryDate: new Date(),
        nfcTagUid: 'TAG-DUP',
        nfcPayload: 'https://example.com/dup',
        recipes: [],
        freshness: 'Fresh',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await BlendModel.create(blend);

      await expect(BlendModel.create(blend)).rejects.toThrow();
    });

    it('should handle missing item errors gracefully', async () => {
      const result = await BlendModel.getById('non-existent-id-xyz');

      expect(result).toBeNull();
    });
  });
});
