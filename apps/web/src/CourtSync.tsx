import { useState, useMemo, useEffect, useRef } from "react";
import { AppContext } from "./AppContext";
import { LIGHT_THEME, DARK_THEME } from "./themes";
import { ALL_LABELS, LABEL_COLORS, matchesSearch, sortCases, fmtDate, fmtDT, getDaysUntil, hearingLabel, Badge, DR, SectionHead } from "./caseHelpers";
import { formatCaseTitle, formatCaseTitleShort, formatParty } from "./utils/caseTitle";
import { generateOfficeReportUrl, generateLastOrderUrl, discoverMCPTools, clearCaseCache, fetchCaseFullByCNR, fetchSCDiaryStatus, triggerCaseRefresh } from "./services/eCourtsService";
import { transformMCPToCase } from "./utils/apiTransform";
import SearchCaseForm, { transformApiToCase } from "./components/SearchCaseForm";
import axios from "axios";
import { saveSearchHistory, checkStorageHealth, exportAllData, StorageHealth } from "./services/localStorageService";
import { loadCases, saveCasesArray, saveCaseReturningRow, archiveCaseById } from "./services/supabaseCasesService";
import { loadSettingsFromSupabase, initSettingsSync } from "./store/settingsStore";
import { checkMigrationNeeded, runDataMigration, skipMigration, MigrationStatus } from "./services/dataMigrationService";
import { supabase } from "./lib/supabaseClient";
import { DonutChart, CourtBarChart, UpcomingHearings, CaseCard, GalleryCard, TableView, KanbanView } from "./components/CaseViews";
import CauseList from "./components/CauseList";
import TasksDashboard from "./components/TasksDashboard";
import SettingsDashboard from "./components/Settings/SettingsDashboard";
import AIAnalysisHub from "./components/AIAnalysisHub";
import ServiceStatus from "./components/ServiceStatus";
import { CaseSummarySection, ListingsSection, TimelineSection, TasksSection, NotesSection, ApplicationsSection, LexTigressOfficeReportSection, LastOrdersSection, EarlierCourtSection, SCDetailSection } from "./components/DetailSections";
import { LowerCourtStatusSection } from "./components/LowerCourtStatusSection";
import { DocumentsSection } from "./components/DocumentsSection";
import { FilingBundleSection } from "./components/FilingBundleSection";
import { DefectsSection } from "./components/DefectsSection";
import { SearchInfo, BellPanel, ConfirmDialog, CaseModal } from "./components/Modals";
// Removed LexAssistant import
import VoiceNoteRecorder from "./components/Notes/VoiceNoteRecorder";
import VoiceNotesPage from "./components/Notes/VoiceNotesPage";
import CommunicationHub from "./components/CommunicationHub";


// Migration for existing cases to fix Unknown vs Unknown
(function migrateCases() {
    try {
        const raw = localStorage.getItem("lextgress_cases");
        if (!raw) return;
        const cases = JSON.parse(raw);
        let changed = false;

        const migrated = cases.map((c: any) => {
            // If petitioner/respondent missing but parties exists, try to rebuild
            if ((!c.petitioner || !c.respondent) && c.parties) {
                const parts = c.parties.split(/\svs?\.?\s|\sVS?\.?\s/i);
                c.petitioner = c.petitioner || parts[0]?.trim() || '';
                c.respondent = c.respondent || parts[1]?.trim() || '';
                changed = true;
            }

            // Fix diaryNumber if missing (old cases stored field as diaryNo)
            if (!c.diaryNumber && c.diaryNo) {
                c.diaryNumber = String(c.diaryNo);
                changed = true;
            }

            // Ensure listings is always an array
            if (!Array.isArray(c.listings)) {
                c.listings = [];
                changed = true;
            }

            // Ensure court fields are set (hardcoded for SC cases)
            if (!c.courtNumber) { c.courtNumber = 'Court No. 1'; changed = true; }
            if (!c.timeOfSitting) { c.timeOfSitting = '10:30 AM'; changed = true; }
            if (c.archived === undefined) { c.archived = false; changed = true; }

            // Re-calculate displayTitle if it's "Unknown vs Unknown" or missing
            if (!c.displayTitle || c.displayTitle.includes("Unknown")) {
                const newTitle = formatCaseTitle(c);
                if (newTitle !== c.displayTitle) {
                    c.displayTitle = newTitle;
                    changed = true;
                }
            }

            // Normalize status: old eCourts cases may have stored lowercase ('active', 'pending', 'disposed')
            // or wrong values ('closed', 'defective') that don't match STATUS_STYLES keys
            const statusNormMap: Record<string, string> = {
                'active': 'Pending', 'ACTIVE': 'Pending',
                'pending': 'Pending', 'PENDING': 'Pending',
                'disposed': 'Disposed', 'DISPOSED': 'Disposed',
                'closed': 'Disposed', 'CLOSED': 'Disposed',
                'defective': 'Pending', 'DEFECTIVE': 'Pending',
                'fresh': 'Fresh', 'FRESH': 'Fresh',
            };
            if (c.status && statusNormMap[c.status] && statusNormMap[c.status] !== c.status) {
                c.status = statusNormMap[c.status];
                changed = true;
            }

            return c;
        });

        if (changed) {
            localStorage.setItem("lextgress_cases", JSON.stringify(migrated));
        }
    } catch (e) {
        console.error("Migration failed", e);
    }
})();

// Legacy key migration: copy old data to new key on first load
(function migrateOldData() {
    try {
        const OLD_KEY = "courtsync_cases_v1";
        if (!localStorage.getItem("lextgress_cases") && localStorage.getItem(OLD_KEY)) {
            localStorage.setItem("lextgress_cases", localStorage.getItem(OLD_KEY)!);
        }
    } catch { }
})();

// ── TOP-LEVEL NAVIGATION (matches original sidebar) ───────────────────────────
const MAIN_NAV = [
    { id: "cases", label: "Cases", icon: "⚖" },
    { id: "causelist", label: "Tentative Cause List", icon: "📑" },
    { id: "tasks", label: "Tasks & Deadlines", icon: "✓" },
    { id: "documents", label: "Documents", icon: "📄" },
    { id: "communication", label: "Communication Hub", icon: "💬" },
    { id: "ai", label: "AI Analysis Hub", icon: "✦" },
    { id: "service", label: "Service Status", icon: "📡" },
    { id: "voice", label: "Voice Notes", icon: "🎙" },
    { id: "settings", label: "Settings", icon: "⚙️" },
];

// Sub-filters shown only when Cases view is active
const CASE_FILTERS = [
    { label: "All Cases", icon: "▦" },
    { label: "Pending", icon: "⏱" },
    { label: "Fresh", icon: "✦" },
    { label: "Disposed", icon: "✓" },
];

const SORT_OPTIONS = [
    { value: "default", label: "Default" },
    { value: "hearing", label: "Hearing Date" },
    { value: "filing", label: "Filing Date" },
    { value: "status", label: "Status" },
    { value: "name", label: "Name (A–Z)" },
];

// ── COMING SOON PLACEHOLDER ───────────────────────────────────────────────────
function ComingSoon({ icon, title, subtitle, T }: { icon: string; title: string; subtitle: string; T: any }) {
    return (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 20, padding: 40 }}>
            <div style={{
                width: 80, height: 80, borderRadius: 22,
                background: "linear-gradient(135deg,#1A2E5E,#2A4B9B)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 36, boxShadow: "0 8px 32px rgba(15,28,63,0.2)",
            }}>{icon}</div>
            <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: T.text, marginBottom: 8, letterSpacing: -0.4 }}>{title}</div>
                <div style={{ fontSize: 15, color: T.textMuted, lineHeight: 1.8, maxWidth: 380 }}>{subtitle}</div>
            </div>
            <div style={{
                padding: "10px 24px", borderRadius: 30,
                background: "linear-gradient(135deg,#C9A84C,#9B7B28)",
                color: "#fff", fontSize: 14, fontWeight: 700,
                boxShadow: "0 4px 16px rgba(201,168,76,0.35)",
                letterSpacing: 0.3,
            }}>
                Coming Soon
            </div>
        </div>
    );
}



