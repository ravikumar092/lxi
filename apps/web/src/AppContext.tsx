import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { Theme, LIGHT_THEME, DARK_THEME } from './themes';

// ── STATUS STYLE ──────────────────────────────────────────────────────────────
// getS(status) returns the bg/text/border colours for each case status badge.
export interface StatusStyle {
  bg: string;
  text: string;
  border: string;
}

const STATUS_STYLES: Record<string, StatusStyle> = {
  Fresh:   { bg: '#E8F0FB', text: '#2A7BD4', border: '#B0CAF0' },
  Pending: { bg: '#FBF4E3', text: '#9B7B28', border: '#E8D18A' },
  Disposed:{ bg: '#E8F5EF', text: '#1A8C5B', border: '#A0D4BB' },
  // fallback
  Default: { bg: '#F0F2F8', text: '#6A74A0', border: '#C8CDE0' },
};

// ── HEARING COLOR ─────────────────────────────────────────────────────────────
// Returns a colour string based on how many days until next hearing.
function computeHearingColor(days: number | null): string {
  if (days === null) return '#8A94B0';
  if (days === 0)    return '#C62828'; // today — red
  if (days <= 3)     return '#E65100'; // very soon — orange-red
  if (days <= 7)     return '#C9A84C'; // this week — gold
  if (days <= 14)    return '#2A7BD4'; // 2 weeks — blue
  return '#1A8C5B';                    // later — green
}

// ── CONTEXT SHAPE ─────────────────────────────────────────────────────────────
interface AppContextValue {
  /** Current active theme tokens */
  T: Theme;
  /** Whether dark mode is on — optional, CourtSync manages this itself */
  isDark?: boolean;
  /** Toggle between light and dark theme — optional, CourtSync manages this itself */
  toggleTheme?: () => void;
  /** Get status badge style for a given case status string */
  getS: (status: string) => StatusStyle;
  /** Get colour for the hearing countdown based on days remaining */
  hearingColor: (days: number | null) => string;
}

export const AppContext = createContext<AppContextValue | undefined>(undefined);

// ── PROVIDER ──────────────────────────────────────────────────────────────────
interface AppProviderProps {
  children: ReactNode;
}

export function AppProvider({ children }: AppProviderProps) {
  const [isDark, setIsDark] = useState(false);

  const toggleTheme = useCallback(() => setIsDark(d => !d), []);

  const T = isDark ? DARK_THEME : LIGHT_THEME;

  const getS = useCallback((status: string): StatusStyle => {
    return STATUS_STYLES[status] ?? STATUS_STYLES.Default;
  }, []);

  const hearingColor = useCallback((days: number | null): string => {
    return computeHearingColor(days);
  }, []);

  return (
    <AppContext.Provider value={{ T, isDark, toggleTheme, getS, hearingColor }}>
      {children}
    </AppContext.Provider>
  );
}

// ── HOOK ──────────────────────────────────────────────────────────────────────
export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp must be used inside <AppProvider>');
  }
  return ctx;
}