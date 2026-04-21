import { Note } from '../types/notes';
import { syncNoteToSheet as doSyncNoteToSheet } from './sheetsService';
import { supabase } from '../lib/supabaseClient';

// Google Sheets secondary sync (optional, for teams that still want sheet backup)
const SHARED_SHEET_MODE = !!import.meta.env.VITE_SHARED_NOTES_SHEET_ID;
const SHARED_SHEET_ID = import.meta.env.VITE_SHARED_NOTES_SHEET_ID as string | undefined;
const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
const SHEET_RANGE = 'Sheet1!A:H';

// ── LOCAL STORAGE FALLBACK (used only during offline / pre-auth) ──────────────
const NOTES_STORAGE_KEY = 'lextgress_notes';

const getLocalNotes = (): Note[] => {
    try {
        const raw = localStorage.getItem(NOTES_STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
};

// ── SHARED SHEET HELPERS (kept as secondary sync option) ─────────────────────
const getSheetNotes = async (userId: string): Promise<Note[]> => {
    if (!SHARED_SHEET_MODE || !SHARED_SHEET_ID || !GOOGLE_API_KEY) return [];
    try {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHARED_SHEET_ID}/values/${SHEET_RANGE}?key=${GOOGLE_API_KEY}`;
        const response = await fetch(url);
        if (!response.ok) return [];
        const data = await response.json();
        const rows = data.values || [];
        if (rows.length < 2) return [];
        return rows.slice(1)
            .filter((row: any[]) => row[0] === userId && row[8] !== 'true')
            .map((row: any[]): Note => ({
                id: row[1], title: row[2], content: row[3],
                case_number: row[4] || null, case_name: null, linked_team_member: null,
                tags: row[5] ? row[5].split(',').map((t: string) => t.trim()) : [],
                created_at: row[6], created_by_id: userId, created_by_name: '',
                updated_by_id: null, updated_by_name: null, updated_at: row[7],
                is_deleted: false, deleted_at: null, source: 'sheet',
            }))
            .sort((a: Note, b: Note) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    } catch { return []; }
};

const saveNoteToSheet = async (noteData: Note, userId: string): Promise<boolean> => {
    if (!SHARED_SHEET_MODE || !SHARED_SHEET_ID || !GOOGLE_API_KEY) return false;
    try {
        const row = [userId, noteData.id, noteData.title, noteData.content,
            noteData.case_number || '', Array.isArray(noteData.tags) ? noteData.tags.join(',') : '',
            noteData.created_at, new Date().toISOString(), 'false'];
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHARED_SHEET_ID}/values/${SHEET_RANGE}:append?valueInputOption=USER_ENTERED&key=${GOOGLE_API_KEY}`;
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [row] }) });
        return res.ok;
    } catch { return false; }
};

// ── MAIN CRUD (Supabase primary) ──────────────────────────────────────────────

// Duplicated helper to avoid circular dependency
async function getTeamContext(): Promise<{ userId: string; teamId: string } | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: profile } = await supabase.from('user_profiles').select('team_id').eq('id', user.id).single();
    if (profile?.team_id) return { userId: user.id, teamId: profile.team_id };
    return null;
}

export const getNotes = async (): Promise<Note[]> => {
    const ctx = await getTeamContext();
    if (!ctx) {
        // Not authenticated yet — fall back to localStorage
        return getLocalNotes().filter(n => !n.is_deleted)
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }

    const { data, error } = await supabase
        .from('notes')
        .select('*')
        .eq('team_id', ctx.teamId)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false });

    if (error) {
        console.warn('[Supabase] getNotes failed, falling back to localStorage', error);
        return getLocalNotes().filter(n => !n.is_deleted);
    }
    return (data || []) as Note[];
};

export const getNoteById = async (id: string): Promise<Note | null> => {
    const ctx = await getTeamContext();
    if (!ctx) return getLocalNotes().find(n => n.id === id && !n.is_deleted) || null;

    const { data, error } = await supabase
        .from('notes')
        .select('*')
        .eq('team_id', ctx.teamId)
        .eq('id', id)
        .eq('is_deleted', false)
        .single();

    if (error) return null;
    return data as Note;
};

