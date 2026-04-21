import { supabase } from '../lib/supabaseClient';
import type { Team, TeamMember, TeamMemberRole } from '../types';

const TEAM_EMAIL_DOMAIN = 'myjunior.com';

/** Generate email from name: "Priya Rajan" → "priya.rajan@myjunior.com" */
export function buildMemberEmail(fullName: string): string {
    const slug = fullName
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '.')
        .replace(/[^a-z0-9.]/g, '');
    return `${slug}@${TEAM_EMAIL_DOMAIN}`;
}

async function getAdminUserId(): Promise<string | null> {
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? null;
}

// ─── TEAM ─────────────────────────────────────────────────────────────────────

/** Get or create the team for the current admin. */
export async function getOrCreateTeam(teamName: string): Promise<Team | null> {
    const adminId = await getAdminUserId();
    if (!adminId) return null;

    // Check if team already exists
    const { data: existing } = await supabase
        .from('teams')
        .select('*')
        .eq('admin_user_id', adminId)
        .single();

    if (existing) return existing as Team;

    // Create new team
    const { data, error } = await supabase
        .from('teams')
        .insert({ name: teamName, admin_user_id: adminId })
        .select()
        .single();

    if (error) { console.error('[Supabase] getOrCreateTeam failed', error); return null; }

    // Link admin's user_profile to this team
    await supabase
        .from('user_profiles')
        .update({ team_id: data.id, role: 'Admin' })
        .eq('id', adminId);

    return data as Team;
}

export async function getMyTeam(): Promise<Team | null> {
    const adminId = await getAdminUserId();
    if (!adminId) return null;

    const { data } = await supabase
        .from('teams')
        .select('*')
        .eq('admin_user_id', adminId)
        .single();

    return (data as Team) ?? null;
}

// ─── TEAM MEMBERS ─────────────────────────────────────────────────────────────

export async function loadTeamMembers(): Promise<TeamMember[]> {
    const team = await getMyTeam();
    if (!team) return [];

    const { data, error } = await supabase
        .from('team_members')
        .select('*')
        .eq('team_id', team.id)
        .order('invited_at', { ascending: true });

    if (error) { console.warn('[Supabase] loadTeamMembers failed', error); return []; }
    return (data || []) as TeamMember[];
}

/**
 * Invite a new team member.
 * - Generates email as name@myjunior.com
 * - Creates a team_members row
 * - Sends Supabase invite email (requires service role key on backend)
 */
export async function inviteTeamMember(
    fullName: string,
    role: TeamMemberRole
): Promise<{ member: TeamMember; email: string } | null> {
    const team = await getMyTeam();
    if (!team) throw new Error('No team found. Please set up your team first.');

    const email = buildMemberEmail(fullName);

    // Insert into team_members
    const { data: member, error } = await supabase
        .from('team_members')
        .insert({
            team_id:   team.id,
            full_name: fullName,
            email,
            role,
        })
        .select()
        .single();

    if (error) {
        if (error.code === '23505') throw new Error(`${email} is already a team member.`);
        throw new Error(error.message);
    }

    // Send invite via backend (POST /api/invite)
    try {
        await fetch('/api/invite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, fullName, role, teamName: team.name }),
        });
    } catch (e) {
        console.warn('Invite email failed (backend may not be configured):', e);
    }

    return { member: member as TeamMember, email };
}

export async function removeTeamMember(memberId: string): Promise<void> {
    const { error } = await supabase
        .from('team_members')
        .delete()
        .eq('id', memberId);

    if (error) throw new Error(error.message);
}
