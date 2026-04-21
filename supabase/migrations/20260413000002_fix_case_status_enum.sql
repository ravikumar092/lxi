-- ============================================================
-- Migration: Fix case_status enum + apply previously pending changes
-- Date: 2026-04-13
-- ============================================================

-- ── 1. Fix case_status enum ────────────────────────────────
-- The app uses 'Fresh' and 'Disposed' as status values but the original
-- enum only had 'Pending', 'Active', 'Closed', 'Defective'.
-- Add the missing values so DB writes no longer fail.
ALTER TYPE case_status ADD VALUE IF NOT EXISTS 'Fresh';
ALTER TYPE case_status ADD VALUE IF NOT EXISTS 'Disposed';

-- ── 2. Add archived column to cases (idempotent) ───────────
ALTER TABLE cases ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_cases_archived ON cases (team_id, archived);

-- ── 3. Create AOR search history table (idempotent) ────────
CREATE TABLE IF NOT EXISTS user_aor_searches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  aor_name    TEXT NOT NULL,
  aor_code    TEXT,
  searched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_aor_searches ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_aor_searches'
      AND policyname = 'Users manage own AOR searches'
  ) THEN
    CREATE POLICY "Users manage own AOR searches"
      ON user_aor_searches FOR ALL
      USING (user_id = auth.uid());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_aor_searches_user_at
  ON user_aor_searches (user_id, searched_at DESC);
