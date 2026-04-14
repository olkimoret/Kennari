/* Kennari — workout.js | Session 5
   Core workout screen logic.
   ------------------------------------------------ */

import { supabase, getUser } from './supabase.js';
import { requireAuth }       from './app.js';
import {
  getFullWorkout,
  getDisplayWeight,
} from './program.js';

// ================================================================
// State
// ================================================================

const state = {
  user:           null,
  profile:        null,
  workout:        null,   // { day, exercises: [...] }
  sessionId:      null,   // created on first set completion
  sessionNumber:  null,
  exerciseIndex:  0,      // which exercise in workout.exercises
  phase:          'warmup',  // 'warmup' | 'working'
  setIndex:       0,      // which set within current phase (0-based)
  displayMode:    'total',
  restInterval:   null,   // active countdown interval
  restOnComplete: null,   // callback stored so tap-to-skip can call it
};

// ================================================================
// DOM refs
// ================================================================

const DOM = {
  screen:        document.getElementById('workout-screen'),
  phasePill:     document.getElementById('phase-pill'),
  skipWarmup:    document.getElementById('btn-skip-warmup'),
  exName:        document.getElementById('exercise-name'),
  sessionLabel:  document.getElementById('session-label'),
  weightNumber:  document.getElementById('weight-number'),
  weightUnit:    document.getElementById('weight-unit'),
  setLabel:      document.getElementById('set-label'),
  setDots:       document.getElementById('set-dots'),
  btnComplete:   document.getElementById('btn-complete'),
  btnDoneEarly:  document.getElementById('btn-done-early'),
  completion:    document.getElementById('completion-overlay'),
  completionSub: document.getElementById('completion-sub'),
  btnDone:       document.getElementById('btn-done'),
  timerOverlay:  document.getElementById('timer-overlay'),
  timerCard:     document.getElementById('timer-card'),
  timerNumber:   document.getElementById('timer-number'),
  timerRing:     document.getElementById('timer-ring'),
  btnSkipRest:   document.getElementById('btn-skip-rest'),
};

// ================================================================
// Helpers
// ================================================================

function getCurrentExercise() {
  return state.workout.exercises[state.exerciseIndex];
}

function getCurrentSets() {
  const ex = getCurrentExercise();
  return state.phase === 'warmup' ? ex.warmupSets : ex.workingSets;
}

function getRestDuration(nextType) {
  const warmupRest  = state.profile?.rest_warmup_seconds  ?? 90;
  const workingRest = state.profile?.rest_working_seconds ?? 180;

  switch (nextType) {
    case 'next-warmup-set':   return warmupRest;
    case 'start-working':     return warmupRest;   // end of warmup → brief rest
    case 'next-working-set':  return workingRest;
    case 'next-exercise':     return workingRest;
    case 'workout-complete':  return 0;
    default:                  return 0;
  }
}

// What happens after the current set is completed?
function computeNextType() {
  const sets        = getCurrentSets();
  const isLastSet   = state.setIndex >= sets.length - 1;
  const isLastEx    = state.exerciseIndex >= state.workout.exercises.length - 1;

  if (state.phase === 'warmup') {
    return isLastSet ? 'start-working' : 'next-warmup-set';
  } else {
    if (!isLastSet)  return 'next-working-set';
    if (!isLastEx)   return 'next-exercise';
    return 'workout-complete';
  }
}

// ================================================================
// Render
// ================================================================

function renderAll() {
  const exercise   = getCurrentExercise();
  const sets       = getCurrentSets();
  const currentSet = sets[state.setIndex];
  const isWarmup   = state.phase === 'warmup';

  // Phase class on root (drives all CSS color switches)
  DOM.screen.className = `app-container workout-screen phase-${state.phase}`;

  // Phase pill
  DOM.phasePill.className   = isWarmup ? 'pill-warmup' : 'pill-working';
  DOM.phasePill.textContent = isWarmup ? 'WARM UP' : 'WORKOUT';

  // Exercise + session info
  DOM.exName.textContent       = exercise.name;
  DOM.sessionLabel.textContent = `TRAINING ${state.workout.day}`;

  // Weight number
  renderWeight(currentSet.weightLbs);

  // Set label:  "SET 2 / 4 · 5 REPS"
  DOM.setLabel.textContent =
    `SET ${state.setIndex + 1} / ${sets.length} · ${currentSet.reps} REPS`;

  // Dots: filled = completed, empty = upcoming or current
  renderDots(sets.length, state.setIndex);
}

