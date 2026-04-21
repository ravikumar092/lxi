export type NoteCategory = 'Strategy' | 'Task' | 'Idea' | 'Problem' | 'Research' | 'Document Requirement' | 'General';

export interface Note {
    id: string;
    title: string;
    content: string; // This will store the transcription for voice notes
    
    // Multi-case linking
    case_number: string | null; // Keep for backward compatibility/primary link
    case_name: string | null;   // Keep for backward compatibility/primary link
    linked_case_ids?: string[]; // Array of UUIDs for multi-case linking
    
    category?: NoteCategory;
    
    // Voice Note Metadata
    audio_url?: string | null;
    duration?: number | null; // in seconds
    
    // AI Metadata
    is_ai_processed?: boolean;
    extracted_tasks?: any[]; // For storing draft tasks before confirmation
    
    linked_team_member: string | null;
    tags: string[];
    created_by_id: string;
    created_by_name: string;
    created_at: string; // ISO timestamp
    updated_by_id: string | null;
    updated_by_name: string | null;
    updated_at: string | null; // ISO timestamp
    is_deleted: boolean;
    deleted_at: string | null; // ISO timestamp
    source: "app" | "sheet" | "voice";
}

