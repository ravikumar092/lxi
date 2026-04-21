/**
 * Lex Tigress – Supabase Cases Service
 * Works with the `cases` table created in migration 20260403000001_platform_foundation.sql
 * All cases are scoped to a team_id.
 */

import { supabase } from '../lib/supabaseClient';
import type { NewCaseData } from '../components/Cases/CaseCreateModal';
import { CaseStatus } from '../types';

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getTeamId(): Promise<string | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    // Admin: team they own
    const { data: ownedTeam } = await supabase
        .from('teams')
        .select('id')
        .eq('admin_user_id', user.id)
        .single();

    if (ownedTeam) return ownedTeam.id;

    // Member: team they belong to
    const { data: profile } = await supabase
        .from('user_profiles')
        .select('team_id')
        .eq('id', user.id)
        .single();

    return profile?.team_id ?? null;
}

async function getUserId(): Promise<string | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: profile } = await supabase
        .from('user_profiles')
        .select('team_id')
        .eq('id', user.id)
        .single();
    
    let teamId = profile?.team_id;

    // Auto-provision a personal team if none exists (MVP bridge)
    if (!teamId) {
        const { data: newTeam, error } = await supabase
            .from('teams')
            .insert({ name: 'Personal Workspace', admin_user_id: user.id })
            .select('id')
            .single();
        if (newTeam) {
            teamId = newTeam.id;
            await supabase.from('user_profiles').update({ team_id: teamId }).eq('id', user.id);
        }
    }
    return user.id;
}

/** Extract the indexable columns from a case object; store the full object in case_data. */
function toRow(caseData: any, teamId: string, userId: string) {
    return {
        // Include id only when it is a real Supabase UUID so upsert-by-id works.
        // Client-side ids (e.g. "case-<timestamp>-<random>") are intentionally omitted
        // so Supabase auto-generates a fresh UUID on insert.
        ...(UUID_RE.test(caseData.id || '') ? { id: caseData.id } : {}),
        team_id:           teamId,
        created_by:        userId,
        diary_no:          caseData.diaryNumber || caseData.diaryNo || '',
        diary_year:        caseData.diaryYear   || '',
        cnr:               caseData.cnrNumber   || null,
        case_number:       caseData.caseNumber  || '',
        parties:           caseData.parties     || '',
        petitioner:        caseData.petitioner  || null,
        respondent:        caseData.respondent  || null,
        display_title:     caseData.displayTitle || null,
        status:            caseData.status      || 'Pending',
        court_no:          caseData.courtNumber || caseData.courtNo || null,
        judge:             Array.isArray(caseData.lastListedJudges) ? caseData.lastListedJudges.join(', ') : caseData.judge || null,
        last_listed_on:    caseData.lastListedOn || null,
        process_id:        caseData.processId || null,
        // Promote `archived` to a first-class column so it is queryable at DB level
        archived:          caseData.archived ?? false,
        case_data:         caseData,
    };
}

/** Convert a Supabase row to the app's case shape. */
function rowToCase(row: any): any {
    return {
        // Inherit JSONB schema first
        ...(row.case_data || {}),
        
        // Database top-level columns take precedence
        id: row.id,
        diaryNo: row.diary_no,
        diaryYear: row.diary_year,
        caseNumber: row.case_number || '',
        parties: row.parties || '',
        petitioner: row.petitioner || '',
        respondent: row.respondent || '',
        displayTitle: row.display_title || '',
        status: row.status as CaseStatus,
        courtNo: row.court_no || '',
        judge: row.judge || '',
        lastListedOn: row.last_listed_on || '',
        processId: row.process_id || '',
        cnr: row.cnr || '',
        team_id: row.team_id,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
        
        // `archived` is a first-class DB column — use it directly (fall back to JSONB value for
        // legacy rows created before the column was added).
        archived: row.archived ?? row.case_data?.archived ?? false,

        // Legacy compat
        diaryNumber: row.diary_no,
    };
}


// ─── LOAD ─────────────────────────────────────────────────────────────────────

/** Load all cases for the current team. Returns [] on error. */
export async function loadCases(): Promise<any[]> {
    const teamId = await getTeamId();
    if (!teamId) return [];

    const { data, error } = await supabase
        .from('cases')
        .select('*')
        .eq('team_id', teamId)
        .order('created_at', { ascending: false });

    if (error) { console.warn('[Supabase] loadCases failed', error); return []; }

    return (data || []).map(rowToCase);
}

