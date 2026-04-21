/**
 * Vercel Serverless Function — Supreme Court Website Proxy
 *
 * Handles: /sci-wp/* → https://www.sci.gov.in/*
 * Bypasses browser CORS restriction on sci.gov.in. No auth token needed.
 *
 * Used for: office reports, earlier court details, last orders, filed documents
 * All accessed via WordPress AJAX endpoint: /wp-admin/admin-ajax.php
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Reconstruct path from catch-all slug
  // e.g. slug = ['wp-admin', 'admin-ajax.php']
  //      → /wp-admin/admin-ajax.php
  const slug = req.query.slug;
  const pathSegments = Array.isArray(slug) ? slug : slug ? [slug] : [];
  const apiPath = pathSegments.join('/');

  // Forward all query params except 'slug'
  const { slug: _slug, ...restQuery } = req.query;
  const qs = new URLSearchParams(restQuery).toString();

  const targetUrl = `https://www.sci.gov.in/${apiPath}${qs ? '?' + qs : ''}`;
  console.log(`[sci-wp-proxy] ${targetUrl}`);

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.sci.gov.in/',
        'Origin': 'https://www.sci.gov.in',
      },
    });

    // sci.gov.in sometimes returns "0", "-1", or plain HTML instead of JSON
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      console.warn(`[sci-wp-proxy] non-JSON response: ${text.slice(0, 80)}`);
      data = { status: false, data: text };
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.status(200).json(data);
  } catch (err) {
    console.error('[sci-wp-proxy] error:', err.message);
    return res.status(502).json({ error: 'SC proxy error', message: err.message });
  }
}
