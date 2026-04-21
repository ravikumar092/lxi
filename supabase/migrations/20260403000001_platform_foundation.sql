-- ============================================================
-- Platform Foundation: Phase 1
-- Tables: teams, team_members, user_profiles, cases, tasks,
--         documents, notes, alerts
-- All roles have full access (permissions added in later phase)
-- ============================================================

-- ─── ENUMS ──────────────────────────────────────────────────

CREATE TYPE team_member_role AS ENUM (
  'Admin',
  'Associate Advocate',
  'Clerk'
);

CREATE TYPE case_status AS ENUM (
  'Pending',
  'Active',
  'Closed',
  'Defective'
);

CREATE TYPE task_status AS ENUM (
  'Open',
  'In Progress',
  'Completed',
  'Delayed',
  'Missed'
);

CREATE TYPE task_priority AS ENUM (
  'High',
  'Medium',
  'Low'
);

CREATE TYPE alert_type AS ENUM (
  'hearing',
  'deadline',
  'service',
  'system'
);

-- ─── TEAMS ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS teams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  admin_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

-- Team members can view their own team; admin can do anything
CREATE POLICY "Team members can view their team"
  ON teams FOR SELECT
  USING (
    admin_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.team_id = teams.id AND tm.user_id = auth.uid()
    )
  );

CREATE POLICY "Admin can manage their team"
  ON teams FOR ALL
  USING (admin_user_id = auth.uid());

-- ─── TEAM MEMBERS ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS team_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  role        team_member_role NOT NULL DEFAULT 'Associate Advocate',
  full_name   TEXT NOT NULL,
  email       TEXT NOT NULL,
  invited_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  joined_at   TIMESTAMPTZ,
  UNIQUE (team_id, email)
);

ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team members visible to same team"
  ON team_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM teams t
      WHERE t.id = team_members.team_id
        AND (
          t.admin_user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM team_members tm2
            WHERE tm2.team_id = t.id AND tm2.user_id = auth.uid()
          )
        )
    )
  );

CREATE POLICY "Admin can manage team members"
  ON team_members FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM teams t
      WHERE t.id = team_members.team_id AND t.admin_user_id = auth.uid()
    )
  );

-- ─── USER PROFILES ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id       UUID REFERENCES teams(id) ON DELETE SET NULL,
  role          team_member_role NOT NULL DEFAULT 'Admin',
  full_name     TEXT NOT NULL DEFAULT '',
  email         TEXT NOT NULL DEFAULT '',
  phone         TEXT,
  specialization TEXT,
  search_limit  INTEGER NOT NULL DEFAULT 50,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view profiles in same team"
  ON user_profiles FOR SELECT
  USING (
    id = auth.uid()
    OR team_id IN (
      SELECT team_id FROM user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  USING (id = auth.uid());

CREATE POLICY "Users can insert own profile"
  ON user_profiles FOR INSERT
  WITH CHECK (id = auth.uid());

-- ─── AUTO-CREATE USER PROFILE ON SIGNUP ─────────────────────

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO user_profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    'Admin'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ─── CASES ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cases (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  diary_no      TEXT NOT NULL,
  diary_year    TEXT NOT NULL,
  case_number   TEXT NOT NULL DEFAULT '',
  parties       TEXT NOT NULL DEFAULT '',
  petitioner    TEXT,
  respondent    TEXT,
  display_title TEXT,
  status        case_status NOT NULL DEFAULT 'Pending',
  court_no      TEXT,
  judge         TEXT,
  last_listed_on TEXT,
  process_id    TEXT,
  cnr           TEXT,
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, diary_no, diary_year)
);

ALTER TABLE cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team members can access their cases"
  ON cases FOR ALL
  USING (
    team_id IN (
      SELECT team_id FROM user_profiles WHERE id = auth.uid()
      UNION
      SELECT id FROM teams WHERE admin_user_id = auth.uid()
    )
  );

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER cases_updated_at
  BEFORE UPDATE ON cases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── TASKS ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tasks (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id                  UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  case_id                  UUID REFERENCES cases(id) ON DELETE SET NULL,
  title                    TEXT NOT NULL,
  description              TEXT NOT NULL DEFAULT '',
  deadline                 TIMESTAMPTZ,
  priority                 task_priority NOT NULL DEFAULT 'Medium',
  status                   task_status NOT NULL DEFAULT 'Open',
  responsible_associate_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  category                 TEXT,
  reason_for_delay         TEXT,
  is_auto                  BOOLEAN NOT NULL DEFAULT false,
  created_by               UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team members can access their tasks"
  ON tasks FOR ALL
  USING (
    team_id IN (
      SELECT team_id FROM user_profiles WHERE id = auth.uid()
      UNION
      SELECT id FROM teams WHERE admin_user_id = auth.uid()
    )
  );

CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── DOCUMENTS ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  case_id     UUID REFERENCES cases(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'other',
  url         TEXT NOT NULL DEFAULT '',
  size_bytes  BIGINT,
  description TEXT,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team members can access their documents"
  ON documents FOR ALL
  USING (
    team_id IN (
      SELECT team_id FROM user_profiles WHERE id = auth.uid()
      UNION
      SELECT id FROM teams WHERE admin_user_id = auth.uid()
    )
  );

-- ─── NOTES ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  case_id         UUID REFERENCES cases(id) ON DELETE SET NULL,
  title           TEXT NOT NULL DEFAULT '',
  content         TEXT NOT NULL DEFAULT '',
  tags            TEXT[] NOT NULL DEFAULT '{}',
  linked_member   TEXT,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name TEXT NOT NULL DEFAULT '',
  updated_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by_name TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_deleted      BOOLEAN NOT NULL DEFAULT false,
  deleted_at      TIMESTAMPTZ
);

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team members can access their notes"
  ON notes FOR ALL
  USING (
    team_id IN (
      SELECT team_id FROM user_profiles WHERE id = auth.uid()
      UNION
      SELECT id FROM teams WHERE admin_user_id = auth.uid()
    )
  );

CREATE TRIGGER notes_updated_at
  BEFORE UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── ALERTS ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alerts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  case_id    UUID REFERENCES cases(id) ON DELETE SET NULL,
  type       alert_type NOT NULL DEFAULT 'system',
  message    TEXT NOT NULL,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own alerts"
  ON alerts FOR SELECT
  USING (user_id = auth.uid() OR team_id IN (
    SELECT id FROM teams WHERE admin_user_id = auth.uid()
  ));

CREATE POLICY "Users can mark their alerts as read"
  ON alerts FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Team can insert alerts"
  ON alerts FOR INSERT
  WITH CHECK (
    team_id IN (
      SELECT team_id FROM user_profiles WHERE id = auth.uid()
      UNION
      SELECT id FROM teams WHERE admin_user_id = auth.uid()
    )
  );

-- ─── INDEXES ────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_cases_team_id ON cases(team_id);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
CREATE INDEX IF NOT EXISTS idx_tasks_team_id ON tasks(team_id);
CREATE INDEX IF NOT EXISTS idx_tasks_case_id ON tasks(case_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_documents_case_id ON documents(case_id);
CREATE INDEX IF NOT EXISTS idx_notes_case_id ON notes(case_id);
CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_read_at ON alerts(read_at);
CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members(user_id);
