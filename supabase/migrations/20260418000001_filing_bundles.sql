-- Lex Tigress: Filing Bundle Generator
-- Feature: Auto Collating Documents for Filing (Paper Book Generator)

-- 1. Filing Bundles Table
CREATE TABLE IF NOT EXISTS public.filing_bundles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,

    -- Bundle type and status
    bundle_type TEXT NOT NULL DEFAULT 'master' CHECK (bundle_type IN ('master', 'court')),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final')),

    -- Document arrangement
    structure_rule TEXT NOT NULL DEFAULT 'supreme_court' CHECK (structure_rule IN ('supreme_court', 'chronological', 'custom')),
    document_list JSONB DEFAULT '[]'::jsonb,       -- Ordered array of BundleDocumentEntry
    missing_documents JSONB DEFAULT '[]'::jsonb,   -- List of absent required docs (DocumentRequirement refs)

    -- Bates / page numbering config
    bates_prefix TEXT DEFAULT '',                  -- e.g. "SLP2024" → produces SLP2024_0001
    bates_start_number INTEGER DEFAULT 1,
    page_number_start INTEGER DEFAULT 1,

    -- Generation metadata
    generated_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    generated_at TIMESTAMPTZ,
    download_url TEXT,                             -- Supabase Storage URL for final PDF
    file_name TEXT,                                -- Auto-named: SLP_PaperBook_Final.pdf

    -- Version tracking
    version INTEGER NOT NULL DEFAULT 1,
    version_history JSONB DEFAULT '[]'::jsonb,     -- Snapshots: [{version, download_url, generated_at, generated_by}]

    -- Permissions: associates allowed to generate/edit
    associate_permission BOOLEAN DEFAULT false,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Bundle Documents Table (individual document slots in a bundle)
CREATE TABLE IF NOT EXISTS public.bundle_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bundle_id UUID NOT NULL REFERENCES public.filing_bundles(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,

    -- Source document reference (one of these will be set)
    document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,   -- Supabase uploaded doc
    source_type TEXT NOT NULL CHECK (source_type IN (
        'uploaded',       -- Direct upload
        'whatsapp',       -- Received via WhatsApp
        'email',          -- Received via Email
        'ai_detected',    -- Flagged by missing doc AI
        'court_order',    -- From eCourts API
        'office_report',  -- From SC office report
        'linked_case'     -- Previously linked case document
    )),
    source_ref TEXT,       -- External reference (e.g. eCourts order ID, communication_history.id)

    -- Bundle position & labelling
    position INTEGER NOT NULL DEFAULT 0,           -- Drag-drop order index
    section_label TEXT,                            -- e.g. "Court Orders", "Petitioner Docs"
    document_name TEXT NOT NULL,

    -- Pagination
    page_start INTEGER,
    page_end INTEGER,
    bates_start TEXT,                              -- e.g. "SLP2024_0001"
    bates_end TEXT,                                -- e.g. "SLP2024_0025"

    -- Placeholder for missing documents
    is_placeholder BOOLEAN DEFAULT false,          -- true = doc not yet received
    placeholder_reason TEXT,                       -- Why it is missing

    -- OCR-extracted bookmark anchor
    bookmark_label TEXT,                           -- Extracted from page title OCR or heading
    bookmark_page INTEGER,

    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_filing_bundles_case ON public.filing_bundles(case_id);
CREATE INDEX IF NOT EXISTS idx_filing_bundles_team ON public.filing_bundles(team_id);
CREATE INDEX IF NOT EXISTS idx_bundle_docs_bundle ON public.bundle_documents(bundle_id);
CREATE INDEX IF NOT EXISTS idx_bundle_docs_position ON public.bundle_documents(bundle_id, position);

-- 4. Enable RLS
ALTER TABLE public.filing_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bundle_documents ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies (team-scoped, same pattern as rest of platform)
CREATE POLICY "Teams can manage their own filing bundles"
    ON public.filing_bundles
    FOR ALL
    USING (
        team_id IN (
            SELECT id FROM public.teams WHERE admin_user_id = auth.uid()
            UNION
            SELECT team_id FROM public.user_profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "Teams can manage their own bundle documents"
    ON public.bundle_documents
    FOR ALL
    USING (
        team_id IN (
            SELECT id FROM public.teams WHERE admin_user_id = auth.uid()
            UNION
            SELECT team_id FROM public.user_profiles WHERE id = auth.uid()
        )
    );

-- 6. Auto-update updated_at trigger
CREATE TRIGGER update_filing_bundles_updated_at
    BEFORE UPDATE ON public.filing_bundles
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
