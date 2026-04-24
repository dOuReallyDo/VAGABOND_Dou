# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server (Express + Vite middleware) on http://localhost:3000
npm run build    # TypeScript check + Vite production build → dist/
npm run lint     # ESLint (zero warnings allowed)
npm run start    # Same as dev — runs tsx server.ts
```

No test suite is configured.

## Environment Variables

Create `.env` in the project root:

```env
ANTHROPIC_API_KEY=sk-ant-...
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

`ANTHROPIC_API_KEY` is served via `GET /api/config` (Express) and also injected at build time by Vite via `process.env.ANTHROPIC_API_KEY`. The client fetches the server endpoint first, falling back to the Vite-injected value.

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

### Supabase Schema

Two tables (see `supabase/schema.sql`):
- `profiles` — linked 1:1 to `auth.users` via trigger on signup; stores traveler profile fields
- `saved_trips` — stores full `inputs` (JSONB) and `plan` (JSONB) per user

Both tables have RLS enabled; users can only read/write their own rows.

### Main App (`src/App.tsx`)

Large single-file component (~1500+ lines) managing:
- 2-step travel form (destination/dates → preferences)
- Plan results display (itinerary tabs, hotel cards, flight cards, map, budget breakdown)
- User menu (top-right): profile editor modal, saved trips modal, change password modal, logout
- Hero image: prefers local JPEGs from `immagini/` (loaded via Vite glob import), falls back to Unsplash URLs
- Item images: uses AI-provided URLs with picsum.photos as fallback

### Deployment

Deployed to Vercel. `vercel.json` configures:
- Build: `npm run build` → `dist/`
- All routes rewrite to `/index.html` (SPA)
- `/api/*` routes pass through to Express handlers (via `@vercel/node`)
