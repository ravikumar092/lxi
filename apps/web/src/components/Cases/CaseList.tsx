import React, { useState, useMemo } from 'react';
import { Case, FilterOptions, ApiCaseResponse } from '../../types';
import { CaseFilters } from './CaseFilters';
import { CaseViewToggle } from './CaseViewToggle';
import { CaseCard } from './CaseCard';
import { CaseTable } from './CaseTable';
import { CaseKanban } from './CaseKanban';
import { SCLookup } from './SCLookup';


interface CaseListProps {
  cases: Case[];
  onCaseClick: (caseId: string) => void;
  onCaseFound: (apiResponse: ApiCaseResponse) => void;
}

type ViewType = 'gallery' | 'table' | 'kanban';

export const CaseList: React.FC<CaseListProps> = ({ cases, onCaseClick, onCaseFound }) => {
  const [viewType, setViewType] = useState<ViewType>('gallery');
  const [filters, setFilters] = useState<FilterOptions>({});

  const filteredCases = useMemo(() => {
    let result = [...cases];

    if (filters.searchQuery) {
      const query = filters.searchQuery.toLowerCase();
      result = result.filter(
        c =>
          c.caseNumber.toLowerCase().includes(query) ||
          (c.displayTitle || '').toLowerCase().includes(query) ||
          (c.petitioner || '').toLowerCase().includes(query) ||
          (c.respondent || '').toLowerCase().includes(query) ||
          c.parties.toLowerCase().includes(query) ||
          c.diaryNo.toLowerCase().includes(query)
      );
    }

    if (filters.status && filters.status.length > 0) {
      result = result.filter(c => filters.status!.includes(c.status));
    }


    return result;
  }, [cases, filters]);

  const handleExport = () => {
    const csvContent = [
      ['Title', 'Diary Number', 'Year', 'Case Number', 'Last Listed On', 'Status'],
      ...filteredCases.map(c => [
        c.displayTitle || c.parties,
        c.diaryNo,
        c.diaryYear,
        c.caseNumber,
        c.lastListedOn,
        c.status
      ])
    ]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cases-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <SCLookup onCaseFound={onCaseFound} />

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Cases</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Showing {filteredCases.length} of {cases.length} cases
          </p>
        </div>
        <CaseViewToggle currentView={viewType} onViewChange={setViewType} />
      </div>

      <CaseFilters filters={filters} onFilterChange={setFilters} onExport={handleExport} />

      {filteredCases.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 rounded-xl backdrop-blur-md bg-white/60 dark:bg-gray-800/60 border border-gray-200/50 dark:border-gray-700/50">
          <p className="text-gray-500 dark:text-gray-400 text-lg">
            {cases.length === 0 ? 'No cases added yet' : 'No cases found'}
          </p>
          <p className="text-gray-400 dark:text-gray-500 text-sm mt-2">
            {cases.length === 0
              ? 'Use the Supreme Court Case Lookup above to add your first case'
              : 'Try adjusting your filters'}
          </p>
        </div>
      ) : (
        <>
          {viewType === 'gallery' && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {filteredCases.map(caseData => (
                <CaseCard key={caseData.id} caseData={caseData} onClick={onCaseClick} />
              ))}
            </div>
          )}

          {viewType === 'table' && (
            <CaseTable cases={filteredCases} onCaseClick={onCaseClick} />
          )}

          {viewType === 'kanban' && (
            <CaseKanban cases={filteredCases} onCaseClick={onCaseClick} />
          )}
        </>
      )}
    </div>
  );
};
