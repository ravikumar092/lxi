/**
 * Lower Court Sync Service
 * ──────────────────────────────────────────────────────────────────────────────
 * Fetches real-time status of the High Court / Trial Court case that originated
 * the Supreme Court matter.  Uses a multi-tier approach:
 *
 *   Tier 1  — eCourts Partner API  (if HC CNR is available from earlierCourtDetails)
 *   Tier 2  — Derive from existing earlierCourtDetails already in the case object
 *   Tier 3  — Return null (caller shows "No lower court data found" state)
 *
 * Caching
 *   localStorage key:  lx_lc_status_{cnr}   (cnr = SC case CNR)
 *   TTL:               6 hours
 *
 * ── NOTES ─────────────────────────────────────────────────────────────────────
 * The eCourts Partner API identifies HC cases via their CNR number.
 * The CNR for the HC case comes from `earlierCourtDetails[*].cnr` which
 * eCourts sometimes returns.  When it is absent we fall back to Tier 2.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { LowerCourtStatus, LowerCourtHearingEntry } from '../types/hearingPrep';
import { searchCases } from './eCourtsService';

const _backendUrl: string = (import.meta as any).env?.VITE_BACKEND_URL || '';
const BASE = `${_backendUrl}/ecourts-api`;

// ── CACHE ─────────────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function cacheKey(cnr: string): string {
  return `lx_lc_status_${cnr}`;
}

function readCache(cnr: string): LowerCourtStatus | null {
  try {
    const raw = localStorage.getItem(cacheKey(cnr));
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw) as { data: LowerCourtStatus; ts: number };
    if (Date.now() - ts < CACHE_TTL_MS) return data;
    localStorage.removeItem(cacheKey(cnr));
    return null;
  } catch {
    return null;
  }
}

function writeCache(cnr: string, data: LowerCourtStatus): void {
  try {
    localStorage.setItem(cacheKey(cnr), JSON.stringify({ data, ts: Date.now() }));
  } catch { /* quota exceeded */ }
}

/** Force-clear cached lower court data for an SC CNR. */
export function clearLowerCourtCache(scCnr: string): void {
  try { localStorage.removeItem(cacheKey(scCnr)); } catch { /* ignore */ }
}

/** Returns true if valid (non-stale) cached data exists for the given SC CNR. */
export function isLowerCourtCached(scCnr: string): boolean {
  return readCache(scCnr) !== null;
}

