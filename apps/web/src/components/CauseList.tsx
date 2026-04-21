import { useMemo, useState } from 'react';
import { formatCaseTitle } from '../utils/caseTitle';

export default function CauseList({ cases, T, onSelectCase }: { cases: any[], T: any, onSelectCase: (c: any) => void }) {
    const [printDateFilter, setPrintDateFilter] = useState("All");

    const upcoming = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const hearings: any[] = [];
        cases.forEach(c => {
            if (c.archived || c.status === "Disposed") return;
            const dateStr = c.nextHearingDate || c.likelyListedOn;
            if (!dateStr) return;
            // Skip past dates — cause list is for upcoming hearings only
            if (new Date(dateStr) < today) return;
            {
                // Find matching listing for this date to extract specific item/bench details
                const listing = c.listings?.find((l: any) => l.date === dateStr) || c.listings?.[0] || {};

                hearings.push({
                    id: c.id,
                    date: dateStr,
                    title: formatCaseTitle(c).toUpperCase(),
                    category: c.caseNumber?.toUpperCase()
                        || ((c.caseType && c.caseType !== 'UNKNOWN') ? `${c.caseType} ${c.shortCaseNumber || ''}`.trim() : '')
                        || (c.diaryNumber ? `DIARY NO. ${c.diaryNumber}/${c.diaryYear}` : ''),
                    court: listing.court || c.courtNumber?.replace(/\D/g, "") || "1",
                    item: listing.item || "-",
                    bench: (() => {
                        const b = Array.isArray(listing.bench) ? listing.bench.join(', ') : (listing.bench || '');
                        return b ? `HON'BLE ${b.toUpperCase()}` : (c.lastListedJudges?.length > 0 ? `HON'BLE ${c.lastListedJudges.join(" AND HON'BLE ").toUpperCase()}` : "TBD");
                    })(),
                    listingType: (listing.type || c.stage || c.status || "REGULAR").toUpperCase(),
                    caseData: c
                });
            }
        });

        const grouped: Record<string, any[]> = {};
        hearings.forEach(h => {
            if (!grouped[h.date]) grouped[h.date] = [];
            grouped[h.date].push(h);
        });

        const sortedDates = Object.keys(grouped).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
        return sortedDates.map(date => ({
            date,
            cases: grouped[date]
        }));
    }, [cases]);

    // Clean LISTING STATUS to match SC exact standards
    function formatListingStatus(raw: string) {
        if (!raw) return "REGULAR";
        const val = raw.toUpperCase();
        if (val.includes("AFTER NOTICE")) return "AFTER NOTICE";
        if (val.includes("FOR ADMISSION") || val.includes("ADMISSION")) return "FOR ADMISSION";
        if (val.includes("FOR ORDERS") || val.includes("ORDERS")) return "FOR ORDERS";
        if (val.includes("FOR JUDGMENT") || val.includes("JUDGMENT")) return "FOR JUDGMENT";
        if (val.includes("PART HEARD")) return "PART HEARD";
        if (val.includes("FRESH")) return "FRESH";
        return "REGULAR"; // Default matched fallback
    }

    // SC dates look like "11.03.2026 (WEDNESDAY)" in the cause list top header. We format it.
    function formatCauseListHeader(dStr: string) {
        const d = new Date(dStr);
        if (isNaN(d.getTime())) return dStr;
        const pad = (n: number) => n.toString().padStart(2, '0');
        const dayStr = pad(d.getDate());
        const monthStr = pad(d.getMonth() + 1);
        const yStr = d.getFullYear();
        const weekdayMatch = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(d);
        return `${dayStr}.${monthStr}.${yStr} (${weekdayMatch.toUpperCase()})`;
    }

    return (
        <div style={{ padding: "24px", maxWidth: 1200, margin: "0 auto", width: "100%" }}>
            <style>
                {`
                    @media print {
                        body * {
                            visibility: hidden;
                        }
                        .printable-area, .printable-area * {
                            visibility: visible;
                        }
                        .printable-area {
                            position: absolute;
                            left: 0;
                            top: 0;
                            width: 100%;
                            padding: 0 !important;
                            margin: 0 !important;
                        }
                        .no-print {
                            display: none !important;
                        }
                        /* Ensure table borders and colors print correctly */
                        .printable-area table {
                            border-collapse: collapse !important;
                        }
                        .printable-area th, .printable-area td {
                            border: 1px solid black !important;
                            color: black !important;
                            background: white !important;
                        }
                    }
                    /* Base SC style for table */
                    .sc-table {
                        width: 100%;
                        border-collapse: collapse;
                        font-family: Arial, sans-serif;
                        font-size: 13px;
                        background: #fff;
                    }
                    .sc-table th, .sc-table td {
                        border: 1px solid #000;
                        padding: 10px;
                        color: #000;
                    }
                    .sc-table th {
                        font-weight: bold;
                        text-align: center;
                    }
                `}
            </style>

            <div className="no-print" style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                <div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: T.text, marginBottom: 8 }}>Tentative Cause List</div>
                    <div style={{ fontSize: 15, color: T.textMuted }}>Review upcoming hearings grouped by date. Clicking a row opens the case.</div>
                </div>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                        <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: 0.8, marginBottom: 4 }}>FILTER BY DATE</label>
                        <div style={{ display: "flex", gap: 8 }}>
                            <input
                                type="date"
                                value={printDateFilter === "All" ? "" : printDateFilter}
                                onChange={(e) => setPrintDateFilter(e.target.value || "All")}
                                style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 14, outline: "none", cursor: "pointer", boxSizing: "border-box" }}
                            />
                            {printDateFilter !== "All" && (
                                <button onClick={() => setPrintDateFilter("All")} style={{ padding: "0 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.bg, color: T.textSub, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                                    Reset
                                </button>
                            )}
                        </div>
                    </div>
                    <button onClick={() => window.print()} style={{ height: "40px", marginTop: "auto", padding: "0 16px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
                        🖨️ Print
                    </button>
                </div>
            </div>

            <div className="printable-area">

                {upcoming.length === 0 ? (
                    <div style={{ background: T.surface, padding: 40, borderRadius: 12, textAlign: "center", border: `1px solid ${T.border}` }}>
                        <div style={{ fontSize: 40, marginBottom: 12 }}>📅</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>No Upcoming Hearings</div>
                        <div style={{ fontSize: 14, color: T.textMuted, marginTop: 4 }}>Any case with a listing date will appear here.</div>
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
                        {upcoming.filter(g => printDateFilter === "All" || printDateFilter === g.date).map(group => {
                            return (
                                <div key={group.date}>
                                    <div style={{ fontSize: 16, fontWeight: 800, color: T.text, textAlign: "center", marginBottom: 12 }}>
                                        CAUSE LIST FOR {formatCauseListHeader(group.date)}
                                    </div>
                                    <div style={{ background: "#fff", border: "1px solid #000", overflow: "hidden" }}>
                                        <table className="sc-table">
                                            <thead>
                                                <tr>
                                                    <th style={{ width: "40px" }}>S.N.</th>
                                                    <th style={{ width: "100px" }}>COURT &<br />ITEM NO.</th>
                                                    <th>BEFORE</th>
                                                    <th>CASE NO. & TITLED</th>
                                                    <th style={{ width: "120px" }}>LISTING<br />STATUS</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {group.cases.map((h, i) => (
                                                    <tr key={h.id}
                                                        onClick={() => onSelectCase(h.caseData)}
                                                        style={{ cursor: "pointer" }}
                                                        onMouseEnter={e => e.currentTarget.style.backgroundColor = "#f0f0f0"}
                                                        onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                                        <td style={{ textAlign: "center", verticalAlign: "top" }}>
                                                            {i + 1}.
                                                        </td>
                                                        <td style={{ textAlign: "center", verticalAlign: "top", fontWeight: "bold" }}>
                                                            {h.court}/{h.item}
                                                        </td>
                                                        <td style={{ verticalAlign: "top", lineHeight: 1.5 }}>
                                                            {h.bench.split(" AND ").map((judge: string, idx: number, arr: string[]) => (
                                                                <span key={idx}>
                                                                    {judge}
                                                                    {idx < arr.length - 1 && <><br />AND<br /></>}
                                                                </span>
                                                            ))}
                                                        </td>
                                                        <td style={{ verticalAlign: "top", lineHeight: 1.5 }}>
                                                            {h.category ? `${h.category} TITLED` : 'TITLED'}<br />
                                                            {h.title}
                                                            {h.caseData.connectedCases && h.caseData.connectedCases.length > 0 && (
                                                                <div style={{ fontWeight: "bold", marginTop: 4 }}>AND CONNECTED MATTER</div>
                                                            )}
                                                        </td>
                                                        <td style={{ textAlign: "center", verticalAlign: "top", fontWeight: "bold" }}>
                                                            {formatListingStatus(h.listingType)}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
