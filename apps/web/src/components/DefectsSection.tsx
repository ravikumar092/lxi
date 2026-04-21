import React, { useState } from "react";
import { useApp } from "../AppContext";
import { SectionCard } from "../caseHelpers";
import { DocDefect, DefectStatus } from "../types";

function getTimeToResolveMessage(createdAt: string, resolvedAt?: string) {
    if (!resolvedAt) return null;
    const diffMs = new Date(resolvedAt).getTime() - new Date(createdAt).getTime();
    if (diffMs < 0) return null;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${diffMins} mins`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hrs`;
    return `${Math.floor(diffHours / 24)} days`;
}

export function DefectsSection({ selected, onUpdate }: { selected: any; onUpdate: (c: any) => void }) {
    const { T } = useApp();
    const [activeTab, setActiveTab] = useState<"Active" | "Resolved" | "Suggested Fixes">("Active");
    const [showForm, setShowForm] = useState(false);
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    const [viewingPdfFor, setViewingPdfFor] = useState<string | null>(null);
    const [toastMessage, setToastMessage] = useState("");

    const [form, setForm] = useState({ title: "", description: "", source: "Manual", status: "Pending", pageNumber: "", ruleViolated: "" });

    const defects: DocDefect[] = selected.defects || [];
    const activeDefects = defects.filter(d => d.status !== "Resolved");
    const resolvedDefects = defects.filter(d => d.status === "Resolved");
    const fixes = activeDefects.filter(d => d.cureSteps || d.draftTemplate);

    let displayList = activeTab === "Active" ? activeDefects : activeTab === "Resolved" ? resolvedDefects : fixes;

    function addDefect() {
        if (!form.title) return;
        const newD: DocDefect = {
            id: "d" + Date.now(),
            caseId: selected.id,
            defectTitle: form.title,
            description: form.description,
            source: form.source as any,
            status: form.status as any,
            pageNumber: form.pageNumber,
            ruleViolated: form.ruleViolated,
            createdAt: new Date().toISOString()
        };
        onUpdate({ ...selected, defects: [newD, ...defects] });
        setShowForm(false);
        setForm({ title: "", description: "", source: "Manual", status: "Pending", pageNumber: "", ruleViolated: "" });
    }

    function toggleExpand(id: string) {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    function updateStatus(id: string, st: DefectStatus) {
        onUpdate({
            ...selected,
            defects: defects.map(d => d.id === id ? { ...d, status: st, resolvedAt: st === "Resolved" ? new Date().toISOString() : d.resolvedAt } : d)
        });
    }

    function createTaskFromDefect(d: DocDefect) {
        const newTask = {
            id: "t" + Date.now(),
            text: `Fix Defect: ${d.defectTitle}`,
            deadline: new Date(Date.now() + 86400000).toISOString(),
            assignee: d.assignedTo || "Junior",
            urgency: "High",
            party: selected.partyType,
            done: false,
            createdAt: new Date().toISOString()
        };
        const tasks = selected.tasks ? [newTask, ...selected.tasks] : [newTask];
        onUpdate({ ...selected, tasks });
        
        // Simulate Notification Service WhatsApp Trigger
        setToastMessage(`Task created & WhatsApp alert sent to ${newTask.assignee}!`);
        setTimeout(() => setToastMessage(""), 4000);
    }

    const getBadgeStyle = (source: string) => {
        if (source === "SC Registry") return { bg: "#FEF2F2", color: "#991B1B", border: "#FECACA" };
        if (source === "AI") return { bg: "#F3E8FF", color: "#6B21A8", border: "#E9D5FF" };
        return { bg: "#EFF6FF", color: "#1E40AF", border: "#BFDBFE" };
    };

    return (
        <SectionCard icon="⚠️" title="DEFECTS & RECTIFICATION" count={defects.length ? `${activeDefects.length} Active` : "None"} onAdd={() => setShowForm(s => !s)} addLabel={showForm ? "✕ Cancel" : "+ Add Defect"}>
            
            {/* Toast Notification Simulation */}
            {toastMessage && (
                <div style={{ position: "fixed", bottom: 20, right: 20, background: "#10B981", color: "#fff", padding: "12px 20px", borderRadius: 8, boxShadow: "0 4px 6px rgba(0,0,0,0.1)", zIndex: 9999, fontWeight: "bold", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
                    <span>📱</span> {toastMessage}
                </div>
            )}

            {/* Learning Engine Insight Banner */}
            {activeDefects.length > 0 && (
                <div style={{ background: "#FEF3C7", border: "1px solid #F59E0B", borderRadius: 8, padding: "12px", marginBottom: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#92400E", fontWeight: 700, fontSize: 12, marginBottom: 4 }}>
                        <span>🧠</span> LEARNING ENGINE WARNING
                    </div>
                    <p style={{ margin: 0, fontSize: 13, color: "#B45309", lineHeight: 1.4 }}>
                        The defect <strong>"{activeDefects[0].defectTitle}"</strong> occurred in your last 2 filings. Ensure strict correction before regenerating the document to avoid Registry rejection.
                    </p>
                </div>
            )}

            {/* Custom Tab Bar */}
            <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
                {(["Active", "Suggested Fixes", "Resolved"] as const).map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        style={{
                            padding: "6px 14px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
                            background: activeTab === tab ? "linear-gradient(135deg,#1A2E5E,#2A4B9B)" : T.surface,
                            color: activeTab === tab ? "#C9A84C" : T.textMuted,
                            border: activeTab === tab ? "none" : `1px solid ${T.borderSoft}`,
                            transition: "all 0.15s"
                        }}
                    >
                        {tab} ({tab === "Active" ? activeDefects.length : tab === "Resolved" ? resolvedDefects.length : fixes.length})
                    </button>
                ))}
            </div>

            {showForm && (
                <div style={{ background: T.surface, borderRadius: 9, border: `1px solid border`, padding: "12px", marginBottom: 16 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                        <input placeholder="Defect Title…" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} style={{ padding: "7px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.bg, color: T.text }} />
                        <select value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} style={{ padding: "7px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.bg, color: T.text }}>
                            <option>Manual</option>
                            <option>AI</option>
                            <option>SC Registry</option>
                        </select>
                        <input placeholder="Rule Violated (e.g. Order IV Rule 5)" value={form.ruleViolated} onChange={e => setForm({ ...form, ruleViolated: e.target.value })} style={{ padding: "7px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.bg, color: T.text }} />
                        <input placeholder="Page Number" value={form.pageNumber} onChange={e => setForm({ ...form, pageNumber: e.target.value })} style={{ padding: "7px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.bg, color: T.text }} />
                    </div>
                    <textarea placeholder="Description…" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} style={{ width: "100%", padding: "7px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.bg, color: T.text, marginBottom: 8 }} />
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button onClick={addDefect} style={{ padding: "6px 14px", background: "linear-gradient(135deg,#C9A84C,#9B7B28)", color: "#fff", border: "none", borderRadius: 6, fontWeight: "bold", cursor: "pointer" }}>Add Defect</button>
                    </div>
                </div>
            )}

            {displayList.length === 0 && (
                <div style={{ textAlign: "center", padding: "20px 0", color: T.textMuted, fontSize: 13 }}>
                    No defects found in {activeTab}.
                </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {displayList.map(d => {
                    const expanded = expandedIds.has(d.id);
                    const bs = getBadgeStyle(d.source);
                    return (
                        <div key={d.id} style={{ border: `1px solid ${T.borderSoft}`, borderRadius: 10, overflow: "hidden", background: d.status === "Resolved" ? `${T.surface}80` : T.surface }}>
                            <div style={{ padding: "12px 14px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                                <div style={{ flex: 1 }}>
                                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                                        <span style={{ padding: "2px 8px", borderRadius: 12, fontSize: 10, fontWeight: 800, background: bs.bg, color: bs.color, border: `1px solid ${bs.border}` }}>
                                            {d.source.toUpperCase()}
                                        </span>
                                        {d.pageNumber && (
                                            <span style={{ fontSize: 11, color: T.textMuted }}>Page {d.pageNumber} {d.paragraphReference && `· Para ${d.paragraphReference}`}</span>
                                        )}
                                        {d.ruleViolated && (
                                            <span style={{ fontSize: 11, color: "#B45309", background: "#FEF3C7", padding: "1px 6px", borderRadius: 4 }}>Rule: {d.ruleViolated}</span>
                                        )}
                                        {d.status === "Resolved" && d.createdAt && d.resolvedAt && (
                                            <span style={{ fontSize: 11, color: "#065F46", background: "#D1FAE5", padding: "1px 6px", borderRadius: 4 }}>
                                                Time taken: {getTimeToResolveMessage(d.createdAt, d.resolvedAt)}
                                            </span>
                                        )}
                                    </div>
                                    <h4 style={{ margin: 0, fontSize: 14, color: T.text, fontWeight: 700 }}>{d.defectTitle}</h4>
                                    {d.description && <p style={{ margin: "4px 0 0", fontSize: 13, color: T.textMuted, lineHeight: 1.4 }}>{d.description}</p>}
                                </div>
                                
                                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                                    <button onClick={() => toggleExpand(d.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#2A7BD4", fontSize: 12, fontWeight: "bold" }}>
                                        {expanded ? "Collapse ▲" : "Details ▼"}
                                    </button>
                                </div>
                            </div>

                            {/* Expanded Section */}
                            {expanded && (
                                <div style={{ borderTop: `1px solid ${T.borderSoft}`, background: T.bg, padding: "14px", display: "flex", flexDirection: "column", gap: 14 }}>
                                    
                                    {/* Action row */}
                                    <div style={{ display: "flex", gap: 8 }}>
                                        {d.status !== "Resolved" && <button onClick={() => updateStatus(d.id, "Resolved")} style={{ padding: "6px 12px", background: "#E0F2FE", color: "#0284C7", border: "1px solid #BAE6FD", borderRadius: 6, fontSize: 12, fontWeight: "bold", cursor: "pointer" }}>✓ Mark Resolved</button>}
                                        {d.status !== "In Progress" && d.status !== "Resolved" && <button onClick={() => updateStatus(d.id, "In Progress")} style={{ padding: "6px 12px", background: "#FEF9C3", color: "#A16207", border: "1px solid #FEF08A", borderRadius: 6, fontSize: 12, fontWeight: "bold", cursor: "pointer" }}>⌛ Mark In Progress</button>}
                                        <button onClick={() => createTaskFromDefect(d)} style={{ padding: "6px 12px", background: T.surface, color: T.text, border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 12, fontWeight: "bold", cursor: "pointer" }}>+ Create Task</button>
                                        <button onClick={() => setViewingPdfFor(viewingPdfFor === d.id ? null : d.id)} style={{ padding: "6px 12px", background: "#F3F4F6", color: "#374151", border: "1px solid #D1D5DB", borderRadius: 6, fontSize: 12, fontWeight: "bold", cursor: "pointer", marginLeft: "auto" }}>
                                            {viewingPdfFor === d.id ? "Close PDF" : "📄 View in PDF"}
                                        </button>
                                    </div>

                                    {/* PDF Viewer Inline */}
                                    {viewingPdfFor === d.id && (
                                        <div style={{ height: 400, border: `1px solid ${T.borderSoft}`, borderRadius: 8, overflow: "hidden", background: "#ccc" }}>
                                            <div style={{ padding: 8, background: "#1F2937", color: "#fff", fontSize: 12, fontWeight: "bold", display: "flex", justifyContent: "space-between" }}>
                                                <span>Navigating to Page {d.pageNumber || 1}...</span>
                                            </div>
                                            <iframe src={`https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf#page=${d.pageNumber || 1}`} style={{ width: "100%", height: "100%", border: "none" }} />
                                        </div>
                                    )}

                                    {/* Cure Suggestion Engine */}
                                    {(d.cureSteps || d.draftTemplate || d.sampleText) && (
                                        <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, padding: "12px", marginTop: 4 }}>
                                            <div style={{ fontSize: 11, fontWeight: 800, color: "#1E293B", letterSpacing: 0.5, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                                                <span>💡</span> CURE SUGGESTIONS
                                            </div>
                                            
                                            {d.cureSteps && (
                                                <div style={{ marginBottom: 12 }}>
                                                    <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 4 }}>Steps to Fix:</div>
                                                    <p style={{ margin: 0, fontSize: 13, color: "#334155", whiteSpace: "pre-line", lineHeight: 1.5 }}>{d.cureSteps}</p>
                                                </div>
                                            )}
                                            
                                            {d.draftTemplate && (
                                                <div>
                                                    <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 4 }}>Draft Template:</div>
                                                    <div style={{ background: "#F1F5F9", padding: "10px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: 13, fontFamily: "monospace", color: "#0F172A", whiteSpace: "pre-wrap" }}>
                                                        {d.draftTemplate}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </SectionCard>
    );
}
