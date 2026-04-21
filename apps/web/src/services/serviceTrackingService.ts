/**
 * Lex Tigress — Service Tracking Service (India Post)
 *
 * Tracks speed post / registered AD consignment numbers via India Post.
 * This is the same data the SC registrar manually looks up and writes
 * into the office report ("Item Delivered (Addressee)").
 *
 * CORS note: India Post's tracking API blocks direct browser calls.
 * Solutions in order of preference:
 *   1. Add '/indiapost' proxy in vite.config.ts (dev) — see comment below
 *   2. Netlify/Vercel serverless function (production)
 *   3. The mock fallback here shows the pattern so AOR can enter manually
 *
 * To add the proxy in vite.config.ts:
 *   '/indiapost': {
 *     target: 'https://www.indiapost.gov.in',
 *     changeOrigin: true,
 *     rewrite: (path) => path.replace(/^\/indiapost/, '')
 *   }
 */

import type { IndiaPostTrackResult, DeliveryStatus } from '../types/hearingPrep';

// ── CONFIG ────────────────────────────────────────────────────────────────────

/** Change to '/indiapost' once proxy is added to vite.config.ts */
const INDIA_POST_BASE =
  import.meta.env.DEV && window.location.protocol === 'http:'
    ? '/indiapost'
    : 'https://www.indiapost.gov.in';

const TRACK_ENDPOINT = `${INDIA_POST_BASE}/_layouts/15/dop.aspx/GetArticleDetails`;

// Cache tracking results for 30 minutes to avoid hammering the API
const CACHE_TTL_MS = 30 * 60 * 1000;

// ── STORAGE HELPERS ───────────────────────────────────────────────────────────

const TRACKING_CACHE_KEY = 'lextgress_tracking_cache';

