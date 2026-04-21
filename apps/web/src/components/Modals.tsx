import { useState, useEffect, useRef } from "react";
import { useApp } from "../AppContext";
import { LABEL_COLORS, ALL_LABELS, CASE_TYPES, COURT_NUMBERS, SITTING_TIMES, fmtDate, getDaysUntil, hearingLabel } from "../caseHelpers";
import { formatCaseTitleShort } from "../utils/caseTitle";

// ── SEARCH INFO TOOLTIP ───────────────────────────────────────────────────────
export function SearchInfo({ show }: { show: boolean }) {
    const { T } = useApp();
    if (!show) return null;
    const rows = [["Petitioner / Respondent", "e.g. Ramesh Kumar"], ["Case number", "e.g. W.P.(C) 12345/2024"], ["Diary number", "e.g. 45821"], ["Diary no. + year", "e.g. 45821/2024"], ["Case type", "e.g. SLP(Crl.)"], ["Court number", "e.g. Court No. 3"], ["Label", "e.g. Urgent"]];
    return (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 14px", boxShadow: "0 8px 24px rgba(15,28,63,0.15)", zIndex: 200, fontSize: 13, color: T.textSub, lineHeight: 1.9 }} role="tooltip">
            <div style={{ fontWeight: 700, color: T.text, marginBottom: 6, fontSize: 14 }}>🔍 Search by:</div>
            {rows.map(([k, v]) => (
                <div key={k} style={{ display: "flex", gap: 8 }}>
                    <span style={{ color: T.accentDark, fontWeight: 600, minWidth: 170, flexShrink: 0 }}>{k}</span>
                    <span style={{ color: T.textMuted }}>{v}</span>
                </div>
            ))}
        </div>
    );
}

// ── BELL PANEL ────────────────────────────────────────────────────────────────
const NOTIF_KEY = 'lextgress_notifications';

