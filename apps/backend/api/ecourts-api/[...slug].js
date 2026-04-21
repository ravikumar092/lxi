/**
 * Vercel Serverless Function — eCourts India API Proxy
 *
 * Handles: /ecourts-api/* → https://webapi.ecourtsindia.com/*
 * Adds the secret Bearer token (stored in Vercel env vars, never exposed to browser).
 *
 * Set ECOURTS_MCP_TOKEN in Vercel Project → Settings → Environment Variables
 */
export default async function handler(req, res) {
  // CORS headers (browser fetch requires these)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.ECOURTS_MCP_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'Server misconfigured: ECOURTS_MCP_TOKEN not set in Vercel env vars' });
  }

  // Reconstruct API path from catch-all slug segments
  // e.g. slug = ['api', 'partner', 'case', 'SCIN010012352026']
  //      → apiPath = 'api/partner/case/SCIN010012352026'
  const slug = req.query.slug;
  const pathSegments = Array.isArray(slug) ? slug : slug ? [slug] : [];
  const apiPath = pathSegments.join('/');

  // Forward all query params except 'slug' (Vercel injects slug internally)
  const { slug: _slug, ...restQuery } = req.query;
  const qs = new URLSearchParams(restQuery).toString();

  const targetUrl = `https://webapi.ecourtsindia.com/${apiPath}${qs ? '?' + qs : ''}`;
  console.log(`[ecourts-proxy] ${req.method} ${targetUrl}`);

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.status(response.status).json(data);
  } catch (err) {
    console.error('[ecourts-proxy] error:', err.message);
    return res.status(502).json({ error: 'eCourts proxy error', message: err.message });
  }
}
