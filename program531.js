/*
 * Kennari — program531.js
 * 5/3/1 engine — logic only, no UI. See docs/PRD-531.md sections 3 to 5.
 * All weights are lbs. Rounding uses roundToNearest from program.js.
 *
 * Reads: training_maxes, sessions (program = '531').
 * Writes: training_maxes (save531Test).
 * Never touches starting_weights or profiles.session_count.
 * Warmup sets are never stored; they are recalculated from the weight.
 *
 * Run the tests from any page served over http, in the browser console:
 *   (await import('./program531.js')).run531Tests()
 */

import { supabase }        from './supabase.js';
import { roundToNearest }  from './program.js';

// ================================================================
// Constants
// ================================================================

export const LIFT_ORDER = ['press', 'deadlift', 'bench', 'squat'];

// Cycle-to-cycle training max increase (lbs)
export const TM_INCREMENT_LBS = { press: 5, bench: 5, squat: 10, deadlift: 10 };

const ROUND_LBS    = 2.5;     // rounding rule (same as the rest of the app)
const TM_PERCENT   = 0.90;
const E1RM_FACTOR  = 0.0333;
const TEST_REPS    = 5;       // target shown on the test set ("5+")

// Warmup, every workout (and test day, off the test weight)
const WARMUP_SCHEME = [
  { pct: 0.40, reps: 5 },
  { pct: 0.50, reps: 5 },
  { pct: 0.60, reps: 3 },
];

// Work sets by week (percent of training max)
export const WEEK_SCHEME = {
  1: { label: '5s',     sets: [
    { pct: 0.65, reps: 5 }, { pct: 0.75, reps: 5 }, { pct: 0.85, reps: 5, amrap: true } ] },
  2: { label: '3s',     sets: [
    { pct: 0.70, reps: 3 }, { pct: 0.80, reps: 3 }, { pct: 0.90, reps: 3, amrap: true } ] },
  3: { label: '5/3/1',  sets: [
    { pct: 0.75, reps: 5 }, { pct: 0.85, reps: 3 }, { pct: 0.95, reps: 1, amrap: true } ] },
  4: { label: 'DELOAD', sets: [
    { pct: 0.40, reps: 5 }, { pct: 0.50, reps: 5 }, { pct: 0.60, reps: 5 } ] },
};

// ================================================================
// Pure logic
// ================================================================

// Estimated 1RM = weight x reps x 0.0333 + weight
export function estimate1RM(weightLbs, reps) {
  return weightLbs * reps * E1RM_FACTOR + weightLbs;
}

// Training max = 90% of estimated 1RM, rounded
export function trainingMaxFrom1RM(e1rmLbs) {
  return roundToNearest(e1rmLbs * TM_PERCENT, ROUND_LBS);
}

// Position from the number of completed regular workouts (n)
export function positionFromN(n) {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`positionFromN: n must be a non-negative integer, got ${n}`);
  }
  return {
    lift:  LIFT_ORDER[n % 4],
    week:  Math.floor((n % 16) / 4) + 1,
    cycle: Math.floor(n / 16) + 1,
    n,
  };
}

// Training max for a given cycle = starting TM + (cycle - 1) x increment
export function tmForCycle(startingTmLbs, lift, cycle) {
  const inc = TM_INCREMENT_LBS[lift];
  if (inc === undefined) throw new Error(`Unknown lift: ${lift}`);
  return startingTmLbs + (cycle - 1) * inc;
}

// Warmup sets off a base weight (training max, or test weight on a test day).
// No 45 lb floor here: the spec's percentages are used as written.
export function getWarmupSets531(baseWeightLbs) {
  return WARMUP_SCHEME.map((cfg, i) => ({
    setNumber: i + 1,
    reps:      cfg.reps,
    weightLbs: roundToNearest(baseWeightLbs * cfg.pct, ROUND_LBS),
  }));
}

// Work sets for a week off the training max
export function getWorkingSets531(tmLbs, week) {
  const scheme = WEEK_SCHEME[week];
  if (!scheme) throw new Error(`Unknown week: ${week}`);
  return scheme.sets.map((cfg, i) => ({
    setNumber: i + 1,
    reps:      cfg.reps,
    weightLbs: roundToNearest(tmLbs * cfg.pct, ROUND_LBS),
    amrap:     cfg.amrap === true,
  }));
}

