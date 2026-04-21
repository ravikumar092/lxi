-- ============================================================
-- Migration: AOR Search History + Cases Archived Column
-- Date: 2026-04-13
-- ============================================================

-- Add top-level `archived` column to cases table.
-- Previously, `archived` was stored only inside the case_data JSONB blob,
-- making it un-queryable at the DB level. This promotes it to a first-class column.
ALTER TABLE cases ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false;

-- Index for fast filtering of active vs archived cases
CREATE INDEX IF NOT EXISTS idx_cases_archived ON cases (team_id, archived);

-- ── AOR Search History ──────────────────────────────────────────────────────

-- Stores recent AOR (Advocate-on-Record) searches per user so that search
-- history persists across login sessions, replacing the previous localStorage approach.
CREATE TABLE IF NOT EXISTS user_aor_searches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  aor_name    TEXT NOT NULL,
  aor_code    TEXT,            -- optional SC AOR code / CC code
  searched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_aor_searches ENABLE ROW LEVEL SECURITY;

-- Users can only see and modify their own search history
CREATE POLICY "Users manage own AOR searches"
  ON user_aor_searches FOR ALL
  USING (user_id = auth.uid());

-- Index to quickly fetch the latest searches per user
CREATE INDEX IF NOT EXISTS idx_user_aor_searches_user_at
  ON user_aor_searches (user_id, searched_at DESC);
