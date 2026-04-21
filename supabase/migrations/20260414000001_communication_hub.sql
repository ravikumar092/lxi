-- Lex Tigress: Communication Hub & AI Intelligence Layer

-- 1. Clients Table
CREATE TABLE IF NOT EXISTS public.clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    whatsapp_number TEXT,
    email TEXT,
    preferences JSONB DEFAULT '{"channels": ["whatsapp"], "language": "auto"}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Update Cases to link to Client
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES public.clients(id);

-- 3. Communication History Table
CREATE TABLE IF NOT EXISTS public.communication_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID REFERENCES public.cases(id) ON DELETE SET NULL,
    client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
    channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'email', 'in-app')),
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('queued', 'pending_approval', 'sent', 'delivered', 'read', 'failed')),
    metadata JSONB DEFAULT '{}'::jsonb, -- Stores binary tracking, AI summaries, etc.
    ai_extracted_tasks JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Communication Templates
CREATE TABLE IF NOT EXISTS public.communication_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT UNIQUE NOT NULL, -- 'missing_doc', 'hearing_update', etc.
    template_text TEXT NOT NULL,
    variables JSONB DEFAULT '[]'::jsonb,
    is_auto_approve BOOLEAN DEFAULT true
);

-- 5. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_comm_history_case ON public.communication_history(case_id);
CREATE INDEX IF NOT EXISTS idx_comm_history_client ON public.communication_history(client_id);
CREATE INDEX IF NOT EXISTS idx_clients_team ON public.clients(team_id);

-- Enable RLS
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_templates ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Teams can view their own clients" ON public.clients
    FOR ALL USING (team_id IN (SELECT id FROM public.teams WHERE admin_user_id = auth.uid() OR id IN (SELECT team_id FROM public.user_profiles WHERE id = auth.uid())));

CREATE POLICY "Teams can view their own communication history" ON public.communication_history
    FOR ALL USING (team_id IN (SELECT id FROM public.teams WHERE admin_user_id = auth.uid() OR id IN (SELECT team_id FROM public.user_profiles WHERE id = auth.uid())));

-- Helper Function to refresh updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
