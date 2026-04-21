import React from 'react';
import { LayoutGrid, Table, Columns2 as Columns } from 'lucide-react';

type ViewType = 'gallery' | 'table' | 'kanban';

interface CaseViewToggleProps {
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
}

export const CaseViewToggle: React.FC<CaseViewToggleProps> = ({ currentView, onViewChange }) => {
  const views: { type: ViewType; icon: React.ElementType; label: string }[] = [
    { type: 'gallery', icon: LayoutGrid, label: 'Gallery' },
    { type: 'table', icon: Table, label: 'Table' },
    { type: 'kanban', icon: Columns, label: 'Kanban' },
  ];

  return (
    <div className="flex items-center space-x-1 p-1 rounded-lg backdrop-blur-md bg-white/60 dark:bg-gray-800/60 border border-gray-200/50 dark:border-gray-700/50">
      {views.map(({ type, icon: Icon, label }) => (
        <button
          key={type}
          onClick={() => onViewChange(type)}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-all duration-200 ${
            currentView === type
              ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-md'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100/50 dark:hover:bg-gray-700/50'
          }`}
          aria-label={label}
        >
          <Icon className="w-4 h-4" />
          <span className="text-sm font-medium">{label}</span>
        </button>
      ))}
    </div>
  );
};