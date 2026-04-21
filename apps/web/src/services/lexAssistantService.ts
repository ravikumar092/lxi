import type { Case, Task, Priority, TaskStatus } from '../types';

// ── Interfaces ─────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: Date;
  action?: AssistantAction;
  suggestedCases?: CaseSuggestion[];
  needsConfirmation?: boolean;
}

export interface AssistantAction {
  type: 'SAVE_NOTE' | 'SAVE_TASK' | 'NAVIGATE_CASE' | 'NONE';
  caseId?: string;
  caseName?: string;
  note?: string;
  task?: {
    action: string;
    assignee: string;
    deadline: string;
    urgency: 'Critical' | 'High' | 'Medium' | 'Low';
  };
}

export interface CaseSuggestion {
  caseId: string;
  title: string;
  diaryNumber: string;
  diaryYear: string;
  caseType: string;
  nextHearingDate: string;
  confidence: number;
}

export interface LexResponse {
  intent:
    | 'FIND_CASE'
    | 'ADD_NOTE'
    | 'CREATE_TASK'
    | 'ANSWER_QUESTION'
    | 'TODAY_SUMMARY'
    | 'URGENT_TASKS'
    | 'CONFIRM'
    | 'UNCLEAR';
  reply: string;
  action: AssistantAction;
  needsConfirmation: boolean;
  suggestedCases: CaseSuggestion[];
}

// Runtime-extended case shape (fields that exist at runtime but not in base type)
interface RuntimeCase extends Case {
  nextHearingDate?: string;
  likelyListedOn?: string;
  timeOfSitting?: string;
  caseType?: string;
  isArchived?: boolean;
  archived?: boolean;
  tasks?: RuntimeTask[];
  diaryNumber?: string;
  labels?: string[];
  keyRisk?: string;
  notes?: Array<{ content?: string; title?: string; createdAt?: string; created_at?: string }>;
  officeReport?: string;
  listings?: Array<{ date?: string; purpose?: string; judges?: string[]; result?: string }>;
  lastOrders?: Array<{ date?: string; order?: string; text?: string; orderDate?: string; orderNumber?: string; judgeName?: string; orderType?: string; url?: string; pdfUrl?: string; orderUrl?: string; title?: string; description?: string }>;
  orders?: Array<{ date?: string; order?: string; text?: string; orderDate?: string; orderNumber?: string; judgeName?: string; orderType?: string; url?: string; pdfUrl?: string; orderUrl?: string; title?: string; description?: string }>;
  recentOrders?: Array<{ date?: string; order?: string; text?: string; orderDate?: string; orderNumber?: string; judgeName?: string; orderType?: string; url?: string; pdfUrl?: string; orderUrl?: string; title?: string; description?: string }>;
  documents?: Array<{ name?: string; title?: string; filedOn?: string; type?: string }>;
  applications?: Array<{ iaNumber?: string; purpose?: string; status?: string; filedOn?: string }>;
  petitionerAdvocates?: string[];
  respondentAdvocates?: string[];
  cnrNumber?: string;
  ourSide?: string;
  dateOfFiling?: string;
  registrationDate?: string;
  verificationDate?: string;
  lastListedOn?: string;
  shortCaseNumber?: string;
  courtNumber?: string;
  lastListedJudges?: string[];
  summary?: string;
  scDetail?: Record<string, unknown>;
}

interface RuntimeTask {
  urgency?: string;
  deadline?: string | Date;
  done?: boolean;
  task?: string;
  title?: string;
  assignedTo?: string;
  role?: string;
}

export interface UrgentItem {
  caseName: string;
  caseId: string;
  task: Task;
}

// ── buildFullDashboard ─────────────────────────────────────────────────────────

