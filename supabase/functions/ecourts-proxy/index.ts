/**
 * Lex Tigress — eCourts Proxy Edge Function
 * Proxies requests to eCourts India Partner API.
 * ECOURTS_MCP_TOKEN stays server-side — never exposed to browser.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const ECOURTS_BASE  = 'https://webapi.ecourtsindia.com';
const ECOURTS_TOKEN = Deno.env.get('ECOURTS_MCP_TOKEN') ?? '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-pdf',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  // Strip the edge function path prefix
  const url = new URL(req.url);
  const ecourtsPath = url.pathname.replace(/^\/functions\/v1\/ecourts-proxy/, '');
  const targetUrl   = `${ECOURTS_BASE}${ecourtsPath}${url.search}`;

  const isPdf = req.headers.get('x-pdf') === '1' || ecourtsPath.includes('order-document');

  console.log(`[ecourts-proxy] token set: ${!!ECOURTS_TOKEN}, token prefix: ${ECOURTS_TOKEN.slice(0,8)}, url: ${targetUrl}`)

  try {
    const upstream = await fetch(targetUrl, {
      method:  req.method,
      headers: {
        'Authorization': `Bearer ${ECOURTS_TOKEN}`,
        'Content-Type':  'application/json',
        'Cache-Control': 'no-store',
      },
      body: req.method !== 'GET' ? req.body : undefined,
    });
    console.log(`[ecourts-proxy] upstream status: ${upstream.status}`)

    if (isPdf) {
      const buf = await upstream.arrayBuffer();
      return new Response(buf, {
        status: upstream.status,
        headers: {
          ...CORS_HEADERS,
          'Content-Type':        'application/pdf',
          'Content-Disposition': 'inline',
        },
      });
    }

    const text = await upstream.text();
    return new Response(text, {
      status:  upstream.status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status:  500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
