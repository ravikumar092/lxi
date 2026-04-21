import { create } from 'zustand';
import { Role, Urgency } from '../caseLogic';
import { supabase } from '../lib/supabaseClient';

export interface TeamMember {
    id: string;
    name: string;
    role: Role;
    specialization: string;
    workloadCapacity: number;
    currentWorkload: number;
}

export interface TrainingExampleTask {
    task: string;
    assigned_to_role: Role;
    assigned_to_person: string;
    urgency: Urgency;
    deadline_days: number;
    reason: string;
}

export interface TrainingExample {
    id: string;
    case_type?: string;
    office_report_text: string;
    correct_tasks: TrainingExampleTask[];
    added_by: string;
    added_on: string;
    isActive: boolean;
}

export interface AiStats {
    accuracyThisWeek: number;
    tasksAutoAssigned: number;
    tasksManuallyCorrected: number;
    commonCorrectionType: string | null;
}

/** Learning system — tracks repeated defect patterns per case type (Feature 2) */
export interface DocDefectRecord {
    id: string;
    caseType: string;     // e.g. 'SLP(C)', 'CA', 'WP(C)'
    documentName: string; // which document was missing/defective
    status: string;       // 'Missing' | 'Incorrect' | 'Incomplete'
    source: string;       // 'Rule' | 'AI' | 'Defect' | 'User'
    frequency: number;    // how many times seen across cases
    lastSeen: string;     // ISO datetime
}

const DEFAULT_TEAM: TeamMember[] = [
    { id: '1', name: 'Renu',   role: 'Paralegal / Clerk',   specialization: 'Service Tracking',  workloadCapacity: 15, currentWorkload: 5 },
    { id: '2', name: 'Priya',  role: 'Associate Advocate',  specialization: 'Criminal Drafting',  workloadCapacity: 10, currentWorkload: 2 },
    { id: '3', name: 'Vikram', role: 'Advocate',             specialization: 'Court Appearances', workloadCapacity: 5,  currentWorkload: 1 },
];

const DEFAULT_AI_STATS: AiStats = {
    accuracyThisWeek: 100,
    tasksAutoAssigned: 0,
    tasksManuallyCorrected: 0,
    commonCorrectionType: null,
};

interface SettingsState {
    roles: string[];
    teamMembers: TeamMember[];
    trainingExamples: TrainingExample[];
    aiStats: AiStats;
    docDefectHistory: DocDefectRecord[];   // Feature 2 learning system
    addRole: (role: string) => void;
    removeRole: (role: string) => void;
    addTeamMember: (member: Omit<TeamMember, 'id'>) => void;
    updateTeamMember: (id: string, updates: Partial<TeamMember>) => void;
    removeTeamMember: (id: string) => void;
    addTrainingExample: (example: Omit<TrainingExample, 'id' | 'added_on'>) => void;
    updateTrainingExample: (id: string, updates: Partial<TrainingExample>) => void;
    removeTrainingExample: (id: string) => void;
    recordAiTask: () => void;
    recordAiCorrection: (correctionType: string) => void;
    recordDocDefect: (caseType: string, documentName: string, source: string, status: string) => void;
    getTopDefects: (caseType: string, limit?: number) => DocDefectRecord[];
}

