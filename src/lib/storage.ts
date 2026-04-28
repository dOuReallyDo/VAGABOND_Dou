import { supabase } from "./supabase";
import type { TravelerProfile } from "./auth";
import type { TravelInputs } from "../services/travelService";

// =============================================
// Slim down plan before saving to DB — strip images that are regenerated at runtime
// =============================================

/** Remove imageUrl/heroImageUrl from plan to reduce payload size.
 *  Images are resolved at runtime via Unsplash/picsum, no need to persist URLs. */
function slimPlanForSave(plan: any): any {
  if (!plan || typeof plan !== 'object') return plan;
  const slim = JSON.parse(JSON.stringify(plan));

  // Strip heroImageUrl from destinationOverview
  if (slim.destinationOverview) {
    delete slim.destinationOverview.heroImageUrl;
  }

  // Strip imageUrl from itinerary activities
  if (Array.isArray(slim.itinerary)) {
    for (const day of slim.itinerary) {
      if (Array.isArray(day.activities)) {
        for (const act of day.activities) {
          delete act.imageUrl;
        }
      }
    }
  }

  // Strip imageUrl from attractions
  if (Array.isArray(slim.destinationOverview?.attractions)) {
    for (const attr of slim.destinationOverview.attractions) {
      delete attr.imageUrl;
    }
  }

  // Strip imageUrl from accommodations
  if (Array.isArray(slim.accommodations)) {
    for (const stop of slim.accommodations) {
      if (Array.isArray(stop.options)) {
        for (const opt of stop.options) {
          delete opt.imageUrl;
        }
      }
    }
  }

  // Strip imageUrl from restaurants
  if (Array.isArray(slim.bestRestaurants)) {
    for (const stop of slim.bestRestaurants) {
      if (Array.isArray(stop.options)) {
        for (const opt of stop.options) {
          delete opt.imageUrl;
        }
      }
    }
  }

  return slim;
}

// =============================================
// Profile Storage (Supabase + localStorage fallback)
// =============================================

const LOCAL_PROFILE_KEY = "vagabond_traveler_profile";

/** Load profile: try Supabase first, fall back to localStorage */
export async function loadProfile(userId?: string): Promise<TravelerProfile | null> {
  // Try Supabase if authenticated
  if (userId) {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("age_range, traveler_type, interests, pace, mobility, familiarity, display_name")
        .eq("id", userId)
        .single();

      if (!error && data) return data as TravelerProfile;
    } catch {
      // Fall through to localStorage
    }
  }

  // Fallback: localStorage
  try {
    const stored = localStorage.getItem(LOCAL_PROFILE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {
    // ignore
  }

  return null;
}

/** Save profile: try Supabase, always save to localStorage as backup */
export async function saveProfile(
  profile: TravelerProfile,
  userId?: string
): Promise<void> {
  // Always save to localStorage as backup
  localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(profile));

  // Try Supabase if authenticated
  if (userId) {
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          age_range: profile.age_range,
          traveler_type: profile.traveler_type,
          interests: profile.interests,
          pace: profile.pace,
          mobility: profile.mobility,
          familiarity: profile.familiarity,
        })
        .eq("id", userId);

      if (error) console.error("[Storage] Error saving profile to Supabase:", error);
    } catch (err) {
      console.error("[Storage] Error saving profile to Supabase:", err);
    }
  }
}

// =============================================
// Saved Trips (Supabase only, requires auth)
// =============================================

export interface SavedTrip {
  id: string;
  trip_name: string;
  destination: string | null;
  inputs: TravelInputs;
  plan: any; // TravelPlan
  is_favorite: boolean;
  created_at: string;
  updated_at: string;
}

const LOCAL_TRIPS_KEY = "vagabond_saved_trips_local";

