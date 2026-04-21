/**
 * Lex Tigress – Missing Document Detection Service (Feature 2)
 *
 * Core intelligence layer for detecting missing/incorrect/incomplete documents,
 * building WhatsApp messages, auto-creating tasks, matching uploads to
 * requirements, managing follow-up reminders, and feeding the learning system.
 */

import type {
    DocumentRequirement,
    DocFilingMode,
    DocFollowUp,
    DocStatus,
    UploadedDocumentMeta,
    DocUploadSource,
} from '../types';
import {
    loadDocReqs,
    saveDocReqs,
    updateDocReq,
    loadUploadedDocs,
    addUploadedDoc,
} from './localStorageService';
import { useSettingsStore } from '../store/settingsStore';
import { optimizePromptText } from '../utils/textOptimizer';

// ─── AI PROXY (reuses existing pipeline) ─────────────────────────────────────

async function callAiProxy(prompt: string): Promise<string> {
    const supabaseUrl: string = (import.meta as any).env?.VITE_SUPABASE_URL || '';
    const supabaseAnon: string = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';

    if (supabaseUrl) {
        const { supabase } = await import('../lib/supabaseClient');
        const { data: { session } } = await supabase.auth.getSession();
        try {
            const response = await fetch(`${supabaseUrl}/functions/v1/ai-proxy`, {
                method: 'POST',
                headers: {
                    'Content-Type':  'application/json',
                    'Authorization': `Bearer ${session?.access_token}`,
                    'apikey':         supabaseAnon,
                },
                body: JSON.stringify({ provider: 'claude', prompt, temperature: 0.1 }),
            });
            if (response.ok) {
                const data = await response.json();
                const text = data.content?.[0]?.text || '';
                if (text.trim().length > 20) return text;
            }
        } catch { /* fall through */ }

        // Claude retry fallback via same proxy
        try {
            const response = await fetch(`${supabaseUrl}/functions/v1/ai-proxy`, {
                method: 'POST',
                headers: {
                    'Content-Type':  'application/json',
                    'Authorization': `Bearer ${session?.access_token}`,
                    'apikey':         supabaseAnon,
                },
                body: JSON.stringify({ provider: 'claude', prompt, temperature: 0.1 }),
            });
            if (response.ok) {
                const data = await response.json();
                const text = data.content?.[0]?.text || '';
                if (text.trim().length > 20) return text;
            }
        } catch { /* fall through */ }
    }

    // Direct Claude fallback (local dev)
    const claudeKey = (import.meta as any).env?.VITE_ANTHROPIC_API_KEY || (import.meta as any).env?.ANTHROPIC_API_KEY;
    if (claudeKey) {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key':         claudeKey,
                'anthropic-version': '2023-06-01',
                'Content-Type':      'application/json',
            },
            body: JSON.stringify({
                model:       'claude-sonnet-4-6',
                max_tokens:  2000,
                temperature: 0.1,
                messages:    [{ role: 'user', content: prompt }],
            }),
        });
        if (res.ok) {
            const data = await res.json();
            return data.content?.[0]?.text || '';
        }
    }

    throw new Error('No AI provider available — check API keys in Settings.');
}

// ─── JSON RESPONSE PARSER ─────────────────────────────────────────────────────

