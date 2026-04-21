/**
 * Lex Tigress Backend — API Proxy Server
 *
 * Hides secret API tokens from the browser bundle.
 * Adds server-side in-memory caching to reduce paid API consumption.
 *
 * Routes:
 *   /ecourts-api/*  → webapi.ecourtsindia.com  (adds Bearer token)
 *   /sci-wp/*       → www.sci.gov.in            (SC WordPress AJAX)
 *   /health         → status check
 */

import 'dotenv/config'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Explicitly load root .env if not already loaded (fixes local dev issues on Windows)
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

import express from 'express'
import { createWorker } from 'tesseract.js'
import multer from 'multer'
import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'
import Groq from 'groq-sdk'
import { Readable } from 'stream'


// For Node.js environments, pdfjs-dist requires the legacy or specifically configured builds
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

const upload = multer({ storage: multer.memoryStorage() })

const app = express()
app.use(express.json()) // Essential for parsing JSON bodies
const PORT = process.env.PORT || process.env.BACKEND_PORT || 3001

// ── SUPABASE CLIENT ───────────────────────────────────────────────────────────
const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY // Use service role for backend bypass
const supabase = createClient(supabaseUrl, supabaseKey)

// ── TWILIO CLIENT ──────────────────────────────────────────────────────────────
const TWILIO_ACCOUNT_SID  = process.env.TWILIO_ACCOUNT_SID
const TWILIO_AUTH_TOKEN   = process.env.TWILIO_AUTH_TOKEN
const TWILIO_FROM         = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886'
const TWILIO_CONTENT_SID  = process.env.TWILIO_CONTENT_SID  || 'HXb5b62575e6e4ff6129ad7c8efe1f983e'

let twilioClient = null
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
  twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
  console.log('[Twilio] client initialised ✓')
} else {
  console.warn('[Twilio] TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set — WhatsApp sends will be skipped')
}

// ── GROQ CLIENT ───────────────────────────────────────────────────────────────
const GROQ_API_KEY = process.env.VITE_GROQ_API_KEY || process.env.GROQ_API_KEY
if (!GROQ_API_KEY) {
  console.warn('[Groq] GROQ_API_KEY not set — transcription will fail')
}
const groq = new Groq({ apiKey: GROQ_API_KEY })


// CORS — allow requests from any origin (Vercel frontend, local dev, etc.)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  next()
})

// ── API USAGE TRACKING MIDDLEWARE ─────────────────────────────────────────────
app.use((req, res, next) => {
  console.log(`[Middleware] ${req.method} ${req.path}`);
  const start = Date.now();
  
  res.on('finish', async () => {
    // Only track specific external API proxy routes and core services
    if (req.path.startsWith('/ecourts-api') || 
        req.path.startsWith('/sci-wp') || 
        req.path.startsWith('/sc-diary-status') ||
        req.path.startsWith('/sc-case-number') ||
        req.path.startsWith('/sc-case-session') ||
        req.path.startsWith('/generate-pdf') ||
        req.path.startsWith('/ecourts-pdf')) {
          
      const duration = Date.now() - start
      
      try {
        const payload = {
          endpoint: req.path,
          method: req.method,
          status_code: res.statusCode,
          duration_ms: duration,
          user_agent: req.get('user-agent') || ''
        };
        const { data, error } = await supabase.from('api_usage_logs').insert([payload]);
        if (error) {
          console.error('[API Usage Log] Supabase Error:', error.message, error.details, error.hint);
        } else {
          console.log(`[API Usage Log] Saved: ${req.path} (${res.statusCode})`);
        }
      } catch (err) {
        console.error('[API Usage Log] Unexpected error:', err.message);
      }
    }
  })
  
  next()
})

// ── ADMIN API USAGE DASHBOARD ─────────────────────────────────────────────────
app.get('/api/admin/api-usage', async (req, res) => {
  try {
    // Get stats from last 7 days for the chart
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const isoDate = sevenDaysAgo.toISOString()

    const { data: logs, error } = await supabase
      .from('api_usage_logs')
      .select('endpoint, method, status_code, duration_ms, created_at')
      .gte('created_at', isoDate)
      .order('created_at', { ascending: false })
      .limit(5000) // cap to 5k for memory safety

    if (error) throw error

    // Calculate metrics
    const totalCalls = logs.length
    const errorCalls = logs.filter(l => (l.status_code || 0) >= 400).length
    const errorRate = totalCalls > 0 ? (errorCalls / totalCalls * 100).toFixed(2) : '0.00'
    const avgDuration = totalCalls > 0 
      ? Math.round(logs.reduce((sum, l) => sum + (l.duration_ms || 0), 0) / totalCalls) 
      : 0

    // Group by endpoint (using prefix for ecourts endpoints to avoid explosion of unique URLs)
    const endpointStats = {}
    logs.forEach(log => {
      let base = log.endpoint || 'unknown'
      if (base.startsWith('/ecourts-api/')) base = '/ecourts-api/*'
      else if (base.startsWith('/sci-wp/')) base = '/sci-wp/*'
      else if (base.startsWith('/ecourts-pdf/')) base = '/ecourts-pdf/*'
      
      if (!endpointStats[base]) {
        endpointStats[base] = { count: 0, totalDuration: 0, errors: 0 }
      }
      endpointStats[base].count++
      endpointStats[base].totalDuration += (log.duration_ms || 0)
      if ((log.status_code || 0) >= 400) endpointStats[base].errors++
    })

    const chartData = Object.keys(endpointStats).map(key => {
      const stats = endpointStats[key]
      return {
        name: key,
        calls: stats.count,
        avg_latency: Math.round(stats.totalDuration / stats.count),
        errorRate: ((stats.errors / stats.count) * 100).toFixed(1)
      }
    }).sort((a, b) => b.calls - a.calls)

    // Latest 100 logs for the data table
    const recentLogs = logs.slice(0, 100)

    res.json({
      metrics: {
        totalCalls,
        errorRate: parseFloat(errorRate),
        avgDuration
      },
      chartData,
      recentLogs
    })
  } catch (err) {
    console.error('[API Usage API] Error:', err.message)
    res.status(500).json({ error: 'Failed to fetch API usage data' })
  }
})

const ECOURTS_BASE  = 'https://webapi.ecourtsindia.com'
const ECOURTS_TOKEN = process.env.ECOURTS_MCP_TOKEN
const SC_BASE       = 'https://www.sci.gov.in'

// ── IN-MEMORY TTL CACHE ───────────────────────────────────────────────────────
// Simple Map-based cache. Resets on server restart (that's fine for dev/MVP).

const memCache = new Map()

function getCached(key) {
  const entry = memCache.get(key)
  if (!entry) return null
  if (entry.expiresAt !== Infinity && Date.now() > entry.expiresAt) {
    memCache.delete(key)
    return null
  }
  return entry.data
}

function setCache(key, data, ttlMs) {
  memCache.set(key, {
    data,
    expiresAt: ttlMs === 0 ? Infinity : Date.now() + ttlMs,
  })
}

function cacheStats() {
  return `${memCache.size} entries cached`
}

// ── CAPTCHA OCR ───────────────────────────────────────────────────────────────
// SC website SIWP captcha is always a simple math image: "7 - 4 =" or "3+5="
// Tesseract reads the digits and operator; we compute the answer server-side.
// Worker is created once and reused across requests (initialization is slow).

let _ocrWorker = null
async function getOcrWorker() {
  if (!_ocrWorker) {
    _ocrWorker = await createWorker('eng', 1, { logger: () => {} })
    await _ocrWorker.setParameters({ tessedit_char_whitelist: '0123456789+-= ' })
  }
  return _ocrWorker
}

