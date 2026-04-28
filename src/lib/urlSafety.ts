/**
 * urlSafety.ts — URL Safety Module for VAGABOND_Dou
 *
 * Multi-layer URL verification system that:
 * 1. Whitelists known-safe domains (booking.com, tripadvisor.it, etc.)
 * 2. Validates URL structure (HTTPS, no IP addresses, no shorteners)
 * 3. Generates safe alternatives for rejected URLs (Booking search, TripAdvisor search, etc.)
 * 4. Integrates with Google Safe Browsing API for unknown domains
 *
 * Rule: If a URL is NOT verified safe, it is REMOVED and REPLACED with a safe alternative.
 * No yellow/red badges — the user never sees a dangerous or unverifiable link.
 */

// ─── TYPES ───────────────────────────────────────────────────────────

export type UrlContext = 'hotel' | 'flight' | 'restaurant' | 'attraction' | 'transport' | 'blog' | 'generic';

export interface UrlSafetyResult {
  /** Whether the original URL is safe to show */
  isSafe: boolean;
  /** The URL to actually display (original if safe, alternative if not) */
  safeUrl: string | null;
  /** Why the URL was rejected, if applicable */
  reason?: string;
  /** The category of safety determination */
  category: 'whitelisted' | 'valid-unknown' | 'unsafe' | 'invalid';
}

// ─── WHITELIST ────────────────────────────────────────────────────────

/** Domains we trust unconditionally — these bypass all other checks */
const SAFE_DOMAINS: Set<string> = new Set([
  // Accommodation platforms
  'booking.com', 'www.booking.com',
  'airbnb.com', 'www.airbnb.com',
  'hotels.com', 'www.hotels.com',
  'expedia.it', 'www.expedia.it',
  'agoda.com', 'www.agoda.com',
  'hostelworld.com', 'www.hostelworld.com',

  // Review & travel info platforms
  'tripadvisor.it', 'www.tripadvisor.it',
  'tripadvisor.com', 'www.tripadvisor.com',
  'viaggisicuri.it', 'www.viaggisicuri.it',
  'lonelyplanet.com', 'www.lonelyplanet.com',
  'rome2rio.com', 'www.rome2rio.com',

  // Flight & airline official sites
  'ryanair.com', 'www.ryanair.com',
  'easyjet.com', 'www.easyjet.com',
  'tap.pt', 'www.tap.pt',
  'trenitalia.com', 'www.trenitalia.com',
  'italotreno.it', 'www.italotreno.it',
  'wizzair.com', 'www.wizzair.com',
  'volotea.com', 'www.volotea.com',
  'vueling.com', 'www.vueling.com',
  'alitalia.it', 'www.alitalia.it',
  'itasoftware.com', 'www.itasoftware.com',
  'skyscanner.it', 'www.skyscanner.it',
  'kayak.it', 'www.kayak.it',
  'google.com', 'www.google.com',
  'maps.google.com',

  // Transport
  'uber.com', 'www.uber.com',
  'lyft.com', 'www.lyft.com',
  'blablacar.it', 'www.blablacar.it',
  'flixbus.it', 'www.flixbus.it',
  'omio.com', 'www.omio.com',
  'trainline.eu', 'www.trainline.eu',

  // Italian government & institutional
  'esteri.it', 'www.esteri.it',
  'viaggiaresicuri.it', 'www.viaggiaresicuri.it',
  'gov.it', 'www.gov.it',
  'salute.gov.it', 'www.salute.gov.it',

  // Image providers (used by app)
  'picsum.photos',
  'images.unsplash.com',

  // Major international airline sites
  'emirates.com', 'www.emirates.com',
  'lufthansa.com', 'www.lufthansa.com',
  'britishairways.com', 'www.britishairways.com',
  'airfrance.it', 'www.airfrance.it',
  'klm.com', 'www.klm.com',
  'swiss.com', 'www.swiss.com',
  'austrian.com', 'www.austrian.com',
  'iberia.com', 'www.iberia.com',
  'delta.com', 'www.delta.com',
  'united.com', 'www.united.com',
  'americanairlines.com', 'www.americanairlines.com',
  'cathaypacific.com', 'www.cathaypacific.com',
  'singaporeair.com', 'www.singaporeair.com',
  'qatarairways.com', 'www.qatarairways.com',
  'etihad.com', 'www.etihad.com',
  'turkishairlines.com', 'www.turkishairlines.com',
]);

