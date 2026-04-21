/* Kennari — settings.js | Session 9
   User preferences: profile, equipment, units, rest timers, logout.
   ------------------------------------------------------------------
   SUPABASE SQL (run once in SQL Editor):
   ALTER TABLE profiles
   ADD COLUMN IF NOT EXISTS weight_increment_lbs numeric default 5;
   ------------------------------------------------------------------ */

import { supabase, signOut } from './supabase.js';
import { requireAuth }       from './app.js';

// ================================================================
// State
// ================================================================

const state = {
  user:            null,
  profile:         null,
  unit:            'lbs',   // 'lbs' | 'kg'
  weightIncrement: 5,       // lbs — loaded from profile
};

// ================================================================
// DOM refs
// ================================================================

const DOM = {
  // Profile
  inputName:       document.getElementById('input-name'),
  inputAge:        document.getElementById('input-age'),
  inputBodyweight: document.getElementById('input-bodyweight'),
  btnSaveProfile:  document.getElementById('btn-save-profile'),
  feedbackProfile: document.getElementById('feedback-profile'),
  // Equipment
  inputBarbell:    document.getElementById('input-barbell'),
  btnSaveEquip:    document.getElementById('btn-save-equipment'),
  feedbackEquip:   document.getElementById('feedback-equipment'),
  // Units
  toggleBtns:      document.querySelectorAll('.toggle-opt'),
  unitLabels:      document.querySelectorAll('.unit-label'),
  // Timers
  inputWarmup:     document.getElementById('input-rest-warmup'),
  inputWorking:    document.getElementById('input-rest-working'),
  btnSaveTimers:   document.getElementById('btn-save-timers'),
  feedbackTimers:  document.getElementById('feedback-timers'),
  // Progression
  incrementBtns:    document.querySelectorAll('.increment-toggle .toggle-opt'),
  incrementKgLabel: document.getElementById('increment-kg-label'),
  // Account
  displayEmail:    document.getElementById('display-email'),
  btnLogout:       document.getElementById('btn-logout'),
};

// ================================================================
// Unit helpers
// ================================================================

function lbsToKg(lbs)  { return Math.round(parseFloat(lbs) * 0.453592 * 100) / 100; }
function kgToLbs(kg)   { return Math.round(parseFloat(kg)  * 2.20462  * 100) / 100; }

// ================================================================
// Dirty tracking — enables save buttons when fields change
// ================================================================

function markDirty(btn) {
  btn.classList.add('dirty');
}

function markClean(btn) {
  btn.classList.remove('dirty', 'loading');
}

// ================================================================
// UI helpers
// ================================================================

function setLoading(btn, on) {
  // Keep dirty class while loading so the spinner stays salmon
  if (on) {
    btn.classList.add('loading');
  } else {
    btn.classList.remove('loading');
  }
}

let feedbackTimers = {};

function showFeedback(el) {
  el.classList.add('visible');
  clearTimeout(feedbackTimers[el.id]);
  feedbackTimers[el.id] = setTimeout(() => el.classList.remove('visible'), 2500);
}

// ================================================================
// Pre-fill from profile
// ================================================================

function updateIncrementKgLabel(incLbs) {
  const kg = Math.round(incLbs * 0.453592 * 10) / 10;
  DOM.incrementKgLabel.textContent = `≈ ${kg} kg per session`;
}

