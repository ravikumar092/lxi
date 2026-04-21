import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../../AppContext';
import type { HearingBrief, ActionItem } from '../../types/hearingPrep';
import {
  runHearingPrep,
  loadHearingBrief,
} from '../../services/hearingPrepService';
import {
  getDeliveryStatusLabel,
  getDeliveryStatusColor,
  getDeliveryStatusBg,
  trackConsignment,
} from '../../services/serviceTrackingService';

interface Props {
  selected: any;                  // the case object
  hearingDate: string;            // ISO date from listing
  onUpdate: (c: any) => void;
}

// ── PRIORITY COLOURS ──────────────────────────────────────────────────────────
const PRIORITY_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  critical: { bg: '#FEF2F2', text: '#991B1B', label: '🔴 Critical' },
  high:     { bg: '#FFF7ED', text: '#9A3412', label: '🟠 High' },
  medium:   { bg: '#FEFCE8', text: '#854D0E', label: '🟡 Medium' },
  low:      { bg: '#F0F9FF', text: '#075985', label: '🔵 Low' },
};

const CATEGORY_ICON: Record<string, string> = {
  service:     '📬',
  pleadings:   '📝',
  ia:          '📋',
  preparation: '⚖️',
  appearance:  '👤',
};

// ── READINESS RING ────────────────────────────────────────────────────────────
function ReadinessRing({ score }: { score: number }) {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - score / 100);
  const color = score >= 75 ? '#1A8C5B' : score >= 50 ? '#C9A84C' : '#C62828';

  return (
    <svg width="72" height="72" viewBox="0 0 72 72">
      <circle cx="36" cy="36" r={r} fill="none" stroke="#E5E7EB" strokeWidth="6" />
      <circle
        cx="36" cy="36" r={r}
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 36 36)"
        style={{ transition: 'stroke-dashoffset 0.6s ease' }}
      />
      <text x="36" y="39" textAnchor="middle" fontSize="14" fontWeight="700" fill={color}>{score}%</text>
    </svg>
  );
}

