/* Kennari — tracking531.js
   5/3/1 progress: last-set reps, estimated 1RM and training max per lift.
   Loaded by tracking.js only for 5/3/1 users; Lite Viking tracking lives in
   tracking.js. Uses the same page (tracking.html) and the same styles.

   Data:
   - training_maxes: one row per test (starting training max per lift)
   - sessions (program = '531', regular, completed): position comes from the
     order of completion, same as the engine (positionFromN)
   - sets: the last working set of each regular workout is the AMRAP set
     (weeks 1-3). Deload (week 4) has no AMRAP and is skipped for reps / 1RM.
   ------------------------------------------------ */

import { supabase }                       from './supabase.js';
import { convertToKg, EXERCISE_LABELS }   from './program.js';
import {
  LIFT_ORDER,
  positionFromN,
  tmForCycle,
  estimate1RM,
} from './program531.js';

// ================================================================
// Data building (pure — no DOM, no database)
// ================================================================

// maxRows:  training_maxes rows, oldest first
// sessions: completed regular 5/3/1 sessions, oldest first (session_number)
// sets:     working sets of those sessions
// Returns per lift: { startTm, reps[], e1rm[], tm[], pb }
export function buildSeries(maxRows, sessions, sets) {
  const result = {};
  LIFT_ORDER.forEach(l => {
    result[l] = { startTm: null, reps: [], e1rm: [], tm: [], pb: null };
  });

  // Tests: starting training max + a comparable estimated 1RM point
  maxRows.forEach(r => {
    const R = result[r.lift];
    if (!R) return;
    const entry = {
      date:      r.created_at,
      weightLbs: Number(r.test_weight_lbs),
      reps:      Number(r.test_reps),
      e1rm:      Number(r.e1rm_lbs),
      tm:        Number(r.training_max_lbs),
      test:      true,
    };
    R.e1rm.push(entry);
    R.tm.push(entry);
    R.startTm = entry.tm;           // latest test is the starting TM (as the engine)
  });

  const setsBySession = {};
  sets.forEach(s => { (setsBySession[s.session_id] ??= []).push(s); });
  Object.values(setsBySession).forEach(arr => arr.sort((a, b) => a.set_number - b.set_number));

  sessions.forEach((s, i) => {
    const lift = s.workout_day;
    const R    = result[lift];
    if (!R || R.startTm === null) return;

    const pos  = positionFromN(i);
    const base = {
      date:  s.completed_at,
      tm:    tmForCycle(R.startTm, lift, pos.cycle),
      week:  pos.week,
      cycle: pos.cycle,
    };

    R.tm.push({ ...base });         // every completed workout of this lift

    if (pos.week === 4) return;     // deload: no AMRAP set

    const sessionSets = setsBySession[s.id];
    const top = sessionSets?.[sessionSets.length - 1];   // last working set = AMRAP
    if (!top || top.reps_completed === null || top.reps_completed === undefined) return;

    const weightLbs = Number(top.weight_lbs);
    const reps      = Number(top.reps_completed);
    const entry = {
      ...base,
      weightLbs,
      reps,
      target: Number(top.reps_target),
      e1rm:   estimate1RM(weightLbs, reps),
    };
    R.reps.push(entry);
    R.e1rm.push(entry);
  });

  const byDate = (a, b) => new Date(a.date) - new Date(b.date);
  LIFT_ORDER.forEach(l => {
    const R = result[l];
    R.reps.sort(byDate);
    R.e1rm.sort(byDate);
    R.tm.sort(byDate);
    R.pb = R.e1rm.reduce((best, e) => (!best || e.e1rm > best.e1rm ? e : best), null);
  });

  return result;
}

// ================================================================
// State
// ================================================================

const METRICS = {
  reps: { title: 'Last Set Reps',   weight: false,
          empty: 'Your reps will appear here after two weeks of workouts for this lift.' },
  e1rm: { title: 'Estimated 1RM',   weight: true,
          empty: 'Keep training — your chart will appear here soon.' },
  tm:   { title: 'Training Max',    weight: true,
          empty: 'Keep training — your chart will appear here soon.' },
};

const state = {
  user:    null,
  profile: null,
  lift:    LIFT_ORDER[0],     // press
  metric:  'reps',
  range:   '8w',
  series:  {},
  goals:   {},                // { squat: { id, target_weight_lbs }, … }
  chart:   null,
  editOpen: false,
};