async function ocrCaptchaImage(imageUrl, cookieHeader) {
  try {
    const imgRes = await fetch(imageUrl, {
      headers: {
        'Cookie': cookieHeader,
        'Referer': `${SC_BASE}/case-status-case-no/`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!imgRes.ok) { console.warn(`[OCR] image fetch failed: ${imgRes.status}`); return null }
    const buf = Buffer.from(await imgRes.arrayBuffer())
    const worker = await getOcrWorker()
    const { data: { text } } = await worker.recognize(buf)
    const cleaned = text.replace(/\s+/g, ' ').trim()
    console.log(`[OCR] raw text: "${cleaned}"`)
    const mathMatch = cleaned.match(/(\d+)\s*([+\-])\s*(\d+)/)
    if (mathMatch) {
      const a = parseInt(mathMatch[1]), op = mathMatch[2], b = parseInt(mathMatch[3])
      const answer = String(op === '+' ? a + b : a - b)
      console.log(`[OCR] math: ${a}${op}${b} = ${answer}`)
      return answer
    }
    console.warn(`[OCR] no math expression found in: "${cleaned}"`)
    return null
  } catch (e) {
    console.warn('[OCR] failed:', e.message)
    return null
  }
}

// ── ECOURTS PDF PROXY ─────────────────────────────────────────────────────────
// Separate route for binary PDF responses (order documents).
// Unlike /ecourts-api/*, this pipes the raw buffer with the correct content-type
// so an <iframe src="/ecourts-pdf/..."> can render the PDF directly in-browser.
// Order PDFs are immutable — cached forever in memory.

const pdfMemCache = new Map() // key → Buffer

app.get('/ecourts-pdf/*splat', async (req, res) => {
  if (!ECOURTS_TOKEN) {
    return res.status(500).json({ error: 'Server misconfigured: missing eCourts token' })
  }

  const stripPath = req.path.replace(/^\/ecourts-pdf/, '')
  const cacheKey  = `pdf_${stripPath}`

  const cachedBuf = pdfMemCache.get(cacheKey)
  if (cachedBuf) {
    console.log(`[pdf cache HIT] ${stripPath}`)
    res.set('Content-Type', 'application/pdf')
    res.set('Content-Disposition', 'inline')
    return res.send(cachedBuf)
  }

  const targetUrl = `${ECOURTS_BASE}${stripPath}`
  console.log(`[eCourts PDF →] ${targetUrl}`)

  try {
    const response = await fetch(targetUrl, {
      headers: { 'Authorization': `Bearer ${ECOURTS_TOKEN}` },
    })

    if (!response.ok) {
      return res.status(response.status).json({ error: `eCourts returned ${response.status}` })
    }

    const contentType = response.headers.get('content-type') || 'application/pdf'
    const buf = Buffer.from(await response.arrayBuffer())

    pdfMemCache.set(cacheKey, buf) // immutable — cache forever
    res.set('Content-Type', contentType)
    res.set('Content-Disposition', 'inline')
    res.send(buf)
  } catch (err) {
    console.error('[eCourts PDF] proxy error:', err.message)
    res.status(502).json({ error: 'eCourts PDF proxy error', message: err.message })
  }
})

// ── ECOURTS PROXY ─────────────────────────────────────────────────────────────
// Vite forwards /ecourts-api/* here. We strip the prefix and forward to
// webapi.ecourtsindia.com with the server-side Bearer token.
//
// TTLs match the frontend localStorage TTLs:
//   order-document → forever (immutable)
//   everything else → 6 hours

app.all('/ecourts-api/*splat', async (req, res) => {
  if (!ECOURTS_TOKEN) {
    console.error('[eCourts] ECOURTS_MCP_TOKEN is not set in .env')
    return res.status(500).json({ error: 'Server misconfigured: missing eCourts token' })
  }

  const stripPath = req.path.replace(/^\/ecourts-api/, '')
  const queryStr  = new URLSearchParams(req.query).toString()
  const cacheKey  = `ec_${req.method}_${stripPath}_${queryStr}`

  // Serve from cache on GET
  if (req.method === 'GET') {
    const cached = getCached(cacheKey)
    if (cached) {
      console.log(`[cache HIT] ${stripPath} — ${cacheStats()}`)
      return res.json(cached)
    }
  }

  const targetUrl = `${ECOURTS_BASE}${stripPath}${queryStr ? '?' + queryStr : ''}`
  console.log(`[eCourts →] ${req.method} ${targetUrl}`)
  console.log(`[eCourts token debug] token starts with: ${ECOURTS_TOKEN ? ECOURTS_TOKEN.slice(0, 10) : 'MISSING'}`)

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'Authorization': `Bearer ${ECOURTS_TOKEN ? ECOURTS_TOKEN.trim() : ''}`,
        'Content-Type':  'application/json',
      },
      signal: AbortSignal.timeout(20000),
    })

    const data = await response.json()

    // Debug: log date-related fields for case detail responses
    if (stripPath.includes('/partner/case/')) {
      const d = data?.data?.courtCaseData || data
      console.log(`[eCourts case debug] lastHearingDate=${d?.lastHearingDate} lastListedOn=${d?.lastListedOn} nextHearingDate=${d?.nextHearingDate} tentativeDate=${d?.tentativeDate} historyLen=${Array.isArray(d?.historyOfCaseHearings)?d.historyOfCaseHearings.length:'N/A'} listingDatesLen=${Array.isArray(d?.listingDates)?d.listingDates.length:'N/A'}`)
      if (Array.isArray(d?.historyOfCaseHearings) && d.historyOfCaseHearings.length > 0) {
        console.log(`[eCourts case debug] first hearing keys: ${Object.keys(d.historyOfCaseHearings[0]).join(',')}`)
        console.log(`[eCourts case debug] first hearing: ${JSON.stringify(d.historyOfCaseHearings[0])}`)
      }
      if (Array.isArray(d?.listingDates) && d.listingDates.length > 0) {
        console.log(`[eCourts case debug] first listingDate: ${JSON.stringify(d.listingDates[0])}`)
      }
    }

    if (req.method === 'GET' && response.ok) {
      // order-document paths are immutable — cache forever
      const isImmutable = stripPath.includes('order-document')
      const ttl = isImmutable ? 0 : 6 * 60 * 60 * 1000  // 0 = forever
      setCache(cacheKey, data, ttl)
    }

    res.status(response.status).json(data)
  } catch (err) {
    console.error('[eCourts] proxy error:', err.message)
    res.status(502).json({ error: 'eCourts proxy error', message: err.message })
  }
})

// ── CAUSELIST TEST ROUTE ──────────────────────────────────────────────────────
// Test whether SC cause list appears in eCourts partner API.
// Usage: /causelist-test?litigant=Sanjukta+Panigrahi&date=2026-03-18
// or:    /causelist-test?q=SCIN010000232026&date=2026-03-18