function renderWeight(weightLbs) {
  const barbellWeight = state.profile?.barbell_weight_lbs ?? 45;
  const unit          = state.profile?.unit_preference    ?? 'lbs';

  const { value, unit: displayUnit } = getDisplayWeight(
    weightLbs,
    state.displayMode,
    barbellWeight,
    unit,
  );

  DOM.weightNumber.textContent = value;
  DOM.weightUnit.textContent   = displayUnit.toUpperCase();
}

function renderDots(total, completedCount) {
  DOM.setDots.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const dot = document.createElement('span');
    dot.className = 'dot' + (i < completedCount ? ' filled' : '');
    DOM.setDots.appendChild(dot);
  }
}

// Immediately fill the dot for the set just tapped (before rest timer)
function fillCurrentDot() {
  const dots = DOM.setDots.querySelectorAll('.dot');
  const dot  = dots[state.setIndex];
  if (dot) dot.classList.add('filled');
}

// ================================================================
// Rest timer
// ================================================================

const RING_CIRCUMFERENCE = 2 * Math.PI * 68; // ≈ 427

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function updateRing(remaining, total) {
  const progress = total > 0 ? remaining / total : 0;
  DOM.timerRing.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - progress);
}

function showTimer(seconds, onComplete) {
  if (seconds <= 0) {
    onComplete();
    return;
  }

  state.restOnComplete = onComplete;
  let remaining = seconds;

  // Reset ring instantly (no transition) before showing
  DOM.timerRing.style.transition = 'none';
  DOM.timerRing.style.strokeDashoffset = '0';
  DOM.timerNumber.textContent = formatTime(remaining);

  // Hide CTA while resting
  DOM.btnComplete.style.visibility = 'hidden';

  // Show overlay + slide card up
  DOM.timerOverlay.classList.add('active');
  // Force a reflow so the slide-up transition fires
  void DOM.timerCard.offsetHeight;
  DOM.timerCard.classList.remove('slide-down');
  DOM.timerCard.classList.add('slide-up');

  // Re-enable ring transition after a tick so the first update animates
  requestAnimationFrame(() => {
    DOM.timerRing.style.transition = '';
    updateRing(remaining, seconds);
  });

  state.restInterval = setInterval(() => {
    remaining--;
    DOM.timerNumber.textContent = formatTime(remaining);
    updateRing(remaining, seconds);

    if (remaining <= 0) {
      hideTimer(onComplete);
    }
  }, 1000);
}

function hideTimer(onComplete) {
  if (state.restInterval) {
    clearInterval(state.restInterval);
    state.restInterval = null;
  }

  state.restOnComplete = null;

  // Slide card down + fade overlay
  DOM.timerCard.classList.remove('slide-up');
  DOM.timerCard.classList.add('slide-down');
  DOM.timerOverlay.classList.remove('active');

  // Restore CTA after card finishes sliding (250ms)
  setTimeout(() => {
    DOM.btnComplete.style.visibility = '';
    if (onComplete) onComplete();
  }, 260);
}

function skipRest() {
  if (!state.restInterval && !state.restOnComplete) return;
  const cb = state.restOnComplete;
  hideTimer(cb);
}

// ================================================================
// State transitions
// ================================================================

function applyNextState(nextType) {
  switch (nextType) {
    case 'next-warmup-set':
      state.setIndex++;
      break;

    case 'start-working':
      state.phase    = 'working';
      state.setIndex = 0;
      break;

    case 'next-working-set':
      state.setIndex++;
      break;

    case 'next-exercise':
      state.exerciseIndex++;
      state.phase    = 'warmup';
      state.setIndex = 0;
      break;

    case 'workout-complete':
      finishWorkout();
      return;
  }

  renderAll();
}

// ================================================================
// Supabase — session & set persistence
// ================================================================

async function ensureSession() {
  if (state.sessionId) return;

  const { data, error } = await supabase
    .from('sessions')
    .insert({
      user_id:        state.user.id,
      session_number: state.sessionNumber,
      workout_day:    state.workout.day,
      completed_at:   null,
    })
    .select('id')
    .single();

  if (!error && data) {
    state.sessionId = data.id;
  }
}

async function saveSet(exercise, setType, setNumber, reps, weightLbs) {
  await ensureSession();
  if (!state.sessionId) return;

  await supabase.from('sets').insert({
    session_id:     state.sessionId,
    exercise,
    set_type:       setType,
    set_number:     setNumber,
    reps_target:    reps,
    reps_completed: reps, // full reps assumed; partial tracking in Session 7
    weight_lbs:     weightLbs,
    completed:      true,
  });
}

