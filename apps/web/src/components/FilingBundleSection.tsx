/**
 * Lex Tigress — Filing Bundle Section
 * Renders inside the Case Detail view (DetailSections.tsx).
 *
 * Shows:
 *  - Existing bundles (Master + Court) with status, version, download links
 *  - Missing document warnings
 *  - "Generate Filing Bundle" CTA
 *  - Role-based access guard
 *  - Opens FilingBundleModal for document assembly
 */

import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../AppContext';
import { openOrDownloadPDF } from './FilingBundleModal';
import { SectionIconBox } from '../caseHelpers';
import { fmtDate } from '../caseHelpers';
import {
    loadBundlesForCase,
    createFilingBundle,
    generateBundlePDF,
    canUserEditBundle,
    aggregateDocumentSources,
} from '../services/filingBundleService';
import type { FilingBundle, BundleType, StructureRule, AggregatedDocument } from '../types';
import { FilingBundleModal } from './FilingBundleModal';

// ─── PROPS ────────────────────────────────────────────────────────────────────

interface FilingBundleSectionProps {
    selected: any; // Case object
}

// ─── STATUS BADGE ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: 'draft' | 'final' }) {
    const color = status === 'final' ? '#1A8C5B' : '#C9A84C';
    return (
        <span style={{
            background: `${color}18`,
            color,
            fontSize: 11,
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 12,
            border: `1px solid ${color}30`,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
        }}>
            {status}
        </span>
    );
}

// ─── BUNDLE TYPE BADGE ────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: BundleType }) {
    const color = type === 'court' ? '#2A7BD4' : '#6A1B9A';
    const label = type === 'court' ? 'Court Filing' : 'Master Bundle';
    return (
        <span style={{
            background: `${color}15`,
            color,
            fontSize: 11,
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 12,
            border: `1px solid ${color}25`,
            letterSpacing: 0.4,
        }}>
            {label}
        </span>
    );
}

// ─── BUNDLE CARD ──────────────────────────────────────────────────────────────

