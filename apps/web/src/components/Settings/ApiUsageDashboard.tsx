import { useState, useEffect } from 'react';
import { useApp } from '../../AppContext';

export default function ApiUsageDashboard() {
  const { T } = useApp();
  const [metrics, setMetrics] = useState<any>(null);
  const [chartData, setChartData] = useState<any[]>([]);
  const [recentLogs, setRecentLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchUsageData = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/api-usage');
      if (!res.ok) throw new Error('Failed to load API stats');
      const data = await res.json();
      setMetrics(data.metrics);
      setChartData(data.chartData);
      setRecentLogs(data.recentLogs);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsageData();
  }, []);

  if (loading) {
    return <div style={{ padding: 20, color: T.textMuted }}>Loading API metrics...</div>;
  }

  if (error) {
    return (
      <div style={{ padding: 20, color: '#C62828' }}>
        Failed to load metrics: {error}
        <br/><button onClick={fetchUsageData} style={{ marginTop: 10, padding: 8 }}>Retry</button>
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: 40 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>Admin API Usage Over 7 Days</div>
        <button onClick={fetchUsageData} style={{
          padding: '6px 12px', background: T.surface, color: T.text, border: `1px solid ${T.border}`, borderRadius: 6, cursor: 'pointer'
        }}>
          ↻ Refresh
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 30 }}>
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: 20, borderRadius: 12 }}>
          <div style={{ fontSize: 12, color: T.textMuted, fontWeight: 700, marginBottom: 8, letterSpacing: 1 }}>TOTAL CALLS</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: T.text }}>{metrics.totalCalls.toLocaleString()}</div>
        </div>
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: 20, borderRadius: 12 }}>
          <div style={{ fontSize: 12, color: T.textMuted, fontWeight: 700, marginBottom: 8, letterSpacing: 1 }}>AVG LATENCY</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: T.text }}>{metrics.avgDuration} <span style={{ fontSize: 16 }}>ms</span></div>
        </div>
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: 20, borderRadius: 12 }}>
          <div style={{ fontSize: 12, color: T.textMuted, fontWeight: 700, marginBottom: 8, letterSpacing: 1 }}>ERROR RATE</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: metrics.errorRate > 5 ? '#C62828' : T.text }}>{metrics.errorRate}%</div>
        </div>
      </div>

      {/* Breakdown List */}
      <div style={{ marginBottom: 30, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${T.border}`, background: T.bg, fontWeight: 700, color: T.text }}>
          Usage by Endpoint Group
        </div>
        <div style={{ padding: 20 }}>
          {chartData.map((d, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ width: 140, fontSize: 13, color: T.textMuted, fontWeight: 600 }}>{d.name}</div>
              <div style={{ flex: 1, height: 12, background: T.bg, borderRadius: 6, margin: '0 16px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(100, (d.calls / Math.max(1, chartData[0]?.calls)) * 100)}%`, background: '#2A7BD4', borderRadius: 6 }} />
              </div>
              <div style={{ width: 140, textAlign: 'right', fontSize: 13, display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                <span style={{ color: T.text, fontWeight: 600 }}>{d.calls} calls</span>
                <span style={{ color: T.textMuted }}>{d.avg_latency}ms</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Logs DataTable */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${T.border}`, background: T.bg, fontWeight: 700, color: T.text }}>
          Recent Activity (Last 100)
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${T.border}`, background: T.surface }}>
                <th style={{ padding: '12px 20px', color: T.textMuted, fontWeight: 600 }}>Timestamp</th>
                <th style={{ padding: '12px 20px', color: T.textMuted, fontWeight: 600 }}>Method</th>
                <th style={{ padding: '12px 20px', color: T.textMuted, fontWeight: 600 }}>Endpoint</th>
                <th style={{ padding: '12px 20px', color: T.textMuted, fontWeight: 600 }}>Status</th>
                <th style={{ padding: '12px 20px', color: T.textMuted, fontWeight: 600 }}>Latency</th>
              </tr>
            </thead>
            <tbody>
              {recentLogs.map((log, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${T.borderSoft}`, background: i % 2 === 0 ? T.surface : T.bg }}>
                  <td style={{ padding: '10px 20px', color: T.textMuted, whiteSpace: 'nowrap' }}>
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td style={{ padding: '10px 20px', color: T.text, fontWeight: 600 }}>{log.method}</td>
                  <td style={{ padding: '10px 20px', color: T.text }}>{log.endpoint}</td>
                  <td style={{ padding: '10px 20px' }}>
                    <span style={{ 
                      padding: '4px 8px', borderRadius: 4, fontWeight: 700, fontSize: 11,
                      backgroundColor: log.status_code >= 500 ? '#FEF2F2' : log.status_code >= 400 ? '#FFFBEB' : '#ECFDF5',
                      color: log.status_code >= 500 ? '#C62828' : log.status_code >= 400 ? '#D97706' : '#059669',
                      border: `1px solid ${log.status_code >= 500 ? '#FECACA' : log.status_code >= 400 ? '#FDE68A' : '#A7F3D0'}`
                    }}>
                      {log.status_code}
                    </span>
                  </td>
                  <td style={{ padding: '10px 20px', color: T.text, fontWeight: 600 }}>{log.duration_ms}ms</td>
                </tr>
              ))}
              {recentLogs.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: '20px', textAlign: 'center', color: T.textMuted }}>No remote API logs found in the selected period.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