app.get('/causelist-test', async (req, res) => {
  if (!ECOURTS_TOKEN) return res.status(500).json({ error: 'ECOURTS_MCP_TOKEN not set' })
  const params = new URLSearchParams(req.query).toString()
  const url = `${ECOURTS_BASE}/api/partner/causelist/search?${params}`
  console.log('[causelist-test →]', url)
  try {
    const r = await fetch(url, {
      headers: { 'Authorization': `Bearer ${ECOURTS_TOKEN}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
    })
    const data = await r.json()
    res.status(r.status).json(data)
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// ── SC WORDPRESS AJAX PROXY ───────────────────────────────────────────────────
// Vite forwards /sci-wp/* here. We strip the prefix and forward to sci.gov.in.
// Cached for 6 hours — SC AJAX data changes at most once per hearing day.

app.get('/sci-wp/*splat', async (req, res) => {
  const stripPath = req.path.replace(/^\/sci-wp/, '')
  const queryStr  = new URLSearchParams(req.query).toString()
  const cacheKey  = `sci_${stripPath}_${queryStr}`

  const cached = getCached(cacheKey)
  if (cached) {
    console.log(`[cache HIT] /sci-wp${stripPath} — ${cacheStats()}`)
    return res.json(cached)
  }

  const targetUrl = `${SC_BASE}${stripPath}${queryStr ? '?' + queryStr : ''}`
  console.log(`[SC-WP  →] ${targetUrl}`)

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'Accept':     'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    })

    // Read as text first — sci.gov.in sometimes returns "0", "-1", or plain HTML
    // for unregistered actions or missing diary numbers instead of valid JSON
    const text = await response.text()
    let data
    try {
      data = JSON.parse(text)
    } catch {
      // Not valid JSON — wrap in expected shape so frontend can handle gracefully
      console.warn(`[SC-WP] non-JSON response for ${stripPath}: ${text.slice(0, 80)}`)
      data = { status: false, data: text }
    }

    if (response.ok) setCache(cacheKey, data, 6 * 60 * 60 * 1000)  // 6 hours
    res.json(data)
  } catch (err) {
    console.error('[SC-WP] proxy error:', err.message)
    res.status(502).json({ error: 'SC proxy error', message: err.message })
  }
})

// ── SC DIARY STATUS (last listed + tentative date) ────────────────────────────
// Fetches Present/Last Listed On and Tentatively Listed On from sci.gov.in
// using the diary number. Uses action=get_case_status_diary_no (no captcha needed
// for diary lookup — different from case number lookup).
app.get('/sc-diary-status', async (req, res) => {
  const { diary, year } = req.query
  if (!diary || !year) return res.status(400).json({ error: 'Missing diary, year' })

  const cacheKey = `sc_diary_${diary}_${year}`
  const cached = getCached(cacheKey)
  if (cached) { console.log(`[cache HIT] sc-diary-status ${diary}/${year}`); return res.json(cached) }

  const toISO = (dmy) => {
    const m = String(dmy || '').match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/)
    return m ? `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` : null
  }

  try {
    // Step 1: Fetch diary status page to get session cookies + nonce tokens
    let cookieHeader = '', scid = '', tokKey = '', tokVal = ''
    try {
      const pageRes = await fetch(`${SC_BASE}/case-status-diary-no/`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
      })
      const setCookie = pageRes.headers.get('set-cookie') || ''
      cookieHeader = setCookie.split(',').map(c => c.split(';')[0].trim()).filter(Boolean).join('; ')
      const html = await pageRes.text()
      const scidMatch = html.match(/name=["']?scid["']?\s+value=["']([a-zA-Z0-9]+)["']/)
        || html.match(/[?&]scid=([a-zA-Z0-9]+)/)
      if (scidMatch) scid = scidMatch[1]
      const tokMatch = html.match(/name=["'](tok_[a-f0-9]+)["'][^>]*value=["']([a-f0-9]+)["']/)
        || html.match(/value=["']([a-f0-9]+)["'][^>]*name=["'](tok_[a-f0-9]+)["']/)
      if (tokMatch) {
        tokKey = tokMatch[1] || tokMatch[2]
        tokVal = tokMatch[2] || tokMatch[1]
        if (!tokKey.startsWith('tok_')) { const tmp = tokKey; tokKey = tokVal; tokVal = tmp }
      }
      console.log(`[SC-diary] session scid=${scid.slice(0,8)} tokKey=${tokKey} cookie=${cookieHeader.slice(0,60)}`)
    } catch (e) {
      console.warn('[SC-diary] session fetch failed, trying without tokens:', e.message)
    }

    // Step 2: POST with session tokens
    const bodyParams = {
      diary_no: String(diary), year: String(year),
      es_ajax_request: '1', submit: 'Search',
      action: 'get_case_status_diary_no', language: 'en',
    }
    if (scid) bodyParams.scid = scid
    if (tokKey && tokVal) bodyParams[tokKey] = tokVal
    const body = new URLSearchParams(bodyParams)
    const url = `${SC_BASE}/wp-admin/admin-ajax.php`
    console.log(`[SC-diary →] POST ${url} diary=${diary} year=${year}`)
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': `${SC_BASE}/case-status-diary-no/`,
        'Origin': SC_BASE,
        ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
      },
      body: body.toString(),
    })
    const text = await response.text()
    console.log(`[SC-diary] response (${text.length} chars): ${text.slice(0, 600)}`)

    // Flatten into a single searchable string (handles JSON wrapper + embedded HTML)
    let raw = text
    try { raw = JSON.stringify(JSON.parse(text)) } catch { /* already flat text */ }
    // Strip HTML tags for cleaner text matching
    const plain = raw.replace(/<[^>]+>/g, ' ').replace(/\\n|\\r|\\t/g, ' ').replace(/\s{2,}/g, ' ')

    // ── Parse dates ──────────────────────────────────────────────────────────
    const lastListedMatch = plain.match(/Present\s*\/\s*Last\s+Listed\s+On\s*[:\-]?\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{4})/i)
      || plain.match(/(?:Present|Last\s+Listed\s+On)\s*[:\-]?\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{4})/i)
      || plain.match(/listed_on[":\s']+(\d{1,2}[-\/]\d{1,2}[-\/]\d{4})/i)
      || plain.match(/Ord(?:er)?\s*(?:dt|date)[:\.\s]+(\d{1,2}[-\/]\d{1,2}[-\/]\d{4})/i)
    const tentativeMatch = plain.match(/(?:Tentatively|likely\s+to\s+be\s+listed)\s*[:\-]?\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{4})/)
      || plain.match(/tentative[^0-9]*(\d{1,2}[-\/]\d{1,2}[-\/]\d{4})/)

    // ── Parse case number (SLP(C)/WP/CA etc.) ────────────────────────────────
    let caseNumber = null
    const caseNoM = plain.match(/((?:SLP|W\.?P|C\.?A|T\.?P|Crl?\.?\s*A?|REVIEW|CONTEMPT)\s*\(?[A-Z.]+\)?\s*No\.?\s*\d{1,6}\s*[\/\-]\s*\d{4})/i)
      || plain.match(/case_no[":\s']+([^"<>{}\n,;]{5,50})/i)
    if (caseNoM) caseNumber = caseNoM[1].trim().replace(/\s+/g, ' ')

    // ── Parse petitioner ─────────────────────────────────────────────────────
    let petitioner = null
    const petM = plain.match(/Petitioner(?:\(s?\))?\s*[:\-]\s*([A-Z][^;\n\r<]{5,120})/i)
      || plain.match(/"petitioner(?:_name)?"\s*:\s*"([^"]{5,120})"/i)
    if (petM) petitioner = petM[1].trim().replace(/\s+/g, ' ').slice(0, 100)

    // ── Parse respondent ─────────────────────────────────────────────────────
    let respondent = null
    const resM = plain.match(/Respondent(?:\(s?\))?\s*[:\-]\s*([A-Z][^;\n\r<]{5,120})/i)
      || plain.match(/"respondent(?:_name)?"\s*:\s*"([^"]{5,120})"/i)
    if (resM) respondent = resM[1].trim().replace(/\s+/g, ' ').slice(0, 100)

    // ── Parse filing / registration date ─────────────────────────────────────
    let filingDate = null
    const filM = plain.match(/(?:Date\s+of\s+Filing|Filing\s+Date|Registration\s+Date)\s*[:\-]?\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{4})/i)
    if (filM) filingDate = toISO(filM[1])

    // ── Parse Earlier Court Details (HTML table) ─────────────────────────────
    const earlierCourtDetails = []
    const earlierTableM = text.match(/Earlier Court Details[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/i)
    if (earlierTableM) {
      const tableHtml = earlierTableM[1]
      const rows = tableHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || []
      // Skip header row
      for (let i = 1; i < rows.length; i++) {
        const cells = rows[i].match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || []
        if (cells.length >= 2) {
          const clean = (c) => c.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
          const cn = clean(cells[0])
          const cno = clean(cells[1])
          const od = cells[2] ? toISO(clean(cells[2])) : null
          const jc = cells[3] ? clean(cells[3]) : 'No'
          if (cn && cn !== 'Court Name') {
            earlierCourtDetails.push({ 
              courtName: cn, 
              caseNumber: cno, 
              orderDate: od,
              judgmentChallenged: jc 
            })
          }
        }
      }
    }

    const result = {
      status: !!(lastListedMatch || tentativeMatch || caseNumber || petitioner || earlierCourtDetails.length > 0),
      lastListedOn:  toISO(lastListedMatch?.[1]),
      tentativeDate: toISO(tentativeMatch?.[1]),
      caseNumber,
      petitioner,
      respondent,
      filingDate,
      earlierCourtDetails,
      rawSnippet: plain.slice(0, 400), // debug: remove after fixing
    }
    if (result.status) {
      const { rawSnippet: _, ...toCache } = result
      setCache(cacheKey, toCache, 6 * 60 * 60 * 1000)
      console.log(`[SC-diary] ✓ case=${caseNumber} pet=${petitioner?.slice(0,30)} lastListed=${result.lastListedOn}`)
    } else {
      console.warn(`[SC-diary] no data found for ${diary}/${year}, plain: ${plain.slice(0,400)}`)
    }
    res.json(result)
  } catch (err) {
    console.error('[SC-diary] error:', err.message)
    res.status(502).json({ error: 'SC diary status error', message: err.message })
  }
})

// ── SC CASE NUMBER LOOKUP ─────────────────────────────────────────────────────
// Resolves SLP/WP/CA registration number → diary number via sci.gov.in.
// Two-step: (1) fetch search page to get session tokens + captcha,
//           (2) call admin-ajax.php with action=get_case_status_case_no.
// Confirmed endpoint from SC website DevTools (23-Mar-2026).

// Session store for SC captcha flow (TTL: 5 minutes)
const scSessions = new Map()
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of scSessions) if (now - v.t > 300000) scSessions.delete(k)
}, 60000)

// SC website uses numeric case_type IDs (confirmed: SLP(C) = 1)
const SC_CASE_TYPE_MAP = {
  'SLP(C)': '1',   'SLPC': '1',
  'SLP(CRL)': '2', 'SLP(CR)': '2', 'SLPCRL': '2', 'SLP(CRIL)': '2',
  'WP(C)': '3',    'WPC': '3',
  'WP(CRL)': '4',  'WP(CR)': '4',  'WPCRL': '4',
  'CA': '5',       'CIVILA': '5',
  'CRL.A': '6',    'CRLA': '6',
  'TP(C)': '13',   'TPC': '13',
  'TP(CRL)': '14', 'TPCRL': '14',
  'SLP(C)CC': '1', // cross-cases filed as SLP
}

// Returns SC session tokens + captcha image (stored server-side)
app.get('/sc-case-session', async (req, res) => {
  try {
    const pageRes = await fetch(`${SC_BASE}/case-status-case-no/`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    })
    const setCookie = pageRes.headers.get('set-cookie') || ''
    const cookieHeader = setCookie.split(',').map(c => c.split(';')[0].trim()).join('; ')
    const html = await pageRes.text()

    let scid = '', tokKey = '', tokVal = ''
    const scidMatch = html.match(/name=["']?scid["']?\s+value=["']([a-zA-Z0-9]+)["']/)
      || html.match(/[?&]scid=([a-zA-Z0-9]+)/)
    if (scidMatch) scid = scidMatch[1]

    const tokMatch = html.match(/name=["'](tok_[a-f0-9]+)["'][^>]*value=["']([a-f0-9]+)["']/)
      || html.match(/value=["']([a-f0-9]+)["'][^>]*name=["'](tok_[a-f0-9]+)["']/)
    if (tokMatch) {
      tokKey = tokMatch[1] || tokMatch[2]
      tokVal = tokMatch[2] || tokMatch[1]
      if (!tokKey.startsWith('tok_')) { const tmp = tokKey; tokKey = tokVal; tokVal = tmp }
    }

    // Extract captcha image URL — SI CAPTCHA plugin uses /?siimage=HASH or .php patterns
    const imgMatch = html.match(/src=["']([^"']*[?&]siimage=[^"']*)["']/)
      || html.match(/id=["'][^"']*si_image[^"']*["'][^>]*src=["']([^"']+)["']/)
      || html.match(/class=["'][^"']*si_captcha_image[^"']*["'][^>]*src=["']([^"']+)["']/)
      || html.match(/id=["']siwp_captcha_image[^"']*["'][^>]*src=["']([^"']+)["']/)
      || html.match(/src=["']([^"']*si_image_captcha\.php[^"']*)["']/)
      || html.match(/src=["']([^"']*si-captcha[^"']*\.php[^"']*)["']/)
      || html.match(/src=["']([^"']*siwp[^"']*\.php[^"']*)["']/)
      || html.match(/siwp_captcha_image["'][^>]*src=["']([^"']+)["']/)
    let captchaImageUrl = imgMatch ? imgMatch[1] : ''
    if (captchaImageUrl && !captchaImageUrl.startsWith('http')) {
      captchaImageUrl = SC_BASE + (captchaImageUrl.startsWith('/') ? '' : '/') + captchaImageUrl
    }
    if (!captchaImageUrl) {
      // Log a snippet of HTML near 'captcha' to help debug
      const idx = html.toLowerCase().indexOf('captcha')
      if (idx >= 0) console.warn(`[SC-session] captcha URL not found; HTML near "captcha": ${html.slice(Math.max(0, idx-50), idx+300)}`)
      else console.warn('[SC-session] captcha URL not found and no "captcha" text in HTML')
    }

    const sid = Math.random().toString(36).slice(2) + Date.now().toString(36)
    scSessions.set(sid, { scid, tokKey, tokVal, cookieHeader, captchaImageUrl, t: Date.now() })

    console.log(`[SC-session] sid=${sid.slice(0,8)} scid=${scid.slice(0,8)} img=${captchaImageUrl.slice(0,80)}`)
    res.json({ sid, ok: true })
  } catch (err) {
    console.error('[SC-session] error:', err.message)
    res.status(502).json({ error: 'Failed to get SC session', ok: false })
  }
})

// Proxy the captcha image through Render (uses session cookies so SC server gives the right image)
app.get('/sc-captcha-img', async (req, res) => {
  const { sid } = req.query
  const session = scSessions.get(String(sid || ''))
  if (!session?.captchaImageUrl) return res.status(404).send('Session not found')
  try {
    const imgRes = await fetch(session.captchaImageUrl, {
      headers: {
        'Cookie': session.cookieHeader,
        'Referer': `${SC_BASE}/case-status-case-no/`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    })
    const contentType = imgRes.headers.get('content-type') || 'image/png'
    res.set('Content-Type', contentType)
    res.set('Cache-Control', 'no-cache')
    const buf = await imgRes.arrayBuffer()
    res.send(Buffer.from(buf))
  } catch (err) {
    res.status(502).send('Captcha image fetch failed')
  }
})

app.get('/sc-case-number', async (req, res) => {
  const { type, no, year } = req.query
  if (!type || !no || !year) {
    return res.status(400).json({ error: 'Missing required params: type, no, year' })
  }

  const cacheKey = `sc_caseno_${type}_${no}_${year}`
  const cached = getCached(cacheKey)
  if (cached) {
    console.log(`[cache HIT] sc-case-number ${type} ${no}/${year}`)
    return res.json(cached)
  }

  const typeKey = String(type).toUpperCase().replace(/\s+/g, '')
  const caseTypeNum = SC_CASE_TYPE_MAP[typeKey] || '1'

  // ── Step 1: Try direct AJAX call (no session/captcha) ─────────────────────
  // Many WordPress AJAX endpoints don't enforce captcha server-side.
  // Try the minimal request first; fall back to full session flow if it fails.
  const makeAjaxCall = async (extraParams = {}) => {
    const params = new URLSearchParams({
      case_type: caseTypeNum,
      case_no:   String(no),
      year:      String(year),
      es_ajax_request: '1',
      submit:    'Search',
      action:    'get_case_status_case_no',
      language:  'en',
      ...extraParams,
    })
    const ajaxUrl = `${SC_BASE}/wp-admin/admin-ajax.php?${params}`
    console.log(`[SC-caseno →] ${ajaxUrl}`)
    return fetch(ajaxUrl, {
      headers: {
        'Accept':     'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer':    `${SC_BASE}/case-status-case-no/`,
      },
    })
  }

  // ── Step 2: If direct fails, fetch session tokens + captcha then retry ─────
  const makeSessionCall = async () => {
    let scid = '', tokKey = '', tokVal = '', captchaAnswer = '0', cookieHeader = ''
    try {
      const pageRes = await fetch(`${SC_BASE}/case-status-case-no/`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
      })
      const setCookie = pageRes.headers.get('set-cookie') || ''
      cookieHeader = setCookie.split(',').map(c => c.split(';')[0].trim()).join('; ')
      const html = await pageRes.text()

      const scidMatch = html.match(/name=["']?scid["']?\s+value=["']([a-zA-Z0-9]+)["']/)
        || html.match(/[?&]scid=([a-zA-Z0-9]+)/)
      if (scidMatch) scid = scidMatch[1]

      const tokMatch = html.match(/name=["'](tok_[a-f0-9]+)["'][^>]*value=["']([a-f0-9]+)["']/)
        || html.match(/value=["']([a-f0-9]+)["'][^>]*name=["'](tok_[a-f0-9]+)["']/)
      if (tokMatch) {
        tokKey = tokMatch[1] || tokMatch[2]
        tokVal = tokMatch[2] || tokMatch[1]
        if (!tokKey.startsWith('tok_')) { const tmp = tokKey; tokKey = tokVal; tokVal = tmp }
      }

      // Extract captcha image URL — SI CAPTCHA plugin uses /?siimage=HASH or .php patterns
      const imgMatch = html.match(/src=["']([^"']*[?&]siimage=[^"']*)["']/)
        || html.match(/id=["'][^"']*si_image[^"']*["'][^>]*src=["']([^"']+)["']/)
        || html.match(/class=["'][^"']*si_captcha_image[^"']*["'][^>]*src=["']([^"']+)["']/)
        || html.match(/id=["']siwp_captcha_image[^"']*["'][^>]*src=["']([^"']+)["']/)
        || html.match(/src=["']([^"']*si_image_captcha\.php[^"']*)["']/)
        || html.match(/src=["']([^"']*si-captcha[^"']*\.php[^"']*)["']/)
        || html.match(/src=["']([^"']*siwp[^"']*\.php[^"']*)["']/)
      let captchaImageUrl = imgMatch ? imgMatch[1] : ''
      if (captchaImageUrl && !captchaImageUrl.startsWith('http')) {
        captchaImageUrl = SC_BASE + (captchaImageUrl.startsWith('/') ? '' : '/') + captchaImageUrl
      }
      if (!captchaImageUrl) {
        const idx = html.toLowerCase().indexOf('captcha')
        if (idx >= 0) console.warn(`[SC-caseno] captcha URL not found; HTML near "captcha": ${html.slice(Math.max(0, idx-50), idx+300)}`)
        else console.warn('[SC-caseno] captcha URL not found and no "captcha" text in HTML')
      }

      // Primary: OCR the captcha image
      if (captchaImageUrl) {
        const ocrAnswer = await ocrCaptchaImage(captchaImageUrl, cookieHeader)
        if (ocrAnswer !== null) captchaAnswer = ocrAnswer
      }

      // Fallback: try to find math text in HTML (rarely present but worth checking)
      if (captchaAnswer === '0') {
        const capMatch = html.match(/(\d+)\s*([+\-])\s*(\d+)\s*=/)
        if (capMatch) {
          const a = parseInt(capMatch[1]), op = capMatch[2], b = parseInt(capMatch[3])
          captchaAnswer = String(op === '+' ? a + b : a - b)
        }
      }
      console.log(`[SC-caseno] session scid=${scid} tok=${tokKey}=${tokVal} captchaAnswer=${captchaAnswer} imgUrl=${captchaImageUrl.slice(0, 80)}`)
    } catch (e) {
      console.warn('[SC-caseno] session fetch failed:', e.message)
    }

    const extra = { siwp_captcha_value: captchaAnswer }
    if (scid) extra.scid = scid
    if (tokKey && tokVal) extra[tokKey] = tokVal

    return fetch(`${SC_BASE}/wp-admin/admin-ajax.php?${new URLSearchParams({
      case_type: caseTypeNum, case_no: String(no), year: String(year),
      es_ajax_request: '1', submit: 'Search',
      action: 'get_case_status_case_no', language: 'en', ...extra,
    })}`, {
      headers: {
        'Accept':     'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer':    `${SC_BASE}/case-status-case-no/`,
        ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
      },
    })
  }

  const parseDiary = (text) => {
    let data = null
    try { data = JSON.parse(text) } catch { /* not JSON */ }

    // ── Priority 1: direct top-level JSON fields (diary_no + year as separate keys)
    // SC website AJAX often returns {"diary_no":"3","year":"2026"} — the regex below
    // fails for this because "3" and "2026" are not adjacent after JSON.stringify.
    if (data && typeof data === 'object') {
      const dno = data.diary_no ?? data.diaryNo ?? data.diary_number
      const dyr = data.year ?? data.diary_year ?? data.diaryYear
      if (dno !== undefined && dyr !== undefined &&
          /^\d{1,6}$/.test(String(dno)) && /^20\d{2}$/.test(String(dyr))) {
        console.log(`[SC-caseno] direct JSON fields: diary_no=${dno} year=${dyr}`)
        return [null, String(parseInt(dno, 10)), String(dyr)]
      }
      // Also check nested under a "data" or "result" key
      const nested = data.data || data.result
      if (nested && typeof nested === 'object') {
        const ndno = nested.diary_no ?? nested.diaryNo
        const ndyr = nested.year ?? nested.diary_year
        if (ndno !== undefined && ndyr !== undefined &&
            /^\d{1,6}$/.test(String(ndno)) && /^20\d{2}$/.test(String(ndyr))) {
          console.log(`[SC-caseno] nested JSON fields: diary_no=${ndno} year=${ndyr}`)
          return [null, String(parseInt(ndno, 10)), String(ndyr)]
        }
      }
    }

    // ── Priority 2: regex on flattened text (HTML or non-structured JSON)
    const raw = data ? JSON.stringify(data) : text
    console.log(`[SC-caseno] response (${raw.length} chars): ${raw.slice(0, 500)}`)

    // Backward + forward search: find the registration number, search ±300 chars for diary number
    const noRe = new RegExp(`0{0,5}${no}[^\\d]`, 'i')
    const noM = noRe.exec(raw)
    if (noM) {
      // Backward: diary number appears before case number in response
      const before = raw.slice(Math.max(0, noM.index - 300), noM.index)
      const allDiaryBack = [...before.matchAll(/(\d{1,6})\s*\/\s*(20\d{2})/g)]
      if (allDiaryBack.length > 0) {
        const last = allDiaryBack[allDiaryBack.length - 1]
        console.log(`[SC-caseno] backward match: diary=${last[1]}/${last[2]} near case_no=${no}`)
        return last
      }
      // Forward: diary number appears after case number in response (common in SC HTML tables)
      const afterStart = noM.index + noM[0].length
      const after = raw.slice(afterStart, afterStart + 400)
      const allDiaryFwd = [...after.matchAll(/\b(\d{1,6})\s*\/\s*(20\d{2})\b/g)]
      for (const m of allDiaryFwd) {
        if (parseInt(m[1], 10) === parseInt(no, 10)) continue  // skip the case number itself
        console.log(`[SC-caseno] forward match: diary=${m[1]}/${m[2]} near case_no=${no}`)
        return m
      }
    }

    // Fallback: named diary pattern anywhere in response
    return raw.match(/diary[_\s-]*(?:no|number)?[:\s"']*(\d{1,6})\s*[\/\-]\s*(20\d{2})/i)
      || raw.match(/>(\d{1,6})\s*\/\s*(20\d{2})</)
  }

  // Client-provided session + captcha answer → skip the automated attempts
  if (req.query.sid && req.query.captchaValue) {
    const session = scSessions.get(String(req.query.sid))
    if (session) {
      const { scid, tokKey, tokVal, cookieHeader } = session
      const extra = { siwp_captcha_value: String(req.query.captchaValue) }
      if (scid) extra.scid = scid
      if (tokKey && tokVal) extra[tokKey] = tokVal
      const capResponse = await fetch(`${SC_BASE}/wp-admin/admin-ajax.php?${new URLSearchParams({
        case_type: caseTypeNum, case_no: String(no), year: String(year),
        es_ajax_request: '1', submit: 'Search',
        action: 'get_case_status_case_no', language: 'en', ...extra,
      })}`, {
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': `${SC_BASE}/case-status-case-no/`,
          'Cookie': cookieHeader,
        },
      })
      const capText = await capResponse.text()
      const capMatch = parseDiary(capText)
      if (capMatch) {
        const result = { status: true, diary_no: capMatch[1], diary_year: capMatch[2] || String(year) }
        setCache(cacheKey, result, 6 * 60 * 60 * 1000)
        console.log(`[SC-caseno] ✓ captcha diary=${result.diary_no}/${result.diary_year}`)
        scSessions.delete(String(req.query.sid))
        return res.json(result)
      }
      console.warn('[SC-caseno] wrong captcha or unexpected format:', capText.slice(0, 200))
      return res.json({ status: false, message: 'Wrong captcha — please try again', debug: capText.slice(0, 200) })
    }
  }

  try {
    // Attempt 1: direct call without session/captcha
    let response = await makeAjaxCall()
    let text = await response.text()
    let diaryMatch = parseDiary(text)

    // Attempt 2: full session + captcha flow
    if (!diaryMatch) {
      console.log('[SC-caseno] direct call failed, retrying with session tokens...')
      response = await makeSessionCall()
      text = await response.text()
      diaryMatch = parseDiary(text)
    }

    if (diaryMatch) {
      const result = { status: true, diary_no: diaryMatch[1], diary_year: diaryMatch[2] || String(year) }
      setCache(cacheKey, result, 6 * 60 * 60 * 1000)
      console.log(`[SC-caseno] ✓ diary=${result.diary_no}/${result.diary_year}`)
      return res.json(result)
    }

    console.warn(`[SC-caseno] no diary number found for ${type} ${no}/${year}`)
    res.json({ status: false, message: 'Case not found on SC website', debug: text.slice(0, 500) })
  } catch (err) {
    console.error('[SC-caseno] error:', err.message)
    res.status(502).json({ error: 'SC case number lookup error', message: err.message })
  }
})

// ── SC OFFICE REPORT REDIRECT ─────────────────────────────────────────────────
// Render (US servers) can't reach api.sci.gov.in directly.
// Redirect the browser/iframe to load the URL itself — the user's browser
// (in India) can reach sci.gov.in fine, and iframes follow 302 redirects.

app.get('/sci-report/*splat', (req, res) => {
  const stripPath = req.path.replace(/^\/sci-report/, '')
  const queryStr  = new URLSearchParams(req.query).toString()
  const targetUrl = `https://api.sci.gov.in${stripPath}${queryStr ? '?' + queryStr : ''}`
  console.log(`[SC-report redirect] ${targetUrl}`)
  res.redirect(302, targetUrl)
})

// ── SC CAUSELIST REDIRECT ─────────────────────────────────────────────────────
// Same reason — redirect to www.sci.gov.in directly.

app.get('/sci-causelist/*splat', (req, res) => {
  const stripPath = req.path.replace(/^\/sci-causelist/, '')
  const queryStr  = new URLSearchParams(req.query).toString()
  const targetUrl = `https://www.sci.gov.in${stripPath}${queryStr ? '?' + queryStr : ''}`
  console.log(`[SC-causelist redirect] ${targetUrl}`)
  res.redirect(302, targetUrl)
})

// ── PDF PARSING FOR FRONTEND OFFLOAD ──────────────────────────────────────────
app.post('/api/v1/parse-pdf', upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No pdf uploaded' })
  
  try {
    const data = new Uint8Array(req.file.buffer)
    const pdf = await pdfjsLib.getDocument({ data }).promise
    const parts = []
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      parts.push(content.items.map(item => ('str' in item ? item.str : '')).join(' '))
    }
    
    res.json({ text: parts.join('\n') })
  } catch (err) {
    console.error('[PDF Parse] Error:', err.message)
    res.status(500).json({ error: 'Failed to parse PDF', message: err.message })
  }
})

// ── SC ADVANCE LIST PDF PROXY ─────────────────────────────────────────────────
// Streams the SC advance list PDF for a given date.
// Vite dev proxy forwards /api/advance-list-proxy?date=YYYY-MM-DD here.

app.get('/api/advance-list-proxy', async (req, res) => {
  const { date } = req.query
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Missing or invalid date param (YYYY-MM-DD)' })
  }

  const targetUrl = `https://api.sci.gov.in/jonew/cl/advance/${date}/M_J.pdf`
  console.log(`[advance-list-proxy] fetching ${targetUrl}`)

  res.setHeader('Access-Control-Allow-Origin', '*')

  try {
    const response = await fetch(targetUrl, {
      signal: AbortSignal.timeout(30000),
      headers: {
        'Accept': 'application/pdf,*/*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    })

    console.log(`[advance-list-proxy] status=${response.status}`)

    if (!response.ok) {
      return res.status(response.status).json({ error: `SC returned ${response.status}`, date })
    }

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Cache-Control', 'no-store')
    res.status(200)

    const reader = response.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(Buffer.from(value))
    }
    res.end()
  } catch (err) {
    console.error('[advance-list-proxy] error:', err.message)
    if (!res.headersSent) {
      res.status(502).json({ error: 'Advance list proxy error', message: err.message, date })
    } else {
      res.end()
    }
  }
})

// ── AI HELPERS ────────────────────────────────────────────────────────────────

async function callGroq(systemPrompt, userMessages) {
  if (!GROQ_API_KEY) { console.warn('[AI] Missing GROQ_API_KEY'); return null }
  
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.1,
        messages: [
          { role: 'system', content: systemPrompt },
          ...userMessages
        ],
      }),
    })
    
    if (!response.ok) {
      const err = await response.text()
      console.error('[Groq Error]', response.status, err)
      return null
    }
    
    const data = await response.json()
    return data.choices[0]?.message?.content || null
  } catch (e) {
    console.error('[Groq Fetch Error]', e.message)
    return null
  }
}