export function buildFullDashboard(cases: Case[]): string {
  const activeCases = (cases as RuntimeCase[])
    .filter(c => !c.isArchived && !c.archived)
    .slice(0, 10);

  if (activeCases.length === 0) {
    return 'No cases in dashboard yet.';
  }

  return activeCases.map((c, index) => {
    const diaryNum = c.diaryNumber || c.diaryNo || '';
    const pet = c.petitioner || '';
    const res = c.respondent || '';

    // ── Tasks ──────────────────────────────────────────────────────────────────
    const tasks = (c.tasks || []) as RuntimeTask[];
    const tasksText = tasks.length > 0
      ? tasks.map((t, i) =>
          `    ${i + 1}. ${t.task || t.title || 'Untitled'}\n` +
          `       Urgency: ${t.urgency || 'Medium'}\n` +
          `       Assignee: ${t.assignedTo || t.role || 'Unassigned'}\n` +
          `       Deadline: ${t.deadline || 'None'}\n` +
          `       Done: ${t.done ? 'Yes ✓' : 'No ✗'}`
        ).join('\n')
      : '    No tasks';

    // ── Notes ──────────────────────────────────────────────────────────────────
    const notes = (c.notes || []) as Array<{
      content?: string;
      title?: string;
      createdAt?: string;
      created_at?: string;
    }>;
    const notesText = notes.length > 0
      ? notes.map((n, i) =>
          `    ${i + 1}. ${n.content || n.title || ''}\n` +
          `       Date: ${n.createdAt || n.created_at || ''}`
        ).join('\n')
      : '    No notes';

    // ── Office Report ──────────────────────────────────────────────────────────
    const officeReport = c.officeReport
      ? (c.officeReport as string).slice(0, 300)
      : 'Not loaded yet';

    // ── Listings ───────────────────────────────────────────────────────────────
    const listings = (c.listings || []) as Array<{
      date?: string;
      purpose?: string;
      result?: string;
      judges?: string[];
    }>;
    const listingsText = listings.length > 0
      ? listings.slice(-5).map(l =>
          `    ${l.date || ''} | ${l.purpose || ''} | ${l.result || ''} | Judges: ${(l.judges || []).join(', ')}`
        ).join('\n')
      : '    No listing history loaded';

    // ── Last Orders ────────────────────────────────────────────────────────────
    type OrderEntry = {
      date?: string;
      orderDate?: string;
      order?: string;
      text?: string;
      title?: string;
      orderType?: string;
      orderNumber?: string;
      judgeName?: string;
    };
    const lastOrders = (c.lastOrders || c.orders || []) as OrderEntry[];
    const ordersText = lastOrders.length > 0
      ? lastOrders.slice(0, 5).map((o, i) =>
          `    ${i + 1}. Date: ${o.date || o.orderDate || 'Unknown'} | ${o.orderType || o.orderNumber || 'Order'}\n` +
          `       ${(o.order || o.text || o.title || 'PDF — view in dashboard').slice(0, 150)}\n` +
          `       Judge: ${o.judgeName || 'Unknown'}`
        ).join('\n')
      : '    Not loaded — advocate must click View Orders in the Cases section first';

    // ── Documents ──────────────────────────────────────────────────────────────
    const documents = (c.documents || []) as Array<{
      name?: string;
      title?: string;
      filedOn?: string;
      type?: string;
    }>;
    const docsText = documents.length > 0
      ? documents.slice(0, 8).map(d =>
          `    - ${d.name || d.title || 'Untitled'} (${d.type || ''}) Filed: ${d.filedOn || ''}`
        ).join('\n')
      : '    No documents loaded';

    // ── Applications ───────────────────────────────────────────────────────────
    const applications = (c.applications || []) as Array<{
      iaNumber?: string;
      purpose?: string;
      status?: string;
      filedOn?: string;
    }>;
    const appsText = applications.length > 0
      ? applications.map(a =>
          `    IA ${a.iaNumber || ''}: ${a.purpose || ''} | Status: ${a.status || ''}`
        ).join('\n')
      : '    No IAs';

    // ── Advocates ──────────────────────────────────────────────────────────────
    const petAdvocates = (c.petitionerAdvocates || []).join(', ') || 'Unknown';
    const resAdvocates = (c.respondentAdvocates || []).join(', ') || 'Unknown';

    // ── SC Detail ──────────────────────────────────────────────────────────────
    const scDetail = c.scDetail as Record<string, unknown> | undefined;
    const scDetailText = scDetail
      ? Object.entries(scDetail)
          .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
          .slice(0, 8)
          .map(([k, v]) => `    ${k}: ${String(v).slice(0, 80)}`)
          .join('\n')
      : '    Not loaded';

    return `
${'═'.repeat(50)}
CASE ${index + 1} OF ${activeCases.length}
${'═'.repeat(50)}

IDENTITY:
  ID: ${c.id}
  Title: ${pet} vs ${res}
  Case Type: ${c.caseType || 'Unknown'}
  Case Number: ${c.caseNumber || ''}
  Short Number: ${c.shortCaseNumber || ''}
  Diary: ${diaryNum} / ${c.diaryYear}
  CNR: ${c.cnrNumber || ''}

STATUS:
  Status: ${c.status}
  Our Side: ${c.ourSide || 'Unknown'}
  Labels: ${(c.labels || []).join(', ') || 'None'}
  Key Risk: ${c.keyRisk || 'None'}
  Archived: ${c.archived ? 'Yes' : 'No'}

HEARING INFO:
  Next Hearing: ${c.nextHearingDate || 'Not scheduled'}
  Likely Listed: ${c.likelyListedOn || 'Unknown'}
  Court: ${c.courtNumber || 'Unknown'}
  Time: ${c.timeOfSitting || 'Unknown'}
  Last Listed: ${c.lastListedOn || 'Unknown'}
  Last Judges: ${(c.lastListedJudges || []).join(', ') || 'Unknown'}

FILING INFO:
  Date of Filing: ${c.dateOfFiling || 'Unknown'}
  Registration: ${c.registrationDate || 'Unknown'}
  Verification: ${c.verificationDate || 'Unknown'}

ADVOCATES:
  Petitioner Side: ${petAdvocates}
  Respondent Side: ${resAdvocates}

CASE SUMMARY:
  ${c.summary || 'No summary added yet'}

TASKS (${tasks.length} total, ${tasks.filter(t => !t.done).length} pending):
${tasksText}

NOTES (${notes.length} total):
${notesText}

OFFICE REPORT:
  ${officeReport}

LISTING HISTORY (last 5):
${listingsText}

LAST ORDERS (${lastOrders.length} loaded):
${ordersText}

DOCUMENTS (${documents.length} loaded):
${docsText}

INTERLOCUTORY APPLICATIONS:
${appsText}

SC DETAIL:
${scDetailText}
`.trim();
  }).join('\n\n');
}

