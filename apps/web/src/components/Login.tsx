import React, { useState } from 'react';
import { Eye, EyeOff, Scale } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

// ── Demo account search limit helpers (used by SearchCaseForm) ────────────────
// Search counts stay in localStorage (ephemeral per-browser, intentional for demo accounts)
export const SEARCH_LIMIT_KEY = (email: string) => `lx_search_count_${email}`;

export function getDemoSearchCount(email: string): number {
  return parseInt(localStorage.getItem(SEARCH_LIMIT_KEY(email)) || '0', 10);
}

export function incrementDemoSearchCount(email: string): void {
  const count = getDemoSearchCount(email);
  localStorage.setItem(SEARCH_LIMIT_KEY(email), String(count + 1));
}

// Search limit comes from user_profiles.search_limit in Supabase (set to 50 for demo1-demo10)
// Pass it in from CourtSync where the profile is already loaded
export function getDemoSearchLimit(searchLimit: number | null): number | null {
  return searchLimit ?? null;  // null = unlimited
}

interface LoginProps {
  onLogin: () => void;
}

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      setError('Invalid email or password');
    } else {
      onLogin();
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col items-center p-8">
        <div className="w-16 h-16 bg-[#1A2E5E] rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-[#1A2E5E]/20">
          <Scale className="text-white w-10 h-10" />
        </div>
        
        <h1 className="text-2xl font-extrabold text-[#1A2E5E] mb-1">Lex Tigress</h1>
        <p className="text-slate-500 font-medium mb-8 text-sm uppercase tracking-widest">AI Legal Platform</p>

        <form onSubmit={handleLogin} className="w-full space-y-6">
          <div className="space-y-1">
            <label className="text-sm font-bold text-slate-700 ml-1">Email</label>
            <input 
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-[#1A2E5E] focus:ring-2 focus:ring-[#1A2E5E]/10 outline-none transition-all"
              placeholder="name@lextgress.com"
              required
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-bold text-slate-700 ml-1">Password</label>
            <div className="relative">
              <input 
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-[#1A2E5E] focus:ring-2 focus:ring-[#1A2E5E]/10 outline-none transition-all"
                placeholder="••••••••"
                required
              />
              <button 
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-slate-600 transition-colors"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm font-medium animate-shake">
              {error}
            </div>
          )}

          <button 
            type="submit"
            className="w-full bg-[#1A2E5E] hover:bg-[#2A4B9B] text-white font-bold py-3.5 rounded-xl shadow-lg shadow-[#1A2E5E]/20 active:scale-[0.98] transition-all"
          >
            Login
          </button>
        </form>

        <div className="mt-8 text-xs text-slate-400 font-medium">
          © 2026 Lex Tigress AI • Professional Legal Systems
        </div>
      </div>
      
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
        }
        .animate-shake { animation: shake 0.2s ease-in-out 0s 2; }
      `}</style>
    </div>
  );
};

export default Login;