/**
 * SC Advance List Service
 *
 * Fetches the Supreme Court's publicly accessible advance list PDFs to find
 * the tentative "likely to be listed" date for tracked cases.
 *
 * PDF URL: https://api.sci.gov.in/jonew/cl/advance/{YYYY-MM-DD}/M_J.pdf
 * - No authentication required
 * - CORS allowed (confirmed)
 * - Published days/weeks ahead for upcoming hearing dates
 *
 * Strategy:
 *   1. For each upcoming weekday, fetch the advance list PDF
 *   2. Parse all case/diary numbers from the PDF text
 *   3. Match against tracked cases
 *   4. Cache parsed results per date (6 hours) to avoid re-downloading
 */

// Proxy URL — avoids CORS and geo-blocking issues with direct browser fetch
const SC_ADVANCE_PROXY = '/api/advance-list-proxy'
const CACHE_PREFIX = 'lx_advlist_'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000  // 6 hours
const MAX_WEEKDAYS = 30                    // scan up to 30 upcoming weekdays

// ── PUBLIC API ────────────────────────────────────────────────────────────────

/**
 * Scan all provided cases against upcoming SC advance lists.
 * More efficient than per-case lookup — one PDF download serves all cases.
 *
 * @returns Map of case id → YYYY-MM-DD tentative hearing date
 */
export async function scanCasesForAdvanceListing(
  cases: Array<{
    id: string
    diaryNumber: string
    diaryYear: string
    caseNumber?: string | null
  }>
): Promise<Record<string, string>> {
  const results: Record<string, string> = {}
  const remaining = cases.filter(c => c.diaryNumber && c.diaryYear)
  if (remaining.length === 0) return results

  const dates = getUpcomingWeekdays(MAX_WEEKDAYS)

  for (const date of dates) {
    if (remaining.length === 0) break

    const ids = await getAdvanceListIds(date)
    if (!ids) continue

    const notYetFound: typeof remaining = []
    for (const c of remaining) {
      if (matchesCase(ids, c.diaryNumber, c.diaryYear, c.caseNumber)) {
        results[c.id] = date
      } else {
        notYetFound.push(c)
      }
    }
    remaining.length = 0
    remaining.push(...notYetFound)
  }

  return results
}

/**
 * Find the advance list date for a single case.
 * Use scanCasesForAdvanceListing for multiple cases (more efficient).
 */
export async function findAdvanceListDate(
  diaryNo: string,
  diaryYear: string,
  caseNumber?: string | null
): Promise<string | null> {
  const dates = getUpcomingWeekdays(MAX_WEEKDAYS)
  for (const date of dates) {
    const ids = await getAdvanceListIds(date)
    if (!ids) continue
    if (matchesCase(ids, diaryNo, diaryYear, caseNumber)) return date
  }
  return null
}

/**
 * Clear cached advance list data (call if stale data suspected).
 */
export function clearAdvanceListCache(): void {
  const toRemove: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(CACHE_PREFIX)) toRemove.push(key)
  }
  toRemove.forEach(k => localStorage.removeItem(k))
}

// ── INTERNALS ─────────────────────────────────────────────────────────────────

/**
 * Returns the set of case/diary identifiers extracted from the advance list
 * for the given date. Returns null if no advance list exists for that date.
 * Results are cached in localStorage for CACHE_TTL_MS.
 */
async function getAdvanceListIds(date: string): Promise<Set<string> | null> {
  const cacheKey = `${CACHE_PREFIX}${date}`
  const expKey   = `${CACHE_PREFIX}${date}_exp`

  // Return from cache if fresh
  const cached  = localStorage.getItem(cacheKey)
  const expiry  = parseInt(localStorage.getItem(expKey) || '0', 10)
  if (cached !== null && Date.now() < expiry) {
    if (cached === 'none') return null
    try { return new Set(JSON.parse(cached) as string[]) } catch { /* re-fetch */ }
  }

  const url = `${SC_ADVANCE_PROXY}?date=${date}`
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(30000), cache: 'no-store' })
  } catch {
    return null
  }

  if (!res.ok) {
    // No advance list published for this date — cache negative result
    try {
      localStorage.setItem(cacheKey, 'none')
      localStorage.setItem(expKey, String(Date.now() + CACHE_TTL_MS))
    } catch { /* storage full */ }
    return null
  }

  // Verify the response is actually a PDF before trying to parse
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('pdf')) {
    const preview = await res.text()
    console.warn(`[AdvanceList] Proxy returned non-PDF for ${date}:`, contentType, preview.slice(0, 200))
    return null
  }

  const buf  = await res.arrayBuffer()
  if (buf.byteLength === 0) return null
  const text = await extractPDFText(buf)
  const ids  = extractIdentifiers(text)

  try {
    localStorage.setItem(cacheKey, JSON.stringify([...ids]))
    localStorage.setItem(expKey, String(Date.now() + CACHE_TTL_MS))
  } catch { /* storage full */ }

  return ids
}

