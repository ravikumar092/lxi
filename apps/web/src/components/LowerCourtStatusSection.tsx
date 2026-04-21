import { useState, useEffect, useRef } from 'react';
import { useApp } from '../AppContext';
import { fetchLowerCourtStatus, clearLowerCourtCache, isLowerCourtCached, isLowerCourtStale } from '../services/lowerCourtSyncService';
import { LowerCourtStatus } from '../types/hearingPrep';

// ── LOWER COURT STATUS SECTION ────────────────────────────────────────────────
export function LowerCourtStatusSection({ selected, onUpdate, fetchTrigger = 0 }: {
    selected: any;
    onUpdate: (c: any) => void;
    fetchTrigger?: number;
}) {
    const { T } = useApp();
    const [open, setOpen] = useState(false);
    const [status, setStatus] = useState<LowerCourtStatus | null>(
        selected?.lowerCourtStatus ?? null
    );
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fetched, setFetched] = useState(false);
    const [activeTab, setActiveTab] = useState<'overview' | 'history'>('overview');
    const [flagNote, setFlagNote] = useState('');
    const [showFlagForm, setShowFlagForm] = useState(false);
    const [manualCnr, setManualCnr] = useState('');
    const [showManualForm, setShowManualForm] = useState(false);
    const loadingRef = useRef(false);

    const scCnr = selected?.cnrNumber;
    const hasCached = scCnr ? isLowerCourtCached(scCnr) : false;
    const isStale = scCnr ? isLowerCourtStale(scCnr) : true;

    // ── LOAD ──────────────────────────────────────────────────────────────────
    const loadStatus = async (force = false) => {
        if (loadingRef.current) return;
        loadingRef.current = true;
        setLoading(true);
        setError(null);
        try {
            const hasEarlier = selected?.earlierCourtDetails && (
                Array.isArray(selected.earlierCourtDetails) ? selected.earlierCourtDetails.length > 0 : !!selected.earlierCourtDetails && selected.earlierCourtDetails !== '—'
            );
            
            const result = await fetchLowerCourtStatus(selected, force);
            if (result) {
                setStatus(result);
                onUpdate({ ...selected, lowerCourtStatus: result });
            } else if (force && !hasEarlier) {
                setError('No earlier court details found in SC record to sync from.');
            } else {
                setError('No lower court data found. Try manual CNR input.');
            }
        } catch (e: any) {
            setError(e?.message || 'Failed to fetch lower court status');
        } finally {
            setFetched(true);
            setLoading(false);
            loadingRef.current = false;
        }
    };

    const handleManualSync = async () => {
        const cnr = manualCnr.trim().toUpperCase();
        if (!cnr || cnr.length < 16) {
            setError('Please enter a valid 16-character CNR number');
            return;
        }
        loadingRef.current = true;
        setLoading(true);
        setError(null);
        try {
            const { fetchLowerCourtStatusByCNR } = await import('../services/lowerCourtSyncService');
            const result = await fetchLowerCourtStatusByCNR(cnr, 'Manual Link');
            if (result) {
                setStatus(result);
                onUpdate({ ...selected, lowerCourtStatus: result });
                setShowManualForm(false);
                setManualCnr('');
            } else {
                setError('No records found for this CNR. Verify the number.');
            }
        } catch (e: any) {
            setError(e?.message || 'Manual sync failed');
        } finally {
            setLoading(false);
            loadingRef.current = false;
        }
    };

    // Reset when selected case changes
    useEffect(() => {
        setOpen(false);
        setError(null);
        setFetched(false);
        loadingRef.current = false;
        setLoading(false);
        // Pre-populate from stored case data if present
        const stored = selected?.lowerCourtStatus ?? null;
        setStatus(stored);
        if (!stored) {
            // Auto-load only if earlierCourtDetails is present
            const hasEarlier = selected?.earlierCourtDetails && (
                Array.isArray(selected.earlierCourtDetails) ? selected.earlierCourtDetails.length > 0 : !!selected.earlierCourtDetails && selected.earlierCourtDetails !== '—'
            );
            if (hasEarlier || hasCached) loadStatus();
        } else {
            setFetched(true);
        }
    }, [selected?.id]);

    // External fetchTrigger (Fetch All button)
    useEffect(() => {
        if (fetchTrigger > 0 && !loadingRef.current) loadStatus(false);
    }, [fetchTrigger]);

    // ── FLAG / NOTE ───────────────────────────────────────────────────────────
    const handleFlag = () => {
        if (!status) return;
        const updated: LowerCourtStatus = {
            ...status,
            accuracyFlag: 'Incorrect',
            userNote: flagNote || 'Flagged as incorrect',
        };
        setStatus(updated);
        onUpdate({ ...selected, lowerCourtStatus: updated });
        setShowFlagForm(false);
        setFlagNote('');
        if (scCnr) clearLowerCourtCache(scCnr);
    };

    const handleClearFlag = () => {
        if (!status) return;
        const updated: LowerCourtStatus = { ...status, accuracyFlag: undefined, userNote: undefined };
        setStatus(updated);
        onUpdate({ ...selected, lowerCourtStatus: updated });
    };

    // ── FORMATTERS ────────────────────────────────────────────────────────────
    const fmtD = (d: string | null) => {
        if (!d) return '—';
        const dt = new Date(d);
        if (isNaN(dt.getTime())) return d;
        return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    const getDaysIndicator = (iso: string | null) => {
        if (!iso) return null;
        const today = new Date(); today.setHours(0,0,0,0);
        const d = new Date(iso); d.setHours(0,0,0,0);
        const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
        if (diff > 0) return { label: `in ${diff}d`, color: diff <= 7 ? '#C62828' : '#16A34A', bg: diff <= 7 ? '#FEF2F2' : '#F0FDF4' };
        if (diff === 0) return { label: 'Today', color: '#C62828', bg: '#FEF2F2' };
        return { label: `${Math.abs(diff)}d ago`, color: '#6B7280', bg: '#F3F4F6' };
    };

    // ── STATUS BADGE COLOURS ──────────────────────────────────────────────────
    const COURT_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
        'High Court': { bg: '#EFF6FF', text: '#1E40AF', border: '#BFDBFE' },
        'Trial Court': { bg: '#FEF3C7', text: '#92400E', border: '#FDE68A' },
        'District Court': { bg: '#F0FDF4', text: '#15803D', border: '#86EFAC' },
    };
    const ctStyle = status ? (COURT_TYPE_COLORS[status.courtType] || { bg: '#F3F4F6', text: '#6B7280', border: '#E5E7EB' }) : null;
    const sourceStyle: Record<string, string> = { 'API': '#16A34A', 'Derived': '#C9A84C', 'Scraped': '#2A7BD4', 'Manual': '#6B7280' };

    const hasData = !!status;
    const lastFetchedHuman = status?.lastFetchedAt
        ? new Date(status.lastFetchedAt).toLocaleString('en-IN', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
        : null;

    // ── RENDER ────────────────────────────────────────────────────────────────
    return (
        <div style={{ background: T.bg, borderRadius: 16, border: `1px solid ${status?.accuracyFlag ? '#EF4444' : T.border}`, padding: '16px 20px', boxShadow: '0 4px 20px rgba(0,0,0,0.06)', marginBottom: 12, transition: 'all 0.3s ease' }}>
            {/* ── HEADER / TOGGLE ── */}
            <div
                onClick={() => setOpen(o => !o)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, marginBottom: open ? 16 : 0, cursor: 'pointer', userSelect: 'none' }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 }}>
                    <div style={{ width: 42, height: 42, borderRadius: 12, background: 'linear-gradient(135deg, #1A3A6B, #2A7BD4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, boxShadow: '0 4px 10px rgba(26,58,107,0.2)' }}>
                        🏛️
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <div style={{ fontSize: 13, fontWeight: 900, color: T.text, letterSpacing: 1.2 }}>LOWER COURT STATUS</div>
                            {hasCached && !loading && (
                                <span style={{ fontSize: 10, fontWeight: 800, background: '#D1FAE5', color: '#06503C', padding: '2px 8px', borderRadius: 4, textTransform: 'uppercase' }}>Live Sync</span>
                            )}
                            {status?.accuracyFlag && (
                                <span style={{ fontSize: 10, fontWeight: 800, background: '#FEF2F2', color: '#B91C1C', padding: '2px 8px', borderRadius: 4, border: '1px solid #FCA5A5', textTransform: 'uppercase' }}>⚠ Flagged</span>
                            )}
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: loading ? '#2A7BD4' : error ? '#DC2626' : T.textMuted, marginTop: 4 }}>
                            {loading ? 'Synchronizing with eCourts…' :
                             error ? error :
                             hasData ? `${status!.courtType} · ${status!.courtName || status!.caseNumber}` :
                             fetched ? 'No linked court records' :
                             'Ready to sync earlier court details'}
                        </div>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    {!loading && (
                        <button
                            onClick={e => { e.stopPropagation(); loadStatus(true); }}
                            title="Force Refresh Sync"
                            style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: T.textMuted, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                            onMouseEnter={e => (e.currentTarget.style.background = T.surface)}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                            ↻
                        </button>
                    )}
                    <span style={{ fontSize: 12, color: T.textMuted, display: 'inline-block', transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}>▼</span>
                </div>
            </div>

            {/* ── BODY (shown when open) ── */}
            {open && (
                <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
                    <style>{`
                        @keyframes fadeIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
                    `}</style>

                    {/* Load prompt */}
                    {!hasData && !fetched && !loading && (
                        <div style={{ textAlign: 'center', padding: '30px 0', border: `2px dashed ${T.border}`, borderRadius: 12, background: T.surface }}>
                            <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
                            <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 6 }}>No Data Synchronized</div>
                            <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 20, maxWidth: 300, margin: '0 auto' }}>Sync with eCourts to fetch real-time hearing dates, orders, and bail status.</div>
                            <button
                                onClick={() => loadStatus()}
                                style={{ padding: '10px 24px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #1A3A6B, #2A7BD4)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 12px rgba(26,58,107,0.3)' }}
                            >
                                🏛️ Start Sync Now
                            </button>
                        </div>
                    )}

                    {/* Loading state */}
                    {loading && (
                        <div style={{ padding: '40px 0', textAlign: 'center' }}>
                            <div style={{ width: 40, height: 40, border: '3px solid #E2E8F0', borderTopColor: '#2A7BD4', borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 1s linear infinite' }} />
                            <div style={{ fontSize: 15, fontWeight: 700, color: '#2C3E50' }}>Fetching Legal Records...</div>
                            <div style={{ fontSize: 12, color: T.textMuted, marginTop: 4 }}>This may take a few seconds</div>
                            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                        </div>
                    )}

                    {/* Error state */}
                    {error && !loading && (
                        <div style={{ background: '#FEF2F2', border: '1px solid #FEE2E2', borderRadius: 12, padding: '16px', marginBottom: 16 }}>
                            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10 }}>
                                <span style={{ fontSize: 20 }}>⚠</span>
                                <div style={{ fontSize: 14, color: '#991B1B', fontWeight: 700 }}>Connection Error</div>
                            </div>
                            <div style={{ fontSize: 13, color: '#B91C1C', marginBottom: 14, lineHeight: 1.5 }}>{error}</div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button
                                    onClick={() => loadStatus(true)}
                                    style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#EF4444', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                                >
                                    Retry Connection
                                </button>
                                <button
                                    onClick={() => setShowManualForm(true)}
                                    style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #FCA5A5', background: '#fff', color: '#B91C1C', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                                >
                                    Enter CNR Manually
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Empty state / Manual Link Prompt */}
                    {!hasData && fetched && !loading && !showManualForm && (
                        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '24px', textAlign: 'center' }}>
                            <div style={{ fontSize: 32, marginBottom: 12 }}>🏗️</div>
                            <div style={{ fontSize: 15, fontWeight: 800, color: T.text, marginBottom: 6 }}>Auto-Sync Unavailable</div>
                            <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 20, lineHeight: 1.5 }}>We couldn't find a direct link in the SC records. Links are usually found in <code>earlierCourtDetails</code>.</div>
                            <button
                                onClick={() => setShowManualForm(true)}
                                style={{ padding: '10px 20px', borderRadius: 10, border: `1px solid ${T.border}`, background: '#fff', color: T.text, fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 5px rgba(0,0,0,0.05)' }}
                            >
                                🔍 Manually Link Case CNR
                            </button>
                        </div>
                    )}

                    {/* Manual Input Form */}
                    {showManualForm && (
                        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: '18px', marginBottom: 16, boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)' }}>
                            <div style={{ fontSize: 12, fontWeight: 900, color: T.text, marginBottom: 6, letterSpacing: 0.8 }}>MANUAL CASE LINKING</div>
                            <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 14 }}>Link a District or High Court case using its unique 16-character CNR number.</div>
                            <div style={{ display: 'flex', gap: 10 }}>
                                <input
                                    type="text"
                                    value={manualCnr}
                                    onChange={e => setManualCnr(e.target.value)}
                                    placeholder="e.g. MHPU010012342024"
                                    style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: `1px solid ${T.border}`, background: T.bg, color: T.text, fontSize: 14, fontWeight: 600, outline: 'none', transition: 'border-color 0.2s' }}
                                    onFocus={e => (e.target.style.borderColor = '#2A7BD4')}
                                    onBlur={e => (e.target.style.borderColor = T.border)}
                                />
                                <button
                                    onClick={handleManualSync}
                                    disabled={loading}
                                    style={{ padding: '0 20px', borderRadius: 10, border: 'none', background: '#2C3E50', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: loading ? 0.6 : 1, transition: 'background 0.2s' }}
                                >
                                    Link
                                </button>
                                <button
                                    onClick={() => setShowManualForm(false)}
                                    style={{ width: 40, borderRadius: 10, border: `1px solid ${T.border}`, background: '#fff', color: T.textMuted, fontSize: 16, cursor: 'pointer' }}
                                >
                                    ✕
                                </button>
                            </div>
                            {error && <div style={{ fontSize: 12, color: '#DC2626', fontWeight: 700, marginTop: 10 }}>⚠ {error}</div>}
                        </div>
                    )}

                    {/* Main data */}
                    {hasData && !loading && (() => {
                        const s = status!;
                        const nextIndicator = getDaysIndicator(s.nextHearingDate);
                        const lastIndicator = getDaysIndicator(s.lastHearingDate);
                        
                        return (
                            <div>
                                {/* Summary Hero Section */}
                                <div style={{ background: 'linear-gradient(135deg, #1e293b, #0f172a)', borderRadius: 14, padding: '16px 20px', marginBottom: 16, color: '#fff', boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }}>
                                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                                {ctStyle && <span style={{ fontSize: 10, fontWeight: 900, background: ctStyle.bg, color: ctStyle.text, padding: '2px 8px', borderRadius: 4, letterSpacing: 0.5 }}>{s.courtType.toUpperCase()}</span>}
                                            </div>
                                            <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', marginBottom: 4, lineHeight: 1.2 }}>{s.courtName || 'Unknown Court'}</div>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                                                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>{s.caseNumber || 'No Case Number'}</div>
                                                {s.cnrNumber && (
                                                    <>
                                                        <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'rgba(255,255,255,0.3)' }} />
                                                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace' }}>CNR: {s.cnrNumber}</div>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                        <div style={{ textAlign: 'right' }}>
                                            <div style={{ fontSize: 11, fontWeight: 800, color: '#60A5FA', marginBottom: 4, letterSpacing: 0.5 }}>CURRENT STAGE</div>
                                            <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', background: 'rgba(96, 165, 250, 0.15)', padding: '4px 12px', borderRadius: 8, border: '1px solid rgba(96, 165, 250, 0.2)' }}>{s.stage || '—'}</div>
                                        </div>
                                    </div>

                                    {/* Primary Metrics Grid */}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 14 }}>
                                        <div>
                                            <div style={{ fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,0.5)', marginBottom: 4, letterSpacing: 0.5 }}>NEXT HEARING</div>
                                            <div style={{ fontSize: 15, fontWeight: 900, color: nextIndicator?.color === '#C62828' ? '#F87171' : '#fff' }}>{fmtD(s.nextHearingDate)}</div>
                                            {nextIndicator && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>{nextIndicator.label}</div>}
                                        </div>
                                        <div>
                                            <div style={{ fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,0.5)', marginBottom: 4, letterSpacing: 0.5 }}>LAST HEARING</div>
                                            <div style={{ fontSize: 15, fontWeight: 900 }}>{fmtD(s.lastHearingDate)}</div>
                                            {lastIndicator && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>{lastIndicator.label}</div>}
                                        </div>
                                        <div>
                                            <div style={{ fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,0.5)', marginBottom: 4, letterSpacing: 0.5 }}>ADJOURNMENTS</div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <div style={{ fontSize: 18, fontWeight: 900, color: s.adjournmentCount > 10 ? '#F87171' : '#fff' }}>{s.adjournmentCount}</div>
                                                <div style={{ height: 16, width: 1, background: 'rgba(255,255,255,0.2)' }} />
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                                                    <div style={{ fontSize: 8, fontWeight: 800, color: '#F87171' }}>P:{s.adjournmentBreakdown.petitioner}</div>
                                                    <div style={{ fontSize: 8, fontWeight: 800, color: '#60A5FA' }}>R:{s.adjournmentBreakdown.respondent}</div>
                                                    <div style={{ fontSize: 8, fontWeight: 800, color: '#94A3B8' }}>C:{s.adjournmentBreakdown.court}</div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Accuracy Warning */}
                                {s.accuracyFlag && (
                                    <div style={{ background: '#FFF1F2', border: '1px solid #FFE4E6', borderRadius: 12, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                                        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                                            <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#EF4444', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>⚠</div>
                                            <div>
                                                <div style={{ fontSize: 13, fontWeight: 800, color: '#991B1B' }}>Data Integrity Flagged</div>
                                                <div style={{ fontSize: 12, color: '#B91C1C', marginTop: 2 }}>{s.userNote || 'User indicated this data may be inaccurate.'}</div>
                                            </div>
                                        </div>
                                        <button onClick={handleClearFlag} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #FCA5A5', background: '#fff', color: '#B91C1C', fontSize: 11, fontWeight: 800, cursor: 'pointer', transition: 'all 0.2s' }}>Resolve Flag</button>
                                    </div>
                                )}

                                {/* Secondary Details Row */}
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
                                    {/* Action Links & Badges */}
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                        <div style={{ background: s.interimOrderFlag ? '#F0FDF4' : T.surface, color: s.interimOrderFlag ? '#166534' : T.textMuted, border: `1px solid ${s.interimOrderFlag ? '#DCFCE7' : T.border}`, borderRadius: 8, padding: '8px 12px', flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ fontSize: 16 }}>{s.interimOrderFlag ? '🛡️' : '⚪'}</span>
                                            <div>
                                                <div style={{ fontSize: 9, fontWeight: 800, opacity: 0.6 }}>INTERIM ORDER</div>
                                                <div style={{ fontSize: 11, fontWeight: 800 }}>{s.interimOrderFlag ? 'STAY IN FORCE' : 'NONE RECORDED'}</div>
                                            </div>
                                        </div>
                                        <div style={{ background: s.bailStatus ? '#EFF6FF' : T.surface, color: s.bailStatus ? '#1E40AF' : T.textMuted, border: `1px solid ${s.bailStatus ? '#DBEAFE' : T.border}`, borderRadius: 8, padding: '8px 12px', flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ fontSize: 16 }}>{s.bailStatus ? '⚖️' : '⚪'}</span>
                                            <div>
                                                <div style={{ fontSize: 9, fontWeight: 800, opacity: 0.6 }}>BAIL STATUS</div>
                                                <div style={{ fontSize: 11, fontWeight: 800 }}>{s.bailStatus ? s.bailStatus.toUpperCase() : 'NOT APPLICABLE'}</div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Last Order Action */}
                                    {s.lastOrderURL && (
                                        <a
                                            href={s.lastOrderURL}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#fff', border: `1px solid ${T.border}`, borderRadius: 12, textDecoration: 'none', color: '#2A7BD4', boxShadow: '0 2px 4px rgba(0,0,0,0.03)', transition: 'transform 0.2s' }}
                                            onMouseEnter={e => (e.currentTarget.style.transform = 'translateY(-2px)')}
                                            onMouseLeave={e => (e.currentTarget.style.transform = 'translateY(0)')}
                                        >
                                            <div style={{ width: 36, height: 36, borderRadius: 10, background: '#E0F2FE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>📄</div>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontSize: 13, fontWeight: 800, color: '#1E293B' }}>View Last Order</div>
                                                <div style={{ fontSize: 11, color: T.textMuted }}>PDF • High Court Record</div>
                                            </div>
                                            <span style={{ fontSize: 14 }}>↗</span>
                                        </a>
                                    )}
                                </div>

                                {/* Tab Bar */}
                                <div style={{ display: 'flex', gap: 6, marginBottom: 16, background: T.surface, padding: 4, borderRadius: 10 }}>
                                    {[
                                        { id: 'overview', icon: '📊', label: 'Case Insight' },
                                        { id: 'history', icon: '📋', label: 'Hearing History' }
                                    ].map(tab => (
                                        <button
                                            key={tab.id}
                                            onClick={() => setActiveTab(tab.id as any)}
                                            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, border: 'none', background: activeTab === tab.id ? '#fff' : 'transparent', color: activeTab === tab.id ? '#1A3A6B' : T.textMuted, fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: activeTab === tab.id ? '0 2px 8px rgba(0,0,0,0.08)' : 'none', transition: 'all 0.2s' }}
                                        >
                                            <span>{tab.icon}</span> {tab.label}
                                        </button>
                                    ))}
                                </div>

                                {/* Content Area */}
                                <div style={{ minHeight: 180 }}>
                                    {activeTab === 'overview' && (
                                        <div style={{ animation: 'fadeIn 0.2s ease-out' }}>
                                            {/* AI Insights Card */}
                                            {s.aiInsights && (
                                                <div style={{ background: 'linear-gradient(135deg, #FFFBEB, #FEF3C7)', border: '1px solid #FDE68A', borderRadius: 12, padding: '16px', marginBottom: 16, position: 'relative', overflow: 'hidden' }}>
                                                    <div style={{ position: 'absolute', top: -10, right: -10, fontSize: 60, opacity: 0.05, pointerEvents: 'none' }}>✨</div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                                                        <span style={{ fontSize: 18 }}>✨</span>
                                                        <div style={{ fontSize: 11, fontWeight: 900, color: '#92400E', letterSpacing: 1 }}>LEX AI ANALYSIS</div>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                                                        <div style={{ flex: 1 }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                                                <div style={{ fontSize: 14, fontWeight: 800, color: '#78350F' }}>Trajectory:</div>
                                                                <div style={{ fontSize: 12, fontWeight: 900, background: s.aiInsights.trajectory === 'Stalled' ? '#FECACA' : '#BBF7D0', color: s.aiInsights.trajectory === 'Stalled' ? '#991B1B' : '#166534', padding: '2px 8px', borderRadius: 4 }}>
                                                                    {s.aiInsights.trajectory.toUpperCase()}
                                                                </div>
                                                            </div>
                                                            <div style={{ fontSize: 13, color: '#92400E', lineHeight: 1.5, fontWeight: 600 }}>{s.aiInsights.patternNote}</div>
                                                        </div>
                                                        {s.aiInsights.delayIndicator !== 'None' && (
                                                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                                                <div style={{ fontSize: 10, fontWeight: 900, color: '#fff', background: s.aiInsights.delayIndicator === 'Critical' ? '#DC2626' : '#D97706', padding: '4px 10px', borderRadius: 6, boxShadow: '0 2px 5px rgba(0,0,0,0.1)' }}>
                                                                    {s.aiInsights.delayIndicator.toUpperCase()} DELAY
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Meta Stats Data Grid */}
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                                <div style={{ background: T.surface, borderRadius: 10, padding: '12px', border: `1px solid ${T.borderSoft}` }}>
                                                    <div style={{ fontSize: 10, fontWeight: 800, color: T.textMuted, marginBottom: 6, letterSpacing: 0.5 }}>ADJOURNMENT SPLIT</div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                        <div style={{ flex: 1, height: 8, borderRadius: 4, background: '#E2E8F0', overflow: 'hidden', display: 'flex' }}>
                                                            <div style={{ width: `${(s.adjournmentBreakdown.petitioner/s.adjournmentCount)*100}%`, background: '#EF4444' }} />
                                                            <div style={{ width: `${(s.adjournmentBreakdown.respondent/s.adjournmentCount)*100}%`, background: '#3B82F6' }} />
                                                            <div style={{ width: `${(s.adjournmentBreakdown.court/s.adjournmentCount)*100}%`, background: '#94A3B8' }} />
                                                        </div>
                                                        <div style={{ fontSize: 11, fontWeight: 800, color: T.text }}>{s.adjournmentCount} Total</div>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                                                        <div style={{ fontSize: 10, fontWeight: 700, color: '#EF4444' }}>● Petitioner: {s.adjournmentBreakdown.petitioner}</div>
                                                        <div style={{ fontSize: 10, fontWeight: 700, color: '#3B82F6' }}>● Respondent: {s.adjournmentBreakdown.respondent}</div>
                                                    </div>
                                                </div>
                                                <div style={{ background: T.surface, borderRadius: 10, padding: '12px', border: `1px solid ${T.borderSoft}`, flex: 1 }}>
                                                    <div style={{ fontSize: 10, fontWeight: 800, color: T.textMuted, marginBottom: 8, letterSpacing: 0.5 }}>CASE DNA & SYNC METADATA</div>
                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                                        <div>
                                                            <div style={{ fontSize: 9, fontWeight: 800, color: T.textMuted, opacity: 0.7 }}>CASE REFERENCE ID</div>
                                                            <div style={{ fontSize: 11, fontWeight: 700, color: T.text, fontFamily: 'monospace' }}>{s.caseId || 'N/A'}</div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {activeTab === 'history' && (
                                        <div style={{ animation: 'fadeIn 0.2s ease-out' }}>
                                            {s.hearingHistory.length === 0 ? (
                                                <div style={{ padding: '30px', textAlign: 'center', color: T.textMuted, fontSize: 14, background: T.surface, borderRadius: 12, border: `1px solid ${T.border}` }}>No chronological history found for this record.</div>
                                            ) : (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                    {s.hearingHistory.slice().sort((a: any,b: any) => b.date.localeCompare(a.date)).slice(0, 10).map((h: any, i: number) => (
                                                        <div key={i} style={{ background: '#fff', border: `1px solid ${T.borderSoft}`, borderRadius: 10, padding: '12px 14px', display: 'flex', gap: 14, alignItems: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                                                            <div style={{ width: 44, textAlign: 'center', flexShrink: 0 }}>
                                                                <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted }}>{new Date(h.date).toLocaleString('en-IN', { month: 'short' }).toUpperCase()}</div>
                                                                <div style={{ fontSize: 18, fontWeight: 900, color: T.text }}>{new Date(h.date).getDate()}</div>
                                                            </div>
                                                            <div style={{ width: 1, height: 24, background: '#E2E8F0' }} />
                                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                                                                    <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>{h.stage || 'Hearing'}</div>
                                                                    <div style={{ fontSize: 10, fontWeight: 800, color: T.textMuted, background: T.surface, padding: '2px 8px', borderRadius: 4 }}>{new Date(h.date).getFullYear()}</div>
                                                                </div>
                                                                {h.judge && <div style={{ fontSize: 12, color: T.textMuted, fontWeight: 600 }}>{h.judge}</div>}
                                                                {h.notes && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, fontStyle: 'italic' }}>"{h.notes}"</div>}
                                                            </div>
                                                        </div>
                                                    ))}
                                                    {s.hearingHistory.length > 10 && (
                                                        <div style={{ textAlign: 'center', padding: '8px', fontSize: 12, color: T.textMuted, fontWeight: 600 }}>Showing last 10 of {s.hearingHistory.length} hearings</div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Footer Actions */}
                                <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${T.borderSoft}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    {!showFlagForm ? (
                                        <button
                                            onClick={() => setShowFlagForm(true)}
                                            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: T.textMuted, fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}
                                            onMouseEnter={e => (e.currentTarget.style.color = '#B91C1C')}
                                            onMouseLeave={e => (e.currentTarget.style.color = T.textMuted)}
                                        >
                                            flag Flag inaccuracies
                                        </button>
                                    ) : (
                                        <div style={{ width: '100%', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '16px' }}>
                                            <div style={{ fontSize: 13, fontWeight: 900, color: T.text, marginBottom: 10 }}>REPORT DATA INACCURACY</div>
                                            <textarea
                                                value={flagNote}
                                                onChange={e => setFlagNote(e.target.value)}
                                                placeholder="Please describe what is incorrect (e.g. 'Hearing date is wrong', 'Case disposed')"
                                                rows={2}
                                                style={{ width: '100%', padding: '12px', borderRadius: 10, border: `1px solid ${T.border}`, fontSize: 14, color: T.text, resize: 'none', background: '#fff', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
                                            />
                                            <div style={{ display: 'flex', gap: 10, marginTop: 12, justifyContent: 'flex-end' }}>
                                                <button onClick={() => setShowFlagForm(false)} style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: T.textSub, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
                                                <button onClick={handleFlag} style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: '#B91C1C', color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>Flag Data</button>
                                            </div>
                                        </div>
                                    )}
                                    {!showFlagForm && s.caseId && (
                                        <div style={{ fontSize: 11, color: T.textMuted, fontWeight: 600 }}>Ref ID: {s.caseId.slice(0,8)}{isStale ? ' · ⚠ Stale Data' : ''}</div>
                                    )}
                                </div>
                            </div>
                        );
                    })()}
                </div>
            )}
        </div>
    );
}
