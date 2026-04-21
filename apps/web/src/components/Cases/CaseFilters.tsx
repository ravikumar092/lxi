import React from 'react';
import { Search, Download, SlidersHorizontal } from 'lucide-react';
import { CaseStatus, FilterOptions } from '../../types';

interface CaseFiltersProps {
  filters: FilterOptions;
  onFilterChange: (filters: FilterOptions) => void;
  onExport: () => void;
}

export const CaseFilters: React.FC<CaseFiltersProps> = ({ filters, onFilterChange, onExport }) => {
  const [showAdvanced, setShowAdvanced] = React.useState(false);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onFilterChange({ ...filters, searchQuery: e.target.value });
  };

  const handleStatusToggle = (status: CaseStatus) => {
    const currentStatuses = filters.status || [];
    const newStatuses = currentStatuses.includes(status)
      ? currentStatuses.filter(s => s !== status)
      : [...currentStatuses, status];
    onFilterChange({ ...filters, status: newStatuses.length > 0 ? newStatuses : undefined });
  };

  const clearFilters = () => {
    onFilterChange({});
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search by parties, case number, or diary number..."
            value={filters.searchQuery || ''}
            onChange={handleSearchChange}
            className="w-full pl-10 pr-4 py-3 rounded-lg backdrop-blur-md bg-white/60 dark:bg-gray-800/60 border border-gray-200/50 dark:border-gray-700/50 focus:outline-none focus:ring-2 focus:ring-amber-500/50 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
          />
        </div>

        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className={`px-4 py-3 rounded-lg backdrop-blur-md border transition-all duration-200 flex items-center space-x-2 ${
            showAdvanced
              ? 'bg-amber-500/20 border-amber-500/30 text-amber-700 dark:text-amber-400'
              : 'bg-white/60 dark:bg-gray-800/60 border-gray-200/50 dark:border-gray-700/50 text-gray-700 dark:text-gray-300'
          }`}
        >
          <SlidersHorizontal className="w-5 h-5" />
          <span className="font-medium">Filters</span>
        </button>

        <button
          onClick={onExport}
          className="px-4 py-3 rounded-lg backdrop-blur-md bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-medium transition-all duration-200 flex items-center space-x-2 shadow-lg"
        >
          <Download className="w-5 h-5" />
          <span>Export</span>
        </button>
      </div>

      {showAdvanced && (
        <div className="p-5 rounded-xl backdrop-blur-md bg-white/60 dark:bg-gray-800/60 border border-gray-200/50 dark:border-gray-700/50 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Case Status
            </label>
            <div className="flex flex-wrap gap-2">
              {Object.values(CaseStatus).map((status) => (
                <button
                  key={status}
                  onClick={() => handleStatusToggle(status)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    filters.status?.includes(status)
                      ? 'bg-amber-500/30 text-amber-700 dark:text-amber-400 border-2 border-amber-500/50'
                      : 'bg-gray-100/50 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 border-2 border-transparent hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={clearFilters}
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100/50 dark:hover:bg-gray-700/50 transition-all duration-200"
            >
              Clear All Filters
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
