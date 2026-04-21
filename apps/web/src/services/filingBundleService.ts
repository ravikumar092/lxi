/**
 * Lex Tigress — Filing Bundle Generator Service
 *
 * Orchestrates Auto Collating Documents for Filing (Paper Book Generator):
 *  1. Aggregate documents from all 6 sources
 *  2. Auto-arrange by structure rule (SC format / chronological / custom)
 *  3. Assign Bates numbers and page numbers
 *  4. Generate bundle index (TOC)
 *  5. Persist bundle to Supabase
 *  6. Trigger backend PDF generation
 *  7. Auto-add newly received documents to active bundles
 *  8. Send WhatsApp + in-app notifications for missing documents
 */

import { supabase } from '../lib/supabaseClient';
import { loadDocReqs, loadUploadedDocs, updateCase } from './localStorageService';
import { communicationService } from './communicationService';
import { createAlert } from './alertsService';
import type {
    FilingBundle,
    BundleDocument,
    BundleType,
    StructureRule,
    AggregatedDocument,
    BundleVersionSnapshot,
    BundleSourceType,
    AlertType,
} from '../types';

// ─── HELPERS ──────────────────────────────────────────────────────────────────

async function getTeamAndUser(): Promise<{ teamId: string; userId: string } | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: profile } = await supabase
        .from('user_profiles')
        .select('team_id')
        .eq('id', user.id)
        .single();

    const teamId = profile?.team_id;
    if (!teamId) return null;
    return { teamId, userId: user.id };
}

/** Strip special characters from a string to produce a safe filename segment. */
function sanitizeForFileName(str: string): string {
    return str
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .replace(/\s+/g, '_')
        .slice(0, 40);
}

/** Derive SC case type prefix from a case number (e.g. "SLP(C) No. 1234/2024" → "SLP"). */
function extractCaseTypePrefix(caseNumber: string): string {
    const match = caseNumber?.match(/^([A-Z]+)/);
    return match ? match[1] : 'CASE';
}

/** Auto-name a bundle file per spec §7. */
function buildFileName(bundleType: BundleType, caseObj: any, version: number): string {
    const caseType = extractCaseTypePrefix(caseObj.caseNumber || '');
    const title    = sanitizeForFileName(caseObj.displayTitle || caseObj.parties || 'Case');
    const date     = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const ver      = version > 1 ? `_v${version}` : '_Final';

    if (bundleType === 'court') {
        // e.g. SLP_PaperBook_Final.pdf
        return `${caseType}_PaperBook${ver}.pdf`;
    } else {
        // e.g. XvY_MasterBundle_20260418.pdf
        return `${title}_MasterBundle_${date}.pdf`;
    }
}

/** Format a Bates number: prefix + zero-padded number (7 digits). */
function formatBates(prefix: string, num: number): string {
    const padded = String(num).padStart(7, '0');
    return prefix ? `${prefix}_${padded}` : padded;
}

// ─── SUPREME COURT DOCUMENT ORDER ─────────────────────────────────────────────

/**
 * SC format document order per Supreme Court Rules 2013, Order XIII.
 * Lower index = appears earlier in the paper book.
 */
const SC_DOCUMENT_ORDER: Record<string, number> = {
    'index':                   1,
    'memo of appearance':      2,
    'vakalatnama':             3,
    'synoptic note':           4,
    'synopsis':                4,
    'list of dates':           5,
    'special leave petition':  6,
    'slp':                     6,
    'writ petition':           6,
    'civil appeal':            6,
    'criminal appeal':         6,
    'petition':                6,
    'affidavit':               7,
    'supporting affidavit':    7,
    'certified copy':          8,
    'impugned order':          8,
    'impugned judgment':       8,
    'high court order':        8,
    'office report':           9,
    'court order':             10,
    'last order':              10,
    'interim order':           10,
    'annexure':                11,
    'exhibit':                 11,
    'lower court records':     12,
    'judgment':                13,
    'order':                   13,
    'other':                   99,
};

function scSortScore(docName: string): number {
    const lower = docName.toLowerCase();
    for (const [key, score] of Object.entries(SC_DOCUMENT_ORDER)) {
        if (lower.includes(key)) return score;
    }
    return 99;
}

