/* Kennari — onboarding.js
   4-step onboarding:
     1. Name & age
     2. Bodyweight & barbell weight
     3. Starting weights (optional — falls back to barbell weight)
     4. Goals preview + save
   ----------------------------------------------------------------- */

import { supabase, getUser } from './supabase.js';

// ================================================================
// State
// ================================================================

let currentUser = null;
let currentUnit = 'lbs';
let currentStep = 1;

// ================================================================
// Init — auth guard + skip if already onboarded
// ================================================================

async function init() {
  currentUser = await getUser();
  if (!currentUser) {
    window.location.replace('index.html');
    return;
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', currentUser.id)
    .maybeSingle();

  if (profile) {
    window.location.replace('workout.html');
    return;
  }

  // Pre-fill barbell default
  document.getElementById('barbell-weight').value = 45;

  setupListeners();
}

// ================================================================
// Step navigation
// ================================================================

const stepEls = document.querySelectorAll('.ob-step');
const dotEls  = document.querySelectorAll('.pdot');

function goToStep(n) {
  stepEls.forEach((s, i) => s.classList.toggle('active', i === n - 1));
  dotEls.forEach((d, i)  => d.classList.toggle('active', i < n));
  currentStep = n;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (n === 4) renderGoals();
}

// ================================================================
// Unit conversion helpers
// ================================================================

function lbsToKg(lbs) {
  return Math.round(parseFloat(lbs) * 0.453592 * 4) / 4;
}

function kgToLbs(kg) {
  return Math.round(parseFloat(kg) * 2.20462 * 4) / 4;
}

function roundTo5(lbs) {
  return Math.round(lbs / 5) * 5;
}

// Returns the input's value in lbs, or null if empty/invalid
function getWeightInLbs(id) {
  const val = parseFloat(document.getElementById(id)?.value ?? '');
  if (isNaN(val) || val <= 0) return null;
  return currentUnit === 'kg' ? kgToLbs(val) : val;
}

// ================================================================
// Unit toggle
// ================================================================

function setupUnitToggle() {
  const toggleBtns   = document.querySelectorAll('.toggle-opt');
  const unitLabels   = document.querySelectorAll('[data-unit-label]');
  const weightInputs = document.querySelectorAll('[data-weight-input]');

  toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const newUnit = btn.dataset.unit;
      if (newUnit === currentUnit) return;

      const oldUnit = currentUnit;

      // Convert every weight input that has a value
      weightInputs.forEach(input => {
        const val = parseFloat(input.value);
        if (!isNaN(val) && val > 0) {
          input.value = oldUnit === 'lbs' ? lbsToKg(val) : kgToLbs(val);
        }
      });

      // Commit new unit AFTER conversion so getWeightInLbs() is still correct during convert
      currentUnit = newUnit;

      toggleBtns.forEach(b => b.classList.toggle('active', b.dataset.unit === newUnit));
      unitLabels.forEach(label => { label.textContent = newUnit.toUpperCase(); });

      if (currentStep === 4) renderGoals();
    });
  });
}

// ================================================================
// Dynamic heading — updates as user types their name
// ================================================================

function setupDynamicHeading() {
  const nameInput = document.getElementById('name');
  const heading   = document.getElementById('step1-heading');

  nameInput.addEventListener('input', () => {
    const name = nameInput.value.trim();
    heading.textContent = name
      ? `Let's get you set up, ${name}.`
      : "Let's get you set up.";
  });
}

// ================================================================
// SKIP / NEXT button on step 3
// Changes label to "Next" only when every exercise field is filled
// ================================================================

function setupSkipNext() {
  const exInputs = ['weight-squat', 'weight-press', 'weight-bench', 'weight-deadlift']
    .map(id => document.getElementById(id));
  const btn      = document.getElementById('btn-advance-3');
  const label    = btn.querySelector('.btn-label');

  function updateLabel() {
    const anyFilled = exInputs.some(input => {
      const val = parseFloat(input.value);
      return !isNaN(val) && val > 0;
    });
    label.textContent = anyFilled ? 'Next' : 'Skip';
  }

  exInputs.forEach(input => input.addEventListener('input', updateLabel));
  updateLabel(); // set initial state
}

// ================================================================
// Goal preview — step 4
// ================================================================

const GOAL_MULTIPLIERS = {
  squat:    1.25,
  press:    0.75,
  bench:    1.00,
  deadlift: 1.50,
};

function renderGoals() {
  const bodyweightLbs = getWeightInLbs('bodyweight');

  Object.entries(GOAL_MULTIPLIERS).forEach(([ex, mult]) => {
    const el = document.getElementById(`goal-${ex}`);
    if (!el) return;

    if (!bodyweightLbs) {
      el.textContent = '—';
      return;
    }

    const goalLbs = roundTo5(bodyweightLbs * mult);
    el.textContent = currentUnit === 'kg'
      ? `${lbsToKg(goalLbs)} kg`
      : `${goalLbs} lbs`;
  });
}

