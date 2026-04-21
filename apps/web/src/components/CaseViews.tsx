import { useApp } from "../AppContext";
import { LABEL_COLORS, fmtDate, getDaysUntil, hearingLabel, Badge } from "../caseHelpers";
import { formatCaseTitleShort, formatParty } from "../utils/caseTitle";
import { loadDocReqs } from "../services/localStorageService";

// ── DATE SAFETY HELPER ────────────────────────────────────────────────────────
// Handles three input formats:
// 1. ISO "YYYY-MM-DD"               → new cases after the fix
// 2. "DD-MM-YYYY [JUDGE NAMES...]"  → old cases saved before the fix
// 3. null / empty                   → shows "No Date"
function safeDate(raw: string | null | undefined): string {
    if (!raw) return "No Date";
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
        const r = fmtDate(raw);
        return (r === "—" || r === "Invalid Date") ? "No Date" : r;
    }
    const m = raw.match(/(\d{2})-(\d{2})-(\d{4})/);
    if (m) {
        const r = fmtDate(`${m[3]}-${m[2]}-${m[1]}`);
        return (r === "—" || r === "Invalid Date") ? "No Date" : r;
    }
    return "No Date";
}

export function DonutChart({ cases }: { cases: any[] }) {
    const { T } = useApp();
    const counts = cases.reduce((acc: any, c: any) => {
        if (!c.archived) acc[c.status] = (acc[c.status] || 0) + 1;
        return acc;
    }, { Pending: 0, Fresh: 0, Disposed: 0 });
    const total = (counts.Pending || 0) + (counts.Fresh || 0) + (counts.Disposed || 0);
    const segs = [
        { key: "Pending", color: "#C9A84C", val: counts.Pending || 0 },
        { key: "Fresh", color: "#2A7BD4", val: counts.Fresh || 0 },
        { key: "Disposed", color: "#1A8C5B", val: counts.Disposed || 0 },
    ];
    const r = 36, cx = 52, cy = 52, circ = 2 * Math.PI * r;
    let cum = 0;
    const slices = segs.map(s => {
        const frac = total > 0 ? s.val / total : 0;
        const dash = frac * circ, offset = circ - cum * circ;
        cum += frac;
        return { ...s, dash, offset };
    });
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <svg width={104} height={104} viewBox="0 0 104 104" role="img" aria-label="Case status breakdown">
                <circle cx={cx} cy={cy} r={r} fill="none" stroke={T.borderSoft} strokeWidth={13} />
                {slices.map((s, i) => (
                    <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={13}
                        strokeDasharray={`${s.dash} ${circ - s.dash}`} strokeDashoffset={s.offset}
                        transform={`rotate(-90 ${cx} ${cy})`} strokeLinecap="round">
                        <title>{s.key}: {s.val}</title>
                    </circle>
                ))}
                <text x={cx} y={cy - 4} textAnchor="middle" fill={T.text} fontSize={19} fontWeight="800" fontFamily="Georgia,serif">{total}</text>
                <text x={cx} y={cy + 12} textAnchor="middle" fill={T.textMuted} fontSize={9} letterSpacing="1">CASES</text>
            </svg>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {segs.map(s => (
                    <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 9, height: 9, borderRadius: "50%", background: s.color }} aria-hidden="true" />
                        <span style={{ color: T.textSub, fontSize: 14 }}>{s.key}</span>
                        <span style={{ color: s.color, fontSize: 15, fontWeight: 800, marginLeft: 2 }}>{s.val}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── COURT BAR CHART ───────────────────────────────────────────────────────────
export function CourtBarChart({ cases }: { cases: any[] }) {
    const { T } = useApp();
    const map: Record<string, number> = {};
    cases.filter(c => !c.archived).forEach(c => { map[c.courtNumber] = (map[c.courtNumber] || 0) + 1; });
    const entries = Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
    const maxVal = Math.max(...entries.map(([, v]) => v), 1);
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {entries.map(([name, count]) => (
                <div key={name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ color: T.textSub, fontSize: 13, width: 78, flexShrink: 0 }}>{name}</span>
                    <div style={{ flex: 1, background: T.borderSoft, borderRadius: 6, height: 8, overflow: "hidden" }}
                        role="progressbar" aria-valuenow={count} aria-valuemax={maxVal} aria-label={`${name}: ${count} cases`}>
                        <div style={{ width: `${(count / maxVal) * 100}%`, background: "linear-gradient(90deg,#C9A84C,#9B7B28)", height: "100%", borderRadius: 6 }} />
                    </div>
                    <span style={{ color: T.text, fontSize: 14, fontWeight: 700, width: 14 }}>{count}</span>
                </div>
            ))}
            {entries.length === 0 && <div style={{ color: T.textMuted, fontSize: 14, textAlign: "center", padding: "12px 0" }}>No court data yet</div>}
        </div>
    );
}

