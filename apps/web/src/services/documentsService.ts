import { supabase } from '../lib/supabaseClient';
import type { Document } from '../types';

async function getTeamId(): Promise<string | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: ownedTeam } = await supabase
        .from('teams')
        .select('id')
        .eq('admin_user_id', user.id)
        .single();

    if (ownedTeam) return ownedTeam.id;

    const { data: profile } = await supabase
        .from('user_profiles')
        .select('team_id')
        .eq('id', user.id)
        .single();

    return profile?.team_id ?? null;
}

async function getUserId(): Promise<string | null> {
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? null;
}

export async function loadDocuments(caseId?: string): Promise<Document[]> {
    const teamId = await getTeamId();
    if (!teamId) return [];

    let query = supabase
        .from('documents')
        .select('*')
        .eq('team_id', teamId)
        .order('uploaded_at', { ascending: false });

    if (caseId) query = query.eq('case_id', caseId);

    const { data, error } = await query;
    if (error) { console.warn('[Supabase] loadDocuments failed', error); return []; }
    return (data || []) as Document[];
}

export async function addDocument(doc: {
    case_id?: string;
    name: string;
    type: string;
    url: string;
    size_bytes?: number;
    description?: string;
}): Promise<Document | null> {
    const [teamId, userId] = await Promise.all([getTeamId(), getUserId()]);
    if (!teamId || !userId) return null;

    const { data, error } = await supabase
        .from('documents')
        .insert({ ...doc, team_id: teamId, uploaded_by: userId })
        .select()
        .single();

    if (error) { console.warn('[Supabase] addDocument failed', error); return null; }
    return data as Document;
}

export async function deleteDocument(id: string): Promise<void> {
    const { error } = await supabase.from('documents').delete().eq('id', id);
    if (error) console.warn('[Supabase] deleteDocument failed', error);
}
