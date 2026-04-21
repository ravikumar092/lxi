import React, { useState } from 'react';
import { Search, FileText, AlertCircle, Loader2 } from 'lucide-react';
import { fetchCaseFullByCNR } from '../../services/eCourtsService';
import { transformMCPToCase } from '../../utils/apiTransform';

interface SCLookupProps {
  onCaseFound: (caseData: any) => void;
}

export const SCLookup: React.FC<SCLookupProps> = ({ onCaseFound }) => {
  const [diaryNumber, setDiaryNumber] = useState('');
  const [diaryYear, setDiaryYear] = useState(new Date().getFullYear().toString());
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLookup = async () => {
    const input = diaryNumber.trim();
    if (!input) {
      setError('Please enter a diary number or CNR number.');
      return;
    }

    // Auto-detect input type:
    // - Numeric (e.g. 542) → diary number → derive CNR: SCIN01 + padded to 6 digits + year
    // - Starts with SCIN (e.g. SCIN010005422026) → use directly as CNR
    let cnr: string;
    if (/^\d+$/.test(input)) {
      cnr = `SCIN01${input.padStart(6, '0')}${diaryYear}`;
    } else if (/^SCIN/i.test(input)) {
      cnr = input.toUpperCase();
    } else {
      setError('Enter a diary number (e.g., 542) or a CNR number (e.g., SCIN010005422026).');
      return;
    }

    setIsSearching(true);
    setError(null);

    try {
      const data = await fetchCaseFullByCNR(cnr);
      if (data) {
        const caseData = transformMCPToCase(data, cnr);
        onCaseFound(caseData);
        setDiaryNumber('');
      } else {
        setError('Case not found. Please verify the diary number and year.');
      }
    } catch (err) {
      console.error('Error fetching case:', err);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="mb-6 p-6 rounded-xl backdrop-blur-md bg-gradient-to-r from-blue-500/10 to-indigo-500/10 border border-blue-500/20">
      <div className="flex items-start space-x-4">
        <div className="p-3 rounded-lg bg-blue-500/20">
          <FileText className="w-6 h-6 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Supreme Court Case Lookup
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Enter a diary number (e.g., 542) with the year, or paste a full CNR number (e.g., SCIN010005422026).
          </p>

          <div className="flex space-x-3">
            <input
              type="text"
              placeholder="Diary No. (e.g., 542) or CNR (SCIN…)"
              value={diaryNumber}
              onChange={(e) => {
                setDiaryNumber(e.target.value);
                setError(null);
              }}
              onKeyPress={(e) => e.key === 'Enter' && handleLookup()}
              className="flex-1 px-4 py-2 rounded-lg backdrop-blur-md bg-white/60 dark:bg-gray-800/60 border border-gray-200/50 dark:border-gray-700/50 focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
            />
            <input
              type="text"
              placeholder="Year"
              value={diaryYear}
              onChange={(e) => {
                setDiaryYear(e.target.value);
                setError(null);
              }}
              onKeyPress={(e) => e.key === 'Enter' && handleLookup()}
              className="w-32 px-4 py-2 rounded-lg backdrop-blur-md bg-white/60 dark:bg-gray-800/60 border border-gray-200/50 dark:border-gray-700/50 focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
            />
            <button
              onClick={handleLookup}
              disabled={isSearching || !diaryNumber.trim()}
              className="px-6 py-2 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
            >
              {isSearching ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Searching...</span>
                </>
              ) : (
                <>
                  <Search className="w-5 h-5" />
                  <span>Lookup</span>
                </>
              )}
            </button>
          </div>

          {error && (
            <div className="mt-3 flex items-start space-x-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg">
              <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <p>{error}</p>
            </div>
          )}

          <div className="mt-3 flex items-start space-x-2 text-xs text-blue-600 dark:text-blue-400">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <p>
              Diary number is automatically converted to CNR for lookup. Both formats are supported.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};