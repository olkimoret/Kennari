/* Kennari — tracking.js | Session 7
   Progress charts, goal tracking, and personal bests.
   ------------------------------------------------ */

import { supabase }                    from './supabase.js';
import { requireAuth }                 from './app.js';
import { convertToKg, EXERCISE_LABELS } from './program.js';

// ================================================================
// State
// ================================================================

const state = {
  user:                 null,
  profile:              null,
  exercise:             'squat',
  range:                '8w',         // default: last 8 weeks
  completedSessions:    [],           // { id, session_number, completed_at }
  allSessions:          [],           // { sessionNumber, completedAt, weightLbs }
  personalBest:         null,         // lbs
  goals:                {},           // { squat: { id, target_weight_lbs }, … }
  chart:                null,
  editOpen:             false,
};

// ================================================================
// DOM refs
// ================================================================

const DOM = {
  exPills:         document.querySelectorAll('.ex-pill'),
  timeBtns:        document.querySelectorAll('.time-btn'),
  chartCanvas:     document.getElementById('progress-chart'),
  chartEmpty:      document.getElementById('chart-empty'),
  // Goal card
  goalExName:      document.getElementById('goal-exercise-name'),
  btnEditGoal:     document.getElementById('btn-edit-goal'),
  goalEditRow:     document.getElementById('goal-edit-row'),
  goalDisplay:     document.getElementById('goal-display'),
  goalInput:       document.getElementById('goal-input'),
  goalEditUnit:    document.getElementById('goal-edit-unit'),
  btnSaveGoal:     document.getElementById('btn-save-goal'),
  goalBarFill:     document.getElementById('goal-bar-fill'),
  goalPct:         document.getElementById('goal-pct'),
  goalDesc:        document.getElementById('goal-desc'),
  // Personal best card
  pbNumber:        document.getElementById('pb-number'),
  pbUnit:          document.getElementById('pb-unit'),
  pbReps:          document.getElementById('pb-reps'),
};

// ================================================================
// Unit helpers
// ================================================================

function toDisplay(lbs) {
  const unit = state.profile?.unit_preference ?? 'lbs';
  if (unit === 'kg') {
    return { value: convertToKg(lbs), unit: 'kg' };
  }
  return { value: lbs, unit: 'lbs' };
}

// Convert a value in the user's current unit back to lbs for storage
function fromDisplay(val) {
  const unit = state.profile?.unit_preference ?? 'lbs';
  return unit === 'kg' ? val / 0.453592 : val;
}

function unitLabel() {
  return (state.profile?.unit_preference ?? 'lbs').toUpperCase();
}

// ================================================================
// Date helpers
// ================================================================

function formatDateShort(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day:   'numeric',
  });
}

function formatDateLong(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'long',
    day:   'numeric',
    year:  'numeric',
  });
}

// ================================================================
// Data loading
// ================================================================

// Called once on init — loads sessions + goals in parallel
async function loadInitialData() {
  const [sessionsRes, goalsRes] = await Promise.all([
    supabase
      .from('sessions')
      .select('id, session_number, completed_at')
      .eq('user_id', state.user.id)
      .not('completed_at', 'is', null)
      .order('session_number', { ascending: true }),
    supabase
      .from('goals')
      .select('id, exercise, target_weight_lbs')
      .eq('user_id', state.user.id),
  ]);

  // Goals
  if (goalsRes.data) {
    goalsRes.data.forEach(g => {
      state.goals[g.exercise] = {
        id:                g.id,
        target_weight_lbs: parseFloat(g.target_weight_lbs),
      };
    });
  }

  // Completed sessions
  state.completedSessions = sessionsRes.data ?? [];
}

// Called on init and on exercise tab switch — loads chart data + PR
async function loadExerciseData() {
  const sessions = state.completedSessions;

  if (sessions.length === 0) {
    state.allSessions = [];
    state.personalBest = null;
    return;
  }

  const sessionIds = sessions.map(s => s.id);

  // Fetch chart data (first working set per session) + PR in parallel
  const [setsRes, pbRes] = await Promise.all([
    supabase
      .from('sets')
      .select('session_id, weight_lbs')
      .in('session_id', sessionIds)
      .eq('exercise', state.exercise)
      .eq('set_type', 'working')
      .eq('set_number', 1),
    supabase
      .from('sets')
      .select('weight_lbs')
      .in('session_id', sessionIds)
      .eq('exercise', state.exercise)
      .eq('set_type', 'working')
      .order('weight_lbs', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // Build session lookup for joining
  const sessionMap = {};
  sessions.forEach(s => { sessionMap[s.id] = s; });

  // Chart data — one point per session, sorted chronologically
  const sets = setsRes.data ?? [];
  state.allSessions = sets
    .map(set => ({
      sessionNumber: sessionMap[set.session_id]?.session_number,
      completedAt:   sessionMap[set.session_id]?.completed_at,
      weightLbs:     parseFloat(set.weight_lbs),
    }))
    .filter(d => d.sessionNumber != null)
    .sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt));

  // Personal best
  state.personalBest = pbRes.data?.weight_lbs
    ? parseFloat(pbRes.data.weight_lbs)
    : null;
}

// ================================================================
// Filtering by time range
// ================================================================

function getFilteredSessions() {
  if (state.range === 'all') return state.allSessions;

  const weeks  = state.range === '4w' ? 4 : 8;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - weeks * 7);

  return state.allSessions.filter(d => new Date(d.completedAt) >= cutoff);
}

