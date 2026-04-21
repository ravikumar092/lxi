/**
 * Vercel Serverless Function — SC Advance List PDF Proxy
 *
 * Handles: /advance-list/{date}/M_J.pdf
 *          → https://api.sci.gov.in/jonew/cl/advance/{date}/M_J.pdf
 *
 * Deployed in Mumbai (bom1) so api.sci.gov.in is reachable.
 * Adds CORS headers so the browser at lex-tigress.vercel.app can fetch it.
 *
 * No auth required — SC advance list PDFs are publicly accessible.
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const slug = req.query.slug;
  const pathSegments = Array.isArray(slug) ? slug : slug ? [slug] : [];
  const apiPath = pathSegments.join('/');

  const targetUrl = `https://api.sci.gov.in/jonew/cl/advance/${apiPath}`;
  console.log(`[advance-list-proxy] ${targetUrl}`);

  try {
    const response = await fetch(targetUrl, {
      signal: AbortSignal.timeout(30000),
      headers: {
        'Accept': 'application/pdf,*/*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `SC returned ${response.status}` });
    }

    const buf = await response.arrayBuffer();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'public, max-age=21600'); // 6 hours
    return res.status(200).send(Buffer.from(buf));
  } catch (err) {
    console.error('[advance-list-proxy] error:', err.message);
    return res.status(502).json({ error: 'Advance list proxy error', message: err.message });
  }
}