// ─── 1. AGGREGATE DOCUMENT SOURCES ───────────────────────────────────────────

/**
 * Pull documents from all 6 sources and return a unified AggregatedDocument[].
 * Deduplicates by normalised document name.
 */
export async function aggregateDocumentSources(
    caseObj: any
): Promise<AggregatedDocument[]> {
    const caseId = caseObj.id as string;
    const results: AggregatedDocument[] = [];
    const seen = new Set<string>();

    function dedupeKey(name: string, type: BundleSourceType): string {
        return `${type}::${name.toLowerCase().trim()}`;
    }

    function addDoc(doc: AggregatedDocument) {
        const key = dedupeKey(doc.documentName, doc.sourceType);
        if (!seen.has(key)) {
            seen.add(key);
            results.push(doc);
        }
    }

    // ── Source 1: Uploaded documents (localStorage) ──────────────────────────
    const uploadedDocs = loadUploadedDocs(caseId);
    for (const doc of uploadedDocs) {
        addDoc({
            id:                   `uploaded_${doc.id}`,
            documentName:         doc.documentName,
            sourceType:           'uploaded',
            fileSizeKB:           doc.fileSizeKB,
            uploadedAt:           doc.uploadedAt,
            linkedRequirementId:  doc.linkedRequirementId,
            isAvailable:          true,
        });
    }

    // ── Source 2: WhatsApp / Email received (Supabase communication_history) ─
    try {
        const messages = await communicationService.getMessageHistory(caseId);
        for (const msg of messages) {
            if (msg.direction !== 'inbound') continue;
            const attachments: any[] = msg.metadata?.attachments || [];
            for (const att of attachments) {
                addDoc({
                    id:           `comm_${msg.id}_${att.file_name}`,
                    documentName: att.file_name || 'Received Document',
                    sourceType:   msg.channel === 'email' ? 'email' : 'whatsapp',
                    sourceRef:    msg.id,
                    fileUrl:      att.url,
                    uploadedAt:   msg.created_at,
                    isAvailable:  true,
                });
            }
        }
    } catch (err) {
        console.warn('[Bundle] Failed to fetch communication history', err);
    }

    // ── Source 3: AI-detected (received) documents from missingDocService ─────
    const docReqs = loadDocReqs(caseId);
    for (const req of docReqs) {
        if (req.status !== 'Received' && req.status !== 'Complete') continue;
        addDoc({
            id:                   `ai_${req.id}`,
            documentName:         req.documentName,
            sourceType:           'ai_detected',
            linkedRequirementId:  req.id,
            uploadedAt:           req.resolvedAt || req.detectedAt,
            isAvailable:          true,
        });
    }

    // ── Source 4: Court Orders (eCourts API cache) ────────────────────────────
    if (caseObj.cnrNumber || caseObj.cnr) {
        try {
            const cnr = caseObj.cnrNumber || caseObj.cnr;
            const cacheKey = `lx_ec_lastOrders_${cnr}`;
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                const orders: any[] = JSON.parse(cached) || [];
                for (const order of orders) {
                    const name = order.orderTitle || order.title || 'Court Order';
                    addDoc({
                        id:           `order_${order.orderId || order.id || name}`,
                        documentName: name,
                        sourceType:   'court_order',
                        sourceRef:    order.orderId || order.id,
                        fileUrl:      order.pdfUrl || order.url,
                        uploadedAt:   order.orderDate || order.date,
                        isAvailable:  true,
                    });
                }
            }
        } catch (err) {
            console.warn('[Bundle] Failed to load court orders cache', err);
        }
    }

    // ── Source 5: Office Reports (SC eCourts cache) ───────────────────────────
    if (caseObj.diaryNo && caseObj.diaryYear) {
        try {
            const cacheKey = `lx_ec_officeReport_${caseObj.cnrNumber || caseObj.cnr || caseObj.diaryNo}`;
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                const report = JSON.parse(cached);
                if (report) {
                    addDoc({
                        id:           `office_report_${caseId}`,
                        documentName: 'Office Report',
                        sourceType:   'office_report',
                        uploadedAt:   new Date().toISOString(),
                        isAvailable:  true,
                    });
                }
            }
        } catch (err) {
            console.warn('[Bundle] Failed to load office report cache', err);
        }
    }

    // ── Source 6: Previously linked case documents (Supabase documents table) ─
    try {
        const { data: supabaseDocs, error } = await supabase
            .from('documents')
            .select('*')
            .eq('case_id', caseId);

        if (!error && supabaseDocs) {
            for (const doc of supabaseDocs) {
                addDoc({
                    id:           `linked_${doc.id}`,
                    documentName: doc.name,
                    sourceType:   'linked_case',
                    documentId:   doc.id,
                    fileUrl:      doc.url,
                    fileSizeKB:   doc.size_bytes ? Math.round(doc.size_bytes / 1024) : undefined,
                    uploadedAt:   doc.uploaded_at,
                    isAvailable:  !!doc.url,
                });
            }
        }
    } catch (err) {
        console.warn('[Bundle] Failed to load Supabase documents', err);
    }

    // Also add placeholders for Missing/Incomplete requirements (for Court bundle warning flags)
    for (const req of docReqs) {
        if (req.status === 'Received' || req.status === 'Complete') continue;
        addDoc({
            id:                   `placeholder_${req.id}`,
            documentName:         req.documentName,
            sourceType:           'ai_detected',
            linkedRequirementId:  req.id,
            isAvailable:          false,
        });
    }

    return results;
}

