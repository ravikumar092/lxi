import { useSettingsStore, TeamMember, TrainingExample } from '../store/settingsStore';
import { GeneratedTask, generateOfficeReportTasks } from '../caseLogic';
import { optimizePromptText } from '../utils/textOptimizer';

export function normaliseTaskKey(text: string, party: string): string {
  const stopWords = new Set([
    'and','or','the','for','to','a','an','of','in','on',
    'at','by','with','is','are','be','been','has','have',
    'that','this','from','as','if','it','its','was','but',
    'also','all','any','not','them','their','your','our',
    'shall','should','must','will','may','can','need',
    'please','kindly','such','each','both','same'
  ]);
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w))
    .slice(0, 2);
  return words.join(' ') + '||' + (party || '').trim();
}

// ⚠️ SECURITY WARNING — READ BEFORE ANY PUBLIC DEPLOYMENT ⚠️
// The API keys below are read from import.meta.env and will be BUNDLED
// into the JavaScript build output. Anyone who opens DevTools → Sources
// can see the raw key values. This is acceptable for localhost dev only.
//
// BEFORE DEPLOYING PUBLICLY (Vercel / Netlify / any public URL):
//  1. Create a serverless function (netlify/functions/ai-proxy.js or
//     Vercel api/ai-proxy.ts) that holds the keys server-side.
//  2. Call that function from here instead of calling Claude/Groq directly.
//  3. Remove ANTHROPIC_API_KEY and GROQ_API_KEY from .env entirely.
//  4. Set them as Environment Variables in your deployment dashboard only.
//
// See: https://docs.netlify.com/functions/overview/
// ─────────────────────────────────────────────────────────────

// Fallbacks for checking standard Vite vs our custom prefix
const getClaudeKey = () => (import.meta as any).env.VITE_ANTHROPIC_API_KEY || (import.meta as any).env.ANTHROPIC_API_KEY;

const getGroqKey = () => (import.meta as any).env.VITE_GROQ_API_KEY || (import.meta as any).env.GROQ_API_KEY;

function parseAIResponse(responseText: string): any[] {
    try {
        if (!responseText || responseText.trim() === '') return [];

        let raw = responseText.trim();

        // Remove markdown code fences if AI wrapped in ```json ... ```
        raw = raw
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();

        // Find the first [ and last ] to extract just the array
        const start = raw.indexOf('[');
        const end = raw.lastIndexOf(']');
        if (start === -1 || end === -1 || end <= start) return [];

        const jsonStr = raw.slice(start, end + 1);
        const parsed = JSON.parse(jsonStr);

        // Handle wrapped object just in case: { tasks: [...] }
        if (Array.isArray(parsed)) return parsed;
        if (parsed && Array.isArray(parsed.tasks)) return parsed.tasks;
        if (parsed && Array.isArray(parsed.data)) return parsed.data;

        return [];
    } catch {
        return [];
    }
}