function parseJsonArray(text: string): any[] {
    try {
        let raw = text.trim()
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();
        const start = raw.indexOf('[');
        const end   = raw.lastIndexOf(']');
        if (start === -1 || end === -1 || end <= start) return [];
        const arr = JSON.parse(raw.slice(start, end + 1));
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
}

// ─── SC FILING RULES PER CASE TYPE ──────────────────────────────────────────

const SC_DOC_RULES: Record<string, string> = {
    'SLP(C)': `Required documents for SLP (Civil):
1. Petition for Special Leave to Appeal (typed and printed)
2. Certified copy of the impugned High Court judgment/order
3. Typed copy of the impugned judgment
4. Affidavit in support of condonation of delay (if filed beyond 90 days of HC order)
5. Vakalatnama signed by petitioner in favour of AOR
6. Court fees (on petition and vakalatnama)
7. Index of documents with page numbers
8. Verification in Form 28 (if SLP relates to appellate jurisdiction)
9. Annexures — all documents referred to in the petition (certified/attested copies)
10. Memo of parties (with complete addresses)
11. Synopsis and list of dates`,

    'SLP(CRL)': `Required documents for SLP (Criminal):
1. Petition for Special Leave to Appeal (Criminal) — typed and printed
2. Certified copy of impugned HC judgment/order
3. Typed copy of impugned order
4. Affidavit in support of condonation of delay (if applicable)
5. Vakalatnama
6. Court fees
7. Index of documents
8. Copy of FIR (if applicable)
9. Copy of chargesheet (if applicable)
10. Copies of trial court and HC orders below
11. Bail application status (if bail sought)
12. Memo of parties`,

    'CA': `Required documents for Civil Appeal:
1. Memorandum of Civil Appeal
2. Certified copy of impugned HC decree/order
3. Typed copy of impugned decree
4. Affidavit in support of condonation (if filed beyond limitation)
5. Vakalatnama
6. Court fees (based on subject matter valuation)
7. Index with page numbers
8. Documents supporting grounds of appeal
9. Memo of parties`,

    'WP(C)': `Required documents for Writ Petition (Civil):
1. Writ Petition — typed and printed (with synopsis and list of dates)
2. Affidavit verifying the petition
3. Vakalatnama
4. Court fees
5. Index with page numbers
6. All documents/annexures referred to in petition (certified/attested)
7. Any prior HC order if writ earlier filed in HC
8. Memo of parties`,

    'WP(CRL)': `Required documents for Writ Petition (Criminal):
1. Writ Petition (Criminal) — typed and printed
2. Affidavit verifying the petition
3. Vakalatnama
4. Court fees
5. Copy of detention order/FIR/chargesheet (whichever applicable)
6. Index with page numbers
7. Memo of parties`,

    'DEFAULT': `Required documents for Supreme Court filing (general):
1. Main petition/appeal (typed and printed)
2. Vakalatnama signed by party in favour of AOR
3. Certified copy of impugned order
4. Court fees
5. Index of documents with page numbers
6. Affidavit in support (if applicable)
7. Memo of parties with complete addresses
8. All annexures referred to in the petition`,
};

function getDocRules(caseType: string): string {
    const normalized = (caseType || '').toUpperCase().replace(/\s+/g, '');
    if (normalized.includes('SLP') && normalized.includes('CRL')) return SC_DOC_RULES['SLP(CRL)'];
    if (normalized.includes('SLP'))  return SC_DOC_RULES['SLP(C)'];
    if (normalized.includes('CA'))   return SC_DOC_RULES['CA'];
    if (normalized.includes('WP') && normalized.includes('CRL')) return SC_DOC_RULES['WP(CRL)'];
    if (normalized.includes('WP'))   return SC_DOC_RULES['WP(C)'];
    return SC_DOC_RULES['DEFAULT'];
}

// ─── LANGUAGE MAP ─────────────────────────────────────────────────────────────

const LANGUAGE_NAMES: Record<string, string> = {
    auto: 'auto-detect',
    en:   'English',
    hi:   'Hindi (हिन्दी)',
    mr:   'Marathi (मराठी)',
    ta:   'Tamil (தமிழ்)',
    te:   'Telugu (తెలుగు)',
    kn:   'Kannada (ಕನ್ನಡ)',
    ml:   'Malayalam (മലയാളം)',
    gu:   'Gujarati (ગુજરાતી)',
    bn:   'Bengali (বাংলা)',
    pa:   'Punjabi (ਪੰਜਾਬੀ)',
    ur:   'Urdu (اردو)',
};

// ─── PROMPT BUILDER ──────────────────────────────────────────────────────────

function buildDocExpectationPrompt(
    caseObj: any,
    uploadedText: string,
    mode: DocFilingMode,
    existingDocNames: string[],
    topDefects: { caseType: string; documentName: string; frequency: number }[],
    language: string = 'auto'
): string {
    const caseType    = caseObj.caseType || caseObj.caseTitle || '';
    const caseNo      = caseObj.caseNumber || `Diary No. ${caseObj.diaryNumber}/${caseObj.diaryYear}` || '';
    const petitioner  = caseObj.petitioner || '';
    const respondent  = caseObj.respondent || '';
    const nextHearing = caseObj.nextHearingDate || caseObj.nextListingDate || 'Not scheduled';

    const defectSection = topDefects.length > 0
        ? `PAST DEFECT PATTERNS (learning system — be extra vigilant about these):\n${topDefects.map((d, i) => `${i + 1}. "${d.documentName}" — seen ${d.frequency} time(s) for ${d.caseType} cases`).join('\n')}`
        : 'PAST DEFECT PATTERNS: None recorded yet.';

    const existingSection = existingDocNames.length > 0
        ? `DOCUMENTS ALREADY UPLOADED / AVAILABLE:\n${existingDocNames.map((n, i) => `${i + 1}. ${n}`).join('\n')}`
        : 'DOCUMENTS ALREADY UPLOADED: None.';

    const modeInstructions = mode === 'Before Filing'
        ? `MODE: Before Filing
Focus: Compare the client-provided documents listed above against what is REQUIRED for filing.
Identify what the client still needs to provide before the case can be filed.`
        : `MODE: After Filing
Focus: Analyse the office report / paper book / court orders text below.
Identify defects raised by the registry, missing compliance, and filing gaps.
- Registry defect "missing pages" / "illegible" / "page number missing" / "unsigned" = Incomplete.
- Registry defect "wrong format" / "not an order" / "not certified" / "dim copy" / "typed copy needed" = Incorrect.
- If a document is mentioned as required but completely missing from the paper book = Missing.
- Look for keywords like "Defect", "Objection", "Office Report dated", "Compliance".
Each registry defect = one DocumentRequirement with source "Defect" and priority "Critical".`;

    const langNote = language === 'auto'
        ? 'The document text may be in English, Hindi, or any other Indian regional language. Auto-detect the language and process accordingly.'
        : `The document text is in ${LANGUAGE_NAMES[language] || language}. Read and interpret the text in that language — including Devanagari, Tamil, Telugu, Malayalam, Kannada, Gujarati, Bengali, Punjabi, or Urdu scripts as applicable. Extract all document names and defect references regardless of script.`;

    return `You are a Supreme Court of India document compliance expert for a law firm.
You must identify ONLY genuinely missing, incorrect, or incomplete documents.
Do NOT flag documents that are already in the "DOCUMENTS ALREADY UPLOADED" list.

MULTILINGUAL INSTRUCTION: ${langNote}
Your JSON output must always be in English (document names, reasons) even if the input text is in Hindi or another language.

CASE TYPE: ${caseType || 'Unknown — use best judgement'}
CASE NO: ${caseNo}
PETITIONER: ${petitioner || 'Not specified'}
RESPONDENT: ${respondent || 'Not specified'}
NEXT HEARING: ${nextHearing}

${modeInstructions}

SC FILING REQUIREMENTS FOR THIS CASE TYPE:
${getDocRules(caseType)}

${defectSection}

${existingSection}

DOCUMENT TEXT TO ANALYSE (Office Report / Paper Book / Order):
${uploadedText.trim() || '(No document text provided — generate requirements based on case type rules only)'}

INSTRUCTIONS:
1. Compare required documents against already available documents.
2. For "After Filing" mode: also extract every defect/objection mentioned in the document text. 
   - Status MUST be "Incorrect" if it's there but wrong (not certified, wrong version).
   - Status MUST be "Incomplete" if it's there but partial (missing pages, unsigned).
   - Status MUST be "Missing" if it's not there at all.
3. Assign priority: Critical = filing blocker or registry defect, Important = strengthens case, Optional = supporting.
4. Set requestedFrom: Client = if party must provide it, Associate = if the legal team must prepare/file it.
5. Set deadline based on next hearing date and priority:
   - Critical: today (YYYY-MM-DD of today)
   - Important: 3 days before next hearing (or 5 days from today if no hearing)
   - Optional: 7 days from today
6. Keep documentName concise and specific (e.g. "Certified copy of HC order" not just "HC order").

Return ONLY a raw JSON array. Each item MUST have EXACTLY these fields:
{
  "documentName": "string",
  "status": "Missing" | "Incorrect" | "Incomplete",
  "priority": "Critical" | "Important" | "Optional",
  "source": "Rule" | "Defect" | "AI",
  "requestedFrom": "Client" | "Associate",
  "deadline": "YYYY-MM-DD",
  "whyImportant": "1-2 sentences on why it matters (SC rule / hearing link / specific registry objection memo)",
  "riskIfMissing": "1-2 sentences on what happens if NOT filed (Registry rejection / Dismissal risk / Case cannot be listed)",
  "filingStage": "specific stage (e.g. 'Fresh Matter', 'After Notice', 'Before Admission')"
}`;
}

// ─── WHATSAPP MESSAGE BUILDERS ────────────────────────────────────────────────

export function buildClientWhatsAppMessage(
    docReq: DocumentRequirement,
    caseObj: any
): string {
    const caseRef  = caseObj.caseNumber || `Diary No. ${caseObj.diaryNumber}/${caseObj.diaryYear}`;
    const parties  = (caseObj.displayTitle || caseObj.parties || '').slice(0, 60);
    const deadline = docReq.deadline
        ? new Date(docReq.deadline).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
        : 'as soon as possible';
    const urgencyLabel =
        docReq.priority === 'Critical'  ? '🚨 URGENT — filing cannot proceed without this' :
        docReq.priority === 'Important' ? '⚠️ Required to strengthen your case' :
                                          '📎 Helpful supporting document';

    return `Dear Client,

We need the following document for your case:

📋 *Case:* ${caseRef}
${parties ? `👥 *Parties:* ${parties}\n` : ''}
📄 *Document needed:* ${docReq.documentName}
📅 *Please share by:* ${deadline}
${urgencyLabel}

${docReq.whyImportant ? `*Why it's needed:* ${docReq.whyImportant}\n` : ''}
Please share this document via WhatsApp or email at the earliest convenience.

If you have any questions, please call our office.

— Lex Tigress | Legal Team`;
}

export function buildAssociateWhatsAppMessage(
    docReq: DocumentRequirement,
    caseObj: any
): string {
    const caseRef  = caseObj.caseNumber || `Diary No. ${caseObj.diaryNumber}/${caseObj.diaryYear}`;
    const deadline = docReq.deadline
        ? new Date(docReq.deadline).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
        : 'ASAP';
    const priorityBadge =
        docReq.priority === 'Critical'  ? '🚨 CRITICAL' :
        docReq.priority === 'Important' ? '⚠️ IMPORTANT' : '📎 OPTIONAL';

    return `${priorityBadge} — Action Required

*Case:* ${caseRef}
*Filing Stage:* ${docReq.filingStage || docReq.filingMode}
*Source:* ${docReq.source}

❌ *Document Missing:* ${docReq.documentName}
*Status:* ${docReq.status}
*Deadline:* ${deadline}

*Why Important:* ${docReq.whyImportant || '(See case file)'}
*Risk if Not Filed:* ${docReq.riskIfMissing || '(See case file)'}

*Action:*
→ Request from: ${docReq.requestedFrom}
→ Follow up within: ${docReq.priority === 'Critical' ? '24 hours' : docReq.priority === 'Important' ? '48 hours' : '7 days'}

— Lex Tigress | Task Auto-Generated`;
}

// ─── TASK AUTO-CREATION ──────────────────────────────────────────────────────

function computeDeadlineDateStr(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
}

export function autoCreateTaskFromDocReq(
    docReq: DocumentRequirement,
    caseObj: any
): any {
    const deadlineDays =
        docReq.priority === 'Critical'  ? 0 :
        docReq.priority === 'Important' ? 3 : 7;

    const assignee =
        docReq.requestedFrom === 'Client' ? 'Paralegal / Clerk' : 'Associate Advocate';

    const urgency =
        docReq.priority === 'Critical'  ? 'Critical' :
        docReq.priority === 'Important' ? 'High'     : 'Medium';

    const caseRef = caseObj.caseNumber || `D.No.${caseObj.diaryNumber}/${caseObj.diaryYear}`;

    return {
        id:         `docreq_task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        text:       `Obtain "${docReq.documentName}" — ${caseRef}`,
        party:      'Petitioner',  // document tasks are petitioner-side by default
        partyPerson: '',
        assignee,
        assignedPerson: '',
        urgency,
        deadline:   docReq.deadline || computeDeadlineDateStr(deadlineDays),
        done:       false,
        isAuto:     true,
        assignmentType: 'doc_req' as const,
        linkedDocReqId: docReq.id,      // link back to the requirement
        reason:     `Missing document detected: ${docReq.documentName}`,
    };
}

