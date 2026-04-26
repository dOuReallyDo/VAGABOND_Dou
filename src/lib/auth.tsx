import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { User, Session } from "@supabase/supabase-js";

// =============================================
// Types
// =============================================
export interface TravelerProfile {
  age_range: string;
  traveler_type: string;
  interests: string[];
  pace: string;
  mobility: string;
  familiarity: string;
  display_name?: string;
}

export const DEFAULT_PROFILE: TravelerProfile = {
  age_range: "",
  traveler_type: "",
  interests: [],
  pace: "Equilibrato",
  mobility: "Nessuna limitazione",
  familiarity: "Mai stato qui",
};

// =============================================
// Auth Context
// =============================================
interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  profile: TravelerProfile | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, displayName?: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<TravelerProfile>) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<TravelerProfile | null>(null);

  // Fetch profile from Supabase
  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("age_range, traveler_type, interests, pace, mobility, familiarity, display_name")
        .eq("id", userId)
        .single();

      if (error) {
        console.warn("[Auth] Profile not found, using defaults:", error.message);
        setProfile(null);
        return;
      }

      setProfile(data as TravelerProfile);
    } catch (err) {
      console.error("[Auth] Error fetching profile:", err);
      setProfile(null);
    }
  };

  // Auth initialization.
  //
  // onAuthStateChange is the source of truth for reactive updates.
  // BUT: if Supabase's internal initializePromise rejects (e.g. navigator.locks
  // timeout on browser close/reopen), INITIAL_SESSION never fires and the app
  // stays on a blank page forever.
  //
  // getSession() is used as a guaranteed fallback: it reads directly from
  // localStorage without waiting for the lock, so it always resolves quickly.
  // If INITIAL_SESSION already fired first, the fallback is a no-op.
  useEffect(() => {
    let initialSessionHandled = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (!session?.user) setProfile(null);
        if (event === 'INITIAL_SESSION') {
          initialSessionHandled = true;
          setLoading(false);
        }
        if (session?.user) await fetchProfile(session.user.id);
      }
    );

    // Fallback: if INITIAL_SESSION hasn't fired within the same microtask queue,
    // getSession() guarantees setLoading(false) is called.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (initialSessionHandled) return;
      initialSessionHandled = true;
      setSession(session);
      setUser(session?.user ?? null);
      if (!session?.user) setProfile(null);
      else fetchProfile(session.user.id);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signUp = async (email: string, password: string, displayName?: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    });
    return { error: error?.message ?? null };
  };

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/`,
      },
    });
    if (error) throw error;
  };

  const signOut = async () => {
    setUser(null);
    setSession(null);
    setProfile(null);
    await supabase.auth.signOut();
  };

  const updateProfile = async (updates: Partial<TravelerProfile>) => {
    if (!user) return;
    const { error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", user.id);
    if (error) {
      console.error("[Auth] Error updating profile:", error);
      throw error;
    }
    await fetchProfile(user.id);
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        profile,
        signIn,
        signUp,
        signInWithGoogle,
        signOut,
        updateProfile,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}