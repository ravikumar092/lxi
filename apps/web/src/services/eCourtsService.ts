/**
 * eCourts India API Service
 * Provides access to eCourts India API for case history and court details
 *
 * Uses dynamic base URL:
 * - Development (localhost): Uses Vite proxy at /ecourts-api
 * - HTTPS (tunnel/production): Uses full HTTPS URL to bypass CORS
 *
 * ── CACHING LAYER ─────────────────────────────────────────────────────────────
 * Every paid endpoint is wrapped with localStorage cache-first logic.
 *
 * Cache keys:  lx_ec_{type}_{cnr}
 * TTLs:
 *   earlierCourt  → 24 hours  (court of origin never changes)
 *   lastOrders    →  6 hours  (may update after a hearing)
 *   documents     → 24 hours  (filing list rarely changes)
 *   officeReport  →  6 hours  (may update on hearing day)
 *   orderDocument → forever   (immutable — court order text never changes)
 *
 * Cost impact per case:
 *   Before: 4 paid API calls on every open, every time              = ₹2.00+
 *   After:  4 calls on first open only, ₹0 on every open within TTL = ₹0
 *
 * Exported utilities:
 *   isCached(type, cnr)    → check without fetching (used by UI to show badge)
 *   clearCaseCache(cnr)    → call after manual refresh to bust stale cache
 * ─────────────────────────────────────────────────────────────────────────────
 */

// eCourts API goes through Render backend (IP-whitelisted by eCourts Partner API).
// Supabase Edge Functions run from Cloudflare IPs which eCourts does not whitelist.
const _backendUrl: string = (import.meta as any).env?.VITE_BACKEND_URL || ''
// In development, prioritize relative paths so the Vite proxy handles routing to localhost:3001
const isDev = (import.meta as any).env?.DEV
const BASE = (isDev && _backendUrl.startsWith('http')) ? '/ecourts-api' : `${_backendUrl}/ecourts-api`

async function getAuthHeaders(): Promise<Record<string, string>> {
  return {}
}

/**
 * GET via eCourts proxy Edge Function.
 * Automatically attaches Supabase auth headers so the Edge Function
 * can verify the user before forwarding to eCourts.
 */
