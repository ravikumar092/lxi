import React from 'react';
import { Calendar, FileText } from 'lucide-react';
import { Case, CaseStatus } from '../../types';

import { formatCaseTitleShort } from '../../utils/caseTitle';

interface CaseCardProps {
  caseData: Case;
  onClick: (caseId: string) => void;
}

export const CaseCard: React.FC<CaseCardProps> = ({ caseData, onClick }) => {
  const getStatusColor = (status: CaseStatus) => {
    switch (status) {
      case CaseStatus.ACTIVE:
        return 'bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/30';
      case CaseStatus.PENDING:
        return 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 border-yellow-500/30';
      case CaseStatus.DEFECTIVE:
        return 'bg-red-500/20 text-red-700 dark:text-red-400 border-red-500/30';
      case CaseStatus.CLOSED:
        return 'bg-gray-500/20 text-gray-700 dark:text-gray-400 border-gray-500/30';
      default:
        return 'bg-gray-500/20 text-gray-700 dark:text-gray-400 border-gray-500/30';
    }
  };

  return (
    <div
      onClick={() => onClick(caseData.id)}
      className="group cursor-pointer p-5 rounded-xl backdrop-blur-md bg-white/60 dark:bg-gray-800/60 border border-gray-200/50 dark:border-gray-700/50 hover:shadow-xl hover:scale-[1.02] transition-all duration-300"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
            {formatCaseTitleShort(caseData)}
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Diary: {caseData.diaryNo}/{caseData.diaryYear}
          </p>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getStatusColor(caseData.status)}`}>
          {caseData.status}
        </span>
      </div>

      <div className="space-y-2">
        <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
          <FileText className="w-4 h-4" />
          <span className="font-medium">Case No:</span>
          <span className="text-gray-900 dark:text-white">{caseData.caseNumber}</span>
        </div>

        <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
          <Calendar className="w-4 h-4" />
          <div className="flex-1">
            <span className="font-medium">Last Listed:</span>
            <p className="text-gray-900 dark:text-white mt-1 text-xs leading-relaxed">
              {caseData.lastListedOn}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};