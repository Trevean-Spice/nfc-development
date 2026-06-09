import { Router } from 'express';
import { ScanController } from '../controllers/scan.controller';

export const scanRouter = Router();

// POST /scans - Record a new scan event
scanRouter.post('/', ScanController.recordScan);

// GET /scans?tagUid=xxx - Get scan events for a specific tag
scanRouter.get('/', ScanController.getScanEvents);
