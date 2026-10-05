/* Kennari — workout531.js
   5/3/1 workout screen. One lift per workout, served by program531.js.
   Separate from workout.js (Lite Viking); shares only styling (workout.css)
   and the pure helpers in program.js.

   Rules (docs/PRD-531.md):
   - Warmups are never saved. Only working sets are written.
   - A workout counts only when its LAST working set is completed.
     Early exit does NOT stamp completed_at; the same workout is served again.
   - Test day: the test set's reps become the training max (training_maxes).
   ------------------------------------------------ */

import { supabase }    from './supabase.js';
import { requireAuth } from './app.js';
import {
  getDisplayWeight,
  roundToNearest,
  convertToKg,
  EXERCISE_LABELS,
} from './program.js';
import {
  get531Workout,
  getTestSets,
  save531Test,
  isWorkoutComplete,
} from './program531.js';

// Mirrors the warmup percentages in program531.js (index 0-2)
const WARMUP_PERCENTAGES = [40, 50, 60];

const STORAGE_KEY = 'kennari_workout_531';

const TEST_STEP_LBS = 5;    // test weight +/- step
const MIN_REPS      = 1;
const MAX_REPS      = 50;

// ================================================================
// State
// ================================================================

const state = {
  user:             null,
  profile:          null,
  workout:          null,      // get531Workout() result
  sessionId:        null,      // created on first completed working set
  sessionNumber:    null,
  phase:            'warmup',  // 'testweight' | 'warmup' | 'working'
  setIndex:         0,
  displayMode:      'total',
  testWeightLbs:    null,      // chosen test weight
  testSaved:        false,     // training_maxes row written
  testTmLbs:        null,      // resulting training max (for the summary)
  completedWorking: [],        // working set numbers already saved
  restInterval:     null,
  restOnComplete:   null,
  testCurrentLbs:   null,      // in-progress value in the test weight card
  repsCurrent:      5,         // in-progress value in the reps card
  busy:             false,
};

// ================================================================
// Persistence — resume if the user navigates away mid-workout
// ================================================================

function persistState() {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
    userId:           state.user?.id,
    phase:            state.phase,
    setIndex:         state.setIndex,
    displayMode:      state.displayMode,
    sessionId:        state.sessionId,
    sessionNumber:    state.sessionNumber,
    workout:          state.workout,
    testWeightLbs:    state.testWeightLbs,
    testSaved:        state.testSaved,
    testTmLbs:        state.testTmLbs,
    completedWorking: state.completedWorking,
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
    if (saved.userId !== userId) return null;
    return saved;
  } catch {
    return null;
  }
}

// ================================================================
// DOM refs
// ================================================================

const DOM = {
  screen:         document.getElementById('workout-screen'),
  phasePill:      document.getElementById('phase-pill'),
  skipWarmup:     document.getElementById('btn-skip-warmup'),
  exName:         document.getElementById('exercise-name'),
  sessionLabel:   document.getElementById('session-label'),
  weightNumber:   document.getElementById('weight-number'),
  weightUnit:     document.getElementById('weight-unit'),
  repsLabel:      document.getElementById('reps-label'),
  setLabel:       document.getElementById('set-label'),
  exerciseCards:  document.getElementById('exercise-cards'),
  btnComplete:    document.getElementById('btn-complete'),
  completion:     document.getElementById('completion-overlay'),
  completionSub:  document.getElementById('completion-sub'),
  btnDone:        document.getElementById('btn-done'),
  confirmOverlay: document.getElementById('confirm-overlay'),
  confirmCard:    document.getElementById('confirm-card'),
  btnConfirmYes:  document.getElementById('btn-confirm-yes'),
  btnConfirmNo:   document.getElementById('btn-confirm-no'),
  timerOverlay:   document.getElementById('timer-overlay'),
  timerCard:      document.getElementById('timer-card'),
  timerNumber:    document.getElementById('timer-number'),
  timerRing:      document.getElementById('timer-ring'),
  btnSkipRest:    document.getElementById('btn-skip-rest'),
  // Test weight card
  testOverlay:    document.getElementById('testweight-overlay'),
  testCard:       document.getElementById('testweight-card'),
  testNumber:     document.getElementById('testweight-number'),
  testUnit:       document.getElementById('testweight-unit'),
  btnTestMinus:   document.getElementById('btn-testweight-minus'),
  btnTestPlus:    document.getElementById('btn-testweight-plus'),
  testInput:      document.getElementById('testweight-input'),
  btnTestStart:   document.getElementById('btn-testweight-start'),
  btnTestCancel:  document.getElementById('btn-testweight-cancel'),
  // Reps card
  repsOverlay:    document.getElementById('reps-overlay'),
  repsCard:       document.getElementById('reps-card'),
  repsNumber:     document.getElementById('reps-number'),
  btnRepsMinus:   document.getElementById('btn-reps-minus'),
  btnRepsPlus:    document.getElementById('btn-reps-plus'),
  btnRepsConfirm: document.getElementById('btn-reps-confirm'),
  toast:          document.getElementById('toast'),
};

