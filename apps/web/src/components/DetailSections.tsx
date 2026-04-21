import { useState, useEffect, useRef } from "react";
import React from "react";
import VoiceNoteRecorder from './Notes/VoiceNoteRecorder';

// SC website proxy base URL
// Dev:  VITE_BACKEND_URL not set → /sci-wp → Vite proxy → localhost:3001
// Prod: VITE_BACKEND_URL = https://your-render-app.onrender.com → full URL
const _scBackend: string = (import.meta as any).env?.VITE_BACKEND_URL || '';
const SC_BASE = `${_scBackend}/sci-wp`;
import { formatCaseTitleShort, formatParty, listParties } from "../utils/caseTitle";
import { useApp } from "../AppContext";
import { fmtDate, fmtDT, SectionCard, SectionIconBox, DR, Badge, LABEL_COLORS, parseListingData, formatDMY, formatDateForDisplay } from "../caseHelpers";
import { getNotes, createNote, updateNote, deleteNote } from '../services/notesService';
import { fetchOfficeReport, fetchLastOrders, fetchEarlierCourt, fetchCaseDocuments, generateOfficeReportUrl, isCached } from '../services/eCourtsService';
import { Note } from '../types/notes';
import axios from "axios";
import { supabase } from '../lib/supabaseClient';
import { generateLegalTasks, generateOfficeReportTasks } from '../caseLogic';
import { buildOfficeReportData, renderOfficeReportText, renderOfficeReportHtml } from '../services/officeReportBuilder';
import { normaliseTaskKey, generatePredictedReport } from '../services/aiTaskService';


// ── UTILITY: Fetch with timeout ────────────────────────────────────────────
async function fetchWithTimeout<T>(
  fetchFn: () => Promise<T | null>,
  timeoutMs: number = 8000
): Promise<T | null> {
  try {
    return await Promise.race([
      fetchFn(),
      new Promise<null>((_, reject) => 
        setTimeout(() => reject(new Error('timeout')), timeoutMs)
      )
    ]);
  } catch (error) {
    console.error('[fetchWithTimeout] Error:', error);
    return null;
  }
}

// ── CASE SUMMARY ──────────────────────────────────────────────────────────────
export function CaseSummarySection({ selected, onUpdate }: { selected: any; onUpdate: (c: any) => void }) {
    const { T } = useApp();
    const [open, setOpen] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(selected.summary || "");
    useEffect(() => { setDraft(selected.summary || ""); setEditing(false); setOpen(false); }, [selected.id]);
    function save() { onUpdate({ ...selected, summary: draft }); setEditing(false); }
    return (
        <div style={{ background: T.bg, borderRadius: 12, border: `1px solid ${selected.keyRisk ? '#EF4444' : T.border}`, padding: "14px 16px", boxShadow: "0 1px 4px rgba(15,28,63,0.08)", marginBottom: 10 }}>
            <div onClick={() => setOpen(o => !o)} style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: open ? 8 : 0, cursor: "pointer", userSelect: "none" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flex: 1, minWidth: 0 }}>
                    <SectionIconBox icon="📋" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: T.text, letterSpacing: 0.8, marginBottom: 3 }}>CASE SUMMARY</div>
                        <div style={{ fontSize: 14, color: T.textMuted }}>{selected.summary ? "Summary added" : "No summary yet"}</div>
                    </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: T.textMuted, display: "inline-block", transform: open ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.2s" }}>▼</span>
                </div>
            </div>
            {open && <>
                {/* Case Summary text */}
                <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, letterSpacing: 0.8, marginBottom: 6, textTransform: "uppercase" }}>Summary</div>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            {!editing && <div style={{ fontSize: 14, color: selected.summary ? T.text : T.textMuted, lineHeight: 1.6 }}>
                                {selected.summary ? (expanded ? selected.summary : selected.summary.slice(0, 120) + (selected.summary.length > 120 ? "…" : "")) : "No summary yet. Click Edit to add one."}
                            </div>}
                            {editing && (
                                <div style={{ marginTop: 4 }}>
                                    <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={4} placeholder="Write case summary here…"
                                        style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 14, color: T.text, resize: "vertical", outline: "none", boxSizing: "border-box", fontFamily: "inherit", lineHeight: 1.6 }} />
                                    <div style={{ display: "flex", gap: 7, marginTop: 6, justifyContent: "flex-end" }}>
                                        <button onClick={() => { setEditing(false); setDraft(selected.summary || ""); }} style={{ padding: "5px 12px", borderRadius: 7, border: `1px solid ${T.border}`, background: T.bg, color: T.textSub, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
                                        <button onClick={save} style={{ padding: "5px 14px", borderRadius: 7, border: "none", background: "linear-gradient(135deg,#C9A84C,#9B7B28)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Save</button>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                            {!editing && selected.summary && <button onClick={e => { e.stopPropagation(); setExpanded(v => !v); }} style={{ fontSize: 13, fontWeight: 700, color: "#2A7BD4", background: "transparent", border: "none", cursor: "pointer", whiteSpace: "nowrap" }}>{expanded ? "▲ Hide" : "▼ View"}</button>}
                            {!editing && <button onClick={e => { e.stopPropagation(); setEditing(true); setExpanded(true); }} style={{ fontSize: 13, fontWeight: 700, color: T.accentDark, background: T.accentBg, border: `1px solid ${T.accentBorder}`, borderRadius: 7, padding: "3px 10px", cursor: "pointer", whiteSpace: "nowrap" }}>✏️ {selected.summary ? "Edit" : "Add"}</button>}
                        </div>
                    </div>
                </div>

                {/* Case Information + Listing Details side by side */}
                <div style={{ borderTop: `1px solid ${T.borderSoft}`, paddingTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "start" }}>
                    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 12px" }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, letterSpacing: 0.8, marginBottom: 8, textTransform: "uppercase" }}>Case Information</div>
                        <DR icon="👤" label="Petitioner(s)">
                            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 2 }}>
                                {listParties(selected.petitioner).map((name, i) => (
                                    <div key={i} style={{ display: "flex", gap: 6 }}>
                                        <span style={{ fontWeight: 700, minWidth: 18, color: "inherit" }}>{i + 1})</span>
                                        <span>{name}</span>
                                    </div>
                                ))}
                                {!selected.petitioner && <span>—</span>}
                            </div>
                        </DR>
                        <DR icon="👥" label="Respondent(s)">
                            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 2 }}>
                                {listParties(selected.respondent).map((name, i) => (
                                    <div key={i} style={{ display: "flex", gap: 6 }}>
                                        <span style={{ fontWeight: 700, minWidth: 18, color: "inherit" }}>{i + 1})</span>
                                        <span>{name}</span>
                                    </div>
                                ))}
                                {!selected.respondent && <span>—</span>}
                            </div>
                        </DR>
                        <DR icon="#" label="D.No">{selected.diaryNumber} / {selected.diaryYear}</DR>
                        <DR icon="🔖" label="CNR">{selected.cnrNumber || "—"}</DR>
                        <DR icon="📋" label="Case No.">{selected.caseNumber || "—"}</DR>
                        {selected.registrationDate && <DR icon="📋" label="Registered On">{fmtDate(selected.registrationDate)}</DR>}
                        {selected.verificationDate && <DR icon="✅" label="Verified On">{fmtDate(selected.verificationDate)}</DR>}
                        <DR icon="⚖" label="Court">{selected.courtName}</DR>
                        <DR icon="🏛" label="Court No.">{selected.courtNumber}</DR>
                        <DR icon="🕐" label="Time">{selected.timeOfSitting}</DR>
                        <DR icon="🏷" label="Labels"><div style={{ display: "flex", flexWrap: "wrap", marginTop: 3 }}>{selected.labels?.length > 0 ? selected.labels.map((l: string) => <Badge key={l} text={l} color={LABEL_COLORS[l] || "#888"} />) : <span style={{ color: T.textMuted }}>—</span>}</div></DR>
                    </div>
                    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 12px" }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, letterSpacing: 0.8, marginBottom: 8, textTransform: "uppercase" }}>Listing Details</div>
                        <DR icon="📅" label="Filed">{fmtDate(selected.dateOfFiling)}</DR>
                        {selected.lastListedJudges?.length > 0 && <DR icon="🧑‍⚖️" label="Judges">{selected.lastListedJudges.join("; ")}</DR>}
                        <DR icon="📌" label="Advance List">{selected.advanceList?.date ? fmtDate(selected.advanceList.date) : selected.advanceList?.published ? "Published" : "Awaited"}</DR>
                        <DR icon="📌" label="Final List">{selected.finalList?.date ? fmtDate(selected.finalList.date) : selected.finalList?.published ? "Published" : "Awaited"}</DR>
                        <DR icon="🔄" label="Checked">{fmtDT(selected.lastCheckedAt)}</DR>
                    </div>
                </div>

                {/* Client Contact Section (NEW) */}
                <div style={{ borderTop: `1px solid ${T.borderSoft}`, marginTop: 12, paddingTop: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, letterSpacing: 0.8, marginBottom: 8, textTransform: "uppercase" }}>Client Contact</div>
                    <ClientContactSection caseId={selected.id} clientId={selected.client_id} onUpdate={onUpdate} selected={selected} />
                </div>
            </>}
        </div>
    );
}

import { communicationService, Client } from '../services/communicationService';

function ClientContactSection({ caseId, clientId, onUpdate, selected }: any) {
    const { T } = useApp();
    const [client, setClient] = useState<Client | null>(null);
    const [loading, setLoading] = useState(false);
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [email, setEmail] = useState("");
    const [sending, setSending] = useState(false);
    const { setSuccessToast } = useApp();

    useEffect(() => {
        if (clientId) {
            setLoading(true);
            communicationService.getClients().then(clients => {
                const found = clients.find(c => c.id === clientId);
                if (found) {
                    setClient(found);
                    setName(found.name);
                    setPhone(found.whatsapp_number);
                    setEmail(found.email);
                }
                setLoading(false);
            });
        } else {
            setClient(null);
            setName(""); setPhone(""); setEmail("");
        }
    }, [clientId, selected.id]);

    const handleSave = async () => {
        setLoading(true);
        const saved = await communicationService.saveClient({
            id: clientId,
            name,
            whatsapp_number: phone,
            email,
            preferences: { channels: ['whatsapp'], language: 'auto' }
        });
        if (saved) {
            setClient(saved);
            onUpdate({ ...selected, client_id: saved.id });
            setEditing(false);
        }
        setLoading(false);
    };

    const handleNotifyWhatsApp = async () => {
        if (!client?.whatsapp_number) {
            setEditing(true);
            alert('No WhatsApp number found for this client.\n\nPlease add the contact number below and save before sending.');
            return;
        }
        setSending(true);
        
        // Prepare template variables: {"1":"12/1","2":"3pm"}
        const date = selected.nextHearingDate ? new Date(selected.nextHearingDate) : new Date();
        const variables = {
            "1": `${date.getDate()}/${date.getMonth() + 1}`,
            "2": selected.status || "Listed"
        };

        const ok = await communicationService.sendNotification({
            caseId: selected.id,
            clientId: client.id,
            channel: 'whatsapp',
            content: `Status update for case ${selected.caseNumber || ''}`,
            eventType: 'status_update',
            whatsappTo: client.whatsapp_number,
            contentVariables: variables
        });

        if (ok) {
            setSuccessToast?.("WhatsApp notification sent successfully!");
        } else {
            console.error("Failed to send WhatsApp");
        }
        setSending(false);
    };

    if (loading && !editing) return <div style={{ fontSize: 13, color: T.textMuted }}>Loading client...</div>;

    if (!clientId && !editing) {
        return <button onClick={() => setEditing(true)} style={{ padding: "6px 12px", borderRadius: 8, border: `1px dashed ${T.accent}`, background: T.accentBg, color: T.accentDark, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>+ Link Client</button>;
    }

    if (editing) {
        return (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, background: T.surface, padding: 12, borderRadius: 10, border: `1px solid ${T.border}` }}>
                <div style={{ gridColumn: "1/-1" }}>
                    <label style={{ fontSize: 10, fontWeight: 800, color: T.textMuted, letterSpacing: 0.5 }}>FULL NAME</label>
                    <input value={name} onChange={e => setName(e.target.value)} style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 13, background: T.bg, color: T.text }} placeholder="Client Name" />
                </div>
                <div>
                    <label style={{ fontSize: 10, fontWeight: 800, color: T.textMuted, letterSpacing: 0.5 }}>WHATSAPP</label>
                    <input value={phone} onChange={e => setPhone(e.target.value)} style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 13, background: T.bg, color: T.text }} placeholder="+91..." />
                </div>
                <div>
                    <label style={{ fontSize: 10, fontWeight: 800, color: T.textMuted, letterSpacing: 0.5 }}>EMAIL</label>
                    <input value={email} onChange={e => setEmail(e.target.value)} style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 13, background: T.bg, color: T.text }} placeholder="email@example.com" />
                </div>
                <div style={{ gridColumn: "1/-1", display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 4 }}>
                    <button onClick={() => setEditing(false)} style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.bg, color: T.textSub, fontSize: 11, fontWeight: 700 }}>Cancel</button>
                    <button onClick={handleSave} style={{ padding: "4px 12px", borderRadius: 6, border: "none", background: T.accentDark, color: "#fff", fontSize: 11, fontWeight: 700 }}>Save Client</button>
                </div>
            </div>
        );
    }

    return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: T.surface, padding: "10px 14px", borderRadius: 10, border: `1px solid ${T.border}` }}>
            <div style={{ display: "flex", gap: 24 }}>
                <div>
                    <div style={{ fontSize: 10, fontWeight: 800, color: T.textMuted, marginBottom: 2 }}>CLIENT</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{client?.name}</div>
                </div>
                <div>
                    <div style={{ fontSize: 10, fontWeight: 800, color: T.textMuted, marginBottom: 2 }}>WHATSAPP</div>
                    <div style={{ fontSize: 13, color: T.textSub }}>{client?.whatsapp_number || "—"}</div>
                </div>
                <div>
                    <div style={{ fontSize: 10, fontWeight: 800, color: T.textMuted, marginBottom: 2 }}>EMAIL</div>
                    <div style={{ fontSize: 13, color: T.textSub }}>{client?.email || "—"}</div>
                </div>
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                {client?.whatsapp_number && (
                    <button 
                        onClick={handleNotifyWhatsApp} 
                        disabled={sending}
                        style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: "#1A8C5B", color: "#fff", fontSize: 11, fontWeight: 700, cursor: sending ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 4 }}
                    >
                        {sending ? "..." : "📱 Notify WhatsApp"}
                    </button>
                )}
                <button onClick={() => setEditing(true)} style={{ fontSize: 12, color: T.accentDark, background: "none", border: "none", fontWeight: 700, cursor: "pointer" }}>Edit</button>
            </div>
        </div>
    );
}