// ─── 2. AUTO-ARRANGE DOCUMENTS ────────────────────────────────────────────────

/**
 * Sort AggregatedDocument[] by the chosen structure rule.
 * Returns a new array — does not mutate input.
 */
export function autoArrangeDocuments(
    docs: AggregatedDocument[],
    rule: StructureRule
): AggregatedDocument[] {
    const copy = [...docs];

    if (rule === 'supreme_court') {
        // SC Rules 2013 document order
        copy.sort((a, b) => scSortScore(a.documentName) - scSortScore(b.documentName));
    } else if (rule === 'chronological') {
        copy.sort((a, b) => {
            const ta = a.uploadedAt ? new Date(a.uploadedAt).getTime() : 0;
            const tb = b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0;
            return ta - tb;
        });
    }
    // 'custom' → caller manages order via drag-drop; no re-sort

    return copy;
}

// ─── 3. BUILD BUNDLE DOCUMENT LIST ───────────────────────────────────────────

/**
 * Convert AggregatedDocument[] into BundleDocument[] with assigned positions.
 * Placeholders (unavailable docs) are included with isPlaceholder = true.
 */
export function buildBundleDocumentList(
    aggregated: AggregatedDocument[]
): Omit<BundleDocument, 'bundleId' | 'teamId'>[] {
    return aggregated.map((doc, index) => ({
        id:                  crypto.randomUUID(),
        position:            index,
        documentName:        doc.documentName,
        sourceType:          doc.sourceType,
        sourceRef:           doc.sourceRef,
        documentId:          doc.documentId,
        fileUrl:             doc.fileUrl,
        sectionLabel:        deriveSectionLabel(doc),
        isPlaceholder:       !doc.isAvailable,
        placeholderReason:   !doc.isAvailable ? 'Document not yet received' : undefined,
        createdAt:           new Date().toISOString(),
    }));
}

/** Derive a human-readable section label from a document's source type and name. */
function deriveSectionLabel(doc: AggregatedDocument): string {
    const lower = doc.documentName.toLowerCase();
    if (lower.includes('vakalatnama') || lower.includes('memo of appearance')) return 'Appearance';
    if (lower.includes('slp') || lower.includes('petition') || lower.includes('appeal')) return 'Main Petition';
    if (lower.includes('affidavit')) return 'Affidavits';
    if (lower.includes('order') || lower.includes('judgment')) return 'Court Orders';
    if (lower.includes('office report')) return 'Office Report';
    if (lower.includes('annexure') || lower.includes('exhibit')) return 'Annexures';
    if (doc.sourceType === 'court_order') return 'Court Orders';
    if (doc.sourceType === 'office_report') return 'Office Report';
    return 'Documents';
}

