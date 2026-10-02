-- Kennari migration 001: 5/3/1 program support
-- Source: PRD-531.md section 4
-- Additive only: new columns with defaults, one new table. No renames, no drops.
-- Safe to re-run (IF NOT EXISTS / guarded policy creation).
-- Run manually in the Supabase SQL Editor.

-- Program on profile (chosen once at onboarding)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS active_program text NOT NULL DEFAULT 'lite_viking';

-- Program tag on sessions; existing rows become lite_viking
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS program text NOT NULL DEFAULT 'lite_viking';

-- Marks 5/3/1 test-day sessions (not counted in n)
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

-- 5/3/1 training maxes, one row per lift per test
CREATE TABLE IF NOT EXISTS training_maxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lift text NOT NULL,                 -- press | deadlift | bench | squat
  test_weight_lbs numeric NOT NULL,
  test_reps integer NOT NULL,
  e1rm_lbs numeric NOT NULL,
  training_max_lbs numeric NOT NULL,  -- starting TM for this lift
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: same pattern as the other user tables (user can read/write own rows only)
ALTER TABLE training_maxes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'training_maxes'
      AND policyname = 'Users can manage own training maxes'
  ) THEN
    CREATE POLICY "Users can manage own training maxes" ON training_maxes
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END
$$;