// ================================================================
// Helpers
// ================================================================

function getUnit() {
  return state.profile?.unit_preference ?? 'lbs';
}

function getCurrentSets() {
  return state.phase === 'working'
    ? state.workout.workingSets
    : state.workout.warmupSets;
}

function getRestDuration(nextType) {
  const warmupRest  = state.profile?.rest_warmup_seconds  ?? 90;
  const workingRest = state.profile?.rest_working_seconds ?? 180;

  switch (nextType) {
    case 'next-warmup-set':   return warmupRest;
    case 'start-working':     return warmupRest;
    case 'next-working-set':  return workingRest;
    case 'workout-complete':  return 0;
    default:                  return 0;
  }
}

// What happens after the current set is completed?
function computeNextType() {
  const sets      = getCurrentSets();
  const isLastSet = state.setIndex >= sets.length - 1;

  if (state.phase === 'warmup') {
    return isLastSet ? 'start-working' : 'next-warmup-set';
  }
  return isLastSet ? 'workout-complete' : 'next-working-set';
}

let toastTimer = null;
function showToast(msg) {
  DOM.toast.textContent = msg;
  DOM.toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => DOM.toast.classList.remove('visible'), 3500);
}

function displayWeightValue(lbs) {
  const rounded = roundToNearest(lbs, 2.5);
  return getUnit() === 'kg' ? convertToKg(rounded) : rounded;
}

// ================================================================
// Render
// ================================================================

function renderAll() {
  const w          = state.workout;
  const inTestCard = state.phase === 'testweight';
  const isWorking  = state.phase === 'working';

  // Phase class on root (drives all CSS color switches)
  DOM.screen.className =
    `app-container workout-screen phase-${isWorking ? 'working' : 'warmup'}`;

  DOM.phasePill.className   = isWorking ? 'pill-working' : 'pill-warmup';
  DOM.phasePill.textContent = isWorking ? 'WORKOUT' : 'WARM UP';

  DOM.skipWarmup.textContent    = isWorking ? "I'm done for today" : 'Skip warm up';
  DOM.skipWarmup.style.visibility = inTestCard ? 'hidden' : '';
  DOM.btnComplete.disabled      = inTestCard;

  DOM.exName.textContent       = EXERCISE_LABELS[w.lift] ?? w.lift;
  DOM.sessionLabel.textContent = w.label;

  if (inTestCard) {
    DOM.weightNumber.textContent = '—';
    DOM.weightUnit.textContent   = getUnit().toUpperCase();
    DOM.repsLabel.textContent    = '—';
    DOM.setLabel.textContent     = '';
    renderCard();
    persistState();
    return;
  }

  const sets       = getCurrentSets();
  const currentSet = sets[state.setIndex];

  renderWeight(currentSet.weightLbs);

  // Reps line: "5 REPS" or "5+ REPS" on the AMRAP set
  DOM.repsLabel.textContent = `${currentSet.reps}${currentSet.amrap ? '+' : ''} REPS`;

  // Set line: "SET 2 / 3 · 50%" (warmup) or "SET 2 / 3" (working)
  const pctSuffix = isWorking
    ? ''
    : ` · ${WARMUP_PERCENTAGES[state.setIndex] ?? ''}%`;
  DOM.setLabel.textContent =
    `SET ${state.setIndex + 1} / ${sets.length}${pctSuffix}`;

  renderCard();

  // Persist position so navigating away and back restores the workout
  persistState();
}

function renderWeight(weightLbs) {
  const barbellWeight = state.profile?.barbell_weight_lbs ?? 45;

  const { value, unit: displayUnit } = getDisplayWeight(
    weightLbs,
    state.displayMode,
    barbellWeight,
    getUnit(),
  );

  DOM.weightNumber.textContent = value;
  DOM.weightUnit.textContent   = displayUnit.toUpperCase();
}

