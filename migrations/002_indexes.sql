-- Kennari migration 002: indexes for the common lookups
-- Additive only. Safe to re-run. Run after 000 and 001 (needs sessions.program).
-- Postgres does not index foreign keys automatically.

-- "All sets for this session" (progression, tracking, adjust popup)
CREATE INDEX IF NOT EXISTS idx_sets_session_id
  ON sets (session_id);

-- Progression / tracking: set rows for one exercise within a session
CREATE INDEX IF NOT EXISTS idx_sets_session_exercise_type
  ON sets (session_id, exercise, set_type);

-- "This user's completed sessions for a program, newest first"
-- (next workout day, last session, session count, tracking chart)
CREATE INDEX IF NOT EXISTS idx_sessions_user_program_session_number
  ON sessions (user_id, program, session_number DESC)
  WHERE completed_at IS NOT NULL;

-- Latest starting weight per exercise
CREATE INDEX IF NOT EXISTS idx_starting_weights_user_exercise_set_at
  ON starting_weights (user_id, exercise, set_at DESC);

-- Goals by user
CREATE INDEX IF NOT EXISTS idx_goals_user_id
  ON goals (user_id);

-- 5/3/1: latest training max per lift
CREATE INDEX IF NOT EXISTS idx_training_maxes_user_lift_created
  ON training_maxes (user_id, lift, created_at DESC);
