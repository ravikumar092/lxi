/**
 * Lex Tigress — Cause List Monitor Service
 *
 * Fetches the SC daily cause list and matches your tracked cases.
 * The cause list is published ~7 PM the evening before the hearing.
 * This fills the last missing piece: court number and item number.
 *
 * SC cause list URL: https://sci.gov.in/cause-list/
 * Also try: https://main.sci.gov.in/causelist (alternate domain)
 *
 * CORS: Same issue as India Post. Add proxy or use serverless function.
 * Proxy in vite.config.ts:
 *   '/sci-causelist': {
 *     target: 'https://sci.gov.in',
 *     changeOrigin: true,
 *     rewrite: (path) => path.replace(/^\/sci-causelist/, '')
 *   }
 */

import type { CauseListEntry } from '../types/hearingPrep';

const CACHE_KEY = 'lextgress_cause_list_cache';
const CACHE_DATE_KEY = 'lextgress_cause_list_date';

const SCI_CAUSELIST_URL =
  import.meta.env.DEV && window.location.protocol === 'http:'
    ? '/sci-causelist/cause-list/'
    : 'https://sci.gov.in/cause-list/';

// ── PUBLIC FUNCTIONS ──────────────────────────────────────────────────────────

/**
 * Fetch tomorrow's cause list and return all entries.
 * Caches for the day so repeated calls don't re-fetch.
 */
export async function fetchTomorrowCauseList(): Promise<CauseListEntry[]> {
  const today = new Date().toISOString().slice(0, 10);
  const cachedDate = localStorage.getItem(CACHE_DATE_KEY);

  // Return cached if already fetched today
  if (cachedDate === today) {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) return JSON.parse(raw) as CauseListEntry[];
    } catch { /* fall through to refetch */ }
  }

  const entries = await fetchAndParseCauseList();

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entries));
    localStorage.setItem(CACHE_DATE_KEY, today);
  } catch { /* storage full */ }

  return entries;
}

/**
 * Given your tracked cases, return which ones appear in tomorrow's cause list.
 * Updates each matched case with court number and item number.
 *
 * @param cases  Array of case objects with diaryNo and diaryYear fields
 * @returns      Map of caseId → CauseListEntry for matched cases
 */
export function matchCasesInCauseList(
  cases: Array<{ id: string; diaryNo: string; diaryYear: string }>,
  causeListEntries: CauseListEntry[]
): Record<string, CauseListEntry> {
  const matches: Record<string, CauseListEntry> = {};

  for (const c of cases) {
    const match = causeListEntries.find(
      (entry) =>
        entry.diaryNo === c.diaryNo ||
        entry.caseNo?.includes(c.diaryNo)
    );
    if (match) {
      matches[c.id] = match;
    }
  }

  return matches;
}

/**
 * Check if now is a good time to auto-fetch the cause list.
 * The SC publishes it after ~6 PM on working days.
 */
export function shouldFetchCauseList(): boolean {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0 = Sun, 6 = Sat

  // Only on working days after 6 PM
  if (day === 0 || day === 6) return false;
  if (hour < 18) return false;

  // Don't fetch if already done today
  const cachedDate = localStorage.getItem(CACHE_DATE_KEY);
  const today = now.toISOString().slice(0, 10);
  return cachedDate !== today;
}

/**
 * Clear the cause list cache (call this manually or at midnight).
 */
export function clearCauseListCache(): void {
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem(CACHE_DATE_KEY);
}

// ── FETCH + PARSE ─────────────────────────────────────────────────────────────

async function fetchAndParseCauseList(): Promise<CauseListEntry[]> {
  try {
    const res = await fetch(SCI_CAUSELIST_URL, {
      headers: { Accept: 'text/html' },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      console.warn('[CauseList] Fetch failed:', res.status);
      return [];
    }

    const html = await res.text();
    return parseCauseListHTML(html);
  } catch (err) {
    console.warn('[CauseList] Error fetching cause list:', err);
    return [];
  }
}

/**
 * Parse the SC cause list HTML into structured entries.
 *
 * The cause list is a table with columns:
 * Court No | Item No | Case No | Parties | ...
 *
 * Diary numbers appear in parentheses like (Diary No. 12345/2026)
 * or as part of the case number field.
 */
function parseCauseListHTML(html: string): CauseListEntry[] {
  const entries: CauseListEntry[] = [];

  const div = document.createElement('div');
  div.innerHTML = html;

  // Try to find table rows
  const rows = div.querySelectorAll('tr');
  let currentCourtNo = '';

  for (const row of rows) {
    const cells = Array.from(row.querySelectorAll('td, th')).map(
      (td) => td.textContent?.trim() ?? ''
    );

    if (cells.length < 3) {
      // Could be a court header row like "COURT NO. 1"
      const rowText = row.textContent ?? '';
      const courtMatch = rowText.match(/COURT\s+NO\.?\s*(\d+)/i);
      if (courtMatch) currentCourtNo = courtMatch[1];
      continue;
    }

    // Try to find item number, case number, diary number
    const itemNo = extractItemNo(cells);
    const caseNo = extractCaseNo(cells);
    const diaryNo = extractDiaryNo(cells, row.innerHTML);
    const parties = cells.find((c) => c.includes('Vs') || c.includes('vs.') || c.includes('Versus')) ?? cells[cells.length - 1];
    const courtNo = extractCourtFromRow(cells, row) || currentCourtNo;

    if ((itemNo || caseNo) && (diaryNo || caseNo)) {
      entries.push({
        diaryNo: diaryNo ?? '',
        caseNo: caseNo ?? '',
        courtNo,
        itemNo: itemNo ?? '',
        listedDate: getTomorrow(),
        parties: parties.slice(0, 200),
      });
    }
  }

  return entries;
}

// ── PARSERS FOR CAUSE LIST TABLE CELLS ───────────────────────────────────────

function extractItemNo(cells: string[]): string | null {
  // Item number is usually a small integer in first or second cell
  for (const cell of cells.slice(0, 3)) {
    if (/^\d{1,4}$/.test(cell.trim())) return cell.trim();
  }
  return null;
}

function extractCaseNo(cells: string[]): string | null {
  for (const cell of cells) {
    // Match patterns like "SLP(C) No. 1234/2026" or "W.P.(Crl.) 500/2022"
    const m = cell.match(
      /(SLP|W\.?P|C\.?A|Crl\.?A|TP|RP|TC|WP|CA|CrA|ConC|ConCr|IA)\s*[\w().]*\s*No\.?\s*[\d\/\-]+/i
    );
    if (m) return m[0].trim();
  }
  return null;
}

function extractDiaryNo(cells: string[], innerHTML: string): string | null {
  // Diary number in parentheses or after "Diary No."
  const combined = cells.join(' ') + ' ' + (innerHTML ?? '');
  const m =
    combined.match(/Diary\s+No\.?\s*(\d{4,6})\s*\/?\s*(\d{4})/i) ||
    combined.match(/\((\d{4,6})\/(\d{4})\)/);
  if (m) return m[1];
  return null;
}

function extractCourtFromRow(_cells: string[], row: Element): string {
  const rowText = row.textContent ?? '';
  const m = rowText.match(/COURT\s+NO\.?\s*(\d+)/i);
  return m ? m[1] : '';
}

function getTomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}