import { useState, useMemo, useEffect, useRef } from 'react';
import { useSettingsStore } from '../store/settingsStore';
import { fmtDate } from '../caseHelpers';
import { formatCaseTitleShort } from '../utils/caseTitle';
import { normaliseTaskKey } from '../services/aiTaskService';

export const SC_TYPES = [
    "SPECIAL LEAVE PETITION (CIVIL) — SLP(C)", "SPECIAL LEAVE PETITION (CRIMINAL) — SLP(Cr)", "CIVIL APPEAL — CA", "CRIMINAL APPEAL — CrA",
    "WRIT PETITION (CIVIL) — WP(C)", "WRIT PETITION (CRIMINAL) — WP(Cr)", "TRANSFER PETITION (CIVIL) — TP(C)", "TRANSFER PETITION (CRIMINAL) — TP(Cr)",
    "REVIEW PETITION (CIVIL) — RP(C)", "REVIEW PETITION (CRIMINAL) — RP(Cr)", "TRANSFERRED CASE (CIVIL) — TC(C)", "TRANSFERRED CASE (CRIMINAL) — TC(Cr)",
    "SPECIAL LEAVE TO PETITION (CIVIL)", "SPECIAL LEAVE TO PETITION (CRIMINAL)", "WRIT TO PETITION (CIVIL)", "WRIT TO PETITION (CRIMINAL)",
    "ORIGINAL SUIT — OS", "DEATH REFERENCE CASE", "CONTEMPT PETITION (CIVIL) — ConC", "CONTEMPT PETITION (CRIMINAL) — ConCr",
    "TAX REFERENCE CASE", "SPECIAL REFERENCE CASE", "ELECTION PETITION", "ARBITRATION PETITION — Arb.P", "CURATIVE PETITION (CIVIL) — CP(C)",
    "CURATIVE PETITION (CRIMINAL) — CP(Cr)", "REFERENCE U/A 317(1)", "MOTION (CRIMINAL)", "DIARY NUMBER", "SUO MOTU WRIT PETITION (CIVIL)",
    "SUO MOTU WRIT PETITION (CRIMINAL)", "SUO MOTU CONTEMPT PETITION (CIVIL)", "SUO MOTU CONTEMPT PETITION (CRIMINAL)", "REFERENCE U/S 14 RTI",
    "REFERENCE U/S 17 RTI", "MISCELLANEOUS APPLICATION", "SUO MOTU TRANSFER PETITION (CIVIL)", "SUO MOTU TRANSFER PETITION (CRIMINAL)"
];

// ─── REAL PDF TEXT EXTRACTION using pdf.js ───────────────────────────────────
const extractTextFromPDF = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const typedArray = new Uint8Array(e.target?.result as ArrayBuffer);
                // Dynamically import pdfjs-dist
                const pdfjsLib = await import('pdfjs-dist');
                // Set worker source
                pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
                const pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;
                let fullText = '';
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const content = await page.getTextContent();
                    const pageText = content.items.map((item: any) => item.str).join(' ');
                    fullText += pageText + '\n';
                }
                resolve(fullText.trim());
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsArrayBuffer(file);
    });
};

// ─── VALIDATE PDF CONTAINS CASE/DIARY REFERENCE ─────────────────────────────
const validatePDFContent = (text: string): boolean => {
    const diaryPattern = /diary\s*no\.?\s*\d+/i;
    const casePattern = /\b(SLP|CA|WP|CrA|TP|RP|TC|OS|ConC|ConCr|Arb\.P|CP)\s*[\(\[]?\s*(C|Cr|Civil|Criminal)?\s*[\)\]]?\s*No\.?\s*\d+/i;
    const numberPattern = /\b\d{4,}\s*\/\s*\d{4}\b/;
    return diaryPattern.test(text) || casePattern.test(text) || numberPattern.test(text);
};

// ─── PERSON AVATAR ────────────────────────────────────────────────────────────
const AVATAR_COLORS = [
    { bg: '#DBEAFE', text: '#1E40AF' }, { bg: '#D1FAE5', text: '#065F46' },
    { bg: '#EDE9FE', text: '#5B21B6' }, { bg: '#FCE7F3', text: '#9D174D' },
    { bg: '#FEF3C7', text: '#92400E' }, { bg: '#FFE4E6', text: '#9F1239' },
];
const getAvatarColor = (name: string) => {
    const idx = name ? name.charCodeAt(0) % AVATAR_COLORS.length : 0;
    return AVATAR_COLORS[idx];
};
const PersonAvatar = ({ name }: { name: string }) => {
    const initials = name ? name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : '??';
    const color = getAvatarColor(name);
    return (
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: color.bg, color: color.text, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, flexShrink: 0, border: `1px solid ${color.text}33` }}>
            {initials}
        </div>
    );
};

