/* Kennari — home.js | Session 10
   Dashboard: greeting, next workout preview, tip.
   ------------------------------------------------ */

import { supabase }            from './supabase.js';
import { requireAuth }         from './app.js';
import { getNextWorkoutDay, EXERCISE_LABELS } from './program.js';

// ================================================================
// Local program constants
// (DAY_EXERCISES and WORKING_SET_COUNT are not exported from program.js)
// ================================================================

const DAY_EXERCISES = {
  A: ['squat', 'press',    'deadlift'],
  B: ['squat', 'bench',    'deadlift'],
};

const WORKING_SET_COUNT = {
  squat:    3,
  press:    3,
  bench:    3,
  deadlift: 1,
};

// ================================================================
// Tips
// ================================================================

const TIPS = [
  "Focus on form, not weight. The bar alone is a great start.",
  "Breathe out on the way up. It makes a real difference.",
  "Sore the next day? That's normal. Keep showing up.",
  "Sleep is when you get stronger. 7–8 hours matters.",
  "You don't need to feel motivated. You just need to show up.",
  "The weight will get hard eventually. That's the point.",
  "Consistency beats intensity every single time.",
  "Missing one session is fine. Missing three is a habit.",
  "The hardest part is always walking through the door.",
  "Progress is slow and then suddenly it isn't.",
];

// ================================================================
// State
// ================================================================

const state = {
  user:        null,
  profile:     null,
  lastSession: null,   // { completed_at, session_number } | null
  nextDay:     'A',
};

// ================================================================
// DOM refs
// ================================================================

const DOM = {
  greetingText:  document.getElementById('greeting-text'),
  lastWorkout:   document.getElementById('last-workout'),
  trainingDay:   document.getElementById('training-day'),
  exerciseList:  document.getElementById('exercise-list'),
  btnStart:      document.getElementById('btn-start'),
  tipText:       document.getElementById('tip-text'),
};

// ================================================================
// Date helpers
// ================================================================

// Returns the number of calendar days between dateStr and today
// (in the user's local timezone, ignoring time-of-day)
function daysSince(dateStr) {
  const then    = new Date(dateStr);
  const now     = new Date();
  const thenDay = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const nowDay  = new Date(now.getFullYear(),  now.getMonth(),  now.getDate());
  return Math.round((nowDay - thenDay) / (1000 * 60 * 60 * 24));
}

// ================================================================
// Render — Greeting
// ================================================================

function renderGreeting() {
  const name      = state.profile?.name ?? 'there';
  const count     = state.profile?.session_count ?? 0;
  const lastDate  = state.lastSession?.completed_at;

  let greeting, lastText;

  if (!lastDate || count === 0) {
    greeting = `Welcome to your first workout, ${name}.`;
    lastText  = 'No workouts yet';
  } else {
    const days = daysSince(lastDate);

    if (days === 0) {
      greeting = `Ready to go again, ${name}?`;
      lastText  = 'Last workout: today';
    } else if (days === 1) {
      greeting = `Nice to see you again, ${name}.`;
      lastText  = 'Last workout: yesterday';
    } else if (days <= 6) {
      greeting = `Nice to see you again, ${name}.`;
      lastText  = `Last workout: ${days} days ago`;
    } else {
      greeting = `Good to have you back, ${name}.`;
      lastText  = `Last workout: ${days} days ago`;
    }
  }

  DOM.greetingText.textContent = greeting;
  DOM.lastWorkout.textContent  = lastText;
}

// ================================================================
// Render — Workout preview card
// ================================================================

function renderWorkoutCard() {
  const day       = state.nextDay;
  const exercises = DAY_EXERCISES[day];

  DOM.trainingDay.textContent = `TRAINING ${day}`;

  DOM.exerciseList.innerHTML = exercises.map(ex => {
    const sets  = WORKING_SET_COUNT[ex] ?? 3;
    const label = EXERCISE_LABELS[ex]   ?? ex;
    return `
      <li>
        <span class="exercise-name">${label}</span>
        <span class="exercise-sets">${sets}×5</span>
      </li>`;
  }).join('');
}

// ================================================================
// Render — Random tip
// ================================================================

function renderTip() {
  const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
  DOM.tipText.textContent = tip;
}

// ================================================================
// Start Workout button
// ================================================================

function setupStartButton() {
  DOM.btnStart.addEventListener('click', () => {
    DOM.btnStart.classList.add('pulsing');
    // Navigate after animation completes (300ms)
    DOM.btnStart.addEventListener(
      'animationend',
      () => { window.location.href = 'workout.html'; },
      { once: true },
    );
  });
}

// ================================================================
// Init
// ================================================================

async function init() {
  state.user = await requireAuth();
  if (!state.user) return;

  // Load profile, last session, and next workout day in parallel
  const [profileRes, sessionRes, nextDay] = await Promise.all([
    supabase
      .from('profiles')
      .select('name, session_count, unit_preference')
      .eq('id', state.user.id)
      .maybeSingle(),

    supabase
      .from('sessions')
      .select('completed_at, session_number')
      .eq('user_id', state.user.id)
      .not('completed_at', 'is', null)
      .order('session_number', { ascending: false })
      .limit(1)
      .maybeSingle(),

    getNextWorkoutDay(state.user.id),
  ]);

  state.profile     = profileRes.data ?? {};
  state.lastSession = sessionRes.data ?? null;
  state.nextDay     = nextDay;

  renderGreeting();
  renderWorkoutCard();
  renderTip();
  setupStartButton();
}

init();
