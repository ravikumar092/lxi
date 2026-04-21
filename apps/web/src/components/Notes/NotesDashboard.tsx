import { useState, useEffect } from 'react';
import { getNotes, createNote, updateNote, deleteNote, getNoteSyncStatus } from '../../services/notesService';
import { getCurrentUser } from '../../services/authService';
import { Note } from '../../types/notes';

export default function NotesDashboard({ T }: { T: any }) {
    const [notes, setNotes] = useState<Note[]>([]);
    const [loading, setLoading] = useState(false);
    const [syncStatus, setSyncStatus] = useState(getNoteSyncStatus());

    // Form state
    const [showForm, setShowForm] = useState(false);
    const [editingNote, setEditingNote] = useState<Note | null>(null);
    const [title, setTitle] = useState("");
    const [content, setContent] = useState("");
    const [caseNumber, setCaseNumber] = useState("");
    const [tags, setTags] = useState("");

    // Auth - maps exactly mapping to eventual real backend user context
    const currentUser = getCurrentUser();

    useEffect(() => {
        const status = getNoteSyncStatus();
        setSyncStatus(status);
        loadNotes();
    }, []);

    const loadNotes = async () => {
        setLoading(true);
        const data = await getNotes();
        setNotes(data);
        setLoading(false);
    };

    const handleSave = async () => {
        if (!title.trim() || !content.trim()) {
            alert("Title and content are required.");
            return;
        }

        const noteData: Note = {
            id: editingNote ? editingNote.id : crypto.randomUUID(),
            title,
            content,
            case_number: caseNumber.trim() || null,
            case_name: null, // Ready for future backend population
            linked_team_member: null,
            tags: tags.split(',').map(t => t.trim()).filter(Boolean),
            created_by_id: editingNote ? editingNote.created_by_id : currentUser.id,
            created_by_name: editingNote ? editingNote.created_by_name : currentUser.name,
            created_at: editingNote ? editingNote.created_at : new Date().toISOString(),
            updated_by_id: currentUser.id,
            updated_by_name: currentUser.name,
            updated_at: new Date().toISOString(),
            is_deleted: false,
            deleted_at: null,
            source: "app"
        };

        if (editingNote) {
            await updateNote(editingNote.id, noteData);
        } else {
            await createNote(noteData);
        }

        setShowForm(false);
        resetForm();
        loadNotes();
    };

    const handleDelete = async (id: string) => {
        if (confirm("Are you sure you want to delete this note?")) {
            await deleteNote(id);
            loadNotes();
        }
    };

    const resetForm = () => {
        setEditingNote(null);
        setTitle("");
        setContent("");
        setCaseNumber("");
        setTags("");
    };

    const openEdit = (note: Note) => {
        setEditingNote(note);
        setTitle(note.title);
        setContent(note.content);
        setCaseNumber(note.case_number || "");
        setTags(note.tags.join(', '));
        setShowForm(true);
    };

    return (
        <div style={{ padding: "24px", maxWidth: 1000, margin: "0 auto", width: "100%" }}>
            {/* Sync Status Banner — Shows mode and configuration status */}
            <div style={{ 
                background: syncStatus.isConfigured 
                    ? (syncStatus.isSharedSheet ? "#F0FDF4" : "#FEF3F2")
                    : "#FEF3F2",
                border: `1px solid ${syncStatus.isConfigured 
                    ? (syncStatus.isSharedSheet ? "#BBF7D0" : "#FED7D7")
                    : "#FED7D7"}`,
                borderRadius: 10, 
                padding: "14px 16px", 
                marginBottom: 24, 
                display: "flex", 
                alignItems: "center", 
                gap: 10 
            }}>
                <span style={{ fontSize: 18 }}>
                    {syncStatus.isSharedSheet ? "🔗" : "📝"}
                </span>
                <div style={{ fontSize: 13, color: syncStatus.isConfigured 
                    ? (syncStatus.isSharedSheet ? "#166534" : "#991B1B")
                    : "#991B1B", fontWeight: 500 }}>
                    {syncStatus.message}
                </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                <div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: T.text, marginBottom: 8 }}>Firm Notes & Research</div>
                    <div style={{ fontSize: 15, color: T.textMuted }}>Draft case notes, research, and push them directly to Google Sheets.</div>
                </div>
                <button
                    onClick={() => { resetForm(); setShowForm(!showForm); }}
                    style={{ padding: "10px 20px", borderRadius: 8, background: T.accentBg, color: T.accentDark, fontWeight: 800, fontSize: 14, border: `1px solid ${T.accentDark}`, cursor: "pointer", display: "flex", gap: 8, alignItems: "center" }}
                >
                    {showForm ? "Cancel" : "✏️ New Note"}
                </button>
            </div>

            {showForm && (
                <div style={{ background: T.surface, border: `1px solid ${T.borderSoft}`, borderRadius: 12, padding: "24px", marginBottom: 32, boxShadow: T.shadow }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: T.text, marginBottom: 16 }}>{editingNote ? "Edit Note" : "Create New Note"}</div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                        <div>
                            <label style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, marginBottom: 6, display: "block" }}>TITLE *</label>
                            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="E.g. Hearing Notes for 14th March" style={{ width: "100%", padding: 12, borderRadius: 8, border: `1px solid ${T.border}`, outline: "none", fontSize: 14, fontFamily: "inherit" }} />
                        </div>
                        <div>
                            <label style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, marginBottom: 6, display: "block" }}>LINK TO CASE (MOCK API READY)</label>
                            <input value={caseNumber} onChange={e => setCaseNumber(e.target.value)} placeholder="Type Case Number manually (e.g. SLP(C) 1234/2026)" style={{ width: "100%", padding: 12, borderRadius: 8, border: `1px solid ${T.border}`, outline: "none", fontSize: 14, fontFamily: "inherit" }} />
                        </div>
                    </div>

                    <div style={{ marginBottom: 16 }}>
                        <label style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, marginBottom: 6, display: "block" }}>CONTENT *</label>
                        <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Type your full note, research, or observations here..." rows={6} style={{ width: "100%", padding: 12, borderRadius: 8, border: `1px solid ${T.border}`, outline: "none", fontSize: 14, fontFamily: "inherit", resize: "vertical" }} />
                    </div>

                    <div style={{ marginBottom: 24 }}>
                        <label style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, marginBottom: 6, display: "block" }}>TAGS (Comma separated)</label>
                        <input value={tags} onChange={e => setTags(e.target.value)} placeholder="urgent, research, hearing notes" style={{ width: "100%", padding: 12, borderRadius: 8, border: `1px solid ${T.border}`, outline: "none", fontSize: 14, fontFamily: "inherit" }} />
                    </div>

                    <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", alignItems: "center" }}>
                        <span style={{ fontSize: 12, color: T.textMuted }}>Drafting as: <strong>{currentUser.name} ({currentUser.role})</strong></span>
                        <div style={{ flex: 1 }} />
                        <button onClick={() => setShowForm(false)} style={{ padding: "10px 20px", borderRadius: 8, background: "transparent", color: T.textMuted, fontWeight: 700, border: `1px solid ${T.borderSoft}`, cursor: "pointer" }}>Discard</button>
                        <button onClick={handleSave} style={{ padding: "10px 24px", borderRadius: 8, background: "#10B981", color: "#fff", fontWeight: 800, border: "none", cursor: "pointer" }}>Save Note</button>
                    </div>
                </div>
            )}

            {loading ? (
                <div style={{ textAlign: "center", padding: 40, color: T.textMuted }}>Loading notes...</div>
            ) : notes.length === 0 ? (
                <div style={{ textAlign: "center", padding: 60, color: T.textMuted, border: `1px dashed ${T.border}`, borderRadius: 12 }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>📝</div>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>No notes created yet.</div>
                    <div style={{ fontSize: 14, marginTop: 4 }}>Click "New Note" to draft your first memo.</div>
                </div>
            ) : (
                <div style={{ display: "grid", gap: 16 }}>
                    {notes.map(note => (
                        <div key={note.id} style={{ background: T.surface, padding: 20, borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: T.shadow }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                                <div>
                                    <div style={{ fontSize: 18, fontWeight: 800, color: T.text, marginBottom: 4 }}>{note.title}</div>
                                    <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 12, color: T.textMuted, fontWeight: 600 }}>
                                        <span>By {note.created_by_name} • {new Date(note.created_at).toLocaleDateString()}</span>
                                        {note.case_number && <span style={{ background: T.bg, padding: "2px 8px", borderRadius: 4, border: `1px solid ${T.borderSoft}` }}>Linked: {note.case_number}</span>}
                                    </div>
                                </div>
                                <div style={{ display: "flex", gap: 8 }}>
                                    <button onClick={() => openEdit(note)} style={{ padding: "6px 10px", borderRadius: 6, background: "transparent", color: T.textSub, border: `1px solid ${T.borderSoft}`, cursor: "pointer" }}>✏️</button>
                                    <button onClick={() => handleDelete(note.id)} style={{ padding: "6px 10px", borderRadius: 6, background: "transparent", color: "#EF4444", border: `1px solid ${T.borderSoft}`, cursor: "pointer" }}>🗑</button>
                                </div>
                            </div>

                            <div style={{ fontSize: 14, color: T.text, lineHeight: 1.6, whiteSpace: "pre-wrap", marginBottom: 16 }}>{note.content}</div>

                            {note.tags && note.tags.length > 0 && (
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                    {note.tags.map(tag => (
                                        <span key={tag} style={{ fontSize: 11, fontWeight: 700, color: T.accentDark, background: T.accentBg, padding: "3px 8px", borderRadius: 12 }}>#{tag}</span>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