// ================================================================
// Chart
// ================================================================

function renderChart() {
  const filtered = getFilteredSessions();
  const unit     = state.profile?.unit_preference ?? 'lbs';

  // Destroy previous instance
  if (state.chart) {
    state.chart.destroy();
    state.chart = null;
  }

  // Need at least 2 points for a meaningful chart
  if (filtered.length < 2) {
    DOM.chartEmpty.style.display  = 'block';
    DOM.chartCanvas.style.display = 'none';
    return;
  }

  DOM.chartEmpty.style.display  = 'none';
  DOM.chartCanvas.style.display = 'block';

  const labels  = filtered.map(d => formatDateShort(d.completedAt));
  const weights = filtered.map(d => toDisplay(d.weightLbs).value);

  const datasets = [
    {
      label:                'Working Weight',
      data:                 weights,
      borderColor:          '#E07B6A',
      backgroundColor:      'transparent',
      borderWidth:          2,
      tension:              0.4,
      pointRadius:          4,
      pointHoverRadius:     6,
      pointBackgroundColor: '#E07B6A',
      pointBorderColor:     '#1E2428',
      pointBorderWidth:     2,
      fill:                 false,
    },
  ];

  // Dashed amber goal reference line
  const goal = state.goals[state.exercise];
  if (goal) {
    datasets.push({
      label:       'Goal',
      data:        filtered.map(() => toDisplay(goal.target_weight_lbs).value),
      borderColor: 'rgba(232, 185, 106, 0.45)',
      borderDash:  [6, 4],
      borderWidth: 1.5,
      pointRadius: 0,
      tension:     0,
      fill:        false,
    });
  }

  state.chart = new Chart(DOM.chartCanvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive:          true,
      maintainAspectRatio: true,
      aspectRatio:         1.7,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#2A3038',
          titleColor:      '#B8BDC4',
          bodyColor:       '#F2E8D9',
          borderColor:     '#3A424C',
          borderWidth:     1,
          padding:         10,
          displayColors:   false,
          callbacks: {
            title: ctx => formatDateLong(filtered[ctx[0].dataIndex].completedAt),
            label: ctx => {
              if (ctx.datasetIndex === 0) {
                return `${ctx.parsed.y} ${unit.toUpperCase()}`;
              }
              return `Goal: ${ctx.parsed.y} ${unit.toUpperCase()}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: 'rgba(58, 66, 76, 0.5)' },
          ticks: {
            color:       '#B8BDC4',
            font:        { family: 'DM Sans', size: 11 },
            maxRotation: 0,
            maxTicksLimit: 6,
          },
        },
        y: {
          grid:   { display: false },
          border: { display: false },
          ticks: {
            color:    '#B8BDC4',
            font:     { family: 'DM Sans', size: 11 },
            callback: v => `${v}`,
          },
        },
      },
    },
  });
}

// ================================================================
// Goal display
// ================================================================

function renderGoal() {
  const unit = unitLabel();
  DOM.goalEditUnit.textContent  = unit;
  DOM.goalExName.textContent    = EXERCISE_LABELS[state.exercise] ?? state.exercise;

  const goal      = state.goals[state.exercise];
  const lastEntry = state.allSessions[state.allSessions.length - 1];

  if (!goal) {
    DOM.goalBarFill.style.width = '0%';
    DOM.goalPct.textContent     = '—';
    DOM.goalDesc.textContent    = lastEntry
      ? `Current: ${toDisplay(lastEntry.weightLbs).value} ${unit} · No goal set`
      : 'Tap "Edit goal" to set a goal.';
    return;
  }

  const { value: goalVal } = toDisplay(goal.target_weight_lbs);

  if (lastEntry) {
    const { value: curVal } = toDisplay(lastEntry.weightLbs);
    const pct = Math.min(
      Math.round((lastEntry.weightLbs / goal.target_weight_lbs) * 100),
      100,
    );
    DOM.goalBarFill.style.width = `${pct}%`;
    DOM.goalPct.textContent     = `${pct}%`;
    DOM.goalDesc.textContent    = `Current: ${curVal} ${unit} · Goal: ${goalVal} ${unit}`;
  } else {
    DOM.goalBarFill.style.width = '0%';
    DOM.goalPct.textContent     = '0%';
    DOM.goalDesc.textContent    = `Goal: ${goalVal} ${unit}`;
  }
}

// ================================================================
// Personal best display
// ================================================================

function renderPersonalBest() {
  if (state.personalBest == null) {
    DOM.pbNumber.textContent = '—';
    DOM.pbUnit.textContent   = '';
    DOM.pbReps.textContent   = '';
    return;
  }

  const { value, unit } = toDisplay(state.personalBest);
  DOM.pbNumber.textContent = value;
  DOM.pbUnit.textContent   = unit.toUpperCase();
  DOM.pbReps.textContent   = '5 reps';
}

// ================================================================
// Goal editing
// ================================================================

function openGoalEdit() {
  state.editOpen = true;

  const goal = state.goals[state.exercise];
  DOM.goalInput.value = goal ? toDisplay(goal.target_weight_lbs).value : '';

  DOM.goalEditRow.style.display = 'flex';
  DOM.goalDisplay.style.display = 'none';
  DOM.btnEditGoal.textContent   = 'Cancel';
  DOM.goalInput.focus();
}

function closeGoalEdit() {
  state.editOpen = false;
  DOM.goalEditRow.style.display = 'none';
  DOM.goalDisplay.style.display = 'block';
  DOM.btnEditGoal.textContent   = 'Edit goal';
}

async function saveGoal() {
  const raw = parseFloat(DOM.goalInput.value);
  if (isNaN(raw) || raw <= 0) {
    DOM.goalInput.focus();
    return;
  }

  const lbs  = fromDisplay(raw);
  const goal = state.goals[state.exercise];
  let error;

  if (goal) {
    ({ error } = await supabase
      .from('goals')
      .update({ target_weight_lbs: lbs })
      .eq('id', goal.id));

    if (!error) {
      state.goals[state.exercise].target_weight_lbs = lbs;
    }
  } else {
    const { data, error: insertError } = await supabase
      .from('goals')
      .insert({
        user_id:           state.user.id,
        exercise:          state.exercise,
        target_weight_lbs: lbs,
      })
      .select('id, target_weight_lbs')
      .single();

    error = insertError;
    if (!error && data) {
      state.goals[state.exercise] = {
        id:                data.id,
        target_weight_lbs: parseFloat(data.target_weight_lbs),
      };
    }
  }

  if (!error) {
    closeGoalEdit();
    renderGoal();
    renderChart(); // redraw goal reference line
  }
}

// ================================================================
// Event listeners
// ================================================================

function setupExercisePills() {
  DOM.exPills.forEach(pill => {
    pill.addEventListener('click', async () => {
      if (pill.dataset.ex === state.exercise) return;

      DOM.exPills.forEach(p => p.classList.toggle('active', p === pill));
      state.exercise = pill.dataset.ex;

      if (state.editOpen) closeGoalEdit();

      await loadExerciseData();
      renderChart();
      renderGoal();
      renderPersonalBest();
    });
  });
}

function setupTimeToggle() {
  DOM.timeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.range === state.range) return;

      DOM.timeBtns.forEach(b => b.classList.toggle('active', b === btn));
      state.range = btn.dataset.range;
      renderChart();
    });
  });
}

function setupGoalEdit() {
  DOM.btnEditGoal.addEventListener('click', () => {
    if (state.editOpen) closeGoalEdit();
    else openGoalEdit();
  });

  DOM.btnSaveGoal.addEventListener('click', saveGoal);

  DOM.goalInput.addEventListener('keydown', e => {
    if (e.key === 'Enter')  saveGoal();
    if (e.key === 'Escape') closeGoalEdit();
  });
}

// ================================================================
// Init
// ================================================================

async function init() {
  state.user = await requireAuth();
  if (!state.user) return;

  // Load user profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', state.user.id)
    .maybeSingle();

  state.profile = profile;

  // Load sessions list + goals (parallel), then exercise-specific data
  await loadInitialData();
  await loadExerciseData();

  renderChart();
  renderGoal();
  renderPersonalBest();

  setupExercisePills();
  setupTimeToggle();
  setupGoalEdit();
}

init();