const SC_CASE_TYPES = `
1. SPECIAL LEAVE PETITION (CIVIL) — SLP(C)
2. SPECIAL LEAVE PETITION (CRIMINAL) — SLP(Cr)
3. CIVIL APPEAL — CA
4. CRIMINAL APPEAL — CrA
5. WRIT PETITION (CIVIL) — WP(C)
6. WRIT PETITION (CRIMINAL) — WP(Cr)
7. TRANSFER PETITION (CIVIL) — TP(C)
8. TRANSFER PETITION (CRIMINAL) — TP(Cr)
9. REVIEW PETITION (CIVIL) — RP(C)
10. REVIEW PETITION (CRIMINAL) — RP(Cr)
11. TRANSFERRED CASE (CIVIL) — TC(C)
12. TRANSFERRED CASE (CRIMINAL) — TC(Cr)
13. SPECIAL LEAVE TO PETITION (CIVIL)
14. SPECIAL LEAVE TO PETITION (CRIMINAL)
15. WRIT TO PETITION (CIVIL)
16. WRIT TO PETITION (CRIMINAL)
17. ORIGINAL SUIT — OS
18. DEATH REFERENCE CASE
19. CONTEMPT PETITION (CIVIL) — ConC
20. CONTEMPT PETITION (CRIMINAL) — ConCr
21. TAX REFERENCE CASE
22. SPECIAL REFERENCE CASE
23. ELECTION PETITION
24. ARBITRATION PETITION — Arb.P
25. CURATIVE PETITION (CIVIL) — CP(C)
26. CURATIVE PETITION (CRIMINAL) — CP(Cr)
27. REFERENCE U/A 317(1)
28. MOTION (CRIMINAL)
29. DIARY NUMBER
30. SUO MOTU WRIT PETITION (CIVIL)
31. SUO MOTU WRIT PETITION (CRIMINAL)
32. SUO MOTU CONTEMPT PETITION (CIVIL)
33. SUO MOTU CONTEMPT PETITION (CRIMINAL)
34. REFERENCE U/S 14 RTI
35. REFERENCE U/S 17 RTI
36. MISCELLANEOUS APPLICATION
37. SUO MOTU TRANSFER PETITION (CIVIL)
38. SUO MOTU TRANSFER PETITION (CRIMINAL)
`;

const buildPrompt = (officeReportText: string, teamMembers: TeamMember[], trainingExamples: TrainingExample[], roles: string[], caseType: string): string => {
    let prompt = `You are a Supreme Court of India legal task manager for a law firm.

STEP 1: Identify the case type from the office report or case number prefix from this list:
${SC_CASE_TYPES}
If not found, detect from language and content. If still unknown, default to "MISCELLANEOUS APPLICATION".

STEP 2: Based on the case type, apply the correct task generation rules.
[Extensive rules exist per Case Type: SLP (Condonation, Caveat, etc), Appeals (Bail, Stay, Execution), Writ (Counter Affidavit, Rejoinder), Contempt (Show Cause, Appearance), Original Suit (Written Statement), etc. You must use typical SC rules for these types.]

STEP 3: Also apply global rules that work for all case types:
- "unserved" -> Paralegal / Clerk | High | T+5
- "vakalatnama" -> Paralegal / Clerk | Medium | T+3
- "defect" -> Associate Advocate | Critical | Today
- "IA filed by respondent" -> Advocate | Medium | T+7
- "next date" -> Create hearing prep tasks

STEP 4: For each task detected return exactly this JSON format:
[
  {
    "task": "exact task description",
    "assigned_to_role": "${roles.join('" | "')}",
    "assigned_to_person": "specific person name based on workload",
    "urgency": "Critical" | "High" | "Medium" | "Low",
    "deadline_days": number,
    "case_type_detected": "string (which of 38 types)",
    "reason": "why this task was generated"
  }
]

FIRM TEAM (with current workload, pick lowest workload matching role):
${roles.map(r => `- ${r}: ${teamMembers.filter(m => m.role === r).map(m => `${m.name} (wl:${m.currentWorkload || 0})`).join(', ') || 'None'}`).join('\n')}

TRAINING EXAMPLES:
`;

    let activeExamples = trainingExamples.filter(ex => ex.isActive !== false && ex.case_type === caseType);
    if (activeExamples.length === 0) {
        // Fallback to all if no exact caseType match found
        activeExamples = trainingExamples.filter(ex => ex.isActive !== false);
    }

    activeExamples.forEach((ex, index) => {
        prompt += `\nExample ${index + 1}:\nOffice Report: ${ex.office_report_text}\nCorrect Output: ${JSON.stringify(ex.correct_tasks, null, 2)}\n`;
    });

    if (activeExamples.length === 0) {
        prompt += `\n(No training examples provided yet. Please use the rules above strictly.)\n`;
    }

    prompt += `\nOFFICE REPORT TEXT: ${officeReportText}\nReturn ONLY a JSON array. Nothing else.`;

    return prompt;
};

