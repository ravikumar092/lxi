/**
 * Lex Tigress — AI Proxy Edge Function
 *
 * Routes AI requests to Claude or Groq. API keys are stored as
 * Edge Function secrets — never exposed to the browser.
 *
 * Replaces direct callClaude / callGroq calls in aiTaskService.ts.
 *
 * Request body:
 *   { provider: 'claude' | 'groq', prompt: string, model?: string,
 *     temperature?: number, maxTokens?: number }
 *
 * Usage from frontend:
 *   fetch(`${VITE_SUPABASE_URL}/functions/v1/ai-proxy`, {
 *     method: 'POST',
 *     headers: {
 *       'Content-Type': 'application/json',
 *       'Authorization': `Bearer ${session.access_token}`,
 *       'apikey': VITE_SUPABASE_ANON_KEY,
 *     },
 *     body: JSON.stringify({ provider: 'claude', prompt: '...' })
 *   })
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const GROQ_KEY      = Deno.env.get('GROQ_API_KEY')      ?? '';
const CORS_HEADERS  = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const { provider, prompt, model, temperature = 0.1, maxTokens = 2000 } = await req.json();

  // ── Claude ────────────────────────────────────────────────────────────────
  if (provider === 'claude') {
    const claudeModel = model || 'claude-sonnet-4-6';
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json',
      },
      body: JSON.stringify({
        model:      claudeModel,
        max_tokens: maxTokens,
        temperature,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });
    const data = await r.json();
    return new Response(JSON.stringify(data), {
      status:  r.status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // ── Groq ──────────────────────────────────────────────────────────────────
  if (provider === 'groq') {
    const groqModel = model || 'llama-3.3-70b-versatile';
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model:       groqModel,
        messages:    [{ role: 'user', content: prompt }],
        temperature,
        max_tokens:  maxTokens,
      }),
    });
    const data = await r.json();
    return new Response(JSON.stringify(data), {
      status:  r.status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Unknown provider. Use "claude" or "groq".' }), {
    status:  400,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
});