/** Known URL shorteners — always blocked (potential phishing vectors) */
const URL_SHORTENERS: Set<string> = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd',
  'buff.ly', 'rb.gy', 'shorturl.at', 'cutt.ly', 'v.gd',
  'tr.im', 'cli.gs', 'lnkd.in', 'db.tt', 'qr.ae', 'adf.ly',
  'bitly.com', 'j.mp', 'ow.ly', 'ht.ly',
]);

/** Patterns that indicate suspicious redirect URLs */
const REDIRECT_PARAMS = [
  'redirect=', 'url=', 'next=', 'target=', 'redir=',
  'return=', 'returnto=', 'goto=', 'link=', 'dest=',
];

// ─── VALIDATION FUNCTIONS ─────────────────────────────────────────────

/**
 * Extracts the hostname from a URL string.
 * Returns null if the URL cannot be parsed.
 */
function getHostname(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Checks if a hostname is a raw IP address (v4 or v6).
 * URLs with IP addresses are often malicious.
 */
function isIpAddress(hostname: string): boolean {
  // IPv4
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    return true;
  }
  // IPv6
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return true;
  }
  return false;
}

/**
 * Checks if a URL is structurally valid and safe.
 * Returns { valid: boolean, reason?: string }
 */
function validateUrlStructure(url: string): { valid: boolean; reason?: string } {
  // Must be a string
  if (typeof url !== 'string' || url.trim() === '') {
    return { valid: false, reason: 'Empty URL' };
  }

  const trimmed = url.trim();

  // Must start with https:// (we reject http:// as potentially unsafe)
  if (!trimmed.startsWith('https://')) {
    if (trimmed.startsWith('http://')) {
      return { valid: false, reason: 'HTTP URL (not encrypted)' };
    }
    return { valid: false, reason: 'Not a valid URL (no protocol)' };
  }

  // Must parse as valid URL
  const hostname = getHostname(trimmed);
  if (!hostname) {
    return { valid: false, reason: 'Cannot parse URL' };
  }

  // No IP addresses
  if (isIpAddress(hostname)) {
    return { valid: false, reason: 'IP address URL' };
  }

  // No URL shorteners
  if (URL_SHORTENERS.has(hostname) || URL_SHORTENERS.has(`www.${hostname}`)) {
    return { valid: false, reason: 'URL shortener (potential phishing)' };
  }

  // No suspicious redirect patterns in query params
  for (const pattern of REDIRECT_PARAMS) {
    if (trimmed.toLowerCase().includes(pattern)) {
      return { valid: false, reason: `Suspicious redirect parameter: ${pattern.split('=')[0]}=` };
    }
  }

  // No common malicious TLD patterns
  const suspiciousTlds = ['.tk', '.ml', '.ga', '.cf', '.gq', '.xyz', '.top', '.buzz', '.icu'];
  for (const tld of suspiciousTlds) {
    if (hostname.endsWith(tld)) {
      return { valid: false, reason: `Suspicious TLD: ${tld}` };
    }
  }

  return { valid: true };
}

/**
 * Checks if a hostname belongs to a whitelisted domain.
 * Handles both exact matches and subdomain matches (e.g., pages.booking.com matches booking.com).
 */
function isWhitelisted(hostname: string): boolean {
  if (SAFE_DOMAINS.has(hostname)) return true;

  // Check if hostname is a subdomain of a whitelisted domain
  const domainsArray = Array.from(SAFE_DOMAINS);
  for (let i = 0; i < domainsArray.length; i++) {
    if (hostname.endsWith(`.${domainsArray[i]}`)) return true;
  }

  return false;
}

// ─── MAIN SAFETY CHECK ───────────────────────────────────────────────

/**
 * Checks if a URL is safe to display.
 * This is the SYNCHRONOUS check — it validates structure and whitelist.
 * For full safety, use checkUrlWithSafeBrowsing() which adds the async API check.
 */
