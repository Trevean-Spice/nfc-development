import { Router } from 'express';
import { TagController } from '../controllers/tag.controller';

export const tagRouter = Router();

// GET /tags/:uid - Get tag information by UID
tagRouter.get('/:uid', TagController.getTag);

// POST /tags - Program a new NFC tag (requires auth)
tagRouter.post('/', TagController.programTag);
