export enum CaseStatus {
  PENDING = 'Pending',
  ACTIVE = 'Active',
  CLOSED = 'Closed',
  DEFECTIVE = 'Defective'
}

export enum ServiceStatus {
  SERVED = 'Served',
  PENDING = 'Pending',
  DEFECTIVE = 'Defective'
}

export enum TaskStatus {
  OPEN = 'Open',
  IN_PROGRESS = 'In Progress',
  COMPLETED = 'Completed',
  DELAYED = 'Delayed',
  MISSED = 'Missed'
}

export enum Priority {
  HIGH = 'High',
  MEDIUM = 'Medium',
  LOW = 'Low'
}

export enum UserRole {
  AOR = 'AOR',
  ASSOCIATE = 'Associate',
  APPELLATE_ADVOCATE = 'Appellate Advocate',
  CLIENT = 'Client'
}

export enum TeamMemberRole {
  ADMIN = 'Admin',
  ASSOCIATE_ADVOCATE = 'Associate Advocate',
  CLERK = 'Clerk'
}

export enum AlertType {
  HEARING = 'hearing',
  DEADLINE = 'deadline',
  SERVICE = 'service',
  SYSTEM = 'system'
}

export interface Case {
  id: string;
  parties: string;
  petitioner?: string;
  respondent?: string;
  displayTitle?: string;
  diaryNo: string;
  diaryYear: string;
  caseNumber: string;
  lastListedOn: string;
  status: CaseStatus;
  processId?: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  deadline: Date;
  priority: Priority;
  responsibleAssociateId: string;
  status: TaskStatus;
  reasonForDelay?: string;
  linkedCaseId: string;
  category?: string;
}

export interface User {
  id: string;
  name: string;
  role: UserRole;
  completionRate: number;
  phoneNumber: string;
  email: string;
}

export interface ViewMode {
  type: 'table' | 'kanban' | 'gallery';
  groupBy?: 'status' | 'judge' | 'date';
}

export interface FilterOptions {
  status?: CaseStatus[];
  judge?: string[];
  dateRange?: {
    start: Date;
    end: Date;
  };
  serviceStatus?: ServiceStatus[];
  searchQuery?: string;
}

export interface UserProfile {
  id: string;
  team_id: string | null;
  role: TeamMemberRole;
  full_name: string;
  email: string;
  phone?: string;
  specialization?: string;
  search_limit: number;
  created_at: string;
}

export interface Team {
  id: string;
  name: string;
  admin_user_id: string;
  created_at: string;
}

export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string | null;
  role: TeamMemberRole;
  full_name: string;
  email: string;
  invited_at: string;
  joined_at: string | null;
}

export interface Document {
  id: string;
  team_id: string;
  case_id: string | null;
  name: string;
  type: string;
  url: string;
  size_bytes?: number;
  description?: string;
  uploaded_by: string | null;
  uploaded_at: string;
}

export interface Alert {
  id: string;
  team_id: string;
  user_id: string | null;
  case_id: string | null;
  type: AlertType;
  message: string;
  read_at: string | null;
  created_at: string;
}

export interface ApiCaseResponse {
  ok: boolean;
  query: {
    diary_no: string;
    diary_year: string;
    language: string;
  };
  data: {
    diaryNo: string;
    diaryYear: string;
    parties: string;
    caseNumber: string;
    cnr: string;
    filed: string;
    lastListedOn: string;
    stage: string;
    dispositionType: string;
    category: string;
    petitioner: string;
    respondent: string;
    petitionerAdvocates: string | null;
    respondentAdvocates: string | null;
    caseStatusBadge: string;
    raw: {
      heading: string;
      table: Record<string, string>;
    };
  };
}

// ─── FEATURE 2: MISSING DOCUMENT DETECTION ────────────────────────────────────

export type DocStatus        = 'Missing' | 'Incorrect' | 'Incomplete' | 'Complete' | 'Received';
export type DocPriority      = 'Critical' | 'Important' | 'Optional';
export type DocSource        = 'Rule' | 'AI' | 'Defect' | 'User';
export type DocRequestedFrom = 'Client' | 'Associate';
export type DocFilingMode    = 'Before Filing' | 'After Filing';
export type DocUploadSource  = 'WhatsApp' | 'Email' | 'Upload' | 'System';

/** One scheduled follow-up entry attached to a DocumentRequirement */
export interface DocFollowUp {
  id: string;
  scheduledAt: string;   // ISO — when reminder is due
  sentAt?: string;       // ISO — when user clicked Resend
  escalated: boolean;
  escalatedAt?: string;
}

/** Metadata for a file uploaded by the user (no file bytes stored in LS) */
export interface UploadedDocumentMeta {
  id: string;
  caseId: string;
  documentName: string;
  fileType: string;          // 'PDF' | 'PNG' | 'JPG' etc.
  fileSizeKB: number;
  uploadSource: DocUploadSource;
  uploadedAt: string;        // ISO
  linkedRequirementId?: string; // set when auto-matched
}

/** Core data model — spec §10 fields + extended fields */
export interface DocumentRequirement {
  // ── Exact spec fields (§10) ──────────────────────────────────────
  id: string;
  caseId: string;
  documentName: string;
  status: DocStatus;
  priority: DocPriority;
  source: DocSource;
  linkedTaskId?: string;
  requestedFrom?: DocRequestedFrom;
  deadline?: string;           // ISO date YYYY-MM-DD
  autoMessageSent: boolean;    // true after WhatsApp share clicked