function computeDeadline(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + (days ?? 7));
    return d.toISOString().split('T')[0];
}

// Map AI JSON format to GeneratedTask format.
// Handles both old field names (task, assigned_to_role) and new ones (text, assignee).
function mapResponseToTasks(
    rawTasks: any[],
    party: string,
    partyPerson: string,
    assignedPerson: string
): any[] {
    return rawTasks
        .filter(t => t && (t.text || t.task))
        .map(t => ({
            id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,

            // Handle both old field name (task) and new field name (text)
            text: (t.text || t.task || '').trim(),

            party,
            partyPerson: '',

            // Handle both old field name (assigned_to_role) and new (assignee)
            assignee: t.assignee || t.assigned_to_role || 'Advocate',

            assignedPerson: assignedPerson || '',

            urgency: t.urgency || t.priority || 'Medium',

            // Compute deadline from deadline_days
            deadline: computeDeadline(t.deadline_days ?? 7),

            done: false,
            isAuto: true,
            assignmentType: 'ai',
            personFound: t.personFound ?? true,
        }));
}

// ── AI PROXY HELPERS ──────────────────────────────────────────────────────────
// Routes through Supabase Edge Function so API keys stay server-side.
// Falls back to direct API calls if VITE_SUPABASE_URL is not configured yet.

async function callAiProxy(provider: 'claude' | 'groq', prompt: string): Promise<string> {
    const supabaseUrl: string = (import.meta as any).env?.VITE_SUPABASE_URL || '';
    const supabaseAnon: string = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';

    if (supabaseUrl) {
        // Use Edge Function proxy (preferred — hides API keys)
        const { supabase } = await import('../lib/supabaseClient');
        const { data: { session } } = await supabase.auth.getSession();
        const response = await fetch(`${supabaseUrl}/functions/v1/ai-proxy`, {
            method: 'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${session?.access_token}`,
                'apikey':         supabaseAnon,
            },
            body: JSON.stringify({ provider, prompt, temperature: 0.1 }),
        });
        if (!response.ok) throw new Error(`AI proxy error: ${response.status}`);
        const data = await response.json();

        if (provider === 'claude') {
            return data.content?.[0]?.text || '';
        } else {
            return data.choices?.[0]?.message?.content || '';
        }
    }

    // Fallback: direct API call (uses env keys, for local dev without Supabase)
    if (provider === 'claude') {
        const apiKey = getClaudeKey();
        if (!apiKey) throw new Error('Anthropic API key missing');
        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key':         apiKey,
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
        if (!res.ok) throw new Error(`Claude error: ${res.status}`);
        const data = await res.json();
        return data.content?.[0]?.text || '';
    } else {
        const apiKey = getGroqKey();
        if (!apiKey) throw new Error('Groq API key missing');
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], temperature: 0.1 }),
        });
        if (!res.ok) throw new Error(`Groq error: ${res.status}`);
        const data = await res.json();
        return data.choices?.[0]?.message?.content || '';
    }
}

const callClaude = async (prompt: string, party: string, partyPerson: string): Promise<GeneratedTask[]> => {
    const text = await callAiProxy('claude', prompt);
    return mapResponseToTasks(parseAIResponse(text), party, partyPerson, '');
};

const callGroq = async (prompt: string, party: string, partyPerson: string): Promise<GeneratedTask[]> => {
    const text = await callAiProxy('claude', prompt);
    return mapResponseToTasks(parseAIResponse(text), party, partyPerson, '');
};

