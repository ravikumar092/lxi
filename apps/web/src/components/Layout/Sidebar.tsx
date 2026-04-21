import React from 'react';
import {
  Scale,
  CheckSquare,
  FileText,
  Bell,
  Mic,
  BarChart3,
  Gavel,
  ChevronRight
} from 'lucide-react';

interface SidebarProps {
  activeView: string;
  onViewChange: (view: string) => void;
}

const menuItems = [
  { id: 'cases', label: 'Cases', icon: Scale },
  { id: 'tasks', label: 'Tasks & Deadlines', icon: CheckSquare },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'analytics', label: 'AI Analysis Hub', icon: BarChart3 },
  { id: 'service', label: 'Service Status', icon: Gavel },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'voice', label: 'Voice Notes', icon: Mic },
];

export const Sidebar: React.FC<SidebarProps> = ({ activeView, onViewChange }) => {
  return (
    <aside className="w-64 h-screen backdrop-blur-xl bg-white/70 dark:bg-gray-900/70 border-r border-gray-200/50 dark:border-gray-700/50 flex flex-col">
      <div className="p-6 border-b border-gray-200/50 dark:border-gray-700/50">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600">
            <Scale className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Lex Tigress</h1>
            <p className="text-xs text-gray-600 dark:text-gray-400">AI Legal Platform</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={`
                w-full flex items-center justify-between px-4 py-3 rounded-lg
                transition-all duration-200 group
                ${isActive
                  ? 'bg-gradient-to-r from-amber-500/20 to-orange-600/20 text-amber-700 dark:text-amber-400 shadow-sm'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100/50 dark:hover:bg-gray-800/50'
                }
              `}
            >
              <div className="flex items-center space-x-3">
                <Icon className={`w-5 h-5 ${isActive ? 'text-amber-600 dark:text-amber-400' : ''}`} />
                <span className="font-medium text-sm">{item.label}</span>
              </div>
              {isActive && <ChevronRight className="w-4 h-4" />}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-gray-200/50 dark:border-gray-700/50">
        <div className="p-3 rounded-lg backdrop-blur-md bg-gradient-to-br from-amber-500/10 to-orange-600/10 border border-amber-500/20">
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-400">Need Help?</p>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">Contact support</p>
        </div>
      </div>
    </aside>
  );
};
