import { BlendController } from '../../src/controllers/blend.controller';
import { BlendModel } from '../../src/models/blend.model';
import { Blend } from '../../src/types/index';
import { Request, Response } from 'express';

jest.mock('../../src/models/blend.model');

describe('BlendController', () => {
  let blendController: BlendController;
  let mockBlendModel: jest.Mocked<typeof BlendModel>;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  const mockBlend: Blend = {
    id: 'blend-001',
    name: 'Ethiopian Yirgacheffe',
    origin: 'Ethiopia',
    grower: 'Muldhima Cooperative',
    roastDate: new Date('2024-02-01'),
    expiryDate: new Date('2025-02-01'),
    nfcTagUid: 'E0048397C7CD80',
    nfcPayload: 'https://trevean.spice/blend/blend-001',
    recipes: ['recipe-101', 'recipe-102'],
    freshness: 'Fresh',
    createdAt: new Date('2024-02-01'),
    updatedAt: new Date('2024-02-01'),
  };

  const mockBlend2: Blend = {
    id: 'blend-002',
    name: 'Indian Cardamom Blend',
    origin: 'India',
    grower: 'Kerala Spice Co',
    roastDate: new Date('2024-01-15'),
    expiryDate: new Date('2025-01-15'),
    nfcTagUid: 'E0048397C7CD81',
    nfcPayload: 'https://trevean.spice/blend/blend-002',
    recipes: ['recipe-201'],
    freshness: 'Good',
    createdAt: new Date('2024-01-15'),
    updatedAt: new Date('2024-01-15'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockBlendModel = BlendModel as jest.Mocked<typeof BlendModel>;
    blendController = new BlendController();

    // Setup mock response
    jsonMock = jest.fn().mockReturnValue(undefined);
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });

    mockRes = {
      status: statusMock,
      json: jsonMock,
    };

    mockReq = {
      params: {},
      query: {},
      body: {},
    };
  });

  describe('getBlend', () => {
    it('should return a blend by ID with 200 status', async () => {
      mockBlendModel.getById.mockResolvedValue(mockBlend);
      mockReq.params = { id: 'blend-001' };

      await blendController.getBlend(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith(mockBlend);
      expect(mockBlendModel.getById).toHaveBeenCalledWith('blend-001');
    });

    it('should return 404 for missing blend ID', async () => {
      mockBlendModel.getById.mockResolvedValue(null);
      mockReq.params = { id: 'non-existent' };

      await blendController.getBlend(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) })
      );
    });
  });

  describe('getAllBlends', () => {
    it('should return paginated results with default limit and 200 status', async () => {
      const mockResult = {
        items: [mockBlend, mockBlend2],
        count: 2,
        scannedCount: 2,
        lastEvaluatedKey: undefined,
      };

      mockBlendModel.scan.mockResolvedValue(mockResult);
      mockReq.query = {};

      await blendController.getAllBlends(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          items: expect.arrayContaining([mockBlend, mockBlend2]),
          count: 2,
        })
      );
      expect(mockBlendModel.scan).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 20 })
      );
    });

    it('should support custom limit and pagination via query params', async () => {
      const mockResult = {
        items: [mockBlend],
        count: 1,
        scannedCount: 1,
        lastEvaluatedKey: 'blend-002',
      };

      mockBlendModel.scan.mockResolvedValue(mockResult);
      mockReq.query = { limit: '10', startKey: 'blend-001' };

      await blendController.getAllBlends(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          items: expect.arrayContaining([mockBlend]),
          count: 1,
        })
      );
      expect(mockBlendModel.scan).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10, exclusiveStartKey: 'blend-001' })
      );
    });

    it('should return empty array with count 0 for no results', async () => {
      const mockResult = {
        items: [],
        count: 0,
        scannedCount: 0,
        lastEvaluatedKey: undefined,
      };

      mockBlendModel.scan.mockResolvedValue(mockResult);
      mockReq.query = {};

      await blendController.getAllBlends(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ items: [], count: 0 })
      );
    });
  });

  describe('updateBlend', () => {
    it('should require authentication', async () => {
      mockReq.params = { id: 'blend-001' };
      mockReq.body = { name: 'New Name' };
      mockReq.headers = {}; // No auth header

      await blendController.updateBlend(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) })
      );
    });

    it('should modify and return updated blend with 200 status', async () => {
      const updateData = { name: 'Premium Ethiopian Yirgacheffe' };
      const updatedBlend: Blend = { ...mockBlend, ...updateData };

      mockBlendModel.update.mockResolvedValue(updatedBlend);
      mockReq.params = { id: 'blend-001' };
      mockReq.body = updateData;
      mockReq.headers = { authorization: 'Bearer token' };

      await blendController.updateBlend(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith(updatedBlend);
      expect(updatedBlend.name).toBe('Premium Ethiopian Yirgacheffe');
      expect(mockBlendModel.update).toHaveBeenCalledWith('blend-001', updateData);
    });

    it('should return 404 when blend does not exist', async () => {
      mockBlendModel.update.mockResolvedValue(null);
      mockReq.params = { id: 'non-existent' };
      mockReq.body = { name: 'New Name' };
      mockReq.headers = { authorization: 'Bearer token' };

      await blendController.updateBlend(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) })
      );
    });

    it('should preserve unchanged fields when updating', async () => {
      const updateData = { freshness: 'Expired' };
      const updatedBlend: Blend = { ...mockBlend, ...updateData };

      mockBlendModel.update.mockResolvedValue(updatedBlend);
      mockReq.params = { id: 'blend-001' };
      mockReq.body = updateData;
      mockReq.headers = { authorization: 'Bearer token' };

      await blendController.updateBlend(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
      const returnedBlend = jsonMock.mock.calls[0][0];
      expect(returnedBlend.origin).toBe(mockBlend.origin);
      expect(returnedBlend.grower).toBe(mockBlend.grower);
      expect(returnedBlend.freshness).toBe('Expired');
    });
  });

  describe('error handling', () => {
    it('should return 500 if database connection fails', async () => {
      mockBlendModel.getById.mockRejectedValue(new Error('DynamoDB connection failed'));
      mockReq.params = { id: 'blend-001' };

      await blendController.getBlend(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) })
      );
    });
  });
})