export const createNote = async (noteData: Note): Promise<Note> => {
    const ctx = await getTeamContext();
    if (!ctx) {
        // Offline fallback
        const notes = getLocalNotes();
        notes.push(noteData);
        localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
        return noteData;
    }

    const isUUID = (str: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
    const validCaseId = noteData.case_number && isUUID(noteData.case_number) ? noteData.case_number : null;

    const payload: any = {
        id: noteData.id,
        team_id: ctx.teamId,
        case_id: validCaseId,
        title: noteData.title,
        content: noteData.content,
        tags: noteData.tags,
        linked_member: noteData.linked_team_member,
        created_by: ctx.userId,
        created_at: noteData.created_at,
        updated_at: noteData.updated_at || new Date().toISOString(),
        
        // New fields for Voice Notes / Classification
        category: noteData.category || 'General',
        audio_url: noteData.audio_url || null,
        duration: noteData.duration || null,
        is_ai_processed: noteData.is_ai_processed || false,
        extracted_tasks: noteData.extracted_tasks || [],
        linked_case_ids: noteData.linked_case_ids || []
    };

    const { error } = await supabase
        .from('notes')
        .insert(payload);

    if (error) console.warn('[Supabase] createNote failed', error);

    // Secondary: sync to Google Sheet if configured
    if (SHARED_SHEET_MODE) saveNoteToSheet(noteData, ctx.userId);

    return noteData;
};

// ── VOICE & AI HELPERS ────────────────────────────────────────────────────────

/**
 * Sends audio blob to backend Whisper proxy.
 */
export async function transcribeAudio(audioBlob: Blob, language: string = 'en'): Promise<{ text: string; duration: number; language: string }> {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');
    formData.append('language', language);

    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
    const response = await fetch(`${backendUrl}/api/transcribe`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Transcription failed');
    }

    return response.json();
}

/**
 * Uploads audio to Supabase Storage.
 */
export async function uploadAudioNote(audioBlob: Blob, noteId: string): Promise<string | null> {
    const fileName = `${noteId}.webm`;
    const { data, error } = await supabase.storage
        .from('voice-notes')
        .upload(fileName, audioBlob, {
            contentType: 'audio/webm',
            upsert: true
        });

    if (error) {
        console.error('[Supabase Storage] Audio upload failed:', error);
        return null;
    }

    const { data: { publicUrl } } = supabase.storage
        .from('voice-notes')
        .getPublicUrl(fileName);

    return publicUrl;
}


export const updateNote = async (id: string, noteData: Partial<Note>): Promise<Note | null> => {
    const ctx = await getTeamContext();
    if (!ctx) {
        const notes = getLocalNotes();
        const idx = notes.findIndex(n => n.id === id);
        if (idx === -1) return null;
        notes[idx] = { ...notes[idx], ...noteData, updated_at: new Date().toISOString() };
        localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
        return notes[idx];
    }

    const updates = {
        title: noteData.title,
        content: noteData.content,
        tags: noteData.tags,
        linked_member: noteData.linked_team_member,
        updated_at: new Date().toISOString()
    };
    
    // Remove undefined fields
    Object.keys(updates).forEach(key => (updates as any)[key] === undefined && delete (updates as any)[key]);

    const { data, error } = await supabase
        .from('notes')
        .update(updates)
        .eq('team_id', ctx.teamId)
        .eq('id', id)
        .select()
        .single();

    if (error) { console.warn('[Supabase] updateNote failed', error); return null; }
    return data as Note;
};

export const deleteNote = async (id: string): Promise<boolean> => {
    const ctx = await getTeamContext();
    if (!ctx) {
        const notes = getLocalNotes();
        const idx = notes.findIndex(n => n.id === id);
        if (idx === -1) return false;
        notes[idx] = { ...notes[idx], is_deleted: true, deleted_at: new Date().toISOString() };
        localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
        return true;
    }

    const { error } = await supabase
        .from('notes')
        .update({ is_deleted: true, deleted_at: new Date().toISOString() })
        .eq('team_id', ctx.teamId)
        .eq('id', id);

    if (error) { console.warn('[Supabase] deleteNote failed', error); return false; }
    return true;
};

// ── SYNC MODE INFO FOR UI ─────────────────────────────────────────────────────
export function getNoteSyncStatus(): { mode: string; message: string; isSharedSheet: boolean; isConfigured: boolean } {
    if (SHARED_SHEET_MODE && SHARED_SHEET_ID && GOOGLE_API_KEY) {
        return {
            mode: 'supabase+sheet',
            message: 'Notes synced to cloud database and Google Sheet.',
            isSharedSheet: true,
            isConfigured: true,
        };
    }
    return {
        mode: 'supabase',
        message: 'Notes synced to your cloud account.',
        isSharedSheet: false,
        isConfigured: true,
    };
}

// Keep export for backwards compatibility (used by sheetsService callers)
export { doSyncNoteToSheet };
export type { Note };
export { getSheetNotes };