/**
 * Extract case identifiers from PDF text.
 *
 * Two types stored:
 *   diary:{n}/{yyyy}   — e.g. diary:23/2026
 *   case:{normalized}  — e.g. case:slpcno3003/2023  (all lower, no spaces/dots)
 */
function extractIdentifiers(text: string): Set<string> {
  const ids = new Set<string>()

  // Case numbers: SLP(C), WP, CA, CrA, etc. followed by No. and digits/year
  const caseRe = /\b(SLP|W\.?P|C\.?A|Crl\.?A?|TP|RP|TC|WP|CA|CrA|ConC|ConCr|MA|IA)\s*[\w().]*\s*No\.?\s*([\d]{1,6}[-–]?[\d]*\s*\/\s*\d{4})/gi
  let m: RegExpExecArray | null
  while ((m = caseRe.exec(text)) !== null) {
    // Normalize: lowercase, remove spaces and dots
    const normalized = m[0].toLowerCase().replace(/[\s.]+/g, '')
    ids.add(`case:${normalized}`)
  }

  // Diary numbers: any N/YYYY pattern (N = 1–6 digits, YYYY = 20xx)
  const diaryRe = /\b(\d{1,6})\s*\/\s*(20\d{2})\b/g
  while ((m = diaryRe.exec(text)) !== null) {
    ids.add(`diary:${m[1]}/${m[2]}`)
  }

  return ids
}

/**
 * Check whether a case matches any identifier in the set.
 */
function matchesCase(
  ids: Set<string>,
  diaryNo: string,
  diaryYear: string,
  caseNumber?: string | null
): boolean {
  // 1. Exact diary number match
  if (ids.has(`diary:${diaryNo}/${diaryYear}`)) return true

  // 2. Case number match (normalized)
  if (caseNumber) {
    const normalized = caseNumber.toLowerCase().replace(/[\s.]+/g, '')
    // Check direct match
    if (ids.has(`case:${normalized}`)) return true
    // Check partial match (PDF format may differ slightly)
    for (const id of ids) {
      if (!id.startsWith('case:')) continue
      const idVal = id.slice(5)
      if (idVal.includes(normalized) || normalized.includes(idVal)) return true
    }
  }

  return false
}

/**
 * Extract full text from a PDF ArrayBuffer by sending it to the backend.
 */
async function extractPDFText(buffer: ArrayBuffer): Promise<string> {
  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
  
  const formData = new FormData();
  formData.append('pdf', new Blob([buffer], { type: 'application/pdf' }));
  
  try {
    const res = await fetch(`${backendUrl}/api/v1/parse-pdf`, {
      method: 'POST',
      body: formData,
    });
    
    if (!res.ok) {
      console.warn('Backend parse-pdf failed for advance list');
      return '';
    }
    
    const json = await res.json();
    return json.text || '';
  } catch (err) {
    console.error('Network error reaching backend parse-pdf', err);
    return '';
  }
}

/**
 * Returns the next N weekdays (Mon–Fri) starting from tomorrow.
 */
function getUpcomingWeekdays(count: number): string[] {
  const dates: string[] = []
  const d = new Date()
  d.setDate(d.getDate() + 1)

  while (dates.length < count) {
    const day = d.getDay()
    if (day !== 0 && day !== 6) {
      dates.push(d.toISOString().slice(0, 10))
    }
    d.setDate(d.getDate() + 1)
  }

  return dates
}