// ─── CREATE ───────────────────────────────────────────────────────────────────

/** Create a new case from the CaseCreateModal form data. */
export async function createCase(data: NewCaseData): Promise<any | null> {
    const [teamId, userId] = await Promise.all([getTeamId(), getUserId()]);
    if (!teamId || !userId) {
        throw new Error('You must belong to a team to create a case.');
    }

    const { data: row, error } = await supabase
        .from('cases')
        .insert({
            team_id:    teamId,
            created_by: userId,
            diary_no:   data.diary_no.trim(),
            diary_year: data.diary_year.trim(),
            case_number: data.case_number.trim(),
            parties:    data.parties.trim(),
            petitioner: data.petitioner.trim(),
            respondent: data.respondent.trim(),
            status:     data.status,
            court_no:   data.court_no.trim(),
            judge:      data.judge.trim(),
            case_data:  {},
        })
        .select()
        .single();

    if (error) throw new Error(error.message);
    return rowToCase(row);
}

// ─── UPDATE ───────────────────────────────────────────────────────────────────

/** Update an existing case by UUID. */
export async function updateCaseById(id: string, data: NewCaseData): Promise<void> {
    const { error } = await supabase
        .from('cases')
        .update({
            diary_no:    data.diary_no.trim(),
            diary_year:  data.diary_year.trim(),
            case_number: data.case_number.trim(),
            parties:     data.parties.trim(),
            petitioner:  data.petitioner.trim(),
            respondent:  data.respondent.trim(),
            status:      data.status,
            court_no:    data.court_no.trim(),
            judge:       data.judge.trim(),
        })
        .eq('id', id);

    if (error) throw new Error(error.message);
}

/** Update specific fields of a case (e.g. after SC API refresh). */
export async function patchCase(id: string, patch: Record<string, any>): Promise<void> {
    const { error } = await supabase
        .from('cases')
        .update(patch)
        .eq('id', id);

    if (error) console.warn('[Supabase] patchCase failed', error);
}

// ─── ARCHIVE / DELETE ────────────────────────────────────────────────────────

/**
 * Soft-delete a case by UUID — sets `archived = true` so the case moves to the
 * Archive view instead of being permanently removed from the database.
 * Use `hardDeleteCaseById` for a true permanent removal.
 */
export async function deleteCaseById(id: string): Promise<void> {
    const { error } = await supabase
        .from('cases')
        .update({ archived: true })
        .eq('id', id);

    if (error) throw new Error(error.message);
}

/**
 * Toggle the `archived` flag on a case.
 * Pass `archived = true` to archive, `false` to restore.
 */
export async function archiveCaseById(id: string, archived: boolean): Promise<void> {
    const { error } = await supabase
        .from('cases')
        .update({ archived })
        .eq('id', id);

    if (error) console.warn('[Supabase] archiveCaseById failed', error);
}

/**
 * Permanently remove a case by UUID from the database.
 * Should only be called from an explicit "Delete Forever" action in the Archive view.
 */
export async function hardDeleteCaseById(id: string): Promise<void> {
    const { error } = await supabase
        .from('cases')
        .delete()
        .eq('id', id);

    if (error) throw new Error(error.message);
}

// ─── LEGACY COMPAT (used by CourtSync for localStorage migration) ─────────────

/**
 * Upsert a case from localStorage migration.
 * Maps old field names to new schema.
 */
export async function saveCase(caseData: any): Promise<void> {
    const [teamId, userId] = await Promise.all([getTeamId(), getUserId()]);
    if (!teamId || !userId) return;

    const row = toRow(caseData, teamId, userId);

    const { error } = await supabase
        .from('cases')
        .upsert(row, { onConflict: 'team_id,diary_no,diary_year' });

    if (error) console.warn('[Supabase] saveCase failed', error);
}

