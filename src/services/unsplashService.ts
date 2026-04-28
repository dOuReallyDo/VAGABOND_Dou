/**
 * Unsplash Image Service — VAGABOND_Dou
 *
 * Searches Unsplash for destination-coherent images.
 * - Uses /search/photos API with keyword-based queries
 * - Caches results in memory (session-level) to minimize API calls
 * - Graceful degradation: returns null if API key missing or on error
 * - Hotlinking allowed per Unsplash API guidelines
 *
 * Free tier: 50 requests/hour (demo mode) — more than enough for trip planning
 */

const UNSPLASH_API_BASE = 'https://api.unsplash.com';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// In-memory cache: keyword → { url, timestamp }
const imageCache = new Map<string, { url: string; timestamp: number }>();

/** Get the Unsplash access key from environment */
function getAccessKey(): string | null {
  return import.meta.env.VITE_UNSPLASH_ACCESS_KEY || null;
}

/** Clean up cache entries older than TTL */
function cleanCache(): void {
  const now = Date.now();
  for (const [key, entry] of imageCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      imageCache.delete(key);
    }
  }
}

/**
 * Search Unsplash for a photo matching the given keywords.
 * Returns the best matching small image URL, or null if not found / error.
 *
 * @param keywords - Search terms (e.g. "Colosseum Rome", "Santorini sunset")
 * @param orientation - 'landscape' (default), 'portrait', or 'squarish'
 * @returns Unsplash image URL or null
 */
export async function searchUnsplashImage(
  keywords: string,
  orientation: 'landscape' | 'portrait' | 'squarish' = 'landscape'
): Promise<string | null> {
  const accessKey = getAccessKey();
  if (!accessKey) {
    console.info('[Unsplash] No VITE_UNSPLASH_ACCESS_KEY set — skipping image search. Add it to .env or Vercel env vars.');
    return null;
  }

  const cacheKey = `${keywords.toLowerCase().trim()}|${orientation}`;
  cleanCache();

  // Check cache first
  const cached = imageCache.get(cacheKey);
  if (cached) {
    return cached.url;
  }

  try {
    const params = new URLSearchParams({
      query: keywords,
      per_page: '5',
      orientation,
      content_filter: 'high', // safe content
    });

    const response = await fetch(
      `${UNSPLASH_API_BASE}/search/photos?${params.toString()}`,
      {
        headers: {
          Authorization: `Client-ID ${accessKey}`,
          'Accept-Version': 'v1',
        },
      }
    );

    if (!response.ok) {
      console.warn(`[Unsplash] API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();

    if (!data.results || data.results.length === 0) {
      return null;
    }

    // Pick the most relevant result (first)
    const photo = data.results[0];
    // Use 'regular' size (1080px wide) — good quality, reasonable bandwidth
    const imageUrl = photo.urls?.regular || photo.urls?.small || null;

    if (imageUrl) {
      imageCache.set(cacheKey, { url: imageUrl, timestamp: Date.now() });
      return imageUrl;
    }

    return null;
  } catch (err) {
    console.warn('[Unsplash] Search failed:', err);
    return null;
  }
}

/**
 * Batch-search images for multiple keywords at once.
 * Returns a Map of keyword → imageUrl (null if not found).
 * Runs requests in parallel with a small stagger to respect rate limits.
 */
export async function searchUnsplashImages(
  keywordsList: string[],
  orientation: 'landscape' | 'portrait' | 'squarish' = 'landscape'
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();

  const promises = keywordsList.map(async (kw, index) => {
    // Small stagger: 200ms between requests to avoid burst
    if (index > 0) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const url = await searchUnsplashImage(kw, orientation);
    results.set(kw, url);
  });

  await Promise.all(promises);
  return results;
}

/**
 * Build a direct Unsplash source URL (no API call needed).
 * This uses Unsplash's dynamic image resize feature.
 * Less contextually relevant than search, but works without API key.
 *
 * Format: https://source.unsplash.com/800x600/?{keywords}
 * NOTE: source.unsplash.com was deprecated. Use picsum.photos as fallback instead.
 */
export function getFallbackImageUrl(keyword: string, width = 800, height = 600): string {
  const kw = keyword.toLowerCase().replace(/[^a-z0-9]/g, '').trim().slice(0, 60);
  return `https://picsum.photos/seed/${kw}/${width}/${height}`;
}

/** Clear the image cache (useful for testing or memory management) */
export function clearImageCache(): void {
  imageCache.clear();
}