// ================================================================
// Validation
// ================================================================

function showError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.classList.add('visible');
}

function clearError(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = '';
  el.classList.remove('visible');
}

function getVal(id) {
  return (document.getElementById(id)?.value ?? '').trim();
}

function getNum(id) {
  return parseFloat(document.getElementById(id)?.value ?? '');
}

function isValidNum(n) {
  return !isNaN(n) && n > 0;
}

function validateStep1() {
  clearError('error-1');
  const name = getVal('name');
  const age  = getNum('age');

  if (!name) {
    showError('error-1', 'Please enter your first name.');
    document.getElementById('name').focus();
    return false;
  }
  if (!isValidNum(age) || age < 13 || age > 120) {
    showError('error-1', 'Please enter a valid age (13–120).');
    document.getElementById('age').focus();
    return false;
  }
  return true;
}

function validateStep2() {
  clearError('error-2');
  const unit = currentUnit.toUpperCase();

  if (!isValidNum(getNum('bodyweight'))) {
    showError('error-2', `Please enter your bodyweight in ${unit}.`);
    document.getElementById('bodyweight').focus();
    return false;
  }
  if (!isValidNum(getNum('barbell-weight'))) {
    showError('error-2', `Please enter your barbell weight in ${unit}.`);
    document.getElementById('barbell-weight').focus();
    return false;
  }
  return true;
}

// ================================================================
// Save to Supabase + redirect
// Empty exercise weights fall back to the barbell weight
// ================================================================

async function saveAndRedirect() {
  const btnStart = document.getElementById('btn-start');
  btnStart.disabled = true;
  btnStart.classList.add('loading');
  clearError('error-4');

  const bodyweightLbs    = getWeightInLbs('bodyweight');
  const barbellWeightLbs = getWeightInLbs('barbell-weight');

  // 1 — profiles
  const { error: profileError } = await supabase
    .from('profiles')
    .insert({
      id:                 currentUser.id,
      name:               getVal('name'),
      age:                parseInt(getVal('age')),
      bodyweight_lbs:     bodyweightLbs,
      unit_preference:    currentUnit,
      barbell_weight_lbs: barbellWeightLbs,
      session_count:      0,
    });

  if (profileError) {
    showError('error-4', 'Could not save your profile. Please try again.');
    btnStart.disabled = false;
    btnStart.classList.remove('loading');
    return;
  }

  // 2 — starting_weights
  // Use entered value if provided; fall back to barbell weight for any empty field
  const weightRows = Object.keys(GOAL_MULTIPLIERS).map(ex => ({
    user_id:    currentUser.id,
    exercise:   ex,
    weight_lbs: getWeightInLbs(`weight-${ex}`) ?? barbellWeightLbs,
  }));

  const { error: weightsError } = await supabase
    .from('starting_weights')
    .insert(weightRows);

  if (weightsError) {
    showError('error-4', 'Could not save your starting weights. Please try again.');
    btnStart.disabled = false;
    btnStart.classList.remove('loading');
    return;
  }

  // 3 — goals
  const goalRows = Object.entries(GOAL_MULTIPLIERS).map(([ex, mult]) => ({
    user_id:           currentUser.id,
    exercise:          ex,
    target_weight_lbs: roundTo5(bodyweightLbs * mult),
  }));

  const { error: goalsError } = await supabase
    .from('goals')
    .insert(goalRows);

  if (goalsError) {
    showError('error-4', 'Could not save your goals. Please try again.');
    btnStart.disabled = false;
    btnStart.classList.remove('loading');
    return;
  }

  window.location.replace('home.html');
}

// ================================================================
// Event listeners
// ================================================================

function setupListeners() {
  setupDynamicHeading();
  setupUnitToggle();
  setupSkipNext();

  // Step 1
  document.getElementById('btn-next-1').addEventListener('click', () => {
    if (validateStep1()) goToStep(2);
  });

  // Step 2
  document.getElementById('btn-back-2').addEventListener('click', () => goToStep(1));
  document.getElementById('btn-next-2').addEventListener('click', () => {
    if (validateStep2()) goToStep(3);
  });

  // Step 3 — no validation, always advances (skip or next)
  document.getElementById('btn-back-3').addEventListener('click', () => goToStep(2));
  document.getElementById('btn-advance-3').addEventListener('click', () => goToStep(4));

  // Step 4
  document.getElementById('btn-back-4').addEventListener('click', () => goToStep(3));
  document.getElementById('btn-start').addEventListener('click', saveAndRedirect);

  // Enter key shortcuts
  document.getElementById('name').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('age').focus();
  });
  document.getElementById('age').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-next-1').click();
  });
}

// ================================================================
// Run
// ================================================================

init();