/** Persist the whole cases array at once (called from CourtSync's debounced effect). */
export async function saveCasesArray(cases: any[]): Promise<boolean> {
    const [teamId, userId] = await Promise.all([getTeamId(), getUserId()]);
    if (!teamId || !userId) return false;

    // Split into two groups so each batch uses the right conflict target.
    // Cases that already have a Supabase UUID → upsert by id (most reliable).
    // New cases without a UUID but with a diary number → upsert by (team_id, diary_no, diary_year).
    // Cases with neither are skipped here; they get persisted via saveCaseReturningRow on add.
    const withUuid  = cases.filter(c => UUID_RE.test(c.id || ''));
    const withDiary = cases.filter(c => !UUID_RE.test(c.id || '') && (c.diaryNumber || c.diaryNo));

    let ok = true;

    if (withUuid.length > 0) {
        const rows = withUuid.map(c => toRow(c, teamId, userId));
        const { error } = await supabase.from('cases').upsert(rows, { onConflict: 'id' });
        if (error) { console.warn('[Supabase] saveCasesArray (by id) failed', error); ok = false; }
    }

    if (withDiary.length > 0) {
        const rows = withDiary.map(c => toRow(c, teamId, userId));
        const { error } = await supabase.from('cases').upsert(rows, { onConflict: 'team_id,diary_no,diary_year' });
        if (error) { console.warn('[Supabase] saveCasesArray (by diary) failed', error); ok = false; }
    }

    return ok;
}

/**
 * Immediately save a single case to Supabase and return the persisted row
 * (with the authoritative Supabase UUID as `id`).
 * Use this when adding a case from search so the state gets the real UUID right away.
 */
export async function saveCaseReturningRow(caseData: any): Promise<any | null> {
    const [teamId, userId] = await Promise.all([getTeamId(), getUserId()]);
    if (!teamId || !userId) return null;

    const row = toRow(caseData, teamId, userId);

    // Case already has a Supabase UUID → upsert by id
    if (UUID_RE.test(caseData.id || '')) {
        const { data, error } = await supabase
            .from('cases')
            .upsert(row, { onConflict: 'id' })
            .select()
            .single();
        if (error) { console.warn('[Supabase] saveCaseReturningRow (by id) failed', error); return null; }
        return rowToCase(data);
    }

    // Has a diary number → upsert by (team_id, diary_no, diary_year)
    if (row.diary_no && row.diary_year) {
        const { data, error } = await supabase
            .from('cases')
            .upsert(row, { onConflict: 'team_id,diary_no,diary_year' })
            .select()
            .single();
        if (error) { console.warn('[Supabase] saveCaseReturningRow (by diary) failed', error); return null; }
        return rowToCase(data);
    }

    // No UUID and no diary number (e.g. AOR result with non-standard CNR) → plain insert
    const { data, error } = await supabase
        .from('cases')
        .insert(row)
        .select()
        .single();
    if (error) { console.warn('[Supabase] saveCaseReturningRow (insert) failed', error); return null; }
    return rowToCase(data);
}

/** Legacy update by diary number (used by SC API refresh flow). */
export async function updateCase(diaryNumber: string, diaryYear: string, freshData: any): Promise<void> {
    const [teamId, userId] = await Promise.all([getTeamId(), getUserId()]);
    if (!teamId || !userId) return;

    // By passing freshData into toRow, it puts freshData in case_data alongside updating top columns.
    const row = toRow(freshData, teamId, userId);

    const { error } = await supabase
        .from('cases')
        .upsert(row, { onConflict: 'team_id,diary_no,diary_year' });

    if (error) console.warn('[Supabase] updateCase failed', error);
}

/**
 * Legacy soft-delete by diary number — archives the case instead of erasing it.
 * Use `hardDeleteCase` for a true permanent removal.
 */
export async function deleteCase(diaryNumber: string, diaryYear: string): Promise<void> {
    const teamId = await getTeamId();
    if (!teamId) return;

    const { error } = await supabase
        .from('cases')
        .update({ archived: true })
        .eq('team_id', teamId)
        .eq('diary_no', diaryNumber)
        .eq('diary_year', diaryYear);

    if (error) console.warn('[Supabase] deleteCase (soft) failed', error);
}

/** Permanently remove a case by diary number. */
export async function hardDeleteCase(diaryNumber: string, diaryYear: string): Promise<void> {
    const teamId = await getTeamId();
    if (!teamId) return;

    const { error } = await supabase
        .from('cases')
        .delete()
        .eq('team_id', teamId)
        .eq('diary_no', diaryNumber)
        .eq('diary_year', diaryYear);

    if (error) console.warn('[Supabase] hardDeleteCase failed', error);
}