// ─── PARTY-SPECIFIC TASK GENERATION ─────────────────────────────────────────
const buildPartyPrompt = (
    partyType: string,
    personName: string,
    context: any,
    existingTasks: any[] = []
): string => {
    const isPetitioner = partyType === 'Petitioner';

    const existingTaskList = existingTasks.length > 0
        ? existingTasks.map((t: any) => `- ${t.text}`).join('\n')
        : 'None yet';

    const petitionerResponsibilities = `
PETITIONER ADVOCATE responsibilities for this case:
- Address EVERY defect listed in the office report (highest priority)
- Verify SLP limitation period (must be within 90 days of HC order date)
- File or complete Statement of Case if not already done
- Serve court notices on all respondents if not already served
- File IA for stay or exemption if interim relief is needed
- Monitor compliance with any interim order already granted
- Prepare written brief for the upcoming hearing`;

    const respondentResponsibilities = `
RESPONDENT ADVOCATE responsibilities for this case:
- File vakalatnama on behalf of respondent if not already filed
- File counter affidavit to the SLP within time
- File reply to any IA filed by the petitioner
- Verify whether petitioner has properly served notice on respondent
- Check if any interim order affects respondent and take steps
- Prepare written brief for the upcoming hearing`;

    const responsibilities = isPetitioner ? petitionerResponsibilities : respondentResponsibilities;
    const otherSide = isPetitioner ? 'Respondent' : 'Petitioner';

    return `You are a Supreme Court of India legal task manager for a law firm.

YOUR CLIENT SIDE: ${partyType} — ${personName || 'party'}
CASE TYPE: ${context.caseType || 'Supreme Court Matter'}
NEXT HEARING: ${context.nextHearing || 'Not scheduled'}

=== LAST COURT ORDER / JUDGMENT ===
${context.lastOrderText?.trim() || 'Not available'}

=== OFFICE REPORT ===
${context.officeReportText?.trim() || 'Not available'}

=== INTERLOCUTORY APPLICATIONS ===
${context.iaText?.trim() || 'None filed'}

=== TASKS ALREADY ASSIGNED — DO NOT REPEAT THESE ===
${existingTaskList}

${responsibilities}

${personName ? `
=== PERSON-SPECIFIC SEARCH ===
SPECIFIC PERSON: ${personName}

Carefully scan ALL three documents above (Last Court Order,
Office Report, Interlocutory Applications) for any mention
of "${personName}" by name.

If "${personName}" is specifically named in any document:
- Create tasks that directly address what is mentioned
  about them specifically
- Reference the specific context in the task description
- Set "personFound": true on these tasks

If "${personName}" is NOT mentioned by name anywhere
in the documents:
- Set "personFound": false on ALL returned tasks
- Still generate general ${partyType} side tasks
` : `
=== GENERAL SIDE TASKS ===
No specific person selected.
Generate general tasks for the entire ${partyType} side.
`}

STRICT RULES:
1. Generate tasks ONLY for the ${partyType} advocate
2. Do NOT generate any task that is the ${otherSide}'s responsibility
3. Each task must be a completely DISTINCT legal action
4. Do NOT repeat or rephrase any task from the already assigned list above
5. Read the office report carefully — create a specific task for each defect found
6. Read the last court order carefully — create tasks for anything the court directed
7. Maximum 6 tasks total
8. All deadlines must fall before the next hearing date
9. Office report defects → deadline_days: 0 (must be done today)
10. Hearing within 7 days → add hearing preparation task with deadline_days: 1

TEAM ASSIGNMENT RULES:
- Office report defects → assignee: "Associate Advocate" | urgency: "Critical"
- Limitation/court directions → assignee: "Advocate" | urgency: "Critical"
- Notice/service tasks → assignee: "Paralegal / Clerk" | urgency: "High"
- Filing tasks → assignee: "Associate Advocate" | urgency: "High"
- Hearing preparation → assignee: "Advocate" | urgency: "High"

OUTPUT FORMAT — STRICT:
Respond with a raw JSON array only.
No markdown. No code fences. No wrapper object. No explanation.
First character of your response must be [
Last character must be ]
Each item must have exactly these fields:
{
  "text": "task description",
  "priority": "High" or "Medium" or "Low",
  "deadline_days": number (0 = today, 3 = in 3 days),
  "assignee": "Advocate" or "Associate Advocate" or "Paralegal / Clerk",
  "urgency": "Critical" or "High" or "Medium" or "Low",
  "personFound": true or false
}`;
};

