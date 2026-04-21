import { Case, CaseStatus, ApiCaseResponse } from '../types';

export const transformApiResponseToCase = (apiResponse: ApiCaseResponse): Case => {
  const { data } = apiResponse;

  const determineStatus = (statusBadge: string): CaseStatus => {
    const badge = statusBadge.toUpperCase();
    if (badge === 'DISPOSED') return CaseStatus.CLOSED;
    if (badge === 'DEFECTIVE') return CaseStatus.DEFECTIVE;
    if (badge === 'PENDING') return CaseStatus.PENDING;
    return CaseStatus.ACTIVE;
  };

  const caseId = `${data.diaryNo}-${data.diaryYear}`;

  return {
    id: caseId,
    parties: data.parties,
    diaryNo: data.diaryNo,
    diaryYear: data.diaryYear,
    caseNumber: data.caseNumber,
    lastListedOn: data.lastListedOn,
    status: determineStatus(data.caseStatusBadge)
  };
};
// ── transformMCPToCase ─────────────────────────────────────────────────────────
// Converts the raw response from fetchCaseByDiary (eCourts MCP API) into the
// same case shape that transformApiToCase (SearchCaseForm) produces.
// This allows SearchCaseForm's handleSearch to use the eCourts API path
// while producing identical case objects for the dashboard.

