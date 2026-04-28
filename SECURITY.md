# Security Policy — VAGABOND_Dou

## API Keys
- `ANTHROPIC_API_KEY`: **Server-side only** — never exposed to the browser. Served via `/api/config` endpoint in development, Vercel env var in production.
- `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`: Public keys — safe in browser code. The anon key has limited permissions enforced by Row Level Security.

## Supabase Security
- All tables have **Row Level Security (RLS)** enabled
- Users can only read/write their own `profiles` and `saved_trips`
- Auto-profile creation via database trigger on signup
- No service_role key in client code — anon key only

## Data Privacy
- Profile data (age, interests, travel preferences) is stored per-user in Supabase
- Travel plans are stored per-user with RLS
- No data is shared between users
- Guest mode uses localStorage only — no PII leaves the browser

## Input Validation
- All inputs validated with Zod schemas before processing
- `TravelInputsSchema` enforces: `budget >= 100`, `departureCity >= 2 chars`, etc.
- `TravelPlanSchema` validates all output from Claude before rendering

## Content Security
- User-generated content (notes, destination searches) is sanitized before inclusion in prompts
- No user content is stored in training data by Anthropic (per their policy)
- Image URLs validated against hotlink-blacklisted domains

## URL Safety System

VAGABOND_Dou implements a 3-layer URL protection system to prevent users from being exposed to malicious, phishing, or inappropriate links:

### Layer 1: Prompt-level Filtering
- The AI prompt includes a "🔗 SICUREZZA DEI LINK" section with an explicit whitelist of 80+ trusted domains
- Claude is instructed to only use URLs from these domains
- Rules: no URL shorteners, no IP addresses, no suspicious TLDs, no HTTP URLs, no redirect parameters
- `bookingUrl` must be Booking.com or official hotel site; `sourceUrl` must be a trusted domain

### Layer 2: Post-processing Sanitization (`src/lib/urlSafety.ts`)
- `sanitizeTravelPlanAsync()` processes every URL field in TravelPlan objects before display. Sync version `sanitizeTravelPlan()` (whitelist-only) kept for tests
- **Whitelisted domains**: pass through unchanged (80+ entries including booking.com, tripadvisor.com, google.com, etc.)
- **Structurally invalid URLs**: immediately replaced with safe alternatives:
  - IP addresses as host → replaced
  - URL shorteners (bit.ly, tinyurl, etc.) → replaced
  - Suspicious TLDs (.xyz, .top, .click, etc.) → replaced
  - HTTP (non-HTTPS) URLs → replaced
  - URLs with redirect parameters (utm_, fbclid, etc.) → stripped or replaced
- **Unknown but structurally valid domains**: batch-verified via Google Safe Browsing API. If API says safe → **original URL kept** (e.g., hotel official sites). If unsafe → replaced.
- Console logs `[URL Safety]` for debugging which URLs are kept vs replaced.

**Replacement policy — unsafe URLs are REMOVED and REPLACED, never shown with warnings:**
| Category | Replacement |
|----------|------------|
| Hotel/Booking | Booking.com search URL (with dates & guests from travelInputs) |
| Restaurant | TripAdvisor search URL |
| Attraction | TripAdvisor search URL |
| Flight | Google search for airline official site |
| Transport | Google Maps link |
| Travel Blog | Removed entirely |
| Images from non-whitelisted CDNs | Removed (falls back to picsum.photos) |

### Layer 3: Google Safe Browsing API (`src/lib/safeBrowsing.ts` + `server.ts`)
- Unknown domains (not in whitelist, not structurally invalid) are checked against Google's Safe Browsing database **in batch** before any replacement decision
- Client calls `POST /api/check-url` which proxies to Google's API
- Server endpoint reads `GOOGLE_SAFE_BROWSING_API_KEY` from env
- **If API says safe**: original URL is **kept** (e.g., hotel official sites verified as safe)
- **If API says unsafe or no API key**: system treats unknown domains as unsafe and replaces them
- **If API error occurs**: fails closed (assumes unsafe)
- In-memory cache with 1-hour TTL to minimize API calls

### Safe Alternative Generation
- `generateSafeAlternative()` creates contextually appropriate replacement URLs
- Booking.com search URLs include travel dates, guest count, and destination from `TravelInputs`
- TripAdvisor and Google Maps searches use the entity name
- All replacements are functional search URLs, not dead links