async function partnerGet(path: string): Promise<any> {
  try {
    const authHeaders = await getAuthHeaders()
    const res = await fetch(`${BASE}${path}`, {
      cache:   'no-store',
      headers: authHeaders,
    })
    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`
      try {
        const errBody = await res.json()
        errMsg = errBody?.message || errBody?.error || errMsg
      } catch { /* body not JSON — use status code only */ }
      return null
    }
    return await res.json()
  } catch (err) {
    return null
  }
}

// ── CACHE TTLs (milliseconds) ─────────────────────────────────────────────────
const TTL = {
  earlierCourt:  24 * 60 * 60 * 1000,  // 24 hours
  lastOrders:     6 * 60 * 60 * 1000,  //  6 hours
  documents:     24 * 60 * 60 * 1000,  // 24 hours
  officeReport:   6 * 60 * 60 * 1000,  //  6 hours
  orderDocument:  0,                    // forever (immutable)
}

// ── CACHE HELPERS ─────────────────────────────────────────────────────────────

/**
 * Read from localStorage. Returns data if fresh, null if missing/expired.
 * ttlMs = 0 means cache forever.
 */
function getCached<T>(key: string, ttlMs: number): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const { data, ts } = JSON.parse(raw) as { data: T; ts: number }
    if (ttlMs === 0 || Date.now() - ts < ttlMs) return data
    localStorage.removeItem(key)
    return null
  } catch {
    return null
  }
}

/** Write to localStorage. Silent on quota errors. */
function setCache(key: string, data: any): void {
  try {
    localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }))
  } catch {
    // quota exceeded — skip silently
  }
}

/**
 * Force-clear all cached data for a CNR.
 * Call this after the user manually refreshes a case so stale cache is busted.
 */
export function clearCaseCache(cnr: string): void {
  const types = ['caseDetail', 'earlierCourt', 'lastOrders', 'documents', 'officeReport']
  types.forEach(type => {
    try { localStorage.removeItem(`lx_ec_${type}_${cnr}`) } catch { /* ignore */ }
  })
}

/**
 * Returns true if a valid cached value exists for this type + CNR.
 * Used by UI to show a "CACHED — ₹0" badge without triggering a fetch.
 */
export function isCached(type: keyof typeof TTL, cnr: string): boolean {
  return getCached(`lx_ec_${type}_${cnr}`, TTL[type]) !== null
}

// ── INTERFACES ────────────────────────────────────────────────────────────────

export interface EarlierCourtData {
  cnr?: string
  courtName?: string
  state?: string
  caseNumber?: string
  filingDate?: string
  judge?: string
  [key: string]: any
}

// ── FETCH FULL CASE DETAIL (1.5 credits, cached 6h) ──────────────────────────
// Single call returns everything: status, parties, IAs, earlier court, orders.
// All other fetch functions below derive from this cached result.
//
// In-flight dedup: if multiple sections call this simultaneously for the same
// CNR (e.g. on "Fetch All"), they all share ONE promise → ONE API call → ₹1.5

const _inFlight = new Map<string, Promise<any>>()

async function fetchCaseDetail(cnr: string): Promise<any | null> {
  const cacheKey = `lx_ec_caseDetail_${cnr}`
  const SIX_HOURS = 6 * 60 * 60 * 1000

  // Layer 1: localStorage (fastest — same session, same device)
  const lsCached = getCached<any>(cacheKey, SIX_HOURS)
  if (lsCached) return lsCached

  // Layer 2: Supabase cases table — case_data column already has full API response
  // Works across devices, survives browser cache clears
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const supabaseUrl  = (import.meta as any).env?.VITE_SUPABASE_URL  as string
    const supabaseAnon = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string
    if (supabaseUrl && supabaseAnon) {
      const sb = createClient(supabaseUrl, supabaseAnon)
      const sixHoursAgo = new Date(Date.now() - SIX_HOURS).toISOString()
      const { data: row } = await sb
        .from('cases')
        .select('case_data, updated_at')
        .eq('cnr', cnr)
        .gte('updated_at', sixHoursAgo)
        .maybeSingle()
      if (row?.case_data) {
        // Rebuild the full API response shape from stored case_data
        // so downstream functions (fetchLastOrders, fetchEarlierCourt etc.) work correctly
        const rebuilt = { data: { courtCaseData: row.case_data }, meta: {} }
        setCache(cacheKey, rebuilt) // also warm localStorage for this session
        return rebuilt
      }
    }
  } catch {
    // Supabase unavailable — fall through to API call
  }

  // Layer 3: in-flight dedup — if same CNR already fetching, share the promise
  if (_inFlight.has(cnr)) {
    return _inFlight.get(cnr)!
  }

  // Layer 4: paid API call (₹1.50)
  const promise = partnerGet(`/api/partner/case/${cnr}`)
    .then(data => {
      if (data) setCache(cacheKey, data)
      _inFlight.delete(cnr)
      return data
    })
    .catch(err => {
      _inFlight.delete(cnr)
      throw err
    })

  _inFlight.set(cnr, promise)
  return promise
}

// ── FETCH CASE BY CNR ─────────────────────────────────────────────────────────
export const fetchCaseByCNR = async (
  cnr: string
): Promise<any | null> => {
  const detail = await fetchCaseDetail(cnr)
  return detail?.data?.courtCaseData ?? null
}

// ── FETCH EARLIER COURT ───────────────────────────────────────────────────────
// Derived from caseDetail — no extra credit cost.
// Returns null if empty so callers fall through to SC website fallback.

export const fetchEarlierCourt = async (
  cnr: string
): Promise<EarlierCourtData | null> => {
  const detail = await fetchCaseDetail(cnr)
  const list = detail?.data?.courtCaseData?.earlierCourtDetails
  return Array.isArray(list) && list.length > 0 ? list : null
}

// ── DATE HELPERS ──────────────────────────────────────────────────────────────

/**
 * Convert various date formats to ISO format (YYYY-MM-DD)
 * Supports: YYYY-MM-DD, DD-MM-YYYY, YYYY-MM-DD with time, "13 Feb 2026"
 */
function toISODate(date: string): string | null {
  if (!date) return null

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date

  // DD-MM-YYYY
  const dmy = date.match(/^(\d{2})-(\d{2})-(\d{4})$/)
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`

  // YYYY-MM-DD with time
  const withTime = date.match(/^(\d{4}-\d{2}-\d{2})/)
  if (withTime) return withTime[1]

  // "13 Feb 2026" format
  const months: Record<string, string> = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04',
    May: '05', Jun: '06', Jul: '07', Aug: '08',
    Sep: '09', Oct: '10', Nov: '11', Dec: '12'
  }
  const readable = date.match(/(\d{1,2})\s+(\w{3})\s+(\d{4})/)
  if (readable) {
    return `${readable[3]}-${months[readable[2]] || '01'}-${readable[1].padStart(2, '0')}`
  }

  return null
}