function fillForm() {
  const p    = state.profile;
  const unit = state.unit;

  DOM.inputName.value = p.name ?? '';
  DOM.inputAge.value  = p.age  ?? '';

  // Bodyweight — convert if needed
  const bwLbs = parseFloat(p.bodyweight_lbs ?? 0);
  DOM.inputBodyweight.value = unit === 'kg' ? lbsToKg(bwLbs) : bwLbs || '';

  // Barbell weight — convert if needed
  const bbLbs = parseFloat(p.barbell_weight_lbs ?? 45);
  DOM.inputBarbell.value = unit === 'kg' ? lbsToKg(bbLbs) : bbLbs;

  // Rest timers — always in seconds, no unit conversion
  DOM.inputWarmup.value  = p.rest_warmup_seconds  ?? 90;
  DOM.inputWorking.value = p.rest_working_seconds ?? 180;

  // Weight increment
  const inc = parseFloat(p.weight_increment_lbs ?? 5);
  state.weightIncrement = inc;
  DOM.incrementBtns.forEach(btn =>
    btn.classList.toggle('active', parseFloat(btn.dataset.increment) === inc),
  );
  updateIncrementKgLabel(inc);

  // Unit toggle UI
  applyUnitLabels(unit);
  DOM.toggleBtns.forEach(btn =>
    btn.classList.toggle('active', btn.dataset.unit === unit),
  );
}

function applyUnitLabels(unit) {
  DOM.unitLabels.forEach(el => { el.textContent = unit.toUpperCase(); });
}

// ================================================================
// Save — Profile
// ================================================================

async function saveProfile() {
  if (!DOM.btnSaveProfile.classList.contains('dirty')) return;

  const name  = DOM.inputName.value.trim();
  const age   = parseInt(DOM.inputAge.value, 10);
  const bwRaw = parseFloat(DOM.inputBodyweight.value);

  if (!name || isNaN(age) || isNaN(bwRaw) || bwRaw <= 0) return;

  const bodyweight_lbs = state.unit === 'kg' ? kgToLbs(bwRaw) : bwRaw;

  setLoading(DOM.btnSaveProfile, true);

  const { error } = await supabase
    .from('profiles')
    .update({ name, age, bodyweight_lbs })
    .eq('id', state.user.id);

  setLoading(DOM.btnSaveProfile, false);

  if (!error) {
    state.profile.name           = name;
    state.profile.age            = age;
    state.profile.bodyweight_lbs = bodyweight_lbs;
    markClean(DOM.btnSaveProfile);
    showFeedback(DOM.feedbackProfile);
  }
}

// ================================================================
// Save — Equipment
// ================================================================

async function saveEquipment() {
  if (!DOM.btnSaveEquip.classList.contains('dirty')) return;

  const bbRaw = parseFloat(DOM.inputBarbell.value);
  if (isNaN(bbRaw) || bbRaw <= 0) return;

  const barbell_weight_lbs = state.unit === 'kg' ? kgToLbs(bbRaw) : bbRaw;

  setLoading(DOM.btnSaveEquip, true);

  const { error } = await supabase
    .from('profiles')
    .update({ barbell_weight_lbs })
    .eq('id', state.user.id);

  setLoading(DOM.btnSaveEquip, false);

  if (!error) {
    state.profile.barbell_weight_lbs = barbell_weight_lbs;
    markClean(DOM.btnSaveEquip);
    showFeedback(DOM.feedbackEquip);
  }
}

// ================================================================
// Save — Units
// ================================================================

async function saveUnit(newUnit) {
  if (newUnit === state.unit) return;

  const oldUnit = state.unit;
  state.unit    = newUnit;

  // Update toggle UI immediately
  DOM.toggleBtns.forEach(btn =>
    btn.classList.toggle('active', btn.dataset.unit === newUnit),
  );
  applyUnitLabels(newUnit);

  // Convert displayed values in-place so numbers match the new unit
  const bwLbs = parseFloat(state.profile.bodyweight_lbs ?? 0);
  DOM.inputBodyweight.value = newUnit === 'kg' ? lbsToKg(bwLbs) : (bwLbs || '');

  const bbLbs = parseFloat(state.profile.barbell_weight_lbs ?? 45);
  DOM.inputBarbell.value = newUnit === 'kg' ? lbsToKg(bbLbs) : bbLbs;

  // Persist — fire and forget, no spinner (instant feel)
  await supabase
    .from('profiles')
    .update({ unit_preference: newUnit })
    .eq('id', state.user.id);

  state.profile.unit_preference = newUnit;
}

