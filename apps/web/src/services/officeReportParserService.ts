/**
 * Lex Tigress — Office Report Parser Service
 *
 * Fetches the Supreme Court's own office report for a case (HTML or PDF)
 * and parses it into a structured object. This is the highest-value data
 * source because it contains service status, pleadings status, IAs, and
 * tagged cases — all in one place.
 *
 * URL patterns observed from api.sci.gov.in:
 *   HTML: https://api.sci.gov.in/officereport/{year}/{diary}/{diary}_{year}_{date}_{processId}.html
 *   PDF:  https://api.sci.gov.in/officereport/{year}/{diary}/{diary}_{year}_{date}.pdf
 *
 * Strategy:
 *   1. Try the SC API proxy endpoint (via your existing /api proxy in vite.config)
 *   2. Try fetching the HTML office report directly
 *   3. Fall back to PDF parse using pdfjs-dist (already in package.json)
 *   4. Return a ParsedOfficeReport with parseError set if all fail
 */

import type {
  ParsedOfficeReport,
  RespondentService,
  ParsedIA,
  TaggedCase,
} from '../types/hearingPrep';

// ── PROXY PATHS ───────────────────────────────────────────────────────────────
// In vite.config.ts, add:
//   '/sci-report': { target: 'https://api.sci.gov.in', changeOrigin: true,
//                    rewrite: p => p.replace(/^\/sci-report/, '') }
// Until then we try direct fetch (works in production, may CORS in dev).
const SCI_BASE = 'https://api.sci.gov.in';

// ── PUBLIC ENTRY POINT ────────────────────────────────────────────────────────

/**
 * Fetch and parse the most recent office report for a case.
 * @param diaryNo   e.g. "2590"
 * @param diaryYear e.g. "2026"
 * @param processId optional — improves URL accuracy if known
 */
export async function fetchAndParseOfficeReport(
  diaryNo: string,
  diaryYear: string,
  processId?: string
): Promise<ParsedOfficeReport> {
  const base: Omit<ParsedOfficeReport, 'source' | 'parseError' | 'rawText'> = {
    diaryNo,
    diaryYear,
    fetchedAt: new Date().toISOString(),
    reportType: 'unknown',
    listedOn: null,
    courtNo: null,
    itemNo: null,
    lastOrderText: '',
    lastOrderDate: null,
    respondents: [],
    serviceComplete: false,
    iaList: [],
    taggedCases: [],
    specialRemarks: [],
  };

  // Strategy 1: Try HTML fetch
  try {
    const htmlText = await fetchOfficeReportHTML(diaryNo, diaryYear, processId);
    if (htmlText) {
      const parsed = parseOfficeReportText(htmlText, diaryNo, diaryYear);
      return { ...base, ...parsed, source: 'html', parseError: null };
    }
  } catch (e) {
    console.warn('[OfficeReportParser] HTML fetch failed:', e);
  }

  // Strategy 2: Try PDF fetch + extract
  try {
    const pdfText = await fetchOfficeReportPDF(diaryNo, diaryYear);
    if (pdfText) {
      const parsed = parseOfficeReportText(pdfText, diaryNo, diaryYear);
      return { ...base, ...parsed, source: 'pdf', parseError: null };
    }
  } catch (e) {
    console.warn('[OfficeReportParser] PDF fetch failed:', e);
  }

  // Strategy 3: Nothing worked
  return {
    ...base,
    rawText: '',
    source: 'none',
    parseError: 'Could not fetch office report from api.sci.gov.in. CORS or network issue.',
  };
}

// ── FETCHERS ──────────────────────────────────────────────────────────────────

async function fetchOfficeReportHTML(
  diaryNo: string,
  diaryYear: string,
  processId?: string
): Promise<string | null> {
  // Try a few URL patterns — the SC uses slightly different formats across years
  const paddedDiary = diaryNo.padStart(5, '0');
  const urls: string[] = [];

  // Pattern 1: with processId
  if (processId) {
    urls.push(
      `${SCI_BASE}/officereport/${diaryYear}/${paddedDiary}/${paddedDiary}_${diaryYear}_${processId}.html`
    );
  }

  // Pattern 2: base listing page (sometimes works)
  urls.push(`${SCI_BASE}/officereport/${diaryYear}/${paddedDiary}/`);

  // Pattern 3: simple diary lookup
  urls.push(
    `${SCI_BASE}/officereport/${diaryYear}/${paddedDiary}/${paddedDiary}_${diaryYear}.html`
  );

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'text/html,application/xhtml+xml' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const html = await res.text();
        // Strip HTML tags to get plain text
        const div = document.createElement('div');
        div.innerHTML = html;
        const text = div.innerText || div.textContent || '';
        if (text.length > 200 && text.includes('OFFICE REPORT')) {
          return text;
        }
      }
    } catch {
      // try next URL
    }
  }
  return null;
}

