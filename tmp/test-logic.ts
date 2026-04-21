import { calculateAIInsights, calculateAdjournmentBreakdown } from './apps/web/src/services/lowerCourtSyncService';
import { getStatusChanges } from './apps/web/src/services/notificationService';
import { LowerCourtStatus } from './apps/web/src/types/hearingPrep';

// 1. Mock Data for Case Analysis
const mockHistory = [
  { date: '2024-03-01', stage: 'Hearing', notes: 'Petitioner sought time to file counter' },
  { date: '2024-02-15', stage: 'Hearing', notes: 'Respondent not present' },
  { date: '2024-01-30', stage: 'Hearing', notes: 'Court not sitting' },
];

console.log('--- TEST 1: Adjournment Breakdown ---');
const breakdown = calculateAdjournmentBreakdown(mockHistory);
console.log('Breakdown:', breakdown);
if (breakdown.petitioner === 1 && breakdown.respondent === 1 && breakdown.court === 1) {
  console.log('✅ Adjournment Breakdown Logic Correct');
} else {
  console.error('❌ Adjournment Breakdown Logic Failed');
}

// 2. Mock Data for AI Insights (Stalled Case)
const stalledStatus: Partial<LowerCourtStatus> = {
  lastHearingDate: '2023-01-01',
  nextHearingDate: null,
  stage: 'Pending',
  hearingHistory: mockHistory
};

console.log('\n--- TEST 2: AI Insights (Stalled) ---');
const insights = calculateAIInsights(stalledStatus);
console.log('Insights:', insights);
if (insights?.trajectory === 'Stalled' && insights?.delayIndicator === 'Critical') {
  console.log('✅ Stalled Detection Correct');
} else {
  console.error('❌ Stalled Detection Failed');
}

// 3. Mock Data for Notification Detection (Date Change)
const oldStatus: LowerCourtStatus = {
  nextHearingDate: '2024-04-10',
  stage: 'Pending',
  lastOrderURL: 'url1',
  // ... rest of fields
} as any;

const newStatus: LowerCourtStatus = {
  nextHearingDate: '2024-05-15',
  stage: 'Pending',
  lastOrderURL: 'url2',
} as any;

console.log('\n--- TEST 3: Notification Triggers ---');
const alerts = getStatusChanges(oldStatus, newStatus);
console.log('Alerts:', alerts);
if (alerts.length === 2 && alerts[0].type === 'date_change' && alerts[1].type === 'new_order') {
  console.log('✅ Notification Logic Correct');
} else {
  console.error('❌ Notification Logic Failed');
}