// ── COMMUNICATION ROUTES ──────────────────────────────────────────────────────

/**
 * Trigger an outgoing notification (WhatsApp/Email).
 * In MVP, this logs to DB and "stubs" the actual transport.
 */
app.post('/api/communication/notify', async (req, res) => {
  const { caseId, clientId, teamId, channel, content, eventType, whatsappTo, contentVariables } = req.body

  try {
    let twilioSid  = null
    let sendStatus = 'sent'

    // ── 1. Send via Twilio WhatsApp ──────────────────────────────────────────
    if ((channel === 'whatsapp' || !channel) && twilioClient) {
      try {
        let recipientNumber = whatsappTo

        // If no number provided but clientId exists, fetch from DB
        if (!recipientNumber && clientId) {
          console.log(`[Comm] Fetching WhatsApp number for client: ${clientId}`)
          const { data: client, error: clientErr } = await supabase
            .from('clients')
            .select('whatsapp_number')
            .eq('id', clientId)
            .single()
          
          if (clientErr || !client?.whatsapp_number) {
            console.warn(`[Comm] Could not find WhatsApp number for client ${clientId}: ${clientErr?.message || 'Empty'}`)
          } else {
            recipientNumber = client.whatsapp_number
          }
        }

        if (recipientNumber) {
          const toNumber = recipientNumber.startsWith('whatsapp:') ? recipientNumber : `whatsapp:${recipientNumber}`

          const msgPayload = {
            from: TWILIO_FROM,
            to:   toNumber,
          }

          // Prefer pre-approved content template when contentVariables provided;
          // fall back to free-text body for sandbox / non-template messages.
          if (contentVariables) {
            msgPayload.contentSid       = TWILIO_CONTENT_SID
            msgPayload.contentVariables = typeof contentVariables === 'string'
              ? contentVariables
              : JSON.stringify(contentVariables)
          } else {
            msgPayload.body = content
          }

          const msg = await twilioClient.messages.create(msgPayload)
          twilioSid  = msg.sid
          sendStatus = 'sent'
          console.log(`[Twilio] ✓ WhatsApp sent to ${toNumber} — SID: ${twilioSid}`)
        } else {
          console.warn('[Twilio] No recipient number available — skipping actual send')
          if (channel === 'whatsapp') sendStatus = 'failed'
        }
      } catch (twilioErr) {
        console.error('[Twilio] send failed:', twilioErr.message)
        sendStatus = 'failed'
      }
    } else if (channel === 'whatsapp' && !twilioClient) {
      console.warn('[Twilio] client not configured — skipping actual send')
    }

    // ── 2. Log to communication_history (non-fatal) ────────────────────────
    let dbRecord = null
    if (teamId) {
      const { data, error } = await supabase.from('communication_history').insert({
        case_id:   caseId   || null,
        client_id: clientId || null,
        team_id:   teamId,
        channel:   channel  || 'whatsapp',
        direction: 'outbound',
        content,
        status:    sendStatus,
        metadata:  { event_type: eventType, twilio_sid: twilioSid },
      }).select().single()

      if (error) console.error('[Comm] DB insert failed (non-fatal):', error.message)
      else dbRecord = data
    } else {
      console.warn('[Comm] No teamId provided — skipping DB log')
    }

    res.json({ success: sendStatus !== 'failed', message: dbRecord, twilio_sid: twilioSid })
  } catch (err) {
    console.error('[Comm] notify error:', err.message)
    res.status(500).json({ error: 'Failed to send notification', message: err.message })
  }
})