async function fetchOfficeReportPDF(
  diaryNo: string,
  diaryYear: string
): Promise<string | null> {
  const paddedDiary = diaryNo.padStart(5, '0');
  const url = `${SCI_BASE}/officereport/${diaryYear}/${paddedDiary}/${paddedDiary}_${diaryYear}.pdf`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;

    const arrayBuffer = await res.arrayBuffer();
    return await extractTextFromPDFBuffer(arrayBuffer);
  } catch {
    return null;
  }
}

/**
 * Send PDF to backend for extraction
 */
async function extractTextFromPDFBuffer(buffer: ArrayBuffer): Promise<string> {
  // Send buffer to backend microservice which handles the pdf parsing
  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
  
  const formData = new FormData();
  formData.append('pdf', new Blob([buffer], { type: 'application/pdf' }));
  
  try {
    const res = await fetch(`${backendUrl}/api/v1/parse-pdf`, {
      method: 'POST',
      body: formData,
    });
    
    if (!res.ok) {
      console.warn('Backend parse-pdf failed');
      return '';
    }
    
    const json = await res.json();
    return json.text || '';
  } catch (err) {
    console.error('Network error reaching backend parse-pdf', err);
    return '';
  }
}


// ── MAIN PARSER ───────────────────────────────────────────────────────────────

function parseOfficeReportText(
  text: string,
  _diaryNo: string,
  _diaryYear: string
): Omit<ParsedOfficeReport, 'diaryNo' | 'diaryYear' | 'fetchedAt' | 'source' | 'parseError'> {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  return {
    reportType: detectReportType(text),
    listedOn: extractListedOn(lines),
    courtNo: extractCourtNo(lines),
    itemNo: extractItemNo(lines),
    lastOrderText: extractLastOrderText(text),
    lastOrderDate: extractLastOrderDate(text),
    respondents: parseRespondentTable(text),
    serviceComplete: detectServiceComplete(text),
    iaList: parseIAList(text),
    taggedCases: parseTaggedCases(text),
    specialRemarks: extractSpecialRemarks(text),
    rawText: text,
  };
}

// ── FIELD EXTRACTORS ──────────────────────────────────────────────────────────

function detectReportType(text: string): string {
  const upper = text.toUpperCase();
  if (upper.includes('OFFICE REPORT OF FRESH CASE') || upper.includes('OFFICE REPORT IN FRESH CASE')) return 'fresh';
  if (upper.includes('AFTER NOTICE')) return 'after_notice';
  if (upper.includes('OFFICE REPORT')) return 'general';
  return 'unknown';
}

function extractListedOn(lines: string[]): string | null {
  for (const line of lines.slice(0, 10)) {
    // "LISTING ON 16.02.2026" or "Listed On: 18-02-2026"
    const m =
      line.match(/LISTING\s+ON\s+(\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{4})/i) ||
      line.match(/Listed\s+On\s*:\s*(\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{4})/i);
    if (m) return normaliseDate(m[1]);
  }
  return null;
}

function extractCourtNo(lines: string[]): string | null {
  for (const line of lines.slice(0, 10)) {
    // "COURT NO. 1 7" or "Court No.: 21"
    const m =
      line.match(/COURT\s+NO[.\s:]+(.+)/i) ||
      line.match(/Court\s+No\.?\s*:\s*(.+)/i);
    if (m) return m[1].replace(/\s+/g, '').trim();
  }
  return null;
}

function extractItemNo(lines: string[]): string | null {
  for (const line of lines.slice(0, 10)) {
    // "ITEM NO. 4 2" or "Item No.: 11"
    const m =
      line.match(/ITEM\s+NO[.\s:]+(.+)/i) ||
      line.match(/Item\s+No\.?\s*:\s*(.+)/i);
    if (m) return m[1].replace(/\s+/g, '').trim();
  }
  return null;
}

