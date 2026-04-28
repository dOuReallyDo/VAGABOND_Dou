import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Google Safe Browsing API proxy endpoint for Vercel serverless deployment.
 * Checks URLs against Google's Safe Browsing threat database.
 *
 * POST /api/check-url
 * Body: { urls: string[] }
 * Response: { results: { [url]: { safe: boolean, threats: string[] } } }
 */

// In-memory cache (per-function invocation — not shared across instances, but helps repeated calls)
const safetyCache = new Map<string, { safe: boolean; threats: string[]; checkedAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed — use POST" });
  }

  const { urls } = req.body as { urls?: string[] };

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: "Missing or invalid 'urls' array" });
  }

  const API_KEY = process.env.GOOGLE_SAFE_BROWSING_API_KEY;

  if (!API_KEY) {
    // No API key configured — return safe for all URLs (whitelist-only mode)
    const results: Record<string, { safe: boolean; threats: string[] }> = {};
    for (const url of urls) {
      results[url] = { safe: true, threats: [] };
    }
    return res.json({ results });
  }

  try {
    const results: Record<string, { safe: boolean; threats: string[] }> = {};

    // Check cache first, collect uncached URLs
    const uncached: string[] = [];
    for (const url of urls) {
      const cached = safetyCache.get(url);
      if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
        results[url] = { safe: cached.safe, threats: cached.threats };
      } else {
        uncached.push(url);
      }
    }

    // If all cached, return immediately
    if (uncached.length === 0) {
      return res.json({ results });
    }

    // Batch check uncached URLs via Google Safe Browsing API
    const batch = uncached.slice(0, 500); // API limit

    const response = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: {
            clientId: "vagabond-dou",
            clientVersion: "1.0.0",
          },
          threatInfo: {
            threatTypes: [
              "MALWARE",
              "SOCIAL_ENGINEERING",
              "UNWANTED_SOFTWARE",
              "POTENTIALLY_HARMFUL_APPLICATION",
            ],
            platformTypes: ["ANY_PLATFORM"],
            threatEntryTypes: ["URL"],
            threatEntries: batch.map((url: string) => ({ url })),
          },
        }),
      }
    );

    if (!response.ok) {
      // API error — fail closed (assume unsafe) for uncached URLs
      for (const url of uncached) {
        results[url] = { safe: false, threats: ["API_ERROR"] };
      }
      return res.json({ results });
    }

    const data = await response.json();
    const matches = data.matches || [];

    // Build a map of matched URLs to their threats
    const threatMap = new Map<string, string[]>();
    for (const match of matches) {
      const matchedUrl = match.threat?.url || "";
      const threatType = match.threatType || "UNKNOWN";
      const existing = threatMap.get(matchedUrl) || [];
      if (!existing.includes(threatType)) {
        existing.push(threatType);
      }
      threatMap.set(matchedUrl, existing);
    }

    // Process uncached URLs
    for (const url of uncached) {
      const threats = threatMap.get(url);
      const result = {
        safe: !threats,
        threats: threats || [],
      };
      results[url] = result;
      // Cache the result
      safetyCache.set(url, { ...result, checkedAt: Date.now() });
    }

    return res.json({ results });
  } catch (error) {
    console.error("Safe Browsing API error:", error);
    // Network/unknown error — fail closed
    const results: Record<string, { safe: boolean; threats: string[] }> = {};
    for (const url of urls) {
      results[url] = { safe: false, threats: ["NETWORK_ERROR"] };
    }
    return res.json({ results });
  }
}