// ─── 4. BATES & PAGE NUMBERING ────────────────────────────────────────────────

/** Apply Bates numbers to BundleDocument[] in-place. Returns updated array. */
export function applyBatesNumbering(
    docs: Omit<BundleDocument, 'bundleId' | 'teamId'>[],
    prefix: string,
    startNumber: number
): Omit<BundleDocument, 'bundleId' | 'teamId'>[] {
    let current = startNumber;
    return docs.map((doc) => {
        if (doc.isPlaceholder) return doc;
        const start = formatBates(prefix, current);
        // Estimate page count from file size if unknown (1 page ≈ 50 KB)
        const estimatedPages = 1;
        const end = formatBates(prefix, current + estimatedPages - 1);
        current += estimatedPages;
        return { ...doc, batesStart: start, batesEnd: end };
    });
}

// ─── 5. GENERATE TOC / INDEX PAGE ────────────────────────────────────────────

export interface TocEntry {
    position:    number;
    documentName: string;
    sectionLabel?: string;
    batesStart?: string;
    pageStart?: number;
    isPlaceholder: boolean;
}

/** Generate a table of contents from the ordered document list. */
export function generateBundleIndex(
    docs: Omit<BundleDocument, 'bundleId' | 'teamId'>[]
): TocEntry[] {
    return docs.map((doc) => ({
        position:     doc.position,
        documentName: doc.documentName,
        sectionLabel: doc.sectionLabel,
        batesStart:   doc.batesStart,
        pageStart:    doc.pageStart,
        isPlaceholder: doc.isPlaceholder,
    }));
}

// ─── 6. SUPABASE CRUD ─────────────────────────────────────────────────────────

/** Create a new FilingBundle record in Supabase. Returns the saved bundle. */
export async function createFilingBundle(
    caseObj: any,
    bundleType: BundleType,
    structureRule: StructureRule,
    options: {
        batesPrefix?: string;
        batesStartNumber?: number;
        pageNumberStart?: number;
        associatePermission?: boolean;
    } = {}
): Promise<FilingBundle | null> {
    const ctx = await getTeamAndUser();
    if (!ctx) return null;

    const { teamId, userId } = ctx;

    // 1. Aggregate & arrange documents
    const aggregated = await aggregateDocumentSources(caseObj);
    const arranged   = autoArrangeDocuments(aggregated, structureRule);
    let   docList    = buildBundleDocumentList(arranged);

    // 2. Apply Bates numbering
    const batesPrefix = options.batesPrefix ?? extractCaseTypePrefix(caseObj.caseNumber || '') + new Date().getFullYear();
    const batesStart  = options.batesStartNumber ?? 1;
    docList = applyBatesNumbering(docList, batesPrefix, batesStart);

    // 3. Identify missing documents
    const missingDocIds = aggregated
        .filter((d) => !d.isAvailable && d.linkedRequirementId)
        .map((d) => d.linkedRequirementId as string);

    // 4. Build file name
    const fileName = buildFileName(bundleType, caseObj, 1);

    // 5. Insert bundle record
    const { data: bundle, error: bundleErr } = await supabase
        .from('filing_bundles')
        .insert({
            case_id:             caseObj.id,
            team_id:             teamId,
            bundle_type:         bundleType,
            status:              'draft',
            structure_rule:      structureRule,
            document_list:       docList,
            missing_documents:   missingDocIds,
            bates_prefix:        batesPrefix,
            bates_start_number:  batesStart,
            page_number_start:   options.pageNumberStart ?? 1,
            file_name:           fileName,
            version:             1,
            version_history:     [],
            associate_permission: options.associatePermission ?? false,
            generated_by:        userId,
        })
        .select()
        .single();

    if (bundleErr) {
        console.error('[Bundle] createFilingBundle failed', bundleErr);
        return null;
    }

    // 6. Insert bundle_documents rows
    const bundleDocRows = docList.map((doc) => ({
        ...doc,
        bundle_id: bundle.id,
        team_id:   teamId,
    }));

    const { error: docsErr } = await supabase
        .from('bundle_documents')
        .insert(bundleDocRows);

    if (docsErr) console.warn('[Bundle] bundle_documents insert failed', docsErr);

    return dbRowToFilingBundle(bundle);
}

