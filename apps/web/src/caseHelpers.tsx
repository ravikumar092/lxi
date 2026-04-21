import React, { useState } from "react";
import { useApp } from "./AppContext";

// ── DATE PARSING HELPERS ───────────────────────────────────────────────────────
export function formatDateForDisplay(raw: string): string {
  if (!raw) return raw
  
  const months = ['Jan','Feb','Mar','Apr','May','Jun',
                  'Jul','Aug','Sep','Oct','Nov','Dec']
  
  // Handle YYYY-MM-DD format (e.g. "2026-02-13")
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) {
    const [, year, month, day] = isoMatch
    return `${parseInt(day)} ${months[parseInt(month)-1]} ${year}`
  }
  
  // Handle DD-MM-YYYY format (e.g. "13-02-2026")
  const dmyMatch = raw.match(/^(\d{2})-(\d{2})-(\d{4})/)
  if (dmyMatch) {
    const [, day, month, year] = dmyMatch
    return `${parseInt(day)} ${months[parseInt(month)-1]} ${year}`
  }
  
  return raw
}

export function parseDMY(dateStr: string): string {
  return formatDateForDisplay(dateStr)
}

export function formatDMY(dateStr: string): string {
  return formatDateForDisplay(dateStr)
}

export function toTitleCase(str: string): string {
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

// ── SHARED LABEL COLORS ───────────────────────────────────────────────────────
export const LABEL_COLORS: Record<string, string> = {
    "Pending/Hearing": "#C9A84C",
    Filing: "#C2185B",
    Disposed: "#1A8C5B",
    Drafting: "#6A1B9A",
    Admin: "#283593",
    Inquiry: "#2A7BD4",
    Urgent: "#C62828",
    "High Priority": "#2E7D32",
};
export const ALL_LABELS = Object.keys(LABEL_COLORS);
export const CASE_TYPES = ["W.P.(C)", "SLP(Crl.)", "CA", "C.A.", "SLP(C)", "OP", "Writ", "MA", "TP"];
export const COURT_NUMBERS = Array.from({ length: 15 }, (_, i) => `Court No. ${i + 1}`);
export const SITTING_TIMES = ["10:30 AM", "11:00 AM", "2:00 PM", "2:30 PM", "3:00 PM", "3:30 PM"];

// ── DATE HELPERS ──────────────────────────────────────────────────────────────
export function fmtDate(str: string | null | undefined): string {
    if (!str) return "—";
    try {
        // Handle DD-MM-YYYY format first (e.g. from SC raw API)
        const dmy = str.match(/^(\d{2})-(\d{2})-(\d{4})/);
        if (dmy) {
            const dt = new Date(parseInt(dmy[3]), parseInt(dmy[2]) - 1, parseInt(dmy[1]));
            if (isNaN(dt.getTime())) return "—";
            return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
        }
        const [y, m, d] = str.split("T")[0].split("-").map(Number);
        if (isNaN(y) || isNaN(m) || isNaN(d)) return "—";
        const dt = new Date(y, m - 1, d);
        if (isNaN(dt.getTime())) return "—";
        return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    } catch { return "—"; }
}

export function fmtDT(str: string | null | undefined): string {
    if (!str) return "—";
    try { return new Date(str).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
    catch { return str; }
}

export function getDaysUntil(dateStr: string | null | undefined): number | null {
    if (!dateStr) return null;
    try {
        const [y, m, d] = dateStr.split("-").map(Number);
        const target = new Date(y, m - 1, d);
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    } catch { return null; }
}

export function hearingLabel(days: number | null): string | null {
    if (days === 0) return "Today";
    if (days === 1) return "Tomorrow";
    if (days != null && days > 1) return `in ${days} days`;
    return null;
}

export function matchesSearch(c: any, q: string): boolean {
    if (!q) return true;
    const lq = q.toLowerCase().trim();
    return (
        (c.displayTitle || "").toLowerCase().includes(lq) ||
        (c.petitioner || "").toLowerCase().includes(lq) ||
        (c.respondent || "").toLowerCase().includes(lq) ||
        (c.petitioners || []).some((p: string) => p.toLowerCase().includes(lq)) ||
        (c.respondents || []).some((r: string) => r.toLowerCase().includes(lq)) ||
        (c.caseNumber || "").toLowerCase().includes(lq) ||
        (c.shortCaseNumber || "").toLowerCase().includes(lq) ||
        (c.caseType || "").toLowerCase().includes(lq) ||
        String(c.diaryNumber || "").includes(lq) ||
        String(c.diaryYear || "").includes(lq) ||
        `${c.diaryNumber || ""}/${c.diaryYear || ""}`.includes(lq) ||
        (c.courtNumber || "").toLowerCase().includes(lq) ||
        (c.labels || []).some((l: string) => l.toLowerCase().includes(lq))
    );
}

export function sortCases(cases: any[], sortBy: string): any[] {
    const arr = [...cases];
    if (sortBy === "hearing" || sortBy === "default") return arr.sort((a, b) => {
        const da = a.likelyListedOn || a.nextHearingDate ? new Date(a.likelyListedOn || a.nextHearingDate) : new Date("9999-01-01");
        const db = b.likelyListedOn || b.nextHearingDate ? new Date(b.likelyListedOn || b.nextHearingDate) : new Date("9999-01-01");
        return da.getTime() - db.getTime();
    });
    if (sortBy === "filing") return arr.sort((a, b) => new Date(b.dateOfFiling).getTime() - new Date(a.dateOfFiling).getTime());
    if (sortBy === "status") { const o: any = { Fresh: 0, Pending: 1, Disposed: 2 }; return arr.sort((a, b) => (o[a.status] ?? 3) - (o[b.status] ?? 3)); }
    if (sortBy === "name") return arr.sort((a, b) => (a.displayTitle || a.petitioners[0] || "").localeCompare(b.displayTitle || b.petitioners[0] || ""));
    return arr;
}

// ── SHARED UI ATOMS ───────────────────────────────────────────────────────────
export function Badge({ text, color }: { text: string; color: string }) {
    return (
        <span style={{ background: `${color}15`, color, fontSize: 13, fontWeight: 700, padding: "3px 10px", borderRadius: 20, border: `1px solid ${color}30`, marginRight: 5, marginBottom: 4, display: "inline-block" }}>
            {text}
        </span>
    );
}

export function DR({ icon, label, children }: { icon: string; label: string; children: React.ReactNode }) {
    const { T } = useApp();
    return (
        <div style={{ marginBottom: 13 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                <span style={{ fontSize: 13, opacity: 0.4 }} aria-hidden="true">{icon}</span>
                <span style={{ color: T.textMuted, fontSize: 11, letterSpacing: 0.9, fontWeight: 700, textTransform: "uppercase" }}>{label}</span>
            </div>
            <div style={{ color: T.text, fontSize: 14.5, paddingLeft: 17, lineHeight: 1.6, fontWeight: 500 }}>{children}</div>
        </div>
    );
}

export function SectionHead({ icon, label }: { icon: string; label: string }) {
    const { T } = useApp();
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, paddingBottom: 9, borderBottom: `1px solid ${T.borderSoft}` }}>
            <div style={{ width: 26, height: 26, borderRadius: 7, background: "linear-gradient(135deg,#1A2E5E,#0F1C3F)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, boxShadow: "0 2px 6px rgba(15,28,63,0.25)" }} aria-hidden="true">{icon}</div>
            <span style={{ color: T.text, fontSize: 15, fontWeight: 700 }}>{label}</span>
        </div>
    );
}

export function SectionIconBox({ icon }: { icon: string }) {
    return (
        <div style={{ width: 32, height: 32, borderRadius: 9, background: "linear-gradient(135deg,#1A2E5E,#0F1C3F)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0, boxShadow: "0 2px 6px rgba(15,28,63,0.2)" }}>
            {icon}
        </div>
    );
}

export function SectionCard({ icon, title, count, onAdd, addLabel, children, extraAction }: {
    icon: string; title: string; count: string; onAdd?: () => void; addLabel?: string; children: React.ReactNode; extraAction?: React.ReactNode;
}) {
    const { T } = useApp();
    const [open, setOpen] = useState(false);
    return (
        <div style={{ background: T.bg, borderRadius: 12, border: `1px solid ${T.border}`, padding: "14px 16px", boxShadow: "0 1px 4px rgba(15,28,63,0.08)", marginBottom: 10 }}>
            <div
                onClick={() => setOpen(o => !o)}
                style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: open ? 8 : 0, cursor: "pointer", userSelect: "none" }}
            >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flex: 1, minWidth: 0 }}>
                    <SectionIconBox icon={icon} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: T.text, letterSpacing: 0.8, marginBottom: 3 }}>{title}</div>
                        <div style={{ fontSize: 14, color: T.textMuted }}>{count}</div>
                    </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    {extraAction && <span onClick={e => { e.stopPropagation(); setOpen(true); }}>{extraAction}</span>}
                    {onAdd && addLabel && (
                        <button onClick={e => { e.stopPropagation(); setOpen(true); onAdd(); }} style={{ fontSize: 13, fontWeight: 700, color: "#2A7BD4", background: "transparent", border: "none", cursor: "pointer", whiteSpace: "nowrap", paddingTop: 2 }}>{addLabel}</button>
                    )}
                    <span style={{ fontSize: 11, color: T.textMuted, display: "inline-block", transform: open ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.2s" }}>▼</span>
                </div>
            </div>
            {open && children}
        </div>
    );
}

export function CaseInfoSection({ icon, title, children, actionLabel, actionUrl, onAction }: {
    icon: string; title: string; children: React.ReactNode; actionLabel?: string; actionUrl?: string; onAction?: () => void;
}) {
    const { T } = useApp();
    return (
        <div style={{ background: T.bg, borderRadius: 12, border: `1px solid ${T.border}`, padding: "14px 16px", boxShadow: "0 1px 4px rgba(15,28,63,0.08)", marginBottom: 10, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flex: 1, minWidth: 0 }}>
                <SectionIconBox icon={icon} />
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: T.text, letterSpacing: 0.8, marginBottom: 5 }}>{title}</div>
                    {children}
                </div>
            </div>
            {actionLabel && (
                onAction ? (
                    <button onClick={onAction} style={{ fontSize: 13, fontWeight: 700, color: "#2A7BD4", whiteSpace: "nowrap", background: "none", border: "none", cursor: "pointer", flexShrink: 0, paddingTop: 2 }}>
                        {actionLabel}
                    </button>
                ) : (
                    <a href={actionUrl || "#"} target={actionUrl && actionUrl !== "#" ? "_blank" : undefined} rel="noreferrer"
                        style={{ fontSize: 13, fontWeight: 700, color: "#2A7BD4", whiteSpace: "nowrap", textDecoration: "none", flexShrink: 0, paddingTop: 2 }}>
                        {actionLabel}
                    </a>
                )
            )}
        </div>
    );
}