// ── URL GENERATORS ────────────────────────────────────────────────────────────

/**
 * Generate Supreme Court office report URL.
 * With processId (future): direct HTML link on api.sci.gov.in
 * Without processId (current): SC website search page
 */
export const generateOfficeReportUrl = (
  diaryNo: string,
  diaryYear: string,
  listedDate?: string,
  processId?: string
): string => {
  if (!diaryNo || !diaryYear) {
    return 'https://www.sci.gov.in/office-report-case-no/'
  }
  if (processId && listedDate) {
    const isoDate = toISODate(listedDate)
    if (isoDate) {
      return `https://api.sci.gov.in/officereport/${diaryYear}/${diaryNo}/${diaryNo}_${diaryYear}_${isoDate}_${processId}.html`
    }
  }
  return 'https://www.sci.gov.in/office-report-case-no/'
}

/**
 * Generate Supreme Court website URL for latest orders.
 */
export const generateLastOrderUrl = (diaryNo: string, diaryYear: string): string => {
  if (!diaryNo || !diaryYear) return '#'
  return `https://suprcourt.nic.in/supremecourtweb/?p=3289&diary=${diaryNo.trim()}&year=${diaryYear.trim()}&type=orders`
}

// ── FETCH OFFICE REPORT ───────────────────────────────────────────────────────
// SC office report HTML comes from SC website, not eCourts API.
// Return null so callers fall through to SC WordPress AJAX fallback.

/**
 * Fetch office reports from SC website via WordPress AJAX proxy.
 * Returns { text: string; html: string | null; links: any[] } or null.
 */
export const fetchOfficeReport = async (
  diaryNo: string,
  diaryYear: string
): Promise<{ text: string; html: string | null; links: any[] } | null> => {
  if (!diaryNo || !diaryYear) return null
  try {
    const tabUrl = `${_backendUrl}/sci-wp/wp-admin/admin-ajax.php?diary_no=${diaryNo}&diary_year=${diaryYear}&tab_name=office_report&action=get_case_details&es_ajax_request=1&language=en`
    const res = await fetch(tabUrl)
    if (!res.ok) return null
    const data = await res.json()
    const html = typeof data?.data === 'string' ? data.data : ''
    if (!html || html.length < 50) return null

    // ── Check if it's a list of reports or direct content ──
    const isList = html.includes('Process Id') || html.includes('Order Date') || html.includes('<table');
    
    if (isList) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const allLinks = Array.from(doc.querySelectorAll('a[href]'))
        .map(link => {
          const rawHref = (link as HTMLAnchorElement).getAttribute('href') || '';
          if (!rawHref || rawHref === '#') return null;
          let fullUrl = rawHref;
          try { fullUrl = new URL(rawHref, 'https://www.sci.gov.in').href; } catch { return null; }
          if (!fullUrl.includes('sci.gov.in')) return null;

          let proxyUrl = fullUrl;
          if (fullUrl.includes('api.sci.gov.in')) {
            proxyUrl = fullUrl.replace('https://api.sci.gov.in', `${_backendUrl}/sci-report`);
          } else if (fullUrl.includes('www.sci.gov.in')) {
            proxyUrl = fullUrl.replace('https://www.sci.gov.in', `${_backendUrl}/sci-causelist`);
          } else if (fullUrl.includes('sci.gov.in')) {
            proxyUrl = fullUrl.replace('https://sci.gov.in', `${_backendUrl}/sci-causelist`);
          }

          const rawText = link.textContent?.trim() || '';
          const dateMatch = rawText.match(/\d{2}[-\/]\d{2}[-\/]\d{4}/) || rawText.match(/\d{4}[-\/]\d{2}[-\/]\d{2}/);
          return { 
            date: dateMatch ? dateMatch[0] : rawText || fullUrl.split('/').pop() || 'Report', 
            proxyUrl, 
            url: fullUrl 
          };
        })
        .filter((l): l is { date: string; proxyUrl: string; url: string } => l !== null);
      
      return { 
        text: 'List of reports', 
        html: null, 
        links: allLinks.sort((a, b) => b.date.localeCompare(a.date)) 
      };
    }

    // ── Otherwise: treat as direct HTML content ──
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\\n|\\r|\\t/g, ' ').replace(/\s{2,}/g, ' ')
    return { text, html, links: [] }
  } catch (err) {
    console.error('[eCourts] fetchOfficeReport error:', err)
    return null
  }
}



