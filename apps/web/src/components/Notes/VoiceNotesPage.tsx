import React, { useState, useEffect, useCallback } from 'react';
import { Mic, Search, Filter, Volume2, Calendar, Tag, Link, ChevronRight, Plus } from 'lucide-react';
import { getNotes } from '../../services/notesService';
import { Note, NoteCategory } from '../../types/notes';
import VoiceNoteRecorder from './VoiceNoteRecorder';
import { Case } from '../../types';

interface VoiceNotesPageProps {
    T: any;
    cases: Case[];
}

const CATEGORY_META: Record<string, { icon: string; color: string; bg: string }> = {
    Strategy:             { icon: '📈', color: '#0369A1', bg: 'rgba(14,165,233,0.12)' },
    Task:                 { icon: '✓',  color: '#047857', bg: 'rgba(16,185,129,0.12)' },
    Idea:                 { icon: '💡', color: '#B45309', bg: 'rgba(245,158,11,0.12)' },
    Problem:              { icon: '⚠️', color: '#B91C1C', bg: 'rgba(239,68,68,0.12)' },
    Research:             { icon: '🔍', color: '#6D28D9', bg: 'rgba(139,92,246,0.12)' },
    'Document Requirement': { icon: '📁', color: '#374151', bg: 'rgba(107,114,128,0.12)' },
    General:              { icon: '📝', color: '#4B5563', bg: 'rgba(156,163,175,0.12)' },
};

const ALL_CATEGORIES: NoteCategory[] = ['Strategy', 'Task', 'Idea', 'Problem', 'Research', 'Document Requirement', 'General'];

function fmtDuration(s: number) {
    const m = Math.floor(s / 60), sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
}

