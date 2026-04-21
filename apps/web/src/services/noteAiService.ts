import { Note, NoteCategory } from '../types/notes';
import { Case } from '../types';
import { useSettingsStore } from '../store/settingsStore';

// Reuse the AI proxy helper from aiTaskService (simplified here or we could export it)
// For now, we'll implement a clean version for notes.

const getGroqKey = () => (import.meta as any).env.VITE_GROQ_API_KEY || (import.meta as any).env.GROQ_API_KEY;

async function callGroq(prompt: string): Promise<string> {
    const apiKey = getGroqKey();
    if (!apiKey) throw new Error('Groq API key missing');

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 
            'Authorization': `Bearer ${apiKey}`, 
            'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ 
            model: 'llama-3.3-70b-versatile', 
            messages: [{ role: 'user', content: prompt }], 
            temperature: 0.1,
            response_format: { type: "json_object" }
        }),
    });
    if (!res.ok) throw new Error(`Groq error: ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
}

export interface NoteAnalysisResult {
    category: NoteCategory;
    suggestedCaseIds: string[];
    tasks: Array<{
        text: string;
        assignee: string;
        urgency: 'Critical' | 'High' | 'Medium' | 'Low';
        deadline_days: number;
    }>;
    summary: string;
}

export async function analyseNoteContent(content: string, cases: Case[]): Promise<NoteAnalysisResult> {
    const activeCases = cases.filter(c => !c.archived).slice(0, 20);
    
    // Build context of cases for matching
    const caseContext = activeCases.map(c => ({
        id: c.id,
        title: c.displayTitle || `${c.petitioner} vs ${c.respondent}`,
        number: c.caseNumber || c.diaryNumber,
        petitioner: c.petitioner,
        respondent: c.respondent
    }));

    const prompt = `
You are a legal AI assistant for a Supreme Court law firm. 
Analyse the following note (transcribed from voice or typed) and provide structured metadata.

NOTE CONTENT:
"${content}"

AVAILABLE CASES (Context):
${JSON.stringify(caseContext, null, 2)}

TASK:
1. CATEGORY: Classify the note into exactly one of: 'Strategy', 'Task', 'Idea', 'Problem', 'Research', 'Document Requirement', 'General'.
2. CASE MATCHING: Identify which cases this note refers to. Return an array of matching Case IDs. If no clear match, return empty array.
3. TASK EXTRACTION: If the note contains actionable items (e.g. "Draft an IA", "Call the client", "Check the diary"), extract them.
   - For each task, assign an urgency (Critical, High, Medium, Low).
   - Assign a role: "Advocate", "Associate Advocate", or "Paralegal / Clerk".
   - Suggest deadline_days (0 for today, 1 for tomorrow, etc.).
4. SUMMARY: A very brief (10 word) summary of the note.

RETURN JSON FORMAT ONLY:
{
  "category": "string",
  "suggestedCaseIds": ["uuid", ...],
  "tasks": [
    { "text": "string", "assignee": "string", "urgency": "string", "deadline_days": number }
  ],
  "summary": "string"
}
`;

    try {
        const responseText = await callGroq(prompt);
        return JSON.parse(responseText) as NoteAnalysisResult;
    } catch (err) {
        console.error('[Note AI] Analysis failed:', err);
        return {
            category: 'General',
            suggestedCaseIds: [],
            tasks: [],
            summary: content.slice(0, 30) + '...'
        };
    }
}