function loadNotifReadState(): Record<string, boolean> {
    try { return JSON.parse(localStorage.getItem(NOTIF_KEY) || '{}'); } catch { return {}; }
}
function saveNotifReadState(state: Record<string, boolean>) {
    try { localStorage.setItem(NOTIF_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

export function BellPanel({ cases, onClose, onSelectCase }: { cases: any[]; onClose: () => void; onSelectCase: (c: any) => void }) {
    const { T, hearingColor } = useApp();
    const ref = useRef<HTMLDivElement>(null);
    const [readState, setReadState] = useState<Record<string, boolean>>(loadNotifReadState);
    const [dismissed, setDismissed] = useState<Record<string, boolean>>({});

    useEffect(() => {
        function handler(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); }
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [onClose]);

    const upcoming = cases.filter(c => { const d = getDaysUntil(c.nextHearingDate); return d !== null && d >= 0 && c.status !== "Disposed" && !c.archived; })
        .sort((a, b) => new Date(a.nextHearingDate).getTime() - new Date(b.nextHearingDate).getTime());

    const recentTasks = cases.flatMap(c => (c.tasks || []).map((t: any) => ({ ...t, caseObj: c })))
        .filter((t: any) => !t.done)
        .sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
        .slice(0, 3);

    const markRead = (id: string) => {
        const next = { ...readState, [id]: true };
        setReadState(next);
        saveNotifReadState(next);
    };
    const markAllRead = () => {
        const next = { ...readState };
        recentTasks.forEach((t: any) => { next[t.id] = true; });
        upcoming.forEach(c => { next[c.id] = true; });
        setReadState(next);
        saveNotifReadState(next);
    };
    const dismiss = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        markRead(id);
        setDismissed(prev => ({ ...prev, [id]: true }));
    };

    const unreadTaskCount = recentTasks.filter((t: any) => !readState[t.id] && !dismissed[t.id]).length;
    const unreadHearingCount = upcoming.filter(c => !readState[c.id] && !dismissed[c.id]).length;
    const totalUnread = unreadTaskCount + unreadHearingCount;

    const visibleTasks = recentTasks.filter((t: any) => !dismissed[t.id]);
    const visibleUpcoming = upcoming.filter(c => !dismissed[c.id]);

    return (
        <div ref={ref} style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 360, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, boxShadow: "0 12px 40px rgba(15,28,63,0.18)", zIndex: 300, overflow: "hidden" }} role="dialog" aria-label="Notifications">
            {/* Header */}
            <div style={{ padding: "14px 16px", borderBottom: `1px solid ${T.borderSoft}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                    <div style={{ fontWeight: 800, fontSize: 16, color: T.text }}>Notifications</div>
                    <div style={{ fontSize: 13, color: T.textMuted, marginTop: 1 }}>
                        {totalUnread > 0 ? `${totalUnread} unread` : 'All caught up'} · {upcoming.length} upcoming
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {totalUnread > 0 && (
                        <button onClick={markAllRead} style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${T.border}`, background: T.bg, color: T.textSub, fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            Mark all read
                        </button>
                    )}
                    <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: T.textMuted, fontSize: 20, lineHeight: 1, padding: 4 }} aria-label="Close">✕</button>
                </div>
            </div>

            <div style={{ maxHeight: 440, overflowY: "auto", padding: "10px 12px" }}>

                {/* TASKS SECTION */}
                {visibleTasks.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, letterSpacing: 1, marginBottom: 8, paddingLeft: 4 }}>NEW TASKS ASSIGNED</div>
                        {visibleTasks.map((t: any) => {
                            const isRead = readState[t.id];
                            return (
                                <div key={t.id}
                                    onClick={() => { markRead(t.id); onSelectCase(t.caseObj); onClose(); }}
                                    tabIndex={0} role="button"
                                    style={{
                                        display: "flex", gap: 10, padding: "11px 12px", borderRadius: 10, marginBottom: 6,
                                        cursor: "pointer", border: `1px solid ${T.borderSoft}`,
                                        background: isRead ? T.bg : T.surface,
                                        borderLeft: isRead ? `3px solid ${T.borderSoft}` : '3px solid #3B82F6',
                                        opacity: isRead ? 0.65 : 1,
                                        transition: "opacity 0.15s",
                                    }}
                                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "#E8EBF5"}
                                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = isRead ? T.bg : T.surface}
                                >
                                    {!isRead && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#3B82F6', flexShrink: 0, marginTop: 5 }} />}
                                    <div style={{ fontSize: 20 }}>📋</div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 13, fontWeight: isRead ? 500 : 700, color: T.text, marginBottom: 2 }}>{t.text}</div>
                                        <div style={{ fontSize: 11, color: T.textMuted }}>{t.caseObj.caseNumber} · Due: {fmtDate(t.deadline)}</div>
                                    </div>
                                    <button onClick={e => dismiss(t.id, e)} style={{ background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: 15, padding: '0 2px', flexShrink: 0, alignSelf: 'flex-start' }} title="Dismiss">✕</button>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* HEARINGS SECTION */}
                <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, letterSpacing: 1, marginBottom: 8, paddingLeft: 4 }}>UPCOMING HEARINGS</div>
                {visibleUpcoming.length === 0
                    ? <div style={{ textAlign: "center", padding: "24px 0", color: T.textMuted, fontSize: 15 }}>No upcoming hearings</div>
                    : visibleUpcoming.map(c => {
                        const days = getDaysUntil(c.nextHearingDate);
                        const col = hearingColor(days);
                        const isRead = readState[c.id];
                        return (
                            <div key={c.id}
                                onClick={() => { markRead(c.id); onSelectCase(c); onClose(); }}
                                tabIndex={0} role="button"
                                style={{
                                    display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, marginBottom: 6,
                                    cursor: "pointer", border: `1px solid ${days != null && days <= 3 ? "#E8D18A" : T.borderSoft}`,
                                    background: isRead ? T.bg : (days != null && days <= 3 ? "#FFFBF0" : T.bg),
                                    borderLeft: isRead ? `3px solid ${T.borderSoft}` : (days != null && days <= 3 ? '3px solid #F59E0B' : '3px solid #3B82F6'),
                                    opacity: isRead ? 0.6 : 1,
                                    transition: "background 0.15s",
                                }}
                                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = days != null && days <= 3 ? "#FFF6DC" : "#E8EBF5"}
                                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = isRead ? T.bg : (days != null && days <= 3 ? "#FFFBF0" : T.bg)}
                                onKeyDown={e => e.key === "Enter" && (markRead(c.id), onSelectCase(c), onClose())}
                            >
                                <div style={{ textAlign: "center", minWidth: 40, flexShrink: 0 }}>
                                    {days === 0 ? <div style={{ fontSize: 11, fontWeight: 900, color: col, letterSpacing: 0.4 }}>TODAY</div>
                                        : <><div style={{ fontSize: 20, fontWeight: 900, color: col, fontFamily: "Georgia,serif", lineHeight: 1 }}>{days}</div><div style={{ fontSize: 10, color: T.textMuted }}>DAYS</div></>}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 14, fontWeight: isRead ? 500 : 700, color: T.accentDark, fontFamily: "Georgia,serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.caseNumber}</div>
                                    <div style={{ fontSize: 13, color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.displayTitle || formatCaseTitleShort(c)}</div>
                                    <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>{fmtDate(c.nextHearingDate)} · {c.courtNumber}</div>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                                    <span style={{ fontSize: 12, fontWeight: 700, color: col }}>{hearingLabel(days)}</span>
                                    <button onClick={e => dismiss(c.id, e)} style={{ background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: 13, padding: '0 2px' }} title="Dismiss">✕</button>
                                </div>
                            </div>
                        );
                    })}
            </div>

            {/* Footer - show total dismissed count */}
            {Object.keys(dismissed).length > 0 && (
                <div style={{ padding: '8px 16px', borderTop: `1px solid ${T.borderSoft}`, fontSize: 11, color: T.textMuted, textAlign: 'center' }}>
                    {Object.keys(dismissed).length} notification{Object.keys(dismissed).length !== 1 ? 's' : ''} dismissed · Reopen panel to reset
                </div>
            )}
        </div>
    );
}