/**
 * WhatsApp Webhook for incoming messages.
 */
app.post('/api/communication/webhook/whatsapp', async (req, res) => {
  const { From, Body, MessageSid } = req.body // Twilio format
  const phoneNumber = From?.replace('whatsapp:', '')
  
  try {
    // 1. Identify client
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('id, team_id, name')
      .eq('whatsapp_number', phoneNumber)
      .single()

    if (clientErr || !client) {
      console.warn(`[Webhook] Unidentified sender: ${phoneNumber}`)
      return res.status(200).end() // Acknowledge to provider
    }

    // 2. Identify the likely case for this client (most recently active)
    const { data: latestCase } = await supabase
      .from('cases')
      .select('id')
      .eq('client_id', client.id)
      .order('last_viewed', { ascending: false })
      .limit(1)

    const caseId = latestCase?.[0]?.id

    // 3. AI Intelligence: Extract tasks/urgency
    const aiAnalysis = await callGroq(
      "You are a legal assistant for Lex Tigress. Identify if this client message contains a document description, a task request, or an urgent question. Return JSON only: { 'intent': 'doc_upload|task_request|question', 'summary': 'short summary', 'urgency': 'low|medium|high' }",
      [{ role: 'user', content: Body }]
    )

    let metadata = { twilio_sid: MessageSid }
    try {
      if (aiAnalysis) {
        metadata.ai_analysis = JSON.parse(aiAnalysis.replace(/```json|```/g, ''))
      }
    } catch { /* ignore parse errors */ }

    // 4. Log to history
    await supabase.from('communication_history').insert({
      case_id: caseId,
      client_id: client.id,
      team_id: client.team_id,
      channel: 'whatsapp',
      direction: 'inbound',
      content: Body,
      status: 'read',
      metadata
    })

    console.log(`[Comm] INBOUND WhatsApp from ${client.name}: "${Body}"`)
    res.status(200).send('OK')
  } catch (err) {
    console.error('[WhatsApp Webhook] Error:', err.message)
    res.status(500).end()
  }
})