/** Load all FilingBundles for a case. */
export async function loadBundlesForCase(caseId: string): Promise<FilingBundle[]> {
    const { data, error } = await supabase
        .from('filing_bundles')
        .select('*')
        .eq('case_id', caseId)
        .order('created_at', { ascending: false });

    if (error) { console.warn('[Bundle] loadBundlesForCase failed', error); return []; }
    return (data || []).map(dbRowToFilingBundle);
}

/** Load a single FilingBundle by id. */
export async function loadBundle(bundleId: string): Promise<FilingBundle | null> {
    const { data, error } = await supabase
        .from('filing_bundles')
        .select('*')
        .eq('id', bundleId)
        .single();

    if (error) { console.warn('[Bundle] loadBundle failed', error); return null; }
    return dbRowToFilingBundle(data);
}

/** Update document ordering after drag-drop (rewrite document_list). */
export async function saveBundleDocumentOrder(
    bundleId: string,
    reorderedDocs: BundleDocument[]
): Promise<void> {
    const reindexed = reorderedDocs.map((doc, idx) => ({ ...doc, position: idx }));

    const { error } = await supabase
        .from('filing_bundles')
        .update({ document_list: reindexed })
        .eq('id', bundleId);

    if (error) console.warn('[Bundle] saveBundleDocumentOrder failed', error);

    // Mirror to bundle_documents table
    for (const doc of reindexed) {
        await supabase
            .from('bundle_documents')
            .update({ position: doc.position })
            .eq('id', doc.id)
            .eq('bundle_id', bundleId);
    }
}

/** Mark a bundle as Final and store version snapshot. */
export async function finaliseBundleVersion(
    bundleId: string,
    downloadUrl: string,
    generatedByUserId: string,
    caseObj: any
): Promise<void> {
    const bundle = await loadBundle(bundleId);
    if (!bundle) return;

    const nextVersion = bundle.version + 1;
    const fileName    = buildFileName(bundle.bundleType, caseObj, bundle.version);

    const snapshot: BundleVersionSnapshot = {
        version:     bundle.version,
        downloadUrl: bundle.downloadUrl ?? downloadUrl,
        fileName,
        generatedAt: bundle.generatedAt ?? new Date().toISOString(),
        generatedBy: generatedByUserId,
    };

    const { error } = await supabase
        .from('filing_bundles')
        .update({
            status:          'final',
            download_url:    downloadUrl,
            file_name:       buildFileName(bundle.bundleType, caseObj, nextVersion),
            version:         nextVersion,
            version_history: [...bundle.versionHistory, snapshot],
            generated_at:    new Date().toISOString(),
            generated_by:    generatedByUserId,
        })
        .eq('id', bundleId);

    if (error) console.warn('[Bundle] finaliseBundleVersion failed', error);
}

// ─── 7. PDF GENERATION (Backend call) ─────────────────────────────────────────

/**
 * Trigger backend PDF generation for a bundle.
 * Calls /api/generate-bundle which merges PDFs, adds Bates stamps, TOC, bookmarks.
 * Returns the download URL on success.
 */
export async function generateBundlePDF(
    bundleId: string,
    caseObj: any
): Promise<string | null> {
    const bundle = await loadBundle(bundleId);
    if (!bundle) return null;

    const toc = generateBundleIndex(bundle.documentList);

    try {
        const response = await fetch('/api/generate-bundle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                bundleId,
                bundleType:      bundle.bundleType,
                documentList:    bundle.documentList,
                toc,
                batesPrefix:     bundle.batesPrefix,
                batesStartNumber: bundle.batesStartNumber,
                pageNumberStart: bundle.pageNumberStart,
                fileName:        bundle.fileName,
                caseTitle:       caseObj.displayTitle || caseObj.parties,
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error('[Bundle] PDF generation failed', errText);
            return null;
        }

        const result = await response.json();
        const downloadUrl: string | null = result.downloadUrl ?? null;

        if (!downloadUrl) {
            console.error('[Bundle] Backend returned no downloadUrl');
            return null;
        }

        // Mark bundle as final with the download URL
        const { data: { user } } = await supabase.auth.getUser();
        await finaliseBundleVersion(bundleId, downloadUrl, user?.id ?? '', caseObj);

        if (bundle.missingDocuments && bundle.missingDocuments.length > 0) {
            await notifyMissingDocuments(bundle, caseObj);
        }

        return downloadUrl;
    } catch (err) {
        console.error('[Bundle] generateBundlePDF error', err);
        return null;
    }
}