// ── LISTINGS ──────────────────────────────────────────────────────────────────
export function ListingsSection({ selected, onUpdate }: { selected: any; onUpdate: (c: any) => void }) {
    const { T } = useApp();
    const [showForm, setShowForm] = useState(false);
    const [showSnapshot, setShowSnapshot] = useState(false);
    const [form, setForm] = useState({ date: "", type: "Daily List of Miscellaneous Matters", bench: "", court: "", item: "" });
    const listings = selected.listings || [];
    
    // Parse listing data from case fields
    const parsed = parseListingData(selected);
    
    // Determine status badge color
    const getStatusBadgeColor = () => {
        if (parsed.statusBadge === "DISPOSED") return "#1A8C5B";
        if (parsed.statusBadge === "PENDING") return "#C9A84C";
        return "#8A94B0";
    };
    
    // Format dates using helper
    const lastListedDateFormatted = parsed.lastListedDate ? formatDMY(parsed.lastListedDate) : "";
    const nextListedDateFormatted = parsed.nextListingDate ? formatDMY(parsed.nextListingDate) : "";
    
    // Check if next date is in past
    const getDaysUntil = (dateStr: string | null) => {
        if (!dateStr) return null;
        const match = dateStr.match(/(\d{2})-(\d{2})-(\d{4})/);
        if (!match) return null;
        const [, day, month, year] = match;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const target = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        target.setHours(0, 0, 0, 0);
        return Math.round((target.getTime() - today.getTime()) / 86400000);
    };
    const daysUntilNext = getDaysUntil(parsed.nextListingDate);
    
    // Determine status badge for next listing
    const getNextBadge = () => {
        if (!daysUntilNext && daysUntilNext !== 0) return "UPCOMING";
        if (daysUntilNext < 0) return "PASSED";
        if (daysUntilNext <= 7 && daysUntilNext >= 0) return "URGENT";
        return "UPCOMING";
    };

    function addListing() {
        if (!form.date) return;
        const newL = { id: "l" + Date.now(), ...form };
        const sorted = [newL, ...listings].sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
        onUpdate({ ...selected, listings: sorted });
        setForm({ date: "", type: "Daily List of Miscellaneous Matters", bench: "", court: "", item: "" });
        setShowForm(false);
    }

    const copySnapshotToClipboard = () => {
        const snapshot = `CASE SNAPSHOT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LAST HEARING
Date: ${lastListedDateFormatted}
Status: ${parsed.statusBadge}
Judges: ${parsed.judges.join(", ") || "—"}
Stage: ${parsed.stage}
${parsed.iaNumbers.length > 0 ? `IA Numbers: ${parsed.iaNumbers.join(" · ")}` : ""}
${parsed.orderDate ? `Order Date: ${parsed.orderDate}` : ""}
${parsed.noticeReturnable ? `Notice Returnable: ${parsed.noticeReturnable}` : ""}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${parsed.nextListingDate ? `NEXT LISTING
Date: ${nextListedDateFormatted}
Status: ${getNextBadge()}
Source: ${parsed.nextListingSource}

` : ""}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
        
        navigator.clipboard.writeText(snapshot).then(() => {
            alert("Snapshot copied to clipboard!");
        });
    };

    return (
        <SectionCard 
            icon="📑" 
            title="LISTINGS" 
            count={parsed.lastListedDate ? `Last: ${lastListedDateFormatted}` : "No listings recorded"} 
            onAdd={() => setShowForm(s => !s)} 
            addLabel={showForm ? "✕ Cancel" : "+ Add Listing"}
        >
            {/* COMPACT SINGLE CARD — Last Listing */}
            {parsed.lastListedDate && (
                <div style={{ background: T.surface, borderRadius: 9, border: `1px solid ${T.borderSoft}`, padding: "12px 14px", marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: 0.7, marginBottom: 6, textTransform: "uppercase" }}>Last Listing</div>
                    {/* Line 1: Date (bold) + Badge (inline right) */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <div style={{ fontSize: 17, fontWeight: 800, color: T.text }}>
                            {lastListedDateFormatted}
                        </div>
                        <div style={{ background: getStatusBadgeColor() + "20", color: getStatusBadgeColor(), padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>
                            {parsed.statusBadge}
                        </div>
                    </div>

                    {/* Line 2: Judges (muted, 13px) */}
                    {parsed.judges.length > 0 && (
                        <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 6, fontWeight: 500 }}>
                            {parsed.judges.join(" • ")}
                        </div>
                    )}

                    {/* Line 3: Stage */}
                    {parsed.stage && (
                        <div style={{ fontSize: 13, color: T.text, marginBottom: 6 }}>
                            {parsed.stage}
                        </div>
                    )}

                    {/* Line 4: Next Date (if available) */}
                    {parsed.nextListingDate && (
                        <div style={{ fontSize: 12, color: T.textSub }}>
                            Next: {nextListedDateFormatted}
                        </div>
                    )}
                </div>
            )}

            {/* NEXT HEARING CARD — shown for pending/fresh cases with a scheduled date */}
            {!parsed.lastListedDate && (selected.nextHearingDate || selected.likelyListedOn) && (() => {
                const nextDate = selected.nextHearingDate || selected.likelyListedOn;
                const today = new Date(); today.setHours(0, 0, 0, 0);
                const nd = new Date(nextDate); nd.setHours(0, 0, 0, 0);
                const isFuture = nd >= today;
                const daysLeft = Math.round((nd.getTime() - today.getTime()) / 86400000);
                return (
                    <div style={{ background: isFuture ? "#F0FDF4" : T.surface, borderRadius: 9, border: `1px solid ${isFuture ? "#86EFAC" : T.borderSoft}`, padding: "12px 14px", marginBottom: 12 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: isFuture ? "#15803D" : T.textMuted, letterSpacing: 0.7, marginBottom: 6, textTransform: "uppercase" }}>
                            {isFuture ? "Scheduled / Next Hearing" : "Last Scheduled Date"}
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div style={{ fontSize: 17, fontWeight: 800, color: isFuture ? "#15803D" : T.text }}>
                                {formatDateForDisplay(nextDate) || nextDate}
                            </div>
                            <div style={{ background: isFuture ? "#DCFCE7" : "#F3F4F6", color: isFuture ? "#15803D" : "#6B7280", padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700 }}>
                                {isFuture ? (daysLeft === 0 ? "TODAY" : `IN ${daysLeft}D`) : "PASSED"}
                            </div>
                        </div>
                        <div style={{ fontSize: 12, color: T.textMuted, marginTop: 4 }}>
                            {parsed.statusBadge} · {selected.stage || "Pending hearing"}
                        </div>
                    </div>
                );
            })()}

            {/* LISTING HISTORY from eCourts API — shown directly for pending cases too */}
            {listings.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: 0.7, marginBottom: 8, textTransform: "uppercase" }}>Hearing History ({listings.length})</div>
                    {listings.slice(0, 5).map((l: any) => (
                        <div key={l.id} style={{ background: T.surface, borderRadius: 8, border: `1px solid ${T.borderSoft}`, padding: "10px 12px", marginBottom: 8 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: l.bench || l.type ? 5 : 0 }}>
                                <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{formatDateForDisplay(l.date) || l.date}</div>
                                {l.type && <span style={{ fontSize: 10, fontWeight: 700, background: "#EFF6FF", color: "#1E40AF", padding: "2px 7px", borderRadius: 4 }}>{l.type.slice(0, 20)}</span>}
                            </div>
                            {l.bench && <div style={{ fontSize: 12, color: T.textMuted }}>{l.bench}</div>}
                            {l.notes && <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>{l.notes.replace(' — synced from eCourts API', '')}</div>}
                        </div>
                    ))}
                    {listings.length > 5 && (
                        <div style={{ fontSize: 12, color: T.textMuted, textAlign: "center", padding: "6px 0" }}>
                            + {listings.length - 5} more — open Snapshot to see all
                        </div>
                    )}
                </div>
            )}

            {/* Snapshot Button — show whenever there is any listing/hearing data */}
            {(!!parsed.lastListedDate || listings.length > 0 || !!selected.lastListedOn || !!selected.nextHearingDate || !!selected.likelyListedOn) && (
                <button
                    onClick={() => setShowSnapshot(true)}
                    style={{
                        marginBottom: 12,
                        padding: "7px 14px",
                        borderRadius: 7,
                        border: `1px solid #2A7BD4`,
                        background: "rgba(42,123,212,0.07)",
                        color: "#2A7BD4",
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        width: "100%",
                        justifyContent: "center"
                    }}>
                    👁 View Listing Snapshot
                </button>
            )}
            
            {/* SNAPSHOT MODAL */}
            {showSnapshot && (
                <div style={{
                    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
                    background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center",
                    zIndex: 999, padding: 16
                }} onClick={() => setShowSnapshot(false)}>
                    <div
                        style={{
                            background: T.bg, borderRadius: 14, border: `1px solid ${T.border}`,
                            width: "100%", maxWidth: 720, maxHeight: "88vh", overflow: "auto",
                            boxShadow: "0 8px 40px rgba(0,0,0,0.35)"
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div style={{ position: "sticky", top: 0, background: T.bg, borderBottom: `1px solid ${T.border}`, padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", zIndex: 1 }}>
                            <div>
                                <div style={{ fontSize: 16, fontWeight: 800, color: T.text }}>Case Hearing Details</div>
                                <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>{selected.caseNumber || `Diary ${selected.diaryNumber}/${selected.diaryYear}`}</div>
                            </div>
                            <button onClick={() => setShowSnapshot(false)} style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", fontSize: 20, lineHeight: 1 }}>✕</button>
                        </div>

                        <div style={{ padding: "16px 20px" }}>
                            {/* ── LISTING HISTORY — NAME CARDS ── */}
                            <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, letterSpacing: 0.8, marginBottom: 12, textTransform: "uppercase" }}>Listing History</div>

                            {/* Card: From SC API data */}
                            {parsed.lastListedDate && (() => {
                                const rows: { label: string; value: string }[] = [
                                    { label: "CL Date", value: lastListedDateFormatted },
                                    { label: "Misc./Regular", value: "—" },
                                    { label: "Stage", value: parsed.stage || "—" },
                                    { label: "Judges", value: parsed.judges.length > 0 ? parsed.judges.join(", ") : "—" },
                                    { label: "IA Numbers", value: parsed.iaNumbers.length > 0 ? parsed.iaNumbers.join(" · ") : "—" },
                                    { label: "Remarks", value: parsed.orderDate ? `Order: ${formatDateForDisplay(parsed.orderDate)}` : parsed.noticeReturnable ? `Notice: ${parsed.noticeReturnable}` : "—" },
                                    { label: "Listed", value: parsed.statusBadge },
                                ];
                                const statusColor = parsed.statusBadge === "DISPOSED" ? "#047857" : "#B45309";
                                const statusBg = parsed.statusBadge === "DISPOSED" ? "#D1FAE5" : "#FEF3C7";
                                return (
                                    <div style={{ background: T.surface, borderRadius: 10, border: `1px solid ${T.border}`, padding: "14px 16px", marginBottom: 12 }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                                            <div style={{ fontSize: 16, fontWeight: 800, color: T.text }}>{lastListedDateFormatted}</div>
                                            <span style={{ fontSize: 10, fontWeight: 700, background: statusBg, color: statusColor, padding: "2px 8px", borderRadius: 4 }}>{parsed.statusBadge}</span>
                                        </div>
                                        {rows.slice(1, -1).map(r => r.value && r.value !== "—" ? (
                                            <div key={r.label} style={{ display: "flex", gap: 10, marginBottom: 6, alignItems: "flex-start" }}>
                                                <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, width: 100, flexShrink: 0, letterSpacing: 0.5 }}>{r.label.toUpperCase()}</div>
                                                <div style={{ fontSize: 13, color: T.text, flex: 1 }}>{r.value}</div>
                                            </div>
                                        ) : null)}
                                        <div style={{ display: "flex", gap: 8, marginTop: 4, alignItems: "center" }}>
                                            <span style={{ fontSize: 10, fontWeight: 700, background: "#EFF6FF", color: "#1E40AF", padding: "2px 8px", borderRadius: 4 }}>SC DATA</span>
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* Cards: Manual / synced listings */}
                            {(listings || []).filter((l: any) => l.date).map((l: any) => (
                                <div key={l.id} style={{ background: T.surface, borderRadius: 10, border: `1px solid ${T.border}`, padding: "14px 16px", marginBottom: 12 }}>
                                    <div style={{ fontSize: 16, fontWeight: 800, color: T.text, marginBottom: 10 }}>{formatDateForDisplay(l.date) || l.date}</div>
                                    {l.type && (
                                        <div style={{ display: "flex", gap: 10, marginBottom: 6, alignItems: "flex-start" }}>
                                            <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, width: 100, flexShrink: 0, letterSpacing: 0.5 }}>MISC./REGULAR</div>
                                            <div style={{ fontSize: 13, color: T.text, flex: 1 }}>{l.type}</div>
                                        </div>
                                    )}
                                    {l.bench && (
                                        <div style={{ display: "flex", gap: 10, marginBottom: 6, alignItems: "flex-start" }}>
                                            <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, width: 100, flexShrink: 0, letterSpacing: 0.5 }}>JUDGES</div>
                                            <div style={{ fontSize: 13, color: T.text, flex: 1 }}>{l.bench}</div>
                                        </div>
                                    )}
                                    {l.court && (
                                        <div style={{ display: "flex", gap: 10, marginBottom: 6, alignItems: "flex-start" }}>
                                            <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, width: 100, flexShrink: 0, letterSpacing: 0.5 }}>COURT NO.</div>
                                            <div style={{ fontSize: 13, color: T.text, flex: 1 }}>{l.court}</div>
                                        </div>
                                    )}
                                    {(l.notes && l.notes !== "Auto-synced from Supreme Court Database") || l.item ? (
                                        <div style={{ display: "flex", gap: 10, marginBottom: 6, alignItems: "flex-start" }}>
                                            <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, width: 100, flexShrink: 0, letterSpacing: 0.5 }}>REMARKS</div>
                                            <div style={{ fontSize: 13, color: T.text, flex: 1 }}>{l.notes && l.notes !== "Auto-synced from Supreme Court Database" ? l.notes : `Item ${l.item}`}</div>
                                        </div>
                                    ) : null}
                                    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                                        <span style={{ fontSize: 10, fontWeight: 700, background: "#F3F4F6", color: "#6B7280", padding: "2px 8px", borderRadius: 4 }}>MANUAL</span>
                                    </div>
                                </div>
                            ))}

                            {/* Scheduled / Next Hearing Card — shown when no past hearing but future date exists */}
                            {!parsed.lastListedDate && listings.length === 0 && (selected.nextHearingDate || selected.likelyListedOn) && (() => {
                                const schedDate = selected.nextHearingDate || selected.likelyListedOn;
                                const schedFormatted = formatDateForDisplay(schedDate) || schedDate;
                                const today = new Date(); today.setHours(0,0,0,0);
                                const nd = new Date(schedDate); nd.setHours(0,0,0,0);
                                const isFuture = nd >= today;
                                const daysLeft = Math.round((nd.getTime() - today.getTime()) / 86400000);
                                return (
                                    <div style={{ background: isFuture ? "#F0FDF4" : T.surface, borderRadius: 10, border: `1px solid ${isFuture ? "#86EFAC" : T.borderSoft}`, padding: "14px 16px", marginBottom: 12 }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                                            <div style={{ fontSize: 16, fontWeight: 800, color: isFuture ? "#15803D" : T.text }}>{schedFormatted}</div>
                                            <span style={{ fontSize: 10, fontWeight: 700, background: isFuture ? "#DCFCE7" : "#F3F4F6", color: isFuture ? "#15803D" : "#6B7280", padding: "2px 8px", borderRadius: 4 }}>
                                                {isFuture ? (daysLeft === 0 ? "TODAY" : `IN ${daysLeft}D`) : "PASSED"}
                                            </span>
                                        </div>
                                        <div style={{ display: "flex", gap: 10, marginBottom: 6, alignItems: "flex-start" }}>
                                            <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, width: 100, flexShrink: 0, letterSpacing: 0.5 }}>STATUS</div>
                                            <div style={{ fontSize: 13, color: T.text, flex: 1 }}>{selected.status || "Pending"}</div>
                                        </div>
                                        {selected.stage && (
                                            <div style={{ display: "flex", gap: 10, marginBottom: 6, alignItems: "flex-start" }}>
                                                <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, width: 100, flexShrink: 0, letterSpacing: 0.5 }}>STAGE</div>
                                                <div style={{ fontSize: 13, color: T.text, flex: 1 }}>{selected.stage}</div>
                                            </div>
                                        )}
                                        {selected.courtNumber && (
                                            <div style={{ display: "flex", gap: 10, marginBottom: 6, alignItems: "flex-start" }}>
                                                <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, width: 100, flexShrink: 0, letterSpacing: 0.5 }}>COURT NO.</div>
                                                <div style={{ fontSize: 13, color: T.text, flex: 1 }}>{selected.courtNumber}</div>
                                            </div>
                                        )}
                                        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                                            <span style={{ fontSize: 10, fontWeight: 700, background: "#EFF6FF", color: "#1E40AF", padding: "2px 8px", borderRadius: 4 }}>SCHEDULED</span>
                                        </div>
                                    </div>
                                );
                            })()}

                            {!parsed.lastListedDate && listings.length === 0 && !selected.nextHearingDate && !selected.likelyListedOn && (
                                <div style={{ padding: "20px", textAlign: "center", color: T.textMuted, fontSize: 13, background: T.surface, borderRadius: 9, border: `1px solid ${T.border}` }}>
                                    No listing data available yet
                                </div>
                            )}

                            {/* ── NEXT LISTING BANNER ── */}
                            {parsed.nextListingDate && (
                                <div style={{ background: "#FBF4E3", border: "1px solid #E8D18A", borderRadius: 9, padding: "12px 16px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <div>
                                        <div style={{ fontSize: 11, fontWeight: 800, color: "#B45309", letterSpacing: 0.6, marginBottom: 3 }}>TENTATIVE NEXT LISTING</div>
                                        <div style={{ fontSize: 15, fontWeight: 800, color: "#92400E" }}>{nextListedDateFormatted}</div>
                                        <div style={{ fontSize: 11, color: "#B45309", marginTop: 2 }}>{parsed.nextListingSource}</div>
                                    </div>
                                    <span style={{ fontSize: 11, fontWeight: 700, background: "#FEF3C7", color: "#B45309", padding: "3px 8px", borderRadius: 4 }}>{getNextBadge()}</span>
                                </div>
                            )}

                            {/* ── Copy Button ── */}
                            <button
                                onClick={copySnapshotToClipboard}
                                style={{ width: "100%", padding: "10px 14px", borderRadius: 7, border: `1px solid ${T.border}`, background: T.surface, color: T.textSub, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                                📋 Copy Snapshot to Clipboard
                            </button>
                        </div>
                    </div>
                </div>
            )}
            
            {/* ADD LISTING FORM */}
            {showForm && (
                <div style={{ background: T.surface, borderRadius: 9, border: `1px solid ${T.border}`, padding: "16px", marginBottom: 12 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                        <div>
                            <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: 0.8, display: "block", marginBottom: 4 }}>DATE</label>
                            <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${T.border}`, fontSize: 14, color: T.text, outline: "none", boxSizing: "border-box", background: T.bg }} />
                        </div>
                        <div>
                            <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: 0.8, display: "block", marginBottom: 4 }}>LIST TYPE</label>
                            <input type="text" placeholder="e.g. Daily List..." value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${T.border}`, fontSize: 14, color: T.text, outline: "none", boxSizing: "border-box", background: T.bg }} />
                        </div>
                    </div>
                    <div style={{ marginBottom: 12 }}>
                        <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: 0.8, display: "block", marginBottom: 4 }}>BENCH (Judges)</label>
                        <input type="text" placeholder="e.g. Mr. Justice Sanjay Karol..." value={form.bench} onChange={e => setForm(f => ({ ...f, bench: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${T.border}`, fontSize: 14, color: T.text, outline: "none", boxSizing: "border-box", background: T.bg }} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                        <div>
                            <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: 0.8, display: "block", marginBottom: 4 }}>COURT NO.</label>
                            <input type="text" placeholder="e.g. 11" value={form.court} onChange={e => setForm(f => ({ ...f, court: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${T.border}`, fontSize: 14, color: T.text, outline: "none", boxSizing: "border-box", background: T.bg }} />
                        </div>
                        <div>
                            <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: 0.8, display: "block", marginBottom: 4 }}>ITEM NO.</label>
                            <input type="text" placeholder="e.g. 119" value={form.item} onChange={e => setForm(f => ({ ...f, item: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${T.border}`, fontSize: 14, color: T.text, outline: "none", boxSizing: "border-box", background: T.bg }} />
                        </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 7 }}>
                        <button onClick={() => setShowForm(false)} style={{ padding: "7px 14px", borderRadius: 7, border: `1px solid ${T.border}`, background: T.bg, color: T.textSub, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
                        <button onClick={addListing} style={{ padding: "7px 18px", borderRadius: 7, border: "none", background: "linear-gradient(135deg,#C9A84C,#9B7B28)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Add Listing</button>
                    </div>
                </div>
            )}
        </SectionCard>
    );
}

// ── TIMELINE ──────────────────────────────────────────────────────────────────

// ── helpers (safe for both ISO "YYYY-MM-DD" and raw SC "DD-MM-YYYY [...]") ──
function parseSCDate(raw: string | null | undefined): string {
    if (!raw) return "";
    const m = raw.match(/(\d{2})-(\d{2})-(\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}
function extractJudges(raw: string | null | undefined): string[] {
    if (!raw) return [];
    const m = raw.match(/\[(.+)\]/);
    if (!m) return [];
    return m[1].split(/\band\b/i)
        .map((j: string) => j.replace(/HON'BLE\s+MR\.\s+/i, "").trim())
        .filter(Boolean);
}
function extractLikelyDate(c: any): string {
    if (c.likelyListedOn) return c.likelyListedOn;
    if (c.nextHearingDate) return c.nextHearingDate;
    return "";
}
function getDaysUntilDate(iso: string): number | null {
    if (!iso) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const t = new Date(iso); t.setHours(0, 0, 0, 0);
    if (isNaN(t.getTime())) return null;
    return Math.round((t.getTime() - today.getTime()) / 86400000);
}

// ── auto-build SC events from case fields ─────────────────────────────────────
function buildSCEvents(c: any): any[] {
    const evs: any[] = [];
    const lastListedOn = c.lastListedOn || parseSCDate(c.lastListedOnRaw);
    const likelyListedOn = extractLikelyDate(c);
    const judges = c.lastListedJudges?.length
        ? c.lastListedJudges
        : extractJudges(c.lastListedOnRaw || "");

    // 1. Case Filed
    if (c.dateOfFiling) evs.push({
        id: "__filing", type: "filing",
        date: c.dateOfFiling,
        event: "Case filed in Supreme Court",
        sub: c.caseNumber
            ? `Case No: ${c.caseNumber}`
            : c.cnrNumber
                ? `CNR: ${c.cnrNumber}`
                : c.diaryNumber
                    ? `Diary No. ${c.diaryNumber}/${c.diaryYear}`
                    : `Year: ${c.diaryYear || '—'}`,
        sub2: c.cnrNumber ? `CNR: ${c.cnrNumber}` : null,
        source: "SC Registry", auto: true,
    });

    // 1a. Case Registered (from eCourts API — may differ from filing date)
    if (c.registrationDate && c.registrationDate !== c.dateOfFiling) evs.push({
        id: "__registration", type: "filing",
        date: c.registrationDate,
        event: "Case registered at SC Registry",
        sub: c.caseNumber ? `Case No: ${c.caseNumber}` : (c.diaryNumber ? `Diary No. ${c.diaryNumber}/${c.diaryYear}` : null),
        source: "SC Registry", auto: true,
    });

    // 1b. Case Verified
    if (c.verificationDate) evs.push({
        id: "__verification", type: "filing",
        date: c.verificationDate,
        event: "Case number verified by SC Registry",
        sub: c.caseNumber ? `Case No: ${c.caseNumber}` : null,
        source: "SC Registry", auto: true,
    });

    // 2. Last Listed On
    if (lastListedOn) evs.push({
        id: "__listed", type: "listing",
        date: lastListedOn,
        event: "Case listed in Supreme Court",
        sub: judges.length
            ? `Before ${judges.join(" & ")}`
            : `${c.courtNumber || "Court No. 1"} · ${c.timeOfSitting || "10:30 AM"}`,
        sub2: judges.length ? `${c.courtNumber || "Court No. 1"} · ${c.timeOfSitting || "10:30 AM"}` : null,
        source: "SC Cause List", auto: true,
    });

    // 3. Order date parsed from stage string
    const stageOrderMatch = (c.stage || "").match(/Ord\s*dt[:\s]*(\d{2})-(\d{2})-(\d{4})/i);
    const linkedCase = (c.stage || "").match(/D\.\s*No\.\s*([\d]+\s*of\s*\d{4})/i);
    if (stageOrderMatch) evs.push({
        id: "__order", type: "order",
        date: `${stageOrderMatch[3]}-${stageOrderMatch[2]}-${stageOrderMatch[1]}`,
        event: "Order passed",
        sub: linkedCase ? `Listed with D. No. ${linkedCase[1]}` : "Motion Hearing — Adjourned Matters",
        source: "SC Order", auto: true,
    });

    // 4. Tentatively listed on (upcoming only if date is in the future)
    if (likelyListedOn) {
        const _today = new Date(); _today.setHours(0, 0, 0, 0);
        const _ld = new Date(likelyListedOn); _ld.setHours(0, 0, 0, 0);
        const _isUpcoming = _ld >= _today;
        evs.push({
            id: "__upcoming", type: _isUpcoming ? "upcoming" : "listing",
            date: likelyListedOn,
            event: _isUpcoming ? "Tentatively listed on" : "Case listed in Supreme Court",
            sub: "Computer generated · Subject to revision",
            source: "SC Website", auto: true, upcoming: _isUpcoming,
        });
    }

    // 5. Last fetched timestamp
    if (c.lastCheckedAt) evs.push({
        id: "__fetched", type: "system",
        date: c.lastCheckedAt,
        event: "Case data fetched from SC",
        sub: `CNR: ${c.cnrNumber || "—"}`,
        source: "Lex Tigress", auto: true, isDatetime: true,
    });

    return evs;
}

const TL_COLOR: Record<string, string> = {
    filing: "#2A7BD4", listing: "#C9A84C", order: "#7B3FA0",
    upcoming: "#1A8C5B", system: "#8A94B0",
    hearing: "#C9A84C", notice: "#C62828", other: "#8A94B0",
};
const TL_LABEL: Record<string, string> = {
    filing: "FILED", listing: "LISTED", order: "ORDER",
    upcoming: "UPCOMING", system: "SYNCED",
    hearing: "HEARING", notice: "NOTICE", other: "EVENT",
};
const TL_ICON: Record<string, string> = {
    filing: "📁", listing: "⚖️", order: "📋",
    upcoming: "📅", system: "🔄",
    hearing: "🗓️", notice: "📨", other: "🔖",
};

// ── EARLIER COURT SECTION ──────────────────────────────────────────────────
export function EarlierCourtSection({ selected, fetchTrigger = 0 }: { selected: any; fetchTrigger?: number }) {
    const { T } = useApp();
    const [open, setOpen] = useState(false);
    const [earlierCourt, setEarlierCourt] = useState<any>(null);
    const [earlierCourtHtml, setEarlierCourtHtml] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const loadingRef = useRef(false); // avoids stale closure bug in useEffect
    const [fetched, setFetched] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [showModal, setShowModal] = useState(false);

    const diaryNo = selected?.diaryNo || selected?.diaryNumber || selected?.diary_no;
    const diaryYear = selected?.diaryYear || selected?.year || selected?.diary_year;

    // Check cache status without triggering a fetch (used for badge display)
    const hasCachedData = selected?.cnrNumber ? isCached('earlierCourt', selected.cnrNumber) : false;

    const loadEarlierCourt = async () => {
        if (loadingRef.current) return;
        loadingRef.current = true;
        setLoading(true);
        setFetchError(null);


        // Try 1: eCourts API (works for district/HC, not SC)
        if (selected?.cnrNumber) {
            const details = await fetchWithTimeout(
                () => fetchEarlierCourt(selected.cnrNumber),
                8000
            );
            if (details) {
                const arr = Array.isArray(details) ? details : [details];
                const primary = arr.find((d: any) => d.judgmentChallenged === 'Yes' || d.judgment_challenged === 'Yes') || arr[0];
                const normalized = {
                    ...primary,
                    courtName: primary.court || primary.courtName || primary.court_name || '',
                    state: primary.state || primary.stateName || '',
                    caseNumber: primary.caseNo || primary.caseNumber || primary.case_number || '',
                    filingDate: primary.orderDate || primary.filingDate || primary.filing_date || '',
                    _allCourts: arr,
                };
                setEarlierCourt(normalized);
                // Don't return — fall through to Try 2 (SC website) which gives judges + full table
            }
        }

        // Try 2: SC website WordPress AJAX — earlier_court_details tab (has judge names)
        if (diaryNo && diaryYear) {
            try {
                const url = `${SC_BASE}/wp-admin/admin-ajax.php?diary_no=${diaryNo}&diary_year=${diaryYear}&tab_name=earlier_court_details&action=get_case_details&es_ajax_request=1&language=en`;
                const res = await fetchWithTimeout(
                    () => fetch(url).then(r => {
                        if (!r.ok) throw new Error(`SC site returned ${r.status}`);
                        return r.json();
                    }),
                    10000
                );
                if (!res) {
                    setFetchError('SC website request failed or timed out');
                } else if (res && 'error' in res) {
                    setFetchError(`SC error: ${res.message || res.error}`);
                } else {
                    const html = typeof res?.data === 'string' ? res.data : '';
                    if (html && html.trim().length > 50) {
                        setEarlierCourtHtml(html);
                        setFetched(true);
                        loadingRef.current = false;
                        setLoading(false);
                        return;
                    }
                }
            } catch (e: any) {
                setFetchError(e?.message || 'Network error');
            }
        } else if (!selected?.cnrNumber) {
            setFetchError('No diary number or CNR — cannot fetch earlier court details');
        }

        setFetched(true);
        loadingRef.current = false;
        setLoading(false);
    };

    // Reset state and auto-load when case changes
    useEffect(() => {
        setOpen(false);
        setEarlierCourt(null);
        setEarlierCourtHtml(null);
        setFetched(false);
        setFetchError(null);
        loadingRef.current = false; // reset immediately (avoids stale closure blocking next load)
        setLoading(false);

        // Auto-load if case has diary number, eCourts cache, or any CNR (eCourts fetch)
        const hasDiary = !!(diaryNo && diaryYear);
        const hasCached = selected?.cnrNumber ? isCached('earlierCourt', selected.cnrNumber) : false;
        if (hasDiary || hasCached || !!selected?.cnrNumber) {
            loadEarlierCourt();
        }
    }, [selected?.id]);

    // "Fetch All" trigger — runs fetch when parent increments fetchTrigger
    useEffect(() => {
        if (fetchTrigger > 0 && !loadingRef.current) loadEarlierCourt();
    }, [fetchTrigger]);

    // Extract judges from various possible formats
    const getJudges = () => {
        if (!earlierCourt) return [];
        if (Array.isArray(earlierCourt.judges)) {
            return earlierCourt.judges.filter((j: any) => j);
        }
        const judges = [];
        if (earlierCourt.judge_1) judges.push(earlierCourt.judge_1);
        if (earlierCourt.judge_2) judges.push(earlierCourt.judge_2);
        if (earlierCourt.judge_3) judges.push(earlierCourt.judge_3);
        if (!judges.length && earlierCourt.judge) judges.push(earlierCourt.judge);
        return judges;
    };

    // Build court display name — combine courtName + state if they're separate fields
    const courtName = (() => {
        const name = earlierCourt?.courtName || earlierCourt?.court_name || earlierCourt?.agency_code || '';
        const state = earlierCourt?.state || earlierCourt?.stateName || '';
        if (name && state && !name.toLowerCase().includes(state.toLowerCase())) {
            return `${name} — ${state}`;
        }
        return name;
    })();

    const caseNo = earlierCourt?.caseNumber || earlierCourt?.case_no || '';
    const orderDate = earlierCourt?.orderDate || earlierCourt?.order_date || '';
    const judgment = earlierCourt?.judgment || earlierCourt?.judgement || earlierCourt?.judgmentType || earlierCourt?.judgment_type || '';
    const judges = getJudges();
    const hasData = earlierCourtHtml || courtName || caseNo || orderDate || judges.length > 0 || judgment;

    // Escape key closes modal
    useEffect(() => {
        if (!showModal) return;
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowModal(false); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [showModal]);

    // Build HTML table render helper
    const renderHtmlTables = () => {
        const doc = new DOMParser().parseFromString(earlierCourtHtml!, 'text/html');
        const tables = Array.from(doc.querySelectorAll('table'));
        if (!tables.length) {
            // No tables — render raw text
            const text = (doc.body?.innerText || doc.body?.textContent || '').trim();
            return <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', color: T.text, margin: 0 }}>{text || '(no data)'}</pre>;
        }
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {tables.map((table, ti) => {
                    const headers = Array.from(table.querySelectorAll('thead th, tr:first-child th')).map(th => th.textContent?.trim() || '');
                    const rows = Array.from(table.querySelectorAll('tbody tr, tr')).slice(headers.length > 0 ? 0 : 1).map(tr =>
                        Array.from(tr.querySelectorAll('td')).map(td => td.textContent?.trim() || '')
                    ).filter(r => r.some(c => c));
                    if (!rows.length) return null;
                    return (
                        <div key={ti} style={{ background: T.surface, borderRadius: 9, border: `1px solid ${T.borderSoft}`, overflow: 'hidden' }}>
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                    {headers.length > 0 && (
                                        <thead>
                                            <tr>
                                                {headers.map((h, i) => (
                                                    <th key={i} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, fontSize: 11, color: '#C9A84C', background: '#1A3A6B', borderBottom: `1px solid ${T.borderSoft}`, whiteSpace: 'nowrap', letterSpacing: 0.5 }}>
                                                        {h.toUpperCase()}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                    )}
                                    <tbody>
                                        {rows.map((row, ri) => (
                                            <tr key={ri} style={{ borderBottom: ri < rows.length - 1 ? `1px solid ${T.borderSoft}` : 'none', background: ri % 2 === 0 ? T.surface : T.bg }}>
                                                {row.map((cell, ci) => (
                                                    <td key={ci} style={{ padding: '9px 12px', color: T.text, fontWeight: ci === 0 ? 600 : 400, verticalAlign: 'top' }}>
                                                        {cell || '—'}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    return (
        <>
        {/* Earlier Court Modal */}
        {showModal && hasData && (
            <div onClick={() => setShowModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,28,63,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                <div onClick={e => e.stopPropagation()} style={{ background: T.surface, borderRadius: 16, width: '100%', maxWidth: 820, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(15,28,63,0.25)', overflow: 'hidden' }}>
                    <div style={{ background: 'linear-gradient(135deg,#1A3A6B,#0F2347)', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 18 }}>🏛️</span>
                            <div>
                                <div style={{ fontSize: 12, fontWeight: 800, color: '#C9A84C', letterSpacing: 1 }}>SUPREME COURT OF INDIA</div>
                                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>Earlier Court Details{earlierCourt?._allCourts?.length > 1 ? ` — ${earlierCourt._allCourts.length} courts` : ''}</div>
                            </div>
                        </div>
                        <button onClick={() => setShowModal(false)} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', lineHeight: 1 }}>✕</button>
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
                        {earlierCourtHtml ? renderHtmlTables() : (() => {
                            const allCourts = earlierCourt?._allCourts && earlierCourt._allCourts.length > 1
                                ? earlierCourt._allCourts
                                : earlierCourt ? [earlierCourt] : [];
                            return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    {allCourts.map((court: any, idx: number) => {
                                        const cn = (() => {
                                            const n = court.courtName || court.court || court.court_name || court.agency_code || '';
                                            const s = court.state || court.stateName || '';
                                            return n && s && !n.toLowerCase().includes(s.toLowerCase()) ? `${n} — ${s}` : n;
                                        })();
                                        const cn2 = court.caseNumber || court.caseNo || court.case_no || '';
                                        const od = court.orderDate || court.filingDate || court.order_date || '';
                                        const jt = court.judgmentType || court.judgment || court.judgement || court.judgment_type || '';
                                        const jc = court.judgmentChallenged || court.judgment_challenged || '';
                                        const agencyCode = court.agencyCode || court.agency_code || '';
                                        const j1 = court.judge_1 || ''; const j2 = court.judge_2 || ''; const j3 = court.judge_3 || '';
                                        const judgeList = [j1, j2, j3].filter(Boolean);
                                        return (
                                            <div key={idx} style={{ background: T.bg, borderRadius: 9, border: `1px solid ${T.borderSoft}`, padding: "12px 14px" }}>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                                    <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{cn || '—'}</div>
                                                    <div style={{ fontSize: 11, color: T.textMuted, background: T.surface, border: `1px solid ${T.borderSoft}`, borderRadius: 4, padding: '2px 7px' }}>#{idx + 1}</div>
                                                </div>
                                                {agencyCode && <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 6 }}>{agencyCode}</div>}
                                                {cn2 && <div style={{ fontSize: 13, color: T.text, marginBottom: 4 }}><span style={{ color: T.textMuted, fontWeight: 600 }}>Case No: </span>{cn2}</div>}
                                                {od && <div style={{ fontSize: 13, color: T.text, marginBottom: 4 }}><span style={{ color: T.textMuted, fontWeight: 600 }}>Order Date: </span>{formatDateForDisplay(od)}</div>}
                                                {jt && <div style={{ fontSize: 13, color: T.text, marginBottom: 4 }}><span style={{ color: T.textMuted, fontWeight: 600 }}>Judgment: </span><span style={{ color: '#C9A84C', fontWeight: 600 }}>{jt}</span></div>}
                                                {jc && <div style={{ fontSize: 13, color: T.text, marginBottom: 4 }}><span style={{ color: T.textMuted, fontWeight: 600 }}>Challenged: </span><span style={{ color: jc === 'Yes' ? '#16A34A' : T.textMuted }}>{jc}</span></div>}
                                                {judgeList.length > 0 && <div style={{ fontSize: 13, color: T.text }}><span style={{ color: T.textMuted, fontWeight: 600 }}>Judges: </span>{judgeList.join(' · ')}</div>}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })()}
                    </div>
                </div>
            </div>
        )}

        <div style={{ background: T.bg, borderRadius: 12, border: `1px solid ${T.border}`, padding: "14px 16px", boxShadow: "0 1px 4px rgba(15,28,63,0.08)", marginBottom: 10 }}>
            <div onClick={() => setOpen(o => !o)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: open ? 10 : 0, cursor: "pointer", userSelect: "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                    <SectionIconBox icon="🏛️" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: T.text, letterSpacing: 0.8, marginBottom: 3 }}>EARLIER COURT</div>
                        <div style={{ fontSize: 13, color: fetchError ? '#DC2626' : T.textMuted, display: 'flex', alignItems: 'center', gap: 8 }}>
                            {loading ? "Fetching earlier court details..." : fetchError ? fetchError : hasData ? "Details loaded" : fetched ? "No earlier court data found" : "Click to load details"}
                            {hasCachedData && !loading && (
                                <span style={{ fontSize: 10, fontWeight: 700, background: '#D1FAE5', color: '#047857', padding: '1px 6px', borderRadius: 3 }}>CACHED</span>
                            )}
                        </div>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {hasData ? (
                        <>
                            <button
                                onClick={e => { e.stopPropagation(); setShowModal(true); }}
                                style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: 'linear-gradient(135deg,#1A3A6B,#0F2347)', color: '#C9A84C', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                            >
                                📄 View Report
                            </button>
                            <button
                                onClick={e => { e.stopPropagation(); loadEarlierCourt(); }}
                                disabled={loading}
                                style={{ padding: '6px 10px', borderRadius: 7, border: `1px solid ${T.border}`, background: 'transparent', color: T.textMuted, fontSize: 12, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}
                            >
                                ↻
                            </button>
                        </>
                    ) : (
                        <button
                            onClick={e => { e.stopPropagation(); loadEarlierCourt(); }}
                            disabled={loading}
                            style={{
                                padding: "6px 14px", borderRadius: 7, border: "none",
                                background: loading ? '#94A3B8' : 'linear-gradient(135deg,#C9A84C,#9B7B28)',
                                color: "#fff", fontSize: 12, fontWeight: 700,
                                cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1
                            }}
                        >
                            {loading ? "Loading..." : hasCachedData ? "Load (cached)" : "Load Earlier Court"}
                        </button>
                    )}
                    <span style={{ fontSize: 11, color: T.textMuted, display: "inline-block", transform: open ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.2s" }}>▼</span>
                </div>
            </div>

            {open && hasData && (
                <div style={{ background: T.surface, borderRadius: 9, border: `1px solid ${T.borderSoft}`, padding: "10px 14px" }}>
                    {earlierCourtHtml ? (() => {
                        // Show first table row as a summary preview
                        const doc = new DOMParser().parseFromString(earlierCourtHtml, 'text/html');
                        const firstRow = doc.querySelector('tbody tr, tr:not(:first-child)');
                        const cells = firstRow ? Array.from(firstRow.querySelectorAll('td')).map(td => td.textContent?.trim() || '') : [];
                        const headers = Array.from(doc.querySelectorAll('thead th, tr:first-child th')).map(th => th.textContent?.trim() || '');
                        const tableCount = doc.querySelectorAll('table').length;
                        const rowCount = doc.querySelectorAll('tbody tr, table tr').length - (headers.length > 0 ? 1 : 0);
                        return (
                            <div>
                                <div style={{ fontSize: 13, color: T.text, fontWeight: 600, marginBottom: 4 }}>
                                    {cells[1] || cells[0] || 'Earlier court details available'}
                                    {rowCount > 1 && <span style={{ fontSize: 11, color: T.textMuted, fontWeight: 400, marginLeft: 8 }}>+{rowCount - 1} more row{rowCount > 2 ? 's' : ''}</span>}
                                </div>
                                {headers.length > 0 && cells.length > 0 && (
                                    <div style={{ fontSize: 12, color: T.textMuted }}>
                                        {headers.slice(0, 3).map((h, i) => cells[i] ? `${h}: ${cells[i]}` : null).filter(Boolean).join(' · ')}
                                    </div>
                                )}
                                {tableCount > 1 && <div style={{ fontSize: 11, color: T.textMuted, marginTop: 3 }}>{tableCount} tables — click View Report for full details</div>}
                            </div>
                        );
                    })() : (
                        <div>
                            {courtName && <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 4 }}>{courtName}</div>}
                            {caseNo && <div style={{ fontSize: 13, color: T.textMuted }}><span style={{ fontWeight: 600 }}>Case No:</span> {caseNo}{orderDate ? ` · Order: ${formatDateForDisplay(orderDate)}` : ''}</div>}
                        </div>
                    )}
                </div>
            )}
        </div>
        </>
    );
}
// Helper: extract readable text from an office report API response (handles multiple shapes)
function extractReportText(report: any): string {
    if (typeof report === 'string') return report.trim();
    if (report?.rawText) return report.rawText.trim();
    if (report?.text) return report.text.trim();
    if (report?.content) return String(report.content).trim();
    // Structured object — render key/value pairs
    return Object.entries(report)
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
        .join('\n');
}

export function SCDetailSection({ selected, fetchTrigger = 0 }: { selected: any; fetchTrigger?: number }) {
    const { T } = useApp();
    const [open, setOpen] = useState(false);
    const [reportContent, setReportContent] = useState<string | null>(null);
    const [reportHtml, setReportHtml] = useState<string | null>(null);
    const [reportPdfUrl, setReportPdfUrl] = useState<string | null>(null);
    const [reportMeta, setReportMeta] = useState<{ date?: string } | null>(null);
    const [loading, setLoading] = useState(false);
    const [fetched, setFetched] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [showReportModal, setShowReportModal] = useState(false);
    const [reportLinks, setReportLinks] = useState<{ date: string; proxyUrl: string; url: string }[]>([]);
    const [activeReportUrl, setActiveReportUrl] = useState<string | null>(null);

    // Get diary number - try multiple field name variations
    const diaryNo = selected.diaryNo || selected.diaryNumber || selected.diary_no;
    const diaryYear = selected.diaryYear || selected.year || selected.diary_year;
    const processId = selected.processId || selected.process_id;

    // Parse case details (needs to be before useEffect closures)
    const parsed = parseListingData(selected);

    // Extract raw date string before the " [judges]" bracket
    const rawListedDate = (() => {
        const fromTable = selected.raw?.table?.['Present/Last Listed On'];
        const fromField = selected.lastListedOn;
        const raw = (fromTable || fromField || '').toString();
        return raw.split(' [')[0].trim();
    })();

    // Generate report URL (with or without processId)
    const reportUrl = diaryNo && diaryYear ? generateOfficeReportUrl(
        diaryNo.toString(),
        diaryYear.toString(),
        rawListedDate,
        processId
    ) : '#';

    // Check if we have a direct HTML link (has processId) — can fetch via /sci-report proxy
    const hasDirectLink = reportUrl && reportUrl.startsWith('https://api.sci.gov.in');

    // Check if eCourts API report is cached
    const hasReportCached = selected?.cnrNumber ? isCached('officeReport', selected.cnrNumber) : false;

    // ── Fetch the actual office report ─────────────────────────────────────────
    const doFetch = async () => {
        if (loading) return;
        setLoading(true);
        setFetchError(null);

        // ── Try 1: SC Website WordPress AJAX — collect reports or direct content ─
        if (diaryNo && diaryYear) {
            const report = await fetchWithTimeout(() => fetchOfficeReport(diaryNo.toString(), diaryYear.toString()), 12000);
            if (report) {
                if (report.links && report.links.length > 0) {
                    // We got a list of reports (pilled dates)
                    setReportLinks(report.links);
                    setActiveReportUrl(report.links[0].proxyUrl); // latest by default
                    setReportMeta({ date: report.links[0].date });
                    setFetched(true);
                    setLoading(false);
                    return;
                } else if (report.html) {
                    // We got direct HTML content
                    setReportContent(extractReportText(report));
                    setReportHtml(report.html);
                    setReportMeta({ date: rawListedDate || undefined });
                    setFetched(true);
                    setLoading(false);
                    return;
                }
            }
        }

        // ── Try 2: Fetch SC HTML directly via /sci-report proxy (needs processId) ─
        if (hasDirectLink) {
            try {
                const proxyUrl = reportUrl.replace('https://api.sci.gov.in', '/sci-report');
                const res = await fetchWithTimeout(
                    () => fetch(proxyUrl).then(r => r.ok ? r.text() : Promise.reject(r.status)),
                    10000
                );
                if (res) {
                    const doc = new DOMParser().parseFromString(res, 'text/html');
                    const text = (doc.body?.innerText || doc.body?.textContent || '').trim();
                    if (text.length > 50) {
                        setReportHtml(res);
                        setReportMeta({ date: rawListedDate || undefined });
                        setFetched(true);
                        setLoading(false);
                        return;
                    }
                }
            } catch { /* fall through to error */ }
        }


        setFetchError(diaryNo && diaryYear
            ? 'Office report not published yet for this case.'
            : 'SC Office Report requires the diary number. Cases added via CNR only do not have diary numbers on record. Please search by diary number on the SC website.');
        setFetched(true);
        setLoading(false);
    };

    // Reset state and auto-load if cached when case changes
    useEffect(() => {
        setOpen(false);
        setReportContent(null);
        setReportHtml(null);
        setReportPdfUrl(null);
        setReportMeta(null);
        setReportLinks([]);
        setActiveReportUrl(null);
        setFetched(false);
        setLoading(false);
        setFetchError(null);
        setShowReportModal(false);

        // Auto-load: if diary available (free SC website fetch) or CNR available (try eCourts)
        if ((diaryNo && diaryYear) || selected?.cnrNumber) {
            doFetch();
        }
    }, [selected?.id]);

    // "Fetch All" trigger
    useEffect(() => {
        if (fetchTrigger > 0 && !loading) doFetch();
    }, [fetchTrigger]);

    // Escape key closes report modal
    useEffect(() => {
        if (!showReportModal) return;
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowReportModal(false); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [showReportModal]);

    const diaryRef = diaryNo && diaryYear ? `${diaryNo}/${diaryYear}` : null;
    const caseNo = selected.caseNumber || '';
    const status = selected.caseStatusBadge || '';
    const stage = parsed.stage || '';
    const nextListing = parsed.nextListingDate;

    const hasReport = !!(reportHtml || reportContent || reportPdfUrl || reportLinks.length > 0);

    return (
        <>
        {/* SC Office Report Modal */}
        {showReportModal && hasReport && (
            <div
                onClick={() => setShowReportModal(false)}
                style={{ position: 'fixed', inset: 0, background: 'rgba(15,28,63,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
            >
                <div
                    onClick={e => e.stopPropagation()}
                    style={{ background: T.surface, borderRadius: 16, width: '100%', maxWidth: 820, height: '95vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(15,28,63,0.25)', overflow: 'hidden' }}
                >
                    {/* Modal header */}
                    <div style={{ background: 'linear-gradient(135deg,#1A3A6B,#0F2347)', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 18 }}>📋</span>
                            <div>
                                <div style={{ fontSize: 12, fontWeight: 800, color: '#C9A84C', letterSpacing: 1 }}>SUPREME COURT OF INDIA</div>
                                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>
                                    {reportMeta?.date ? `Office Report — ${formatDateForDisplay(reportMeta.date)}` : 'Office Report'}
                                </div>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <a
                                href={reportLinks.find(r => r.proxyUrl === activeReportUrl)?.url || reportUrl}
                                target="_blank" rel="noopener noreferrer"
                                style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: '#C9A84C', color: '#1A3A6B', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}
                            >
                                Open ↗
                            </a>
                            <button onClick={() => setShowReportModal(false)} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', lineHeight: 1 }}>
                                ✕
                            </button>
                        </div>
                    </div>
                    {/* Date pills for multiple reports */}
                    {reportLinks.length > 0 && (
                        <div style={{ padding: '8px 16px', display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: `1px solid ${T.borderSoft}`, flexShrink: 0, background: T.bg }}>
                            {reportLinks.map((r, i) => (
                                <button
                                    key={i}
                                    onClick={e => { e.stopPropagation(); setActiveReportUrl(r.proxyUrl); }}
                                    style={{
                                        padding: '4px 10px', borderRadius: 5, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                                        background: activeReportUrl === r.proxyUrl ? '#C9A84C' : 'rgba(201,168,76,0.15)',
                                        color: activeReportUrl === r.proxyUrl ? '#1A3A6B' : '#C9A84C',
                                    }}
                                >
                                    {r.date}
                                </button>
                            ))}
                        </div>
                    )}
                    {/* Report content */}
                    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                        {(reportLinks.length > 0 && activeReportUrl) ? (
                            <iframe src={activeReportUrl}
                                style={{ flex: 1, width: '100%', border: 'none', display: 'block' }}
                                title="SC Office Report" />
                        ) : reportPdfUrl ? (
                            <iframe src={reportPdfUrl}
                                style={{ flex: 1, width: '100%', border: 'none', display: 'block' }}
                                title="SC Office Report" />
                        ) : reportHtml ? (
                            <iframe srcDoc={reportHtml} sandbox="allow-same-origin"
                                style={{ flex: 1, width: '100%', border: 'none', display: 'block' }}
                                title="SC Office Report" />
                        ) : (
                            <pre style={{ flex: 1, margin: 0, padding: '20px 24px', fontSize: 12.5, lineHeight: 1.9, color: T.text, fontFamily: "'Courier New', Courier, monospace", whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowY: 'auto', background: T.bg }}>
                                {reportContent}
                            </pre>
                        )}
                    </div>
                </div>
            </div>
        )}

        <div style={{ background: T.bg, borderRadius: 12, border: `1px solid ${T.border}`, padding: "14px 16px", boxShadow: "0 1px 4px rgba(15,28,63,0.08)", marginBottom: 10 }}>
            {/* Header */}
            <div onClick={() => setOpen(o => !o)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: open ? 12 : 0, cursor: "pointer", userSelect: "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                    <SectionIconBox icon="📋" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: T.text, letterSpacing: 0.8, marginBottom: 3, display: 'flex', alignItems: 'center', gap: 8 }}>
                            SUPREME COURT OFFICE REPORT
                            {hasReportCached && !loading && (
                                <span style={{ fontSize: 10, fontWeight: 700, background: '#D1FAE5', color: '#047857', padding: '1px 6px', borderRadius: 3 }}>CACHED</span>
                            )}
                        </div>
                        <div style={{ fontSize: 13, color: T.textMuted }}>
                            {loading ? 'Fetching report...'
                                : hasReport && reportMeta?.date ? `Report dated: ${formatDateForDisplay(reportMeta.date)}`
                                : hasReport ? 'Report loaded'
                                : rawListedDate ? `Last listed: ${formatDateForDisplay(rawListedDate)}`
                                : 'Click to fetch the actual report'}
                        </div>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {hasReport && (
                        <button
                            onClick={e => { e.stopPropagation(); setShowReportModal(true); }}
                            style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: 'linear-gradient(135deg,#1A3A6B,#0F2347)', color: '#C9A84C', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                        >
                            📄 View Report
                        </button>
                    )}
                    <span style={{ fontSize: 11, color: T.textMuted, display: "inline-block", transform: open ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.2s" }}>▼</span>
                </div>
            </div>

            {open && <>{/* Case metadata row */}
            <div style={{ background: T.surface, borderRadius: 9, border: `1px solid ${T.borderSoft}`, padding: "10px 14px", marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: '6px 20px' }}>
                {diaryRef && <span style={{ fontSize: 12, color: T.textMuted }}>
                    <span style={{ fontWeight: 600 }}>Diary:</span> {diaryRef}
                </span>}
                {caseNo && <span style={{ fontSize: 12, color: T.textMuted }}>
                    <span style={{ fontWeight: 600 }}>Case:</span> {caseNo}
                </span>}
                {stage && <span style={{ fontSize: 12, color: T.textMuted }}>
                    <span style={{ fontWeight: 600 }}>Stage:</span> {stage}
                </span>}
                {nextListing && <span style={{ fontSize: 12, color: T.textMuted }}>
                    <span style={{ fontWeight: 600 }}>Next listing:</span> {formatDateForDisplay(nextListing)}
                </span>}
                {status && (
                    <span style={{
                        fontSize: 11, fontWeight: 700,
                        background: status === 'DISPOSED' ? '#D1FAE5' : '#FEF3C7',
                        color: status === 'DISPOSED' ? '#047857' : '#B45309',
                        padding: '1px 7px', borderRadius: 4, textTransform: 'uppercase' as const
                    }}>
                        {status}
                    </span>
                )}
            </div>

            {/* ── Error state ── */}
            {fetchError && !reportHtml && !reportContent && (
                <div style={{
                    marginBottom: 12, padding: "10px 12px", background: '#FEF2F2',
                    border: '1px solid #FECACA', borderRadius: 8,
                    fontSize: 13, color: '#991B1B'
                }}>
                    {fetchError}
                </div>
            )}

            {/* ── Action buttons ── */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {/* Primary: Fetch button */}
                {!fetched ? (
                    <button
                        onClick={() => doFetch()}
                        disabled={loading}
                        style={{
                            flex: 1, padding: "8px 14px", borderRadius: 7, border: "none",
                            background: loading ? '#94A3B8' : 'linear-gradient(135deg,#C9A84C,#9B7B28)',
                            color: "#fff", fontSize: 13, fontWeight: 700,
                            cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1
                        }}
                    >
                        {loading ? "Fetching..." : hasReportCached ? "Load Office Report (cached)" : "Fetch Office Report"}
                    </button>
                ) : (
                    <>
                        {/* Reload from cache */}
                        <button
                            onClick={() => doFetch()}
                            disabled={loading}
                            style={{
                                padding: "7px 12px", borderRadius: 6, border: `1px solid #2A7BD4`,
                                background: "transparent", color: "#2A7BD4", fontSize: 12, fontWeight: 600,
                                cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1
                            }}
                        >
                            {loading ? "Loading..." : "Reload"}
                        </button>
                        {/* Force refresh (busts cache) */}
                        <button
                            onClick={() => doFetch()}
                            disabled={loading}
                            style={{
                                padding: "7px 12px", borderRadius: 6, border: `1px solid #DC2626`,
                                background: "transparent", color: "#DC2626", fontSize: 12, fontWeight: 600,
                                cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1
                            }}
                        >
                            Force Refresh
                        </button>
                    </>
                )}
                {/* Always-visible: open SC website */}
                {diaryRef && (
                    <a
                        href={`https://www.sci.gov.in/case-status-diary-no/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                            padding: "7px 12px", borderRadius: 6, border: `1px solid ${T.border}`,
                            background: "transparent", color: T.textMuted, fontSize: 12, fontWeight: 600,
                            textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4
                        }}
                    >
                        Open SC Website ↗
                    </a>
                )}
            </div>
            </>}
        </div>
        </>
    );
}

export function TimelineSection({ selected, onUpdate }: { selected: any; onUpdate: (c: any) => void }) {
    const { T } = useApp();
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({ date: "", event: "", type: "hearing" });

    // Merge SC auto-events with manual events, sort newest first
    const scEvents = buildSCEvents(selected);
    const manualEvs = (selected.timeline || []).filter((e: any) => !e.id?.startsWith("__"));
    const allEvents = [...scEvents, ...manualEvs]
        .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

    function addEvent() {
        if (!form.date || !form.event.trim()) return;
        onUpdate({ ...selected, timeline: [{ id: "tl" + Date.now(), ...form }, ...(selected.timeline || [])] });
        setForm({ date: "", event: "", type: "hearing" });
        setShowForm(false);
    }
    function removeEvent(id: string) {
        onUpdate({ ...selected, timeline: (selected.timeline || []).filter((x: any) => x.id !== id) });
    }

    return (
        <SectionCard
            icon="🕐"
            title="TIMELINE"
            count={`${allEvents.length} event${allEvents.length !== 1 ? "s" : ""}`}
            onAdd={() => setShowForm(s => !s)}
            addLabel={showForm ? "✕ Cancel" : "+ Add Event"}
        >
            {/* ── Add event form ── */}
            {showForm && (
                <div style={{ background: T.surface, borderRadius: 9, border: `1px solid ${T.border}`, padding: "12px", marginBottom: 12 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                        <div>
                            <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: 0.8, display: "block", marginBottom: 3 }}>DATE</label>
                            <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                                style={{ width: "100%", padding: "7px 9px", borderRadius: 7, border: `1px solid ${T.border}`, fontSize: 14, color: T.text, outline: "none", boxSizing: "border-box" }} />
                        </div>
                        <div>
                            <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: 0.8, display: "block", marginBottom: 3 }}>TYPE</label>
                            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                                style={{ width: "100%", padding: "7px 9px", borderRadius: 7, border: `1px solid ${T.border}`, fontSize: 14, color: T.text, background: T.surface, outline: "none" }}>
                                {["hearing", "filing", "order", "listing", "notice", "other"].map(t =>
                                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                                )}
                            </select>
                        </div>
                    </div>
                    <input placeholder="Describe the event…" value={form.event} onChange={e => setForm(f => ({ ...f, event: e.target.value }))}
                        style={{ width: "100%", padding: "7px 9px", borderRadius: 7, border: `1px solid ${T.border}`, fontSize: 14, color: T.text, outline: "none", boxSizing: "border-box", marginBottom: 8 }} />
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 7 }}>
                        <button onClick={() => setShowForm(false)}
                            style={{ padding: "5px 12px", borderRadius: 7, border: `1px solid ${T.border}`, background: T.bg, color: T.textSub, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
                        <button onClick={addEvent}
                            style={{ padding: "5px 14px", borderRadius: 7, border: "none", background: "linear-gradient(135deg,#C9A84C,#9B7B28)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Add</button>
                    </div>
                </div>
            )}

            {/* ── SC auto-events notice ── */}
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 12, padding: "6px 10px", background: T.surface, borderRadius: 7, border: `1px solid ${T.borderSoft}` }}>
                ℹ️ &nbsp;Events marked <span style={{ color: T.accent, fontWeight: 700 }}>SC</span> are auto-fetched from the Supreme Court database.
            </div>

            {/* ── Timeline list ── */}
            <div style={{ position: "relative" }}>
                {allEvents.map((ev: any, i: number) => {
                    const isLast = i === allEvents.length - 1;
                    const color = TL_COLOR[ev.type] || "#8A94B0";
                    const label = TL_LABEL[ev.type] || ev.type?.toUpperCase();
                    const icon = TL_ICON[ev.type] || "🔖";
                    const days = ev.upcoming ? getDaysUntilDate(ev.date) : null;
                    const isAuto = ev.auto === true;

                    return (
                        <div key={ev.id} style={{ display: "flex", position: "relative" }}>
                            {/* spine + dot */}
                            <div style={{ width: 52, display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                                <div style={{ width: 2, height: 12, background: i === 0 ? "transparent" : T.borderSoft }} />
                                <div style={{
                                    width: 32, height: 32, borderRadius: "50%",
                                    background: ev.upcoming ? "transparent" : color,
                                    border: ev.upcoming ? `2px dashed ${color}` : `3px solid ${T.bg}`,
                                    boxShadow: ev.upcoming ? "none" : `0 0 0 3px ${color}25`,
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    fontSize: 14, flexShrink: 0, zIndex: 1,
                                }}>
                                    {icon}
                                </div>
                                {!isLast && <div style={{ width: 2, flex: 1, minHeight: 16, background: T.borderSoft }} />}
                            </div>

                            {/* card */}
                            <div style={{ flex: 1, paddingTop: 6, paddingBottom: 10, paddingRight: 4 }}>
                                <div style={{
                                    background: ev.upcoming ? `${color}08` : T.bg,
                                    borderRadius: 11,
                                    border: `1px solid ${ev.upcoming ? `${color}35` : T.border}`,
                                    padding: "10px 13px",
                                    transition: "background 0.15s",
                                }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            {/* badge row */}
                                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5, flexWrap: "wrap" }}>
                                                <span style={{ fontSize: 9, fontWeight: 900, color: "#fff", background: color, padding: "2px 7px", borderRadius: 20, letterSpacing: 0.8 }}>
                                                    {label}
                                                </span>
                                                {isAuto && (
                                                    <span style={{ fontSize: 9, fontWeight: 800, color: T.accent, background: T.accentBg, border: `1px solid ${T.accentBorder}`, padding: "1px 6px", borderRadius: 20, letterSpacing: 0.6 }}>
                                                        SC
                                                    </span>
                                                )}
                                                <span style={{ fontSize: 10, color: T.textMuted }}>via {ev.source}</span>
                                            </div>
                                            {/* title */}
                                            <div style={{ fontSize: 13.5, fontWeight: 700, color: ev.upcoming ? color : T.text, lineHeight: 1.4 }}>
                                                {ev.event}
                                            </div>
                                            {/* sub */}
                                            {ev.sub && <div style={{ fontSize: 12, color: T.textMuted, marginTop: 3 }}>{ev.sub}</div>}
                                            {ev.sub2 && <div style={{ fontSize: 11, color: T.textMuted }}>{ev.sub2}</div>}
                                        </div>

                                        {/* right side: date + delete */}
                                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                                            <div style={{ fontSize: 12, fontWeight: 700, color: ev.upcoming ? color : T.textSub }}>
                                                {ev.isDatetime ? fmtDT(ev.date) : fmtDate(ev.date)}
                                            </div>
                                            {ev.upcoming && days !== null && (
                                                <div style={{
                                                    fontSize: 10, fontWeight: 800,
                                                    color: days <= 7 ? "#E65100" : color,
                                                    background: days <= 7 ? "#FFF3E0" : `${color}15`,
                                                    padding: "2px 8px", borderRadius: 10,
                                                }}>
                                                    {days === 0 ? "Today" : days < 0 ? `${Math.abs(days)}d ago` : `in ${days}d`}
                                                </div>
                                            )}
                                            {/* only manual events can be deleted */}
                                            {!isAuto && (
                                                <button onClick={() => removeEvent(ev.id)}
                                                    style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", fontSize: 15, padding: "0 2px", lineHeight: 1 }}
                                                    aria-label="Remove">✕</button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </SectionCard>
    );
}

// Pure helper — parses petitioner/respondent names from either a pre-parsed array
// or raw SC API string like "1 STATE OF MAHARASHTRA2 SOME OTHER PARTY"
function parsePartyNames(arrField: any, rawField: any): string[] {
    // Split a single string that may contain concatenated numbered names
    // e.g. "GODABOLE @ JAYANTHI BAPAT5 SUMA GODABOLE,6 PADMA" → 2 separate names
    const splitConcatenated = (str: string): string[] => {
        return str
            // Insert separator wherever: letter/punc is immediately followed by 1-2 digits then space+uppercase
            .replace(/([A-Za-z.,@)])\s*(\d{1,2})\s+(?=[A-Z])/g, '$1||')
            .split('||')
            .map(p => p.replace(/^\s*\d{1,2}\s+/, '').replace(/,\s*$/, '').trim())
            .filter(p => p.length > 2 && !/^\d+$/.test(p));
    };

    let names: string[] = [];
    if (Array.isArray(arrField) && arrField.length > 0) {
        for (const item of arrField) {
            const s = String(item || '').trim();
            if (!s) continue;
            const parts = splitConcatenated(s);
            // If splitting found multiple parts, use them; otherwise use cleaned single value
            names.push(...(parts.length > 0 ? parts : [s.replace(/^\d+\s+/, '').replace(/,\s*$/, '').trim()]));
        }
    } else {
        const str = String(rawField || '').trim();
        if (str) names = splitConcatenated(str);
    }
    return [...new Set(names.filter(n => n.length > 1))];
}

// Read a cached value from localStorage without TTL (task generation only needs best-effort data)
function readCache(key: string): any | null {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw).data ?? null;
    } catch { return null; }
}

// ── TASKS ─────────────────────────────────────────────────────────────────────
export function TasksSection({ selected, onUpdate }: { selected: any; onUpdate: (c: any) => void }) {
    const { T } = useApp();
    const [showForm, setShowForm] = useState(false);
    const [newTask, setNewTask] = useState("");
    const [newDeadline, setNewDeadline] = useState("");
    const [deadlineError, setDeadlineError] = useState(false);
    const [assignee, setAssignee] = useState("Paralegal / Clerk");
    const [urgency, setUrgency] = useState("Medium");
    // Party type: read from case, local override allowed
    const [partyType, setPartyType] = useState<"Petitioner" | "Respondent" | "">(
        selected.ourSide === "petitioner" ? "Petitioner"
        : selected.ourSide === "respondent" ? "Respondent"
        : selected.partyType || ""
    );
    const [generating, setGenerating] = useState(false);
    const [generatingBoth, setGeneratingBoth] = useState(false);
    const [generateInfo, setGenerateInfo] = useState<string | null>(null);
    const [selectedPerson, setSelectedPerson] = useState<string>("");

    const tasks = selected.tasks || [];

    const urgencyRank: Record<string, number> = { Critical: 1, High: 2, Medium: 3, Low: 4 };
    const byUrgency = (a: any, b: any) => {
        const diff = (urgencyRank[a.urgency] || 3) - (urgencyRank[b.urgency] || 3);
        if (diff !== 0) return diff;
        if (a.deadline && b.deadline) return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
        return 0;
    };

    // Strict party filter: when a party is selected, show ONLY tasks tagged to that party
    // Untagged tasks (no party field) are hidden to prevent them leaking across both sides
    const untaggedCount = partyType ? tasks.filter((t: any) => !t.party && !t.done).length : 0;
    const visibleTasks = tasks.filter((t: any) => {
        // Must match selected party
        if (t.party !== partyType) return false;

        // If a person is selected, show:
        // 1. Tasks specific to that person (partyPerson matches)
        // 2. General tasks with no specific person (partyPerson empty)
        if (selectedPerson) {
            return !t.partyPerson || t.partyPerson === selectedPerson;
        }

        // No person selected — show all tasks for this party
        return true;
    });
    const pending = visibleTasks.filter((t: any) => !t.done).slice().sort(byUrgency);
    const done = visibleTasks.filter((t: any) => t.done);

    const taskKeys = tasks.map((t: any) => normaliseTaskKey(t.text, t.party || ''));
    const uniqueKeySet = new Set(taskKeys);
    const hasDuplicates = uniqueKeySet.size < tasks.length;
    const duplicateCount = tasks.length - uniqueKeySet.size;

    function handlePartyChange(party: "Petitioner" | "Respondent") {
        setPartyType(party);
        setGenerateInfo(null);
        setSelectedPerson("");
        // Persist to case so it's remembered
        onUpdate({ ...selected, partyType: party });
    }

    async function handleGenerateTasks() {
        const caseStatusCheck = (selected?.status || "").toLowerCase();
        if (caseStatusCheck === "disposed" || caseStatusCheck === "closed") {
            alert("Case Disposed / Closed. No pending tasks.");
            return;
        }
        if (!partyType || generating) return;
        setGenerating(true);
        setGenerateInfo(null);

        const caseType = selected.caseType || selected.caseTitle || "";
        const nextHearing = selected.nextHearingDate || selected.nextListingDate || null;
        const cnr = selected.cnrNumber;
        const personTag = selectedPerson ? { partyPerson: selectedPerson } : {};

        // Collect office report text
        let officeReportText = "";
        try {
            const cachedReport = cnr ? readCache(`lx_ec_officeReport_${cnr}`) : null;
            officeReportText = renderOfficeReportText(buildOfficeReportData(selected, cachedReport ?? null));
        } catch { }

        // Collect last order text
        let lastOrderText = "";
        const cachedOrder = cnr ? readCache(`lx_ec_lastOrders_${cnr}`) : null;
        if (cachedOrder) {
            lastOrderText = [
                cachedOrder.orderText || cachedOrder.order_text,
                cachedOrder.orderSummary || cachedOrder.order_summary,
                cachedOrder.remarks,
                cachedOrder.directives ? (Array.isArray(cachedOrder.directives) ? cachedOrder.directives.join(" ") : String(cachedOrder.directives)) : null,
            ].filter(Boolean).join(" ");
        }

        // Collect IA text
        const cachedOfficeData = cnr ? readCache(`lx_ec_officeReport_${cnr}`) : null;
        const iaList = cachedOfficeData?.iaList || selected.interlocutoryApplications || [];
        const iaText = iaList.length > 0
            ? iaList.map((ia: any) =>
                `IA No. ${ia.number || ia.iaNumber || ia.ia_number || ''}: ${ia.purpose || ia.type || ia.status || 'Filed'} by ${ia.filedBy || ia.filed_by || 'party'}`
            ).join("; ")
            : "";

        // Try AI first (Gemini → Groq)
        try {
            const { generateTasksForPerson } = await import('../services/aiTaskService');
            const aiTasks = await generateTasksForPerson(partyType, selectedPerson, {
                officeReportText, lastOrderText, iaText, caseType, nextHearing,
            });
            if (aiTasks && aiTasks.length > 0) {
                const withParty = aiTasks.map((t: any) => ({ ...t, party: partyType, assignedPerson: undefined, ...personTag }));
                // Duplicate = same text AND same partyPerson (same text for a different person is a new task)
                const existingKeys = new Set(
                    tasks.map((t: any) => normaliseTaskKey(t.text, t.party || ''))
                );
                const fresh = withParty.filter((g: any) =>
                    !existingKeys.has(normaliseTaskKey(g.text, g.party || ''))
                );

                // Person-specific task filtering
                if (selectedPerson && fresh.length > 0) {
                    const allPersonNotFound = fresh.every(
                        (t: any) => t.personFound === false
                    );

                    if (allPersonNotFound) {
                        setGenerateInfo(
                            `No specific tasks found for ${selectedPerson} ` +
                            `in the case documents. ` +
                            `General ${partyType} tasks already exist above.`
                        );
                        setGenerating(false);
                        return;
                    }

                    // Keep only person-specific tasks when person is selected
                    const personTasks = fresh.filter(
                        (t: any) => t.personFound !== false
                    );

                    // Save only person-specific tasks
                    const updatedTasks = [...tasks, ...personTasks];
                    onUpdate({ ...selected, tasks: updatedTasks });
                    setGenerateInfo(
                        `✅ ${personTasks.length} tasks found specific to ` +
                        `${selectedPerson}`
                    );
                    setGenerating(false);
                    return;
                }

                // Default save (no person selected — save all fresh tasks)
                const forWhom = selectedPerson ? `${selectedPerson} (${partyType})` : partyType;
                setGenerateInfo(
                    fresh.length > 0
                        ? `✨ ${fresh.length} AI task${fresh.length > 1 ? "s" : ""} added for ${forWhom}`
                        : `No new tasks to add for ${forWhom}`
                );
                if (fresh.length > 0) onUpdate({ ...selected, tasks: [...fresh, ...tasks], partyType });
                setGenerating(false);
                setTimeout(() => setGenerateInfo(null), 5000);
                return;
            }
        } catch { /* fall through to rule-based */ }

        // Fallback: rule-based generation
        const { tasks: baseTasks } = generateLegalTasks(caseType, selected.status || "", nextHearing, partyType);
        const lowerReport = officeReportText.toLowerCase();
        const hasActiveStay = lowerReport.includes("stay granted") || lowerReport.includes("interim stay");
        const officeReportTasks = generateOfficeReportTasks(officeReportText, nextHearing, partyType, hasActiveStay);
        const lastOrderTasks = lastOrderText ? generateOfficeReportTasks(lastOrderText, nextHearing, partyType, hasActiveStay) : [];

        const allGenerated = [
            ...baseTasks.map(t => ({ ...t, party: partyType, ...personTag })),
            ...officeReportTasks.map(t => ({ ...t, party: partyType, ...personTag })),
            ...lastOrderTasks.map(t => ({ ...t, party: partyType, ...personTag })),
        ];
        const existingKeys = new Set(
            tasks.map((t: any) => normaliseTaskKey(t.text, t.party || ''))
        );
        const fresh = allGenerated.filter(g =>
            !existingKeys.has(normaliseTaskKey(g.text, (g as any).party || ''))
        );

        const sources: string[] = ["case type"];
        if (officeReportTasks.length > 0) sources.push("office report");
        if (lastOrderTasks.length > 0) sources.push("last order");
        const forWhom = selectedPerson ? `${selectedPerson} (${partyType})` : `${partyType} side`;
        setGenerateInfo(
            fresh.length > 0
                ? `${fresh.length} task${fresh.length > 1 ? "s" : ""} added for ${forWhom} (from ${sources.join(", ")})`
                : `No new tasks to add for ${forWhom}`
        );
        if (fresh.length > 0) onUpdate({ ...selected, tasks: [...fresh, ...tasks], partyType });
        setGenerating(false);
        setTimeout(() => setGenerateInfo(null), 4000);
    }

    async function handleGenerateBothSides() {
        const caseStatusCheck = (selected?.status || "").toLowerCase();
        if (caseStatusCheck === "disposed" || caseStatusCheck === "closed") {
            alert("Case Disposed / Closed. No pending tasks.");
            return;
        }
        if (generatingBoth) return;
        setGeneratingBoth(true);
        setGenerateInfo(null);

        try {
            const { generateTasksForBothSides } = await import('../services/aiTaskService');
            const result = await generateTasksForBothSides(selected, '', '');

            const existingKeys = new Set(
                tasks.map((t: any) => normaliseTaskKey(t.text, t.party || ''))
            );

            const freshPetitioner = result.petitioner
                .map((t: any) => ({ ...t, party: "Petitioner", assignedPerson: undefined }))
                .filter((t: any) => !existingKeys.has(normaliseTaskKey(t.text, t.party || '')));

            const freshRespondent = result.respondent
                .map((t: any) => ({ ...t, party: "Respondent", assignedPerson: undefined }))
                .filter((t: any) => !existingKeys.has(normaliseTaskKey(t.text, t.party || '')));

            // Cross-side dedup: remove respondent tasks that are the same action as a petitioner task
            const petitionerKeys = new Set(
                freshPetitioner.map((t: any) => normaliseTaskKey(t.text, ''))
            );
            const crossDedupedRespondent = freshRespondent.filter((t: any) =>
                !petitionerKeys.has(normaliseTaskKey(t.text, ''))
            );

            const allFresh = [...freshPetitioner, ...crossDedupedRespondent];
            if (allFresh.length > 0) {
                onUpdate({ ...selected, tasks: [...allFresh, ...tasks] });
                setGenerateInfo(`✨ ${freshPetitioner.length} Petitioner + ${crossDedupedRespondent.length} Respondent tasks added`);
            } else {
                setGenerateInfo("No new tasks — both sides are already up to date");
            }
        } catch {
            setGenerateInfo("⚠️ Failed to generate — please try again");
        }

        setGeneratingBoth(false);
        setTimeout(() => setGenerateInfo(null), 6000);
    }

    function addTask() {
        if (!newTask.trim()) return;
        if (!newDeadline) { setDeadlineError(true); return; }
        setDeadlineError(false);
        onUpdate({
            ...selected,
            tasks: [{
                id: "t" + Date.now(),
                text: newTask.trim(),
                deadline: newDeadline,
                assignee,
                urgency,
                party: partyType || undefined,
                partyPerson: selectedPerson || undefined,
                isAuto: false,
                done: false,
                createdAt: new Date().toISOString()
            }, ...tasks]
        });
        setNewTask("");
        setNewDeadline("");
        setShowForm(false);
    }

    function toggleTask(id: string) { onUpdate({ ...selected, tasks: tasks.map((t: any) => t.id === id ? { ...t, done: !t.done } : t) }); }
    function deleteTask(id: string) { onUpdate({ ...selected, tasks: tasks.filter((t: any) => t.id !== id) }); }

    function handleRemoveDuplicates() {
        const confirmed = window.confirm(
            `Found ${duplicateCount} duplicate task${duplicateCount > 1 ? 's' : ''}.\n\nKeep the newest copy of each and remove the rest?\n\nThis cannot be undone.`
        );
        if (!confirmed) return;

        const seen = new Set<string>();
        const deduplicated = [...tasks]
            .sort((a: any, b: any) => b.id.localeCompare(a.id))
            .filter((t: any) => {
                const key = normaliseTaskKey(t.text, t.party || '');
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });

        const cleaned = deduplicated.map((t: any) => {
            const pp = t.partyPerson;
            let cleanPartyPerson = '';

            if (!pp) {
                cleanPartyPerson = '';
            } else if (typeof pp === 'string') {
                cleanPartyPerson = pp;
            } else if (Array.isArray(pp)) {
                cleanPartyPerson = pp
                    .map((p: any) => typeof p === 'string' ? p : p?.name || '')
                    .filter(Boolean)
                    .join(', ');
            }

            return { ...t, partyPerson: cleanPartyPerson };
        });

        onUpdate({ ...selected, tasks: cleaned });
    }

    const getUrgencyColor = (u: string) => {
        if (u === "Critical") return { bg: "#FEF2F2", text: "#991B1B", border: "#FECACA" };
        if (u === "High") return { bg: "#FFFBEB", text: "#92400E", border: "#FDE68A" };
        if (u === "Low") return { bg: "#F3F4F6", text: "#4B5563", border: "#E5E7EB" };
        return { bg: "#EFF6FF", text: "#1E40AF", border: "#BFDBFE" };
    };

    const getRoleBorder = (role: string) => {
        if (role === "Advocate") return "2px solid #C9A84C";
        if (role === "Associate Advocate") return "2px solid #2A7BD4";
        return `1px solid ${T.borderSoft}`;
    };

    return (
        <SectionCard icon="✅" title="TASKS & DEADLINES" count={selectedPerson ? `${pending.length} pending · ${done.length} done (${selectedPerson})` : partyType ? `${pending.length} pending · ${done.length} done (${partyType})` : `${pending.length} pending · ${done.length} done`}>

            {/* ── Party selector + action buttons ── */}
            <div style={{ background: T.surface, borderRadius: 9, border: `1px solid ${T.border}`, padding: "12px 14px", marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: 0.8, marginBottom: 8 }}>YOUR CLIENT'S PARTY ROLE</div>
                <div style={{ display: "flex", gap: 8, marginBottom: partyType ? 10 : 12 }}>
                    {(["Petitioner", "Respondent"] as const).map(p => (
                        <button
                            key={p}
                            onClick={() => handlePartyChange(p)}
                            style={{
                                flex: 1, padding: "8px 10px", borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: "pointer",
                                border: partyType === p ? "none" : `1px solid ${T.border}`,
                                background: partyType === p
                                    ? (p === "Petitioner" ? "linear-gradient(135deg,#2A7BD4,#1A5EA8)" : "linear-gradient(135deg,#C9A84C,#9B7B28)")
                                    : T.bg,
                                color: partyType === p ? "#fff" : T.textMuted,
                            }}
                        >
                            {p === "Petitioner" ? "⚖️ Petitioner" : "🛡 Respondent"}
                        </button>
                    ))}
                </div>
                {/* Party name dropdown — shown once a side is chosen */}
                {partyType && (() => {
                    const names = partyType === "Petitioner"
                        ? parsePartyNames(selected.petitioners, selected.petitioner)
                        : parsePartyNames(selected.respondents, selected.respondent);
                    if (names.length === 0) return null;
                    return (
                        <div style={{ marginBottom: 10 }}>
                            <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: 0.8, display: "block", marginBottom: 4 }}>
                                {partyType === "Petitioner" ? "⚖️ PETITIONER NAME" : "🛡 RESPONDENT NAME"}
                            </label>
                            <select
                                value={selectedPerson}
                                onChange={e => setSelectedPerson(e.target.value)}
                                style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: `1px solid ${T.border}`, fontSize: 13, color: selectedPerson ? T.text : T.textMuted, background: T.bg, outline: "none", cursor: "pointer" }}
                            >
                                <option value="">— Select {partyType} —</option>
                                {names.map(name => (
                                    <option key={name} value={name}>{name}</option>
                                ))}
                            </select>
                        </div>
                    );
                })()}
                {!partyType && (
                    <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 10, padding: "6px 10px", background: T.bg, borderRadius: 6, border: `1px solid ${T.borderSoft}` }}>
                        Select your client's party role above to generate or add tasks.
                    </div>
                )}
                {generateInfo && (
                    <div style={{ marginBottom: 8, padding: "6px 10px", borderRadius: 6, background: generateInfo.includes("No new") ? "#FEF3C7" : "#D1FAE5", border: `1px solid ${generateInfo.includes("No new") ? "#FDE68A" : "#6EE7B7"}`, color: generateInfo.includes("No new") ? "#92400E" : "#065F46", fontSize: 12, fontWeight: 600 }}>
                        {generateInfo.includes("No new") ? "ℹ️" : "✅"} {generateInfo}
                    </div>
                )}
                {/* ⚡ Both Sides — always visible, generates for Petitioner + Respondent at once */}
                <button
                    onClick={handleGenerateBothSides}
                    disabled={generatingBoth || generating}
                    style={{
                        width: "100%", padding: "9px 12px", borderRadius: 7, border: "none", fontSize: 13, fontWeight: 700,
                        cursor: (!generatingBoth && !generating) ? "pointer" : "not-allowed",
                        background: "linear-gradient(135deg,#0EA5E9,#0369A1)",
                        color: "#fff", opacity: (!generatingBoth && !generating) ? 1 : 0.6,
                        marginBottom: 8,
                    }}
                >
                    {generatingBoth ? "⏳ Generating for both sides…" : "⚡ Generate for Both Sides (Petitioner + Respondent)"}
                </button>
                <div style={{ display: "flex", gap: 8 }}>
                    <button
                        onClick={handleGenerateTasks}
                        disabled={!partyType || generating || generatingBoth}
                        style={{
                            flex: 1, padding: "8px 12px", borderRadius: 7, border: "none", fontSize: 13, fontWeight: 700, cursor: (partyType && !generating && !generatingBoth) ? "pointer" : "not-allowed",
                            background: partyType ? "linear-gradient(135deg,#6D28D9,#4C1D95)" : T.borderSoft,
                            color: partyType ? "#fff" : T.textMuted, opacity: (partyType && !generating && !generatingBoth) ? 1 : 0.6,
                        }}
                    >
                        {generating
                            ? "⏳ Generating…"
                            : selectedPerson
                                ? `🔍 Find Tasks for ${selectedPerson.split(' ')[0]}`
                                : "🔮 Generate for Selected Side"
                        }
                    </button>
                    {selectedPerson && !generating && (
                        <div style={{
                            fontSize: 11,
                            color: '#6B7280',
                            marginTop: 4,
                            textAlign: 'center',
                            fontStyle: 'italic'
                        }}>
                            AI will scan documents specifically for {selectedPerson}
                        </div>
                    )}
                    <button
                        onClick={() => { if (partyType) setShowForm(s => !s); }}
                        disabled={!partyType}
                        style={{
                            flex: 1, padding: "8px 12px", borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: partyType ? "pointer" : "not-allowed",
                            border: partyType ? `1px solid ${T.border}` : `1px solid ${T.borderSoft}`,
                            background: showForm ? T.surface : T.bg,
                            color: partyType ? T.text : T.textMuted, opacity: partyType ? 1 : 0.6,
                        }}
                    >
                        {showForm ? "✕ Cancel" : "+ New Task"}
                    </button>
                </div>
                {hasDuplicates && (
                    <button
                        onClick={handleRemoveDuplicates}
                        style={{
                            background: '#FEF2F2',
                            border: '1px solid #FECACA',
                            color: '#C62828',
                            borderRadius: 8,
                            padding: '6px 14px',
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: 'pointer',
                        }}
                    >
                        🧹 Remove {duplicateCount} Duplicate{duplicateCount > 1 ? 's' : ''}
                    </button>
                )}
            </div>

            {/* ── Manual task form ── */}
            {showForm && (
                <div style={{ background: T.surface, borderRadius: 9, border: `1px solid ${T.border}`, padding: "16px", marginBottom: 10 }}>
                    {/* Party display */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: 0.8 }}>PARTY:</span>
                        <span style={{
                            fontSize: 12, fontWeight: 700, padding: "2px 10px", borderRadius: 5,
                            background: partyType === "Petitioner" ? "#DBEAFE" : "#FEF3C7",
                            color: partyType === "Petitioner" ? "#1E40AF" : "#92400E",
                            border: partyType === "Petitioner" ? "1px solid #BFDBFE" : "1px solid #FDE68A",
                        }}>
                            {partyType === "Petitioner" ? "⚖️ Petitioner" : "🛡 Respondent"}
                        </span>
                    </div>
                    <div style={{ marginBottom: 12 }}>
                        <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: 0.8, display: "block", marginBottom: 4 }}>TASK DESCRIPTION</label>
                        <input value={newTask} onChange={e => setNewTask(e.target.value)} placeholder="Describe the task…" onKeyDown={e => e.key === "Enter" && addTask()} style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: `1px solid ${T.border}`, fontSize: 14, color: T.text, outline: "none", boxSizing: "border-box" }} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
                        <div>
                            <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: 0.8, display: "block", marginBottom: 4 }}>ASSIGNEE</label>
                            <select value={assignee} onChange={e => setAssignee(e.target.value)} style={{ width: "100%", padding: "7px 9px", borderRadius: 7, border: `1px solid ${T.border}`, fontSize: 14, color: T.text, background: T.surface, outline: "none" }}>
                                <option>Advocate</option>
                                <option>Associate Advocate</option>
                                <option>Paralegal / Clerk</option>
                            </select>
                        </div>
                        <div>
                            <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: 0.8, display: "block", marginBottom: 4 }}>URGENCY</label>
                            <select value={urgency} onChange={e => setUrgency(e.target.value)} style={{ width: "100%", padding: "7px 9px", borderRadius: 7, border: `1px solid ${T.border}`, fontSize: 14, color: T.text, background: T.surface, outline: "none" }}>
                                <option>Critical</option>
                                <option>High</option>
                                <option>Medium</option>
                                <option>Low</option>
                            </select>
                        </div>
                        <div>
                            <label style={{ fontSize: 11, fontWeight: 700, color: deadlineError ? "#DC2626" : T.textMuted, letterSpacing: 0.8, display: "block", marginBottom: 4 }}>
                                DEADLINE {deadlineError && <span style={{ color: "#DC2626" }}>*required</span>}
                            </label>
                            <input
                                type="date" value={newDeadline}
                                onChange={e => { setNewDeadline(e.target.value); setDeadlineError(false); }}
                                style={{ width: "100%", padding: "7px 9px", borderRadius: 7, border: `1px solid ${deadlineError ? "#DC2626" : T.border}`, fontSize: 14, color: T.text, outline: "none", boxSizing: "border-box" }}
                            />
                        </div>
                    </div>
                    <div style={{ display: "flex", gap: 7, justifyContent: "flex-end" }}>
                        <button onClick={() => { setShowForm(false); setDeadlineError(false); }} style={{ padding: "7px 14px", borderRadius: 7, border: `1px solid ${T.border}`, background: T.bg, color: T.textSub, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
                        <button onClick={addTask} style={{ padding: "7px 18px", borderRadius: 7, border: "none", background: "linear-gradient(135deg,#C9A84C,#9B7B28)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Add Task</button>
                    </div>
                </div>
            )}

            {/* ── Untagged tasks notice ── */}
            {untaggedCount > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", marginBottom: 6, borderRadius: 8, background: "#FFFBEB", border: "1px solid #FDE68A", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: "#92400E", fontWeight: 600, flex: 1 }}>
                        ⚠️ {untaggedCount} old task{untaggedCount > 1 ? "s" : ""} have no party tag and are hidden.
                    </span>
                    <button
                        onClick={() => {
                            const updated = tasks.map((t: any) => !t.party ? { ...t, party: partyType } : t);
                            onUpdate({ ...selected, tasks: updated });
                        }}
                        style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 6, border: "1px solid #FCD34D", background: "#FEF3C7", color: "#92400E", cursor: "pointer", whiteSpace: "nowrap" }}
                    >
                        Assign to {partyType}
                    </button>
                    <button
                        onClick={() => onUpdate({ ...selected, tasks: tasks.filter((t: any) => t.party) })}
                        style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 6, border: "1px solid #FCA5A5", background: "#FEE2E2", color: "#991B1B", cursor: "pointer", whiteSpace: "nowrap" }}
                    >
                        Delete all
                    </button>
                </div>
            )}

            {/* ── Task list ── */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[...pending, ...done].map((t: any) => {
                    const uColor = getUrgencyColor(t.urgency);
                    let overdue = false;
                    if (t.deadline && !t.done) {
                        overdue = new Date(t.deadline).getTime() < new Date().setHours(0, 0, 0, 0);
                    }
                    return (
                        <div key={t.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px", background: T.surface, borderRadius: 10, border: getRoleBorder(t.assignee), opacity: t.done ? 0.6 : 1 }}>
                            <input type="checkbox" checked={!!t.done} onChange={() => toggleTask(t.id)} style={{ marginTop: 4, width: 16, height: 16, cursor: "pointer" }} />
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 14, color: T.text, textDecoration: t.done ? "line-through" : "none", lineHeight: 1.4, fontWeight: 500 }}>{t.text}</div>
                                <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                                    {(t.party || t.partyPerson) && (
                                        <span style={{
                                            fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 5,
                                            background: t.party === "Petitioner" ? "#DBEAFE" : "#FEF3C7",
                                            color: t.party === "Petitioner" ? "#1E40AF" : "#92400E",
                                            border: t.party === "Petitioner" ? "1px solid #BFDBFE" : "1px solid #FDE68A",
                                            maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                        }}>
                                            {t.party === "Petitioner" ? "⚖️ Petitioner" : t.party === "Respondent" ? "🛡 Respondent" : ""}
                                            {(() => {
                                              const pp = t.partyPerson;
                                              if (!pp) return null;
                                              if (typeof pp === 'string') return ` · ${pp}`;
                                              if (Array.isArray(pp)) {
                                                const names = pp
                                                  .map((p: any) => typeof p === 'string' ? p : p?.name || '')
                                                  .filter(Boolean)
                                                  .join(', ');
                                                return names ? ` · ${names}` : null;
                                              }
                                              return null;
                                            })()}
                                        </span>
                                    )}
                                    {t.isAuto && <span style={{ fontSize: 11, fontWeight: 700, color: "#8B5CF6", background: "#EDE9FE", padding: "2px 6px", borderRadius: 4, border: "1px solid #C4B5FD" }}>AUTO</span>}
                                    <span style={{ fontSize: 11, fontWeight: 700, color: uColor.text, background: uColor.bg, padding: "2px 6px", borderRadius: 4, border: `1px solid ${uColor.border}` }}>
                                        {t.urgency?.toUpperCase() || "MEDIUM"}
                                    </span>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, background: T.bg, padding: "2px 6px", borderRadius: 4, border: `1px solid ${T.borderSoft}` }}>
                                        👤 {t.assignee?.toUpperCase() || "UNASSIGNED"}
                                    </span>
                                    {t.deadline && (
                                        <span style={{ fontSize: 11, fontWeight: 700, color: overdue ? "#DC2626" : T.textSub, background: overdue ? "#FEE2E2" : "transparent", padding: "2px 6px", borderRadius: 4, border: overdue ? "1px solid #FCA5A5" : `1px solid ${T.borderSoft}`, display: "flex", alignItems: "center", gap: 4 }}>
                                            ⏱ {fmtDate(t.deadline)} {overdue ? "(OVERDUE)" : ""}
                                        </span>
                                    )}
                                </div>
                                {t.statutoryNote && (
                                    <div style={{ fontSize: 11, color: "#92400E", marginTop: 5, background: "#FFFBEB", padding: "3px 8px", borderRadius: 4, border: "1px solid #FDE68A" }}>
                                        📌 {t.statutoryNote}
                                    </div>
                                )}
                            </div>
                            <button onClick={() => deleteTask(t.id)} style={{ background: "none", border: "none", color: "#EF4444", cursor: "pointer", fontSize: 16, padding: "2px", opacity: 0.6 }}>🗑</button>
                        </div>
                    );
                })}
                {tasks.length === 0 && (
                    <div style={{ fontSize: 13, color: T.textMuted, textAlign: "center", padding: "14px 0" }}>
                        No tasks yet. Select a party role and click Generate Tasks.
                    </div>
                )}
            </div>
        </SectionCard>
    );
}

// ── NOTES ─────────────────────────────────────────────────────────────────────
export function NotesSection({ selected, onUpdate }: { selected: any; onUpdate?: (c: any) => void }) {
    const { T } = useApp();
    const [notes, setNotes] = useState<Note[]>([]);
    const [loading, setLoading] = useState(false);
    const [userEmail, setUserEmail] = useState<string>('');
    const [showVoiceForCase, setShowVoiceForCase] = useState(false);

    // Form state
    const [showForm, setShowForm] = useState(false);
    const [editingNote, setEditingNote] = useState<Note | null>(null);
    const [title, setTitle] = useState("");
    const [content, setContent] = useState("");
    const [tags, setTags] = useState("");
    const [category, setCategory] = useState<NoteCategory>("General");
    const [noteSearch, setNoteSearch] = useState("");

    const CATEGORY_STYLES: Record<NoteCategory, { icon: string; bg: string; color: string; border: string }> = {
        Strategy: { icon: "📈", bg: "rgba(14,165,233,0.1)", color: "#0369A1", border: "#7DD3FC" },
        Task: { icon: "✓", bg: "rgba(16,185,129,0.1)", color: "#047857", border: "#6EE7B7" },
        Idea: { icon: "💡", bg: "rgba(245,158,11,0.1)", color: "#B45309", border: "#FCD34D" },
        Problem: { icon: "⚠️", bg: "rgba(239,68,68,0.1)", color: "#B91C1C", border: "#FCA5A5" },
        Research: { icon: "🔍", bg: "rgba(139,92,246,0.1)", color: "#6D28D9", border: "#C4B5FD" },
        "Document Requirement": { icon: "📁", bg: "rgba(107,114,128,0.1)", color: "#374151", border: "#D1D5DB" },
        General: { icon: "📝", bg: "rgba(156,163,175,0.1)", color: "#4B5563", border: "#E5E7EB" }
    };


    const uniqueCaseID = selected.shortCaseNumber || String(selected.diaryNumber);
    const caseName = formatCaseTitleShort(selected);

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => {
            if (user) setUserEmail(user.email ?? '');
        });
        loadNotes();
    }, [selected.id]);

    const loadNotes = async () => {
        setLoading(true);
        const data = await getNotes();
        // Match by: (1) legacy case_number string, OR (2) linked_case_ids UUID array (for voice/AI notes)
        const caseUUID = selected.id;
        setNotes(data.filter(n => 
            n.case_number === uniqueCaseID ||
            (caseUUID && Array.isArray(n.linked_case_ids) && n.linked_case_ids.includes(caseUUID))
        ));
        setLoading(false);
    };

    // Placeholder to avoid unused variable (was handleLogin)
    const _unused = () => {
        if (false) {
            alert(
                "❌ Google OAuth not configured.\n\n" +
                "Please set VITE_GOOGLE_CLIENT_ID in your .env file.\n\n" +
                "Steps:\n" +
                "1. Go to Google Cloud Console\n" +
                "2. Create OAuth 2.0 Client ID (Web application)\n" +
                "3. Add http://localhost:5175 to Authorized redirect URIs\n" +
                "4. Copy Client ID to .env as VITE_GOOGLE_CLIENT_ID=your_client_id"
            );
            return;
        }

    };

    const handleSave = async () => {
        if (!title.trim() || !content.trim()) return;
        const { data: { user } } = await supabase.auth.getUser();
        const noteData: Note = {
            id: editingNote ? editingNote.id : crypto.randomUUID(),
            title, content,
            case_number: uniqueCaseID || null,
            case_name: caseName || null,
            linked_team_member: null,
            tags: tags.split(',').map(t => t.trim()).filter(Boolean),
            category,
            created_by_id: user?.id ?? '',
            created_by_name: user?.user_metadata?.display_name ?? user?.email ?? '',
            created_at: editingNote ? editingNote.created_at : new Date().toISOString(),
            updated_by_id: user?.id ?? null,
            updated_by_name: user?.user_metadata?.display_name ?? user?.email ?? null,
            updated_at: new Date().toISOString(),
            is_deleted: false, deleted_at: null, source: editingNote ? editingNote.source : "app"
        };

        if (editingNote) await updateNote(editingNote.id, noteData);
        else await createNote(noteData);

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
        setEditingNote(null); setTitle(""); setContent(""); setTags("");
    };

    const openEdit = (note: Note) => {
        setEditingNote(note);
        setTitle(note.title);
        setContent(note.content);
        setTags(note.tags.join(', '));
        setCategory(note.category || "General");
        setShowForm(true);
    };


    return (
        <>
        <SectionCard icon="📝" title="NOTES & RESEARCH" count={notes.length > 0 ? `${notes.length} note${notes.length !== 1 ? "s" : ""}` : "No notes yet"} onAdd={() => { resetForm(); setShowForm(s => !s); }} addLabel={showForm ? "✕ Cancel" : "+ New Note"}
            extraAction={
                <button
                    id="voice-note-case-btn"
                    title="Record Voice Note for this case"
                    onClick={() => { setShowVoiceForCase(true); }}
                    style={{
                        padding: '4px 10px', borderRadius: 8,
                        border: '1px solid rgba(201,168,76,0.4)',
                        background: 'rgba(201,168,76,0.1)',
                        color: '#C9A84C', cursor: 'pointer',
                        fontSize: 16, display: 'flex', alignItems: 'center', gap: 5
                    }}
                >
                    🎙
                </button>
            }
        >

            {/* Compact status line */}
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 10, fontSize: 11, color: T.textMuted }}>
                <span>🔒</span>
                <span>Private · {userEmail || "Supabase"}</span>
            </div>

            {/* Note Filter */}
            {notes.length > 0 && (
                <input
                    value={noteSearch}
                    onChange={e => setNoteSearch(e.target.value)}
                    placeholder="Search notes..."
                    style={{ width: "100%", padding: "6px 10px", borderRadius: 7, border: `1px solid ${T.borderSoft}`, outline: "none", fontSize: 12, background: T.bg, color: T.text, boxSizing: "border-box", marginBottom: 8 }}
                />
            )}

            {showForm && (
                <div style={{ background: T.surface, border: `1px solid ${T.borderSoft}`, borderRadius: 10, padding: "12px", marginBottom: 10 }}>
                    <div style={{ display: "flex", gap: 7, marginBottom: 7 }}>
                        <select 
                            value={category} 
                            onChange={e => setCategory(e.target.value as NoteCategory)}
                            style={{ padding: "7px 9px", borderRadius: 7, border: `1px solid ${T.border}`, outline: "none", fontSize: 13, background: T.bg, color: T.text }}
                        >
                            {Object.keys(CATEGORY_STYLES).map(cat => (
                                <option key={cat} value={cat}>{(CATEGORY_STYLES as any)[cat].icon} {cat}</option>
                            ))}
                        </select>
                        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title..." style={{ flex: 1, padding: "7px 9px", borderRadius: 7, border: `1px solid ${T.border}`, outline: "none", fontSize: 13, boxSizing: "border-box" }} />
                    </div>
                    <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Note content..." rows={3} style={{ width: "100%", padding: "7px 9px", borderRadius: 7, border: `1px solid ${T.border}`, outline: "none", fontSize: 13, resize: "vertical", boxSizing: "border-box", marginBottom: 7 }} />
                    <input value={tags} onChange={e => setTags(e.target.value)} placeholder="Tags (comma separated)..." style={{ width: "100%", padding: "7px 9px", borderRadius: 7, border: `1px solid ${T.border}`, outline: "none", fontSize: 12, boxSizing: "border-box", marginBottom: 10 }} />
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        <button onClick={() => setShowForm(false)} style={{ padding: "5px 12px", borderRadius: 7, background: "transparent", color: T.textMuted, fontWeight: 600, border: `1px solid ${T.borderSoft}`, cursor: "pointer", fontSize: 12 }}>Cancel</button>
                        <button onClick={handleSave} style={{ padding: "5px 14px", borderRadius: 7, background: "#10B981", color: "#fff", fontWeight: 700, border: "none", cursor: "pointer", fontSize: 12 }}>Save</button>
                    </div>
                </div>

            )}

            {loading ? (
                <div style={{ padding: "10px 0", textAlign: "center", color: T.textMuted, fontSize: 12 }}>Loading...</div>
            ) : notes.length === 0 && !showForm ? (
                <div style={{ padding: "12px 0", textAlign: "center", color: T.textMuted, fontSize: 12 }}>No notes created yet for this case.</div>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
                    {[
                        { id: 'Strategy',            label: 'Strategy Notes',     icon: '📈' },
                        { id: 'Task',                label: 'Tasks',              icon: '✓' },
                        { id: 'Idea',                label: 'Ideas',              icon: '💡' },
                        { id: 'Research',            label: 'Research',           icon: '🔍' },
                        { id: 'Document Requirement', label: 'Document Needs',     icon: '📁' },
                        { id: 'General',             label: 'General',            icon: '📝' },
                        { id: 'Problem',             label: 'Problems/Blockers',   icon: '⚠️' }
                    ].map(group => {
                        const groupNotes = notes.filter(n => {
                            if (noteSearch.trim()) {
                                const q = noteSearch.toLowerCase();
                                const matches = n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q) || 
                                              n.tags.some(t => t.toLowerCase().includes(q.replace('#', '')));
                                if (!matches) return false;
                            }
                            // Map categories to groups (fallback to General)
                            const cat = n.category || 'General';
                            if (group.id === 'General') {
                                return cat === 'General' || !['Strategy', 'Task', 'Idea', 'Research', 'Document Requirement', 'Problem'].includes(cat);
                            }
                            return cat === group.id;
                        });

                        if (groupNotes.length === 0) return null;

                        return (
                            <div key={group.id}>
                                <div style={{ 
                                    fontSize: 11, fontWeight: 800, color: T.textMuted, 
                                    letterSpacing: 1.2, marginBottom: 8, display: 'flex', 
                                    alignItems: 'center', gap: 8, textTransform: 'uppercase' 
                                }}>
                                    <span>{group.icon}</span>
                                    <span>{group.label}</span>
                                    <div style={{ height: 1, flex: 1, background: T.borderSoft }} />
                                    <span style={{ fontSize: 10, background: T.bg, padding: '1px 6px', borderRadius: 6, border: `1px solid ${T.borderSoft}` }}>{groupNotes.length}</span>
                                </div>
                                
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {groupNotes.map(note => {
                                        const style = CATEGORY_STYLES[note.category || "General"] || CATEGORY_STYLES.General;
                                        return (
                                            <div key={note.id} style={{ background: T.surface, padding: "12px 14px", borderRadius: 10, border: `1px solid ${T.borderSoft}`, boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                                                    <div style={{ minWidth: 0, flex: 1 }}>
                                                        <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 2 }}>{note.title}</div>
                                                        <div style={{ fontSize: 10, color: T.textMuted }}>{fmtDate(note.created_at)} · {note.source === 'voice' ? '🎙 AI Voice' : '⌨️ Typed'}</div>
                                                    </div>
                                                    <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                                                        <button onClick={() => openEdit(note)} style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", fontSize: 14 }}>✏️</button>
                                                        <button onClick={() => handleDelete(note.id)} style={{ background: "none", border: "none", color: "#EF4444", cursor: "pointer", fontSize: 14 }}>🗑</button>
                                                    </div>
                                                </div>
                                                
                                                <div style={{ fontSize: 13, color: T.textSub, lineHeight: 1.6, whiteSpace: "pre-wrap", marginBottom: note.audio_url || (note.extracted_tasks && note.extracted_tasks.length > 0) ? 12 : 0 }}>
                                                    {note.content}
                                                </div>

                                                {/* Extracted Tasks (if any) */}
                                                {note.extracted_tasks && note.extracted_tasks.length > 0 && (
                                                    <div style={{ marginBottom: 12, background: 'rgba(16,185,129,0.05)', padding: 8, borderRadius: 8, border: '1px solid rgba(16,185,129,0.15)' }}>
                                                        <div style={{ fontSize: 10, fontWeight: 800, color: '#047857', marginBottom: 4, textTransform: 'uppercase' }}>✅ Linked Tasks</div>
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                            {note.extracted_tasks.map((task: any, i: number) => (
                                                                <div key={i} style={{ fontSize: 11, color: T.text, display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                    <span>•</span>
                                                                    <span style={{ flex: 1 }}>{task.text}</span>
                                                                    <span style={{ fontSize: 9, color: T.textMuted }}>({task.assignee})</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {note.audio_url && (
                                                    <div style={{ marginBottom: 12, background: T.bg, padding: 8, borderRadius: 8, border: `1px solid ${T.borderSoft}` }}>
                                                        <audio controls src={note.audio_url} style={{ width: '100%', height: 32 }} />
                                                    </div>
                                                )}

                                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                                        {note.tags.map(t => <span key={t} style={{ fontSize: 8, padding: "1px 6px", borderRadius: 4, background: T.accentBg, color: T.accentDark, fontWeight: 700 }}>#{t.toUpperCase()}</span>)}
                                                    </div>
                                                    {note.created_by_name && (
                                                        <div style={{ fontSize: 9, color: T.textMuted }}>By {note.created_by_name}</div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

        </SectionCard>

        {/* Voice Note Recorder — opens as overlay, pre-linked to this case */}
        {showVoiceForCase && (
            <VoiceNoteRecorder
                cases={[selected]}
                T={T}
                onClose={() => setShowVoiceForCase(false)}
                onComplete={(_note) => {
                    setShowVoiceForCase(false);
                    loadNotes();
                }}
            />
        )}
        </>
    );
}

// ── DOCUMENTS ─────────────────────────────────────────────────────────────────
const ALLOWED_TYPES: Record<string, string> = {
    'application/pdf': '📄',
    'image/jpeg': '🖼',
    'image/png': '🖼',
    'image/jpg': '🖼',
    'application/msword': '📝',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '📝',
};
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export function DocumentsSection({ selected, onUpdate }: { selected: any; onUpdate: (c: any) => void }) {
    const { T } = useApp();
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
    const [showDriveInput, setShowDriveInput] = useState(false);
    const [driveLink, setDriveLink] = useState('');
    const [driveName, setDriveName] = useState('');
    const [apiDocuments, setApiDocuments] = useState<any>(null);
    const [apiDocsFetched, setApiDocsFetched] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const docs = selected.documents || [];

    // Check cache status for badge display (no fetch triggered)
    const hasDocsCached = selected?.cnrNumber ? isCached('documents', selected.cnrNumber) : false;

    const loadApiDocuments = async () => {
        if (!selected?.cnrNumber || apiDocsFetched) return;
        const data = await fetchWithTimeout(() => fetchCaseDocuments(selected.cnrNumber));
        if (data) setApiDocuments(data);
        setApiDocsFetched(true);
    };

    // Auto-load ONLY if already cached (0 API cost — reads from localStorage)
    useEffect(() => {
        if (!selected?.cnrNumber) return;
        if (hasDocsCached && !apiDocsFetched) {
            loadApiDocuments();
        }
    }, [selected?.cnrNumber]);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploadError(null);
        setUploadSuccess(null);

        // Validate type
        if (!ALLOWED_TYPES[file.type]) {
            setUploadError('Only PDF, JPG, PNG, DOC, DOCX files are allowed.');
            e.target.value = '';
            return;
        }
        // Validate size
        if (file.size > MAX_FILE_SIZE) {
            setShowDriveInput(true);
            setUploadError(`File too large (${formatFileSize(file.size)}). Max is 2 MB.\nFor larger files, upload to Google Drive and paste the link below.`);
            e.target.value = '';
            return;
        }

        setUploading(true);
        try {
            const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            const doc = {
                id: crypto.randomUUID(),
                name: file.name,
                type: file.type,
                size: file.size,
                sizeDisplay: formatFileSize(file.size),
                base64,
                uploadedAt: new Date().toISOString(),
                source: 'upload' as const,
            };

            try {
                onUpdate({ ...selected, documents: [...docs, doc] });
                setUploadSuccess(`✓ ${file.name} uploaded successfully`);
            } catch {
                setUploadError('Storage full. Please export your data to free up space, then try again.');
            }
        } catch {
            setUploadError('Failed to read file. Please try again.');
        } finally {
            setUploading(false);
            e.target.value = '';
        }
    };

    const handleAddDriveLink = () => {
        if (!driveLink.trim() || !driveName.trim()) {
            setUploadError('Please enter both a document name and a Google Drive link.');
            return;
        }
        const doc = {
            id: crypto.randomUUID(),
            name: driveName.trim(),
            type: 'link',
            size: 0,
            sizeDisplay: 'Drive link',
            url: driveLink.trim(),
            uploadedAt: new Date().toISOString(),
            source: 'drive' as const,
        };
        onUpdate({ ...selected, documents: [...docs, doc] });
        setDriveLink('');
        setDriveName('');
        setShowDriveInput(false);
        setUploadError(null);
        setUploadSuccess('✓ Google Drive link saved');
    };

    const viewDocument = (doc: any) => {
        if (doc.source === 'drive' || doc.type === 'link') {
            window.open(doc.url, '_blank', 'noreferrer');
            return;
        }
        // Open base64 document in new tab
        const win = window.open('', '_blank');
        if (!win) return;
        if (doc.type === 'application/pdf') {
            win.document.write(`<html><body style="margin:0"><iframe src="${doc.base64}" style="width:100%;height:100vh;border:none"></iframe></body></html>`);
        } else if (doc.type?.startsWith('image/')) {
            win.document.write(`<html><body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;min-height:100vh"><img src="${doc.base64}" style="max-width:100%;max-height:100vh;object-fit:contain"></body></html>`);
        } else {
            // For Word docs — trigger download
            const a = win.document.createElement('a');
            a.href = doc.base64;
            a.download = doc.name;
            win.document.body.appendChild(a);
            a.click();
            win.close();
        }
    };

    const removeDocument = (docId: string) => {
        onUpdate({ ...selected, documents: docs.filter((d: any) => d.id !== docId) });
    };

    return (
        <SectionCard icon="📁" title="DOCUMENTS" count={docs.length > 0 ? `${docs.length} file${docs.length !== 1 ? 's' : ''} saved` : 'No documents saved yet'} onAdd={() => { }} addLabel="">
            {/* Upload Controls */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <label style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 16px',
                    borderRadius: 8, border: `1px solid ${T.border}`, background: uploading ? T.bg : T.surface,
                    color: T.textSub, fontSize: 13, fontWeight: 700, cursor: uploading ? 'not-allowed' : 'pointer',
                    opacity: uploading ? 0.7 : 1, whiteSpace: 'nowrap',
                }}>
                    {uploading ? '⏳ Uploading...' : '📎 Upload File'}
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                        style={{ display: 'none' }}
                        onChange={handleFileChange}
                        disabled={uploading}
                    />
                </label>
                <button
                    onClick={() => { setShowDriveInput(v => !v); setUploadError(null); }}
                    style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.textSub, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                >
                    🔗 Paste Drive Link
                </button>
                <div style={{ fontSize: 11, color: T.textMuted, alignSelf: 'center', marginLeft: 4 }}>
                    PDF, JPG, PNG, DOC, DOCX · Max 2 MB
                </div>
            </div>

            {/* Google Drive link input */}
            {showDriveInput && (
                <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: 14, marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, marginBottom: 8 }}>PASTE GOOGLE DRIVE LINK</div>
                    <input
                        placeholder="Document name (e.g. Counter Affidavit.pdf)"
                        value={driveName}
                        onChange={e => setDriveName(e.target.value)}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: 7, border: `1px solid ${T.border}`, fontSize: 13, color: T.text, outline: 'none', boxSizing: 'border-box', marginBottom: 8 }}
                    />
                    <input
                        placeholder="Google Drive share link..."
                        value={driveLink}
                        onChange={e => setDriveLink(e.target.value)}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: 7, border: `1px solid ${T.border}`, fontSize: 13, color: T.text, outline: 'none', boxSizing: 'border-box', marginBottom: 10 }}
                    />
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button onClick={() => { setShowDriveInput(false); setUploadError(null); }} style={{ padding: '6px 14px', borderRadius: 7, border: `1px solid ${T.border}`, background: T.bg, color: T.textSub, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                        <button onClick={handleAddDriveLink} style={{ padding: '6px 16px', borderRadius: 7, border: 'none', background: 'linear-gradient(135deg,#C9A84C,#9B7B28)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Save Link</button>
                    </div>
                </div>
            )}

            {/* Status messages */}
            {uploadError && (
                <div style={{ padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 12, color: '#C62828', marginBottom: 10, whiteSpace: 'pre-line' }}>
                    ⚠️ {uploadError}
                </div>
            )}
            {uploadSuccess && (
                <div style={{ padding: '8px 12px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, fontSize: 12, color: '#166534', marginBottom: 10 }}>
                    {uploadSuccess}
                </div>
            )}

            {/* API Documents Section */}
            {apiDocuments !== null && (
                <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: T.textMuted, letterSpacing: 0.8, marginBottom: 10, textTransform: 'uppercase' }}>Court Filed Documents</div>
                    
                    {Array.isArray(apiDocuments) && apiDocuments.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {apiDocuments.map((doc: any, idx: number) => {
                                const docName = doc.name || doc.title || doc.type || 'Document';
                                const filedDate = doc.filedDate || doc.filed_date || doc.date || null;
                                const docUrl = doc.url || doc.link || null;
                                
                                return (
                                    <div key={idx} style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                        padding: '10px 12px', background: T.surface, borderRadius: 8, border: `1px solid ${T.border}`
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                                            <span style={{ fontSize: 18, flexShrink: 0 }}>📄</span>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: 13, fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {docName}
                                                </div>
                                                {filedDate && (
                                                    <div style={{ fontSize: 11, color: T.textMuted }}>
                                                        Filed: {formatDateForDisplay(filedDate)}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        {docUrl && (
                                            <button
                                                onClick={() => window.open(docUrl, '_blank', 'noreferrer')}
                                                style={{
                                                    padding: '4px 10px', borderRadius: 6, border: `1px solid ${T.border}`,
                                                    background: T.bg, color: '#2A7BD4', fontSize: 12, fontWeight: 600,
                                                    cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap', marginLeft: 8
                                                }}
                                            >
                                                View
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div style={{ fontSize: 13, color: T.textMuted, padding: '10px 12px' }}>
                            No court documents on file
                        </div>
                    )}
                </div>
            )}

            {/* Document list */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {docs.map((d: any) => (
                    <div key={d.id} style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
                        background: T.surface, borderRadius: 9, border: `1px solid ${T.border}`,
                        minWidth: 160, flex: '1 1 160px', cursor: 'pointer',
                    }}
                        onClick={() => viewDocument(d)}
                        title={`Click to open ${d.name}`}
                    >
                        <span style={{ fontSize: 20, flexShrink: 0 }}>
                            {d.source === 'drive' ? '🔗' : (ALLOWED_TYPES[d.type] || '📄')}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#2A7BD4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</div>
                            <div style={{ fontSize: 10, color: T.textMuted }}>
                                {d.sizeDisplay || (d.source === 'drive' ? 'Drive link' : '')} · {fmtDate(d.uploadedAt)}
                            </div>
                        </div>
                        <button
                            onClick={e => { e.stopPropagation(); removeDocument(d.id); }}
                            style={{ background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: 15, padding: '2px 4px', flexShrink: 0 }}
                            title="Remove document"
                        >✕</button>
                    </div>
                ))}
            </div>
        </SectionCard>
    );
}

// ── APPLICATIONS ──────────────────────────────────────────────────────────────
export function ApplicationsSection({ selected, onUpdate, fetchTrigger = 0 }: { selected: any; onUpdate: (c: any) => void; fetchTrigger?: number }) {
    const { T } = useApp();
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({ title: "", status: "Pending", filedOn: "", particular: "", filedBy: "", remark: "" });
    const [iaApiData, setIaApiData] = useState<any[] | null>(null);
    const [iaLoading, setIaLoading] = useState(false);
    const [iaFetched, setIaFetched] = useState(false);
    const [selectedIA, setSelectedIA] = useState<any | null>(null);
    const [iaDebugMsg, setIaDebugMsg] = useState<string>("");
    const [scRawHtml, setScRawHtml] = useState<string | null>(null);
    const [showRawModal, setShowRawModal] = useState(false);
    const apps = selected.applications || [];
    const STATUS_COLORS: Record<string, string> = { Pending: "#C9A84C", Allowed: "#1A8C5B", Dismissed: "#C62828", Withdrawn: "#8A94B0", D: "#C62828" };

    // Get suggested IAs from listing data
    const parsed = parseListingData(selected);
    const suggestedIAs: string[] = parsed.iaNumbers || [];

    // Office report iaList — the richest source of IA details from SC
    // Fields: iaNo, aorName (Filed By), filedOn (Filing Date), description (Particular)
    const officeReport = selected.officeReport;
    const officeIAList: any[] = officeReport?.iaList || [];

    // Normalise office report IAs into display-friendly objects
    const officeIARows: any[] = officeIAList.map((ia: any) => ({
        iaNo: ia.iaNo,
        particular: ia.description || ia.particulars || ia.particular || "",
        filedBy: ia.aorName || ia.filed_by || ia.advocate || "",
        filingDate: ia.filedOn || ia.filing_date || "",
        status: ia.status || "",
        remark: ia.remark || ia.remarks || "",
        _source: "officeReport",
        _raw: ia,
    }));

    // Merge: office report rows first, then any suggestedIA numbers not already in office list
    const officeIANos = new Set(officeIARows.map((r: any) => (r.iaNo || "").trim()));
    const listingOnlyRows: any[] = suggestedIAs
        .filter((n: string) => !officeIANos.has(n.trim()))
        .map((iaNo: string) => ({ iaNo, particular: "", filedBy: "", filingDate: "", status: "", remark: "", _source: "listing" }));

    // Recursively search for an array of IA-like objects anywhere in the API response
    function findIAArray(obj: any, depth = 0): any[] | null {
        if (depth > 5 || !obj || typeof obj !== "object") return null;
        if (Array.isArray(obj)) {
            if (obj.length === 0) return null;
            const first = obj[0];
            if (first && typeof first === "object") {
                const lk = Object.keys(first).map(k => k.toLowerCase().replace(/_/g, ""));
                const hasIAField = lk.some(k => k.includes("iano") || k.includes("regno") || k.includes("regastno") || k.includes("srno") || k.includes("serial"));
                const hasDetailField = lk.some(k => k.includes("particular") || k.includes("filedby") || k.includes("filingdate") || k.includes("status") || k.includes("remark") || k.includes("enteredon"));
                if (hasIAField || hasDetailField) return obj;
            }
            return null;
        }
        // Check known root-level keys first (fastest path)
        const knownKeys = [
            "interlocutoryApplications", "interlocutory_applications",
            "ia_list", "iaList", "ia", "ias",
            "iaDocuments", "ia_documents", "ia_data", "iaData",
            "interlocutory", "IAs", "iaApplications", "ia_applications",
            "applications", "applicationList", "application_list",
        ];
        for (const key of knownKeys) {
            if (Array.isArray(obj[key]) && obj[key].length > 0) return obj[key];
        }
        // Recurse into nested objects
        for (const key of Object.keys(obj)) {
            if (typeof obj[key] === "object" && obj[key] !== null && !Array.isArray(obj[key])) {
                const found = findIAArray(obj[key], depth + 1);
                if (found) return found;
            }
        }
        // Recurse into any arrays that aren't simple values
        for (const key of Object.keys(obj)) {
            if (Array.isArray(obj[key])) {
                const found = findIAArray(obj[key], depth + 1);
                if (found) return found;
            }
        }
        return null;
    }

    // Normalize a raw IA object from the API into our standard shape
    function normalizeIAItem(item: any): any {
        // Build a lowercase-no-underscore key map for fuzzy matching
        const lk: Record<string, any> = {};
        Object.keys(item).forEach(k => { lk[k.toLowerCase().replace(/_/g, "")] = item[k]; });
        return {
            iaNo: item.iaNo || item.ia_no || item.regNo || item.reg_no || item.iano || item.regno
                || lk.iano || lk.regno || lk.registrationnumber || lk.regastno || "",
            srNo: item.srNo || item.sr_no || item.srno || item.serialNumber || item.serial_number
                || lk.srno || lk.serialnumber || "",
            particular: item.particular || item.particulars || item.Particular
                || lk.particular || lk.particulars || lk.description || "",
            remark: item.remark || item.remarks || lk.remark || lk.remarks || "",
            filedBy: item.filedBy || item.filed_by || item.FiledBy || item.petitionerName
                || lk.filedby || lk.filedbyname || lk.petitionername || lk.petitioner || "",
            filingDate: item.filingDate || item.filing_date || item.FilingDate || item.date_of_filing
                || lk.filingdate || lk.dateoffiling || "",
            status: item.status || item.Status || lk.status || "",
            enteredOn: item.enteredOn || item.entered_on || item.EnteredOn
                || lk.enteredon || lk.dateentered || "",
            _source: "api",
            _raw: item,
        };
    }

    // Fetch IA details — tries SC website documents tab first (free), then SC proxy, then eCourts API
    const fetchIAData = async (scOnly = false) => {
        if (iaLoading) return;
        setIaLoading(true);
        setIaDebugMsg("Fetching from SC…");

        const diaryNo = selected?.diaryNumber || selected?.diaryNo || "";
        const diaryYear = selected?.diaryYear || "";

        // ── Try 0: SC website WordPress AJAX — discover tab names, then fetch documents tab ──
        if (diaryNo && diaryYear) {
            try {
                const baseUrl = `${SC_BASE}/wp-admin/admin-ajax.php?diary_no=${diaryNo}&diary_year=${diaryYear}&action=get_case_details&es_ajax_request=1&language=en`;

                // Step 1: fetch main page to discover available tab names
                const mainRes = await fetchWithTimeout(
                    () => fetch(`${baseUrl}&tab_name=`).then(r => r.ok ? r.json() : Promise.reject(r.status)),
                    10000
                );
                const mainHtml = typeof mainRes?.data === 'string' ? mainRes.data : '';
                const tabNames: string[] = [];
                if (mainHtml) {
                    const mainDoc = new DOMParser().parseFromString(mainHtml, 'text/html');
                    mainDoc.querySelectorAll('[data-tab-name]').forEach(el => {
                        const t = el.getAttribute('data-tab-name');
                        if (t) tabNames.push(t);
                    });
                }

                // Step 2: find the documents/IA tab
                const docsTab = tabNames.find(t => /document|filing|ia\b|application/i.test(t)) || 'documents';

                // Step 3: fetch the documents tab (or try main HTML if no tab found)
                const tabRes = await fetchWithTimeout(
                    () => fetch(`${baseUrl}&tab_name=${docsTab}`).then(r => r.ok ? r.json() : Promise.reject(r.status)),
                    10000
                );
                // Use tab HTML if available, otherwise try parsing IA tables from main HTML
                const html = (typeof tabRes?.data === 'string' && tabRes.data.trim().length > 50)
                    ? tabRes.data
                    : mainHtml;
                if (html) {
                    setScRawHtml(html); // save raw HTML for "View SC Table" modal
                    const doc = new DOMParser().parseFromString(html, 'text/html');
                    const tables = Array.from(doc.querySelectorAll('table'));

                    // Parse IA table — header contains "Reg. No" or "I.A."
                    const iaTable = tables.find(t => /reg\.\s*no|i\.a\.|interlocutory/i.test(t.textContent || ''));
                    if (iaTable) {
                        const iaRows = Array.from(iaTable.querySelectorAll('tbody tr'))
                            .map(tr => {
                                const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent?.trim() || '');
                                if (cells.length < 4) return null;
                                return {
                                    srNo: cells[0],
                                    iaNo: cells[1],
                                    particular: cells[2],
                                    remark: cells[3],
                                    filedBy: cells[4] || '',
                                    filingDate: cells[5] || '',
                                    status: cells[6] || '',
                                    enteredOn: cells[7] || '',
                                    _source: 'sc-documents',
                                };
                            })
                            .filter(Boolean) as any[];
                        if (iaRows.length > 0) {
                            setIaApiData(iaRows);
                            setIaDebugMsg(`✓ ${iaRows.length} IA(s) loaded from SC`);
                        }
                    }

                    // Parse Other Documents table — header contains "Document Number" or "Document Type"
                    const docsTable = tables.find(t => /document\s*number|document\s*type/i.test(t.textContent || ''));
                    if (docsTable) {
                        // otherDocsData visible inside "View SC Table" modal via raw HTML
                    }

                    if (iaTable || docsTable) {
                        setIaFetched(true);
                        setIaLoading(false);
                        return;
                    }
                    setIaDebugMsg('SC documents tab returned no tables');
                }
            } catch (err: any) {
                setIaDebugMsg(`SC documents tab error: ${err?.message || 'unknown'}`);
            }
        }

        if (scOnly) {
            setIaFetched(true);
            setIaLoading(false);
            return;
        }

        // ── Try 1: eCourts API by CNR (if configured and CNR available) ──
        if (selected?.cnrNumber) {
            const docs = await fetchWithTimeout(() => fetchCaseDocuments(selected.cnrNumber), 8000);
            if (docs) {
                const raw = findIAArray(docs);
                if (raw && raw.length > 0) {
                    setIaApiData(raw.map(normalizeIAItem));
                    setIaDebugMsg(`✓ ${raw.length} IA(s) loaded from eCourts documents`);
                    setIaFetched(true); setIaLoading(false); return;
                }
            }
        }

        if (!selected?.cnrNumber) {
            setIaDebugMsg("No diary number or CNR available on this case.");
        }

        setIaFetched(true);
        setIaLoading(false);
    };

    // Reset on case change + auto-load when CNR available
    useEffect(() => {
        setIaApiData(null);
        setIaFetched(false);
        setIaLoading(false);
        setSelectedIA(null);
        setIaDebugMsg("");
        setScRawHtml(null);
        setShowRawModal(false);
        // Auto-load: use diary number (SC website, free) or CNR (eCourts API)
        const hasDiary = !!(selected?.diaryNumber || selected?.diaryNo) && !!selected?.diaryYear;
        if (hasDiary || !!selected?.cnrNumber) {
            setTimeout(() => fetchIAData(false), 0);
        }
    }, [selected?.id]);

    // "Fetch All" trigger — SC sources only (no eCourts API credits)
    useEffect(() => {
        if (fetchTrigger > 0 && !iaLoading && !iaFetched) fetchIAData(true);
    }, [fetchTrigger]);

    // Unified list: API data (if any) → office report rows → listing-only rows
    const scIARows: any[] = iaApiData && iaApiData.length > 0
        ? iaApiData
        : [...officeIARows, ...listingOnlyRows];

    function addApp() {
        if (!form.title.trim()) return;
        onUpdate({ ...selected, applications: [...apps, { id: "a" + Date.now(), ...form, filedOn: form.filedOn || new Date().toISOString().split("T")[0] }] });
        setForm({ title: "", status: "Pending", filedOn: "", particular: "", filedBy: "", remark: "" });
        setShowForm(false);
    }
    function updateStatus(id: string, status: string) { onUpdate({ ...selected, applications: apps.map((a: any) => a.id === id ? { ...a, status } : a) }); }

    const countMessage = () => {
        const scCount = scIARows.length;
        if (scCount === 0 && apps.length === 0) return "No IAs on record";
        return `${scCount > 0 ? `${scCount} from SC` : ""} ${apps.length > 0 ? `· ${apps.length} added` : ""}`.trim().replace(/^·\s*/, "");
    };

    return (
        <SectionCard icon="📂" title="APPLICATIONS" count={countMessage()} onAdd={() => setShowForm(s => !s)} addLabel={showForm ? "✕ Cancel" : "+ Add Application"}>

            {/* Fetch SC Applications button — works via CNR or diary number */}
            {!iaFetched && (
                <div style={{ marginBottom: 12 }}>
                    <button
                        onClick={() => fetchIAData()}
                        disabled={iaLoading}
                        style={{
                            width: "100%", padding: "8px 14px", borderRadius: 7, border: "none",
                            background: iaLoading ? '#94A3B8' : 'linear-gradient(135deg,#2A7BD4,#1A5EA8)',
                            color: "#fff", fontSize: 13, fontWeight: 700,
                            cursor: iaLoading ? "not-allowed" : "pointer", opacity: iaLoading ? 0.7 : 1
                        }}
                    >
                        {iaLoading ? "Fetching Applications..." : "📡 Fetch SC Applications"}
                    </button>
                    {!selected?.cnrNumber && (
                        <div style={{ marginTop: 6, fontSize: 11, color: "#8A94B0" }}>
                            ℹ️ No CNR on this case — will try via diary number ({selected?.diaryNumber || selected?.diaryNo}/{selected?.diaryYear})
                        </div>
                    )}
                </div>
            )}

            {iaFetched && (
                <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={() => fetchIAData()} disabled={iaLoading} style={{ padding: "5px 12px", borderRadius: 6, border: `1px solid #2A7BD4`, background: "transparent", color: "#2A7BD4", fontSize: 12, fontWeight: 600, cursor: iaLoading ? "not-allowed" : "pointer" }}>
                        {iaLoading ? "Loading..." : "Reload SC Applications"}
                    </button>
                    {scRawHtml && (
                        <button
                            onClick={() => setShowRawModal(true)}
                            style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "linear-gradient(135deg,#1A3A6B,#0F2347)", color: "#C9A84C", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                        >
                            📄 View SC Table
                        </button>
                    )}
                    {iaDebugMsg && (
                        <div style={{ width: "100%", marginTop: 2, fontSize: 11, color: iaDebugMsg.startsWith("✓") ? "#1A8C5B" : "#C62828", fontStyle: "italic" }}>
                            {iaDebugMsg}
                        </div>
                    )}
                </div>
            )}

            {/* Raw SC HTML modal — shows the full table exactly as SC website returns it */}
            {showRawModal && scRawHtml && (
                <div
                    style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
                    onClick={e => { if (e.target === e.currentTarget) setShowRawModal(false); }}
                >
                    <div style={{ background: T.bg, borderRadius: 14, width: "100%", maxWidth: 900, maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.5)", overflow: "hidden" }}>
                        {/* Header */}
                        <div style={{ background: "linear-gradient(135deg,#1A3A6B,#0F2347)", padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
                            <div>
                                <div style={{ color: "#C9A84C", fontWeight: 800, fontSize: 15 }}>Supreme Court of India</div>
                                <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 2 }}>IA Applications &amp; Documents</div>
                            </div>
                            <button
                                onClick={() => setShowRawModal(false)}
                                style={{ background: "rgba(255,255,255,0.12)", border: "none", color: "#fff", borderRadius: 6, padding: "4px 10px", fontSize: 16, cursor: "pointer", fontWeight: 700 }}
                            >✕</button>
                        </div>
                        {/* Scrollable content — renders SC HTML tables with injected styles */}
                        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
                            <style>{`
                                .sc-raw-modal table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 18px; }
                                .sc-raw-modal thead th, .sc-raw-modal tr:first-child th { background: #1A3A6B; color: #C9A84C; padding: 8px 10px; text-align: left; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; border-right: 1px solid rgba(255,255,255,0.1); white-space: nowrap; }
                                .sc-raw-modal td { padding: 8px 10px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
                                .sc-raw-modal tr:nth-child(even) td { background: #f8f9fa; }
                                .sc-raw-modal h2, .sc-raw-modal h3 { font-size: 13px; font-weight: 700; color: #1A3A6B; margin: 16px 0 8px; text-transform: uppercase; letter-spacing: 0.5px; }
                                .sc-raw-modal a { color: #2A7BD4; }
                            `}</style>
                            <div
                                className="sc-raw-modal"
                                dangerouslySetInnerHTML={{ __html: scRawHtml }}
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* Empty state */}
            {scIARows.length === 0 && apps.length === 0 && (
                <div style={{ fontSize: 13, color: T.textMuted, padding: "12px", textAlign: "center", marginBottom: 12 }}>
                    No applications on record. Fetch from SC or add manually.
                </div>
            )}



            {/* Add form */}
            {showForm && (
                <div style={{ background: T.surface, borderRadius: 9, border: `1px solid ${T.border}`, padding: "12px", marginBottom: 10 }}>
                    <input placeholder="Application title (e.g. IA No. 1/2024 – Stay Application)" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} style={{ width: "100%", padding: "7px 9px", borderRadius: 7, border: `1px solid ${T.border}`, fontSize: 14, color: T.text, outline: "none", boxSizing: "border-box", marginBottom: 7 }} />
                    {form.particular ? <input value={form.particular} readOnly style={{ width: "100%", padding: "6px 9px", borderRadius: 7, border: `1px solid ${T.borderSoft}`, fontSize: 13, color: T.textMuted, outline: "none", boxSizing: "border-box", marginBottom: 7, background: T.bg }} /> : null}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                        <div>
                            <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: 0.8, display: "block", marginBottom: 3 }}>STATUS</label>
                            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} style={{ width: "100%", padding: "7px 9px", borderRadius: 7, border: `1px solid ${T.border}`, fontSize: 14, color: T.text, background: T.surface, outline: "none" }}>
                                {["Pending", "Allowed", "Dismissed", "Withdrawn"].map(s => <option key={s}>{s}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: 0.8, display: "block", marginBottom: 3 }}>FILED ON</label>
                            <input type="date" value={form.filedOn} onChange={e => setForm(f => ({ ...f, filedOn: e.target.value }))} style={{ width: "100%", padding: "7px 9px", borderRadius: 7, border: `1px solid ${T.border}`, fontSize: 14, color: T.text, outline: "none", boxSizing: "border-box" }} />
                        </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 7 }}>
                        <button onClick={() => setShowForm(false)} style={{ padding: "5px 12px", borderRadius: 7, border: `1px solid ${T.border}`, background: T.bg, color: T.textSub, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
                        <button onClick={addApp} style={{ padding: "5px 14px", borderRadius: 7, border: "none", background: "linear-gradient(135deg,#C9A84C,#9B7B28)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Add</button>
                    </div>
                </div>
            )}

            {/* Tracked (manually added) apps */}
            {apps.length > 0 && (
                <div style={{ marginTop: scIARows.length > 0 ? 4 : 0 }}>
                    {scIARows.length > 0 && <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, letterSpacing: 0.8, marginBottom: 8, textTransform: "uppercase" }}>Tracked Applications</div>}
                    {apps.map((a: any) => (
                        <div key={a.id} style={{ background: T.surface, borderRadius: 9, border: `1px solid ${T.borderSoft}`, padding: "12px 14px", marginBottom: 8 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                                <div style={{ fontSize: 14, fontWeight: 700, color: T.text, flex: 1 }}>{a.title}</div>
                                <button onClick={() => onUpdate({ ...selected, applications: apps.filter((x: any) => x.id !== a.id) })} style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", fontSize: 15, padding: "0 2px", lineHeight: 1, flexShrink: 0 }}>✕</button>
                            </div>
                            {a.particular && (
                                <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 8 }}>{a.particular}</div>
                            )}
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                <select value={a.status} onChange={e => updateStatus(a.id, e.target.value)} style={{ padding: "3px 8px", borderRadius: 6, border: `1px solid ${STATUS_COLORS[a.status] || T.border}`, background: `${STATUS_COLORS[a.status] || "#8A94B0"}15`, color: STATUS_COLORS[a.status] || T.textMuted, fontSize: 13, fontWeight: 700, cursor: "pointer", outline: "none" }}>
                                    {["Pending", "Allowed", "Dismissed", "Withdrawn"].map(s => <option key={s}>{s}</option>)}
                                </select>
                                <span style={{ fontSize: 11, color: T.textMuted }}>Filed: {fmtDate(a.filedOn)}</span>
                                {a.filedBy && <span style={{ fontSize: 11, color: T.textMuted }}>By: {a.filedBy}</span>}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* IA Details Modal — Name Card Style */}
            {selectedIA && (() => {
                const iaNo = selectedIA.iaNo || "IA";
                const srNo = selectedIA.srNo || "";
                const particular = selectedIA.particular || "";
                const filedBy = selectedIA.filedBy || "";
                const filingDateRaw = selectedIA.filingDate || "";
                const remark = selectedIA.remark || "";
                const statusVal = selectedIA.status || "";
                const enteredOnRaw = selectedIA.enteredOn || "";
                const sColor = STATUS_COLORS[statusVal] || "#8A94B0";
                const dataSource = selectedIA._source;
                const hasAnyData = !!(srNo || particular || filedBy || filingDateRaw || remark || enteredOnRaw);

                const copyText = [
                    `SUPREME COURT OF INDIA`,
                    `Interlocutory Application: ${iaNo}`,
                    statusVal ? `Status: ${statusVal}` : null,
                    srNo ? `Serial No: ${srNo}` : null,
                    particular ? `Particular: ${particular}` : null,
                    filedBy ? `Filed By: ${filedBy}` : null,
                    filingDateRaw ? `Filing Date: ${formatDateForDisplay(filingDateRaw)}` : null,
                    enteredOnRaw ? `Entered On: ${formatDateForDisplay(enteredOnRaw)}` : null,
                    remark ? `Remarks: ${remark}` : null,
                ].filter(Boolean).join("\n");

                return (
                    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: 16 }} onClick={() => setSelectedIA(null)}>
                        <div style={{ background: T.bg, borderRadius: 16, border: `1px solid ${T.border}`, width: "100%", maxWidth: 420, maxHeight: "90vh", overflow: "auto", boxShadow: "0 8px 40px rgba(0,0,0,0.35)" }} onClick={e => e.stopPropagation()}>

                            {/* SC Header */}
                            <div style={{ background: "linear-gradient(135deg,#1A3A6B,#0F2347)", padding: "16px 20px", textAlign: "center" }}>
                                <div style={{ fontSize: 12, fontWeight: 800, color: "#C9A84C", letterSpacing: 1, textTransform: "uppercase", marginBottom: 3 }}>Supreme Court of India</div>
                                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)" }}>Interlocutory Application Details</div>
                                <button onClick={() => setSelectedIA(null)} style={{ position: "absolute", top: 12, right: 16, background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.25)", color: "#fff", cursor: "pointer", fontSize: 14, borderRadius: 5, padding: "3px 8px", lineHeight: 1 }}>✕</button>
                            </div>

                            {/* IA Number Badge */}
                            <div style={{ textAlign: "center", padding: "20px 20px 0" }}>
                                <div style={{ display: "inline-block", padding: "8px 24px", borderRadius: 8, background: "linear-gradient(135deg,#FEF3C7,#FDE68A)", border: "2px solid #D97706", fontSize: 18, fontWeight: 800, color: "#92400E" }}>
                                    {iaNo}
                                </div>
                                {statusVal && statusVal !== "—" && (
                                    <div style={{ marginTop: 10 }}>
                                        <span style={{ fontSize: 12, fontWeight: 700, background: sColor + "22", color: sColor, padding: "4px 14px", borderRadius: 20, border: `1px solid ${sColor}44` }}>
                                            {statusVal.toUpperCase()}
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Fields */}
                            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 0 }}>
                                {hasAnyData ? (
                                    <>
                                        {srNo && (
                                            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: `1px solid ${T.borderSoft}` }}>
                                                <span style={{ fontSize: 18, flexShrink: 0 }}>🔢</span>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 1 }}>Serial Number</div>
                                                    <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{srNo}</div>
                                                </div>
                                            </div>
                                        )}
                                        {particular && (
                                            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "11px 0", borderBottom: `1px solid ${T.borderSoft}` }}>
                                                <span style={{ fontSize: 18, flexShrink: 0, marginTop: 2 }}>📝</span>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 1 }}>Particulars</div>
                                                    <div style={{ fontSize: 14, fontWeight: 600, color: T.text, lineHeight: 1.4 }}>{particular}</div>
                                                </div>
                                            </div>
                                        )}
                                        {filedBy && (
                                            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: `1px solid ${T.borderSoft}` }}>
                                                <span style={{ fontSize: 18, flexShrink: 0 }}>👤</span>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 1 }}>Filed By</div>
                                                    <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{filedBy}</div>
                                                </div>
                                            </div>
                                        )}
                                        {filingDateRaw && (
                                            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: `1px solid ${T.borderSoft}` }}>
                                                <span style={{ fontSize: 18, flexShrink: 0 }}>📅</span>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 1 }}>Filing Date</div>
                                                    <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{formatDateForDisplay(filingDateRaw)}</div>
                                                </div>
                                            </div>
                                        )}
                                        {enteredOnRaw && (
                                            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: `1px solid ${T.borderSoft}` }}>
                                                <span style={{ fontSize: 18, flexShrink: 0 }}>🏛️</span>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 1 }}>Entered On</div>
                                                    <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{formatDateForDisplay(enteredOnRaw)}</div>
                                                </div>
                                            </div>
                                        )}
                                        {remark && (
                                            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "11px 0" }}>
                                                <span style={{ fontSize: 18, flexShrink: 0, marginTop: 2 }}>💬</span>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 1 }}>Remarks</div>
                                                    <div style={{ fontSize: 14, fontWeight: 600, color: T.text, lineHeight: 1.4 }}>{remark}</div>
                                                </div>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div style={{ fontSize: 13, padding: "16px", background: "#FFFBEB", borderRadius: 10, border: "1px solid #FDE68A", color: "#92400E", lineHeight: 1.6, textAlign: "center", marginBottom: 8 }}>
                                        <div style={{ fontSize: 22, marginBottom: 8 }}>📋</div>
                                        <div style={{ fontWeight: 700, marginBottom: 4 }}>Limited Data Available</div>
                                        <div style={{ fontSize: 12 }}>This IA was extracted from court listing. Full details are available in the SC registry.</div>
                                        <div style={{ marginTop: 8, fontSize: 11, color: "#B45309" }}>Click "Reload SC Applications" to fetch complete details.</div>
                                    </div>
                                )}

                                {/* Source + actions */}
                                <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${T.borderSoft}`, textAlign: "center" }}>
                                    <div style={{ fontSize: 10, color: T.textMuted, fontStyle: "italic", marginBottom: 12 }}>
                                        Source: {dataSource === "api" ? "SC Registry (via API)" : dataSource === "officeReport" ? "SC Office Report" : dataSource === "sc-documents" ? "SC Documents Tab" : "Court Listing"}
                                    </div>
                                    <div style={{ display: "flex", gap: 10 }}>
                                        <button
                                            onClick={() => navigator.clipboard.writeText(copyText).then(() => alert("✓ Copied!"))}
                                            style={{ flex: 1, padding: "9px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.textSub, fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                                        >
                                            📋 Copy
                                        </button>
                                        <button
                                            onClick={() => setSelectedIA(null)}
                                            style={{ flex: 1, padding: "9px 14px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#1A3A6B,#0F2347)", color: "#C9A84C", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                                        >
                                            Close
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </SectionCard>
    );
}

// ── LEX TIGRESS OFFICE REPORT ──────────────────────────────────────────────────
export function LexTigressOfficeReportSection({ selected, fetchTrigger = 0 }: { selected: any; fetchTrigger?: number }) {
    const { T } = useApp();
    const [reportText, setReportText] = useState<string>("");
    const [loading, setLoading] = useState(false);
    const [generated, setGenerated] = useState(false);
    const [apiEnhanced, setApiEnhanced] = useState(false);
    const [copied, setCopied] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [aiPrediction, setAiPrediction] = useState<string>('');
    const [generatingPrediction, setGeneratingPrediction] = useState<boolean>(false);

    const diaryNo = selected?.diaryNo || selected?.diaryNumber || selected?.diary_no;
    const diaryYear = selected?.diaryYear || selected?.year || selected?.diary_year;

    const generateReport = async (_forceRefresh = false, openAfter = false) => {
        const caseStatusCheck = (selected?.status || "").toLowerCase();
        if (caseStatusCheck === "disposed" || caseStatusCheck === "closed") {
            alert("This case is already disposed / closed. Office report generation is not allowed.");
            return;
        }
        // Step 1: generate immediately from local case data — instant, no API needed
        try {
            const reportData = buildOfficeReportData(selected, null);
            setReportText(renderOfficeReportText(reportData));
        } catch (e) {
            setReportText("Error building report. Check case data.");
        }
        setGenerated(true);
        setApiEnhanced(false);
        if (openAfter) setShowModal(true);

        if (!diaryNo || !diaryYear) return;

        // Step 2: Fetch SC website tabs to enrich the report
        setLoading(true);
        try {
            const fetchTab = (tab: string) =>
                fetchWithTimeout(
                    () => fetch(`${SC_BASE}/wp-admin/admin-ajax.php?diary_no=${diaryNo}&diary_year=${diaryYear}&tab_name=${tab}&action=get_case_details&es_ajax_request=1&language=en`)
                        .then(r => r.ok ? r.json() : Promise.reject(r.status)),
                    10000
                );

            // Fetch all three tabs in parallel
            const [earlierRes, officeRes, ordersRes] = await Promise.all([
                fetchTab('earlier_court_details').catch(() => null),
                fetchTab('office_report').catch(() => null),
                fetchTab('judgement_orders').catch(() => null),
            ]);

            const apiData: any = {};

            // Parse earlier court details → extract High Court name, case no, order date
            const earlierHtml = typeof earlierRes?.data === 'string' ? earlierRes.data : '';
            if (earlierHtml) {
                const doc = new DOMParser().parseFromString(earlierHtml, 'text/html');
                const rows = Array.from(doc.querySelectorAll('tbody tr'));
                for (const row of rows) {
                    const cells = Array.from(row.querySelectorAll('td')).map(td => td.textContent?.trim() || '');
                    if (cells.length < 5) continue;
                    const [, courtType, state, bench, caseNo, orderDate] = cells;
                    if (/high/i.test(courtType)) {
                        apiData.highCourtName = bench || `High Court of ${state}`;
                        apiData.highCourtCaseNo = caseNo;
                        apiData.highCourtOrderDate = orderDate;
                    } else if (/district|trial/i.test(courtType) && !apiData.trialCourtName) {
                        apiData.trialCourtName = bench || `District Court, ${state}`;
                        apiData.trialCourtCaseNo = caseNo;
                        apiData.trialCourtOrderDate = orderDate;
                    }
                }
            }

            // Parse office report tab → extract last SC office report date
            const officeHtml = typeof officeRes?.data === 'string' ? officeRes.data : '';
            if (officeHtml) {
                const doc2 = new DOMParser().parseFromString(officeHtml, 'text/html');
                const latestLink = doc2.querySelector('a[href*="api.sci.gov.in"]');
                if (latestLink) {
                    apiData.scOfficeReportDate = latestLink.textContent?.trim() || '';
                    apiData.scOfficeReportUrl = new URL((latestLink as HTMLAnchorElement).href).href;
                }
            }

            // Parse judgement_orders tab → extract last order date
            const ordersHtml = typeof ordersRes?.data === 'string' ? ordersRes.data : '';
            if (ordersHtml) {
                const doc3 = new DOMParser().parseFromString(ordersHtml, 'text/html');
                // Links are sorted newest-first by SC website; pick the first PDF link
                const pdfLinks = Array.from(doc3.querySelectorAll('a[href*="api.sci.gov.in"]'))
                    .filter(a => (a as HTMLAnchorElement).href.toLowerCase().endsWith('.pdf'));
                if (pdfLinks.length > 0) {
                    // Link text is the date (e.g. "13-Feb-2026"), prefer that
                    const linkText = pdfLinks[0].textContent?.trim() || '';
                    if (linkText) {
                        apiData.lastOrderDate = linkText;
                    } else {
                        // Fallback: extract date from filename  e.g. Order_13-Feb-2026.pdf
                        const href = new URL((pdfLinks[0] as HTMLAnchorElement).href).pathname;
                        const m = href.match(/Order[_-](\d{2}-\w+-\d{4})/i);
                        if (m) apiData.lastOrderDate = m[1];
                    }
                }
            }

            if (Object.keys(apiData).length > 0) {
                const enhanced = buildOfficeReportData(selected, apiData);
                setReportText(renderOfficeReportText(enhanced));
                setApiEnhanced(true);
            }
        } catch { /* keep local draft */ }

        setLoading(false);
        generateAIPrediction();
    };

    async function generateAIPrediction() {
        if (generatingPrediction) return;
        setGeneratingPrediction(true);
        try {
            const cnr = selected?.cnrNumber;
            const cachedReport = cnr
                ? readCache(`lx_ec_officeReport_${cnr}`)
                : null;
            const cachedOrder = cnr
                ? readCache(`lx_ec_lastOrders_${cnr}`)
                : null;

            const officeReportText = renderOfficeReportText(
                buildOfficeReportData(selected, cachedReport ?? null)
            );

            const lastOrderText = cachedOrder
                ? [
                    cachedOrder.orderText || cachedOrder.order_text || '',
                    cachedOrder.orderSummary || '',
                    cachedOrder.remarks || '',
                    cachedOrder.directives || ''
                ].filter(Boolean).join('\n\n')
                : '';

            const iaText = cachedReport?.iaList
                ?.map((ia: any, i: number) =>
                    `IA No. ${ia.number || i + 1}: ${ia.description || ''} by ${ia.filedBy || ''}`)
                .join('; ') || '';

            const petitioners = Array.isArray(selected?.petitioners)
                ? selected.petitioners.join(', ')
                : selected?.petitioner || '';

            const respondents = Array.isArray(selected?.respondents)
                ? selected.respondents.join(', ')
                : selected?.respondent || '';

            const context = {
                officeReportText,
                lastOrderText,
                iaText,
                caseType: selected?.caseType || selected?.caseTitle || '',
                nextHearing: selected?.nextHearingDate || selected?.nextListingDate || null
            };

            const prediction = await generatePredictedReport(context, petitioners, respondents);
            setAiPrediction(prediction);
        } catch (err) {
            console.error('AI prediction failed:', err);
            setAiPrediction(
                '<p class="sc-body sc-italic">Failed to generate prediction. ' +
                'Please check your API keys in Settings.</p>'
            );
        } finally {
            setGeneratingPrediction(false);
        }
    }

    // Reset when case changes
    useEffect(() => {
        setReportText("");
        setGenerated(false);
        setApiEnhanced(false);
        setLoading(false);
        setShowModal(false);
    }, [selected?.id]);

    // "Fetch All" trigger — generate silently (no modal popup)
    useEffect(() => {
        if (fetchTrigger > 0 && !loading && !generated) generateReport(false, false);
    }, [fetchTrigger]);

    const copyReport = () => {
        navigator.clipboard.writeText(reportText).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const openPrintWindow = () => {
        const caseTitle = selected?.caseNumber || selected?.shortCaseNumber || "Office Report";
        const diaryRef = (selected?.diaryNumber || selected?.diaryNo) && selected?.diaryYear
            ? `Diary No. ${selected.diaryNumber || selected.diaryNo}/${selected.diaryYear}`
            : "";
        let bodyHtml = "";
        try {
            const reportData = buildOfficeReportData(selected, null);
            bodyHtml = renderOfficeReportHtml(reportData);
        } catch { bodyHtml = `<pre style="white-space:pre-wrap">${reportText}</pre>`; }

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>${caseTitle} — Office Report</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 1.9; color: #000; background: #fff; }
  .page { max-width: 720px; margin: 0 auto; padding: 40px 50px; }
  /* SC report header */
  .sc-report-header { text-align: center; border-bottom: 3px double #000; padding-bottom: 14px; margin-bottom: 20px; }
  .sc-report-header h1 { font-size: 14pt; font-weight: bold; letter-spacing: 1.5px; text-transform: uppercase; }
  .sc-report-header h2 { font-size: 12pt; font-weight: bold; letter-spacing: 0.5px; margin-top: 3px; }
  .sc-report-header .diary-ref { font-size: 10pt; color: #555; margin-top: 4px; }
  /* Body elements from renderOfficeReportHtml */
  .sc-center { text-align: center; margin: 4px 0; }
  .sc-bold { font-weight: bold; }
  .sc-italic { font-style: italic; }
  .sc-underline { text-decoration: underline; }
  .sc-title { font-size: 13pt; letter-spacing: 1px; margin: 10px 0; }
  .sc-body { text-align: justify; margin: 8px 0; }
  .sc-para { text-align: justify; margin: 8px 0; padding-left: 24px; text-indent: -24px; }
  .sc-para-no { font-weight: bold; display: inline-block; width: 24px; }
  .sc-gap { height: 16px; }
  .sc-gap-sm { height: 8px; }
  .sc-parties { width: 100%; border: none; border-collapse: collapse; margin: 8px 0; }
  .sc-party-name { font-weight: bold; font-size: 11pt; width: 78%; vertical-align: top; padding: 3px 0; }
  .sc-party-role { font-style: italic; text-align: right; vertical-align: top; padding: 3px 0; white-space: nowrap; }
  .sc-versus { text-align: center; font-weight: bold; letter-spacing: 2px; padding: 4px 0; }
  .sc-table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; font-size: 11pt; }
  .sc-table th { border: 1px solid #000; padding: 5px 8px; font-weight: bold; background: #f0f0f0; text-align: left; }
  .sc-table td { border: 1px solid #000; padding: 5px 8px; vertical-align: top; }
  .sc-sig { width: 100%; margin-top: 30px; }
  .sc-sig-date { font-style: italic; font-size: 11pt; }
  .sc-sig-name { text-align: right; font-weight: bold; font-size: 12pt; }
  .sc-draft-banner { margin-top: 24px; padding: 10px 16px; border: 2px dashed #B45309; background: #FFFBEB; color: #92400E; font-size: 10pt; text-align: center; border-radius: 4px; }
  .actions { display: flex; gap: 12px; justify-content: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #ccc; }
  .btn { padding: 8px 20px; border-radius: 6px; border: none; font-size: 11pt; font-weight: bold; cursor: pointer; }
  .btn-print { background: #1A3A6B; color: #C9A84C; }
  .btn-close { background: #f5f5f5; color: #333; border: 1px solid #ccc; }
  body::before {
    content: 'LEX TIGRESS OFFICE REPORT';
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-35deg);
    font-size: 72px;
    font-weight: 900;
    color: rgba(0, 0, 0, 0.04);
    white-space: nowrap;
    pointer-events: none;
    z-index: 0;
    letter-spacing: 4px;
    font-family: 'Times New Roman', Times, serif;
    user-select: none;
  }
  @media print {
    .actions { display: none !important; }
    .page { padding: 20px 30px; }
  }
</style>
</head>
<body>
<div class="page">
  <div class="actions">
    <button class="btn btn-print" onclick="window.print()">🖨 Print / Save as PDF</button>
    <button class="btn btn-close" onclick="window.close()">✕ Close</button>
  </div>
  <div class="sc-report-header">
    <h1>In the Supreme Court of India</h1>
    <h2>Office Report</h2>
    ${diaryRef ? `<div class="diary-ref">${diaryRef}</div>` : ""}
  </div>
  ${bodyHtml}
</div>
<script>window.focus();</script>
</body>
</html>`;
        const w = window.open("", "_blank", "width=900,height=750,scrollbars=yes,resizable=yes");
        if (w) {
            w.document.write(html);
            w.document.close();
        }
    };

    // Close modal on Escape key
    useEffect(() => {
        if (!showModal) return;
        const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setShowModal(false); };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [showModal]);

    return (
        <>
            {/* In-app Report Modal */}
            {showModal && (
                <div
                    onClick={() => setShowModal(false)}
                    style={{ position: "fixed", inset: 0, background: "rgba(15,28,63,0.55)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
                >
                    <div
                        onClick={e => e.stopPropagation()}
                        style={{ background: T.surface, borderRadius: 16, width: "100%", maxWidth: 760, maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 8px 40px rgba(15,28,63,0.25)", overflow: "hidden" }}
                    >
                        {/* Modal header */}
                        <div style={{ background: "linear-gradient(135deg,#1A3A6B,#0F2347)", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <span style={{ fontSize: 18 }}>⚖️</span>
                                <div>
                                    <div style={{ fontSize: 12, fontWeight: 800, color: "#C9A84C", letterSpacing: 1 }}>IN THE SUPREME COURT OF INDIA</div>
                                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)" }}>Office Report — Case Preparation Document</div>
                                </div>
                                {loading && <span style={{ marginLeft: 8, fontSize: 11, color: "rgba(255,255,255,0.6)" }}>⏳ Enhancing…</span>}
                                {!loading && generated && (
                                    <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: apiEnhanced ? "#6EE7B7" : "#FCD34D", background: "rgba(255,255,255,0.12)", padding: "2px 7px", borderRadius: 4 }}>
                                        {apiEnhanced ? "API + LOCAL" : "LOCAL DRAFT"}
                                    </span>
                                )}
                            </div>
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <button onClick={copyReport} style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.25)", background: "rgba(255,255,255,0.1)", color: copied ? "#6EE7B7" : "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                                    {copied ? "✓ Copied" : "📋 Copy"}
                                </button>
                                <button onClick={openPrintWindow} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "#C9A84C", color: "#1A3A6B", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                                    🖨 Print / PDF
                                </button>
                                <button onClick={() => { generateReport(true, false); }} disabled={loading} style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.25)", background: "transparent", color: "rgba(255,255,255,0.8)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                                    ↺
                                </button>
                                <button onClick={() => setShowModal(false)} style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.25)", background: "rgba(255,255,255,0.1)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", lineHeight: 1 }}>
                                    ✕
                                </button>
                            </div>
                        </div>
                        {/* Report content — SC-styled HTML */}
                        <div className="sc-watermark-container" style={{ overflowY: "auto", background: T.bg, flex: 1, padding: "20px 28px" }}>
                            <style>{`
                                .sc-modal-report { font-family: 'Times New Roman', Times, serif; font-size: 12.5pt; line-height: 1.9; color: #1a1a1a; }
                                .sc-modal-report .sc-center { text-align: center; margin: 3px 0; }
                                .sc-modal-report .sc-bold { font-weight: bold; }
                                .sc-modal-report .sc-italic { font-style: italic; }
                                .sc-modal-report .sc-underline { text-decoration: underline; }
                                .sc-modal-report .sc-title { font-size: 13.5pt; letter-spacing: 1px; margin: 10px 0; }
                                .sc-modal-report .sc-body { text-align: justify; margin: 8px 0; }
                                .sc-modal-report .sc-para { text-align: justify; margin: 8px 0; padding-left: 28px; text-indent: -28px; }
                                .sc-modal-report .sc-para-no { font-weight: bold; display: inline-block; width: 28px; }
                                .sc-modal-report .sc-gap { height: 14px; }
                                .sc-modal-report .sc-gap-sm { height: 6px; }
                                .sc-modal-report .sc-parties { width: 100%; border: none; border-collapse: collapse; margin: 8px 0; }
                                .sc-modal-report .sc-party-name { font-weight: bold; font-size: 11.5pt; width: 78%; vertical-align: top; padding: 3px 0; }
                                .sc-modal-report .sc-party-role { font-style: italic; text-align: right; vertical-align: top; padding: 3px 0; white-space: nowrap; }
                                .sc-modal-report .sc-versus { text-align: center; font-weight: bold; letter-spacing: 2px; padding: 4px 0; }
                                .sc-modal-report .sc-table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; font-size: 11pt; }
                                .sc-modal-report .sc-table th { border: 1px solid #555; padding: 5px 8px; font-weight: bold; text-align: left; background: rgba(26,58,107,0.08); }
                                .sc-modal-report .sc-table td { border: 1px solid #aaa; padding: 5px 8px; vertical-align: top; }
                                .sc-modal-report .sc-sig { width: 100%; margin-top: 30px; }
                                .sc-modal-report .sc-sig-date { font-style: italic; font-size: 11pt; }
                                .sc-modal-report .sc-sig-name { text-align: right; font-weight: bold; font-size: 12pt; }
                                .sc-modal-report .sc-draft-banner { margin-top: 20px; padding: 8px 14px; border: 2px dashed #B45309; background: #FFFBEB; color: #92400E; font-size: 10pt; text-align: center; border-radius: 4px; }
                                .sc-watermark-container { position: relative; }
                                .sc-watermark-container::before { content: 'LEX TIGRESS OFFICE REPORT'; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-35deg); font-size: 72px; font-weight: 900; color: rgba(0, 0, 0, 0.04); white-space: nowrap; pointer-events: none; z-index: 0; letter-spacing: 4px; font-family: 'Times New Roman', Times, serif; user-select: none; }
                            `}</style>
                            <div
                                className="sc-modal-report"
                                dangerouslySetInnerHTML={{ __html: (() => {
                                    try {
                                        return renderOfficeReportHtml(buildOfficeReportData(selected, null)) +
                                            (aiPrediction
                                                ? aiPrediction
                                                : generatingPrediction
                                                    ? '<div style="text-align:center; padding: 24px; font-family: Times New Roman, serif; color: #666; font-style: italic;">⏳ Generating AI analysis...</div>'
                                                    : '');
                                    } catch { return `<pre style="white-space:pre-wrap;font-family:monospace">${reportText}</pre>`; }
                                })() }}
                            />
                        </div>
                        {/* Footer */}
                        <div style={{ padding: "8px 20px", borderTop: `1px solid ${T.borderSoft}`, background: T.surface, flexShrink: 0 }}>
                            <span style={{ fontSize: 11, color: T.textMuted, fontStyle: "italic" }}>
                                {apiEnhanced ? "Enhanced with SC API data" : "⚠ Draft — generated from local case data. Not an official SC document."}
                            </span>
                        </div>
                    </div>
                </div>
            )}

            {/* Section card (always compact) */}
            <div style={{ background: T.bg, borderRadius: 12, border: `1px solid ${T.border}`, padding: "14px 16px", boxShadow: "0 1px 4px rgba(15,28,63,0.08)", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <SectionIconBox icon="📋" />
                        <div>
                            <div style={{ fontSize: 13, fontWeight: 800, color: T.text, letterSpacing: 0.8, marginBottom: 2, display: "flex", alignItems: "center", gap: 6 }}>
                                LEX-OFFICE REPORT
                                {generated && (
                                    <span style={{ fontSize: 10, fontWeight: 700, color: apiEnhanced ? "#047857" : "#B45309", background: apiEnhanced ? "#D1FAE5" : "#FEF3C7", padding: "2px 6px", borderRadius: 3 }}>
                                        {apiEnhanced ? "API + LOCAL" : "LOCAL DRAFT"}
                                    </span>
                                )}
                            </div>
                            <div style={{ fontSize: 13, color: T.textMuted }}>
                                {loading ? "⏳ Enhancing with SC API data…" : generated ? "Report ready — click to view" : "Builds a court-format office report from case data"}
                            </div>
                        </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button
                            onClick={() => generateReport(!generated, true)}
                            disabled={loading}
                            style={{
                                padding: "6px 14px", borderRadius: 7, border: "none",
                                background: loading ? "#94A3B8" : "linear-gradient(135deg,#C9A84C,#9B7B28)",
                                color: "#fff", fontSize: 12, fontWeight: 700,
                                cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1
                            }}
                        >
                            {loading ? "⏳ Generating…" : generated ? "↺ Refresh" : "📋 Generate"}
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}

// ── LAST ORDERS SECTION ────────────────────────────────────────────────────
// LAST ORDERS
// Data priority: eCourts API → local case data (fallback)
// API fields to map: orderDate/order_date, judges/coram,
// iaNumbers/ia_numbers, petitionerAdvocate, respondentAdvocate
// When API plan is active, verify field names from console log
// and update the API override block in the useEffect above
export function LastOrdersSection({ selected, fetchTrigger = 0 }: { selected: any; fetchTrigger?: number }) {
    const { T } = useApp();
    const [open, setOpen] = useState(false);
    const [orderData, setOrderData] = useState<any>(null);
    const [dataSource, setDataSource] = useState<'api' | 'local'>('local');
    const [fetched, setFetched] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [orderLinks, setOrderLinks] = useState<{ date: string; label: string; url: string; proxyUrl: string }[]>([]);
    const [activePdf, setActivePdf] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const loadingRef = useRef(false); // avoids stale closure bug in useEffect
    const [showOrdersModal, setShowOrdersModal] = useState(false);

    const diaryNo = selected?.diaryNo || selected?.diaryNumber || selected?.diary_no;
    const diaryYear = selected?.diaryYear || selected?.year || selected?.diary_year;

    // Check cache status for badge display (no fetch)
    const hasOrdersCached = selected?.cnrNumber ? isCached('lastOrders', selected.cnrNumber) : false;

    const loadLastOrders = async () => {
        if (loadingRef.current) return;
        loadingRef.current = true;
        setLoading(true);
        setFetchError(null);


        // Try 1: eCourts API — get judgmentOrders list and build PDF links via /ecourts-pdf proxy
        if (selected?.cnrNumber) {
            const data = await fetchWithTimeout(() => fetchLastOrders(selected.cnrNumber), 8000);
            if (data) {
                const arr = Array.isArray(data) ? data : [data];
                setOrderData(arr);
                setDataSource('api');
                // Build PDF links using /ecourts-pdf proxy (handles binary PDF responses)
                // eCourts judgmentOrders items carry a filename field — try common field names
                const links = arr
                    .map((o: any, i: number) => {
                        const filename = o.filename || o.orderFileName || o.orderFilename
                            || o.documentFileName || o.file_name || o.orderNo || '';
                        if (!filename) return null;
                        const proxyUrl = `${_scBackend}/ecourts-pdf/api/partner/case/${selected.cnrNumber}/order/${filename}`;
                        const rawDate = o.orderDate || o.date || o.judgmentDate || `Order ${i + 1}`;
                        const orderType = o.orderType || o.type || o.orderCategory
                            || (String(filename).toLowerCase().includes('rop') ? 'ROP' : 'Order');
                        return { date: rawDate, label: orderType, url: proxyUrl, proxyUrl };
                    })
                    .filter((l): l is { date: string; label: string; url: string; proxyUrl: string } => l !== null);

                if (links.length > 0) {
                    setOrderLinks(links);
                    setActivePdf(links[0].proxyUrl);
                    setFetched(true);
                    loadingRef.current = false;
                    setLoading(false);
                    return; // PDF links found — skip SC website fallback
                }
            }
        }

        // Try 2: SC website judgement_orders tab — capture ALL order links
        if (diaryNo && diaryYear) {
            try {
                const url = `${SC_BASE}/wp-admin/admin-ajax.php?diary_no=${diaryNo}&diary_year=${diaryYear}&tab_name=judgement_orders&action=get_case_details&es_ajax_request=1&language=en`;
                const res = await fetchWithTimeout(
                    () => fetch(url).then(r => {
                        if (!r.ok) throw new Error(`SC site returned ${r.status}`);
                        return r.json();
                    }),
                    10000
                );
                if (!res) {
                    setFetchError('SC website request failed or timed out');
                    setFetched(true); loadingRef.current = false; setLoading(false); return;
                }
                if (res && 'error' in res) {
                    setFetchError(`SC error: ${res.message || res.error}`);
                    setFetched(true); loadingRef.current = false; setLoading(false); return;
                }
                const html = typeof res?.data === 'string' ? res.data : '';
                if (html) {
                    const doc = new DOMParser().parseFromString(html, 'text/html');

                    // Capture all anchor tags with valid hrefs — not just api.sci.gov.in
                    const allLinks = Array.from(doc.querySelectorAll('a[href]'))
                        .map(a => {
                            const rawHref = (a as HTMLAnchorElement).getAttribute('href') || '';
                            if (!rawHref || rawHref === '#') return null;
                            let fullUrl = rawHref;
                            try { fullUrl = new URL(rawHref, 'https://www.sci.gov.in').href; } catch { return null; }

                            // Map known SC domains to proxy prefixes (www. must come before plain sci.)
                            let proxyUrl = fullUrl;
                            if (fullUrl.includes('api.sci.gov.in')) {
                                proxyUrl = fullUrl.replace('https://api.sci.gov.in', `${_scBackend}/sci-report`);
                            } else if (fullUrl.includes('www.sci.gov.in')) {
                                proxyUrl = fullUrl.replace('https://www.sci.gov.in', `${_scBackend}/sci-causelist`);
                            } else if (fullUrl.includes('sci.gov.in')) {
                                proxyUrl = fullUrl.replace('https://sci.gov.in', `${_scBackend}/sci-causelist`);
                            }

                            // Extract date from link text — remove "[ROP - of Main Case]" type suffixes
                            const rawText = a.textContent?.trim() || '';
                            const dateMatch = rawText.match(/\d{2}-\d{2}-\d{4}/);
                            const label = a.closest('td,li,div')?.textContent?.replace(rawText, '').trim() || '';
                            const orderType = label.replace(/[\[\]]/g, '').trim() ||
                                (fullUrl.toLowerCase().includes('rop') ? 'ROP' :
                                 fullUrl.toLowerCase().includes('order') ? 'Order' : '');

                            return {
                                date: dateMatch ? dateMatch[0] : rawText,
                                label: orderType,
                                url: fullUrl,
                                proxyUrl,
                            };
                        })
                        .filter((l): l is { date: string; label: string; url: string; proxyUrl: string } =>
                            l !== null && l.date.length > 0
                        );

                    if (allLinks.length > 0) {
                        setOrderLinks(allLinks);
                        setActivePdf(allLinks[0].proxyUrl);
                        setFetched(true);
                        loadingRef.current = false;
                        setLoading(false);
                        return;
                    }
                }
            } catch (e: any) {
                setFetchError(e?.message || 'Network error — check if backend is running');
            }
        } else if (!selected?.cnrNumber) {
            setFetchError('No diary number or CNR — cannot fetch orders');
        }

        setDataSource('local');
        setFetched(true);
        loadingRef.current = false;
        setLoading(false);
    };

    // Reset state and auto-load when case changes
    useEffect(() => {
        setOpen(false);
        setOrderData(null);
        setOrderLinks([]);
        setActivePdf(null);
        setDataSource('local');
        setFetched(false);
        setFetchError(null);
        loadingRef.current = false; // reset immediately (avoids stale closure blocking next load)
        setLoading(false);
        setShowOrdersModal(false);

        // Auto-load if diary number available, eCourts cached, or any CNR
        const hasDiary = !!(diaryNo && diaryYear);
        const hasCached = selected?.cnrNumber ? isCached('lastOrders', selected.cnrNumber) : false;
        if (hasDiary || hasCached || !!selected?.cnrNumber) {
            loadLastOrders();
        }
    }, [selected?.id]);

    // "Fetch All" trigger
    useEffect(() => {
        if (fetchTrigger > 0 && !loadingRef.current) loadLastOrders();
    }, [fetchTrigger]);

    // Escape key closes orders modal
    useEffect(() => {
        if (!showOrdersModal) return;
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowOrdersModal(false); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [showOrdersModal]);

    // Build display data from the right source
    const parsed = parseListingData(selected);

    // These get overridden by API data if available
    let displayOrderDate = parsed.orderDate || parsed.lastListedDate || null;
    let displayJudges = parsed.judges || [];
    let displayIANumbers = parsed.iaNumbers || [];
    // petitionerAdvocates/respondentAdvocates can be an array or string — normalise to string
    const advToStr = (adv: any): string => {
        if (!adv) return '';
        if (Array.isArray(adv)) return adv.join(', ');
        return String(adv);
    };
    let displayPetitionerAdvocate = advToStr(selected.petitionerAdvocates);
    let displayRespondentAdvocate = advToStr(selected.respondentAdvocates);

    // Override with API data if we got it (orderData may be an array)
    if (dataSource === 'api' && orderData) {
        const firstOrder = Array.isArray(orderData) ? orderData[0] : orderData;
        if (firstOrder) {
            displayOrderDate = firstOrder.orderDate || firstOrder.order_date || firstOrder.date || displayOrderDate;
            displayJudges = firstOrder.judges || firstOrder.coram || displayJudges;
            displayIANumbers = firstOrder.iaNumbers || firstOrder.ia_numbers || displayIANumbers;
            displayPetitionerAdvocate = firstOrder.petitionerAdvocate || firstOrder.petitioner_advocate || displayPetitionerAdvocate;
            displayRespondentAdvocate = firstOrder.respondentAdvocate || firstOrder.respondent_advocate || displayRespondentAdvocate;
        }
    }

    // Format advocates (strip "1 " prefix and title case)
    const formatAdvocate = (adv: string) => {
        if (!adv) return '';
        return adv.replace(/^1\s+/, '').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    };

    const hasLocalData = displayOrderDate || displayJudges.length > 0 || displayIANumbers.length > 0 || displayPetitionerAdvocate || displayRespondentAdvocate;

    return (
        <>
        {/* Last Orders Modal */}
        {showOrdersModal && orderLinks.length > 0 && (
            <div
                onClick={() => setShowOrdersModal(false)}
                style={{ position: 'fixed', inset: 0, background: 'rgba(15,28,63,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
            >
                <div
                    onClick={e => e.stopPropagation()}
                    style={{ background: T.surface, borderRadius: 16, width: '100%', maxWidth: 960, height: '95vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(15,28,63,0.25)', overflow: 'hidden' }}
                >
                    {/* Modal header */}
                    <div style={{ background: 'linear-gradient(135deg,#1A3A6B,#0F2347)', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 18 }}>⚖️</span>
                            <div>
                                <div style={{ fontSize: 12, fontWeight: 800, color: '#C9A84C', letterSpacing: 1 }}>SUPREME COURT OF INDIA</div>
                                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>
                                    Last Orders — {orderLinks.length} order{orderLinks.length > 1 ? 's' : ''}
                                </div>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <a
                                href={orderLinks.find(o => o.proxyUrl === activePdf)?.url || orderLinks[0].url}
                                target="_blank" rel="noopener noreferrer"
                                style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: '#C9A84C', color: '#1A3A6B', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}
                            >
                                Open ↗
                            </a>
                            <button onClick={() => setShowOrdersModal(false)} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', lineHeight: 1 }}>
                                ✕
                            </button>
                        </div>
                    </div>
                    {/* Order date pills */}
                    <div style={{ padding: '8px 16px', display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: `1px solid ${T.borderSoft}`, flexShrink: 0, background: T.bg }}>
                        {orderLinks.map((o, i) => (
                            <button
                                key={i}
                                onClick={() => setActivePdf(o.proxyUrl)}
                                style={{
                                    padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                                    border: `1px solid ${activePdf === o.proxyUrl ? '#2A7BD4' : T.border}`,
                                    background: activePdf === o.proxyUrl ? '#EFF6FF' : T.surface,
                                    color: activePdf === o.proxyUrl ? '#2A7BD4' : T.text,
                                    cursor: 'pointer'
                                }}
                            >
                                {o.date || `Order ${i + 1}`}{o.label ? ` · ${o.label}` : ''}
                            </button>
                        ))}
                    </div>
                    {/* PDF — fills all remaining height */}
                    <div style={{ flex: 1, minHeight: 0 }}>
                        {activePdf && (
                            <iframe src={activePdf} style={{ width: '100%', height: '100%', border: 'none', display: 'block' }} title="Order PDF" />
                        )}
                    </div>
                </div>
            </div>
        )}

        <div style={{ background: T.bg, borderRadius: 12, border: `1px solid ${T.border}`, padding: "14px 16px", boxShadow: "0 1px 4px rgba(15,28,63,0.08)", marginBottom: 10 }}>
            <div onClick={() => setOpen(o => !o)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: open ? 8 : 0, cursor: "pointer", userSelect: "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                    <SectionIconBox icon="⚖️" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: T.text, letterSpacing: 0.8, marginBottom: 3 }}>LAST ORDERS</div>
                        <div style={{ fontSize: 13, color: fetchError ? '#DC2626' : T.textMuted, display: 'flex', alignItems: 'center', gap: 8 }}>
                            {loading ? 'Fetching orders...' : fetchError ? fetchError : orderLinks.length > 0 ? `${orderLinks.length} order${orderLinks.length > 1 ? 's' : ''} found` : hasLocalData ? "Order information" : "Click to load orders"}
                            {hasOrdersCached && (
                                <span style={{ fontSize: 10, fontWeight: 700, background: '#D1FAE5', color: '#047857', padding: '1px 6px', borderRadius: 3 }}>CACHED</span>
                            )}
                        </div>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {orderLinks.length > 0 ? (
                        <button
                            onClick={e => { e.stopPropagation(); setShowOrdersModal(true); }}
                            style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: 'linear-gradient(135deg,#1A3A6B,#0F2347)', color: '#C9A84C', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                        >
                            📄 View Orders
                        </button>
                    ) : (
                        <button
                            onClick={e => { e.stopPropagation(); loadLastOrders(); }}
                            disabled={loading}
                            style={{
                                padding: '6px 14px', borderRadius: 7, border: 'none',
                                background: loading ? '#94A3B8' : 'linear-gradient(135deg,#C9A84C,#9B7B28)',
                                color: "#fff", fontSize: 12, fontWeight: 700,
                                cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1
                            }}
                        >
                            {loading ? "Loading..." : hasOrdersCached ? "Load (cached)" : "Load Orders"}
                        </button>
                    )}
                    {fetched && orderLinks.length > 0 && (
                        <button
                            onClick={e => { e.stopPropagation(); loadLastOrders(); }}
                            disabled={loading}
                            style={{ padding: '6px 10px', borderRadius: 7, border: `1px solid ${T.border}`, background: 'transparent', color: T.textMuted, fontSize: 12, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}
                        >
                            ↻
                        </button>
                    )}
                    <span style={{ fontSize: 11, color: T.textMuted, display: "inline-block", transform: open ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.2s" }}>▼</span>
                </div>
            </div>

            {open && <>{/* All orders from eCourts API when no SC website links */}
            {!orderLinks.length && Array.isArray(orderData) && orderData.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, letterSpacing: 0.8, marginBottom: 8, textTransform: 'uppercase' }}>
                        Orders from eCourts ({orderData.length})
                    </div>
                    {orderData.map((order: any, idx: number) => {
                        const oDate = order.orderDate || order.order_date || order.date || '';
                        const oJudges: string[] = order.judges || order.coram || [];
                        const oType = order.orderType || order.type || order.purposeOfHearing || order.purpose || '';
                        return (
                            <div key={idx} style={{ background: T.surface, borderRadius: 9, border: `1px solid ${T.borderSoft}`, padding: '10px 14px', marginBottom: 8 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: oJudges.length || oType ? 6 : 0 }}>
                                    <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{oDate ? formatDateForDisplay(oDate) : `Order ${idx + 1}`}</div>
                                    {oType && <span style={{ fontSize: 11, fontWeight: 600, background: '#EFF6FF', color: '#1E40AF', padding: '2px 7px', borderRadius: 4 }}>{oType}</span>}
                                </div>
                                {Array.isArray(oJudges) && oJudges.length > 0 && (
                                    <div style={{ fontSize: 12, color: T.textMuted }}>{oJudges.join(' · ')}</div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {hasLocalData ? (
                <div style={{ background: T.surface, borderRadius: 9, border: `1px solid ${T.borderSoft}`, padding: "14px" }}>
                    {/* Order date */}
                    {displayOrderDate && (
                        <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 10 }}>
                            Order dated {formatDateForDisplay(displayOrderDate)}
                        </div>
                    )}

                    {/* CORAM section */}
                    {displayJudges.length > 0 && (
                        <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, letterSpacing: 0.8, marginBottom: 6, textTransform: 'uppercase' }}>CORAM</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                {displayJudges.map((judge: string, idx: number) => (
                                    <div key={idx} style={{ fontSize: 13, color: T.text }}>{judge}</div>
                                ))}
                            </div>
                        </div>
                    )}
                    {displayJudges.length === 0 && (
                        <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 12 }}>
                            Coram not available
                        </div>
                    )}

                    {/* IA Numbers section */}
                    {displayIANumbers.length > 0 && (
                        <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, letterSpacing: 0.8, marginBottom: 6, textTransform: 'uppercase' }}>IAs IN THIS ORDER</div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {displayIANumbers.map((ia: string, idx: number) => (
                                    <div key={idx} style={{
                                        fontSize: 12, fontWeight: 600,
                                        background: '#F3F4F6', color: '#374151',
                                        padding: '3px 8px', borderRadius: 4
                                    }}>
                                        {ia}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Advocates section */}
                    {(displayPetitionerAdvocate || displayRespondentAdvocate) && (
                        <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, letterSpacing: 0.8, marginBottom: 6, textTransform: 'uppercase' }}>ADVOCATES</div>
                            {displayPetitionerAdvocate && (
                                <div style={{ fontSize: 13, color: T.text, marginBottom: 3 }}>
                                    <strong>Petitioner:</strong> {formatAdvocate(displayPetitionerAdvocate)}
                                </div>
                            )}
                            {displayRespondentAdvocate && (
                                <div style={{ fontSize: 13, color: T.text }}>
                                    <strong>Respondent:</strong> {formatAdvocate(displayRespondentAdvocate)}
                                </div>
                            )}
                        </div>
                    )}

                </div>
            ) : (
                <div style={{ padding: "14px", color: T.textMuted, fontSize: 13, textAlign: "center" }}>
                    No orders on record
                </div>
            )}
            </>}
        </div>
        </>
    );
}