// ── HEALTH ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status:       'ok',
    uptime:       `${Math.floor(process.uptime())}s`,
    cache:        cacheStats(),
    ecourtsToken: ECOURTS_TOKEN ? '✓ set' : '✗ missing',
    twilio:       twilioClient  ? '✓ configured' : '✗ missing credentials',
  })
})

// ── FILING BUNDLE PDF GENERATOR ───────────────────────────────────────────────
//
//  POST /api/generate-bundle
//  Body: {
//    bundleId, bundleType, documentList (BundleDocument[]), toc (TocEntry[]),
//    batesPrefix, batesStartNumber, pageNumberStart, fileName, caseTitle
//  }
//
//  Steps:
//   1. Fetch each document PDF from its URL
//   2. Merge PDFs using pdf-lib
//   3. Stamp Bates numbers and page numbers on each page
//   4. Inject a clickable TOC page at the front
//   5. Add PDF bookmarks for each document section
//   6. Upload merged PDF to Supabase Storage
//   7. Update filing_bundles.download_url
//   8. Return { downloadUrl }

app.post('/api/generate-bundle', async (req, res) => {
  try {
    const {
      bundleId,
      bundleType,
      documentList,
      batesPrefix,
      batesStartNumber = 1,
      pageNumberStart  = 1,
      fileName,
      caseTitle,
    } = req.body

    if (!bundleId || !documentList || !Array.isArray(documentList)) {
      return res.status(400).json({ error: 'bundleId and documentList are required' })
    }

    // ── Dynamic import pdf-lib (ESM) ────────────────────────────────────────
    let PDFDocument, StandardFonts, rgb, pdfLib
    try {
      pdfLib        = await import('pdf-lib')
      PDFDocument   = pdfLib.PDFDocument
      StandardFonts = pdfLib.StandardFonts
      rgb           = pdfLib.rgb
    } catch (e) {
      console.warn('[Bundle] pdf-lib not installed')
      return res.status(500).json({ error: 'pdf-lib not installed. Run: npm install pdf-lib in apps/backend.' })
    }

    // ── Build URL map: Supabase lookup + doc.fileUrl fallback ────────────────
    const docIds = documentList.map((d) => d.documentId).filter(Boolean)
    let supabaseDocs = []
    if (docIds.length > 0) {
      const { data, error } = await supabase
        .from('documents')
        .select('id, url, name')
        .in('id', docIds)
      if (!error) supabaseDocs = data || []
    }
    const supabaseUrlMap = Object.fromEntries(supabaseDocs.map((d) => [d.id, d.url]))

    // Resolve each document's fetch URL: Supabase lookup > doc.fileUrl > null
    function resolveUrl(doc) {
      return (doc.documentId && supabaseUrlMap[doc.documentId]) || doc.fileUrl || null
    }

    // ── Create merged PDF ────────────────────────────────────────────────────
    const mergedPdf      = await PDFDocument.create()
    const helvetica      = await mergedPdf.embedFont(StandardFonts.Helvetica)
    const helveticaBold  = await mergedPdf.embedFont(StandardFonts.HelveticaBold)

    // ── Page 1: Title page ───────────────────────────────────────────────────
    const titlePage = mergedPdf.addPage([595, 842])
    const { width: tW, height: tH } = titlePage.getSize()

    titlePage.drawRectangle({ x: 0, y: 0, width: tW, height: 6, color: rgb(0.1, 0.18, 0.37) })
    titlePage.drawRectangle({ x: 0, y: tH - 6, width: tW, height: 6, color: rgb(0.1, 0.18, 0.37) })

    titlePage.drawText(bundleType === 'court' ? 'PAPER BOOK' : 'MASTER BUNDLE', {
      x: tW / 2 - 70, y: tH / 2 + 40,
      font: helveticaBold, size: 26, color: rgb(0.1, 0.18, 0.37),
    })
    titlePage.drawText(caseTitle || '', {
      x: 60, y: tH / 2,
      font: helvetica, size: 13, color: rgb(0.2, 0.2, 0.2),
      maxWidth: tW - 120,
    })
    titlePage.drawText(`Generated: ${new Date().toLocaleDateString('en-IN')}`, {
      x: 60, y: tH / 2 - 30,
      font: helvetica, size: 10, color: rgb(0.5, 0.5, 0.5),
    })

    // ── Page 2: TOC placeholder — drawn AFTER merging ────────────────────────
    const tocPage = mergedPdf.addPage([595, 842])
    const tocPageHeight = tocPage.getSize().height

    // ── Merge document PDFs ──────────────────────────────────────────────────
    let batesCounter = batesStartNumber
    let pageCounter  = pageNumberStart + 2 // after title + toc

    // Track each doc's real page index in the merged PDF (for TOC links)
    const docPageMap = [] // [{ doc, pageIndex, pageNum, batesStart }]
    const bookmarks  = []

    for (const doc of documentList) {
      const fileUrl = resolveUrl(doc)

      if (doc.isPlaceholder || !fileUrl) {
        // Placeholder page
        const phPage = mergedPdf.addPage([595, 842])
        const { width: pW, height: pH } = phPage.getSize()

        phPage.drawRectangle({
          x: 40, y: 40, width: pW - 80, height: pH - 80,
          borderColor: rgb(0.8, 0.2, 0.2), borderWidth: 2,
          color: rgb(1, 0.95, 0.95), opacity: 0.3,
        })
        phPage.drawText('DOCUMENT NOT YET RECEIVED', {
          x: pW / 2 - 110, y: pH / 2 + 20,
          font: helveticaBold, size: 14, color: rgb(0.8, 0.2, 0.2),
        })
        phPage.drawText(doc.documentName || '', {
          x: 80, y: pH / 2 - 10,
          font: helvetica, size: 12, color: rgb(0.4, 0.2, 0.2), maxWidth: pW - 160,
        })
        phPage.drawText('This section will be completed once the document is received.', {
          x: 80, y: pH / 2 - 35,
          font: helvetica, size: 10, color: rgb(0.5, 0.3, 0.3),
        })

        const idx = mergedPdf.getPageCount() - 1
        docPageMap.push({ doc, pageIndex: idx, pageNum: pageCounter, batesStart: null })
        bookmarks.push({ title: `[MISSING] ${doc.documentName}`, page: idx })
        pageCounter++
        continue
      }

      // Fetch PDF bytes
      let pdfBytes
      try {
        const fetchRes = await fetch(fileUrl, { signal: AbortSignal.timeout(30000) })
        if (!fetchRes.ok) throw new Error(`HTTP ${fetchRes.status}`)
        pdfBytes = await fetchRes.arrayBuffer()
      } catch (fetchErr) {
        console.warn(`[Bundle] Could not fetch ${doc.documentName}:`, fetchErr.message)
        const phPage = mergedPdf.addPage([595, 842])
        const { width: pW, height: pH } = phPage.getSize()
        phPage.drawRectangle({
          x: 40, y: 40, width: pW - 80, height: pH - 80,
          borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 1,
          color: rgb(0.97, 0.97, 0.97), opacity: 0.5,
        })
        phPage.drawText(`[Could not load: ${doc.documentName}]`, {
          x: 60, y: pH / 2, font: helvetica, size: 12, color: rgb(0.5, 0.5, 0.5),
        })
        const idx = mergedPdf.getPageCount() - 1
        docPageMap.push({ doc, pageIndex: idx, pageNum: pageCounter, batesStart: null })
        bookmarks.push({ title: `[ERROR] ${doc.documentName}`, page: idx })
        pageCounter++
        continue
      }

      // Load and copy pages
      let donorPdf
      try {
        donorPdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true })
      } catch (loadErr) {
        console.warn(`[Bundle] Could not parse PDF for ${doc.documentName}:`, loadErr.message)
        const phPage = mergedPdf.addPage([595, 842])
        phPage.drawText(`[Could not parse: ${doc.documentName}]`, {
          x: 60, y: 400, font: helvetica, size: 12, color: rgb(0.5, 0.5, 0.5),
        })
        const idx = mergedPdf.getPageCount() - 1
        docPageMap.push({ doc, pageIndex: idx, pageNum: pageCounter, batesStart: null })
        bookmarks.push({ title: `[ERROR] ${doc.documentName}`, page: idx })
        pageCounter++
        continue
      }

      const copiedPages  = await mergedPdf.copyPages(donorPdf, donorPdf.getPageIndices())
      const sectionStart = mergedPdf.getPageCount()
      const batesDocStart = batesPrefix
        ? `${batesPrefix}_${String(batesCounter).padStart(7, '0')}`
        : String(batesCounter).padStart(7, '0')

      docPageMap.push({ doc, pageIndex: sectionStart, pageNum: pageCounter, batesStart: batesDocStart })
      bookmarks.push({ title: doc.documentName, page: sectionStart })

      for (const page of copiedPages) {
        mergedPdf.addPage(page)
        const { width: pW } = page.getSize()

        const batesStr = batesPrefix
          ? `${batesPrefix}_${String(batesCounter).padStart(7, '0')}`
          : String(batesCounter).padStart(7, '0')

        page.drawText(batesStr, { x: 20, y: 12, font: helvetica, size: 7, color: rgb(0.3, 0.3, 0.3) })
        page.drawText(String(pageCounter), { x: pW / 2 - 8, y: 12, font: helvetica, size: 8, color: rgb(0.3, 0.3, 0.3) })
        if (doc.sectionLabel) {
          page.drawText(doc.sectionLabel, { x: pW - 120, y: 12, font: helvetica, size: 7, color: rgb(0.5, 0.5, 0.5) })
        }

        batesCounter++
        pageCounter++
      }
    }

    // ── Draw TOC (two-pass: now we know real page numbers) ───────────────────
    tocPage.drawText('TABLE OF CONTENTS', {
      x: 60, y: tocPageHeight - 60,
      font: helveticaBold, size: 14, color: rgb(0.1, 0.18, 0.37),
    })
    tocPage.drawLine({
      start: { x: 60, y: tocPageHeight - 72 }, end: { x: 535, y: tocPageHeight - 72 },
      thickness: 0.5, color: rgb(0.1, 0.18, 0.37),
    })

    const tocAnnots = []
    let tocY = tocPageHeight - 95

    for (const entry of docPageMap) {
      if (tocY < 60) break

      const { doc, pageNum, batesStart } = entry
      const isPlaceholder = doc.isPlaceholder || !resolveUrl(doc)
      const numStr  = String(doc.position + 1).padStart(2, ' ')
      const nameStr = (doc.documentName || '').trim()
      const pageStr  = pageNum ? String(pageNum) : '—'

      // Manually wrap the document name
      const words = nameStr.split(/\s+/)
      const lines = []
      let currentLine = words[0] || ''
      
      for (let i = 1; i < words.length; i++) {
        const testLine = currentLine + ' ' + words[i]
        // max width for name is approx 310 to not run into page numbers
        if (helvetica.widthOfTextAtSize(testLine, 10) > 310) {
          lines.push(currentLine)
          currentLine = words[i]
        } else {
          currentLine = testLine
        }
      }
      if (currentLine) lines.push(currentLine)

      const textLineCount = Math.max(1, lines.length)
      const startTocY = tocY
      const LINE_HEIGHT = 16
      const ENTRY_SPACING = 28
      
      // Draw first line with number
      tocPage.drawText(`${numStr}.  ${lines[0] || ''}`, {
        x: 60, y: tocY,
        font: helvetica, size: 10,
        color: isPlaceholder ? rgb(0.8, 0.2, 0.2) : rgb(0.1, 0.1, 0.1),
      })
      tocY -= LINE_HEIGHT

      // Draw subsequent lines indented!
      for (let i = 1; i < lines.length; i++) {
        tocPage.drawText(lines[i], {
          x: 80, y: tocY, // Indented past the number
          font: helvetica, size: 10,
          color: isPlaceholder ? rgb(0.8, 0.2, 0.2) : rgb(0.1, 0.1, 0.1),
        })
        tocY -= LINE_HEIGHT
      }

      // Bates number (right-aligned at 420)
      if (batesStart) {
        tocPage.drawText(batesStart, { x: 405, y: startTocY, font: helvetica, size: 9, color: rgb(0.4, 0.4, 0.4) })
      }

      // Page number (right-aligned at 535)
      tocPage.drawText(pageStr, { x: 515, y: startTocY, font: helvetica, size: 9, color: rgb(0.3, 0.3, 0.3) })

      // Clickable link annotation covering this row
      if (!isPlaceholder && entry.pageIndex < mergedPdf.getPageCount()) {
        try {
          const targetPage = mergedPdf.getPage(entry.pageIndex)
          const annotRef   = mergedPdf.context.nextRef()
          const annot = mergedPdf.context.obj({
            Type: pdfLib.PDFName.of('Annot'),
            Subtype: pdfLib.PDFName.of('Link'),
            Rect: pdfLib.PDFArray.withContext(mergedPdf.context),
            Border: mergedPdf.context.obj([0, 0, 0]),
            Dest: mergedPdf.context.obj([targetPage.ref, pdfLib.PDFName.of('XYZ'), pdfLib.PDFNull, pdfLib.PDFNull, pdfLib.PDFNull]),
          })
          // Set Rect manually (pdf-lib PDFArray)
          const rect = pdfLib.PDFArray.withContext(mergedPdf.context)
          rect.push(pdfLib.PDFNumber.of(60))
          rect.push(pdfLib.PDFNumber.of(startTocY - (textLineCount - 1) * LINE_HEIGHT - 4))
          rect.push(pdfLib.PDFNumber.of(535))
          rect.push(pdfLib.PDFNumber.of(startTocY + 11))
          annot.set(pdfLib.PDFName.of('Rect'), rect)
          mergedPdf.context.assign(annotRef, annot)
          tocAnnots.push(annotRef)
        } catch (annotErr) {
          // non-fatal
        }
      }

      tocY = startTocY - ENTRY_SPACING - (textLineCount - 1) * LINE_HEIGHT
    }

    // Attach all link annotations to the TOC page
    if (tocAnnots.length > 0) {
      try {
        const annotsArray = mergedPdf.context.obj(tocAnnots)
        tocPage.node.set(pdfLib.PDFName.of('Annots'), annotsArray)
      } catch (e) {
        console.warn('[Bundle] TOC annotations failed:', e.message)
      }
    }

    // ── PDF Bookmarks / Outlines ─────────────────────────────────────────────
    if (bookmarks.length > 0) {
      try {
        const outlinesDictRef  = mergedPdf.context.nextRef()
        const outlineItemRefs  = bookmarks.map(() => mergedPdf.context.nextRef())

        bookmarks.forEach((bm, i) => {
          if (bm.page >= mergedPdf.getPageCount()) return
          const targetPageRef = mergedPdf.getPage(bm.page).ref
          const isLast = i === bookmarks.length - 1
          const itemDict = mergedPdf.context.obj({
            Title:  pdfLib.PDFString.of(bm.title),
            Parent: outlinesDictRef,
            ...(i > 0       && { Prev: outlineItemRefs[i - 1] }),
            ...(!isLast     && { Next: outlineItemRefs[i + 1] }),
            Dest: [targetPageRef, pdfLib.PDFName.of('Fit')],
          })
          mergedPdf.context.assign(outlineItemRefs[i], itemDict)
        })

        const outlinesDict = mergedPdf.context.obj({
          Type:  pdfLib.PDFName.of('Outlines'),
          First: outlineItemRefs[0],
          Last:  outlineItemRefs[outlineItemRefs.length - 1],
          Count: pdfLib.PDFNumber.of(bookmarks.length),
        })
        mergedPdf.context.assign(outlinesDictRef, outlinesDict)
        mergedPdf.catalog.set(pdfLib.PDFName.of('Outlines'), outlinesDictRef)
      } catch (err) {
        console.warn('[Bundle] Bookmarks failed:', err.message)
      }
    }

    // ── Serialise ────────────────────────────────────────────────────────────
    const finalPdfBytes = await mergedPdf.save()

    // ── Upload to Supabase Storage (base64 fallback for local dev) ───────────
    const storageFileName = fileName || `bundle_${bundleId}_${Date.now()}.pdf`
    const { error: uploadError } = await supabase
      .storage
      .from('filing-bundles')
      .upload(storageFileName, Buffer.from(finalPdfBytes), { contentType: 'application/pdf', upsert: true })

    let downloadUrl
    if (!uploadError) {
      const { data: urlData } = supabase.storage.from('filing-bundles').getPublicUrl(storageFileName)
      downloadUrl = urlData?.publicUrl
    } else {
      console.warn('[Bundle] Storage upload failed:', uploadError.message)
      downloadUrl = `data:application/pdf;base64,${Buffer.from(finalPdfBytes).toString('base64')}`
    }

    // ── Update bundle record ─────────────────────────────────────────────────
    if (bundleId) {
      await supabase.from('filing_bundles').update({
        download_url: downloadUrl,
        status:       'final',
        generated_at: new Date().toISOString(),
      }).eq('id', bundleId)
    }

    return res.json({ downloadUrl, pageCount: mergedPdf.getPageCount() })
  } catch (err) {
    console.error('[Bundle] generate-bundle error:', err)
    return res.status(500).json({ error: err.message })
  }
})