export function isUrlSafe(url: string): UrlSafetyResult {
  // Structural validation first
  const structure = validateUrlStructure(url);
  if (!structure.valid) {
    return {
      isSafe: false,
      safeUrl: null,
      reason: structure.reason,
      category: 'invalid',
    };
  }

  const hostname = getHostname(url)!;

  // Whitelist check
  if (isWhitelisted(hostname)) {
    return {
      isSafe: true,
      safeUrl: url,
      category: 'whitelisted',
    };
  }

  // Valid URL but unknown domain — needs Safe Browsing API check
  return {
    isSafe: false, // Default to unsafe until verified by API
    safeUrl: null,
    reason: 'Unknown domain — needs Safe Browsing verification',
    category: 'valid-unknown',
  };
}

/**
 * Returns true if the URL passes structural + whitelist checks (no API call needed).
 * Used as a quick synchronous filter before async Safe Browsing checks.
 */
export function isWhitelistedUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const structure = validateUrlStructure(url);
  if (!structure.valid) return false;
  const hostname = getHostname(url);
  return hostname !== null && isWhitelisted(hostname);
}

// ─── SAFE ALTERNATIVE GENERATORS ──────────────────────────────────────

/**
 * Generates a safe Booking.com search URL for a hotel.
 */
export function getBookingSearchUrl(hotelName: string, city: string): string {
  const q = encodeURIComponent(`${hotelName} ${city}`);
  return `https://www.booking.com/searchresults.html?ss=${q}`;
}

/**
 * Generates a safe Booking.com search URL with dates and guests.
 */
export function getBookingSearchUrlWithDates(
  hotelName: string,
  city: string,
  checkin: string,
  checkout: string,
  adults: number,
  children?: { age: number }[]
): string {
  const q = encodeURIComponent(`${hotelName} ${city}`);
  const childParams = children?.map(c => `&age=${c.age}`).join('') || '';
  return `https://www.booking.com/searchresults.html?ss=${q}&checkin=${checkin}&checkout=${checkout}&group_adults=${adults}&group_children=${children?.length || 0}${childParams}&selected_currency=EUR`;
}

/**
 * Generates a safe TripAdvisor search URL.
 */
export function getTripAdvisorSearchUrl(name: string, location: string): string {
  const q = encodeURIComponent(`${name} ${location}`);
  return `https://www.tripadvisor.it/Search?q=${q}`;
}

/**
 * Generates a safe Google Maps URL for a location.
 */
export function getGoogleMapsUrl(name: string, city: string): string {
  const q = encodeURIComponent(`${name}, ${city}`);
  return `https://www.google.com/maps/search/${q}`;
}

/**
 * Generates a safe Viaggiaresicuri (Italian govt travel advisory) URL.
 */
export function getViaggiaSicuriUrl(country: string): string {
  const q = encodeURIComponent(country);
  return `https://www.viaggiaresicuri.it/find-country?search=${q}`;
}

/**
 * Generates an airline official site search URL or Google search.
 */
export function getAirlineSearchUrl(airlineName: string): string {
  const q = encodeURIComponent(`${airlineName} sito ufficiale`);
  return `https://www.google.com/search?q=${q}`;
}

/**
 * Generates a safe alternative URL based on the context.
 * Returns null if no suitable alternative can be generated (e.g., blog posts).
 */
export function getSafeAlternative(
  originalUrl: string,
  context: UrlContext,
  details: { name?: string; city?: string; checkin?: string; checkout?: string; adults?: number; children?: { age: number }[] }
): string | null {
  const name = details.name || '';
  const city = details.city || '';

  switch (context) {
    case 'hotel':
      if (name && city && details.checkin && details.checkout && details.adults) {
        return getBookingSearchUrlWithDates(name, city, details.checkin, details.checkout, details.adults, details.children);
      }
      if (name && city) return getBookingSearchUrl(name, city);
      return null;

    case 'restaurant':
      if (name && city) return getTripAdvisorSearchUrl(name, city);
      return null;

    case 'attraction':
      if (name && city) return getTripAdvisorSearchUrl(name, city);
      return null;

    case 'flight':
      if (name) return getAirlineSearchUrl(name);
      return null;

    case 'transport':
      if (name && city) return getGoogleMapsUrl(name, city);
      return null;

    case 'blog':
      // Blog posts can't easily be replaced — remove them
      return null;

    case 'generic':
      // Try a Google search as fallback
      if (name) {
        const q = encodeURIComponent(name);
        return `https://www.google.com/search?q=${q}`;
      }
      return null;

    default:
      return null;
  }
}

