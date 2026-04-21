/**
 * Lex Tigress — Hearing Prep Service
 *
 * The main orchestrator. When a hearing date is assigned to a case, call
 * runHearingPrep(case) and it will:
 *
 *   1. Fetch + parse the latest office report from api.sci.gov.in
 *   2. Fetch last orders from eCourts API
 *   3. Fetch case documents/IAs from eCourts API
 *   4. Track all respondents with stored India Post tracking numbers
 *   5. Compute a readiness score
 *   6. Build a list of action items for the advocate
 *   7. Save the HearingBrief to localStorage
 *   8. Feed the brief into AI task generation (Gemini/Groq)
 *
 * This is what gets the office report ready weeks before the hearing
 * instead of the day before.
 */

import type { HearingBrief, ActionItem, ParsedOfficeReport } from '../types/hearingPrep';
import {
  fetchAndParseOfficeReport,
  computeReadinessScore,
} from './officeReportParserService';
import { trackAllRespondents } from './serviceTrackingService';
import { fetchLastOrders, fetchCaseDocuments } from './eCourtsService';
import { assignTasksFromOfficeReport } from './aiTaskService';
import { supabase } from '../lib/supabaseClient';

// ── STORAGE (Supabase) ────────────────────────────────────────────────────────

const BRIEFS_KEY = 'lextgress_hearing_briefs'; // kept for localStorage fallback only

async function getUserId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function loadHearingBrief(caseId: string): Promise<HearingBrief | null> {
  const userId = await getUserId();
  if (!userId) {
    // Fallback: localStorage
    try {
      const raw = localStorage.getItem(BRIEFS_KEY);
      const all: Record<string, HearingBrief> = raw ? JSON.parse(raw) : {};
      return all[caseId] ?? null;
    } catch { return null; }
  }
  const { data, error } = await supabase
    .from('hearing_briefs')
    .select('brief_data')
    .eq('user_id', userId)
    .eq('case_id', caseId)
    .single();
  if (error) return null;
  return (data?.brief_data as HearingBrief) ?? null;
}

export async function saveHearingBrief(brief: HearingBrief): Promise<void> {
  const userId = await getUserId();
  if (!userId) {
    // Fallback: localStorage
    try {
      const raw = localStorage.getItem(BRIEFS_KEY);
      const all: Record<string, HearingBrief> = raw ? JSON.parse(raw) : {};
      all[brief.caseId] = brief;
      localStorage.setItem(BRIEFS_KEY, JSON.stringify(all));
    } catch (err) { console.warn('[HearingPrep] localStorage fallback failed:', err); }
    return;
  }
  const { error } = await supabase.from('hearing_briefs').upsert({
    user_id:         userId,
    case_id:         brief.caseId,
    diary_no:        brief.diaryNo,
    diary_year:      brief.diaryYear,
    hearing_date:    brief.hearingDate,
    generated_at:    brief.generatedAt,
    readiness_score: brief.readinessScore,
    brief_data:      brief,
  }, { onConflict: 'user_id,case_id' });
  if (error) console.warn('[Supabase] saveHearingBrief failed', error);
}

export async function deleteHearingBrief(caseId: string): Promise<void> {
  const userId = await getUserId();
  if (!userId) {
    try {
      const raw = localStorage.getItem(BRIEFS_KEY);
      const all: Record<string, HearingBrief> = raw ? JSON.parse(raw) : {};
      delete all[caseId];
      localStorage.setItem(BRIEFS_KEY, JSON.stringify(all));
    } catch { /* ignore */ }
    return;
  }
  await supabase.from('hearing_briefs')
    .delete()
    .eq('user_id', userId)
    .eq('case_id', caseId);
}