// ── TRANSCRIPTION API ─────────────────────────────────────────────────────────
/**
 * Receives an audio blob, sends it to Groq Whisper, and returns the text.
 */
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' })
    }

    if (!GROQ_API_KEY) {
      return res.status(500).json({ error: 'Groq API Key not configured on server' })
    }

    console.log(`[Whisper] Transcribing ${req.file.size} bytes...`)

    // Use groq-sdk to transcribe
    // Whisper supports: flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, or webm.
    const transcription = await groq.audio.transcriptions.create({
      file: await Groq.toFile(req.file.buffer, 'speech.webm'),
      model: 'whisper-large-v3-turbo', // High speed, good accuracy
      response_format: 'verbose_json',
      language: req.body.language || 'en' // optional hint
    })

    console.log(`[Whisper] Transcription complete: "${transcription.text.slice(0, 50)}..."`)

    return res.json({
      text: transcription.text,
      duration: transcription.duration,
      language: transcription.language
    })
  } catch (err) {
    console.error('[Transcription] Error:', err)
    return res.status(500).json({ error: err.message })
  }
})

// ── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[backend] running on http://localhost:${PORT}`)
  if (!ECOURTS_TOKEN) {
    console.warn('[backend] WARNING: ECOURTS_MCP_TOKEN not set — eCourts calls will fail')
  }
})
