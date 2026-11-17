import { ScanController } from '../../src/controllers/scan.controller';
import { ScanModel } from '../../src/models/scan.model';
import { ScanEvent } from '../../src/types/index';
import { Request, Response } from 'express';

jest.mock('../../src/models/scan.model');

describe('ScanController', () => {
  let scanController: ScanController;
  let mockScanModel: jest.Mocked<typeof ScanModel>;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

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
    location: {
      latitude: 37.7749,
      longitude: -122.4194,
      accuracy: 10,
    },
    freshness: 'Fresh',
    createdAt: new Date('2024-02-15T10:30:00Z'),
  };

  const mockScanEvent2: ScanEvent = {
    id: 'scan-002',
    blendId: 'blend-001',
    tagUid: 'E0048397C7CD80',
    timestamp: new Date('2024-02-20T14:15:00Z'),
    deviceInfo: {
      platform: 'Android',
      version: '14',
      userAgent: 'Mozilla/5.0',
    },
    location: {
      latitude: 40.7128,
      longitude: -74.006,
      accuracy: 15,
    },
    freshness: 'Fresh',
    createdAt: new Date('2024-02-20T14:15:00Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockScanModel = ScanModel as jest.Mocked<typeof ScanModel>;
    scanController = new ScanController();

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

  describe('recordScan', () => {
    it('should create scan event and return 201 status', async () => {
      const scanInput = {
        blendId: 'blend-001',
        tagUid: 'E0048397C7CD80',
        latitude: 37.7749,
        longitude: -122.4194,
        platform: 'iOS',
      };

      mockScanModel.create.mockResolvedValue(mockScanEvent);
      mockReq.body = scanInput;

      await scanController.recordScan(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(201);
      expect(jsonMock).toHaveBeenCalledWith(mockScanEvent);
      expect(mockScanModel.create).toHaveBeenCalledWith(expect.objectContaining(scanInput));
    });

    it('should handle scan without location data', async () => {
      const scanInput = {
        blendId: 'blend-001',
        tagUid: 'E0048397C7CD80',
        platform: 'web',
      };

      const eventWithoutLocation: ScanEvent = {
        ...mockScanEvent,
        location: undefined,
      };

      mockScanModel.create.mockResolvedValue(eventWithoutLocation);
      mockReq.body = scanInput;

      await scanController.recordScan(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(201);
      const returnedEvent = jsonMock.mock.calls[0][0];
      expect(returnedEvent.location).toBeUndefined();
    });

    it('should preserve freshness status at scan time', async () => {
      const scanInput = {
        blendId: 'blend-001',
        tagUid: 'E0048397C7CD80',
        platform: 'Android',
      };

      mockScanModel.create.mockResolvedValue(mockScanEvent2);
      mockReq.body = scanInput;

      await scanController.recordScan(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(201);
      const returnedEvent = jsonMock.mock.calls[0][0];
      expect(returnedEvent.freshness).toBe('Fresh');
      expect(mockScanModel.create).toHaveBeenCalled();
    });

    it('should return 400 for missing required fields', async () => {
      const invalidInput = {
        blendId: 'blend-001',
        // missing tagUid and platform
      };

      mockReq.body = invalidInput;

      await scanController.recordScan(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) })
      );
    });
  });

  describe('getScanEvents', () => {
    it('should return filtered results by blend ID with 200 status', async () => {
      const mockResult = {
        items: [mockScanEvent, mockScanEvent2],
        count: 2,
        scannedCount: 2,
      };

      mockScanModel.query.mockResolvedValue(mockResult);
      mockReq.query = { blendId: 'blend-001' };

      await scanController.getScanEvents(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          items: expect.arrayContaining([mockScanEvent, mockScanEvent2]),
          count: 2,
        })
      );
      expect(mockScanModel.query).toHaveBeenCalledWith(
        'blendId',
        'blend-001',
        expect.any(Object)
      );
    });

    it('should support date range filtering', async () => {
      const mockResult = {
        items: [mockScanEvent],
        count: 1,
        scannedCount: 1,
      };

      mockScanModel.query.mockResolvedValue(mockResult);

      const startDate = '2024-02-01';
      const endDate = '2024-02-16';
      mockReq.query = { blendId: 'blend-001', startDate, endDate };

      await scanController.getScanEvents(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          items: expect.arrayContaining([mockScanEvent]),
          count: 1,
        })
      );
      expect(mockScanModel.query).toHaveBeenCalledWith(
        'blendId',
        'blend-001',
        expect.objectContaining({
          filterExpression: expect.stringContaining('timestamp'),
        })
      );
    });

    it('should handle empty results gracefully', async () => {
      const mockResult = {
        items: [],
        count: 0,
        scannedCount: 0,
      };

      mockScanModel.query.mockResolvedValue(mockResult);
      mockReq.query = { blendId: 'non-existent-blend' };

      await scanController.getScanEvents(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ items: [], count: 0 })
      );
    });

    it('should support pagination through results via limit parameter', async () => {
      const mockResult = {
        items: [mockScanEvent],
        count: 1,
        scannedCount: 1,
        lastEvaluatedKey: { blendId: 'blend-001', id: 'scan-001' },
      };

      mockScanModel.query.mockResolvedValue(mockResult);
      mockReq.query = { blendId: 'blend-001', limit: '1' };

      await scanController.getScanEvents(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          lastEvaluatedKey: expect.any(Object),
        })
      );
      expect(mockScanModel.query).toHaveBeenCalledWith(
        'blendId',
        'blend-001',
        expect.objectContaining({ limit: 1 })
      );
    });

    it('should return 400 if blendId query param is missing', async () => {
      mockReq.query = {};

      await scanController.getScanEvents(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) })
      );
    });
  });

  describe('error handling', () => {
    it('should return 500 if scan creation fails', async () => {
      mockScanModel.create.mockRejectedValue(new Error('Failed to record scan'));
      mockReq.body = {
        blendId: 'blend-001',
        tagUid: 'E0048397C7CD80',
        platform: 'iOS',
      };

      await scanController.recordScan(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) })
      );
    });

    it('should return 500 if query fails', async () => {
      mockScanModel.query.mockRejectedValue(new Error('Query failed'));
      mockReq.query = { blendId: 'blend-001' };

      await scanController.getScanEvents(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) })
      );
    });
  });
})