// ── LISTING DATA PARSER ────────────────────────────────────────────────────────
export interface ParsedListing {
  lastListedDate: string;
  judges: string[];
  stage: string;
  statusBadge: string;
  iaNumbers: string[];
  nextListingDate: string | null;
  nextListingSource: string;
  orderDate: string | null;
  noticeReturnable: string | null;
}

export function parseListingData(caseData: any): ParsedListing {
  const lastListedOn = caseData.lastListedOn || "";
  const stage = caseData.stage || "";
  const statusBadge = (caseData.caseStatusBadge || caseData.status || "PENDING").toString().toUpperCase();
  
  // Parse date and judges from lastListedOn
  let lastListedDate = "";
  let judges: string[] = [];
  
  // Try to get from both sources
  const lastListedRaw = caseData.raw?.table?.["Present/Last Listed On"] || lastListedOn || '';
  
  
  if (lastListedRaw) {
    // Extract date part (before the bracket) — must look like a real date
    const dateMatch = lastListedRaw.match(/^([^\[]+)/);
    if (dateMatch) {
      const candidate = dateMatch[1].trim();
      // Validate: must contain DD-MM-YYYY or YYYY-MM-DD pattern
      if (/\d{2}[-/]\d{2}[-/]\d{4}|\d{4}[-/]\d{2}[-/]\d{2}/.test(candidate)) {
        lastListedDate = candidate;
      }
    }
    
    // Extract judges from inside [ ] brackets
    const bracketMatch = lastListedRaw.match(/\[([^\]]+)\]/);
    const judgeRaw = bracketMatch ? bracketMatch[1] : '';
    
    if (judgeRaw) {
      // Split on "and HON'BLE" or "HON'BLE", handling both cases
      const parts: string[] = judgeRaw.replace(/and\s+HON'BLE/gi, '|||HON\'BLE').split('|||');
      judges = parts
        .map((p: string) => p.replace(/HON'BLE\s+(MR\.|MS\.|DR\.)?\s*JUSTICE\s*/gi, '').trim())
        .filter((p: string) => p.length > 0)
        .map((p: string) => toTitleCase(p));
    }
  }
  
  // Fallback: use lastListedJudges array if bracket parsing returned empty
  if (judges.length === 0 && caseData.lastListedJudges) {
    judges = (caseData.lastListedJudges as string[])
      .map((j: string) => toTitleCase(
        j.replace(/HON'BLE\s+(MR\.|MS\.|DR\.)?\s*JUSTICE\s*/gi, '')
         .trim()
      ))
      .filter((j: string) => j.length > 0)
  }
  
  // Extract stage label from stage string
  const stageLabelMatch = stage.match(/\[([^\]]+)\]/);
  const stageLabel = stageLabelMatch ? stageLabelMatch[1] : stage.split("(")[0].trim();
  
  // Extract IA numbers
  const iaMatches: string[] = stage.match(/\d{5}\/\d{4}/g) || [];
  const iaNumbers: string[] = Array.from(new Set(iaMatches));
  
  // Extract next listing date
  const nextDateMatch = stage.match(/List On \(Date\)\s*\((\d{2})-(\d{2})-(\d{4})\)/i);
  const nextListingDate = nextDateMatch ? `${nextDateMatch[1]}-${nextDateMatch[2]}-${nextDateMatch[3]}` : null;
  
  // Determine next listing source
  let nextListingSource = "Order";
  if (nextListingDate) {
    const orderDateMatch = stage.match(/Ord\s*dt[:\s]*(\d{2})-(\d{2})-(\d{4})/i);
    if (orderDateMatch) {
      nextListingSource = `Order dated ${orderDateMatch[1]}-${orderDateMatch[2]}-${orderDateMatch[3]}`;
    }
  }
  
  // Check for computer-generated next date from raw.table
  const tableNextDate = caseData.raw?.table?.["Tentatively case may be listed on (likely to be listed on)"] ||
                        caseData.raw?.table?.["Tentatively case may be listed on"] ||
                        caseData.raw?.table?.["Likely to be listed on"];
  if (tableNextDate && tableNextDate.includes("Computer generated")) {
    nextListingSource = "Computer generated";
  }
  
  // Extract order date
  const orderDateMatch = stage.match(/Ord\s*dt[:\s]*(\d{2})-(\d{2})-(\d{4})/i);
  const orderDate = orderDateMatch ? `${orderDateMatch[1]}-${orderDateMatch[2]}-${orderDateMatch[3]}` : null;
  
  // Extract notice returnable
  const noticeMatch = stage.match(/Notice Returnable\s*\(([^)]+)\)/i);
  const noticeReturnable = noticeMatch ? noticeMatch[1] : null;
  
  return {
    lastListedDate,
    judges,
    stage: stageLabel,
    statusBadge,
    iaNumbers,
    nextListingDate,
    nextListingSource,
    orderDate,
    noticeReturnable
  };
}