// ─── TRAVEL PLAN SANITIZATION ──────────────────────────────────────────

import type { TravelPlan } from '../shared/contract';
import { checkUrlsSafety } from './safeBrowsing';

/**
 * Collects all URLs from a travel plan and their context info for batch verification.
 * Returns an array of { url, context, details } objects.
 */
function collectAllUrlsWithInfo(
  plan: TravelPlan,
  travelInputs: { startDate?: string; endDate?: string; people?: { adults: number; children: { age: number }[] } }
): Array<{ url: string; context: UrlContext; details: Parameters<typeof getSafeAlternative>[2] }> {
  const entries: Array<{ url: string; context: UrlContext; details: Parameters<typeof getSafeAlternative>[2] }> = [];
  const city = plan.destinationOverview?.title || '';

  // Attractions sourceUrl
  plan.destinationOverview?.attractions?.forEach(attr => {
    if (attr.sourceUrl) entries.push({ url: attr.sourceUrl, context: 'attraction', details: { name: attr.name, city } });
  });

  // Activity sourceUrl (within itinerary days)
  plan.itinerary?.forEach(day => {
    day.activities.forEach(activity => {
      if (activity.sourceUrl) entries.push({ url: activity.sourceUrl, context: 'attraction', details: { name: activity.name || activity.location || '', city } });
    });
  });

  // Flight bookingUrl
  plan.flights?.forEach(segment => {
    segment.options.forEach(option => {
      if (option.bookingUrl) entries.push({ url: option.bookingUrl, context: 'flight', details: { name: option.airline } });
    });
  });

  // Accommodation bookingUrl
  plan.accommodations?.forEach(stop => {
    stop.options.forEach(option => {
      if (option.bookingUrl) entries.push({ url: option.bookingUrl, context: 'hotel', details: { name: option.name, city: stop.stopName, checkin: travelInputs.startDate, checkout: travelInputs.endDate, adults: travelInputs.people?.adults, children: travelInputs.people?.children } });
    });
  });

  // Restaurant sourceUrl
  plan.bestRestaurants?.forEach(stop => {
    stop.options.forEach(option => {
      if (option.sourceUrl) entries.push({ url: option.sourceUrl, context: 'restaurant', details: { name: option.name, city: stop.stopName } });
    });
  });

  // Private transfer links
  plan.transportInfo?.privateTransferLinks?.forEach(link => {
    if (link.url) entries.push({ url: link.url, context: 'transport', details: { name: link.provider || '', city } });
  });

  // Travel blog links
  plan.travelBlogs?.forEach(blog => {
    if (blog.url) entries.push({ url: blog.url, context: 'blog', details: { name: blog.title || '' } });
  });

  // Image URLs (heroImageUrl)
  if (plan.destinationOverview?.heroImageUrl) {
    entries.push({ url: plan.destinationOverview.heroImageUrl, context: 'generic', details: {} });
  }

  // Activity imageUrls
  plan.itinerary?.forEach(day => {
    day.activities.forEach(activity => {
      if (activity.imageUrl) entries.push({ url: activity.imageUrl, context: 'generic', details: {} });
    });
  });

  // Accommodation imageUrls
  plan.accommodations?.forEach(stop => {
    stop.options.forEach(option => {
      if (option.imageUrl) entries.push({ url: option.imageUrl, context: 'generic', details: {} });
    });
  });

  return entries;
}

