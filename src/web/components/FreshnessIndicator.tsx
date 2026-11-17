import { FC, useMemo } from 'react';

interface FreshnessIndicatorProps {
  harvestDate: string;
  freshnessWindowDays: number;
}

interface FreshnessStatus {
  level: 'fresh' | 'good' | 'aging' | 'old';
  percentage: number;
  label: string;
  color: string;
}

const FreshnessIndicator: FC<FreshnessIndicatorProps> = ({
  harvestDate,
  freshnessWindowDays,
}) => {
  const freshnessStatus = useMemo<FreshnessStatus>(() => {
    const harvest = new Date(harvestDate);
    const now = new Date();
    const daysSinceHarvest = Math.floor(
      (now.getTime() - harvest.getTime()) / (1000 * 60 * 60 * 24)
    );

    const percentage = Math.max(
      0,
      Math.round(((freshnessWindowDays - daysSinceHarvest) / freshnessWindowDays) * 100)
    );

    let status: FreshnessStatus['level'] = 'fresh';
    if (percentage >= 75) {
      status = 'fresh';
    } else if (percentage >= 50) {
      status = 'good';
    } else if (percentage >= 25) {
      status = 'aging';
    } else {
      status = 'old';
    }

    const colors: Record<FreshnessStatus['level'], string> = {
      fresh: 'bg-green-500',
      good: 'bg-yellow-500',
      aging: 'bg-orange-500',
      old: 'bg-red-500',
    };

    const labels: Record<FreshnessStatus['level'], string> = {
      fresh: 'Peak Freshness',
      good: 'Still Great',
      aging: 'Use Soon',
      old: 'Best Used Soon',
    };

    return {
      level: status,
      percentage: Math.max(0, percentage),
      label: labels[status],
      color: colors[status],
    };
  }, [harvestDate, freshnessWindowDays]);

  return (
    <div className="w-full">
      {/* Label and Percentage */}
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm font-semibold text-amber-900">
          {freshnessStatus.label}
        </span>
        <span className="text-sm font-bold text-amber-700">
          {freshnessStatus.percentage}%
        </span>
      </div>

      {/* Progress Bar */}
      <div className="w-full h-2 bg-amber-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${freshnessStatus.color} transition-all duration-300`}
          style={{ width: `${freshnessStatus.percentage}%` }}
        ></div>
      </div>

      {/* Status Indicator Dots */}
      <div className="flex justify-between mt-2 px-0.5">
        <div
          className={`w-2 h-2 rounded-full transition-colors ${
            freshnessStatus.percentage >= 75 ? 'bg-green-500' : 'bg-gray-300'
          }`}
          title="Fresh"
        ></div>
        <div
          className={`w-2 h-2 rounded-full transition-colors ${
            freshnessStatus.percentage >= 50 ? 'bg-yellow-500' : 'bg-gray-300'
          }`}
          title="Good"
        ></div>
        <div
          className={`w-2 h-2 rounded-full transition-colors ${
            freshnessStatus.percentage >= 25 ? 'bg-orange-500' : 'bg-gray-300'
          }`}
          title="Aging"
        ></div>
        <div
          className={`w-2 h-2 rounded-full transition-colors ${
            freshnessStatus.percentage > 0 ? 'bg-red-500' : 'bg-gray-300'
          }`}
          title="Old"
        ></div>
      </div>
    </div>
  );
};

export default FreshnessIndicator;
