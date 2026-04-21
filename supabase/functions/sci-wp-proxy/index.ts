/**
 * Lex Tigress — SC WordPress Proxy Edge Function
 *
 * Proxies requests to the Supreme Court WordPress API.
 * Replaces the Express /sci-wp/* route.
 *
 * Usage from frontend:
 *   fetch(`${VITE_SUPABASE_URL}/functions/v1/sci-wp-proxy/wp-admin/admin-ajax.php?...`, {
 *     headers: { Authorization: `Bearer ${session.access_token}`, apikey: VITE_SUPABASE_ANON_KEY }
 *   })
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const SC_BASE      = 'https://www.sci.gov.in';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const scPath    = url.pathname.replace(/^\/functions\/v1\/sci-wp-proxy/, '');
  const targetUrl = `${SC_BASE}${scPath}${url.search}`;

  const upstream = await fetch(targetUrl, {
    method:  req.method,
    headers: {
      'Accept':     'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    body: req.method !== 'GET' ? req.body : undefined,
  });

  const text = await upstream.text();
  let data: unknown;
  try { data = JSON.parse(text); }
  catch { data = { status: false, data: text }; }

  return new Response(JSON.stringify(data), {
    status: upstream.status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
});