// Warmup and the single AMRAP test set, once the user has entered a test weight
export function getTestSets(testWeightLbs) {
  return {
    warmupSets:  getWarmupSets531(testWeightLbs),
    workingSets: [{ setNumber: 1, reps: TEST_REPS, weightLbs: testWeightLbs, amrap: true }],
  };
}

// Completion rule: a workout counts only if its LAST working set was completed
// (AMRAP set in weeks 1-3, set 3 in deload week, the test set on a test day).
// completedSetNumbers = working set numbers the user has completed.
export function isWorkoutComplete(workout, completedSetNumbers) {
  const sets = workout?.workingSets ?? [];
  if (sets.length === 0) return false;
  const last = sets[sets.length - 1];
  return completedSetNumbers.includes(last.setNumber);
}

// ================================================================
// Supabase reads
// ================================================================

// Latest training_maxes row = the starting TM for that lift
async function getStartingTM(userId, lift) {
  const { data, error } = await supabase
    .from('training_maxes')
    .select('training_max_lbs')
    .eq('user_id', userId)
    .eq('lift', lift)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? Number(data.training_max_lbs) : null;
}

// { phase: 'test' | 'program', lift, week, cycle, n }
// phase is 'test' until all 4 lifts have a training max; lift is then the
// next untested lift in rotation order and week / cycle are null.
export async function get531Position(userId) {
  const [maxesRes, countRes] = await Promise.all([
    supabase
      .from('training_maxes')
      .select('lift')
      .eq('user_id', userId),
    supabase
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('program', '531')
      .eq('is_test', false)
      .not('completed_at', 'is', null),
  ]);

  if (maxesRes.error) throw maxesRes.error;
  if (countRes.error) throw countRes.error;

  const tested   = new Set((maxesRes.data ?? []).map(r => r.lift));
  const nextTest = LIFT_ORDER.find(l => !tested.has(l));

  if (nextTest) {
    return { phase: 'test', lift: nextTest, week: null, cycle: null, n: 0 };
  }

  return { phase: 'program', ...positionFromN(countRes.count ?? 0) };
}

// Current TM for a lift in a cycle, or null if the lift has not been tested
export async function getCurrentTM(userId, lift, cycle) {
  const startingTm = await getStartingTM(userId, lift);
  if (startingTm === null) return null;
  return tmForCycle(startingTm, lift, cycle);
}

// The workout to serve now.
// Test workout: warmupSets / workingSets are empty until the user enters a
// test weight; then call getTestSets(testWeightLbs).
export async function get531Workout(userId) {
  const pos      = await get531Position(userId);
  const liftName = pos.lift.toUpperCase();

  if (pos.phase === 'test') {
    return {
      program:         '531',
      kind:            'test',
      lift:            pos.lift,
      week:            null,
      cycle:           null,
      n:               pos.n,
      tmLbs:           null,
      label:           `TEST · ${liftName}`,
      needsTestWeight: true,
      warmupSets:      [],
      workingSets:     [],
    };
  }

  const tm = await getCurrentTM(userId, pos.lift, pos.cycle);
  if (tm === null) {
    throw new Error(`No training max found for ${pos.lift}`);
  }

  return {
    program:         '531',
    kind:            'program',
    lift:            pos.lift,
    week:            pos.week,
    cycle:           pos.cycle,
    n:               pos.n,
    tmLbs:           tm,
    label:           `WEEK ${pos.week} · ${WEEK_SCHEME[pos.week].label} · ${liftName}`,
    needsTestWeight: false,
    warmupSets:      getWarmupSets531(tm),
    workingSets:     getWorkingSets531(tm, pos.week),
  };
}

// ================================================================
// Supabase write
// ================================================================

// Saves a test result. Call only after the test set was completed.
// Returns { e1rmLbs, trainingMaxLbs }.
export async function save531Test(userId, lift, testWeightLbs, reps) {
  if (!LIFT_ORDER.includes(lift)) {
    throw new Error(`Unknown lift: ${lift}`);
  }
  if (!(testWeightLbs > 0)) {
    throw new Error('Test weight must be greater than 0');
  }
  if (!Number.isInteger(reps) || reps < 1) {
    throw new Error('Reps must be a whole number of at least 1');
  }

  const e1rmLbs        = estimate1RM(testWeightLbs, reps);
  const trainingMaxLbs = trainingMaxFrom1RM(e1rmLbs);

  const { error } = await supabase
    .from('training_maxes')
    .insert({
      user_id:          userId,
      lift,
      test_weight_lbs:  testWeightLbs,
      test_reps:        reps,
      e1rm_lbs:         e1rmLbs,
      training_max_lbs: trainingMaxLbs,
    });

  if (error) throw error;
  return { e1rmLbs, trainingMaxLbs };
}

