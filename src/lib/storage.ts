import { supabase } from "./supabase";
import type { TravelerProfile } from "./auth";
import type { TravelInputs } from "../services/travelService";

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
        plan: trip.plan,
        is_favorite: trip.is_favorite,
      })
      .select()
      .single();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout: il server non risponde")), TIMEOUT_MS)
    );

    const { data, error } = await Promise.race([insertPromise, timeoutPromise]);
    if (error) throw new Error(error.message);
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