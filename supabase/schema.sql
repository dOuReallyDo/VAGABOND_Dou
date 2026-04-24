-- =============================================
-- VAGABOND_Dou — Supabase Schema
-- =============================================

-- Enable Row Level Security
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;

-- =============================================
-- 1. PROFILES (linked to auth.users)
-- =============================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Traveler profile
  age_range TEXT,
  traveler_type TEXT,
  interests TEXT[] DEFAULT '{}',
  pace TEXT DEFAULT 'Equilibrato',
  mobility TEXT DEFAULT 'Nessuna limitazione',
  familiarity TEXT DEFAULT 'Mai stato qui',
  
  -- Display name
  display_name TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- RLS policies
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- =============================================
-- 2. SAVED_TRIPS
-- =============================================
CREATE TABLE IF NOT EXISTS public.saved_trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  
  -- Trip info
  trip_name TEXT NOT NULL,
  destination TEXT,
  
  -- Full input & output (JSONB)
  inputs JSONB NOT NULL DEFAULT '{}',
  plan JSONB NOT NULL DEFAULT '{}',
  
  -- Flags
  is_favorite BOOLEAN DEFAULT false,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookup by user
CREATE INDEX IF NOT EXISTS idx_saved_trips_user ON public.saved_trips (user_id);
CREATE INDEX IF NOT EXISTS idx_saved_trips_favorite ON public.saved_trips (user_id, is_favorite);

-- RLS policies
ALTER TABLE public.saved_trips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own trips"
  ON public.saved_trips FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own trips"
  ON public.saved_trips FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own trips"
  ON public.saved_trips FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own trips"
  ON public.saved_trips FOR DELETE
  USING (auth.uid() = user_id);

-- =============================================
-- 3. HELPER: updated_at trigger
-- =============================================
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at ON public.profiles;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.saved_trips;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.saved_trips
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();