/** Load saved trips: try Supabase, fall back to localStorage */
export async function loadTrips(userId?: string): Promise<SavedTrip[]> {
  if (userId) {
    try {
      const { data, error } = await supabase
        .from("saved_trips")
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });

      if (!error && data) return data as SavedTrip[];
    } catch {
      // Fall through to localStorage
    }
  }

  // Fallback: localStorage (for guests)
  try {
    const stored = localStorage.getItem(LOCAL_TRIPS_KEY);
    if (stored) return JSON.parse(stored);
  } catch {
    // ignore
  }

  return [];
}

/** Save a trip — throws if userId is provided but Supabase save fails */
export async function saveTrip(
  trip: Omit<SavedTrip, "id" | "created_at" | "updated_at">,
  userId?: string
): Promise<SavedTrip | null> {
  if (userId) {
    const TIMEOUT_MS = 10_000;
      const insertPromise = supabase
      .from("saved_trips")
      .insert({
        user_id: userId,
        trip_name: trip.trip_name,
        destination: trip.destination,
        inputs: trip.inputs,
        plan: slimPlanForSave(trip.plan),
        is_favorite: trip.is_favorite,
      })
      .select()
      .single();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout: il server non risponde")), TIMEOUT_MS)
    );

    const { data, error } = await Promise.race([insertPromise, timeoutPromise]);
    if (error) {
      console.error('[SaveTrip] Supabase error:', JSON.stringify(error, null, 2));
      console.error('[SaveTrip] Payload plan keys:', Object.keys(trip.plan || {}));
      const planSize = new Blob([JSON.stringify(trip.plan)]).size;
      console.error('[SaveTrip] Plan JSON size:', (planSize / 1024).toFixed(1), 'KB');
      throw new Error(error.message);
    }
    return data as SavedTrip;
  }

  // Guest fallback: localStorage only when not authenticated
  const trips = await loadTrips();
  const newTrip: SavedTrip = {
    ...trip,
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  trips.unshift(newTrip);
  localStorage.setItem(LOCAL_TRIPS_KEY, JSON.stringify(trips));
  return newTrip;
}

/** Delete a trip */
export async function deleteTrip(tripId: string, userId?: string): Promise<void> {
  if (userId) {
    try {
      await supabase.from("saved_trips").delete().eq("id", tripId);
    } catch {
      // ignore
    }
  }

  // Also remove from localStorage
  const trips = await loadTrips();
  const filtered = trips.filter((t) => t.id !== tripId);
  localStorage.setItem(LOCAL_TRIPS_KEY, JSON.stringify(filtered));
}

/** Toggle favorite */
export async function toggleFavorite(
  tripId: string,
  isFavorite: boolean,
  userId?: string
): Promise<void> {
  if (userId) {
    try {
      await supabase
        .from("saved_trips")
        .update({ is_favorite: isFavorite })
        .eq("id", tripId);
    } catch {
      // ignore
    }
  }

  // Also update localStorage
  const trips = await loadTrips();
  const idx = trips.findIndex((t) => t.id === tripId);
  if (idx >= 0) {
    trips[idx].is_favorite = isFavorite;
    localStorage.setItem(LOCAL_TRIPS_KEY, JSON.stringify(trips));
  }
}

/** Migrate localStorage trips to Supabase (call after login) */
export async function migrateLocalTripsToSupabase(userId: string): Promise<void> {
  const localTrips = localStorage.getItem(LOCAL_TRIPS_KEY);
  if (!localTrips) return;

  try {
    const trips: SavedTrip[] = JSON.parse(localTrips);
    for (const trip of trips) {
      await supabase.from("saved_trips").insert({
        user_id: userId,
        trip_name: trip.trip_name,
        destination: trip.destination,
        inputs: trip.inputs,
        plan: trip.plan,
        is_favorite: trip.is_favorite,
      });
    }
    // Clear localStorage after successful migration
    localStorage.removeItem(LOCAL_TRIPS_KEY);
    console.log("[Storage] Migrated local trips to Supabase");
  } catch (err) {
    console.error("[Storage] Error migrating trips:", err);
  }
}