let DOM = {};

// ================================================================
// Unit + date helpers
// ================================================================

function unitLower() { return state.profile?.unit_preference ?? 'lbs'; }
function unitLabel() { return unitLower().toUpperCase(); }

// whole = true rounds an estimate to a whole number (estimated 1RM)
function toDisplay(lbs, whole = false) {
  if (unitLower() === 'kg') {
    return whole ? Math.round(lbs * 0.453592) : convertToKg(lbs);
  }
  return whole ? Math.round(lbs) : lbs;
}

function fromDisplay(val) {
  return unitLower() === 'kg' ? val / 0.453592 : val;
}

function formatDateShort(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateLong(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// Colors come from the CSS variables so style.css stays the single source
function cssColors() {
  const s = getComputedStyle(document.documentElement);
  const v = n => s.getPropertyValue(n).trim();
  return {
    accent:  v('--accent'),
    warning: v('--warning'),
    muted:   v('--text-muted'),
    surface: v('--surface'),
    border:  v('--border'),
    cream:   v('--cream'),
    bg:      v('--bg'),
  };
}

function withAlpha(hex, alpha) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const [r, g, b] = [m[1], m[2], m[3]].map(x => parseInt(x, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ================================================================
// Data loading
// ================================================================

async function loadAll() {
  const uid = state.user.id;

  const [maxesRes, sessionsRes, goalsRes] = await Promise.all([
    supabase
      .from('training_maxes')
      .select('lift, test_weight_lbs, test_reps, e1rm_lbs, training_max_lbs, created_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: true }),

    supabase
      .from('sessions')
      .select('id, workout_day, session_number, completed_at')
      .eq('user_id', uid)
      .eq('program', '531')
      .eq('is_test', false)
      .not('completed_at', 'is', null)
      .order('session_number', { ascending: true }),

    supabase
      .from('goals')
      .select('id, exercise, target_weight_lbs')
      .eq('user_id', uid),
  ]);

  if (maxesRes.error)    throw maxesRes.error;
  if (sessionsRes.error) throw sessionsRes.error;

  const sessions = sessionsRes.data ?? [];

  // Working sets for those sessions, in chunks to keep the request small
  let sets = [];
  for (let i = 0; i < sessions.length; i += 100) {
    const ids = sessions.slice(i, i + 100).map(s => s.id);
    const { data, error } = await supabase
      .from('sets')
      .select('session_id, set_number, weight_lbs, reps_target, reps_completed')
      .in('session_id', ids)
      .eq('set_type', 'working');
    if (error) throw error;
    sets = sets.concat(data ?? []);
  }

  state.series = buildSeries(maxesRes.data ?? [], sessions, sets);

  (goalsRes.data ?? []).forEach(g => {
    state.goals[g.exercise] = {
      id:                g.id,
      target_weight_lbs: parseFloat(g.target_weight_lbs),
    };
  });
}

// ================================================================
// Chart
// ================================================================

function getPoints() {
  const R   = state.series[state.lift];
  const all = R ? R[state.metric] : [];
  if (state.range === 'all') return all;

  const weeks  = state.range === '4w' ? 4 : 8;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - weeks * 7);
  return all.filter(p => new Date(p.date) >= cutoff);
}

function pointValue(p) {
  switch (state.metric) {
    case 'reps': return p.reps;
    case 'e1rm': return toDisplay(p.e1rm, true);
    default:     return toDisplay(p.tm);
  }
}

function renderChart() {
  const cfg    = METRICS[state.metric];
  const R      = state.series[state.lift];
  const points = getPoints();
  const unit   = unitLabel();
  const c      = cssColors();

  DOM.chartTitle.textContent = cfg.title;

  if (state.chart) {
    state.chart.destroy();
    state.chart = null;
  }

  if (points.length < 2) {
    DOM.chartEmpty.textContent = R && R.startTm === null
      ? 'Test this lift first. It comes up in your workout rotation.'
      : cfg.empty;
    DOM.chartEmpty.style.display  = 'block';
    DOM.chartCanvas.style.display = 'none';
    return;
  }

  DOM.chartEmpty.style.display  = 'none';
  DOM.chartCanvas.style.display = 'block';

  const labels = points.map(p => formatDateShort(p.date));

  const datasets = [{
    label:                cfg.title,
    data:                 points.map(pointValue),
    borderColor:          c.accent,
    backgroundColor:      'transparent',
    borderWidth:          2,
    tension:              0.4,
    pointRadius:          4,
    pointHoverRadius:     6,
    pointBackgroundColor: c.accent,
    pointBorderColor:     c.bg,
    pointBorderWidth:     2,
    fill:                 false,
  }];

  // Dashed reference line: the rep target for reps, the goal for weights
  const dashed = {
    borderColor: withAlpha(c.warning, 0.45),
    borderDash:  [6, 4],
    borderWidth: 1.5,
    pointRadius: 0,
    tension:     0,
    fill:        false,
  };

  if (state.metric === 'reps') {
    datasets.push({ ...dashed, label: 'Minimum', data: points.map(p => p.target) });
  } else {
    const goal = state.goals[state.lift];
    if (goal) {
      datasets.push({
        ...dashed,
        label: 'Goal',
        data:  points.map(() => toDisplay(goal.target_weight_lbs)),
      });
    }
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
          backgroundColor: c.surface,
          titleColor:      c.muted,
          bodyColor:       c.cream,
          borderColor:     c.border,
          borderWidth:     1,
          padding:         10,
          displayColors:   false,
          callbacks: {
            title: ctx => formatDateLong(points[ctx[0].dataIndex].date),
            label: ctx => {
              if (ctx.datasetIndex === 1) {
                return state.metric === 'reps'
                  ? `Minimum: ${ctx.parsed.y} reps`
                  : `Goal: ${ctx.parsed.y} ${unit}`;
              }
              return state.metric === 'reps'
                ? `${ctx.parsed.y} reps`
                : `${ctx.parsed.y} ${unit}`;
            },
            // Reps chart: also say what weight the reps were done with
            afterLabel: ctx => {
              if (ctx.datasetIndex !== 0 || state.metric !== 'reps') return '';
              const p = points[ctx.dataIndex];
              return `at ${toDisplay(p.weightLbs)} ${unit}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid:   { display: false },
          border: { color: withAlpha(c.border, 0.5) },
          ticks:  { color: c.muted, font: { family: 'DM Sans', size: 11 }, maxRotation: 0, maxTicksLimit: 6 },
        },
        y: {
          grid:   { display: false },
          border: { display: false },
          ticks: {
            color:     c.muted,
            font:      { family: 'DM Sans', size: 11 },
            precision: state.metric === 'reps' ? 0 : undefined,
            callback:  v => `${v}`,
          },
          beginAtZero: state.metric === 'reps',
        },
      },
    },
  });
}

// ================================================================
// Goal card (goal vs latest estimated 1RM)
// ================================================================

function renderGoal() {
  const unit = unitLabel();
  DOM.goalEditUnit.textContent = unit;
  DOM.goalExName.textContent   = EXERCISE_LABELS[state.lift] ?? state.lift;

  const goal = state.goals[state.lift];
  const R    = state.series[state.lift];
  const last = R && R.e1rm.length ? R.e1rm[R.e1rm.length - 1] : null;

  if (!goal) {
    DOM.goalBarFill.style.width = '0%';
    DOM.goalPct.textContent     = '—';
    DOM.goalDesc.textContent    = last
      ? `Estimated 1RM: ${toDisplay(last.e1rm, true)} ${unit} · No goal set`
      : 'Tap "Edit goal" to set a goal.';
    return;
  }

  const goalVal = toDisplay(goal.target_weight_lbs);

  if (last) {
    const pct = Math.min(Math.round((last.e1rm / goal.target_weight_lbs) * 100), 100);
    DOM.goalBarFill.style.width = `${pct}%`;
    DOM.goalPct.textContent     = `${pct}%`;
    DOM.goalDesc.textContent    =
      `Estimated 1RM: ${toDisplay(last.e1rm, true)} ${unit} · Goal: ${goalVal} ${unit}`;
  } else {
    DOM.goalBarFill.style.width = '0%';
    DOM.goalPct.textContent     = '0%';
    DOM.goalDesc.textContent    = `Goal: ${goalVal} ${unit}`;
  }
}

function openGoalEdit() {
  state.editOpen = true;
  const goal = state.goals[state.lift];
  DOM.goalInput.value = goal ? toDisplay(goal.target_weight_lbs) : '';
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
  const goal = state.goals[state.lift];
  let error;

  if (goal) {
    ({ error } = await supabase
      .from('goals')
      .update({ target_weight_lbs: lbs })
      .eq('id', goal.id));
    if (!error) state.goals[state.lift].target_weight_lbs = lbs;
  } else {
    const { data, error: insertError } = await supabase
      .from('goals')
      .insert({ user_id: state.user.id, exercise: state.lift, target_weight_lbs: lbs })
      .select('id, target_weight_lbs')
      .single();
    error = insertError;
    if (!error && data) {
      state.goals[state.lift] = { id: data.id, target_weight_lbs: parseFloat(data.target_weight_lbs) };
    }
  }

  if (!error) {
    closeGoalEdit();
    renderGoal();
    renderChart();
  }
}

// ================================================================
// Best estimated 1RM card
// ================================================================

function renderPersonalBest() {
  DOM.pbTitle.textContent = 'Best Estimated 1RM';

  const pb = state.series[state.lift]?.pb;
  if (!pb) {
    DOM.pbNumber.textContent = '—';
    DOM.pbUnit.textContent   = '';
    DOM.pbReps.textContent   = '';
    return;
  }

  DOM.pbNumber.textContent = toDisplay(pb.e1rm, true);
  DOM.pbUnit.textContent   = unitLabel();
  DOM.pbReps.textContent   =
    `${toDisplay(pb.weightLbs)} ${unitLabel()} × ${pb.reps} ${pb.reps === 1 ? 'rep' : 'reps'}`;
}

// ================================================================
// Controls
// ================================================================

function renderAll() {
  renderChart();
  renderGoal();
  renderPersonalBest();
}

function setupControls() {
  DOM.exPills.forEach(pill => {
    pill.addEventListener('click', () => {
      if (pill.dataset.ex === state.lift) return;
      DOM.exPills.forEach(p => p.classList.toggle('active', p === pill));
      state.lift = pill.dataset.ex;
      if (state.editOpen) closeGoalEdit();
      renderAll();
    });
  });

  DOM.metricBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.metric === state.metric) return;
      DOM.metricBtns.forEach(b => b.classList.toggle('active', b === btn));
      state.metric = btn.dataset.metric;
      renderChart();
    });
  });

  DOM.rangeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.range === state.range) return;
      DOM.rangeBtns.forEach(b => b.classList.toggle('active', b === btn));
      state.range = btn.dataset.range;
      renderChart();
    });
  });

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
// Init (called by tracking.js for 5/3/1 users)
// ================================================================

export async function init531({ user, profile }) {
  state.user    = user;
  state.profile = profile;

  DOM = {
    exPills:      document.querySelectorAll('.ex-pill'),
    rangeBtns:    document.querySelectorAll('.time-btn[data-range]'),
    metricBtns:   document.querySelectorAll('.metric-btn'),
    metricRow:    document.getElementById('metric-row'),
    chartTitle:   document.getElementById('chart-title'),
    chartCanvas:  document.getElementById('progress-chart'),
    chartEmpty:   document.getElementById('chart-empty'),
    goalExName:   document.getElementById('goal-exercise-name'),
    btnEditGoal:  document.getElementById('btn-edit-goal'),
    goalEditRow:  document.getElementById('goal-edit-row'),
    goalDisplay:  document.getElementById('goal-display'),
    goalInput:    document.getElementById('goal-input'),
    goalEditUnit: document.getElementById('goal-edit-unit'),
    btnSaveGoal:  document.getElementById('btn-save-goal'),
    goalBarFill:  document.getElementById('goal-bar-fill'),
    goalPct:      document.getElementById('goal-pct'),
    goalDesc:     document.getElementById('goal-desc'),
    pbTitle:      document.getElementById('pb-title'),
    pbNumber:     document.getElementById('pb-number'),
    pbUnit:       document.getElementById('pb-unit'),
    pbReps:       document.getElementById('pb-reps'),
  };

  DOM.metricRow.style.display = 'flex';

  // Start on the first lift in the rotation
  DOM.exPills.forEach(p => p.classList.toggle('active', p.dataset.ex === state.lift));

  try {
    await loadAll();
  } catch (err) {
    console.error('Could not load 5/3/1 tracking', err);
    DOM.chartEmpty.textContent    = "Couldn't load your progress. Check your connection and reload.";
    DOM.chartEmpty.style.display  = 'block';
    DOM.chartCanvas.style.display = 'none';
    return;
  }

  renderAll();
  setupControls();
}