// Keep old function names as aliases so nothing breaks
export function buildBasicCaseList(cases: Case[]): string {
  return buildFullDashboard(cases);
}
export function buildFullCaseDetail(c: Case): string {
  return buildFullDashboard([c]);
}
export function buildCasesSummary(cases: Case[]): string {
  return buildFullDashboard(cases);
}

// ── Fallbacks ──────────────────────────────────────────────────────────────────

const FALLBACK_UNCLEAR: LexResponse = {
  intent: 'UNCLEAR',
  reply: "I had trouble understanding that. Could you rephrase?",
  action: { type: 'NONE' },
  needsConfirmation: false,
  suggestedCases: [],
};

const FALLBACK_NETWORK: LexResponse = {
  intent: 'UNCLEAR',
  reply: "I'm having trouble connecting. Please check your internet and try again.",
  action: { type: 'NONE' },
  needsConfirmation: false,
  suggestedCases: [],
};

// ── analyseMessage (single-stage) ─────────────────────────────────────────────

export async function analyseMessage(
  userMessage: string,
  chatHistory: ChatMessage[],
  cases: Case[]
): Promise<LexResponse> {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY;
  const today = new Date().toLocaleDateString('en-IN');
  const fullDashboard = buildFullDashboard(cases);

  const activeCases = (cases as RuntimeCase[]).filter(
    c => !c.isArchived && !c.archived
  );

  const systemPrompt = `You are Lex, a friendly and smart AI legal clerk for a Supreme Court of India advocate.
You have COMPLETE ACCESS to the advocate's full dashboard.
You can see everything — all cases, tasks, notes, orders, office reports, listings, documents, and more.

PERSONALITY:
- Friendly but professional
- Brief and clear — advocates are busy
- Always confirm before saving anything
- Proactively flag urgent things
- Use simple English

TODAY'S DATE: ${today}
TOTAL ACTIVE CASES: ${activeCases.length}

TEAM MEMBERS:
- Renu — Paralegal / Clerk (filing, tracking, notice service, admin)
- Priya — Associate Advocate (drafting, research, affidavits, counter filings)
- Vikram — Advocate (court appearances, arguments, urgent hearings)

LANGUAGE SUPPORT:
You can understand and respond in ALL Indian languages.
Supported languages include:
- English (default)
- Tamil (தமிழ்)
- Hindi (हिंदी)
- Telugu (తెలుగు)
- Kannada (ಕನ್ನಡ)
- Malayalam (മലയാളം)
- Marathi (मराठी)
- Bengali (বাংলা)
- Gujarati (ગુજરાતી)
- Punjabi (ਪੰਜਾਬੀ)
- Odia (ଓଡ଼ିଆ)
- Urdu (اردو)
- Assamese (অসমীয়া)
- Tanglish (Tamil words typed in English letters)
- Hinglish (Hindi words typed in English letters)
- Any mix of the above languages

LANGUAGE RULES:
- Detect the language the advocate is using
- Always reply in the SAME language the advocate used
- If advocate mixes languages, reply in the same mix
- If advocate uses Tanglish, reply in Tanglish
- If advocate uses Hinglish, reply in Hinglish
- For technical legal terms keep them in English even when replying in other languages (e.g. "SLP", "vakalatnama", "diary number", "affidavit" stay in English)
- Legal case names and party names stay in English in all language responses
- Numbers, dates, and case numbers stay in English

CONFIRMATION WORDS — recognise these as YES/CONFIRM in any Indian language:
  English:  yes, confirm, ok, correct, proceed, save it, done, sure, go ahead
  Tamil:    seri, aama, correct, podunga, save pannunga, proceed pannunga
  Hindi:    haan, theek hai, sahi hai, karo, chalega, bilkul, zaroor
  Telugu:   avunu, sare, cheyyi, save cheyyi
  Kannada:  houdu, sari, madi, save madi
  Malayalam: athe, sheriyanu, cheyyuka, okay
  Marathi:  hoy, bari, kara, thik aahe
  Bengali:  haan, thik ache, koro, sure
  Gujarati: ha, saru, karo, confirm karo

CANCEL WORDS — recognise these as NO/CANCEL:
  English:  no, cancel, stop, don't, never mind
  Tamil:    venda, cancel pannunga, illai, theva illai, nillungo
  Hindi:    nahi, mat karo, rukho, band karo
  Telugu:   vaddhu, aapandi, cancel cheyyi
  Kannada:  beda, nillu, cancel madi
  Malayalam: venda, nirthu, cancel cheyyuka
  Marathi:  nako, thamba, cancel kara
  Bengali:  na, thako, cancel koro
  Gujarati: nahi, raho, cancel karo

EXAMPLE RESPONSES IN DIFFERENT LANGUAGES:

If advocate asks in Tamil:
  "இன்று என்ன cases இருக்கு?"
  Lex replies in Tamil:
  "இன்று உங்களுக்கு 2 cases hearing-க்கு இருக்கு:
   1. Rajesh Kumar case — Court 4, காலை 10:30
   2. State vs Mehta — Court 12, மதியம் 2:00"

If advocate asks in Hindi:
  "Rajesh Kumar ke case mein kya urgent tasks hain?"
  Lex replies in Hindi:
  "Rajesh Kumar case mein 2 urgent tasks hain:
   1. Bail application file karni hai — Friday tak (Priya ko assign)
   2. Judge ke documents submit karne hain — Critical"

If advocate uses Tanglish:
  "Enna tasks pending iruku Priya kitta?"
  Lex replies in Tanglish:
  "Priya kitta 3 tasks pending iruku:
   1. Counter affidavit draft pannanum — Thursday
   2. Rejoinder prepare pannanum — Next week
   3. Documents file pannanum — Critical"

COMPLETE DASHBOARD DATA:
${fullDashboard}

YOUR CAPABILITIES:
1. Find any case by name, diary number, case number
2. Read and explain full case details
3. List pending tasks for any case or team member
4. Find overdue tasks (deadline passed, not done)
5. Add a note to a case
6. Create and assign a task to team member
7. Answer questions about hearings, judges, courts
8. Summarise today's listed cases
9. Find all urgent/critical tasks across all cases
10. Explain what an office report means and what to do
11. Check key risk alerts
12. Tell advocate what needs attention right now
13. Find cases listed in a specific court
14. Show what a team member needs to do

SMART BEHAVIOURS:
- If only ONE case exists and no case is mentioned, automatically use that case
- If advocate says "the case" or "that case" and there is only one case, use it automatically
- If office report has defects/issues, suggest the right task to fix it
- If orders say "not loaded", tell advocate to go to Cases, open the case, click View Orders, wait for load, then come back
- Always mention case name when talking about tasks
- For urgent tasks, list them with case name + deadline
- If asked what needs attention: combine today's hearings + critical tasks + key risks

RESPONSE FORMAT — always reply in this exact JSON only, no extra text, no markdown fences:
{
  "intent": "FIND_CASE|ADD_NOTE|CREATE_TASK|ANSWER_QUESTION|TODAY_SUMMARY|URGENT_TASKS|CONFIRM|UNCLEAR",
  "reply": "Your friendly reply — max 100 words, use numbered list when listing multiple items",
  "action": {
    "type": "SAVE_NOTE|SAVE_TASK|NAVIGATE_CASE|NONE",
    "caseId": "",
    "caseName": "",
    "note": "",
    "task": {
      "action": "",
      "assignee": "",
      "deadline": "",
      "urgency": "Critical|High|Medium|Low"
    }
  },
  "needsConfirmation": false,
  "suggestedCases": [
    {
      "caseId": "",
      "title": "",
      "diaryNumber": "",
      "diaryYear": "",
      "caseType": "",
      "nextHearingDate": "",
      "confidence": 85
    }
  ]
}

STRICT RULES:
- Always set needsConfirmation: true for SAVE_NOTE and SAVE_TASK — never save without confirmation
- Never invent case details — only use dashboard data
- Never return anything outside the JSON block
- Keep reply under 100 words
- caseId in action must be exact ID from dashboard data
- If case name is ambiguous, populate suggestedCases`;

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...chatHistory.slice(-8).map(m => ({ role: m.role, content: m.text })),
    { role: 'user' as const, content: userMessage },
  ];

  try {
    const res = await fetch('/groq-api/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.2,
        max_tokens: 800,
        messages,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Groq error:', res.status, errText);
      return FALLBACK_NETWORK;
    }

    const data = await res.json() as {
      choices: Array<{ message: { content: string } }>;
    };

    let text = data.choices[0]?.message?.content ?? '';
    text = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    try {
      return JSON.parse(text) as LexResponse;
    } catch {
      console.error('JSON parse failed:', text);
      return FALLBACK_UNCLEAR;
    }
  } catch (err) {
    console.error('Lex fetch error:', err);
    return FALLBACK_NETWORK;
  }
}