function fmtRelTime(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export default function VoiceNotesPage({ T, cases }: VoiceNotesPageProps) {
    const [notes, setNotes] = useState<Note[]>([]);
    const [loading, setLoading] = useState(true);
    const [showRecorder, setShowRecorder] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterCategory, setFilterCategory] = useState<NoteCategory | 'All'>('All');
    const [filterSource, setFilterSource] = useState<'all' | 'voice' | 'typed'>('all');
    const [expandedNote, setExpandedNote] = useState<string | null>(null);

    const loadNotes = useCallback(async () => {
        setLoading(true);
        const data = await getNotes();
        setNotes(data.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
        setLoading(false);
    }, []);

    useEffect(() => { loadNotes(); }, [loadNotes]);

    const filtered = notes.filter(n => {
        if (filterSource === 'voice' && n.source !== 'voice') return false;
        if (filterSource === 'typed' && n.source === 'voice') return false;
        if (filterCategory !== 'All' && n.category !== filterCategory) return false;
        if (searchTerm.trim()) {
            const q = searchTerm.toLowerCase();
            return n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q) ||
                n.tags.some(t => t.toLowerCase().includes(q)) ||
                (n.case_name || '').toLowerCase().includes(q);
        }
        return true;
    });

    const voiceCount = notes.filter(n => n.source === 'voice').length;
    const todayCount = notes.filter(n => {
        const d = new Date(n.created_at);
        const today = new Date();
        return d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
    }).length;
    const aiProcessedCount = notes.filter(n => n.is_ai_processed).length;

    return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: T.bg }}>
            {/* ── HEADER ── */}
            <div style={{
                background: T.surface,
                borderBottom: `1px solid ${T.border}`,
                padding: '20px 28px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 16,
                flexShrink: 0
            }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                        <div style={{
                            width: 36, height: 36, borderRadius: 10,
                            background: 'linear-gradient(135deg,#C9A84C,#9B7B28)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 18, boxShadow: '0 4px 12px rgba(201,168,76,0.3)'
                        }}>🎙</div>
                        <div>
                            <div style={{ fontSize: 18, fontWeight: 800, color: T.text, letterSpacing: -0.3 }}>Voice Notes</div>
                            <div style={{ fontSize: 12, color: T.textMuted }}>AI-powered voice transcription & task extraction</div>
                        </div>
                    </div>
                </div>

                {/* Stats */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    {[
                        { label: 'Total', value: notes.length, color: T.text },
                        { label: 'Voice', value: voiceCount, color: '#C9A84C' },
                        { label: 'Today', value: todayCount, color: '#10B981' },
                        { label: 'AI Processed', value: aiProcessedCount, color: '#2A7BD4' },
                    ].map(s => (
                        <div key={s.label} style={{ textAlign: 'center', background: T.bg, padding: '8px 14px', borderRadius: 10, border: `1px solid ${T.borderSoft}` }}>
                            <div style={{ fontSize: 18, fontWeight: 800, color: s.color }}>{s.value}</div>
                            <div style={{ fontSize: 10, color: T.textMuted, fontWeight: 600 }}>{s.label}</div>
                        </div>
                    ))}
                </div>

                {/* Record Button */}
                <button
                    id="record-voice-note-btn"
                    onClick={() => setShowRecorder(true)}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '12px 20px', borderRadius: 12,
                        background: 'linear-gradient(135deg,#C9A84C,#9B7B28)',
                        color: '#fff', border: 'none', cursor: 'pointer',
                        fontSize: 14, fontWeight: 700,
                        boxShadow: '0 4px 16px rgba(201,168,76,0.35)',
                        flexShrink: 0
                    }}
                >
                    <Mic size={18} />
                    Record New Note
                </button>
            </div>

            {/* ── FILTERS ── */}
            <div style={{
                padding: '12px 28px',
                background: T.surface,
                borderBottom: `1px solid ${T.borderSoft}`,
                display: 'flex',
                gap: 10,
                alignItems: 'center',
                flexWrap: 'wrap',
                flexShrink: 0
            }}>
                {/* Search */}
                <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
                    <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: T.textMuted }} />
                    <input
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        placeholder="Search notes, cases, tags..."
                        style={{
                            width: '100%', padding: '8px 10px 8px 30px',
                            borderRadius: 9, border: `1px solid ${T.border}`,
                            fontSize: 13, background: T.bg, color: T.text,
                            outline: 'none', boxSizing: 'border-box'
                        }}
                    />
                </div>

                {/* Source filter */}
                <div style={{ display: 'flex', gap: 4, background: T.bg, padding: 3, borderRadius: 9, border: `1px solid ${T.borderSoft}` }}>
                    {(['all', 'voice', 'typed'] as const).map(src => (
                        <button
                            key={src}
                            onClick={() => setFilterSource(src)}
                            style={{
                                padding: '5px 12px', borderRadius: 7, border: 'none',
                                background: filterSource === src ? 'linear-gradient(135deg,#C9A84C,#9B7B28)' : 'transparent',
                                color: filterSource === src ? '#fff' : T.textMuted,
                                fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap'
                            }}
                        >
                            {src === 'all' ? 'All' : src === 'voice' ? '🎙 Voice' : '⌨️ Typed'}
                        </button>
                    ))}
                </div>

                {/* Category filter */}
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {(['All', ...ALL_CATEGORIES] as (NoteCategory | 'All')[]).map(cat => {
                        const meta = cat === 'All' ? null : CATEGORY_META[cat];
                        const isActive = filterCategory === cat;
                        return (
                            <button
                                key={cat}
                                onClick={() => setFilterCategory(cat)}
                                style={{
                                    padding: '4px 10px', borderRadius: 20, border: 'none',
                                    background: isActive ? (meta?.bg || 'rgba(201,168,76,0.15)') : T.bg,
                                    color: isActive ? (meta?.color || '#C9A84C') : T.textMuted,
                                    fontSize: 11, fontWeight: 700, cursor: 'pointer',
                                    border: isActive
                                                      ? `1px solid ${(meta?.color || '#C9A84C') + '40'}`
                                                      : 'none',
                                    transition: 'all 0.15s'
                                }}
                            >
                                {meta?.icon} {cat}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* ── NOTES LIST ── */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 28px' }}>
                {loading ? (
                    <div style={{ textAlign: 'center', padding: '60px 0', color: T.textMuted }}>
                        <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
                        <div style={{ fontSize: 14 }}>Loading notes...</div>
                    </div>
                ) : filtered.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '80px 0' }}>
                        <div style={{ fontSize: 48, marginBottom: 16 }}>🎙</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 8 }}>
                            {notes.length === 0 ? 'No notes yet' : 'No notes match your filters'}
                        </div>
                        <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 24 }}>
                            {notes.length === 0
                                ? 'Record your first voice note or long-press the logo to start'
                                : 'Try adjusting your search or filters'}
                        </div>
                        {notes.length === 0 && (
                            <button
                                onClick={() => setShowRecorder(true)}
                                style={{
                                    padding: '12px 24px', borderRadius: 12,
                                    background: 'linear-gradient(135deg,#C9A84C,#9B7B28)',
                                    color: '#fff', border: 'none', cursor: 'pointer',
                                    fontSize: 14, fontWeight: 700,
                                    boxShadow: '0 4px 16px rgba(201,168,76,0.3)'
                                }}
                            >
                                🎙 Record Your First Note
                            </button>
                        )}
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {filtered.map(note => {
                            const meta = CATEGORY_META[note.category || 'General'] || CATEGORY_META.General;
                            const isExpanded = expandedNote === note.id;
                            const linkedCases = (note.linked_case_ids || [])
                                .map(id => cases.find(c => c.id === id))
                                .filter(Boolean);

                            return (
                                <div
                                    key={note.id}
                                    style={{
                                        background: T.surface,
                                        borderRadius: 14,
                                        border: `1px solid ${T.border}`,
                                        overflow: 'hidden',
                                        boxShadow: '0 1px 4px rgba(15,28,63,0.06)',
                                        transition: 'box-shadow 0.15s'
                                    }}
                                >
                                    {/* Note header */}
                                    <div
                                        onClick={() => setExpandedNote(isExpanded ? null : note.id)}
                                        style={{ padding: '14px 16px', cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'flex-start' }}
                                    >
                                        {/* Category icon */}
                                        <div style={{
                                            width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                                            background: meta.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18
                                        }}>
                                            {meta.icon}
                                        </div>

                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                                                <div style={{ fontSize: 14, fontWeight: 700, color: T.text, flex: 1 }}>{note.title}</div>
                                                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                                                    {note.source === 'voice' && (
                                                        <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, background: 'rgba(201,168,76,0.12)', color: '#C9A84C', fontWeight: 700, border: '1px solid rgba(201,168,76,0.25)' }}>
                                                            🎙 AI VOICE
                                                        </span>
                                                    )}
                                                    <span style={{ fontSize: 11, color: T.textMuted }}>{fmtRelTime(note.created_at)}</span>
                                                    <ChevronRight size={14} style={{ color: T.textMuted, transform: isExpanded ? 'rotate(90deg)' : 'none', transition: '0.2s' }} />
                                                </div>
                                            </div>

                                            {/* Category + linked cases badges */}
                                            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
                                                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 5, background: meta.bg, color: meta.color, fontWeight: 700 }}>
                                                    {note.category || 'General'}
                                                </span>
                                                {note.case_name && (
                                                    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 5, background: 'rgba(42,123,212,0.1)', color: '#2A7BD4', fontWeight: 700 }}>
                                                        ⚖️ {note.case_name.slice(0, 30)}{note.case_name.length > 30 ? '…' : ''}
                                                    </span>
                                                )}
                                                {linkedCases.length > 1 && (
                                                    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 5, background: 'rgba(42,123,212,0.08)', color: '#2A7BD4', fontWeight: 700 }}>
                                                        +{linkedCases.length - 1} more cases
                                                    </span>
                                                )}
                                                {note.is_ai_processed && (
                                                    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 5, background: 'rgba(16,185,129,0.1)', color: '#047857', fontWeight: 700 }}>
                                                        ✦ AI Processed
                                                    </span>
                                                )}
                                            </div>

                                            {/* Preview text */}
                                            {!isExpanded && (
                                                <div style={{ fontSize: 12, color: T.textMuted, marginTop: 5, lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                                                    {note.content}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Expanded content */}
                                    {isExpanded && (
                                        <div style={{ borderTop: `1px solid ${T.borderSoft}`, padding: '14px 16px', background: T.bg }}>
                                            {/* Full transcription */}
                                            <div style={{ fontSize: 13, color: T.text, lineHeight: 1.7, marginBottom: 12, whiteSpace: 'pre-wrap' }}>
                                                {note.content}
                                            </div>

                                            {/* Audio player */}
                                            {note.audio_url && (
                                                <div style={{ marginBottom: 14, background: T.surface, padding: 10, borderRadius: 10, border: `1px solid ${T.borderSoft}` }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                                        <Volume2 size={14} style={{ color: '#C9A84C' }} />
                                                        <span style={{ fontSize: 11, fontWeight: 700, color: T.textMuted }}>VOICE RECORDING</span>
                                                        {note.duration && <span style={{ fontSize: 11, color: T.textMuted }}>• {fmtDuration(Math.floor(note.duration))}s</span>}
                                                    </div>
                                                    <audio controls src={note.audio_url} style={{ width: '100%', height: 34 }} />
                                                </div>
                                            )}

                                            {/* Extracted Tasks */}
                                            {note.extracted_tasks && note.extracted_tasks.length > 0 && (
                                                <div style={{ marginBottom: 12 }}>
                                                    <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, letterSpacing: 0.8, marginBottom: 8, textTransform: 'uppercase' }}>
                                                        ✅ Extracted Tasks ({note.extracted_tasks.length})
                                                    </div>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                                        {note.extracted_tasks.map((task: any, i: number) => (
                                                            <div key={i} style={{
                                                                background: T.surface, padding: '8px 12px',
                                                                borderRadius: 8, border: `1px solid ${T.borderSoft}`,
                                                                display: 'flex', alignItems: 'center', gap: 10
                                                            }}>
                                                                <div style={{ fontSize: 14 }}>✅</div>
                                                                <div style={{ flex: 1 }}>
                                                                    <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{task.text}</div>
                                                                    <div style={{ fontSize: 10, color: T.textMuted, display: 'flex', gap: 8, marginTop: 2 }}>
                                                                        <span>👤 {task.assignee}</span>
                                                                        <span>🔥 {task.urgency}</span>
                                                                        {task.deadline && <span>⏱ {task.deadline}</span>}
                                                                    </div>
                                                                </div>
                                                                <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, background: 'rgba(16,185,129,0.1)', color: '#047857', fontWeight: 700 }}>AUTO</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Linked cases */}
                                            {linkedCases.length > 0 && (
                                                <div style={{ marginBottom: 12 }}>
                                                    <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, letterSpacing: 0.8, marginBottom: 6, textTransform: 'uppercase' }}>
                                                        ⚖️ Linked Cases
                                                    </div>
                                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                                        {linkedCases.map((c: any) => (
                                                            <span key={c.id} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, background: 'rgba(42,123,212,0.1)', color: '#2A7BD4', fontWeight: 700, border: '1px solid rgba(42,123,212,0.2)' }}>
                                                                ⚖️ {c.displayTitle || c.petitioner || c.caseNumber}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Tags */}
                                            {note.tags.length > 0 && (
                                                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                                                    {note.tags.map(t => (
                                                        <span key={t} style={{ fontSize: 9, padding: '2px 7px', borderRadius: 5, background: T.accentBg, color: T.accentDark, fontWeight: 700 }}>
                                                            #{t.toUpperCase()}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Footer */}
                                            <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.borderSoft}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <div style={{ fontSize: 11, color: T.textMuted }}>
                                                    By {note.created_by_name || 'Unknown'} · {new Date(note.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                                </div>
                                                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                                    {note.is_ai_processed && <span style={{ fontSize: 10, color: '#047857' }}>✦ AI Processed</span>}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── VOICE RECORDER MODAL ── */}
            {showRecorder && (
                <VoiceNoteRecorder
                    cases={cases}
                    T={T}
                    onClose={() => setShowRecorder(false)}
                    onComplete={(note) => {
                        setShowRecorder(false);
                        loadNotes();
                    }}
                />
            )}

            {/* ── FAB: Quick Record ── */}
            {!showRecorder && (
                <button
                    id="fab-record-voice"
                    onClick={() => setShowRecorder(true)}
                    title="Record new voice note (or long-press the logo)"
                    style={{
                        position: 'fixed',
                        bottom: 28,
                        right: 28,
                        width: 56,
                        height: 56,
                        borderRadius: '50%',
                        background: 'linear-gradient(135deg,#C9A84C,#9B7B28)',
                        color: '#fff',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 6px 20px rgba(201,168,76,0.5)',
                        zIndex: 100,
                        fontSize: 22
                    }}
                >
                    <Mic size={24} />
                </button>
            )}
        </div>
    );
}
