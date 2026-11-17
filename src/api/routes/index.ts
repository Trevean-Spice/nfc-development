import { Router } from 'express';
import { blendRouter } from './blend.routes';
import { scanRouter } from './scan.routes';
import { recipeRouter } from './recipe.routes';
import { tagRouter } from './tag.routes';

export const apiRoutes = Router();

// Mount route modules
apiRoutes.use('/blends', blendRouter);
apiRoutes.use('/scans', scanRouter);
apiRoutes.use('/recipes', recipeRouter);
apiRoutes.use('/tags', tagRouter);

export { blendRouter } from './blend.routes';
export { scanRouter } from './scan.routes';
export { recipeRouter } from './recipe.routes';
export { tagRouter } from './tag.routes';
