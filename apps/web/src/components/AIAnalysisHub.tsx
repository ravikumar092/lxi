import { useState, useEffect } from 'react';
import { useApp } from '../AppContext';
import { loadAllDocReqs, loadCases } from '../services/localStorageService';
import { getOverdueFollowUps, markFollowUpSent } from '../services/missingDocService';
import { useSettingsStore } from '../store/settingsStore';
import type { DocumentRequirement } from '../types';

export default function AIAnalysisHub({ cases: initialCases }: { cases: any[] }) {
    const { T } = useApp();
    const [allReqs, setAllReqs] = useState<DocumentRequirement[]>([]);
    const [cases, setCases] = useState<any[]>(initialCases);
    const store = useSettingsStore();

    useEffect(() => {
        setAllReqs(loadAllDocReqs());
        setCases(loadCases());
    }, []);

    const refresh = () => {
        setAllReqs(loadAllDocReqs());
    };

    // Global Stats
    const stats = {
        missing:    allReqs.filter(r => r.status === 'Missing').length,
        incorrect:  allReqs.filter(r => r.status === 'Incorrect').length,
        incomplete: allReqs.filter(r => r.status === 'Incomplete').length,
        complete:   allReqs.filter(r => r.status === 'Complete' || r.status === 'Received').length,
    };

    // Overdue Follow-ups mapping with Case context
    const overdue = getOverdueFollowUps(allReqs).map(item => {
        const caseObj = cases.find(c => c.id === item.req.caseId);
        return { ...item, caseObj };
    });

    // Practice Insights from Learning System
    const topDefects = store.getTopDefects('', 10);

    return (
        <div style={{ padding: '30px 40px', maxWidth: 1200, margin: "0 auto", width: "100%" }}>
            <div style={{ marginBottom: 30 }}>
                <h1 style={{ fontSize: 24, fontWeight: 800, color: T.text, marginBottom: 8 }}>AI Analysis Hub</h1>
                <p style={{ fontSize: 14, color: T.textMuted }}>Global practice compliance, automated reminders, and practice-aware AI insights.</p>
            </div>

            {/* ── GLOBAL STATS ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, marginBottom: 40 }}>
                {[
                    { label: 'Missing Docs', count: stats.missing, color: '#DC2626', bg: '#FEF2F2' },
                    { label: 'Incorrect Docs', count: stats.incorrect, color: '#D97706', bg: '#FFFBEB' },
                    { label: 'Incomplete Docs', count: stats.incomplete, color: '#B45309', bg: '#FFFBEB' },
                    { label: 'Total Scanned', count: allReqs.length, color: '#2A7BD4', bg: '#F0F9FF' },
                ].map((s, i) => (
                    <div key={i} style={{
                        background: s.bg, border: `1px solid ${s.color}30`, borderRadius: 12, padding: '20px',
                        textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
                    }}>
                        <div style={{ fontSize: 32, fontWeight: 800, color: s.color, marginBottom: 4 }}>{s.count}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: s.color, opacity: 0.8, letterSpacing: 0.5, textTransform: 'uppercase' }}>{s.label}</div>
                    </div>
                ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 30 }}>
                {/* ── OVERDUE COMPLIANCE REMINDERS ── */}
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 15 }}>
                        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text }}>⏰ Compliance Reminders</h2>
                        <span style={{ fontSize: 12, background: '#FEF2F2', color: '#DC2626', padding: '2px 10px', borderRadius: 20, fontWeight: 700 }}>
                            {overdue.length} Action{overdue.length !== 1 ? 's' : ''} Needed
                        </span>
                    </div>
                    
                    {overdue.length === 0 ? (
                        <div style={{ padding: 40, background: T.surface, borderRadius: 12, border: `1px dashed ${T.border}`, textAlign: 'center', color: T.textMuted }}>
                            ✅ All reminders are up to date across all cases.
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {overdue.map(({ req, followUp, caseObj }, i) => (
                                <div key={i} style={{
                                    background: T.bg, border: `1px solid ${T.border}`, borderRadius: 12, padding: '14px 18px',
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                                }}>
                                    <div>
                                        <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{req.documentName}</div>
                                        <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>
                                            Case: <b>{caseObj?.caseNumber || 'Unknown'}</b> · {req.requestedFrom} · {req.priority}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            markFollowUpSent(caseObj.id, req.id, followUp.id);
                                            refresh();
                                        }}
                                        style={{
                                            padding: '8px 16px', borderRadius: 8, background: '#25D366', color: '#fff',
                                            border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer'
                                        }}
                                    >
                                        📲 Resend WhatsApp
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* ── PRACTICE LEARNING SYSTEM ── */}
                <div>
                    <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 15 }}>🧠 Practice Insights</h2>
                    <div style={{ background: 'linear-gradient(135deg, rgba(201,168,76,0.1), rgba(155,123,40,0.05))', borderRadius: 12, border: '1px solid #E8D18A', padding: '16px' }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: '#92400E', letterSpacing: 0.5, marginBottom: 12 }}>TOP REGISTRY DEFECTS</div>
                        
                        {topDefects.length === 0 ? (
                            <div style={{ fontSize: 12, color: '#B45309', fontStyle: 'italic' }}>Learning from your practice... defects will appear here as they are detected.</div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {topDefects.map((d, i) => (
                                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontSize: 13, fontWeight: 700, color: '#78350F' }}>{d.documentName}</div>
                                            <div style={{ fontSize: 11, color: '#B45309' }}>{d.caseType} · {d.status}</div>
                                        </div>
                                        <div style={{ fontSize: 14, fontWeight: 800, color: '#92400E' }}>{d.frequency}x</div>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div style={{ marginTop: 20, paddingTop: 15, borderTop: '1px solid #E8D18A', fontSize: 11, color: '#B45309', lineHeight: 1.5 }}>
                            💡 <b>Smart Tip:</b> These documents are frequently flagged by the Registry. Be extra careful when reviewing them.
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