export async function loadAllHearingBriefs(): Promise<Record<string, HearingBrief>> {
  const userId = await getUserId();
  if (!userId) {
    try {
      const raw = localStorage.getItem(BRIEFS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }
  const { data, error } = await supabase
    .from('hearing_briefs')
    .select('case_id, brief_data')
    .eq('user_id', userId);
  if (error) return {};
  const result: Record<string, HearingBrief> = {};
  for (const row of data || []) {
    result[row.case_id] = row.brief_data as HearingBrief;
  }
  return result;
}

// ── MAIN ORCHESTRATOR ─────────────────────────────────────────────────────────

export interface RunPrepOptions {
  /** Called with status updates as each step completes */
  onProgress?: (step: string, done: number, total: number) => void;
  /** Skip AI task generation (faster, for background runs) */
  skipAI?: boolean;
}

/**
 * Run the full hearing prep pipeline for a case.
 *
 * @param caseData  The full case object from your app state
 * @param hearingDate  ISO date string "YYYY-MM-DD"
 */
export async function runHearingPrep(
  caseData: any,
  hearingDate: string,
  opts: RunPrepOptions = {}
): Promise<HearingBrief> {
  const { onProgress, skipAI = false } = opts;
  const total = skipAI ? 4 : 5;
  let done = 0;

  const report = (step: string) => {
    done++;
    onProgress?.(step, done, total);
  };

  const diaryNo: string = caseData.diaryNo ?? caseData.diaryNumber ?? '';
  const diaryYear: string = caseData.diaryYear ?? '';
  const cnr: string = caseData.cnr ?? caseData.cnrNumber ?? '';

  // ── Step 1: Parse office report ──────────────────────────────────────────
  let officeReport: ParsedOfficeReport | null = null;
  try {
    officeReport = await fetchAndParseOfficeReport(diaryNo, diaryYear);
    report('Office report fetched');
  } catch (e) {
    console.warn('[HearingPrep] Office report fetch failed:', e);
    report('Office report fetch failed');
  }

  // ── Step 2: Fetch last orders from eCourts ───────────────────────────────
  let lastOrders: any = null;
  if (cnr) {
    try {
      lastOrders = await fetchLastOrders(cnr);
      report('Last orders fetched');
    } catch {
      report('Last orders fetch failed');
    }
  } else {
    report('Last orders skipped (no CNR)');
  }

  // ── Step 3: Fetch case documents / IA list ───────────────────────────────
  let caseDocuments: any = null;
  if (cnr) {
    try {
      caseDocuments = await fetchCaseDocuments(cnr);
      console.log('[HearingPrep] Case documents fetched:', caseDocuments);
      report('Documents fetched');
    } catch {
      report('Documents fetch failed');
    }
  } else {
    report('Documents skipped (no CNR)');
  }

  // ── Step 4: Track all respondents ────────────────────────────────────────
  if (officeReport && officeReport.respondents.length > 0) {
    try {
      // Merge any tracking numbers already stored on the case
      const existing: any[] = caseData.respondents ?? [];
      const merged = officeReport.respondents.map((r) => {
        const stored = existing.find((e) => e.name === r.name);
        return { ...r, trackingNumber: stored?.trackingNumber ?? r.trackingNumber };
      });
      officeReport.respondents = await trackAllRespondents(merged) as typeof officeReport.respondents;
      report('Service tracking updated');
    } catch {
      report('Service tracking failed');
    }
  } else {
    report('Service tracking skipped');
  }

  // ── Step 5: AI task generation ───────────────────────────────────────────
  if (!skipAI && officeReport) {
    try {
      const briefText = buildBriefText(officeReport, caseData, hearingDate);
      const caseType = caseData.caseNumber?.split(' ')[0] ?? 'Civil';
      const tasks = await assignTasksFromOfficeReport(briefText, caseType);
      // Merge tasks back into the app — they're already saved by aiTaskService
      // but we store a reference count here
      report(`AI generated ${tasks.length} tasks`);
    } catch {
      report('AI task generation failed');
    }
  }

  // ── Assemble the brief ───────────────────────────────────────────────────
  const readiness = officeReport ? computeReadinessScore(officeReport) : 0;
  const actionItems = buildActionItems(officeReport, caseData);

  const brief: HearingBrief = {
    caseId: caseData.id,
    diaryNo,
    diaryYear,
    hearingDate,
    generatedAt: new Date().toISOString(),
    readinessScore: readiness,
    actionItems,
    officeReport,
    lastOrders,
    caseDocuments,
    courtNo: officeReport?.courtNo ?? null,
    itemNo: officeReport?.itemNo ?? null,
  };

  await saveHearingBrief(brief);
  return brief;
}

// ── ACTION ITEMS BUILDER ──────────────────────────────────────────────────────

/**
 * Derive a prioritised list of action items from the parsed data.
 * This is the "what does the advocate need to do?" list.
 */
function buildActionItems(
  report: ParsedOfficeReport | null,
  _caseData: any
): ActionItem[] {
  const items: ActionItem[] = [];
  const id = () => crypto.randomUUID();

  if (!report) {
    items.push({
      id: id(),
      priority: 'high',
      category: 'preparation',
      title: 'Office report could not be fetched',
      detail: 'Manually check api.sci.gov.in or the SC website for the latest office report.',
    });
    return items;
  }

  // ── Service status alerts ────────────────────────────────────────────────
  for (const r of report.respondents) {
    if (r.serviceStatus === 'Incomplete' || r.serviceStatus === 'Unknown') {
      items.push({
        id: id(),
        priority: 'critical',
        category: 'service',
        title: `Service incomplete — ${r.name}`,
        detail: r.remarks || 'Notice not yet delivered or trial court report awaited.',
        respondentName: r.name,
      });
    }

    if (r.vakalatnama === 'Not filed' || r.vakalatnama === null) {
      if (r.serviceStatus === 'Complete') {
        items.push({
          id: id(),
          priority: 'high',
          category: 'appearance',
          title: `Vakalatnama not filed — ${r.name}`,
          detail: 'Service is complete but no vakalatnama filed. Follow up or mention to court.',
          respondentName: r.name,
        });
      }
    }

    if (!r.counterAffidavit && r.serviceStatus === 'Complete') {
      items.push({
        id: id(),
        priority: 'medium',
        category: 'pleadings',
        title: `Counter affidavit not filed — ${r.name}`,
        detail: 'Check if counter affidavit needs to be filed before next hearing.',
        respondentName: r.name,
      });
    }
  }

  // ── Overall service not complete ─────────────────────────────────────────
  if (!report.serviceComplete) {
    items.push({
      id: id(),
      priority: 'critical',
      category: 'service',
      title: 'Service not complete on all respondents',
      detail: 'Matter may not be heard. Consider mentioning or seeking direction from court.',
    });
  }

  // ── IAs pending response ─────────────────────────────────────────────────
  if (report.iaList.length > 0) {
    items.push({
      id: id(),
      priority: 'high',
      category: 'ia',
      title: `${report.iaList.length} application(s) pending`,
      detail: report.iaList.map((ia) => `${ia.iaNo}: ${ia.description}`).join(' | '),
    });
  }

  // ── Special remarks / defects ────────────────────────────────────────────
  for (const remark of report.specialRemarks) {
    items.push({
      id: id(),
      priority: 'high',
      category: 'preparation',
      title: 'Registrar remark / defect notice',
      detail: remark,
    });
  }

  // ── Tagged cases to prepare ──────────────────────────────────────────────
  if (report.taggedCases.length > 0) {
    items.push({
      id: id(),
      priority: 'medium',
      category: 'preparation',
      title: `${report.taggedCases.length} similar/tagged case(s)`,
      detail: 'Prepare arguments for tagged matters. Check if they will be heard together.',
    });
  }

  // ── Court/item number not yet assigned ───────────────────────────────────
  if (!report.courtNo || !report.itemNo) {
    items.push({
      id: id(),
      priority: 'low',
      category: 'preparation',
      title: 'Court no. & item no. not yet assigned',
      detail: 'Will be available on the cause list after ~7 PM the evening before the hearing.',
    });
  }

  // ── Standard preparation items (always present) ──────────────────────────
  items.push({
    id: id(),
    priority: 'medium',
    category: 'preparation',
    title: 'Review last court order and brief Senior Advocate',
    detail: report.lastOrderText
      ? `Last order: "${report.lastOrderText.slice(0, 200)}..."`
      : 'Fetch and review the last order before the hearing.',
  });

  // Sort: critical → high → medium → low
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  items.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return items;
}

// ── TEXT BUILDER FOR AI ───────────────────────────────────────────────────────

/**
 * Format the HearingBrief data as plain text for the AI prompt.
 * This mimics what an office report looks like so aiTaskService
 * can parse it with its existing prompt logic.
 */
function buildBriefText(
  report: ParsedOfficeReport,
  caseData: any,
  hearingDate: string
): string {
  const lines: string[] = [];

  lines.push(`HEARING PREP BRIEF`);
  lines.push(`Case: ${caseData.displayTitle ?? caseData.parties ?? 'Unknown'}`);
  lines.push(`Case Number: ${caseData.caseNumber ?? 'Unknown'}`);
  lines.push(`Diary No: ${caseData.diaryNo ?? ''}/${caseData.diaryYear ?? ''}`);
  lines.push(`Hearing Date: ${hearingDate}`);
  lines.push(`Generated: ${new Date().toLocaleDateString('en-IN')}`);
  lines.push('');
  lines.push('LAST COURT ORDER:');
  lines.push(report.lastOrderText || 'No order text extracted.');
  lines.push('');
  lines.push('SERVICE STATUS:');
  for (const r of report.respondents) {
    lines.push(
      `${r.name}: ${r.serviceStatus} — Tracking: ${r.deliveryStatus} — Vakalatnama: ${r.vakalatnama ?? 'Not filed'} — Counter Affidavit: ${r.counterAffidavit ?? 'Not filed'}`
    );
  }
  lines.push(report.serviceComplete ? '→ Service is complete.' : '→ Service is NOT complete.');
  lines.push('');

  if (report.iaList.length > 0) {
    lines.push('APPLICATIONS FILED:');
    for (const ia of report.iaList) {
      lines.push(`  IA ${ia.iaNo} by ${ia.aorName} on ${ia.filedOn ?? '?'}: ${ia.description}`);
    }
    lines.push('');
  }

  if (report.taggedCases.length > 0) {
    lines.push('TAGGED/SIMILAR CASES:');
    for (const tc of report.taggedCases) {
      lines.push(`  ${tc.caseNo} — ${tc.petitioner} — ${tc.status}`);
    }
    lines.push('');
  }

  if (report.specialRemarks.length > 0) {
    lines.push('SPECIAL REMARKS / DEFECTS:');
    for (const rem of report.specialRemarks) {
      lines.push(`  ${rem}`);
    }
  }

  return lines.join('\n');
}

// ── HELPER: Cases needing prep ────────────────────────────────────────────────

/**
 * From a list of cases, return those with hearings in the next N days
 * that don't yet have a hearing brief (or brief is stale).
 */
export async function getCasesNeedingPrep(
  cases: any[],
  daysAhead = 7
): Promise<any[]> {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() + daysAhead);

  const allBriefs = await loadAllHearingBriefs();

  return cases.filter((c) => {
    // Check if it has a hearing date
    const listings: any[] = c.listings ?? [];
    const upcoming = listings.find((l: any) => {
      const d = new Date(l.date);
      return d >= now && d <= cutoff;
    });
    if (!upcoming) return false;

    // Check if brief exists and is recent (< 24 hours old)
    const brief = allBriefs[c.id];
    if (!brief) return true;

    const age = Date.now() - new Date(brief.generatedAt).getTime();
    return age > 24 * 60 * 60 * 1000; // older than 24h
  });
}