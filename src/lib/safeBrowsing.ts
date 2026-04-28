/**
 * safeBrowsing.ts — Google Safe Browsing API integration
 *
 * Client-side module that checks URLs against Google Safe Browsing API
 * via our backend endpoint. Results are cached in memory.
 *
 * Usage:
 *   const result = await checkUrlSafety('https://example.com');
 *   // result = { safe: true } or { safe: false, threats: ['MALWARE'] }
 */

const API_ENDPOINT = '/api/check-url';

// In-memory cache: URL → { safe: boolean, threats?: string[], checkedAt: number }
const safetyCache = new Map<string, { safe: boolean; threats?: string[]; checkedAt: number }>();

// Cache TTL: 1 hour (URLs don't change safety status frequently)
const CACHE_TTL_MS = 60 * 60 * 1000;

// Batch queue for efficient API calls
let batchQueue: string[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;
const BATCH_DELAY_MS = 100; // Wait 100ms to batch URLs

export interface SafeBrowsingResult {
  safe: boolean;
  threats?: string[];
  cached?: boolean;
}

/**
 * Check a single URL against the Safe Browsing API (with caching).
 * If the URL is already in the whitelist (checked by urlSafety.ts),
 * this function doesn't need to be called at all.
 */
export async function checkUrlSafety(url: string): Promise<SafeBrowsingResult> {
  // Check cache first
  const cached = safetyCache.get(url);
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
    return { safe: cached.safe, threats: cached.threats, cached: true };
  }

  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: [url] }),
    });

    if (!response.ok) {
      // If the API fails, we fail CLOSED (assume unsafe)
      console.warn(`Safe Browsing API failed for ${url}: ${response.status}`);
      return { safe: false, threats: ['API_ERROR'] };
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      console.warn(`Safe Browsing API response not JSON for ${url}`);
      return { safe: false, threats: ['API_ERROR'] };
    }

    const result = data.results?.[url];

    if (result) {
      const safe = result.safe !== false;
      const threats = result.threats || [];

      // Cache the result
      safetyCache.set(url, { safe, threats, checkedAt: Date.now() });

      return { safe, threats };
    }

    // No result for this URL — assume unsafe
    return { safe: false, threats: ['NO_RESULT'] };
  } catch (error) {
    console.warn(`Safe Browsing check failed for ${url}:`, error);
    // Network error — fail closed
    return { safe: false, threats: ['NETWORK_ERROR'] };
  }
}

/**
 * Check multiple URLs in a single batch API call.
 * More efficient than individual calls when sanitizing an entire travel plan.
 */
export async function checkUrlsSafety(urls: string[]): Promise<Map<string, SafeBrowsingResult>> {
  const results = new Map<string, SafeBrowsingResult>();

  // Filter out cached URLs
  const uncached: string[] = [];
  for (const url of urls) {
    const cached = safetyCache.get(url);
    if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
      results.set(url, { safe: cached.safe, threats: cached.threats, cached: true });
    } else {
      uncached.push(url);
    }
  }

  if (uncached.length === 0) {
    return results;
  }

  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: uncached }),
    });

    if (!response.ok) {
      // API failure — fail closed for all uncached URLs
      console.warn(`[SafeBrowsing] API returned ${response.status} ${response.statusText}`);
      for (const url of uncached) {
        results.set(url, { safe: false, threats: ['API_ERROR'] });
      }
      return results;
    }

    let data: any;
    try {
      data = await response.json();
    } catch (parseErr) {
      // Response is not JSON (e.g., 405 returns HTML from SPA rewrite)
      console.warn('[SafeBrowsing] API response is not valid JSON:', parseErr);
      for (const url of uncached) {
        results.set(url, { safe: false, threats: ['API_ERROR'] });
      }
      return results;
    }

    for (const url of uncached) {
      const result = data.results?.[url];
      if (result) {
        const safe = result.safe !== false;
        const threats = result.threats || [];
        safetyCache.set(url, { safe, threats, checkedAt: Date.now() });
        results.set(url, { safe, threats });
      } else {
        results.set(url, { safe: false, threats: ['NO_RESULT'] });
      }
    }
  } catch (error) {
    console.warn('Safe Browsing batch check failed:', error);
    for (const url of uncached) {
      results.set(url, { safe: false, threats: ['NETWORK_ERROR'] });
    }
  }

  return results;
}

/**
 * Clear the safety cache. Useful for testing or when the user refreshes a plan.
 */
export function clearSafetyCache(): void {
  safetyCache.clear();
}