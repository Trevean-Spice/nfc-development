import { FC } from 'react';
import Image from 'next/image';
import FreshnessIndicator from './FreshnessIndicator';

interface Blend {
  id: string;
  name: string;
  origin: string;
  keyIngredients: string[];
  harvestDate: string;
  description: string;
  imageUrl: string;
}

interface BlendCardProps {
  blend: Blend;
}

const BlendCard: FC<BlendCardProps> = ({ blend }) => {
  const freshnessWindowDays = 180;

  return (
    <div className="bg-white rounded-lg shadow-md hover:shadow-xl transition-shadow overflow-hidden border border-amber-100 hover:border-amber-300 h-full flex flex-col">
      {/* Image */}
      <div className="relative w-full aspect-square bg-amber-100 overflow-hidden">
        <Image
          src={blend.imageUrl}
          alt={blend.name}
          fill
          className="object-cover hover:scale-105 transition-transform duration-300"
        />
      </div>

      {/* Content */}
      <div className="p-4 flex flex-col flex-grow">
        <h3 className="text-lg font-bold text-amber-900 mb-1">
          {blend.name}
        </h3>
        <p className="text-sm text-amber-700 mb-3">{blend.origin}</p>

        {/* Ingredients */}
        <div className="mb-4">
          <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-2">
            Key Ingredients
          </p>
          <div className="flex flex-wrap gap-1">
            {blend.keyIngredients.slice(0, 3).map((ing, idx) => (
              <span
                key={idx}
                className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded"
              >
                {ing}
              </span>
            ))}
            {blend.keyIngredients.length > 3 && (
              <span className="text-xs text-amber-600 px-2 py-1">
                +{blend.keyIngredients.length - 3}
              </span>
            )}
          </div>
        </div>

        {/* Freshness */}
        <div className="mt-auto pt-4 border-t border-amber-100">
          <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-2">
            Freshness Status
          </p>
          <FreshnessIndicator
            harvestDate={blend.harvestDate}
            freshnessWindowDays={freshnessWindowDays}
          />
        </div>

        {/* Tap to Explore */}
        <div className="mt-4 pt-4 border-t border-amber-100">
          <p className="text-center text-sm font-semibold text-amber-700 hover:text-amber-900 cursor-pointer">
            Tap to Explore ✓
          </p>
        </div>
      </div>
    </div>
  );
};

export default BlendCard;
