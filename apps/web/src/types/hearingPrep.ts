/**
 * Lex Tigress — Hearing Prep Types
 * All types for the pre-hearing brief system:
 * office report parsing, service tracking, cause list, and hearing brief.
 */

// ── SERVICE / NOTICE TRACKING ─────────────────────────────────────────────────

export type DeliveryStatus =
  | 'delivered'
  | 'in_transit'
  | 'not_delivered'
  | 'unknown'
  | 'not_entered';

export interface RespondentService {
  /** e.g. "Respondent No. 1", "Nakoda Agency" */
  name: string;
  noticeIssuedOn: string | null;     // ISO date
  noticeServedOn: string | null;     // ISO date
  /** 'Complete' | 'Incomplete' | 'Waived' | 'Not Required' */
  serviceStatus: string;
  remarks: string;
  /** Speed post / registered AD tracking number entered by AOR */
  trackingNumber: string | null;
  /** Live result from India Post tracking */
  deliveryStatus: DeliveryStatus;
  deliveryDate: string | null;       // ISO date when delivered
  deliveryLocation: string | null;
  lastTrackingEvent: string | null;
  lastTrackedAt: string | null;      // ISO datetime
  /** Pleadings status from office report */
  vakalatnama: string | null;        // filed date or 'Not filed'
  counterAffidavit: string | null;   // filed date or 'Not filed'
  rejoinder: string | null;          // filed date or 'N/A'
}

// ── INTERLOCUTORY APPLICATIONS ────────────────────────────────────────────────

export interface ParsedIA {
  iaNo: string;
  aorName: string;
  filedOn: string | null;
  description: string;
}

// ── TAGGED / SIMILAR CASES ────────────────────────────────────────────────────

export interface TaggedCase {
  diaryNo: string;
  caseNo: string;
  petitioner: string;
  status: string;
  remarks: string;
}

// ── PARSED OFFICE REPORT ──────────────────────────────────────────────────────

export interface ParsedOfficeReport {
  /** Which diary number this was parsed for */
  diaryNo: string;
  diaryYear: string;
  /** When this was fetched/parsed */
  fetchedAt: string;
  /** 'fresh' | 'after_notice' | 'unknown' */
  reportType: string;
  /** Hearing date from the report header */
  listedOn: string | null;
  courtNo: string | null;
  itemNo: string | null;
  /** Full verbatim text of the last court order */
  lastOrderText: string;
  /** Date of the last order */
  lastOrderDate: string | null;
  /** Structured service status per respondent */
  respondents: RespondentService[];
  /** Whether overall service is complete */
  serviceComplete: boolean;
  /** All IAs/applications filed */
  iaList: ParsedIA[];
  /** Similar or tagged cases from the report */
  taggedCases: TaggedCase[];
  /** Any defect/correction notes from the registrar */
  specialRemarks: string[];
  /** Raw full text (for AI task generation) */
  rawText: string;
  /** Source used: 'html' | 'pdf' | 'none' */
  source: 'html' | 'pdf' | 'none';
  /** Any error that occurred during parsing */
  parseError: string | null;
}

// ── CAUSE LIST ENTRY ──────────────────────────────────────────────────────────

export interface CauseListEntry {
  diaryNo: string;
  caseNo: string;
  courtNo: string;
  itemNo: string;
  listedDate: string;
  parties: string;
}

// ── HEARING BRIEF (the final assembled product) ───────────────────────────────

export interface HearingBrief {
  caseId: string;
  diaryNo: string;
  diaryYear: string;
  hearingDate: string;
  generatedAt: string;
  /** Overall readiness score 0-100 */
  readinessScore: number;
  /** Items that need action before the hearing */
  actionItems: ActionItem[];
  /** From office report parser */
  officeReport: ParsedOfficeReport | null;
  /** From eCourts API */
  lastOrders: any | null;
  /** From eCourts API */
  caseDocuments: any | null;
  /** Court/item from cause list (available night before) */
  courtNo: string | null;
  itemNo: string | null;
}

export interface ActionItem {
  id: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  category: 'service' | 'pleadings' | 'ia' | 'preparation' | 'appearance';
  title: string;
  detail: string;
  /** Which respondent this relates to, if any */
  respondentName?: string;
}

// ── INDIA POST TRACKING RESPONSE ─────────────────────────────────────────────

export interface IndiaPostTrackResult {
  trackingNo: string;
  status: DeliveryStatus;
  deliveryDate: string | null;
  currentLocation: string | null;
  lastEvent: string | null;
  checkedAt: string;
  error: string | null;
}

// ── LOWER COURT STATUS (High Court / Trial Court) ─────────────────────────────

export interface LowerCourtHearingEntry {
  date: string;            // ISO date
  stage: string;
  judge?: string;
  notes?: string;
}

export interface LowerCourtStatus {
  /** Reference to Supreme Court case internal ID */
  caseId?: string;
  /** 'High Court' | 'Trial Court' | 'District Court' */
  courtType: 'High Court' | 'Trial Court' | 'District Court';
  /** Court name e.g. "Delhi High Court" */
  courtName: string;
  /** HC/trial court case number */
  caseNumber: string;
  /** eCourts CNR if available */
  cnrNumber?: string;
  /** ISO date or null */
  lastHearingDate: string | null;
  /** ISO date or null */
  nextHearingDate: string | null;
  /** Stage string e.g. "Judgment Reserved" */
  stage: string;
  /** URL to download the latest order PDF */
  lastOrderURL: string | null;
  /** True if there is a stay/interim order in place */
  interimOrderFlag: boolean;
  /** Bail status e.g. "Regular Bail Granted" or null */
  bailStatus: string | null;
  /** Total number of adjournments */
  adjournmentCount: number;
  /** Breakdown of adjournments by requesting party */
  adjournmentBreakdown: {
    petitioner: number;
    respondent: number;
    court: number;
  };
  /** Hearing history (parsed from eCourts or scraped) */
  hearingHistory: LowerCourtHearingEntry[];
  /** ISO datetime when this data was last fetched */
  lastFetchedAt: string;
  /** Where the data came from */
  dataSource: 'API' | 'Scraped' | 'Derived' | 'Manual';
  /** AI-Derived Insights */
  aiInsights?: {
    trajectory: 'Accelerating' | 'Normal' | 'Stalled' | 'Disposed';
    delayIndicator: 'None' | 'Minor' | 'Critical';
    patternNote: string;
  };
  /** User-flagged inaccuracy */
  accuracyFlag?: 'Incorrect';
  /** Optional user note */
  userNote?: string;
}