// ================================================================
// Console tests (pure logic, no database)
// ================================================================

export function run531Tests() {
  const results = [];

  function check(name, actual, expected) {
    const a    = JSON.stringify(actual);
    const e    = JSON.stringify(expected);
    const pass = a === e;
    results.push({ test: name, result: pass ? 'PASS' : 'FAIL', actual: a, expected: e });
  }

  const weights = sets => sets.map(s => s.weightLbs);
  const reps    = sets => sets.map(s => s.reps);

  // Press test: 100 lbs x 6 reps
  const e1rm = estimate1RM(100, 6);
  check('test: e1RM (2dp)',       e1rm.toFixed(2),               '119.98');
  check('test: TM',               trainingMaxFrom1RM(e1rm),      107.5);
  const t = getTestSets(100);
  check('test: warmup weights',   weights(t.warmupSets),         [40, 50, 60]);
  check('test: warmup reps',      reps(t.warmupSets),            [5, 5, 3]);
  check('test: one AMRAP set',    t.workingSets.map(s => s.amrap), [true]);

  // Press, cycle 1, week 1 (TM 107.5)
  const tm = tmForCycle(107.5, 'press', 1);
  check('c1w1: TM',               tm,                            107.5);
  check('c1w1: warmup weights',   weights(getWarmupSets531(tm)), [42.5, 55, 65]);
  check('c1w1: warmup reps',      reps(getWarmupSets531(tm)),    [5, 5, 3]);
  check('c1w1: work weights',     weights(getWorkingSets531(tm, 1)), [70, 80, 92.5]);
  check('c1w1: work reps',        reps(getWorkingSets531(tm, 1)),    [5, 5, 5]);
  check('c1w1: AMRAP flags',      getWorkingSets531(tm, 1).map(s => s.amrap), [false, false, true]);

  // Press, cycle 1, week 4 (deload, no AMRAP)
  check('c1w4: work weights',     weights(getWorkingSets531(tm, 4)), [42.5, 55, 65]);
  check('c1w4: work reps',        reps(getWorkingSets531(tm, 4)),    [5, 5, 5]);
  check('c1w4: no AMRAP',         getWorkingSets531(tm, 4).map(s => s.amrap), [false, false, false]);

  // Extra: weeks 2 and 3 (not in the brief, same TM)
  check('c1w2: work weights',     weights(getWorkingSets531(tm, 2)), [75, 85, 97.5]);
  check('c1w3: work weights',     weights(getWorkingSets531(tm, 3)), [80, 92.5, 102.5]);

  // Position
  const pos = n => { const p = positionFromN(n); return [p.lift, p.week, p.cycle]; };
  check('n=0  press/w1/c1',       pos(0),  ['press', 1, 1]);
  check('n=5  deadlift/w2/c1',    pos(5),  ['deadlift', 2, 1]);
  check('n=15 squat/w4/c1',       pos(15), ['squat', 4, 1]);
  check('n=16 press/w1/c2',       pos(16), ['press', 1, 2]);

  // Training max by cycle
  check('press TM cycle 2',       tmForCycle(107.5, 'press', 2),    112.5);
  check('bench TM cycle 2 (+5)',  tmForCycle(100, 'bench', 2),      105);
  check('squat TM cycle 2 (+10)', tmForCycle(200, 'squat', 2),      210);
  check('deadlift TM cycle 3 (+10)', tmForCycle(250, 'deadlift', 3), 270);

  // Completion rule
  const w1 = { workingSets: getWorkingSets531(tm, 1) };
  check('complete: last set done',  isWorkoutComplete(w1, [1, 2, 3]), true);
  check('complete: stopped early',  isWorkoutComplete(w1, [1, 2]),    false);
  const w4 = { workingSets: getWorkingSets531(tm, 4) };
  check('complete: deload set 3',   isWorkoutComplete(w4, [1, 2, 3]), true);
  check('complete: test set',       isWorkoutComplete(t, [1]),        true);
  check('complete: test not done',  isWorkoutComplete(t, []),         false);

  const failed = results.filter(r => r.result === 'FAIL');
  console.table(results.map(({ test, result }) => ({ test, result })));
  if (failed.length) {
    console.warn(`${failed.length} FAILED`);
    console.table(failed);
  } else {
    console.log(`All ${results.length} tests passed`);
  }
  return { passed: results.length - failed.length, failed: failed.length, results };
}