/**
 * Async version of sanitizeTravelPlan that verifies unknown domains
 * via Google Safe Browsing API before replacing their URLs.
 *
 * Flow:
 * 1. Collect all URLs from the plan
 * 2. Run synchronous check (whitelist + structure)
 * 3. For URLs that are "valid-unknown" (not whitelisted, but structurally valid),
 *    call Google Safe Browsing API in batch
 * 4. Replace ONLY URLs that the API confirms as unsafe OR are structurally invalid
 * 5. Keep URLs that the API says are safe
 *
 * Falls back to sync-only mode if the API is unavailable (whitelist-only).
 */
export async function sanitizeTravelPlanAsync(
  plan: TravelPlan,
  travelInputs: { startDate?: string; endDate?: string; people?: { adults: number; children: { age: number }[] } }
): Promise<TravelPlan> {
  const sanitized = JSON.parse(JSON.stringify(plan)) as TravelPlan;
  const allUrlEntries = collectAllUrlsWithInfo(sanitized, travelInputs);

  // Step 1: Sync check — categorize every URL
  const unknownUrls: string[] = [];
  const urlCheckResults = new Map<string, UrlSafetyResult>();

  for (const entry of allUrlEntries) {
    const result = isUrlSafe(entry.url);
    if (result.category === 'valid-unknown') {
      unknownUrls.push(entry.url);
    }
    urlCheckResults.set(entry.url, result);
  }

  // Step 2: Batch verify unknown URLs via Safe Browsing API
  const safeBrowsingResults = new Map<string, boolean>(); // url → isSafe
  if (unknownUrls.length > 0) {
    console.log(`[URL Safety] Checking ${unknownUrls.length} unknown URLs via Google Safe Browsing API...`);
    try {
      const sbResults = await checkUrlsSafety(unknownUrls);
      for (const url of unknownUrls) {
        const result = sbResults.get(url);
        if (result) {
          safeBrowsingResults.set(url, result.safe);
          if (result.cached) {
            console.log(`[URL Safety] Cached result for ${url}: ${result.safe ? 'safe' : 'unsafe'}`);
          } else {
            console.log(`[URL Safety] API result for ${url}: ${result.safe ? 'safe' : 'unsafe'}`);
          }
        }
      }
    } catch (err) {
      console.warn('[URL Safety] Safe Browsing API batch call failed, falling back to whitelist-only mode:', err);
      // On API failure, all unknown URLs are treated as unsafe (fail closed)
    }
  }

  // Step 3: Build final decision map — URL → keep original? or replace?
  const urlDecision = new Map<string, { keepOriginal: boolean; replacementUrl: string | null }>();

  for (const entry of allUrlEntries) {
    const syncResult = urlCheckResults.get(entry.url);
    if (!syncResult) continue;

    if (syncResult.isSafe) {
      // Whitelisted — keep
      urlDecision.set(entry.url, { keepOriginal: true, replacementUrl: null });
    } else if (syncResult.category === 'valid-unknown') {
      // Check Safe Browsing API result
      const sbSafe = safeBrowsingResults.get(entry.url);
      if (sbSafe === true) {
        // API says safe — KEEP the original URL!
        console.log(`[URL Safety] ✅ Keeping verified-safe URL: ${entry.url}`);
        urlDecision.set(entry.url, { keepOriginal: true, replacementUrl: null });
      } else {
        // API says unsafe OR API failed — replace
        const alt = getSafeAlternative(entry.url, entry.context, entry.details);
        urlDecision.set(entry.url, { keepOriginal: false, replacementUrl: alt });
      }
    } else {
      // Structurally invalid — always replace
      const alt = getSafeAlternative(entry.url, entry.context, entry.details);
      urlDecision.set(entry.url, { keepOriginal: false, replacementUrl: alt });
    }
  }

  // Step 4: Apply decisions to travel plan
  const city = sanitized.destinationOverview?.title || '';

  // 1. Attractions sourceUrl
  sanitized.destinationOverview?.attractions?.forEach(attr => {
    if (attr.sourceUrl) {
      const decision = urlDecision.get(attr.sourceUrl);
      if (decision && !decision.keepOriginal) {
        attr.sourceUrl = decision.replacementUrl || undefined;
      }
    }
  });

  // 2. Activity sourceUrl
  sanitized.itinerary?.forEach(day => {
    day.activities.forEach(activity => {
      if (activity.sourceUrl) {
        const decision = urlDecision.get(activity.sourceUrl);
        if (decision && !decision.keepOriginal) {
          activity.sourceUrl = decision.replacementUrl || undefined;
        }
      }
    });
  });

  // 3. Flight bookingUrl
  sanitized.flights?.forEach(segment => {
    segment.options.forEach(option => {
      if (option.bookingUrl) {
        const decision = urlDecision.get(option.bookingUrl);
        if (decision && !decision.keepOriginal) {
          option.bookingUrl = decision.replacementUrl || undefined;
        }
      }
    });
  });

  // 4. Accommodation bookingUrl
  sanitized.accommodations?.forEach(stop => {
    stop.options.forEach(option => {
      if (option.bookingUrl) {
        const decision = urlDecision.get(option.bookingUrl);
        if (decision && !decision.keepOriginal) {
          option.bookingUrl = decision.replacementUrl || undefined;
        }
      }
    });
  });

  // 5. Restaurant sourceUrl
  sanitized.bestRestaurants?.forEach(stop => {
    stop.options.forEach(option => {
      if (option.sourceUrl) {
        const decision = urlDecision.get(option.sourceUrl);
        if (decision && !decision.keepOriginal) {
          option.sourceUrl = decision.replacementUrl || undefined;
        }
      }
    });
  });

  // 6. Private transfer links — filter out unsafe
  if (sanitized.transportInfo?.privateTransferLinks) {
    sanitized.transportInfo.privateTransferLinks = sanitized.transportInfo.privateTransferLinks.filter(link => {
      if (link.url) {
        const decision = urlDecision.get(link.url);
        return decision?.keepOriginal ?? false;
      }
      return true;
    });
  }

  // 7. Travel blog links — remove unsafe
  if (sanitized.travelBlogs) {
    sanitized.travelBlogs = sanitized.travelBlogs
      .map(blog => {
        if (blog.url) {
          const decision = urlDecision.get(blog.url);
          if (decision && !decision.keepOriginal) return null;
        }
        return blog;
      })
      .filter(Boolean) as typeof sanitized.travelBlogs;
  }

  // 8-10. Image URLs — strip non-safe ones (keep if whitelisted or verified by API)
  const safeImageDomains = ['picsum.photos', 'images.unsplash.com', 'upload.wikimedia.org'];
  const isSafeImage = (url: string): boolean => {
    const decision = urlDecision.get(url);
    if (decision?.keepOriginal) {
      const hostname = getHostname(url);
      // For images, only keep if from a known image CDN even if API-safe
      return hostname !== null && safeImageDomains.some(d => hostname === d || hostname.endsWith(`.${d}`));
    }
    return false;
  };

  if (sanitized.destinationOverview?.heroImageUrl && !isSafeImage(sanitized.destinationOverview.heroImageUrl)) {
    sanitized.destinationOverview.heroImageUrl = undefined;
  }

  sanitized.itinerary?.forEach(day => {
    day.activities.forEach(activity => {
      if (activity.imageUrl && !isSafeImage(activity.imageUrl)) {
        activity.imageUrl = undefined;
      }
    });
  });

  sanitized.accommodations?.forEach(stop => {
    stop.options.forEach(option => {
      if (option.imageUrl && !isSafeImage(option.imageUrl)) {
        option.imageUrl = undefined;
      }
    });
  });

  const stats = getSanitizationStats(plan, sanitized);
  console.log(`[URL Safety] Sanitization complete: ${stats.keptOriginal} kept, ${stats.replaced} replaced, ${stats.removed} removed out of ${stats.totalUrls} total URLs`);
  return sanitized;
}

