import { useState, useEffect } from 'react';
import { useApp } from '../AppContext';
import { loadCases } from '../services/supabaseCasesService';
import {
  loadAllHearingBriefs,
  runHearingPrep,
  getCasesNeedingPrep,
  saveHearingBrief,
} from '../services/hearingPrepService';
import {
  trackConsignment,
  getDeliveryStatusLabel,
  getDeliveryStatusColor,
  getDeliveryStatusBg,
} from '../services/serviceTrackingService';
import {
  fetchTomorrowCauseList,
  matchCasesInCauseList,
  shouldFetchCauseList,
} from '../services/causeListService';
import type { HearingBrief } from '../types/hearingPrep';

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function getUpcomingHearing(caseObj: any): string | null {
  const listings: any[] = caseObj.listings ?? [];
  const future = listings
    .filter((l: any) => new Date(l.date) >= new Date())
    .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return future[0]?.date ?? null;
}

function urgencyColor(days: number): string {
  if (days <= 1) return '#C62828';
  if (days <= 3) return '#E65100';
  if (days <= 7) return '#C9A84C';
  return '#1A8C5B';
}

export default function ServiceStatus() {
  const { T } = useApp();
  const [cases, setCases] = useState<any[]>([]);
  const [briefs, setBriefs] = useState<Record<string, HearingBrief>>({});
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [causeListMsg, setCauseListMsg] = useState('');
  const [filter, setFilter] = useState<'upcoming' | 'all'>('upcoming');
  const [editingTracking, setEditingTracking] = useState<string | null>(null);
  const [trackingInputs, setTrackingInputs] = useState<Record<string, string>>({});

  useEffect(() => {
    loadCases().then((allCases) => {
      setCases(allCases);
    });
    loadAllHearingBriefs().then(setBriefs);
    if (shouldFetchCauseList()) {
      setCauseListMsg('Checking tomorrow\'s cause list…');
      fetchTomorrowCauseList().then((entries) => {
        if (entries.length > 0) {
          const matches = matchCasesInCauseList(allCases, entries);
          const count = Object.keys(matches).length;
          setCauseListMsg(count > 0
            ? `\u2705 ${count} case(s) found in tomorrow's cause list`
            : 'Cause list fetched — none of your cases listed tomorrow');
        } else {
          setCauseListMsg('Could not fetch cause list (add /sci-causelist proxy to vite.config.ts)');
        }
      });
    }
  }, []);

  const displayCases = cases
    .filter((c: any) => filter === 'all' || getUpcomingHearing(c) !== null)
    .sort((a, b) => {
      const da = getUpcomingHearing(a);
      const db = getUpcomingHearing(b);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return new Date(da).getTime() - new Date(db).getTime();
    });

  const needsPrep = getCasesNeedingPrep(cases);

  async function handleGenerateBrief(caseObj: any) {
    const hearingDate = getUpcomingHearing(caseObj);
    if (!hearingDate) return;
    setGeneratingFor(caseObj.id);
    try {
      const brief = await runHearingPrep(caseObj, hearingDate, { skipAI: false });
      setBriefs((prev) => ({ ...prev, [caseObj.id]: brief }));
    } finally {
      setGeneratingFor(null);
    }
  }

  async function handleSaveTracking(caseId: string, respondentKey: string, respondentName: string) {
    const trackingNo = (trackingInputs[respondentKey] ?? '').trim();
    if (!trackingNo) return;
    const result = await trackConsignment(trackingNo);
    const brief = briefs[caseId];
    if (!brief?.officeReport) return;
    const updatedRespondents = brief.officeReport.respondents.map((r) =>
      r.name === respondentName
        ? { ...r, trackingNumber: trackingNo, deliveryStatus: result.status, deliveryDate: result.deliveryDate, deliveryLocation: result.currentLocation, lastTrackingEvent: result.lastEvent, lastTrackedAt: result.checkedAt }
        : r
    );
    const updatedBrief = { ...brief, officeReport: { ...brief.officeReport, respondents: updatedRespondents } };
    setBriefs((prev) => ({ ...prev, [caseId]: updatedBrief }));
    saveHearingBrief(updatedBrief); // async — fire and forget is acceptable here
    setEditingTracking(null);
  }

  return (
    <div style={{ padding: '24px 32px', maxWidth: 900, margin: '0 auto', width: '100%' }}>

      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: T.text, marginBottom: 4 }}>Service Status</div>
          <div style={{ fontSize: 13, color: T.textMuted }}>Track notice delivery, pleadings, and hearing readiness for all upcoming cases.</div>
        </div>
        {needsPrep.length > 0 && (
          <button
            onClick={() => needsPrep.forEach((c) => handleGenerateBrief(c))}
            disabled={!!generatingFor}
            style={{ padding: '8px 16px', borderRadius: 9, border: 'none', background: 'linear-gradient(135deg,#1A2E5E,#C9A84C)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            \u2746 Generate All Briefs ({needsPrep.length})
          </button>
        )}
      </div>

      {causeListMsg && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 9, background: causeListMsg.startsWith('\u2705') ? '#E8F5EF' : '#FBF4E3', border: `1px solid ${causeListMsg.startsWith('\u2705') ? '#A0D4BB' : '#E8D18A'}`, fontSize: 13, color: causeListMsg.startsWith('\u2705') ? '#1A8C5B' : '#9B7B28' }}>
          {causeListMsg}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {(['upcoming', 'all'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={{ padding: '6px 16px', borderRadius: 8, border: `1px solid ${filter === f ? '#1A2E5E' : T.border}`, background: filter === f ? '#1A2E5E' : T.bg, color: filter === f ? '#fff' : T.textMuted, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            {f === 'upcoming' ? `Upcoming (${cases.filter((c) => getUpcomingHearing(c)).length})` : `All Cases (${cases.length})`}
          </button>
        ))}
      </div>

      {displayCases.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: T.textMuted }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 8 }}>{filter === 'upcoming' ? 'No upcoming hearings' : 'No cases saved yet'}</div>
          <div style={{ fontSize: 13 }}>{filter === 'upcoming' ? 'Cases with upcoming listings will appear here.' : 'Add cases from the Cases section.'}</div>
        </div>
      )}

      {displayCases.map((c) => {
        const hearingDate = getUpcomingHearing(c);
        const days = hearingDate ? daysUntil(hearingDate) : null;
        const brief = generatingFor === c.id ? null : briefs[c.id] ?? null;
        const respondents = brief?.officeReport?.respondents ?? c.respondents ?? [];

        return (
          <div key={c.id} style={{ background: T.bg, borderRadius: 12, border: `1px solid ${T.border}`, marginBottom: 12, overflow: 'hidden' }}>

            {/* Header */}
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: T.text, marginBottom: 2 }}>{c.displayTitle ?? c.parties ?? 'Unknown Case'}</div>
                <div style={{ fontSize: 12, color: T.textMuted }}>{c.caseNumber ?? ''} · Diary {c.diaryNo}/{c.diaryYear}</div>
              </div>
              {hearingDate && days !== null && (
                <div style={{ padding: '4px 12px', borderRadius: 20, background: `${urgencyColor(days)}15`, border: `1px solid ${urgencyColor(days)}40`, color: urgencyColor(days), fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap' }}>
                  {days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days} days`} · {hearingDate}
                </div>
              )}
              {generatingFor === c.id ? (
                <div style={{ fontSize: 12, color: T.textMuted }}>Generating…</div>
              ) : brief ? (
                <div style={{ padding: '3px 10px', borderRadius: 20, background: brief.readinessScore >= 75 ? '#E8F5EF' : '#FBF4E3', color: brief.readinessScore >= 75 ? '#1A8C5B' : '#9B7B28', fontSize: 12, fontWeight: 700 }}>
                  {brief.readinessScore}% ready
                </div>
              ) : hearingDate ? (
                <button onClick={() => handleGenerateBrief(c)} style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#1A2E5E,#2A4B9B)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  \u2746 Generate Brief
                </button>
              ) : null}
            </div>

            {/* Court/Item */}
            {brief && (brief.courtNo || brief.itemNo) && (
              <div style={{ padding: '8px 16px', background: '#F0F4FF', fontSize: 12, fontWeight: 700, color: '#1A2E5E', borderBottom: `1px solid ${T.border}` }}>
                \uD83D\uDCCD Court No. {brief.courtNo ?? '?'} · Item No. {brief.itemNo ?? '?'}
              </div>
            )}

            {/* Respondents */}
            {respondents.length > 0 && (
              <div style={{ padding: '12px 16px' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, letterSpacing: 0.8, marginBottom: 8 }}>SERVICE STATUS</div>
                {respondents.map((r: any, i: number) => {
                  const rKey = `${c.id}-${i}`;
                  return (
                    <div key={i} style={{ background: T.surface, borderRadius: 9, border: `1px solid ${T.border}`, padding: '10px 12px', marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: T.text }}>{r.name}</div>
                        <div style={{ padding: '2px 9px', borderRadius: 20, background: getDeliveryStatusBg(r.deliveryStatus ?? 'unknown'), color: getDeliveryStatusColor(r.deliveryStatus ?? 'unknown'), fontSize: 11, fontWeight: 700 }}>
                          {getDeliveryStatusLabel(r.deliveryStatus ?? 'unknown')}
                        </div>
                        <div style={{ padding: '2px 9px', borderRadius: 20, background: r.serviceStatus === 'Complete' ? '#E8F5EF' : '#FEF2F2', color: r.serviceStatus === 'Complete' ? '#1A8C5B' : '#991B1B', fontSize: 11, fontWeight: 700 }}>
                          {r.serviceStatus ?? 'Unknown'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, marginBottom: 8 }}>
                        {[{ key: 'vakalatnama', label: 'Vakalatnama' }, { key: 'counterAffidavit', label: 'Counter' }, { key: 'rejoinder', label: 'Rejoinder' }].map(({ key, label }) => {
                          const val = r[key];
                          const filed = val && val !== 'Not filed' && val !== 'No appearance';
                          return (
                            <div key={key} style={{ padding: '2px 8px', borderRadius: 5, background: filed ? '#E8F5EF' : '#F3F4F6', border: `1px solid ${filed ? '#A0D4BB' : T.border}`, fontSize: 11, color: filed ? '#1A8C5B' : '#9CA3AF', fontWeight: 600 }}>
                              {label}: {val ?? '\u2014'}
                            </div>
                          );
                        })}
                      </div>
                      {editingTracking === rKey ? (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input autoFocus value={trackingInputs[rKey] ?? r.trackingNumber ?? ''} onChange={(e) => setTrackingInputs((p) => ({ ...p, [rKey]: e.target.value }))} placeholder="Speed post tracking no. (e.g. EW123456789IN)" style={{ flex: 1, padding: '5px 9px', borderRadius: 7, border: `1px solid ${T.border}`, fontSize: 12, color: T.text, outline: 'none', background: T.bg, fontFamily: 'monospace' }} />
                          <button onClick={() => handleSaveTracking(c.id, rKey, r.name)} style={{ padding: '5px 12px', borderRadius: 7, border: 'none', background: '#1A2E5E', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Save</button>
                          <button onClick={() => setEditingTracking(null)} style={{ padding: '5px 10px', borderRadius: 7, border: `1px solid ${T.border}`, background: T.bg, color: T.textMuted, fontSize: 12, cursor: 'pointer' }}>\u2715</button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={() => setEditingTracking(rKey)}>
                          <span style={{ fontSize: 12, color: r.trackingNumber ? T.text : T.textMuted, fontFamily: 'monospace' }}>
                            {r.trackingNumber ? `\uD83D\uDCE6 ${r.trackingNumber}` : '+ Add speed post tracking number'}
                          </span>
                          {r.lastTrackingEvent && <span style={{ fontSize: 11, color: T.textMuted, fontStyle: 'italic' }}>· {r.lastTrackingEvent.slice(0, 60)}</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}