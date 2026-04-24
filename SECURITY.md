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