/**
 * Vercel Serverless Function — eCourts PDF Binary Proxy
 *
 * Handles: /ecourts-pdf/* → https://webapi.ecourtsindia.com/*
 * Returns PDF binary with correct Content-Type so <iframe> can render inline.
 *
 * Note: Vercel hobby plan has 4.5MB response limit.
 * Court order PDFs are typically < 1MB so this should be fine.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.ECOURTS_MCP_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'Server misconfigured: ECOURTS_MCP_TOKEN not set' });
  }

  const slug = req.query.slug;
  const pathSegments = Array.isArray(slug) ? slug : slug ? [slug] : [];
  const apiPath = pathSegments.join('/');

  const { slug: _slug, ...restQuery } = req.query;
  const qs = new URLSearchParams(restQuery).toString();

  const targetUrl = `https://webapi.ecourtsindia.com/${apiPath}${qs ? '?' + qs : ''}`;
  console.log(`[ecourts-pdf-proxy] ${targetUrl}`);

  try {
    const response = await fetch(targetUrl, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `eCourts returned ${response.status}` });
    }

    const contentType = response.headers.get('content-type') || 'application/pdf';
    const buf = Buffer.from(await response.arrayBuffer());

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', 'inline');
    return res.send(buf);
  } catch (err) {
    console.error('[ecourts-pdf-proxy] error:', err.message);
    return res.status(502).json({ error: 'PDF proxy error', message: err.message });
  }
}
