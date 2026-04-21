import axios from 'axios';
import { Note } from '../types/notes';
import { getGoogleSession, getSheetIdForUser, setSheetIdForUser } from './authService';

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3/files';

const getFirstName = (fullName: string | null) => {
    return (fullName || "User").split(" ")[0];
};

export const findOrCreateNotesSheet = async (): Promise<string | null> => {
    const session = getGoogleSession();
    if (!session || session.isExpired) return null;

    const email = session.email;
    if (!email) return null;
    const existingId = getSheetIdForUser(email);
    if (existingId) return existingId;

    const firstName = getFirstName(session.name);
    const sheetName = `Lex Tigress — Legal Notes — ${firstName}`;

    try {
        // 1. Search for existing sheet in Drive (scoped to app-created files or all depending on user selection)
        const searchRes = await axios.get(DRIVE_API_BASE, {
            params: {
                q: `name='${sheetName}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
                fields: 'files(id, name)',
            },
            headers: { Authorization: `Bearer ${session.token}` }
        });

        if (searchRes.data.files && searchRes.data.files.length > 0) {
            const id = searchRes.data.files[0].id;
            setSheetIdForUser(email, id);
            return id;
        }

        // 2. Create if not found
        const createRes = await axios.post(SHEETS_API_BASE, {
            properties: { title: sheetName },
        }, {
            headers: { Authorization: `Bearer ${session.token}` }
        });

        const newId = createRes.data.spreadsheetId;

        // 3. Initialize header row
        const headers = [['#', 'Case Number', 'Case Name', 'Title', 'Content', 'Tags', 'Created By', 'Created At', 'Updated At', 'Source', 'UUID']];
        await axios.put(`${SHEETS_API_BASE}/${newId}/values/Sheet1!A1:K1?valueInputOption=USER_ENTERED`, {
            values: headers
        }, {
            headers: { Authorization: `Bearer ${session.token}` }
        });

        setSheetIdForUser(email, newId);
        return newId;
    } catch (err) {
        console.error("Error finding/creating sheet", err);
        return null;
    }
};

const getRowCount = async (token: string, sheetId: string): Promise<number> => {
    try {
        const res = await axios.get(`${SHEETS_API_BASE}/${sheetId}/values/Sheet1!A:A`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const rows = res.data.values || [];
        return rows.length; // Includes header, so first note will be row 2, ID 1
    } catch (err) {
        return 1; // Fallback
    }
};

export const syncNoteToSheet = async (note: Note): Promise<boolean> => {
    const session = getGoogleSession();
    if (!session || session.isExpired) return false;

    const sheetId = await findOrCreateNotesSheet();
    if (!sheetId) return false;

    try {
        const rowCount = await getRowCount(session.token, sheetId);

        const row = [
            rowCount, // Sequential ID
            note.case_number || 'N/A',
            note.case_name || 'N/A',
            note.title,
            note.content,
            note.tags.join(', '),
            note.created_by_name,
            note.created_at,
            note.updated_at || '',
            note.source,
            note.id // UUID in last column
        ];

        // Append to the sheet
        await axios.post(`${SHEETS_API_BASE}/${sheetId}/values/Sheet1!A:K:append?valueInputOption=USER_ENTERED`, {
            values: [row]
        }, {
            headers: { Authorization: `Bearer ${session.token}` }
        });

        return true;
    } catch (err) {
        console.error("Sync error:", err);
        return false;
    }
};

export const openMySheet = async () => {
    const session = getGoogleSession();
    if (!session || !session.email) return;
    const sheetId = getSheetIdForUser(session.email);
    if (sheetId) {
        window.open(`https://docs.google.com/spreadsheets/d/${sheetId}`, '_blank');
    }
};

export const syncAllNotesToSheet = async (notes: Note[]): Promise<number> => {
    const session = getGoogleSession();
    if (!session || session.isExpired) return 0;

    const sheetId = await findOrCreateNotesSheet();
    if (!sheetId) return 0;

    try {
        let currentCount = await getRowCount(session.token, sheetId);

        const rows = notes.map(note => [
            currentCount++,
            note.case_number || 'N/A',
            note.case_name || 'N/A',
            note.title,
            note.content,
            note.tags.join(', '),
            note.created_by_name,
            note.created_at,
            note.updated_at || '',
            note.source,
            note.id
        ]);

        await axios.post(`${SHEETS_API_BASE}/${sheetId}/values/Sheet1!A:K:append?valueInputOption=USER_ENTERED`, {
            values: rows
        }, {
            headers: { Authorization: `Bearer ${session.token}` }
        });

        return notes.length;
    } catch (err) {
        console.error("Bulk sync error:", err);
        return 0;
    }
};

export const fetchNotesFromSheet = async (): Promise<any[]> => {
    const session = getGoogleSession();
    if (!session || session.isExpired) return [];

    const sheetId = await findOrCreateNotesSheet();
    if (!sheetId) return [];

    try {
        const res = await axios.get(`${SHEETS_API_BASE}/${sheetId}/values/Sheet1!A2:K`, {
            headers: { Authorization: `Bearer ${session.token}` }
        });

        if (!res.data || !res.data.values) return [];

        return res.data.values.map((row: any) => ({
            id: row[10] || row[0], // Prefer UUID in last column
            case_number: row[1] === 'N/A' || !row[1] ? null : row[1],
            case_name: row[2] === 'N/A' || !row[2] ? null : row[2],
            title: row[3] || 'Untitled',
            content: row[4] || '',
            tags: row[5] ? row[5].split(',').map((t: string) => t.trim()) : [],
            created_by_name: row[6] || 'Unknown',
            created_at: row[7] || new Date().toISOString(),
            updated_at: row[8] || null,
            source: row[9] || 'sheet',
            is_deleted: false,
            deleted_at: null
        }));
    } catch (err) {
        console.error("Error fetching notes:", err);
        return [];
    }
};
