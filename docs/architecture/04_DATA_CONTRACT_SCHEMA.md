# Data Contract Schema — VAGABOND_Dou

## Input: TravelInputs

```typescript
interface TravelInputs {
  // Chi viaggia
  people: {
    adults: number;           // min 1
    children: { age: number }[];
  };

  // Soldi
  budget: number;              // min 100, totale per tutte le persone

  // Dove
  departureCity: string;       // min 2 chars
  departureCountry?: string;
  destination: string;         // min 2 chars
  country?: string;

  // Quando
  startDate: string;           // ISO date
  endDate: string;             // ISO date
  isPeriodFlexible: boolean;   // ±3 giorni

  // Come
  accommodationType: string;   // comma-separated multi-select
  flightPreference?: string;  // "Volo diretto" | "Volo economico" | "Treno" | "Auto privata"
  stopover?: string;           // città di scalo
  departureTimePreference?: string;

  // Note
  notes?: string;

  // MODIFICA (per iterazioni successive)
  modificationRequest?: string;
  previousPlan?: any;

  // 🆕 PROFILO VIAGGIATORE
  travelerProfile?: {
    ageRange?: string;          // "18-25" | "26-35" | "36-45" | "46-55" | "56-65" | "65+"
    travelerType?: string;      // "Solo/a" | "Coppia romantica" | "Famiglia con bimbi piccoli" | "Famiglia con ragazzi" | "Gruppo di amici" | "Viaggio di lavoro"
    interests?: string[];       // max 5: "Cultura" | "Mare" | "Food & Wine" | "Natura" | "Sport" | "Shopping" | "Nightlife" | "Benessere" | "Foto" | "Intrattenimento" | "Avventura" | "Storia"
    pace?: string;              // "Slow & relax" | "Equilibrato" | "Avventura intensa"
    mobility?: string;          // "Nessuna limitazione" | "Ridotta" | "A carrozzina"
    familiarity?: string;        // "Mai stato qui" | "Ci sono già stato" | "Esperto della zona"
  };
}
```

## Output: TravelPlan

Invariato rispetto a Vagabond originale. Vedere `src/shared/contract.ts` per lo schema Zod completo.

Campi principali: `budgetWarning`, `destinationOverview`, `weatherInfo`, `safetyAndHealth`, `itinerary`, `budgetBreakdown`, `flights`, `accommodations`, `bestRestaurants`, `mapPoints`, `localTips`, `transportInfo`, `travelBlogs`, `travelHighlights`.

## ⚠️ TravelPlan Sanitization (URL Safety)

All TravelPlan objects are sanitized via `sanitizeTravelPlan()` (in `src/lib/urlSafety.ts`) before being rendered or saved:

- **Every URL field** (`bookingUrl`, `sourceUrl`, `website`, `imageUrl`, `mapUrl`, etc.) is checked against a whitelist of 80+ trusted domains
- **Structurally invalid URLs** (IP addresses, shorteners, suspicious TLDs, HTTP, redirect parameters) are replaced with safe alternatives
- **Unknown domains** are verified against the Google Safe Browsing API (if `GOOGLE_SAFE_BROWSING_API_KEY` is configured)
- Unsafe URLs are **removed and replaced**, never shown with warnings — the user only ever sees safe, functional URLs

This sanitization happens in `App.tsx` after every plan generation or modification, before the plan is stored in React state.

## Profile: TravelerProfile (Supabase)

```typescript
interface TravelerProfile {
  id: string;                   // UUID → auth.users
  age_range: string;
  traveler_type: string;
  interests: string[];
  pace: string;
  mobility: string;
  familiarity: string;
  display_name?: string;
  created_at: string;
  updated_at: string;
}
```

## SavedTrip (Supabase)

```typescript
interface SavedTrip {
  id: string;                   // UUID
  user_id: string;              // FK → profiles
  trip_name: string;
  destination?: string;
  inputs: TravelInputs;         // JSONB
  plan: TravelPlan;             // JSONB
  is_favorite: boolean;
  created_at: string;
  updated_at: string;
}
```