  // ── Extended fields ───────────────────────────────────────────────
  filingMode: DocFilingMode;
  detectedAt: string;          // ISO datetime
  resolvedAt?: string;         // ISO datetime
  whyImportant?: string;       // AI: shown in AI Report
  riskIfMissing?: string;      // AI: risk in AI Report
  filingStage?: string;        // e.g. 'Before first listing'
  whatsappClientText?: string;      // pre-composed client message
  whatsappAssociateText?: string;   // pre-composed associate message
  clientMessageSentAt?: string;
  associateMessageSentAt?: string;
  followUps: DocFollowUp[];
  uploadedDocId?: string;      // matched UploadedDocumentMeta.id
  notes?: string;
}

// ─── FEATURE: FILING BUNDLE GENERATOR ────────────────────────────────────────

export type BundleType       = 'master' | 'court';
export type BundleStatus     = 'draft' | 'final';
export type StructureRule    = 'supreme_court' | 'chronological' | 'custom';
export type BundleSourceType =
  | 'uploaded'      // Direct upload by team
  | 'whatsapp'      // Received via WhatsApp inbound message
  | 'email'         // Received via Email inbound message
  | 'ai_detected'   // Flagged by missing doc AI (Feature 2)
  | 'court_order'   // Fetched from eCourts API
  | 'office_report' // Fetched from SC office report
  | 'linked_case';  // Previously linked case document

/** One document slot inside a filing bundle (ordered list entry) */
export interface BundleDocument {
  id: string;
  bundleId: string;
  teamId: string;

  // Source reference
  documentId?: string;        // Supabase documents.id (if uploaded doc)
  fileUrl?: string;           // Direct URL to fetch PDF bytes (WhatsApp, court orders, linked docs)
  sourceType: BundleSourceType;
  sourceRef?: string;         // External ref: eCourts order ID, communication_history.id, etc.

  // Ordering & labelling
  position: number;           // 0-based drag-drop index
  sectionLabel?: string;      // e.g. "Court Orders", "Petitioner Documents"
  documentName: string;

  // Pagination (populated after PDF generation)
  pageStart?: number;
  pageEnd?: number;
  batesStart?: string;        // e.g. "SLP2024_0001"
  batesEnd?: string;

  // Missing document placeholder
  isPlaceholder: boolean;
  placeholderReason?: string;

  // OCR bookmark
  bookmarkLabel?: string;     // Extracted from page title OCR or heading
  bookmarkPage?: number;

  createdAt: string;
}

/** Version snapshot stored inside filing_bundles.version_history JSONB */
export interface BundleVersionSnapshot {
  version: number;
  downloadUrl: string;
  fileName: string;
  generatedAt: string;
  generatedBy: string;
}

/** Core data model — maps to filing_bundles table */
export interface FilingBundle {
  // Spec §9 fields
  id: string;
  caseId: string;
  bundleType: BundleType;
  documentList: BundleDocument[];    // Ordered array
  missingDocuments: string[];        // DocumentRequirement.id refs for absent required docs
  generatedBy?: string;              // user_profiles.id
  generatedAt?: string;              // ISO datetime
  downloadUrl?: string;
  status: BundleStatus;

  // Extended fields
  teamId: string;
  structureRule: StructureRule;
  batesPrefix: string;               // e.g. "SLP2024" → SLP2024_0001
  batesStartNumber: number;
  pageNumberStart: number;
  fileName?: string;                 // Auto-named: SLP_PaperBook_Final.pdf
  version: number;
  versionHistory: BundleVersionSnapshot[];
  associatePermission: boolean;      // AOR can grant associates access

  createdAt: string;
  updatedAt: string;
}

/** Aggregated document entry returned by aggregateDocumentSources() */
export interface AggregatedDocument {
  id: string;                        // Stable unique key across sources
  documentName: string;
  sourceType: BundleSourceType;
  sourceRef?: string;
  documentId?: string;               // Supabase documents.id if available
  fileUrl?: string;                  // Direct URL to file bytes
  fileSizeKB?: number;
  uploadedAt?: string;
  isAvailable: boolean;              // false = placeholder (doc not yet received)
  linkedRequirementId?: string;      // DocumentRequirement.id if AI-detected
}

// ─── FEATURE 3: DEFECT DETECTION ENGINE ───────────────────────────────────────

export type DefectStatus = 'Pending' | 'In Progress' | 'Resolved';
export type DefectSource = 'SC Registry' | 'AI' | 'Manual';
export type DefectAssignee = 'Clerk' | 'Junior' | 'Translator' | 'Unassigned';

export interface DocDefect {
  id: string;
  caseId: string;
  defectTitle: string;
  description: string;
  pageNumber?: string;
  paragraphReference?: string;
  ruleViolated?: string;
  cureSteps?: string;
  draftTemplate?: string;
  sampleText?: string;
  assignedTo?: DefectAssignee | string;
  status: DefectStatus;
  timeToResolve?: string;
  source: DefectSource;
  createdAt: string; // ISO
  resolvedAt?: string; // ISO
}