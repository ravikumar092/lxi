/**
 * Lex Tigress — Notification Service
 * Identifies changes in case status and triggers alerts (Web, WhatsApp, SMS).
 */

import { LowerCourtStatus } from '../types/hearingPrep';

export interface CaseAlert {
  type: 'date_change' | 'new_order' | 'disposed' | 'approaching';
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
}

/**
 * Compare old and new status to find meaningful changes.
 */
export function getStatusChanges(oldS: LowerCourtStatus | null, newS: LowerCourtStatus): CaseAlert[] {
  const alerts: CaseAlert[] = [];

  if (!oldS) return []; // Initial load, no "change"

  // 1. Hearing date change
  if (newS.nextHearingDate && oldS.nextHearingDate !== newS.nextHearingDate) {
    alerts.push({
      type: 'date_change',
      title: 'Hearing Date Updated',
      message: `Lower court hearing moved from ${oldS.nextHearingDate || 'None'} to ${newS.nextHearingDate}.`,
      severity: 'warning'
    });
  }

  // 2. New order uploaded
  if (newS.lastOrderURL && oldS.lastOrderURL !== newS.lastOrderURL) {
    alerts.push({
      type: 'new_order',
      title: 'New Order Available',
      message: `A new order has been uploaded for the ${newS.courtType} case.`,
      severity: 'info'
    });
  }

  // 3. Case disposed
  const disposedKeywords = ['disposed', 'decided', 'dismissed', 'allowed'];
  const isNowDisposed = disposedKeywords.some(k => newS.stage.toLowerCase().includes(k));
  const wasDisposed = oldS ? disposedKeywords.some(k => oldS.stage.toLowerCase().includes(k)) : false;

  if (isNowDisposed && !wasDisposed) {
    alerts.push({
      type: 'disposed',
      title: 'Case Disposed',
      message: `The lower court matter has been ${newS.stage.toLowerCase()}.`,
      severity: 'critical'
    });
  }

  return alerts;
}

/**
 * Trigger external notifications (Twilio / WhatsApp).
 * Currently stubbed for MVP.
 */
export async function triggerExternalAlert(caseId: string, alert: CaseAlert) {
  console.log(`[Notification] Triggering ${alert.type} for case ${caseId}: ${alert.message}`);
  
  // Example Twilio/WhatsApp integration:
  // await fetch('/api/notify/whatsapp', { 
  //   method: 'POST', 
  //   body: JSON.stringify({ 
  //     to: '+91XXXXXXXXXX', 
  //     message: `*LEX TIGRESS ALERT*\n${alert.title}\n${alert.message}` 
  //   }) 
  // });
}