// ─── FOLLOW-UP SCHEDULER ──────────────────────────────────────────────────────

export function scheduleFollowUp(priority: DocumentRequirement['priority']): DocFollowUp {
    const now = new Date();
    const hours = priority === 'Critical' ? 24 : priority === 'Important' ? 48 : 168; // 7 days
    const scheduledAt = new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
    return {
        id:          `fu_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        scheduledAt,
        escalated: false,
    };
}

export function getOverdueFollowUps(
    reqs: DocumentRequirement[]
): Array<{ req: DocumentRequirement; followUp: DocFollowUp }> {
    const now = new Date().toISOString();
    const results: Array<{ req: DocumentRequirement; followUp: DocFollowUp }> = [];
    for (const req of reqs) {
        if (req.status === 'Complete' || req.status === 'Received') continue;
        for (const fu of (req.followUps || [])) {
            if (!fu.sentAt && fu.scheduledAt < now) {
                results.push({ req, followUp: fu });
            }
        }
    }
    return results;
}

export function markFollowUpSent(
    caseId: string,
    reqId: string,
    followUpId: string
): void {
    const reqs = loadDocReqs(caseId);
    const now  = new Date().toISOString();
    const updated = reqs.map((r) => {
        if (r.id !== reqId) return r;
        const updatedFUs = r.followUps.map((fu) =>
            fu.id === followUpId ? { ...fu, sentAt: now } : fu
        );
        // Schedule another follow-up (escalation logic)
        const freshFU = scheduleFollowUp(r.priority);
        freshFU.escalated = true;
        freshFU.escalatedAt = now;
        return { ...r, followUps: [...updatedFUs, freshFU] };
    });
    saveDocReqs(caseId, updated);
}

// ─── UPLOAD ↔ REQUIREMENT MATCHER ───────────────────────────────────────────

function normaliseDocName(name: string): string[] {
    const stopWords = new Set(['of', 'the', 'in', 'and', 'or', 'to', 'a', 'an', 'for', 'by', 'copy', 'certified']);
    return name
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !stopWords.has(w));
}

export function matchUploadToRequirement(
    uploadedDoc: UploadedDocumentMeta,
    existingReqs: DocumentRequirement[]
): DocumentRequirement | null {
    const uploadWords = normaliseDocName(uploadedDoc.documentName);
    if (uploadWords.length === 0) return null;

    let bestMatch: DocumentRequirement | null = null;
    let bestScore = 0;

    for (const req of existingReqs) {
        if (req.status === 'Complete' || req.status === 'Received') continue;
        const reqWords = normaliseDocName(req.documentName);
        const overlap  = uploadWords.filter((w) => reqWords.includes(w)).length;
        const score    = overlap / Math.max(uploadWords.length, reqWords.length);
        if (score > bestScore && overlap >= 2) {
            bestScore = score;
            bestMatch = req;
        }
    }

    return bestMatch;
}

export function processUploadedDocument(
    caseId: string,
    file: { name: string; size: number; type: string },
    uploadSource: DocUploadSource
): { uploadedDoc: UploadedDocumentMeta; matchedReq: DocumentRequirement | null } {
    const uploadedDoc: UploadedDocumentMeta = {
        id:             `upl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        caseId,
        documentName:   file.name.replace(/\.[^/.]+$/, ''), // strip extension
        fileType:       file.type || file.name.split('.').pop()?.toUpperCase() || 'FILE',
        fileSizeKB:     Math.round((file.size || 0) / 1024),
        uploadSource,
        uploadedAt:     new Date().toISOString(),
    };

    const existingReqs  = loadDocReqs(caseId);
    const matchedReq    = matchUploadToRequirement(uploadedDoc, existingReqs);

    if (matchedReq) {
        // Update the requirement
        updateDocReq(caseId, matchedReq.id, {
            status:       'Received',
            resolvedAt:   new Date().toISOString(),
            uploadedDocId: uploadedDoc.id,
        });
        // Link the upload back
        uploadedDoc.linkedRequirementId = matchedReq.id;
        matchedReq.status = 'Received'; // reflect in returned object
    }

    addUploadedDoc(caseId, uploadedDoc);

    // ── Auto-add to active filing bundles (spec §5 — "auto-adds document to bundle once received") ──
    if (matchedReq) {
        // Fire-and-forget: insert received doc into any draft bundles for this case
        import('./filingBundleService').then(({ autoAddReceivedDocToBundle }) => {
            autoAddReceivedDocToBundle(
                caseId,
                {
                    documentName: uploadedDoc.documentName,
                    documentId:   undefined, // not yet in Supabase documents table at this point
                },
                matchedReq.id
            ).catch((err) => console.warn('[Bundle] autoAddReceivedDocToBundle failed', err));
        });
    }

    return { uploadedDoc, matchedReq };
}

