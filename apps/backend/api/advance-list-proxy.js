/**
 * Vercel Serverless Function — SC Advance List PDF Proxy
 *
 * Usage: /api/advance-list-proxy?date=2026-03-24
 * Streams: https://api.sci.gov.in/jonew/cl/advance/{date}/M_J.pdf
 *
 * Uses Web Streams reader to chunk-stream the PDF without buffering.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { date } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Missing or invalid date param (YYYY-MM-DD)' });
  }

  const targetUrl = `https://api.sci.gov.in/jonew/cl/advance/${date}/M_J.pdf`;
  console.log(`[advance-list-proxy] fetching ${targetUrl}`);

  try {
    const response = await fetch(targetUrl, {
      signal: AbortSignal.timeout(55000),
      headers: {
        'Accept': 'application/pdf,*/*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    console.log(`[advance-list-proxy] status=${response.status} type=${response.headers.get('content-type')}`);

    if (!response.ok) {
      return res.status(response.status).json({ error: `SC returned ${response.status}`, date });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200);

    // Stream chunk by chunk using Web Streams reader — no imports needed
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    console.error('[advance-list-proxy] error:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Advance list proxy error', message: err.message, date });
    } else {
      res.end();
    }
  }
}
