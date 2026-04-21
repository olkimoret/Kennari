/* Kennari — workout.js | Session 5
   Core workout screen logic.
   ------------------------------------------------ */

import { supabase, getUser } from './supabase.js';
import { requireAuth }       from './app.js';
import {
  getFullWorkout,
  getDisplayWeight,
  getWarmupSets,
  getWorkingSets,
  roundToNearest,
  convertToKg,
} from './program.js';

// Mirrors WARMUP_SCHEMA percentages in program.js (index 0–3)
const WARMUP_PERCENTAGES = [40, 50, 60, 80];

const STORAGE_KEY = 'kennari_workout';

function persistState() {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
    userId:        state.user?.id,
    exerciseIndex: state.exerciseIndex,
    phase:         state.phase,
    setIndex:      state.setIndex,
    displayMode:   state.displayMode,
    sessionId:     state.sessionId,
    sessionNumber: state.sessionNumber,
    workout:       state.workout,
  }));
}

function clearPersistedState() {
  sessionStorage.removeItem(STORAGE_KEY);
}

function loadPersistedState(userId) {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    // Discard if it belongs to a different user
    if (saved.userId !== userId) return null;
    return saved;
  } catch {
    return null;
  }
}

// ================================================================
// State
// ================================================================

const state = {
  user:              null,
  profile:           null,
  workout:           null,   // { day, exercises: [...] }
  sessionId:         null,   // created on first set completion
  sessionNumber:     null,
  exerciseIndex:     0,      // which exercise in workout.exercises
  phase:             'warmup',  // 'warmup' | 'working'
  setIndex:          0,      // which set within current phase (0-based)
  displayMode:       'total',
  restInterval:      null,   // active countdown interval
  restOnComplete:    null,   // callback stored so tap-to-skip can call it
  weightIncrement:   5,      // lbs — loaded from profile
  adjustOriginalLbs: null,   // working weight when popup opened
  adjustCurrentLbs:  null,   // in-progress adjustment value
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
  repsLabel:     document.getElementById('reps-label'),
  setLabel:      document.getElementById('set-label'),
  exerciseCards: document.getElementById('exercise-cards'),
  btnComplete:   document.getElementById('btn-complete'),
  completion:    document.getElementById('completion-overlay'),
  completionSub: document.getElementById('completion-sub'),
  btnDone:       document.getElementById('btn-done'),
  confirmOverlay:  document.getElementById('confirm-overlay'),
  confirmCard:     document.getElementById('confirm-card'),
  btnConfirmYes:   document.getElementById('btn-confirm-yes'),
  btnConfirmNo:    document.getElementById('btn-confirm-no'),
  timerOverlay:  document.getElementById('timer-overlay'),
  timerCard:     document.getElementById('timer-card'),
  timerNumber:   document.getElementById('timer-number'),
  timerRing:     document.getElementById('timer-ring'),
  btnSkipRest:   document.getElementById('btn-skip-rest'),
  // Weight adjust popup
  btnAdjustWeight:  document.getElementById('btn-adjust-weight'),
  adjustOverlay:    document.getElementById('adjust-overlay'),
  adjustCard:       document.getElementById('adjust-card'),
  adjustWeightNum:  document.getElementById('adjust-weight-number'),
  adjustWeightUnit: document.getElementById('adjust-weight-unit'),
  btnAdjustMinus:   document.getElementById('btn-adjust-minus'),
  btnAdjustPlus:    document.getElementById('btn-adjust-plus'),
  adjustInput:      document.getElementById('adjust-input'),
  btnAdjustSave:    document.getElementById('btn-adjust-save'),
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

  // Header action button: skip warmup during warmup, done for today during working
  DOM.skipWarmup.textContent = isWarmup ? 'Skip warm up' : "I'm done for today";

  // Exercise + session info
  DOM.exName.textContent       = exercise.name;
  DOM.sessionLabel.textContent = `TRAINING ${state.workout.day}`;

  // Weight number
  renderWeight(currentSet.weightLbs);

  // Reps line (large): "5 REPS"
  DOM.repsLabel.textContent = `${currentSet.reps} REPS`;

  // Set info line (small): "SET 2 / 4 · 50%" (warmup) or "SET 2 / 3" (working)
  const pctSuffix = isWarmup
    ? ` · ${WARMUP_PERCENTAGES[state.setIndex] ?? ''}%`
    : '';
  DOM.setLabel.textContent =
    `SET ${state.setIndex + 1} / ${sets.length}${pctSuffix}`;

  // Exercise cards: one per exercise, active/completed/upcoming states
  renderExerciseCards();

  // Persist position so navigating away and back restores the workout
  persistState();
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

function renderExerciseCards() {
  const exercises  = state.workout.exercises;
  const currentIdx = state.exerciseIndex;
  const isWarmup   = state.phase === 'warmup';

  DOM.exerciseCards.innerHTML = '';

  exercises.forEach((ex, i) => {
    const card = document.createElement('div');

    let status;
    if (i < currentIdx)      status = 'completed';
    else if (i === currentIdx) status = 'active';
    else                       status = 'upcoming';

    card.className = `ex-card ex-card--${status}`;

    // Exercise name label
    const nameEl = document.createElement('span');
    nameEl.className   = 'ex-card-name';
    nameEl.textContent = ex.name;

    // Dots row
    const dotsEl = document.createElement('div');
    dotsEl.className = 'ex-card-dots';

    let dotCount, filledCount;
    if (status === 'completed') {
      dotCount    = 3;   // completed: 3 salmon filled dots
      filledCount = 3;
    } else if (status === 'active') {
      dotCount    = isWarmup ? 4 : 3;  // phase-specific count
      filledCount = state.setIndex;    // sets already done this exercise
    } else {
      dotCount    = 4;   // upcoming: 4 muted empty dots
      filledCount = 0;
    }

    for (let d = 0; d < dotCount; d++) {
      const dot = document.createElement('span');
      dot.className = 'ex-dot' + (d < filledCount ? ' filled' : '');
      dotsEl.appendChild(dot);
    }

    card.appendChild(nameEl);
    card.appendChild(dotsEl);
    DOM.exerciseCards.appendChild(card);
  });
}

// Immediately fill the dot for the set just tapped (before rest timer)
function fillCurrentDot() {
  const activeCard = DOM.exerciseCards.querySelector('.ex-card--active');
  if (!activeCard) return;
  const dots = activeCard.querySelectorAll('.ex-dot');
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
  clearPersistedState();

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
// Confirm stop (slide-up card)
// ================================================================

function showConfirmStop() {
  DOM.confirmOverlay.classList.add('active');
  void DOM.confirmCard.offsetHeight; // force reflow so transition fires
  DOM.confirmCard.classList.remove('slide-down');
  DOM.confirmCard.classList.add('slide-up');
}

function hideConfirmStop() {
  DOM.confirmCard.classList.remove('slide-up');
  DOM.confirmCard.classList.add('slide-down');
  DOM.confirmOverlay.classList.remove('active');
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
    clearPersistedState();
    window.location.replace('home.html');
    return;
  }

  // Disable buttons while saving
  DOM.skipWarmup.disabled  = true;
  DOM.btnComplete.disabled = true;

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
// Weight adjustment popup
// ================================================================

function getIncrementDisplayLabel() {
  const unit = state.profile?.unit_preference ?? 'lbs';
  const inc  = state.weightIncrement;
  return unit === 'kg' ? (inc / 2) : inc;
}

function renderAdjustDisplay() {
  const unit    = state.profile?.unit_preference ?? 'lbs';
  const rounded = roundToNearest(state.adjustCurrentLbs, 2.5);
  const display = unit === 'kg' ? convertToKg(rounded) : rounded;

  DOM.adjustWeightNum.textContent  = display;
  DOM.adjustWeightUnit.textContent = unit.toUpperCase();

  const changed = Math.abs(state.adjustCurrentLbs - state.adjustOriginalLbs) >= 0.01;
  DOM.btnAdjustSave.classList.toggle('visible', changed);
}

function openAdjustPopup() {
  if (state.phase !== 'working') return;

  const exercise = getCurrentExercise();
  state.adjustOriginalLbs = exercise.workingWeightLbs;
  state.adjustCurrentLbs  = exercise.workingWeightLbs;

  const incLabel = getIncrementDisplayLabel();
  DOM.btnAdjustMinus.textContent = `− ${incLabel}`;
  DOM.btnAdjustPlus.textContent  = `+ ${incLabel}`;
  DOM.adjustInput.value = '';
  DOM.btnAdjustSave.classList.remove('visible');

  renderAdjustDisplay();

  DOM.adjustOverlay.classList.add('active');
  void DOM.adjustCard.offsetHeight;
  DOM.adjustCard.classList.remove('slide-down');
  DOM.adjustCard.classList.add('slide-up');
}

function closeAdjustPopup() {
  DOM.adjustCard.classList.remove('slide-up');
  DOM.adjustCard.classList.add('slide-down');
  DOM.adjustOverlay.classList.remove('active');
}

async function saveAdjustWeight() {
  const newLbs   = roundToNearest(state.adjustCurrentLbs, 2.5);
  const exercise = getCurrentExercise();
  const exKey    = exercise.exercise;

  // Update exercise in state
  exercise.workingWeightLbs = newLbs;
  exercise.warmupSets       = getWarmupSets(newLbs);
  exercise.workingSets      = getWorkingSets(newLbs, exKey);

  closeAdjustPopup();
  renderAll();

  // Persist new starting weight so next session progression is based on this
  supabase.from('starting_weights').insert({
    user_id:    state.user.id,
    exercise:   exKey,
    weight_lbs: newLbs,
    set_at:     new Date().toISOString(),
  });

  // Update already-logged working sets in DB for this exercise/session
  if (state.sessionId) {
    supabase.from('sets')
      .update({ weight_lbs: newLbs })
      .eq('session_id', state.sessionId)
      .eq('exercise', exKey)
      .eq('set_type', 'working');
  }

  persistState();
}

function setupAdjustPopup() {
  DOM.btnAdjustWeight.addEventListener('click', () => {
    if (state.phase === 'working') openAdjustPopup();
  });

  DOM.adjustOverlay.addEventListener('click', closeAdjustPopup);

  DOM.btnAdjustMinus.addEventListener('click', () => {
    const newLbs = Math.max(
      roundToNearest(state.adjustCurrentLbs - state.weightIncrement, 2.5),
      45,
    );
    state.adjustCurrentLbs = newLbs;
    DOM.adjustInput.value  = '';
    renderAdjustDisplay();
  });

  DOM.btnAdjustPlus.addEventListener('click', () => {
    state.adjustCurrentLbs = roundToNearest(
      state.adjustCurrentLbs + state.weightIncrement,
      2.5,
    );
    DOM.adjustInput.value = '';
    renderAdjustDisplay();
  });

  DOM.adjustInput.addEventListener('input', () => {
    const raw = parseFloat(DOM.adjustInput.value);
    if (isNaN(raw) || raw <= 0) return;
    const unit = state.profile?.unit_preference ?? 'lbs';
    const lbs  = unit === 'kg' ? raw / 0.453592 : raw;
    state.adjustCurrentLbs = Math.max(lbs, 45);
    renderAdjustDisplay();
  });

  DOM.adjustInput.addEventListener('blur', () => {
    if (!DOM.adjustInput.value) return;
    const raw = parseFloat(DOM.adjustInput.value);
    if (isNaN(raw) || raw <= 0) { DOM.adjustInput.value = ''; return; }
    const unit    = state.profile?.unit_preference ?? 'lbs';
    const lbs     = unit === 'kg' ? raw / 0.453592 : raw;
    const rounded = Math.max(roundToNearest(lbs, 2.5), 45);
    state.adjustCurrentLbs = rounded;
    DOM.adjustInput.value  = unit === 'kg' ? convertToKg(rounded) : rounded;
    renderAdjustDisplay();
  });

  DOM.btnAdjustSave.addEventListener('click', saveAdjustWeight);
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

  state.profile          = profile;
  state.weightIncrement  = parseFloat(profile?.weight_increment_lbs ?? 5);

  // Restore mid-workout state if the user navigated away and came back
  const saved = loadPersistedState(state.user.id);

  if (saved?.workout) {
    state.exerciseIndex = saved.exerciseIndex;
    state.phase         = saved.phase;
    state.setIndex      = saved.setIndex;
    state.displayMode   = saved.displayMode;
    state.sessionId     = saved.sessionId;
    state.sessionNumber = saved.sessionNumber;
    state.workout       = saved.workout;
  } else {
    // Fresh start — fetch session number and build workout
    const { count } = await supabase
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', state.user.id)
      .not('completed_at', 'is', null);

    state.sessionNumber = (count ?? 0) + 1;
    state.workout       = await getFullWorkout(state.user.id, profile);
  }

  // Initial render
  renderAll();

  // Listeners
  DOM.btnComplete.addEventListener('click', onCompleteSet);
  DOM.skipWarmup.addEventListener('click', () => {
    if (state.phase === 'warmup') onSkipWarmup();
    else showConfirmStop();
  });

  DOM.btnConfirmYes.addEventListener('click', () => {
    hideConfirmStop();
    onDoneForToday();
  });
  DOM.btnConfirmNo.addEventListener('click', hideConfirmStop);
  DOM.confirmOverlay.addEventListener('click', hideConfirmStop);
  DOM.btnDone.addEventListener('click', () => {
    window.location.replace('home.html');
  });
  DOM.timerOverlay.addEventListener('click', skipRest);
  DOM.btnSkipRest.addEventListener('click', skipRest);

  setupModeIcons();
  setupAdjustPopup();
}

init();