/**
 * Sanitizes all URLs in a TravelPlan by checking each one against
 * the whitelist and structural validation. Unsafe URLs are replaced
 * with safe alternatives or removed.
 *
 * NOTE: This is the SYNC version that does NOT call the Google Safe Browsing API.
 * For full safety verification, use sanitizeTravelPlanAsync() instead.
 *
 * @param plan - The travel plan object from the AI
 * @param travelInputs - The original travel inputs (needed for date/guest info in alternatives)
 * @returns A new TravelPlan with all URLs sanitized
 */
export function sanitizeTravelPlan(
  plan: TravelPlan,
  travelInputs: { startDate?: string; endDate?: string; people?: { adults: number; children: { age: number }[] } }
): TravelPlan {
  const sanitized = JSON.parse(JSON.stringify(plan)) as TravelPlan;
  const city = plan.destinationOverview?.title || '';

  // 1. Attractions sourceUrl
  if (sanitized.destinationOverview?.attractions) {
    for (const attr of sanitized.destinationOverview.attractions) {
      if (attr.sourceUrl) {
        const result = isUrlSafe(attr.sourceUrl);
        if (!result.isSafe) {
          attr.sourceUrl = getSafeAlternative(attr.sourceUrl, 'attraction', { name: attr.name, city }) || undefined;
        }
      }
    }
  }

  // 2. Activity sourceUrl (within itinerary days)
  if (sanitized.itinerary) {
    for (const day of sanitized.itinerary) {
      for (const activity of day.activities) {
        if (activity.sourceUrl) {
          const result = isUrlSafe(activity.sourceUrl);
          if (!result.isSafe) {
            activity.sourceUrl = getSafeAlternative(activity.sourceUrl, 'attraction', { name: activity.name || activity.location || '', city }) || undefined;
          }
        }
      }
    }
  }

  // 3. Flight bookingUrl
  if (sanitized.flights) {
    for (const segment of sanitized.flights) {
      for (const option of segment.options) {
        if (option.bookingUrl) {
          const result = isUrlSafe(option.bookingUrl);
          if (!result.isSafe) {
            option.bookingUrl = getSafeAlternative(option.bookingUrl, 'flight', { name: option.airline }) || undefined;
          }
        }
      }
    }
  }

  // 4. Accommodation bookingUrl
  if (sanitized.accommodations) {
    for (const stop of sanitized.accommodations) {
      for (const option of stop.options) {
        if (option.bookingUrl) {
          const result = isUrlSafe(option.bookingUrl);
          if (!result.isSafe) {
            option.bookingUrl = getSafeAlternative(option.bookingUrl, 'hotel', {
              name: option.name,
              city: stop.stopName,
              checkin: travelInputs.startDate,
              checkout: travelInputs.endDate,
              adults: travelInputs.people?.adults,
              children: travelInputs.people?.children,
            }) || undefined;
          }
        }
      }
    }
  }

  // 5. Restaurant sourceUrl
  if (sanitized.bestRestaurants) {
    for (const stop of sanitized.bestRestaurants) {
      for (const option of stop.options) {
        if (option.sourceUrl) {
          const result = isUrlSafe(option.sourceUrl);
          if (!result.isSafe) {
            option.sourceUrl = getSafeAlternative(option.sourceUrl, 'restaurant', { name: option.name, city: stop.stopName }) || undefined;
          }
        }
      }
    }
  }

  // 6. Private transfer links — remove links with unsafe URLs entirely
  // (a Google Maps search for a shady provider is not a useful replacement)
  if (sanitized.transportInfo?.privateTransferLinks) {
    sanitized.transportInfo.privateTransferLinks = sanitized.transportInfo.privateTransferLinks
      .filter(link => {
        if (link.url) {
          return isUrlSafe(link.url).isSafe;
        }
        return true;
      });
  }

  // 7. Travel blog links — remove unsafe ones entirely
  if (sanitized.travelBlogs) {
    sanitized.travelBlogs = sanitized.travelBlogs
      .map(blog => {
        if (blog.url) {
          const result = isUrlSafe(blog.url);
          if (!result.isSafe) return null;
        }
        return blog;
      })
      .filter(Boolean) as typeof sanitized.travelBlogs;
  }

  // 8. heroImageUrl — only allow whitelisted image domains or remove
  if (sanitized.destinationOverview?.heroImageUrl) {
    const result = isUrlSafe(sanitized.destinationOverview.heroImageUrl);
    if (!result.isSafe) {
      // For images, check if it's from a known safe image CDN
      const hostname = getHostname(sanitized.destinationOverview.heroImageUrl);
      const safeImageDomains = ['picsum.photos', 'images.unsplash.com', 'upload.wikimedia.org'];
      const isSafeImage = hostname && safeImageDomains.some(d => hostname === d || hostname.endsWith(`.${d}`));
      if (!isSafeImage) {
        sanitized.destinationOverview.heroImageUrl = undefined;
      }
    }
  }

  // 9. Activity imageUrls — same check as heroImageUrl
  if (sanitized.itinerary) {
    for (const day of sanitized.itinerary) {
      for (const activity of day.activities) {
        if (activity.imageUrl) {
          const result = isUrlSafe(activity.imageUrl);
          if (!result.isSafe) {
            const hostname = getHostname(activity.imageUrl);
            const safeImageDomains = ['picsum.photos', 'images.unsplash.com', 'upload.wikimedia.org'];
            const isSafeImage = hostname && safeImageDomains.some(d => hostname === d || hostname.endsWith(`.${d}`));
            if (!isSafeImage) {
              activity.imageUrl = undefined;
            }
          }
        }
      }
    }
  }

  // 10. Accommodation imageUrls
  if (sanitized.accommodations) {
    for (const stop of sanitized.accommodations) {
      for (const option of stop.options) {
        if (option.imageUrl) {
          const result = isUrlSafe(option.imageUrl);
          if (!result.isSafe) {
            const hostname = getHostname(option.imageUrl);
            const safeImageDomains = ['picsum.photos', 'images.unsplash.com', 'upload.wikimedia.org'];
            const isSafeImage = hostname && safeImageDomains.some(d => hostname === d || hostname.endsWith(`.${d}`));
            if (!isSafeImage) {
              option.imageUrl = undefined;
            }
          }
        }
      }
    }
  }

  return sanitized;
}

