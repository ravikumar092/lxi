import React, { useState, useRef, useCallback } from "react";
import { formatCaseTitle } from "../utils/caseTitle";
import { fetchCaseFullByCNR, searchCases, fetchCaseByCaseNumber, fetchSCCaseSession, submitSCCaseCaptcha, fetchSCDiaryStatus } from "../services/eCourtsService";
import { transformMCPToCase } from "../utils/apiTransform";

// ─────────────────────────────────────────────────────────────────────────────
// TYPE DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────
interface ExtractedFields {
  diaryNo?: string;
  diaryYear?: string;
  caseType?: string;
  cnr?: string;
  caseNumber?: string;
  caseTypeCode?: string;        // SC lookup code e.g. "SLP(C)", "WP(C)", "CA", "TP(C)"
  isIAOnly?: boolean;           // true when only an IA number was found (no main case number)
  isHighCourt?: boolean;        // true when a High Court case type (W.A.) was detected — no SC lookup
  registrationNumber?: string;  // pure number extracted from case number e.g. "878"
  registrationYear?: string;    // year extracted from case number e.g. "2026"
  courtName?: string;
  courtNumber?: string;
  petitioner?: string;
  respondent?: string;
  advocates?: string[];
  dateOfFiling?: string;
  allDates?: string[];
  judges?: string[];
  timeOfSitting?: string;
  status?: string;
  jurisdiction?: string;
  docType?: string;
  processId?: string;        // Process Id from Office Report (metadata only)
  processYear?: string;      // Year from Process Id line
  isFreshFiling?: boolean;   // true when diary number < 100 (fresh filing, not yet indexed)
  isIADiary?: boolean;       // true when only an IA Diary No was found (not the main case)
}

interface CaseResult {
  diaryNo?: string;
  diaryYear?: string;
  parties?: string;
  caseNumber?: string;
  cnr?: string;
  filed?: string;
  lastListedOn?: string;
  caseStatusBadge?: string;
  petitioner?: string;
  respondent?: string;
  petitionerAdvocates?: string | null;
  respondentAdvocates?: string;
  status?: string;
  [key: string]: unknown;
}

interface SavedCase {
  diaryNumber?: string | number;
  diaryNo?: string | number;
  diaryYear?: string | number;
  cnrNumber?: string;
  caseNumber?: string;
  petitioners?: string[];
  [key: string]: unknown;
}

interface StatusStyle {
  bg: string;
  color: string;
  border: string;
}