// ── UPCOMING HEARINGS ─────────────────────────────────────────────────────────
export function UpcomingHearings({ cases, onSelectCase }: { cases: any[]; onSelectCase?: (c: any) => void }) {
    const { T, hearingColor } = useApp();
    const upcoming = cases
        .filter(c => { const d = getDaysUntil(c.nextHearingDate); return d !== null && d >= 0 && c.status !== "Disposed" && !c.archived; })
        .sort((a, b) => new Date(a.nextHearingDate).getTime() - new Date(b.nextHearingDate).getTime())
        .slice(0, 5);
    if (!upcoming.length)
        return <div style={{ color: T.textMuted, fontSize: 14, textAlign: "center", padding: "16px 0" }}>No upcoming hearings</div>;
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {upcoming.map(c => {
                const days = getDaysUntil(c.nextHearingDate);
                const col = hearingColor(days);
                return (
                    <div key={c.id} onClick={() => onSelectCase && onSelectCase(c)}
                        style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: T.bg, borderRadius: 9, border: `1px solid ${days != null && days <= 3 ? "#E8D18A" : T.borderSoft}`, cursor: onSelectCase ? "pointer" : "default" }}
                        role={onSelectCase ? "button" : undefined} tabIndex={onSelectCase ? 0 : undefined}
                        onKeyDown={e => e.key === "Enter" && onSelectCase && onSelectCase(c)}>
                        <div style={{ textAlign: "center", minWidth: 38, flexShrink: 0 }}>
                            {days === 0
                                ? <div style={{ fontSize: 11, fontWeight: 900, color: col, letterSpacing: 0.5 }}>TODAY</div>
                                : <><div style={{ fontSize: 18, fontWeight: 900, color: col, fontFamily: "Georgia,serif", lineHeight: 1 }}>{days}</div>
                                    <div style={{ fontSize: 10, color: T.textMuted, letterSpacing: 0.5 }}>DAYS</div></>}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: T.accentDark, fontFamily: "Georgia,serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.caseType} {c.shortCaseNumber}</div>
                            <div style={{ fontSize: 13, color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{formatCaseTitleShort(c)}</div>
                        </div>
                        <div style={{ fontSize: 11, flexShrink: 0, textAlign: "right" }}>
                            <div style={{ color: T.textMuted }}>{(c.courtNumber || "—").replace("Court No.", "Ct.")}</div>
                            <div style={{ color: col, fontWeight: 700 }}>{hearingLabel(days)}</div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ── CASE CARD (List View) ─────────────────────────────────────────────────────
export function CaseCard({ c, selected, onClick, searchTerm, onToggleSelect, isSelected }: { c: any; selected: boolean; onClick: () => void; searchTerm: string; onToggleSelect?: (id: string) => void; isSelected?: boolean }) {
    const { T, getS, hearingColor } = useApp();
    const s = getS(c.status);
    const days = getDaysUntil(c.nextHearingDate);
    const show = days !== null && days >= 0 && c.status !== "Disposed" && !c.archived;
    const urgent = show && days !== null && days <= 3;

    function hi(text: string) {
        if (!searchTerm || !text) return text;
        const lq = searchTerm.toLowerCase(), idx = text.toLowerCase().indexOf(lq);
        if (idx === -1) return text;
        return <>{text.slice(0, idx)}<mark style={{ background: "#FBF4E3", color: T.accentDark, borderRadius: 2, padding: "0 2px" }}>{text.slice(idx, idx + searchTerm.length)}</mark>{text.slice(idx + searchTerm.length)}</>;
    }

    return (
        <div onClick={onToggleSelect ? () => onToggleSelect(c.id) : onClick} onKeyDown={e => e.key === "Enter" && (onToggleSelect ? onToggleSelect(c.id) : onClick())}
            tabIndex={0} role="button" aria-selected={selected}
            style={{ display: "flex", alignItems: "center", gap: 12, background: selected ? "#F0F4FF" : c.archived ? "#F8F9FC" : T.surface, border: `1px solid ${selected ? "#2A4B9B" : urgent ? "#E8D18A" : T.border}`, borderLeft: `3px solid ${selected ? "#C9A84C" : urgent ? "#C9A84C" : c.archived ? T.borderSoft : "transparent"}`, borderRadius: 12, padding: "14px 16px", cursor: "pointer", transition: "all 0.2s", marginBottom: 10, opacity: c.archived ? 0.85 : 1, boxShadow: selected ? "0 2px 12px rgba(201,168,76,0.2)" : T.shadow }}>
            {onToggleSelect && (
                <div style={{ paddingRight: 4 }}>
                    <input 
                        type="checkbox" 
                        checked={isSelected} 
                        onChange={(e) => { e.stopPropagation(); onToggleSelect(c.id); }}
                        style={{ width: 18, height: 18, cursor: "pointer", accentColor: "#C9A84C" }}
                    />
                </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flex: 1, minWidth: 0 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                        <div style={{ width: 7, height: 7, borderRadius: "50%", background: s.text, flexShrink: 0 }} />
                        <span style={{ color: T.accentDark, fontSize: 13, fontWeight: 700, fontFamily: "Georgia,serif", letterSpacing: 0.3 }}>{hi(c.caseNumber)}</span>
                        {c.archived && <span style={{ fontSize: 11, color: T.textMuted, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 4, padding: "1px 6px", fontWeight: 600 }}>ARCHIVED</span>}
                    </div>
                    {(c.registrationDate || c.verificationDate) && (
                        <div style={{ display: "flex", gap: 10, marginLeft: 15, marginBottom: 4, flexWrap: "wrap" }}>
                            {c.registrationDate && <span style={{ fontSize: 11, color: T.textMuted }}>📋 Registered: {safeDate(c.registrationDate)}</span>}
                            {c.verificationDate && <span style={{ fontSize: 11, color: T.textMuted }}>✅ Verified: {safeDate(c.verificationDate)}</span>}
                        </div>
                    )}
                    <div style={{ color: T.text, fontSize: 15.5, marginLeft: 15, marginBottom: 7, lineHeight: 1.45 }}>
                        <span style={{ fontWeight: 600 }}>{formatCaseTitleShort(c)}</span>
                    </div>
                    <div style={{ display: "flex", gap: 14, marginLeft: 15, flexWrap: "wrap", alignItems: "center" }}>
                        <span style={{ color: T.textMuted, fontSize: 13 }}>⚖ {c.courtNumber}</span>
                        <span style={{ color: T.textMuted, fontSize: 13 }}>🕐 {c.timeOfSitting}</span>
                        {c.cnrNumber
                            ? <span style={{ color: T.textMuted, fontSize: 13 }}>📂 {hi(c.cnrNumber)}</span>
                            : c.diaryNumber
                                ? <span style={{ color: T.textMuted, fontSize: 13 }}>📂 {hi(String(c.diaryNumber))}/{hi(String(c.diaryYear))}</span>
                                : null
                        }
                        {show && <span style={{ color: hearingColor(days), fontSize: 13, fontWeight: urgent ? 700 : 500 }}>📅 {hearingLabel(days)}</span>}
                    </div>
                    <div style={{ display: "flex", gap: 14, marginLeft: 15, marginTop: 5, flexWrap: "wrap", alignItems: "center" }}>
                        <span style={{ color: T.textMuted, fontSize: 13 }}>
                            🔁 Last Listed: {safeDate(c.lastListedOn)}
                        </span>
                        {(() => {
                            const likelyDate = c.likelyListedOn || c.nextHearingDate;
                            const today = new Date(new Date().setHours(0,0,0,0));
                            const isFuture = likelyDate && new Date(likelyDate) >= today;
                            if (c.status === "Disposed") {
                                return <span style={{ color: T.textMuted, fontSize: 13 }}>📅 Likely Listed: No Date</span>;
                            }
                            return (
                                <span style={{ color: isFuture ? "#C9A84C" : T.textMuted, fontSize: 13, fontWeight: isFuture ? 600 : 400 }}>
                                    📅 Likely Listed: {isFuture ? safeDate(likelyDate) : "—"}
                                </span>
                            );
                        })()}
                    </div>
                    {c.keyRisk && (
                        <div style={{ marginLeft: 15, marginTop: 7, background: "#FEF2F2", border: "1px solid #FECACA", color: "#991B1B", padding: "4px 8px", borderRadius: 6, fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                            <span>🚨</span> Hearing Risk: {c.keyRisk.length > 80 ? c.keyRisk.slice(0, 80) + '...' : c.keyRisk}
                        </div>
                    )}
                    {c.labels?.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginLeft: 15, marginTop: c.keyRisk ? 4 : 7 }}>
                            {c.labels.map((l: string) => <Badge key={l} text={l} color={LABEL_COLORS[l] || T.textSub} />)}
                        </div>
                    )}
                </div>
                <span style={{ background: s.bg, color: s.text, fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20, letterSpacing: 0.6, flexShrink: 0, border: `1px solid ${s.border}` }}>
                    {c.status.toUpperCase()}
                </span>
                {(() => {
                    const reqs = loadDocReqs(c.id);
                    const missing = reqs.filter(r => r.status !== 'Complete' && r.status !== 'Received').length;
                    if (missing === 0) return null;
                    return (
                        <div style={{
                            background: '#DC2626', color: '#fff',
                            borderRadius: 10, fontSize: 10, fontWeight: 800,
                            padding: '2px 6px', minWidth: 18, textAlign: 'center',
                            marginLeft: 4, flexShrink: 0, boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                        }}>
                            {missing}📄
                        </div>
                    );
                })()}
            </div>
        </div>
    );
}

// ── GALLERY CARD ──────────────────────────────────────────────────────────────
export function GalleryCard({ c, selected, onClick, onToggleSelect, isSelected }: { c: any; selected: boolean; onClick: () => void; onToggleSelect?: (id: string) => void; isSelected?: boolean }) {
    const { T, getS, hearingColor } = useApp();
    const s = getS(c.status);
    const days = getDaysUntil(c.nextHearingDate);
    const show = days !== null && days >= 0 && c.status !== "Disposed" && !c.archived;
    const urgent = show && days !== null && days <= 3;
    return (
        <div onClick={onToggleSelect ? () => onToggleSelect(c.id) : onClick} onKeyDown={e => e.key === "Enter" && (onToggleSelect ? onToggleSelect(c.id) : onClick())} tabIndex={0} role="button" aria-selected={selected}
            style={{ background: selected ? "#F0F4FF" : T.surface, border: `1px solid ${selected ? "#2A4B9B" : urgent ? "#E8D18A" : T.border}`, borderTop: `3px solid ${s.text}`, borderRadius: 12, padding: "16px 14px", cursor: "pointer", transition: "all 0.18s", boxShadow: selected ? "0 4px 16px rgba(201,168,76,0.2)" : T.shadow, display: "flex", flexDirection: "column", gap: 8, minHeight: 160, position: "relative" }}>
            {onToggleSelect && (
                <div style={{ position: "absolute", top: 12, right: 12, zIndex: 5 }}>
                    <input type="checkbox" checked={isSelected} onChange={(e) => { e.stopPropagation(); onToggleSelect(c.id); }} style={{ width: 17, height: 17, cursor: "pointer", accentColor: "#C9A84C" }} />
                </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <span style={{ background: s.bg, color: s.text, fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 20, border: `1px solid ${s.border}`, letterSpacing: 0.5 }}>{c.status.toUpperCase()}</span>
                {show && <span style={{ fontSize: 11, fontWeight: 700, color: hearingColor(days), marginRight: onToggleSelect ? 24 : 0 }}>📅 {hearingLabel(days)}</span>}
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.accentDark, fontFamily: "Georgia,serif", letterSpacing: 0.2, lineHeight: 1.3 }}>{c.caseNumber}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text, lineHeight: 1.4, flex: 1 }}>
                {formatCaseTitleShort(c)}
                {(() => {
                    const reqs = loadDocReqs(c.id);
                    const missing = reqs.filter(r => r.status !== 'Complete' && r.status !== 'Received').length;
                    if (missing === 0) return null;
                    return (
                        <div style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            background: '#DC2626', color: '#fff',
                            borderRadius: 10, fontSize: 10, fontWeight: 800,
                            padding: '2px 6px', minWidth: 18, marginLeft: 8, verticalAlign: 'middle'
                        }}>
                            {missing}📄
                        </div>
                    );
                })()}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: "auto" }}>
                <span style={{ fontSize: 11, color: T.textMuted }}>⚖ {(c.courtNumber || "—").replace("Court No.", "Ct.")}</span>
                {c.cnrNumber
                    ? <span style={{ fontSize: 11, color: T.textMuted }}>· 📂 {c.cnrNumber}</span>
                    : c.diaryNumber
                        ? <span style={{ fontSize: 11, color: T.textMuted }}>· 📂 {c.diaryNumber}/{c.diaryYear}</span>
                        : null
                }
            </div>
            {c.labels?.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>{c.labels.slice(0, 3).map((l: string) => <span key={l} style={{ fontSize: 10, fontWeight: 700, color: LABEL_COLORS[l] || "#8A94B0", background: `${LABEL_COLORS[l] || "#8A94B0"}18`, padding: "2px 7px", borderRadius: 10, border: `1px solid ${LABEL_COLORS[l] || "#8A94B0"}30` }}>{l}</span>)}</div>}
        </div>
    );
}