// ─── PREDICTED OFFICE REPORT ────────────────────────────────────────────────
export async function generatePredictedReport(
  context: {
    officeReportText: string;
    lastOrderText: string;
    iaText: string;
    caseType: string;
    nextHearing: string | null;
  },
  petitioners: string,
  respondents: string
): Promise<string> {
  const prompt = `You are a Supreme Court of India registry expert and legal analyst for a law firm.

CASE TYPE: ${context.caseType || 'Supreme Court Matter'}
NEXT HEARING: ${context.nextHearing || 'Not scheduled'}
PETITIONER: ${petitioners || 'Not specified'}
RESPONDENT: ${respondents || 'Not specified'}

=== LAST COURT ORDER / JUDGMENT ===
${context.lastOrderText?.trim() || 'Not available'}

=== CURRENT OFFICE REPORT ===
${context.officeReportText?.trim() || 'Not available'}

=== INTERLOCUTORY APPLICATIONS ===
${context.iaText?.trim() || 'None filed'}

Based on ALL documents above, generate a predicted office report for the next hearing date.

Your prediction must include ALL of these sections:

1. LIKELY REGISTRY DEFECTS
   List specific defects the registry is likely to raise based on what is missing or pending in the office report.
   For each defect: what it is, which side must fix it, how urgent it is.
   If no defects likely: write "No defects anticipated"

2. PENDING COURT DIRECTIONS
   List any directions from the last court order that have not yet been complied with.
   For each: what was directed, by whom, current status.
   If all complied: write "All directions complied with"

3. IA STATUS
   For each IA filed, predict its current status:
   - Has the other side filed a reply?
   - Is it likely to be listed for hearing?
   If no IAs: write "No IAs pending"

4. SERVICE STATUS
   Has the petitioner properly served notice on all respondents? What is pending?

5. RECOMMENDED ACTIONS BEFORE NEXT HEARING
   Petitioner side: list 2-3 most critical actions
   Respondent side: list 2-3 most critical actions

RULES:
- Be specific — reference actual defects/orders from documents
- Be concise — maximum 3 points per section
- Do NOT repeat information already in the office report
- Focus only on what is LIKELY to happen at next hearing
- Write in formal legal language suitable for advocates

OUTPUT FORMAT — STRICT:
Return HTML only using ONLY these CSS classes (no inline styles, no other classes):
sc-bold, sc-italic, sc-underline, sc-body, sc-para, sc-para-no, sc-gap, sc-gap-sm, sc-table

Use Times New Roman font implicitly (set by consumer).
Structure your output exactly like this:

<div class="sc-gap"></div>
<p class="sc-bold sc-underline sc-center">BEFORE NEXT HEARING</p>
<div class="sc-gap-sm"></div>

<p class="sc-bold">LIKELY REGISTRY DEFECTS:</p>
[for each defect:]
<p class="sc-para"><span class="sc-para-no">1.</span> [defect description — which side must fix it]</p>
[if no defects:]
<p class="sc-body sc-italic">No defects anticipated.</p>

<div class="sc-gap-sm"></div>
<p class="sc-bold">PENDING COURT DIRECTIONS:</p>
[for each direction:]
<p class="sc-para"><span class="sc-para-no">1.</span> [what was directed, by whom, status]</p>
[if none:]
<p class="sc-body sc-italic">All directions complied with.</p>

<div class="sc-gap-sm"></div>
<p class="sc-bold">IA STATUS:</p>
[for each IA:]
<p class="sc-para"><span class="sc-para-no">1.</span> [IA description and predicted status]</p>
[if none:]
<p class="sc-body sc-italic">No IAs pending.</p>

<div class="sc-gap-sm"></div>
<p class="sc-bold">SERVICE STATUS:</p>
<p class="sc-body">[service status description]</p>

<div class="sc-gap-sm"></div>
<p class="sc-bold">RECOMMENDED ACTIONS BEFORE NEXT HEARING:</p>
<p class="sc-body"><span class="sc-bold">Petitioner:</span> [2-3 actions]</p>
<p class="sc-body"><span class="sc-bold">Respondent:</span> [2-3 actions]</p>

<div class="sc-gap"></div>
<p class="sc-italic sc-center">Lex Tigress — For preparation purposes only</p>
<div class="sc-gap"></div>

Do NOT use any inline styles.
Do NOT use any classes other than the ones listed above.
Do NOT include <html>, <head>, <body> tags.
Return ONLY the HTML fragment above, nothing else.`;

  // Try Claude first (via ai-proxy Edge Function)
  try {
    const text = await callAiProxy('claude', prompt);
    if (text && text.trim().length > 50) return text.trim();
  } catch { /* fall through to Groq */ }

  // Claude retry fallback
  try {
    const text = await callAiProxy('claude', prompt);
    if (text && text.trim().length > 50) return text.trim();
  } catch { /* fall through */ }

  return 'Unable to generate prediction. Please check your API keys in Settings.';
}