// ─── 8. AUTO-ADD RECEIVED DOCUMENT ───────────────────────────────────────────

/**
 * Called when a document is received and matched to a requirement.
 * Finds active (draft) bundles for the case and inserts the document.
 * This is the trigger that completes the "auto-add doc once received" spec requirement.
 */
export async function autoAddReceivedDocToBundle(
    caseId:       string,
    receivedDoc:  { documentName: string; fileUrl?: string; documentId?: string },
    requirementId: string
): Promise<void> {
    const ctx = await getTeamAndUser();
    if (!ctx) return;

    // Find all draft bundles for this case
    const { data: bundles, error } = await supabase
        .from('filing_bundles')
        .select('*')
        .eq('case_id', caseId)
        .eq('status', 'draft');

    if (error || !bundles?.length) return;

    for (const bundleRow of bundles) {
        const bundle = dbRowToFilingBundle(bundleRow);

        // Check if there's already a placeholder for this requirement
        const placeholderIndex = bundle.documentList.findIndex(
            (d) =>
                d.isPlaceholder &&
                (d.documentName.toLowerCase() === receivedDoc.documentName.toLowerCase())
        );

        let updatedList: BundleDocument[];

        if (placeholderIndex >= 0) {
            // Replace placeholder with real document
            updatedList = bundle.documentList.map((d, idx) =>
                idx === placeholderIndex
                    ? {
                        ...d,
                        isPlaceholder:      false,
                        placeholderReason:  undefined,
                        documentId:         receivedDoc.documentId,
                        sourceType:         'uploaded' as BundleSourceType,
                    }
                    : d
            );
        } else {
            // Append as new document at end
            const newDoc: BundleDocument = {
                id:           crypto.randomUUID(),
                bundleId:     bundle.id,
                teamId:       ctx.teamId,
                position:     bundle.documentList.length,
                documentName: receivedDoc.documentName,
                sourceType:   'uploaded',
                documentId:   receivedDoc.documentId,
                sectionLabel: 'Documents',
                isPlaceholder: false,
                createdAt:    new Date().toISOString(),
            };
            updatedList = [...bundle.documentList, newDoc];
        }

        // Remove from missing_documents list
        const updatedMissing = bundle.missingDocuments.filter((id) => id !== requirementId);

        await supabase
            .from('filing_bundles')
            .update({
                document_list:     updatedList,
                missing_documents: updatedMissing,
            })
            .eq('id', bundle.id);
    }
}

// ─── 9. MISSING DOC NOTIFICATIONS ────────────────────────────────────────────

/**
 * Send both WhatsApp and in-app notifications for missing documents in a bundle.
 * Called when bundle is generated with missing items.
 */
