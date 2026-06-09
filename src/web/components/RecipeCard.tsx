import { FC } from 'react';

interface Recipe {
  id: string;
  title: string;
  prepTime: number;
  servings: number;
  description: string;
  ingredients?: string[];
}

interface RecipeCardProps {
  recipe: Recipe;
}

const RecipeCard: FC<RecipeCardProps> = ({ recipe }) => {
  return (
    <div className="bg-white border-2 border-amber-200 rounded-lg p-6 hover:shadow-lg transition-shadow">
      {/* Header */}
      <h3 className="text-xl font-bold text-amber-900 mb-2">{recipe.title}</h3>
      <p className="text-amber-700 mb-4">{recipe.description}</p>

      {/* Metadata */}
      <div className="flex gap-4 mb-4 pb-4 border-b border-amber-100">
        <div className="flex items-center gap-2">
          <span className="text-lg">⏱️</span>
          <div>
            <p className="text-xs text-amber-600 uppercase font-semibold">Prep Time</p>
            <p className="font-bold text-amber-900">{recipe.prepTime} min</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-lg">👥</span>
          <div>
            <p className="text-xs text-amber-600 uppercase font-semibold">Servings</p>
            <p className="font-bold text-amber-900">{recipe.servings}</p>
          </div>
        </div>
      </div>

      {/* Ingredients */}
      {recipe.ingredients && recipe.ingredients.length > 0 && (
        <div>
          <p className="text-sm font-semibold text-amber-600 uppercase tracking-wide mb-3">
            Key Ingredients
          </p>
          <ul className="space-y-1 mb-4">
            {recipe.ingredients.map((ingredient, idx) => (
              <li
                key={idx}
                className="text-sm text-amber-800 flex items-start before:content-['•'] before:mr-2 before:text-amber-700"
              >
                {ingredient}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* CTA */}
      <button className="w-full mt-4 bg-amber-700 hover:bg-amber-800 text-white font-semibold py-2 px-4 rounded transition-colors">
        View Full Recipe
      </button>
    </div>
  );
};

export default RecipeCard;