function BundleCard({
    bundle,
    caseObj,
    onRegenerate,
    canEdit,
    T,
}: {
    bundle: FilingBundle;
    caseObj: any;
    onRegenerate: (b: FilingBundle) => void;
    canEdit: boolean;
    T: any;
}) {
    const [generating, setGenerating] = useState(false);
    const [genError, setGenError]     = useState('');

    const docCount      = bundle.documentList.filter((d) => !d.isPlaceholder).length;
    const missingCount  = bundle.missingDocuments.length;
    const placeholders  = bundle.documentList.filter((d) => d.isPlaceholder).length;

    async function handleDownload() {
        if (bundle.downloadUrl) {
            openOrDownloadPDF(bundle.downloadUrl, bundle.fileName || 'bundle.pdf');
            return;
        }
        // Generate on demand
        setGenerating(true);
        setGenError('');
        const url = await generateBundlePDF(bundle.id, caseObj);
        setGenerating(false);
        if (url) {
            openOrDownloadPDF(url, bundle.fileName || 'bundle.pdf');
        } else {
            setGenError('PDF generation failed. Please try again.');
        }
    }

    return (
        <div style={{
            background: T.bgAlt || T.bg,
            border: `1px solid ${missingCount > 0 ? '#C9A84C40' : T.border}`,
            borderRadius: 10,
            padding: '12px 14px',
            marginBottom: 8,
        }}>
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                    <TypeBadge type={bundle.bundleType} />
                    <StatusBadge status={bundle.status} />
                    <span style={{ fontSize: 11, color: T.textMuted, fontWeight: 600 }}>v{bundle.version}</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                    {canEdit && (
                        <button
                            onClick={() => onRegenerate(bundle)}
                            style={{
                                padding: '4px 10px',
                                borderRadius: 7,
                                border: `1px solid ${T.border}`,
                                background: T.bg,
                                color: T.textSub,
                                fontSize: 11,
                                fontWeight: 600,
                                cursor: 'pointer',
                            }}
                        >
                            Edit / Re-arrange
                        </button>
                    )}
                    <button
                        onClick={handleDownload}
                        disabled={generating}
                        style={{
                            padding: '4px 12px',
                            borderRadius: 7,
                            border: 'none',
                            background: generating
                                ? '#888'
                                : 'linear-gradient(135deg,#1A2E5E,#0F1C3F)',
                            color: '#fff',
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: generating ? 'not-allowed' : 'pointer',
                        }}
                    >
                        {generating ? 'Generating…' : bundle.downloadUrl ? 'Download PDF' : 'Generate PDF'}
                    </button>
                </div>
            </div>

            {/* Stats row */}
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: T.textMuted }}>
                    <span style={{ color: T.text, fontWeight: 700 }}>{docCount}</span> docs
                </span>
                {placeholders > 0 && (
                    <span style={{ fontSize: 12, color: '#C9A84C' }}>
                        ⚠ {placeholders} placeholder{placeholders > 1 ? 's' : ''}
                    </span>
                )}
                {missingCount > 0 && (
                    <span style={{ fontSize: 12, color: '#EF4444' }}>
                        ✗ {missingCount} missing
                    </span>
                )}
                {bundle.fileName && (
                    <span style={{ fontSize: 11, color: T.textMuted, fontStyle: 'italic' }}>
                        {bundle.fileName}
                    </span>
                )}
            </div>

            {/* Structure rule */}
            <div style={{ marginTop: 5, fontSize: 11, color: T.textMuted }}>
                Order: {
                    bundle.structureRule === 'supreme_court'
                        ? 'SC Format (Rules 2013)'
                        : bundle.structureRule === 'chronological'
                        ? 'Chronological'
                        : 'Custom'
                }
                {bundle.batesPrefix && (
                    <span style={{ marginLeft: 8 }}>· Bates: {bundle.batesPrefix}_0001…</span>
                )}
            </div>

            {/* Generation date */}
            {bundle.generatedAt && (
                <div style={{ marginTop: 4, fontSize: 11, color: T.textMuted }}>
                    Generated: {fmtDate(bundle.generatedAt)}
                </div>
            )}

            {/* Error */}
            {genError && (
                <div style={{ marginTop: 6, fontSize: 12, color: '#EF4444' }}>{genError}</div>
            )}

            {/* Version history */}
            {bundle.versionHistory.length > 0 && (
                <details style={{ marginTop: 8 }}>
                    <summary style={{ fontSize: 11, color: T.textMuted, cursor: 'pointer', userSelect: 'none' }}>
                        Version history ({bundle.versionHistory.length})
                    </summary>
                    <div style={{ paddingTop: 6, paddingLeft: 8 }}>
                        {bundle.versionHistory.map((v) => (
                            <div key={v.version} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                <span style={{ fontSize: 11, color: T.textMuted }}>v{v.version}</span>
                                <span style={{ fontSize: 11, color: T.textMuted }}>{fmtDate(v.generatedAt)}</span>
                                {v.downloadUrl && (
                                    <a
                                        href={v.downloadUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        style={{ fontSize: 11, color: '#2A7BD4', textDecoration: 'none' }}
                                    >
                                        Download
                                    </a>
                                )}
                            </div>
                        ))}
                    </div>
                </details>
            )}
        </div>
    );
}

// ─── GENERATE MODAL (type + structure selection) ──────────────────────────────