// ── fuzzyMatchCases ────────────────────────────────────────────────────────────

export function fuzzyMatchCases(query: string, cases: Case[]): CaseSuggestion[] {
  const q = query.toLowerCase().trim();
  const queryWords = q.split(/\s+/).filter(Boolean);

  const scored: Array<{ case: RuntimeCase; score: number }> = (cases as RuntimeCase[]).map(c => {
    const pet = (c.petitioner || '').toLowerCase();
    const res = (c.respondent || '').toLowerCase();
    const diaryNum = (c.diaryNumber || c.diaryNo || '').toLowerCase();
    const caseNum = (c.caseNumber || '').toLowerCase();

    let score = 0;

    // Exact diary number match
    if (diaryNum === q) { score = 100; }
    // Diary number contains query
    else if (diaryNum.includes(q)) { score = Math.max(score, 80); }
    // Case number contains query
    else if (caseNum.includes(q)) { score = Math.max(score, 70); }

    const allInPet = queryWords.length > 0 && queryWords.every(w => pet.includes(w));
    const allInRes = queryWords.length > 0 && queryWords.every(w => res.includes(w));
    const someInPet = queryWords.some(w => pet.includes(w));
    const someInRes = queryWords.some(w => res.includes(w));

    if (allInPet) score = Math.max(score, 90);
    if (allInRes) score = Math.max(score, 90);
    if (!allInPet && someInPet) score = Math.max(score, 60);
    if (!allInRes && someInRes) score = Math.max(score, 60);

    return { case: c, score };
  });

  return scored
    .filter(s => s.score > 30)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(s => ({
      caseId: s.case.id,
      title: s.case.displayTitle || `${s.case.petitioner || ''} vs ${s.case.respondent || ''}`,
      diaryNumber: s.case.diaryNumber || s.case.diaryNo || '',
      diaryYear: s.case.diaryYear || '',
      caseType: s.case.caseType || '',
      nextHearingDate: s.case.nextHearingDate || '',
      confidence: s.score,
    }));
}