function loadTrackingCache(): Record<string, IndiaPostTrackResult> {
  try {
    const raw = localStorage.getItem(TRACKING_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveTrackingCache(cache: Record<string, IndiaPostTrackResult>): void {
  try {
    localStorage.setItem(TRACKING_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Storage full — clear old entries
    localStorage.removeItem(TRACKING_CACHE_KEY);
  }
}

function isCacheValid(result: IndiaPostTrackResult): boolean {
  if (!result.checkedAt) return false;
  const age = Date.now() - new Date(result.checkedAt).getTime();
  // Don't re-check if already delivered
  if (result.status === 'delivered') return true;
  return age < CACHE_TTL_MS;
}

// ── MAIN TRACKING FUNCTION ────────────────────────────────────────────────────

/**
 * Track a single consignment number.
 * Returns cached result if fresh; else fetches live.
 *
 * @param trackingNo  India Post consignment number (e.g. "EW123456789IN")
 */
export async function trackConsignment(
  trackingNo: string
): Promise<IndiaPostTrackResult> {
  const normalised = trackingNo.trim().toUpperCase();

  // Check cache
  const cache = loadTrackingCache();
  if (cache[normalised] && isCacheValid(cache[normalised])) {
    return cache[normalised];
  }

  // Try live fetch
  const result = await fetchLiveTracking(normalised);

  // Save to cache
  cache[normalised] = result;
  saveTrackingCache(cache);

  return result;
}

async function fetchLiveTracking(trackingNo: string): Promise<IndiaPostTrackResult> {
  try {
    const res = await fetch(TRACK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ strArticleNo: trackingNo }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return buildErrorResult(trackingNo, `HTTP ${res.status}`);
    }

    const data = await res.json();
    return parseIndiaPostResponse(trackingNo, data);
  } catch (err: any) {
    // CORS error in dev without proxy
    if (err?.message?.includes('CORS') || err?.message?.includes('Failed to fetch')) {
      return buildErrorResult(
        trackingNo,
        'CORS — add /indiapost proxy to vite.config.ts for dev, or use Netlify function in production'
      );
    }
    return buildErrorResult(trackingNo, err?.message ?? 'Network error');
  }
}

/**
 * Parse India Post's JSON response into our standard format.
 * The actual response structure from their internal API:
 * { d: { Table: [{ Article_No, Delivery_Status, Delivery_Date, ... }] } }
 */
function parseIndiaPostResponse(trackingNo: string, data: any): IndiaPostTrackResult {
  try {
    // India Post returns data inside a "d" wrapper (ASP.NET Web Services pattern)
    const payload = data?.d ?? data;
    const table = payload?.Table ?? payload?.result ?? [];
    const latest = Array.isArray(table) ? table[0] : table;

    if (!latest) {
      return buildErrorResult(trackingNo, 'No tracking data found');
    }

    const statusRaw: string = (
      latest.Delivery_Status ??
      latest.status ??
      latest.Status ??
      ''
    ).toLowerCase();

    const status: DeliveryStatus = mapStatus(statusRaw);

    const deliveryDate =
      latest.Delivery_Date ?? latest.delivery_date ?? latest.DeliveryDate ?? null;

    const location =
      latest.Office ?? latest.office ?? latest.Location ?? latest.location ?? null;

    const lastEvent =
      latest.Event ?? latest.event ?? latest.Remarks ?? latest.remarks ?? statusRaw;

    return {
      trackingNo,
      status,
      deliveryDate: deliveryDate ? normaliseDate(String(deliveryDate)) : null,
      currentLocation: location ? String(location).trim() : null,
      lastEvent: lastEvent ? String(lastEvent).trim().slice(0, 200) : null,
      checkedAt: new Date().toISOString(),
      error: null,
    };
  } catch (e: any) {
    return buildErrorResult(trackingNo, `Parse error: ${e?.message}`);
  }
}

function mapStatus(raw: string): DeliveryStatus {
  if (!raw) return 'unknown';
  if (raw.includes('delivered') || raw.includes('addressee')) return 'delivered';
  if (raw.includes('transit') || raw.includes('in bag') || raw.includes('dispatched')) return 'in_transit';
  if (raw.includes('not delivered') || raw.includes('undelivered') || raw.includes('returned')) return 'not_delivered';
  if (raw.includes('no one') || raw.includes('not entered') || raw.includes('appearance')) return 'not_entered';
  return 'unknown';
}

function buildErrorResult(trackingNo: string, error: string): IndiaPostTrackResult {
  return {
    trackingNo,
    status: 'unknown',
    deliveryDate: null,
    currentLocation: null,
    lastEvent: null,
    checkedAt: new Date().toISOString(),
    error,
  };
}

function normaliseDate(raw: string): string {
  const m = raw.match(/(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return raw;
}

// ── BATCH TRACKER ─────────────────────────────────────────────────────────────

/**
 * Track all respondents in a case that have a trackingNumber set.
 * Returns updated respondents array.
 */
export async function trackAllRespondents(
  respondents: Array<{ name: string; trackingNumber: string | null; [key: string]: any }>
): Promise<typeof respondents> {
  const results = await Promise.allSettled(
    respondents.map(async (r) => {
      if (!r.trackingNumber) return r;
      const result = await trackConsignment(r.trackingNumber);
      return {
        ...r,
        deliveryStatus: result.status,
        deliveryDate: result.deliveryDate,
        deliveryLocation: result.currentLocation,
        lastTrackingEvent: result.lastEvent,
        lastTrackedAt: result.checkedAt,
      };
    })
  );

  return results.map((r, i) =>
    r.status === 'fulfilled' ? r.value : respondents[i]
  );
}

// ── STATUS DISPLAY HELPERS ────────────────────────────────────────────────────

export function getDeliveryStatusLabel(status: DeliveryStatus): string {
  const labels: Record<DeliveryStatus, string> = {
    delivered: 'Delivered',
    in_transit: 'In Transit',
    not_delivered: 'Not Delivered',
    not_entered: 'No Appearance',
    unknown: 'Unknown',
  };
  return labels[status] ?? 'Unknown';
}

export function getDeliveryStatusColor(status: DeliveryStatus): string {
  const colors: Record<DeliveryStatus, string> = {
    delivered: '#1A8C5B',
    in_transit: '#9B7B28',
    not_delivered: '#C62828',
    not_entered: '#6A74A0',
    unknown: '#9B9BAA',
  };
  return colors[status] ?? '#9B9BAA';
}

export function getDeliveryStatusBg(status: DeliveryStatus): string {
  const bgs: Record<DeliveryStatus, string> = {
    delivered: '#E8F5EF',
    in_transit: '#FBF4E3',
    not_delivered: '#FEF2F2',
    not_entered: '#F0F2F8',
    unknown: '#F5F5F7',
  };
  return bgs[status] ?? '#F5F5F7';
}