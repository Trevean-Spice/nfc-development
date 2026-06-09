import { Router } from 'express';
import { RecipeController } from '../controllers/recipe.controller';

export const recipeRouter = Router();

// GET /recipes?blendId=xxx - Get recipes for a specific blend
recipeRouter.get('/', RecipeController.getRecipes);