/** Returns true if the cached data is older than 6 hours (i.e., needs refresh). */
export function isLowerCourtStale(scCnr: string): boolean {
  try {
    const raw = localStorage.getItem(cacheKey(scCnr));
    if (!raw) return true;
    const { ts } = JSON.parse(raw) as { ts: number };
    return Date.now() - ts >= CACHE_TTL_MS;
  } catch {
    return true;
  }
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

/** Convert various date formats to ISO YYYY-MM-DD. */
function toISO(s: string | null | undefined): string | null {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dmy = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const readable = s.match(/(\d{1,2})\s+(\w{3})\s+(\d{4})/);
  if (readable) {
    const months: Record<string, string> = {
      Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
      Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12',
    };
    return `${readable[3]}-${months[readable[2]] || '01'}-${readable[1].padStart(2,'0')}`;
  }
  return null;
}

/** Detect bail-related keywords in a stage string. */
function parseBailStatus(stage: string): string | null {
  const s = stage.toLowerCase();
  if (s.includes('bail granted') || s.includes('bail allowed')) return 'Bail Granted';
  if (s.includes('bail rejected') || s.includes('bail refused')) return 'Bail Rejected';
  if (s.includes('anticipatory bail')) return 'Anticipatory Bail';
  if (s.includes('regular bail')) return 'Regular Bail';
  if (s.includes('bail')) return 'Bail Matter';
  return null;
}

/** Detect interim/stay order keywords in stage/order text. */
function detectInterimOrder(stage: string, orderText?: string): boolean {
  const combined = ((stage || '') + ' ' + (orderText || '')).toLowerCase();
  return (
    combined.includes('stay granted') ||
    combined.includes('status quo') ||
    combined.includes('interim order') ||
    combined.includes('interim relief') ||
    combined.includes('stay order') ||
    combined.includes('injunction')
  );
}

/**
 * Heuristic: Calculate adjournment breakdown by searching keywords in hearing notes.
 */
export function calculateAdjournmentBreakdown(history: LowerCourtHearingEntry[]): { petitioner: number; respondent: number; court: number } {
  const breakdown = { petitioner: 0, respondent: 0, court: 0 };
  if (!history || history.length === 0) return breakdown;

  history.forEach(h => {
    const note = (h.notes || '').toLowerCase() + ' ' + (h.stage || '').toLowerCase();
    if (note.includes('petitioner') || note.includes('appellant')) {
       if (note.includes('sought time') || note.includes('adjournment') || note.includes('counsel sought')) {
         breakdown.petitioner++;
         return;
       }
    }
    if (note.includes('respondent') || note.includes('service') || note.includes('notice')) {
       if (note.includes('sought time') || note.includes('time to file') || note.includes('not present')) {
         breakdown.respondent++;
         return;
       }
    }
    breakdown.court++; // Default to court/paupacity of time if no clear requester
  });
  return breakdown;
}

/**
 * AI-Derived Insights: Trajectory and Delay Indicators.
 */
export function calculateAIInsights(status: Partial<LowerCourtStatus>): LowerCourtStatus['aiInsights'] {
  const history = status.hearingHistory || [];
  const stage = (status.stage || '').toLowerCase();
  const lastDate = status.lastHearingDate ? new Date(status.lastHearingDate) : null;
  const today = new Date();

  let trajectory: 'Accelerating' | 'Normal' | 'Stalled' | 'Disposed' = 'Normal';
  let delayIndicator: 'None' | 'Minor' | 'Critical' = 'None';
  let patternNote = 'Regular progression.';

  // 1. Trajectory
  if (stage.includes('disposed') || stage.includes('decided') || stage.includes('dismissed') || stage.includes('allowed')) {
    trajectory = 'Disposed';
    patternNote = 'Case has reached final disposal.';
  } else if (lastDate) {
    const monthsSinceLast = (today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
    if (monthsSinceLast > 12) {
      trajectory = 'Stalled';
      patternNote = 'No hearing for over a year (Stalled).';
    } else if (history.length >= 3) {
      // Check interval between last few hearings
      const last3 = history.slice(0, 3).map(h => new Date(h.date).getTime());
      const avgInterval = ((last3[0] - last3[1]) + (last3[1] - last3[2])) / 2 / (1000 * 60 * 60 * 24);
      if (avgInterval < 30) {
        trajectory = 'Accelerating';
        patternNote = 'Hearings are occurring frequently (Accelerating).';
      }
    }
  }

  // 2. Delay Indicator
  if (trajectory !== 'Disposed') {
     if (lastDate) {
       const daysSinceLast = (today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
       if (daysSinceLast > 365) delayIndicator = 'Critical';
       else if (daysSinceLast > 180) delayIndicator = 'Minor';
     }
  }

  return { trajectory, delayIndicator, patternNote };
}

/** Map Indian High Court names to 2-letter eCourts state codes. */
const COURT_STATE_MAP: Record<string, string> = {
  'HIGH COURT OF DELHI': 'DL',
  'DELHI HIGH COURT': 'DL',
  'HIGH COURT OF BOMBAY': 'MH',
  'BOMBAY HIGH COURT': 'MH',
  'HIGH COURT OF JUDICATURE AT BOMBAY': 'MH',
  'HIGH COURT OF MADRAS': 'TN',
  'MADRAS HIGH COURT': 'TN',
  'HIGH COURT OF KARNATAKA': 'KA',
  'KARNATAKA HIGH COURT': 'KA',
  'HIGH COURT OF ALLAHABAD': 'UP',
  'ALLAHABAD HIGH COURT': 'UP',
  'HIGH COURT OF JUDICATURE AT ALLAHABAD': 'UP',
  'HIGH COURT OF CALCUTTA': 'WB',
  'CALCUTTA HIGH COURT': 'WB',
  'HIGH COURT OF GUJARAT': 'GJ',
  'GUJARAT HIGH COURT': 'GJ',
  'HIGH COURT OF MADHYA PRADESH': 'MP',
  'MADHYA PRADESH HIGH COURT': 'MP',
  'HIGH COURT OF RAJASTHAN': 'RJ',
  'RAJASTHAN HIGH COURT': 'RJ',
  'HIGH COURT OF ORISSA': 'OR',
  'ORISSA HIGH COURT': 'OR',
  'HIGH COURT OF PATNA': 'BR',
  'PATNA HIGH COURT': 'BR',
  'HIGH COURT OF TELANGANA': 'TS',
  'TELANGANA HIGH COURT': 'TS',
  'HIGH COURT OF ANDHRA PRADESH': 'AP',
  'ANDHRA PRADESH HIGH COURT': 'AP',
  'HIGH COURT OF KERALA': 'KL',
  'KERALA HIGH COURT': 'KL',
  'HIGH COURT OF PUNJAB & HARYANA': 'PH',
  'PUNJAB AND HARYANA HIGH COURT': 'PH',
  'HIGH COURT OF HIMACHAL PRADESH': 'HP',
  'HIMACHAL PRADESH HIGH COURT': 'HP',
  'HIGH COURT OF JAMMU & KASHMIR': 'JK',
  'JAMMU AND KASHMIR HIGH COURT': 'JK',
  'HIGH COURT OF JHARKHAND': 'JH',
  'JHARKHAND HIGH COURT': 'JH',
  'HIGH COURT OF CHHATTISGARH': 'CH',
  'CHHATTISGARH HIGH COURT': 'CH',
  'HIGH COURT OF UTTARAKHAND': 'UA',
  'UTTARAKHAND HIGH COURT': 'UA',
  'HIGH COURT OF GAUHATI': 'AS',
  'GAUHATI HIGH COURT': 'AS',
  'HIGH COURT OF MANIPUR': 'MN',
  'HIGH COURT OF MEGHALAYA': 'ML',
  'HIGH COURT OF TRIPURA': 'TR',
  'HIGH COURT OF SIKKIM': 'SK',
};

function mapCourtToState(courtName: string): string | null {
  if (!courtName) return null;
  const n = courtName.toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  
  // Direct match
  if (COURT_STATE_MAP[n]) return COURT_STATE_MAP[n];
  
  // Partial match
  for (const [key, code] of Object.entries(COURT_STATE_MAP)) {
    if (n.includes(key) || key.includes(n)) return code;
  }
  
  // Keyword extraction for District Courts
  if (n.includes('DELHI')) return 'DL';
  if (n.includes('MAHARASHTRA') || n.includes('MUMBAI')) return 'MH';
  if (n.includes('TAMIL NADU') || n.includes('CHENNAI')) return 'TN';
  if (n.includes('UTTAR PRADESH')) return 'UP';
  if (n.includes('KARNATAKA')) return 'KA';
  
  return null;
}

/**
 * Scan a text block (e.g. Office Report) for High Court metadata.
 * Returns a partial EarlierCourtDetails object or null.
 */
function extractMetadataFromText(text: string): any | null {
  if (!text) return null;

  // 1. Look for 16-char CNR [A-Z]{4}\d{12}
  const cnrMatch = text.match(/[A-Z]{4}\d{12}/);
  if (cnrMatch) {
    return { cnr: cnrMatch[0], dataSource: 'Office Report (Scanned)' };
  }

  // 2. Look for Case Type + No + Year (e.g. SLP(C) No. 1234/2024 or WP (C) 5678 of 2023)
  const caseNoRe = /(SLP|W\.?P|C\.?A|T\.?P|Crl?\.?\s*A?|REVIEW|CONTEMPT)\s*\(?[A-Z.]+\)?\s*No\.?\s*(\d{1,6})\s*[\/\-]\s*(\d{4})/i;
  const caseMatch = text.match(caseNoRe);
  
  // 3. Look for High Court Name
  const courtMatch = text.match(/(HIGH COURT OF [A-Z&\s]+|DELHI HIGH COURT|BOMBAY HIGH COURT|MADRAS HIGH COURT)/i);
  
  if (caseMatch || courtMatch) {
    return {
      caseNumber: caseMatch ? `${caseMatch[1]} No. ${caseMatch[2]}/${caseMatch[3]}` : undefined,
      courtName: courtMatch ? courtMatch[1].trim() : undefined,
      dataSource: 'Office Report (Scanned)'
    };
  }

  return null;
}

/**
 * Tier 1.4: Office Report Extraction.
 * Fetches the SC Office Report and scans it for HC metadata.
 */
async function fetchFromOfficeReportBridge(diaryNo: string, diaryYear: string): Promise<any | null> {
  const { fetchOfficeReport } = await import('./eCourtsService');
  const report = await fetchOfficeReport(diaryNo, diaryYear);
  if (!report?.text) return null;

  console.log(`[LCS] Scanning Office Report for ${diaryNo}/${diaryYear}...`);
  return extractMetadataFromText(report.text);
}


// ── TIER 1: eCourts API ───────────────────────────────────────────────────────

/**
 * Fetch case details from eCourts Partner API using HC CNR.
 * Returns full courtCaseData or null.
 */
async function fetchFromECourts(hcCnr: string): Promise<any | null> {
  try {
    const res = await fetch(`${BASE}/api/partner/case/${hcCnr}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data?.courtCaseData ?? null;
  } catch {
    return null;
  }
}

/** Transform raw eCourts courtCaseData into LowerCourtStatus. */
function transformECourtsToLCS(raw: any, courtName: string, scCaseId?: string): LowerCourtStatus {
  // eCourts Partner API uses historyOfCaseHearings (past) and listingDates (future)
  const history = Array.isArray(raw.historyOfCaseHearings) ? raw.historyOfCaseHearings : [];
  const listings = Array.isArray(raw.listingDates) ? raw.listingDates : [];
  const combined = [...history, ...listings];

  const hearingHistory: LowerCourtHearingEntry[] = combined.map(
    (h: any): LowerCourtHearingEntry => {
      const hDate = h.businessDate || h.hearingDate || h.date || h.listingDate || '';
      return {
        date: toISO(hDate) || '',
        stage: h.purpose || h.purposeOfHearing || h.stage || h.caseStage || h.listType || '',
        judge: h.judge || h.judgeName || h.bench || undefined,
        notes: h.remarks || h.causeOfHearing || undefined,
      };
    }
  ).filter((h: LowerCourtHearingEntry) => h.date);

  // Sort history by date descending
  hearingHistory.sort((a, b) => b.date.localeCompare(a.date));

  const adjCount = history.length;
  const stage = raw.caseStatus || raw.stage || raw.currentStage || raw.purpose || '';
  
  // Find last order
  const orders = Array.isArray(raw.judgmentOrders) ? raw.judgmentOrders : (Array.isArray(raw.orders) ? raw.orders : []);
  const lastOrderEntry = orders[0];
  const lastOrderURL = lastOrderEntry?.filename
    ? `${BASE}/api/partner/case/${raw.cnrNumber || raw.cnr || ''}/order/${lastOrderEntry.filename}`
    : null;

  const today = new Date().toISOString().slice(0, 10);
  const nextDateVal = raw.nextHearingDate || raw.nextDate || listings.find((l: any) => (l.businessDate || l.listingDate) >= today)?.businessDate;

  const result: LowerCourtStatus = {
    caseId: scCaseId,
    courtType: detectCourtType(courtName || raw.courtName || ''),
    courtName: courtName || raw.courtName || 'Unknown Court',
    caseNumber: raw.caseNumber || raw.caseNo || raw.registrationNumber || '',
    cnrNumber: raw.cnrNumber || raw.cnr || undefined,
    lastHearingDate: toISO(raw.lastHearingDate || raw.lastDate || (history[0]?.businessDate) || (hearingHistory.find(h => h.date < today)?.date)),
    nextHearingDate: toISO(nextDateVal),
    stage,
    lastOrderURL,
    interimOrderFlag: detectInterimOrder(stage),
    bailStatus: parseBailStatus(stage),
    adjournmentCount: adjCount,
    adjournmentBreakdown: calculateAdjournmentBreakdown(hearingHistory),
    hearingHistory,
    lastFetchedAt: new Date().toISOString(),
    dataSource: 'API',
  };
  
  // Attach AI insights
  result.aiInsights = calculateAIInsights(result);
  return result;
}




// ── TIER 2: Derive from earlierCourtDetails ───────────────────────────────────

/**
 * Derive a best-effort LowerCourtStatus from the SC case's earlierCourtDetails.
 * Enhanced to extract CNR from strings if present.
 */
function deriveFromEarlierCourt(caseObj: any): LowerCourtStatus | null {
  const details = caseObj?.earlierCourtDetails;
  const arr = Array.isArray(details) ? details : (details && details !== '—' ? [details] : []);
  if (!arr.length) return null;

  // Pick the most relevant entry (challenged judgment preferred)
  const primary = arr.find((d: any) =>
    d.judgmentChallenged === 'Yes' || d.judgment_challenged === 'Yes'
  ) || arr[0];

  if (!primary) return null;

  // Robust CNR extraction from primary object
  let foundCnr = primary.cnr || primary.cnrNumber || undefined;
  if (!foundCnr) {
    // Search all values in the primary object for a 16-char CNR pattern [A-Z]{4}\d{12}
    const blob = JSON.stringify(primary);
    const m = blob.match(/[A-Z]{4}\d{12}/);
    if (m) foundCnr = m[0];
  }

  const cn = primary.courtName || primary.court || primary.court_name || primary.agencyCode || '';
  const caseNo = primary.caseNumber || primary.caseNo || primary.case_number || '';
  if (!cn && !caseNo && !foundCnr) return null;

  const orderDate = toISO(primary.orderDate || primary.filingDate || primary.order_date || '');
  const stage = primary.judgmentType || primary.judgment || primary.judgement || 'Judgment Challenged';

  return {
    caseId: caseObj.id,
    courtType: detectCourtType(cn),
    courtName: formatCourtName(primary),
    caseNumber: caseNo,
    cnrNumber: foundCnr,
    lastHearingDate: orderDate,
    nextHearingDate: null,
    stage,
    lastOrderURL: null,
    interimOrderFlag: false,
    bailStatus: parseBailStatus(stage),
    adjournmentCount: 0,
    adjournmentBreakdown: { petitioner: 0, respondent: 0, court: 0 },
    hearingHistory: orderDate
      ? [{ date: orderDate, stage, notes: 'Derived from SC earlier court details' }]
      : [],
    lastFetchedAt: new Date().toISOString(),
    dataSource: 'Derived',
  };
}

/** Detect whether a court is HC, Trial or District from its name. */
function detectCourtType(name: string): 'High Court' | 'Trial Court' | 'District Court' {
  const n = name.toLowerCase();
  if (n.includes('high court')) return 'High Court';
  if (n.includes('district')) return 'District Court';
  return 'Trial Court';
}

/** Build a clean court display name from earlier court details object. */
function formatCourtName(d: any): string {
  const name  = d.courtName || d.court || d.court_name || d.agency_code || '';
  const state = d.state || d.stateName || '';
  if (name && state && !name.toLowerCase().includes(state.toLowerCase())) {
    return `${name} — ${state}`;
  }
  return name || state || 'Unknown Court';
}

/**
 * Tier 1.5: Discovery Search.
 * If CNR is missing, try to find the case by searching for the petitioner name
 * within the identified state/court context.
 */
async function discoverCNR(caseObj: any): Promise<{ cnr: string; courtName: string } | null> {
  const petitioner = (caseObj.petitioners?.[0] || caseObj.petitioner || '').split(',')[0].split('vs')[0].trim();
  if (!petitioner || petitioner.length < 3) return null;

  const details = caseObj.earlierCourtDetails;
  const arr = Array.isArray(details) ? details : (details && details !== '—' ? [details] : []);
  const primary = arr[0];
  if (!primary) return null;

  const courtName = primary.courtName || primary.court || primary.court_name || '';
  const stateCode = primary.state || primary.stateName || mapCourtToState(courtName);
  
  if (!stateCode) return null;

  try {
    console.log(`[LCS] Attempting discovery search for "${petitioner}" in ${stateCode} (${courtName})...`);
    
    // If we have a case number, use it to narrow search significantly (₹0.20 per attempt)
    const caseTypeNo = primary.caseNumber || primary.caseNo || '';
    
    const results = await searchCases({
      petitioners: petitioner,
      state: stateCode.slice(0, 2).toUpperCase(),
      pageSize: 5
    });

    const cases = results?.data?.results || [];
    if (cases.length === 0) return null;

    // Best effort match
    const match = cases.find((c: any) => {
       const regNo = (c.registrationNumber || c.caseNumber || '').toUpperCase();
       const targetNo = caseTypeNo.toUpperCase();
       if (!targetNo) return true;
       // Match "1234/2024" part
       const targetParts = targetNo.match(/(\d+)[\/\s-]+(\d{4})/);
       if (targetParts) {
         return regNo.includes(targetParts[1]) && regNo.includes(targetParts[2]);
       }
       return regNo.includes(targetNo);
    }) || cases[0];

    return {
      cnr: match.cnr || match.cnrNumber,
      courtName: formatCourtName(primary)
    };
  } catch (err) {
    console.error('[LCS] Discovery search failed:', err);
    return null;
  }
}

// ── PUBLIC API ────────────────────────────────────────────────────────────────

/**
 * Main entry point.  Given an SC case object (with earlierCourtDetails embedded),
 * returns the best available LowerCourtStatus.
 *
 * Lookup order:
 *   1. localStorage cache (if fresh < 6h)
 *   2. eCourts API by HC CNR (if available)
 *   3. Derive from earlierCourtDetails
 *   4. null
 *
 * @param scCaseObj  The full SC case object (from Supabase / eCourts)
 * @param forceRefresh  Skip cache and fetch fresh data
 */
export async function fetchLowerCourtStatus(
  scCaseObj: any,
  forceRefresh = false
): Promise<LowerCourtStatus | null> {
  const scCnr = scCaseObj?.cnrNumber;
  const oldStatus = scCaseObj?.lowerCourtStatus || readCache(scCnr);

  // Cache check (skip if forceRefresh)
  if (scCnr && !forceRefresh) {
    const cached = readCache(scCnr);
    if (cached) return cached;
  }

  // Tier 1: Try eCourts API using HC CNR from earlierCourtDetails
  let earlierDetails = scCaseObj?.earlierCourtDetails;
  
  // BRIDGE: If details are missing or have no state/cnr, pull from SC Diary Status (backend scrape)
  if (forceRefresh && (!earlierDetails || earlierDetails === '—' || (Array.isArray(earlierDetails) && earlierDetails.length === 0))) {
    const { fetchSCDiaryStatus } = await import('./eCourtsService');
    const scraped = await fetchSCDiaryStatus(scCaseObj.diaryNumber, scCaseObj.diaryYear);
    if (scraped?.earlierCourtDetails?.length) {
      console.log(`[LCS] Bridge Success: Scraped ${scraped.earlierCourtDetails.length} earlier court entries from SC website.`);
      earlierDetails = scraped.earlierCourtDetails;
      // We don't save to Supabase here, just use it for the current sync session
    } else {
      // BRIDGE TIER 1.4: If Diary Status has no table, try scanning the Office Report text
      const extracted = await fetchFromOfficeReportBridge(scCaseObj.diaryNumber, scCaseObj.diaryYear);
      if (extracted) {
        console.log(`[LCS] Bridge Success: Extracted ${extracted.cnr || extracted.caseNumber} from Office Report text.`);
        earlierDetails = [extracted];
      }
    }
  }

  const arr = Array.isArray(earlierDetails) ? earlierDetails : earlierDetails ? [earlierDetails] : [];

  let result: LowerCourtStatus | null = null;

  for (const d of arr) {
    let hcCnr = d.cnr || d.cnrNumber;
    if (!hcCnr) {
      const m = JSON.stringify(d).match(/[A-Z]{4}\d{12}/);
      if (m) hcCnr = m[0];
    }

    if (!hcCnr) continue;
    try {
      const raw = await fetchFromECourts(hcCnr);
      if (raw) {
        const courtName = formatCourtName(d);
        result = transformECourtsToLCS(raw, courtName, scCaseObj.id);
        console.log(`[LCS] Tier 1 Success: found record for CNR ${hcCnr}`);
        break;
      }
    } catch {
      // fall through
    }
  }

  // Tier 1.5: Discovery Search (Litigant Name + State)
  if (!result && forceRefresh) {
    const discovery = await discoverCNR(scCaseObj);
    if (discovery) {
      try {
        const raw = await fetchFromECourts(discovery.cnr);
        if (raw) {
          result = transformECourtsToLCS(raw, discovery.courtName, scCaseObj.id);
          console.log(`[LCS] Discovery Success: found record for CNR ${discovery.cnr}`);
        }
      } catch { /* ignore */ }
    }
  }

  // Tier 2: Derive from static earlierCourtDetails data
  if (!result) {
    result = deriveFromEarlierCourt(scCaseObj);
  }

  // Final result processing (Tiers 1, 1.5, and 2)
  if (result) {
    if (scCnr) writeCache(scCnr, result);
    
    // Check for changes and trigger notifications
    const { getStatusChanges, triggerExternalAlert } = await import('./notificationService');
    const alerts = getStatusChanges(oldStatus, result);
    for (const alert of alerts) {
      console.log(`[LCS] Alert Triggered: ${alert.title} - ${alert.message}`);
      triggerExternalAlert(scCaseObj.id || scCnr, alert);
    }
    return result;
  }

  // Tier 3: No data
  return null;
}


/**
 * Background Sync: Refreshes all cases that are older than 6 hours.
 */
export async function refreshStaleCases(cases: any[], onUpdate?: (c: any) => void): Promise<void> {
  console.log(`[LCS] Starting background sync check for ${cases.length} cases...`);
  
  for (const c of cases) {
    const cnr = c.cnrNumber;
    if (!cnr) continue;
    
    if (isLowerCourtStale(cnr)) {
      console.log(`[LCS] Refreshing stale case ${cnr}...`);
      const updated = await fetchLowerCourtStatus(c, true);
      if (updated && onUpdate) {
        onUpdate({ ...c, lowerCourtStatus: updated });
      }
    }
  }
  console.log(`[LCS] Background sync complete.`);
}

/**
 * Convenience: fetch by HC CNR directly (used by the Refresh button).
 * Skips cache always.
 */
export async function fetchLowerCourtStatusByCNR(
  hcCnr: string,
  courtName: string
): Promise<LowerCourtStatus | null> {
  try {
    const raw = await fetchFromECourts(hcCnr);
    if (!raw) return null;
    return transformECourtsToLCS(raw, courtName, undefined); // caseId unknown in direct CNR fetch
  } catch {
    return null;
  }
}