// ── FETCH LAST ORDERS ─────────────────────────────────────────────────────────
// Returns null if empty so callers fall through to SC website fallback.

export const fetchLastOrders = async (
  cnr: string
): Promise<any | null> => {
  const detail = await fetchCaseDetail(cnr)
  const list = detail?.data?.courtCaseData?.judgmentOrders
  return Array.isArray(list) && list.length > 0 ? list : null
}

// ── FETCH CASE DOCUMENTS ──────────────────────────────────────────────────────
// Returns null if empty so ApplicationsSection falls through to SC website.

export const fetchCaseDocuments = async (
  cnr: string
): Promise<any | null> => {
  const detail = await fetchCaseDetail(cnr)
  const list = detail?.data?.courtCaseData?.filedDocuments
  return Array.isArray(list) && list.length > 0 ? list : null
}

// ── FETCH ORDER DOCUMENT ──────────────────────────────────────────────────────
// Cached forever — court order text is immutable once published.
// Layer 1: in-memory Map  (fastest, same session)
// Layer 2: localStorage   (persists across page reloads, no TTL)
// Layer 3: API call       (₹1.25, only on first ever access per device)

const orderDocMemCache = new Map<string, string>()

export const fetchOrderDocument = async (
  cnr: string,
  filename: string
): Promise<string | null> => {
  const cacheKey = `lx_ec_orderDocument_${cnr}_${filename}`

  if (orderDocMemCache.has(cacheKey)) return orderDocMemCache.get(cacheKey)!

  const lsCached = getCached<string>(cacheKey, TTL.orderDocument)
  if (lsCached) {
    orderDocMemCache.set(cacheKey, lsCached)
    return lsCached
  }

  const data = await partnerGet(`/api/partner/case/${cnr}/order/${filename}`)
  if (!data) return null

  let text: string | null = null
  if (typeof data === 'string') text = data.trim()
  else if (typeof data?.text === 'string') text = data.text.trim()

  if (text) {
    orderDocMemCache.set(cacheKey, text)
    setCache(cacheKey, text)
  }
  return text
}

// ── CHECK ECOURTS STATUS ──────────────────────────────────────────────────────
// Uses the free public court-structure endpoint — no billing, no auth required.

export const checkECourtsStatus = async (): Promise<'online' | 'offline'> => {
  try {
    const res = await fetch(`${BASE}/api/CauseList/court-structure/states`)
    return res.ok ? 'online' : 'offline'
  } catch {
    return 'offline'
  }
}

// ── STUB EXPORTS (referenced by CourtSync.tsx and SearchCaseForm.tsx) ─────────
// These are placeholders for future MCP / eCourts Search API endpoints.
// Once the API plan is upgraded, replace the fetch URLs and remove the stub guards.

/**
 * Discover available MCP tools from the eCourts API.
 * Currently returns an empty list — called on app mount in CourtSync.tsx
 * so the console log is informational only.
 */
export const discoverMCPTools = async (): Promise<string[]> => {
  // Not applicable for REST partner API — return empty
  return []
}

/**
 * Search cases using eCourts partner search API (₹0.20/call).
 * Supports advocate, petitioner, respondent, litigant name search.
 * Use state='SC' to filter Supreme Court cases.
 */
export const searchCases = async (
  params: {
    advocates?: string
    petitioners?: string
    respondents?: string
    litigants?: string
    filingDateFrom?: string
    filingDateTo?: string
    state?: string
    pageSize?: number
    page?: number
  }
): Promise<any | null> => {
  const queryParams: Record<string, string> = {}
  if (params.advocates)      queryParams.advocates      = params.advocates
  if (params.petitioners)    queryParams.petitioners    = params.petitioners
  if (params.respondents)    queryParams.respondents    = params.respondents
  if (params.litigants)      queryParams.litigants      = params.litigants
  if (params.filingDateFrom) queryParams.filingDateFrom = params.filingDateFrom
  if (params.filingDateTo)   queryParams.filingDateTo   = params.filingDateTo
  if (params.state)          queryParams.state          = params.state
  queryParams.pageSize = String(params.pageSize || 20)
  if (params.page)           queryParams.page           = String(params.page)
  const qs = new URLSearchParams(queryParams).toString()
  return partnerGet(`/api/partner/search?${qs}`)
}

/**
 * Trigger a fresh data scrape for a case on the eCourts side.
 * Call this before fetchCaseFullByCNR to ensure up-to-date data.
 * eCourts says scrape completes in 5-10 seconds.
 */
