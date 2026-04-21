import React from 'react';
import { Case, CaseStatus } from '../../types';
import { Calendar, FileText, Hash } from 'lucide-react';
import { formatCaseTitleShort } from '../../utils/caseTitle';

interface CaseTableProps {
  cases: Case[];
  onCaseClick: (caseId: string) => void;
}

export const CaseTable: React.FC<CaseTableProps> = ({ cases, onCaseClick }) => {
  const getStatusColor = (status: CaseStatus) => {
    switch (status) {
      case CaseStatus.ACTIVE:
        return 'bg-green-500/20 text-green-700 dark:text-green-400';
      case CaseStatus.PENDING:
        return 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400';
      case CaseStatus.DEFECTIVE:
        return 'bg-red-500/20 text-red-700 dark:text-red-400';
      case CaseStatus.CLOSED:
        return 'bg-gray-500/20 text-gray-700 dark:text-gray-400';
      default:
        return 'bg-gray-500/20 text-gray-700 dark:text-gray-400';
    }
  };

  return (
    <div className="overflow-x-auto rounded-xl backdrop-blur-md bg-white/60 dark:bg-gray-800/60 border border-gray-200/50 dark:border-gray-700/50">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200/50 dark:border-gray-700/50">
            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
              Parties
            </th>
            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
              Diary Number
            </th>
            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
              Year
            </th>
            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
              Case Number
            </th>
            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
              Last Listed On
            </th>
            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {cases.map((caseData) => (
            <tr
              key={caseData.id}
              onClick={() => onCaseClick(caseData.id)}
              className="border-b border-gray-200/30 dark:border-gray-700/30 hover:bg-gray-100/30 dark:hover:bg-gray-700/30 cursor-pointer transition-colors duration-150"
            >
              <td className="px-6 py-4">
                <span className="font-semibold text-gray-900 dark:text-white">
                  {caseData.displayTitle || formatCaseTitleShort(caseData)}
                </span>
              </td>
              <td className="px-6 py-4">
                <div className="flex items-center space-x-2">
                  <Hash className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">{caseData.diaryNo}</span>
                </div>
              </td>
              <td className="px-6 py-4">
                <span className="text-sm text-gray-700 dark:text-gray-300">{caseData.diaryYear}</span>
              </td>
              <td className="px-6 py-4">
                <div className="flex items-center space-x-2">
                  <FileText className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">{caseData.caseNumber}</span>
                </div>
              </td>
              <td className="px-6 py-4">
                <div className="flex items-center space-x-2">
                  <Calendar className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                  <span className="text-xs text-gray-700 dark:text-gray-300">{caseData.lastListedOn}</span>
                </div>
              </td>
              <td className="px-6 py-4">
                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(caseData.status)}`}>
                  {caseData.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};