// ─── SHARED CONTEXT BUILDER ─────────────────────────────────────────────────
// Reads localStorage cache and builds the full document context for a case.
// Used by both the per-case detail view AND the bulk "generate all" feature.
const readCache = (key: string): any | null => {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw).data ?? null;
    } catch { return null; }
};

export const buildCaseContext = async (caseObj: any): Promise<{
    officeReportText: string;
    lastOrderText: string;
    iaText: string;
    caseType: string;
    nextHearing: string | null;
}> => {
    const cnr = caseObj.cnrNumber;
    const { buildOfficeReportData, renderOfficeReportText } = await import('./officeReportBuilder');

    let officeReportText = "";
    try {
        const cachedReport = cnr ? readCache(`lx_ec_officeReport_${cnr}`) : null;
        officeReportText = renderOfficeReportText(buildOfficeReportData(caseObj, cachedReport ?? null));
    } catch { }

    let lastOrderText = "";
    const cachedOrder = cnr ? readCache(`lx_ec_lastOrders_${cnr}`) : null;
    if (cachedOrder) {
        lastOrderText = [
            cachedOrder.orderText || cachedOrder.order_text,
            cachedOrder.orderSummary || cachedOrder.order_summary,
            cachedOrder.remarks,
            cachedOrder.directives
                ? (Array.isArray(cachedOrder.directives) ? cachedOrder.directives.join(" ") : String(cachedOrder.directives))
                : null,
        ].filter(Boolean).join(" ");
    }

    const cachedOfficeData = cnr ? readCache(`lx_ec_officeReport_${cnr}`) : null;
    const iaList = cachedOfficeData?.iaList || caseObj.interlocutoryApplications || [];
    const iaText = iaList.length > 0
        ? iaList.map((ia: any) =>
            `IA No. ${ia.number || ia.iaNumber || ia.ia_number || ''}: ${ia.purpose || ia.type || ia.status || 'Filed'} by ${ia.filedBy || ia.filed_by || 'party'}`
        ).join("; ")
        : "";

    return {
        officeReportText: optimizePromptText(officeReportText, 10000),
        lastOrderText: optimizePromptText(lastOrderText, 10000),
        iaText: optimizePromptText(iaText, 5000),
        caseType: caseObj.caseType || caseObj.caseTitle || "",
        nextHearing: caseObj.nextHearingDate || caseObj.nextListingDate || null,
    };
};