const COMING_SOON: Record<string, { icon: string; title: string; subtitle: string }> = {
    tasks: { icon: "✓", title: "Tasks & Deadlines", subtitle: "Track your case tasks, deadlines, and reminders all in one place. Set due dates, assign priorities, and never miss a court deadline again." },
    documents: { icon: "📁", title: "Documents", subtitle: "Securely store and organise all your case documents, pleadings, orders, and notices. Full-text search and version history coming soon." },
    ai: { icon: "✦", title: "AI Analysis Hub", subtitle: "Leverage AI to analyse judgments, predict outcomes, summarise case facts, and draft pleadings. Powered by advanced legal language models." },
    service: { icon: "📡", title: "Service Status", subtitle: "Monitor the real-time health of the Supreme Court API, listing services, and connected integrations from a single dashboard." },
    notify: { icon: "🔔", title: "Notifications", subtitle: "Get instant alerts when your case is listed, an order is uploaded, or a hearing date changes. Configure via email, SMS, or push." },
    voice: { icon: "🎙", title: "Voice Notes", subtitle: "Record voice memos during hearings, auto-transcribe them, and link them directly to case records for a seamless workflow." },
};

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function CourtSync() {
    const [isDark, setIsDark] = useState(() => {
        try { const s = localStorage.getItem("courtsync_dark"); return s ? JSON.parse(s) : false; } catch { return false; }
    });
    const T = isDark ? DARK_THEME : LIGHT_THEME;

    const getS = (s: string) => {
        if (s === "Pending") return T.pending;
        if (s === "Fresh") return T.fresh;
        if (s === "Disposed") return T.disposed;
        return T.archived;
    };
    const hearingColor = (days: number | null): string => {
        if (days === null || days < 0) return T.textMuted;
        if (days === 0) return "#C62828";
        if (days <= 3) return "#9B7B28";
        return T.textMuted;
    };

    useEffect(() => { localStorage.setItem("courtsync_dark", JSON.stringify(isDark)); }, [isDark]);

    // ── STATE ──────────────────────────────────────────────────────────────────
    const [cases, setCases] = useState<any[]>([]);
    const [activeView, setActiveView] = useState("cases");        // top-level nav
    const [statusFilter, setStatusFilter] = useState("All Cases");    // case sub-filter
    const [courtFilter, setCourtFilter] = useState("All Courts");    // court type filter
    const [labelFilter, setLabelFilter] = useState<string[]>([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [selected, setSelected] = useState<any>(null);
    const [collapsed, setCollapsed] = useState(false);
    const [showAdd, setShowAdd] = useState(false);
    const [showEdit, setShowEdit] = useState(false);
    const [detailClosed, setDetailClosed] = useState(false);
    const [detailFullscreen, setDetailFullscreen] = useState(false);
    const [activeTab, setActiveTab] = useState("courts");
    const [searchFocus, setSearchFocus] = useState(false);
    const [sortBy, setSortBy] = useState("default");
    const [showBell, setShowBell] = useState(false);
    const [showArchived, setShowArchived] = useState(false);
    const [viewMode, setViewMode] = useState("list");
    const [confirm, setConfirm] = useState<any>(null);
    const [successToast, setSuccessToast] = useState<string | null>(null);
    const [storageWarn, setStorageWarn] = useState(false);
    const [migrationStatus, setMigrationStatus] = useState<MigrationStatus | null>(null);
    const [migrating, setMigrating] = useState(false);
    const [storageHealth, setStorageHealth] = useState<StorageHealth>({ usedKB: "0", percent: 0, isWarning: false });
    const [refreshingId, setRefreshingId] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [user, setUser] = useState<any>(null);
    const [fetchAllTrigger, setFetchAllTrigger] = useState(0);
    const [initialLoading, setInitialLoading] = useState(true);
    const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
    const logoLongPressTimer = useRef<any>(null);


    // Load cases from Supabase on mount
    useEffect(() => {
        loadCases().then((data) => {
            setCases(data);
            setInitialLoading(false);
        });
    }, []);

    // Advance list PDF scanning removed — likelyListedOn comes only from eCourts API (nextHearingDate)

    useEffect(() => {
        if (cases.length === 0) return;
        const active = cases.filter(c => !c.archived);
        if (active.length === 0) return;

        import('./services/lowerCourtSyncService').then(m => {
            m.refreshStaleCases(active, (updated: any) => {
                setCases(prev => prev.map(x => x.id === updated.id ? updated : x));
            });
        });
    }, []); // Run once on mount

    // Background: fetch SC diary status (lastListedOn) for cases that are missing it
    useEffect(() => {
        if (cases.length === 0) return;
        const missing = cases.filter(c =>
            !c.archived && !c.lastListedOn && c.diaryNumber && c.diaryYear
        );
        if (missing.length === 0) return;

        let cancelled = false;
        (async () => {
            for (const c of missing) {
                if (cancelled) break;
                try {
                    const status = await fetchSCDiaryStatus(c.diaryNumber, c.diaryYear);
                    if (cancelled) break;
                    if (!status?.lastListedOn && !status?.tentativeDate) continue;
                    const update: any = {};
                    if (status.lastListedOn) update.lastListedOn = status.lastListedOn;
                    if (status.tentativeDate) update.likelyListedOn = status.tentativeDate;
                    setCases(prev => prev.map(x => x.id === c.id ? { ...x, ...update } : x));
                    saveCasesArray([{ ...c, ...update }]);
                } catch { /* ignore */ }
                // small delay between requests to avoid hammering SC server
                await new Promise(r => setTimeout(r, 1500));
            }
        })();

        return () => { cancelled = true; };
    }, [cases.length]);

    useEffect(() => {
        supabase.auth.getUser().then(async ({ data: { user: authUser } }) => {
            if (!authUser) return;
            const { data: profile } = await supabase
                .from('user_profiles')
                .select('full_name, role, search_limit, team_id')
                .eq('id', authUser.id)
                .single();
            setUser({
                id: authUser.id,
                email: authUser.email,
                name: profile?.full_name || authUser.email,
                role: profile?.role || 'Advocate',
                searchLimit: profile?.search_limit ?? null,
                teamId: profile?.team_id || null,
            });
        });
    }, []);

    // Discover MCP tools on app mount
    useEffect(() => {
        discoverMCPTools()
    }, []);

    // Load settings from Supabase + subscribe to auto-save on changes
    useEffect(() => {
        loadSettingsFromSupabase();
        const unsubscribe = initSettingsSync();
        return unsubscribe;
    }, []);

    // Check if existing localStorage data needs to be migrated to Supabase
    useEffect(() => {
        checkMigrationNeeded().then((status) => {
            if (status.needed) setMigrationStatus(status);
        });
    }, []);

    const handleLogout = async () => {
        await supabase.auth.signOut();
        window.location.reload();
    };
    const [forceShowAI, setForceShowAI] = useState(false);
    const [previewCase, setPreviewCase] = useState<any>(null);
    const bellRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Debounce saves — wait 2s after last change before persisting
        const timer = setTimeout(async () => {
            await saveCasesArray(cases);
        }, 2000);
        return () => clearTimeout(timer);
    }, [cases]);
    useEffect(() => {
        if (!successToast) return;
        const t = setTimeout(() => setSuccessToast(null), 3000);
        return () => clearTimeout(t);
    }, [successToast]);

    // ── ECOURTS DATA FETCHING ──────────────────────────────────────────────────
    // fetchEarlierCourt auto-fetch removed — EarlierCourtSection in DetailSections.tsx
    // handles it with cache-first logic (auto-loads if cached ₹0, button otherwise ₹0.50).

    // ── GENERATE OFFICE REPORT AND ORDER URLs ──────────────────────────────────
    useEffect(() => {
        if (!selected) return;

        const officeReportUrl = generateOfficeReportUrl(selected.diaryNumber?.toString() || '', selected.diaryYear?.toString() || '');
        const lastOrderUrl = generateLastOrderUrl(selected.diaryNumber?.toString() || '', selected.diaryYear?.toString() || '');

        if ((officeReportUrl !== '#' && selected.officeReportUrl !== officeReportUrl) ||
            (lastOrderUrl !== '#' && selected.lastOrdersUrl !== lastOrderUrl)) {
            handleSaveCase({
                ...selected,
                officeReportUrl: officeReportUrl !== '#' ? officeReportUrl : selected.officeReportUrl,
                lastOrdersUrl: lastOrderUrl !== '#' ? lastOrderUrl : selected.lastOrdersUrl
            });
        }
    }, [selected?.diaryNumber, selected?.diaryYear]);

    // ── DERIVED ────────────────────────────────────────────────────────────────
    const activeCases = cases.filter(c => !c.archived);
    const counts = {
        Pending: activeCases.filter(c => c.status === "Pending").length,
        Fresh: activeCases.filter(c => c.status === "Fresh").length,
        Disposed: activeCases.filter(c => c.status === "Disposed").length,
    };
    const upcomingThisWeek = activeCases.filter(c => {
        const d = getDaysUntil(c.nextHearingDate);
        return d !== null && d >= 0 && d <= 7 && c.status !== "Disposed";
    }).length;

    // Bell count = unread hearings + unread pending tasks (reads from persisted read state)
    const bellUnreadCount = (() => {
        try {
            const readState: Record<string, boolean> = JSON.parse(localStorage.getItem('lextgress_notifications') || '{}');
            const unreadHearings = activeCases.filter(c => {
                const d = getDaysUntil(c.nextHearingDate);
                return d !== null && d >= 0 && d <= 7 && c.status !== "Disposed" && !readState[c.id];
            }).length;
            const unreadTasks = cases.flatMap(c => (c.tasks || []).filter((t: any) => !t.done))
                .filter((t: any) => !readState[t.id])
                .slice(0, 3).length;
            return unreadHearings + unreadTasks;
        } catch { return upcomingThisWeek; }
    })();


    const getCourtType = (c: any): string => {
        const ct = c.lowerCourtStatus?.courtType || '';
        if (ct.toLowerCase().includes('high')) return 'High Court';
        if (ct.toLowerCase().includes('trial') || ct.toLowerCase().includes('district')) return 'Trial Court';
        return 'Supreme Court';
    };

    const filtered = useMemo(() => {
        const pool = showArchived ? cases.filter(c => c.archived) : activeCases;
        const base = pool.filter(c => {
            const okStatus = statusFilter === "All Cases" || c.status === statusFilter;
            const okLabel = labelFilter.length === 0 || labelFilter.some(l => c.labels.includes(l));
            const okCourt = courtFilter === "All Courts" || getCourtType(c) === courtFilter;
            return okStatus && okLabel && okCourt && matchesSearch(c, searchTerm);
        });
        return sortCases(base, sortBy);
    }, [cases, statusFilter, labelFilter, courtFilter, searchTerm, sortBy, showArchived]);

    const hasFilters = searchTerm || labelFilter.length > 0 || statusFilter !== "All Cases" || courtFilter !== "All Courts";

    // ── HANDLERS ───────────────────────────────────────────────────────────────
    function handleSaveCase(saved: any) {
        // Auto-archive when status changes to Disposed
        const shouldAutoArchive = saved.status === 'Disposed' && !saved.archived;
        const finalCase = shouldAutoArchive ? { ...saved, archived: true } : saved;

        setCases(prev => {
            const idx = prev.findIndex(c => c.id === finalCase.id);
            if (idx === -1) return [finalCase, ...prev];
            const n = [...prev]; n[idx] = finalCase; return n;
        });
        setSelected(finalCase);

        if (shouldAutoArchive) {
            setSuccessToast('Case is Disposed — moved to Archive automatically.');
        }
    }
    function handleUpdateMultipleCases(updatedList: any[]) {
        setCases(prev => {
            const next = [...prev];
            updatedList.forEach(updated => {
                const idx = next.findIndex(c => c.id === updated.id);
                if (idx !== -1) next[idx] = updated;
            });
            return next;
        });
    }
    function handleArchiveToggle(caseId: string) {
        const c = cases.find(x => x.id === caseId);
        const newArchived = !(c?.archived);
        setCases(prev => prev.map(x => x.id === caseId ? { ...x, archived: newArchived } : x));
        if (selected?.id === caseId) setSelected((p: any) => ({ ...p, archived: newArchived }));
        setConfirm(null);
        // Persist immediately — don't rely solely on the 2-second debounce
        archiveCaseById(caseId, newArchived).catch(err => console.warn('[archive] persist failed', err));
    }
    // "Delete" is a soft-delete — the case moves to Archive instead of being permanently removed.
    // A permanent hard-delete option is available from within the Archive view.
    function handleDelete(caseId: string) {
        setCases(prev => prev.map(c => c.id === caseId ? { ...c, archived: true } : c));
        if (selected?.id === caseId) {
            setSelected((p: any) => ({ ...p, archived: true }));
            // Deselect so the detail panel closes after archiving
            setSelected(null);
        }
        setConfirm(null);
        setSuccessToast('Case moved to Archive.');
        // Persist immediately — don't rely solely on the 2-second debounce
        archiveCaseById(caseId, true).catch(err => console.warn('[delete/archive] persist failed', err));
    }
    async function handleBulkRestore() {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;
        
        // Update local state
        setCases(prev => prev.map(c => ids.includes(c.id) ? { ...c, archived: false } : c));
        
        // Update currently selected case if it was restored
        if (selected && ids.includes(selected.id)) {
            setSelected((prev: any) => ({ ...prev, archived: false }));
        }

        // Persist to Supabase immediately
        for (const id of ids) {
            await archiveCaseById(id, false).catch(err => console.warn('[bulk restore] persist failed', id, err));
        }
        
        setSelectedIds(new Set());
        setSuccessToast(`Restored ${ids.length} cases to active list.`);
    }
    async function handleBulkPermanentDelete(idsToUse?: string[]) {
        const ids = idsToUse || Array.from(selectedIds);
        if (ids.length === 0) return;
        
        setCases(prev => prev.filter(c => !ids.includes(c.id)));
        
        // Clear selection first to hide the bar immediately
        setSelectedIds(new Set());
        
        // If the currently selected case is being deleted, close detail panel
        if (selected && ids.includes(selected.id)) {
            setSelected(null);
        }

        import('./services/supabaseCasesService').then(async m => {
            for (const id of ids) {
                try {
                    await m.hardDeleteCaseById(id);
                } catch (e) {
                    console.error("Failed to delete case", id, e);
                }
            }
        });

        setConfirm(null);
        setSuccessToast(`Permanently deleted ${ids.length} case${ids.length !== 1 ? 's' : ''}.`);
    }
    function toggleSelect(id: string) {
        setSelectedIds(prev => {
            const n = new Set(prev);
            if (n.has(id)) n.delete(id); else n.add(id);
            return n;
        });
    }
    function handleSelectAll(filteredItems: any[]) {
        const allFilteredIds = filteredItems.map(c => c.id);
        const allAlreadySelected = allFilteredIds.every(id => selectedIds.has(id));
        
        if (allAlreadySelected) {
            setSelectedIds(prev => {
                const n = new Set(prev);
                allFilteredIds.forEach(id => n.delete(id));
                return n;
            });
        } else {
            setSelectedIds(prev => {
                const n = new Set(prev);
                allFilteredIds.forEach(id => n.add(id));
                return n;
            });
        }
    }
    async function handleCaseFound(caseData: any) {
        // Part 6 — Save diary search to history
        if (caseData.diaryNumber && caseData.diaryYear) {
            saveSearchHistory(caseData.diaryNumber, caseData.diaryYear);
        }

        // Immediately persist to Supabase and get back the authoritative UUID so that
        // subsequent archive/delete calls (which use .eq('id', uuid)) work correctly.
        const saved = await saveCaseReturningRow(caseData).catch(() => null);
        const finalData = saved || caseData;

        setCases(prev => {
            // Prefer Supabase UUID match first, then CNR, then diary no + year
            const exists = prev.findIndex(c => {
                if (finalData.id && c.id === finalData.id) return true;
                if (finalData.cnrNumber && c.cnrNumber)
                    return c.cnrNumber === finalData.cnrNumber;
                if (finalData.diaryNumber && finalData.diaryYear && c.diaryNumber && c.diaryYear)
                    return c.diaryNumber === finalData.diaryNumber && c.diaryYear === finalData.diaryYear;
                return false;
            });
            if (exists !== -1) {
                const existing = prev[exists];
                // Merge ALL listings from fresh API data (not just the first one)
                const existingListings = [...(existing.listings || [])];
                const newListings = Array.isArray(finalData.listings) ? finalData.listings : [];
                newListings.forEach((nl: any) => {
                    if (nl.date && !existingListings.find((l: any) => l.date === nl.date)) {
                        existingListings.push(nl);
                    }
                });
                existingListings.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
                const merged = { ...existing, ...finalData, id: existing.id, timeline: existing.timeline, tasks: existing.tasks, notes: existing.notes, documents: existing.documents, applications: existing.applications, listings: existingListings };
                const n = [...prev]; n[exists] = merged;
                return n;
            }
            return [finalData, ...prev];
        });
        setSelected((prev: any) => {
            if (!prev) return finalData;
            const mergedListings = [...(prev.listings || [])];
            const newListings = Array.isArray(finalData.listings) ? finalData.listings : [];
            newListings.forEach((nl: any) => {
                if (nl.date && !mergedListings.find((l: any) => l.date === nl.date)) {
                    mergedListings.push(nl);
                }
            });
            mergedListings.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
            return { ...prev, ...finalData, id: prev.id, timeline: prev.timeline, tasks: prev.tasks, notes: prev.notes, documents: prev.documents, applications: prev.applications, listings: mergedListings };
        });
        setStatusFilter("All Cases"); setCourtFilter("All Courts"); setShowArchived(false);

        // Prompt user to upload the real office report — never auto-generate with fake text
        setSuccessToast(`✅ Case ${finalData.caseNumber || finalData.diaryNumber} added. Upload the Office Report PDF in Team Inbox to generate tasks.`);

        // Background: fetch SC website diary status to get Last Listed On + Tentatively Listed On
        // (eCourts partner API doesn't return these — SC website does)
        if (finalData.diaryNumber && finalData.diaryYear) {
            fetchSCDiaryStatus(finalData.diaryNumber, finalData.diaryYear).then(scStatus => {
                if (!scStatus) return;
                const { lastListedOn, tentativeDate } = scStatus;
                if (!lastListedOn && !tentativeDate) return;
                setCases(prev => prev.map(c => {
                    const match = finalData.cnrNumber
                        ? c.cnrNumber === finalData.cnrNumber
                        : c.diaryNumber === finalData.diaryNumber && c.diaryYear === finalData.diaryYear;
                    if (!match) return c;
                    return {
                        ...c,
                        ...(lastListedOn ? { lastListedOn } : {}),
                        ...(tentativeDate ? { likelyListedOn: tentativeDate } : {}),
                    };
                }));
            });
        }
    }

    async function handleRefreshCase(c: any) {
        if (!c.cnrNumber) {
            alert("No CNR number available for this case — cannot refresh via eCourts API.");
            return;
        }
        clearCaseCache(c.cnrNumber);
        setRefreshingId(c.id);
        try {
            // Trigger eCourts to scrape fresh data, then wait for it to complete
            await triggerCaseRefresh(c.cnrNumber);
            await new Promise(resolve => setTimeout(resolve, 8000));
            const [data, scDiaryStatus] = await Promise.all([
                fetchCaseFullByCNR(c.cnrNumber, true),
                (c.diaryNumber && c.diaryYear)
                    ? fetchSCDiaryStatus(c.diaryNumber, c.diaryYear)
                    : Promise.resolve(null),
            ]);
            if (data) {
                const refreshed = transformMCPToCase(data, c.cnrNumber);
                // Guaranteed fallback: eCourts sometimes uses nextHearingDate for last listed date
                // (when the case was heard but no future date is set yet)
                const raw = data?.data?.courtCaseData || data;
                const toISO = (s: string) => {
                    if (!s) return '';
                    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
                    const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
                    return m ? `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` : s;
                };
                if (!refreshed.lastListedOn && raw?.lastHearingDate)
                    refreshed.lastListedOn = toISO(raw.lastHearingDate);
                // If likelyListedOn is a past date, it means eCourts put the last listed date there
                const todayStr = new Date().toISOString().slice(0, 10);
                if (!refreshed.lastListedOn && refreshed.likelyListedOn && refreshed.likelyListedOn < todayStr) {
                    refreshed.lastListedOn = refreshed.likelyListedOn;
                    refreshed.likelyListedOn = null;
                }
                // Overlay SC website dates (more accurate than eCourts partner API)
                if (scDiaryStatus?.lastListedOn) refreshed.lastListedOn = scDiaryStatus.lastListedOn;
                if (scDiaryStatus?.tentativeDate) refreshed.likelyListedOn = scDiaryStatus.tentativeDate;
                handleCaseFound(refreshed);
            } else {
                alert("Case not found or eCourts API busy. Try again later.");
            }
        } catch (err) {
            console.error("Error refreshing case", err);
            alert("Error refreshing case from eCourts API.");
        } finally {
            setRefreshingId(null);
        }
    }

    async function handleCasePreview(caseInfo: any) {
        const cnr = caseInfo.cnrNumber || caseInfo.cnr;
        if (!cnr) {
            alert("No CNR number available for preview.");
            return;
        }
        setSuccessToast("Fetching case details for preview...");
        try {
            const data = await fetchCaseFullByCNR(cnr);
            if (data) {
                const fullCaseData = transformMCPToCase(data, cnr);
                setPreviewCase(fullCaseData);
            } else {
                alert("Case details not found.");
            }
        } catch (err) {
            console.error("Error fetching preview", err);
            alert("Error fetching case details from eCourts API.");
        }
    }

    function handleExportListPdf() {
        let rows = "";
        filtered.forEach((c: any, index: number) => {
            rows += `
                <tr>
                    <td style="text-align: center;">${index + 1}</td>
                    <td><strong>${c.diaryNumber}/${c.diaryYear}</strong><br/>${c.caseType} ${c.shortCaseNumber}</td>
                    <td>${c.displayTitle || formatCaseTitleShort(c)}</td>
                    <td style="font-weight:bold; text-align:center;">${c.status.toUpperCase()}</td>
                </tr>
            `;
        });

        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Lex Tigress Case List</title>
                <style>
                    body { font-family: 'Times New Roman', Times, serif; color: #000; padding: 40px; background: #fff; max-width: 1000px; margin: 0 auto; line-height: 1.5; }
                    .header { text-align: center; margin-bottom: 30px; }
                    .header h1 { margin: 0; font-size: 24px; text-decoration: underline; text-transform: uppercase; }
                    .header h2 { margin: 8px 0 0 0; font-size: 18px; font-weight: bold; }
                    table { width: 100%; border-collapse: collapse; margin-bottom: 30px; font-size: 14px; }
                    th { padding: 12px; border: 1px solid #000; background-color: #eaeaea; font-weight:bold; text-align: left; }
                    td { padding: 10px; border: 1px solid #000; }
                    .footer { border-top: 1px solid #000; margin-top: 40px; padding-top: 15px; font-size: 13px; text-align: center; }
                    
                    @media print {
                        .no-print { display: none !important; }
                        body { padding: 0; max-width: 100%; }
                    }
                    .actions { text-align: right; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 1px dashed #ccc; }
                    .btn { padding: 10px 20px; background: #1A2E5E; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 16px; font-weight: bold; font-family: sans-serif; }
                    .btn:hover { background: #2A4B9B; }
                </style>
            </head>
            <body>
                <div class="actions no-print">
                    <button class="btn" onclick="window.print()">🖨️ Print / Save as PDF</button>
                    <button class="btn" style="background:#666; margin-left:10px;" onclick="window.close()">Close</button>
                </div>
                
                <div class="header">
                    <h1>IN THE SUPREME COURT OF INDIA</h1>
                    <h2>CASE LISTING SUMMARY</h2>
                    <p style="margin: 8px 0 0 0; font-size: 15px;">Total Cases: ${filtered.length} | Generated on ${new Date().toLocaleDateString()}</p>
                </div>
                
                <table>
                    <thead>
                        <tr>
                            <th style="width: 5%; text-align:center;">S.No</th>
                            <th style="width: 25%;">Case / Diary No.</th>
                            <th style="width: 50%;">Parties</th>
                            <th style="width: 20%; text-align:center;">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>

                <div class="footer">
                    <p style="margin: 0;">Generated by <strong>Lex Tigress</strong> AI Legal Platform</p>
                    <p style="font-style: italic; margin: 5px 0 0 0; font-size: 12px;">This document is for information purposes and not a certified court copy.</p>
                </div>
            </body>
            </html>
        `;

        const newWin = window.open('', '_blank');
        if (newWin) {
            newWin.document.open();
            newWin.document.write(htmlContent);
            newWin.document.close();
        }
    }

    function handleExportDetailPdf(c: any) {
        const nextHearingText = c.nextHearingDate && c.status !== "Disposed" ? new Date(c.nextHearingDate).toLocaleDateString() : "Not Listed / N/A";

        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Case Report - ${c.diaryNumber}/${c.diaryYear}</title>
                <style>
                    body { font-family: 'Times New Roman', Times, serif; color: #000; padding: 40px; background: #fff; max-width: 850px; margin: 0 auto; line-height: 1.5; }
                    .header { text-align: center; margin-bottom: 20px; }
                    .header h1 { margin: 0; font-size: 24px; text-decoration: underline; text-transform: uppercase; }
                    .header h2 { margin: 8px 0 0 0; font-size: 18px; font-weight: bold; }
                    table { width: 100%; border-collapse: collapse; margin-bottom: 30px; font-size: 15px; }
                    td { padding: 12px; border: 1px solid #000; }
                    .label-td { font-weight: bold; background-color: #f9f9f9; width: 35%; }
                    .section { margin-bottom: 30px; border: 1px solid #000; padding: 20px; }
                    .section-title { font-weight: bold; font-size: 18px; margin-bottom: 15px; text-decoration: underline; }
                    .party-block { margin-left: 10px; }
                    .vs { text-align: center; font-style: italic; font-weight: bold; margin: 15px 0; }
                    .footer { border-top: 1px solid #000; margin-top: 50px; padding-top: 15px; font-size: 13px; text-align: center; }
                    
                    @media print {
                        .no-print { display: none !important; }
                        body { padding: 0; max-width: 100%; }
                    }
                    .actions { text-align: right; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 1px dashed #ccc; }
                    .btn { padding: 10px 20px; background: #1A2E5E; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 16px; font-weight: bold; font-family: sans-serif; }
                    .btn:hover { background: #2A4B9B; }
                </style>
            </head>
            <body>
                <div class="actions no-print">
                    <button class="btn" onclick="window.print()">🖨️ Print / Save as PDF</button>
                    <button class="btn" style="background:#666; margin-left:10px;" onclick="window.close()">Close</button>
                </div>
                
                <div class="header">
                    <h1>IN THE SUPREME COURT OF INDIA</h1>
                    <h2>CASE STATUS RECORD</h2>
                </div>
                
                <table>
                    <tr><td class="label-td">Case Type / No.</td><td>${c.caseType} No. ${c.shortCaseNumber}</td></tr>
                    <tr><td class="label-td">Diary Number</td><td>${c.diaryNumber} / ${c.diaryYear}</td></tr>
                    <tr><td class="label-td">Present Status</td><td style="text-transform: uppercase; font-weight: bold;">${c.status}</td></tr>
                    <tr><td class="label-td">Next Hearing Date</td><td>${nextHearingText}</td></tr>
                </table>

                <div class="section">
                    <div class="section-title">PARTIES</div>
                    <div class="party-block">
                        <p style="margin: 0 0 10px 0;"><strong>Title:</strong><br/>${c.displayTitle || formatCaseTitle(c)}</p>
                    </div>
                </div>
                
                <div class="section">
                    <div class="section-title">ADVOCATES</div>
                    <div class="party-block">
                        <p style="margin: 0 0 10px 0;"><strong>For Petitioner(s):</strong><br/>${c.petitionerAdvocates?.length ? c.petitionerAdvocates.join(", ") : "Not Updated"}</p>
                        <p style="margin: 0;"><strong>For Respondent(s):</strong><br/>${c.respondentAdvocates?.length ? c.respondentAdvocates.join(", ") : "Not Updated"}</p>
                    </div>
                </div>

                <div class="footer">
                    <p style="margin: 0;">Generated by <strong>Lex Tigress</strong> AI Legal Platform on ${new Date().toLocaleDateString()}</p>
                    <p style="font-style: italic; margin: 5px 0 0 0; font-size: 12px;">This document is for information purposes and not a certified court copy.</p>
                </div>
            </body>
            </html>
        `;

        const newWin = window.open('', '_blank');
        if (newWin) {
            newWin.document.open();
            newWin.document.write(htmlContent);
            newWin.document.close();
        }
    }

    // ── TOPBAR TITLE ───────────────────────────────────────────────────────────
    const navItem = MAIN_NAV.find(n => n.id === activeView);
    const topbarTitle = activeView === "cases"
        ? (showArchived ? "Archived Cases" : "Cases")
        : (activeView === "voice" ? "Voice Notes" : (navItem?.label ?? "Dashboard"));

    // Debugging activeView
    if (typeof window !== 'undefined') (window as any)._lexActiveView = activeView;

    // ── RENDER ─────────────────────────────────────────────────────────────────
    return (
        <AppContext.Provider value={{ T, getS, hearingColor }}>
            <div style={{ display: "flex", height: "100vh", background: T.bg, fontFamily: "'DM Sans','Segoe UI',sans-serif", color: T.text, overflow: "hidden" }}>

                {/* ── GLOBAL MOBILE STYLES ───────────────────────────────────────── */}
                <style>{`
                    @keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}
                    @keyframes slideInRight{from{transform:translateX(100%)}to{transform:translateX(0)}}
                    @keyframes fadeIn{from{opacity:0}to{opacity:1}}
                    ::-webkit-scrollbar{width:4px;height:4px}
                    ::-webkit-scrollbar-track{background:transparent}
                    ::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.15);border-radius:4px}
                    .desktop-sidebar{display:flex!important}
                    .mobile-bottom-nav{display:none!important}
                    .mobile-search-bar{display:none!important}
                    .mobile-detail-sheet{display:none!important}
                    @media(max-width:768px){
                        .desktop-sidebar{display:none!important}
                        .mobile-bottom-nav{display:flex!important}
                        .mobile-search-bar{display:flex!important}
                        .desktop-search{display:none!important}
                        .desktop-sort{display:none!important}
                        .desktop-count{display:none!important}
                        .charts-row{display:none!important}
                        .view-mode-btns{display:none!important}
                        .generate-report-btn{display:none!important}
                        .detail-panel-desktop{display:none!important}
                        .main-content-padding{padding:12px!important;padding-bottom:76px!important}
                        .info-grid{grid-template-columns:1fr!important}
                        .case-gallery-grid{grid-template-columns:repeat(2,1fr)!important;gap:8px!important}
                        .filter-toolbar{padding:10px 12px!important}
                        .filter-status-wrap{flex-wrap:nowrap!important;overflow-x:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch}
                        .filter-labels-wrap{flex-wrap:nowrap!important;overflow-x:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch}
                        .topbar-height{height:48px!important}
                        .topbar-title{font-size:15px!important}
                        .desktop-only{display:none!important}
                        .mobile-search-icon{display:flex!important}
                        .mobile-detail-sheet{display:flex!important}
                    }
                `}</style>

                {/* ── TOASTS ─────────────────────────────────────────────────────── */}
                {successToast && (
                    <div style={{ position: "fixed", bottom: 80, right: 16, zIndex: 2000, background: "#1A8C5B", color: "#fff", padding: "11px 16px", borderRadius: 12, fontSize: 14, fontWeight: 700, boxShadow: "0 4px 20px rgba(26,140,91,0.4)", display: "flex", alignItems: "center", gap: 10, maxWidth: "calc(100vw - 32px)", animation: "slideUp 0.3s ease" }} role="status">
                        ✅ {successToast}
                        <button onClick={() => setSuccessToast(null)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.7)", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>✕</button>
                    </div>
                )}
                {migrationStatus?.needed && (
                    <div style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 3000, background: "#1A2E5E", color: "#fff", padding: "14px 20px", borderRadius: 14, fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 12, maxWidth: "calc(100vw - 32px)", boxShadow: "0 8px 32px rgba(26,46,94,0.4)", flexWrap: "wrap" }} role="status">
                        <span>☁️ Found <b>{migrationStatus.caseCount} case{migrationStatus.caseCount !== 1 ? 's' : ''}</b> and <b>{migrationStatus.noteCount} note{migrationStatus.noteCount !== 1 ? 's' : ''}</b> saved locally. Sync them to your cloud account?</span>
                        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                            <button
                                disabled={migrating}
                                onClick={async () => {
                                    setMigrating(true);
                                    try {
                                        const result = await runDataMigration();
                                        setMigrationStatus(null);
                                        setSuccessToast(`Synced ${result.cases} cases and ${result.notes} notes to cloud`);
                                        loadCases().then(setCases);
                                    } catch { /* ignore */ }
                                    setMigrating(false);
                                }}
                                style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.2)", color: "#fff", cursor: migrating ? "wait" : "pointer", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}
                            >
                                {migrating ? "Syncing…" : "Sync Now"}
                            </button>
                            <button
                                onClick={async () => { await skipMigration(); setMigrationStatus(null); }}
                                style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "transparent", color: "rgba(255,255,255,0.7)", cursor: "pointer", fontSize: 13, whiteSpace: "nowrap" }}
                            >
                                Skip
                            </button>
                        </div>
                    </div>
                )}
                {false && storageWarn && (
                    <div style={{ position: "fixed", bottom: successToast ? 130 : 80, right: 16, zIndex: 2000, background: "#9B7B28", color: "#fff", padding: "11px 16px", borderRadius: 12, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 12, maxWidth: "calc(100vw - 32px)", boxShadow: "0 4px 20px rgba(155,123,40,0.4)" }} role="alert">
                        <span>⚠️ Storage is {storageHealth.percent}% full ({storageHealth.usedKB} KB). Export your data to avoid losing cases.</span>
                        <button onClick={() => { exportAllData(); }} style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.15)", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>Export Now</button>
                        <button onClick={() => setStorageWarn(false)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.7)", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>✕</button>
                    </div>
                )}

                {/* ── SIDEBAR (desktop only) ─────────────────────────────────────── */}
                <div className="desktop-sidebar" style={{ width: collapsed ? 58 : 234, background: T.sidebar, flexDirection: "column", transition: "width 0.25s ease", flexShrink: 0, overflow: "hidden", boxShadow: "2px 0 16px rgba(15,28,63,0.22)" }} role="navigation" aria-label="Main navigation">

                    {/* Logo */}
                    <div 
                        onMouseDown={(e) => {
                            (e.currentTarget as any).classList.add('logo-active');
                            logoLongPressTimer.current = setTimeout(() => {
                                setShowVoiceRecorder(true);
                                (e.currentTarget as any).classList.remove('logo-active');
                                if (window.navigator.vibrate) window.navigator.vibrate(100);
                            }, 3000);
                        }}
                        onMouseUp={(e) => {
                            (e.currentTarget as any).classList.remove('logo-active');
                            clearTimeout(logoLongPressTimer.current);
                        }}
                        onMouseLeave={(e) => {
                            (e.currentTarget as any).classList.remove('logo-active');
                            clearTimeout(logoLongPressTimer.current);
                        }}
                        onTouchStart={(e) => {
                            (e.currentTarget as any).classList.add('logo-active');
                            logoLongPressTimer.current = setTimeout(() => {
                                setShowVoiceRecorder(true);
                                (e.currentTarget as any).classList.remove('logo-active');
                                if (window.navigator.vibrate) window.navigator.vibrate(100);
                            }, 3000);
                        }}
                        onTouchEnd={(e) => {
                            (e.currentTarget as any).classList.remove('logo-active');
                            clearTimeout(logoLongPressTimer.current);
                        }}
                        style={{ padding: "16px 14px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", gap: 11, flexShrink: 0, cursor: "pointer", userSelect: "none" }}
                    >
                        <div style={{ width: 36, height: 36, flexShrink: 0, background: "linear-gradient(135deg,#C9A84C,#9B7B28)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, boxShadow: "0 2px 8px rgba(201,168,76,0.45)" }}>⚖</div>
                        {!collapsed && (
                            <div>
                                <div style={{ fontWeight: 800, fontSize: 17, color: "#fff", letterSpacing: -0.3 }}>Lex Tigress</div>
                                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", letterSpacing: 0.9, marginTop: 1 }}>AI LEGAL PLATFORM</div>
                            </div>
                        )}
                    </div>


                    {/* Main nav items */}
                    <nav style={{ padding: "10px 8px", flexShrink: 0 }}>
                        {MAIN_NAV.map(n => {
                            const active = activeView === n.id;
                            return (
                                <button key={n.id}
                                    onClick={() => { setActiveView(n.id); if (n.id === "cases") { setShowArchived(false); setStatusFilter("All Cases"); setCourtFilter("All Courts"); } }}
                                    aria-current={active ? "page" : undefined}
                                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 10, border: "none", background: active ? "rgba(201,168,76,0.16)" : "transparent", color: active ? "#C9A84C" : "rgba(255,255,255,0.52)", cursor: "pointer", fontSize: 14.5, fontWeight: active ? 700 : 400, transition: "all 0.18s", textAlign: "left", marginBottom: 2 }}>
                                    <span style={{ fontSize: 17, flexShrink: 0, lineHeight: 1 }}>{n.icon}</span>
                                    {!collapsed && <span style={{ flex: 1 }}>{n.label}</span>}
                                    {!collapsed && n.id === "cases" && (
                                        <span style={{ fontSize: 12, fontWeight: 700, color: active ? "#C9A84C" : "rgba(255,255,255,0.28)", background: "rgba(255,255,255,0.06)", padding: "1px 8px", borderRadius: 12 }}>
                                            {activeCases.length}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </nav>

                    {/* Spacer to push bottom section down */}
                    <div style={{ flex: 1 }} />

                    {/* Bottom section */}
                    <div style={{ padding: "8px", borderTop: "1px solid rgba(255,255,255,0.08)", flexShrink: 0 }}>
                        {activeView === "cases" && (
                            <button
                                onClick={() => { setShowArchived(!showArchived); setStatusFilter("All Cases"); setCourtFilter("All Courts"); setSelectedIds(new Set()); }}
                                aria-pressed={showArchived}
                                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "flex-start", gap: 9, padding: "8px 11px", borderRadius: 9, border: "none", background: showArchived ? "rgba(201,168,76,0.1)" : "transparent", color: showArchived ? "#C9A84C" : "rgba(255,255,255,0.38)", cursor: "pointer", fontSize: 13.5, fontWeight: showArchived ? 700 : 400, marginBottom: 6 }}>
                                <span>🗄</span>
                                {!collapsed && <span>Archived ({cases.filter(c => c.archived).length})</span>}
                            </button>
                        )}
                        <button
                            onClick={() => { setActiveView("cases"); setShowAdd(true); }}
                            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "flex-start", gap: 9, padding: "10px 11px", borderRadius: 9, border: "1px solid rgba(201,168,76,0.32)", background: "rgba(201,168,76,0.09)", color: "#C9A84C", cursor: "pointer", fontSize: 14.5, fontWeight: 700, marginBottom: 8 }}
                            aria-label="Add new case">
                            <span style={{ fontSize: 19, lineHeight: 1 }}>＋</span>
                            {!collapsed && <span>Add Case</span>}
                        </button>

                        {/* Need Help? */}
                        {!collapsed && (
                            <div style={{ background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.15)", borderRadius: 9, padding: "10px 12px" }}>
                                <div style={{ fontSize: 13, fontWeight: 700, color: "#C9A84C", marginBottom: 2 }}>Need Help?</div>
                                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", cursor: "pointer" }}>Contact support</div>
                            </div>
                        )}
                    </div>
                </div>

                {/* ── MOBILE BOTTOM NAV ──────────────────────────────────────── */}
                <div className="mobile-bottom-nav" style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 100, background: T.sidebar, borderTop: "1px solid rgba(255,255,255,0.1)", paddingBottom: "env(safe-area-inset-bottom)", alignItems: "center", justifyContent: "space-around" }}>
                    {MAIN_NAV.slice(0, 5).map(n => {
                        const active = activeView === n.id;
                        return (
                            <button key={n.id} onClick={() => { setActiveView(n.id); if (n.id === "cases") { setShowArchived(false); setStatusFilter("All Cases"); setCourtFilter("All Courts"); } }}
                                style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "8px 4px", background: "none", border: "none", cursor: "pointer", color: active ? "#C9A84C" : "rgba(255,255,255,0.45)" }}>
                                <span style={{ fontSize: 20 }}>{n.icon}</span>
                                <span style={{ fontSize: 10, fontWeight: active ? 700 : 500 }}>{n.label.split(" ")[0]}</span>
                            </button>
                        );
                    })}
                    <button onClick={() => { setActiveView("cases"); setShowAdd(true); }} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "8px 4px", background: "none", border: "none", cursor: "pointer", color: "#C9A84C" }}>
                        <span style={{ fontSize: 22 }}>＋</span>
                        <span style={{ fontSize: 10, fontWeight: 600 }}>Add</span>
                    </button>
                </div>

                {/* ── MOBILE DETAIL SHEET ─────────────────────────────────────────── */}
                {selected && (
                    <div className="mobile-detail-sheet" style={{ position: "fixed", inset: 0, zIndex: 200, background: T.surface, flexDirection: "column", animation: "slideInRight 0.28s ease" }}>
                        <div style={{ height: 52, display: "flex", alignItems: "center", padding: "0 14px", gap: 12, background: T.sidebar, flexShrink: 0 }}>
                            <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: "#C9A84C", cursor: "pointer", fontSize: 22, lineHeight: 1, padding: 4 }}>←</button>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 800, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{selected.displayTitle || formatCaseTitleShort(selected)}</div>
                                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>{selected.caseNumber}</div>
                            </div>
                            <button onClick={() => setShowEdit(true)} style={{ background: "rgba(201,168,76,0.15)", border: "1px solid rgba(201,168,76,0.3)", borderRadius: 8, color: "#C9A84C", cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "5px 12px" }}>Edit</button>
                        </div>
                        <div style={{ flex: 1, overflow: "auto", padding: "14px 14px 80px" }}>
                            <div style={{ marginBottom: 14, paddingBottom: 14, borderBottom: `1px solid ${T.borderSoft}` }}>
                                {(selected.caseType && selected.caseType !== 'UNKNOWN') || selected.shortCaseNumber ? (
                                    <div style={{ display: "inline-block", background: T.accentBg, border: `1px solid ${T.accentBorder}`, borderRadius: 6, padding: "2px 9px", color: T.accentDark, fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{selected.caseType} {selected.shortCaseNumber}</div>
                                ) : null}
                                <div style={{ fontSize: 18, fontWeight: 800, color: T.text, lineHeight: 1.3, marginBottom: 4 }}>{formatCaseTitle(selected)}</div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                                    <span style={{ background: getS(selected.status).bg, color: getS(selected.status).text, fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 20, border: `1px solid ${getS(selected.status).border}` }}>{selected.status.toUpperCase()}</span>
                                    {selected.archived && <span style={{ background: "#F3F4F7", color: T.textMuted, fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 20, border: `1px solid ${T.border}` }}>ARCHIVED</span>}
                                </div>
                                <div style={{ display: "flex", gap: 8 }}>
                                    <button onClick={() => setShowEdit(true)} style={{ flex: 1, padding: "9px", borderRadius: 9, border: `1px solid ${T.border}`, background: T.bg, color: T.textSub, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>✏️ Edit</button>
                                    <button onClick={() => setConfirm({ type: selected.archived ? "unarchive" : "archive", caseId: selected.id })} style={{ flex: 1, padding: "9px", borderRadius: 9, border: `1px solid ${T.border}`, background: T.bg, color: T.textSub, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{selected.archived ? "📤 Restore" : "🗄 Archive"}</button>
                                    <button onClick={() => setConfirm({ type: "delete", caseId: selected.id })} style={{ padding: "9px 14px", borderRadius: 9, border: "1px solid #FECACA", background: "#FEF2F2", color: "#C62828", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>🗑</button>
                                </div>
                            </div>
                            <CaseSummarySection selected={selected} onUpdate={handleSaveCase} />
                            <ListingsSection selected={selected} onUpdate={handleSaveCase} />
                            <LastOrdersSection selected={selected} fetchTrigger={fetchAllTrigger} />
                            <SCDetailSection selected={selected} fetchTrigger={fetchAllTrigger} />
                            <LexTigressOfficeReportSection selected={selected} fetchTrigger={fetchAllTrigger} />
                            <EarlierCourtSection selected={selected} fetchTrigger={fetchAllTrigger} />
                            <LowerCourtStatusSection selected={selected} onUpdate={handleSaveCase} fetchTrigger={fetchAllTrigger} />
                            <TimelineSection selected={selected} onUpdate={handleSaveCase} />
                            <DocumentsSection selected={selected} onUpdate={handleSaveCase} />
                            <FilingBundleSection selected={selected} />
                            <DefectsSection selected={selected} onUpdate={handleSaveCase} />
                            <ApplicationsSection selected={selected} onUpdate={handleSaveCase} fetchTrigger={fetchAllTrigger} />
                            <NotesSection selected={selected} onUpdate={handleSaveCase} />
                            <TasksSection selected={selected} onUpdate={handleSaveCase} />
                        </div>
                    </div>
                )}

                {/* ── MAIN CONTENT ───────────────────────────────────────────────── */}
                <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

                    {/* TOPBAR */}
                    <div className="topbar-height" style={{ height: 56, borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", padding: "0 14px", gap: 10, background: T.topbar, flexShrink: 0, boxShadow: T.shadow }}>
                        {/* Hamburger — desktop only */}
                        <button className="desktop-only" onClick={() => setCollapsed(!collapsed)} style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", fontSize: 20, padding: 4, lineHeight: 1, flexShrink: 0 }} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>☰</button>
                        <div className="desktop-only" style={{ width: 1, height: 22, background: T.borderSoft }} />

                        {/* Logo icon — mobile only */}
                        <div 
                            onMouseDown={(e) => {
                                (e.currentTarget as any).classList.add('logo-active');
                                logoLongPressTimer.current = setTimeout(() => {
                                    setShowVoiceRecorder(true);
                                    (e.currentTarget as any).classList.remove('logo-active');
                                    if (window.navigator.vibrate) window.navigator.vibrate(100);
                                }, 3000);
                            }}
                            onMouseUp={(e) => {
                                (e.currentTarget as any).classList.remove('logo-active');
                                clearTimeout(logoLongPressTimer.current);
                            }}
                            onMouseLeave={(e) => {
                                (e.currentTarget as any).classList.remove('logo-active');
                                clearTimeout(logoLongPressTimer.current);
                            }}
                            onTouchStart={(e) => {
                                (e.currentTarget as any).classList.add('logo-active');
                                logoLongPressTimer.current = setTimeout(() => {
                                    setShowVoiceRecorder(true);
                                    (e.currentTarget as any).classList.remove('logo-active');
                                    if (window.navigator.vibrate) window.navigator.vibrate(100);
                                }, 3000);
                            }}
                            onTouchEnd={(e) => {
                                (e.currentTarget as any).classList.remove('logo-active');
                                clearTimeout(logoLongPressTimer.current);
                            }}

                            style={{ 
                                width: 28, height: 28, flexShrink: 0, 
                                background: "linear-gradient(135deg,#C9A84C,#9B7B28)", 
                                borderRadius: 8, display: "flex", alignItems: "center", 
                                justifyContent: "center", fontSize: 16, cursor: "pointer",
                                userSelect: "none"
                            }}
                        >
                            ⚖
                        </div>

                        <span className="topbar-title" style={{ fontWeight: 700, fontSize: 18, color: T.text, letterSpacing: -0.2, flexShrink: 0 }}>{topbarTitle}</span>



                        <div style={{ flex: 1 }} />


                        {activeView === "cases" && (
                            <div className="desktop-count" style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 20, padding: "5px 14px", fontSize: 14, color: T.textSub, fontWeight: 600, flexShrink: 0, whiteSpace: "nowrap" }}>
                                {filtered.length} of {showArchived ? cases.filter(c => c.archived).length : activeCases.length} cases
                            </div>
                        )}

                        {/* Bell */}
                        <div style={{ position: "relative", flexShrink: 0 }} ref={bellRef}>
                            <button onClick={() => setShowBell(!showBell)} aria-label={bellUnreadCount > 0 ? `${bellUnreadCount} unread notification(s)` : 'No unread notifications'} aria-expanded={showBell}
                                style={{ width: 34, height: 34, borderRadius: 10, background: bellUnreadCount > 0 ? "#FBF4E3" : T.bg, border: `1px solid ${bellUnreadCount > 0 ? T.accentBorder : T.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 18, position: "relative" }}>
                                🔔
                                {bellUnreadCount > 0 && <div style={{ position: "absolute", top: -4, right: -4, width: 16, height: 16, borderRadius: "50%", background: "#C62828", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#fff", fontWeight: 800, border: "2px solid #fff" }}>{bellUnreadCount}</div>}
                            </button>
                            {showBell && <BellPanel cases={cases} onClose={() => setShowBell(false)} onSelectCase={c => { setActiveView("cases"); setSelected(c); setDetailClosed(false); setDetailFullscreen(false); setShowArchived(false); }} />}
                        </div>




                        {/* User Profile & Logout */}
                        {user && (
                            <div style={{ display: "flex", alignItems: "center", gap: 12, marginRight: 8 }}>
                                <div className="desktop-only" style={{ textAlign: "right" }}>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Welcome, {user.name}</div>
                                    <div style={{ fontSize: 11, color: T.textMuted }}>{user.role}</div>
                                </div>
                                <button
                                    onClick={handleLogout}
                                    style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.bg, color: "#C62828", fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}
                                    onMouseEnter={(e) => { e.currentTarget.style.background = "#FEF2F2"; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.background = T.bg; }}
                                >
                                    Logout
                                </button>
                            </div>
                        )}

                        {/* Theme toggle */}
                        <button onClick={() => setIsDark(!isDark)} aria-label="Toggle theme"
                            style={{ width: 34, height: 34, borderRadius: 10, background: T.bg, border: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 18, flexShrink: 0 }}>
                            {isDark ? "☀️" : "🌙"}
                        </button>
                    </div>


                    {/* ── BODY ─────────────────────────────────────────────────────── */}
                    {initialLoading ? (
                        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20 }}>
                            <div style={{ width: 44, height: 44, border: `3px solid ${T.border}`, borderTopColor: "#C9A84C", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                            <div style={{ color: T.textMuted, fontSize: 16, fontWeight: 700, letterSpacing: 0.5 }}>Loading Lex Tigress...</div>
                        </div>
                    ) : (
                        <>
                            {/* Cause list view */}
                    {activeView === "causelist" && (
                        <div style={{ flex: 1, display: "flex", overflow: "hidden", overflowY: "auto" }}>
                            <CauseList
                                cases={cases}
                                T={T}
                                onSelectCase={(c) => {
                                    setActiveView("cases");
                                    setSelected(c);
                                    setDetailClosed(false);
                                    setShowArchived(false);
                                }}
                            />
                        </div>
                    )}

                    {/* Tasks Inbox view */}
                    {activeView === "tasks" && (
                        <div style={{ flex: 1, display: "flex", overflow: "hidden", overflowY: "auto" }}>
                            <TasksDashboard
                                cases={cases}
                                T={T}
                                onUpdateCase={handleSaveCase}
                                onUpdateMultipleCases={handleUpdateMultipleCases}
                                forceShowAI={forceShowAI}
                                onForceShowAIHandled={() => setForceShowAI(false)}
                            />
                        </div>
                    )}

                    {/* Settings Dashboard view */}
                    {activeView === "settings" && (
                        <div style={{ flex: 1, display: "flex", overflow: "hidden", overflowY: "auto" }}>
                            <SettingsDashboard />
                        </div>
                    )}

                    {/* AI Analysis Hub view */}
                    {activeView === "ai" && (
                        <div style={{ flex: 1, display: "flex", overflow: "hidden", overflowY: "auto" }}>
                            <AIAnalysisHub cases={cases} />
                        </div>
                    )}

                    {/* Service Status view */}
                    {activeView === "service" && (
                        <div style={{ flex: 1, display: "flex", overflow: "hidden", overflowY: "auto" }}>
                            <ServiceStatus />
                        </div>
                    )}

                    {/* Communication Hub view */}
                    {activeView === "communication" && (
                        <div style={{ flex: 1, display: "flex", overflow: "hidden", overflowY: "auto" }}>
                            <CommunicationHub T={T} />
                        </div>
                    )}

                    {/* Voice Notes Page */}
                    {activeView === "voice" && (
                        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
                            <VoiceNotesPage
                                cases={cases}
                                T={T}
                            />
                        </div>
                    )}

                    {/* Non-cases views: show coming soon */}
                    {activeView !== "cases" && activeView !== "causelist" && activeView !== "tasks" && activeView !== "settings" && activeView !== "ai" && activeView !== "service" && activeView !== "voice" && activeView !== "communication" && (
                        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
                            <ComingSoon T={T} icon="🏗️" title="Module Under Construction" subtitle="This feature is coming soon to Lex Tigress." />
                        </div>
                    )}

                    {/* Cases view */}
                    {activeView === "cases" && (
                        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
                            <div className="main-content-padding" style={{ flex: 1, overflow: "auto", padding: 20 }}>

                                {/* SC Lookup */}
                                {!showArchived && <SearchCaseForm onCaseFound={handleCaseFound} theme={T} onViewDetail={handleCasePreview} userEmail={user?.email} searchLimit={user?.searchLimit} savedCases={cases} />}

                                {/* Charts row */}
                                {!showArchived && (
                                    <div className="charts-row" style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12, marginBottom: 22 }}>
                                        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 18, boxShadow: T.shadow }}>
                                            <div style={{ fontSize: 11, color: T.textMuted, letterSpacing: 1.1, fontWeight: 700, marginBottom: 16 }}>STATUS BREAKDOWN</div>
                                            <DonutChart cases={cases} />
                                        </div>
                                        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 18, boxShadow: T.shadow }}>
                                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                                                <div style={{ fontSize: 11, color: T.textMuted, letterSpacing: 1.1, fontWeight: 700 }}>{activeTab === "hearings" ? "UPCOMING HEARINGS" : "BY COURT NUMBER"}</div>
                                                <div style={{ display: "flex", gap: 4 }} role="tablist">
                                                    {[["courts", "Courts"], ["hearings", "Hearings"]].map(([key, lbl]) => (
                                                        <button key={key} onClick={() => setActiveTab(key)} role="tab" aria-selected={activeTab === key}
                                                            style={{ padding: "3px 8px", borderRadius: 6, border: `1px solid ${T.border}`, background: activeTab === key ? T.sidebar : "transparent", color: activeTab === key ? "#C9A84C" : T.textMuted, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                                                            {lbl}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                            {activeTab === "courts" ? <CourtBarChart cases={cases} /> : <UpcomingHearings cases={cases} onSelectCase={c => { setSelected(c); setDetailClosed(false); setDetailFullscreen(false); }} />}
                                        </div>
                                    </div>
                                )}

                                {/* Filter Toolbar (Moved from Sidebar) */}
                                {!showArchived && (
                                    <div className="filter-toolbar" style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: "16px 20px", marginBottom: 20, boxShadow: T.shadow }}>
                                        {/* Status Row */}
                                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                                            <div style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, letterSpacing: 0.5, width: 60 }}>STATUS</div>
                                            <div className="filter-status-wrap" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                                {CASE_FILTERS.map(f => {
                                                    const active = statusFilter === f.label;
                                                    return (
                                                        <button key={f.label} onClick={() => setStatusFilter(f.label)}
                                                            style={{ padding: "6px 14px", borderRadius: 20, border: active ? `1px solid #C9A84C` : `1px solid ${T.border}`, background: active ? "rgba(201,168,76,0.1)" : T.bg, color: active ? "#C9A84C" : T.textSub, fontSize: 13, fontWeight: active ? 700 : 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s" }}>
                                                            <span style={{ fontSize: 14 }}>{f.icon}</span> {f.label} {f.label !== "All Cases" && <span style={{ opacity: 0.6 }}>({counts[f.label as keyof typeof counts] ?? 0})</span>}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        {/* Court Type Row */}
                                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                                            <div style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, letterSpacing: 0.5, width: 60 }}>COURT</div>
                                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                                {[
                                                    { label: "All Courts", icon: "🏛️" },
                                                    { label: "Supreme Court", icon: "⚖️" },
                                                    { label: "High Court", icon: "🏦" },
                                                    { label: "Trial Court", icon: "🏢" },
                                                ].map(({ label, icon }) => {
                                                    const active = courtFilter === label;
                                                    return (
                                                        <button key={label} onClick={() => setCourtFilter(label)}
                                                            style={{ padding: "6px 14px", borderRadius: 20, border: active ? "1px solid #2A7BD4" : `1px solid ${T.border}`, background: active ? "rgba(42,123,212,0.1)" : T.bg, color: active ? "#2A7BD4" : T.textSub, fontSize: 13, fontWeight: active ? 700 : 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s" }}>
                                                            <span style={{ fontSize: 14 }}>{icon}</span> {label}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        {/* Labels Row */}
                                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                            <div style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, letterSpacing: 0.5, width: 60 }}>LABELS</div>
                                            <div className="filter-labels-wrap" style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1 }}>
                                                {ALL_LABELS.map(l => {
                                                    const active = labelFilter.includes(l);
                                                    return (
                                                        <button key={l} onClick={() => setLabelFilter(prev => active ? prev.filter(x => x !== l) : [...prev, l])}
                                                            style={{ padding: "4px 12px", borderRadius: 8, border: active ? `1px solid ${LABEL_COLORS[l]}` : `1px solid ${T.border}`, background: active ? `${LABEL_COLORS[l]}15` : T.bg, color: active ? LABEL_COLORS[l] : T.textSub, fontSize: 12, fontWeight: active ? 700 : 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s" }}>
                                                            <div style={{ width: 8, height: 8, borderRadius: "50%", background: LABEL_COLORS[l] }} />
                                                            {l}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                            {(labelFilter.length > 0 || statusFilter !== "All Cases" || courtFilter !== "All Courts") && (
                                                <button onClick={() => { setLabelFilter([]); setStatusFilter("All Cases"); setCourtFilter("All Courts"); }}
                                                    style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: "rgba(198,40,40,0.08)", color: "#C62828", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                                                    ✕ Clear Filters
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Search info banner */}
                                {searchTerm && <div style={{ marginBottom: 10, padding: "8px 14px", background: T.accentBg, border: `1px solid ${T.accentBorder}`, borderRadius: 9, fontSize: 14, color: T.accentDark, fontWeight: 600 }} role="status">🔍 {filtered.length} result{filtered.length !== 1 ? "s" : ""} for "{searchTerm}"</div>}

                                {/* View mode + header */}
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 10 }}>
                                    <div style={{ fontSize: 11, color: T.textMuted, letterSpacing: 1.2, fontWeight: 700, display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                                        <div style={{ height: 1, width: 20, background: T.border }} />
                                        {showArchived ? "ARCHIVED CASES" : "CASE TIMELINE"}
                                        <div style={{ height: 1, flex: 1, background: T.border }} />
                                    </div>
                                    {filtered.length > 0 && (
                                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                            <button className="generate-report-btn" onClick={handleExportListPdf} title="Generate Case List Report" style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 9, border: `1px solid ${T.border}`, background: T.surface, color: T.textSub, fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: T.shadow }}>
                                                📄 Generate Report
                                            </button>
                                            <div className="view-mode-btns" style={{ display: "flex", gap: 3, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 9, padding: 3, flexShrink: 0, boxShadow: T.shadow }}>
                                                {[{ mode: "list", icon: "≡", label: "List" }, { mode: "gallery", icon: "⊞", label: "Gallery" }, { mode: "table", icon: "▦", label: "Table" }, { mode: "kanban", icon: "⋮⋮", label: "Kanban" }].map(v => (
                                                    <button key={v.mode} onClick={() => setViewMode(v.mode)} title={v.label}
                                                        style={{ padding: "5px 11px", borderRadius: 7, border: "none", background: viewMode === v.mode ? "linear-gradient(135deg,#1A2E5E,#2A4B9B)" : "transparent", color: viewMode === v.mode ? "#C9A84C" : T.textMuted, fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "all 0.15s" }}>
                                                        {v.icon}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Bulk Action Bar */}
                                {showArchived && selectedIds.size > 0 && (
                                    <div style={{ position: "sticky", top: 0, zIndex: 100, marginBottom: 16, background: "#1A2E5E", borderRadius: 12, padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 8px 24px rgba(26,46,94,0.3)", animation: "slideUp 0.3s ease" }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                                            <span style={{ color: "#C9A84C", fontWeight: 800, fontSize: 15 }}>{selectedIds.size} Selected</span>
                                            <button onClick={() => setSelectedIds(new Set())} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.6)", fontSize: 13, cursor: "pointer", textDecoration: "underline" }}>Cancel</button>
                                        </div>
                                        <div style={{ display: "flex", gap: 10 }}>
                                            <button onClick={handleBulkRestore} style={{ background: "linear-gradient(135deg,#C9A84C,#9B7B28)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 12px rgba(201,168,76,0.3)" }}>📤 Restore to Active</button>
                                            <button onClick={() => setConfirm({ type: "bulk_delete", ids: Array.from(selectedIds) })} style={{ background: "rgba(198,40,40,0.2)", border: "1px solid #C62828", color: "#EF5350", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>🗑 Permanently Delete</button>
                                        </div>
                                    </div>
                                )}

                                {/* Case list */}
                                <div id="case-list-panel">
                                    {viewMode === "list" && <div role="list">{filtered.map(c => <div key={c.id} role="listitem"><CaseCard c={c} selected={selected?.id === c.id} onClick={() => { setSelected(c); setDetailClosed(false); setDetailFullscreen(false); }} searchTerm={searchTerm} onToggleSelect={showArchived ? toggleSelect : undefined} isSelected={selectedIds.has(c.id)} /></div>)}</div>}
                                    {viewMode === "gallery" && <div className="case-gallery-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 12 }}>{filtered.map(c => <GalleryCard key={c.id} c={c} selected={selected?.id === c.id} onClick={() => { setSelected(c); setDetailClosed(false); setDetailFullscreen(false); }} onToggleSelect={showArchived ? toggleSelect : undefined} isSelected={selectedIds.has(c.id)} />)}</div>}
                                    {viewMode === "table" && <TableView cases={filtered} selected={selected} onSelect={c => { setSelected(c); setDetailClosed(false); setDetailFullscreen(false); }} searchTerm={searchTerm} onToggleSelect={showArchived ? toggleSelect : undefined} isSelected={id => selectedIds.has(id)} onSelectAll={showArchived ? () => handleSelectAll(filtered) : undefined} allSelected={filtered.length > 0 && filtered.every(c => selectedIds.has(c.id))} />}
                                    {viewMode === "kanban" && <KanbanView cases={filtered} selected={selected} onSelect={c => { setSelected(c); setDetailClosed(false); setDetailFullscreen(false); }} onToggleSelect={showArchived ? toggleSelect : undefined} isSelected={selectedIds.has(c.id)} />}
                                </div>

                                {/* Empty state */}
                                {filtered.length === 0 && (
                                    <div style={{ textAlign: "center", padding: "56px 20px" }} role="status">
                                        {cases.length === 0 && !showArchived ? (
                                            <>
                                                <div style={{ fontSize: 40, marginBottom: 14 }}>⚖️</div>
                                                <div style={{ color: T.text, fontSize: 17, fontWeight: 800, marginBottom: 8 }}>Welcome to Lex Tigress</div>
                                                <div style={{ color: T.textMuted, fontSize: 15, marginBottom: 6, lineHeight: 1.8 }}>Search for a Supreme Court case using the form above.<br />Enter a <strong style={{ color: T.textSub }}>Diary Number</strong> and <strong style={{ color: T.textSub }}>Year</strong> to get started.</div>
                                                <div style={{ display: "inline-block", marginTop: 8, padding: "8px 18px", background: T.accentBg, border: `1px solid ${T.accentBorder}`, borderRadius: 9, fontSize: 14, color: T.accentDark, fontWeight: 600 }}>e.g. Diary No. 45821 / Year 2024</div>
                                            </>
                                        ) : (
                                            <>
                                                <div style={{ fontSize: 36, marginBottom: 12 }}>🔍</div>
                                                <div style={{ color: T.text, fontSize: 16, fontWeight: 700, marginBottom: 6 }}>No cases found</div>
                                                <div style={{ color: T.textMuted, fontSize: 14, marginBottom: 20, lineHeight: 1.8 }}>Try a party name, case no., or diary no.</div>
                                                {hasFilters && <button onClick={() => { setSearchTerm(""); setLabelFilter([]); setStatusFilter("All Cases"); setCourtFilter("All Courts"); }} style={{ padding: "9px 22px", borderRadius: 9, border: `1px solid ${T.border}`, background: T.surface, color: T.textSub, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Clear all filters</button>}
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* DETAIL PANEL */}
                            {selected && (
                                <div className="detail-panel-desktop" style={{ width: detailClosed ? 40 : detailFullscreen ? "100%" : "clamp(480px,42vw,680px)", background: T.surface, borderLeft: `1px solid ${T.border}`, overflow: detailClosed ? "hidden" : "auto", flexShrink: 0, boxShadow: "-2px 0 12px rgba(15,28,63,0.06)", transition: "width 0.25s ease" }} role="complementary" aria-label="Case details">
                                    <div style={{ position: "sticky", top: 0, zIndex: 10, width: "100%", display: "flex", alignItems: "center", justifyContent: detailClosed ? "center" : "flex-end", padding: "10px 14px", gap: 8, background: T.surface, borderBottom: `1px solid ${T.borderSoft}`, boxSizing: "border-box" }}>
                                        {detailClosed ? (
                                            <button onClick={() => setDetailClosed(false)} aria-label="Expand details" style={{ background: "none", border: "none", cursor: "pointer", color: T.textMuted, fontSize: 15, fontWeight: 700 }}>▶</button>
                                        ) : (<>
                                            <button onClick={() => { setDetailFullscreen(v => !v); }} title={detailFullscreen ? "Exit fullscreen" : "Fullscreen"} style={{ background: "none", border: "none", cursor: "pointer", color: T.textMuted, fontSize: 15, fontWeight: 700 }}>{detailFullscreen ? "⊡ Exit" : "⛶ Full"}</button>
                                            <button onClick={() => { setDetailClosed(true); setDetailFullscreen(false); }} aria-label="Collapse details" style={{ background: "none", border: "none", cursor: "pointer", color: T.textMuted, fontSize: 15, fontWeight: 700 }}>◀ Close</button>
                                        </>)}
                                    </div>
                                    {!detailClosed && (
                                        <div id="case-detail-content" style={{ padding: 20 }}>
                                            {/* Header */}
                                            <div style={{ marginBottom: 18, paddingBottom: 16, borderBottom: `1px solid ${T.borderSoft}` }}>
                                                <div style={{ fontSize: 22, fontWeight: 800, color: T.text, lineHeight: 1.3, marginBottom: 4, letterSpacing: -0.3 }}>
                                                    {formatCaseTitle(selected)}
                                                </div>
                                                {(selected.caseType && selected.caseType !== 'UNKNOWN') || selected.shortCaseNumber ? (
                                                    <div style={{ display: "inline-block", background: T.accentBg, border: `1px solid ${T.accentBorder}`, borderRadius: 6, padding: "2px 9px", color: T.accentDark, fontSize: 13, fontFamily: "Georgia,serif", fontWeight: 700 }}>{selected.caseType} {selected.shortCaseNumber}</div>
                                                ) : null}
                                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
                                                    <span style={{ background: getS(selected.status).bg, color: getS(selected.status).text, fontSize: 13, fontWeight: 700, padding: "4px 12px", borderRadius: 20, border: `1px solid ${getS(selected.status).border}`, letterSpacing: 0.5 }}>{selected.status.toUpperCase()}</span>
                                                    {selected.archived && <span style={{ background: "#F3F4F7", color: T.textMuted, fontSize: 13, fontWeight: 700, padding: "4px 12px", borderRadius: 20, border: `1px solid ${T.border}` }}>ARCHIVED</span>}
                                                </div>
                                                {selected.nextHearingDate && selected.status !== "Disposed" && !selected.archived && (() => {
                                                    const days = getDaysUntil(selected.nextHearingDate);
                                                    if (days === null || days < 0) return null;
                                                    return <div style={{ marginTop: 12, padding: "10px 14px", background: "#FBF4E3", border: "1px solid #E8D18A", borderRadius: 9, display: "flex", alignItems: "center", gap: 12 }}>
                                                        <span style={{ fontSize: 22 }}>📅</span>
                                                        <div>
                                                            <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 2 }}>Next Hearing</div>
                                                            <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>{fmtDate(selected.nextHearingDate)}<span style={{ fontSize: 13, fontWeight: 600, color: hearingColor(days), marginLeft: 8 }}>({hearingLabel(days)})</span></div>
                                                        </div>
                                                    </div>;
                                                })()}
                                                <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", borderTop: `1px solid ${T.borderSoft}`, paddingTop: 14 }}>
                                                    <button onClick={() => handleExportDetailPdf(selected)} title="Generate Case Report" style={{ flex: 1, padding: "8px 14px", borderRadius: 9, border: `1px solid ${T.border}`, background: T.surface, color: T.textSub, fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>📄 Report</button>
                                                    <button onClick={() => handleRefreshCase(selected)} disabled={refreshingId === selected.id} title="Refresh Listing & Details from SC Database" style={{ flex: 1, padding: "8px 14px", borderRadius: 9, border: `1px solid ${T.accentBorder}`, background: refreshingId === selected.id ? T.bg : T.accentBg, color: refreshingId === selected.id ? T.textMuted : T.accentDark, fontSize: 13, fontWeight: 700, cursor: refreshingId === selected.id ? "wait" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: refreshingId === selected.id ? 0.7 : 1 }}>{refreshingId === selected.id ? "🔄 Syncing..." : "🔄 Refresh SC Data"}</button>
                                                    <button
                                                        onClick={() => { setFetchAllTrigger(n => n + 1); setSuccessToast("Data fetched"); }}
                                                        title="Fetch all sections (Earlier Court, Office Report, Last Orders) in one shot"
                                                        style={{ flex: 1, padding: "8px 14px", borderRadius: 9, border: "1px solid #2A7BD4", background: "rgba(42,123,212,0.08)", color: "#2A7BD4", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                                                    >
                                                        📡 Fetch All
                                                    </button>
                                                    <button onClick={() => setShowEdit(true)} style={{ flex: 1, padding: "8px 14px", borderRadius: 9, border: `1px solid ${T.border}`, background: T.surface, color: T.textSub, fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>✏️ Edit</button>
                                                    <button onClick={() => setConfirm({ type: selected.archived ? "unarchive" : "archive", caseId: selected.id })} style={{ flex: 1, padding: "8px 14px", borderRadius: 9, border: `1px solid ${T.border}`, background: T.bg, color: T.textSub, fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>{selected.archived ? "🔄 Restore" : "🗄 Archive"}</button>
                                                    <button onClick={() => setConfirm({ type: selected.archived ? "hard_delete" : "delete", caseId: selected.id })} style={{ padding: "8px 14px", borderRadius: 9, border: "1px solid #FECACA", background: "#FEF2F2", color: "#C62828", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>{selected.archived ? "🗑 Delete Forever" : "🗑 Delete"}</button>
                                                </div>
                                            </div>

                                            <CaseSummarySection selected={selected} onUpdate={handleSaveCase} />
                                            <ListingsSection selected={selected} onUpdate={handleSaveCase} />
                                            <LastOrdersSection selected={selected} fetchTrigger={fetchAllTrigger} />
                                            <SCDetailSection selected={selected} fetchTrigger={fetchAllTrigger} />
                                            <LexTigressOfficeReportSection selected={selected} fetchTrigger={fetchAllTrigger} />
                                            <EarlierCourtSection selected={selected} fetchTrigger={fetchAllTrigger} />
                                            <LowerCourtStatusSection selected={selected} onUpdate={handleSaveCase} fetchTrigger={fetchAllTrigger} />
                                            <TimelineSection selected={selected} onUpdate={handleSaveCase} />
                                            <DocumentsSection selected={selected} onUpdate={handleSaveCase} />
                                            <FilingBundleSection selected={selected} />
                                            <DefectsSection selected={selected} onUpdate={handleSaveCase} />
                                            <ApplicationsSection selected={selected} onUpdate={handleSaveCase} fetchTrigger={fetchAllTrigger} />
                                            <NotesSection selected={selected} onUpdate={handleSaveCase} />
                                            <TasksSection selected={selected} onUpdate={handleSaveCase} />
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                    </>
                )}

                {/* ── MODALS ─────────────────────────────────────────────────────── */}
                {/* Case Preview Modal */}
                {previewCase && (
                    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
                        <div style={{ background: T.surface, borderRadius: 16, width: "100%", maxWidth: 800, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 8px 40px rgba(0,0,0,0.35)", position: "relative" }}>
                            <div style={{ position: "sticky", top: 0, background: T.surface, borderBottom: `1px solid ${T.border}`, padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 10 }}>
                                <div style={{ fontWeight: 800, fontSize: 18, color: T.text }}>Case Detail Preview</div>
                                <button onClick={() => setPreviewCase(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: T.textMuted }}>✕</button>
                            </div>
                            <div style={{ padding: 24 }}>
                                <div style={{ marginBottom: 20 }}>
                                    <div style={{ display: "inline-block", background: T.accentBg, border: `1px solid ${T.accentBorder}`, borderRadius: 6, padding: "2px 9px", color: T.accentDark, fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{previewCase.caseType} {previewCase.shortCaseNumber}</div>
                                    <div style={{ fontSize: 24, fontWeight: 800, color: T.text, lineHeight: 1.3, marginBottom: 4 }}>{formatParty(previewCase.petitioner)}</div>
                                    <div style={{ fontSize: 16, fontWeight: 800, color: T.textSub }}>v. {formatParty(previewCase.respondent)}</div>
                                </div>

                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
                                    <div>
                                        <SectionHead icon="🔨" label="Case Information" />
                                        <DR icon="#" label="Diary No.">{previewCase.diaryNumber} / {previewCase.diaryYear}</DR>
                                        <DR icon="📅" label="Date of Filing">{fmtDate(previewCase.dateOfFiling)}</DR>
                                        <DR icon="🏛" label="Court">{previewCase.courtName}</DR>
                                        <DR icon="📌" label="Status">{previewCase.status}</DR>
                                    </div>
                                    <div>
                                        <SectionHead icon="🗓" label="Listing Details" />
                                        <DR icon="📅" label="Last Listed">{fmtDate(previewCase.lastListedOn)}</DR>
                                        <DR icon="📅" label="Next Hearing">{fmtDate(previewCase.nextHearingDate)}</DR>
                                        <DR icon="🧑‍⚖️" label="Judges">{previewCase.lastListedJudges?.join("; ") || "—"}</DR>
                                    </div>
                                </div>

                                <div style={{ borderTop: `1px solid ${T.borderSoft}`, paddingTop: 20, display: "flex", gap: 12, justifyContent: "flex-end" }}>
                                    <button onClick={() => setPreviewCase(null)} style={{ padding: "10px 20px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.bg, color: T.textSub, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Close Preview</button>
                                    <button
                                        onClick={() => {
                                            handleCaseFound(previewCase);
                                            setPreviewCase(null);
                                        }}
                                        style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#C9A84C,#9B7B28)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: "0 2px 8px rgba(201,168,76,0.4)" }}
                                    >
                                        Add to Dashboard
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {showAdd && <CaseModal onClose={() => setShowAdd(false)} onSave={c => { setCases(p => [c, ...p]); setSelected(c); setShowArchived(false); }} />}
                {showEdit && selected && <CaseModal editCase={selected} onClose={() => setShowEdit(false)} onSave={handleSaveCase} />}
                
                {confirm?.type === "archive" && <ConfirmDialog title="Archive Case" message={`Archive "${cases.find(c => c.id === confirm.caseId)?.caseNumber}"?`} confirmLabel="Archive" onConfirm={() => handleArchiveToggle(confirm.caseId)} onCancel={() => setConfirm(null)} />}
                {confirm?.type === "unarchive" && <ConfirmDialog title="Restore Case" message={`Restore "${cases.find(c => c.id === confirm.caseId)?.caseNumber}" to active list?`} confirmLabel="Restore" onConfirm={() => handleArchiveToggle(confirm.caseId)} onCancel={() => setConfirm(null)} />}
                {confirm?.type === "delete" && <ConfirmDialog title="Archive Case" message={`Move "${cases.find(c => c.id === confirm.caseId)?.caseNumber}" to Archive? You can restore it later from the Archive view.`} confirmLabel="Archive" onConfirm={() => handleDelete(confirm.caseId)} onCancel={() => setConfirm(null)} />}
                {confirm?.type === "hard_delete" && <ConfirmDialog title="Delete Permanently" message={`Are you sure you want to permanently delete "${cases.find(c => c.id === confirm.caseId)?.caseNumber}"? This cannot be undone.`} confirmLabel="Delete Forever" onConfirm={() => handleBulkPermanentDelete([confirm.caseId])} onCancel={() => setConfirm(null)} danger />}
                {confirm?.type === "bulk_delete" && <ConfirmDialog title="Delete Multiple Cases" message={`Are you sure you want to permanently delete ${confirm.ids.length} selected cases? This cannot be undone.`} confirmLabel={`Delete ${confirm.ids.length} Cases`} onConfirm={() => handleBulkPermanentDelete(confirm.ids)} onCancel={() => setConfirm(null)} danger />}

                {/* Voice Recorder Overlay */}
                {showVoiceRecorder && (
                    <VoiceNoteRecorder 
                        cases={cases} 
                        T={T} 
                        onClose={() => setShowVoiceRecorder(false)} 
                        onComplete={(note) => {
                            setShowVoiceRecorder(false);
                            setSuccessToast("Note processed and saved!");
                            // Trigger a refresh of cases if a case was linked
                            if (note.linked_case_ids && note.linked_case_ids.length > 0) {
                                loadCases().then(setCases);
                            }
                        }}
                    />
                )}
            </div>
        </div>
    </AppContext.Provider>
);
}