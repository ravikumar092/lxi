import { useState, useEffect } from 'react';
import React from 'react';
import CourtSync from './CourtSync';
import Login from './components/Login';
import { supabase } from './lib/supabaseClient';
import { UserProvider } from './context/UserContext';

// ── ERROR BOUNDARY ────────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: any) {
    super(props)
    this.state = { hasError: false, error: '' }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message }
  }

  componentDidCatch(error: Error, info: any) {
    console.error('App crashed:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          fontFamily: 'sans-serif',
          gap: 16
        }}>
          <div style={{ fontSize: 32 }}>⚠️</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>
            Something went wrong
          </div>
          <div style={{ 
            fontSize: 13, color: '#666', 
            maxWidth: 400, textAlign: 'center',
            wordBreak: 'break-word'
          }}>
            {this.state.error}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 24px',
              background: '#1A2E5E',
              color: 'white',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 14
            }}
          >
            Refresh App
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// ── SCHEMA MIGRATION ──────────────────────────────────────────────────────────
const SCHEMA_VERSION = '4'

function migrateSchema() {
  try {
    const savedVersion = localStorage.getItem('lextgress_schema_version')
    if (savedVersion !== SCHEMA_VERSION) {
      const raw = localStorage.getItem('lextgress_cases')
      if (raw) {
        const cases = JSON.parse(raw)
        const migrated = cases.map((c: any) => {
          // Backfill diaryNumber from CNR for cases added via CNR lookup (SCIN01XXXXXXYYYY)
          let diaryNumber = c.diaryNumber;
          let diaryYear = c.diaryYear;
          if (!diaryNumber && c.cnrNumber) {
            const m = c.cnrNumber.match(/^SCIN01(\d{6})(\d{4})$/i);
            if (m) {
              diaryNumber = String(parseInt(m[1], 10));
              diaryYear = diaryYear || m[2];
            }
          }
          return {
            ...c,
            diaryNumber: diaryNumber || c.diaryNumber || '',
            diaryYear: diaryYear || c.diaryYear || '',
            judgmentOrders: c.judgmentOrders || [],
            earlierCourtDetails: c.earlierCourtDetails || [],
            listingDates: c.listingDates || [],
            interlocutoryApplications: c.interlocutoryApplications || [],
            notices: c.notices || [],
            decisionDate: c.decisionDate || null,
            mcpData: c.mcpData || null,
          };
        })
        // Deduplicate by CNR (keep the entry with more user data — listings + notes)
        const seen = new Map<string, any>()
        const deduped = migrated.filter((c: any) => {
          const key = c.cnrNumber || `${c.diaryNumber}-${c.diaryYear}`
          if (!key || key === '-') return true // no key to deduplicate on
          if (seen.has(key)) {
            const prev = seen.get(key)
            const prevScore = (prev.listings?.length || 0) + (prev.notes?.length || 0) + (prev.tasks?.length || 0)
            const curScore  = (c.listings?.length  || 0) + (c.notes?.length  || 0) + (c.tasks?.length  || 0)
            if (curScore > prevScore) seen.set(key, c) // swap to richer entry
            return false // drop the duplicate
          }
          seen.set(key, c)
          return true
        })
        // Replace with deduped list (seen map holds the richer entry for each key)
        const final = deduped.map((c: any) => {
          const key = c.cnrNumber || `${c.diaryNumber}-${c.diaryYear}`
          return seen.get(key) || c
        })
        localStorage.setItem('lextgress_cases', JSON.stringify(final))
      }
      localStorage.setItem('lextgress_schema_version', SCHEMA_VERSION)
    }
  } catch (e) {
    console.warn('Migration failed:', e)
  }
}

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    migrateSchema();

    // Check existing session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsLoggedIn(!!session);
    });

    // Listen for login/logout events
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsLoggedIn(!!session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (!isLoggedIn) {
    return <Login onLogin={() => setIsLoggedIn(true)} />;
  }

  return (
    <ErrorBoundary>
      <UserProvider>
        <CourtSync />
      </UserProvider>
    </ErrorBoundary>
  );
}

export default App;