// ─── MAIN: ANALYSE DOCUMENTS ─────────────────────────────────────────────────

export async function analyseDocuments(
    caseObj: any,
    uploadedText: string,
    mode: DocFilingMode,
    language: string = 'auto'
): Promise<DocumentRequirement[]> {
    const caseId   = caseObj.id;
    const caseType = caseObj.caseType || caseObj.caseTitle || '';

    // Build context from learning system
    const store      = useSettingsStore.getState();
    const topDefects = store.getTopDefects(caseType, 5);

    // Get already-uploaded doc names
    const uploadedDocs    = loadUploadedDocs(caseId);
    const existingDocNames = uploadedDocs.map((d) => d.documentName);

    // Also include already-complete requirements as "available"
    const existingReqs = loadDocReqs(caseId);
    const completeNames = existingReqs
        .filter((r) => r.status === 'Complete' || r.status === 'Received')
        .map((r) => r.documentName);

    const allExisting = [...new Set([...existingDocNames, ...completeNames])];

    const optimizedText = optimizePromptText(uploadedText, 25000);

    // Build and fire the prompt
    const prompt = buildDocExpectationPrompt(caseObj, optimizedText, mode, allExisting, topDefects, language);
    const rawText = await callAiProxy(prompt);
    const parsed  = parseJsonArray(rawText);

    if (parsed.length === 0) {
        throw new Error('AI returned no requirements. Please check the document text and try again.');
    }

    const now = new Date().toISOString();

    // Hydrate each raw item into a full DocumentRequirement
    const requirements: DocumentRequirement[] = parsed
        .filter((item: any) => item && item.documentName && item.status)
        .map((item: any): DocumentRequirement => {
            const id = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            const req: DocumentRequirement = {
                id,
                caseId,
                documentName:          item.documentName || 'Unknown document',
                status:                (item.status as DocStatus) || 'Missing',
                priority:              item.priority || 'Important',
                source:                item.source   || 'AI',
                requestedFrom:         item.requestedFrom || 'Associate',
                deadline:              item.deadline  || computeDeadlineDateStr(item.priority === 'Critical' ? 0 : 5),
                autoMessageSent:       false,
                filingMode:            mode,
                detectedAt:            now,
                whyImportant:          item.whyImportant  || '',
                riskIfMissing:         item.riskIfMissing || '',
                filingStage:           item.filingStage   || '',
                followUps:             [],
            };

            // Build pre-composed WhatsApp messages
            req.whatsappClientText    = buildClientWhatsAppMessage(req, caseObj);
            req.whatsappAssociateText = buildAssociateWhatsAppMessage(req, caseObj);

            // Feed learning system
            store.recordDocDefect(caseType, req.documentName, req.source, req.status);

            return req;
        });

    // Merge with existing (avoid replacing already-resolved items)
    const existingPending = existingReqs.filter(
        (r) => r.status !== 'Complete' && r.status !== 'Received'
    );
    // Dedup: skip if same documentName already in existing pending list
    const existingNames = new Set(existingPending.map((r) => r.documentName.toLowerCase()));
    const fresh = requirements.filter((r) => !existingNames.has(r.documentName.toLowerCase()));

    const resolvedExisting = existingReqs.filter(
        (r) => r.status === 'Complete' || r.status === 'Received'
    );
    const merged = [...fresh, ...existingPending, ...resolvedExisting];
    saveDocReqs(caseId, merged);

    return fresh; // return only the newly detected ones
}

