/**
 * Lex Tigress — Filing Bundle Assembly Modal
 *
 * Full-screen modal for assembling the filing bundle:
 *  - Drag-and-drop document reordering
 *  - Missing document placeholders (highlighted)
 *  - Structure rule info
 *  - Live clickable Table of Contents preview
 *  - Add document button
 *  - Generate PDF action
 */

import { useState, useCallback } from 'react';
import { useApp } from '../AppContext';

export function openOrDownloadPDF(url: string, fileName = 'bundle.pdf') {
    if (url.startsWith('data:')) {
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
    } else {
        window.open(url, '_blank');
    }
}
import {
    saveBundleDocumentOrder,
    generateBundlePDF,
    applyBatesNumbering,
    generateBundleIndex,
    type TocEntry,
} from '../services/filingBundleService';
import type {
    FilingBundle,
    BundleDocument,
    AggregatedDocument,
    BundleSourceType,
} from '../types';

// ─── SOURCE ICON MAP ──────────────────────────────────────────────────────────

const SOURCE_ICONS: Record<BundleSourceType, string> = {
    uploaded:      '📤',
    whatsapp:      '💬',
    email:         '📧',
    ai_detected:   '🤖',
    court_order:   '⚖️',
    office_report: '📋',
    linked_case:   '🔗',
};

const SOURCE_LABELS: Record<BundleSourceType, string> = {
    uploaded:      'Uploaded',
    whatsapp:      'WhatsApp',
    email:         'Email',
    ai_detected:   'AI Detected',
    court_order:   'Court Order',
    office_report: 'Office Report',
    linked_case:   'Linked',
};

// ─── DRAG-DROP (native HTML5) ─────────────────────────────────────────────────

interface DragState {
    draggingIndex: number | null;
    overIndex: number | null;
}

// ─── DOCUMENT ROW ─────────────────────────────────────────────────────────────

function DocumentRow({
    doc,
    index,
    isDragging,
    isOver,
    onDragStart,
    onDragEnter,
    onDragEnd,
    onRemove,
    T,
}: {
    doc: BundleDocument;
    index: number;
    isDragging: boolean;
    isOver: boolean;
    onDragStart: (i: number) => void;
    onDragEnter: (i: number) => void;
    onDragEnd: () => void;
    onRemove: (id: string) => void;
    T: any;
}) {
    return (
        <div
            draggable
            onDragStart={() => onDragStart(index)}
            onDragEnter={() => onDragEnter(index)}
            onDragEnd={onDragEnd}
            onDragOver={(e) => e.preventDefault()}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 12px',
                borderRadius: 8,
                border: `1px solid ${
                    doc.isPlaceholder
                        ? '#EF444440'
                        : isOver
                        ? '#C9A84C'
                        : T.border
                }`,
                background: isDragging
                    ? `${T.text}08`
                    : doc.isPlaceholder
                    ? '#EF444408'
                    : isOver
                    ? '#C9A84C08'
                    : T.bgAlt || T.bg,
                opacity: isDragging ? 0.5 : 1,
                cursor: 'grab',
                transition: 'all 0.15s',
                marginBottom: 4,
            }}
        >
            {/* Drag handle */}
            <span style={{ color: T.textMuted, fontSize: 14, cursor: 'grab', flexShrink: 0 }}>⠿</span>

            {/* Position number */}
            <span style={{
                width: 22, height: 22,
                borderRadius: 6,
                background: T.textMuted + '20',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, color: T.textMuted,
                flexShrink: 0,
            }}>
                {index + 1}
            </span>

            {/* Source icon */}
            <span style={{ fontSize: 14, flexShrink: 0 }} title={SOURCE_LABELS[doc.sourceType]}>
                {SOURCE_ICONS[doc.sourceType]}
            </span>

            {/* Document info */}
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                    fontSize: 13,
                    fontWeight: doc.isPlaceholder ? 500 : 600,
                    color: doc.isPlaceholder ? '#EF4444' : T.text,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                    {doc.isPlaceholder && <span style={{ marginRight: 5 }}>⚠</span>}
                    {doc.documentName}
                    {doc.isPlaceholder && (
                        <span style={{ marginLeft: 6, fontSize: 11, color: '#EF4444', fontWeight: 400 }}>
                            (Missing — awaiting receipt)
                        </span>
                    )}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
                    {doc.sectionLabel && (
                        <span style={{ fontSize: 10, color: T.textMuted }}>{doc.sectionLabel}</span>
                    )}
                    {doc.batesStart && (
                        <span style={{ fontSize: 10, color: T.textMuted }}>Bates: {doc.batesStart}</span>
                    )}
                    {doc.bookmarkLabel && (
                        <span style={{ fontSize: 10, color: '#2A7BD4' }}>🔖 {doc.bookmarkLabel}</span>
                    )}
                </div>
            </div>

            {/* Remove button */}
            <button
                onClick={() => onRemove(doc.id)}
                title="Remove from bundle"
                style={{
                    width: 22, height: 22,
                    borderRadius: 5,
                    border: `1px solid ${T.border}`,
                    background: 'transparent',
                    color: T.textMuted,
                    fontSize: 12,
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                }}
            >
                ✕
            </button>
        </div>
    );
}