export function transformMCPToCase(
    mcpData: any,
    cnrOverride?: string
): any | null {
    if (!mcpData) return null;

    // eCourts full response: { data: { courtCaseData: {...} }, meta: {...} }
    // eCourts search result: flat object { cnr, petitioners, caseStatus, ... }
    const d = mcpData?.data?.courtCaseData || mcpData;
    const entityInfo = mcpData?.data?.entityInfo || {};

    const now = new Date().toISOString();
    const caseId = `case-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // eCourts uses caseStatus (not caseStatusBadge)
    // Map to UI status keys: Fresh, Pending, Disposed (matches STATUS_STYLES in AppContext)
    // eCourts "FRESH" = newly registered, not yet heard (SC website shows these as "PENDING")
    // Default to 'Pending' so unknown/empty statuses match SC website behavior
    const statusRaw = (d.caseStatus || d.caseStatusBadge || d.status || '').toUpperCase();
    let status = 'Pending';
    // eCourts API uses various disposal outcome words instead of just "DISPOSED"
    const disposalKeywords = ['DISPOSED', 'ALLOWED', 'DISMISSED', 'WITHDRAWN', 'SETTLED', 'DISPOSED OF', 'QUASHED', 'DECREED', 'CONVICTED', 'ACQUITTED', 'ABATED'];
    if (disposalKeywords.some(k => statusRaw === k || statusRaw.startsWith(k))) status = 'Disposed';
    else if (statusRaw === 'FRESH') status = 'Fresh';
    else if (statusRaw === 'DEFECTIVE') status = 'Pending';
    else if (statusRaw === 'PENDING') status = 'Pending';
    else if (statusRaw === 'ACTIVE') status = 'Pending';

    // petitioners/respondents are plain string arrays in eCourts API
    const petitionersArr: string[] = Array.isArray(d.petitioners)
        ? d.petitioners
        : d.petitioner ? [d.petitioner] : [];
    const respondentsArr: string[] = Array.isArray(d.respondents)
        ? d.respondents
        : d.respondent ? [d.respondent] : [];

    const petitionerRaw = petitionersArr[0] || '';
    const respondentRaw = respondentsArr[0] || '';

    // petitionerAdvocates/respondentAdvocates are plain string arrays (not tagged strings)
    const petitionerAdvocates: string[] = Array.isArray(d.petitionerAdvocates)
        ? d.petitionerAdvocates : [];
    const respondentAdvocates: string[] = Array.isArray(d.respondentAdvocates)
        ? d.respondentAdvocates : [];

    const theCnr = d.cnr || d.cnrNumber || cnrOverride || '';

    // Derive diary number and year from CNR (SCIN01XXXXXXYYYY format)
    // e.g. SCIN010005422026 → diary = "542", year = "2026"
    const cnrMatch = theCnr.match(/^SCIN01(\d{6})(\d{4})$/i);
    const diaryFromCnr = cnrMatch ? String(parseInt(cnrMatch[1], 10)) : '';
    const yearFromCnr  = cnrMatch ? cnrMatch[2] : '';

    // Extract hearings array from whichever field the API uses
    // Debug confirmed: eCourts partner API uses 'historyOfCaseHearings' (past) and 'listingDates' (scheduled)
    const historyArr: any[] = Array.isArray(d.historyOfCaseHearings) ? d.historyOfCaseHearings
        : Array.isArray(d.hearings) ? d.hearings
        : Array.isArray(d.hearingHistory) ? d.hearingHistory
        : Array.isArray(d.caseHearings) ? d.caseHearings : [];

    // Helper: extract date from any hearing record — covers all known eCourts field names
    const getHearingDate = (h: any): string =>
        h.businessDate || h.hearingDate || h.date || h.caseHearingDate || h.clDate
        || h.nextDate || h.listingDate || h.scheduledDate || '';

    // Helper: normalize date to YYYY-MM-DD
    const toISO = (raw: string): string => {
        if (!raw) return '';
        if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
        const dmy = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
        return raw;
    };

    // Merge scheduled listing dates (future) with hearing history (past)
    const scheduledArr: any[] = Array.isArray(d.listingDates) ? d.listingDates : [];
    const hearingsArr: any[] = [...historyArr, ...scheduledArr];

    // First future scheduled date (for nextHearingDate / likelyListedOn fallback)
    const today = new Date().toISOString().slice(0, 10);
    const firstFutureScheduled = scheduledArr
      .map(h => getHearingDate(h))
      .filter(d => d >= today)
      .sort()[0] || '';

    // eCourts sometimes uses nextHearingDate for the last heard date when no future date is set yet.
    // If nextHearingDate is in the past, treat it as the last listed date instead.
    const nextHearingISO = toISO(d.nextHearingDate || d.next_hearing_date || '');
    const nextHearingIsPast = nextHearingISO && nextHearingISO < today;
    const nextHearingIsFuture = nextHearingISO && nextHearingISO >= today;

    // Extract latest hearing date from arrays if top-level field is missing
    const latestHearingDate = (() => {
        if (historyArr.length === 0) return null;
        const sorted = historyArr.slice().sort((a: any, b: any) => {
            const da = getHearingDate(a);
            const db = getHearingDate(b);
            return da > db ? -1 : 1;
        });
        return getHearingDate(sorted[0]) || null;
    })();

    // Map hearings to the listings format used by ListingsSection
    const listingsFromAPI = hearingsArr.map((h: any, i: number) => {
        const rawDate = getHearingDate(h);
        const isoDate = toISO(rawDate);

        const judgesRaw = Array.isArray(h.judges) ? h.judges.join(', ')
            : Array.isArray(h.coram) ? h.coram.join(', ')
            : (h.judge || h.judgeNames || h.bench || '');

        const purpose = h.purpose || h.purposeOfHearing || h.causeOfHearing
            || h.stage || h.type || h.listType || '';
        const miscRegular = h.miscRegular || (purpose.toLowerCase().includes('misc') ? 'Misc.' : 'Regular');

        return {
            id: `l_api_${i}_${Date.now()}`,
            date: isoDate,
            type: purpose || 'Listed',
            bench: judgesRaw,
            court: h.courtNumber || h.court || h.proposedList || h.courtNo || '',
            item: h.itemNo || h.item || h.clItemNo || h.srNo || '',
            notes: `${miscRegular}${purpose ? ' · ' + purpose : ''} — synced from eCourts API`,
        };
    }).filter((l: any) => l.date);

    // Extract latest order date from judgmentOrders as last-resort fallback
    const latestOrderDate = (() => {
        if (!Array.isArray(d.judgmentOrders) || d.judgmentOrders.length === 0) return null;
        const sorted = d.judgmentOrders.slice().sort((a: any, b: any) => {
            const da = a.orderDate || a.date || a.judgmentDate || '';
            const db = b.orderDate || b.date || b.judgmentDate || '';
            return da > db ? -1 : 1;
        });
        return sorted[0]?.orderDate || sorted[0]?.date || sorted[0]?.judgmentDate || null;
    })();

    // ourSide — match logged-in AOR name against advocate lists
    let ourSide: 'petitioner' | 'respondent' | null = null;
    try {
        const userRaw = localStorage.getItem('lextgress_user');
        if (userRaw) {
            const user = JSON.parse(userRaw);
            const aorName = (user.aorName || '').trim().toUpperCase();
            if (aorName) {
                const norm = (s: string) => s.trim().toUpperCase();
                if (petitionerAdvocates.some(a => norm(a) === aorName)) ourSide = 'petitioner';
                else if (respondentAdvocates.some(a => norm(a) === aorName)) ourSide = 'respondent';
            }
        }
    } catch { /* ignore */ }

    return {
        id: caseId,
        petitioner: petitionerRaw,
        respondent: respondentRaw,
        petitioners: petitionersArr,
        respondents: respondentsArr,
        parties: petitionersArr.concat(respondentsArr).join(' vs ') || '',
        caseType: (() => {
            // Try direct fields first
            if (d.caseType && d.caseType !== 'UNKNOWN') return d.caseType;
            if (d.case_type && d.case_type !== 'UNKNOWN') return d.case_type;
            // Try parsing from combined caseNo field e.g. "SLP(Crl)/000878/2026"
            const caseNoRaw = d.caseNo || d.case_no || '';
            const caseNoMatch = caseNoRaw.match(/^([A-Z][A-Z0-9()]+)\//i);
            if (caseNoMatch) return caseNoMatch[1];
            return '';
        })(),
        shortCaseNumber: (() => {
            // Short form: used in card badge as "{caseType} {shortCaseNumber}"
            // Zero-pad registration number to 6 digits to match SC website format (e.g. 000878)
            const rawRegNo = d.registrationNumber || d.registration_number || '';
            const regYear = d.cnrYear || yearFromCnr || '';
            if (rawRegNo && regYear) {
                // If already contains "/" year is embedded — don't double-append
                if (rawRegNo.includes('/')) return rawRegNo;
                const padded = /^\d+$/.test(rawRegNo) ? rawRegNo.padStart(6, '0') : rawRegNo;
                return `${padded}/${regYear}`;
            }
            // Fallback: try to extract just number/year from caseNo
            const caseNoRaw = d.caseNo || d.case_no || '';
            const numMatch = caseNoRaw.match(/(\d+)[\/\s-]+(\d{4})/);
            if (numMatch) return `${numMatch[1].padStart(6, '0')}/${numMatch[2]}`;
            return d.caseNumber || d.case_number || '';
        })(),
        caseNumber: (() => {
            // Full form shown in Case Information panel: "SLP(Crl) No. 000878/2026"
            const rawRegNo = d.registrationNumber || d.registration_number || '';
            const regYear = d.cnrYear || yearFromCnr || '';
            const caseT = (() => {
                if (d.caseType && d.caseType !== 'UNKNOWN') return d.caseType;
                if (d.case_type && d.case_type !== 'UNKNOWN') return d.case_type;
                const caseNoRaw = d.caseNo || d.case_no || '';
                const m = caseNoRaw.match(/^([A-Z][A-Z0-9()]+)\//i);
                return m ? m[1] : '';
            })();
            if (rawRegNo && regYear) {
                const padded = rawRegNo.includes('/')
                    ? rawRegNo
                    : `${/^\d+$/.test(rawRegNo) ? rawRegNo.padStart(6, '0') : rawRegNo}/${regYear}`;
                return caseT ? `${caseT} No. ${padded}` : `No. ${padded}`;
            }
            return d.caseNumber || d.case_number || d.caseNo || d.case_no || '';
        })(),
        diaryNumber: diaryFromCnr || d.filingNumber || d.diaryNo || d.diary_no || '',
        diaryYear: yearFromCnr || d.cnrYear || (d.filingDate ? String(d.filingDate).slice(0, 4) : ''),
        cnrNumber: theCnr,
        status,
        nextHearingDate: nextHearingIsFuture ? nextHearingISO : (toISO(d.nextDate || d.next_date || firstFutureScheduled || entityInfo.nextDateOfHearing || '') || null),
        lastListedOn: toISO(entityInfo.lastDateOfHearing || d.lastHearingDate || d.lastListedOn || d.last_listed_on || d.lastHearing || d.lastDate || d.last_date || d.latestHearingDate || latestHearingDate || latestOrderDate || '') || (nextHearingIsPast ? nextHearingISO : null),
        likelyListedOn: toISO(d.likelyListedOn || d.tentativeDate || firstFutureScheduled || '') || (nextHearingIsFuture ? nextHearingISO : null),
        advanceList: { published: false, date: null, presentInList: false },
        finalList: { published: false, date: null, presentInList: false },
        lastCheckedAt: now,
        labels: [],
        lastListedJudges: Array.isArray(d.judges) ? d.judges : (Array.isArray(d.coram) ? d.coram : []),
        finalListJudges: [],
        courtName: d.courtName || d.court_name || 'Supreme Court of India',
        courtNumber: d.courtNumber || d.court_number || 'Court No. 1',
        timeOfSitting: d.timeOfSitting || '10:30 AM',
        dateOfFiling: d.filingDate || d.filed || d.date_of_filing || d.dateOfFiling || now.split('T')[0],
        registrationDate: d.registrationDate || d.caseRegistrationDate || d.registeredOn || d.case_registered_on || null,
        verificationDate: d.verificationDate || d.caseVerificationDate || d.verifiedOn || d.case_verified_on || null,
        earlierCourtDetails: Array.isArray(d.earlierCourtDetails) && d.earlierCourtDetails.length > 0 ? d.earlierCourtDetails : '—',
        officeReportUrl: '',
        lastOrdersUrl: '',
        stage: d.stage || d.purpose || d.purposeOfHearing || d.currentStage || '',
        lastListedOnRaw: d.lastHearingDate || d.lastListedOn || d.lastHearing || d.lastDate || latestHearingDate || latestOrderDate || '',
        scSyncedAt: now,
        summary: d.caseAiAnalysis?.caseSummary || '',
        listings: listingsFromAPI,
        keyRisk: false,
        tasks: [],
        notes: [{
            id: 'n' + Date.now(),
            text: `Case retrieved via eCourts API on ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}.`,
            createdAt: now,
        }],
        documents: [],
        applications: [],
        timeline: [{
            id: 'tl' + Date.now(),
            date: d.filingDate || d.filed || now.split('T')[0],
            event: 'Case filed',
            type: 'filing',
        }],
        archived: false,
        petitionerAdvocates,
        respondentAdvocates,
        ourSide,
        displayTitle: petitionerRaw
            ? `${petitionerRaw.split(',')[0]?.trim()} vs ${respondentRaw.split(',')[0]?.trim() || '...'}`
            : d.caseNumber || theCnr,
    };
}