/**
 * Returns statistics about how many URLs were sanitized in a travel plan.
 * Useful for debugging and logging.
 */
export function getSanitizationStats(originalPlan: TravelPlan, sanitizedPlan: TravelPlan): {
  totalUrls: number;
  replaced: number;
  removed: number;
  keptOriginal: number;
} {
  const collectUrls = (plan: TravelPlan): string[] => {
    const urls: string[] = [];

    plan.destinationOverview?.attractions?.forEach(a => { if (a.sourceUrl) urls.push(a.sourceUrl); });
    plan.itinerary?.forEach(d => d.activities.forEach(a => { if (a.sourceUrl) urls.push(a.sourceUrl); if (a.imageUrl) urls.push(a.imageUrl); }));
    plan.flights?.forEach(s => s.options.forEach(o => { if (o.bookingUrl) urls.push(o.bookingUrl); }));
    plan.accommodations?.forEach(s => s.options.forEach(o => { if (o.bookingUrl) urls.push(o.bookingUrl); if (o.imageUrl) urls.push(o.imageUrl); }));
    plan.bestRestaurants?.forEach(s => s.options.forEach(o => { if (o.sourceUrl) urls.push(o.sourceUrl); }));
    plan.transportInfo?.privateTransferLinks?.forEach(l => { if (l.url) urls.push(l.url); });
    plan.travelBlogs?.forEach(b => { if (b.url) urls.push(b.url); });
    if (plan.destinationOverview?.heroImageUrl) urls.push(plan.destinationOverview.heroImageUrl);

    return urls;
  };

  const originalUrls = collectUrls(originalPlan);
  const sanitizedUrls = collectUrls(sanitizedPlan);

  let keptOriginal = 0;
  let replaced = 0;
  let removed = 0;

  for (let i = 0; i < originalUrls.length; i++) {
    const orig = originalUrls[i];
    if (i < sanitizedUrls.length) {
      const sanitized = sanitizedUrls[i];
      if (orig === sanitized) keptOriginal++;
      else if (sanitized === undefined || sanitized === '') removed++;
      else replaced++;
    } else {
      removed++;
    }
  }

  return {
    totalUrls: originalUrls.length,
    replaced,
    removed,
    keptOriginal,
  };
}