// One card for the lift, with a dot per set of the current phase
function renderCard() {
  const w = state.workout;
  DOM.exerciseCards.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'ex-card ex-card--active';

  const nameEl = document.createElement('span');
  nameEl.className   = 'ex-card-name';
  nameEl.textContent = EXERCISE_LABELS[w.lift] ?? w.lift;

  const dotsEl = document.createElement('div');
  dotsEl.className = 'ex-card-dots';

  let dotCount, filledCount;
  if (state.phase === 'working') {
    dotCount    = w.workingSets.length;
    filledCount = state.setIndex;
  } else if (state.phase === 'warmup') {
    dotCount    = w.warmupSets.length;
    filledCount = state.setIndex;
  } else {
    dotCount    = 3;   // test weight not chosen yet: show the 3 warmup dots
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
}

// Immediately fill the dot for the set just completed
function fillCurrentDot() {
  const dots = DOM.exerciseCards.querySelectorAll('.ex-dot');
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

  DOM.timerOverlay.classList.add('active');
  void DOM.timerCard.offsetHeight;
  DOM.timerCard.classList.remove('slide-down');
  DOM.timerCard.classList.add('slide-up');

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

// Tear down a running rest timer without advancing
function cancelRest() {
  if (!state.restInterval) return;
  clearInterval(state.restInterval);
  state.restInterval   = null;
  state.restOnComplete = null;
  DOM.timerCard.classList.remove('slide-up');
  DOM.timerCard.classList.add('slide-down');
  DOM.timerOverlay.classList.remove('active');
  DOM.btnComplete.style.visibility = '';
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
  }

  renderAll();
}

// ================================================================
// Supabase — session & working-set persistence
// Warmups are never saved.
// ================================================================

async function ensureSession() {
  if (state.sessionId) return true;

  const { data, error } = await supabase
    .from('sessions')
    .insert({
      user_id:        state.user.id,
      session_number: state.sessionNumber,
      workout_day:    state.workout.lift,
      program:        '531',
      is_test:        state.workout.kind === 'test',
      completed_at:   null,
    })
    .select('id')
    .single();

  if (error || !data) return false;
  state.sessionId = data.id;
  return true;
}

// Returns true when the set is saved (or was already saved on an earlier try)
async function saveWorkingSet(set, repsCompleted) {
  if (state.completedWorking.includes(set.setNumber)) return true;
  if (!(await ensureSession())) return false;

  const { error } = await supabase.from('sets').insert({
    session_id:     state.sessionId,
    exercise:       state.workout.lift,
    set_type:       'working',
    set_number:     set.setNumber,
    reps_target:    set.reps,
    reps_completed: repsCompleted,
    weight_lbs:     set.weightLbs,
    completed:      true,
  });

  if (error) return false;

  state.completedWorking.push(set.setNumber);
  persistState();
  return true;
}

// Completion rule: stamp completed_at only when the last working set is done
async function finishWorkout() {
  if (!isWorkoutComplete(state.workout, state.completedWorking)) return false;
  if (!state.sessionId) return false;

  const { error } = await supabase
    .from('sessions')
    .update({ completed_at: new Date().toISOString() })
    .eq('id', state.sessionId);

  if (error) return false;

  clearPersistedState();
  showCompletion();
  return true;
}

// ================================================================
// Completion screen
// ================================================================

function showCompletion() {
  const w = state.workout;
  const unit = getUnit().toUpperCase();

  if (w.kind === 'test' && state.testTmLbs != null) {
    // Non-breaking space keeps the number and its unit on the same line
    DOM.completionSub.textContent =
      `${EXERCISE_LABELS[w.lift] ?? w.lift} test done. ` +
      `Your training max is ${displayWeightValue(state.testTmLbs)} ${unit}.`;
  } else {
    DOM.completionSub.textContent =
      `${EXERCISE_LABELS[w.lift] ?? w.lift}, week ${w.week} done.`;
  }
  DOM.completion.hidden = false;
}

// ================================================================
// Complete Set handler
// ================================================================

// Saves a working set, then rests or finishes. Returns true on success.
async function completeWorkingSet(set, reps) {
  state.busy = true;
  DOM.btnComplete.disabled = true;

  try {
    const saved = await saveWorkingSet(set, reps);
    if (!saved) {
      showToast("Couldn't save that set. Check your connection and try again.");
      return false;
    }

    fillCurrentDot();

    const nextType = computeNextType();
    if (nextType === 'workout-complete') {
      const finished = await finishWorkout();
      if (!finished) {
        showToast("Couldn't finish the workout. Try again.");
      }
      return finished;
    }

    showTimer(getRestDuration(nextType), () => applyNextState(nextType));
    return true;
  } finally {
    state.busy = false;
    DOM.btnComplete.disabled = false;
  }
}

async function onCompleteSet() {
  if (state.busy || state.phase === 'testweight') return;

  // Pulse animation
  DOM.btnComplete.classList.add('pulsing');
  DOM.btnComplete.addEventListener(
    'animationend',
    () => DOM.btnComplete.classList.remove('pulsing'),
    { once: true },
  );

  const sets       = getCurrentSets();
  const currentSet = sets[state.setIndex];

  // Warmup: nothing is saved, just move on
  if (state.phase === 'warmup') {
    fillCurrentDot();
    const nextType = computeNextType();
    showTimer(getRestDuration(nextType), () => applyNextState(nextType));
    return;
  }

  // AMRAP set: ask how many reps first
  if (currentSet.amrap) {
    openRepsCard(currentSet);
    return;
  }

  await completeWorkingSet(currentSet, currentSet.reps);
}

// ================================================================
// Reps card (last working set)
// ================================================================

function renderReps() {
  DOM.repsNumber.textContent = state.repsCurrent;
}

function openRepsCard(set) {
  state.repsCurrent = set.reps;
  renderReps();

  DOM.repsOverlay.classList.add('active');
  void DOM.repsCard.offsetHeight;
  DOM.repsCard.classList.remove('slide-down');
  DOM.repsCard.classList.add('slide-up');
}

function closeRepsCard() {
  DOM.repsCard.classList.remove('slide-up');
  DOM.repsCard.classList.add('slide-down');
  DOM.repsOverlay.classList.remove('active');
}

async function confirmReps() {
  if (state.busy) return;

  const set  = getCurrentSets()[state.setIndex];
  const reps = state.repsCurrent;
  const w    = state.workout;

  DOM.btnRepsConfirm.disabled = true;

  // Test day: write the training max first (once), then the set
  if (w.kind === 'test' && !state.testSaved) {
    try {
      const res = await save531Test(state.user.id, w.lift, state.testWeightLbs, reps);
      state.testSaved = true;
      state.testTmLbs = res.trainingMaxLbs;
      persistState();
    } catch (err) {
      console.error('Could not save test result', err);
      showToast("Couldn't save your test. Try again.");
      DOM.btnRepsConfirm.disabled = false;
      return;
    }
  }

  const ok = await completeWorkingSet(set, reps);
  DOM.btnRepsConfirm.disabled = false;
  if (ok) closeRepsCard();
}

function setupRepsCard() {
  DOM.btnRepsMinus.addEventListener('click', () => {
    state.repsCurrent = Math.max(MIN_REPS, state.repsCurrent - 1);
    renderReps();
  });
  DOM.btnRepsPlus.addEventListener('click', () => {
    state.repsCurrent = Math.min(MAX_REPS, state.repsCurrent + 1);
    renderReps();
  });
  DOM.btnRepsConfirm.addEventListener('click', confirmReps);
  // Tapping outside cancels: the set is not completed
  DOM.repsOverlay.addEventListener('click', () => {
    if (!state.busy) closeRepsCard();
  });
}

// ================================================================
// Test weight card (test days, before the warmup)
// ================================================================

function getMinTestLbs() {
  return parseFloat(state.profile?.barbell_weight_lbs ?? 45);
}

function renderTestDisplay() {
  DOM.testUnit.textContent   = getUnit().toUpperCase();
  DOM.testNumber.textContent = displayWeightValue(state.testCurrentLbs);
}

function openTestCard() {
  const stepLabel = getUnit() === 'kg' ? TEST_STEP_LBS / 2 : TEST_STEP_LBS;
  DOM.btnTestMinus.textContent = `− ${stepLabel}`;
  DOM.btnTestPlus.textContent  = `+ ${stepLabel}`;
  DOM.testInput.value = '';
  // Start from the minimum (the empty bar) so there is always a number
  state.testCurrentLbs = getMinTestLbs();
  renderTestDisplay();

  DOM.testOverlay.classList.add('active');
  void DOM.testCard.offsetHeight;
  DOM.testCard.classList.remove('slide-down');
  DOM.testCard.classList.add('slide-up');
}

function closeTestCard() {
  DOM.testCard.classList.remove('slide-up');
  DOM.testCard.classList.add('slide-down');
  DOM.testOverlay.classList.remove('active');
}

function startTestWorkout() {
  const lbs  = roundToNearest(state.testCurrentLbs, 2.5);
  const sets = getTestSets(lbs);

  state.testWeightLbs         = lbs;
  state.workout.warmupSets    = sets.warmupSets;
  state.workout.workingSets   = sets.workingSets;
  state.phase                 = 'warmup';
  state.setIndex              = 0;

  closeTestCard();
  renderAll();
}

function setupTestCard() {
  DOM.btnTestMinus.addEventListener('click', () => {
    state.testCurrentLbs = Math.max(
      roundToNearest(state.testCurrentLbs - TEST_STEP_LBS, 2.5),
      getMinTestLbs(),
    );
    DOM.testInput.value = '';
    renderTestDisplay();
  });

  DOM.btnTestPlus.addEventListener('click', () => {
    state.testCurrentLbs = roundToNearest(state.testCurrentLbs + TEST_STEP_LBS, 2.5);
    DOM.testInput.value = '';
    renderTestDisplay();
  });

  DOM.testInput.addEventListener('input', () => {
    const raw = parseFloat(DOM.testInput.value);
    if (isNaN(raw) || raw <= 0) return;
    const lbs = getUnit() === 'kg' ? raw / 0.453592 : raw;
    state.testCurrentLbs = Math.max(lbs, getMinTestLbs());
    renderTestDisplay();
  });

  DOM.testInput.addEventListener('blur', () => {
    if (!DOM.testInput.value) return;
    const raw = parseFloat(DOM.testInput.value);
    if (isNaN(raw) || raw <= 0) { DOM.testInput.value = ''; return; }
    const lbs     = getUnit() === 'kg' ? raw / 0.453592 : raw;
    const rounded = Math.max(roundToNearest(lbs, 2.5), getMinTestLbs());
    state.testCurrentLbs = rounded;
    DOM.testInput.value  = displayWeightValue(rounded);
    renderTestDisplay();
  });

  DOM.btnTestStart.addEventListener('click', startTestWorkout);
  DOM.btnTestCancel.addEventListener('click', () => {
    clearPersistedState();
    window.location.replace('home.html');
  });
  // The weight is required, so tapping outside does not dismiss this card
}

// ================================================================
// Confirm stop (slide-up card)
// ================================================================

function showConfirmStop() {
  DOM.confirmOverlay.classList.add('active');
  void DOM.confirmCard.offsetHeight;
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
// Does NOT stamp completed_at: the workout does not count, and the same
// one is served next time. Any sets already saved stay on an incomplete
// session, which the engine ignores.
// ================================================================

function onDoneForToday() {
  cancelRest();
  clearPersistedState();
  window.location.replace('home.html');
}

// ================================================================
// Skip warmup
// ================================================================

function onSkipWarmup() {
  cancelRest();
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

      if (state.phase === 'testweight') return;
      const currentSet = getCurrentSets()[state.setIndex];
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

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', state.user.id)
    .maybeSingle();

  // Lite Viking users belong on the other workout screen
  if ((profile?.active_program ?? 'lite_viking') !== '531') {
    window.location.replace('workout.html');
    return;
  }

  state.profile = profile;

  const saved = loadPersistedState(state.user.id);

  if (saved?.workout) {
    state.phase            = saved.phase;
    state.setIndex         = saved.setIndex;
    state.displayMode      = saved.displayMode;
    state.sessionId        = saved.sessionId;
    state.sessionNumber    = saved.sessionNumber;
    state.workout          = saved.workout;
    state.testWeightLbs    = saved.testWeightLbs;
    state.testSaved        = saved.testSaved ?? false;
    state.testTmLbs        = saved.testTmLbs ?? null;
    state.completedWorking = saved.completedWorking ?? [];
  } else {
    // Fresh start — session number = completed 5/3/1 sessions + 1
    const { count } = await supabase
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', state.user.id)
      .eq('program', '531')
      .not('completed_at', 'is', null);

    state.sessionNumber = (count ?? 0) + 1;

    try {
      state.workout = await get531Workout(state.user.id);
    } catch (err) {
      console.error('Could not load 5/3/1 workout', err);
      DOM.exName.textContent       = "Couldn't load your workout";
      DOM.sessionLabel.textContent = 'Check your connection and reload';
      DOM.btnComplete.disabled     = true;
      return;
    }

    state.phase = state.workout.needsTestWeight ? 'testweight' : 'warmup';
  }

  renderAll();

  // Listeners
  DOM.btnComplete.addEventListener('click', onCompleteSet);
  DOM.skipWarmup.addEventListener('click', () => {
    if (state.phase === 'warmup') onSkipWarmup();
    else if (state.phase === 'working') showConfirmStop();
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
  setupTestCard();
  setupRepsCard();

  if (state.phase === 'testweight') openTestCard();
}

init();
