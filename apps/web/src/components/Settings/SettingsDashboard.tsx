import { useState } from 'react';
import { useApp } from '../../AppContext';
import { useUser } from '../../context/UserContext';
import TeamManagement from './TeamManagement';
import ApiUsageDashboard from './ApiUsageDashboard';

const TABS = [
  { id: 'team', label: 'Team Management' },
  { id: 'api_usage', label: 'API Usage' },
];

export default function SettingsDashboard() {
  const { T } = useApp();
  const { userProfile } = useUser();
  const [activeTab, setActiveTab] = useState('team');

  const isAdmin = userProfile?.role === 'Admin';
  
  const tabs = isAdmin 
    ? [...TABS] 
    : TABS.filter(t => t.id !== 'api_usage');

  return (
    <div style={{ padding: 32, maxWidth: 1000, margin: '0 auto', width: '100%' }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 20 }}>
        Settings
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${T.border}`, marginBottom: 28 }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: activeTab === tab.id ? 600 : 400,
              color: activeTab === tab.id ? T.accent : T.textMuted,
              borderBottom: activeTab === tab.id ? `2px solid ${T.accent}` : '2px solid transparent',
              background: 'none',
              border: 'none',
              borderRadius: 0,
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'team' && <TeamManagement />}
      {activeTab === 'api_usage' && <ApiUsageDashboard />}
    </div>
  );
}