function GenerateSetupModal({
    onConfirm,
    onClose,
    T,
}: {
    onConfirm: (type: BundleType, rule: StructureRule, opts: any) => void;
    onClose: () => void;
    T: any;
}) {
    const [bundleType, setBundleType]       = useState<BundleType>('court');
    const [structureRule, setStructureRule]  = useState<StructureRule>('supreme_court');
    const [batesPrefix, setBatesPrefix]     = useState('');
    const [batesStart, setBatesStart]       = useState(1);
    const [assocPerm, setAssocPerm]         = useState(false);

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 1100,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={onClose}>
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    background: T.bg,
                    border: `1px solid ${T.border}`,
                    borderRadius: 14,
                    padding: '24px 26px',
                    width: 420,
                    maxWidth: '95vw',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
                }}
            >
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                    <div style={{
                        width: 32, height: 32, borderRadius: 9,
                        background: 'linear-gradient(135deg,#1A2E5E,#0F1C3F)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 17,
                    }}>
                        📁
                    </div>
                    <div>
                        <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>Generate Filing Bundle</div>
                        <div style={{ fontSize: 12, color: T.textMuted }}>Configure bundle options</div>
                    </div>
                </div>

                {/* Bundle type */}
                <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8 }}>
                        Bundle Type
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        {(['court', 'master'] as BundleType[]).map((t) => (
                            <button
                                key={t}
                                onClick={() => setBundleType(t)}
                                style={{
                                    flex: 1,
                                    padding: '8px 10px',
                                    borderRadius: 8,
                                    border: `2px solid ${bundleType === t ? '#1A2E5E' : T.border}`,
                                    background: bundleType === t ? '#1A2E5E12' : T.bg,
                                    color: bundleType === t ? '#1A2E5E' : T.textSub,
                                    fontSize: 13,
                                    fontWeight: bundleType === t ? 700 : 500,
                                    cursor: 'pointer',
                                    textAlign: 'center',
                                }}
                            >
                                {t === 'court' ? '⚖️ Court Filing\n(Paper Book)' : '📦 Master Bundle\n(Internal)'}
                            </button>
                        ))}
                    </div>
                    <div style={{ marginTop: 6, fontSize: 11, color: T.textMuted }}>
                        {bundleType === 'court'
                            ? 'Clean, SC-formatted filing. Only finalised documents.'
                            : 'Comprehensive internal copy. All documents including drafts.'}
                    </div>
                </div>

                {/* Structure rule */}
                <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8 }}>
                        Document Order
                    </div>
                    <select
                        value={structureRule}
                        onChange={(e) => setStructureRule(e.target.value as StructureRule)}
                        style={{
                            width: '100%', padding: '8px 10px', borderRadius: 8,
                            border: `1px solid ${T.border}`, background: T.bg,
                            color: T.text, fontSize: 13, outline: 'none',
                        }}
                    >
                        <option value="supreme_court">Supreme Court Format (default — Rules 2013)</option>
                        <option value="chronological">Chronological (by date)</option>
                        <option value="custom">Custom (drag-and-drop in next step)</option>
                    </select>
                </div>

                {/* Bates prefix */}
                <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8 }}>
                        Bates Number Prefix <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <input
                            value={batesPrefix}
                            onChange={(e) => setBatesPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                            placeholder="e.g. SLP2024"
                            style={{
                                flex: 1, padding: '7px 10px', borderRadius: 8,
                                border: `1px solid ${T.border}`, background: T.bg,
                                color: T.text, fontSize: 13, outline: 'none',
                            }}
                        />
                        <input
                            type="number"
                            min={1}
                            value={batesStart}
                            onChange={(e) => setBatesStart(Math.max(1, parseInt(e.target.value) || 1))}
                            style={{
                                width: 80, padding: '7px 10px', borderRadius: 8,
                                border: `1px solid ${T.border}`, background: T.bg,
                                color: T.text, fontSize: 13, outline: 'none',
                                textAlign: 'center',
                            }}
                        />
                    </div>
                    {batesPrefix && (
                        <div style={{ marginTop: 4, fontSize: 11, color: T.textMuted }}>
                            Preview: <strong>{batesPrefix}_{String(batesStart).padStart(7, '0')}</strong>
                        </div>
                    )}
                </div>

                {/* Associate permission */}
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, cursor: 'pointer' }}>
                    <input
                        type="checkbox"
                        checked={assocPerm}
                        onChange={(e) => setAssocPerm(e.target.checked)}
                        style={{ width: 15, height: 15, accentColor: '#1A2E5E' }}
                    />
                    <span style={{ fontSize: 13, color: T.text }}>Allow Associates to edit this bundle</span>
                </label>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button onClick={onClose} style={{
                        padding: '8px 16px', borderRadius: 8, border: `1px solid ${T.border}`,
                        background: T.bg, color: T.textSub, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    }}>
                        Cancel
                    </button>
                    <button
                        onClick={() => onConfirm(bundleType, structureRule, {
                            batesPrefix, batesStartNumber: batesStart, associatePermission: assocPerm,
                        })}
                        style={{
                            padding: '8px 18px', borderRadius: 8, border: 'none',
                            background: 'linear-gradient(135deg,#C9A84C,#9B7B28)',
                            color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                        }}
                    >
                        Check Documents →
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── MAIN SECTION ─────────────────────────────────────────────────────────────

