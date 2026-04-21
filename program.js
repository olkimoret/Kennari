/*
 * Kennari — program.js | Session 4
 * Complete training program engine — pure logic, no UI.
 * All weights stored and calculated in lbs internally.
 * Display conversion (kg / per-side / per-dumbbell) happens here too.
 *
 * ============================================================
 * SUPABASE SETUP
 * Run these SQL statements in your Supabase SQL Editor
 * if you haven't already created these tables.
 * ============================================================
 *
 * create table sessions (
 *   id             uuid default gen_random_uuid() primary key,
 *   user_id        uuid references auth.users not null,
 *   session_number integer not null,
 *   workout_day    text not null,
 *   completed_at   timestamp with time zone default null
 * );
 *
 * create table sets (
 *   id             uuid default gen_random_uuid() primary key,
 *   session_id     uuid references sessions not null,
 *   exercise       text not null,
 *   set_type       text not null,        -- 'warmup' | 'working'
 *   set_number     integer not null,
 *   reps_target    integer not null,
 *   reps_completed integer default null, -- null until logged
 *   weight_lbs     numeric not null,
 *   completed      boolean default false
 * );
 *
 * alter table sessions enable row level security;
 * alter table sets     enable row level security;
 *
 * create policy "Users can manage own sessions" on sessions
 *   for all using (auth.uid() = user_id);
 *
 * create policy "Users can manage own sets" on sets
 *   for all using (
 *     session_id in (
 *       select id from sessions where user_id = auth.uid()
 *     )
 *   );
 *
 * ============================================================
 */

import { supabase } from './supabase.js';

// ================================================================
// Constants
// ================================================================

const WARMUP_SCHEMA = [
  { pct: 0.40, reps: 5 },
  { pct: 0.50, reps: 4 },
  { pct: 0.60, reps: 3 },
  { pct: 0.80, reps: 2 },
];

const MIN_WEIGHT_LBS   = 45;   // Never load a warmup below the bare bar
const PROGRESSION_LBS  = 5;    // Default; overridden by user's weight_increment_lbs
const DELOAD_FACTOR    = 0.90; // Applied after two consecutive fails
const WORKING_REPS     = 5;

// Exercises per day (internal keys match starting_weights / sets table)
const DAY_EXERCISES = {
  A: ['squat', 'press',  'deadlift'],
  B: ['squat', 'bench',  'deadlift'],
};

// Human-readable names for display
export const EXERCISE_LABELS = {
  squat:    'Squat',
  press:    'Press',
  bench:    'Bench Press',
  deadlift: 'Deadlift',
};

// Deadlift = 1 set; all other exercises = 3 sets
const WORKING_SET_COUNT = {
  squat:    3,
  press:    3,
  bench:    3,
  deadlift: 1,
};

// ================================================================
// Utility: roundToNearest
// e.g. roundToNearest(87.3, 2.5) → 87.5
// ================================================================

export function roundToNearest(value, increment) {
  return Math.round(value / increment) * increment;
}

// ================================================================
// Utility: convertToKg
// Converts lbs → kg, rounded to nearest 1.25 kg
// ================================================================

export function convertToKg(lbs) {
  return roundToNearest(lbs * 0.453592, 1.25);
}

// ================================================================
// getDisplayWeight
// Returns { value, label, unit } for rendering on the workout screen
//
// mode:  'total'    → full bar weight
//        'barbell'  → plates loaded per side
//        'dumbbell' → weight per hand
// unit:  'lbs' | 'kg'
// ================================================================

export function getDisplayWeight(weightLbs, mode, barbellWeightLbs, unit) {
  let raw;

  switch (mode) {
    case 'total':
      raw = weightLbs;
      break;
    case 'barbell':
      raw = (weightLbs - barbellWeightLbs) / 2;
      break;
    case 'dumbbell':
      raw = weightLbs / 2;
      break;
    default:
      raw = weightLbs;
  }

  // Clamp to 0 in case barbell weight > total (edge case)
  raw = Math.max(raw, 0);

  const roundedLbs = roundToNearest(raw, 2.5);
  const value      = unit === 'kg' ? convertToKg(roundedLbs) : roundedLbs;

  const labelMap = {
    total:    'total',
    barbell:  'per side',
    dumbbell: 'per dumbbell',
  };

  return {
    value,
    label: labelMap[mode] ?? 'total',
    unit,
  };
}

// ================================================================
// getWarmupSets
// Returns 4 warmup set descriptors for a given working weight
// ================================================================

export function getWarmupSets(workingWeightLbs) {
  return WARMUP_SCHEMA.map((cfg, i) => {
    const raw    = workingWeightLbs * cfg.pct;
    const weight = Math.max(roundToNearest(raw, 2.5), MIN_WEIGHT_LBS);
    return {
      setNumber: i + 1,
      reps:      cfg.reps,
      weightLbs: weight,
    };
  });
}