async function finishWorkout(early = false) {
  if (state.sessionId) {
    await supabase
      .from('sessions')
      .update({ completed_at: new Date().toISOString() })
      .eq('id', state.sessionId);

    await supabase
      .from('profiles')
      .update({ session_count: (state.profile?.session_count ?? 0) + 1 })
      .eq('id', state.user.id);
  }

  showCompletion(early);
}

// ================================================================
// Completion screen
// ================================================================

function showCompletion(early = false) {
  if (early) {
    DOM.completionSub.textContent =
      'Progress saved. Rest up — see you next time.';
  } else {
    const day     = state.workout.day;
    const exCount = state.workout.exercises.length;
    DOM.completionSub.textContent =
      `Day ${day} done — ${exCount} exercise${exCount > 1 ? 's' : ''} completed.`;
  }
  DOM.completion.hidden = false;
}

// ================================================================
// Complete Set handler
// ================================================================

async function onCompleteSet() {
  // Pulse animation
  DOM.btnComplete.classList.add('pulsing');
  DOM.btnComplete.addEventListener(
    'animationend',
    () => DOM.btnComplete.classList.remove('pulsing'),
    { once: true },
  );

  const exercise   = getCurrentExercise();
  const sets       = getCurrentSets();
  const currentSet = sets[state.setIndex];

  // Visually fill the completed dot immediately
  fillCurrentDot();

  // Persist to Supabase (non-blocking — don't await, don't stall UI)
  saveSet(
    exercise.exercise,
    state.phase,
    state.setIndex + 1,
    currentSet.reps,
    currentSet.weightLbs,
  );

  const nextType    = computeNextType();
  const restSeconds = getRestDuration(nextType);

  showTimer(restSeconds, () => applyNextState(nextType));
}

// ================================================================
// Done for today (early exit)
// ================================================================

async function onDoneForToday() {
  // Dismiss rest timer if active (same teardown as skip warmup)
  if (state.restInterval) {
    clearInterval(state.restInterval);
    state.restInterval   = null;
    state.restOnComplete = null;
    DOM.timerCard.classList.remove('slide-up');
    DOM.timerCard.classList.add('slide-down');
    DOM.timerOverlay.classList.remove('active');
    DOM.btnComplete.style.visibility = '';
  }

  // Nothing was completed at all — bail without creating a session record
  if (!state.sessionId) {
    window.location.replace('home.html');
    return;
  }

  // Disable both buttons while saving
  DOM.btnDoneEarly.disabled  = true;
  DOM.btnComplete.disabled   = true;

  await finishWorkout(true);
}

// ================================================================
// Skip warmup
// ================================================================

function onSkipWarmup() {
  // Dismiss rest timer if it's currently showing
  if (state.restInterval) {
    clearInterval(state.restInterval);
    state.restInterval   = null;
    state.restOnComplete = null;
    DOM.timerCard.classList.remove('slide-up');
    DOM.timerCard.classList.add('slide-down');
    DOM.timerOverlay.classList.remove('active');
    DOM.btnComplete.style.visibility = '';
  }

  state.phase    = 'working';
  state.setIndex = 0;
  renderAll();
}

// ================================================================
// Display mode icons
// ================================================================

function setupModeIcons() {
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.mode === state.displayMode) return;

      state.displayMode = btn.dataset.mode;

      document.querySelectorAll('.mode-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.mode === state.displayMode),
      );

      // Recalculate big number for current set
      const sets       = getCurrentSets();
      const currentSet = sets[state.setIndex];
      renderWeight(currentSet.weightLbs);
    });
  });
}

// ================================================================
// Init
// ================================================================

async function init() {
  state.user = await requireAuth();
  if (!state.user) return;

  // Load profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', state.user.id)
    .maybeSingle();

  state.profile = profile;

  // Next session number = completed sessions + 1
  const { count } = await supabase
    .from('sessions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', state.user.id)
    .not('completed_at', 'is', null);

  state.sessionNumber = (count ?? 0) + 1;

  // Build the full workout
  state.workout = await getFullWorkout(state.user.id, profile);

  // Initial render
  renderAll();

  // Listeners
  DOM.btnComplete.addEventListener('click', onCompleteSet);
  DOM.btnDoneEarly.addEventListener('click', onDoneForToday);
  DOM.skipWarmup.addEventListener('click', onSkipWarmup);
  DOM.btnDone.addEventListener('click', () => {
    window.location.replace('home.html');
  });
  DOM.timerOverlay.addEventListener('click', skipRest);
  DOM.btnSkipRest.addEventListener('click', skipRest);

  setupModeIcons();
}

init();
