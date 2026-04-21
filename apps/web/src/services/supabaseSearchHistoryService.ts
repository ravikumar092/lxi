/**
 * Lex Tigress – AOR Search History Service
 *
 * Persists the user's recent Advocate-on-Record (AOR) searches to Supabase
 * so the history survives logout/login cycles (replacing the old localStorage approach).
 *
 * Table: user_aor_searches
 *   id          UUID
 *   user_id     UUID  (auth.users.id)
 *   aor_name    TEXT
 *   aor_code    TEXT  (optional SC CC code)
 *   searched_at TIMESTAMPTZ
 */

import { supabase } from '../lib/supabaseClient';

export interface AorSearchEntry {
    id: string;
    aorName: string;
    aorCode?: string;
    searchedAt: string;
}

/** Max number of recent entries to keep per user. */
const MAX_HISTORY = 10;

/**
 * Save an AOR search to the user's persistent history.
 * De-duplicates by name — if the same AOR was searched before, updates the timestamp.
 */
export async function saveAorSearch(aorName: string, aorCode?: string): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;  // Not logged in — silently skip

    const trimmedName = aorName.trim();
    if (!trimmedName) return;

    // Upsert strategy: delete old entry with same name, insert fresh with new timestamp
    await supabase
        .from('user_aor_searches')
        .delete()
        .eq('user_id', user.id)
        .ilike('aor_name', trimmedName);

    await supabase
        .from('user_aor_searches')
        .insert({
            user_id:     user.id,
            aor_name:    trimmedName,
            aor_code:    aorCode ?? null,
            searched_at: new Date().toISOString(),
        });

    // Prune oldest entries beyond MAX_HISTORY
    const { data: all } = await supabase
        .from('user_aor_searches')
        .select('id, searched_at')
        .eq('user_id', user.id)
        .order('searched_at', { ascending: false });

    if (all && all.length > MAX_HISTORY) {
        const toDelete = all.slice(MAX_HISTORY).map((r: any) => r.id);
        await supabase.from('user_aor_searches').delete().in('id', toDelete);
    }
}

/**
 * Load the user's most recent AOR searches (newest first).
 * Returns [] if not logged in or on any error.
 */
export async function loadAorSearchHistory(): Promise<AorSearchEntry[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
        .from('user_aor_searches')
        .select('id, aor_name, aor_code, searched_at')
        .eq('user_id', user.id)
        .order('searched_at', { ascending: false })
        .limit(MAX_HISTORY);

    if (error) {
        console.warn('[Supabase] loadAorSearchHistory failed', error);
        return [];
    }

    return (data || []).map((r: any) => ({
        id:         r.id,
        aorName:    r.aor_name,
        aorCode:    r.aor_code ?? undefined,
        searchedAt: r.searched_at,
    }));
}