export const useSettingsStore = create<SettingsState>()(
    (set, get) => ({
        roles: ['Advocate', 'Associate Advocate', 'Paralegal / Clerk'],
        teamMembers: DEFAULT_TEAM,
        trainingExamples: [],
        aiStats: DEFAULT_AI_STATS,
        docDefectHistory: [],    // Feature 2 learning system

        addRole: (role) => set((state) => ({ roles: [...state.roles, role] })),
        removeRole: (role) => set((state) => ({ roles: state.roles.filter((r) => r !== role) })),

        addTeamMember: (member) => set((state) => ({
            teamMembers: [...state.teamMembers, { ...member, id: Date.now().toString() }]
        })),
        updateTeamMember: (id, updates) => set((state) => ({
            teamMembers: state.teamMembers.map((m) => m.id === id ? { ...m, ...updates } : m)
        })),
        removeTeamMember: (id) => set((state) => ({
            teamMembers: state.teamMembers.filter((m) => m.id !== id)
        })),

        addTrainingExample: (example) => set((state) => ({
            trainingExamples: [...state.trainingExamples, {
                ...example,
                id: Date.now().toString(),
                added_on: new Date().toISOString()
            }]
        })),
        updateTrainingExample: (id, updates) => set((state) => ({
            trainingExamples: state.trainingExamples.map((e) => e.id === id ? { ...e, ...updates } : e)
        })),
        removeTrainingExample: (id) => set((state) => ({
            trainingExamples: state.trainingExamples.filter((e) => e.id !== id)
        })),

        recordAiTask: () => set((state) => {
            const total = state.aiStats.tasksAutoAssigned + 1;
            const corrected = state.aiStats.tasksManuallyCorrected;
            const accuracy = total > 0 ? Math.round(((total - corrected) / total) * 100) : 100;
            return { aiStats: { ...state.aiStats, tasksAutoAssigned: total, accuracyThisWeek: accuracy } };
        }),
        recordAiCorrection: (correctionType) => set((state) => {
            const total = state.aiStats.tasksAutoAssigned;
            const corrected = state.aiStats.tasksManuallyCorrected + 1;
            const accuracy = total > 0 ? Math.round(((total - Math.min(corrected, total)) / total) * 100) : 0;
            return { aiStats: { ...state.aiStats, tasksManuallyCorrected: corrected, accuracyThisWeek: accuracy, commonCorrectionType: correctionType } };
        }),

        // ── Feature 2: Learning System ───────────────────────────────────────
        recordDocDefect: (caseType, documentName, source, status) => set((state) => {
            const history = [...state.docDefectHistory];
            const idx = history.findIndex(
                (d) => d.caseType === caseType && 
                       d.documentName.toLowerCase() === documentName.toLowerCase() &&
                       d.status === status
            );
            if (idx >= 0) {
                history[idx] = { ...history[idx], frequency: history[idx].frequency + 1, lastSeen: new Date().toISOString() };
            } else {
                history.push({
                    id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    caseType, documentName, source, status,
                    frequency: 1,
                    lastSeen: new Date().toISOString(),
                });
            }
            return { docDefectHistory: history };
        }),

        getTopDefects: (caseType, limit = 5) => {
            return get()
                .docDefectHistory
                .filter((d) => !caseType || d.caseType === caseType)
                .sort((a, b) => b.frequency - a.frequency)
                .slice(0, limit);
        },
    })
);

// ── SUPABASE SYNC ─────────────────────────────────────────────────────────────

/** Call once after login to load settings from Supabase into the store. */
export async function loadSettingsFromSupabase(): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
        .from('user_app_state')
        .select('roles, team_members, training, ai_stats, doc_defect_history')
        .eq('user_id', user.id)
        .single();

    if (error || !data) return;

    useSettingsStore.setState({
        roles:            data.roles           || ['Advocate', 'Associate Advocate', 'Paralegal / Clerk'],
        teamMembers:      data.team_members    || DEFAULT_TEAM,
        trainingExamples: data.training        || [],
        aiStats:          data.ai_stats        || DEFAULT_AI_STATS,
        docDefectHistory: data.doc_defect_history || [],
    });
}

/** Persist current store state to Supabase. Call after any mutation. */
export async function saveSettingsToSupabase(): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { roles, teamMembers, trainingExamples, aiStats, docDefectHistory } = useSettingsStore.getState();

    await supabase.from('user_app_state').upsert({
        user_id:            user.id,
        roles,
        team_members:       teamMembers,
        training:           trainingExamples,
        ai_stats:           aiStats,
        doc_defect_history: docDefectHistory,
        updated_at:         new Date().toISOString(),
    }, { onConflict: 'user_id' });
}

/** Subscribe to store changes and auto-save to Supabase (debounced 1.5s). */
let _saveTimer: ReturnType<typeof setTimeout> | null = null;

export function initSettingsSync(): () => void {
    const unsubscribe = useSettingsStore.subscribe(() => {
        if (_saveTimer) clearTimeout(_saveTimer);
        _saveTimer = setTimeout(() => saveSettingsToSupabase(), 1500);
    });
    return unsubscribe;
}