export async function notifyMissingDocuments(
    bundle:  FilingBundle,
    caseObj: any
): Promise<void> {
    if (!bundle.missingDocuments.length) return;

    const ctx = await getTeamAndUser();
    if (!ctx) return;

    const missingCount = bundle.missingDocuments.length;
    const bundleTypeLabel = bundle.bundleType === 'court' ? 'Court Filing Bundle' : 'Master Bundle';
    const caseTitle = caseObj.displayTitle || caseObj.parties || 'Case';

    // ── In-app alert ────────────────────────────────────────────────────────
    await createAlert({
        user_id:  ctx.userId,
        case_id:  caseObj.id,
        type:     'deadline' as AlertType,
        message:  `${bundleTypeLabel} for ${caseTitle} has ${missingCount} missing document${missingCount > 1 ? 's' : ''}. Follow up required.`,
    });

    // ── Auto-create tasks for missing documents ──────────────────────────────
    try {
        const { createTasksForRequirements } = await import('./missingDocService');
        const allReqsForTasks = loadDocReqs(caseObj.id);
        const missingReqs = allReqsForTasks.filter((r) => bundle.missingDocuments.includes(r.id));
        if (missingReqs.length > 0) {
            const newTasks = createTasksForRequirements(missingReqs, caseObj);
            if (newTasks.length > 0) {
                const existingTasks = caseObj.tasks || [];
                const alreadyLinked = new Set(existingTasks.map((t: any) => t.linkedDocReqId).filter(Boolean));
                const uniqueNewTasks = newTasks.filter((t: any) => !alreadyLinked.has(t.linkedDocReqId));
                if (uniqueNewTasks.length > 0) {
                    updateCase(caseObj.diaryNumber, caseObj.diaryYear, {
                        tasks: [...existingTasks, ...uniqueNewTasks],
                    });
                }
            }
        }
    } catch (err) {
        console.warn('[Bundle] Auto task creation failed', err);
    }

    // ── WhatsApp notification (via existing communicationService) ───────────
    // Build message using doc names from the bundle
    const loadDocReqsModule = await import('./localStorageService');
    const allReqs = loadDocReqsModule.loadDocReqs(caseObj.id);

    const missingNames = allReqs
        .filter((r) => bundle.missingDocuments.includes(r.id))
        .map((r) => `• ${r.documentName}`)
        .join('\n');

    const message =
        `*${bundleTypeLabel} — Missing Documents*\n\n` +
        `Case: *${caseTitle}*\n\n` +
        `The following documents are required to complete the bundle:\n${missingNames}\n\n` +
        `Please send these documents at the earliest.`;

    // Queue outbound message (pending_approval, so AOR reviews before send)
    try {
        const clients = await communicationService.getClients();
        const linkedClient = clients.find((c) => (caseObj as any).client_id === c.id);

        if (linkedClient) {
            await communicationService.sendNotification({
                caseId:    caseObj.id,
                clientId:  linkedClient.id,
                channel:   'whatsapp',
                content:   message,
                eventType: 'missing_doc_bundle',
                whatsappTo: linkedClient.whatsapp_number,
            });
        }
    } catch (err) {
        console.warn('[Bundle] WhatsApp notification failed', err);
    }
}

// ─── 10. ROLE PERMISSION CHECK ────────────────────────────────────────────────

/**
 * Check if the current user can generate or edit a bundle.
 * AOR (Admin): always allowed.
 * Associates: only if bundle.associatePermission is true.
 */
export async function canUserEditBundle(bundle: FilingBundle): Promise<boolean> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const { data: profile } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('id', user.id)
        .single();

    if (!profile) return false;

    // TeamMemberRole.ADMIN = 'Admin' — AOR role maps to Admin in the platform
    if (profile.role === 'Admin') return true;

    // Associates need explicit permission
    return bundle.associatePermission;
}

// ─── 11. SERIALISATION ───────────────────────────────────────────────────────

function dbRowToFilingBundle(row: any): FilingBundle {
    return {
        id:                  row.id,
        caseId:              row.case_id,
        teamId:              row.team_id,
        bundleType:          row.bundle_type,
        status:              row.status,
        structureRule:       row.structure_rule,
        documentList:        row.document_list || [],
        missingDocuments:    row.missing_documents || [],
        generatedBy:         row.generated_by,
        generatedAt:         row.generated_at,
        downloadUrl:         row.download_url,
        fileName:            row.file_name,
        batesPrefix:         row.bates_prefix || '',
        batesStartNumber:    row.bates_start_number ?? 1,
        pageNumberStart:     row.page_number_start ?? 1,
        version:             row.version ?? 1,
        versionHistory:      row.version_history || [],
        associatePermission: row.associate_permission ?? false,
        createdAt:           row.created_at,
        updatedAt:           row.updated_at,
    };
}