// ── TRACKING NUMBER INPUT ─────────────────────────────────────────────────────
function TrackingInput({
  respondentName: _respondentName,
  current,
  onSave,
  T,
}: {
  respondentName: string;
  current: string | null;
  onSave: (v: string) => void;
  T: any;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
}) {
  const [val, setVal] = useState(current ?? '');
  const [saved, setSaved] = useState(false);

  function save() {
    onSave(val.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="Speed post tracking no. (e.g. EW123456789IN)"
        style={{
          flex: 1, padding: '5px 9px', borderRadius: 7,
          border: `1px solid ${T.border}`, fontSize: 12,
          color: T.text, outline: 'none', background: T.bg,
          fontFamily: 'monospace',
        }}
      />
      <button
        onClick={save}
        style={{
          padding: '5px 12px', borderRadius: 7, border: 'none',
          background: saved ? '#1A8C5B' : '#1A2E5E', color: '#fff',
          fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        {saved ? '✓ Saved' : 'Save'}
      </button>
    </div>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function HearingBriefPanel({ selected, hearingDate, onUpdate }: Props) {
  const { T } = useApp();
  const [brief, setBrief] = useState<HearingBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [progressDone, setProgressDone] = useState(0);
  const [progressTotal, setProgressTotal] = useState(5);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'actions' | 'service' | 'order' | 'ias'>('actions');

  // Load existing brief on mount
  useEffect(() => {
    loadHearingBrief(selected.id).then((existing) => {
      if (existing) setBrief(existing);
    });
  }, [selected.id]);

  const runPrep = useCallback(async () => {
    setLoading(true);
    setProgressDone(0);
    try {
      const result = await runHearingPrep(selected, hearingDate, {
        onProgress: (step: string, done: number, total: number) => {
          setProgressMsg(step);
          setProgressDone(done);
          setProgressTotal(total);
        },
      });
      setBrief(result);

      // Persist respondents back into case so tracking numbers survive reload
      if (result.officeReport?.respondents) {
        onUpdate({
          ...selected,
          respondents: result.officeReport.respondents,
          hearingCourtNo: result.courtNo,
          hearingItemNo: result.itemNo,
        });
      }
    } catch (err) {
      console.error('[HearingBriefPanel] runPrep failed:', err);
    } finally {
      setLoading(false);
      setProgressMsg('');
    }
  }, [selected, hearingDate, onUpdate]);

  // ── Save tracking number for a respondent and re-track ───────────────────
  async function saveTrackingNumber(respondentName: string, trackingNo: string) {
    if (!brief?.officeReport) return;
    const updated = brief.officeReport.respondents.map((r) =>
      r.name === respondentName ? { ...r, trackingNumber: trackingNo } : r
    );

    // Immediately track this one
    if (trackingNo) {
      const result = await trackConsignment(trackingNo);
      const idx = updated.findIndex((r) => r.name === respondentName);
      if (idx >= 0) {
        updated[idx] = {
          ...updated[idx],
          deliveryStatus: result.status,
          deliveryDate: result.deliveryDate,
          deliveryLocation: result.currentLocation,
          lastTrackingEvent: result.lastEvent,
          lastTrackedAt: result.checkedAt,
        };
      }
    }

    const newBrief = {
      ...brief,
      officeReport: { ...brief.officeReport, respondents: updated },
    };
    setBrief(newBrief);
    onUpdate({ ...selected, respondents: updated });
  }

  const toggleItem = (id: string) =>
    setExpandedItems((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  // ── RENDER: loading ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ background: T.surface, borderRadius: 12, border: `1px solid ${T.border}`, padding: 24, marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: T.text, letterSpacing: 0.8, marginBottom: 16 }}>⚙️ PREPARING HEARING BRIEF</div>
        <div style={{ width: '100%', height: 6, background: T.border, borderRadius: 3, marginBottom: 12, overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 3,
            background: 'linear-gradient(90deg,#1A2E5E,#C9A84C)',
            width: `${(progressDone / progressTotal) * 100}%`,
            transition: 'width 0.4s ease',
          }} />
        </div>
        <div style={{ fontSize: 13, color: T.textMuted }}>{progressMsg || 'Starting…'}</div>
        <div style={{ fontSize: 12, color: T.textMuted, marginTop: 4 }}>{progressDone} of {progressTotal} steps complete</div>
      </div>
    );
  }

  // ── RENDER: empty state ──────────────────────────────────────────────────
  if (!brief) {
    const daysUntil = Math.ceil(
      (new Date(hearingDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    return (
      <div style={{
        background: 'linear-gradient(135deg,#F0F4FF,#EEF2FF)',
        borderRadius: 12, border: `1px solid #C7D2FE`, padding: 24, marginBottom: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ fontSize: 32 }}>📋</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#1A2E5E', marginBottom: 6 }}>
              Hearing in {daysUntil} days — Brief not generated yet
            </div>
            <div style={{ fontSize: 13, color: '#4B5563', marginBottom: 16, lineHeight: 1.6 }}>
              Generate your pre-hearing brief now. The app will fetch the latest office report,
              track service status, pull all IAs, and create AI-generated action tasks —
              weeks before the hearing, not the day before.
            </div>
            <button
              onClick={runPrep}
              style={{
                padding: '9px 20px', borderRadius: 9, border: 'none',
                background: 'linear-gradient(135deg,#1A2E5E,#2A4B9B)',
                color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}
            >
              ✦ Generate Pre-Hearing Brief
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── RENDER: brief exists ─────────────────────────────────────────────────
  const { readinessScore, actionItems, officeReport } = brief;
  const criticalCount = actionItems.filter((a) => a.priority === 'critical').length;

  // Tabs
  const TAB_STYLE = (active: boolean): React.CSSProperties => ({
    padding: '6px 14px', borderRadius: 7, border: 'none',
    background: active ? '#1A2E5E' : 'transparent',
    color: active ? '#fff' : T.textMuted,
    fontSize: 12, fontWeight: 700, cursor: 'pointer',
  });

  return (
    <div style={{ background: T.surface, borderRadius: 12, border: `1px solid ${T.border}`, marginBottom: 10, overflow: 'hidden' }}>

      {/* ── Header ── */}
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 14 }}>
        <ReadinessRing score={readinessScore} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: T.text, letterSpacing: 0.8 }}>PRE-HEARING BRIEF</div>
          <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>
            Generated {new Date(brief.generatedAt).toLocaleString('en-IN')} ·
            Hearing {hearingDate}
            {brief.courtNo ? ` · Court ${brief.courtNo}` : ''}
            {brief.itemNo ? ` · Item ${brief.itemNo}` : ''}
          </div>
          {criticalCount > 0 && (
            <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 5, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, padding: '3px 9px' }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: '#991B1B' }}>🚨 {criticalCount} critical issue{criticalCount > 1 ? 's' : ''} need attention</span>
            </div>
          )}
        </div>
        <button
          onClick={runPrep}
          title="Regenerate brief"
          style={{ padding: '6px 12px', borderRadius: 7, border: `1px solid ${T.border}`, background: T.bg, color: T.textSub, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          ↻ Refresh
        </button>
      </div>

      {/* ── Tab Bar ── */}
      <div style={{ padding: '8px 16px', display: 'flex', gap: 4, borderBottom: `1px solid ${T.border}` }}>
        <button style={TAB_STYLE(activeTab === 'actions')} onClick={() => setActiveTab('actions')}>
          Action Items {actionItems.length > 0 ? `(${actionItems.length})` : ''}
        </button>
        <button style={TAB_STYLE(activeTab === 'service')} onClick={() => setActiveTab('service')}>
          Service Status
        </button>
        <button style={TAB_STYLE(activeTab === 'order')} onClick={() => setActiveTab('order')}>
          Last Order
        </button>
        {officeReport && officeReport.iaList.length > 0 && (
          <button style={TAB_STYLE(activeTab === 'ias')} onClick={() => setActiveTab('ias')}>
            IAs ({officeReport.iaList.length})
          </button>
        )}
      </div>

      {/* ── Tab: Action Items ── */}
      {activeTab === 'actions' && (
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {actionItems.length === 0 && (
            <div style={{ textAlign: 'center', color: T.textMuted, fontSize: 13, padding: 20 }}>
              ✅ No action items — case appears ready for hearing.
            </div>
          )}
          {actionItems.map((item: ActionItem) => {
            const ps = PRIORITY_STYLE[item.priority];
            const expanded = expandedItems.has(item.id);
            return (
              <div
                key={item.id}
                style={{ background: ps.bg, borderRadius: 8, border: `1px solid ${ps.text}22`, overflow: 'hidden' }}
              >
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer' }}
                  onClick={() => toggleItem(item.id)}
                >
                  <span style={{ fontSize: 16 }}>{CATEGORY_ICON[item.category] ?? '•'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: ps.text }}>{item.title}</div>
                    {!expanded && (
                      <div style={{ fontSize: 12, color: ps.text, opacity: 0.8, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.detail}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: ps.text, opacity: 0.9 }}>{ps.label}</span>
                    <span style={{ color: ps.text, fontSize: 12 }}>{expanded ? '▲' : '▼'}</span>
                  </div>
                </div>
                {expanded && (
                  <div style={{ padding: '0 12px 12px', fontSize: 13, color: ps.text, lineHeight: 1.6 }}>
                    {item.detail}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Tab: Service Status ── */}
      {activeTab === 'service' && (
        <div style={{ padding: 16 }}>
          {!officeReport && (
            <div style={{ color: T.textMuted, fontSize: 13, textAlign: 'center', padding: 20 }}>
              Office report could not be fetched. Enter tracking numbers manually below.
            </div>
          )}

          {/* Overall service badge */}
          {officeReport && (
            <div style={{
              marginBottom: 12, padding: '8px 12px', borderRadius: 8,
              background: officeReport.serviceComplete ? '#E8F5EF' : '#FEF2F2',
              border: `1px solid ${officeReport.serviceComplete ? '#A0D4BB' : '#FECACA'}`,
              fontSize: 13, fontWeight: 700,
              color: officeReport.serviceComplete ? '#1A8C5B' : '#991B1B',
            }}>
              {officeReport.serviceComplete ? '✅ Service complete on all respondents' : '⚠️ Service not complete — matter may not proceed'}
            </div>
          )}

          {/* Per-respondent cards */}
          {(officeReport?.respondents ?? [{ name: 'Respondent(s)', trackingNumber: null, serviceStatus: 'Unknown', deliveryStatus: 'unknown', noticeIssuedOn: null, noticeServedOn: null, remarks: '', vakalatnama: null, counterAffidavit: null, rejoinder: null, deliveryDate: null, deliveryLocation: null, lastTrackingEvent: null, lastTrackedAt: null }]).map((r, i) => (
            <div key={i} style={{ background: T.bg, borderRadius: 10, border: `1px solid ${T.border}`, padding: 14, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: T.text }}>{r.name}</div>
                  {r.noticeIssuedOn && (
                    <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>
                      Notice issued: {r.noticeIssuedOn}
                      {r.noticeServedOn ? ` · Served: ${r.noticeServedOn}` : ''}
                    </div>
                  )}
                  {r.remarks && (
                    <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2, fontStyle: 'italic' }}>{r.remarks}</div>
                  )}
                </div>
                <div style={{
                  padding: '3px 10px', borderRadius: 20,
                  background: getDeliveryStatusBg(r.deliveryStatus),
                  color: getDeliveryStatusColor(r.deliveryStatus),
                  fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
                }}>
                  {getDeliveryStatusLabel(r.deliveryStatus)}
                </div>
              </div>

              {/* Pleadings row */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                {[
                  { label: 'Vakalatnama', val: r.vakalatnama },
                  { label: 'Counter Affidavit', val: r.counterAffidavit },
                  { label: 'Rejoinder', val: r.rejoinder },
                ].map(({ label, val }) => (
                  <div key={label} style={{
                    padding: '3px 9px', borderRadius: 6,
                    background: val && val !== 'Not filed' && val !== 'No appearance' ? '#E8F5EF' : '#F3F4F6',
                    border: `1px solid ${val && val !== 'Not filed' ? '#A0D4BB' : T.border}`,
                    fontSize: 11, fontWeight: 700,
                    color: val && val !== 'Not filed' && val !== 'No appearance' ? '#1A8C5B' : '#6B7280',
                  }}>
                    {label}: {val ?? 'Not filed'}
                  </div>
                ))}
              </div>

              {/* Tracking number input */}
              <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: 0.7, marginBottom: 4 }}>SPEED POST TRACKING</div>
                <TrackingInput
                  respondentName={r.name}
                  current={r.trackingNumber}
                  onSave={(v) => saveTrackingNumber(r.name, v)}
                  T={T}
                />
                {r.lastTrackingEvent && (
                  <div style={{ fontSize: 12, color: T.textMuted, marginTop: 6 }}>
                    Last event: {r.lastTrackingEvent}
                    {r.deliveryLocation ? ` · ${r.deliveryLocation}` : ''}
                    {r.lastTrackedAt ? ` · checked ${new Date(r.lastTrackedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : ''}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Tab: Last Order ── */}
      {activeTab === 'order' && (
        <div style={{ padding: 16 }}>
          {officeReport?.lastOrderDate && (
            <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 10 }}>
              Order dated: {officeReport.lastOrderDate}
            </div>
          )}
          <div style={{
            background: '#F8F9FD', borderRadius: 10, border: `1px solid ${T.border}`,
            padding: 16, fontSize: 14, color: T.text, lineHeight: 1.8,
            fontStyle: 'italic', whiteSpace: 'pre-wrap',
          }}>
            {officeReport?.lastOrderText || 'No order text could be extracted from the office report.'}
          </div>
          {officeReport?.specialRemarks && officeReport.specialRemarks.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: T.textMuted, letterSpacing: 0.8, marginBottom: 8 }}>REGISTRAR REMARKS</div>
              {officeReport.specialRemarks.map((r, i) => (
                <div key={i} style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#92400E', marginBottom: 6 }}>
                  {r}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: IAs ── */}
      {activeTab === 'ias' && officeReport && (
        <div style={{ padding: 16 }}>
          {officeReport.iaList.length === 0 ? (
            <div style={{ color: T.textMuted, fontSize: 13, textAlign: 'center', padding: 20 }}>No interlocutory applications listed.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {officeReport.iaList.map((ia, i) => (
                <div key={i} style={{ background: T.bg, borderRadius: 9, border: `1px solid ${T.border}`, padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>IA No. {ia.iaNo}</div>
                    <div style={{ fontSize: 12, color: T.textMuted }}>{ia.filedOn ?? 'Date unknown'}</div>
                  </div>
                  <div style={{ fontSize: 12, color: T.textSub }}>{ia.description}</div>
                  <div style={{ fontSize: 12, color: T.textMuted, marginTop: 4 }}>Filed by: {ia.aorName}</div>
                </div>
              ))}
            </div>
          )}
          {officeReport.taggedCases.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: T.textMuted, letterSpacing: 0.8, marginBottom: 8 }}>TAGGED / SIMILAR CASES</div>
              {officeReport.taggedCases.map((tc, i) => (
                <div key={i} style={{ background: T.bg, borderRadius: 9, border: `1px solid ${T.border}`, padding: 12, marginBottom: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{tc.caseNo}</div>
                  <div style={{ fontSize: 12, color: T.textSub }}>{tc.petitioner}</div>
                  <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>Status: {tc.status} {tc.remarks ? `· ${tc.remarks}` : ''}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}