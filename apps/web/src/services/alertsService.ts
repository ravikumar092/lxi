import { supabase } from '../lib/supabaseClient';
import type { Alert, AlertType } from '../types';

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

/** Load all unread alerts for the current user. */
export async function loadUnreadAlerts(): Promise<Alert[]> {
    const userId = await getUserId();
    if (!userId) return [];

    const { data, error } = await supabase
        .from('alerts')
        .select('*')
        .eq('user_id', userId)
        .is('read_at', null)
        .order('created_at', { ascending: false });

    if (error) { console.warn('[Supabase] loadUnreadAlerts failed', error); return []; }
    return (data || []) as Alert[];
}

/** Load all alerts (read + unread) for current user. */
export async function loadAlerts(): Promise<Alert[]> {
    const userId = await getUserId();
    if (!userId) return [];

    const { data, error } = await supabase
        .from('alerts')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);

    if (error) { console.warn('[Supabase] loadAlerts failed', error); return []; }
    return (data || []) as Alert[];
}

/** Count of unread alerts for badge display. */
export async function getUnreadCount(): Promise<number> {
    const userId = await getUserId();
    if (!userId) return 0;

    const { count, error } = await supabase
        .from('alerts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('read_at', null);

    if (error) return 0;
    return count ?? 0;
}

/** Mark a single alert as read. */
export async function markAlertRead(id: string): Promise<void> {
    const { error } = await supabase
        .from('alerts')
        .update({ read_at: new Date().toISOString() })
        .eq('id', id);

    if (error) console.warn('[Supabase] markAlertRead failed', error);
}

/** Mark all alerts for current user as read. */
export async function markAllAlertsRead(): Promise<void> {
    const userId = await getUserId();
    if (!userId) return;

    const { error } = await supabase
        .from('alerts')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', userId)
        .is('read_at', null);

    if (error) console.warn('[Supabase] markAllAlertsRead failed', error);
}

/** Create a new alert for a user. */
export async function createAlert(alert: {
    user_id: string;
    case_id?: string;
    type: AlertType;
    message: string;
}): Promise<void> {
    const teamId = await getTeamId();
    if (!teamId) return;

    const { error } = await supabase
        .from('alerts')
        .insert({ ...alert, team_id: teamId });

    if (error) console.warn('[Supabase] createAlert failed', error);
}
