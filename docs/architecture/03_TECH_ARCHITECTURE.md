# Technical Architecture — VAGABOND_Dou

## Required
React SPA + Express server proxy + Anthropic Claude AI + Supabase (auth + persistence).

## Non-negotiables
- No API keys in the browser (server proxy for Anthropic)
- Input validation (Zod schemas)
- Row Level Security on all DB tables
- Strict JSON schema output + runtime validation
- Dev/Staging/Prod separation

## Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Vite + React 18 + TypeScript |
| **Styling** | Tailwind CSS v4 + Framer Motion |
| **AI** | Anthropic Claude (Sonnet 4 + Haiku) with web_search tool |
| **Auth** | Supabase Auth (email/password + Google OAuth) |
| **Database** | Supabase PostgreSQL (profiles, saved_trips) |
| **Server** | Express (dev proxy + prod static) |
| **Maps** | Leaflet + OpenStreetMap |
| **Deploy** | Vercel |

## Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│                    Browser                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ AuthForm  │  │ProfileForm│  │ TravelForm      │  │
│  │ (Supabase │  │ (Step 1)  │  │ (Step 2) +      │  │
│  │  Auth)    │  │          │  │ NoteSuggestions  │  │
│  └─────┬─────┘  └─────┬────┘  └────────┬─────────┘  │
│        │              │                │             │
│  ┌─────▼──────────────▼────────────────▼──────────┐  │
│  │              AuthContext                        │  │
│  │    (Supabase session + profile state)          │  │
│  └─────┬──────────────┬────────────────┬──────────┘  │
│        │              │                │             │
│  ┌─────▼─────┐  ┌─────▼────┐  ┌───────▼──────────┐ │
│  │ Supabase  │  │TravelSvc │  │   Storage Layer   │ │
│  │  Client   │  │(Claude)  │  │ (Supabase+lclStr) │ │
│  └───────────┘  └─────┬────┘  └──────────────────┘ │
└───────────────────────┼─────────────────────────────┘
                        │
              ┌─────────▼─────────┐
              │  Express Server   │
              │  /api/config      │──▶ Anthropic API Key
              │  /api/health      │
              │  Vite middleware   │
              │  (dev mode)       │
              └───────────────────┘
```

## Data Flow

### Plan Generation
1. User fills profile (Step 1) → stored in state + Supabase/localStorage
2. User fills travel details (Step 2) → includes `travelerProfile` in payload
3. `travelService.ts` builds prompt with profile enrichment
4. Claude API returns JSON → validated by `TravelPlanSchema`
5. Plan rendered in UI → auto-saved via Storage layer

### Auth Flow
1. Login/Signup via Supabase Auth
2. `AuthProvider` manages session, loads profile
3. On mount: check session → load profile → load saved trips
4. On first login after guest: migrate localStorage → Supabase

## Database

### profiles (RLS enabled)
- `id` UUID PK → auth.users
- `age_range`, `traveler_type`, `interests[]`, `pace`, `mobility`, `familiarity`
- Auto-created on signup via trigger

### saved_trips (RLS enabled)
- `id` UUID PK
- `user_id` FK → profiles
- `trip_name`, `destination`
- `inputs` JSONB (TravelInputs)
- `plan` JSONB (TravelPlan)
- `is_favorite` boolean

## Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `ANTHROPIC_API_KEY` | server-side | Claude API access |
| `VITE_SUPABASE_URL` | client-side | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | client-side | Supabase public key |