// ─── TOC PREVIEW ─────────────────────────────────────────────────────────────

function TocPreview({ entries, T }: { entries: TocEntry[]; T: any }) {
    return (
        <div>
            <div style={{
                fontSize: 11, fontWeight: 700, color: T.textMuted,
                letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10,
            }}>
                Table of Contents Preview
            </div>
            {entries.length === 0 && (
                <div style={{ fontSize: 12, color: T.textMuted }}>No documents yet.</div>
            )}
            {entries.map((entry, idx) => (
                <div
                    key={idx}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '5px 0',
                        borderBottom: `1px solid ${T.border}20`,
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <span style={{
                            width: 20, fontSize: 11, color: T.textMuted,
                            fontWeight: 600, flexShrink: 0,
                        }}>
                            {entry.position + 1}.
                        </span>
                        <span style={{
                            fontSize: 12,
                            color: entry.isPlaceholder ? '#EF4444' : T.text,
                            fontStyle: entry.isPlaceholder ? 'italic' : 'normal',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                            {entry.isPlaceholder ? '⚠ ' : ''}{entry.documentName}
                        </span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                        {entry.batesStart && (
                            <span style={{ fontSize: 10, color: T.textMuted }}>{entry.batesStart}</span>
                        )}
                        {entry.pageStart !== undefined && (
                            <span style={{ fontSize: 10, color: T.textMuted }}>p.{entry.pageStart}</span>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}

// ─── MAIN MODAL ───────────────────────────────────────────────────────────────

interface FilingBundleModalProps {
    bundle: FilingBundle;
    caseObj: any;
    aggregatedDocs: AggregatedDocument[];
    onClose: (updatedBundle?: FilingBundle) => void;
}

export function FilingBundleModal({
    bundle,
    caseObj,
    aggregatedDocs,
    onClose,
}: FilingBundleModalProps) {
    const { T } = useApp();

    // Work on a local copy of documentList
    const [docs, setDocs]           = useState<BundleDocument[]>([...bundle.documentList]);
    const [dragState, setDragState] = useState<DragState>({ draggingIndex: null, overIndex: null });
    const [saving, setSaving]       = useState(false);
    const [generating, setGenerating] = useState(false);
    const [genError, setGenError]   = useState('');
    const [activeTab, setActiveTab] = useState<'arrange' | 'toc'>('arrange');
    const [showAddPicker, setShowAddPicker] = useState(false);

    // Compute live TOC
    const toc: TocEntry[] = generateBundleIndex(
        applyBatesNumbering(docs, bundle.batesPrefix, bundle.batesStartNumber)
    );

    // ── Drag handlers (HTML5 native drag-drop) ───────────────────────────────
    const handleDragStart = useCallback((index: number) => {
        setDragState({ draggingIndex: index, overIndex: null });
    }, []);

    const handleDragEnter = useCallback((index: number) => {
        setDragState((prev) => ({ ...prev, overIndex: index }));
    }, []);

    const handleDragEnd = useCallback(() => {
        setDragState((prev) => {
            const { draggingIndex, overIndex } = prev;
            if (draggingIndex === null || overIndex === null || draggingIndex === overIndex) {
                return { draggingIndex: null, overIndex: null };
            }
            setDocs((d) => {
                const reordered = [...d];
                const [moved] = reordered.splice(draggingIndex, 1);
                reordered.splice(overIndex, 0, moved);
                return reordered.map((doc, idx) => ({ ...doc, position: idx }));
            });
            return { draggingIndex: null, overIndex: null };
        });
    }, []);

    // ── Remove a document from the list ──────────────────────────────────────
    const handleRemove = useCallback((id: string) => {
        setDocs((prev) =>
            prev
                .filter((d) => d.id !== id)
                .map((d, idx) => ({ ...d, position: idx }))
        );
    }, []);

    // ── Add document from aggregated sources ─────────────────────────────────
    const handleAddDoc = useCallback((aggDoc: AggregatedDocument) => {
        const alreadyAdded = docs.some(
            (d) => d.documentName.toLowerCase() === aggDoc.documentName.toLowerCase()
        );
        if (alreadyAdded) { setShowAddPicker(false); return; }

        const newDoc: BundleDocument = {
            id:           crypto.randomUUID(),
            bundleId:     bundle.id,
            teamId:       bundle.teamId,
            position:     docs.length,
            documentName: aggDoc.documentName,
            sourceType:   aggDoc.sourceType,
            sourceRef:    aggDoc.sourceRef,
            documentId:   aggDoc.documentId,
            sectionLabel: 'Documents',
            isPlaceholder: !aggDoc.isAvailable,
            createdAt:    new Date().toISOString(),
        };
        setDocs((prev) => [...prev, newDoc]);
        setShowAddPicker(false);
    }, [docs, bundle.id, bundle.teamId]);

    // ── Save ordering ─────────────────────────────────────────────────────────
    const handleSave = useCallback(async () => {
        setSaving(true);
        await saveBundleDocumentOrder(bundle.id, docs);
        setSaving(false);
        onClose({ ...bundle, documentList: docs });
    }, [bundle, docs, onClose]);

    // ── Generate PDF ──────────────────────────────────────────────────────────
    const handleGenerate = useCallback(async () => {
        // Save order first
        await saveBundleDocumentOrder(bundle.id, docs);

        setGenerating(true);
        setGenError('');
        const url = await generateBundlePDF(bundle.id, caseObj);
        setGenerating(false);

        if (url) {
            openOrDownloadPDF(url, bundle.fileName || 'bundle.pdf');
            onClose({ ...bundle, documentList: docs, downloadUrl: url, status: 'final' });
        } else {
            setGenError('PDF generation failed. Please try again.');
        }
    }, [bundle, docs, caseObj, onClose]);

    // Docs not yet in bundle (for Add picker)
    const availableToAdd = aggregatedDocs.filter(
        (ad) => !docs.some((d) => d.documentName.toLowerCase() === ad.documentName.toLowerCase())
    );

    const missingCount    = docs.filter((d) => d.isPlaceholder).length;
    const availableCount  = docs.filter((d) => !d.isPlaceholder).length;

    return (
        <div
            style={{
                position: 'fixed', inset: 0, zIndex: 1200,
                background: 'rgba(0,0,0,0.65)',
                display: 'flex', alignItems: 'stretch', justifyContent: 'flex-end',
            }}
            onClick={() => onClose()}
        >
            {/* Drawer panel */}
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: '100%', maxWidth: 780,
                    background: T.bg,
                    borderLeft: `1px solid ${T.border}`,
                    display: 'flex', flexDirection: 'column',
                    height: '100vh',
                    overflowY: 'auto',
                    boxShadow: '-8px 0 32px rgba(0,0,0,0.2)',
                }}
            >
                {/* Header */}
                <div style={{
                    padding: '18px 20px 14px',
                    borderBottom: `1px solid ${T.border}`,
                    position: 'sticky', top: 0,
                    background: T.bg, zIndex: 10,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{
                                width: 32, height: 32, borderRadius: 9,
                                background: 'linear-gradient(135deg,#1A2E5E,#0F1C3F)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
                            }}>
                                📁
                            </div>
                            <div>
                                <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>
                                    {bundle.bundleType === 'court' ? 'Court Filing Bundle (Paper Book)' : 'Master Bundle'}
                                </div>
                                <div style={{ fontSize: 12, color: T.textMuted }}>
                                    {caseObj.displayTitle || caseObj.parties} · v{bundle.version}
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={() => onClose()}
                            style={{
                                width: 30, height: 30, borderRadius: 8,
                                border: `1px solid ${T.border}`, background: T.bg,
                                color: T.textMuted, fontSize: 16, cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}
                        >
                            ✕
                        </button>
                    </div>

                    {/* Stats bar */}
                    <div style={{
                        display: 'flex', gap: 16, marginTop: 10,
                        padding: '8px 12px', borderRadius: 8,
                        background: T.textMuted + '10',
                    }}>
                        <span style={{ fontSize: 12, color: T.text }}>
                            <strong>{availableCount}</strong> documents
                        </span>
                        {missingCount > 0 && (
                            <span style={{ fontSize: 12, color: '#EF4444' }}>
                                ⚠ <strong>{missingCount}</strong> missing
                            </span>
                        )}
                        <span style={{ fontSize: 12, color: T.textMuted }}>
                            Order: {
                                bundle.structureRule === 'supreme_court' ? 'SC Format'
                                : bundle.structureRule === 'chronological' ? 'Chronological'
                                : 'Custom'
                            }
                        </span>
                        {bundle.batesPrefix && (
                            <span style={{ fontSize: 12, color: T.textMuted }}>
                                Bates: {bundle.batesPrefix}_0001…
                            </span>
                        )}
                    </div>

                    {/* Tabs */}
                    <div style={{ display: 'flex', gap: 4, marginTop: 10 }}>
                        {(['arrange', 'toc'] as const).map((tab) => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                style={{
                                    padding: '6px 14px',
                                    borderRadius: 7,
                                    border: `1px solid ${activeTab === tab ? '#1A2E5E' : T.border}`,
                                    background: activeTab === tab ? '#1A2E5E12' : T.bg,
                                    color: activeTab === tab ? '#1A2E5E' : T.textSub,
                                    fontSize: 12,
                                    fontWeight: activeTab === tab ? 700 : 500,
                                    cursor: 'pointer',
                                }}
                            >
                                {tab === 'arrange' ? '⠿ Arrange Documents' : '📑 TOC Preview'}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Body */}
                <div style={{ flex: 1, padding: '16px 20px', overflowY: 'auto' }}>
                    {activeTab === 'arrange' && (
                        <>
                            {/* Missing doc warning */}
                            {missingCount > 0 && (
                                <div style={{
                                    padding: '10px 14px', borderRadius: 9,
                                    background: '#EF444410',
                                    border: '1px solid #EF444430',
                                    marginBottom: 14,
                                    fontSize: 13, color: '#C62828',
                                    lineHeight: 1.5,
                                }}>
                                    <strong>⚠ {missingCount} document{missingCount > 1 ? 's' : ''} missing</strong> —
                                    Placeholders are included so the bundle structure is complete.
                                    These sections will be highlighted in the final PDF.
                                    Documents are auto-added once received via WhatsApp or upload.
                                </div>
                            )}

                            {/* Instruction */}
                            <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 10 }}>
                                Drag rows to reorder. Remove documents you don't want in this bundle.
                            </div>

                            {/* Document list */}
                            <div>
                                {docs.map((doc, idx) => (
                                    <DocumentRow
                                        key={doc.id}
                                        doc={doc}
                                        index={idx}
                                        isDragging={dragState.draggingIndex === idx}
                                        isOver={dragState.overIndex === idx}
                                        onDragStart={handleDragStart}
                                        onDragEnter={handleDragEnter}
                                        onDragEnd={handleDragEnd}
                                        onRemove={handleRemove}
                                        T={T}
                                    />
                                ))}
                            </div>

                            {/* Add document button */}
                            <button
                                onClick={() => setShowAddPicker((v) => !v)}
                                style={{
                                    width: '100%',
                                    marginTop: 8,
                                    padding: '8px 14px',
                                    borderRadius: 8,
                                    border: `1px dashed ${T.border}`,
                                    background: 'transparent',
                                    color: T.textMuted,
                                    fontSize: 13,
                                    cursor: 'pointer',
                                    textAlign: 'center',
                                }}
                            >
                                + Add Document
                            </button>

                            {/* Add doc picker */}
                            {showAddPicker && availableToAdd.length > 0 && (
                                <div style={{
                                    marginTop: 8,
                                    border: `1px solid ${T.border}`,
                                    borderRadius: 9,
                                    overflow: 'hidden',
                                    maxHeight: 220,
                                    overflowY: 'auto',
                                }}>
                                    {availableToAdd.map((ad) => (
                                        <div
                                            key={ad.id}
                                            onClick={() => handleAddDoc(ad)}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: 10,
                                                padding: '9px 12px',
                                                borderBottom: `1px solid ${T.border}20`,
                                                cursor: 'pointer',
                                                fontSize: 13, color: T.text,
                                            }}
                                            onMouseEnter={(e) => {
                                                (e.currentTarget as HTMLDivElement).style.background = T.textMuted + '10';
                                            }}
                                            onMouseLeave={(e) => {
                                                (e.currentTarget as HTMLDivElement).style.background = 'transparent';
                                            }}
                                        >
                                            <span>{SOURCE_ICONS[ad.sourceType]}</span>
                                            <span style={{ flex: 1 }}>{ad.documentName}</span>
                                            {!ad.isAvailable && (
                                                <span style={{ fontSize: 10, color: '#EF4444' }}>Missing</span>
                                            )}
                                            <span style={{ fontSize: 10, color: T.textMuted }}>
                                                {SOURCE_LABELS[ad.sourceType]}
                                            </span>
                                        </div>
                                    ))}
                                    {availableToAdd.length === 0 && (
                                        <div style={{ padding: '12px', fontSize: 12, color: T.textMuted }}>
                                            All available documents are already in the bundle.
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    )}

                    {activeTab === 'toc' && (
                        <TocPreview entries={toc} T={T} />
                    )}
                </div>

                {/* Footer */}
                <div style={{
                    padding: '14px 20px',
                    borderTop: `1px solid ${T.border}`,
                    background: T.bg,
                    position: 'sticky', bottom: 0,
                }}>
                    {genError && (
                        <div style={{ marginBottom: 8, fontSize: 12, color: '#EF4444' }}>{genError}</div>
                    )}
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button
                            onClick={() => onClose()}
                            style={{
                                padding: '9px 16px', borderRadius: 8,
                                border: `1px solid ${T.border}`, background: T.bg,
                                color: T.textSub, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            style={{
                                padding: '9px 16px', borderRadius: 8,
                                border: `1px solid ${T.border}`, background: T.bg,
                                color: T.text, fontSize: 13, fontWeight: 600,
                                cursor: saving ? 'not-allowed' : 'pointer',
                            }}
                        >
                            {saving ? 'Saving…' : 'Save Order'}
                        </button>
                        <button
                            onClick={handleGenerate}
                            disabled={generating || saving}
                            style={{
                                padding: '9px 20px', borderRadius: 8, border: 'none',
                                background: generating
                                    ? '#888'
                                    : 'linear-gradient(135deg,#C9A84C,#9B7B28)',
                                color: '#fff', fontSize: 13, fontWeight: 700,
                                cursor: generating ? 'not-allowed' : 'pointer',
                                boxShadow: '0 2px 8px rgba(201,168,76,0.3)',
                            }}
                        >
                            {generating ? 'Generating PDF…' : '⬇ Generate & Download PDF'}
                        </button>
                    </div>
                    <div style={{ marginTop: 8, fontSize: 11, color: T.textMuted, textAlign: 'right' }}>
                        PDF will include: indexed TOC · bookmarks · Bates numbers · page numbers
                    </div>
                </div>
            </div>
        </div>
    );
}