// ── CONFIRM DIALOG ────────────────────────────────────────────────────────────
export function ConfirmDialog({ title, message, onConfirm, onCancel, confirmLabel = "Confirm", danger = false }: { title: string; message: string; onConfirm: () => void; onCancel: () => void; confirmLabel?: string; danger?: boolean }) {
    const { T } = useApp();
    useEffect(() => {
        function handler(e: KeyboardEvent) { if (e.key === "Escape") onCancel(); }
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [onCancel]);
    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,28,63,0.5)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} role="dialog" aria-modal="true">
            <div style={{ background: T.surface, borderRadius: 16, width: "100%", maxWidth: 400, padding: 28, boxShadow: "0 20px 60px rgba(15,28,63,0.3)" }}>
                <div style={{ fontWeight: 800, fontSize: 18, color: T.text, marginBottom: 8 }}>{title}</div>
                <div style={{ fontSize: 15, color: T.textSub, marginBottom: 24, lineHeight: 1.6 }}>{message}</div>
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                    <button onClick={onCancel} style={{ padding: "9px 20px", borderRadius: 9, border: `1px solid ${T.border}`, background: T.bg, color: T.textSub, fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
                    <button onClick={onConfirm} style={{ padding: "9px 24px", borderRadius: 9, border: "none", background: danger ? "#C62828" : "linear-gradient(135deg,#C9A84C,#9B7B28)", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>{confirmLabel}</button>
                </div>
            </div>
        </div>
    );
}

// ── MULTI PARTY INPUT ─────────────────────────────────────────────────────────
function MultiPartyInput({ label, values, onChange }: { label: string; values: string[]; onChange: (v: string[]) => void }) {
    const { T } = useApp();
    return (
        <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: 0.9, textTransform: "uppercase", marginBottom: 5 }}>{label}</label>
            {values.map((val, i) => (
                <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                    <input type="text" value={val} onChange={e => { const n = [...values]; n[i] = e.target.value; onChange(n); }} placeholder={`${label} ${i + 1}`}
                        style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 15, color: T.text, outline: "none", boxSizing: "border-box" }} />
                    {values.length > 1 && <button type="button" onClick={() => onChange(values.filter((_, j) => j !== i))} style={{ padding: "0 10px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.bg, color: T.textMuted, cursor: "pointer", fontSize: 17, fontWeight: 700, flexShrink: 0 }}>✕</button>}
                </div>
            ))}
            <button type="button" onClick={() => onChange([...values, ""])} style={{ padding: "6px 14px", borderRadius: 8, border: `1px dashed ${T.accent}`, background: T.accentBg, color: T.accentDark, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>+ Add {label}</button>
        </div>
    );
}

// ── FIELD ─────────────────────────────────────────────────────────────────────
function Field({ fkey, label, type = "text", opts = null, form, errors, setForm }: any) {
    const { T } = useApp();
    return (
        <div style={{ marginBottom: 14 }}>
            <label htmlFor={fkey} style={{ display: "block", fontSize: 11, fontWeight: 700, color: errors[fkey] ? "#C62828" : T.textMuted, letterSpacing: 0.9, textTransform: "uppercase", marginBottom: 5 }}>
                {label}{errors[fkey] && <span style={{ marginLeft: 6, fontWeight: 600, fontSize: 10 }}> — {errors[fkey]}</span>}
            </label>
            {opts
                ? <select id={fkey} value={form[fkey]} onChange={e => setForm((f: any) => ({ ...f, [fkey]: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${errors[fkey] ? "#C62828" : T.border}`, fontSize: 15, color: T.text, background: T.surface, outline: "none" }}>
                    {opts.map((o: string) => <option key={o}>{o}</option>)}
                </select>
                : <input id={fkey} type={type} value={form[fkey]} onChange={e => setForm((f: any) => ({ ...f, [fkey]: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${errors[fkey] ? "#C62828" : T.border}`, fontSize: 15, color: T.text, outline: "none", boxSizing: "border-box" }} />
            }
        </div>
    );
}

// ── CASE MODAL ────────────────────────────────────────────────────────────────
export function CaseModal({ onClose, onSave, editCase }: { onClose: () => void; onSave: (c: any) => void; editCase?: any }) {
    const { T } = useApp();
    const isEdit = !!editCase;
    const [form, setForm] = useState(isEdit ? {
        petitioners: [...editCase.petitioners], respondents: [...editCase.respondents],
        caseType: editCase.caseType, shortCaseNumber: editCase.shortCaseNumber,
        diaryNumber: editCase.diaryNumber, diaryYear: editCase.diaryYear, cnrNumber: editCase.cnrNumber || "",
        status: editCase.status, courtNumber: editCase.courtNumber, timeOfSitting: editCase.timeOfSitting,
        dateOfFiling: editCase.dateOfFiling, nextHearingDate: editCase.nextHearingDate || "",
        earlierCourtDetails: editCase.earlierCourtDetails || "—", labels: [...editCase.labels],
    } : {
        petitioners: [""], respondents: [""], caseType: "W.P.(C)", shortCaseNumber: "",
        diaryNumber: "", diaryYear: String(new Date().getFullYear()), cnrNumber: "",
        status: "Fresh", courtNumber: "Court No. 1", timeOfSitting: "10:30 AM",
        dateOfFiling: new Date().toISOString().split("T")[0], nextHearingDate: "", earlierCourtDetails: "—", labels: [],
    });
    const [errors, setErrors] = useState<any>({});
    useEffect(() => {
        function h(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
        document.addEventListener("keydown", h);
        return () => document.removeEventListener("keydown", h);
    }, [onClose]);
    const F = (props: any) => <Field {...props} form={form} errors={errors} setForm={setForm} />;
    function validate() {
        const e: any = {};
        if (!form.petitioners.some((p: string) => p.trim())) e.petitioners = "Required";
        if (!form.respondents.some((r: string) => r.trim())) e.respondents = "Required";
        if (!form.shortCaseNumber.trim()) e.shortCaseNumber = "Required";
        return e;
    }
    function submit() {
        const e = validate(); if (Object.keys(e).length) { setErrors(e); return; }
        const saved = {
            ...(isEdit ? editCase : {}),
            id: isEdit ? editCase.id : "case_" + Date.now(),
            petitioners: form.petitioners.filter((p: string) => p.trim()),
            respondents: form.respondents.filter((r: string) => r.trim()),
            caseType: form.caseType, shortCaseNumber: form.shortCaseNumber,
            caseNumber: `${form.caseType} ${form.shortCaseNumber}`,
            diaryNumber: form.diaryNumber, diaryYear: form.diaryYear, cnrNumber: form.cnrNumber || "",
            status: form.status, nextHearingDate: form.nextHearingDate || null,
            lastListedOn: isEdit ? editCase.lastListedOn : null, likelyListedOn: isEdit ? editCase.likelyListedOn : null,
            advanceList: isEdit ? editCase.advanceList : { published: false, date: null, presentInList: false },
            finalList: isEdit ? editCase.finalList : { published: false, date: null, presentInList: false },
            lastCheckedAt: new Date().toISOString(), labels: form.labels,
            lastListedJudges: isEdit ? editCase.lastListedJudges : [], finalListJudges: isEdit ? editCase.finalListJudges : [],
            courtName: isEdit ? editCase.courtName : "Supreme Court of India",
            courtNumber: form.courtNumber, timeOfSitting: form.timeOfSitting, dateOfFiling: form.dateOfFiling,
            earlierCourtDetails: form.earlierCourtDetails || "—",
            officeReportUrl: isEdit ? editCase.officeReportUrl : "#", lastOrdersUrl: isEdit ? editCase.lastOrdersUrl : "#",
            summary: isEdit ? editCase.summary : "", listings: isEdit ? editCase.listings : [], tasks: isEdit ? editCase.tasks : [],
            notes: isEdit ? editCase.notes : [], documents: isEdit ? editCase.documents : [], applications: isEdit ? editCase.applications : [],
            timeline: isEdit ? editCase.timeline : [], archived: isEdit ? editCase.archived : false,
        };
        onSave(saved); onClose();
    }
    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,28,63,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} role="dialog" aria-modal="true">
            <div style={{ background: T.surface, borderRadius: 16, width: "100%", maxWidth: 560, maxHeight: "92vh", overflow: "auto", boxShadow: "0 20px 60px rgba(15,28,63,0.3)" }}>
                <div style={{ padding: "20px 24px", borderBottom: `1px solid ${T.borderSoft}`, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: T.surface, zIndex: 1 }}>
                    <div>
                        <div style={{ fontWeight: 800, fontSize: 18, color: T.text }}>{isEdit ? "Edit Case" : "Add New Case"}</div>
                        <div style={{ fontSize: 14, color: T.textMuted, marginTop: 2 }}>{isEdit ? `Editing ${editCase.caseNumber}` : "Fill in the case details below"}</div>
                    </div>
                    <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, color: T.textMuted, lineHeight: 1 }} aria-label="Close">✕</button>
                </div>
                <div style={{ padding: "20px 24px" }}>
                    <MultiPartyInput label="Petitioner" values={form.petitioners} onChange={vals => setForm((f: any) => ({ ...f, petitioners: vals }))} />
                    {errors.petitioners && <div style={{ color: "#C62828", fontSize: 13, marginTop: -10, marginBottom: 10 }}>{errors.petitioners}</div>}
                    <MultiPartyInput label="Respondent" values={form.respondents} onChange={vals => setForm((f: any) => ({ ...f, respondents: vals }))} />
                    {errors.respondents && <div style={{ color: "#C62828", fontSize: 13, marginTop: -10, marginBottom: 10 }}>{errors.respondents}</div>}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
                        <F fkey="caseType" label="Case Type" opts={CASE_TYPES} />
                        <F fkey="shortCaseNumber" label="Case Number" />
                        <F fkey="diaryNumber" label="Diary Number" />
                        <F fkey="diaryYear" label="Diary Year" />
                        <div style={{ gridColumn: "1/-1" }}><F fkey="cnrNumber" label="CNR Number" /></div>
                        <F fkey="status" label="Status" opts={["Fresh", "Pending", "Disposed"]} />
                        <F fkey="courtNumber" label="Court Number" opts={COURT_NUMBERS} />
                        <F fkey="dateOfFiling" label="Date of Filing" type="date" />
                        <F fkey="nextHearingDate" label="Next Hearing Date" type="date" />
                        <div style={{ gridColumn: "1/-1" }}><F fkey="timeOfSitting" label="Time of Sitting" opts={SITTING_TIMES} /></div>
                        <div style={{ gridColumn: "1/-1" }}><F fkey="earlierCourtDetails" label="Earlier Court Details" /></div>
                    </div>
                    <div style={{ marginBottom: 14 }}>
                        <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: 0.9, textTransform: "uppercase", marginBottom: 8 }}>Labels</label>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {ALL_LABELS.map(l => {
                                const active = form.labels.includes(l);
                                return <button key={l} type="button"
                                    onClick={() => setForm((f: any) => ({ ...f, labels: active ? f.labels.filter((x: string) => x !== l) : [...f.labels, l] }))}
                                    style={{ padding: "4px 12px", borderRadius: 20, border: `1px solid ${active ? LABEL_COLORS[l] + "60" : T.border}`, background: active ? `${LABEL_COLORS[l]}15` : T.bg, color: active ? LABEL_COLORS[l] : T.textSub, fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                                    aria-pressed={active}>{l}</button>;
                            })}
                        </div>
                    </div>
                    <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", paddingTop: 10, borderTop: `1px solid ${T.borderSoft}` }}>
                        <button type="button" onClick={onClose} style={{ padding: "9px 20px", borderRadius: 9, border: `1px solid ${T.border}`, background: T.bg, color: T.textSub, fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
                        <button type="button" onClick={submit} style={{ padding: "9px 24px", borderRadius: 9, border: "none", background: "linear-gradient(135deg,#C9A84C,#9B7B28)", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", boxShadow: "0 2px 8px rgba(201,168,76,0.4)" }}>
                            {isEdit ? "Save Changes" : "Add Case"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