export const triggerCaseRefresh = async (cnr: string): Promise<void> => {
  try {
    await fetch(`${BASE}/api/partner/case/${cnr}/refresh`, { method: 'POST' })
  } catch {
    // Non-critical — proceed with fetch even if refresh trigger fails
  }
}

/**
 * Fetch full raw API response for a case by CNR.
 * Returns the complete { data: { courtCaseData: {...} }, meta: {...} } object.
 * Used by search form and refresh — pass result to transformMCPToCase().
 * Cost: ₹0.50, cached 6 hours.
 */
export const fetchCaseFullByCNR = async (cnr: string, forceRefresh = false): Promise<any | null> => {
  if (forceRefresh) {
    // Bust backend in-memory cache by adding a timestamp query param — changes the cache key
    // Also clear frontend localStorage cache for this CNR
    try { localStorage.removeItem(`lx_ec_caseDetail_${cnr}`) } catch { /* ignore */ }
    const res = await fetch(`${BASE}/api/partner/case/${cnr}?_t=${Date.now()}`)
    if (!res.ok) return null
    const data = await res.json()
    // Store fresh response back into frontend cache
    if (data) setCache(`lx_ec_caseDetail_${cnr}`, data)
    return data
  }
  return await fetchCaseDetail(cnr)
}

/**
 * Look up a case by registration number (e.g. SLP(C) No. 6677/2026) via the SC website.
 * The SC website resolves the registration number → diary number.
 * Returns { diary_no, diary_year } if found, null otherwise.
 * Used by Document Scanner when only a case number is extracted from a document.
 */
export const fetchCaseByCaseNumber = async (
  caseType: string,
  caseNo: string,
  year: string,
): Promise<{ diary_no: string; diary_year: string } | null> => {
  try {
    const params = new URLSearchParams({ type: caseType, no: caseNo, year })
    const res = await fetch(`${_backendUrl}/sc-case-number?${params}`)
    if (!res.ok) return null
    const data = await res.json()
    if (!data?.status || !data?.diary_no) return null
    return { diary_no: String(data.diary_no), diary_year: String(data.diary_year || year) }
  } catch {
    return null
  }
}

/**
 * Fetch case details from SC website by diary number (sci.gov.in diary status).
 * Returns dates AND case number, petitioner, respondent parsed from the SC website.
 * This is the primary lookup for SC cases since the eCourts partner API
 * (webapi.ecourtsindia.com) does not reliably index SC cases.
 */
export const fetchSCDiaryStatus = async (
  diaryNo: string,
  diaryYear: string,
): Promise<{
  lastListedOn: string | null;
  tentativeDate: string | null;
  caseNumber: string | null;
  petitioner: string | null;
  respondent: string | null;
  filingDate: string | null;
  earlierCourtDetails?: any[];
  status: boolean;
} | null> => {
  try {
    const params = new URLSearchParams({ diary: String(diaryNo), year: String(diaryYear) })
    const res = await fetch(`${_backendUrl}/sc-diary-status?${params}`)
    if (!res.ok) return null
    const data = await res.json()
    return {
      status:        !!data.status,
      lastListedOn:  data.lastListedOn  || null,
      tentativeDate: data.tentativeDate || null,
      caseNumber:    data.caseNumber    || null,
      petitioner:    data.petitioner    || null,
      respondent:    data.respondent    || null,
      filingDate:    data.filingDate    || null,
      earlierCourtDetails: data.earlierCourtDetails || [],
    }
  } catch {
    return null
  }
}

/**
 * Get a fresh SC website session (captcha image for case number lookup).
 * Returns session ID — use with submitSCCaseCaptcha().
 */
export const fetchSCCaseSession = async (): Promise<{ sid: string; ok: boolean } | null> => {
  try {
    const res = await fetch(`${_backendUrl}/sc-case-session`)
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

/**
 * Submit captcha answer to complete SC case number → diary number lookup.
 */
export const submitSCCaseCaptcha = async (
  caseType: string, caseNo: string, year: string, sid: string, captchaValue: string
): Promise<{ diary_no: string; diary_year: string } | { error: true; debug?: string } | null> => {
  try {
    const params = new URLSearchParams({ type: caseType, no: caseNo, year, sid, captchaValue })
    const res = await fetch(`${_backendUrl}/sc-case-number?${params}`)
    if (!res.ok) return null
    const data = await res.json()
    if (!data?.status || !data?.diary_no) return { error: true, debug: data?.debug || data?.message || '' }
    return { diary_no: String(data.diary_no), diary_year: String(data.diary_year || year) }
  } catch { return null }
}