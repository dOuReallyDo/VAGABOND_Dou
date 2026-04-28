# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server (Express + Vite middleware) on http://localhost:3000
npm run build    # TypeScript check + Vite production build → dist/
npm run lint     # ESLint (zero warnings allowed)
npm run start    # Same as dev — runs tsx server.ts
npm test         # Run Vitest unit tests
npm run test:watch # Run Vitest in watch mode
```

## Environment Variables

Create `.env` in the project root:

```env
ANTHROPIC_API_KEY=sk-ant-...
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
GOOGLE_SAFE_BROWSING_API_KEY=***
VITE_UNSPLASH_ACCESS_KEY=your-unsplash-access-key
```

`ANTHROPIC_API_KEY` is served via `GET /api/config` (Express) and also injected at build time by Vite via `process.env.ANTHROPIC_API_KEY`. The client fetches the server endpoint first, falling back to the Vite-injected value.

`GOOGLE_SAFE_BROWSING_API_KEY` is optional. When set, the `/api/check-url` endpoint proxies requests to Google's Safe Browsing API to verify unknown URLs. Without it, the system operates in **whitelist-only mode** (URLs on trusted domains pass, all other unknown domains are replaced with safe alternatives).

`VITE_UNSPLASH_ACCESS_KEY` is optional. When set, the app searches Unsplash for destination-coherent images (hero, attractions, itinerary activities). Free tier: 50 requests/hour. Without it, falls back to picsum.photos. Get a key at https://unsplash.com/developers.

## Architecture

### Server + Client Split

`server.ts` is an Express server that:
- Exposes `/api/config` (serves the Anthropic API key to the browser)
- In dev, acts as a Vite middleware proxy (SPA hot-reload)
- In prod, serves `dist/` as static files

The entire app UI lives in `src/` and runs in the browser. **The Anthropic SDK is called directly from the browser** (`dangerouslyAllowBrowser: true`), not from the server.

### AI Layer (`src/services/travelService.ts`)

Three exported functions:
- `generateTravelPlan(inputs, onProgress?)` — main function, calls `claude-sonnet-4-6` with `web_search` tool (up to 6 uses), returns a Zod-validated `TravelPlan`
- `getDestinationCountries(destination)` — calls `claude-haiku-4-5-20251001` to resolve ambiguous destination names to country lists
- `summarizeAccommodationReviews(...)` — calls `claude-haiku-4-5-20251001` with `web_search` to fetch real hotel prices/reviews

The prompt in `generateTravelPlan` is Italian-language and dynamically injects traveler profile rules (pace, traveler type, interests, mobility) as explicit AI instructions.

### Data Contracts (`src/shared/contract.ts`)

Zod schemas define both input and output:
- `TravelInputsSchema` / `TravelInputs` — form inputs including optional `travelerProfile`
- `TravelPlanSchema` / `TravelPlan` — full validated AI response (itinerary, flights, accommodations, restaurants, map points, etc.)

All AI responses are validated against `TravelPlanSchema` before use. A `repairJson()` helper attempts to fix truncated JSON by balancing braces before parsing.

### Auth & Profile (`src/lib/auth.tsx`)

React context (`AuthProvider`) wrapping Supabase auth. Exposes:
- `user`, `session`, `loading`, `profile` (traveler profile from Supabase `profiles` table)
- `signIn`, `signUp`, `signInWithGoogle`, `signOut`
- `updateProfile`, `refreshProfile`

`TravelerProfile` type is defined here (fields: `age_range`, `traveler_type`, `interests[]`, `pace`, `mobility`, `familiarity`, `display_name`).

### Storage (`src/lib/storage.ts`)

All persistence functions use Supabase when authenticated, with localStorage as fallback for guests:
- `loadProfile` / `saveProfile` — traveler profile CRUD
- `loadTrips` / `saveTrip` / `deleteTrip` / `toggleFavorite` — saved trips CRUD
- `migrateLocalTripsToSupabase(userId)` — called after login to migrate guest data

### Supabase Save Trip (CRITICAL — read if saving breaks)

`saveTrip()` in `src/lib/storage.ts` bypasses the Supabase JS client entirely for saves:
- **Root cause of hangs**: The Supabase JS client has an `initializePromise` that blocks ALL API calls (getSession, insert, etc.) while refreshing auth tokens. On Vercel free tier, this can hang forever.
- **Fix**: `saveTrip()` now uses **REST API via `fetch()`** directly, reading the JWT access token from `localStorage` key `sb-{projectRef}-auth-token` (synchronous, instant, no network call).
- POST to `{SUPABASE_URL}/rest/v1/saved_trips` with `Authorization: Bearer {token}` and `apikey: {anonKey}` headers.
- If REST call fails (no token, timeout, error) → falls back to `saveTripToLocal()` (localStorage).
- `loadTrips()` merges Supabase + localStorage trips, deduplicating by trip_name+destination.
- **`persistSession: true`** in supabase.ts (was `false`, caused session loss on Vercel → RLS blocks saves).

**Key files**: `src/lib/storage.ts` (saveTrip, loadTrips, saveTripToLocal), `src/lib/supabase.ts` (persistSession), `src/lib/auth.tsx` (AuthProvider)

### Main App (`src/App.tsx`)

Large single-file component (~1500+ lines) managing:
- 2-step travel form (destination/dates → preferences)
- Plan results display (itinerary tabs, hotel cards, flight cards, map, budget breakdown)
- User menu (top-right): profile editor modal, saved trips modal, change password modal, logout
- Hero image: prefers local JPEGs from `immagini/` (loaded via Vite glob import), falls back to Unsplash URLs
- Item images: uses AI-provided URLs with picsum.photos as fallback

### URL Safety Layer (`src/lib/urlSafety.ts` + `src/lib/safeBrowsing.ts` + `api/check-url.ts`)

3-layer protection for all URLs generated by Claude:

1. **Prompt-level**: `travelService.ts` injects a "🔗 SICUREZZA DEI LINK" section into the prompt, listing trusted domains and explicit rules (no shorteners, no IP addresses, no suspicious TLDs, no HTTP, no redirect params).
2. **Post-processing (client)**: `sanitizeTravelPlanAsync()` is called in `App.tsx` on every generated/modified travel plan before setting state. It checks every URL field:
   - Whitelisted domains (80+ trust entries) → pass through
   - Structurally invalid URLs (IP addresses, shorteners, suspicious TLDs, HTTP, redirect params) → replaced with safe alternatives (Booking.com search, TripAdvisor search, Google Maps, Google search)
   - Unknown domains → checked **in batch** via Safe Browsing API. If API confirms safe → original URL **kept**. If unsafe → replaced.
   - Console logs with `[URL Safety]` prefix for debugging which URLs are kept vs replaced.
   - Sync version `sanitizeTravelPlan()` (whitelist-only, no API) kept for tests.
3. **Google Safe Browsing API (server)**: `POST /api/check-url` in `server.ts` (dev) and `api/check-url.ts` (Vercel serverless function) proxies requests to Google's Safe Browsing API. Has in-memory cache (1h TTL). API errors fail closed (assume unsafe). When API key is configured, unknown domains are verified — safe ones are **kept** (not replaced), only truly unsafe URLs are replaced.

**⚠️ Vercel pitfall**: Routes defined ONLY in `server.ts` return 405 on Vercel. Must add corresponding `api/*.ts` serverless function for each endpoint.

Sanitization policy: unsafe URLs are **removed and replaced**, never shown with warnings:
- Hotel → Booking.com search URL (with dates & guests)
- Restaurant/Attraction → TripAdvisor search
- Flight → Google search for airline official site
- Transport → Google Maps link
- Blog → removed entirely
- Images from non-whitelisted CDNs → removed (falls back to picsum)

### Deployment

Deployed to Vercel. `vercel.json` configures:
- Build: `npm run build` → `dist/`
- All routes rewrite to `/index.html` (SPA)
- `/api/*` routes pass through to Express handlers (via `@vercel/node`)