// ─── GENERATE TASKS FOR BOTH SIDES ──────────────────────────────────────────
// Generates tasks for Petitioner AND Respondent from the same document context.
// Runs sequentially to avoid AI rate limits.
export const generateTasksForBothSides = async (
    caseObj: any,
    petitionerName: string = '',
    respondentName: string = ''
): Promise<{ petitioner: GeneratedTask[]; respondent: GeneratedTask[] }> => {
    const context = await buildCaseContext(caseObj);

    let petitioner: GeneratedTask[] = [];
    let respondent: GeneratedTask[] = [];

    const existingTasks: any[] = caseObj.tasks || [];
    const existingPetTasks = existingTasks.filter((t: any) => t.party === "Petitioner");
    const existingRespTasks = existingTasks.filter((t: any) => t.party === "Respondent");

    try { petitioner = await generateTasksForPerson("Petitioner", petitionerName, context, existingPetTasks); } catch { }
    // Small pause between calls to avoid hitting rate limits
    await new Promise(r => setTimeout(r, 500));
    try { respondent = await generateTasksForPerson("Respondent", respondentName, context, existingRespTasks); } catch { }

    // Rule-based fallback for any side that got nothing from AI
    if (petitioner.length === 0 || respondent.length === 0) {
        const { generateLegalTasks, generateOfficeReportTasks } = await import('../caseLogic');
        const hasStay = context.officeReportText.toLowerCase().includes("stay granted");
        if (petitioner.length === 0) {
            const { tasks: base } = generateLegalTasks(context.caseType, caseObj.status || "", context.nextHearing, "Petitioner");
            const from = generateOfficeReportTasks(context.officeReportText, context.nextHearing, "Petitioner", hasStay);
            petitioner = [...base, ...from].map(t => ({ ...t, assignmentType: 'standard' as const }));
        }
        if (respondent.length === 0) {
            const { tasks: base } = generateLegalTasks(context.caseType, caseObj.status || "", context.nextHearing, "Respondent");
            const from = generateOfficeReportTasks(context.officeReportText, context.nextHearing, "Respondent", hasStay);
            respondent = [...base, ...from].map(t => ({ ...t, assignmentType: 'standard' as const }));
        }
    }

    return { petitioner, respondent };
};

export const generateTasksForPerson = async (
    partyType: "Petitioner" | "Respondent",
    personName: string,
    context: { officeReportText: string; lastOrderText: string; iaText: string; caseType: string; nextHearing: string | null },
    existingTasks: any[] = []
): Promise<GeneratedTask[]> => {
    const prompt = buildPartyPrompt(partyType, personName, context, existingTasks);

    try {
        const tasks = await callClaude(prompt, partyType, personName || '');
        useSettingsStore.getState().recordAiTask();
        return tasks;
    } catch { /* fall through */ }

    try {
        const tasks = await callGroq(prompt, partyType, personName || '');
        useSettingsStore.getState().recordAiTask();
        return tasks;
    } catch { /* fall through */ }

    return []; // caller falls back to rule-based
};

export const assignTasksFromOfficeReport = async (officeReportText: string, caseType: string = "Civil Appeal"): Promise<GeneratedTask[]> => {
    // 1. Build context
    const { teamMembers, trainingExamples, roles } = useSettingsStore.getState();
    const prompt = buildPrompt(officeReportText, teamMembers, trainingExamples, roles, caseType);

    // 2. Try Claude (Primary)
    try {
        const tasks = await callClaude(prompt, '', '');
        // Record stat
        useSettingsStore.getState().recordAiTask();
        return tasks;
    } catch (error) {
        console.error("Claude fallback triggered due to error:", error);
        // Continue to next fallback
    }

    // 3. Try Groq (Backup)
    try {
        const tasks = await callGroq(prompt, '', '');
        // Record stat
        useSettingsStore.getState().recordAiTask();
        return tasks;
    } catch (error) {
        console.error("Groq fallback triggered due to error:", error);
        // Continue to next fallback
    }

    // 4. Try Rule-based / Keyword Engine (Final Fallback)
    const fallbackTasks = generateOfficeReportTasks(officeReportText).map(task => ({
        ...task,
        assignmentType: 'standard' as const
    }));
    return fallbackTasks;
};