// ================================================================
// getWorkingSets
// Returns working set descriptors (1 for deadlift, 3 for others)
// ================================================================

export function getWorkingSets(workingWeightLbs, exercise) {
  const count = WORKING_SET_COUNT[exercise] ?? 3;
  return Array.from({ length: count }, (_, i) => ({
    setNumber: i + 1,
    reps:      WORKING_REPS,
    weightLbs: workingWeightLbs,
  }));
}

// ================================================================
// Internal: getStartingWeight
// Falls back to 45 lbs if not found (user skipped during onboarding)
// ================================================================

async function getStartingWeight(userId, exercise) {
  const { data } = await supabase
    .from('starting_weights')
    .select('weight_lbs')
    .eq('user_id', userId)
    .eq('exercise', exercise)
    .order('set_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.weight_lbs ?? MIN_WEIGHT_LBS;
}

// ================================================================
// Internal: didFail
// A session is failed if any working set was not completed
// or was completed with fewer reps than the target
// ================================================================

function didFail(sets) {
  if (!sets || sets.length === 0) return false;
  return sets.some(s =>
    !s.completed ||
    (s.reps_completed !== null && s.reps_completed < s.reps_target)
  );
}

// ================================================================
// Internal: getExerciseHistory
// Returns the last 2 completed sessions that included `exercise`,
// each with their working sets attached.
// ================================================================

async function getExerciseHistory(userId, exercise) {
  // Pull recent completed sessions — enough to find 2 with this exercise
  const { data: sessions } = await supabase
    .from('sessions')
    .select('id, session_number')
    .eq('user_id', userId)
    .not('completed_at', 'is', null)
    .order('session_number', { ascending: false })
    .limit(20);

  if (!sessions || sessions.length === 0) return [];

  const history = [];

  for (const session of sessions) {
    if (history.length >= 2) break;

    const { data: sets } = await supabase
      .from('sets')
      .select('weight_lbs, reps_target, reps_completed, completed')
      .eq('session_id', session.id)
      .eq('exercise', exercise)
      .eq('set_type', 'working');

    if (sets && sets.length > 0) {
      history.push({ session, sets });
    }
  }

  return history;
}

// ================================================================
// getNextWorkoutDay
// Returns 'A' or 'B' based on the last completed session
// ================================================================

export async function getNextWorkoutDay(userId) {
  const { data } = await supabase
    .from('sessions')
    .select('workout_day')
    .eq('user_id', userId)
    .not('completed_at', 'is', null)
    .order('session_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return 'A'; // Very first session ever
  return data.workout_day === 'A' ? 'B' : 'A';
}

// ================================================================
// getWorkingWeight
// Applies progression, same-weight repeat, or deload logic
// ================================================================

export async function getWorkingWeight(userId, exercise, progressionLbs = PROGRESSION_LBS) {
  const history = await getExerciseHistory(userId, exercise);

  // No history at all — use onboarding starting weight
  if (history.length === 0) {
    return getStartingWeight(userId, exercise);
  }

  const [last, prev] = history;
  const lastWeight   = last.sets[0].weight_lbs;
  const lastFailed   = didFail(last.sets);

  if (!lastFailed) {
    return lastWeight + progressionLbs;
  }

  // Failed last time — check for double fail at same weight
  if (prev) {
    const prevWeight = prev.sets[0].weight_lbs;
    const prevFailed = didFail(prev.sets);

    if (prevFailed && prevWeight === lastWeight) {
      // Two consecutive fails at the same weight → deload 10%
      return roundToNearest(lastWeight * DELOAD_FACTOR, 2.5);
    }
  }

  // Single fail → repeat same weight
  return lastWeight;
}

// ================================================================
// getFullWorkout
// Assembles the complete workout object for the workout screen
// ================================================================

export async function getFullWorkout(userId, userProfile) {
  const day           = await getNextWorkoutDay(userId);
  const exercises     = DAY_EXERCISES[day];
  const progressionLbs = userProfile?.weight_increment_lbs ?? PROGRESSION_LBS;

  const exerciseData = await Promise.all(
    exercises.map(async (ex) => {
      const workingWeightLbs = await getWorkingWeight(userId, ex, progressionLbs);
      return {
        name:             EXERCISE_LABELS[ex],
        exercise:         ex,
        workingWeightLbs,
        warmupSets:       getWarmupSets(workingWeightLbs),
        workingSets:      getWorkingSets(workingWeightLbs, ex),
      };
    })
  );

  return { day, exercises: exerciseData };
}