/**
 * Extract the verbatim text of the last/most recent court order.
 * Orders are typically in quotes in the office report.
 */
function extractLastOrderText(text: string): string {
  // Find the last quoted block — this is the most recent order
  // Quotes can be " " or " " or plain "
  const quotePattern = /["""]([^"""]{30,})["""]/gs;
  const matches = [...text.matchAll(quotePattern)];

  if (matches.length === 0) {
    // Fallback: find text after "has been pleased to pass the following order"
    const markerIdx = text.lastIndexOf('following order');
    if (markerIdx > -1) {
      return text.slice(markerIdx + 15, markerIdx + 2000).trim();
    }
    return '';
  }

  // Return the last (most recent) quoted order
  const lastMatch = matches[matches.length - 1];
  return lastMatch[1].trim();
}

function extractLastOrderDate(text: string): string | null {
  // "lastly listed on 21-01-2026" or "on 12.01.2026"
  const patterns = [
    /lastly\s+listed\s+on\s+(\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{4})/i,
    /lastly\s+mentioned\s+on\s+(\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{4})/i,
    /DATE\s*:\s*(\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{4})/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) return normaliseDate(m[1]);
  }
  return null;
}

// ── RESPONDENT TABLE PARSER ───────────────────────────────────────────────────

/**
 * Parse the service status table for all respondents.
 *
 * The table appears in two forms across the reports:
 *
 * Form A (simple inline — seen in single-respondent cases):
 *   "Respondent Sole : Delivered on 11.02.2026  Not filed  Not filed  N/A"
 *
 * Form B (multi-respondent table):
 *   Name of Parties | Notice issued on | Notice served on | Status | Remarks
 *   RESPONDENT No. - 1 | 09-05-2024 | - | Incomplete | Trial court report is awaited
 *
 * Form C (pleadings table):
 *   Name of Parties | Vakalatnama | Counter Affidavit | Rejoinder | Remarks
 */
export function parseRespondentTable(text: string): RespondentService[] {
  const respondents: RespondentService[] = [];

  // ── Form A: simple inline single respondent ─────────────────────────────
  const simpleMatch = text.match(
    /Respondent\s+Sole?\s*:?\s*(Delivered on\s*[\d.]+|Not delivered|Service complete|Incomplete)[^\n]*/gi
  );
  if (simpleMatch && simpleMatch.length > 0) {
    const line = simpleMatch[0];
    respondents.push(buildRespondentFromLine('Respondent Sole', line));
  }

  // ── Form B: multi-respondent service table ──────────────────────────────
  // Find all "RESPONDENT No. - N" blocks
  const respondentBlocks = text.matchAll(
    /RESPONDENT\s+No\.?\s*[-–]?\s*(\d+)([\s\S]{0,400}?)(?=RESPONDENT\s+No\.?|3\.\s+The\s+status\s+of\s+parties|Service\s+is\s+complete|DATE\s*:)/gi
  );

  for (const block of respondentBlocks) {
    const num = block[1];
    const content = block[2];

    const name = `Respondent No. ${num}`;

    // Extract dates from the block
    const dates = [...content.matchAll(/(\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{4})/g)].map((m) =>
      normaliseDate(m[1])
    );

    const isComplete =
      /Complete/i.test(content) && !/Incomplete/i.test(content);

    const isIncomplete = /Incomplete/i.test(content);

    // Remarks: everything after "Complete" or "Incomplete"
    const remarksMatch = content.match(
      /(?:Complete|Incomplete)([\s\S]{0,200})/i
    );
    const remarks = remarksMatch ? remarksMatch[1].trim().slice(0, 150) : '';

    // Delivered date — "Item Delivered" or "delivered on"
    const deliveredMatch = content.match(
      /(?:Item\s+)?Delivered[^,\n]*?(\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{4})/i
    );

    respondents.push({
      name,
      noticeIssuedOn: dates[0] ?? null,
      noticeServedOn: dates[1] ?? null,
      serviceStatus: isComplete ? 'Complete' : isIncomplete ? 'Incomplete' : 'Unknown',
      remarks,
      trackingNumber: null,
      deliveryStatus: deliveredMatch ? 'delivered' : isComplete ? 'delivered' : 'unknown',
      deliveryDate: deliveredMatch ? normaliseDate(deliveredMatch[1]) : null,
      deliveryLocation: null,
      lastTrackingEvent: null,
      lastTrackedAt: null,
      vakalatnama: null,
      counterAffidavit: null,
      rejoinder: null,
    });
  }

  // ── Form C: merge pleadings status into respondents ─────────────────────
  mergePleadingsStatus(text, respondents);

  // If we found nothing but service is mentioned simply
  if (respondents.length === 0) {
    const serviceComplete = /Service\s+is\s+complete/i.test(text);
    respondents.push({
      name: 'Respondent(s)',
      noticeIssuedOn: null,
      noticeServedOn: null,
      serviceStatus: serviceComplete ? 'Complete' : 'Unknown',
      remarks: serviceComplete ? 'Service is complete' : 'See office report',
      trackingNumber: null,
      deliveryStatus: serviceComplete ? 'delivered' : 'unknown',
      deliveryDate: null,
      deliveryLocation: null,
      lastTrackingEvent: null,
      lastTrackedAt: null,
      vakalatnama: null,
      counterAffidavit: null,
      rejoinder: null,
    });
  }

  return respondents;
}

function buildRespondentFromLine(name: string, line: string): RespondentService {
  const delivered = /Delivered on\s*([\d.]+)/i.exec(line);
  const complete = /Service complete/i.test(line) || !!delivered;

  return {
    name,
    noticeIssuedOn: null,
    noticeServedOn: delivered ? normaliseDate(delivered[1]) : null,
    serviceStatus: complete ? 'Complete' : 'Unknown',
    remarks: line.trim().slice(0, 150),
    trackingNumber: null,
    deliveryStatus: delivered ? 'delivered' : complete ? 'delivered' : 'unknown',
    deliveryDate: delivered ? normaliseDate(delivered[1]) : null,
    deliveryLocation: null,
    lastTrackingEvent: null,
    lastTrackedAt: null,
    vakalatnama: extractField(line, 'Not filed') ? 'Not filed' : null,
    counterAffidavit: null,
    rejoinder: null,
  };
}

/**
 * Merge vakalatnama / counter affidavit dates from the pleadings table
 * back into the respondents array (matched by respondent number).
 */
function mergePleadingsStatus(text: string, respondents: RespondentService[]): void {
  // The pleadings table pattern: RESPONDENT No. - 1 M/S PHILLIPS INDIA LTD. | date | date
  const pleadingBlocks = text.matchAll(
    /RESPONDENT\s+No\.?\s*[-–]?\s*(\d+)[\s\S]{0,60}?(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4})\s+(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4})/gi
  );

  for (const block of pleadingBlocks) {
    const num = block[1];
    const date1 = normaliseDate(block[2]);
    const date2 = normaliseDate(block[3]);
    const target = respondents.find(
      (r) => r.name.includes(`No. ${num}`) || r.name.includes(`No.${num}`)
    );
    if (target) {
      target.vakalatnama = target.vakalatnama ?? date1;
      target.counterAffidavit = target.counterAffidavit ?? date2;
    }
  }

  // Also check for "Not filed" patterns
  const notFiledBlocks = text.matchAll(
    /RESPONDENT\s+No\.?\s*[-–]?\s*(\d+)[\s\S]{0,100}?No\s+appearance/gi
  );
  for (const block of notFiledBlocks) {
    const num = block[1];
    const target = respondents.find((r) => r.name.includes(`No. ${num}`));
    if (target) {
      target.vakalatnama = target.vakalatnama ?? 'No appearance';
    }
  }
}

function detectServiceComplete(text: string): boolean {
  return /4\.\s+Service\s+is\s+complete/i.test(text) ||
    /Service\s+of\s+notice\s+is\s+complete/i.test(text);
}

// ── IA LIST PARSER ────────────────────────────────────────────────────────────

export function parseIAList(text: string): ParsedIA[] {
  const ias: ParsedIA[] = [];

  // Pattern: "1. 5986/2026 K. Paarivendhan 07-01-2026 Exemption From Filing..."
  const tableSection = extractSection(text, 'status of the applications', 'Service is complete');
  if (!tableSection) return ias;

  const rows = tableSection.matchAll(
    /(\d+)\.\s+([\d\/]+)\s+([\w\s.]+?)\s+(\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{4})\s+(.+?)(?=\n\d+\.|$)/gs
  );

  for (const row of rows) {
    ias.push({
      iaNo: row[2].trim(),
      aorName: row[3].trim(),
      filedOn: normaliseDate(row[4]),
      description: row[5].trim().slice(0, 200),
    });
  }

  return ias;
}

// ── TAGGED CASES PARSER ───────────────────────────────────────────────────────

export function parseTaggedCases(text: string): TaggedCase[] {
  const tagged: TaggedCase[] = [];

  // Pattern: "Similarity found" table or "Tagged with" mention
  // Table row: "1  46616/2018  W.P.(Crl.) No. 000336/2018  RADHIKA AGARWAL vs. UNION...  Pending"
  const section = extractSection(text, 'Similarity found', 'proof of service') ||
    extractSection(text, 'similar cases', 'proof of service') ||
    '';

  if (!section) {
    // Simple "Tagged with CA No. X" pattern
    const taggedMatch = text.match(/[Tt]ag(?:ged)?\s+with\s+([\w\s().\-\/,]+?)(?:\.|and|$)/g);
    if (taggedMatch) {
      for (const m of taggedMatch) {
        tagged.push({
          diaryNo: '',
          caseNo: m.replace(/[Tt]ag(?:ged)?\s+with\s+/i, '').trim(),
          petitioner: '',
          status: 'Pending',
          remarks: 'Tagged case — see office report',
        });
      }
    }
    return tagged;
  }

  const rows = section.matchAll(
    /(\d+)\s+([\d\/]+)\s+([\w.()\s\/]+?)\s+([\w\s]+?)\s+(?:vs?\.?|Versus)\s+([\w\s]+?)\s+(Pending|Disposed|Fresh)/gi
  );

  for (const row of rows) {
    tagged.push({
      diaryNo: row[2].trim(),
      caseNo: row[3].trim(),
      petitioner: row[4].trim(),
      status: row[6].trim(),
      remarks: '',
    });
  }

  return tagged;
}

// ── SPECIAL REMARKS ───────────────────────────────────────────────────────────

function extractSpecialRemarks(text: string): string[] {
  const remarks: string[] = [];

  // Defect notices
  const defectMatch = text.match(/defect[^.]{0,200}\./gi);
  if (defectMatch) remarks.push(...defectMatch.map((d) => d.trim()));

  // Correction/amendment notices
  const correctionMatch = text.match(/order dated[^.]*corrected[^.]{0,200}\./gi);
  if (correctionMatch) remarks.push(...correctionMatch.map((c) => c.trim()));

  // District court forwarding
  const districtMatch = text.match(/District[^.]*forwarded[^.]{0,200}\./gi);
  if (districtMatch) remarks.push(...districtMatch.map((d) => d.trim()));

  return [...new Set(remarks)].slice(0, 5);
}

// ── UTILITY HELPERS ───────────────────────────────────────────────────────────

function normaliseDate(raw: string): string {
  // Convert DD.MM.YYYY or DD-MM-YYYY or DD/MM/YYYY → YYYY-MM-DD
  const m = raw.match(/(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})/);
  if (!m) return raw;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function extractSection(text: string, startMarker: string, endMarker: string): string | null {
  const startIdx = text.toLowerCase().indexOf(startMarker.toLowerCase());
  if (startIdx === -1) return null;
  const endIdx = text.toLowerCase().indexOf(endMarker.toLowerCase(), startIdx);
  if (endIdx === -1) return text.slice(startIdx, startIdx + 2000);
  return text.slice(startIdx, endIdx);
}

function extractField(text: string, field: string): boolean {
  return text.toLowerCase().includes(field.toLowerCase());
}

// ── READINESS SCORE ───────────────────────────────────────────────────────────

/**
 * Given a parsed office report, compute a 0-100 readiness score
 * so the app can show advocates how prepared they are.
 */
export function computeReadinessScore(report: ParsedOfficeReport): number {
  let score = 0;
  const max = 100;

  // Service complete = 40 points
  if (report.serviceComplete) score += 40;
  else {
    const served = report.respondents.filter(
      (r) => r.serviceStatus === 'Complete'
    ).length;
    const total = report.respondents.length || 1;
    score += Math.round((served / total) * 30);
  }

  // Last order extracted = 20 points
  if (report.lastOrderText.length > 50) score += 20;

  // All IAs listed = 10 points
  if (report.iaList.length > 0) score += 10;

  // No defects / special remarks = 10 points
  if (report.specialRemarks.length === 0) score += 10;

  // Court/item number known = 20 points
  if (report.courtNo && report.itemNo) score += 20;

  return Math.min(score, max);
}