export function FilingBundleSection({ selected }: FilingBundleSectionProps) {
    const { T } = useApp();
    const [open, setOpen]                   = useState(false);
    const [bundles, setBundles]             = useState<FilingBundle[]>([]);
    const [loading, setLoading]             = useState(false);
    const [userCanEdit, setUserCanEdit]     = useState(false);

    // Modals
    const [showSetup, setShowSetup]         = useState(false);
    const [assemblyBundle, setAssemblyBundle] = useState<FilingBundle | null>(null);
    const [assemblyDocs, setAssemblyDocs]   = useState<AggregatedDocument[]>([]);
    const [creating, setCreating]           = useState(false);
    const [createError, setCreateError]     = useState('');

    // Missing-items confirmation (shown after check, before assembly modal)
    const [pendingConfirm, setPendingConfirm] = useState<{
        bundle: FilingBundle;
        aggDocs: AggregatedDocument[];
        availableCount: number;
        missingCount: number;
    } | null>(null);

    // Load bundles when section opens
    useEffect(() => {
        if (!open || !selected?.id) return;
        setLoading(true);
        Promise.all([
            loadBundlesForCase(selected.id),
            // Check edit permission using first bundle (AOR check is role-level)
            loadBundlesForCase(selected.id).then((bs) =>
                bs.length > 0
                    ? canUserEditBundle(bs[0])
                    : canUserEditBundle({ associatePermission: false } as FilingBundle)
            ),
        ]).then(([bs, canEdit]) => {
            setBundles(bs);
            setUserCanEdit(canEdit);
            setLoading(false);
        });
    }, [open, selected?.id]);

    // Also check edit permission on mount (for CTA display)
    useEffect(() => {
        canUserEditBundle({ associatePermission: true } as FilingBundle).then(setUserCanEdit);
    }, []);

    const handleConfirmSetup = useCallback(
        async (type: BundleType, rule: StructureRule, opts: any) => {
            setShowSetup(false);
            setCreating(true);
            setCreateError('');

            try {
                const aggDocs = await aggregateDocumentSources(selected);
                const newBundle = await createFilingBundle(selected, type, rule, opts);
                if (!newBundle) {
                    setCreateError('Failed to create bundle. Please try again.');
                    setCreating(false);
                    return;
                }
                setBundles((prev) => [newBundle, ...prev]);

                // Show missing-items confirmation before opening assembly modal
                const availableCount = aggDocs.filter((d) => d.isAvailable).length;
                const missingCount   = aggDocs.filter((d) => !d.isAvailable).length;
                setPendingConfirm({ bundle: newBundle, aggDocs, availableCount, missingCount });
            } catch (err) {
                setCreateError('An error occurred. Please try again.');
                console.error('[FilingBundle] handleConfirmSetup error', err);
            } finally {
                setCreating(false);
            }
        },
        [selected]
    );

    const handleProceedToAssembly = useCallback(() => {
        if (!pendingConfirm) return;
        setAssemblyDocs(pendingConfirm.aggDocs);
        setAssemblyBundle(pendingConfirm.bundle);
        setPendingConfirm(null);
    }, [pendingConfirm]);

    const handleRegenerate = useCallback(async (bundle: FilingBundle) => {
        const aggDocs = await aggregateDocumentSources(selected);
        setAssemblyDocs(aggDocs);
        setAssemblyBundle(bundle);
    }, [selected]);

    const handleModalClose = useCallback((updatedBundle?: FilingBundle) => {
        setAssemblyBundle(null);
        if (updatedBundle) {
            setBundles((prev) =>
                prev.map((b) => b.id === updatedBundle.id ? updatedBundle : b)
            );
        }
    }, []);

    const courtBundle  = bundles.find((b) => b.bundleType === 'court');
    const masterBundle = bundles.find((b) => b.bundleType === 'master');
    const totalMissing = bundles.reduce((sum, b) => sum + b.missingDocuments.length, 0);

    return (
        <>
            {/* Section wrapper */}
            <div style={{
                background: T.bg,
                borderRadius: 12,
                border: `1px solid ${totalMissing > 0 ? '#C9A84C40' : T.border}`,
                padding: '14px 16px',
                boxShadow: '0 1px 4px rgba(15,28,63,0.08)',
                marginBottom: 10,
            }}>
                {/* Header (clickable) */}
                <div
                    onClick={() => setOpen((o) => !o)}
                    style={{
                        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                        gap: 12, marginBottom: open ? 12 : 0, cursor: 'pointer', userSelect: 'none',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flex: 1, minWidth: 0 }}>
                        <SectionIconBox icon="📁" />
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 800, color: T.text, letterSpacing: 0.8, marginBottom: 3 }}>
                                FILING BUNDLES
                            </div>
                            <div style={{ fontSize: 14, color: T.textMuted }}>
                                {bundles.length === 0
                                    ? 'Paper Book & Master Bundle generator'
                                    : `${bundles.length} bundle${bundles.length > 1 ? 's' : ''} · ${
                                          courtBundle ? (courtBundle.status === 'final' ? 'Court bundle ready' : 'Court bundle draft') : 'No court bundle'
                                      }${totalMissing > 0 ? ` · ⚠ ${totalMissing} missing` : ''}`}
                            </div>
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        {totalMissing > 0 && (
                            <span style={{
                                background: '#C9A84C18', color: '#C9A84C',
                                fontSize: 11, fontWeight: 700,
                                padding: '2px 8px', borderRadius: 12,
                                border: '1px solid #C9A84C30',
                            }}>
                                ⚠ {totalMissing} missing
                            </span>
                        )}
                        <span style={{
                            fontSize: 11, color: T.textMuted,
                            transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
                            transition: 'transform 0.2s',
                            display: 'inline-block',
                        }}>▼</span>
                    </div>
                </div>

                {/* Expanded content */}
                {open && (
                    <div>
                        {loading && (
                            <div style={{ textAlign: 'center', padding: '20px 0', color: T.textMuted, fontSize: 13 }}>
                                Loading bundles…
                            </div>
                        )}

                        {!loading && (
                            <>
                                {/* Existing bundles */}
                                {bundles.length > 0 && (
                                    <div style={{ marginBottom: 14 }}>
                                        {bundles.map((b) => (
                                            <BundleCard
                                                key={b.id}
                                                bundle={b}
                                                caseObj={selected}
                                                onRegenerate={handleRegenerate}
                                                canEdit={userCanEdit}
                                                T={T}
                                            />
                                        ))}
                                    </div>
                                )}

                                {/* Empty state */}
                                {bundles.length === 0 && (
                                    <div style={{
                                        textAlign: 'center', padding: '16px 0',
                                        color: T.textMuted, fontSize: 13, marginBottom: 14,
                                    }}>
                                        No bundles yet. Generate your first filing bundle below.
                                    </div>
                                )}

                                {/* Error */}
                                {createError && (
                                    <div style={{ marginBottom: 10, fontSize: 12, color: '#EF4444' }}>
                                        {createError}
                                    </div>
                                )}

                                {/* CTA buttons — role-gated */}
                                {userCanEdit ? (
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                        <button
                                            onClick={() => setShowSetup(true)}
                                            disabled={creating}
                                            style={{
                                                flex: 1,
                                                padding: '10px 16px',
                                                borderRadius: 9,
                                                border: 'none',
                                                background: creating ? '#888' : 'linear-gradient(135deg,#C9A84C,#9B7B28)',
                                                color: '#fff',
                                                fontSize: 13,
                                                fontWeight: 700,
                                                cursor: creating ? 'not-allowed' : 'pointer',
                                                boxShadow: '0 2px 8px rgba(201,168,76,0.3)',
                                            }}
                                        >
                                            {creating ? 'Checking documents…' : '+ Generate Filing Bundle'}
                                        </button>
                                        {courtBundle && !masterBundle && (
                                            <button
                                                onClick={() => setShowSetup(true)}
                                                style={{
                                                    padding: '10px 14px',
                                                    borderRadius: 9,
                                                    border: `1px solid ${T.border}`,
                                                    background: T.bg,
                                                    color: T.text,
                                                    fontSize: 13,
                                                    fontWeight: 600,
                                                    cursor: 'pointer',
                                                }}
                                            >
                                                + Master Bundle
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <div style={{
                                        padding: '10px 14px',
                                        borderRadius: 9,
                                        background: `${T.textMuted}12`,
                                        fontSize: 13,
                                        color: T.textMuted,
                                        textAlign: 'center',
                                    }}>
                                        Bundle generation requires AOR permission. Contact your AOR to generate or edit bundles.
                                    </div>
                                )}

                                {/* Info note */}
                                <div style={{ marginTop: 10, fontSize: 11, color: T.textMuted, lineHeight: 1.5 }}>
                                    Bundles aggregate documents from all sources: uploads, WhatsApp, court orders, office reports, and AI-detected requirements.
                                    Missing documents are flagged and auto-added once received.
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Generate setup modal */}
            {showSetup && (
                <GenerateSetupModal
                    onConfirm={handleConfirmSetup}
                    onClose={() => setShowSetup(false)}
                    T={T}
                />
            )}

            {/* Missing-items confirmation */}
            {pendingConfirm && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 1100,
                    background: 'rgba(0,0,0,0.55)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }} onClick={() => setPendingConfirm(null)}>
                    <div onClick={(e) => e.stopPropagation()} style={{
                        background: T.bg, border: `1px solid ${T.border}`,
                        borderRadius: 14, padding: '24px 26px', width: 420, maxWidth: '95vw',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
                    }}>
                        <div style={{ fontSize: 15, fontWeight: 800, color: T.text, marginBottom: 6 }}>
                            Document Check Complete
                        </div>
                        <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 16 }}>
                            System found the following documents for this bundle:
                        </div>
                        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                            <div style={{
                                flex: 1, padding: '12px 14px', borderRadius: 9,
                                background: '#1A8C5B12', border: '1px solid #1A8C5B30', textAlign: 'center',
                            }}>
                                <div style={{ fontSize: 22, fontWeight: 800, color: '#1A8C5B' }}>{pendingConfirm.availableCount}</div>
                                <div style={{ fontSize: 11, color: '#1A8C5B', fontWeight: 600 }}>Documents Ready</div>
                            </div>
                            {pendingConfirm.missingCount > 0 && (
                                <div style={{
                                    flex: 1, padding: '12px 14px', borderRadius: 9,
                                    background: '#EF444412', border: '1px solid #EF444430', textAlign: 'center',
                                }}>
                                    <div style={{ fontSize: 22, fontWeight: 800, color: '#EF4444' }}>{pendingConfirm.missingCount}</div>
                                    <div style={{ fontSize: 11, color: '#EF4444', fontWeight: 600 }}>Missing — Placeholder pages will be added</div>
                                </div>
                            )}
                        </div>
                        {pendingConfirm.missingCount > 0 && (
                            <div style={{
                                padding: '10px 12px', borderRadius: 8,
                                background: '#C9A84C12', border: '1px solid #C9A84C30',
                                fontSize: 12, color: '#9B7B28', marginBottom: 16, lineHeight: 1.5,
                            }}>
                                ⚠ Missing documents will appear as placeholder pages. Tasks will be auto-created to follow up.
                            </div>
                        )}
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={() => setPendingConfirm(null)} style={{
                                flex: 1, padding: '10px', borderRadius: 8,
                                border: `1px solid ${T.border}`, background: T.bg,
                                color: T.textSub, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                            }}>Cancel</button>
                            <button onClick={handleProceedToAssembly} style={{
                                flex: 2, padding: '10px', borderRadius: 8, border: 'none',
                                background: 'linear-gradient(135deg,#1A2E5E,#0F1C3F)',
                                color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                            }}>Arrange &amp; Generate PDF →</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Assembly / drag-drop modal */}
            {assemblyBundle && (
                <FilingBundleModal
                    bundle={assemblyBundle}
                    caseObj={selected}
                    aggregatedDocs={assemblyDocs}
                    onClose={handleModalClose}
                />
            )}
        </>
    );
}
