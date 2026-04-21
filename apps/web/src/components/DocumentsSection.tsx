/**
 * Lex Tigress – DocumentsSection Component (Feature 2)
 * 
 * Full 4-tab Documents UI: Missing | Uploaded | Requests Sent | Completed
 * Pattern follows LowerCourtStatusSection.tsx exactly.
 */

import { useState, useEffect, useRef } from 'react';
import { useApp } from '../AppContext';
import type {
    DocumentRequirement,
    DocFilingMode,
    DocUploadSource,
    UploadedDocumentMeta,
    DocPriority,
} from '../types';
import {
    loadDocReqs,
    saveDocReqs,
    loadUploadedDocs,
} from '../services/localStorageService';
import {
    analyseDocuments,
    createTasksForRequirements,
    markRequirementComplete,
    processUploadedDocument,
    getOverdueFollowUps,
    markFollowUpSent,
    recordWhatsAppSent,
    buildClientWhatsAppMessage,
    buildAssociateWhatsAppMessage,
} from '../services/missingDocService';
import { useSettingsStore } from '../store/settingsStore';

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function fmtDeadline(iso?: string): string {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch { return iso; }
}

function daysUntil(iso?: string): number | null {
    if (!iso) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const target = new Date(iso); target.setHours(0, 0, 0, 0);
    return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function fmtDT(iso?: string): string {
    if (!iso) return '';
    try {
        return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    } catch { return iso; }
}

function statusColor(status: string): { bg: string; border: string; text: string; dot: string } {
    switch (status) {
        case 'Missing':    return { bg: '#FEF2F2', border: '#FECACA', text: '#DC2626', dot: '#DC2626' };
        case 'Incorrect':  return { bg: '#FFFBEB', border: '#FDE68A', text: '#D97706', dot: '#D97706' };
        case 'Incomplete': return { bg: '#FFFBEB', border: '#FDE68A', text: '#B45309', dot: '#B45309' };
        case 'Complete':
        case 'Received':   return { bg: '#F0FDF4', border: '#86EFAC', text: '#16A34A', dot: '#16A34A' };
        default:           return { bg: '#F9FAFB', border: '#E5E7EB', text: '#6B7280', dot: '#9CA3AF' };
    }
}

function priorityBadge(priority: string): { label: string; bg: string; color: string } {
    switch (priority) {
        case 'Critical':  return { label: '⚠️ Filing Blocker', bg: '#FEE2E2', color: '#991B1B' };
        case 'Important': return { label: '📋 Case Strength',  bg: '#FEF3C7', color: '#92400E' };
        default:          return { label: '➕ Supporting',      bg: '#F9FAFB', color: '#6B7280' };
    }
}

function sortReqs(reqs: DocumentRequirement[]): DocumentRequirement[] {
    const order = { Critical: 0, Important: 1, Optional: 2 };
    return [...reqs].sort((a, b) => (order[a.priority] ?? 2) - (order[b.priority] ?? 2));
}

// ─── WHATSAPP SHARE BUTTON ───────────────────────────────────────────────────

function WhatsAppComposer({
    req, caseObj, recipient, onClose, onSent,
}: {
    req: DocumentRequirement;
    caseObj: any;
    recipient: 'Client' | 'Associate';
    onClose: () => void;
    onSent: () => void;
}) {
    const { teamMembers } = useSettingsStore();

    const [selectedAssociate, setSelectedAssociate] = useState(
        teamMembers.length > 0 ? teamMembers[0].name : ''
    );

    const buildMsg = (associateName?: string) =>
        recipient === 'Client'
            ? (req.whatsappClientText || buildClientWhatsAppMessage(req, caseObj))
            : `Dear ${associateName || selectedAssociate},\n\n` + (req.whatsappAssociateText || buildAssociateWhatsAppMessage(req, caseObj));

    const [msg, setMsg] = useState(() => buildMsg());
    const [copied, setCopied] = useState(false);
    const [sending, setSending] = useState(false);

    // Guard: Client WhatsApp requires a linked client contact
    const missingClientContact = recipient === 'Client' && !caseObj.client_id;

    function handleAssociateChange(name: string) {
        setSelectedAssociate(name);
        setMsg(buildMsg(name));
    }

    function handleCopy() {
        navigator.clipboard.writeText(msg).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
    }

    async function handleShare() {
        setSending(true);
        try {
            await recordWhatsAppSent(caseObj.id, req.id, recipient, recipient === 'Client' ? { id: caseObj.client_id, teamId: caseObj.team_id } : undefined);

            // Optionally dispatch a success toast here via your app's notification system
            console.log(`[Twilio] Sent missing doc notification to ${recipient}`);
            onSent();
        } catch (error) {
            console.error('[Twilio] Error sending missing doc notification:', error);
            alert('Failed to send notification via Twilio. Check console for details.');
        } finally {
            setSending(false);
        }
    }

    return (
        <div style={{
            background: missingClientContact ? '#FFF7ED' : '#F0FDF4',
            border: `1px solid ${missingClientContact ? '#FED7AA' : '#86EFAC'}`,
            borderRadius: 10, padding: '14px 16px', marginTop: 10,
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: missingClientContact ? '#C2410C' : '#15803D', letterSpacing: 0.6, textTransform: 'uppercase' }}>
                    📲 WhatsApp — {recipient}
                </div>
                <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', fontSize: 16, lineHeight: 1 }}>✕</button>
            </div>

            {missingClientContact ? (
                <div style={{ textAlign: 'center', padding: '16px 8px' }}>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>📵</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#C2410C', marginBottom: 4 }}>No Client Contact Linked</div>
                    <div style={{ fontSize: 12, color: '#92400E', lineHeight: 1.5 }}>
                        This case has no client contact. Please go to the <b>Client Contact</b> section in the case details and add a WhatsApp number before sending.
                    </div>
                </div>
            ) : (
                <>
                    {recipient === 'Associate' && teamMembers.length > 0 && (
                        <div style={{ marginBottom: 10 }}>
                            <label style={{ fontSize: 11, fontWeight: 800, color: '#15803D', letterSpacing: 0.5, display: 'block', marginBottom: 4 }}>SEND TO</label>
                            <select
                                value={selectedAssociate}
                                onChange={e => handleAssociateChange(e.target.value)}
                                style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #86EFAC', fontSize: 13, background: '#fff', color: '#15803D', fontWeight: 600, outline: 'none', cursor: 'pointer' }}
                            >
                                {teamMembers.map(m => (
                                    <option key={m.id} value={m.name}>{m.name} — {m.role}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    <textarea
                        value={msg}
                        onChange={(e) => setMsg(e.target.value)}
                        rows={8}
                        style={{
                            width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #86EFAC',
                            fontSize: 12, color: '#15803D', resize: 'vertical', outline: 'none',
                            boxSizing: 'border-box', fontFamily: 'monospace', lineHeight: 1.5,
                            background: '#fff',
                        }}
                    />
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button onClick={handleCopy} disabled={sending} style={{
                            flex: 1, padding: '8px 12px', borderRadius: 7, border: '1px solid #86EFAC',
                            background: '#fff', color: '#15803D', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                            opacity: sending ? 0.5 : 1
                        }}>
                            {copied ? '✅ Copied!' : '📋 Copy'}
                        </button>
                        <button onClick={handleShare} disabled={sending} style={{
                            flex: 2, padding: '8px 14px', borderRadius: 7, border: 'none',
                            background: 'linear-gradient(135deg,#25D366,#128C7E)', color: '#fff',
                            fontSize: 13, fontWeight: 700, cursor: sending ? 'wait' : 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
                        }}>
                            {sending ? 'Sending...' : '⚡ Send on WhatsApp →'}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}

// ─── DOCUMENT CARD ────────────────────────────────────────────────────────────

function DocRequirementCard({
    req, caseObj, T, onMarkComplete, onRefresh,
}: {
    req: DocumentRequirement;
    caseObj: any;
    T: any;
    onMarkComplete: (id: string) => void;
    onRefresh: () => void;
}) {
    const [whatsappOpen, setWhatsappOpen]     = useState<'Client' | 'Associate' | null>(null);
    const [expanded, setExpanded]             = useState(false);
    const sc   = statusColor(req.status);
    const pb   = priorityBadge(req.priority);
    const days = daysUntil(req.deadline);
    const isOverdue = days !== null && days < 0;

    return (
        <div style={{
            background: sc.bg, border: `1.5px solid ${sc.border}`, borderRadius: 10,
            padding: '12px 14px', marginBottom: 10,
        }}>
            {/* Header row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                    <div style={{
                        width: 10, height: 10, borderRadius: '50%', background: sc.dot, flexShrink: 0, marginTop: 2,
                    }} />
                    <div style={{ fontSize: 14, fontWeight: 700, color: T.text, lineHeight: 1.3 }}>
                        {req.documentName}
                        {req.followUps?.some(fu => fu.escalated) && (
                            <span style={{ 
                                marginLeft: 8, fontSize: 10, fontWeight: 800, color: '#DC2626',
                                background: '#FEE2E2', padding: '1px 6px', borderRadius: 4,
                                letterSpacing: 0.5
                            }}>‼️ ESCALATED</span>
                        )}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                        background: pb.bg, color: pb.color, whiteSpace: 'nowrap',
                    }}>{pb.label}</span>
                    <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                        background: `${sc.dot}20`, color: sc.text,
                    }}>{req.status.toUpperCase()}</span>
                </div>
            </div>

            {/* Meta row */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: T.textMuted }}>
                    📋 Source: <b>{req.source}</b>
                </span>
                {req.filingStage && (
                    <span style={{ fontSize: 11, color: T.textMuted }}>
                        🏛️ {req.filingStage}
                    </span>
                )}
                {req.requestedFrom && (
                    <span style={{ fontSize: 11, color: T.textMuted }}>
                        👤 From: <b>{req.requestedFrom}</b>
                    </span>
                )}
            </div>

            {/* Timeline */}
            {req.deadline && (
                <div style={{
                    fontSize: 12, fontWeight: 600,
                    color: isOverdue ? '#DC2626' : days !== null && days <= 3 ? '#D97706' : '#16A34A',
                    marginBottom: 8,
                }}>
                    ⏰ {isOverdue
                        ? `Overdue by ${Math.abs(days!)} day${Math.abs(days!) !== 1 ? 's' : ''} — ${fmtDeadline(req.deadline)}`
                        : days === 0 ? 'Due TODAY'
                        : days === 1 ? 'Due TOMORROW'
                        : `Must file by ${fmtDeadline(req.deadline)} (${days} days)`}
                    {caseObj.nextHearingDate && ` · before next hearing`}
                </div>
            )}

            {/* Collapsible AI info */}
            {(req.whyImportant || req.riskIfMissing) && (
                <div style={{ marginBottom: 8 }}>
                    <button
                        onClick={() => setExpanded((v) => !v)}
                        style={{
                            fontSize: 11, color: T.textMuted, background: 'none', border: 'none',
                            cursor: 'pointer', padding: 0, fontWeight: 600,
                        }}
                    >
                        {expanded ? '▲ Hide details' : '▼ Why important?'}
                    </button>
                    {expanded && (
                        <div style={{ marginTop: 6, padding: '8px 10px', background: 'rgba(0,0,0,0.04)', borderRadius: 7 }}>
                            {req.whyImportant && (
                                <div style={{ fontSize: 12, color: T.text, marginBottom: 4 }}>
                                    <b>Why needed:</b> {req.whyImportant}
                                </div>
                            )}
                            {req.riskIfMissing && (
                                <div style={{ fontSize: 12, color: '#DC2626' }}>
                                    <b>Risk if not filed:</b> {req.riskIfMissing}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                    onClick={() => setWhatsappOpen(whatsappOpen === 'Client' ? null : 'Client')}
                    style={{
                        padding: '5px 12px', borderRadius: 7, border: '1px solid #25D366',
                        background: whatsappOpen === 'Client' ? '#25D366' : 'transparent',
                        color: whatsappOpen === 'Client' ? '#fff' : '#128C7E',
                        fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    }}
                >
                    📲 Client
                </button>
                <button
                    onClick={() => setWhatsappOpen(whatsappOpen === 'Associate' ? null : 'Associate')}
                    style={{
                        padding: '5px 12px', borderRadius: 7, border: '1px solid #2A7BD4',
                        background: whatsappOpen === 'Associate' ? '#2A7BD4' : 'transparent',
                        color: whatsappOpen === 'Associate' ? '#fff' : '#2A7BD4',
                        fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    }}
                >
                    📲 Associate
                </button>
                <button
                    onClick={() => { markRequirementComplete(caseObj.id, req.id); onMarkComplete(req.id); }}
                    style={{
                        padding: '5px 12px', borderRadius: 7, border: '1px solid #D1D5DB',
                        background: 'transparent', color: '#16A34A',
                        fontSize: 12, fontWeight: 700, cursor: 'pointer', marginLeft: 'auto',
                    }}
                >
                    ✅ Mark Complete
                </button>
            </div>

            {/* WhatsApp Composer */}
            {whatsappOpen && (
                <WhatsAppComposer
                    req={req}
                    caseObj={caseObj}
                    recipient={whatsappOpen}
                    onClose={() => setWhatsappOpen(null)}
                    onSent={() => { setWhatsappOpen(null); onRefresh(); }}
                />
            )}
        </div>
    );
}

// ─── SPINNER ──────────────────────────────────────────────────────────────────

function Spinner({ size = 18, color = '#9B7B28' }: { size?: number; color?: string }) {
    return (
        <svg
            width={size} height={size} viewBox="0 0 24 24" fill="none"
            style={{ animation: 'spin 0.8s linear infinite', flexShrink: 0 }}
        >
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="3" strokeOpacity="0.2" />
            <path d="M12 2a10 10 0 0 1 10 10" stroke={color} strokeWidth="3" strokeLinecap="round" />
        </svg>
    );
}

// ─── PDF TEXT EXTRACTOR ───────────────────────────────────────────────────────

async function extractTextFromPdf(file: File): Promise<string> {
    // Dynamically load pdfjs-dist to keep initial bundle light
    const pdfjsLib = await import('pdfjs-dist');
    // Use a CDN worker to avoid bundling issues
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    const pageTexts: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        // Join items — preserves Devanagari/regional script glyphs if embedded
        const pageText = content.items
            .map((item: any) => ('str' in item ? item.str : ''))
            .join(' ');
        pageTexts.push(pageText);
    }
    return pageTexts.join('\n\n');
}

// ─── SCAN MODAL ───────────────────────────────────────────────────────────────

const ANALYSIS_STAGES = [
    { label: 'Reading document…',      pct: 15 },
    { label: 'Detecting language…',    pct: 30 },
    { label: 'Matching SC rules…',     pct: 55 },
    { label: 'Running AI analysis…',   pct: 75 },
    { label: 'Generating report…',     pct: 90 },
];

const LANGUAGES = [
    { value: 'auto',  label: '🌐 Auto-detect' },
    { value: 'en',    label: '🇬🇧 English' },
    { value: 'hi',    label: '🇮🇳 Hindi (हिन्दी)' },
    { value: 'mr',    label: '🇮🇳 Marathi (मराठी)' },
    { value: 'ta',    label: '🇮🇳 Tamil (தமிழ்)' },
    { value: 'te',    label: '🇮🇳 Telugu (తెలుగు)' },
    { value: 'kn',    label: '🇮🇳 Kannada (ಕನ್ನಡ)' },
    { value: 'ml',    label: '🇮🇳 Malayalam (മലയാളം)' },
    { value: 'gu',    label: '🇮🇳 Gujarati (ગુજરાતી)' },
    { value: 'bn',    label: '🇮🇳 Bengali (বাংলা)' },
    { value: 'pa',    label: '🇮🇳 Punjabi (ਪੰਜਾਬੀ)' },
    { value: 'ur',    label: '🇮🇳 Urdu (اردو)' },
];

function ScanModal({
    caseObj, T, onClose, onComplete,
}: {
    caseObj: any; T: any; onClose: () => void; onComplete: (reqs: DocumentRequirement[]) => void;
}) {
    const [mode, setMode]             = useState<DocFilingMode>('Before Filing');
    const [text, setText]             = useState('');
    const [language, setLanguage]     = useState('auto');
    const [loading, setLoading]       = useState(false);
    const [fileLoading, setFileLoading] = useState(false);
    const [uploadedFile, setUploadedFile] = useState<string | null>(null);
    const [stageIdx, setStageIdx]     = useState(0);
    const [error, setError]           = useState('');
    const fileRef                     = useRef<HTMLInputElement>(null);
    const stageTimerRef               = useRef<ReturnType<typeof setInterval> | null>(null);

    // Animate through stages while loading
    function startStageAnimation() {
        setStageIdx(0);
        stageTimerRef.current = setInterval(() => {
            setStageIdx((prev) => {
                if (prev < ANALYSIS_STAGES.length - 2) return prev + 1;
                return prev; // hold at last stage until done
            });
        }, 1400);
    }
    function stopStageAnimation() {
        if (stageTimerRef.current) {
            clearInterval(stageTimerRef.current);
            stageTimerRef.current = null;
        }
    }

    async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        setFileLoading(true);
        setError('');
        setUploadedFile(null);
        try {
            let extracted = '';
            if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
                extracted = await extractTextFromPdf(file);
            } else {
                // .txt / .doc-as-text — read with UTF-8 to preserve Devanagari
                extracted = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload  = (ev) => resolve((ev.target?.result as string) || '');
                    reader.onerror = () => reject(new Error('Could not read file'));
                    reader.readAsText(file, 'UTF-8');
                });
            }
            if (!extracted.trim()) {
                setError('No text could be extracted from this file. For scanned PDFs, please paste the text manually.');
            } else {
                setText(extracted);
                setUploadedFile(file.name);
            }
        } catch (err: any) {
            setError(err?.message || 'Failed to read file. Try pasting the text manually.');
        } finally {
            setFileLoading(false);
            if (fileRef.current) fileRef.current.value = '';
        }
    }

    async function handleAnalyse() {
        setLoading(true);
        setError('');
        startStageAnimation();
        try {
            const newReqs = await analyseDocuments(caseObj, text, mode, language);
            stopStageAnimation();
            setStageIdx(ANALYSIS_STAGES.length - 1);
            // Brief pause so user sees 100%
            await new Promise((r) => setTimeout(r, 400));
            onComplete(newReqs);
        } catch (err: any) {
            stopStageAnimation();
            setError(err?.message || 'AI analysis failed. Please try again.');
        } finally {
            setLoading(false);
        }
    }

    const currentStage = ANALYSIS_STAGES[stageIdx];

    return (
        <div
            style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                background: 'rgba(0,0,0,0.55)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', zIndex: 1200, padding: 16,
            }}
            onClick={loading ? undefined : onClose}
        >
            <div
                style={{
                    background: T.bg, borderRadius: 14, border: `1px solid ${T.border}`,
                    width: '100%', maxWidth: 560, maxHeight: '90vh', overflow: 'auto',
                    boxShadow: '0 8px 40px rgba(0,0,0,0.35)',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{
                    position: 'sticky', top: 0, background: T.bg,
                    borderBottom: `1px solid ${T.border}`, padding: '14px 20px',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 1,
                }}>
                    <div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: T.text }}>🔍 Scan Documents</div>
                        <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>AI-powered document gap analysis · Multilingual</div>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={loading}
                        style={{ background: 'none', border: 'none', color: T.textMuted, cursor: loading ? 'not-allowed' : 'pointer', fontSize: 20, lineHeight: 1, opacity: loading ? 0.4 : 1 }}
                    >✕</button>
                </div>

                <div style={{ padding: '20px' }}>
                    {/* Practice Insights (Point 8 Learning System) */}
                    {(() => {
                        const store = useSettingsStore.getState();
                        const insights = store.getTopDefects(caseObj.caseType || caseObj.caseTitle || '', 3);
                        if (insights.length === 0) return null;
                        return (
                            <div style={{
                                background: 'linear-gradient(135deg, rgba(201,168,76,0.1), rgba(155,123,40,0.05))',
                                border: '1px solid #E8D18A', borderRadius: 10, padding: '10px 14px', marginBottom: 20,
                            }}>
                                <div style={{ fontSize: 11, fontWeight: 800, color: '#92400E', letterSpacing: 0.8, marginBottom: 6, textTransform: 'uppercase' }}>
                                    💡 Practice Insights for {caseObj.caseType || 'this case type'}
                                </div>
                                <div style={{ fontSize: 12, color: '#B45309', lineHeight: 1.4 }}>
                                    Based on past cases, attorneys often miss these:
                                    <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                                        {insights.map((ins, i) => (
                                            <li key={i}><b>{ins.documentName}</b> (often {ins.status})</li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        );
                    })()}

                    {/* Mode toggle */}
                    <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, letterSpacing: 0.8, marginBottom: 8, textTransform: 'uppercase' }}>Filing Mode</div>
                        <div style={{ display: 'flex', gap: 0, borderRadius: 8, overflow: 'hidden', border: `1px solid ${T.border}` }}>
                            {(['Before Filing', 'After Filing'] as DocFilingMode[]).map((m) => (
                                <button
                                    key={m}
                                    onClick={() => setMode(m)}
                                    disabled={loading}
                                    style={{
                                        flex: 1, padding: '9px 12px', border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
                                        fontSize: 13, fontWeight: 700,
                                        background: mode === m ? 'linear-gradient(135deg,#C9A84C,#9B7B28)' : T.surface,
                                        color: mode === m ? '#fff' : T.textSub,
                                        transition: 'all 0.15s',
                                    }}
                                >
                                    {m === 'Before Filing' ? '📤 Before Filing' : '📥 After Filing'}
                                </button>
                            ))}
                        </div>
                        <div style={{ fontSize: 12, color: T.textMuted, marginTop: 8 }}>
                            {mode === 'Before Filing'
                                ? '📝 Upload or paste documents received from client to detect what\'s missing before filing.'
                                : '🏛️ Upload office report, paper book, or court orders to detect defects and compliance gaps.'
                            }
                        </div>
                    </div>

                    {/* Language selector */}
                    <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, letterSpacing: 0.8, marginBottom: 6, textTransform: 'uppercase' }}>
                            Document Language
                        </div>
                        <select
                            value={language}
                            onChange={(e) => setLanguage(e.target.value)}
                            disabled={loading}
                            style={{
                                width: '100%', padding: '9px 12px', borderRadius: 8,
                                border: `1px solid ${T.border}`, fontSize: 13, fontWeight: 600,
                                color: T.text, background: T.surface, outline: 'none', cursor: 'pointer',
                                opacity: loading ? 0.6 : 1,
                            }}
                        >
                            {LANGUAGES.map((l) => (
                                <option key={l.value} value={l.value}>{l.label}</option>
                            ))}
                        </select>
                        <div style={{ fontSize: 11, color: T.textMuted, marginTop: 5 }}>
                            🌐 AI will read and analyse text in the selected language — Hindi, Marathi, Tamil and other Indian languages supported.
                        </div>
                    </div>

                    {/* File upload */}
                    <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, letterSpacing: 0.8, marginBottom: 6, textTransform: 'uppercase' }}>
                            Upload Document (PDF / Text)
                        </div>
                        <button
                            onClick={() => !loading && !fileLoading && fileRef.current?.click()}
                            disabled={loading || fileLoading}
                            style={{
                                width: '100%', padding: '10px 14px', borderRadius: 8,
                                border: `2px dashed ${fileLoading ? '#C9A84C' : uploadedFile ? '#86EFAC' : T.border}`,
                                background: fileLoading ? 'rgba(201,168,76,0.06)' : uploadedFile ? '#F0FDF4' : T.surface,
                                color: uploadedFile ? '#15803D' : T.textSub,
                                fontSize: 13, fontWeight: 600,
                                cursor: loading || fileLoading ? 'not-allowed' : 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                transition: 'all 0.2s',
                            }}
                        >
                            {fileLoading ? (
                                <>
                                    <Spinner size={16} color="#C9A84C" />
                                    Extracting text from file…
                                </>
                            ) : uploadedFile ? (
                                <>✅ {uploadedFile}</>
                            ) : (
                                <>📎 Click to upload PDF or text file</>
                            )}
                        </button>
                        <input ref={fileRef} type="file" accept=".pdf,.txt,.doc,.docx" style={{ display: 'none' }} onChange={handleFileChange} />
                        {uploadedFile && (
                            <div style={{ fontSize: 11, color: '#15803D', marginTop: 4 }}>
                                Text extracted — review or edit below before analysing.
                            </div>
                        )}
                    </div>

                    {/* Paste text */}
                    <div style={{ marginBottom: 20 }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, letterSpacing: 0.8, marginBottom: 6, textTransform: 'uppercase' }}>
                            Or Paste Text
                        </div>
                        <textarea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            disabled={loading}
                            rows={6}
                            placeholder={mode === 'Before Filing'
                                ? 'Paste a list of documents received from client, or leave blank to analyse based on case type rules only…\n\nHindi/regional language text supported — e.g. याचिका, वकालतनामा, न्यायालय आदेश…'
                                : 'Paste the office report text, defect list, or court order text here…\n\nHindi/regional language text supported — e.g. कमी रिपोर्ट, आपत्तियां…'
                            }
                            style={{
                                width: '100%', padding: '10px 12px', borderRadius: 8,
                                border: `1px solid ${T.border}`, fontSize: 13, color: T.text,
                                resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                                fontFamily: 'inherit', lineHeight: 1.6, background: T.bg,
                                opacity: loading ? 0.7 : 1,
                            }}
                        />
                        <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>
                            Supports Hindi (हिन्दी), Marathi, Tamil, Telugu, Kannada, Malayalam, Gujarati, Bengali, Punjabi, Urdu
                        </div>
                    </div>

                    {error && (
                        <div style={{
                            background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8,
                            padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#DC2626',
                        }}>
                            ⚠️ {error}
                        </div>
                    )}

                    {/* AI Analysis Progress */}
                    {loading && (
                        <div style={{
                            background: 'linear-gradient(135deg, rgba(201,168,76,0.1), rgba(155,123,40,0.05))',
                            border: '1px solid #E8D18A', borderRadius: 10,
                            padding: '14px 16px', marginBottom: 14,
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                                <Spinner size={18} color="#9B7B28" />
                                <div style={{ fontSize: 13, fontWeight: 700, color: '#78350F' }}>
                                    {currentStage.label}
                                </div>
                            </div>
                            {/* Progress bar */}
                            <div style={{ height: 6, borderRadius: 3, background: 'rgba(155,123,40,0.15)', overflow: 'hidden' }}>
                                <div style={{
                                    height: '100%', borderRadius: 3,
                                    background: 'linear-gradient(90deg,#C9A84C,#9B7B28)',
                                    width: `${currentStage.pct}%`,
                                    transition: 'width 1.2s ease',
                                }} />
                            </div>
                            <div style={{ fontSize: 11, color: '#B45309', marginTop: 6 }}>
                                This may take 10–30 seconds. Do not close the modal.
                            </div>
                        </div>
                    )}

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 10 }}>
                        <button
                            onClick={onClose}
                            disabled={loading}
                            style={{
                                flex: 1, padding: '10px 14px', borderRadius: 8, border: `1px solid ${T.border}`,
                                background: T.surface, color: T.textSub, fontSize: 14, fontWeight: 600,
                                cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1,
                            }}
                        >Cancel</button>
                        <button
                            onClick={handleAnalyse}
                            disabled={loading || fileLoading}
                            style={{
                                flex: 2, padding: '10px 14px', borderRadius: 8, border: 'none',
                                background: (loading || fileLoading) ? '#D1D5DB' : 'linear-gradient(135deg,#C9A84C,#9B7B28)',
                                color: '#fff', fontSize: 14, fontWeight: 700,
                                cursor: (loading || fileLoading) ? 'not-allowed' : 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                            }}
                        >
                            {loading ? (
                                <><Spinner size={16} color="#fff" /> Analysing…</>
                            ) : fileLoading ? (
                                <><Spinner size={16} color="#fff" /> Reading file…</>
                            ) : (
                                '✨ Analyse with AI →'
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

type TabKey = 'missing' | 'uploaded' | 'requests' | 'completed';

export function DocumentsSection({
    selected,
    onUpdate,
}: {
    selected: any;
    onUpdate: (c: any) => void;
}) {
    const { T } = useApp();
    const [activeTab, setActiveTab]         = useState<TabKey>('missing');
    const [reqs, setReqs]                   = useState<DocumentRequirement[]>([]);
    const [uploadedDocs, setUploadedDocs]   = useState<UploadedDocumentMeta[]>([]);
    const [showScan, setShowScan]           = useState(false);
    const [showAiReport, setShowAiReport]   = useState(false);
    const [showFullReport, setShowFullReport] = useState(false);
    const [uploadSource, setUploadSource]   = useState<DocUploadSource>('Upload');
    const uploadFileRef                     = useRef<HTMLInputElement>(null);
    const [showManualForm, setShowManualForm] = useState(false);

    const caseId = selected?.id;

    // Load from localStorage when case changes
    useEffect(() => {
        if (!caseId) return;
        setReqs(loadDocReqs(caseId));
        setUploadedDocs(loadUploadedDocs(caseId));
    }, [caseId]);

    function refresh() {
        if (!caseId) return;
        setReqs(loadDocReqs(caseId));
        setUploadedDocs(loadUploadedDocs(caseId));
    }

    // Derived lists
    const pendingReqs   = reqs.filter((r) => r.status === 'Missing' || r.status === 'Incorrect' || r.status === 'Incomplete');
    const completedReqs = reqs.filter((r) => r.status === 'Complete' || r.status === 'Received');
    const requestsSent  = reqs.filter((r) => r.autoMessageSent);
    const overdueList   = getOverdueFollowUps(reqs);
    const hasCritical   = pendingReqs.some((r) => r.priority === 'Critical');

    const missingCount   = reqs.filter((r) => r.status === 'Missing').length;
    const incorrectCount = reqs.filter((r) => r.status === 'Incorrect').length;
    const incompleteCount = reqs.filter((r) => r.status === 'Incomplete').length;

    function handleScanComplete(newReqs: DocumentRequirement[]) {
        setShowScan(false);
        // Auto-create tasks for Critical/Important requirements
        if (newReqs.length > 0) {
            const newTasks = createTasksForRequirements(newReqs, selected);
            if (newTasks.length > 0) {
                const existingTasks = selected.tasks || [];
                onUpdate({ ...selected, tasks: [...existingTasks, ...newTasks] });
            }
        }
        refresh();
    }

    function handleMarkComplete(reqId: string) {
        setReqs((prev) => prev.map((r) => r.id === reqId ? { ...r, status: 'Complete' as const, resolvedAt: new Date().toISOString() } : r));
    }

    function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file || !caseId) return;
        const { uploadedDoc, matchedReq } = processUploadedDocument(
            caseId,
            { name: file.name, size: file.size, type: file.type },
            uploadSource
        );
        setUploadedDocs((prev) => [...prev, uploadedDoc]);
        if (matchedReq) {
            setReqs((prev) => prev.map((r) => r.id === matchedReq.id
                ? { ...r, status: 'Received' as const, resolvedAt: new Date().toISOString(), uploadedDocId: uploadedDoc.id }
                : r
            ));
        }
        if (uploadFileRef.current) uploadFileRef.current.value = '';
    }

    function handleResendFollowUp(followUpId: string, reqId: string) {
        markFollowUpSent(caseId, reqId, followUpId);
        refresh();
    }

    function handleManualAdd(name: string, priority: DocPriority) {
        const id = `req_man_${Date.now()}`;
        const newReq: DocumentRequirement = {
            id,
            caseId,
            documentName: name,
            status: 'Missing',
            priority,
            source: 'User',
            requestedFrom: 'Client',
            deadline: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
            autoMessageSent: false,
            filingMode: 'After Filing', // default for manual add
            detectedAt: new Date().toISOString(),
            followUps: [],
        };
        const updated = [...reqs, newReq];
        saveDocReqs(caseId, updated);
        setReqs(updated);
        setShowManualForm(false);
    }

    async function handleNotifyAll() {
        if (!caseId) return;
        const missing = pendingReqs.filter(r => !r.autoMessageSent);
        if (missing.length === 0) {
            alert('No new missing documents to notify.');
            return;
        }

        const caseRef = selected.caseNumber || `Diary ${selected.diaryNumber}/${selected.diaryYear}`;
        let msg = `*Lex Tigress | Document Update*\n\nDear Client, we have identified multiple missing documents for your case *${caseRef}*:\n\n`;
        missing.forEach((r, i) => {
            const statusLabel = r.status === 'Missing' ? '' : ` [${r.status}]`;
            msg += `${i + 1}. *${r.documentName}*${statusLabel} — ${r.priority}\n`;
        });
        msg += `\nPlease share these as soon as possible via WhatsApp or Email.\n\n— Lex Tigress Team`;

        try {
            // Ensure we have a client_id on the case
            if (!selected.client_id) {
                alert('No client contact linked to this case.\n\nPlease go to the Client Contact section in case details and add the client\'s WhatsApp number before sending.');
                return;
            }

            // Loop and send individually - to log each missing piece, OR we could build a generic message
            // Wait for all to send
            await Promise.all(missing.map(r => recordWhatsAppSent(caseId, r.id, 'Client', { id: selected.client_id, teamId: selected.team_id })));
            
            alert(`Sent ${missing.length} missing document notifications via Twilio.`);
        } catch (error) {
            console.error('[Twilio] Error auto-sending all missing documents:', error);
            alert('Failed to send all notifications via Twilio.');
        } finally {
            refresh();
        }
    }

    const tabs: { key: TabKey; label: string; count: number }[] = [
        { key: 'missing',   label: 'Missing',         count: pendingReqs.length },
        { key: 'uploaded',  label: 'Uploaded',         count: uploadedDocs.length },
        { key: 'requests',  label: 'Requests Sent',    count: requestsSent.length },
        { key: 'completed', label: 'Completed',        count: completedReqs.length },
    ];

    const tabBadgeColor: Record<TabKey, string> = {
        missing:   '#DC2626',
        uploaded:  '#2A7BD4',
        requests:  '#D97706',
        completed: '#16A34A',
    };

    return (
        <div style={{
            background: T.bg, borderRadius: 12, border: `1px solid ${T.border}`,
            padding: '14px 16px', boxShadow: '0 1px 4px rgba(15,28,63,0.08)', marginBottom: 10,
        }}>
            {/* ── Section Header ── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: hasCritical || reqs.length > 0 ? 12 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                    <div style={{
                        width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(135deg,#C9A84C,#9B7B28)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0,
                    }}>📄</div>
                    <div>
                        <div style={{ fontSize: 13, fontWeight: 800, color: T.text, letterSpacing: 0.8 }}>DOCUMENTS</div>
                        {reqs.length > 0 ? (
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                                {missingCount > 0    && <span style={{ fontSize: 10, fontWeight: 700, color: '#DC2626', background: '#FEE2E2', padding: '1px 6px', borderRadius: 10 }}>{missingCount} Missing</span>}
                                {incorrectCount > 0  && <span style={{ fontSize: 10, fontWeight: 700, color: '#D97706', background: '#FEF3C7', padding: '1px 6px', borderRadius: 10 }}>{incorrectCount} Incorrect</span>}
                                {incompleteCount > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: '#B45309', background: '#FEF3C7', padding: '1px 6px', borderRadius: 10 }}>{incompleteCount} Incomplete</span>}
                                {completedReqs.length > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: '#16A34A', background: '#DCFCE7', padding: '1px 6px', borderRadius: 10 }}>{completedReqs.length} OK</span>}
                            </div>
                        ) : (
                            <div style={{ fontSize: 12, color: T.textMuted }}>No scan yet — click Scan to detect gaps</div>
                        )}
                    </div>
                </div>
                <button
                    onClick={() => setShowScan(true)}
                    style={{
                        padding: '7px 14px', borderRadius: 8, border: 'none',
                        background: 'linear-gradient(135deg,#C9A84C,#9B7B28)', color: '#fff',
                        fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
                        display: 'flex', alignItems: 'center', gap: 6,
                    }}
                >
                    🔍 Scan
                </button>
                <button
                    onClick={() => setShowFullReport(true)}
                    disabled={reqs.length === 0}
                    style={{
                        padding: '7px 14px', borderRadius: 8, border: `1px solid ${T.border}`,
                        background: T.surface, color: T.text,
                        fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
                        display: 'flex', alignItems: 'center', gap: 6,
                        opacity: reqs.length === 0 ? 0.5 : 1
                    }}
                >
                    📑 AI Report
                </button>
            </div>

            {/* ── Critical Alert Banner ── */}
            {hasCritical && (
                <div style={{
                    background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 9,
                    padding: '10px 14px', marginBottom: 12,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                    <div>
                        <div style={{ fontSize: 12, fontWeight: 800, color: '#991B1B', letterSpacing: 0.5 }}>
                            ⚠️ {pendingReqs.filter((r) => r.priority === 'Critical').length} FILING BLOCKER{pendingReqs.filter((r) => r.priority === 'Critical').length !== 1 ? 'S' : ''} DETECTED
                        </div>
                        <div style={{ fontSize: 11, color: '#B91C1C', marginTop: 2 }}>
                            Resolve before next hearing
                            {selected.nextHearingDate && (() => {
                                const d = daysUntil(selected.nextHearingDate);
                                return d !== null ? ` · ${d < 0 ? 'PASSED' : `${d} day${d !== 1 ? 's' : ''} left`}` : '';
                            })()}
                        </div>
                    </div>
                    <span style={{ fontSize: 22 }}>🚨</span>
                </div>
            )}

            {/* ── Overdue Follow-ups Banner ── */}
            {overdueList.length > 0 && (
                <div style={{
                    background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 9,
                    padding: '8px 14px', marginBottom: 12, fontSize: 12,
                    color: '#B45309', fontWeight: 600,
                }}>
                    ⏰ {overdueList.length} follow-up{overdueList.length !== 1 ? 's' : ''} overdue — switch to "Requests Sent" tab to resend
                </div>
            )}

            {reqs.length === 0 && uploadedDocs.length === 0 ? (
                /* ── Empty State ── */
                <div style={{
                    textAlign: 'center', padding: '32px 20px',
                    background: T.surface, borderRadius: 10, border: `1px dashed ${T.border}`,
                }}>
                    <div style={{ fontSize: 36, marginBottom: 12 }}>📄</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 6 }}>No Document Scan Yet</div>
                    <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 20, lineHeight: 1.5 }}>
                        Click <b>Scan</b> to let AI detect missing, incorrect, or incomplete documents based on SC filing rules and any documents you've received.
                    </div>
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                        <div style={{ fontSize: 12, color: T.textMuted, background: T.bg, padding: '6px 12px', borderRadius: 20, border: `1px solid ${T.border}` }}>
                            📤 Before Filing — client docs
                        </div>
                        <div style={{ fontSize: 12, color: T.textMuted, background: T.bg, padding: '6px 12px', borderRadius: 20, border: `1px solid ${T.border}` }}>
                            📥 After Filing — office report/orders
                        </div>
                    </div>
                </div>
            ) : (
                <>
                    {/* ── Tab Bar ── */}
                    <div style={{
                        display: 'flex', gap: 0, borderRadius: 9, overflow: 'hidden',
                        border: `1px solid ${T.border}`, marginBottom: 14,
                    }}>
                        {tabs.map((tab) => (
                            <button
                                key={tab.key}
                                onClick={() => setActiveTab(tab.key)}
                                style={{
                                    flex: 1, padding: '8px 6px', border: 'none', cursor: 'pointer',
                                    fontSize: 11, fontWeight: 700,
                                    background: activeTab === tab.key ? 'linear-gradient(135deg,#C9A84C,#9B7B28)' : T.surface,
                                    color: activeTab === tab.key ? '#fff' : T.textSub,
                                    transition: 'all 0.15s',
                                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                                }}
                            >
                                {tab.label}
                                {tab.count > 0 && (
                                    <span style={{
                                        fontSize: 10, fontWeight: 800,
                                        background: activeTab === tab.key ? 'rgba(255,255,255,0.25)' : tabBadgeColor[tab.key] + '20',
                                        color: activeTab === tab.key ? '#fff' : tabBadgeColor[tab.key],
                                        borderRadius: 10, padding: '0 5px', minWidth: 16, textAlign: 'center',
                                    }}>
                                        {tab.count}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>

                    {/* ── TAB CONTENT ── */}

                    {/* MISSING DOCUMENTS TAB */}
                    {activeTab === 'missing' && (
                        <div>
                            {/* AI Report Panel */}
                            {pendingReqs.length > 0 && (
                                <div style={{
                                    background: 'linear-gradient(135deg, rgba(201,168,76,0.08), rgba(155,123,40,0.04))',
                                    border: '1px solid #E8D18A', borderRadius: 9, padding: '12px 14px', marginBottom: 14,
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ fontSize: 12, fontWeight: 800, color: '#92400E', letterSpacing: 0.5 }}>
                                            ✨ AI ANALYSIS REPORT
                                        </div>
                                        <button
                                            onClick={() => setShowAiReport((v) => !v)}
                                            style={{ background: 'none', border: 'none', color: '#B45309', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                                        >
                                            {showAiReport ? '▲ Hide' : '▼ View'}
                                        </button>
                                    </div>
                                    <div style={{ fontSize: 12, color: '#B45309', marginTop: 4 }}>
                                        {pendingReqs.length} issue{pendingReqs.length !== 1 ? 's' : ''} need attention
                                    </div>
                                    {showAiReport && (
                                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #E8D18A' }}>
                                            <div style={{ marginBottom: 12 }}>
                                                <div style={{ fontSize: 11, fontWeight: 800, color: '#92400E', letterSpacing: 0.5, marginBottom: 6 }}>SUMMARY OF GAPS</div>
                                                {pendingReqs.map((r, i) => (
                                                    <div key={r.id} style={{ marginBottom: 16, paddingBottom: 12, borderBottom: i < pendingReqs.length - 1 ? `1px solid ${T.border}` : 'none' }}>
                                                        <div style={{ fontSize: 13, fontWeight: 800, color: '#78350F', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                                                            <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#92400E20', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>{i + 1}</span>
                                                            {r.documentName} 
                                                            <span style={{ 
                                                                fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 4,
                                                                background: r.priority === 'Critical' ? '#FEE2E2' : '#FEF3C7',
                                                                color: r.priority === 'Critical' ? '#DC2626' : '#92400E',
                                                                marginLeft: 'auto'
                                                            }}>
                                                                {r.priority.toUpperCase()}
                                                            </span>
                                                        </div>
                                                        <div style={{ marginLeft: 30 }}>
                                                            {r.whyImportant && (
                                                                <div style={{ fontSize: 12, color: '#92400E', marginBottom: 6, lineHeight: 1.4 }}>
                                                                    <b>📜 Significance:</b> {r.whyImportant}
                                                                </div>
                                                            )}
                                                            {r.riskIfMissing && (
                                                                <div style={{ fontSize: 12, color: '#C2410C', lineHeight: 1.4 }}>
                                                                    <b>🚨 Risk:</b> {r.riskIfMissing}
                                                                </div>
                                                            )}
                                                            <div style={{ fontSize: 11, color: '#B45309', marginTop: 6, opacity: 0.8 }}>
                                                                Source: {r.source} {r.filingStage ? `· Stage: ${r.filingStage}` : ''}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Tab Actions */}
                            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                                <button
                                    onClick={handleNotifyAll}
                                    disabled={pendingReqs.filter(r => !r.autoMessageSent).length === 0}
                                    style={{
                                        flex: 1, padding: '7px 12px', borderRadius: 8,
                                        background: '#25D366', color: '#fff',
                                        border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                        opacity: pendingReqs.filter(r => !r.autoMessageSent).length === 0 ? 0.5 : 1
                                    }}
                                >
                                    ⚡ Send All on WhatsApp
                                </button>
                                <button
                                    onClick={() => setShowManualForm(v => !v)}
                                    style={{
                                        padding: '7px 12px', borderRadius: 8,
                                        background: T.surface, color: T.textSub,
                                        border: `1px solid ${T.border}`, fontSize: 12, fontWeight: 700, cursor: 'pointer'
                                    }}
                                >
                                    {showManualForm ? '✕' : '+ Manual'}
                                </button>
                            </div>

                            {/* Manual Add Form */}
                            {showManualForm && (
                                <ManualAddForm 
                                    onAdd={handleManualAdd} 
                                    onCancel={() => setShowManualForm(false)}
                                    T={T}
                                />
                            )}

                            {sortReqs(pendingReqs).map((req) => (
                                <DocRequirementCard
                                    key={req.id}
                                    req={req}
                                    caseObj={selected}
                                    T={T}
                                    onMarkComplete={handleMarkComplete}
                                    onRefresh={refresh}
                                />
                            ))}

                            {pendingReqs.length === 0 && (
                                <div style={{ textAlign: 'center', padding: '24px', color: T.textMuted, fontSize: 13 }}>
                                    ✅ All documents accounted for — no missing items detected.
                                </div>
                            )}
                        </div>
                    )}

                    {/* UPLOADED DOCUMENTS TAB */}
                    {activeTab === 'uploaded' && (
                        <div>
                            {/* Upload Controls */}
                            <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                                <select
                                    value={uploadSource}
                                    onChange={(e) => setUploadSource(e.target.value as DocUploadSource)}
                                    style={{
                                        padding: '7px 10px', borderRadius: 7, border: `1px solid ${T.border}`,
                                        fontSize: 12, fontWeight: 600, color: T.text, background: T.surface, outline: 'none',
                                    }}
                                >
                                    <option value="Upload">📎 Upload</option>
                                    <option value="WhatsApp">💬 WhatsApp</option>
                                    <option value="Email">📧 Email</option>
                                    <option value="System">🔄 System</option>
                                </select>
                                <button
                                    onClick={() => uploadFileRef.current?.click()}
                                    style={{
                                        flex: 1, padding: '7px 14px', borderRadius: 7, border: `2px dashed ${T.border}`,
                                        background: T.surface, color: T.textSub, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                                    }}
                                >
                                    + Upload Document
                                </button>
                                <input ref={uploadFileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" style={{ display: 'none' }} onChange={handleFileUpload} />
                            </div>

                            {/* Auto-match result */}
                            {uploadedDocs.filter((d) => d.linkedRequirementId).length > 0 && (
                                <div style={{
                                    background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 8,
                                    padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#15803D', fontWeight: 600,
                                }}>
                                    ✅ {uploadedDocs.filter((d) => d.linkedRequirementId).length} file{uploadedDocs.filter((d) => d.linkedRequirementId).length !== 1 ? 's' : ''} auto-matched to pending requirements
                                </div>
                            )}

                            {uploadedDocs.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '24px', color: T.textMuted, fontSize: 13 }}>
                                    No documents uploaded yet. Upload files received from client or court.
                                </div>
                            ) : (
                                uploadedDocs.map((doc) => {
                                    const linkedReq = reqs.find((r) => r.id === doc.linkedRequirementId);
                                    return (
                                        <div key={doc.id} style={{
                                            background: doc.linkedRequirementId ? '#F0FDF4' : T.surface,
                                            border: `1px solid ${doc.linkedRequirementId ? '#86EFAC' : T.borderSoft}`,
                                            borderRadius: 9, padding: '10px 12px', marginBottom: 8,
                                        }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 3 }}>
                                                        📎 {doc.documentName}
                                                    </div>
                                                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                                        <span style={{ fontSize: 11, color: T.textMuted }}>{doc.fileType} · {doc.fileSizeKB} KB</span>
                                                        <span style={{ fontSize: 11, color: T.textMuted }}>via {doc.uploadSource}</span>
                                                        <span style={{ fontSize: 11, color: T.textMuted }}>{fmtDT(doc.uploadedAt)}</span>
                                                    </div>
                                                </div>
                                                {doc.linkedRequirementId ? (
                                                    <span style={{ fontSize: 10, fontWeight: 700, background: '#DCFCE7', color: '#16A34A', padding: '2px 7px', borderRadius: 4, whiteSpace: 'nowrap', marginLeft: 8 }}>
                                                        ✅ Matched
                                                    </span>
                                                ) : (
                                                    <span style={{ fontSize: 10, fontWeight: 700, background: T.surface, color: T.textMuted, padding: '2px 7px', borderRadius: 4, marginLeft: 8 }}>
                                                        Unmatched
                                                    </span>
                                                )}
                                            </div>
                                            {linkedReq && (
                                                <div style={{ fontSize: 11, color: '#15803D', marginTop: 4 }}>
                                                    Matched to: {linkedReq.documentName}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    )}

                    {/* REQUESTS SENT TAB */}
                    {activeTab === 'requests' && (
                        <div>
                            {overdueList.length > 0 && (
                                <div style={{
                                    background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8,
                                    padding: '10px 14px', marginBottom: 14, fontSize: 12, color: '#DC2626', fontWeight: 700,
                                }}>
                                    ⏰ {overdueList.length} follow-up{overdueList.length !== 1 ? 's' : ''} overdue — client has not responded
                                </div>
                            )}

                            {requestsSent.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '24px', color: T.textMuted, fontSize: 13 }}>
                                    No WhatsApp requests sent yet. Use the 📲 buttons on Missing documents to message client or associate.
                                </div>
                            ) : (
                                requestsSent.map((req) => {
                                    const overdueForThisReq = overdueList.filter((o) => o.req.id === req.id);
                                    const isOverdueReq = overdueForThisReq.length > 0;
                                    return (
                                        <div key={req.id} style={{
                                            background: isOverdueReq ? '#FEF2F2' : T.surface,
                                            border: `1px solid ${isOverdueReq ? '#FECACA' : T.borderSoft}`,
                                            borderRadius: 9, padding: '10px 12px', marginBottom: 8,
                                        }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                                                <div>
                                                    <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>
                                                        📨 {req.documentName}
                                                        {req.followUps?.some(fu => fu.escalated) && (
                                                            <span style={{ marginLeft: 6, color: '#DC2626', fontSize: 10, fontWeight: 800 }}>‼️ ESCALATED</span>
                                                        )}
                                                    </div>
                                                    <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>
                                                        {req.requestedFrom} · {req.priority}
                                                        {req.clientMessageSentAt && ` · Client: ${fmtDT(req.clientMessageSentAt)}`}
                                                        {req.associateMessageSentAt && ` · Associate: ${fmtDT(req.associateMessageSentAt)}`}
                                                    </div>
                                                </div>
                                                {isOverdueReq ? (
                                                    <span style={{ fontSize: 10, fontWeight: 700, background: '#FEE2E2', color: '#DC2626', padding: '2px 7px', borderRadius: 4, whiteSpace: 'nowrap' }}>
                                                        ⚠️ Overdue
                                                    </span>
                                                ) : (
                                                    <span style={{ fontSize: 10, fontWeight: 700, background: '#DCFCE7', color: '#16A34A', padding: '2px 7px', borderRadius: 4, whiteSpace: 'nowrap' }}>
                                                        Sent
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{ display: 'flex', gap: 7 }}>
                                                {isOverdueReq && (
                                                    <button
                                                        onClick={() => handleResendFollowUp(overdueForThisReq[0].followUp.id, req.id)}
                                                        style={{
                                                            padding: '5px 12px', borderRadius: 7,
                                                            border: '1px solid #DC2626', background: 'rgba(220,38,38,0.05)',
                                                            color: '#DC2626', fontSize: 11, fontWeight: 800, cursor: 'pointer',
                                                        }}
                                                    >
                                                        🚨 Escalate via WhatsApp
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => { markRequirementComplete(caseId, req.id); handleMarkComplete(req.id); }}
                                                    style={{
                                                        padding: '5px 12px', borderRadius: 7,
                                                        border: '1px solid #D1D5DB', background: 'transparent',
                                                        color: '#16A34A', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                                                    }}
                                                >
                                                    ✅ Mark Received
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    )}

                    {/* COMPLETED TAB */}
                    {activeTab === 'completed' && (
                        <div>
                            {completedReqs.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '24px', color: T.textMuted, fontSize: 13 }}>
                                    No completed requirements yet.
                                </div>
                            ) : (
                                completedReqs.map((req) => (
                                    <div key={req.id} style={{
                                        background: '#F0FDF4', border: '1px solid #86EFAC',
                                        borderRadius: 9, padding: '10px 12px', marginBottom: 8,
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div>
                                                <div style={{ fontSize: 13, fontWeight: 700, color: '#15803D' }}>✅ {req.documentName}</div>
                                                <div style={{ fontSize: 11, color: '#16A34A', marginTop: 2 }}>
                                                    {req.status} · {req.resolvedAt ? fmtDT(req.resolvedAt) : ''}
                                                </div>
                                            </div>
                                            <span style={{ fontSize: 10, fontWeight: 700, background: '#DCFCE7', color: '#16A34A', padding: '2px 7px', borderRadius: 4 }}>
                                                {req.status.toUpperCase()}
                                            </span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </>
            )}

            {/* AI COMPLIANCE REPORT MODAL (Point 5 Multi-Layer Output) */}
            {showFullReport && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.6)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', zIndex: 1300, padding: 16,
                }} onClick={() => setShowFullReport(false)}>
                    <div style={{
                        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 700,
                        maxHeight: '90vh', overflow: 'auto', padding: 40, color: '#111827',
                        boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
                    }} onClick={e => e.stopPropagation()}>
                        {/* Report Header */}
                        <div style={{ textAlign: 'center', marginBottom: 30, borderBottom: '2px solid #F3F4F6', paddingBottom: 20 }}>
                            <div style={{ fontSize: 12, fontWeight: 800, color: '#9B7B28', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8 }}>AI Strategic Analysis</div>
                            <h2 style={{ fontSize: 26, fontWeight: 900, marginBottom: 4 }}>Document Compliance Report</h2>
                            <div style={{ fontSize: 14, color: '#6B7280' }}>Ref: {selected.caseNumber || `Diary ${selected.diaryNumber}/${selected.diaryYear}`} · {new Date().toLocaleDateString('en-IN')}</div>
                        </div>

                        {/* Executive Summary */}
                        <div style={{ marginBottom: 30 }}>
                            <h3 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ width: 8, height: 16, background: '#D97706', borderRadius: 2 }} />
                                Executive Summary
                            </h3>
                            <p style={{ fontSize: 14, lineHeight: 1.6, color: '#374151' }}>
                                Analysis of current case files and Supreme Court rules reveals <b>{reqs.filter(r => r.status !== 'Complete' && r.status !== 'Received').length}</b> outstanding compliance gaps. 
                                {reqs.some(r => r.priority === 'Critical' && r.status !== 'Complete') ? ' Several "Critical" blocks are detected which may prevent the registry from listing or accepting the matter.' : ' These gaps should be addressed to ensure case strength before the next listing.'}
                            </p>
                        </div>

                        {/* Gap Detailed Table */}
                        <div style={{ marginBottom: 30 }}>
                            <h3 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ width: 8, height: 16, background: '#D97706', borderRadius: 2 }} />
                                Detailed Findings & Risks
                            </h3>
                            <div style={{ border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden' }}>
                                {reqs.filter(r => r.status !== 'Complete' && r.status !== 'Received').map((r, i) => (
                                    <div key={r.id} style={{ 
                                        padding: '16px 20px', 
                                        borderBottom: i < reqs.length - 1 ? '1px solid #E5E7EB' : 'none',
                                        background: r.priority === 'Critical' ? '#FFFBEB' : 'white'
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                                            <span style={{ fontWeight: 800, fontSize: 14 }}>{i + 1}. {r.documentName}</span>
                                            <span style={{ 
                                                fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 4,
                                                background: r.priority === 'Critical' ? '#FEF2F2' : '#F3F4F6',
                                                color: r.priority === 'Critical' ? '#DC2626' : '#6B7280'
                                            }}>{r.priority.toUpperCase()}</span>
                                        </div>
                                        <div style={{ fontSize: 13, color: '#4B5563', lineHeight: 1.5 }}>
                                            <div style={{ marginBottom: 4 }}><b>Significance:</b> {r.whyImportant || 'Required for standard filing compliance.'}</div>
                                            <div><b>Risk:</b> {r.riskIfMissing || 'Possible registry rejection or delay in listing.'}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Footer / Call to action */}
                        <div style={{ textAlign: 'center', paddingTop: 20 }}>
                            <button 
                                onClick={() => window.print()}
                                style={{
                                    padding: '10px 24px', borderRadius: 10, border: 'none',
                                    background: '#111827', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer'
                                }}
                            >
                                🖨️ Print / Save as PDF
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── SCAN MODAL ── */}
            {showScan && (
                <ScanModal
                    caseObj={selected}
                    T={T}
                    onClose={() => setShowScan(false)}
                    onComplete={handleScanComplete}
                />
            )}
        </div>
    );
}

// ── MANUAL ADD FORM COMPONENT ──
function ManualAddForm({ onAdd, onCancel, T }: { onAdd: (n: string, p: DocPriority) => void; onCancel: () => void; T: any }) {
    const [name, setName] = useState('');
    const [prio, setPrio] = useState<DocPriority>('Important');

    return (
        <div style={{
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10,
            padding: '14px', marginBottom: 14, boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
        }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: T.textSub, marginBottom: 10, letterSpacing: 0.8 }}>ADD DOCUMENT REQUIREMENT</div>
            <input 
                type="text" 
                placeholder="e.g. Translated copy of FIR"
                value={name}
                onChange={e => setName(e.target.value)}
                style={{
                    width: '100%', padding: '8px 10px', borderRadius: 7, border: `1px solid ${T.border}`,
                    background: T.bg, color: T.text, fontSize: 13, marginBottom: 10, outline: 'none',
                    boxSizing: 'border-box'
                }}
            />
            <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                {(['Critical', 'Important', 'Optional'] as DocPriority[]).map(p => (
                    <button 
                        key={p}
                        onClick={() => setPrio(p)}
                        style={{
                            flex: 1, padding: '5px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                            border: `1px solid ${prio === p ? T.accentBorder : T.border}`,
                            background: prio === p ? T.accentBg : T.bg,
                            color: prio === p ? T.accentDark : T.textMuted,
                            cursor: 'pointer'
                        }}
                    >
                        {p}
                    </button>
                ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
                <button 
                    onClick={() => { if (name.trim()) onAdd(name.trim(), prio); }}
                    style={{
                        flex: 1, padding: '8px', borderRadius: 8, background: 'linear-gradient(135deg,#C9A84C,#9B7B28)',
                        color: '#fff', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer'
                    }}
                >
                    Add Requirement
                </button>
                <button 
                    onClick={onCancel}
                    style={{
                        padding: '8px 12px', borderRadius: 8, background: T.bg, color: T.textMuted,
                        border: `1px solid ${T.border}`, fontSize: 12, fontWeight: 600, cursor: 'pointer'
                    }}
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}