export default function TasksDashboard({ cases, T, onUpdateCase, onUpdateMultipleCases, forceShowAI, onForceShowAIHandled }: {
    cases: any[], T: any, onUpdateCase: any, onUpdateMultipleCases?: (cases: any[]) => void, forceShowAI?: boolean, onForceShowAIHandled?: () => void
}) {
    // ── Filters ────────────────────────────────────────────────────────────────
    const [roleFilter, setRoleFilter] = useState<string>("All");
    const [urgencyFilter, setUrgencyFilter] = useState<string>("All");
    const [statusFilter, setStatusFilter] = useState<string>("Pending");
    const [caseFilter, setCaseFilter] = useState<string>("All");
    const [partyFilter, setPartyFilter] = useState<string>("All");
    const [personFilter, setPersonFilter] = useState<string>("All");
    const [searchQuery, setSearchQuery] = useState<string>("");
    const [showCompleted, setShowCompleted] = useState(false);

    // ── AI Scanner ─────────────────────────────────────────────────────────────
    const [showAI, setShowAI] = useState(false);
    const [orText, setOrText] = useState("");
    const [isScanning, setIsScanning] = useState(false);
    const [scannerError, setScannerError] = useState<string>("");
    const fileInputRef = useRef<HTMLInputElement>(null);

    // ── Regeneration ──────────────────────────────────────────────────────────
    const [regenModal, setRegenModal] = useState(false);
    const [regenType, setRegenType] = useState(SC_TYPES[0]);
    const [regenCaseId, setRegenCaseId] = useState("");
    const [regenText, setRegenText] = useState("");

    // ── Bulk Actions ──────────────────────────────────────────────────────────
    const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
    const [showBulkBar, setShowBulkBar] = useState(false);
    const [bulkAssignPerson, setBulkAssignPerson] = useState("");

    // ── Bulk AI Generate All Cases ────────────────────────────────────────────
    const [isBulkGenerating, setIsBulkGenerating] = useState(false);
    const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number; caseName: string } | null>(null);
    const [bulkResult, setBulkResult] = useState<{ added: number; caseCount: number } | null>(null);

    // ── Inline Deadline Edit ──────────────────────────────────────────────────
    const [editDeadlineTaskId, setEditDeadlineTaskId] = useState<string | null>(null);
    const [editDeadlineValue, setEditDeadlineValue] = useState<string>("");

    // ── Inline Priority Override ──────────────────────────────────────────────
    const [editUrgencyTaskId, setEditUrgencyTaskId] = useState<string | null>(null);

    const store = useSettingsStore();

    useEffect(() => {
        if (forceShowAI) {
            setShowAI(true);
            if (onForceShowAIHandled) onForceShowAIHandled();
        }
    }, [forceShowAI, onForceShowAIHandled]);

    // ── Update bulk bar visibility ─────────────────────────────────────────────
    useEffect(() => {
        setShowBulkBar(selectedTasks.size > 0);
    }, [selectedTasks]);

    // ── Flatten all tasks ─────────────────────────────────────────────────────
    const allTasks = useMemo(() => {
        let list: any[] = [];
        cases.forEach(c => {
            // Skip tasks from disposed or closed cases
            const caseStatus = (c.status || "").toLowerCase();
            if (caseStatus === "disposed" || caseStatus === "closed") return;
            if (c.tasks && Array.isArray(c.tasks)) {
                c.tasks.forEach((t: any) => {
                    list.push({
                        ...t,
                        caseId: c.id,
                        caseTitle: c.displayTitle || formatCaseTitleShort(c),
                        caseOfficeReport: c.officeReportText || "" // Store actual office report text on case
                    });
                });
            }
        });
        return list;
    }, [cases]);

    // ── Statistics ────────────────────────────────────────────────────────────
    const stats = useMemo(() => {
        const now = new Date().setHours(0, 0, 0, 0);
        const pending = allTasks.filter(t => !t.done);
        const critical = pending.filter(t => t.urgency === 'Critical').length;
        const overdue = pending.filter(t => {
            if (!t.deadline) return false;
            const d = new Date(t.deadline);
            d.setHours(0, 0, 0, 0);
            return d.getTime() < now;
        }).length;
        const dueToday = pending.filter(t => {
            if (!t.deadline) return false;
            const d = new Date(t.deadline);
            d.setHours(0, 0, 0, 0);
            return d.getTime() === now;
        }).length;
        const completedToday = allTasks.filter(t => {
            if (!t.done || !t.completedAt) return false;
            const d = new Date(t.completedAt);
            d.setHours(0, 0, 0, 0);
            return d.getTime() === now;
        }).length;
        return { total: pending.length, critical, overdue, dueToday, completedToday };
    }, [allTasks]);

    // ── Filter + Search ───────────────────────────────────────────────────────
    const filtered = allTasks.filter(t => {
        if (roleFilter !== "All" && t.assignee !== roleFilter) return false;
        if (urgencyFilter !== "All" && t.urgency !== urgencyFilter) return false;
        if (caseFilter !== "All" && t.caseId !== caseFilter) return false;
        if (partyFilter !== "All" && t.party !== partyFilter) return false;
        if (personFilter !== "All" && t.partyPerson !== personFilter) return false;
        if (statusFilter === "Pending" && t.done) return false;
        if (statusFilter === "Completed" && !t.done) return false;
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            const matchText = t.text?.toLowerCase().includes(q);
            const matchCase = t.caseTitle?.toLowerCase().includes(q);
            const matchPerson = t.assignedPerson?.toLowerCase().includes(q);
            if (!matchText && !matchCase && !matchPerson) return false;
        }
        return true;
    }).sort((a, b) => {
        if (a.done && !b.done) return 1;
        if (!a.done && b.done) return -1;
        const uVal: any = { "Critical": 1, "High": 2, "Medium": 3, "Low": 4 };
        if ((uVal[a.urgency] || 5) !== (uVal[b.urgency] || 5)) return (uVal[a.urgency] || 5) - (uVal[b.urgency] || 5);
        if (a.deadline && b.deadline) return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
        return 0;
    });

    const pending = filtered.filter(t => !t.done);
    const completed = filtered.filter(t => t.done);

    const unknownTypeCases = useMemo(() => {
        return cases.filter(c => c.tasks && c.tasks.some((t: any) =>
            !t.done && (t.caseTypeDetected?.includes("MISCELLANEOUS APPLICATION") || (!t.caseTypeDetected && t.assignmentType === 'ai'))
        ));
    }, [cases]);

    // ── Helpers ───────────────────────────────────────────────────────────────
    const getUrgencyColor = (u: string) => {
        if (u === "Critical") return { bg: "#FEF2F2", text: "#991B1B", border: "#FECACA" };
        if (u === "High") return { bg: "#FFFBEB", text: "#92400E", border: "#FDE68A" };
        if (u === "Low") return { bg: "#F3F4F6", text: "#4B5563", border: "#E5E7EB" };
        return { bg: "#EFF6FF", text: "#1E40AF", border: "#BFDBFE" };
    };

    const FilterButton = ({ label, active, onClick }: any) => (
        <button onClick={onClick} style={{ padding: "6px 14px", borderRadius: 20, border: `1px solid ${active ? T.accentDark : T.border}`, background: active ? T.accentBg : "transparent", color: active ? T.accentDark : T.textSub, fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}>
            {label}
        </button>
    );

    // ── Toggle Task Complete ───────────────────────────────────────────────────
    const toggleTask = (taskId: string, caseId: string) => {
        const relatedCase = cases.find(c => c.id === caseId);
        if (!relatedCase) return;
        const updatedTasks = relatedCase.tasks.map((t: any) =>
            t.id === taskId ? { ...t, done: !t.done, completedAt: !t.done ? new Date().toISOString() : null } : t
        );
        onUpdateCase({ ...relatedCase, tasks: updatedTasks });
    };

    // ── Bulk Actions ──────────────────────────────────────────────────────────
    const toggleSelectTask = (taskId: string) => {
        setSelectedTasks(prev => {
            const next = new Set(prev);
            next.has(taskId) ? next.delete(taskId) : next.add(taskId);
            return next;
        });
    };

    const bulkMarkComplete = () => {
        const selectedIdArray = Array.from(selectedTasks);
        if (onUpdateMultipleCases) {
            const updatesMap: Record<string, any> = {};
            selectedIdArray.forEach(taskId => {
                const task = allTasks.find(t => t.id === taskId);
                if (task && !task.done) {
                    const case_ = cases.find(c => c.id === task.caseId);
                    if (case_) {
                        const existingUpdate = updatesMap[case_.id] || { ...case_ };
                        existingUpdate.tasks = existingUpdate.tasks.map((t: any) =>
                            t.id === taskId ? { ...t, done: true, completedAt: new Date().toISOString() } : t
                        );
                        updatesMap[case_.id] = existingUpdate;
                    }
                }
            });
            onUpdateMultipleCases(Object.values(updatesMap));
        } else {
            selectedIdArray.forEach(taskId => {
                const task = allTasks.find(t => t.id === taskId);
                if (task && !task.done) toggleTask(taskId, task.caseId);
            });
        }
        setSelectedTasks(new Set());
    };

    const bulkReassign = () => {
        if (!bulkAssignPerson.trim()) return;
        const selectedIdArray = Array.from(selectedTasks);
        if (onUpdateMultipleCases) {
            const updatesMap: Record<string, any> = {};
            selectedIdArray.forEach(taskId => {
                const task = allTasks.find(t => t.id === taskId);
                if (task) {
                    const case_ = cases.find(c => c.id === task.caseId);
                    if (case_) {
                        const existingUpdate = updatesMap[case_.id] || { ...case_ };
                        existingUpdate.tasks = existingUpdate.tasks.map((t: any) =>
                            t.id === taskId ? { ...t, assignedPerson: bulkAssignPerson, assignee: "Team" } : t
                        );
                        updatesMap[case_.id] = existingUpdate;
                    }
                }
            });
            onUpdateMultipleCases(Object.values(updatesMap));
        } else {
            selectedIdArray.forEach(taskId => {
                const task = allTasks.find(t => t.id === taskId);
                if (task) {
                    const case_ = cases.find(c => c.id === task.caseId);
                    if (case_) {
                        onUpdateCase({ ...case_, tasks: case_.tasks.map((t: any) => t.id === taskId ? { ...t, assignedPerson: bulkAssignPerson, assignee: "Team" } : t) });
                    }
                }
            });
        }
        setBulkAssignPerson("");
        setSelectedTasks(new Set());
    };

    // ── Inline Deadline Save ──────────────────────────────────────────────────
    const saveDeadline = (taskId: string, caseId: string) => {
        const relatedCase = cases.find(c => c.id === caseId);
        if (!relatedCase) return;
        const updatedTasks = relatedCase.tasks.map((t: any) =>
            t.id === taskId ? { ...t, deadline: editDeadlineValue } : t
        );
        onUpdateCase({ ...relatedCase, tasks: updatedTasks });
        setEditDeadlineTaskId(null);
    };

    // ── Inline Urgency Save ───────────────────────────────────────────────────
    const saveUrgency = (taskId: string, caseId: string, newUrgency: string) => {
        const relatedCase = cases.find(c => c.id === caseId);
        if (!relatedCase) return;
        const updatedTasks = relatedCase.tasks.map((t: any) =>
            t.id === taskId ? { ...t, urgency: newUrgency } : t
        );
        onUpdateCase({ ...relatedCase, tasks: updatedTasks });
        setEditUrgencyTaskId(null);
    };

    // ── Real PDF Upload Handler ───────────────────────────────────────────────
    const handleFileUpload = async (e: any) => {
        const file = e.target?.files?.[0];
        if (!file) return;

        // Step 1 — Check file type
        if (!file.name.toLowerCase().endsWith('.pdf')) {
            setScannerError("⚠️ Invalid file format. Please upload a PDF document only.");
            return;
        }

        setScannerError("");
        setIsScanning(true);
        setOrText("");

        try {
            // Step 2 — Actually extract text from PDF using pdf.js
            const extractedText = await extractTextFromPDF(file);

            // Step 3 — Validate extracted text contains a case/diary reference
            if (!extractedText || extractedText.trim().length < 20) {
                setScannerError("⚠️ Could not extract readable text from this PDF. The file may be scanned or encrypted.");
                setIsScanning(false);
                return;
            }

            if (!validatePDFContent(extractedText)) {
                setScannerError("⚠️ File rejected: No valid Case Number or Diary Number found inside this document. Please upload a valid Supreme Court Office Report.");
                setIsScanning(false);
                return;
            }

            // Step 4 — Set extracted text into textarea
            setOrText(extractedText);
        } catch (err) {
            setScannerError("⚠️ Failed to read PDF. Please try pasting the text manually.");
        }

        setIsScanning(false);
        // Reset file input so same file can be re-uploaded
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    // ── Bulk AI: Generate Tasks for ALL Cases (both sides) ────────────────────
    const handleBulkGenerateAll = async () => {
        const activeCases = cases.filter((c: any) => !c.archived && c.status !== 'Disposed');
        if (activeCases.length === 0 || isBulkGenerating) return;

        setIsBulkGenerating(true);
        setBulkResult(null);
        setBulkProgress({ current: 0, total: activeCases.length, caseName: "" });

        const { generateTasksForBothSides } = await import('../services/aiTaskService');
        const updatedCases: any[] = [];
        let totalAdded = 0;

        for (let i = 0; i < activeCases.length; i++) {
            const c = activeCases[i];
            const caseName = c.displayTitle || formatCaseTitleShort(c, 35);
            setBulkProgress({ current: i + 1, total: activeCases.length, caseName });

            try {
                const result = await generateTasksForBothSides(c);
                const existingTasks: any[] = c.tasks || [];
                // Deduplicate: same text + same party = skip
                const existingKeys = new Set(
                    existingTasks.map((t: any) => normaliseTaskKey(t.text, t.party || ''))
                );

                const petFresh = result.petitioner
                    .map((t: any) => ({ ...t, party: "Petitioner", assignedPerson: undefined }))
                    .filter((t: any) => !existingKeys.has(normaliseTaskKey(t.text, t.party || '')));

                const respFresh = result.respondent
                    .map((t: any) => ({ ...t, party: "Respondent", assignedPerson: undefined }))
                    .filter((t: any) => !existingKeys.has(normaliseTaskKey(t.text, t.party || '')));

                const fresh = [...petFresh, ...respFresh];
                if (fresh.length > 0) {
                    updatedCases.push({ ...c, tasks: [...fresh, ...existingTasks] });
                    totalAdded += fresh.length;
                }
            } catch { /* skip this case silently */ }

            // 2 second gap between cases to avoid Gemini rate limits
            // (15 requests per minute limit — 2 per case = max 7 cases/min)
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        if (updatedCases.length > 0 && onUpdateMultipleCases) {
            onUpdateMultipleCases(updatedCases);
        } else if (updatedCases.length > 0) {
            updatedCases.forEach(c => onUpdateCase(c));
        }

        setBulkProgress(null);
        setIsBulkGenerating(false);
        setBulkResult({ added: totalAdded, caseCount: updatedCases.length });
        setTimeout(() => setBulkResult(null), 10000);
    };

    // ── AI Scanner Runner ─────────────────────────────────────────────────────
    const runAIScanner = async () => {
        if (!orText.trim()) return;
        setScannerError("");
        setIsScanning(true);

        try {
            // Auto-detect case from extracted text
            let targetCase = cases.find(c =>
                (c.caseNumber && orText.toLowerCase().includes(c.caseNumber.toLowerCase())) ||
                (c.diaryNumber && orText.includes(String(c.diaryNumber))) ||
                (c.petitioners && c.petitioners[0] && orText.toLowerCase().includes(c.petitioners[0].toLowerCase()))
            );

            if (!targetCase) {
                setScannerError("⚠️ Could not automatically detect which case this document belongs to. Ensure the document contains the Diary Number or Case Number.");
                setIsScanning(false);
                return;
            }

            const { assignTasksFromOfficeReport } = await import('../services/aiTaskService');
            const newTasks = await assignTasksFromOfficeReport(orText.trim());

            if (newTasks && newTasks.length > 0) {
                // Store the actual office report text on the case for future training use
                onUpdateCase({
                    ...targetCase,
                    officeReportText: orText.trim(), // ← Real text stored here
                    tasks: [
                        ...newTasks.map((t: any) => ({ ...t, id: crypto.randomUUID() })), // ← Safe UUID
                        ...(targetCase.tasks || [])
                    ]
                });
                setOrText("");
                setShowAI(false);
            } else {
                setScannerError("No actionable defects found in the text. Please verify the document is a Supreme Court Office Report.");
            }
        } catch (error) {
            console.error("AI Auto-Assign failed:", error);
            setScannerError("AI processing failed. Please try again.");
        }

        setIsScanning(false);
    };

    // ── Regenerate Tasks ──────────────────────────────────────────────────────
    const runRegenerate = async () => {
        if (!regenText.trim() || !regenCaseId) return;
        const targetCase = cases.find(c => c.id === regenCaseId);
        if (!targetCase) return;
        setIsScanning(true);
        try {
            const { assignTasksFromOfficeReport } = await import('../services/aiTaskService');
            const newTasks = await assignTasksFromOfficeReport(regenText.trim(), regenType);
            if (newTasks) {
                onUpdateCase({
                    ...targetCase,
                    officeReportText: regenText.trim(),
                    tasks: [
                        ...newTasks.map((t: any) => ({ ...t, id: crypto.randomUUID() })),
                        ...(targetCase.tasks || [])
                    ]
                });
            }
        } catch (error) {
            console.error("AI Regen failed:", error);
        }
        setIsScanning(false);
        setRegenModal(false);
        setRegenText("");
    };

    // ─────────────────────────────────────────────────────────────────────────
    // RENDER
    // ─────────────────────────────────────────────────────────────────────────
    return (
        <>
            <div style={{ padding: "24px", maxWidth: 1000, margin: "0 auto", width: "100%" }}>

                {/* ── HEADER ── */}
                <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: T.text, marginBottom: 8 }}>Team Inbox</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ fontSize: 15, color: T.textMuted }}>Manage assigned tasks and approaching deadlines across all cases.</div>
                        <button onClick={() => setShowAI(!showAI)} style={{ padding: "8px 16px", borderRadius: 8, border: `1px dashed #C4B5FD`, background: "#EDE9FE", color: "#6D28D9", fontSize: 13, fontWeight: 800, cursor: "pointer", display: "flex", gap: 6, alignItems: "center" }}>
                            <span>✨</span> AI Task Generator
                        </button>
                    </div>
                </div>

                {/* ── BULK AI GENERATE BANNER ── */}
                <div style={{ background: "linear-gradient(135deg,#0F172A,#1E3A5F)", borderRadius: 14, padding: "18px 22px", marginBottom: 20, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", boxShadow: "0 4px 24px rgba(14,165,233,0.18)" }}>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", marginBottom: 4 }}>
                            🚀 Auto-Generate Tasks for All Cases
                        </div>
                        <div style={{ fontSize: 12, color: "#94A3B8", lineHeight: 1.5 }}>
                            AI reads each case's office report, last order &amp; IAs and generates tasks for
                            <span style={{ color: "#7DD3FC", fontWeight: 700 }}> ⚖️ Petitioner</span> and
                            <span style={{ color: "#FCD34D", fontWeight: 700 }}> 🛡 Respondent</span> sides simultaneously.
                            Skips duplicates. Covers {cases.filter((c: any) => !c.archived).length} active case{cases.filter((c: any) => !c.archived).length !== 1 ? "s" : ""}.
                        </div>
                    </div>

                    {/* Progress / Result feedback */}
                    {bulkProgress && (
                        <div style={{ textAlign: "center", minWidth: 160 }}>
                            <div style={{ fontSize: 13, color: "#7DD3FC", fontWeight: 700, marginBottom: 4 }}>
                                Case {bulkProgress.current} / {bulkProgress.total}
                            </div>
                            <div style={{ fontSize: 11, color: "#94A3B8", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {bulkProgress.caseName}
                            </div>
                            <div style={{ marginTop: 6, height: 4, background: "#1E3A5F", borderRadius: 2, overflow: "hidden" }}>
                                <div style={{ height: "100%", background: "#0EA5E9", borderRadius: 2, width: `${(bulkProgress.current / bulkProgress.total) * 100}%`, transition: "width 0.4s" }} />
                            </div>
                        </div>
                    )}
                    {bulkResult && (
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#86EFAC", padding: "6px 14px", background: "rgba(16,185,129,0.15)", borderRadius: 8, border: "1px solid rgba(16,185,129,0.3)", whiteSpace: "nowrap" }}>
                            ✅ {bulkResult.added} tasks added across {bulkResult.caseCount} case{bulkResult.caseCount !== 1 ? "s" : ""}
                        </div>
                    )}

                    <button
                        onClick={handleBulkGenerateAll}
                        disabled={isBulkGenerating || cases.filter((c: any) => !c.archived).length === 0}
                        style={{
                            padding: "10px 22px", borderRadius: 9, border: "none", fontSize: 14, fontWeight: 800, cursor: isBulkGenerating ? "not-allowed" : "pointer",
                            background: isBulkGenerating ? "#334155" : "linear-gradient(135deg,#0EA5E9,#0369A1)",
                            color: "#fff", opacity: isBulkGenerating ? 0.7 : 1, whiteSpace: "nowrap",
                            boxShadow: isBulkGenerating ? "none" : "0 2px 12px rgba(14,165,233,0.4)",
                        }}
                    >
                        {isBulkGenerating ? "⏳ Processing…" : "Generate All"}
                    </button>
                </div>

                {/* ── STATISTICS BAR ── */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 20 }}>
                    {[
                        { label: "Pending Tasks", value: stats.total, color: "#1E40AF", bg: "#EFF6FF", border: "#BFDBFE" },
                        { label: "Critical", value: stats.critical, color: "#991B1B", bg: "#FEF2F2", border: "#FECACA" },
                        { label: "Overdue", value: stats.overdue, color: "#DC2626", bg: "#FEE2E2", border: "#FCA5A5" },
                        { label: "Due Today", value: stats.dueToday, color: "#92400E", bg: "#FFFBEB", border: "#FDE68A" },
                        { label: "Completed Today", value: stats.completedToday, color: "#065F46", bg: "#D1FAE5", border: "#6EE7B7" },
                    ].map(s => (
                        <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 10, padding: "12px 16px", textAlign: "center" }}>
                            <div style={{ fontSize: 24, fontWeight: 900, color: s.color }}>{s.value}</div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: s.color, opacity: 0.8, marginTop: 2 }}>{s.label.toUpperCase()}</div>
                        </div>
                    ))}
                </div>

                {/* ── UNKNOWN TYPE WARNING ── */}
                {unknownTypeCases.length > 0 && (
                    <div style={{ background: "#FEFCE8", border: "1px solid #FEF08A", borderRadius: 12, padding: 16, marginBottom: 20, display: "flex", gap: 16, alignItems: "center", boxShadow: T.shadow }}>
                        <div style={{ fontSize: 24 }}>⚠️</div>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 800, color: "#854D0E", marginBottom: 4 }}>Case type not detected — tasks generated using general rules.</div>
                            <div style={{ fontSize: 13, color: "#A16207" }}>The AI failed to classify {unknownTypeCases.length} case(s). Please verify the case type and regenerate.</div>
                        </div>
                        <button onClick={() => { setRegenCaseId(unknownTypeCases[0].id); setRegenModal(true); }} style={{ padding: "8px 16px", borderRadius: 8, background: "#854D0E", color: "#fff", border: "none", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
                            Regenerate Tasks
                        </button>
                    </div>
                )}

                {/* ── REGENERATE MODAL ── */}
                {regenModal && (
                    <div style={{ background: "#FFFBEB", borderRadius: 12, border: `1px solid #FDE68A`, padding: "20px", marginBottom: 20, boxShadow: "0 4px 20px rgba(217,119,6,0.08)" }}>
                        <div style={{ fontSize: 15, fontWeight: 800, color: "#B45309", marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
                            <span>🔄</span> Manually Override Case Type
                        </div>
                        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                            <select value={regenCaseId} onChange={e => setRegenCaseId(e.target.value)} style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid #FCD34D" }}>
                                {unknownTypeCases.map(c => <option key={c.id} value={c.id}>Regenerate: {c.caseNumber || c.diaryNumber}</option>)}
                            </select>
                            <select value={regenType} onChange={e => setRegenType(e.target.value)} style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid #FCD34D" }}>
                                {SC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </div>
                        <textarea value={regenText} onChange={e => setRegenText(e.target.value)} placeholder="Paste the exact Office Report here to regenerate..." rows={4} style={{ width: "100%", padding: 12, borderRadius: 8, border: "1px solid #FCD34D", marginBottom: 16, boxSizing: "border-box" }} />
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                            <button onClick={() => setRegenModal(false)} style={{ padding: "8px 16px", borderRadius: 8, background: "none", border: "1px solid #FCD34D", color: "#B45309", cursor: "pointer", fontWeight: 700 }}>Cancel</button>
                            <button onClick={runRegenerate} disabled={isScanning || !regenText} style={{ padding: "8px 16px", borderRadius: 8, background: "#D97706", color: "#fff", border: "none", cursor: "pointer", fontWeight: 700 }}>
                                {isScanning ? "Processing..." : "Run Regeneration"}
                            </button>
                        </div>
                    </div>
                )}

                {/* ── AI SCANNER ── */}
                {showAI && (
                    <div style={{ background: "#F5F3FF", borderRadius: 12, border: `1px solid #C4B5FD`, padding: "20px", marginBottom: 20, boxShadow: "0 4px 20px rgba(109,40,217,0.08)" }}>
                        <div style={{ fontSize: 15, fontWeight: 800, color: "#6D28D9", marginBottom: 8, display: "flex", gap: 8, alignItems: "center" }}>
                            <span>✨</span> Upload Court Document or Paste Text
                        </div>
                        <div style={{ fontSize: 13, color: "#5B21B6", marginBottom: 16, lineHeight: 1.6 }}>
                            Upload a PDF or paste the office report text. The AI will read the <b>Diary / Case Number</b>, detect defects, and assign tasks automatically.
                        </div>

                        {/* Error message */}
                        {scannerError && (
                            <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: "#991B1B", fontWeight: 600 }}>
                                {scannerError}
                            </div>
                        )}

                        <div style={{ marginBottom: 14 }}>
                            <label style={{ fontSize: 11, fontWeight: 800, color: "#6D28D9", letterSpacing: 1, marginBottom: 6, display: "block" }}>UPLOAD OFFICE REPORT (.PDF ONLY)</label>
                            <input
                                ref={fileInputRef}
                                type="file"
                                onChange={handleFileUpload}
                                accept=".pdf"
                                disabled={isScanning}
                                style={{ width: "100%", padding: "10px", borderRadius: 8, border: `1px dashed #A78BFA`, fontSize: 13, background: "#fff", color: "#5B21B6", cursor: "pointer" }}
                            />
                            {isScanning && (
                                <div style={{ fontSize: 12, color: "#6D28D9", marginTop: 6, fontWeight: 600 }}>
                                    ⏳ Extracting text from PDF... please wait
                                </div>
                            )}
                        </div>

                        <div style={{ fontSize: 11, fontWeight: 800, color: "#6D28D9", letterSpacing: 1, marginBottom: 6 }}>OR PASTE OFFICE REPORT TEXT</div>
                        <textarea
                            value={orText}
                            onChange={e => { setOrText(e.target.value); setScannerError(""); }}
                            placeholder="Paste Supreme Court Office Report text here..."
                            rows={5}
                            disabled={isScanning}
                            style={{ width: "100%", padding: "12px", borderRadius: 8, border: `1px solid #DDD6FE`, fontSize: 14, color: T.text, outline: "none", boxSizing: "border-box", marginBottom: 14, resize: "vertical", opacity: isScanning ? 0.6 : 1 }}
                        />

                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                            {isScanning && <span style={{ fontSize: 13, color: "#6D28D9", fontWeight: 700 }}>Processing with AI... ⏳</span>}
                            <button onClick={() => { setShowAI(false); setOrText(""); setScannerError(""); }} style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid #C4B5FD`, background: "#fff", color: "#6D28D9", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Close</button>
                            <button onClick={runAIScanner} disabled={isScanning || !orText.trim()} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: (isScanning || !orText.trim()) ? "#A78BFA" : "#7C3AED", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                                {isScanning ? "Processing..." : "Run Scanner"}
                            </button>
                        </div>
                    </div>
                )}

                {/* ── BULK ACTION BAR ── */}
                {showBulkBar && (
                    <div style={{ background: "#1E40AF", borderRadius: 10, padding: "12px 16px", marginBottom: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ color: "#fff", fontWeight: 700, fontSize: 13 }}>{selectedTasks.size} task(s) selected</span>
                        <button onClick={bulkMarkComplete} style={{ padding: "6px 14px", borderRadius: 6, background: "#10B981", color: "#fff", border: "none", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>✓ Mark Complete</button>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <input value={bulkAssignPerson} onChange={e => setBulkAssignPerson(e.target.value)} placeholder="Reassign to..." style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #93C5FD", fontSize: 12, outline: "none", width: 130 }} />
                            <button onClick={bulkReassign} disabled={!bulkAssignPerson.trim()} style={{ padding: "6px 12px", borderRadius: 6, background: "#3B82F6", color: "#fff", border: "none", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>Reassign</button>
                        </div>
                        <button onClick={() => setSelectedTasks(new Set())} style={{ marginLeft: "auto", padding: "6px 12px", borderRadius: 6, background: "transparent", color: "#93C5FD", border: "1px solid #93C5FD", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>Clear</button>
                    </div>
                )}

                {/* ── FILTERS + SEARCH ── */}
                <div style={{ background: T.surface, padding: "16px", borderRadius: 12, border: `1px solid ${T.border}`, marginBottom: 20 }}>
                    {/* Search bar */}
                    <div style={{ marginBottom: 14 }}>
                        <input
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="🔍  Search tasks by keyword, case title or person..."
                            style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 14, outline: "none", boxSizing: "border-box", background: T.bg, color: T.text }}
                        />
                    </div>
                    <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                        <div>
                            <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, letterSpacing: 1, marginBottom: 8 }}>ROLE / ASSIGNEE</div>
                            <div style={{ display: "flex", gap: 8 }}>
                                {["All", ...store.roles].map(r => <FilterButton key={r} label={r} active={roleFilter === r} onClick={() => setRoleFilter(r)} />)}
                            </div>
                        </div>
                        <div>
                            <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, letterSpacing: 1, marginBottom: 8 }}>STATUS</div>
                            <div style={{ display: "flex", gap: 8 }}>
                                {["All", "Pending", "Completed"].map(s => <FilterButton key={s} label={s} active={statusFilter === s} onClick={() => setStatusFilter(s)} />)}
                            </div>
                        </div>
                        <div>
                            <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, letterSpacing: 1, marginBottom: 8 }}>URGENCY</div>
                            <div style={{ display: "flex", gap: 8 }}>
                                {["All", "Critical", "High", "Medium", "Low"].map(u => <FilterButton key={u} label={u} active={urgencyFilter === u} onClick={() => setUrgencyFilter(u)} />)}
                            </div>
                        </div>
                        <div>
                            <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, letterSpacing: 1, marginBottom: 8 }}>CASE</div>
                            <select value={caseFilter} onChange={e => { setCaseFilter(e.target.value); setPartyFilter("All"); setPersonFilter("All"); }} style={{ padding: "7px 14px", borderRadius: 8, border: `1px solid ${caseFilter !== "All" ? T.accentDark : T.border}`, background: caseFilter !== "All" ? T.accentBg : T.bg, color: caseFilter !== "All" ? T.accentDark : T.textSub, fontSize: 13, fontWeight: 700, cursor: "pointer", outline: "none", minWidth: 200 }}>
                                <option value="All">All Cases</option>
                                {cases.filter(c => !c.archived).map(c => {
                                    const title = c.displayTitle || formatCaseTitleShort(c, 40);
                                    const ref = c.caseNumber ? c.caseNumber.split(" ")[0] + " " + (c.caseNumber.split(" ")[2] || "") : `D.No ${c.diaryNumber}`;
                                    return <option key={c.id} value={c.id}>{ref} • {title}</option>;
                                })}
                            </select>
                        </div>
                        {/* Party role filter */}
                        <div>
                            <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, letterSpacing: 1, marginBottom: 8 }}>PARTY ROLE</div>
                            <div style={{ display: "flex", gap: 8 }}>
                                {["All", "Petitioner", "Respondent"].map(p => (
                                    <FilterButton key={p} label={p === "All" ? "All" : p === "Petitioner" ? "⚖️ Pet." : "🛡 Resp."} active={partyFilter === p} onClick={() => { setPartyFilter(p); setPersonFilter("All"); }} />
                                ))}
                            </div>
                        </div>
                        {/* Client name filter — unique partyPerson values from visible tasks */}
                        {(() => {
                            const baseTasks = caseFilter === "All" ? allTasks : allTasks.filter(t => t.caseId === caseFilter);
                            const clients = [...new Set(
                                baseTasks
                                    .filter(t => partyFilter === "All" || t.party === partyFilter)
                                    .map((t: any) => t.partyPerson).filter(Boolean)
                            )] as string[];
                            if (clients.length === 0) return null;
                            return (
                                <div>
                                    <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, letterSpacing: 1, marginBottom: 8 }}>CLIENT</div>
                                    <select value={personFilter} onChange={e => setPersonFilter(e.target.value)} style={{ padding: "7px 14px", borderRadius: 8, border: `1px solid ${personFilter !== "All" ? T.accentDark : T.border}`, background: personFilter !== "All" ? T.accentBg : T.bg, color: personFilter !== "All" ? T.accentDark : T.textSub, fontSize: 13, fontWeight: 700, cursor: "pointer", outline: "none", minWidth: 200 }}>
                                        <option value="All">All Clients</option>
                                        {clients.map(p => <option key={p} value={p}>{p}</option>)}
                                    </select>
                                </div>
                            );
                        })()}
                    </div>
                </div>

                {/* ── TASK LIST ── */}
                {filtered.length === 0 ? (
                    <div style={{ background: T.surface, padding: 40, borderRadius: 12, textAlign: "center", border: `1px dashed ${T.border}` }}>
                        <div style={{ fontSize: 40, marginBottom: 12 }}>
                            {searchQuery ? "🔍" : "🎉"}
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>
                            {searchQuery ? `No tasks matching "${searchQuery}"` : "Inbox Zero — no tasks right now!"}
                        </div>
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

                        {/* Pending tasks */}
                        {pending.map(t => {
                            const uColor = getUrgencyColor(t.urgency);
                            const nowMs = new Date().setHours(0, 0, 0, 0);
                            const deadMs = t.deadline ? new Date(t.deadline).getTime() : null;
                            const isOverdue = deadMs !== null && deadMs < nowMs;
                            const isToday = deadMs !== null && deadMs === nowMs;
                            const is1Day = deadMs !== null && deadMs === nowMs + 86400000;
                            const is3Day = deadMs !== null && deadMs > nowMs + 86400000 && deadMs <= nowMs + 3 * 86400000;
                            const isSelected = selectedTasks.has(t.id);

                            return (
                                <div key={t.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 16px", background: isSelected ? "#EFF6FF" : T.surface, borderRadius: 12, border: isSelected ? `2px solid #3B82F6` : `1px solid ${T.border}`, boxShadow: T.shadow, transition: "all 0.15s" }}>

                                    {/* Checkbox for bulk select */}
                                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelectTask(t.id)} style={{ marginTop: 4, cursor: "pointer", width: 16, height: 16, flexShrink: 0 }} />

                                    {/* Status + Complete button */}
                                    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 90 }}>
                                        <div style={{ fontSize: 10, fontWeight: 800, padding: "3px 6px", borderRadius: 6, background: "#FEF3C7", color: "#D97706", border: `1px solid #FDE68A`, textAlign: "center" }}>
                                            PENDING
                                        </div>
                                        <button onClick={() => toggleTask(t.id, t.caseId)} style={{ padding: "5px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer", border: `1px solid #10B981`, background: "#10B981", color: "#fff", transition: "all 0.2s" }}>
                                            ✓ Complete
                                        </button>
                                    </div>

                                    {/* Task content */}
                                    <div style={{ flex: 1 }}>
                                        {/* Task text + AI badge */}
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8, gap: 8 }}>
                                            <div style={{ fontSize: 14, color: T.text, lineHeight: 1.5, fontWeight: 600, flex: 1 }}>{t.text}</div>
                                            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                                                {t.assignmentType === 'ai' && <span style={{ fontSize: 10, fontWeight: 800, color: "#166534", background: "#dcfce7", padding: "2px 7px", borderRadius: 4, border: "1px solid #bbf7d0" }}>🟢 AI</span>}
                                                {t.assignmentType === 'backup' && <span style={{ fontSize: 10, fontWeight: 800, color: "#854d0e", background: "#fef08a", padding: "2px 7px", borderRadius: 4, border: "1px solid #fde047" }}>🟡 Backup AI</span>}
                                                {t.assignmentType === 'standard' && <span style={{ fontSize: 10, fontWeight: 800, color: "#475569", background: "#f1f5f9", padding: "2px 7px", borderRadius: 4, border: "1px solid #cbd5e1" }}>⚪ Auto</span>}
                                            </div>
                                        </div>

                                        {/* Metadata row */}
                                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>

                                            {/* Urgency with override */}
                                            {editUrgencyTaskId === t.id ? (
                                                <select autoFocus value={t.urgency} onChange={e => saveUrgency(t.id, t.caseId, e.target.value)} onBlur={() => setEditUrgencyTaskId(null)} style={{ padding: "2px 6px", borderRadius: 6, fontSize: 12, border: `1px solid ${uColor.border}`, background: uColor.bg, color: uColor.text, fontWeight: 700 }}>
                                                    {["Critical", "High", "Medium", "Low"].map(u => <option key={u}>{u}</option>)}
                                                </select>
                                            ) : (
                                                <span onClick={() => setEditUrgencyTaskId(t.id)} title="Click to change urgency" style={{ color: uColor.text, background: uColor.bg, padding: "2px 8px", borderRadius: 6, border: `1px solid ${uColor.border}`, fontWeight: 700, cursor: "pointer" }}>
                                                    {t.urgency?.toUpperCase() || "MEDIUM"} ✎
                                                </span>
                                            )}

                                            {/* Party + client name badge */}
                                            {(t.party || t.partyPerson) && (
                                                <span style={{
                                                    fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 5,
                                                    background: t.party === "Petitioner" ? "#DBEAFE" : "#FEF3C7",
                                                    color: t.party === "Petitioner" ? "#1E40AF" : "#92400E",
                                                    border: t.party === "Petitioner" ? "1px solid #BFDBFE" : "1px solid #FDE68A",
                                                    maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                                }}>
                                                    {t.party === "Petitioner" ? "⚖️ Petitioner" : t.party === "Respondent" ? "🛡 Respondent" : ""}
                                                    {t.partyPerson ? ` · ${t.partyPerson}` : ""}
                                                </span>
                                            )}

                                            {/* Assignee role badge */}
                                            {t.assignee && (
                                                <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 5, background: T.bg, color: T.textMuted, border: `1px solid ${T.borderSoft}` }}>
                                                    👤 {t.assignee}
                                                </span>
                                            )}

                                            {/* Deadline with edit */}
                                            {editDeadlineTaskId === t.id ? (
                                                <div style={{ display: "flex", gap: 4 }}>
                                                    <input type="date" autoFocus value={editDeadlineValue} onChange={e => setEditDeadlineValue(e.target.value)} style={{ padding: "2px 6px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 12 }} />
                                                    <button onClick={() => saveDeadline(t.id, t.caseId)} style={{ padding: "2px 8px", borderRadius: 6, background: "#10B981", color: "#fff", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>Save</button>
                                                    <button onClick={() => setEditDeadlineTaskId(null)} style={{ padding: "2px 8px", borderRadius: 6, background: T.bg, border: `1px solid ${T.border}`, cursor: "pointer", fontSize: 11 }}>✕</button>
                                                </div>
                                            ) : (
                                                t.deadline && (
                                                    <span
                                                        onClick={() => { setEditDeadlineTaskId(t.id); setEditDeadlineValue(t.deadline?.split('T')[0] || ""); }}
                                                        title="Click to edit deadline"
                                                        style={{ color: isOverdue ? "#DC2626" : (isToday ? "#991B1B" : (is1Day ? "#B45309" : (is3Day ? "#854D0E" : T.textSub))), background: isOverdue ? "#FEE2E2" : (isToday ? "#FECACA" : (is1Day ? "#FEF3C7" : (is3Day ? "#FEF9C3" : "transparent"))), padding: "2px 8px", borderRadius: 6, border: isOverdue ? "1px solid #FCA5A5" : (isToday ? "1px solid #F87171" : (is1Day ? "1px solid #FCD34D" : (is3Day ? "1px solid #FEF08A" : `1px solid ${T.borderSoft}`))), display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontWeight: 600 }}>
                                                        📅 {fmtDate(t.deadline)}
                                                        {isOverdue && <span style={{ fontWeight: 800 }}>⚠ Overdue</span>}
                                                        {isToday && <span style={{ fontWeight: 800 }}>⚠ Due Today</span>}
                                                        {is1Day && <span>Due Tomorrow</span>}
                                                        {is3Day && <span>Due in 3 Days</span>}
                                                        <span style={{ opacity: 0.6, fontSize: 10 }}>✎</span>
                                                    </span>
                                                )
                                            )}

                                            {/* Case title */}
                                            <span style={{ color: T.textSub, marginLeft: "auto", fontSize: 11 }}>📁 {t.caseTitle}</span>
                                        </div>

                                        {/* Deadline label + statutory note */}
                                        {(t.deadlineLabel || t.statutoryNote) && (
                                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                                                {t.deadlineLabel && (
                                                    <span style={{ fontSize: 11, color: "#6366F1", background: "#EEF2FF", padding: "2px 8px", borderRadius: 5, border: "1px solid #C7D2FE", fontWeight: 600 }}>
                                                        ⏱ {t.deadlineLabel}
                                                    </span>
                                                )}
                                                {t.statutoryNote && (
                                                    <span style={{ fontSize: 11, color: "#6B7280", background: "#F3F4F6", padding: "2px 8px", borderRadius: 5, border: "1px solid #E5E7EB", fontWeight: 500 }}>
                                                        📋 {t.statutoryNote}
                                                    </span>
                                                )}
                                            </div>
                                        )}

                                    </div>
                                </div>
                            );
                        })}

                        {/* Completed tasks — collapsed by default */}
                        {completed.length > 0 && (
                            <div style={{ marginTop: 8 }}>
                                <button onClick={() => setShowCompleted(!showCompleted)} style={{ width: "100%", padding: "10px 16px", borderRadius: 10, border: `1px dashed ${T.border}`, background: T.surface, color: T.textMuted, fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                                    {showCompleted ? "▲ Hide" : "▼ Show"} {completed.length} completed task{completed.length !== 1 ? "s" : ""}
                                </button>

                                {showCompleted && (
                                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                                        {completed.map(t => (
                                            <div key={t.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 16px", background: T.surface, borderRadius: 10, border: `1px solid ${T.borderSoft}`, opacity: 0.65 }}>
                                                <input type="checkbox" checked={selectedTasks.has(t.id)} onChange={() => toggleSelectTask(t.id)} style={{ marginTop: 4, cursor: "pointer", width: 16, height: 16, flexShrink: 0 }} />
                                                <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 90 }}>
                                                    <div style={{ fontSize: 10, fontWeight: 800, padding: "3px 6px", borderRadius: 6, background: "#ECFDF5", color: "#059669", border: `1px solid #A7F3D0`, textAlign: "center" }}>DONE</div>
                                                    <button onClick={() => toggleTask(t.id, t.caseId)} style={{ padding: "4px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer", border: `1px solid ${T.border}`, background: T.bg, color: T.textSub }}>Reopen</button>
                                                </div>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ fontSize: 13, color: T.textSub, textDecoration: "line-through", fontWeight: 500 }}>{t.text}</div>
                                                    <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                                                        {(t.party || t.partyPerson) && (
                                                            <span style={{ fontWeight: 700, padding: "1px 7px", borderRadius: 4, background: t.party === "Petitioner" ? "#DBEAFE" : "#FEF3C7", color: t.party === "Petitioner" ? "#1E40AF" : "#92400E", border: t.party === "Petitioner" ? "1px solid #BFDBFE" : "1px solid #FDE68A" }}>
                                                                {t.party === "Petitioner" ? "⚖️" : "🛡"} {t.partyPerson || t.party}
                                                            </span>
                                                        )}
                                                        <span>👤 {t.assignee}</span>
                                                        <span>📁 {t.caseTitle}</span>
                                                        {t.completedAt && <span>✓ Completed {fmtDate(t.completedAt)}</span>}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

        </>
    );
}