// ================================================================
// Save — Weight Increment
// ================================================================

async function saveIncrement(newInc) {
  if (newInc === state.weightIncrement) return;
  state.weightIncrement = newInc;

  DOM.incrementBtns.forEach(btn =>
    btn.classList.toggle('active', parseFloat(btn.dataset.increment) === newInc),
  );
  updateIncrementKgLabel(newInc);

  await supabase
    .from('profiles')
    .update({ weight_increment_lbs: newInc })
    .eq('id', state.user.id);

  state.profile.weight_increment_lbs = newInc;
}

// ================================================================
// Save — Rest Timers
// ================================================================

async function saveTimers() {
  if (!DOM.btnSaveTimers.classList.contains('dirty')) return;

  const warmup  = parseInt(DOM.inputWarmup.value,  10);
  const working = parseInt(DOM.inputWorking.value, 10);

  if (isNaN(warmup) || warmup < 10 || isNaN(working) || working < 10) return;

  setLoading(DOM.btnSaveTimers, true);

  const { error } = await supabase
    .from('profiles')
    .update({ rest_warmup_seconds: warmup, rest_working_seconds: working })
    .eq('id', state.user.id);

  setLoading(DOM.btnSaveTimers, false);

  if (!error) {
    state.profile.rest_warmup_seconds  = warmup;
    state.profile.rest_working_seconds = working;
    markClean(DOM.btnSaveTimers);
    showFeedback(DOM.feedbackTimers);
  }
}

// ================================================================
// Logout
// ================================================================

async function handleLogout() {
  DOM.btnLogout.disabled    = true;
  DOM.btnLogout.textContent = 'Logging out…';

  await signOut();
  window.location.replace('index.html');
}

// ================================================================
// Event listeners
// ================================================================

function setupListeners() {
  DOM.btnSaveProfile.addEventListener('click', saveProfile);
  DOM.btnSaveEquip.addEventListener('click', saveEquipment);
  DOM.btnSaveTimers.addEventListener('click', saveTimers);
  DOM.btnLogout.addEventListener('click', handleLogout);

  DOM.toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => saveUnit(btn.dataset.unit));
  });

  DOM.incrementBtns.forEach(btn => {
    btn.addEventListener('click', () => saveIncrement(parseFloat(btn.dataset.increment)));
  });

  // Mark sections dirty when any field changes
  [DOM.inputName, DOM.inputAge, DOM.inputBodyweight].forEach(el =>
    el.addEventListener('input', () => markDirty(DOM.btnSaveProfile)),
  );
  DOM.inputBarbell.addEventListener('input', () => markDirty(DOM.btnSaveEquip));
  [DOM.inputWarmup, DOM.inputWorking].forEach(el =>
    el.addEventListener('input', () => markDirty(DOM.btnSaveTimers)),
  );

  // Enter key submits the relevant section
  [DOM.inputName, DOM.inputAge, DOM.inputBodyweight].forEach(el =>
    el.addEventListener('keydown', e => { if (e.key === 'Enter') saveProfile(); }),
  );
  DOM.inputBarbell.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveEquipment();
  });
  [DOM.inputWarmup, DOM.inputWorking].forEach(el =>
    el.addEventListener('keydown', e => { if (e.key === 'Enter') saveTimers(); }),
  );
}

// ================================================================
// Init
// ================================================================

async function init() {
  state.user = await requireAuth();
  if (!state.user) return;

  // Load profile + email in parallel
  const [profileRes, userRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('*')
      .eq('id', state.user.id)
      .maybeSingle(),
    supabase.auth.getUser(),
  ]);

  state.profile = profileRes.data ?? {};
  state.unit    = state.profile.unit_preference ?? 'lbs';

  // Show email
  const email = userRes.data?.user?.email ?? state.user.email ?? '—';
  DOM.displayEmail.textContent = email;

  fillForm();
  setupListeners();
}

init();