declare global {
  interface Window {
    Tesseract: {
      createWorker: (lang: string, oem: number, options: { logger: (m: { status: string; progress: number }) => void }) => Promise<{
        recognize: (src: string) => Promise<{ data: { text: string } }>;
        terminate: () => Promise<void>;
      }>;
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF DECODER — handles FlateDecode + CIDFont CMap (Supreme Court PDF format)
// ─────────────────────────────────────────────────────────────────────────────
async function decompressChunk(uint8Array: Uint8Array): Promise<string | null> {
  try {
    const ds = new DecompressionStream("deflate");
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    writer.write(new Uint8Array(uint8Array)); writer.close();
    const chunks = [];
    while (true) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total); let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return new TextDecoder("latin1").decode(out);
  } catch { return null; }
}

function buildCMap(text: string): Record<number, string> {
  const m: Record<number, string> = {}, rx = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g; let r;
  while ((r = rx.exec(text))) { const g = parseInt(r[1],16), u = parseInt(r[2],16); if (u>0) m[g] = String.fromCodePoint(u); }
  return m;
}

function decodeTJ(tjContent: string, cmap: Record<number, string>): string {
  let t = "";
  for (const [, hex] of tjContent.matchAll(/<([0-9A-Fa-f]*)>/g))
    for (let i = 0; i < hex.length; i += 2) t += cmap[parseInt(hex.slice(i,i+2),16)] ?? "";
  return t;
}

async function extractTextFromPDF(arrayBuffer: ArrayBuffer): Promise<string> {
  try {
    const bytes = new Uint8Array(arrayBuffer);
    let raw = ""; for (let i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i]);
    const streamRx = /<<([^>]*)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
    const streams = []; let sm;
    while ((sm = streamRx.exec(raw))) streams.push({ meta: sm[1], raw: sm[2] });
    const decompressed = await Promise.all(streams.map(async s => {
      if (!s.meta.includes("FlateDecode")) return s.raw;
      const idx = raw.indexOf(s.raw);
      return await decompressChunk(bytes.slice(idx, idx + s.raw.length)) ?? "";
    }));
    const cmaps: Record<number, Record<number, string>> = {}; let fi = 0;
    for (const t of decompressed) { if (t.includes("begincmap") && t.includes("beginbfchar")) { cmaps[fi] = buildCMap(t); fi++; } }
    const words = [];
    for (const t of decompressed) {
      if (!t.includes("BT")) continue;
      let ci = 0;
      for (const line of t.split("\n")) {
        const fm = line.match(/\/F(\d+)\s+[\d.]+\s+Tf/); if (fm) ci = parseInt(fm[1])-1;
        const cmap: Record<number, string> = cmaps[ci] ?? cmaps[0] ?? {};
        const tj = line.match(/\[([\s\S]*?)\]\s*TJ/); if (tj) { const d = decodeTJ(tj[1],cmap); if (d.trim()) words.push(d.trim()); }
        const ts = line.match(/\(([^)]*)\)\s*Tj/); if (ts) { const d = ts[1].replace(/[^\x20-\x7E]/g,"").trim(); if (d) words.push(d); }
      }
    }
    return words.join(" ");
  } catch { return ""; }
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPREHENSIVE FIELD EXTRACTOR
// ─────────────────────────────────────────────────────────────────────────────
function extractAllFields(text: string): ExtractedFields {
  const t = text.replace(/\s+/g, " ").trim();
  const fields: ExtractedFields = {};

  // ── CASE NUMBER EXTRACTION ────────────────────────────────────────────────
  // Every pattern REQUIRES a recognized label before the number.
  // A bare number without a label is meaningless — NO fallback.
  //
  // numG = regex group holding the case number
  // yearG = regex group holding the year
  // Patterns that capture the bracket type (SLP/WP/TP/Conmt/RP) use:
  //   group 1 = bracket type ("C", "CRL"), group 2 = number, group 3 = year  → numG:2, yearG:3
  // Patterns without bracket type (CA/CrA/Diary/IA/W.A.) use:
  //   group 1 = number, group 2 = year                                        → numG:1, yearG:2
  type CP = { rx: RegExp; label: string; numG: number; yearG: number; isHC: boolean };
  const casePatterns: CP[] = [
    // ── DIARY NUMBER (strongest identifier — SC internal) ─────────────────────────
    // Groups A + B: "Diary No.", "Diary No(s).", "DIARY NUMBER", "DIARY NNN/YYYY"
    // Separators: "/" or "-" or " OF " (SC office reports use all three)
    { rx: /diary\s+no(?:\(s\))?\.?\s*[:\-]?\s*(\d{1,6})\s*(?:[\/\-]|\s+of\s+)(20\d{2})/i,     label:"Diary No", numG:1, yearG:2, isHC:false },
    { rx: /diary\s+number\s*[:\-]?\s*(\d{1,6})\s*(?:[\/\-]|\s+of\s+)(20\d{2})/i,               label:"Diary No", numG:1, yearG:2, isHC:false },
    { rx: /\bdiary\s+(\d{1,6})\s*[-\/](20\d{2})/i,                                               label:"Diary No", numG:1, yearG:2, isHC:false },
    // D.NO. / D NO. / D.No(s). variants — handles "D.NO.", "D NO.", "D.No(s).", "D NO(s)."
    { rx: /\bd\.?\s*no(?:\(s\))?\.?\s*[:\-]?\s*(\d{1,6})\s*(?:[\/\-]|\s+of\s*)(20\d{2})/i,    label:"Diary No", numG:1, yearG:2, isHC:false },
    // ── SLP ──────────────────────────────────────────────────────────────────────
    { rx: /petition\(?s?\)?\s+for\s+special\s+leave(?:\s+to\s+appeal)?\s*\(([A-Z.]+)\)\s*No\(?s?\)?\.?\s*0*(\d{1,6})(?:-\d+)?\s*(?:[\/\-]|\s+of)\s*(20\d{2})/i, label:"SLP No", numG:2, yearG:3, isHC:false },
    { rx: /s\.?\s*l\.?\s*p\.?\s*\(([A-Z.]+)\)\s*No\(?s?\)?\.?\s*[:\-]?\s*0*(\d{1,6})(?:-\d+)?\s*(?:[-\s]*\/|\s+of)\s*(20\d{2})/i,                              label:"SLP No", numG:2, yearG:3, isHC:false },
    // ── WRIT PETITION ────────────────────────────────────────────────────────────
    { rx: /writ\s+petition\s*\(([A-Z.]+)\)\s*No\(?s?\)?\.?\s*[:\-]?\s*(\d{1,6})(?:-\d+)?\s*(?:[\/\-]|\s+of)\s*(20\d{2})/i, label:"WP No", numG:2, yearG:3, isHC:false },
    { rx: /w\.?\s*p\.?\s*\(([A-Z.]+)\)\s*No\(?s?\)?\.?\s*[:\-]?\s*(\d{1,6})(?:-\d+)?\s*(?:[\/\-]|\s+of)\s*(20\d{2})/i,     label:"WP No", numG:2, yearG:3, isHC:false },
    // ── CIVIL APPEAL ─────────────────────────────────────────────────────────────
    { rx: /civil\s+appeal\s*No\(?s?\)?\.?\s*[:\-]?\s*(\d{4,6})(?:-\d+)?\s*(?:of|\/)\s*(20\d{2})/i, label:"CA No",    numG:1, yearG:2, isHC:false },
    { rx: /\bc\.?\s*a\.?\s*No\(?s?\)?\.?\s*[:\-]?\s*(\d{4,6})(?:-\d+)?\s*(?:of|\/)\s*(20\d{2})/i,  label:"CA No",    numG:1, yearG:2, isHC:false },
    // ── CRIMINAL APPEAL ──────────────────────────────────────────────────────────
    { rx: /criminal\s+appeal\s*No\(?s?\)?\.?\s*[:\-]?\s*(\d{4,6})(?:-\d+)?\s*(?:of|\/)\s*(20\d{2})/i,       label:"Crl.A No", numG:1, yearG:2, isHC:false },
    { rx: /cr(?:l|im)\.?\s*a(?:pp(?:eal)?)?\.?\s*No\(?s?\)?\.?\s*[:\-]?\s*(\d{4,6})(?:-\d+)?\s*(?:of|\/)\s*(20\d{2})/i, label:"Crl.A No", numG:1, yearG:2, isHC:false },
    // ── TRANSFER PETITION ────────────────────────────────────────────────────────
    { rx: /transfer\s+petition\s*\(([A-Z.]+)\)\s*No\(?s?\)?\.?\s*[:\-]?\s*(\d{1,6})(?:-\d+)?\s*(?:[\/\-]|\s+of)\s*(20\d{2})/i, label:"TP No", numG:2, yearG:3, isHC:false },
    { rx: /t\.?\s*p\.?\s*\(([A-Z.]+)\)\s*No\(?s?\)?\.?\s*[:\-]?\s*(\d{1,6})(?:-\d+)?\s*(?:[\/\-]|\s+of)\s*(20\d{2})/i,         label:"TP No", numG:2, yearG:3, isHC:false },
    // ── CONTEMPT PETITION ────────────────────────────────────────────────────────
    { rx: /contempt\s+petition\s*\(?([A-Z]*)\)?\s*No\(?s?\)?\.?\s*[:\-]?\s*(\d{1,6})(?:-\d+)?\s*(?:[\/\-]|\s+of)\s*(20\d{2})/i, label:"Conmt No", numG:2, yearG:3, isHC:false },
    { rx: /con?mt\.?\s*pet\.?\s*\(?([A-Z]*)\)?\s*No\(?s?\)?\.?\s*[:\-]?\s*(\d{1,6})(?:-\d+)?\s*(?:[\/\-]|\s+of)\s*(20\d{2})/i, label:"Conmt No", numG:2, yearG:3, isHC:false },
    // ── REVIEW PETITION ──────────────────────────────────────────────────────────
    { rx: /review\s+petition\s*\(?([A-Z]*)\)?\s*No\(?s?\)?\.?\s*[:\-]?\s*(\d{1,6})(?:-\d+)?\s*(?:[\/\-]|\s+of)\s*(20\d{2})/i, label:"RP No", numG:2, yearG:3, isHC:false },
    { rx: /\br\.?\s*p\.?\s*\(([A-Z]+)\)\s*No\(?s?\)?\.?\s*[:\-]?\s*(\d{1,6})(?:-\d+)?\s*(?:[\/\-]|\s+of)\s*(20\d{2})/i,       label:"RP No", numG:2, yearG:3, isHC:false },
    // ── TRANSFERRED CASE ─────────────────────────────────────────────────────────
    { rx: /transferred\s+case\s*\(([A-Z.]+)\)\s*No\(?s?\)?\.?\s*[:\-]?\s*0*(\d{1,6})(?:-\d+)?\s*(?:[\/\-]|\s+of)\s*(20\d{2})/i, label:"TC No", numG:2, yearG:3, isHC:false },
    { rx: /\bt\.?c\.?\s*\(([A-Z.]+)\)\s*No\.?\s*[:\-]?\s*0*(\d{1,6})\s*(?:[\/\-]|\s+of)\s*(20\d{2})/i,                         label:"TC No", numG:2, yearG:3, isHC:false },
    // ── HIGH COURT — flag only, SC lookup not applicable ─────────────────────────
    { rx: /w\.?\s*a\.?\s*No\(?s?\)?\.?\s*[:\-]?\s*(\d{1,6})(?:-\d+)?\s*(?:[\/\-]|\s+of)\s*(20\d{2})/i, label:"W.A. No", numG:1, yearG:2, isHC:true },
    // ── INTERLOCUTORY APPLICATION — lowest priority ───────────────────────────────
    { rx: /interlocutory\s+application\s*No\(?s?\)?\.?\s*[:\-]?\s*(\d{1,6})(?:-\d+)?\s*[\/\-]\s*(20\d{2})/i, label:"IA No", numG:1, yearG:2, isHC:false },
    { rx: /i\.?\s*a\.?\s*No\(?s?\)?\.?\s*[:\-]?\s*(\d{1,6})(?:-\d+)?\s*[\/\-]\s*(20\d{2})/i,                label:"IA No", numG:1, yearG:2, isHC:false },
    // ── NO BARE NUMBER FALLBACK — a number without a label is meaningless ─────────
  ];

  for (const { rx, label, numG, yearG, isHC } of casePatterns) {
    const m = t.match(rx);
    if (!m) continue;
    fields.caseType   = label;
    fields.caseNumber = m[0].trim(); // full matched text (e.g. "SLP(C) No. 2772 OF 2026")
    const bracketType = numG === 2 ? (m[1] || '') : ''; // e.g. "C", "CRL", "CRL."
    const isCrl = /CRL|CRIM/.test(bracketType.toUpperCase());
    const num  = String(parseInt(m[numG], 10));   // strip leading zeros
    const year = m[yearG];
    if (label === "Diary No") {
      fields.diaryNo   = num;
      fields.diaryYear = year;
    } else {
      fields.registrationNumber = num;
      fields.registrationYear   = year;
      if (isHC)              fields.isHighCourt = true;
      if (label === "IA No") fields.isIAOnly    = true;
      // Derive the SC website case type code for the diary-number lookup API
      if      (label === "SLP No")   fields.caseTypeCode = isCrl ? 'SLP(CRL)' : 'SLP(C)';
      else if (label === "WP No")    fields.caseTypeCode = isCrl ? 'WP(CRL)'  : 'WP(C)';
      else if (label === "TP No")    fields.caseTypeCode = isCrl ? 'TP(CRL)'  : 'TP(C)';
      else if (label === "Conmt No") fields.caseTypeCode = isCrl ? 'ConCr'    : 'ConC';
      else if (label === "RP No")    fields.caseTypeCode = isCrl ? 'RP(CRL)'  : 'RP(C)';
      else if (label === "CA No")    fields.caseTypeCode = 'CA';
      else if (label === "Crl.A No") fields.caseTypeCode = 'CRL.A';
      else if (label === "TC No")    fields.caseTypeCode = isCrl ? 'TC(CRL)' : 'TC(C)';
    }
    break;
  }

  // ── YEAR SANITY CHECK ───────────────────────────────────────────────────────
  // Reject extracted years outside [1950, currentYear+1] (catches OCR truncations like "202")
  const _curYear = new Date().getFullYear();
  const _yearOk = (y: string | undefined) => !!y && parseInt(y, 10) >= 1950 && parseInt(y, 10) <= _curYear + 1;
  if (fields.diaryYear && !_yearOk(fields.diaryYear)) { delete fields.diaryNo; delete fields.diaryYear; }
  if (fields.registrationYear && !_yearOk(fields.registrationYear)) { delete fields.registrationNumber; delete fields.registrationYear; }

  // ── SCI URL DIARY EXTRACTION (Group G) ─────────────────────────────────────
  // Printed/screenshotted SCI office report URLs contain diary+year in the path
  if (!fields.diaryNo) {
    const urlM = t.match(/officereport\/(\d{4})\/(\d+)\//);
    if (urlM && _yearOk(urlM[1])) {
      fields.diaryNo   = String(parseInt(urlM[2], 10));
      fields.diaryYear = urlM[1];
      fields.caseType  = fields.caseType || 'Diary No';
    }
  }

  // ── IA DIARY NUMBER (Group F) ───────────────────────────────────────────────
  // I.A. DIARY NO., Application Diary No., INTERLOCUTORY APPLICATION D.NO.
  // Extracted as metadata only — do NOT use as main case lookup.
  if (!fields.diaryNo && !fields.registrationNumber) {
    const iaDM = t.match(/i\.?a\.?\s+diary\s+no\.?\s*(\d{1,6})\s*(?:of\s+)(20\d{2})/i)
              || t.match(/interlocutory\s+application\s+d\.?no\.?\s*(\d{1,6})\s*[\/\-](20\d{2})/i)
              || t.match(/application\s+diary\s+no\.?\s*(\d{1,6})\s*(?:of\s+)(20\d{2})/i);
    if (iaDM && _yearOk(iaDM[2])) {
      fields.diaryNo   = String(parseInt(iaDM[1], 10));
      fields.diaryYear = iaDM[2];
      fields.isIADiary = true;
      fields.caseType  = 'IA Diary';
    }
  }

  // ── PROCESS ID EXTRACTION ───────────────────────────────────────────────────
  // "Process Id: 1038/2024", "Process Id-64/2022" — metadata, not for API lookup
  const procM = t.match(/process\s+id\s*[-:\s]+(\d+)\s*[\/\-]\s*(20\d{2})/i);
  if (procM && _yearOk(procM[2])) { fields.processId = procM[1]; fields.processYear = procM[2]; }

  // ── FRESH FILING DETECTION ──────────────────────────────────────────────────
  // Diary numbers < 100 are very early in a given year — eCourts may not index them yet
  if (fields.diaryNo && parseInt(fields.diaryNo, 10) < 100 && !fields.isIADiary) {
    fields.isFreshFiling = true;
  }

  // ── IA CONTEXT: if only an IA was found, look for "IN SLP(C)/WP/CA No. X/Y" ──
  // SC office reports often say: "I.A. No. 44 OF 2026 IN SLP(C) No. 2772 OF 2026"
  if (fields.isIAOnly) {
    const inM = t.match(/\bIN\s+(s\.?\s*l\.?\s*p\.?|w\.?\s*p\.?|c\.?\s*a\.?|t\.?\s*p\.?|criminal\s+appeal|civil\s+appeal)\s*\(?([A-Z.]*)\)?\s*No\(?s?\)?\.?\s*0*(\d{1,6})(?:-\d+)?\s*(?:[\/\-]|\s+of)\s*(20\d{2})/i);
    if (inM) {
      const rawType = (inM[1] || '').replace(/[\s.]/g, '').toUpperCase();
      const bracket = (inM[2] || '').toUpperCase().replace(/\./g, '');
      const isCrl2  = /CRL|CRIM/.test(bracket);
      const num2    = String(parseInt(inM[3], 10));
      const year2   = inM[4];
      let lbl2 = 'SLP No', code2: string | undefined;
      if      (/WP/.test(rawType))           { lbl2 = 'WP No';    code2 = isCrl2 ? 'WP(CRL)' : 'WP(C)'; }
      else if (/CA|CIVILAPPEAL/.test(rawType)){ lbl2 = 'CA No';   code2 = 'CA'; }
      else if (/TP/.test(rawType))           { lbl2 = 'TP No';    code2 = isCrl2 ? 'TP(CRL)' : 'TP(C)'; }
      else if (/CRIMINALAPPEAL/.test(rawType)){ lbl2 = 'Crl.A No'; code2 = 'CRL.A'; }
      else                                    { lbl2 = 'SLP No';   code2 = isCrl2 ? 'SLP(CRL)' : 'SLP(C)'; }
      fields.isIAOnly           = false;
      fields.caseType           = lbl2;
      fields.caseNumber         = inM[0].trim();
      fields.registrationNumber = num2;
      fields.registrationYear   = year2;
      fields.caseTypeCode       = code2;
    }
  }

  // ── CNR ────────────────────────────────────────────────────────────────────
  const cnr = t.match(/\bSCIN\d{10,}\b|\bCNR\s*[:\-]?\s*([A-Z0-9]{12,})/i);
  if (cnr) {
    fields.cnr = cnr[0].replace(/^CNR\s*[:\-]?\s*/i,"").trim().toUpperCase();
    // Derive diary number from SC CNR format: SCIN01 + 6-digit-diary + 4-digit-year
    if (!fields.diaryNo) {
      const scinM = fields.cnr.match(/^SCIN01(\d{6})(\d{4})$/);
      if (scinM) {
        fields.diaryNo   = String(parseInt(scinM[1], 10));
        fields.diaryYear = scinM[2];
      }
    }
  }

  // If diary number extracted but no registrationNumber, copy it so local matching works
  if (!fields.registrationNumber && fields.diaryNo) {
    fields.registrationNumber = fields.diaryNo;
    fields.registrationYear   = fields.diaryYear;
  }

  if (/supreme\s*court\s*of\s*india/i.test(t)) fields.courtName = "Supreme Court of India";
  else if (/high\s*court\s*of\s*([a-z\s]+)/i.test(t)) fields.courtName = t.match(/high\s*court\s*of\s*([a-z\s]+)/i)?.[0];

  const courtNo = t.match(/court\s*(?:no\.?|number)\s*[:\-]?\s*(\d+)/i);
  if (courtNo) fields.courtNumber = `Court No. ${courtNo[1]}`;

  // Allow optional space/dots between name and Petitioner/Appellant/Respondent label
  const petMatch = t.match(/([A-Z][A-Z\s&.,]{4,}?)\s*\.{2,}\s*(?:Appellant|Petitioner)/);
  if (petMatch) fields.petitioner = petMatch[1].trim();
  else {
    // "vs." fallback — require both sides to be at least 5 chars (avoids matching abbreviations like "T.V.")
    const vs = t.match(/([A-Z][A-Z\s&.,]{4,}?)\s+(?:VERSUS|V\.S\.|VS\.)\s+([A-Z][A-Z\s&.,]{4,})/);
    if (vs) { fields.petitioner = vs[1].trim(); fields.respondent = vs[2].trim(); }
  }

  if (!fields.respondent) {
    const resMatch = t.match(/(?:VERSUS|VS\.)\s+([A-Z][A-Z\s&.,]{4,}?)\s*\.{2,}\s*(?:Respondent|OFFICE REPORT)/i);
    if (resMatch) fields.respondent = resMatch[1].trim();
  }

  const advMatches = [...t.matchAll(/(?:Mr\.|Ms\.|Mrs\.|Dr\.)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),?\s*(?:Adv|Advocate|Sr\. Counsel|Senior Counsel)?/g)];
  if (advMatches.length > 0) fields.advocates = advMatches.map(m => m[0].replace(/,?\s*$/, "").trim());

  const filingDate = t.match(/(?:filed|filing|registered\s*on)\s*[:\-]?\s*(\d{1,2}[-\.\/]\d{1,2}[-\.\/]\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+\w+\s+\d{4})/i);
  if (filingDate) fields.dateOfFiling = filingDate[1];

  const dates = [...t.matchAll(/(\d{1,2}[-\.\/]\d{1,2}[-\.\/]\d{4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{4})/gi)];
  if (dates.length > 0) fields.allDates = dates.map(d => d[1]);

  const judges = [...t.matchAll(/(?:Justice|Hon'ble|Honble|JUSTICE)\s+([A-Z][a-z]*\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g)];
  if (judges.length > 0) fields.judges = judges.map(j => `Justice ${j[1].trim()}`);

  const time = t.match(/\b(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))\b/);
  if (time) fields.timeOfSitting = time[1];

  if (/\bDISPOSED\b/i.test(t)) fields.status = "Disposed";
  else if (/\bDEFECTIVE\b/i.test(t)) fields.status = "Defective";
  else if (/\bPENDING\b/i.test(t)) fields.status = "Pending";
  else if (/\bFRESH\b/i.test(t)) fields.status = "Fresh";

  if (/civil\s*appellate/i.test(t))   fields.jurisdiction = "Civil Appellate";
  if (/criminal\s*appellate/i.test(t)) fields.jurisdiction = "Criminal Appellate";
  if (/original\s*jurisdiction/i.test(t)) fields.jurisdiction = "Original";

  if (/office\s*report/i.test(t))              fields.docType = "Office Report";
  if (/cause\s*list/i.test(t))                 fields.docType = "Cause List";
  if (/\bORDER\b/.test(t))                     fields.docType = fields.docType || "Order";
  if (/notice\s*of\s*(?:motion|hearing)/i.test(t)) fields.docType = fields.docType || "Notice";

  return fields;
}

function matchAgainstCases(fields: ExtractedFields, savedCases: SavedCase[]): SavedCase[] {
  if (!savedCases?.length) return [];
  const seen = new Set<unknown>();
  const results: SavedCase[] = [];
  for (const c of savedCases) {
    let matched = false;
    // 1. Diary number + year (strongest match)
    if (fields.diaryNo && fields.diaryYear)
      if (String(c.diaryNumber || c.diaryNo) === String(fields.diaryNo) && String(c.diaryYear) === String(fields.diaryYear)) matched = true;
    // 2. CNR number
    if (!matched && fields.cnr && c.cnrNumber && c.cnrNumber.toLowerCase() === fields.cnr.toLowerCase()) matched = true;
    // 3. Registration number + year extracted from case number (handles "SLP(Crl) No. 000878/2026")
    if (!matched && fields.registrationNumber && fields.registrationYear) {
      const regNum = parseInt(fields.registrationNumber, 10);
      // Check against stored caseNumber field e.g. "SLP(Crl) No. 000878/2026" or "No. 878/2026"
      const caseNumStr = String(c.caseNumber || '');
      const numMatch = caseNumStr.match(/No\.\s*0*(\d+)\s*[\/\-]/);
      if (numMatch && !isNaN(regNum) && parseInt(numMatch[1], 10) === regNum && caseNumStr.includes(fields.registrationYear)) matched = true;
      // Check against shortCaseNumber e.g. "000878/2026"
      if (!matched) {
        const shortStr = String((c as any).shortCaseNumber || '');
        const shortMatch = shortStr.match(/^0*(\d+)\/(20\d{2})$/);
        if (shortMatch && !isNaN(regNum) && parseInt(shortMatch[1], 10) === regNum && shortMatch[2] === fields.registrationYear) matched = true;
      }
    }
    if (matched && !seen.has(c)) { seen.add(c); results.push(c); }
  }
  return results;
}

// Build CNR from diary number + year (Supreme Court format: SCIN01 + 6-digit diary + year)
function buildCNRFromDiary(diaryNo: string, diaryYear: string): string {
  return `SCIN01${String(parseInt(diaryNo, 10)).padStart(6, '0')}${diaryYear}`;
}

async function fetchCaseByCNRStr(cnr: string): Promise<{ ok: boolean; data: CaseResult; errorMsg?: string }> {
  try {
    const data = await fetchCaseFullByCNR(cnr.trim().toUpperCase());
    if (!data) return { ok: false, data: {} as CaseResult, errorMsg: "Case not found in eCourts database" };
    return { ok: true, data: transformMCPToCase(data, cnr) as CaseResult };
  } catch (e: any) {
    return { ok: false, data: {} as CaseResult, errorMsg: e?.message || "Network error" };
  }
}

// Try all available identifiers to fetch the case from eCourts:
// Build a full CaseResult from SC diary status response + document extraction.
// The eCourts partner API (webapi.ecourtsindia.com) does not reliably index SC
// cases — the SC website (sci.gov.in) is the authoritative source for SC data.
function buildResultFromDiaryStatus(
  ds: NonNullable<Awaited<ReturnType<typeof fetchSCDiaryStatus>>>,
  diaryNo: string, diaryYear: string, cnr: string, fields: ExtractedFields
): { ok: boolean; data: CaseResult } {
  return {
    ok: true,
    data: {
      diaryNo, diaryYear, cnr,
      // Prefer extracted case number (e.g. SLP(C) 3878/2026) over SC diary API's short format (No. 8523/2026)
      caseNumber:   fields.caseNumber  || ds.caseNumber  || '',
      petitioner:   ds.petitioner  || fields.petitioner  || '',
      respondent:   ds.respondent  || fields.respondent  || '',
      lastListedOn: ds.lastListedOn  || undefined,
      filed:        ds.filingDate    || fields.dateOfFiling || undefined,
      status: 'PENDING',
    } as CaseResult,
  };
}

async function fetchCaseFromFields(fields: ExtractedFields): Promise<{ ok: boolean; data: CaseResult; errorMsg?: string }> {
  // IA Diary numbers are not the main case — skip API lookup
  if (fields.isIADiary) {
    return { ok: false, data: {} as CaseResult, errorMsg: "Document contains an I.A. Diary number, not a main case diary number. Use Dashboard → Search to look up by diary number." };
  }

  // 1. Direct CNR from document
  if (fields.cnr) {
    const res = await fetchCaseByCNRStr(fields.cnr);
    if (res.ok) return res;
  }

  // 2. Diary number path: try eCourts (both diary-CNR and reg-CNR), then SC website
  if (fields.diaryNo && fields.diaryYear) {
    // 2a. Try eCourts with diary-based CNR
    const cnrDiary = buildCNRFromDiary(fields.diaryNo, fields.diaryYear);
    const resDiary = await fetchCaseByCNRStr(cnrDiary);
    if (resDiary.ok) return resDiary;

    // 2b. SC website diary status — full case data (primary SC source)
    try {
      const ds = await fetchSCDiaryStatus(fields.diaryNo, fields.diaryYear);
      if (ds?.status || ds?.caseNumber || ds?.petitioner || ds?.lastListedOn) {
        return buildResultFromDiaryStatus(ds, fields.diaryNo, fields.diaryYear, cnrDiary, fields);
      }
    } catch { /* ignore */ }

    // 2d. Fresh filing warning — very small diary numbers are early-year filings not yet indexed
    if (fields.isFreshFiling) {
      return {
        ok: false,
        data: {} as CaseResult,
        errorMsg: `Fresh filing — Diary No. ${fields.diaryNo}/${fields.diaryYear} is a very early filing (low diary number) and may not yet be indexed in eCourts or the SC portal. Try again later or check directly at sci.gov.in.`,
      };
    }
  }

  // 3. Case registration number via SC website → diary number → eCourts / SC diary
  // Skip for High Court cases and IA-only documents
  if (fields.registrationNumber && fields.registrationYear && !fields.isHighCourt && !fields.isIAOnly) {
    // 3b. SC website case-number lookup (needs captcha server-side; auto-resolves math captcha)
    try {
      const knownType = fields.caseTypeCode || fields.caseType || '';
      const typesToTry: string[] = knownType && knownType !== 'Case No'
        ? [knownType]
        : ['SLP(C)', 'WP(C)', 'CA', 'TP(C)', 'SLP(CRL)', 'WP(CRL)'];
      for (const caseType of typesToTry) {
        const scResult = await fetchCaseByCaseNumber(caseType, fields.registrationNumber, fields.registrationYear);
        if (scResult?.diary_no) {
          // Got diary number from SC website — now try eCourts
          const cnrD = buildCNRFromDiary(scResult.diary_no, scResult.diary_year);
          const resD = await fetchCaseByCNRStr(cnrD);
          if (resD.ok) return resD;
          // eCourts failed — use SC diary status with the now-known diary number
          try {
            const ds = await fetchSCDiaryStatus(scResult.diary_no, scResult.diary_year);
            if (ds?.status || ds?.caseNumber || ds?.petitioner || ds?.lastListedOn) {
              return buildResultFromDiaryStatus(
                ds, scResult.diary_no, scResult.diary_year, cnrD,
                { ...fields, diaryNo: scResult.diary_no, diaryYear: scResult.diary_year }
              );
            }
          } catch { /* ignore */ }
          break;
        }
      }
    } catch { /* ignore */ }
  }

  // 4. Party name search — try petitioner then respondent (state=SC filters Supreme Court)
  const nameYear = fields.registrationYear || fields.diaryYear || '';
  const regNum   = fields.registrationNumber ? parseInt(fields.registrationNumber, 10) : null;

  const tryNameSearch = async (params: Parameters<typeof searchCases>[0]) => {
    try {
      const results = await searchCases({ ...params, state: 'SC' });
      const items: any[] = Array.isArray(results?.data) ? results.data
        : Array.isArray(results?.cases) ? results.cases
        : Array.isArray(results) ? results : [];
      const hit = items.find((r: any) => {
        if (!r) return false;
        if (nameYear) {
          const rYear = String(r.registrationYear || r.cnrYear || r.year || '');
          if (rYear && rYear !== nameYear) return false;
        }
        if (regNum !== null) {
          const rNum = parseInt(r.registrationNumber || r.caseNo?.match(/(\d+)/)?.[1] || '0', 10);
          return rNum === regNum;
        }
        return true;
      });
      if (hit) {
        const cnrHit = hit.cnr || hit.cnrNumber || '';
        if (cnrHit) {
          const res2 = await fetchCaseByCNRStr(cnrHit);
          if (res2.ok) return res2;
        }
      }
    } catch { /* ignore */ }
    return null;
  };

  if (fields.petitioner && nameYear) {
    const q = fields.petitioner.split(/\s+/).slice(0, 3).join(' ');
    const r = await tryNameSearch({ petitioners: q });
    if (r) return r;
  }

  if (fields.respondent && nameYear) {
    const q = fields.respondent.split(/\s+/).slice(0, 3).join(' ');
    const r = await tryNameSearch({ respondents: q });
    if (r) return r;
  }

  if (fields.advocates && fields.advocates.length > 0 && nameYear) {
    const q = fields.advocates[0].split(/\s+/).slice(0, 3).join(' ');
    const r = await tryNameSearch({ advocates: q });
    if (r) return r;
  }

  return {
    ok: false, data: {} as CaseResult,
    errorMsg: "Could not fetch case — document does not contain a diary number or CNR. Use Dashboard → Search to add by diary number.",
  };
}

function statusStyle(s?: string): StatusStyle {
  const b = (s||"").toUpperCase();
  if (b==="PENDING")                   return {bg:"#FBF4E3",color:"#9B7B28",border:"#E8D18A"};
  if (b==="DISPOSED"||b==="CLOSED")    return {bg:"#E3F5EE",color:"#1A8C5B",border:"#9FD9BC"};
  if (b==="DEFECTIVE")                 return {bg:"#FEF2F2",color:"#C62828",border:"#FECACA"};
  return                                      {bg:"#E8F1FB",color:"#2A7BD4",border:"#B3D0F0"};
}

function StepDot({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
      <div style={{width:32,height:32,borderRadius:"50%",background:done?"linear-gradient(135deg,#1A8C5B,#2ECC8A)":active?"linear-gradient(135deg,#1A2E5E,#2A4B9B)":"#E2E6EF",color:(done||active)?"#fff":"#8A94B0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800,transition:"all 0.3s",boxShadow:active?"0 4px 14px rgba(26,46,94,0.35)":"none"}}>
        {done?"✓":n}
      </div>
    </div>
  );
}

function FieldRow({ icon, label, value }: { icon: string; label: string; value?: string | string[] | null }) {
  if (!value) return null;
  const display = Array.isArray(value) ? value.join(", ") : value;
  return (
    <div style={{display:"flex",gap:10,alignItems:"flex-start",padding:"7px 0",borderBottom:"1px solid #F3F4F8"}}>
      <span style={{fontSize:14,flexShrink:0,marginTop:1}}>{icon}</span>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:10,fontWeight:700,color:"#8A94B0",letterSpacing:0.8,textTransform:"uppercase",marginBottom:2}}>{label}</div>
        <div style={{fontSize:13,fontWeight:600,color:"#1A2340",lineHeight:1.5,wordBreak:"break-word"}}>{display}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function DocumentScanner({ onCaseFound, savedCases = [] }: { onCaseFound?: (c: CaseResult | SavedCase) => void; savedCases?: SavedCase[] }) {
  const [step,         setStep]         = useState(0);
  const [imgSrc,       setImgSrc]       = useState<string | null>(null);
  const [fileType,     setFileType]     = useState("");
  const [progress,     setProgress]     = useState(0);
  const [rawText,      setRawText]      = useState("");
  const [fields,       setFields]       = useState<ExtractedFields | null>(null);
  const [caseResult,   setCaseResult]   = useState<CaseResult | SavedCase | null>(null);
  const [matchedCases, setMatchedCases] = useState<SavedCase[]>([]);
  const [alreadySaved, setAlreadySaved] = useState(false);   // true = case is already in dashboard
  const [fetchError,   setFetchError]   = useState("");
  const [error,        setError]        = useState("");
  const [source,       setSource]       = useState("");
  const [captchaSid,    setCaptchaSid]    = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [captchaLoading,setCaptchaLoading]= useState(false);
  const [captchaError,  setCaptchaError]  = useState("");
  const [isDragging,   setIsDragging]   = useState(false);
  const [showCam,      setShowCam]      = useState(false);
  const [camError,     setCamError]     = useState("");

  const fileRef   = useRef<HTMLInputElement>(null);
  const camRef    = useRef<HTMLInputElement>(null);
  const videoRef  = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // ── LOAD FILE ──────────────────────────────────────────────────────────────
  const loadFile = useCallback(async (file: File) => {
    if (!file) return;
    const isPDF = file.type==="application/pdf" || file.name?.toLowerCase().endsWith(".pdf");
    const isImg = file.type.startsWith("image/");
    if (!isPDF && !isImg) { setError("Please upload a JPG, PNG, or PDF file."); setStep(6); return; }
    if (isPDF) {
      setFileType("pdf"); setStep(2); setProgress(10);
      try {
        const buf  = await file.arrayBuffer(); setProgress(40);
        const text = await extractTextFromPDF(buf); setProgress(80);
        setRawText(text); setProgress(100);
        const extracted = extractAllFields(text);
        if (!extracted.diaryNo && !extracted.cnr && !extracted.caseNumber && !extracted.petitioner && !extracted.registrationNumber) {
          setError("No recognisable case fields found. The PDF may use an unsupported encoding — try uploading a screenshot as PNG/JPG.");
          setStep(6); return;
        }
        setFields(extracted); setStep(3);
      } catch(e) { setError("Could not read PDF: "+(e as Error).message); setStep(6); }
    } else {
      setFileType("image");
      const r = new FileReader();
      r.onload = (e: ProgressEvent<FileReader>) => { setImgSrc(e.target?.result as string ?? null); setStep(1); };
      r.readAsDataURL(file);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files?.[0]) loadFile(e.target.files[0]); };
  const handleDrop   = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); };

  // ── OCR ────────────────────────────────────────────────────────────────────
  const runOCR = useCallback(async () => {
    setStep(2); setProgress(0); setRawText(""); setFields(null); setError("");
    try {
      if (!window.Tesseract) throw new Error("Tesseract.js not loaded.");
      const worker = await window.Tesseract.createWorker("eng", 1, {
        logger: m => { if (m.status==="recognizing text") setProgress(Math.round(m.progress*100)); }
      });
      const { data: { text } } = await worker.recognize(imgSrc!);
      await worker.terminate();
      setRawText(text);
      const extracted = extractAllFields(text);
      if (!extracted.diaryNo && !extracted.cnr && !extracted.caseNumber && !extracted.petitioner && !extracted.registrationNumber) {
        setError("No case information found in this image. Ensure text is clearly visible."); setStep(6); return;
      }
      setFields(extracted); setStep(3);
    } catch(e) { setError("OCR failed: "+(e as Error).message); setStep(6); }
  }, [imgSrc]);

  // ── LOOKUP ─────────────────────────────────────────────────────────────────
  const lookupCase = useCallback(async () => {
    if (!fields) return;
    setStep(4);
    setFetchError("");
    setAlreadySaved(false);

    // 1. Check local dashboard first (instant — no API cost)
    const locals = matchAgainstCases(fields, savedCases);
    if (locals.length > 0) {
      setMatchedCases(locals);
      setAlreadySaved(true);
      setSource("local");
      setCaseResult(locals.length === 1 ? locals[0] : null);
      setStep(5);
      return;
    }

    // 2. Fetch from eCourts API using whatever identifiers were found
    const res = await fetchCaseFromFields(fields);
    if (res.ok) {
      setMatchedCases([res.data as unknown as SavedCase]);
      setCaseResult(res.data);
      setAlreadySaved(false);
      setSource("api");
      setStep(5);
      return;
    }

    // 3. Nothing found
    setFetchError(res.errorMsg || "Could not fetch case");
    setMatchedCases([]);
    setCaseResult(null);
    setSource("extracted");
    setStep(5);
  }, [fields, savedCases]);

  // ── SC CAPTCHA LOOKUP ──────────────────────────────────────────────────────
  const loadCaptcha = useCallback(async () => {
    setCaptchaLoading(true);
    setCaptchaSid("");
    setCaptchaError("");
    const session = await fetchSCCaseSession();
    if (session?.sid) {
      setCaptchaSid(session.sid);
    } else {
      setCaptchaError("Could not load captcha from SC website.");
    }
    setCaptchaLoading(false);
  }, []);

  const handleCaptchaSubmit = useCallback(async () => {
    if (!fields || !captchaSid || !captchaAnswer) return;
    setCaptchaLoading(true);
    setCaptchaError("");
    const caseType = fields.caseTypeCode || fields.caseType || '';
    const no = fields.registrationNumber || '';
    const year = fields.registrationYear || '';
    const scResult = await submitSCCaseCaptcha(caseType, no, year, captchaSid, captchaAnswer);
    if (scResult && 'diary_no' in scResult) {
      const cnr = buildCNRFromDiary(scResult.diary_no, scResult.diary_year);
      let res = await fetchCaseByCNRStr(cnr);
      // Retry once after a short delay (Render cold-start can cause first call to fail)
      if (!res.ok) {
        await new Promise(r => setTimeout(r, 1500));
        res = await fetchCaseByCNRStr(cnr);
      }
      if (res.ok) {
        setMatchedCases([res.data as unknown as SavedCase]);
        setCaseResult(res.data);
        setAlreadySaved(!!savedCases.find((c: SavedCase) => c.cnrNumber === (res.data as any).cnrNumber));
        setSource("api");
        setStep(5);
        setCaptchaSid("");
        setCaptchaAnswer("");
      } else {
        // Update fields so the diary number is now available for display
        setFields(f => f ? { ...f, diaryNo: scResult.diary_no, diaryYear: scResult.diary_year } : f);
        setCaptchaError(`Diary No. ${scResult.diary_no}/${scResult.diary_year} found — eCourts fetch failed. Go to Dashboard → Search and enter diary number ${scResult.diary_no} (year ${scResult.diary_year}).`);
      }
    } else {
      const debugInfo = (scResult && 'debug' in scResult && scResult.debug) ? `\nSC response: ${scResult.debug}` : '';
      setCaptchaError(`No result — wrong captcha answer or case not found for this type. Please check the captcha image and try again.${debugInfo}`);
      // Refresh captcha
      const session = await fetchSCCaseSession();
      if (session?.sid) setCaptchaSid(session.sid);
    }
    setCaptchaLoading(false);
  }, [fields, captchaSid, captchaAnswer, savedCases]);

  // ── WEBCAM ─────────────────────────────────────────────────────────────────
  const openCamera = useCallback(async () => {
    setCamError("");
    setShowCam(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          // Request ideal dimensions matching device screen for best quality
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      }, 100);
    } catch (e) {
      setCamError("Camera access denied or not available: " + (e as Error).message);
    }
  }, []);

  const capturePhoto = useCallback(() => {
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width  = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext("2d")?.drawImage(videoRef.current, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setShowCam(false);
    setImgSrc(dataUrl);
    setFileType("image");
    setStep(1);
  }, []);

  const closeCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setShowCam(false);
    setCamError("");
  }, []);

  const reset = () => {
    closeCamera();
    setStep(0); setImgSrc(null); setFileType(""); setProgress(0);
    setRawText(""); setFields(null); setCaseResult(null); setMatchedCases([]); setAlreadySaved(false); setFetchError(""); setError(""); setSource(""); setCaptchaSid(""); setCaptchaAnswer(""); setCaptchaLoading(false); setCaptchaError("");
    if (fileRef.current) fileRef.current.value = "";
    if (camRef.current)  camRef.current.value  = "";
  };

  const ss = caseResult ? statusStyle((caseResult.caseStatusBadge || caseResult.status) as string | undefined) : statusStyle(fields?.status);

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div style={{fontFamily:"'DM Sans','Segoe UI',system-ui,sans-serif"}}>

      {/* Steps — only when in progress */}
      {step>0 && step<6 && (
        <div style={{display:"flex",alignItems:"center",marginBottom:16}}>
          {["Upload","Scan","Review","Lookup","Done"].map((label,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",flex:i<4?1:0}}>
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                <StepDot n={i+1} active={step===i+1} done={step>i+1}/>
                <span style={{fontSize:9,color:step>i?"#1A2E5E":"#8A94B0",fontWeight:700,letterSpacing:0.5}}>{label}</span>
              </div>
              {i<4 && <div style={{flex:1,height:2,background:step>i+1?"#1A8C5B":"#E2E6EF",margin:"0 4px",marginBottom:16,transition:"background 0.3s"}}/>}
            </div>
          ))}
        </div>
      )}

      {/* ── STEP 0: Upload ── */}
      {step===0 && (
        <div>
          <div
            onDragOver={e=>{e.preventDefault();setIsDragging(true);}}
            onDragLeave={()=>setIsDragging(false)}
            onDrop={handleDrop}
            style={{border:`1.5px dashed ${isDragging?"#1A2E5E":"#C9A84C"}`,borderRadius:10,padding:"14px 16px",background:isDragging?"rgba(26,46,94,0.04)":"rgba(201,168,76,0.03)",transition:"all 0.2s",display:"flex",alignItems:"center",gap:12,marginBottom:8}}>
            <span style={{fontSize:22,flexShrink:0}}>📂</span>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:700,color:"#1A2340"}}>Drop a court document</div>
              <div style={{fontSize:11,color:"#8A94B0"}}>PDF, JPG or PNG</div>
            </div>
            <button onClick={()=>fileRef.current?.click()} style={{flexShrink:0,padding:"7px 16px",borderRadius:20,border:"none",background:"linear-gradient(135deg,#1A2E5E,#2A4B9B)",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>
              Browse
            </button>
            <button onClick={openCamera} style={{flexShrink:0,padding:"7px 14px",borderRadius:20,border:"1px solid #E2E6EF",background:"#fff",color:"#1A2340",fontSize:12,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
              <span style={{fontSize:13}}>📸</span> Camera
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*,application/pdf,.pdf" style={{display:"none"}} onChange={handleChange}/>
          <input ref={camRef}  type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={handleChange}/>

          {/* ─────────────────────────────────────────────────────────────────
              WEBCAM MODAL — Full-screen on mobile, centred card on desktop
          ───────────────────────────────────────────────────────────────── */}
          {showCam && (
            <>
              {/* Inject keyframes + mobile overrides once */}
              <style>{`
                @keyframes camFadeIn {
                  from { opacity: 0; transform: scale(0.97); }
                  to   { opacity: 1; transform: scale(1); }
                }

                /* Full-screen on phones (≤ 640 px wide) */
                @media (max-width: 640px) {
                  .cam-modal-card {
                    width: 100% !important;
                    height: 100% !important;
                    max-width: 100% !important;
                    border-radius: 0 !important;
                    display: flex !important;
                    flex-direction: column !important;
                  }
                  .cam-video-wrap {
                    flex: 1 !important;
                    max-height: none !important;
                  }
                  .cam-video {
                    height: 100% !important;
                    max-height: none !important;
                    object-fit: cover !important;
                  }
                  .cam-btn-row {
                    /* stick to bottom, use safe-area inset for notched phones */
                    padding-bottom: calc(14px + env(safe-area-inset-bottom)) !important;
                  }
                }
              `}</style>

              <div style={{
                position: "fixed",
                inset: 0,
                zIndex: 9999,
                background: "rgba(0,0,0,0.82)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}>
                <div
                  className="cam-modal-card"
                  style={{
                    background: "#fff",
                    borderRadius: 16,
                    overflow: "hidden",
                    // Desktop: nice card. Mobile CSS above overrides to full-screen.
                    width: "min(520px, 92vw)",
                    maxWidth: "92vw",
                    boxShadow: "0 8px 48px rgba(0,0,0,0.5)",
                    animation: "camFadeIn 0.22s ease",
                  }}
                >
                  {/* Header bar */}
                  <div style={{
                    padding: "12px 16px",
                    background: "linear-gradient(135deg,#1A2E5E,#2A4B9B)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexShrink: 0,
                  }}>
                    <span style={{fontWeight:800,color:"#fff",fontSize:14}}>📸 Camera Scan</span>
                    <button
                      onClick={closeCamera}
                      style={{background:"rgba(255,255,255,0.2)",border:"none",borderRadius:20,color:"#fff",fontSize:12,fontWeight:700,padding:"5px 12px",cursor:"pointer"}}
                    >
                      ✕ Close
                    </button>
                  </div>

                  {camError ? (
                    <div style={{padding:28,textAlign:"center"}}>
                      <div style={{fontSize:32,marginBottom:12}}>🚫</div>
                      <div style={{fontSize:13,color:"#C62828",fontWeight:600,marginBottom:18,lineHeight:1.5}}>{camError}</div>
                      <button onClick={closeCamera} style={{padding:"10px 24px",borderRadius:8,border:"none",background:"#F3F4F8",color:"#4A5568",fontWeight:700,cursor:"pointer",fontSize:14}}>
                        Close
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* Video area */}
                      <div
                        className="cam-video-wrap"
                        style={{
                          position: "relative",
                          background: "#000",
                          // Desktop: sensible max-height. Mobile CSS removes this.
                          maxHeight: "58vh",
                          overflow: "hidden",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <video
                          ref={videoRef}
                          autoPlay
                          playsInline
                          muted
                          className="cam-video"
                          style={{
                            width: "100%",
                            // Desktop: cap height. Mobile CSS overrides.
                            maxHeight: "58vh",
                            display: "block",
                            objectFit: "cover",
                          }}
                        />

                        {/* Subtle document-frame guide overlay */}
                        <div style={{
                          position: "absolute",
                          inset: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          pointerEvents: "none",
                        }}>
                          <div style={{
                            width: "82%",
                            height: "72%",
                            border: "2px dashed rgba(255,255,255,0.45)",
                            borderRadius: 10,
                            boxShadow: "0 0 0 9999px rgba(0,0,0,0.28)",
                          }}/>
                        </div>

                        {/* Hint text */}
                        <div style={{
                          position: "absolute",
                          bottom: 10,
                          left: 0,
                          right: 0,
                          textAlign: "center",
                          fontSize: 11,
                          color: "rgba(255,255,255,0.75)",
                          fontWeight: 600,
                          letterSpacing: 0.3,
                          pointerEvents: "none",
                        }}>
                          Align document within the frame
                        </div>
                      </div>

                      {/* Capture / Cancel buttons */}
                      <div
                        className="cam-btn-row"
                        style={{
                          padding: "14px 16px",
                          display: "flex",
                          gap: 10,
                          background: "#111827",
                          flexShrink: 0,
                        }}
                      >
                        <button
                          onClick={capturePhoto}
                          style={{
                            flex: 1,
                            padding: "13px",
                            borderRadius: 10,
                            border: "none",
                            background: "linear-gradient(135deg,#C9A84C,#9B7B28)",
                            color: "#fff",
                            fontSize: 15,
                            fontWeight: 800,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 8,
                          }}
                        >
                          <span style={{fontSize:18}}>📷</span> Capture
                        </button>
                        <button
                          onClick={closeCamera}
                          style={{
                            padding: "13px 20px",
                            borderRadius: 10,
                            border: "none",
                            background: "rgba(255,255,255,0.1)",
                            color: "#fff",
                            fontSize: 14,
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Collapsed fields hint */}
          <details style={{marginTop:4}}>
            <summary style={{fontSize:11,color:"#8A94B0",cursor:"pointer",fontWeight:600,userSelect:"none",listStyle:"none",display:"flex",alignItems:"center",gap:4}}>
              <span style={{fontSize:10}}>▸</span> Fields extracted from document
            </summary>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"4px 8px",marginTop:8,padding:"10px 12px",borderRadius:8,background:"#F3F4F8",border:"1px solid #E2E6EF"}}>
              {[
                ["🔢","Diary / Case No."],["🏛️","Court Name & No."],["👤","Petitioner(s)"],
                ["👥","Respondent(s)"],   ["📋","Case Number"],    ["🔖","CNR Number"],
                ["⚖️","Advocates"],       ["📅","Filing Date"],    ["🧑‍⚖️","Judges"],
                ["🕐","Time of Sitting"], ["📌","Hearing Dates"],  ["⚡","Status"],
              ].map(([icon,label])=>(
                <div key={label} style={{display:"flex",gap:4,alignItems:"center",fontSize:11,color:"#4A5568"}}>
                  <span>{icon}</span><span style={{fontWeight:600}}>{label}</span>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      {/* ── STEP 1: Image preview ── */}
      {step===1 && imgSrc && (
        <div style={{background:"#fff",borderRadius:14,border:"1px solid #E2E6EF",overflow:"hidden",boxShadow:"0 2px 12px rgba(15,28,63,0.08)"}}>
          <div style={{padding:"14px 16px",borderBottom:"1px solid #E2E6EF",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <span style={{fontWeight:800,color:"#1A2340",fontSize:14}}>🖼️ Image Preview</span>
            <button onClick={reset} style={{fontSize:12,color:"#8A94B0",background:"none",border:"none",cursor:"pointer",fontWeight:600}}>✕ Change</button>
          </div>
          <img src={imgSrc} alt="preview" style={{width:"100%",maxHeight:280,objectFit:"contain",background:"#F3F4F8",padding:12}}/>
          <div style={{padding:16}}>
            <button onClick={runOCR} style={{width:"100%",padding:"13px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#1A2E5E,#2A4B9B)",color:"#fff",fontSize:15,fontWeight:800,cursor:"pointer"}}>
              🔍 Start OCR Scan
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 2: Processing ── */}
      {step===2 && (
        <div style={{background:"#fff",borderRadius:14,border:"1px solid #E2E6EF",padding:28,textAlign:"center"}}>
          <div style={{fontSize:36,marginBottom:14}}>{fileType==="pdf"?"📄":"🔬"}</div>
          <div style={{fontSize:16,fontWeight:800,color:"#1A2340",marginBottom:6}}>
            {fileType==="pdf"?"Extracting all fields from PDF...":"Scanning document with OCR..."}
          </div>
          <div style={{fontSize:13,color:"#8A94B0",marginBottom:20}}>Reading case info, parties, dates, advocates...</div>
          <div style={{background:"#F3F4F8",borderRadius:99,height:10,overflow:"hidden",marginBottom:10}}>
            <div style={{width:`${progress}%`,height:"100%",background:"linear-gradient(90deg,#1A2E5E,#C9A84C)",borderRadius:99,transition:"width 0.4s"}}/>
          </div>
          <div style={{fontSize:13,fontWeight:700,color:"#1A2E5E"}}>{progress}%</div>
        </div>
      )}

      {/* ── STEP 3: Review extracted fields ── */}
      {step===3 && fields && (
        <div style={{background:"#fff",borderRadius:14,border:"1px solid #E2E6EF",overflow:"hidden",boxShadow:"0 2px 12px rgba(15,28,63,0.08)"}}>
          <div style={{padding:"14px 16px",background:"linear-gradient(135deg,#1A2E5E,#2A4B9B)",display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:18}}>✅</span>
            <span style={{fontWeight:800,color:"#fff",fontSize:14}}>Fields Extracted Successfully</span>
            <span style={{marginLeft:"auto",fontSize:11,padding:"2px 8px",borderRadius:20,background:"rgba(255,255,255,0.2)",color:"#fff",fontWeight:700}}>
              {fileType==="pdf"?"📄 PDF":"🔬 OCR"}
            </span>
          </div>
          <div style={{padding:16}}>
            {/* Low-confidence warning when only bare number extracted */}
            {fields.caseType === "Case No" && !fields.caseTypeCode && !fields.diaryNo && !fields.cnr && (
              <div style={{padding:"10px 12px",borderRadius:8,background:"#FFF8E1",border:"1px solid #FFE082",marginBottom:12,fontSize:11,color:"#7B5800",lineHeight:1.6}}>
                <strong>⚠ Case type unknown</strong> — only a bare number ({fields.registrationNumber}/{fields.registrationYear}) was found with no case type label (SLP/WP/CA etc.). The search will try all common types but may return a wrong case. For best results, scan a document that shows the full case type.
              </div>
            )}

            <div style={{fontSize:12,fontWeight:700,color:"#8A94B0",letterSpacing:0.8,textTransform:"uppercase",marginBottom:8}}>📋 Case Information</div>
            <div style={{background:"#F9FAFB",borderRadius:10,padding:"4px 14px",marginBottom:14,border:"1px solid #E2E6EF"}}>
              <FieldRow icon="🔢" label={fields.diaryNo ? "Diary No" : (fields.caseTypeCode || fields.caseType || "Case No")} value={fields.diaryNo ? `${fields.diaryNo} / ${fields.diaryYear}` : fields.registrationNumber ? `${fields.registrationNumber} / ${fields.registrationYear}` : null}/>
              <FieldRow icon="📋" label="Case Number"   value={fields.caseNumber}/>
              <FieldRow icon="🔖" label="CNR Number"    value={fields.cnr}/>
              <FieldRow icon="👤" label="Petitioner(s)" value={fields.petitioner}/>
              <FieldRow icon="👥" label="Respondent(s)" value={fields.respondent}/>
              <FieldRow icon="🏛️" label="Court Name"    value={fields.courtName}/>
              <FieldRow icon="🏢" label="Court Number"  value={fields.courtNumber}/>
              <FieldRow icon="🕐" label="Time of Sitting" value={fields.timeOfSitting}/>
              <FieldRow icon="⚖️" label="Jurisdiction"  value={fields.jurisdiction}/>
              <FieldRow icon="📁" label="Document Type" value={fields.docType}/>
              {fields.processId && <FieldRow icon="🔑" label="Process Id" value={`${fields.processId} / ${fields.processYear}`}/>}
            </div>

            {fields.isFreshFiling && (
              <div style={{padding:"10px 14px",borderRadius:8,background:"#FFF7ED",border:"1px solid #FED7AA",color:"#C2410C",fontSize:12,fontWeight:600,marginBottom:14}}>
                ⚠ Fresh filing — Diary No. {fields.diaryNo}/{fields.diaryYear} is a very early filing. It may not yet be indexed in eCourts or the SC portal.
              </div>
            )}
            {fields.isIADiary && (
              <div style={{padding:"10px 14px",borderRadius:8,background:"#EFF6FF",border:"1px solid #BFDBFE",color:"#1D4ED8",fontSize:12,fontWeight:600,marginBottom:14}}>
                ℹ This document contains an I.A. Diary number (not the main case diary). Use Dashboard → Search to look up the main case.
              </div>
            )}

            <div style={{fontSize:12,fontWeight:700,color:"#8A94B0",letterSpacing:0.8,textTransform:"uppercase",marginBottom:8}}>📅 Listing Details</div>
            <div style={{background:"#F9FAFB",borderRadius:10,padding:"4px 14px",marginBottom:14,border:"1px solid #E2E6EF"}}>
              <FieldRow icon="📅" label="Date of Filing" value={fields.dateOfFiling}/>
              <FieldRow icon="🧑‍⚖️" label="Judges"       value={fields.judges}/>
              <FieldRow icon="⚖️" label="Advocates"     value={fields.advocates}/>
              <FieldRow icon="📌" label="Dates Found"   value={fields.allDates?.slice(0,4)}/>
              {fields.status && (
                <div style={{display:"flex",gap:10,alignItems:"center",padding:"7px 0"}}>
                  <span style={{fontSize:14}}>⚡</span>
                  <div>
                    <div style={{fontSize:10,fontWeight:700,color:"#8A94B0",letterSpacing:0.8,textTransform:"uppercase",marginBottom:2}}>Status</div>
                    <span style={{fontSize:12,fontWeight:800,padding:"3px 10px",borderRadius:20,background:statusStyle(fields.status).bg,color:statusStyle(fields.status).color,border:`1px solid ${statusStyle(fields.status).border}`}}>
                      {fields.status.toUpperCase()}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <details style={{marginBottom:16}}>
              <summary style={{fontSize:12,color:"#8A94B0",cursor:"pointer",fontWeight:600,userSelect:"none"}}>📝 View raw extracted text</summary>
              <div style={{marginTop:8,padding:12,borderRadius:8,background:"#F3F4F8",fontSize:11,color:"#4A5568",fontFamily:"monospace",maxHeight:100,overflowY:"auto",whiteSpace:"pre-wrap",lineHeight:1.7}}>
                {rawText.slice(0,800)}{rawText.length>800?"...":""}
              </div>
            </details>

            <div style={{display:"flex",gap:10}}>
              <button onClick={reset} style={{flex:1,padding:"11px",borderRadius:10,border:"1px solid #E2E6EF",background:"#F3F4F8",color:"#4A5568",fontSize:14,fontWeight:700,cursor:"pointer"}}>✕ Cancel</button>
              <button onClick={lookupCase} style={{flex:2,padding:"11px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#C9A84C,#9B7B28)",color:"#fff",fontSize:14,fontWeight:800,cursor:"pointer",boxShadow:"0 4px 14px rgba(201,168,76,0.35)"}}>
                ⚖️ Find This Case
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 4: Lookup ── */}
      {step===4 && (
        <div style={{background:"#fff",borderRadius:14,border:"1px solid #E2E6EF",padding:28,textAlign:"center"}}>
          <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
          <div style={{width:48,height:48,borderRadius:"50%",background:"linear-gradient(135deg,#1A2E5E,#2A4B9B)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,margin:"0 auto 16px",animation:"spin 1.2s linear infinite"}}>⚖️</div>
          <div style={{fontSize:16,fontWeight:800,color:"#1A2340",marginBottom:6}}>Looking up case...</div>
          <div style={{fontSize:13,color:"#8A94B0",marginBottom:6}}>Matching against your dashboard and SC API</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,justifyContent:"center",marginTop:12}}>
            {fields?.diaryNo   && <span style={{fontSize:11,padding:"3px 10px",borderRadius:20,background:"#E8F1FB",color:"#2A7BD4",fontWeight:700}}>Diary {fields.diaryNo}/{fields.diaryYear}</span>}
            {!fields?.diaryNo && fields?.registrationNumber && <span style={{fontSize:11,padding:"3px 10px",borderRadius:20,background:"#E8F1FB",color:"#2A7BD4",fontWeight:700}}>{fields.caseType} {fields.registrationNumber}/{fields.registrationYear}</span>}
            {fields?.cnr        && <span style={{fontSize:11,padding:"3px 10px",borderRadius:20,background:"#E8F1FB",color:"#2A7BD4",fontWeight:700}}>{fields.cnr}</span>}
            {fields?.petitioner && <span style={{fontSize:11,padding:"3px 10px",borderRadius:20,background:"#E8F1FB",color:"#2A7BD4",fontWeight:700}}>{fields.petitioner.slice(0,20)}</span>}
          </div>
        </div>
      )}

      {/* ── STEP 5: Result ── */}
      {step===5 && (
        <div style={{background:"#fff",borderRadius:14,border:"1px solid #E2E6EF",overflow:"hidden",boxShadow:"0 2px 12px rgba(15,28,63,0.08)"}}>
          <div style={{padding:"14px 18px",background:source==="extracted"?"linear-gradient(135deg,#C9A84C,#9B7B28)":matchedCases.length>1?"linear-gradient(135deg,#2A4B9B,#1A2E5E)":"linear-gradient(135deg,#1A8C5B,#2ECC8A)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:18}}>{source==="extracted"?"📋":matchedCases.length>1?"🔍":"✅"}</span>
              <span style={{fontWeight:800,color:"#fff",fontSize:14}}>
                {matchedCases.length>1?`${matchedCases.length} Matching Cases Found`:source==="local"?"Case Found in Dashboard":source==="api"?"Case Found via SC API":"Fields Extracted — No Match Found"}
              </span>
            </div>
            <span style={{fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:20,background:"rgba(255,255,255,0.25)",color:"#fff"}}>
              {source==="local"?"📱 Local":source==="api"?"🌐 SC API":"📋 From Scan"}
            </span>
          </div>

          <div style={{padding:18}}>
            {matchedCases.length===0 && source==="extracted" && (
              <div style={{padding:"12px 14px",borderRadius:10,background:"#FFF8E1",border:"1px solid #FFE082",marginBottom:14}}>
                <div style={{fontSize:12,fontWeight:800,color:"#7B5800",marginBottom:4}}>Case not found</div>
                <div style={{fontSize:12,color:"#5D4200",lineHeight:1.6}}>
                  {fetchError || `${fields?.caseNumber || (fields?.registrationNumber ? `${fields.caseType || 'Case'} No. ${fields.registrationNumber}/${fields.registrationYear}` : fields?.diaryNo ? `Diary ${fields.diaryNo}/${fields.diaryYear}` : 'This case')} could not be fetched from the SC website.`}
                </div>
                <div style={{fontSize:11,color:"#7B5800",marginTop:6}}>
                  Try scanning a document that includes the diary number or CNR.
                </div>
              </div>
            )}

            {/* ── IA-only warning ── */}
            {fields?.isIAOnly && (
              <div style={{padding:"12px 14px",borderRadius:10,background:"#FFF3E0",border:"1px solid #FFB74D",marginBottom:14}}>
                <div style={{fontSize:12,fontWeight:800,color:"#7C4400",marginBottom:4}}>⚠ Interlocutory Application — cannot look up directly</div>
                <div style={{fontSize:11,color:"#5D3200",lineHeight:1.6}}>
                  Only an IA number ({fields.registrationNumber}/{fields.registrationYear}) was found. The SC website does not support lookup by IA number.<br/>
                  Scan the <strong>main SLP / WP / Civil Appeal order or office report</strong> to get the diary number.
                </div>
              </div>
            )}

            {/* ── High Court warning ── */}
            {fields?.isHighCourt && (
              <div style={{padding:"12px 14px",borderRadius:10,background:"#F3E5F5",border:"1px solid #CE93D8",marginBottom:14}}>
                <div style={{fontSize:12,fontWeight:800,color:"#4A148C",marginBottom:4}}>ℹ High Court case detected</div>
                <div style={{fontSize:11,color:"#38006B",lineHeight:1.6}}>
                  {fields.caseType} {fields.registrationNumber}/{fields.registrationYear} appears to be a High Court case. SC lookup is not applicable.<br/>
                  If this case has an SLP or appeal pending in the Supreme Court, scan that SC document instead.
                </div>
              </div>
            )}

            {/* ── SC Captcha Lookup ── */}
            {!caseResult && !fields?.isIAOnly && !fields?.isHighCourt && fields?.registrationNumber && fields?.registrationYear && (
              <div style={{background:"#EEF4FF",borderRadius:10,border:"1px solid #C7D9F8",padding:"12px 14px",marginBottom:14}}>
                <div style={{fontSize:12,fontWeight:800,color:"#1A4FA3",marginBottom:6}}>
                  🔐 Look up by Case Number
                </div>
                <div style={{fontSize:11,color:"#2A5CB8",marginBottom:10,lineHeight:1.5}}>
                  SC website requires a captcha to find the diary number for{" "}
                  <strong>{fields.caseTypeCode || fields.caseType || "Case"} No. {fields.registrationNumber}/{fields.registrationYear}</strong>.
                  Solve the math in the image and enter the answer.
                </div>
                {!captchaSid && !captchaLoading && (
                  <button
                    onClick={loadCaptcha}
                    style={{fontSize:12,padding:"6px 14px",borderRadius:8,background:"#2A7BD4",color:"#fff",border:"none",cursor:"pointer",fontWeight:700}}
                  >
                    Load Captcha
                  </button>
                )}
                {captchaLoading && <div style={{fontSize:12,color:"#2A7BD4"}}>Loading...</div>}
                {captchaSid && !captchaLoading && (
                  <div>
                    <img
                      src={`${(import.meta as any).env?.VITE_BACKEND_URL || ''}/sc-captcha-img?sid=${captchaSid}`}
                      alt="SC website captcha"
                      style={{display:"block",marginBottom:8,border:"1px solid #C7D9F8",borderRadius:6,maxHeight:60}}
                    />
                    <div style={{display:"flex",gap:8,alignItems:"center"}}>
                      <input
                        type="text"
                        value={captchaAnswer}
                        onChange={e => setCaptchaAnswer(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleCaptchaSubmit()}
                        placeholder="Answer"
                        maxLength={5}
                        style={{width:70,padding:"6px 10px",borderRadius:8,border:"1.5px solid #C7D9F8",fontSize:14,fontWeight:700,textAlign:"center"}}
                      />
                      <button
                        onClick={handleCaptchaSubmit}
                        disabled={!captchaAnswer || captchaLoading}
                        style={{fontSize:12,padding:"6px 14px",borderRadius:8,background:captchaAnswer?"#2A7BD4":"#ccc",color:"#fff",border:"none",cursor:captchaAnswer?"pointer":"default",fontWeight:700}}
                      >
                        Submit
                      </button>
                      <button
                        onClick={loadCaptcha}
                        style={{fontSize:11,padding:"5px 10px",borderRadius:8,background:"#F0F4FA",color:"#2A7BD4",border:"1px solid #C7D9F8",cursor:"pointer"}}
                      >
                        Refresh
                      </button>
                    </div>
                  </div>
                )}
                {captchaError && (
                  <div style={{fontSize:11,color:"#C0392B",marginTop:6,fontWeight:600}}>{captchaError}</div>
                )}
              </div>
            )}

            {/* ── What was detected ── */}
            {fields && (fields.diaryNo || fields.cnr || fields.caseNumber || fields.registrationNumber) && (
              <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:14}}>
                <span style={{fontSize:11,fontWeight:700,color:"#8A94B0",letterSpacing:0.5,alignSelf:"center"}}>DETECTED:</span>
                {fields.diaryNo && fields.diaryYear && <span style={{fontSize:11,padding:"3px 10px",borderRadius:20,background:"#E8F1FB",color:"#2A7BD4",fontWeight:700}}>📋 Diary {fields.diaryNo}/{fields.diaryYear}</span>}
                {fields.cnr && <span style={{fontSize:11,padding:"3px 10px",borderRadius:20,background:"#E8F1FB",color:"#2A7BD4",fontWeight:700}}>🔖 CNR: {fields.cnr}</span>}
                {fields.caseNumber && <span style={{fontSize:11,padding:"3px 10px",borderRadius:20,background:"#E8F1FB",color:"#2A7BD4",fontWeight:700}}>⚖️ {fields.caseNumber}</span>}
              </div>
            )}

            {/* ── Multiple matches: show list ── */}
            {matchedCases.length > 1 && (
              <div style={{marginBottom:14}}>
                <div style={{fontSize:12,fontWeight:700,color:"#8A94B0",letterSpacing:0.8,textTransform:"uppercase",marginBottom:8}}>
                  Select a case to open in dashboard
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {matchedCases.map((mc, i) => {
                    const mcr = mc as any;
                    const s = statusStyle(mcr.status || mcr.caseStatusBadge);
                    return (
                      <div key={i} style={{padding:"12px 14px",borderRadius:10,border:"1px solid #E2E6EF",background:"#F9FAFB",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:13,fontWeight:700,color:"#1A2340",marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                            {mcr.caseNumber || `Diary ${mcr.diaryNumber || mcr.diaryNo}/${mcr.diaryYear}`}
                          </div>
                          <div style={{fontSize:12,color:"#8A94B0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                            {mcr.petitioner || (Array.isArray(mcr.petitioners) ? mcr.petitioners[0] : '')} {mcr.respondent ? `vs ${mcr.respondent}` : ''}
                          </div>
                          {mcr.cnrNumber && <div style={{fontSize:10,color:"#8A94B0",marginTop:2}}>CNR: {mcr.cnrNumber}</div>}
                        </div>
                        <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0}}>
                          <span style={{fontSize:11,fontWeight:700,padding:"3px 8px",borderRadius:12,background:s.bg,color:s.color,border:`1px solid ${s.border}`}}>{(mcr.status||"").toUpperCase()}</span>
                          <button onClick={()=>{setCaseResult(mc as unknown as CaseResult);if(onCaseFound)onCaseFound(mc);}} style={{padding:"6px 14px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#1A2E5E,#2A4B9B)",color:"#fff",fontSize:12,fontWeight:800,cursor:"pointer"}}>
                            Open →
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Single match: show case detail ── */}
            {caseResult && matchedCases.length <= 1 && (() => {
              const cr = caseResult as CaseResult;
              return (
              <>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                  <div style={{fontSize:13,color:"#8A94B0",fontWeight:600}}>
                    {(cr as any).caseNumber || (fields?.diaryNo ? `Diary ${fields.diaryNo}/${fields.diaryYear}` : '')}
                  </div>
                  <span style={{fontSize:12,fontWeight:800,padding:"4px 12px",borderRadius:20,background:ss.bg,color:ss.color,border:`1px solid ${ss.border}`}}>
                    {(cr.caseStatusBadge||cr.status||"ACTIVE").toUpperCase()}
                  </span>
                </div>
                <div style={{padding:"12px 14px",borderRadius:10,background:"#F3F4F8",marginBottom:12,border:"1px solid #E2E6EF"}}>
                  <div style={{fontSize:11,fontWeight:700,color:"#8A94B0",letterSpacing:0.8,textTransform:"uppercase",marginBottom:4}}>Parties</div>
                  <div style={{fontSize:14,fontWeight:700,color:"#1A2340",lineHeight:1.5}}>{formatCaseTitle(cr)}</div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
                  {([["Case No",(cr as any).caseNumber],["CNR",cr.cnr],["Filed",cr.filed],["Last Listed",cr.lastListedOn]] as [string, string | undefined][]).filter(f=>f[1]).map(([l,v])=>(
                    <div key={l} style={{padding:"8px 12px",borderRadius:8,background:"#F3F4F8",border:"1px solid #E2E6EF"}}>
                      <div style={{fontSize:10,fontWeight:700,color:"#8A94B0",letterSpacing:0.8,textTransform:"uppercase",marginBottom:2}}>{l}</div>
                      <div style={{fontSize:12,fontWeight:600,color:"#1A2340"}}>{v}</div>
                    </div>
                  ))}
                </div>
              </>
              );
            })()}

            {fields && matchedCases.length <= 1 && (
              <div style={{marginBottom:12}}>
                <div style={{fontSize:12,fontWeight:700,color:"#8A94B0",letterSpacing:0.8,textTransform:"uppercase",marginBottom:8}}>
                  {caseResult?"📋 Additional Extracted Fields":"📋 Extracted from Document"}
                </div>
                <div style={{background:"#F9FAFB",borderRadius:10,padding:"4px 14px",border:"1px solid #E2E6EF"}}>
                  <FieldRow icon="🔢" label={fields.caseType||"Case No"} value={fields.diaryNo ? `Diary ${fields.diaryNo} / ${fields.diaryYear}` : fields.registrationNumber ? `${fields.registrationNumber} / ${fields.registrationYear}` : null}/>
                  <FieldRow icon="📋" label="Case Number"   value={fields.caseNumber}/>
                  <FieldRow icon="🔖" label="CNR"           value={fields.cnr}/>
                  <FieldRow icon="👤" label="Petitioner"    value={fields.petitioner}/>
                  <FieldRow icon="👥" label="Respondent"    value={fields.respondent}/>
                  <FieldRow icon="🏛️" label="Court"         value={fields.courtName}/>
                  <FieldRow icon="🧑‍⚖️" label="Judges"       value={fields.judges}/>
                  <FieldRow icon="⚖️" label="Advocates"     value={fields.advocates}/>
                  <FieldRow icon="📅" label="Filing Date"   value={fields.dateOfFiling}/>
                  <FieldRow icon="📁" label="Document"      value={fields.docType}/>
                  {fields.processId && <FieldRow icon="🔑" label="Process Id" value={`${fields.processId} / ${fields.processYear}`}/>}
                </div>
              </div>
            )}


            <div style={{display:"flex",gap:10,marginTop:12}}>
              <button onClick={reset} style={{flex:1,padding:"11px",borderRadius:10,border:"1px solid #E2E6EF",background:"#F3F4F8",color:"#4A5568",fontSize:13,fontWeight:700,cursor:"pointer"}}>📄 Scan Another</button>
              {caseResult && matchedCases.length <= 1 && (
                <button onClick={()=>{if(onCaseFound)onCaseFound(caseResult);}} style={{flex:2,padding:"11px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#1A2E5E,#2A4B9B)",color:"#fff",fontSize:13,fontWeight:800,cursor:"pointer"}}>
                  {alreadySaved ? "⚖️ Open in Dashboard" : "➕ Add to Dashboard"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 6: Error ── */}
      {step===6 && (
        <div style={{background:"#FEF2F2",borderRadius:14,border:"1px solid #FECACA",padding:22}}>
          <div style={{display:"flex",gap:14,alignItems:"flex-start",marginBottom:16}}>
            <span style={{fontSize:26}}>⚠️</span>
            <div>
              <div style={{fontSize:15,fontWeight:800,color:"#C62828",marginBottom:4}}>Extraction Failed</div>
              <div style={{fontSize:13,color:"#7F1D1D",lineHeight:1.6}}>{error}</div>
            </div>
          </div>
          <ul style={{margin:"0 0 16px",paddingLeft:18,fontSize:12,color:"#7F1D1D",lineHeight:2.2}}>
            <li>For PDFs — works with Supreme Court text-based PDFs (not scanned images)</li>
            <li>For scanned PDFs — take a screenshot → upload as PNG/JPG</li>
            <li>For photos — ensure good lighting and flat document</li>
          </ul>
          <button onClick={reset} style={{width:"100%",padding:"12px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#C62828,#EF5350)",color:"#fff",fontSize:14,fontWeight:800,cursor:"pointer"}}>
            🔄 Try Again
          </button>
        </div>
      )}
    </div>
  );
}