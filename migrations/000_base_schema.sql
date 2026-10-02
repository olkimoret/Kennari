-- Kennari migration 000: base schema for a FRESH Supabase project
-- Reconstructed from what the app code reads and writes (Lite Viking).
-- Run this FIRST, then 001_531.sql. Do NOT run on a project that already has these tables.

-- profiles: one row per user; its existence means "onboarded"
CREATE TABLE IF NOT EXISTS profiles (
  id                   uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name                 text,
  age                  integer,
  bodyweight_lbs       numeric,
  unit_preference      text    NOT NULL DEFAULT 'lbs',
  barbell_weight_lbs   numeric NOT NULL DEFAULT 45,
  rest_warmup_seconds  integer NOT NULL DEFAULT 90,
  rest_working_seconds integer NOT NULL DEFAULT 180,
  weight_increment_lbs numeric NOT NULL DEFAULT 5,
  session_count        integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS starting_weights (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exercise   text NOT NULL,            -- squat | press | bench | deadlift
  weight_lbs numeric NOT NULL,
  set_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_number integer NOT NULL,
  workout_day    text NOT NULL,        -- 'A' | 'B'
  completed_at   timestamptz DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS sets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  exercise       text NOT NULL,
  set_type       text NOT NULL,        -- 'warmup' | 'working'
  set_number     integer NOT NULL,
  reps_target    integer NOT NULL,
  reps_completed integer DEFAULT NULL,
  weight_lbs     numeric NOT NULL,
  completed      boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS goals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exercise          text NOT NULL,
  target_weight_lbs numeric NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Row Level Security: users can only touch their own rows
ALTER TABLE profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE starting_weights ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sets             ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals            ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own profile" ON profiles
  FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can manage own starting weights" ON starting_weights
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can manage own sessions" ON sessions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can manage own sets" ON sets
  FOR ALL
  USING (session_id IN (SELECT id FROM sessions WHERE user_id = auth.uid()))
  WITH CHECK (session_id IN (SELECT id FROM sessions WHERE user_id = auth.uid()));

CREATE POLICY "Users can manage own goals" ON goals
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