// ─── TASK CREATION BATCH ──────────────────────────────────────────────────────

/**
 * For a set of new requirements, auto-create tasks for Critical + Important ones.
 * Returns the tasks array to be merged into case.tasks by the caller.
 */
export function createTasksForRequirements(
    reqs: DocumentRequirement[],
    caseObj: any
): any[] {
    const tasks: any[] = [];
    for (const req of reqs) {
        if (req.priority === 'Optional') continue; // optional → no auto task
        const task = autoCreateTaskFromDocReq(req, caseObj);
        tasks.push(task);
        // Link task id back to requirement
        updateDocReq(caseObj.id, req.id, { linkedTaskId: task.id });
    }
    return tasks;
}

// ─── MARK REQUIREMENT COMPLETE ────────────────────────────────────────────────

export function markRequirementComplete(caseId: string, reqId: string): void {
    updateDocReq(caseId, reqId, {
        status:     'Complete',
        resolvedAt: new Date().toISOString(),
    });
}

import { communicationService } from './communicationService';

// ─── RECORD WHATSAPP SENT ─────────────────────────────────────────────────────

export async function recordWhatsAppSent(
    caseId: string,
    reqId: string,
    recipient: 'Client' | 'Associate',
    clientInfo?: { id: string; teamId: string }
): Promise<void> {
    const now = new Date().toISOString();
    const reqs = loadDocReqs(caseId);
    const req  = reqs.find((r) => r.id === reqId);
    if (!req) return;

    // Trigger real notification through backend
    if (recipient === 'Client' && clientInfo) {
        await communicationService.sendNotification({
            caseId,
            clientId: clientInfo.id,
            channel: 'whatsapp',
            content: req.whatsappClientText || `Missing document request: ${req.documentName}`,
            eventType: 'missing_doc'
        });
    }

    const newFollowUp = scheduleFollowUp(req.priority);
    const updates: Partial<DocumentRequirement> = {
        autoMessageSent: true,
        followUps: [...(req.followUps || []), newFollowUp],
    };
    if (recipient === 'Client')    updates.clientMessageSentAt    = now;
    if (recipient === 'Associate') updates.associateMessageSentAt = now;

    updateDocReq(caseId, reqId, updates);
}

// ─── SUMMARY STATS ────────────────────────────────────────────────────────────

export function getDocSummary(caseId: string): {
    missing: number;
    incorrect: number;
    incomplete: number;
    complete: number;
    total: number;
    hasCritical: boolean;
    overdueFollowUps: number;
} {
    const reqs = loadDocReqs(caseId);
    return {
        missing:    reqs.filter((r) => r.status === 'Missing').length,
        incorrect:  reqs.filter((r) => r.status === 'Incorrect').length,
        incomplete: reqs.filter((r) => r.status === 'Incomplete').length,
        complete:   reqs.filter((r) => r.status === 'Complete' || r.status === 'Received').length,
        total:      reqs.length,
        hasCritical: reqs.some((r) => r.priority === 'Critical' && r.status !== 'Complete' && r.status !== 'Received'),
        overdueFollowUps: getOverdueFollowUps(reqs).length,
    };
}
