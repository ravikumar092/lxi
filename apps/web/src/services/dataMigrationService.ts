/**
 * Lex Tigress — Browser-to-Supabase Data Migration
 *
 * On first login after the Supabase migration, detects any data still
 * sitting in localStorage and offers to upload it to the cloud.
 */

import { supabase } from '../lib/supabaseClient';

const MIGRATION_FLAG = 'lx_supabase_migrated_v1';

export interface MigrationStatus {
  needed: boolean;
  caseCount: number;
  noteCount: number;
  userId: string;
}

/** Check if there is local data that hasn't been migrated yet. */
export async function checkMigrationNeeded(): Promise<MigrationStatus> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { needed: false, caseCount: 0, noteCount: 0, userId: '' };

  // Already migrated on this browser
  if (localStorage.getItem(MIGRATION_FLAG) === user.id) {
    return { needed: false, caseCount: 0, noteCount: 0, userId: user.id };
  }

  const rawCases = localStorage.getItem('lextgress_cases');
  const rawNotes = localStorage.getItem('lextgress_notes');

  const cases: any[] = rawCases ? JSON.parse(rawCases) : [];
  const notes: any[] = rawNotes ? JSON.parse(rawNotes) : [];

  const caseCount = cases.length;
  const noteCount = notes.filter((n: any) => !n.is_deleted).length;

  return {
    needed: caseCount > 0 || noteCount > 0,
    caseCount,
    noteCount,
    userId: user.id,
  };
}

export interface MigrationResult {
  cases: number;
  notes: number;
}

/** Upload all localStorage data to Supabase. Call after user confirms. */
export async function runDataMigration(): Promise<MigrationResult> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // ── Cases ──────────────────────────────────────────────────────────────
  const rawCases = localStorage.getItem('lextgress_cases');
  const cases: any[] = rawCases ? JSON.parse(rawCases) : [];

  if (cases.length > 0) {
    const { saveCasesArray } = await import('./supabaseCasesService');
    await saveCasesArray(cases);
  }

  // ── Notes ──────────────────────────────────────────────────────────────
  const rawNotes = localStorage.getItem('lextgress_notes');
  const notes: any[] = rawNotes ? JSON.parse(rawNotes).filter((n: any) => !n.is_deleted) : [];

  if (notes.length > 0) {
    const rows = notes.map((note: any) => ({ ...note, user_id: user.id }));
    // Batch insert — ignore conflicts (note may already exist from another device)
    await supabase.from('notes').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
  }

  // ── Search History ─────────────────────────────────────────────────────
  const rawHistory = localStorage.getItem('lextgress_search_history');
  if (rawHistory) {
    const history: any[] = JSON.parse(rawHistory);
    const rows = history.map((h: any) => ({
      user_id:      user.id,
      diary_number: h.diary_number,
      year:         h.year,
      searched_at:  h.searched_at,
    }));
    await supabase.from('search_history').upsert(rows, { ignoreDuplicates: true });
  }

  // ── Zustand settings ───────────────────────────────────────────────────
  const rawZustand = localStorage.getItem('lextigress-settings-storage');
  if (rawZustand) {
    const parsed = JSON.parse(rawZustand);
    const state = parsed?.state;
    if (state) {
      const { useSettingsStore, saveSettingsToSupabase } = await import('../store/settingsStore');
      useSettingsStore.setState({
        teamMembers:      state.teamMembers      || [],
        trainingExamples: state.trainingExamples || [],
        aiStats:          state.aiStats          || {},
        roles:            state.roles            || [],
      });
      await saveSettingsToSupabase();
    }
  }

  // Mark this browser as migrated — keep localStorage as read-only backup
  localStorage.setItem(MIGRATION_FLAG, user.id);

  return { cases: cases.length, notes: notes.length };
}

/** Mark migration as skipped without uploading. */
export async function skipMigration(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (user) localStorage.setItem(MIGRATION_FLAG, user.id);
}