// ── TABLE VIEW ────────────────────────────────────────────────────────────────
export function TableView({ cases, selected, onSelect, searchTerm, onToggleSelect, isSelected, onSelectAll, allSelected }: { cases: any[]; selected: any; onSelect: (c: any) => void; searchTerm: string; onToggleSelect?: (id: string) => void; isSelected?: (id: string) => boolean; onSelectAll?: () => void; allSelected?: boolean }) {
    const { T, getS } = useApp();
    function hi(text: string) {
        if (!searchTerm || !text) return text;
        const lq = searchTerm.toLowerCase(), idx = text.toLowerCase().indexOf(lq);
        if (idx === -1) return text;
        return <>{text.slice(0, idx)}<mark style={{ background: "#FBF4E3", color: "#9B7B28", borderRadius: 2, padding: "0 2px" }}>{text.slice(idx, idx + searchTerm.length)}</mark>{text.slice(idx + searchTerm.length)}</>;
    }
    const cols = ["Case Number", "Petitioner", "Respondent", "Court", "Diary No.", "Status", "Last Listed", "Likely Listed", "Labels"];
    return (
        <div style={{ overflowX: "auto", borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: T.shadow }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                    <tr style={{ background: T.sidebar }}>
                        {onSelectAll && (
                            <th style={{ padding: "10px 14px", width: 40 }}>
                                <input type="checkbox" checked={allSelected} onChange={onSelectAll} style={{ width: 16, height: 16, cursor: "pointer", accentColor: "#C9A84C" }} />
                            </th>
                        )}
                        {cols.map(col => <th key={col} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.6)", letterSpacing: 0.8, whiteSpace: "nowrap", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>{col}</th>)}
                    </tr>
                </thead>
                <tbody>
                    {cases.map((c, i) => {
                        const s = getS(c.status);
                        const isSel = selected?.id === c.id;
                        return (
                            <tr key={c.id} onClick={onToggleSelect ? () => onToggleSelect(c.id) : () => onSelect(c)}
                                style={{ background: isSel ? "#F0F4FF" : i % 2 === 0 ? T.surface : T.bg, cursor: "pointer", transition: "background 0.15s", borderBottom: `1px solid ${T.borderSoft}` }}
                                onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = "#EEF2FF" }}
                                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isSel ? "#F0F4FF" : i % 2 === 0 ? T.surface : T.bg }}>
                                {onToggleSelect && (
                                    <td style={{ padding: "10px 14px", textAlign: "center" }}>
                                        <input type="checkbox" checked={isSelected?.(c.id)} onChange={(e) => { e.stopPropagation(); onToggleSelect(c.id); }} style={{ width: 16, height: 16, cursor: "pointer", accentColor: "#C9A84C" }} />
                                    </td>
                                )}
                                <td style={{ padding: "10px 14px", fontWeight: 700, color: T.accentDark, fontFamily: "Georgia,serif", fontSize: 12, whiteSpace: "nowrap" }}>{hi(c.caseNumber)}</td>
                                <td style={{ padding: "10px 14px", color: T.text, fontWeight: 600, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{hi(formatCaseTitleShort(c, 100))}</td>
                                <td style={{ padding: "10px 14px", color: T.textSub, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{hi(formatParty(c.respondent))}</td>
                                <td style={{ padding: "10px 14px", color: T.textMuted, whiteSpace: "nowrap", fontSize: 12 }}>{(c.courtNumber || "—").replace("Court No.", "Ct.")}</td>
                                <td style={{ padding: "10px 14px", color: T.textMuted, whiteSpace: "nowrap", fontSize: 12 }}>{c.cnrNumber ? c.cnrNumber : c.diaryNumber ? `${c.diaryNumber}/${c.diaryYear}` : '—'}</td>
                                <td style={{ padding: "10px 14px" }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span style={{ background: s.bg, color: s.text, fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 20, border: `1px solid ${s.border}`, letterSpacing: 0.5 }}>{c.status.toUpperCase()}</span>
                                        {(() => {
                                            const reqs = loadDocReqs(c.id);
                                            const missing = reqs.filter(r => r.status !== 'Complete' && r.status !== 'Received').length;
                                            if (missing === 0) return null;
                                            return (
                                                <div style={{
                                                    background: '#DC2626', color: '#fff',
                                                    borderRadius: 10, fontSize: 10, fontWeight: 800,
                                                    padding: '2px 5px', minWidth: 16, textAlign: 'center'
                                                }}>
                                                    {missing}📄
                                                </div>
                                            );
                                        })()}
                                    </div>
                                </td>
                                <td style={{ padding: "10px 14px", color: T.textMuted, whiteSpace: "nowrap", fontSize: 12 }}>{c.lastListedOn ? safeDate(c.lastListedOn) : "—"}</td>
                                <td style={{ padding: "10px 14px", whiteSpace: "nowrap", fontSize: 12 }}>{(() => {
                                    const d = c.likelyListedOn;
                                    const isFuture = d && new Date(d) >= new Date(new Date().setHours(0,0,0,0));
                                    if (c.status === 'Disposed') return <span style={{ color: T.textMuted }}>No Date</span>;
                                    return isFuture ? <span style={{ color: "#C9A84C", fontWeight: 700 }}>{safeDate(d)}</span> : <span style={{ color: T.textMuted }}>—</span>;
                                })()}</td>
                                <td style={{ padding: "10px 14px" }}><div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>{c.labels?.slice(0, 2).map((l: string) => <span key={l} style={{ fontSize: 10, fontWeight: 700, color: LABEL_COLORS[l] || "#8A94B0", background: `${LABEL_COLORS[l] || "#8A94B0"}18`, padding: "1px 6px", borderRadius: 10 }}>{l}</span>)}{c.labels?.length > 2 && <span style={{ fontSize: 10, color: T.textMuted }}>+{c.labels.length - 2}</span>}</div></td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

// ── KANBAN VIEW ───────────────────────────────────────────────────────────────
export function KanbanView({ cases, selected, onSelect, onToggleSelect, isSelected }: { cases: any[]; selected: any; onSelect: (c: any) => void; onToggleSelect?: (id: string) => void; isSelected?: (id: string) => boolean }) {
    const { T, hearingColor } = useApp();
    const columns = [
        { key: "Fresh", color: "#2A7BD4", icon: "✦" },
        { key: "Pending", color: "#C9A84C", icon: "⏱" },
        { key: "Disposed", color: "#1A8C5B", icon: "✓" },
    ];
    return (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, alignItems: "start" }}>
            {columns.map(col => {
                const items = cases.filter(c => c.status === col.key);
                return (
                    <div key={col.key} style={{ background: T.surface, borderRadius: 12, border: `1px solid ${T.border}`, overflow: "hidden", boxShadow: T.shadow }}>
                        <div style={{ padding: "12px 14px", background: `${col.color}12`, borderBottom: `2px solid ${col.color}`, display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 15 }}>{col.icon}</span>
                            <span style={{ fontSize: 13, fontWeight: 800, color: col.color, flex: 1 }}>{col.key}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: col.color, background: `${col.color}20`, padding: "2px 10px", borderRadius: 20 }}>{items.length}</span>
                        </div>
                        <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8, minHeight: 100 }}>
                            {items.length === 0 && <div style={{ fontSize: 12, color: T.textMuted, textAlign: "center", padding: "20px 0" }}>No cases</div>}
                            {items.map(c => {
                                const days = getDaysUntil(c.nextHearingDate);
                                const show = days !== null && days >= 0 && c.status !== "Disposed";
                                const urgent = show && days !== null && days <= 3;
                                const isSel = selected?.id === c.id;
                                return (
                                    <div key={c.id} onClick={onToggleSelect ? () => onToggleSelect(c.id) : () => onSelect(c)}
                                        style={{ display: "flex", alignItems: "flex-start", gap: 10, background: isSel ? "#F0F4FF" : T.bg, border: `1px solid ${isSel ? "#2A4B9B" : urgent ? "#E8D18A" : T.border}`, borderLeft: `3px solid ${isSel ? "#C9A84C" : urgent ? "#C9A84C" : col.color}`, borderRadius: 9, padding: "10px 12px", cursor: "pointer", transition: "all 0.15s" }}
                                        onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = "#EEF2FF" }}
                                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isSel ? "#F0F4FF" : T.bg }}>
                                        {onToggleSelect && (
                                            <div style={{ marginTop: 2 }}>
                                                <input type="checkbox" checked={isSelected?.(c.id)} onChange={(e) => { e.stopPropagation(); onToggleSelect(c.id); }} style={{ width: 15, height: 15, cursor: "pointer", accentColor: "#C9A84C" }} />
                                            </div>
                                        )}
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontSize: 11, fontWeight: 700, color: T.accentDark, fontFamily: "Georgia,serif", marginBottom: 4 }}>{c.caseNumber}</div>
                                            <div style={{ fontSize: 12, fontWeight: 600, color: T.text, marginBottom: 6, lineHeight: 1.4 }}>
                                                {formatCaseTitleShort(c, 50)}
                                            </div>
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
                                                <span style={{ fontSize: 11, color: T.textMuted }}>⚖ {(c.courtNumber || "—").replace("Court No.", "Ct.")}</span>
                                                {show && <span style={{ fontSize: 11, fontWeight: 700, color: hearingColor(days) }}>📅 {hearingLabel(days)}</span>}
                                            </div>
                                            {c.labels?.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 6 }}>{c.labels.slice(0, 2).map((l: string) => <span key={l} style={{ fontSize: 10, fontWeight: 700, color: LABEL_COLORS[l] || "#8A94B0", background: `${LABEL_COLORS[l] || "#8A94B0"}18`, padding: "1px 6px", borderRadius: 10 }}>{l}</span>)}</div>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}