// ── getTodayCases ──────────────────────────────────────────────────────────────

export function getTodayCases(cases: Case[]): Case[] {
  const today = new Date().toISOString().split('T')[0];
  return (cases as RuntimeCase[])
    .filter(c => {
      if (c.isArchived) return false;
      return c.nextHearingDate?.startsWith(today) || c.likelyListedOn?.startsWith(today);
    })
    .sort((a, b) => {
      const ta = a.timeOfSitting || '';
      const tb = b.timeOfSitting || '';
      return ta.localeCompare(tb);
    });
}

// ── getUrgentItems ─────────────────────────────────────────────────────────────

export function getUrgentItems(cases: Case[]): UrgentItem[] {
  const items: UrgentItem[] = [];

  for (const c of cases as RuntimeCase[]) {
    if (c.isArchived) continue;
    if (!c.tasks) continue;

    for (const t of c.tasks) {
      const urgency = t.urgency || '';
      if (urgency !== 'Critical' && urgency !== 'High') continue;
      items.push({
        caseName: c.displayTitle || `${c.petitioner || ''} vs ${c.respondent || ''}`,
        caseId: c.id,
        task: t as unknown as Task,
      });
    }
  }

  items.sort((a, b) => {
    const ua = (a.task as unknown as RuntimeTask).urgency || '';
    const ub = (b.task as unknown as RuntimeTask).urgency || '';
    if (ua === 'Critical' && ub !== 'Critical') return -1;
    if (ub === 'Critical' && ua !== 'Critical') return 1;
    const da = String((a.task as unknown as RuntimeTask).deadline || '');
    const db = String((b.task as unknown as RuntimeTask).deadline || '');
    return da.localeCompare(db);
  });

  return items.slice(0, 20);
}

// Re-export Priority and TaskStatus for use in LexAssistant
export type { Priority, TaskStatus };
