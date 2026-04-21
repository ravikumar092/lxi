import React from 'react';
import { Case, CaseStatus } from '../../types';
import { CaseCard } from './CaseCard';

interface CaseKanbanProps {
  cases: Case[];
  onCaseClick: (caseId: string) => void;
}

export const CaseKanban: React.FC<CaseKanbanProps> = ({ cases, onCaseClick }) => {
  const columns = [
    { status: CaseStatus.PENDING, title: 'Pending', color: 'border-yellow-500/50' },
    { status: CaseStatus.ACTIVE, title: 'Active', color: 'border-green-500/50' },
    { status: CaseStatus.DEFECTIVE, title: 'Defective', color: 'border-red-500/50' },
    { status: CaseStatus.CLOSED, title: 'Closed', color: 'border-gray-500/50' },
  ];

  const getCasesByStatus = (status: CaseStatus) => {
    return cases.filter(c => c.status === status);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {columns.map((column) => {
        const columnCases = getCasesByStatus(column.status);

        return (
          <div key={column.status} className="flex flex-col">
            <div className={`p-4 rounded-t-xl backdrop-blur-md bg-white/60 dark:bg-gray-800/60 border-t-4 ${column.color}`}>
              <h3 className="font-bold text-gray-900 dark:text-white text-lg">
                {column.title}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                {columnCases.length} case{columnCases.length !== 1 ? 's' : ''}
              </p>
            </div>

            <div className="flex-1 space-y-4 p-4 rounded-b-xl backdrop-blur-md bg-white/40 dark:bg-gray-800/40 border border-t-0 border-gray-200/50 dark:border-gray-700/50 min-h-[400px]">
              {columnCases.length > 0 ? (
                columnCases.map((caseData) => (
                  <CaseCard key={caseData.id} caseData={caseData} onClick={onCaseClick} />
                ))
              ) : (
                <div className="flex items-center justify-center h-32 text-gray-500 dark:text-gray-400 text-sm">
                  No cases
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
