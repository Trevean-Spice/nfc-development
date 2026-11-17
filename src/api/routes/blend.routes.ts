import { Router } from 'express';
import { BlendController } from '../controllers/blend.controller';

export const blendRouter = Router();

// GET /blends - Get all blends with pagination
blendRouter.get('/', BlendController.getAllBlends);

// GET /blends/:id - Get a specific blend by ID
blendRouter.get('/:id', BlendController.getBlend);

// PUT /blends/:id - Update a blend (requires auth)
blendRouter.put('/:id', BlendController.updateBlend);
